import type { AgentHistoryMessage } from '@kooka/core';
import type { SemanticHandlesState } from './semanticHandles.js';

export class LingyunSession {
  history: AgentHistoryMessage[] = [];
  pendingPlan?: string;
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
}

