import { z } from 'zod';

import type { AgentHistoryMessage } from '@kooka/core';
import {
  cloneFileHandlesState,
  cloneSemanticHandlesState,
  LingyunSession,
  normalizeFileHandlesState,
  normalizeOptionalMentionedSkills,
  type LingyunSession as LingyunSessionType,
} from '../agent/session.js';
import { normalizeSemanticHandlesState, type SemanticHandlesState } from '../agent/semanticHandles.js';
import type { LingyunCompactionSyntheticContext } from '../agent/transientSyntheticContext.js';

export type LingyunSessionSnapshotV1 = {
  version: 1;
  savedAt: string;
  sessionId: string;
  parentSessionId?: string;
  subagentType?: string;
  modelId?: string;
  pendingPlan?: string;
  history: AgentHistoryMessage[];
  mentionedSkills?: string[];
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

function normalizeCompactionSyntheticContexts(
  value: unknown,
): LingyunCompactionSyntheticContext[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const contexts = value
    .filter(
      (context): context is LingyunCompactionSyntheticContext =>
        isRecord(context) &&
        (context.transientContext === 'explore' || context.transientContext === 'memoryRecall') &&
        typeof context.text === 'string',
    )
    .map(context => ({
      transientContext: context.transientContext,
      text: context.text,
    }));
  return contexts.length > 0 ? contexts : undefined;
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
  const pendingPlan = readTrimmedOptionalString(value.pendingPlan);
  const history = Array.isArray(value.history) ? (value.history as AgentHistoryMessage[]) : [];
  const mentionedSkills = normalizeOptionalMentionedSkills(value.mentionedSkills);
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
    ...(pendingPlan ? { pendingPlan } : {}),
    history,
    ...(mentionedSkills ? { mentionedSkills } : {}),
    ...(compactionSyntheticContexts ? { compactionSyntheticContexts } : {}),
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
    pendingPlan: z.string().optional(),
    history: z.array(z.unknown()),
    mentionedSkills: z.array(z.string()).optional(),
    compactionSyntheticContexts: z
      .array(
        z.object({
          transientContext: z.enum(['explore', 'memoryRecall']),
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

  return {
    version: 1,
    savedAt,
    sessionId,
    ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
    ...(session.subagentType ? { subagentType: session.subagentType } : {}),
    ...(session.modelId ? { modelId: session.modelId } : {}),
    ...(session.pendingPlan ? { pendingPlan: session.pendingPlan } : {}),
    history: session.getHistory(),
    ...(mentionedSkills ? { mentionedSkills } : {}),
    ...(session.compactionSyntheticContexts.length > 0
      ? {
          compactionSyntheticContexts: session.compactionSyntheticContexts.map((context) => ({ ...context })),
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
    mentionedSkills: snapshot.mentionedSkills,
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
