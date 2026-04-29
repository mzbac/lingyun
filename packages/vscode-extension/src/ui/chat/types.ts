import type { AgentSessionState } from '../../core/agent';
import type { SessionSignals } from '../../core/sessionSignals';
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

export interface ChatQueuedInput {
  id: string;
  createdAt: number;
  message: string;
  displayContent: string;
  attachmentCount: number;
}

export interface ChatSessionLoopState {
  enabled: boolean;
  intervalMinutes: number;
  prompt: string;
  lastFiredAt?: number;
  nextFireAt?: number;
}

export type ChatLoopStatusReason =
  | 'ready'
  | 'disabled'
  | 'unavailable'
  | 'no_context'
  | 'busy'
  | 'plan_mode'
  | 'pending_plan';

export interface ChatLoopUiState extends ChatSessionLoopState {
  available: boolean;
  canRunNow: boolean;
  reason: ChatLoopStatusReason;
  statusText: string;
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
  memoryExcluded?: boolean;
  checkpoint?: {
    historyLength: number;
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
    memoryContextSource?: string;
    isProtected?: boolean;
    approvalReason?: string;
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
  /**
   * Deterministic fallback label captured from the first real user input.
   * Generated or explicit titles remain in `title`; display code should prefer
   * `title` once it is no longer the default placeholder.
   */
  firstUserMessagePreview?: string;
  createdAt: number;
  updatedAt: number;
  signals: SessionSignals;
  messages: ChatMessage[];
  agentState: AgentSessionState;
  currentModel: string;
  mode: ChatMode;
  stepCounter: number;
  activeStepId?: string;
  pendingPlan?: { task: string; planMessageId: string };
  queuedInputs?: ChatQueuedInput[];
  loop?: ChatSessionLoopState;
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
