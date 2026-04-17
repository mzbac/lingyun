import { getMessageText } from '@kooka/core';

import type { AgentCallbacks } from '../../../core/types';
import { cleanAssistantPreamble } from '../utils';
import type { ChatMessage } from '../types';
import type { RunnerConversationView } from './callbackContracts';

type ExecutionStateParams = {
  view: RunnerConversationView;
  showThinking: boolean;
  debugLlm: boolean;
  persistSessions: boolean;
  debug(message: string): void;
};

type AgentStatusEvent = Parameters<NonNullable<AgentCallbacks['onStatusChange']>>[0];

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
  let thoughtMsg: ChatMessage | undefined;
  let thoughtBuffer = '';
  let thoughtTokensSeen = 0;
  let thoughtCharsSeen = 0;
  let loggedFirstThought = false;
  let assistantMsg: ChatMessage | undefined;
  let assistantStarted = false;

  debug(
    `[Thinking] callbacks created showThinking=${String(showThinking)} mode=${view.mode} turn=${view.currentTurnId ?? ''}`,
  );

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

  function pushThought(text: string): void {
    if (!text) return;

    thoughtTokensSeen += 1;
    thoughtCharsSeen += text.length;
    if (!loggedFirstThought) {
      loggedFirstThought = true;
      debug(
        `[Thinking] first token len=${String(text.length)} trimmedLen=${String(text.trim().length)} showThinking=${String(showThinking)} step=${view.activeStepId ?? ''}`,
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
        turnId: view.currentTurnId,
        stepId: view.activeStepId,
      };
      thoughtBuffer = '';
      debug(
        `[Thinking] created thoughtId=${thoughtMsg.id} initialChars=${String(normalized.length)} step=${view.activeStepId ?? ''}`,
      );
      view.messages.push(thoughtMsg);
      view.postMessage({ type: 'message', message: thoughtMsg });
      return;
    }

    const safe = text.replace(/\[REDACTED\]/g, '');
    if (!safe) return;
    thoughtMsg.content += safe;
    view.postMessage({ type: 'token', messageId: thoughtMsg.id, token: safe });
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
    view.postMessage({ type: 'token', messageId: msg.id, token: chunk });
  }

  function reconcileAssistantForToolCall(): void {
    if (!assistantMsg || assistantMsg.turnId !== view.currentTurnId) return;
    const original = assistantMsg.content;
    const trimmed = cleanAssistantPreamble(original);
    if (trimmed !== original) {
      assistantMsg.content = trimmed;
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    }
  }

  function finalizeAssistantForStepEnd(): void {
    if (!assistantMsg || assistantMsg.turnId !== view.currentTurnId) return;
    const original = assistantMsg.content;
    const cleaned = cleanAssistantPreamble(original);
    if (cleaned !== original) {
      assistantMsg.content = cleaned;
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    }
  }

  function reconcileAssistantFromHistory(): void {
    const history = view.agent.getHistory();
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
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
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    }
  }

  function startNewTurn(): void {
    stepMsg = undefined;
    view.activeStepId = undefined;
    stepPosted = false;
    thoughtMsg = undefined;
    thoughtBuffer = '';
    assistantMsg = undefined;
    assistantStarted = false;
  }

  function resetStreamedContentForRetry(status: AgentStatusEvent): void {
    if (status?.type !== 'retry') return;

    thoughtBuffer = '';
    if (thoughtMsg && thoughtMsg.turnId === view.currentTurnId) {
      thoughtMsg.content = '';
      view.postMessage({ type: 'updateMessage', message: thoughtMsg });
    }
    if (assistantMsg && assistantMsg.turnId === view.currentTurnId) {
      assistantMsg.content = '';
      view.postMessage({ type: 'updateMessage', message: assistantMsg });
    }
    assistantStarted = false;
  }

  function markStepDoneIfPosted(): void {
    if (stepPosted && stepMsg?.step) {
      if (stepMsg.step.status !== 'canceled') {
        stepMsg.step.status = 'done';
      }
      view.postMessage({ type: 'updateMessage', message: stepMsg });
    }
    if (debugLlm) {
      debug(
        `[Thinking] end tokens=${String(thoughtTokensSeen)} chars=${String(thoughtCharsSeen)} created=${String(!!thoughtMsg)} bufferChars=${String(thoughtBuffer.length)}`,
      );
    }
  }

  function markStepError(aborted: boolean): void {
    if (!stepMsg?.step) return;
    stepMsg.step.status = aborted ? 'canceled' : 'error';
    if (stepPosted) {
      view.postMessage({ type: 'updateMessage', message: stepMsg });
    }
  }

  function resetCompletionState(): void {
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
