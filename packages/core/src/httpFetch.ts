/**
 * Shared HTTP fetch machinery (undici) used by both @kooka/agent-sdk and the
 * VS Code extension.
 *
 * Owns the knowledge that would otherwise be duplicated per package:
 * - Case-insensitive header merging (`setHeader`/`hasHeader`/`mergeHeaders`)
 * - Request-input introspection (`isRequestInput`/`inputHeaders`/`requestInputUrl`/`requestInputInit`)
 * - Timeout + combined abort-signal helpers
 * - `createFetchWithStreamingDefaults`: an undici fetch whose Agent allows
 *   long-lived streaming SSE responses (bodyTimeout/headersTimeout = 0) and
 *   sets `accept-encoding: identity` unless the caller already specified one.
 *
 * The fetch returned by `createFetchWithStreamingDefaults` is intentionally
 * the only timeout source: request lifetime is bounded by the AbortSignal
 * timeout, never by undici's header/body timeouts.
 */
import { Agent, fetch as undiciFetch } from 'undici';

/** Structural `FetchFunction` (avoids a direct dep on `@ai-sdk/provider-utils`). */
export type LingyunFetch = (input: unknown, init?: unknown) => Promise<Response>;

const hasOwnHeader = Object.prototype.hasOwnProperty;

function setHeader(headers: Record<string, string>, name: unknown, value: unknown): void {
  if (value === undefined || value === null) return;
  const key = String(name).trim();
  if (!key) return;

  const normalized = key.toLowerCase();
  for (const existing in headers) {
    if (!hasOwnHeader.call(headers, existing)) continue;
    if (existing.toLowerCase() === normalized) delete headers[existing];
  }

  headers[key] = String(value);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  for (const key in headers) {
    if (!hasOwnHeader.call(headers, key)) continue;
    if (key.toLowerCase() === normalized) return true;
  }
  return false;
}

function isRequestInput(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function inputHeaders(input: unknown): Headers | undefined {
  return isRequestInput(input) ? input.headers : undefined;
}

function requestInputUrl(input: string | URL | Request): string | URL {
  return isRequestInput(input) ? input.url : input;
}

type RequestInputInit = RequestInit & {
  cache?: Request['cache'];
  credentials?: Request['credentials'];
  duplex?: 'half';
  integrity?: Request['integrity'];
  keepalive?: Request['keepalive'];
  mode?: Request['mode'];
  redirect?: Request['redirect'];
  referrer?: Request['referrer'];
  referrerPolicy?: Request['referrerPolicy'];
};

function requestInputInit(input: string | URL | Request): RequestInputInit {
  if (!isRequestInput(input)) return {};

  const init: RequestInputInit = {
    cache: input.cache,
    credentials: input.credentials,
    integrity: input.integrity,
    keepalive: input.keepalive,
    method: input.method,
    mode: input.mode,
    redirect: input.redirect,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    signal: input.signal,
  };

  if (input.body) {
    init.body = input.body;
    init.duplex = 'half';
  }

  return init;
}

function mergeHeaders(headers: Record<string, string>, initHeaders: unknown): void {
  if (!initHeaders) return;

  if (Array.isArray(initHeaders)) {
    for (const [k, v] of initHeaders) setHeader(headers, k, v);
    return;
  }

  if (initHeaders instanceof Headers) {
    for (const [k, v] of initHeaders.entries()) setHeader(headers, k, v);
    return;
  }

  if (typeof initHeaders === 'object') {
    const headerRecord = initHeaders as Record<string, unknown>;
    for (const key in headerRecord) {
      if (!hasOwnHeader.call(headerRecord, key)) continue;
      const value = headerRecord[key];
      setHeader(headers, key, value);
    }
  }
}

function abortSignalReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function createTimeoutError(timeoutMs: number): Error {
  const domException = globalThis.DOMException;
  if (typeof domException === 'function') {
    return new domException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError');
  }
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.name = 'TimeoutError';
  return error;
}

export function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const abortSignalExt = AbortSignal as typeof AbortSignal & {
    timeout?: (ms: number) => AbortSignal;
  };
  const timeoutFn = abortSignalExt.timeout;
  if (typeof timeoutFn === 'function') {
    return timeoutFn(timeoutMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(createTimeoutError(timeoutMs)), timeoutMs);
  timeout.unref?.();
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

export function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const abortSignalExt = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  };
  const any = abortSignalExt.any;
  if (typeof any === 'function') {
    return any(signals);
  }

  if (signals.length === 1) return signals[0];

  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(abortSignalReason(signal));
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener('abort', () => abortFrom(signal), { once: true });
  }
  return controller.signal;
}

export function normalizeBaseURL(input: string): string {
  return input.replace(/\/+$/, '');
}

export type FetchWithStreamingDefaults = { fetch: LingyunFetch; dispose: () => void };

export type FetchWithStreamingDefaultsOptions = {
  allowInsecureTLS?: boolean;
};

export function createFetchWithStreamingDefaults(
  timeoutMs?: number,
  options?: FetchWithStreamingDefaultsOptions,
): FetchWithStreamingDefaults {
  const timeoutValue = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const dispatcher = new Agent({
    // Streaming model responses can legitimately spend a long time before headers.
    // Use the AbortSignal timeout below as the single request timeout source.
    bodyTimeout: 0,
    headersTimeout: 0,
    ...(options?.allowInsecureTLS ? { connect: { rejectUnauthorized: false } } : {}),
  });
  const fetchUndici = undiciFetch as unknown as (input: unknown, init?: unknown) => Promise<unknown>;

  const fetchFn: LingyunFetch = (input, init) => {
    const requestInput = input as string | URL | Request;
    const initRecord = (init ?? {}) as RequestInit & { headers?: unknown; signal?: AbortSignal };
    const requestDefaults = requestInputInit(requestInput);
    const headers: Record<string, string> = {};

    mergeHeaders(headers, inputHeaders(requestInput));
    mergeHeaders(headers, initRecord.headers);

    // Some Responses and local OpenAI-compatible endpoints misbehave with compressed SSE streams.
    if (!hasHeader(headers, 'accept-encoding')) {
      headers['accept-encoding'] = 'identity';
    }

    const signals: AbortSignal[] = [];
    if (requestDefaults.signal) signals.push(requestDefaults.signal);
    if (initRecord.signal) signals.push(initRecord.signal);

    if (timeoutValue > 0) {
      signals.push(createTimeoutSignal(timeoutValue));
    }

    const signal = signals.length > 0 ? combineAbortSignals(signals) : undefined;
    const requestInit = {
      ...requestDefaults,
      ...initRecord,
      dispatcher: dispatcher as unknown,
      headers,
      ...(signal ? { signal } : {}),
    };
    return fetchUndici(requestInputUrl(requestInput), requestInit) as Promise<Response>;
  };

  return { fetch: fetchFn, dispose: () => dispatcher.close() };
}
