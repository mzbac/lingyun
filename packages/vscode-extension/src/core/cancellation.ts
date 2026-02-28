import * as vscode from 'vscode';

export function createAbortSignalFromCancellationToken(token: vscode.CancellationToken): {
  signal: AbortSignal;
  dispose: () => void;
};
export function createAbortSignalFromCancellationToken(token?: vscode.CancellationToken): {
  signal?: AbortSignal;
  dispose: () => void;
};
export function createAbortSignalFromCancellationToken(token?: vscode.CancellationToken): {
  signal?: AbortSignal;
  dispose: () => void;
} {
  if (!token) return { signal: undefined, dispose: () => {} };

  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
    return { signal: controller.signal, dispose: () => {} };
  }

  const listener = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => listener.dispose() };
}

export function createCancellationTokenFromAbortSignal(signal: AbortSignal): {
  token: vscode.CancellationToken;
  dispose: () => void;
} {
  const source = new vscode.CancellationTokenSource();
  const onAbort = () => source.cancel();

  if (signal.aborted) {
    source.cancel();
    return { token: source.token, dispose: () => source.dispose() };
  }

  signal.addEventListener('abort', onAbort, { once: true });
  return {
    token: source.token,
    dispose: () => {
      signal.removeEventListener('abort', onAbort);
      source.dispose();
    },
  };
}

