import type { AgentSessionState } from '../../core/agent';
import type { ToolDiffView } from './toolDiff';

export type ChatMode = 'build' | 'plan';

export interface ChatImageAttachment {
  mediaType: string;
  dataUrl: string;
  filename?: string;
}

export interface ChatUserInput {
  message: string;
  attachments?: ChatImageAttachment[];
}

export type ChatMessageRole =
  | 'user'
  | 'assistant'
  | 'thought'
  | 'warning'
  | 'tool'
  | 'error'
  | 'plan'
  | 'step'
  | 'revert'
  | 'operation';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: number;
  turnId?: string;
  stepId?: string;
  checkpoint?: {
    historyLength: number;
    pendingPlan?: string;
  };
  step?: {
    index: number;
    status: 'running' | 'done' | 'error' | 'canceled';
    mode?: string;
    model?: string;
    snapshot?: { baseHash: string };
    patch?: { baseHash: string; files: string[] };
  };
  plan?: {
    status: 'generating' | 'draft' | 'needs_input' | 'executing' | 'done' | 'canceled';
    task?: string;
  };
  revert?: {
    revertedMessages: number;
    files?: Array<{ path: string; additions: number; deletions: number }>;
  };
  operation?: {
    kind: 'compact';
    status: 'running' | 'done' | 'error' | 'canceled';
    label: string;
    detail?: string;
    startedAt: number;
    endedAt?: number;
    auto?: boolean;
    summaryText?: string;
    summaryTruncated?: boolean;
  };
  toolCall?: {
    id: string;
    name: string;
    args: string;
    status: 'pending' | 'running' | 'success' | 'error' | 'rejected';
    result?: string;
    approvalId?: string;
    diff?: string;
    diffStats?: { additions: number; deletions: number };
    diffTruncated?: boolean;
    diffUnavailableReason?: string;
    diffView?: ToolDiffView;
    path?: string;
    isProtected?: boolean;
    isOutsideWorkspace?: boolean;
    blockedReason?: string;
    blockedSettingKey?: string;
    batchFiles?: string[];
    additionalCount?: number;
    lsp?: unknown;
    todos?: unknown;
    /**
     * For `task` tool calls, this links to the spawned subagent session id (if created).
     */
    taskSessionId?: string;
  };
}

export interface ChatSessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  agentState: AgentSessionState;
  currentModel: string;
  mode: ChatMode;
  stepCounter: number;
  activeStepId?: string;
  pendingPlan?: { task: string; planMessageId: string };
  /**
   * When set, this session is a subagent session created via the `task` tool.
   */
  parentSessionId?: string;
  /**
   * Built-in subagent type name (e.g. "explore", "general") for subagent sessions.
   */
  subagentType?: string;
  revert?: {
    messageId: string;
    snapshotHash: string;
    baselineAgentState: AgentSessionState;
    baselinePendingPlan?: { task: string; planMessageId: string };
    files?: Array<{ path: string; additions: number; deletions: number }>;
    updatedAt: number;
  };
  runtime?: { wasRunning: boolean; updatedAt: number };
}

export type RevertBarState = {
  active: true;
  revertedMessages: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
};
