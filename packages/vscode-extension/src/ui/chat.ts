import * as vscode from 'vscode';
import type { AgentLoop, AgentSessionState } from '../core/agent';
import type { SnapshotPatch, WorkspaceSnapshot } from '../core/snapshot';
import type { SessionStore } from '../core/sessionStore';
import type { InputHistoryStore } from '../core/inputHistoryStore';
import type { AgentCallbacks, LLMProvider, ToolDefinition, ToolCall } from '../core/types';
import type { ModelInfo } from '../providers/copilot';
import type { ChatMessage, ChatMode, ChatSessionInfo, RevertBarState } from './chat/types';

type LLMProviderWithModels = LLMProvider & {
  getModels?: () => Promise<ModelInfo[]>;
  clearModelCache?: () => void;
};

// Intentionally uses declaration merging + runtime prototype patching (see the `require()` block at the end).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ChatViewProvider {
  public static readonly viewType = 'lingyun.chatView';

  view?: vscode.WebviewView;
  viewDisposables: vscode.Disposable[] = [];
  messages: ChatMessage[] = [];
  sessions: Map<string, ChatSessionInfo> = new Map();
  activeSessionId: string;
  isProcessing = false;
  currentModel: string;
  mode: ChatMode;
  availableModels: ModelInfo[] = [];
  autoApprovedTools: Set<string>;
  pendingApprovals: Map<
    string,
    { resolve: (approved: boolean) => void; toolName: string; stepId?: string }
  > = new Map();
  autoApproveThisRun = false;
  pendingPlan?: { task: string; planMessageId: string };
  activeStepId?: string;
  currentTurnId?: string;
  stepCounter = 0;
  abortRequested = false;
  webviewClientInstanceId?: string;
  initAcked = false;
  initInterval?: NodeJS.Timeout;
  initInFlight = false;
  webviewErrorShown = false;

  sessionStore?: SessionStore<ChatSessionInfo>;
  sessionsLoadedFromDisk = false;
  sessionsLoadPromise?: Promise<void>;
  sessionSaveTimer?: NodeJS.Timeout;
  dirtySessionIds: Set<string> = new Set();

  inputHistoryEntries: string[] = [];
  inputHistoryLoadedFromDisk = false;
  inputHistoryStore?: InputHistoryStore;

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
  > = new Map();

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
  > = new Map();

  constructor(
    public context: vscode.ExtensionContext,
    public agent: AgentLoop,
    public llmProvider?: LLMProviderWithModels,
    public outputChannel?: vscode.OutputChannel
  ) {
    this.currentModel = vscode.workspace.getConfiguration('lingyun').get('model') || 'gpt-4o';
    this.mode =
      (vscode.workspace.getConfiguration('lingyun').get<string>('mode') || 'build') === 'plan'
        ? 'plan'
        : 'build';
    this.autoApprovedTools = new Set(
      this.context.globalState.get<string[]>('autoApprovedTools') || []
    );

    this.activeSessionId = crypto.randomUUID();
    this.initializeSessions();
    void this.ensureSessionsLoaded();
  }
}

// Method signatures (type-only) – implementations are attached at runtime in the method modules.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ChatViewProvider extends vscode.WebviewViewProvider {
  onAutoApproveEnabled(): void;

  initializeSessions(): void;
  isSessionPersistenceEnabled(): boolean;
  getSessionPersistenceLimits(): { maxSessions: number; maxSessionBytes: number };
  getOrCreateSessionStore(): SessionStore<ChatSessionInfo> | undefined;
  pruneSessionForStorage(session: ChatSessionInfo, maxSessionBytes: number): ChatSessionInfo;
  markSessionDirty(sessionId: string): void;
  scheduleSessionSave(): void;
  pruneSessionsInMemory(maxSessions: number): void;
  flushSessionSave(): Promise<void>;
  normalizeLoadedSession(raw: ChatSessionInfo): ChatSessionInfo;
  normalizeLoadedAgentState(raw: unknown): AgentSessionState;
  recoverInterruptedSessions(): void;
  ensureSessionsLoaded(): Promise<void>;
  getBlankAgentState(): AgentSessionState;
  getActiveSession(): ChatSessionInfo;
  getSessionsForUI(): Array<{ id: string; title: string }>;
  postSessions(): void;
  createNewSession(): Promise<void>;
  switchToSession(sessionId: string): Promise<void>;
  switchToSessionSync(sessionId: string): void;

  setBackend(agent: AgentLoop, llmProvider?: LLMProviderWithModels): Promise<void>;
  clearCurrentSession(): Promise<void>;
  compactCurrentSession(): Promise<void>;
  onSessionPersistenceConfigChanged(): Promise<void>;
  clearSavedSessions(): Promise<void>;

  getOrCreateInputHistoryStore(): InputHistoryStore | undefined;
  ensureInputHistoryLoaded(): Promise<void>;
  recordInputHistory(content: string): void;
  postInputHistory(): void;

  getWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined>;
  getUndoRedoAvailability(): { canUndo: boolean; canRedo: boolean };
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
  getRevertBarStateForUI(): RevertBarState | null;
  postRevertBarState(): void;
  postApprovalState(): void;

  getRenderableMessages(): ChatMessage[];
  persistActiveSession(): void;

  sendMessage(content: string): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  redoAll(): Promise<void>;
  discardUndone(): Promise<void>;
  viewRevertDiff(): Promise<void>;
  commitRevertedConversationIfNeeded(): void;
  collectPatchesFromIndex(startIndex: number): SnapshotPatch[];
  deriveAgentStateBeforeUserMessage(params: {
    baseline: AgentSessionState;
    boundaryIndex: number;
  }): AgentSessionState;
  applyRevert(boundaryMessageId: string): Promise<void>;
  clearRevert(): Promise<void>;

  resolveWebviewView(webviewView: vscode.WebviewView): void;
  startInitPusher(): void;
  sendInit(force?: boolean): Promise<void>;

  handleUserMessage(content: string): Promise<void>;
  retryToolCall(approvalId: string): Promise<void>;
  isPlanFirstEnabled(): boolean;
  classifyPlanStatus(plan: string): 'draft' | 'needs_input';
  createPlanningCallbacks(planMsg: ChatMessage): AgentCallbacks;
  createAgentCallbacks(): AgentCallbacks;
  executePendingPlan(planMessageId?: string): Promise<void>;
  regeneratePendingPlan(planMessageId: string, reason?: string): Promise<void>;
  cancelPendingPlan(planMessageId: string): Promise<void>;
  revisePendingPlan(planMessageId: string, instructions: string): Promise<void>;

  loadModels(): Promise<void>;
  getFavoriteModelIds(): Promise<string[]>;
  getRecentModelIds(): Promise<string[]>;
  isModelFavorite(modelId: string): Promise<boolean>;
  getModelLabel(modelId: string): string;
  recordRecentModel(modelId: string): Promise<void>;
  pickModel(): Promise<void>;
  setCurrentModel(modelId: string): Promise<void>;
  toggleFavoriteModel(modelId: string): Promise<void>;
  postModelState(): Promise<void>;

  handleApprovalResponse(approvalId: string, approved: boolean): void;
  approveAllPendingApprovals(): void;
  rejectAllPendingApprovals(reason: string): void;
  requestInlineApproval(tc: ToolCall, def: ToolDefinition, parentMessageId?: string): Promise<boolean>;
  markActiveStepStatus(status: 'running' | 'done' | 'error' | 'canceled'): void;

  postMessage(message: unknown): void;
  getHtml(webview: vscode.Webview): string;
}

// NOTE: TS has no partial classes. We attach method bodies in focused modules and `require()`
// them after the class is defined (CommonJS), keeping `src/ui/chat.ts` small.
/* eslint-disable @typescript-eslint/no-require-imports */
require('./chat/methods.sessions');
require('./chat/methods.inputHistory');
require('./chat/methods.revert');
require('./chat/methods.webview');
require('./chat/methods.runner.input');
require('./chat/methods.runner.callbacks');
require('./chat/methods.runner.plan');
require('./chat/methods.models');
require('./chat/methods.approvals');
/* eslint-enable @typescript-eslint/no-require-imports */
