import { z } from 'zod';

import type { AgentHistoryMessage } from '@kooka/core';
import { LingyunSession, type LingyunSession as LingyunSessionType } from '../agent/agent.js';

export type LingyunSessionSnapshotV1 = {
  version: 1;
  savedAt: string;
  sessionId?: string;
  parentSessionId?: string;
  subagentType?: string;
  modelId?: string;
  pendingPlan?: string;
  history: AgentHistoryMessage[];
  mentionedSkills?: string[];
  fileHandles?: {
    nextId: number;
    byId: Record<string, string>;
  };
};

export type LingyunSessionSnapshot = LingyunSessionSnapshotV1;

const FileHandlesSchema = z.object({
  nextId: z.number(),
  byId: z.record(z.string(), z.string()),
});

export const LingyunSessionSnapshotSchema = z
  .object({
    version: z.literal(1),
    savedAt: z.string(),
    sessionId: z.string().optional(),
    parentSessionId: z.string().optional(),
    subagentType: z.string().optional(),
    modelId: z.string().optional(),
    pendingPlan: z.string().optional(),
    history: z.array(z.unknown()),
    mentionedSkills: z.array(z.string()).optional(),
    fileHandles: FileHandlesSchema.optional(),
  })
  .passthrough();

export function snapshotSession(
  session: LingyunSessionType,
  options?: { savedAt?: Date; sessionId?: string; includeFileHandles?: boolean }
): LingyunSessionSnapshot {
  const includeFileHandles = options?.includeFileHandles !== false;
  const savedAt = (options?.savedAt ?? new Date()).toISOString();
  const sessionId = options?.sessionId ?? session.sessionId;

  return {
    version: 1,
    savedAt,
    ...(sessionId ? { sessionId } : {}),
    ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
    ...(session.subagentType ? { subagentType: session.subagentType } : {}),
    ...(session.modelId ? { modelId: session.modelId } : {}),
    ...(session.pendingPlan ? { pendingPlan: session.pendingPlan } : {}),
    history: session.getHistory(),
    ...(session.mentionedSkills.length > 0 ? { mentionedSkills: [...session.mentionedSkills] } : {}),
    ...(includeFileHandles && session.fileHandles ? { fileHandles: session.fileHandles } : {}),
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
    fileHandles: snapshot.fileHandles,
  });
}

export function serializeSessionSnapshot(snapshot: LingyunSessionSnapshot, options?: { pretty?: boolean }): string {
  return JSON.stringify(snapshot, null, options?.pretty ? 2 : undefined);
}

export function parseSessionSnapshot(input: unknown): LingyunSessionSnapshot {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const parsed = LingyunSessionSnapshotSchema.parse(raw);

  return {
    version: 1,
    savedAt: parsed.savedAt,
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    ...(parsed.parentSessionId ? { parentSessionId: parsed.parentSessionId } : {}),
    ...(parsed.subagentType ? { subagentType: parsed.subagentType } : {}),
    ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
    ...(parsed.pendingPlan ? { pendingPlan: parsed.pendingPlan } : {}),
    history: parsed.history as AgentHistoryMessage[],
    ...(Array.isArray(parsed.mentionedSkills) ? { mentionedSkills: parsed.mentionedSkills } : {}),
    ...(parsed.fileHandles ? { fileHandles: parsed.fileHandles } : {}),
  };
}
