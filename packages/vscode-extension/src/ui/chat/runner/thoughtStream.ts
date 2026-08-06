import type { AgentCallbacks } from '../../../core/types';
import type { ChatMessage } from '../types';

type AgentStatusEvent = Parameters<NonNullable<AgentCallbacks['onStatusChange']>>[0];

type ThoughtStreamView = {
  messages: ChatMessage[];
  postMessage(message: unknown): void;
};

type ThoughtStreamParams = {
  view: ThoughtStreamView;
  showThinking: boolean;
  getTurnId(): string | undefined;
  getStepId?(): string | undefined;
  debug(message: string): void;
};

const TOKEN_FLUSH_INTERVAL_MS = 25;

export interface ThoughtStream {
  push(text: string): void;
  startNewSegment(): void;
  resetForRetry(status: AgentStatusEvent): void;
  flush(): void;
  logSummary(): void;
}

/**
 * Owns the UI lifecycle for streamed model reasoning.
 *
 * Both Build and Plan callbacks use this path so reasoning has identical
 * sanitization, batching, retry cleanup, and terminal flushing semantics.
 */
export function createThoughtStream(params: ThoughtStreamParams): ThoughtStream {
  const { view, showThinking, getTurnId, getStepId, debug } = params;

  let thoughtMsg: ChatMessage | undefined;
  let thoughtBuffer = '';
  let pendingToken = '';
  let flushTimer: NodeJS.Timeout | undefined;
  let thoughtTokensSeen = 0;
  let thoughtCharsSeen = 0;
  let loggedFirstThought = false;

  debug(
    `[Thinking] callbacks created showThinking=${String(showThinking)} turn=${getTurnId() ?? ''}`,
  );

  function flush(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (!thoughtMsg || !pendingToken) return;

    const token = pendingToken;
    pendingToken = '';
    view.postMessage({ type: 'token', messageId: thoughtMsg.id, token });
  }

  function discardPendingToken(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    pendingToken = '';
  }

  function queueToken(token: string): void {
    pendingToken += token;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flush();
    }, TOKEN_FLUSH_INTERVAL_MS);
  }

  function push(text: string): void {
    if (!text) return;

    thoughtTokensSeen += 1;
    thoughtCharsSeen += text.length;
    if (!loggedFirstThought) {
      loggedFirstThought = true;
      debug(
        `[Thinking] first token len=${String(text.length)} trimmedLen=${String(text.trim().length)} showThinking=${String(showThinking)} step=${getStepId?.() ?? ''}`,
      );
    }

    if (!showThinking) return;

    // Local servers sometimes emit "<think>\n" as a separate chunk, which creates an
    // empty-looking Thinking block. Buffer whitespace until we see a real character.
    if (!thoughtMsg) {
      thoughtBuffer += text;
      const normalized = thoughtBuffer.replace(/\[REDACTED\]/g, '').trim();
      if (!normalized) return;

      thoughtMsg = {
        id: crypto.randomUUID(),
        role: 'thought',
        content: normalized,
        timestamp: Date.now(),
        turnId: getTurnId(),
        stepId: getStepId?.(),
      };
      thoughtBuffer = '';
      debug(
        `[Thinking] created thoughtId=${thoughtMsg.id} initialChars=${String(normalized.length)} step=${thoughtMsg.stepId ?? ''}`,
      );
      view.messages.push(thoughtMsg);
      view.postMessage({ type: 'message', message: thoughtMsg });
      return;
    }

    const safe = text.replace(/\[REDACTED\]/g, '');
    if (!safe) return;
    thoughtMsg.content += safe;
    queueToken(safe);
  }

  function startNewSegment(): void {
    flush();
    thoughtMsg = undefined;
    thoughtBuffer = '';
  }

  function resetForRetry(status: AgentStatusEvent): void {
    if (status?.type !== 'retry') return;

    thoughtBuffer = '';
    if (thoughtMsg && thoughtMsg.turnId === getTurnId()) {
      discardPendingToken();
      thoughtMsg.content = '';
      view.postMessage({ type: 'updateMessage', message: thoughtMsg });
    }
  }

  function logSummary(): void {
    debug(
      `[Thinking] end tokens=${String(thoughtTokensSeen)} chars=${String(thoughtCharsSeen)} created=${String(!!thoughtMsg)} bufferChars=${String(thoughtBuffer.length)}`,
    );
  }

  return {
    push,
    startNewSegment,
    resetForRetry,
    flush,
    logSummary,
  };
}
