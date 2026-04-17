import type * as vscode from 'vscode';

import type { AgentLoop } from '../../../core/agent';
import type { SessionSignals } from '../../../core/sessionSignals';
import type { WorkspaceSnapshot } from '../../../core/snapshot';
import type { AgentApprovalContext, AgentCallbacks, ToolCall, ToolDefinition } from '../../../core/types';
import type { OfficeSync } from '../../office/sync';
import type { ChatMessage, ChatSessionInfo } from '../types';

export interface ChatRunnerCallbacksService {
  createPlanningCallbacks(planMsg: ChatMessage): AgentCallbacks;
  createAgentCallbacks(): AgentCallbacks;
}

/**
 * Root callback dependency contract used only at the composition/adapter boundary.
 *
 * Deeper runner modules should depend on the narrower Runner*View types below so
 * their interfaces reveal the actual knowledge they require.
 */

export interface ChatRunnerCallbacksDeps {
  activeSessionId: string;
  sessions: Map<string, ChatSessionInfo>;
  agent: Pick<AgentLoop, 'getHistory' | 'resolveFileId'>;
  currentModel: string;
  currentTurnId?: string;
  activeStepId?: string;
  stepCounter: number;
  mode: 'build' | 'plan';
  llmProvider?: { id?: string };
  messages: ChatMessage[];
  abortRequested: boolean;
  signals: SessionSignals;
  officeSync?: OfficeSync;
  outputChannel?: vscode.OutputChannel;
  snapshot?: WorkspaceSnapshot;
  snapshotUnavailableReason?: string;
  toolDiffBeforeByToolCallId: Map<
    string,
    {
      absPath: string;
      displayPath: string;
      beforeText: string;
      isExternal: boolean;
      skippedReason?: 'too_large' | 'binary';
    }
  >;
  toolDiffSnapshotsByToolCallId: Map<
    string,
    {
      absPath: string;
      displayPath: string;
      beforeText: string;
      afterText: string;
      isExternal: boolean;
      truncated: boolean;
    }
  >;
  isSessionPersistenceEnabled(): boolean;
  normalizeLoadedSession(raw: ChatSessionInfo): ChatSessionInfo;
  persistActiveSession(): void;
  postMessage(message: unknown): void;
  postSessions(): void;
  markSessionDirty(sessionId: string): void;
  flushSessionSave(): Promise<void>;
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
  requestInlineApproval(
    tc: ToolCall,
    def: ToolDefinition,
    parentMessageId?: string,
    approvalContext?: AgentApprovalContext,
  ): Promise<boolean>;
  getWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined>;
}

export type RunnerMessageStore = Pick<
  ChatRunnerCallbacksDeps,
  'messages' | 'postMessage' | 'persistActiveSession' | 'isSessionPersistenceEnabled'
>;

export type RunnerConversationView = Pick<
  ChatRunnerCallbacksDeps,
  | 'agent'
  | 'messages'
  | 'currentModel'
  | 'currentTurnId'
  | 'activeStepId'
  | 'stepCounter'
  | 'mode'
  | 'llmProvider'
  | 'postMessage'
  | 'persistActiveSession'
> & {
  activeStepId?: string;
  currentTurnId?: string;
  stepCounter: number;
};

export type RunnerPersistenceView = Pick<
  ChatRunnerCallbacksDeps,
  | 'activeSessionId'
  | 'sessions'
  | 'normalizeLoadedSession'
  | 'postSessions'
  | 'markSessionDirty'
  | 'flushSessionSave'
  | 'persistActiveSession'
  | 'isSessionPersistenceEnabled'
  | 'outputChannel'
  | 'messages'
  | 'postMessage'
  | 'toolDiffSnapshotsByToolCallId'
  | 'agent'
  | 'currentTurnId'
>;

export type RunnerPlanningView = Pick<
  ChatRunnerCallbacksDeps,
  | 'activeSessionId'
  | 'sessions'
  | 'normalizeLoadedSession'
  | 'postSessions'
  | 'markSessionDirty'
  | 'flushSessionSave'
  | 'persistActiveSession'
  | 'isSessionPersistenceEnabled'
  | 'outputChannel'
  | 'messages'
  | 'postMessage'
  | 'agent'
  | 'currentTurnId'
  | 'getContextForUI'
  | 'requestInlineApproval'
  | 'abortRequested'
>;

export type RunnerToolLifecycleView = Pick<
  ChatRunnerCallbacksDeps,
  | 'agent'
  | 'messages'
  | 'currentTurnId'
  | 'activeStepId'
  | 'signals'
  | 'toolDiffBeforeByToolCallId'
  | 'toolDiffSnapshotsByToolCallId'
  | 'postMessage'
  | 'persistActiveSession'
> &
  RunnerPersistenceView;

export type RunnerCompactionView = Pick<
  ChatRunnerCallbacksDeps,
  'agent' | 'messages' | 'currentTurnId' | 'postMessage' | 'persistActiveSession' | 'getContextForUI'
>;

export type RunnerSnapshotView = Pick<
  ChatRunnerCallbacksDeps,
  'mode' | 'persistActiveSession' | 'getWorkspaceSnapshot' | 'snapshotUnavailableReason'
> & {
  snapshotUnavailableReason?: string;
};
