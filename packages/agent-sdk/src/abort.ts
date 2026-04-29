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

export function timeoutSignal(timeoutMs: number): AbortSignal {
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

  if (signals.length === 1) return signals[0]!;

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

