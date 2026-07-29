import type { ChatMessage } from '../types';

function normalizeTurnId(currentTurnId?: string): string | undefined {
  return typeof currentTurnId === 'string' && currentTurnId.trim() ? currentTurnId.trim() : undefined;
}

export function currentTurnHasExternalMemoryContextAttempt(
  messages: ChatMessage[],
  currentTurnId?: string
): boolean {
  const turnId = normalizeTurnId(currentTurnId);
  for (const message of messages) {
    if (!message.toolCall?.memoryContextSource) continue;
    if (!turnId || message.turnId === turnId) return true;
  }
  return false;
}

export function currentTurnIsMemoryExcluded(messages: ChatMessage[], currentTurnId?: string): boolean {
  const turnId = normalizeTurnId(currentTurnId);
  if (!turnId) return false;
  for (const message of messages) {
    if (message.memoryExcluded && (message.id === turnId || message.turnId === turnId)) return true;
  }
  return false;
}
