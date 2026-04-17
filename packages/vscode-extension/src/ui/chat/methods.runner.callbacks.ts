import * as vscode from 'vscode';

import type { AgentCallbacks } from '../../core/types';
import { recordAssistantOutcome } from '../../core/sessionSignals';
import { getDebugSettings } from '../../core/debugSettings';
import { appendErrorLog, appendLog } from '../../core/logger';
import { bindChatControllerService } from './controllerService';
import { decorateAgentCallbacksWithOfficeSync } from '../office/sync';
import type { ChatMessage } from './types';
import type { ChatController } from './controller';
import type { ChatRunnerCallbacksDeps, ChatRunnerCallbacksService } from './runner/callbackContracts';
export type { ChatRunnerCallbacksService } from './runner/callbackContracts';
import { createCompactionCallbacks } from './runner/compactionCallbacks';
import { createChatExecutionState } from './runner/executionState';
import { createPlanningCallbacks } from './runner/planningCallbacks';
import { createStepSnapshotCallbacks } from './runner/stepSnapshotCallbacks';
import { createToolLifecycleCallbacks } from './runner/toolLifecycleCallbacks';
import { appendDebugLog, postTurnStatus } from './runner/callbackUtils';
import { createChatRunnerCallbacksDepsForController } from './runner/callbackControllerAdapter';

/**
 * Composition root for chat runner callbacks.
 *
 * The deeper runner modules own planning, execution state, tool lifecycle,
 * compaction, and step snapshot behavior. This module wires them together.
 */
type ChatRunnerCallbacksRuntime = ChatRunnerCallbacksDeps & ChatRunnerCallbacksService;

export function createChatRunnerCallbacksService(controller: ChatRunnerCallbacksDeps): ChatRunnerCallbacksService {
  const runtime = controller as ChatRunnerCallbacksRuntime;
  const service = bindChatControllerService(runtime, {
    createPlanningCallbacks(this: ChatRunnerCallbacksRuntime, planMsg: ChatMessage): AgentCallbacks {
      const callbacks = createPlanningCallbacks(this, planMsg);
      return this.officeSync ? decorateAgentCallbacksWithOfficeSync(callbacks, this.officeSync) : callbacks;
    },

  createAgentCallbacks(this: ChatRunnerCallbacksRuntime): AgentCallbacks {
    const showThinking =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('showThinking', false) ?? false;
    const debugLlm = getDebugSettings().llm;
    const persistSessions = this.isSessionPersistenceEnabled();

    const debug = (message: string) => {
      if (!debugLlm || !message) return;
      appendLog(this.outputChannel, message, { level: 'debug', tag: 'UI' });
    };

    const executionState = createChatExecutionState({
      view: this,
      showThinking,
      debugLlm,
      persistSessions,
      debug,
    });
    const toolLifecycle = createToolLifecycleCallbacks({
      view: this,
      executionState,
      persistSessions,
    });
    const compaction = createCompactionCallbacks({
      view: this,
      persistSessions,
    });
    const stepSnapshots = createStepSnapshotCallbacks({
      view: this,
      persistSessions,
    });

    const callbacks: AgentCallbacks = {
      onCompactionStart: (event) => {
        compaction.onCompactionStart(event);
      },
      onIterationStart: async () => {
        executionState.startNewTurn();
        const step = executionState.postStepMsgIfNeeded();
        await stepSnapshots.onIterationStart(step);
      },
      onAssistantToken: (token) => {
        executionState.pushAssistant(token);
      },
      onThoughtToken: (token) => {
        executionState.pushThought(token);
      },
      onToolCall: async (tc, def) => {
        await toolLifecycle.onToolCall(tc, def);
      },
      onToolBlocked: (tc, def, reason) => {
        toolLifecycle.onToolBlocked(tc, def, reason);
      },
      onToolResult: (tc, result) => {
        toolLifecycle.onToolResult(tc, result);
      },
      onIterationEnd: async () => {
        const stepMsg = executionState.getStepMessage();
        await stepSnapshots.onIterationEnd(stepMsg);

        executionState.reconcileAssistantFromHistory();
        executionState.finalizeAssistantForStepEnd();
        executionState.markStepDoneIfPosted();
        if (persistSessions) {
          this.persistActiveSession();
        }
        this.postMessage({ type: 'context', context: this.getContextForUI() });
      },
      onCompactionEnd: (event) => {
        compaction.onCompactionEnd(event);
      },
      onStatusChange: (status) => {
        executionState.resetStreamedContentForRetry(status);
        postTurnStatus(this, this.currentTurnId, status);
      },
      onRequestApproval: async (tc, def, approvalContext) => {
        executionState.postStepMsgIfNeeded();
        executionState.reconcileAssistantForToolCall();
        return await this.requestInlineApproval(tc, def, undefined, approvalContext);
      },
      onDebug: (message) => {
        appendDebugLog(this, message);
      },
      onComplete: (response) => {
        executionState.finalizeAssistantForStepEnd();
        if (!executionState.hasAssistantMessage() && response) {
          executionState.pushAssistant(response);
        }
        if (this.mode === 'build' && response) {
          recordAssistantOutcome(this.signals, response);
        }
        if (this.currentTurnId) {
          this.postMessage({ type: 'turnStatus', turnId: this.currentTurnId, status: { type: 'done' } });
        }
        this.abortRequested = false;
        executionState.resetCompletionState();
        this.postMessage({ type: 'complete' });
        this.postMessage({ type: 'context', context: this.getContextForUI() });
        if (persistSessions) {
          this.persistActiveSession();
        }
      },
      onError: (error) => {
        const debugEnabled = getDebugSettings().llm;
        if (debugEnabled) {
          appendErrorLog(this.outputChannel, 'Agent error', error, { tag: 'Agent' });
        }
      },
    };

    return this.officeSync ? decorateAgentCallbacksWithOfficeSync(callbacks, this.officeSync) : callbacks;
  },
  });
  Object.assign(runtime, service);
  return service;
}

export function createChatRunnerCallbacksServiceForController(
  controller: ChatController
): ChatRunnerCallbacksService {
  return createChatRunnerCallbacksService(createChatRunnerCallbacksDepsForController(controller));
}
