import type { AgentCallbacks, ToolCall, ToolDefinition } from '../../../core/types';
import { cleanAssistantPreamble, isCancellationError } from '../utils';
import type { ChatMessage } from '../types';
import type { RunnerPlanningView } from './callbackContracts';
import {
  appendDebugLog,
  applyCommonToolResultFields,
  postAgentNotice,
  postTurnStatus,
  resolveToolCallUiPath,
  upsertTaskChildSession,
} from './callbackUtils';
import {
  getPlanFailureText,
  getPlanMessageKindFromPlaceholder,
  getPlanPlaceholderText,
  isPlanPlaceholderText,
} from './runCoordinatorPendingPlan';
import { findToolMessageByApprovalId } from '../toolMessageLookup';
import { createThoughtStream } from './thoughtStream';

type PlanningCallbacksOptions = {
  showThinking: boolean;
};

export function createPlanningCallbacks(
  view: RunnerPlanningView,
  planMsg: ChatMessage,
  options: PlanningCallbacksOptions,
): AgentCallbacks {
  const persistSessions = view.isSessionPersistenceEnabled();
  const planContainerId = planMsg.id;
  const planTurnId = planMsg.turnId ?? view.currentTurnId;
  const planKind = getPlanMessageKindFromPlaceholder(planMsg.content) ?? 'initial';
  const planPlaceholderText = planMsg.content || getPlanPlaceholderText(planKind);

  let buffered = '';
  let flushHandle: NodeJS.Timeout | undefined;
  const thoughtStream = createThoughtStream({
    view,
    showThinking: options.showThinking,
    getTurnId: () => planTurnId,
    // Keep plan reasoning visible beside the card. Plan Activity is collapsed by
    // default, so nesting via stepId would make live reasoning appear missing.
    debug: (message) => appendDebugLog(view, `${message} mode=plan`),
  });

  const postPlanUpdate = () => {
    view.postMessage({ type: 'updateMessage', message: planMsg });
    if (persistSessions) {
      view.persistActiveSession();
    }
  };

  const clearScheduledFlush = () => {
    if (!flushHandle) return;
    clearTimeout(flushHandle);
    flushHandle = undefined;
  };

  const flushPendingPlanUpdate = () => {
    if (!flushHandle) return;
    clearScheduledFlush();
    postPlanUpdate();
  };

  const scheduleFlush = () => {
    if (flushHandle) return;
    flushHandle = setTimeout(() => {
      flushHandle = undefined;
      postPlanUpdate();
    }, 60);
  };

  const hasNonPlaceholderPlanContent = () => {
    const text = (planMsg.content || '').trim();
    return !!text && !isPlanPlaceholderText(text);
  };


  const markPlanFailed = (wasCanceled: boolean) => {
    clearScheduledFlush();

    const status = wasCanceled ? 'canceled' : 'draft';
    if (planMsg.plan) {
      planMsg.plan.status = status;
    } else {
      planMsg.plan = { status };
    }

    if (!hasNonPlaceholderPlanContent()) {
      planMsg.content = getPlanFailureText({ kind: planKind, wasCanceled });
    }

    postPlanUpdate();
  };

  const upsertToolError = (tc: ToolCall, def: ToolDefinition, reason: string) => {
    const existing = findToolMessageByApprovalId({
      messages: view.messages,
      approvalId: tc.id,
      planningContainerId: planContainerId,
    });

    if (existing?.toolCall) {
      existing.toolCall.status = 'error';
      existing.toolCall.result = reason;
      view.postMessage({ type: 'updateTool', message: existing });
    } else {
      const { path } = resolveToolCallUiPath(view, tc, def, { includeWorkdir: true });

      const toolMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        content: '',
        timestamp: Date.now(),
        stepId: planContainerId,
        toolCall: {
          id: def.id,
          name: def.name,
          args: tc.function.arguments,
          status: 'error',
          approvalId: tc.id,
          path,
          result: reason,
        },
      };
      view.messages.push(toolMsg);
      view.postMessage({ type: 'message', message: toolMsg });
    }

    if (persistSessions) {
      view.persistActiveSession();
    }
  };

  return {
    onIterationStart: () => {
      thoughtStream.startNewSegment();
    },
    onIterationEnd: () => {
      thoughtStream.flush();
      if (persistSessions) {
        view.persistActiveSession();
      }
      // Keep the global context indicator in sync during plan loops (usage updates per turn).
      view.postMessage({ type: 'context', context: view.getContextForUI() });
    },
    onDebug: message => {
      appendDebugLog(view, message);
    },
    onStatusChange: status => {
      if (status?.type === 'retry') {
        thoughtStream.resetForRetry(status);
        buffered = '';
        clearScheduledFlush();
        planMsg.content = planPlaceholderText;
        view.postMessage({ type: 'updateMessage', message: planMsg });
        if (persistSessions) {
          view.persistActiveSession();
        }
      }
      postTurnStatus(view, planTurnId, status);
    },
    onNotice: notice => {
      postAgentNotice(view, notice, { persist: persistSessions });
    },
    onAssistantToken: token => {
      buffered += token;
      planMsg.content = cleanAssistantPreamble(buffered);
      scheduleFlush();
    },
    onThoughtToken: token => {
      thoughtStream.push(token);
    },
    onToolCall: (tc: ToolCall, def: ToolDefinition) => {
      thoughtStream.flush();
      const { path } = resolveToolCallUiPath(view, tc, def);

      const existing = findToolMessageByApprovalId({
        messages: view.messages,
        approvalId: tc.id,
        planningContainerId: planContainerId,
      });

      if (existing?.toolCall) {
        existing.toolCall.id = def.id;
        existing.toolCall.name = def.name;
        existing.toolCall.args = tc.function.arguments;
        if (path) existing.toolCall.path = path;
        if (existing.toolCall.status !== 'pending' && existing.toolCall.status !== 'rejected') {
          existing.toolCall.status = 'running';
        }
        view.postMessage({ type: 'updateTool', message: existing });
        if (persistSessions) {
          view.persistActiveSession();
        }
        return;
      }

      const toolMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        content: '',
        timestamp: Date.now(),
        stepId: planContainerId,
        toolCall: {
          id: def.id,
          name: def.name,
          args: tc.function.arguments,
          status: 'running',
          approvalId: tc.id,
          path,
        },
      };
      view.messages.push(toolMsg);
      view.postMessage({ type: 'message', message: toolMsg });
      if (persistSessions) {
        view.persistActiveSession();
      }
    },
    onToolBlocked: (tc: ToolCall, def: ToolDefinition, reason: string) => {
      thoughtStream.flush();
      upsertToolError(tc, def, reason);
    },
    onToolResult: (tc, result) => {
      thoughtStream.flush();
      const toolMsg = findToolMessageByApprovalId({
        messages: view.messages,
        approvalId: tc.id,
        planningContainerId: planContainerId,
      });
      if (toolMsg?.toolCall) {
        const { resultStr, isTaskTool, hasDiff, maybeTodos } = applyCommonToolResultFields(toolMsg.toolCall, result);

        if (isTaskTool && result.success) {
          const childId = upsertTaskChildSession(view, result);
          if (childId) toolMsg.toolCall.taskSessionId = childId;
        }

        let storeOutput = !result.success || (!!resultStr.trim() && !hasDiff);
        if (toolMsg.toolCall.id === 'todowrite' || toolMsg.toolCall.id === 'todoread') {
          // Todo output is already surfaced in the header popover; avoid spamming the chat with raw JSON.
          storeOutput = false;
        }
        toolMsg.toolCall.result = storeOutput ? resultStr.substring(0, 4000) : undefined;

        view.postMessage({ type: 'updateTool', message: toolMsg });

        if (Array.isArray(maybeTodos)) {
          view.postMessage({ type: 'todos', todos: maybeTodos });
        }
        if (persistSessions) {
          view.persistActiveSession();
        }
      }
    },
    onRequestApproval: async (tc, def, approvalContext) => {
      return await view.requestInlineApproval(tc, def, planContainerId, approvalContext);
    },
    onComplete: () => {
      thoughtStream.flush();
      thoughtStream.logSummary();
      flushPendingPlanUpdate();
      if (planTurnId) {
        view.postMessage({ type: 'turnStatus', turnId: planTurnId, status: { type: 'done' } });
      }
      view.postMessage({ type: 'context', context: view.getContextForUI() });
      if (persistSessions) {
        view.persistActiveSession();
      }
    },
    onError: error => {
      thoughtStream.flush();
      thoughtStream.logSummary();
      // Terminal plan-run errors are surfaced by the run coordinator after agent.plan() rejects.
      // This callback only keeps the plan card itself out of the stale "generating" state.
      const wasCanceled = isCancellationError(error, { abortRequested: view.abortRequested });
      markPlanFailed(wasCanceled);
      view.postMessage({ type: 'context', context: view.getContextForUI() });
    },
  };
}
