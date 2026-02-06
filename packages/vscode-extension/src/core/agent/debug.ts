import * as crypto from 'crypto';
import type { ToolResult } from '../types';

export function truncateForDebug(value: string, max = 500): string {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

const URL_REGEX = /\bhttps?:\/\/[^\s"'<>]+/gi;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._-]+/gi;

export function redactSensitive(text: string): string {
  let out = String(text ?? '');
  out = out.replace(BEARER_REGEX, 'Bearer <redacted>');
  out = out.replace(URL_REGEX, '<url>');
  out = out.replace(IPV4_REGEX, '<ip>');
  return out;
}

export function summarizeErrorForDebug(error: unknown): string {
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

  const name =
    error instanceof Error
      ? error.name
      : typeof asRecord(error)?.name === 'string'
        ? (asRecord(error)?.name as string)
        : 'UnknownError';

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();

  const codeCandidate =
    typeof asRecord(error)?.code === 'string'
      ? (asRecord(error)?.code as string)
      : typeof asRecord(asRecord(error)?.cause)?.code === 'string'
        ? (asRecord(asRecord(error)?.cause)?.code as string)
        : '';

  const statusCandidates = [
    asRecord(error)?.status,
    asRecord(error)?.statusCode,
    asRecord(asRecord(error)?.response)?.status,
    asRecord(asRecord(error)?.cause)?.status,
    asRecord(asRecord(error)?.cause)?.statusCode,
    asRecord(asRecord(asRecord(error)?.cause)?.response)?.status,
  ];

  const status = statusCandidates.find(v => typeof v === 'number' && Number.isFinite(v)) as number | undefined;

  const cause = (error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined) ?? asRecord(error)?.cause;
  const causeMessage =
    cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : typeof cause === 'string'
        ? cause
        : (() => {
            if (!cause) return '';
            try {
              return JSON.stringify(cause);
            } catch {
              return String(cause);
            }
          })();

  const parts = [
    `name=${name}`,
    codeCandidate ? `code=${codeCandidate}` : '',
    typeof status === 'number' ? `status=${String(status)}` : '',
    `message=${truncateForDebug(redactSensitive(message), 500)}`,
    causeMessage ? `cause=${truncateForDebug(redactSensitive(causeMessage), 500)}` : '',
  ].filter(Boolean);

  return parts.join(' ');
}

export function formatToolFailureForDebug(result: ToolResult): string {
  const errorType = result.metadata?.errorType ? String(result.metadata.errorType) : '';
  const errorRaw = result.error ? String(result.error) : 'Unknown error';
  const error = truncateForDebug(redactSensitive(errorRaw), 500);

  const extra: string[] = [];
  if (result.metadata && typeof result.metadata === 'object') {
    const meta = result.metadata as Record<string, unknown>;
    if (errorType === 'external_paths_disabled') {
      const settingKey = typeof meta.blockedSettingKey === 'string' ? meta.blockedSettingKey : '';
      if (settingKey) extra.push(`setting=${settingKey}`);

      const blockedPathsRaw = meta.blockedPaths;
      if (Array.isArray(blockedPathsRaw)) {
        const paths = blockedPathsRaw
          .filter((p): p is string => typeof p === 'string' && !!p.trim())
          .slice(0, 5)
          .map(p => truncateForDebug(redactSensitive(p), 120));
        if (paths.length) {
          const suffix = blockedPathsRaw.length > paths.length ? ',…' : '';
          extra.push(`paths=${paths.join(',')}${suffix}`);
        }
      }
    }
  }
  if (errorType.startsWith('edit_') && result.metadata) {
    const meta = result.metadata as Record<string, unknown>;
    const oldLen = typeof meta.oldStringLength === 'number' ? meta.oldStringLength : undefined;
    const sha = typeof meta.oldStringSha256 === 'string' ? meta.oldStringSha256 : undefined;
    const hasLinePrefix = meta.hasLinePrefix === true;
    const hasFileTags = meta.hasFileTags === true;

    if (typeof oldLen === 'number') {
      extra.push(`oldLen=${String(oldLen)}`);
    }
    if (typeof sha === 'string' && sha) {
      extra.push(`oldSha=${sha.slice(0, 12)}`);
    }
    if (hasLinePrefix) {
      extra.push('hasLinePrefix');
    }
    if (hasFileTags) {
      extra.push('hasFileTags');
    }
  }

  const parts = [errorType, truncateForDebug(error, 500), extra.length ? `(${extra.join(' ')})` : ''].filter(Boolean);
  return parts.join(': ');
}

export function summarizeToolArgsForDebug(args: unknown): string {
  const redactKeys = new Set(['content', 'patch', 'patchText', 'diff', 'oldString', 'newString']);

  if (!args || typeof args !== 'object') {
    return truncateForDebug(JSON.stringify(args ?? null), 500);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (redactKeys.has(key)) {
      const len = typeof value === 'string' ? value.length : 0;
      out[key] = `<${len} chars>`;
      continue;
    }

    if (typeof value === 'string') {
      out[key] = truncateForDebug(value, 200);
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      out[key] = `<array len=${value.length}>`;
      continue;
    }

    if (value && typeof value === 'object') {
      out[key] = '<object>';
      continue;
    }

    out[key] = value ?? null;
  }

  return truncateForDebug(JSON.stringify(out), 800);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashJsonLines(items: unknown[]): { sha256: string; bytes: number } {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (const item of items) {
    const line = JSON.stringify(item) + '\n';
    hash.update(line, 'utf8');
    bytes += Buffer.byteLength(line, 'utf8');
  }
  return { sha256: hash.digest('hex'), bytes };
}
