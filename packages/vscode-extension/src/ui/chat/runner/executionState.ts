import { getMessageText, type AgentHistoryMessage } from '@kooka/core';

import type { AgentCallbacks } from '../../../core/types';
import { cleanAssistantPreamble } from '../utils';
import type { ChatMessage } from '../types';
import type { RunnerConversationView } from './callbackContracts';
import { createThoughtStream } from './thoughtStream';
import { createTokenBatcher } from './tokenBatcher';

type ExecutionStateParams = {
  view: RunnerConversationView;
  showThinking: boolean;
  debugLlm: boolean;
  persistSessions: boolean;
  debug(message: string): void;
};

type AgentStatusEvent = Parameters<NonNullable<AgentCallbacks['onStatusChange']>>[0];

function findLatestAssistantMessage(history: AgentHistoryMessage[]): AgentHistoryMessage | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message?.role === 'assistant') return message;
  }
  return undefined;
}

export interface ChatExecutionState {
  ensureStepMsg(): ChatMessage;
  postStepMsgIfNeeded(): ChatMessage;
  pushThought(text: string): void;
  pushAssistant(text: string): void;
  reconcileAssistantForToolCall(): void;
  finalizeAssistantForStepEnd(): void;
  reconcileAssistantFromHistory(): void;
  startNewTurn(): void;
  resetStreamedContentForRetry(status: AgentStatusEvent): void;
  markStepDoneIfPosted(): void;
  markStepError(aborted: boolean): void;
  resetCompletionState(): void;
  getStepMessage(): ChatMessage | undefined;
  hasAssistantMessage(): boolean;
}

export function createChatExecutionState(params: ExecutionStateParams): ChatExecutionState {
  const { view, showThinking, debugLlm, persistSessions, debug } = params;

  let stepMsg: ChatMessage | undefined;
  let stepPosted = false;
  let assistantMsg: ChatMessage | undefined;
  let assistantStarted = false;
  const tokenBatcher = createTokenBatcher({
    flushMs: 25,
    flush: (messageId, token) => view.postMessage({ type: 'token', messageId, token }),
  });
  const thoughtStream = createThoughtStream({
    view,
    showThinking,
    getTurnId: () => view.currentTurnId,
    getStepId: () => view.activeStepId,
    debug: (message) => debug(`${message} mode=${view.mode}`),
  });

  function ensureStepMsg(): ChatMessage {
    if (stepMsg) return stepMsg;

    const index = ++view.stepCounter;
    stepMsg = {
      id: crypto.randomUUID(),
      role: 'step',
      content: '',
      timestamp: Date.now(),
      turnId: view.currentTurnId,
      step: {
        index,
        status: 'running',
        mode: view.mode === 'plan' ? 'Plan' : 'Build',
        model: view.currentModel,
      },
    };
    view.activeStepId = stepMsg.id;
    debug(`[Step] start stepId=${stepMsg.id} index=${String(index)} turn=${view.currentTurnId ?? ''}`);
    return stepMsg;
  }

  function postStepMsgIfNeeded(): ChatMessage {
    const msg = ensureStepMsg();
    if (stepPosted) return msg;
    stepPosted = true;
    view.messages.push(msg);
    view.postMessage({ type: 'message', message: msg });
    if (persistSessions) {
      view.persistActiveSession();
    }
    return msg;
  }

  function ensureAssistantMsg(): ChatMessage {
    if (assistantMsg) return assistantMsg;
    assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      turnId: view.currentTurnId,
      stepId: view.activeStepId,
    };
    view.messages.push(assistantMsg);
    view.postMessage({ type: 'message', message: assistantMsg });
    return assistantMsg;
  }

  function flushTokenBuffer(messageId: string): void {
    tokenBatcher.flush(messageId);
  }

  function flushAllTokenBuffers(): void {
    thoughtStream.flush();
    tokenBatcher.flushAll();
  }

  function discardTokenBuffer(messageId: string): void {
    tokenBatcher.discard(messageId);
  }

  function queueToken(messageId: string, token: string): void {
    tokenBatcher.push(messageId, token);
  }

  function pushThought(text: string): void {
    thoughtStream.push(text);
  }

  function pushAssistant(text: string): void {
    if (!text) return;
    let chunk = text;
    if (!assistantStarted) {
      chunk = chunk.replace(/^[\s\r\n]+/, '');
      if (!chunk) return;
      assistantStarted = true;
    }
    const msg = ensureAssistantMsg();
    msg.content += chunk;
    queueToken(msg.id, chunk);
  }

  function reconcileAssistantForToolCall(): void {
    if (!assistantMsg || assistantMsg.turnId !== view.currentTurnId) return;
    const original = assistantMsg.content;
    const trimmed = cleanAssistantPreamble(original);
    if (trimmed !== original) {
      assistantMsg.content = trimmed;
      discardTokenBuffer(assistantMsg.id);
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    } else {
      flushTokenBuffer(assistantMsg.id);
    }
  }

  function finalizeAssistantForStepEnd(): void {
    if (!assistantMsg || assistantMsg.turnId !== view.currentTurnId) return;
    const original = assistantMsg.content;
    const cleaned = cleanAssistantPreamble(original);
    if (cleaned !== original) {
      assistantMsg.content = cleaned;
      discardTokenBuffer(assistantMsg.id);
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    } else {
      flushTokenBuffer(assistantMsg.id);
    }
  }

  function reconcileAssistantFromHistory(): void {
    const lastAssistant = findLatestAssistantMessage(view.agent.getHistory());
    if (!lastAssistant) return;

    const finalContent = cleanAssistantPreamble(getMessageText(lastAssistant));
    if (!finalContent.trim()) return;

    if (!assistantMsg) {
      assistantMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
        turnId: view.currentTurnId,
        stepId: view.activeStepId,
      };
      view.messages.push(assistantMsg);
      view.postMessage({ type: 'message', message: assistantMsg });
      return;
    }

    if (assistantMsg.turnId === view.currentTurnId && assistantMsg.content !== finalContent) {
      assistantMsg.content = finalContent;
      discardTokenBuffer(assistantMsg.id);
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    }
  }

  function startNewTurn(): void {
    flushAllTokenBuffers();
    stepMsg = undefined;
    view.activeStepId = undefined;
    stepPosted = false;
    thoughtStream.startNewSegment();
    assistantMsg = undefined;
    assistantStarted = false;
  }

  function resetStreamedContentForRetry(status: AgentStatusEvent): void {
    if (status?.type !== 'retry') return;

    thoughtStream.resetForRetry(status);
    if (assistantMsg && assistantMsg.turnId === view.currentTurnId) {
      discardTokenBuffer(assistantMsg.id);
      assistantMsg.content = '';
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    }
    assistantStarted = false;
  }

  function markStepDoneIfPosted(): void {
    flushAllTokenBuffers();
    if (stepPosted && stepMsg?.step) {
      if (stepMsg.step.status !== 'canceled') {
        stepMsg.step.status = 'done';
      }
      view.postMessage({ type: 'updateMessage', message: stepMsg });
    }
    if (debugLlm) {
      thoughtStream.logSummary();
    }
  }

  function markStepError(aborted: boolean): void {
    flushAllTokenBuffers();
    if (!stepMsg?.step) return;
    stepMsg.step.status = aborted ? 'canceled' : 'error';
    if (stepPosted) {
      view.postMessage({ type: 'updateMessage', message: stepMsg });
    }
  }

  function resetCompletionState(): void {
    flushAllTokenBuffers();
    view.activeStepId = undefined;
    stepMsg = undefined;
    stepPosted = false;
  }

  function getStepMessage(): ChatMessage | undefined {
    return stepMsg;
  }

  function hasAssistantMessage(): boolean {
    return !!assistantMsg;
  }

  return {
    ensureStepMsg,
    postStepMsgIfNeeded,
    pushThought,
    pushAssistant,
    reconcileAssistantForToolCall,
    finalizeAssistantForStepEnd,
    reconcileAssistantFromHistory,
    startNewTurn,
    resetStreamedContentForRetry,
    markStepDoneIfPosted,
    markStepError,
    resetCompletionState,
    getStepMessage,
    hasAssistantMessage,
  };
}
