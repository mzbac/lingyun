import * as vscode from 'vscode';

import type { AgentHistoryMessage, UserHistoryInput } from '@kooka/core';

import type { AgentSessionState } from '../../core/agent';
import type { SessionSignals } from '../../core/sessionSignals';
import type { AgentApprovalContext, AgentCallbacks, LLMProvider } from '../../core/types';
import type { OfficeSync } from '../office/sync';
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
    options?: { fromQueue?: boolean; synthetic?: boolean; displayContent?: string }
  ): Promise<void>;
}

export interface ChatLoopRunnerPort {
  canAcceptLoopSteer(): boolean;
}

export interface ChatAgentPort {
  readonly running: boolean;
  run(task: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string>;
  continue(message: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string>;
  getHistory(): AgentHistoryMessage[];
  exportState(): AgentSessionState;
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

export interface RunCoordinatorLoopPort {
  hasLoopContext(session?: ChatSessionInfo): boolean;
  onRunStart(sessionId?: string): void;
  onRunEnd(sessionId?: string): void;
  syncActiveSession(options?: { resetSchedule?: boolean }): void;
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

export interface ChatLoopHost {
  activeSessionId: string;
  isProcessing: boolean;
  mode: ChatMode;
  sessions: Map<string, ChatSessionInfo>;
  agent: { exportState(): AgentSessionState };
  runner: ChatLoopRunnerPort;
  getActiveSession(): ChatSessionInfo;
  postLoopState(session?: ChatSessionInfo): void;
  injectLoopPrompt(prompt?: string): Promise<boolean>;
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
  loopManager: RunCoordinatorLoopPort;
  maybeGenerateSessionTitle(params: { sessionId: string; message: string; synthetic?: boolean }): void;
  markActiveStepStatus(status: 'running' | 'done' | 'error' | 'canceled'): void;
  messages: ChatMessage[];
  mode: ChatMode;
  officeSync?: OfficeSync;
  pendingApprovals: Map<string, PendingApprovalEntry>;
  persistActiveSession(): void;
  postApprovalState(): void;
  postLoopState(session?: ChatSessionInfo): void;
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
