import type { ChatMessage } from '../types';

/**
 * Owns run-coordinator message lookup/posting policy that should stay consistent
 * across retry, execute-plan, regenerate-plan, and revise-plan flows.
 *
 * Hidden knowledge kept here:
 * - how the "latest" user turn is chosen
 * - when turn-scoped errors are considered equivalent
 * - how duplicate error posts are suppressed without callers re-implementing scans
 */
export function findLatestUserTurnId(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') {
      return message.id;
    }
  }
  return undefined;
}

export function hasEquivalentTurnError(params: {
  messages: ChatMessage[];
  turnId?: string;
  content: string;
}): boolean {
  if (!params.turnId) return false;
  const trimmedContent = params.content.trim();
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (message.turnId !== params.turnId) continue;
    if ((message.content || '').trim() === trimmedContent && message.role === 'error') {
      return true;
    }
  }
  return false;
}

export function appendTurnErrorMessage(params: {
  messages: ChatMessage[];
  turnId?: string;
  content: string;
}): ChatMessage | undefined {
  if (hasEquivalentTurnError(params)) {
    return undefined;
  }

  const errorMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'error',
    content: params.content,
    timestamp: Date.now(),
    turnId: params.turnId,
  };
  params.messages.push(errorMsg);
  return errorMsg;
}
