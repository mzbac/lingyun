import type { ToolCall, ToolDefinition } from '../../core/types';
import type { ChatMessage } from './types';

/**
 * Owns approvalId-based tool-message lookup policy across approvals, runner callbacks,
 * and coordinator flows.
 *
 * Hidden knowledge kept here:
 * - whether lookup is global, approval-scoped, turn-scoped, step-scoped, or
 *   plan-container-scoped
 * - how "most recent" matching is applied consistently across those contexts
 */
export function findLatestToolMessageByApprovalId(
  messages: ChatMessage[],
  approvalId: string,
): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.toolCall?.approvalId === approvalId) {
      return message;
    }
  }
  return undefined;
}

export function findApprovalToolMessage(params: {
  messages: ChatMessage[];
  approvalId: string;
  stepId?: string;
}): ChatMessage | undefined {
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (message.toolCall?.approvalId !== params.approvalId) continue;
    if (params.stepId && message.stepId !== params.stepId) continue;
    return message;
  }
  return undefined;
}

export function findToolMessageByApprovalId(params: {
  messages: ChatMessage[];
  approvalId: string;
  currentTurnId?: string;
  currentStepId?: string;
  planningContainerId?: string;
}): ChatMessage | undefined {
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (message.toolCall?.approvalId !== params.approvalId) continue;
    if (params.planningContainerId) {
      if (message.stepId === params.planningContainerId) return message;
      continue;
    }
    if (params.currentStepId) {
      if (message.stepId === params.currentStepId) return message;
      continue;
    }
    if (message.turnId === params.currentTurnId) {
      return message;
    }
  }
  return undefined;
}

export type ToolMessageLookupScope = {
  currentTurnId?: string;
  currentStepId?: string;
  planningContainerId?: string;
};

/**
 * Upserts the chat tool message for a tool call: finds the existing message by
 * approvalId (scoped by turn/step/plan container) and updates it, otherwise
 * creates a new `role: 'tool'` message.
 *
 * Owns the shared tool-message protocol so every caller (build callbacks, plan
 * callbacks, inline approvals) follows the same update/create rules:
 * - updated messages always refresh id/name/args and merge optional fields
 * - `preservePendingOrRejected` keeps an in-flight approval status when the
 *   tool transitions to running
 * - created messages always carry `approvalId` and the UI status
 *
 * Returns the found-or-created message so callers can persist or add details.
 */
export function upsertToolMessage(params: {
  view: { messages: ChatMessage[]; postMessage(message: unknown): void };
  tc: ToolCall;
  def: ToolDefinition;
  status?: NonNullable<ChatMessage['toolCall']>['status'];
  stepId?: string;
  turnId?: string;
  path?: string;
  result?: string;
  isProtected?: boolean;
  approvalReason?: string;
  memoryContextSource?: string;
  lookupScope?: ToolMessageLookupScope;
  preservePendingOrRejected?: boolean;
}): ChatMessage {
  const { view, tc, def } = params;

  const existing = findToolMessageByApprovalId({
    messages: view.messages,
    approvalId: tc.id,
    currentTurnId: params.lookupScope?.currentTurnId,
    currentStepId: params.lookupScope?.currentStepId,
    planningContainerId: params.lookupScope?.planningContainerId,
  });

  if (existing?.toolCall) {
    existing.toolCall.id = def.id;
    existing.toolCall.name = def.name;
    existing.toolCall.args = tc.function.arguments;
    if (params.path) existing.toolCall.path = params.path;
    if (params.memoryContextSource) existing.toolCall.memoryContextSource = params.memoryContextSource;
    if (params.status) {
      const current = existing.toolCall.status;
      if (!params.preservePendingOrRejected || (current !== 'pending' && current !== 'rejected')) {
        existing.toolCall.status = params.status;
      }
    }
    if (params.result !== undefined) existing.toolCall.result = params.result;
    if (params.isProtected !== undefined) {
      existing.toolCall.isProtected = params.isProtected || existing.toolCall.isProtected;
    }
    if (params.approvalReason !== undefined) {
      existing.toolCall.approvalReason = params.approvalReason || existing.toolCall.approvalReason;
    }
    if (!existing.stepId && params.stepId) {
      existing.stepId = params.stepId;
    }
    view.postMessage({ type: 'updateTool', message: existing });
    return existing;
  }

  const toolMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'tool',
    content: '',
    timestamp: Date.now(),
    turnId: params.turnId,
    stepId: params.stepId,
    toolCall: {
      id: def.id,
      name: def.name,
      args: tc.function.arguments,
      status: params.status ?? 'running',
      approvalId: tc.id,
      ...(params.path ? { path: params.path } : {}),
      ...(params.result !== undefined ? { result: params.result } : {}),
      ...(params.isProtected ? { isProtected: params.isProtected } : {}),
      ...(params.approvalReason !== undefined ? { approvalReason: params.approvalReason } : {}),
      ...(params.memoryContextSource ? { memoryContextSource: params.memoryContextSource } : {}),
    },
  };
  view.messages.push(toolMsg);
  view.postMessage({ type: 'message', message: toolMsg });
  return toolMsg;
}
