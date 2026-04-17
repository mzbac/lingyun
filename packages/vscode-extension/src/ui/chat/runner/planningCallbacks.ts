import type { AgentCallbacks, ToolCall, ToolDefinition } from '../../../core/types';
import { cleanAssistantPreamble, formatErrorForUser } from '../utils';
import type { ChatMessage } from '../types';
import type { RunnerPlanningView } from './callbackContracts';
import {
  appendDebugLog,
  applyCommonToolResultFields,
  postTurnStatus,
  resolveToolCallUiPath,
  upsertTaskChildSession,
} from './callbackUtils';
import { findToolMessageByApprovalId } from '../toolMessageLookup';

export function createPlanningCallbacks(
  view: RunnerPlanningView,
  planMsg: ChatMessage
): AgentCallbacks {
  const persistSessions = view.isSessionPersistenceEnabled();
  const planContainerId = planMsg.id;
  const planTurnId = planMsg.turnId ?? view.currentTurnId;
  const planPlaceholderText = planMsg.content || 'Planning...';

  let buffered = '';
  let flushHandle: NodeJS.Timeout | undefined;

  const flush = () => {
    flushHandle = undefined;
    view.postMessage({ type: 'updateMessage', message: planMsg });
    if (persistSessions) {
      view.persistActiveSession();
    }
  };

  const scheduleFlush = () => {
    if (flushHandle) return;
    flushHandle = setTimeout(flush, 60);
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
    onIterationEnd: () => {
      // Keep the global context indicator in sync during plan loops (usage updates per turn).
      view.postMessage({ type: 'context', context: view.getContextForUI() });
    },
    onDebug: message => {
      appendDebugLog(view, message);
    },
    onStatusChange: status => {
      if (status?.type === 'retry') {
        buffered = '';
        if (flushHandle) {
          clearTimeout(flushHandle);
          flushHandle = undefined;
        }
        planMsg.content = planPlaceholderText;
        view.postMessage({ type: 'updateMessage', message: planMsg });
        if (persistSessions) {
          view.persistActiveSession();
        }
      }
      postTurnStatus(view, planTurnId, status);
    },
    onAssistantToken: token => {
      buffered += token;
      planMsg.content = cleanAssistantPreamble(buffered);
      scheduleFlush();
    },
    onToolCall: (tc: ToolCall, def: ToolDefinition) => {
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
      upsertToolError(tc, def, reason);
    },
    onToolResult: (tc, result) => {
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
      if (planTurnId) {
        view.postMessage({ type: 'turnStatus', turnId: planTurnId, status: { type: 'done' } });
      }
      view.postMessage({ type: 'context', context: view.getContextForUI() });
    },
    onError: error => {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: formatErrorForUser(error, { llmProviderId: view.llmProvider?.id }),
        timestamp: Date.now(),
      };
      view.messages.push(errorMsg);
      view.postMessage({ type: 'message', message: errorMsg });
      view.postMessage({ type: 'context', context: view.getContextForUI() });
      if (persistSessions) {
        view.persistActiveSession();
      }
    },
  };
}
