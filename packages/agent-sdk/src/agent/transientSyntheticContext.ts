import {
  createAssistantHistoryMessage,
  type AgentHistoryMessage,
} from '@kooka/core';

export type LingyunAgentSyntheticContext = {
  transientContext: 'explore' | 'memoryRecall';
  text: string;
};

export function isTransientSyntheticMessage(message: AgentHistoryMessage): boolean {
  if (!message.metadata?.synthetic) return false;
  const tag = (message.metadata as any)?.transientContext;
  return tag === 'explore' || tag === 'memoryRecall';
}

export function stripTransientSyntheticMessages(
  history: readonly AgentHistoryMessage[],
): AgentHistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.filter((message) => !isTransientSyntheticMessage(message));
}

export function appendSyntheticContextMessage(
  history: AgentHistoryMessage[],
  context: LingyunAgentSyntheticContext,
): AgentHistoryMessage[] {
  const message = createAssistantHistoryMessage();
  message.metadata = { synthetic: true, ...({ transientContext: context.transientContext } as any) } as any;
  message.parts.push({ type: 'text', text: context.text, state: 'done' } as any);
  history.push(message);
  return history;
}
