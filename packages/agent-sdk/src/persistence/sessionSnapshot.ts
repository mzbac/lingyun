import { z } from 'zod';

import type { AgentHistoryMessage, AgentHistoryStats } from '@kooka/core';
import { getAgentHistoryStats } from '@kooka/core';
import {
  cloneFileHandlesState,
  cloneSemanticHandlesState,
  cloneThreadGoal,
  LingyunSession,
  normalizeFileHandlesState,
  normalizeOptionalMentionedSkills,
  normalizeSystemPromptSnapshot,
  normalizeThreadGoal,
  type LingyunSession as LingyunSessionType,
} from '../agent/session.js';
import { normalizeSemanticHandlesState, type SemanticHandlesState } from '../agent/semanticHandles.js';
import {
  normalizeCompactionSyntheticContexts,
  type LingyunCompactionSyntheticContext,
} from '../agent/transientSyntheticContext.js';

export type LingyunSessionSnapshotV1 = {
  version: 1;
  savedAt: string;
  sessionId: string;
  parentSessionId?: string;
  subagentType?: string;
  modelId?: string;
  systemPromptSnapshot?: string[];
  pendingPlan?: string;
  history: AgentHistoryMessage[];
  stats?: AgentHistoryStats;
  mentionedSkills?: string[];
  threadGoal?: LingyunSession['threadGoal'];
  compactionSyntheticContexts?: LingyunCompactionSyntheticContext[];
  fileHandles?: LingyunSession['fileHandles'];
  semanticHandles?: SemanticHandlesState;
};

export type LingyunSessionSnapshot = LingyunSessionSnapshotV1;

const FileHandlesSchema = z.object({
  nextId: z.number(),
  byId: z.record(z.string(), z.string()),
});

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSnapshotInput(input: unknown): unknown {
  return typeof input === 'string' ? JSON.parse(input) : input;
}

function tryParseSnapshotInput(input: unknown): unknown | undefined {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function readTrimmedOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requireSnapshotSessionId(value: unknown, context: string): string {
  const sessionId = readTrimmedOptionalString(value);
  if (!sessionId) {
    throw new Error(`${context}: sessionId is required`);
  }
  return sessionId;
}

function coerceSessionSnapshot(value: RecordLike): LingyunSessionSnapshot | undefined {
  if (value.version !== 1) return undefined;

  const savedAt = readTrimmedOptionalString(value.savedAt);
  if (!savedAt) return undefined;

  const sessionId = readTrimmedOptionalString(value.sessionId);
  if (!sessionId) return undefined;

  const parentSessionId = readTrimmedOptionalString(value.parentSessionId);
  const subagentType = readTrimmedOptionalString(value.subagentType);
  const modelId = readTrimmedOptionalString(value.modelId);
  const systemPromptSnapshot = normalizeSystemPromptSnapshot(value.systemPromptSnapshot);
  const pendingPlan = readTrimmedOptionalString(value.pendingPlan);
  const history = Array.isArray(value.history) ? (value.history as AgentHistoryMessage[]) : [];
  const mentionedSkills = normalizeOptionalMentionedSkills(value.mentionedSkills);
  const threadGoal = normalizeThreadGoal(value.threadGoal);
  const compactionSyntheticContexts = normalizeCompactionSyntheticContexts(value.compactionSyntheticContexts);
  const fileHandles = normalizeFileHandlesState(value.fileHandles);
  const semanticHandles = normalizeSemanticHandlesState(value.semanticHandles);

  return {
    version: 1,
    savedAt,
    sessionId,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(subagentType ? { subagentType } : {}),
    ...(modelId ? { modelId } : {}),
    ...(systemPromptSnapshot ? { systemPromptSnapshot } : {}),
    ...(pendingPlan ? { pendingPlan } : {}),
    history,
    stats: getAgentHistoryStats(history),
    ...(mentionedSkills ? { mentionedSkills } : {}),
    ...(threadGoal ? { threadGoal } : {}),
    ...(compactionSyntheticContexts.length > 0 ? { compactionSyntheticContexts } : {}),
    ...(fileHandles ? { fileHandles } : {}),
    ...(semanticHandles ? { semanticHandles } : {}),
  };
}

export const LingyunSessionSnapshotSchema = z
  .object({
    version: z.literal(1),
    savedAt: z.string(),
    sessionId: z.string(),
    parentSessionId: z.string().optional(),
    subagentType: z.string().optional(),
    modelId: z.string().optional(),
    systemPromptSnapshot: z.array(z.string()).optional(),
    pendingPlan: z.string().optional(),
    history: z.array(z.unknown()),
    stats: z.unknown().optional(),
    mentionedSkills: z.array(z.string()).optional(),
    threadGoal: z.unknown().optional(),
    compactionSyntheticContexts: z
      .array(
        z.object({
          transientContext: z.enum(['explore', 'memoryRecall', 'goal']),
          text: z.string(),
        }),
      )
      .optional(),
    fileHandles: FileHandlesSchema.optional(),
    semanticHandles: z.unknown().optional(),
  })
  .passthrough();

export function snapshotSession(
  session: LingyunSessionType,
  options?: { savedAt?: Date; sessionId?: string; includeFileHandles?: boolean }
): LingyunSessionSnapshot {
  const includeFileHandles = options?.includeFileHandles !== false;
  const savedAt = (options?.savedAt ?? new Date()).toISOString();
  const sessionId = requireSnapshotSessionId(options?.sessionId ?? session.sessionId, 'snapshotSession');
  const mentionedSkills = normalizeOptionalMentionedSkills(session.mentionedSkills);
  const systemPromptSnapshot = session.getSystemPromptSnapshot();

  return {
    version: 1,
    savedAt,
    sessionId,
    ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
    ...(session.subagentType ? { subagentType: session.subagentType } : {}),
    ...(session.modelId ? { modelId: session.modelId } : {}),
    ...(systemPromptSnapshot ? { systemPromptSnapshot } : {}),
    ...(session.pendingPlan ? { pendingPlan: session.pendingPlan } : {}),
    history: session.getHistory(),
    stats: session.getStats(),
    ...(mentionedSkills ? { mentionedSkills } : {}),
    ...(session.threadGoal ? { threadGoal: cloneThreadGoal(session.threadGoal) } : {}),
    ...(session.compactionSyntheticContexts.length > 0
      ? {
          compactionSyntheticContexts: normalizeCompactionSyntheticContexts(session.compactionSyntheticContexts),
        }
      : {}),
    ...(includeFileHandles && session.fileHandles ? { fileHandles: cloneFileHandlesState(session.fileHandles) } : {}),
    ...(session.semanticHandles ? { semanticHandles: cloneSemanticHandlesState(session.semanticHandles) } : {}),
  };
}

export function restoreSession(snapshot: LingyunSessionSnapshot): LingyunSession {
  return new LingyunSession({
    history: snapshot.history,
    pendingPlan: snapshot.pendingPlan,
    sessionId: snapshot.sessionId,
    parentSessionId: snapshot.parentSessionId,
    subagentType: snapshot.subagentType,
    modelId: snapshot.modelId,
    systemPromptSnapshot: snapshot.systemPromptSnapshot,
    mentionedSkills: snapshot.mentionedSkills,
    threadGoal: snapshot.threadGoal,
    compactionSyntheticContexts: snapshot.compactionSyntheticContexts,
    fileHandles: snapshot.fileHandles,
    semanticHandles: snapshot.semanticHandles,
  });
}

export function serializeSessionSnapshot(snapshot: LingyunSessionSnapshot, options?: { pretty?: boolean }): string {
  return JSON.stringify(snapshot, null, options?.pretty ? 2 : undefined);
}

export function parseSessionSnapshot(input: unknown): LingyunSessionSnapshot {
  const raw = parseSnapshotInput(input);
  const parsed = LingyunSessionSnapshotSchema.parse(raw);
  const snapshot = coerceSessionSnapshot(parsed as RecordLike);
  if (!snapshot) {
    throw new Error('Invalid session snapshot: sessionId is required');
  }
  return snapshot;
}

/**
 * Best-effort parser for host/UI boundaries that need to tolerate partially malformed
 * session snapshots while still rejecting snapshots without basic identity/version fields.
 */
export function tryParseSessionSnapshot(input: unknown): LingyunSessionSnapshot | undefined {
  try {
    return parseSessionSnapshot(input);
  } catch {
    const raw = tryParseSnapshotInput(input);
    if (!isRecord(raw)) return undefined;
    return coerceSessionSnapshot(raw);
  }
}
