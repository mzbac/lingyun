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
const BASIC_AUTH_REGEX = /Basic\s+[A-Za-z0-9+/=]+/gi;
const JSON_SECRET_KV_REGEX =
  /("(?:authorization|proxy-authorization|proxyauthorization|apikey|api_key|x-api-key|token|access_token|accesstoken|refresh_token|refreshtoken|secret|client_secret|clientsecret|password|passwd|cookie|set-cookie|private_key|privatekey)"\s*:\s*)"[^"]*"/gi;
const INLINE_SECRET_KV_REGEX =
  /\b(authorization|proxy-authorization|proxyauthorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|cookie|set-cookie|private[-_]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi;

const SENSITIVE_TOOL_ARG_KEYS = new Set([
  'content',
  'patch',
  'patchtext',
  'diff',
  'oldstring',
  'newstring',
  'authorization',
  'proxyauthorization',
  'apikey',
  'xapikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'password',
  'passwd',
  'cookie',
  'setcookie',
  'privatekey',
  'headers',
  'credentials',
  'credential',
]);

export function redactSensitive(text: string): string {
  let out = String(text ?? '');
  out = out.replace(BEARER_REGEX, 'Bearer <redacted>');
  out = out.replace(BASIC_AUTH_REGEX, 'Basic <redacted>');
  out = out.replace(JSON_SECRET_KV_REGEX, '$1"<redacted>"');
  out = out.replace(INLINE_SECRET_KV_REGEX, '$1$2<redacted>');
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
  if (!args || typeof args !== 'object') {
    return truncateForDebug(redactSensitive(safeJsonStringify(args ?? null)), 500);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (isSensitiveArgKey(key)) {
      const len = typeof value === 'string' ? value.length : 0;
      out[key] = len > 0 ? `<redacted:${len} chars>` : '<redacted>';
      continue;
    }

    if (typeof value === 'string') {
      out[key] = truncateForDebug(redactSensitive(value), 200);
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

  return truncateForDebug(redactSensitive(safeJsonStringify(out)), 800);
}

function isSensitiveArgKey(key: string): boolean {
  const normalized = String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!normalized) return false;
  if (SENSITIVE_TOOL_ARG_KEYS.has(normalized)) return true;
  if (normalized.endsWith('token')) return true;
  if (normalized.endsWith('secret')) return true;
  if (normalized.endsWith('password')) return true;
  if (normalized.endsWith('cookie')) return true;
  if (normalized.endsWith('apikey')) return true;
  if (normalized.endsWith('authorization')) return true;
  if (normalized.endsWith('privatekey')) return true;
  if (normalized.endsWith('headers')) return true;
  return false;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
