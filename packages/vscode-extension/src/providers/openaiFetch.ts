import type { FetchFunction } from '@ai-sdk/provider-utils';
import { Agent, fetch as undiciFetch } from 'undici';

function toHeaderRecord(initHeaders: unknown): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!initHeaders) return headers;

  if (Array.isArray(initHeaders)) {
    for (const [k, v] of initHeaders) headers[String(k)] = String(v);
    return headers;
  }

  if (initHeaders instanceof Headers) {
    for (const [k, v] of initHeaders.entries()) headers[k] = v;
    return headers;
  }

  if (typeof initHeaders === 'object') {
    Object.assign(headers, initHeaders as Record<string, string>);
  }

  return headers;
}

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const abortSignalExt = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  };
  const any = abortSignalExt.any;
  if (typeof any === 'function') {
    return any(signals);
  }

  if (signals.length === 1) return signals[0];

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

export type FetchWithStreamingDefaults = { fetch: FetchFunction; dispose: () => void };

export function normalizeBaseURL(input: string): string {
  return input.replace(/\/+$/, '');
}

export function createFetchWithStreamingDefaults(timeoutMs?: number): FetchWithStreamingDefaults {
  const timeoutValue = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const dispatcher = new Agent({ bodyTimeout: 0 });
  const fetchUndici = undiciFetch as unknown as (input: unknown, init?: unknown) => Promise<unknown>;

  const fetchFn: FetchFunction = (input, init?) => {
    const headers: Record<string, string> = {};

    Object.assign(headers, toHeaderRecord(init?.headers));

    // Some Responses and local OpenAI-compatible endpoints misbehave with compressed SSE streams.
    if (!('accept-encoding' in headers) && !('Accept-Encoding' in headers)) {
      headers['accept-encoding'] = 'identity';
    }

    const signals: AbortSignal[] = [];
    if (init?.signal) signals.push(init.signal);

    if (timeoutValue > 0) {
      const abortSignalExt = AbortSignal as typeof AbortSignal & {
        timeout?: (ms: number) => AbortSignal;
      };
      const timeoutFn = abortSignalExt.timeout;
      if (typeof timeoutFn === 'function') {
        signals.push(timeoutFn(timeoutValue));
      }
    }

    const signal = signals.length > 0 ? combineAbortSignals(signals) : undefined;
    const requestInit = {
      ...(init ?? {}),
      dispatcher: dispatcher as unknown,
      headers,
      ...(signal ? { signal } : {}),
    };
    return fetchUndici(input, requestInit) as Promise<Response>;
  };

  return { fetch: fetchFn, dispose: () => dispatcher.close() };
}
