import {
  createSystemHistoryMessage,
  type AgentHistoryMessage,
} from '@kooka/core';

export type LingyunAgentTransientContextKind = 'explore' | 'memoryRecall' | 'goal';

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

function isCompactionSyntheticContextKind(value: unknown): value is LingyunAgentTransientContextKind {
  return value === 'explore' || value === 'memoryRecall' || value === 'goal';
}

export function normalizeCompactionSyntheticContexts(value: unknown): LingyunCompactionSyntheticContext[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  const contexts: LingyunCompactionSyntheticContext[] = [];
  for (const context of value) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) continue;
    const transientContext = (context as any).transientContext;
    if (!isCompactionSyntheticContextKind(transientContext)) continue;
    if (typeof (context as any).text !== 'string') continue;
    contexts.push({ transientContext, text: (context as any).text });
  }
  return contexts;
}

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
  return tag === 'explore' || tag === 'memoryRecall' || tag === 'goal';
}

export function isCompactionRestoredSyntheticMessage(message: AgentHistoryMessage): boolean {
  if (!message.metadata?.synthetic) return false;
  const source = message.metadata.compactionRestore?.source;
  return source === 'sessionState' || source === 'explore' || source === 'memoryRecall' || source === 'goal';
}

function stripSyntheticMessages(
  history: readonly AgentHistoryMessage[],
  shouldStrip: (message: AgentHistoryMessage) => boolean,
): AgentHistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  let stripped: AgentHistoryMessage[] | undefined;
  for (let i = 0; i < history.length; i++) {
    const message = history[i];
    if (!shouldStrip(message)) {
      if (stripped) stripped.push(message);
      continue;
    }

    if (!stripped) stripped = history.slice(0, i);
  }

  return stripped ?? [...history];
}

export function stripTransientSyntheticMessages(
  history: readonly AgentHistoryMessage[],
): AgentHistoryMessage[] {
  return stripSyntheticMessages(history, isTransientSyntheticMessage);
}

export function stripCompactionRestoredSyntheticMessages(
  history: readonly AgentHistoryMessage[],
): AgentHistoryMessage[] {
  return stripSyntheticMessages(history, isCompactionRestoredSyntheticMessage);
}

export function normalizeSyntheticContextMessageRoles(
  history: readonly AgentHistoryMessage[],
): AgentHistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  let normalized: AgentHistoryMessage[] | undefined;
  for (let i = 0; i < history.length; i++) {
    const message = history[i];
    const shouldNormalize =
      message.role !== 'system' &&
      (isTransientSyntheticMessage(message) || isCompactionRestoredSyntheticMessage(message));

    if (!shouldNormalize) {
      if (normalized) normalized.push(message);
      continue;
    }

    if (!normalized) normalized = history.slice(0, i);
    const parts: AgentHistoryMessage['parts'] = [];
    for (const part of message.parts) {
      parts.push({ ...(part as any) } as AgentHistoryMessage['parts'][number]);
    }

    normalized.push({
      ...message,
      role: 'system' as const,
      metadata: message.metadata ? { ...message.metadata } : undefined,
      parts,
    });
  }

  return normalized ?? [...history];
}

export function appendSyntheticContextMessage(
  history: AgentHistoryMessage[],
  context: LingyunAgentSyntheticContext,
): AgentHistoryMessage[] {
  const text = String(context.text || '').trim();
  if (!text) return history;

  const message = createSystemHistoryMessage(text, { synthetic: true });
  message.metadata = {
    ...(message.metadata ?? {}),
    synthetic: true,
    transientContext: context.transientContext,
  };
  history.push(message);
  return history;
}

export function appendCompactionRestoredSyntheticMessage(
  history: AgentHistoryMessage[],
  params: { source: LingyunCompactionRestoreSource; text: string },
): AgentHistoryMessage[] {
  const text = String(params.text || '').trim();
  if (!text) return history;

  const message = createSystemHistoryMessage(text, { synthetic: true });
  message.metadata = {
    ...(message.metadata ?? {}),
    synthetic: true,
    compactionRestore: { source: params.source },
  };
  history.push(message);
  return history;
}

export function snapshotSyntheticContextsForCompaction(
  contexts: readonly LingyunAgentSyntheticContext[],
): LingyunCompactionSyntheticContext[] {
  if (!Array.isArray(contexts) || contexts.length === 0) return [];

  const snapshots: LingyunCompactionSyntheticContext[] = [];
  for (const context of contexts) {
    if (!context?.persistAfterCompaction) continue;
    const text = trimCompactionText(context.text, context.maxCharsAfterCompaction);
    if (!text) continue;
    let updated = false;
    for (let i = 0; i < snapshots.length; i++) {
      if (snapshots[i]?.transientContext !== context.transientContext) continue;
      snapshots[i] = { transientContext: context.transientContext, text };
      updated = true;
      break;
    }
    if (!updated) snapshots.push({ transientContext: context.transientContext, text });
  }

  return snapshots;
}
