import type { AgentHistoryMessage, AgentHistoryStats } from '@kooka/core';
import {
  cloneAgentHistoryMessages,
  cloneUserHistoryInput,
  getAgentHistoryStats,
  parseUserHistoryInput,
} from '@kooka/core';
import type { UserHistoryInput } from '@kooka/core';
import { normalizeSemanticHandlesState, type SemanticHandlesState } from './semanticHandles.js';
import {
  normalizeCompactionSyntheticContexts,
  type LingyunCompactionSyntheticContext,
} from './transientSyntheticContext.js';

export type LingyunFileHandlesState = {
  nextId: number;
  byId: Record<string, string>;
};

export type LingyunThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete';

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

export type LingyunThreadGoalToolResponse = {
  goal: LingyunThreadGoalToolGoal | null;
  remainingTokens: number | null;
  completionBudgetReport: string | null;
};

export type LingyunThreadGoalToolGoal = {
  threadId: string;
  objective: string;
  status: LingyunThreadGoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export const THREAD_GOAL_COMPLETION_BUDGET_REPORT =
  "Goal achieved. Report final usage from this tool result's structured goal fields. If `goal.tokenBudget` is present, include token usage from `goal.tokensUsed` and `goal.tokenBudget`. If `goal.timeUsedSeconds` is greater than 0, summarize elapsed time in a concise, human-friendly form appropriate to the response language.";

export function createBlankFileHandlesState(): LingyunFileHandlesState {
  return { nextId: 1, byId: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const FILE_HANDLE_ID_RE = /^F(\d+)$/;

function parseFileHandleNumber(id: string): number | undefined {
  const match = FILE_HANDLE_ID_RE.exec(id);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export function isNormalizedFileHandlesState(value: unknown): value is LingyunFileHandlesState {
  if (!isRecord(value)) return false;
  if (typeof value.nextId !== 'number' || !Number.isSafeInteger(value.nextId) || value.nextId < 1) return false;

  const byId = value.byId;
  if (!isRecord(byId)) return false;

  let minimumNextId = 1;
  for (const id in byId) {
    if (!Object.prototype.hasOwnProperty.call(byId, id)) continue;
    const fileHandleNumber = parseFileHandleNumber(id);
    if (fileHandleNumber === undefined) return false;
    const filePath = byId[id];
    if (typeof filePath !== 'string' || !filePath || filePath.trim() !== filePath) return false;
    if (fileHandleNumber >= minimumNextId) minimumNextId = fileHandleNumber + 1;
  }

  return value.nextId >= minimumNextId;
}

export function normalizeFileHandlesState(value: unknown): LingyunFileHandlesState | undefined {
  if (!isRecord(value)) return undefined;

  const nextId = value.nextId;
  const byIdRaw = value.byId;
  if (typeof nextId !== 'number' || !Number.isFinite(nextId) || nextId < 1 || !isRecord(byIdRaw)) {
    return undefined;
  }

  const byId: Record<string, string> = {};
  let minimumNextId = 1;
  for (const id in byIdRaw) {
    if (!Object.prototype.hasOwnProperty.call(byIdRaw, id)) continue;
    const filePath = byIdRaw[id];
    const fileHandleNumber = parseFileHandleNumber(id);
    if (fileHandleNumber === undefined) continue;
    if (typeof filePath !== 'string') continue;
    const normalizedPath = filePath.trim();
    if (!normalizedPath) continue;
    byId[id] = normalizedPath;
    if (fileHandleNumber >= minimumNextId) minimumNextId = fileHandleNumber + 1;
  }

  return {
    nextId: Math.max(minimumNextId, Math.floor(nextId)),
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
  const cloned: Record<string, T> = {};
  for (const id in entries) {
    if (!Object.prototype.hasOwnProperty.call(entries, id)) continue;
    const entry = entries[id];
    if (!entry) continue;
    cloned[id] = { ...entry, range: cloneSemanticHandleRange(entry.range) };
  }
  return cloned;
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

  const parts: string[] = [];
  for (const part of value) {
    if (typeof part !== 'string') continue;
    if (part.trim()) parts.push(part);
  }
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
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return undefined;
  return value;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

export function cloneThreadGoal(goal: LingyunThreadGoal | undefined): LingyunThreadGoal | undefined {
  return goal ? { ...goal } : undefined;
}

function threadGoalForToolResponse(goal: LingyunThreadGoal, threadId: string): LingyunThreadGoalToolGoal {
  return {
    threadId,
    objective: goal.objective,
    status: goal.status,
    ...(goal.tokenBudget !== undefined ? { tokenBudget: goal.tokenBudget } : {}),
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

export function createThreadGoalToolResponse(
  goal: LingyunThreadGoal | undefined,
  options?: { includeCompletionReport?: boolean; threadId?: string | undefined },
): LingyunThreadGoalToolResponse {
  const threadId = options?.threadId ?? goal?.sessionId ?? '';
  const response: LingyunThreadGoalToolResponse = {
    goal: goal ? threadGoalForToolResponse(goal, threadId) : null,
    remainingTokens: goal?.tokenBudget ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : null,
    completionBudgetReport: null,
  };
  if (
    options?.includeCompletionReport &&
    goal?.status === 'complete' &&
    (goal.tokenBudget !== undefined || goal.timeUsedSeconds > 0)
  ) {
    response.completionBudgetReport = THREAD_GOAL_COMPLETION_BUDGET_REPORT;
  }
  return response;
}

export function resolveThreadGoalStatusAfterBudgetLimit(params: {
  currentStatus?: LingyunThreadGoalStatus;
  requestedStatus: LingyunThreadGoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  budgetLimitEligible?: boolean;
}): LingyunThreadGoalStatus {
  if (
    params.currentStatus === 'budgetLimited' &&
    (params.requestedStatus === 'paused' || params.requestedStatus === 'blocked')
  ) {
    return 'budgetLimited';
  }
  if (
    (params.budgetLimitEligible ?? params.requestedStatus === 'active') &&
    params.requestedStatus !== 'complete' &&
    params.tokenBudget !== undefined &&
    Math.max(0, Math.floor(params.tokensUsed)) >= params.tokenBudget
  ) {
    return 'budgetLimited';
  }
  return params.requestedStatus;
}

function normalizeThreadGoalStatus(value: unknown): LingyunThreadGoalStatus | undefined {
  switch (value) {
    case 'active':
    case 'paused':
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
    case 'complete':
      return value;
    case 'usage_limited':
      return 'usageLimited';
    case 'budget_limited':
      return 'budgetLimited';
    default:
      return undefined;
  }
}

export function normalizeThreadGoal(value: unknown): LingyunThreadGoal | undefined {
  if (!isRecord(value)) return undefined;

  const id = readTrimmedOptionalString(value.id);
  const objective = readTrimmedOptionalString(value.objective);
  const status = normalizeThreadGoalStatus(value.status);
  if (!id || !objective) return undefined;
  if (!status) return undefined;

  const tokensUsed = readNonNegativeInteger(value.tokensUsed) ?? 0;
  const timeUsedSeconds = readNonNegativeInteger(value.timeUsedSeconds) ?? 0;
  const createdAt = readNonNegativeInteger(value.createdAt) ?? Date.now();
  const updatedAt = readNonNegativeInteger(value.updatedAt) ?? createdAt;
  const tokenBudget = readPositiveInteger(value.tokenBudget);
  const sessionId = readTrimmedOptionalString(value.sessionId);

  const normalizedStatus = resolveThreadGoalStatusAfterBudgetLimit({
    requestedStatus: status,
    tokenBudget,
    tokensUsed,
  });

  return {
    id,
    ...(sessionId ? { sessionId } : {}),
    objective,
    status: normalizedStatus,
    ...(tokenBudget ? { tokenBudget } : {}),
    tokensUsed,
    timeUsedSeconds,
    createdAt,
    updatedAt,
  };
}

export function normalizePendingInputs(inputs: unknown): UserHistoryInput[] {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  const pendingInputs: UserHistoryInput[] = [];
  for (const input of inputs) {
    const normalized = parseUserHistoryInput(input);
    if (normalized !== undefined) {
      pendingInputs.push(normalized);
    }
  }
  return pendingInputs;
}

function clonePendingInputs(inputs: readonly UserHistoryInput[]): UserHistoryInput[] {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  const cloned: UserHistoryInput[] = [];
  for (const input of inputs) {
    cloned.push(cloneUserHistoryInput(input));
  }
  return cloned;
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
    if (init?.compactionSyntheticContexts) this.setCompactionSyntheticContexts(init.compactionSyntheticContexts);
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
    return clonePendingInputs(this.pendingInputs);
  }

  setPendingInputs(inputs: unknown): void {
    this.pendingInputs = normalizePendingInputs(inputs);
  }

  setCompactionSyntheticContexts(contexts: unknown): void {
    this.compactionSyntheticContexts = normalizeCompactionSyntheticContexts(contexts);
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
