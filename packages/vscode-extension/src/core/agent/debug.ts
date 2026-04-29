import * as os from 'node:os';
import * as crypto from 'crypto';
import type { ToolResult } from '../types';
import { TOOL_ERROR_CODES } from '@kooka/core';

export type DebugRedactionLevel = 'full' | 'secrets-only';

export function truncateForDebug(value: string, max = 500): string {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

const URL_REGEX = /\bhttps?:\/\/[^\s"'<>]+/gi;
const FILE_URL_REGEX = /\bfile:\/\/[^\s"'<>]+/gi;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const BRACKETED_IPV6_REGEX = /\[(?:[0-9a-f]{0,4}:){1,7}[0-9a-f]{0,4}\](?::\d{1,5})?/gi;
const LOCALHOST_REGEX = /\blocalhost\b(?::\d{1,5})?/gi;
const LOCAL_DOMAIN_REGEX = /\b(?:[a-z0-9-]+\.)+(?:local|localhost)\b(?::\d{1,5})?/gi;
const PRIVATE_DOMAIN_REGEX = /\b(?:[a-z0-9-]+\.)+(?:internal|lan|corp|home)\b(?::\d{1,5})?/gi;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._-]+/gi;
const BASIC_AUTH_REGEX = /Basic\s+[A-Za-z0-9+/=]+/gi;
const OPENAI_API_KEY_REGEX = /\bsk-[A-Za-z0-9_-]{6,}\b/g;
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

type DebugFormatOptions = {
  redactionLevel?: DebugRedactionLevel;
};

function redactSecrets(text: string): string {
  let out = String(text ?? '');
  out = out.replace(BEARER_REGEX, 'Bearer <redacted>');
  out = out.replace(BASIC_AUTH_REGEX, 'Basic <redacted>');
  out = out.replace(OPENAI_API_KEY_REGEX, 'sk-<redacted>');
  out = out.replace(JSON_SECRET_KV_REGEX, '$1"<redacted>"');
  out = out.replace(INLINE_SECRET_KV_REGEX, '$1$2<redacted>');
  return out;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function redactPrivateHosts(text: string): string {
  let out = text;
  out = out.replace(LOCAL_DOMAIN_REGEX, '<local-host>');
  out = out.replace(PRIVATE_DOMAIN_REGEX, '<private-host>');
  out = out.replace(LOCALHOST_REGEX, '<local-host>');
  out = out.replace(BRACKETED_IPV6_REGEX, '<ip>');
  out = out.replace(IPV4_REGEX, (match) => (isPrivateIpv4(match) ? '<private-ip>' : match));
  return out;
}

export function redactSensitive(text: string, options?: DebugFormatOptions): string {
  let out = redactSecrets(text);
  if ((options?.redactionLevel ?? 'full') === 'secrets-only') {
    return redactPrivateHosts(out);
  }
  out = out.replace(URL_REGEX, '<url>');
  out = out.replace(FILE_URL_REGEX, '<file-url>');
  out = redactPrivateHosts(out);
  out = out.replace(IPV4_REGEX, '<ip>');
  out = redactHomePath(out);
  return out;
}

function redactHomePath(text: string): string {
  const homeDir = String(os.homedir() || '').trim();
  if (!homeDir) return text;

  const variants = new Set<string>([homeDir]);
  if (homeDir.includes('\\')) variants.add(homeDir.replace(/\\/g, '/'));
  if (homeDir.includes('/')) variants.add(homeDir.replace(/\//g, '\\'));

  let out = text;
  for (const variant of variants) {
    if (!variant) continue;
    out = out.replace(new RegExp(escapeRegex(variant), 'gi'), '~');
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function summarizeErrorForDebug(error: unknown, options?: DebugFormatOptions): string {
  const redactionLevel = options?.redactionLevel ?? 'full';
  const cause = getErrorCause(error);
  const causeMessage = cause ? formatErrorMessageForDebug(cause, { includeName: true }) : '';

  const errorCode = getErrorCode(error);
  const errorType = getErrorType(error);
  const parts = [
    `name=${getErrorName(error)}`,
    errorCode ? `code=${truncateForDebug(redactSensitive(errorCode, { redactionLevel }), 160)}` : '',
    errorType ? `type=${truncateForDebug(redactSensitive(errorType, { redactionLevel }), 160)}` : '',
    typeof getErrorStatus(error) === 'number' ? `status=${String(getErrorStatus(error))}` : '',
    ...getProviderDiagnosticsForDebug(error, redactionLevel),
    `message=${truncateForDebug(redactSensitive(getErrorMessage(error), { redactionLevel }), 500)}`,
    causeMessage
      ? `cause=${truncateForDebug(redactSensitive(causeMessage, { redactionLevel }), 500)}`
      : '',
  ].filter(Boolean);

  return parts.join(' ');
}

export function formatDetailedErrorForDebug(error: unknown, options?: DebugFormatOptions): string {
  const redactionLevel = options?.redactionLevel ?? 'full';
  const lines: string[] = [];

  for (const [index, item] of getErrorChain(error).entries()) {
    const label = index === 0 ? 'error' : `cause[${index}]`;
    const itemCode = getErrorCode(item);
    const itemType = getErrorType(item);
    const parts = [
      `name=${getErrorName(item)}`,
      itemCode ? `code=${truncateForDebug(redactSensitive(itemCode, { redactionLevel }), 160)}` : '',
      itemType ? `type=${truncateForDebug(redactSensitive(itemType, { redactionLevel }), 160)}` : '',
      typeof getErrorStatus(item) === 'number' ? `status=${String(getErrorStatus(item))}` : '',
      ...getProviderDiagnosticsForDebug(item, redactionLevel),
      `message=${truncateForDebug(redactSensitive(getErrorMessage(item), { redactionLevel }), 1000)}`,
    ].filter(Boolean);

    lines.push(`${label}: ${parts.join(' ')}`);

    const responseHeaders = getErrorResponseHeaders(item);
    if (responseHeaders !== undefined) {
      lines.push(
        `${label}.headers=${truncateForDebug(redactSensitive(safeJsonStringify(responseHeaders), { redactionLevel }), 1000)}`,
      );
    }

    const stack = getErrorStack(item);
    if (stack) {
      lines.push(`${label}.stack=${truncateForDebug(redactSensitive(stack, { redactionLevel }), 2000)}`);
    }
  }

  return lines.join('\n');
}

export function formatToolFailureForDebug(result: ToolResult, options?: DebugFormatOptions): string {
  const redactionLevel = options?.redactionLevel ?? 'full';
  const errorCode = result.metadata?.errorCode ? String(result.metadata.errorCode) : '';
  const errorType = result.metadata?.errorType ? String(result.metadata.errorType) : '';
  const label = errorCode || errorType;
  const errorRaw = result.error ? String(result.error) : 'Unknown error';
  const error = truncateForDebug(redactSensitive(errorRaw, { redactionLevel }), 500);

  const extra: string[] = [];
  if (result.metadata && typeof result.metadata === 'object') {
    const meta = result.metadata as Record<string, unknown>;
    if (label === TOOL_ERROR_CODES.external_paths_disabled) {
      const settingKey = typeof meta.blockedSettingKey === 'string' ? meta.blockedSettingKey : '';
      if (settingKey) extra.push(`setting=${settingKey}`);

      const blockedPathsRaw = meta.blockedPaths;
      if (Array.isArray(blockedPathsRaw)) {
        const paths = blockedPathsRaw
          .filter((p): p is string => typeof p === 'string' && !!p.trim())
          .slice(0, 5)
          .map(p => truncateForDebug(redactSensitive(p, { redactionLevel }), 120));
        if (paths.length) {
          const suffix = blockedPathsRaw.length > paths.length ? ',…' : '';
          extra.push(`paths=${paths.join(',')}${suffix}`);
        }
      }
    }
  }
  if (label.startsWith('edit_') && result.metadata) {
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

  const parts = [label, truncateForDebug(error, 500), extra.length ? `(${extra.join(' ')})` : ''].filter(Boolean);
  return parts.join(': ');
}

export function summarizeToolArgsForDebug(args: unknown, options?: DebugFormatOptions): string {
  const redactionLevel = options?.redactionLevel ?? 'full';
  if (!args || typeof args !== 'object') {
    return truncateForDebug(redactSensitive(safeJsonStringify(args ?? null), { redactionLevel }), 500);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (isSensitiveArgKey(key)) {
      const len = typeof value === 'string' ? value.length : 0;
      out[key] = len > 0 ? `<redacted:${len} chars>` : '<redacted>';
      continue;
    }

    if (typeof value === 'string') {
      out[key] = truncateForDebug(redactSensitive(value, { redactionLevel }), 200);
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

  return truncateForDebug(redactSensitive(safeJsonStringify(out), { redactionLevel }), 800);
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function getErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  while (current !== undefined && current !== null) {
    if (typeof current === 'object') {
      if (seen.has(current)) break;
      seen.add(current);
    }

    chain.push(current);
    current = getErrorCause(current);
  }

  return chain;
}

function getErrorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  const record = asRecord(error);
  return typeof record?.name === 'string' ? record.name : 'UnknownError';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return safeJsonStringify(error);
}

function getErrorCode(error: unknown): string {
  const record = asRecord(error);
  return typeof record?.code === 'string' ? record.code : '';
}

function getErrorType(error: unknown): string {
  const record = asRecord(error);
  if (typeof record?.type === 'string' && record.type.trim()) return record.type.trim();
  if (typeof record?.errorType === 'string' && record.errorType.trim()) return record.errorType.trim();
  return '';
}

function getErrorStringField(error: unknown, keys: string[]): string {
  const record = asRecord(error);
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getErrorNumberField(error: unknown, keys: string[]): number | undefined {
  const record = asRecord(error);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function getProviderDiagnosticsForDebug(error: unknown, redactionLevel: DebugRedactionLevel): string[] {
  const provider = getErrorStringField(error, ['providerId', 'provider']);
  const requestId = getErrorStringField(error, ['requestId']);
  const cfRay = getErrorStringField(error, ['cfRay']);
  const authorizationError = getErrorStringField(error, ['authorizationError', 'identityAuthorizationError']);
  const identityErrorCode = getErrorStringField(error, ['identityErrorCode']);
  const identityErrorType = getErrorStringField(error, ['identityErrorType']);
  const retryAfterMs = getErrorNumberField(error, ['retryAfterMs']);

  const stringPart = (key: string, value: string) => {
    const safe = truncateForDebug(redactSensitive(value, { redactionLevel }), 160);
    return safe ? `${key}=${safe}` : '';
  };

  return [
    provider ? stringPart('provider', provider) : '',
    requestId ? stringPart('requestId', requestId) : '',
    cfRay ? stringPart('cfRay', cfRay) : '',
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? `retryAfterMs=${String(Math.ceil(retryAfterMs))}`
      : '',
    authorizationError ? stringPart('authorizationError', authorizationError) : '',
    identityErrorCode ? stringPart('identityErrorCode', identityErrorCode) : '',
    identityErrorType ? stringPart('identityErrorType', identityErrorType) : '',
  ].filter(Boolean);
}

function getErrorStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  const candidates = [record?.status, record?.statusCode, asRecord(record?.response)?.status];
  return candidates.find(v => typeof v === 'number' && Number.isFinite(v)) as number | undefined;
}

function getErrorCause(error: unknown): unknown {
  return (error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined) ?? asRecord(error)?.cause;
}

function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return typeof error.stack === 'string' ? error.stack : undefined;
  const record = asRecord(error);
  return typeof record?.stack === 'string' ? record.stack : undefined;
}

function getErrorResponseHeaders(error: unknown): unknown {
  const record = asRecord(error);
  return record?.responseHeaders ?? asRecord(record?.response)?.headers;
}

function formatErrorMessageForDebug(error: unknown, options?: { includeName?: boolean }): string {
  const message = getErrorMessage(error);
  if (!options?.includeName) return message;
  const name = getErrorName(error);
  return name && name !== 'UnknownError' ? `${name}: ${message}` : message;
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
