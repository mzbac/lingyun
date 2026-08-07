/**
 * Debounced token-stream batching shared by assistant and thought streaming.
 *
 * Both streaming paths flush pending tokens to the webview in 25ms batches to
 * avoid one `postMessage` per model token. This module owns the debounce
 * timer + per-target buffer bookkeeping once instead of duplicating it in
 * `executionState.ts` (assistant tokens) and `thoughtStream.ts` (reasoning).
 */
export function createTokenBatcher(params: {
  flushMs: number;
  flush(targetId: string, token: string): void;
}): {
  push(targetId: string, token: string): void;
  flush(targetId: string): void;
  flushAll(): void;
  discard(targetId: string): void;
  discardAll(): void;
} {
  const { flushMs, flush } = params;
  const buffers = new Map<string, { token: string; timer?: NodeJS.Timeout }>();

  function clearBuffer(targetId: string): void {
    const buffer = buffers.get(targetId);
    if (!buffer) return;
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = undefined;
    }
    buffers.delete(targetId);
    if (buffer.token) {
      flush(targetId, buffer.token);
    }
  }

  return {
    push(targetId: string, token: string): void {
      if (!token) return;
      const existing = buffers.get(targetId);
      if (existing) {
        existing.token += token;
        return;
      }
      const buffer: { token: string; timer?: NodeJS.Timeout } = { token };
      buffers.set(targetId, buffer);
      buffer.timer = setTimeout(() => {
        clearBuffer(targetId);
      }, flushMs);
    },

    flush(targetId: string): void {
      clearBuffer(targetId);
    },

    flushAll(): void {
      for (const targetId of [...buffers.keys()]) {
        clearBuffer(targetId);
      }
    },

    discard(targetId: string): void {
      const buffer = buffers.get(targetId);
      if (!buffer) return;
      if (buffer.timer) {
        clearTimeout(buffer.timer);
        buffer.timer = undefined;
      }
      buffers.delete(targetId);
    },

    discardAll(): void {
      for (const targetId of [...buffers.keys()]) {
        const buffer = buffers.get(targetId);
        if (!buffer) continue;
        if (buffer.timer) {
          clearTimeout(buffer.timer);
          buffer.timer = undefined;
        }
        buffers.delete(targetId);
      }
    },
  };
}
