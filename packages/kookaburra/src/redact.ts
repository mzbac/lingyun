const URL_REGEX = /\bhttps?:\/\/[^\s"'<>]+/gi;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b/g;
const BEARER_REGEX = /Bearer\\s+[A-Za-z0-9._-]+/gi;
const BASIC_AUTH_REGEX = /Basic\\s+[A-Za-z0-9+/=]+/gi;
const JSON_SECRET_KV_REGEX =
  /(\"(?:authorization|proxy-authorization|proxyauthorization|apikey|api_key|x-api-key|token|access_token|accesstoken|refresh_token|refreshtoken|secret|client_secret|clientsecret|password|passwd|cookie|set-cookie|private_key|privatekey)\"\\s*:\\s*)\"[^\"]*\"/gi;
const INLINE_SECRET_KV_REGEX =
  /\\b(authorization|proxy-authorization|proxyauthorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|cookie|set-cookie|private[-_]?key)\\b(\\s*[:=]\\s*)([^\\s,;]+)/gi;

export function truncateForDisplay(value: string, max = 500): string {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

export function redactSensitive(text: string): string {
  let out = String(text ?? '');
  out = out.replace(BEARER_REGEX, 'Bearer <redacted>');
  out = out.replace(BASIC_AUTH_REGEX, 'Basic <redacted>');
  out = out.replace(JSON_SECRET_KV_REGEX, '$1\"<redacted>\"');
  out = out.replace(INLINE_SECRET_KV_REGEX, '$1$2<redacted>');
  out = out.replace(URL_REGEX, '<url>');
  out = out.replace(IPV4_REGEX, '<ip>');
  return out;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const SENSITIVE_KEYS = new Set([
  'content',
  'patch',
  'diff',
  'oldstring',
  'newstring',
  'authorization',
  'proxy-authorization',
  'proxyauthorization',
  'apikey',
  'api_key',
  'x-api-key',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'client_secret',
  'password',
  'cookie',
  'set-cookie',
  'private_key',
  'headers',
  'credentials',
  'credential',
]);

export function summarizeArgsForDisplay(args: unknown, max = 500): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return truncateForDisplay(redactSensitive(safeJsonStringify(args)), max);
  }

  const record = args as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower)) {
      out[key] = '<redacted>';
      continue;
    }

    if (typeof value === 'string') {
      out[key] = truncateForDisplay(redactSensitive(value), 200);
      continue;
    }

    out[key] = value;
  }

  return truncateForDisplay(redactSensitive(safeJsonStringify(out)), max);
}

