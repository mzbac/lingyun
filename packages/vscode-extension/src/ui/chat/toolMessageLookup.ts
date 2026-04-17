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
