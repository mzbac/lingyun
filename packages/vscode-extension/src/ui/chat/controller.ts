import * as vscode from 'vscode';

import type { AgentLoop } from '../../core/agent';
import { resolveConfiguredModelId } from '../../core/modelSelection';
import type { InputHistoryStore } from '../../core/inputHistoryStore';
import type { SessionStore } from '../../core/sessionStore';
import { createBlankSessionSignals, type SessionSignals } from '../../core/sessionSignals';
import type { WorkspaceSnapshot } from '../../core/snapshot';
import type { ModelInfo } from '../../providers/copilot';
import type { LLMProviderWithUi } from '../../providers/providerUi';
import type { OfficeSync } from '../office/sync';

import { installChatControllerComposition } from './controllerComposition';
import type { ChatApprovalsService } from './methods.approvals';
import type { ChatInputHistoryService } from './methods.inputHistory';
import type { ChatLoopService } from './methods.loop';
import type { ChatModeService } from './methods.mode';
import type { ChatModelsService } from './methods.models';
import type { ChatRevertService } from './methods.revert';
import type { ChatRunnerCallbacksService } from './methods.runner.callbacks';
import type { ChatRunnerInputService } from './methods.runner.input';
import type { ChatRunnerPlanService } from './methods.runner.plan';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatSkillsService } from './methods.skills';
import type { ChatWebviewService } from './methods.webview';
import type { ChatMessage, ChatMode, ChatSessionInfo } from './types';
import type { ChatLoopManager } from './loopManager';
import type { ChatQueueManager } from './queueManager';
import type { RunCoordinator } from './runner/runCoordinator';

export type LLMProviderWithModels = LLMProviderWithUi & {
  getModels?: () => Promise<ModelInfo[]>;
  clearModelCache?: () => void;
};

export class ChatController {
  view?: vscode.WebviewView;
  viewDisposables: vscode.Disposable[] = [];
  messages: ChatMessage[] = [];
  signals: SessionSignals = createBlankSessionSignals();
  sessions: Map<string, ChatSessionInfo> = new Map();
  activeSessionId: string = crypto.randomUUID();
  officeSync?: OfficeSync;
  isProcessing = false;
  currentModel = 'gpt-4o';
  mode: ChatMode = 'build';
  availableModels: ModelInfo[] = [];
  autoApprovedTools: Set<string> = new Set();
  pendingApprovals: Map<string, { resolve: (approved: boolean) => void; toolName: string; stepId?: string }> =
    new Map();
  autoApproveThisRun = false;
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

  approvalsApi!: ChatApprovalsService;
  inputHistoryApi!: ChatInputHistoryService;
  loopApi!: ChatLoopService;
  modeApi!: ChatModeService;
  modelApi!: ChatModelsService;
  revertApi!: ChatRevertService;
  runnerCallbacksApi!: ChatRunnerCallbacksService;
  runnerInputApi!: ChatRunnerInputService;
  runnerPlanApi!: ChatRunnerPlanService;
  sessionApi!: ChatSessionsService;
  skillsApi!: ChatSkillsService;
  webviewApi!: ChatWebviewService;
  loopManager!: ChatLoopManager;
  queueManager!: ChatQueueManager;
  runner!: RunCoordinator;

  constructor(
    public context: vscode.ExtensionContext,
    public agent: AgentLoop,
    public llmProvider?: LLMProviderWithModels,
    public outputChannel?: vscode.OutputChannel
  ) {
    installChatControllerComposition(this);

    this.currentModel = resolveConfiguredModelId(this.llmProvider?.id);
    this.mode =
      (vscode.workspace.getConfiguration('lingyun').get<string>('mode') || 'build') === 'plan'
        ? 'plan'
        : 'build';
    this.autoApprovedTools = new Set(this.context.globalState.get<string[]>('autoApprovedTools') || []);

    this.sessionApi.initializeSessions();
    void this.sessionApi.ensureSessionsLoaded();
  }
}
