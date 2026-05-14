import type { AgentHistoryMessage, AgentHistoryStats } from '@kooka/core';
import {
  cloneAgentHistoryMessages,
  cloneUserHistoryInput,
  getAgentHistoryStats,
  parseUserHistoryInput,
} from '@kooka/core';
import type { UserHistoryInput } from '@kooka/core';
import { normalizeSemanticHandlesState, type SemanticHandlesState } from './semanticHandles.js';
import type { LingyunCompactionSyntheticContext } from './transientSyntheticContext.js';

export type LingyunFileHandlesState = {
  nextId: number;
  byId: Record<string, string>;
};

export type LingyunThreadGoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete';

export type LingyunThreadGoal = {
  id: string;
  sessionId?: string;
  objective: string;
  status: LingyunThreadGoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export function createBlankFileHandlesState(): LingyunFileHandlesState {
  return { nextId: 1, byId: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeFileHandlesState(value: unknown): LingyunFileHandlesState | undefined {
  if (!isRecord(value)) return undefined;

  const nextId = value.nextId;
  const byIdRaw = value.byId;
  if (typeof nextId !== 'number' || !Number.isFinite(nextId) || nextId < 1 || !isRecord(byIdRaw)) {
    return undefined;
  }

  const byId: Record<string, string> = {};
  for (const [id, filePath] of Object.entries(byIdRaw)) {
    if (!/^F\d+$/.test(id)) continue;
    if (typeof filePath !== 'string') continue;
    const normalizedPath = filePath.trim();
    if (!normalizedPath) continue;
    byId[id] = normalizedPath;
  }

  return {
    nextId: Math.max(1, Math.floor(nextId)),
    byId,
  };
}

export function createBlankSemanticHandlesState(): SemanticHandlesState {
  return {
    nextMatchId: 1,
    nextSymbolId: 1,
    nextLocId: 1,
    matches: {},
    symbols: {},
    locations: {},
  };
}

export function cloneFileHandlesState(
  value: LingyunFileHandlesState | undefined,
): LingyunFileHandlesState | undefined {
  return value ? { nextId: value.nextId, byId: { ...value.byId } } : undefined;
}

function cloneSemanticHandleRange(
  range: SemanticHandlesState['matches'][string]['range'],
): SemanticHandlesState['matches'][string]['range'] {
  return {
    start: { ...range.start },
    end: { ...range.end },
  };
}

function cloneSemanticHandleEntries<T extends { range: SemanticHandlesState['matches'][string]['range'] }>(
  entries: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(entries).map(([id, entry]) => [id, { ...entry, range: cloneSemanticHandleRange(entry.range) }]),
  ) as Record<string, T>;
}

export function cloneSemanticHandlesState(
  value: SemanticHandlesState | undefined,
): SemanticHandlesState | undefined {
  if (!value) return undefined;
  return {
    nextMatchId: value.nextMatchId,
    nextSymbolId: value.nextSymbolId,
    nextLocId: value.nextLocId,
    matches: cloneSemanticHandleEntries(value.matches),
    symbols: cloneSemanticHandleEntries(value.symbols),
    locations: cloneSemanticHandleEntries(value.locations),
  };
}

export function normalizeMentionedSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const skill = typeof item === 'string' ? item.trim() : '';
    if (!skill || seen.has(skill)) continue;
    seen.add(skill);
    normalized.push(skill);
  }
  return normalized;
}

export function normalizeSystemPromptSnapshot(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const parts = value
    .map((part) => (typeof part === 'string' ? part : ''))
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : undefined;
}

export function normalizeOptionalMentionedSkills(value: unknown): string[] | undefined {
  const mentionedSkills = normalizeMentionedSkills(value);
  return mentionedSkills.length > 0 ? mentionedSkills : undefined;
}

function readTrimmedOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

export function cloneThreadGoal(goal: LingyunThreadGoal | undefined): LingyunThreadGoal | undefined {
  return goal ? { ...goal } : undefined;
}

export function normalizeThreadGoal(value: unknown): LingyunThreadGoal | undefined {
  if (!isRecord(value)) return undefined;

  const id = readTrimmedOptionalString(value.id);
  const objective = readTrimmedOptionalString(value.objective);
  const status = value.status;
  if (!id || !objective) return undefined;
  if (status !== 'active' && status !== 'paused' && status !== 'budget_limited' && status !== 'complete') {
    return undefined;
  }

  const tokensUsed = readNonNegativeInteger(value.tokensUsed) ?? 0;
  const timeUsedSeconds = readNonNegativeInteger(value.timeUsedSeconds) ?? 0;
  const createdAt = readNonNegativeInteger(value.createdAt) ?? Date.now();
  const updatedAt = readNonNegativeInteger(value.updatedAt) ?? createdAt;
  const tokenBudget = readPositiveInteger(value.tokenBudget);
  const sessionId = readTrimmedOptionalString(value.sessionId);

  return {
    id,
    ...(sessionId ? { sessionId } : {}),
    objective,
    status,
    ...(tokenBudget ? { tokenBudget } : {}),
    tokensUsed,
    timeUsedSeconds,
    createdAt,
    updatedAt,
  };
}

export class LingyunSession {
  history: AgentHistoryMessage[] = [];
  pendingPlan?: string;
  pendingInputs: UserHistoryInput[] = [];
  compactionSyntheticContexts: LingyunCompactionSyntheticContext[] = [];
  sessionId?: string;
  parentSessionId?: string;
  subagentType?: string;
  modelId?: string;
  systemPromptSnapshot?: string[];
  mentionedSkills: string[] = [];
  threadGoal?: LingyunThreadGoal;
  fileHandles?: LingyunFileHandlesState;
  semanticHandles?: SemanticHandlesState;

  constructor(
    init?: Partial<
      Pick<
        LingyunSession,
        | 'history'
        | 'pendingPlan'
        | 'pendingInputs'
        | 'compactionSyntheticContexts'
        | 'sessionId'
        | 'parentSessionId'
        | 'subagentType'
        | 'modelId'
        | 'systemPromptSnapshot'
        | 'mentionedSkills'
        | 'threadGoal'
        | 'fileHandles'
        | 'semanticHandles'
      >
    >,
  ) {
    if (init?.history) this.history = cloneAgentHistoryMessages(init.history);
    if (init?.pendingPlan) this.pendingPlan = init.pendingPlan;
    if (init?.pendingInputs) this.setPendingInputs(init.pendingInputs);
    if (init?.compactionSyntheticContexts) {
      this.compactionSyntheticContexts = init.compactionSyntheticContexts.map((context) => ({ ...context }));
    }
    if (init?.sessionId) this.sessionId = init.sessionId;
    if (init?.parentSessionId) this.parentSessionId = init.parentSessionId;
    if (init?.subagentType) this.subagentType = init.subagentType;
    if (init?.modelId) this.modelId = init.modelId;
    this.setSystemPromptSnapshot(init?.systemPromptSnapshot);
    this.setMentionedSkills(init?.mentionedSkills);
    this.threadGoal = cloneThreadGoal(normalizeThreadGoal(init?.threadGoal));
    this.fileHandles = cloneFileHandlesState(init?.fileHandles);
    this.semanticHandles = normalizeSemanticHandlesState(init?.semanticHandles);
  }

  setMentionedSkills(skills: unknown): void {
    this.mentionedSkills = normalizeMentionedSkills(skills);
  }

  rememberMentionedSkill(skill: string): void {
    const normalized = normalizeMentionedSkills([skill]);
    if (normalized.length === 0) return;
    if (!this.mentionedSkills.includes(normalized[0]!)) {
      this.mentionedSkills.push(normalized[0]!);
    }
  }

  clearMentionedSkills(): void {
    this.mentionedSkills = [];
  }

  setSystemPromptSnapshot(parts: unknown): void {
    const snapshot = normalizeSystemPromptSnapshot(parts);
    this.systemPromptSnapshot = snapshot ? [...snapshot] : undefined;
  }

  getSystemPromptSnapshot(): string[] | undefined {
    return this.systemPromptSnapshot ? [...this.systemPromptSnapshot] : undefined;
  }

  getStats(): AgentHistoryStats {
    return getAgentHistoryStats(this.history);
  }

  getHistory(): AgentHistoryMessage[] {
    return cloneAgentHistoryMessages(this.history);
  }

  enqueuePendingInput(input: UserHistoryInput): void {
    const normalized = parseUserHistoryInput(input);
    if (!normalized) return;
    this.pendingInputs.push(normalized);
  }

  getPendingInputs(): UserHistoryInput[] {
    return this.pendingInputs.map((input) => cloneUserHistoryInput(input));
  }

  setPendingInputs(inputs: UserHistoryInput[]): void {
    this.pendingInputs = inputs
      .map((input) => parseUserHistoryInput(input))
      .filter((input): input is UserHistoryInput => input !== undefined);
  }

  peekPendingInput(): UserHistoryInput | undefined {
    const next = this.pendingInputs[0];
    return next === undefined ? undefined : cloneUserHistoryInput(next);
  }

  shiftPendingInput(): void {
    if (this.pendingInputs.length > 0) {
      this.pendingInputs.shift();
    }
  }

  clearPendingInputs(): void {
    this.pendingInputs = [];
  }

  clearRuntimeState(): void {
    this.history = [];
    this.pendingPlan = undefined;
    this.clearPendingInputs();
    this.fileHandles = createBlankFileHandlesState();
    this.semanticHandles = createBlankSemanticHandlesState();
    this.clearMentionedSkills();
    this.threadGoal = undefined;
    this.systemPromptSnapshot = undefined;
    this.compactionSyntheticContexts = [];
  }
}
