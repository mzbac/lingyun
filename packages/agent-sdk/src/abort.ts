export function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as any)?.any;
  if (typeof any === 'function') {
    return any(signals);
  }

  if (signals.length === 1) return signals[0]!;

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

