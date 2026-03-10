import type { AgentHistoryMessage } from '@kooka/core';
import { cloneUserHistoryInput, parseUserHistoryInput } from '@kooka/core';
import type { UserHistoryInput } from '@kooka/core';
import type { SemanticHandlesState } from './semanticHandles.js';

export class LingyunSession {
  history: AgentHistoryMessage[] = [];
  pendingPlan?: string;
  pendingInputs: UserHistoryInput[] = [];
  sessionId?: string;
  parentSessionId?: string;
  subagentType?: string;
  modelId?: string;
  mentionedSkills: string[] = [];
  fileHandles?: {
    nextId: number;
    byId: Record<string, string>;
  };
  semanticHandles?: SemanticHandlesState;

  constructor(
    init?: Partial<
      Pick<
        LingyunSession,
        | 'history'
        | 'pendingPlan'
        | 'pendingInputs'
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
    if (init?.history) this.history = [...init.history];
    if (init?.pendingPlan) this.pendingPlan = init.pendingPlan;
    if (init?.pendingInputs) this.setPendingInputs(init.pendingInputs);
    if (init?.sessionId) this.sessionId = init.sessionId;
    if (init?.parentSessionId) this.parentSessionId = init.parentSessionId;
    if (init?.subagentType) this.subagentType = init.subagentType;
    if (init?.modelId) this.modelId = init.modelId;
    if (init?.mentionedSkills) this.mentionedSkills = [...init.mentionedSkills];
    if (init?.fileHandles) this.fileHandles = init.fileHandles;
    if (init?.semanticHandles) this.semanticHandles = init.semanticHandles;
  }

  getHistory(): AgentHistoryMessage[] {
    return [...this.history];
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
}
