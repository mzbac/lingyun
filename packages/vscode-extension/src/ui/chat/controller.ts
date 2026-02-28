import * as vscode from 'vscode';
import type { AgentLoop, AgentSessionState } from '../../core/agent';
import type { SnapshotPatch, WorkspaceSnapshot } from '../../core/snapshot';
import type { SessionStore } from '../../core/sessionStore';
import type { InputHistoryStore } from '../../core/inputHistoryStore';
import type { AgentCallbacks, LLMProvider, ToolDefinition, ToolCall } from '../../core/types';
import { createBlankSessionSignals, type SessionSignals } from '../../core/sessionSignals';
import type { ModelInfo } from '../../providers/copilot';
import type { ChatMessage, ChatMode, ChatSessionInfo, ChatUserInput, RevertBarState } from './types';
import { installApprovalsMethods } from './methods.approvals';
import { installInputHistoryMethods } from './methods.inputHistory';
import { installModeMethods } from './methods.mode';
import { installModelsMethods } from './methods.models';
import { installRevertMethods } from './methods.revert';
import { installRunnerCallbacksMethods } from './methods.runner.callbacks';
import { installRunnerInputMethods } from './methods.runner.input';
import { installRunnerPlanMethods } from './methods.runner.plan';
import { installSessionsMethods } from './methods.sessions';
import { installSkillsMethods } from './methods.skills';
import { installWebviewMethods } from './methods.webview';
import { RunCoordinator } from './runner/runCoordinator';

export type LLMProviderWithModels = LLMProvider & {
  getModels?: () => Promise<ModelInfo[]>;
  clearModelCache?: () => void;
};

export function installChatControllerMethods(controller: ChatController): void {
  installSessionsMethods(controller);
  installInputHistoryMethods(controller);
  installModeMethods(controller);
  installRevertMethods(controller);
  installSkillsMethods(controller);
  installWebviewMethods(controller);
  installRunnerInputMethods(controller);
  installRunnerCallbacksMethods(controller);
  installRunnerPlanMethods(controller);
  installModelsMethods(controller);
  installApprovalsMethods(controller);
  controller.runner = new RunCoordinator(controller);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ChatController {
  view?: vscode.WebviewView;
  viewDisposables: vscode.Disposable[] = [];
  messages: ChatMessage[] = [];
  signals: SessionSignals = createBlankSessionSignals();
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
  skillNamesForUiPromise?: Promise<string[]>;

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

  runner!: RunCoordinator;

  constructor(
    public context: vscode.ExtensionContext,
    public agent: AgentLoop,
    public llmProvider?: LLMProviderWithModels,
    public outputChannel?: vscode.OutputChannel
  ) {
    installChatControllerMethods(this);

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

// Method signatures (type-only) – implementations are installed from the method modules.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ChatController extends vscode.WebviewViewProvider {
  onAutoApproveEnabled(): void;

  setModeAndPersist(
    mode: ChatMode,
    options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
  ): Promise<void>;

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

  handleUserMessage(content: string | ChatUserInput): Promise<void>;
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

  postUnknownSkillWarnings(content: string, turnId?: string): Promise<void>;
  getSkillNamesForUI(): Promise<string[]>;

  postMessage(message: unknown): void;
  getHtml(webview: vscode.Webview): string;
}
