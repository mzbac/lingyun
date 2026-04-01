import {
  createAssistantHistoryMessage,
  type AgentHistoryMessage,
} from '@kooka/core';

export type LingyunAgentTransientContextKind = 'explore' | 'memoryRecall';

export type LingyunAgentSyntheticContext = {
  transientContext: LingyunAgentTransientContextKind;
  text: string;
  persistAfterCompaction?: boolean;
  maxCharsAfterCompaction?: number;
};

export type LingyunCompactionSyntheticContext = {
  transientContext: LingyunAgentTransientContextKind;
  text: string;
};

export type LingyunCompactionRestoreSource = 'sessionState' | LingyunAgentTransientContextKind;

const TRUNCATED_SUFFIX = '\n\n... [TRUNCATED]';

function trimCompactionText(text: string, maxChars?: number): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0) {
    return trimmed;
  }
  const limit = Math.max(200, Math.floor(maxChars));
  if (trimmed.length <= limit) return trimmed;
  const keep = Math.max(0, limit - TRUNCATED_SUFFIX.length);
  return `${trimmed.slice(0, keep).trimEnd()}${TRUNCATED_SUFFIX}`;
}

export function isTransientSyntheticMessage(message: AgentHistoryMessage): boolean {
  if (!message.metadata?.synthetic) return false;
  const tag = message.metadata.transientContext;
  return tag === 'explore' || tag === 'memoryRecall';
}

export function isCompactionRestoredSyntheticMessage(message: AgentHistoryMessage): boolean {
  if (!message.metadata?.synthetic) return false;
  const source = message.metadata.compactionRestore?.source;
  return source === 'sessionState' || source === 'explore' || source === 'memoryRecall';
}

export function stripTransientSyntheticMessages(
  history: readonly AgentHistoryMessage[],
): AgentHistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.filter((message) => !isTransientSyntheticMessage(message));
}

export function stripCompactionRestoredSyntheticMessages(
  history: readonly AgentHistoryMessage[],
): AgentHistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.filter((message) => !isCompactionRestoredSyntheticMessage(message));
}

export function appendSyntheticContextMessage(
  history: AgentHistoryMessage[],
  context: LingyunAgentSyntheticContext,
): AgentHistoryMessage[] {
  const text = String(context.text || '').trim();
  if (!text) return history;

  const message = createAssistantHistoryMessage();
  message.metadata = {
    synthetic: true,
    transientContext: context.transientContext,
  };
  message.parts.push({ type: 'text', text, state: 'done' } as any);
  history.push(message);
  return history;
}

export function appendCompactionRestoredSyntheticMessage(
  history: AgentHistoryMessage[],
  params: { source: LingyunCompactionRestoreSource; text: string },
): AgentHistoryMessage[] {
  const text = String(params.text || '').trim();
  if (!text) return history;

  const message = createAssistantHistoryMessage();
  message.metadata = {
    synthetic: true,
    compactionRestore: { source: params.source },
  };
  message.parts.push({ type: 'text', text, state: 'done' } as any);
  history.push(message);
  return history;
}

export function snapshotSyntheticContextsForCompaction(
  contexts: readonly LingyunAgentSyntheticContext[],
): LingyunCompactionSyntheticContext[] {
  if (!Array.isArray(contexts) || contexts.length === 0) return [];

  const byKind = new Map<LingyunAgentTransientContextKind, LingyunCompactionSyntheticContext>();
  for (const context of contexts) {
    if (!context?.persistAfterCompaction) continue;
    const text = trimCompactionText(context.text, context.maxCharsAfterCompaction);
    if (!text) continue;
    byKind.set(context.transientContext, {
      transientContext: context.transientContext,
      text,
    });
  }

  return [...byKind.values()];
}
