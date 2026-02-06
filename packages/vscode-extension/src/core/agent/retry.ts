export const RETRY_INITIAL_DELAY_MS = 2000;
export const RETRY_BACKOFF_FACTOR = 2;
export const RETRY_MAX_DELAY_NO_HEADERS_MS = 30_000;
export const RETRY_MAX_DELAY_MS = 2_147_483_647; // max 32-bit signed integer for setTimeout

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
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

export type RetryableReason = { message: string; retryAfterMs?: number };

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

function getErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  const maybe = asRecord(error)?.name;
  return typeof maybe === 'string' ? maybe : '';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  const direct = asRecord(error)?.code;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const cause = asRecord(asRecord(error)?.cause)?.code;
  if (typeof cause === 'string' && cause.trim()) return cause.trim();
  return undefined;
}

function getStatusCode(error: unknown): number | undefined {
  const candidates = [
    asRecord(error)?.status,
    asRecord(error)?.statusCode,
    asRecord(asRecord(error)?.response)?.status,
    asRecord(asRecord(error)?.cause)?.status,
    asRecord(asRecord(error)?.cause)?.statusCode,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return undefined;
}

function getResponseHeaders(error: unknown): Record<string, string> | undefined {
  const candidates = [
    asRecord(error)?.responseHeaders,
    asRecord(asRecord(error)?.cause)?.responseHeaders,
    asRecord(error)?.headers,
    asRecord(asRecord(error)?.cause)?.headers,
    asRecord(asRecord(error)?.response)?.headers,
    asRecord(asRecord(asRecord(error)?.cause)?.response)?.headers,
    asRecord(asRecord(error)?.data)?.responseHeaders,
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

  return undefined;
}

function parseRetryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined;

  const retryAfterMs = headers['retry-after-ms'];
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const parsedSeconds = Number.parseFloat(retryAfter);
    if (!Number.isNaN(parsedSeconds)) {
      return Math.ceil(parsedSeconds * 1000);
    }

    const parsedDate = Date.parse(retryAfter);
    if (!Number.isNaN(parsedDate)) {
      const delta = parsedDate - Date.now();
      if (delta > 0) return Math.ceil(delta);
    }
  }

  return undefined;
}

export function retryable(error: unknown): RetryableReason | undefined {
  const name = getErrorName(error);
  const code = getErrorCode(error);
  const status = getStatusCode(error);
  const headers = getResponseHeaders(error);
  const retryAfterMs = parseRetryAfterMs(headers);

  if (name === 'AbortError') return undefined;

  const msg = getErrorMessage(error);
  const lower = msg.toLowerCase();

  if (status === 429) return { message: 'Too Many Requests', retryAfterMs };
  if (status === 503 || status === 502 || status === 504 || status === 529) {
    return { message: 'Provider is overloaded', retryAfterMs };
  }
  if (status && status >= 500) return { message: 'Provider server error', retryAfterMs };

  const transientCodes = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ECONNREFUSED',
    'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
    'UND_ERR_SOCKET_BUSY',
    'UND_ERR_INFO',
  ]);
  if (code && transientCodes.has(code)) return { message: 'Network error', retryAfterMs };

  if (lower.includes('terminated')) return { message: 'Connection terminated', retryAfterMs };
  if (lower.includes('socket hang up')) return { message: 'Network error', retryAfterMs };
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return { message: 'Rate limited', retryAfterMs };
  }
  if (lower.includes('overloaded') || lower.includes('exhausted') || lower.includes('unavailable')) {
    return { message: 'Provider is overloaded', retryAfterMs };
  }
  if (lower.includes('no_kv_space') || lower.includes('server_error') || lower.includes('internal server error')) {
    return { message: 'Provider server error', retryAfterMs };
  }

  if (typeof msg === 'string') {
    try {
      const json = JSON.parse(msg);
      const type = typeof json?.type === 'string' ? json.type : '';
      const errorType = typeof json?.error?.type === 'string' ? json.error.type : '';
      const errorCode = typeof json?.error?.code === 'string' ? json.error.code : '';
      const code = typeof json?.code === 'string' ? json.code : '';
      const message = typeof json?.error?.message === 'string' ? json.error.message : '';

      if (type === 'error' && errorType === 'too_many_requests') return { message: 'Too Many Requests', retryAfterMs };
      if (type === 'error' && (errorCode.includes('rate_limit') || code.includes('rate_limit'))) return { message: 'Rate limited', retryAfterMs };
      if (code.includes('exhausted') || code.includes('unavailable')) return { message: 'Provider is overloaded', retryAfterMs };
      if (message.includes('no_kv_space') || (type === 'error' && errorType === 'server_error') || !!json?.error) {
        return { message: 'Provider server error', retryAfterMs };
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}
