import * as vscode from 'vscode';

import type { AgentHistoryMessage, UserHistoryInput } from '@kooka/core';
import type { LingyunThreadGoal, LingyunThreadGoalStatus } from '@kooka/agent-sdk';

import type { AgentSessionState } from '../../core/agent';
import type { SessionSignals } from '../../core/sessionSignals';
import type { AgentApprovalContext, AgentCallbacks, LLMProvider } from '../../core/types';
import type { ChatMessage, ChatMode, ChatQueuedInput, ChatSessionInfo, ChatUserInput } from './types';

export type PendingApprovalEntry = {
  resolve: (approved: boolean) => void;
  toolName: string;
  stepId?: string;
  approvalContext?: AgentApprovalContext;
};

export interface ChatQueueRunnerPort {
  handleUserMessage(
    content: string | ChatUserInput,
    options?: { fromQueue?: boolean; synthetic?: boolean; displayContent?: string; forceBuild?: boolean }
  ): Promise<void>;
}

export interface ChatAgentPort {
  readonly running: boolean;
  run(task: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string>;
  continue(message: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string>;
  getHistory(): AgentHistoryMessage[];
  exportState(): AgentSessionState;
  getThreadGoal(): LingyunThreadGoal | undefined;
  setThreadGoalObjective(params: {
    objective: string;
    tokenBudget?: number;
    status?: LingyunThreadGoalStatus;
    replaceExisting?: boolean;
    preserveUsage?: boolean;
  }): LingyunThreadGoal;
  updateThreadGoalStatus(status: LingyunThreadGoalStatus): LingyunThreadGoal;
  clearThreadGoal(): void;
  clear(): Promise<void>;
  steer(input: UserHistoryInput): void;
  plan(task: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string>;
  resume(callbacks?: AgentCallbacks): Promise<string>;
  execute(callbacks?: AgentCallbacks, options?: { approvedPlan?: string }): Promise<string>;
}

export interface RunCoordinatorQueuePort {
  enqueueActiveInput(payload: {
    message: string;
    displayContent: string;
    attachmentCount: number;
    attachments: NonNullable<ChatUserInput['attachments']>;
  }): ChatQueuedInput;
  takeByIdFromActiveSession(id: string): ChatUserInput | undefined;
  scheduleAutosendForSession(sessionId: string, options?: { suppress?: boolean }): void;
  flushAutosendForActiveSession(): Promise<void>;
}

export interface ChatQueueHost {
  activeSessionId: string;
  isProcessing: boolean;
  messages: ChatMessage[];
  sessions: Map<string, ChatSessionInfo>;
  view?: vscode.WebviewView;
  runner: ChatQueueRunnerPort;
  getActiveSession(): ChatSessionInfo;
  postMessage(message: unknown): void;
  persistActiveSession(): void;
}

export interface RunCoordinatorHost {
  activeSessionId: string;
  agent: ChatAgentPort;
  autoApproveThisRun: boolean;
  abortRequested: boolean;
  classifyPlanStatus(plan: string): 'draft' | 'needs_input';
  commitRevertedConversationIfNeeded(): void;
  createAgentCallbacks(): AgentCallbacks;
  createPlanningCallbacks(planMsg: ChatMessage): AgentCallbacks;
  currentTurnId?: string;
  ensureSessionsLoaded(): Promise<void>;
  getActiveSession(): ChatSessionInfo;
  getContextForUI(): {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    contextLimitTokens?: number;
    outputLimitTokens?: number;
    percent?: number;
  };
  isPlanFirstEnabled(): boolean;
  isProcessing: boolean;
  isSessionPersistenceEnabled(): boolean;
  llmProvider?: LLMProvider;
  maybeGenerateSessionTitle(params: { sessionId: string; message: string; synthetic?: boolean }): void;
  markActiveStepStatus(status: 'running' | 'done' | 'error' | 'canceled'): void;
  messages: ChatMessage[];
  mode: ChatMode;
  pendingApprovals: Map<string, PendingApprovalEntry>;
  persistActiveSession(): void;
  postApprovalState(): void;
  postMessage(message: unknown): void;
  postSessions(): void;
  postUnknownSkillWarnings(content: string, turnId?: string): Promise<void>;
  queueManager: RunCoordinatorQueuePort;
  recordInputHistory(content: string): void;
  recordUserIntent(text: string): void;
  signals?: SessionSignals;
  setModeAndPersist(
    mode: ChatMode,
    options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
  ): Promise<void>;
  view?: vscode.WebviewView;
}
