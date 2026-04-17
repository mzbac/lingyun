import type { AgentHistoryMessage } from '@kooka/core';
import { cloneAgentHistoryMessages, cloneUserHistoryInput, parseUserHistoryInput } from '@kooka/core';
import type { UserHistoryInput } from '@kooka/core';
import { normalizeSemanticHandlesState, type SemanticHandlesState } from './semanticHandles.js';
import type { LingyunCompactionSyntheticContext } from './transientSyntheticContext.js';

export type LingyunFileHandlesState = {
  nextId: number;
  byId: Record<string, string>;
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

export function normalizeOptionalMentionedSkills(value: unknown): string[] | undefined {
  const mentionedSkills = normalizeMentionedSkills(value);
  return mentionedSkills.length > 0 ? mentionedSkills : undefined;
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
  mentionedSkills: string[] = [];
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
        | 'mentionedSkills'
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
    this.setMentionedSkills(init?.mentionedSkills);
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
    this.compactionSyntheticContexts = [];
  }
}
