export const RETRY_INITIAL_DELAY_MS = 2000;
export const RETRY_BACKOFF_FACTOR = 2;
export const RETRY_MAX_DELAY_NO_HEADERS_MS = 30_000;
export const RETRY_MAX_DELAY_MS = 2_147_483_647; // max 32-bit signed integer for setTimeout

function createAbortError(): Error {
  const err = new Error('Aborted');
  (err as any).name = 'AbortError';
  return err;
}

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw createAbortError();
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.min(ms, RETRY_MAX_DELAY_MS));

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function delay(attempt: number, retryAfterMs?: number): number {
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(Math.ceil(retryAfterMs), RETRY_MAX_DELAY_MS);
  }

  const computed = RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, Math.max(0, attempt - 1));
  return Math.min(computed, RETRY_MAX_DELAY_NO_HEADERS_MS);
}

export type RetryableKind =
  | 'rate_limited'
  | 'provider_overloaded'
  | 'provider_server_error'
  | 'network_error'
  | 'connection_terminated'
  | 'responses_stream_parser_error';

export type RetryableReason = { kind: RetryableKind; message: string; retryAfterMs?: number };

function getErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || String(error);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);

    if (!current || typeof current !== 'object') break;
    current = (current as any).cause;
  }

  return chain;
}

function getErrorMessages(error: unknown): string[] {
  const chain = getErrorChain(error);
  const messages: string[] = [];

  for (const item of chain) {
    const message = getErrorMessage(item).trim();
    if (message) messages.push(message);
  }

  return messages;
}

function getErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  const maybe = (error as any)?.name;
  return typeof maybe === 'string' ? maybe : '';
}

function getErrorNames(error: unknown): string[] {
  const names: string[] = [];
  for (const item of getErrorChain(error)) {
    const name = getErrorName(item).trim();
    if (name) names.push(name);
  }
  return names;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getStringKey(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    if (!normalizedKeys.has(key.toLowerCase())) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function getErrorStringValue(error: unknown, keys: string[]): string | undefined {
  for (const item of getErrorChain(error)) {
    const record = recordOrUndefined(item);
    const data = recordOrUndefined(record?.data);
    const nestedError = recordOrUndefined(record?.error);
    const dataError = recordOrUndefined(data?.error);

    for (const source of [record, data, nestedError, dataError]) {
      const value = getStringKey(source, keys);
      if (value) return value;
    }
  }
  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  return getErrorStringValue(error, ['code', 'errorCode']);
}

function getErrorType(error: unknown): string | undefined {
  return getErrorStringValue(error, ['type', 'errorType']);
}

function getStatusCode(error: unknown): number | undefined {
  for (const item of getErrorChain(error)) {
    const candidates = [
      (item as any)?.status,
      (item as any)?.statusCode,
      (item as any)?.response?.status,
    ];

    for (const value of candidates) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }

  return undefined;
}

function getResponseHeaders(error: unknown): Record<string, string> | undefined {
  for (const item of getErrorChain(error)) {
    const candidates = [
      (item as any)?.responseHeaders,
      (item as any)?.headers,
      (item as any)?.response?.headers,
      (item as any)?.data?.responseHeaders,
    ];

    for (const value of candidates) {
      if (!value) continue;

      if (value instanceof Headers) {
        const out: Record<string, string> = {};
        for (const [k, v] of value.entries()) out[k.toLowerCase()] = v;
        return out;
      }

      if (typeof value === 'object') {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (typeof v === 'string') out[k.toLowerCase()] = v;
        }
        if (Object.keys(out).length > 0) return out;
      }
    }
  }

  return undefined;
}

function parseRetryResetMs(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    const now = Date.now();
    // Common provider reset headers use epoch seconds. Accept epoch milliseconds too.
    if (parsed > 1_000_000_000_000) {
      const delta = parsed - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    if (parsed > 1_000_000_000) {
      const delta = parsed * 1000 - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    // Some gateways use the same delta-seconds semantics as Retry-After.
    return Math.ceil(parsed * 1000);
  }

  const parsedDate = Date.parse(value);
  if (!Number.isNaN(parsedDate)) {
    const delta = parsedDate - Date.now();
    if (delta > 0) return Math.ceil(delta);
  }

  return undefined;
}

function parseRetryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined;

  const retryAfterMs = headers['retry-after-ms'];
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }

  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const parsed = parseRetryResetMs(retryAfter);
    if (parsed !== undefined) return parsed;
  }

  return (
    parseRetryResetMs(headers['x-ratelimit-reset']) ??
    parseRetryResetMs(headers['x-rate-limit-reset']) ??
    parseRetryResetMs(headers['ratelimit-reset'])
  );
}

function getRetryAfterMs(error: unknown): number | undefined {
  for (const item of getErrorChain(error)) {
    const direct = (item as any)?.retryAfterMs;
    if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
      return Math.ceil(direct);
    }
    if (typeof direct === 'string') {
      const parsed = Number.parseFloat(direct);
      if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
    }
  }
  return undefined;
}

export function retryable(error: unknown): RetryableReason | undefined {
  const names = getErrorNames(error);
  const code = getErrorCode(error);
  const type = getErrorType(error);
  const status = getStatusCode(error);
  const headers = getResponseHeaders(error);
  const retryAfterMs = getRetryAfterMs(error) ?? parseRetryAfterMs(headers);

  const normalizedNames = names.map((item) => item.toLowerCase());
  const normalizedCode = code?.toLowerCase();
  const normalizedType = type?.toLowerCase();

  if (normalizedNames.includes('aborterror') || normalizedCode === 'request_aborted' || normalizedType === 'aborted') {
    return undefined;
  }

  if (status === 429) return { kind: 'rate_limited', message: 'Too Many Requests', retryAfterMs };
  if (status === 503 || status === 502 || status === 504 || status === 529) {
    return { kind: 'provider_overloaded', message: 'Provider is overloaded', retryAfterMs };
  }
  if (status && status >= 500) return { kind: 'provider_server_error', message: 'Provider server error', retryAfterMs };

  if (
    normalizedCode === 'rate_limit_exceeded' ||
    normalizedCode === 'rate_limited' ||
    normalizedCode === 'too_many_requests' ||
    normalizedType === 'rate_limit_error' ||
    normalizedType === 'too_many_requests'
  ) {
    return { kind: 'rate_limited', message: 'Rate limited', retryAfterMs };
  }

  if (
    normalizedCode === 'server_is_overloaded' ||
    normalizedCode === 'slow_down' ||
    normalizedCode?.includes('exhausted') ||
    normalizedCode?.includes('unavailable')
  ) {
    return { kind: 'provider_overloaded', message: 'Provider is overloaded', retryAfterMs };
  }

  if (
    normalizedCode === 'no_kv_space' ||
    normalizedCode === 'server_error' ||
    normalizedCode === 'internal_server_error' ||
    normalizedType === 'server_error'
  ) {
    return { kind: 'provider_server_error', message: 'Provider server error', retryAfterMs };
  }

  const transientCodes = new Set([
    'network_error',
    'request_timeout',
    'stream_read_error',
    'econnreset',
    'etimedout',
    'epipe',
    'econnrefused',
    'enotfound',
    'und_err_connect_timeout',
    'und_err_headers_timeout',
    'und_err_body_timeout',
    'und_err_socket',
    'und_err_socket_busy',
    'und_err_info',
  ]);
  if (normalizedCode && transientCodes.has(normalizedCode)) {
    return { kind: 'network_error', message: 'Network error', retryAfterMs };
  }

  if (normalizedCode === 'stream_terminated') {
    return { kind: 'connection_terminated', message: 'Connection terminated', retryAfterMs };
  }

  if (normalizedCode === 'invalid_sse_json') {
    return { kind: 'responses_stream_parser_error', message: 'Responses stream parser error', retryAfterMs };
  }

  if (normalizedNames.includes('timeouterror')) {
    return { kind: 'network_error', message: 'Network error', retryAfterMs };
  }

  const messages = getErrorMessages(error);
  const msg = messages[0] ?? getErrorMessage(error);
  const lower = messages.length > 0 ? messages.join('\n').toLowerCase() : msg.toLowerCase();

  if (/\b(?:timed?\s*out|timeout)\b/i.test(lower)) {
    return { kind: 'network_error', message: 'Network error', retryAfterMs };
  }
  if (lower.includes('terminated')) return { kind: 'connection_terminated', message: 'Connection terminated', retryAfterMs };
  if (lower.includes('summaryparts') && lower.includes('undefined')) {
    return { kind: 'responses_stream_parser_error', message: 'Responses stream parser error', retryAfterMs };
  }
  if (lower.includes('text part') && lower.includes('not found')) {
    return { kind: 'responses_stream_parser_error', message: 'Responses stream parser error', retryAfterMs };
  }
  if (lower.includes('socket hang up')) return { kind: 'network_error', message: 'Network error', retryAfterMs };
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return { kind: 'rate_limited', message: 'Rate limited', retryAfterMs };
  }
  if (lower.includes('overloaded') || lower.includes('exhausted') || lower.includes('unavailable')) {
    return { kind: 'provider_overloaded', message: 'Provider is overloaded', retryAfterMs };
  }
  if (lower.includes('no_kv_space') || lower.includes('server_error') || lower.includes('internal server error')) {
    return { kind: 'provider_server_error', message: 'Provider server error', retryAfterMs };
  }

  if (typeof msg === 'string') {
    try {
      const json = JSON.parse(msg);
      const type = typeof json?.type === 'string' ? json.type.toLowerCase() : '';
      const errorType = typeof json?.error?.type === 'string' ? json.error.type.toLowerCase() : '';
      const errorCode = typeof json?.error?.code === 'string' ? json.error.code.toLowerCase() : '';
      const code = typeof json?.code === 'string' ? json.code.toLowerCase() : '';
      const message = typeof json?.error?.message === 'string' ? json.error.message.toLowerCase() : '';

      if (errorType === 'too_many_requests') return { kind: 'rate_limited', message: 'Too Many Requests', retryAfterMs };
      if (errorType === 'rate_limit_error' || errorCode.includes('rate_limit') || code.includes('rate_limit')) {
        return { kind: 'rate_limited', message: 'Rate limited', retryAfterMs };
      }
      if (errorCode.includes('exhausted') || errorCode.includes('unavailable') || code.includes('exhausted') || code.includes('unavailable')) {
        return { kind: 'provider_overloaded', message: 'Provider is overloaded', retryAfterMs };
      }
      if (
        errorCode === 'no_kv_space' ||
        code === 'no_kv_space' ||
        errorCode === 'server_error' ||
        code === 'server_error' ||
        errorCode === 'internal_server_error' ||
        code === 'internal_server_error' ||
        errorType === 'server_error' ||
        message.includes('no_kv_space') ||
        (type === 'error' && message.includes('internal server error'))
      ) {
        return { kind: 'provider_server_error', message: 'Provider server error', retryAfterMs };
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}
