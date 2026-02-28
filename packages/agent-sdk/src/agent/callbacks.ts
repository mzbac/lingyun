export function invokeCallbackSafely<TArgs extends unknown[]>(
  fn: ((...args: TArgs) => void | Promise<void>) | undefined,
  params: { label: string; onDebug?: (message: string) => void },
  ...args: TArgs
): void | Promise<void> {
  if (!fn) return;

  const report = (kind: 'rejected' | 'threw', error: unknown) => {
    try {
      params.onDebug?.(
        `[Callbacks] ${params.label} ${kind} (${error instanceof Error ? error.name : typeof error})`,
      );
    } catch {
      // ignore
    }
  };

  try {
    const result = fn(...args);
    if (result && typeof (result as Promise<void>).then === 'function') {
      return Promise.resolve(result)
        .catch((error) => {
          report('rejected', error);
        })
        .then(() => undefined);
    }
  } catch (error) {
    report('threw', error);
  }
}

