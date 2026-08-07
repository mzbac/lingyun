import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readTodos } from '../../core/todo';
import { toolRegistry } from '../../core/registry';
import { summarizeToolArgsForDebug } from '../../core/agent/debug';
import { getDebugRedactionLevel } from '../../core/debugSettings';
import { appendErrorLog, appendLog } from '../../core/logger';
import { getConfiguredReasoningEffort } from '../../core/reasoningEffort';
import { resolveConfiguredModelId } from '../../core/modelSelection';
import { isToolAllowedByFilter } from '../../core/toolFilter';
import { WorkspaceMemories } from '../../core/memories';
import { createSampleToolsConfig } from '../../providers/workspace';
import type { ModelInfo } from '../../providers/modelCatalog';

import type { LLMProviderWithUi, ProviderAuthUiState } from '../../providers/providerUi';
import { getNonce } from './utils';
import { getWorkspaceFolderUrisByPriority, resolveExistingFilePath } from './fileLinks';
import { buildApprovalStateForUI } from './approvalState';
import type { PendingApprovalEntry } from './controllerPorts';
import type {
  ChatComposerSubmissionState,
  ChatImageAttachment,
  ChatUserInput,
  ChatUserMessageOptions,
} from './types';
import { bindChatControllerService } from './controllerService';
import { createLingyunDiffUri } from './diffContentProvider';
import './webviewTestBuild'; // declares globalThis.LINGYUN_TEST_BUILD
import type { ChatRevertService } from './methods.revert';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatSkillsService } from './methods.skills';
import type { ChatQueueManager } from './queueManager';
import type { RunCoordinator } from './runner/runCoordinator';
import type { ChatController } from './controller';
import {
  getWebviewMessageType,
  parseWebviewErrorMessage,
  parseWebviewInitAckMessage,
  parseWebviewReadyMessage,
  parseWebviewTranscriptHistoryRequest,
  type WebviewTranscriptHistoryRequest,
  WEBVIEW_MESSAGE_ERROR,
  WEBVIEW_MESSAGE_INIT_ACK,
  WEBVIEW_MESSAGE_READY,
  WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE,
  WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
} from './webviewProtocol';
import { handleWebviewInitAckMessage, handleWebviewReadyMessage } from './webviewHandshake';
import { handleWebviewCrashMessage, resetWebviewCrashToastState } from './webviewCrash';
import { postInputNotice } from './inputNotice';
import {
  createEarlierTranscriptPage,
  createInitialTranscriptPage,
} from './transcriptPaging';

import {
  normalizeCandidatePath,
  CHAT_WEBVIEW_SCRIPT_PARTS,
  LlmProviderId,
  normalizeLlmProviderId,
  getConfiguredLlmProviderId,
  getPlanFirstEnabled,
  getAutoApproveEnabled,
  getShowThinkingEnabled,
  getMemoriesFeatureEnabled,
  getAllowExternalPathsEnabled,
  getBlockGitPushEnabled,
  getSkillsEnabled,
  SkillsBudget,
  SkillSearchPaths,
  normalizeSkillSearchPaths,
  getSkillSearchPaths,
  getSkillsBudget,
  skillsBudgetEqual,
  getSubagentModelOverride,
  normalizeSubagentModelOverride,
  getSessionsPersistEnabled,
  getSessionsMaxSessions,
  getSessionsMaxSessionBytes,
  SessionRetentionLimits,
  getSessionRetentionLimits,
  ToolRuntimeLimits,
  ToolFilter,
  InstructionPatterns,
  InstructionFileSettings,
  WorkspaceEnv,
  DebugSettingsUi,
  PluginSettings,
  OpenAICompatibleSettings,
  CodexSubscriptionSettings,
  ModelLimits,
  normalizeToolFilter,
  getToolFilter,
  stringListsEqual,
  hasListItemLongerThan,
  collectManualToolConfirmationReasons,
  ToolCatalogState,
  buildToolCatalogForUI,
  formatManualToolResultData,
  formatMemoryUpdateMessage,
  formatMemoryDropMessage,
  normalizeInstructionPatterns,
  getInstructionPatterns,
  getInstructionFileSettings,
  instructionFileSettingsEqual,
  normalizeWorkspaceEnv,
  getWorkspaceEnvValidationError,
  getWorkspaceEnv,
  workspaceEnvEqual,
  getDebugSettingsForUi,
  normalizeDebugSettings,
  debugSettingsEqual,
  normalizePluginSpecs,
  normalizePluginWorkspaceDir,
  getPluginSettings,
  pluginSettingsEqual,
  normalizeOpenAICompatibleText,
  normalizeOpenAICompatibleModelDisplayNames,
  getOpenAICompatibleModelDisplayNamesValidationError,
  getOpenAICompatibleSettings,
  openAICompatibleSettingsEqual,
  getCodexSubscriptionSettings,
  normalizeModelLimits,
  getModelLimitsValidationError,
  getModelLimits,
  modelLimitsEqual,
  getToolRuntimeLimits,
  toolRuntimeLimitsEqual,
  CompactionToolOutputMode,
  GenerationSettings,
  normalizeTextVerbosity,
  getGenerationSettings,
  generationSettingsEqual,
  getMemoryAutoRecallEnabled,
  getMemoryAutoRecallMaxResults,
  getMemoryAutoRecallMaxTokens,
  getMemoryAutoRecallMinScore,
  getMemoryAutoRecallMinScoreGap,
  getMemoryAutoRecallMaxAgeDays,
  MemoryAutoRecallBudget,
  getMemoryAutoRecallBudget,
  MemoryAutoRecallFilters,
  getMemoryAutoRecallFilters,
  MemoryAdvancedLimits,
  getMemoryAdvancedLimits,
  memoryAdvancedLimitsEqual,
  getExplorePrepassEnabled,
  getExplorePrepassMaxChars,
  getSubagentTaskMaxOutputChars,
  getAutoCompactionEnabled,
  getCompactionPruneEnabled,
  getCompactionPruneProtectTokens,
  getCompactionPruneMinimumTokens,
  CompactionPruneSettings,
  getCompactionPruneSettings,
  compactionPruneSettingsEqual,
  getCompactionToolOutputMode,
  normalizeCompactionToolOutputMode,
  parseWebviewImageAttachments,
  parseComposerSubmissionId,
  getToastErrorMessage,
  updateBooleanWebviewSetting,
} from './webviewSettings';


export interface ChatWebviewService {
  resolveWebviewView(webviewView: vscode.WebviewView): void;
  startInitPusher(): void;
  sendInit(force?: boolean): Promise<void>;
  loadEarlierTranscriptMessages(request: WebviewTranscriptHistoryRequest): void;
  refreshSettingsState(): Promise<void>;
  getProviderAuthStateForUI(): Promise<ProviderAuthUiState>;
  postProviderState(): Promise<void>;
  switchProvider(providerId: string): Promise<void>;
  setOpenAICompatibleSettings(settings: Partial<OpenAICompatibleSettings>): Promise<void>;
  setCodexSubscriptionSettings(settings: Partial<CodexSubscriptionSettings>): Promise<void>;
  setPlanFirst(enabled: boolean): Promise<void>;
  setAutoApprove(enabled: boolean): Promise<void>;
  setAllowExternalPaths(enabled: boolean): Promise<void>;
  setBlockGitPush(enabled: boolean): Promise<void>;
  setDebugSettings(settings: Partial<DebugSettingsUi>): Promise<void>;
  setPluginSettings(settings: Partial<PluginSettings>): Promise<void>;
  setToolRuntimeLimits(limits: Partial<ToolRuntimeLimits>): Promise<void>;
  setToolFilter(patterns: ToolFilter): Promise<void>;
  revokeAlwaysAllowedTool(toolId: string): Promise<void>;
  clearAlwaysAllowedTools(confirmed?: boolean): Promise<void>;
  setWorkspaceEnv(env: WorkspaceEnv): Promise<void>;
  setInstructionPatterns(patterns: InstructionPatterns): Promise<void>;
  setInstructionFileSettings(settings: Partial<InstructionFileSettings>): Promise<void>;
  setSkillsEnabled(enabled: boolean): Promise<void>;
  setSkillSearchPaths(paths: SkillSearchPaths): Promise<void>;
  setSkillsBudget(budget: Partial<SkillsBudget>): Promise<void>;
  setSessionsPersist(enabled: boolean): Promise<void>;
  setSessionRetentionLimits(limits: Partial<SessionRetentionLimits>): Promise<void>;
  setShowThinking(enabled: boolean): Promise<void>;
  setMemoriesFeatureEnabled(enabled: boolean): Promise<void>;
  setMemoryAutoRecall(enabled: boolean): Promise<void>;
  setMemoryAutoRecallBudget(budget: Partial<MemoryAutoRecallBudget>): Promise<void>;
  setMemoryAutoRecallFilters(filters: Partial<MemoryAutoRecallFilters>): Promise<void>;
  setMemoryAdvancedLimits(limits: Partial<MemoryAdvancedLimits>): Promise<void>;
  updateMemoriesNow(): Promise<void>;
  dropMemoriesNow(confirmed?: boolean): Promise<void>;
  showLogs(): void;
  postToolCatalog(): Promise<void>;
  listTools(): Promise<void>;
  runTool(toolId?: string, args?: Record<string, unknown>, confirmed?: boolean): Promise<void>;
  createToolsConfig(): Promise<void>;
  setExplorePrepass(enabled: boolean): Promise<void>;
  setExplorePrepassMaxChars(maxChars: number): Promise<void>;
  setSubagentModelOverride(model: string): Promise<void>;
  setSubagentTaskMaxOutputChars(maxChars: number): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  setCompactionPruneSettings(settings: Partial<CompactionPruneSettings>): Promise<void>;
  setCompactionToolOutputMode(mode: string): Promise<void>;
  setModelLimits(limits: ModelLimits): Promise<void>;
  setGenerationSettings(settings: Partial<GenerationSettings>): Promise<void>;
  authenticateProvider(): Promise<void>;
  disconnectProvider(): Promise<void>;
  postMessage(message: unknown): void;
  getHtml(webview: vscode.Webview): string;
  /**
   * Test-only bridge: evaluates a JS expression inside the chat webview DOM and
   * resolves with the (JSON-serializable) result. Only functional in
   * `ExtensionMode.Test`; the renderer ignores the request otherwise.
   */
  evaluateInWebview(expression: string): Promise<unknown>;
}

export interface ChatWebviewDeps {
  context: vscode.ExtensionContext;
  outputChannel?: vscode.OutputChannel;
  view?: vscode.WebviewView;
  viewDisposables: vscode.Disposable[];
  availableModels: ModelInfo[];
  currentModel: string;
  activeSessionId: string;
  inputHistoryEntries: string[];
  skillNamesForUiPromise?: Promise<string[]>;
  mode: 'build' | 'plan';
  isProcessing: boolean;
  autoApproveThisRun: boolean;
  pendingApprovals: Map<string, PendingApprovalEntry>;
  initAcked: boolean;
  initInterval?: NodeJS.Timeout;
  initInFlight: boolean;
  webviewClientInstanceId?: string;
  webviewCrashToastClientId?: string;
  pendingComposerAttachments: ChatImageAttachment[];
  composerSubmissionState?: ChatComposerSubmissionState;
  llmProvider?: Pick<
    LLMProviderWithUi,
    'id' | 'name' | 'getAuthStatus' | 'authenticate' | 'disconnect' | 'clearModelCache'
  >;
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
  abortCurrentRun(reason?: string): void;
  queueManager: Pick<ChatQueueManager, 'clearActiveSession' | 'flushAutosendForActiveSession' | 'getQueuedInputs' | 'postState'>;
  runner: Pick<RunCoordinator, 'steerQueuedInput'>;
  createNewSession(): Promise<void>;
  compactCurrentSession(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  redoAll(): Promise<void>;
  discardUndone(confirmed?: boolean): Promise<void>;
  viewRevertDiff(): Promise<void>;
  switchToSession(sessionId: string): Promise<void>;
  postSessions(): void;
  handleUserMessage(content: string | ChatUserInput, options?: ChatUserMessageOptions): Promise<void>;
  approveAllPendingApprovals(options?: { includeManual?: boolean }): void;
  postApprovalState(): void;
  handleAlwaysAllowApproval(approvalId: string): Promise<void>;
  getAutoApprovedToolsForUI(): string[];
  revokeAutoApprovedTool(toolId: string): Promise<void>;
  clearAutoApprovedToolsForUI(): Promise<void>;
  clearCurrentSession(): Promise<void>;
  clearSavedSessions(): Promise<void>;
  executePendingPlan(planMessageId?: string): Promise<void>;
  loadModels(): Promise<void>;
  postModelState(): Promise<void>;
  postModelPickerState(reveal?: boolean): Promise<void>;
  refreshModelsForUI(): Promise<void>;
  clearRecentModels(): Promise<void>;
  setCurrentModel(modelId: string): Promise<void>;
  setReasoningEffort(reasoningEffort: string): Promise<void>;
  openAdvancedModelSettings(): Promise<void>;
  toggleFavoriteModel(modelId: string): Promise<void>;
  getActiveSession(): ReturnType<ChatSessionsService['getActiveSession']>;
  setModeAndPersist(
    mode: 'build' | 'plan',
    options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
  ): Promise<void>;
  cancelPendingPlan(planMessageId: string): Promise<void>;
  revisePendingPlan(planMessageId: string, instructions: string): Promise<void>;
  handleApprovalResponse(approvalId: string, approved: boolean): void;
  retryToolCall(approvalId: string): Promise<void>;
  ensureSessionsLoaded(): Promise<void>;
  onSessionPersistenceConfigChanged(): Promise<void>;
  getModelLabel(modelId: string): string;
  getRenderableMessages(): ReturnType<ChatSessionsService['getRenderableMessages']>;
  getRevertBarStateForUI(): ReturnType<ChatRevertService['getRevertBarStateForUI']>;
  getContextForUI(): ReturnType<ChatSessionsService['getContextForUI']>;
  getSessionsForUI(): ReturnType<ChatSessionsService['getSessionsForUI']>;
  getSkillNamesForUI(): Promise<Awaited<ReturnType<ChatSkillsService['getSkillNamesForUI']>>>;
  getUndoRedoAvailability(): ReturnType<ChatRevertService['getUndoRedoAvailability']>;
  isModelFavorite(modelId: string): Promise<boolean>;
  postMessage(message: unknown): void;
}

type ChatWebviewRuntime = ChatWebviewDeps & ChatWebviewService;

type BrowserChatProtocol = {
  ready: typeof WEBVIEW_MESSAGE_READY;
  initAck: typeof WEBVIEW_MESSAGE_INIT_ACK;
  webviewError: typeof WEBVIEW_MESSAGE_ERROR;
  transcriptHistoryRequest: typeof WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST;
  transcriptHistoryPage: typeof WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE;
};

type MemoryActionStatus = {
  state: 'idle' | 'running' | 'success' | 'error';
  message: string;
};

const idleMemoryActionStatus: MemoryActionStatus = { state: 'idle', message: '' };

function postMemoryActionStatus(controller: Pick<ChatWebviewRuntime, 'postMessage'>, status: MemoryActionStatus): void {
  controller.postMessage({ type: 'memoryActionStatusState', memoryActionStatus: status });
}

type ChatWebviewSettingsStateMessage = {
  type: 'settingsState' | 'init';
  currentModel: string;
  currentModelLabel: string;
  currentModelIsFavorite: boolean;
  currentReasoningEffort: ReturnType<typeof getConfiguredReasoningEffort>;
  currentProviderId: LlmProviderId;
  providerAuth: ProviderAuthUiState;
  openAICompatibleSettings: OpenAICompatibleSettings;
  codexSubscriptionSettings: CodexSubscriptionSettings;
  planFirst: boolean;
  autoApprove: boolean;
  allowExternalPaths: boolean;
  blockGitPush: boolean;
  debugSettings: DebugSettingsUi;
  toolRuntimeLimits: ToolRuntimeLimits;
  toolFilter: ToolFilter;
  autoApprovedTools: string[];
  toolsCatalog?: ToolCatalogState;
  workspaceEnv: WorkspaceEnv;
  pluginSettings: PluginSettings;
  instructionPatterns: InstructionPatterns;
  instructionFileSettings: InstructionFileSettings;
  showThinking: boolean;
  memoriesFeatureEnabled: boolean;
  memoryAutoRecall: boolean;
  memoryAutoRecallMaxResults: number;
  memoryAutoRecallMaxTokens: number;
  memoryAutoRecallMinScore: number;
  memoryAutoRecallMinScoreGap: number;
  memoryAutoRecallMaxAgeDays: number;
  memoryAdvancedLimits: MemoryAdvancedLimits;
  memoryActionStatus: MemoryActionStatus;
  explorePrepass: boolean;
  explorePrepassMaxChars: number;
  subagentModelOverride: string;
  subagentTaskMaxOutputChars: number;
  autoCompaction: boolean;
  compactionPrune: boolean;
  compactionPruneProtectTokens: number;
  compactionPruneMinimumTokens: number;
  compactionToolOutputMode: CompactionToolOutputMode;
  modelLimits: ModelLimits;
  generationSettings: GenerationSettings;
  mode: 'build' | 'plan';
  skillsEnabled: boolean;
  skillSearchPaths: SkillSearchPaths;
  skillsBudget: SkillsBudget;
  sessionsPersist: boolean;
  sessionsMaxSessions: number;
  sessionsMaxSessionBytes: number;
  skills: Awaited<ReturnType<ChatSkillsService['getSkillNamesForUI']>>;
};

type ChatWebviewInitMessage = ChatWebviewSettingsStateMessage & {
  type: 'init';
  sessions: ReturnType<ChatSessionsService['getSessionsForUI']>;
  activeSessionId: string;
  messages: ReturnType<ChatSessionsService['getRenderableMessages']>;
  transcriptHistory: {
    mode: 'paged';
    hasEarlierMessages: boolean;
    cursor: string;
  };
  inputHistory: string[];
  revertState: ReturnType<ChatRevertService['getRevertBarStateForUI']>;
  context: ReturnType<ChatSessionsService['getContextForUI']>;
  todos: Awaited<ReturnType<typeof readTodos>>;
  planPending: boolean;
  activePlanMessageId: string;
  processing: boolean;
  queuedInputs: ReturnType<ChatQueueManager['getQueuedInputs']>;
  composerAttachments: ChatImageAttachment[];
  composerSubmissionState?: ChatComposerSubmissionState;
  pendingApprovals: number;
  manualApprovals: number;
  autoApproveThisRun: boolean;
} & ReturnType<ChatRevertService['getUndoRedoAvailability']>;

function createBrowserChatProtocol(): BrowserChatProtocol {
  return {
    ready: WEBVIEW_MESSAGE_READY,
    initAck: WEBVIEW_MESSAGE_INIT_ACK,
    webviewError: WEBVIEW_MESSAGE_ERROR,
    transcriptHistoryRequest: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
    transcriptHistoryPage: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE,
  };
}

function renderBrowserChatProtocolBootstrapScript(nonce: string): string {
  const protocolJson = JSON.stringify(createBrowserChatProtocol());
  return `<script nonce="${nonce}">window.LINGYUN_CHAT_PROTOCOL = Object.freeze(${protocolJson});</script>`;
}

/**
 * Test-only implementation of `evaluateInWebview`. Only ever referenced from
 * the `globalThis.LINGYUN_TEST_BUILD === true &&` attach below, so esbuild
 * removes it from the production bundle.
 */
function evaluateInWebviewTestImpl(runtime: ChatWebviewRuntime, expression: string): Promise<unknown> {
  const view = runtime.view;
  if (!view) {
    return Promise.reject(new Error('Chat webview is not open'));
  }

  const id = crypto.randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      getWebviewTestEvalEntries(runtime).delete(id);
      reject(new Error(`Timed out evaluating in chat webview: ${expression.slice(0, 120)}`));
    }, 15_000);

    getWebviewTestEvalEntries(runtime).set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      timer,
    });

    view.webview.postMessage({ type: '__testEval', id, expression });
  });
}

/**
 * Test-only webview DOM bridge used by the e2e suite. This code never ships in
 * the production bundle: it is injected by `getHtml()` only when the extension
 * host runs in `ExtensionMode.Test`, and the production build strips it (the
 * only reference is behind `globalThis.LINGYUN_TEST_BUILD === true`).
 *
 * The bridge is load-inert (it only sets a flag and registers a listener) and
 * posts results back via the bare `vscode` identifier: bootstrap.js declares
 * `let vscode` at the top level of a classic script, which lives in the shared
 * global lexical environment, so this inline script can reference it without
 * touching the production renderer bundle or re-acquiring the VS Code API
 * (which can only be acquired once per webview).
 */
function renderWebviewTestBridgeScript(nonce: string): string {
  const source = `
    (() => {
      window.__LINGYUN_TEST_MODE__ = true;
      window.addEventListener('message', (e) => {
        const data = e && e.data;
        if (!data || data.type !== '__testEval' || typeof data.id !== 'string' || typeof data.expression !== 'string') return;
        try {
          const result = new Function('"use strict"; return (' + data.expression + ');')();
          vscode.postMessage({ type: '__testEvalResult', id: data.id, ok: true, value: result });
        } catch (evalErr) {
          vscode.postMessage({ type: '__testEvalResult', id: data.id, ok: false, error: String(evalErr && evalErr.message ? evalErr.message : evalErr) });
        }
      });
    })();`;
  return `<script nonce="${nonce}">${source}</script>`;
}

async function buildWebviewSettingsStateMessage(
  runtime: ChatWebviewRuntime,
  params?: {
    type?: 'settingsState' | 'init';
    modelLabel?: string;
    currentModelIsFavorite?: boolean;
    deferOptional?: boolean;
  }
): Promise<ChatWebviewSettingsStateMessage> {
  const nextModel = resolveConfiguredModelId(runtime.llmProvider?.id) || runtime.currentModel;
  runtime.currentModel = nextModel;
  const deferOptional = params?.deferOptional === true;
  const currentModelIsFavoritePromise = typeof params?.currentModelIsFavorite === 'boolean'
    ? Promise.resolve(params.currentModelIsFavorite)
    : runtime.isModelFavorite(runtime.currentModel);
  let skills: string[];
  let providerAuth: ProviderAuthUiState;
  let currentModelIsFavorite: boolean;
  if (deferOptional) {
    skills = [];
    providerAuth = {
      providerId: typeof runtime.llmProvider?.id === 'string' ? runtime.llmProvider.id : '',
      providerName: typeof runtime.llmProvider?.name === 'string' ? runtime.llmProvider.name : '',
      supported: false,
      authenticated: false,
      status: 'hidden',
      label: '',
    };
    currentModelIsFavorite = await currentModelIsFavoritePromise;
  } else {
    [skills, providerAuth, currentModelIsFavorite] = await Promise.all([
      runtime.getSkillNamesForUI(),
      runtime.getProviderAuthStateForUI(),
      currentModelIsFavoritePromise,
    ]);
  }
  const modelLabel = params?.modelLabel || runtime.getModelLabel(runtime.currentModel) || runtime.currentModel;

  return {
    type: params?.type ?? 'settingsState',
    currentModel: runtime.currentModel,
    currentModelLabel: modelLabel,
    currentModelIsFavorite,
    currentReasoningEffort: getConfiguredReasoningEffort(),
    currentProviderId: getConfiguredLlmProviderId(),
    providerAuth,
    openAICompatibleSettings: getOpenAICompatibleSettings(),
    codexSubscriptionSettings: getCodexSubscriptionSettings(),
    planFirst: getPlanFirstEnabled(),
    autoApprove: getAutoApproveEnabled(),
    allowExternalPaths: getAllowExternalPathsEnabled(),
    blockGitPush: getBlockGitPushEnabled(),
    debugSettings: getDebugSettingsForUi(),
    toolRuntimeLimits: getToolRuntimeLimits(),
    toolFilter: getToolFilter(),
    autoApprovedTools: runtime.getAutoApprovedToolsForUI(),
    workspaceEnv: getWorkspaceEnv(),
    pluginSettings: getPluginSettings(),
    instructionPatterns: getInstructionPatterns(),
    instructionFileSettings: getInstructionFileSettings(),
    showThinking: getShowThinkingEnabled(),
    memoriesFeatureEnabled: getMemoriesFeatureEnabled(),
    memoryAutoRecall: getMemoryAutoRecallEnabled(),
    memoryAutoRecallMaxResults: getMemoryAutoRecallMaxResults(),
    memoryAutoRecallMaxTokens: getMemoryAutoRecallMaxTokens(),
    memoryAutoRecallMinScore: getMemoryAutoRecallMinScore(),
    memoryAutoRecallMinScoreGap: getMemoryAutoRecallMinScoreGap(),
    memoryAutoRecallMaxAgeDays: getMemoryAutoRecallMaxAgeDays(),
    memoryAdvancedLimits: getMemoryAdvancedLimits(),
    memoryActionStatus: idleMemoryActionStatus,
    explorePrepass: getExplorePrepassEnabled(),
    explorePrepassMaxChars: getExplorePrepassMaxChars(),
    subagentModelOverride: getSubagentModelOverride(),
    subagentTaskMaxOutputChars: getSubagentTaskMaxOutputChars(),
    autoCompaction: getAutoCompactionEnabled(),
    compactionPrune: getCompactionPruneEnabled(),
    compactionPruneProtectTokens: getCompactionPruneProtectTokens(),
    compactionPruneMinimumTokens: getCompactionPruneMinimumTokens(),
    compactionToolOutputMode: getCompactionToolOutputMode(),
    modelLimits: getModelLimits(),
    generationSettings: getGenerationSettings(),
    mode: runtime.mode,
    skillsEnabled: getSkillsEnabled(),
    skillSearchPaths: getSkillSearchPaths(),
    skillsBudget: getSkillsBudget(),
    sessionsPersist: getSessionsPersistEnabled(),
    sessionsMaxSessions: getSessionsMaxSessions(),
    sessionsMaxSessionBytes: getSessionsMaxSessionBytes(),
    skills,
  };
}

async function buildWebviewInitMessage(
  runtime: ChatWebviewRuntime,
  params: { modelLabel: string; currentModelIsFavorite: boolean }
): Promise<ChatWebviewInitMessage> {
  const pendingPlan = runtime.getActiveSession().pendingPlan;
  const approvalState = buildApprovalStateForUI({
    pendingApprovals: runtime.pendingApprovals,
    autoApproveThisRun: runtime.autoApproveThisRun,
  });
  const settingsState = await buildWebviewSettingsStateMessage(runtime, {
    type: 'init',
    modelLabel: params.modelLabel,
    currentModelIsFavorite: params.currentModelIsFavorite,
    deferOptional: true,
  });
  const transcriptPage = createInitialTranscriptPage(runtime.getRenderableMessages());

  return {
    ...settingsState,
    type: 'init',
    sessions: runtime.getSessionsForUI(),
    activeSessionId: runtime.activeSessionId,
    messages: transcriptPage.messages,
    transcriptHistory: {
      mode: 'paged',
      hasEarlierMessages: transcriptPage.hasEarlierMessages,
      cursor: transcriptPage.cursor ?? '',
    },
    inputHistory: runtime.inputHistoryEntries,
    revertState: runtime.getRevertBarStateForUI(),
    context: runtime.getContextForUI(),
    todos: [],
    planPending: !!pendingPlan,
    activePlanMessageId: pendingPlan?.planMessageId ?? '',
    processing: runtime.isProcessing,
    queuedInputs: runtime.queueManager.getQueuedInputs(),
    composerAttachments: runtime.pendingComposerAttachments,
    ...(runtime.composerSubmissionState
      ? { composerSubmissionState: runtime.composerSubmissionState }
      : {}),
    pendingApprovals: approvalState.count,
    manualApprovals: approvalState.manualCount,
    autoApproveThisRun: approvalState.autoApproveThisRun,
    ...runtime.getUndoRedoAvailability(),
  };
}

type DeferredWebviewTask = {
  view: vscode.WebviewView;
  provider: ChatWebviewRuntime['llmProvider'];
  promise: Promise<void>;
};

type DeferredTodoTask = {
  view: vscode.WebviewView;
  sessionId: string;
  promise: Promise<void>;
};

const deferredWebviewTasks = new WeakMap<ChatWebviewRuntime, DeferredWebviewTask>();
const deferredTodoTasks = new WeakMap<ChatWebviewRuntime, DeferredTodoTask>();

type WebviewTestEvalEntry = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

const webviewTestEvalEntries = new WeakMap<ChatWebviewRuntime, Map<string, WebviewTestEvalEntry>>();

function getWebviewTestEvalEntries(runtime: ChatWebviewRuntime): Map<string, WebviewTestEvalEntry> {
  let entries = webviewTestEvalEntries.get(runtime);
  if (!entries) {
    entries = new Map<string, WebviewTestEvalEntry>();
    webviewTestEvalEntries.set(runtime, entries);
  }
  return entries;
}

function rejectPendingWebviewTestEvals(runtime: ChatWebviewRuntime, reason: string): void {
  const entries = webviewTestEvalEntries.get(runtime);
  if (!entries) return;
  for (const entry of entries.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  entries.clear();
}

/**
 * Test-only handler for renderer `__testEvalResult` messages. Referenced only
 * from the `globalThis.LINGYUN_TEST_BUILD === true &&` guard in the message
 * switch, so esbuild removes it from the production bundle.
 */
function handleWebviewTestEvalResult(runtime: ChatWebviewRuntime, data: unknown): void {
  const payload = data as Record<string, unknown>;
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return;
  const entry = getWebviewTestEvalEntries(runtime).get(id);
  if (!entry) return;
  getWebviewTestEvalEntries(runtime).delete(id);
  clearTimeout(entry.timer);
  if (payload.ok) {
    entry.resolve(payload.value);
  } else {
    entry.reject(new Error(typeof payload.error === 'string' ? payload.error : 'Webview test eval failed'));
  }
}

function logDeferredWebviewTaskFailure(
  runtime: ChatWebviewRuntime,
  label: string,
  error: unknown
): void {
  appendErrorLog(runtime.outputChannel, `Failed to refresh deferred chat ${label}`, error, {
    tag: 'Webview',
  });
}

async function refreshDeferredWebviewState(
  runtime: ChatWebviewRuntime,
  view: vscode.WebviewView
): Promise<void> {
  const provider = runtime.llmProvider;
  const tasks: Array<{ label: string; promise: Promise<void> }> = [];

  if (runtime.availableModels.length === 0) {
    tasks.push({
      label: 'models',
      promise: runtime.loadModels(),
    });
  }

  tasks.push({
    label: 'provider state',
    promise: runtime.getProviderAuthStateForUI().then((providerAuth) => {
      if (runtime.view !== view || runtime.llmProvider !== provider) return;
      runtime.postMessage({
        type: 'providerState',
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth,
      });
    }),
  });

  tasks.push({
    label: 'skills',
    promise: runtime.getSkillNamesForUI().then((skills) => {
      if (runtime.view !== view) return;
      runtime.postMessage({
        type: 'skillsEnabledState',
        skillsEnabled: getSkillsEnabled(),
        skills,
      });
    }),
  });

  const results = await Promise.allSettled(tasks.map((task) => task.promise));
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === 'rejected') {
      logDeferredWebviewTaskFailure(runtime, tasks[index].label, result.reason);
    }
  }
}

function scheduleDeferredWebviewState(runtime: ChatWebviewRuntime): void {
  const view = runtime.view;
  if (!view) return;

  const provider = runtime.llmProvider;
  const current = deferredWebviewTasks.get(runtime);
  if (current?.view === view && current.provider === provider) return;

  const promise = refreshDeferredWebviewState(runtime, view).catch((error) => {
    logDeferredWebviewTaskFailure(runtime, 'state', error);
  });
  const task = { view, provider, promise };
  deferredWebviewTasks.set(runtime, task);
}

function scheduleDeferredTodos(runtime: ChatWebviewRuntime): void {
  const view = runtime.view;
  if (!view) return;

  const sessionId = runtime.activeSessionId;
  const current = deferredTodoTasks.get(runtime);
  if (current?.view === view && current.sessionId === sessionId) return;

  const promise = readTodos(runtime.context, sessionId)
    .then((todos) => {
      if (runtime.view !== view || runtime.activeSessionId !== sessionId) return;
      runtime.postMessage({ type: 'todos', todos });
    })
    .catch((error) => {
      logDeferredWebviewTaskFailure(runtime, 'TODO state', error);
    });
  const task = { view, sessionId, promise };
  deferredTodoTasks.set(runtime, task);
}

export function createChatWebviewService(controller: ChatWebviewDeps): ChatWebviewService {
  const runtime = controller as ChatWebviewRuntime;
  const service = bindChatControllerService(runtime, {
  resolveWebviewView(this: ChatWebviewRuntime, webviewView: vscode.WebviewView): void {
    for (const d of this.viewDisposables) {
      d.dispose();
    }
    this.viewDisposables = [];

    this.view = webviewView;
    this.initAcked = false;
    this.webviewClientInstanceId = undefined;
    resetWebviewCrashToastState(this);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    this.viewDisposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (!this.view) return;

        if (webviewView.visible) {
          if (!this.initAcked) {
            this.startInitPusher();
          }
          return;
        }

        // Stop pushing init while hidden.
        if (this.initInterval) {
          clearInterval(this.initInterval);
          this.initInterval = undefined;
        }
      })
    );

    this.viewDisposables.push(
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.initAcked = false;
        this.webviewClientInstanceId = undefined;
        resetWebviewCrashToastState(this);
        globalThis.LINGYUN_TEST_BUILD === true &&
          rejectPendingWebviewTestEvals(this, 'Chat webview was disposed before the test eval completed');
        if (this.initInterval) {
          clearInterval(this.initInterval);
          this.initInterval = undefined;
        }
      })
    );

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (data) => {
        const messageType = getWebviewMessageType(data);
        try {
        // Test-only DOM bridge response from the renderer. The production build
        // folds the guard to false and removes the whole branch (including the
        // `__testEvalResult` string) via minify.
        if (globalThis.LINGYUN_TEST_BUILD === true && messageType === '__testEvalResult') {
          handleWebviewTestEvalResult(this, data);
          return;
        }
        switch (messageType) {
          case 'newSession':
            try {
              await this.createNewSession();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'newSession', pending: false });
            }
            break;
          case 'openLocation': {
            const workspaceFolderUris = getWorkspaceFolderUrisByPriority();
            const payload = data as Record<string, unknown>;
            const filePathRaw = typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
            const lineRaw =
              typeof payload.line === 'number'
                ? payload.line
                : typeof payload.line === 'string'
                  ? Number(payload.line)
                  : NaN;
            const characterRaw =
              typeof payload.character === 'number'
                ? payload.character
                : typeof payload.character === 'string'
                  ? Number(payload.character)
                  : NaN;
            const line = Number.isFinite(lineRaw) ? Math.max(1, Math.floor(lineRaw)) : undefined;
            const character = Number.isFinite(characterRaw) ? Math.max(1, Math.floor(characterRaw)) : 1;
            if (!filePathRaw || !line) break;

            const allowExternalPaths = getAllowExternalPathsEnabled();

            try {
              const normalized = normalizeCandidatePath(filePathRaw);
              if (!normalized) break;
              const candidates: string[] = [];
              if ((normalized.startsWith('a/') || normalized.startsWith('b/')) && normalized.length > 2) {
                candidates.push(normalized.slice(2));
              }
              candidates.push(normalized);

              let resolved:
                | { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }
                | undefined;
              let blockedExternalMessage: string | undefined;

              for (const candidate of candidates) {
                const attempt = await resolveExistingFilePath(candidate, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                  break;
                }
                if (attempt.blockedMessage) blockedExternalMessage = attempt.blockedMessage;
              }

              if (!resolved) {
                if (blockedExternalMessage) {
                  postInputNotice(this, blockedExternalMessage);
                } else {
                  postInputNotice(this, 'File not found.');
                }
                break;
              }

              const doc = await vscode.workspace.openTextDocument(resolved.uri);
              const editor = await vscode.window.showTextDocument(doc, { preview: false });
              const pos = new vscode.Position(line - 1, character - 1);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            } catch (error) {
              appendErrorLog(this.outputChannel, 'Failed to open linked location from webview', error, { tag: 'Webview' });
              postInputNotice(this, 'Failed to open file location. See logs for details.');
            }
            break;
          }
          case 'resolveFileLinks': {
            const workspaceFolderUris = getWorkspaceFolderUrisByPriority();
            const payload = data as Record<string, unknown>;
            const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
            const candidatesRaw = Array.isArray(payload.candidates) ? payload.candidates : [];
            if (!requestId) break;
            if (workspaceFolderUris.length === 0) {
              this.postMessage({ type: 'resolvedFileLinks', requestId, results: [] });
              break;
            }

            const allowExternalPaths = getAllowExternalPathsEnabled();

            const results: Array<{ raw: string; ok: boolean; path?: string }> = [];
            const seen = new Set<string>();
            let uniqueCount = 0;
            for (const item of candidatesRaw) {
              const raw =
                item && typeof item === 'object' && typeof (item as any).raw === 'string'
                  ? String((item as any).raw).trim()
                  : '';
              if (!raw) continue;
              if (seen.has(raw)) continue;
              if (uniqueCount >= 200) break;
              seen.add(raw);
              uniqueCount++;

              const normalized = normalizeCandidatePath(raw);
              if (!normalized) {
                results.push({ raw, ok: false });
                continue;
              }
              let resolved:
                | { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }
                | undefined;

              if ((normalized.startsWith('a/') || normalized.startsWith('b/')) && normalized.length > 2) {
                const stripped = normalized.slice(2);
                const attempt = await resolveExistingFilePath(stripped, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                }
              }

              if (!resolved) {
                const attempt = await resolveExistingFilePath(normalized, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                }
              }

              if (!resolved) {
                results.push({ raw, ok: false });
                continue;
              }

              // Use absolute paths to avoid ambiguity in multi-root workspaces.
              results.push({ raw, ok: true, path: resolved.absPath });
            }

            this.postMessage({ type: 'resolvedFileLinks', requestId, results });
            break;
          }
          case 'openNativeDiff': {
            const payload = data as Record<string, unknown>;
            const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId.trim() : '';
            if (!toolCallId) break;

            const snapshot = this.toolDiffSnapshotsByToolCallId.get(toolCallId);
            if (!snapshot) {
              postInputNotice(this, 'Diff snapshot is unavailable (try rerunning the tool).');
              break;
            }

            const allowExternalPaths = getAllowExternalPathsEnabled();
            if (!allowExternalPaths && snapshot.isExternal) {
              postInputNotice(this, 'External paths are disabled. Enable Allow external paths in chat settings to view this diff.');
              break;
            }

            const fileName = path.basename(snapshot.absPath || snapshot.displayPath || 'file');
            const left = createLingyunDiffUri({ toolCallId, side: 'before', fileName });
            const right = createLingyunDiffUri({ toolCallId, side: 'after', fileName });
            const title = `LingYun Diff: ${snapshot.displayPath || fileName}`;

            try {
              await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
            } catch {
              postInputNotice(this, 'Failed to open diff editor.');
            }

            break;
          }
          case 'compactSession':
            try {
              await this.compactCurrentSession();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'compactSession', pending: false });
            }
            break;
          case 'undo':
            try {
              await this.undo();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'undo', pending: false });
            }
            break;
          case 'redo':
            try {
              await this.redo();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'redo', pending: false });
            }
            break;
          case 'redoAll':
            try {
              await this.redoAll();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'redoAll', pending: false });
            }
            break;
          case 'discardUndone':
            try {
              await this.discardUndone(data.confirmed === true);
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'discardUndone', pending: false });
            }
            break;
          case 'viewRevertDiff':
            try {
              await this.viewRevertDiff();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'viewRevertDiff', pending: false });
            }
            break;
          case 'switchSession':
            if (typeof data.sessionId === 'string') {
              await this.switchToSession(data.sessionId);
            } else {
              this.postSessions();
            }
            break;
          case 'clearCurrentSession': {
            try {
              if (this.isProcessing) {
                postInputNotice(this, 'Stop the current task before clearing the session.');
                break;
              }
              if (data.confirmed !== true) break;
              this.toolDiffBeforeByToolCallId.clear();
              this.toolDiffSnapshotsByToolCallId.clear();
              await this.clearCurrentSession();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'clearCurrentSession', pending: false });
            }
            break;
          }
          case 'clearSavedSessions': {
            try {
              if (this.isProcessing) {
                postInputNotice(this, 'Stop the current task before clearing saved sessions.');
                break;
              }
              if (data.confirmed !== true) break;
              await this.clearSavedSessions();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'clearSavedSessions', pending: false });
            }
            break;
          }
          case 'send':
            {
              const payload = data as Record<string, unknown>;
              const submissionId = parseComposerSubmissionId(payload.submissionId);
              if (!submissionId) {
                postInputNotice(this, 'Message could not be accepted. Your draft was kept.');
                break;
              }
              const attachments = parseWebviewImageAttachments(payload.attachments);
              const message = typeof payload.message === 'string' ? payload.message : '';
              const draft = typeof payload.draft === 'string' ? payload.draft : message;
              this.pendingComposerAttachments = attachments;
              this.composerSubmissionState = {
                id: submissionId,
                status: 'pending',
                draft,
              };
              this.postMessage({
                type: 'sendState',
                submissionId,
                status: 'pending',
                draft,
              });

              let accepted = false;
              const onAccepted = () => {
                if (accepted) return;
                accepted = true;
                if (this.composerSubmissionState?.id === submissionId) {
                  this.pendingComposerAttachments = [];
                  this.composerSubmissionState = {
                    id: submissionId,
                    status: 'accepted',
                    draft,
                  };
                }
                this.postMessage({
                  type: 'sendState',
                  submissionId,
                  status: 'accepted',
                  draft,
                });
              };
              const input: ChatUserInput = {
                message,
                attachments,
              };
              try {
                await this.handleUserMessage(input, { onAccepted });
              } catch (error) {
                if (accepted) throw error;
                appendErrorLog(this.outputChannel, 'Failed to accept composer submission', error, {
                  tag: 'Webview',
                });
              }

              if (!accepted) {
                if (this.composerSubmissionState?.id === submissionId) {
                  this.composerSubmissionState = {
                    id: submissionId,
                    status: 'rejected',
                    draft,
                  };
                }
                this.postMessage({
                  type: 'sendState',
                  submissionId,
                  status: 'rejected',
                  draft,
                  message: 'Message was not accepted. Your draft was restored.',
                });
              }
            }
            break;
          case 'composerSubmissionSettled': {
            const payload = data as Record<string, unknown>;
            const submissionId = parseComposerSubmissionId(payload.submissionId);
            if (
              submissionId &&
              this.composerSubmissionState?.id === submissionId &&
              this.composerSubmissionState.status !== 'pending'
            ) {
              this.composerSubmissionState = undefined;
            }
            break;
          }
          case 'composerAttachmentsState': {
            const payload = data as Record<string, unknown>;
            this.pendingComposerAttachments = parseWebviewImageAttachments(payload.attachments);
            break;
          }
          case 'clearQueue': {
            try {
              this.queueManager.clearActiveSession({ notify: false });
              this.queueManager.flushAutosendForActiveSession().catch(() => {});
            } finally {
              this.queueManager.postState();
            }
            break;
          }
          case 'steerQueuedInput': {
            const id = typeof (data as any).id === 'string' ? String((data as any).id) : '';
            let queueStateAlreadyPosted = false;
            try {
              if (id) {
                queueStateAlreadyPosted = await this.runner.steerQueuedInput(id);
              }
            } finally {
              if (!queueStateAlreadyPosted) {
                this.queueManager.postState();
              }
            }
            break;
          }
          case 'abort':
            this.abortCurrentRun();
            break;
          case 'approveAll':
            this.approveAllPendingApprovals({ includeManual: false });
            break;
          case 'clear': {
            this.toolDiffBeforeByToolCallId.clear();
            this.toolDiffSnapshotsByToolCallId.clear();
            await this.clearCurrentSession();
            break;
          }
          case WEBVIEW_MESSAGE_READY:
            handleWebviewReadyMessage(this, parseWebviewReadyMessage(data));
            break;
          case WEBVIEW_MESSAGE_INIT_ACK:
            if (!handleWebviewInitAckMessage(this, parseWebviewInitAckMessage(data))) {
              return;
            }
            break;
          case WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST: {
            const request = parseWebviewTranscriptHistoryRequest(data);
            if (request) {
              service.loadEarlierTranscriptMessages(request);
            }
            break;
          }
          case 'refreshSettingsState':
            await service.refreshSettingsState();
            break;
          case 'showModelPicker':
            await this.postModelPickerState(true);
            break;
          case 'refreshModels':
            await this.refreshModelsForUI();
            break;
          case 'clearRecentModels':
            await this.clearRecentModels();
            break;
          case 'authenticateProvider':
            await service.authenticateProvider();
            break;
          case 'disconnectProvider':
            await service.disconnectProvider();
            break;
          case 'switchProvider':
            if (typeof data.providerId === 'string') {
              await service.switchProvider(data.providerId);
            } else {
              await service.postProviderState();
            }
            break;
          case 'setOpenAICompatibleSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setOpenAICompatibleSettings(data.settings as Partial<OpenAICompatibleSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setCodexSubscriptionSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setCodexSubscriptionSettings(data.settings as Partial<CodexSubscriptionSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setPlanFirst':
            if (typeof data.enabled === 'boolean') {
              await service.setPlanFirst(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setAutoApprove':
            if (typeof data.enabled === 'boolean') {
              await service.setAutoApprove(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setAllowExternalPaths':
            if (typeof data.enabled === 'boolean') {
              await service.setAllowExternalPaths(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setBlockGitPush':
            if (typeof data.enabled === 'boolean') {
              await service.setBlockGitPush(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setDebugSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setDebugSettings(data.settings as Partial<DebugSettingsUi>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setPluginSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setPluginSettings(data.settings as Partial<PluginSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setToolRuntimeLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setToolRuntimeLimits(data.limits as Partial<ToolRuntimeLimits>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setToolFilter':
            if (Array.isArray(data.patterns) || typeof data.patterns === 'string') {
              await service.setToolFilter(normalizeToolFilter(data.patterns));
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'revokeAutoApprovedTool':
            if (typeof data.toolId === 'string') {
              await service.revokeAlwaysAllowedTool(data.toolId);
            } else {
              this.postMessage({ type: 'autoApprovedToolsState', autoApprovedTools: this.getAutoApprovedToolsForUI() });
            }
            break;
          case 'clearAutoApprovedTools':
            await service.clearAlwaysAllowedTools(data.confirmed === true);
            break;
          case 'setWorkspaceEnv':
            if (data.env && typeof data.env === 'object') {
              await service.setWorkspaceEnv(data.env as WorkspaceEnv);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setInstructionPatterns':
            if (Array.isArray(data.patterns) || typeof data.patterns === 'string') {
              await service.setInstructionPatterns(normalizeInstructionPatterns(data.patterns));
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setInstructionFileSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setInstructionFileSettings(data.settings as Partial<InstructionFileSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSkillsEnabled':
            if (typeof data.enabled === 'boolean') {
              await service.setSkillsEnabled(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSkillSearchPaths':
            if (Array.isArray(data.paths) || typeof data.paths === 'string') {
              await service.setSkillSearchPaths(normalizeSkillSearchPaths(data.paths));
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSkillsBudget':
            if (data.budget && typeof data.budget === 'object') {
              await service.setSkillsBudget(data.budget as Partial<SkillsBudget>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSessionsPersist':
            if (typeof data.enabled === 'boolean') {
              await service.setSessionsPersist(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSessionRetentionLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setSessionRetentionLimits(data.limits as Partial<SessionRetentionLimits>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setShowThinking':
            if (typeof data.enabled === 'boolean') {
              await service.setShowThinking(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoriesFeatureEnabled':
            if (typeof data.enabled === 'boolean') {
              await service.setMemoriesFeatureEnabled(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAutoRecall':
            if (typeof data.enabled === 'boolean') {
              await service.setMemoryAutoRecall(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAutoRecallBudget':
            if (data.budget && typeof data.budget === 'object') {
              await service.setMemoryAutoRecallBudget(data.budget as Partial<MemoryAutoRecallBudget>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAutoRecallFilters':
            if (data.filters && typeof data.filters === 'object') {
              await service.setMemoryAutoRecallFilters(data.filters as Partial<MemoryAutoRecallFilters>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAdvancedLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setMemoryAdvancedLimits(data.limits as Partial<MemoryAdvancedLimits>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'updateMemories':
            await service.updateMemoriesNow();
            break;
          case 'dropMemories':
            await service.dropMemoriesNow(data.confirmed === true);
            break;
          case 'showLogs':
            try {
              service.showLogs();
            } finally {
              this.postMessage({ type: 'logsActionState', pending: false });
            }
            break;
          case 'listTools':
            await service.listTools();
            break;
          case 'runTool':
            await service.runTool(
              typeof data.toolId === 'string' ? data.toolId : undefined,
              data.args && typeof data.args === 'object' ? data.args as Record<string, unknown> : undefined,
              data.confirmed === true
            );
            break;
          case 'createToolsConfig':
            await service.createToolsConfig();
            break;
          case 'setExplorePrepass':
            if (typeof data.enabled === 'boolean') {
              await service.setExplorePrepass(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setExplorePrepassMaxChars':
            if (typeof data.maxChars === 'number') {
              await service.setExplorePrepassMaxChars(data.maxChars);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSubagentModelOverride':
            if (typeof data.model === 'string') {
              await service.setSubagentModelOverride(data.model);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSubagentTaskMaxOutputChars':
            if (typeof data.maxChars === 'number') {
              await service.setSubagentTaskMaxOutputChars(data.maxChars);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setAutoCompaction':
            if (typeof data.enabled === 'boolean') {
              await service.setAutoCompaction(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setCompactionPruneSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setCompactionPruneSettings(data.settings as Partial<CompactionPruneSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setCompactionToolOutputMode':
            if (typeof data.mode === 'string') {
              await service.setCompactionToolOutputMode(data.mode);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setModelLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setModelLimits(data.limits as ModelLimits);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setGenerationSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setGenerationSettings(data.settings as Partial<GenerationSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'changeModel':
            if (typeof data.model === 'string') {
              await this.setCurrentModel(data.model);
            } else {
              await this.postModelState();
              await this.postModelPickerState(false);
            }
            break;
          case 'setReasoningEffort':
            if (typeof data.reasoningEffort === 'string') {
              await this.setReasoningEffort(data.reasoningEffort);
            } else {
              await this.postModelState();
            }
            break;
          case 'openAdvancedModelSettings':
            try {
              await this.openAdvancedModelSettings();
            } finally {
              this.postMessage({ type: 'advancedModelSettingsState', pending: false });
            }
            break;
          case 'toggleFavoriteModel': {
            const modelId =
              typeof data.model === 'string' && data.model.trim()
                ? data.model.trim()
                : this.currentModel;
            if (modelId) {
              await this.toggleFavoriteModel(modelId);
            } else {
              await this.postModelState();
              await this.postModelPickerState(false);
            }
            break;
          }
          case 'changeMode': {
            const postCurrentMode = () => this.postMessage({ type: 'modeChanged', mode: this.mode });
            if (this.isProcessing) {
              postInputNotice(this, 'Stop the current task before switching modes.');
              postCurrentMode();
              break;
            }
            if (data.mode !== 'plan' && data.mode !== 'build') {
              postCurrentMode();
              break;
            }
            if (data.mode === 'build') {
              const pendingPlan = this.getActiveSession().pendingPlan;
              if (pendingPlan) {
                postCurrentMode();
                await this.executePendingPlan(pendingPlan.planMessageId);
                break;
              }
            }
            if (data.mode === this.mode) {
              postCurrentMode();
              break;
            }
            await this.setModeAndPersist(data.mode);
            break;
          }
          case 'executePlan':
            await this.executePendingPlan(
              typeof data.planMessageId === 'string' ? data.planMessageId : undefined
            );
            break;
          case 'cancelPlan': {
            const pendingPlan = this.getActiveSession().pendingPlan;
            if (pendingPlan?.planMessageId === data.planMessageId && data.confirmed !== true) {
              this.postMessage({ type: 'planPending', value: true, planMessageId: pendingPlan?.planMessageId ?? '' });
              break;
            }
            await this.cancelPendingPlan(typeof data.planMessageId === 'string' ? data.planMessageId : '');
            break;
          }
          case 'revisePlan':
            {
              const pendingPlan = this.getActiveSession().pendingPlan;
              if (!pendingPlan || pendingPlan.planMessageId !== data.planMessageId) {
                this.postMessage({
                  type: 'planPending',
                  value: !!pendingPlan,
                  planMessageId: pendingPlan?.planMessageId ?? '',
                });
                break;
              }
            }

            if (typeof data.instructions === 'string' && data.instructions.trim()) {
              await this.revisePendingPlan(data.planMessageId, data.instructions);
              return;
            }

            postInputNotice(this, 'Type plan revisions in the chat input, then press Enter or click Revise again.');
            this.postMessage({
              type: 'setInput',
              value: '',
              placeholder: 'Type plan revisions or answer questions, then press Enter or click Revise again…',
            });
            break;
          case 'approveToolCall':
            this.handleApprovalResponse(data.approvalId, true);
            break;
          case 'rejectToolCall':
            this.handleApprovalResponse(data.approvalId, false);
            break;
          case 'retryTool':
            if (typeof data.approvalId === 'string' && data.approvalId.trim()) {
              await this.retryToolCall(data.approvalId.trim());
            } else {
              this.postMessage({ type: 'processing', value: this.isProcessing });
            }
            break;
          case 'alwaysAllowTool': {
            if (typeof data.approvalId === 'string' && data.approvalId.trim()) {
              await this.handleAlwaysAllowApproval(data.approvalId.trim());
            } else {
              this.postApprovalState();
            }
            break;
          }
          case WEBVIEW_MESSAGE_ERROR: {
            const message = parseWebviewErrorMessage(data);
            handleWebviewCrashMessage(this, message?.error);
            break;
          }
        }
        } catch (error) {
          appendErrorLog(this.outputChannel, `Failed to handle webview message: ${messageType}`, error, { tag: 'Webview' });
          postInputNotice(this, 'That chat UI action failed. See logs for details.');
          await service.refreshSettingsState().catch(() => {});
          this.postMessage({ type: 'processing', value: this.isProcessing });
        }
      })
    );

    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.startInitPusher();
  },

  startInitPusher(this: ChatWebviewRuntime): void {
    if (this.initInterval) {
      clearInterval(this.initInterval);
      this.initInterval = undefined;
    }

    this.initInterval = setInterval(() => {
      void this.sendInit();
    }, 2000);

    void this.sendInit();
  },

  async sendInit(this: ChatWebviewRuntime, force = false): Promise<void> {
    if (!this.view) return;
    if (!force && this.initAcked) return;
    if (this.initInFlight) return;

    this.initInFlight = true;
    let initPosted = false;
    try {
      await this.ensureSessionsLoaded();

      const modelLabel = this.getModelLabel(this.currentModel) || this.currentModel;
      const currentModelIsFavorite = await this.isModelFavorite(this.currentModel);
      this.postMessage(
        await buildWebviewInitMessage(this, {
          modelLabel,
          currentModelIsFavorite,
        })
      );
      initPosted = true;
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to send init', error, { tag: 'Webview' });

      const fallback = this.currentModel || 'gpt-4o';
      this.currentModel = fallback;
      let currentModelIsFavorite = false;
      try {
        currentModelIsFavorite = await this.isModelFavorite(fallback);
      } catch {
        currentModelIsFavorite = false;
      }

      try {
        this.postMessage(
          await buildWebviewInitMessage(this, {
            modelLabel: fallback,
            currentModelIsFavorite,
          })
        );
        initPosted = true;
      } catch (postError) {
        appendErrorLog(this.outputChannel, 'Failed to post init fallback', postError, {
          tag: 'Webview',
        });
      }
    } finally {
      this.initInFlight = false;
      if (initPosted) {
        scheduleDeferredWebviewState(this);
        scheduleDeferredTodos(this);
      }
      void this.queueManager.flushAutosendForActiveSession();
    }
  },

  loadEarlierTranscriptMessages(
    this: ChatWebviewRuntime,
    request: WebviewTranscriptHistoryRequest
  ): void {
    const responseBase = {
      type: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE,
      requestId: request.requestId,
      sessionId: request.sessionId,
      requestCursor: request.cursor,
    };

    if (request.sessionId !== this.activeSessionId) {
      this.postMessage({
        ...responseBase,
        messages: [],
        hasEarlierMessages: false,
        cursor: '',
        error: 'staleSession',
      });
      return;
    }

    const page = createEarlierTranscriptPage(this.getRenderableMessages(), request.cursor);
    if (!page) {
      this.postMessage({
        ...responseBase,
        messages: [],
        hasEarlierMessages: false,
        cursor: '',
        error: 'staleCursor',
      });
      return;
    }

    this.postMessage({
      ...responseBase,
      messages: page.messages,
      hasEarlierMessages: page.hasEarlierMessages,
      cursor: page.cursor ?? '',
    });
  },

  async refreshSettingsState(this: ChatWebviewRuntime): Promise<void> {
    if (!this.view) return;

    try {
      this.skillNamesForUiPromise = undefined;
      this.postMessage(await buildWebviewSettingsStateMessage(this));
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to refresh chat settings state', error, { tag: 'Webview' });
    }
  },

  async getProviderAuthStateForUI(this: ChatWebviewRuntime): Promise<ProviderAuthUiState> {
    const provider = this.llmProvider;
    const providerId = typeof provider?.id === 'string' ? provider.id : '';
    const providerName = typeof provider?.name === 'string' ? provider.name : '';

    if (!provider?.getAuthStatus) {
      return {
        providerId,
        providerName,
        supported: false,
        authenticated: false,
        status: 'hidden',
        label: '',
      };
    }

    const status = await provider.getAuthStatus().catch(() => undefined);
    if (!status) {
      return {
        providerId,
        providerName,
        supported: true,
        authenticated: false,
        status: 'signed_out',
        label: 'Sign in',
      };
    }

    return {
      providerId,
      providerName,
      supported: status.supported !== false,
      authenticated: !!status.authenticated,
      status: status.status || (status.authenticated ? 'signed_in' : 'signed_out'),
      label: status.label || '',
      ...(status.detail ? { detail: status.detail } : {}),
      ...(status.accountLabel ? { accountLabel: status.accountLabel } : {}),
      ...(status.primaryActionLabel ? { primaryActionLabel: status.primaryActionLabel } : {}),
      ...(status.secondaryActionLabel ? { secondaryActionLabel: status.secondaryActionLabel } : {}),
    };
  },

  async postProviderState(this: ChatWebviewRuntime): Promise<void> {
    const providerAuth = await service.getProviderAuthStateForUI();
    this.postMessage({ type: 'providerState', currentProviderId: getConfiguredLlmProviderId(), providerAuth });
  },

  async switchProvider(this: ChatWebviewRuntime, providerId: string): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before switching providers.');
      await service.postProviderState();
      return;
    }

    const normalized = normalizeLlmProviderId(providerId);
    if (!normalized) {
      postInputNotice(this, 'Unsupported provider.');
      await service.postProviderState();
      return;
    }

    if (normalized === getConfiguredLlmProviderId()) {
      await service.postProviderState();
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('llmProvider', normalized, true);
      this.postMessage({ type: 'providerState', currentProviderId: normalized, providerAuth: await service.getProviderAuthStateForUI() });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist provider setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to switch provider. See logs for details.');
      await service.postProviderState();
    }
  },

  async setOpenAICompatibleSettings(this: ChatWebviewRuntime, settings: Partial<OpenAICompatibleSettings>): Promise<void> {
    const postCurrentState = async () => {
      this.postMessage({
        type: 'openAICompatibleSettingsState',
        openAICompatibleSettings: getOpenAICompatibleSettings(),
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing OpenAI-compatible provider settings.');
      await postCurrentState();
      return;
    }

    const current = getOpenAICompatibleSettings();
    const raw = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
    const displayNamesValidationError = Object.prototype.hasOwnProperty.call(raw, 'modelDisplayNames')
      ? getOpenAICompatibleModelDisplayNamesValidationError(raw.modelDisplayNames)
      : undefined;
    if (displayNamesValidationError) {
      postInputNotice(this, displayNamesValidationError);
      await postCurrentState();
      return;
    }

    const next: OpenAICompatibleSettings = {
      baseURL: Object.prototype.hasOwnProperty.call(raw, 'baseURL')
        ? normalizeOpenAICompatibleText(raw.baseURL, 500)
        : current.baseURL,
      defaultModelId: Object.prototype.hasOwnProperty.call(raw, 'defaultModelId')
        ? normalizeOpenAICompatibleText(raw.defaultModelId, 200)
        : current.defaultModelId,
      apiKeyEnv: Object.prototype.hasOwnProperty.call(raw, 'apiKeyEnv')
        ? (normalizeOpenAICompatibleText(raw.apiKeyEnv, 120) || 'OPENAI_API_KEY')
        : current.apiKeyEnv,
      allowInsecureTLS: Object.prototype.hasOwnProperty.call(raw, 'allowInsecureTLS')
        ? raw.allowInsecureTLS === true
        : current.allowInsecureTLS,
      modelDisplayNames: Object.prototype.hasOwnProperty.call(raw, 'modelDisplayNames')
        ? normalizeOpenAICompatibleModelDisplayNames(raw.modelDisplayNames)
        : current.modelDisplayNames,
    };

    if (next.baseURL && !/^https?:\/\//i.test(next.baseURL)) {
      postInputNotice(this, 'OpenAI-compatible base URL must start with http:// or https://.');
      await postCurrentState();
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next.apiKeyEnv)) {
      postInputNotice(this, 'API key environment variable must be a valid environment variable name.');
      await postCurrentState();
      return;
    }
    if (openAICompatibleSettingsEqual(next, current)) {
      this.postMessage({
        type: 'openAICompatibleSettingsState',
        openAICompatibleSettings: current,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('openaiCompatible.baseURL', next.baseURL, true);
      await config.update('openaiCompatible.defaultModelId', next.defaultModelId, true);
      await config.update('openaiCompatible.apiKeyEnv', next.apiKeyEnv, true);
      await config.update('openaiCompatible.allowInsecureTLS', next.allowInsecureTLS, true);
      await config.update('openaiCompatible.modelDisplayNames', next.modelDisplayNames, true);
      this.postMessage({
        type: 'openAICompatibleSettingsState',
        openAICompatibleSettings: next,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist OpenAI-compatible provider settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update OpenAI-compatible provider settings. See logs for details.');
      await postCurrentState();
    }
  },

  async setCodexSubscriptionSettings(this: ChatWebviewRuntime, settings: Partial<CodexSubscriptionSettings>): Promise<void> {
    const postCurrentState = async () => {
      this.postMessage({
        type: 'codexSubscriptionSettingsState',
        codexSubscriptionSettings: getCodexSubscriptionSettings(),
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing Codex subscription provider settings.');
      await postCurrentState();
      return;
    }

    const current = getCodexSubscriptionSettings();
    const raw = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
    if (Object.prototype.hasOwnProperty.call(raw, 'defaultModelId') && typeof raw.defaultModelId !== 'string') {
      postInputNotice(this, 'Codex subscription default model must be a string.');
      await postCurrentState();
      return;
    }

    const next: CodexSubscriptionSettings = {
      defaultModelId: Object.prototype.hasOwnProperty.call(raw, 'defaultModelId')
        ? (normalizeOpenAICompatibleText(raw.defaultModelId, 200) || 'gpt-5.3-codex')
        : current.defaultModelId,
    };
    if (next.defaultModelId === current.defaultModelId) {
      this.postMessage({
        type: 'codexSubscriptionSettingsState',
        codexSubscriptionSettings: current,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('codexSubscription.defaultModelId', next.defaultModelId, true);
      this.postMessage({
        type: 'codexSubscriptionSettingsState',
        codexSubscriptionSettings: next,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist Codex subscription provider settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update Codex subscription provider settings. See logs for details.');
      await postCurrentState();
    }
  },

  async setPlanFirst(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'planFirst',
      stateType: 'planFirstState',
      stateField: 'planFirst',
      getCurrent: getPlanFirstEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing plan-first behavior.',
      failureNotice: 'Failed to update plan-first behavior. See logs for details.',
      logLabel: 'Failed to persist plan-first setting',
    });
  },

  async setAutoApprove(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'autoApprove',
      stateType: 'autoApproveState',
      stateField: 'autoApprove',
      getCurrent: getAutoApproveEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing tool safety behavior.',
      failureNotice: 'Failed to update tool safety behavior. See logs for details.',
      logLabel: 'Failed to persist auto-approve setting',
    });
  },

  async setAllowExternalPaths(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'security.allowExternalPaths',
      stateType: 'allowExternalPathsState',
      stateField: 'allowExternalPaths',
      getCurrent: getAllowExternalPathsEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing external path access.',
      failureNotice: 'Failed to update external path access. See logs for details.',
      logLabel: 'Failed to persist external path access setting',
    });
  },

  async setBlockGitPush(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'security.blockGitPush',
      stateType: 'blockGitPushState',
      stateField: 'blockGitPush',
      getCurrent: getBlockGitPushEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing git push protection.',
      failureNotice: 'Failed to update git push protection. See logs for details.',
      logLabel: 'Failed to persist git push protection setting',
    });
  },

  async setDebugSettings(this: ChatWebviewRuntime, settings: Partial<DebugSettingsUi>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'debugSettingsState', debugSettings: getDebugSettingsForUi() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing diagnostics logging.');
      postCurrentState();
      return;
    }

    const current = getDebugSettingsForUi();
    const normalized = normalizeDebugSettings(settings, current);
    if (debugSettingsEqual(normalized, current)) {
      this.postMessage({ type: 'debugSettingsState', debugSettings: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('debug.details', normalized.details, true);
      await config.update('debug.llm', normalized.llm, true);
      await config.update('debug.tools', normalized.tools, true);
      await config.update('debug.plugins', normalized.plugins, true);
      this.postMessage({ type: 'debugSettingsState', debugSettings: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist diagnostics logging settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update diagnostics logging. See logs for details.');
      postCurrentState();
    }
  },

  async setPluginSettings(this: ChatWebviewRuntime, settings: Partial<PluginSettings>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'pluginSettingsState', pluginSettings: getPluginSettings() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing plugin loading behavior.');
      postCurrentState();
      return;
    }

    const current = getPluginSettings();
    const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
    const next: PluginSettings = {
      plugins: Object.prototype.hasOwnProperty.call(raw, 'plugins')
        ? normalizePluginSpecs(raw.plugins)
        : current.plugins,
      autoDiscover: typeof raw.autoDiscover === 'boolean' ? raw.autoDiscover : current.autoDiscover,
      workspaceDir: Object.prototype.hasOwnProperty.call(raw, 'workspaceDir')
        ? normalizePluginWorkspaceDir(raw.workspaceDir)
        : current.workspaceDir,
    };

    if (hasListItemLongerThan(next.plugins, 240)) {
      postInputNotice(this, 'Plugin module specs must be 240 characters or shorter.');
      postCurrentState();
      return;
    }
    if (next.workspaceDir.length > 120) {
      postInputNotice(this, 'Plugin workspace directory must be 120 characters or shorter.');
      postCurrentState();
      return;
    }
    if (pluginSettingsEqual(next, current)) {
      this.postMessage({ type: 'pluginSettingsState', pluginSettings: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('plugins', next.plugins, true);
      await config.update('plugins.autoDiscover', next.autoDiscover, true);
      await config.update('plugins.workspaceDir', next.workspaceDir, true);
      this.postMessage({ type: 'pluginSettingsState', pluginSettings: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist plugin settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update plugin settings. See logs for details.');
      postCurrentState();
    }
  },

  async setToolRuntimeLimits(this: ChatWebviewRuntime, limits: Partial<ToolRuntimeLimits>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'toolRuntimeLimitsState', toolRuntimeLimits: getToolRuntimeLimits() });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing tool runtime limits.');
      postCurrentState();
      return;
    }

    const current = getToolRuntimeLimits();
    const next: ToolRuntimeLimits = {
      toolTimeoutMs: Number(limits.toolTimeoutMs ?? current.toolTimeoutMs),
      readMaxLines: Number(limits.readMaxLines ?? current.readMaxLines),
      bashBackgroundTtlMs: Number(limits.bashBackgroundTtlMs ?? current.bashBackgroundTtlMs),
      bashBackgroundCaptureMs: Number(limits.bashBackgroundCaptureMs ?? current.bashBackgroundCaptureMs),
      bashBackgroundCaptureLines: Number(limits.bashBackgroundCaptureLines ?? current.bashBackgroundCaptureLines),
      workspaceShellTimeoutMs: Number(limits.workspaceShellTimeoutMs ?? current.workspaceShellTimeoutMs),
      httpTimeoutMs: Number(limits.httpTimeoutMs ?? current.httpTimeoutMs),
    };

    if (
      !Number.isFinite(next.toolTimeoutMs) || next.toolTimeoutMs < 0 ||
      !Number.isFinite(next.readMaxLines) || next.readMaxLines < 1 ||
      !Number.isFinite(next.bashBackgroundTtlMs) || next.bashBackgroundTtlMs < 0 ||
      !Number.isFinite(next.bashBackgroundCaptureMs) || next.bashBackgroundCaptureMs < 0 ||
      !Number.isFinite(next.bashBackgroundCaptureLines) || next.bashBackgroundCaptureLines < 0 ||
      !Number.isFinite(next.workspaceShellTimeoutMs) || next.workspaceShellTimeoutMs < 0 ||
      !Number.isFinite(next.httpTimeoutMs) || next.httpTimeoutMs < 0
    ) {
      postInputNotice(this, 'Tool runtime limits must be non-negative, and Read max lines must be at least 1.');
      postCurrentState();
      return;
    }

    const normalized: ToolRuntimeLimits = {
      toolTimeoutMs: Math.floor(next.toolTimeoutMs),
      readMaxLines: Math.floor(next.readMaxLines),
      bashBackgroundTtlMs: Math.floor(next.bashBackgroundTtlMs),
      bashBackgroundCaptureMs: Math.floor(next.bashBackgroundCaptureMs),
      bashBackgroundCaptureLines: Math.floor(next.bashBackgroundCaptureLines),
      workspaceShellTimeoutMs: Math.floor(next.workspaceShellTimeoutMs),
      httpTimeoutMs: Math.floor(next.httpTimeoutMs),
    };
    if (toolRuntimeLimitsEqual(normalized, current)) {
      this.postMessage({ type: 'toolRuntimeLimitsState', toolRuntimeLimits: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('toolTimeoutMs', normalized.toolTimeoutMs, true);
      await config.update('tools.read.maxLines', normalized.readMaxLines, true);
      await config.update('tools.bash.backgroundTtlMs', normalized.bashBackgroundTtlMs, true);
      await config.update('tools.bash.backgroundCaptureMs', normalized.bashBackgroundCaptureMs, true);
      await config.update('tools.bash.backgroundCaptureLines', normalized.bashBackgroundCaptureLines, true);
      await config.update('tools.workspaceShell.timeoutMs', normalized.workspaceShellTimeoutMs, true);
      await config.update('tools.http.timeoutMs', normalized.httpTimeoutMs, true);
      this.postMessage({ type: 'toolRuntimeLimitsState', toolRuntimeLimits: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist tool runtime limits', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update tool runtime limits. See logs for details.');
      postCurrentState();
    }
  },

  async setToolFilter(this: ChatWebviewRuntime, patterns: ToolFilter): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'toolFilterState', toolFilter: getToolFilter() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing tool availability.');
      postCurrentState();
      return;
    }

    const normalized = normalizeToolFilter(patterns);
    if (hasListItemLongerThan(normalized, 120)) {
      postInputNotice(this, 'Tool filter patterns must be 120 characters or shorter.');
      postCurrentState();
      return;
    }

    const current = getToolFilter();
    if (stringListsEqual(normalized, current)) {
      this.postMessage({ type: 'toolFilterState', toolFilter: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('toolFilter', normalized, true);
      this.postMessage({ type: 'toolFilterState', toolFilter: normalized, toolsCatalog: await buildToolCatalogForUI() });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist tool filter setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update tool availability. See logs for details.');
      postCurrentState();
    }
  },

  async revokeAlwaysAllowedTool(this: ChatWebviewRuntime, toolId: string): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'autoApprovedToolsState', autoApprovedTools: this.getAutoApprovedToolsForUI() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing always-allowed tools.');
      postCurrentState();
      return;
    }

    const normalizedToolId = typeof toolId === 'string' ? toolId.trim() : '';
    if (!normalizedToolId) {
      postInputNotice(this, 'Choose an always-allowed tool to revoke.');
      postCurrentState();
      return;
    }

    try {
      await this.revokeAutoApprovedTool(normalizedToolId);
      postCurrentState();
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to revoke always-allowed tool', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to revoke always-allowed tool. See logs for details.');
      postCurrentState();
    }
  },

  async clearAlwaysAllowedTools(this: ChatWebviewRuntime, confirmed?: boolean): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'autoApprovedToolsState', autoApprovedTools: this.getAutoApprovedToolsForUI() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before clearing always-allowed tools.');
      postCurrentState();
      return;
    }

    if (this.getAutoApprovedToolsForUI().length === 0 || confirmed !== true) {
      postCurrentState();
      return;
    }

    try {
      await this.clearAutoApprovedToolsForUI();
      postCurrentState();
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to clear always-allowed tools', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to clear always-allowed tools. See logs for details.');
      postCurrentState();
    }
  },

  async setWorkspaceEnv(this: ChatWebviewRuntime, env: WorkspaceEnv): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'workspaceEnvState', workspaceEnv: getWorkspaceEnv() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing workspace tool environment variables.');
      postCurrentState();
      return;
    }

    const validationError = getWorkspaceEnvValidationError(env);
    if (validationError) {
      postInputNotice(this, validationError);
      postCurrentState();
      return;
    }

    const normalized = normalizeWorkspaceEnv(env);
    const current = getWorkspaceEnv();
    if (workspaceEnvEqual(normalized, current)) {
      this.postMessage({ type: 'workspaceEnvState', workspaceEnv: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('env', normalized, true);
      this.postMessage({ type: 'workspaceEnvState', workspaceEnv: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist workspace tool environment variables', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update workspace tool environment variables. See logs for details.');
      postCurrentState();
    }
  },

  async setInstructionPatterns(this: ChatWebviewRuntime, patterns: InstructionPatterns): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'instructionPatternsState', instructionPatterns: getInstructionPatterns() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing instruction files.');
      postCurrentState();
      return;
    }

    const normalized = normalizeInstructionPatterns(patterns);
    if (hasListItemLongerThan(normalized, 240)) {
      postInputNotice(this, 'Instruction paths and glob patterns must be 240 characters or shorter.');
      postCurrentState();
      return;
    }

    const current = getInstructionPatterns();
    if (stringListsEqual(normalized, current)) {
      this.postMessage({ type: 'instructionPatternsState', instructionPatterns: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('instructions', normalized, true);
      this.postMessage({ type: 'instructionPatternsState', instructionPatterns: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist instruction pattern setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update instruction files. See logs for details.');
      postCurrentState();
    }
  },

  async setInstructionFileSettings(this: ChatWebviewRuntime, settings: Partial<InstructionFileSettings>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'instructionFileSettingsState', instructionFileSettings: getInstructionFileSettings() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing instruction file loading.');
      postCurrentState();
      return;
    }

    const current = getInstructionFileSettings();
    const includeGlobal = typeof settings.includeGlobal === 'boolean' ? settings.includeGlobal : current.includeGlobal;
    const maxCharsPerFile = Number(settings.maxCharsPerFile ?? current.maxCharsPerFile);
    const maxTotalChars = Number(settings.maxTotalChars ?? current.maxTotalChars);

    if (
      !Number.isFinite(maxCharsPerFile) || maxCharsPerFile < 1000 ||
      !Number.isFinite(maxTotalChars) || maxTotalChars < 1000
    ) {
      postInputNotice(this, 'Instruction file character limits must be at least 1000.');
      postCurrentState();
      return;
    }

    const normalized: InstructionFileSettings = {
      includeGlobal,
      maxCharsPerFile: Math.floor(maxCharsPerFile),
      maxTotalChars: Math.floor(maxTotalChars),
    };
    if (instructionFileSettingsEqual(normalized, current)) {
      this.postMessage({ type: 'instructionFileSettingsState', instructionFileSettings: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('instructionFiles.includeGlobal', normalized.includeGlobal, true);
      await config.update('instructionFiles.maxCharsPerFile', normalized.maxCharsPerFile, true);
      await config.update('instructionFiles.maxTotalChars', normalized.maxTotalChars, true);
      this.postMessage({ type: 'instructionFileSettingsState', instructionFileSettings: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist instruction file loading settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update instruction file loading. See logs for details.');
      postCurrentState();
    }
  },

  async setSkillsEnabled(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'skills.enabled',
      stateType: 'skillsEnabledState',
      stateField: 'skillsEnabled',
      getCurrent: getSkillsEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing skills behavior.',
      failureNotice: 'Failed to update skills behavior. See logs for details.',
      logLabel: 'Failed to persist skills enabled setting',
      extraState: async () => ({ skills: await this.getSkillNamesForUI() }),
      onChanged: () => { this.skillNamesForUiPromise = undefined; },
    });
  },

  async setSkillSearchPaths(this: ChatWebviewRuntime, paths: SkillSearchPaths): Promise<void> {
    const postCurrentState = async () => this.postMessage({
      type: 'skillSearchPathsState',
      skillSearchPaths: getSkillSearchPaths(),
      skills: await this.getSkillNamesForUI(),
    });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing skill search paths.');
      await postCurrentState();
      return;
    }

    const normalized = normalizeSkillSearchPaths(paths);
    if (hasListItemLongerThan(normalized, 240)) {
      postInputNotice(this, 'Skill search paths must be 240 characters or shorter.');
      await postCurrentState();
      return;
    }

    const current = getSkillSearchPaths();
    if (stringListsEqual(normalized, current)) {
      this.postMessage({
        type: 'skillSearchPathsState',
        skillSearchPaths: current,
        skills: await this.getSkillNamesForUI(),
      });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('skills.paths', normalized, true);
      this.skillNamesForUiPromise = undefined;
      this.postMessage({
        type: 'skillSearchPathsState',
        skillSearchPaths: normalized,
        skills: await this.getSkillNamesForUI(),
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist skill search paths setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update skill search paths. See logs for details.');
      this.skillNamesForUiPromise = undefined;
      await postCurrentState();
    }
  },

  async setSkillsBudget(this: ChatWebviewRuntime, budget: Partial<SkillsBudget>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'skillsBudgetState', skillsBudget: getSkillsBudget() });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing skills prompt budgets.');
      postCurrentState();
      return;
    }

    const current = getSkillsBudget();
    const next = { ...current, ...(budget || {}) };
    if (
      !Number.isFinite(next.maxPromptSkills) || next.maxPromptSkills < 0 ||
      !Number.isFinite(next.maxInjectSkills) || next.maxInjectSkills < 1 ||
      !Number.isFinite(next.maxInjectChars) || next.maxInjectChars < 1
    ) {
      postInputNotice(this, 'Skills budgets must be valid non-negative prompt cap and positive injection caps.');
      postCurrentState();
      return;
    }

    const normalized: SkillsBudget = {
      maxPromptSkills: Math.floor(next.maxPromptSkills),
      maxInjectSkills: Math.floor(next.maxInjectSkills),
      maxInjectChars: Math.floor(next.maxInjectChars),
    };
    if (skillsBudgetEqual(normalized, current)) {
      this.postMessage({ type: 'skillsBudgetState', skillsBudget: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('skills.maxPromptSkills', normalized.maxPromptSkills, true);
      await config.update('skills.maxInjectSkills', normalized.maxInjectSkills, true);
      await config.update('skills.maxInjectChars', normalized.maxInjectChars, true);
      this.skillNamesForUiPromise = undefined;
      this.postMessage({ type: 'skillsBudgetState', skillsBudget: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist skills budget settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update skills budgets. See logs for details.');
      postCurrentState();
    }
  },

  async setSessionsPersist(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing session persistence.');
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: getSessionsPersistEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getSessionsPersistEnabled();
    if (next === current) {
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('sessions.persist', next, true);
      await this.onSessionPersistenceConfigChanged();
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: getSessionsPersistEnabled() });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist session persistence setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update session persistence. See logs for details.');
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: getSessionsPersistEnabled() });
    }
  },

  async setSessionRetentionLimits(this: ChatWebviewRuntime, limits: Partial<SessionRetentionLimits>): Promise<void> {
    const postCurrentState = () => {
      const current = getSessionRetentionLimits();
      this.postMessage({
        type: 'sessionRetentionState',
        sessionsMaxSessions: current.maxSessions,
        sessionsMaxSessionBytes: current.maxSessionBytes,
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing session retention.');
      postCurrentState();
      return;
    }

    const current = getSessionRetentionLimits();
    const nextMaxSessions = Number(limits.maxSessions ?? current.maxSessions);
    const nextMaxSessionBytes = Number(limits.maxSessionBytes ?? current.maxSessionBytes);
    if (!Number.isFinite(nextMaxSessions) || nextMaxSessions < 1 || !Number.isFinite(nextMaxSessionBytes) || nextMaxSessionBytes < 1000) {
      postInputNotice(this, 'Session retention must keep at least 1 session and 1000 bytes per session.');
      postCurrentState();
      return;
    }

    const normalized: SessionRetentionLimits = {
      maxSessions: Math.floor(nextMaxSessions),
      maxSessionBytes: Math.floor(nextMaxSessionBytes),
    };
    if (normalized.maxSessions === current.maxSessions && normalized.maxSessionBytes === current.maxSessionBytes) {
      this.postMessage({
        type: 'sessionRetentionState',
        sessionsMaxSessions: current.maxSessions,
        sessionsMaxSessionBytes: current.maxSessionBytes,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('sessions.maxSessions', normalized.maxSessions, true);
      await config.update('sessions.maxSessionBytes', normalized.maxSessionBytes, true);
      await this.onSessionPersistenceConfigChanged();
      this.postMessage({
        type: 'sessionRetentionState',
        sessionsMaxSessions: normalized.maxSessions,
        sessionsMaxSessionBytes: normalized.maxSessionBytes,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist session retention settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update session retention. See logs for details.');
      postCurrentState();
    }
  },

  async setShowThinking(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'showThinking',
      stateType: 'showThinkingState',
      stateField: 'showThinking',
      getCurrent: getShowThinkingEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing thinking display.',
      failureNotice: 'Failed to update thinking display. See logs for details.',
      logLabel: 'Failed to persist show-thinking setting',
    });
  },

  async setMemoriesFeatureEnabled(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'features.memories',
      stateType: 'memoriesFeatureState',
      stateField: 'memoriesFeatureEnabled',
      getCurrent: getMemoriesFeatureEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing memory features.',
      failureNotice: 'Failed to update memory features. See logs for details.',
      logLabel: 'Failed to persist memories feature setting',
    });
  },

  async setMemoryAutoRecall(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'memories.autoRecall',
      stateType: 'memoryAutoRecallState',
      stateField: 'memoryAutoRecall',
      getCurrent: getMemoryAutoRecallEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing memory recall behavior.',
      failureNotice: 'Failed to update memory recall behavior. See logs for details.',
      logLabel: 'Failed to persist memory auto-recall setting',
    });
  },

  async setMemoryAutoRecallBudget(this: ChatWebviewRuntime, budget: Partial<MemoryAutoRecallBudget>): Promise<void> {
    const postCurrentState = () => {
      const current = getMemoryAutoRecallBudget();
      this.postMessage({
        type: 'memoryAutoRecallBudgetState',
        memoryAutoRecallMaxResults: current.maxResults,
        memoryAutoRecallMaxTokens: current.maxTokens,
      });
    };
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory recall budget.');
      postCurrentState();
      return;
    }

    const current = getMemoryAutoRecallBudget();
    const nextMaxResults = Number(budget.maxResults ?? current.maxResults);
    const nextMaxTokens = Number(budget.maxTokens ?? current.maxTokens);
    if (!Number.isFinite(nextMaxResults) || nextMaxResults < 1 || !Number.isFinite(nextMaxTokens) || nextMaxTokens < 100) {
      postInputNotice(this, 'Memory recall budget must allow at least 1 result and 100 tokens.');
      postCurrentState();
      return;
    }

    const normalized: MemoryAutoRecallBudget = {
      maxResults: Math.floor(nextMaxResults),
      maxTokens: Math.floor(nextMaxTokens),
    };
    if (normalized.maxResults === current.maxResults && normalized.maxTokens === current.maxTokens) {
      this.postMessage({
        type: 'memoryAutoRecallBudgetState',
        memoryAutoRecallMaxResults: current.maxResults,
        memoryAutoRecallMaxTokens: current.maxTokens,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('memories.maxAutoRecallResults', normalized.maxResults, true);
      await config.update('memories.maxAutoRecallTokens', normalized.maxTokens, true);
      this.postMessage({
        type: 'memoryAutoRecallBudgetState',
        memoryAutoRecallMaxResults: normalized.maxResults,
        memoryAutoRecallMaxTokens: normalized.maxTokens,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memory auto-recall budget', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory recall budget. See logs for details.');
      postCurrentState();
    }
  },

  async setMemoryAutoRecallFilters(this: ChatWebviewRuntime, filters: Partial<MemoryAutoRecallFilters>): Promise<void> {
    const postCurrentState = () => {
      const current = getMemoryAutoRecallFilters();
      this.postMessage({
        type: 'memoryAutoRecallFiltersState',
        memoryAutoRecallMinScore: current.minScore,
        memoryAutoRecallMinScoreGap: current.minScoreGap,
        memoryAutoRecallMaxAgeDays: current.maxAgeDays,
      });
    };
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory recall filters.');
      postCurrentState();
      return;
    }

    const current = getMemoryAutoRecallFilters();
    const nextMinScore = Number(filters.minScore ?? current.minScore);
    const nextMinScoreGap = Number(filters.minScoreGap ?? current.minScoreGap);
    const nextMaxAgeDays = Number(filters.maxAgeDays ?? current.maxAgeDays);
    if (!Number.isFinite(nextMinScore) || nextMinScore < 0 || !Number.isFinite(nextMinScoreGap) || nextMinScoreGap < 0 || !Number.isFinite(nextMaxAgeDays) || nextMaxAgeDays < 1) {
      postInputNotice(this, 'Memory recall filters must use non-negative scores and at least 1 max-age day.');
      postCurrentState();
      return;
    }

    const normalized: MemoryAutoRecallFilters = {
      minScore: Math.min(100, nextMinScore),
      minScoreGap: Math.min(50, nextMinScoreGap),
      maxAgeDays: Math.min(3650, Math.floor(nextMaxAgeDays)),
    };
    if (
      normalized.minScore === current.minScore
      && normalized.minScoreGap === current.minScoreGap
      && normalized.maxAgeDays === current.maxAgeDays
    ) {
      this.postMessage({
        type: 'memoryAutoRecallFiltersState',
        memoryAutoRecallMinScore: current.minScore,
        memoryAutoRecallMinScoreGap: current.minScoreGap,
        memoryAutoRecallMaxAgeDays: current.maxAgeDays,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('memories.autoRecallMinScore', normalized.minScore, true);
      await config.update('memories.autoRecallMinScoreGap', normalized.minScoreGap, true);
      await config.update('memories.autoRecallMaxAgeDays', normalized.maxAgeDays, true);
      this.postMessage({
        type: 'memoryAutoRecallFiltersState',
        memoryAutoRecallMinScore: normalized.minScore,
        memoryAutoRecallMinScoreGap: normalized.minScoreGap,
        memoryAutoRecallMaxAgeDays: normalized.maxAgeDays,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memory auto-recall filters', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory recall filters. See logs for details.');
      postCurrentState();
    }
  },

  async updateMemoriesNow(this: ChatWebviewRuntime): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before updating memories.');
      postMemoryActionStatus(this, idleMemoryActionStatus);
      return;
    }

    postMemoryActionStatus(this, { state: 'running', message: 'Updating memories…' });
    try {
      const memories = new WorkspaceMemories(this.context);
      const result = await memories.updateFromSessions(getWorkspaceFolderUrisByPriority()[0]);
      const message = formatMemoryUpdateMessage(result);
      appendLog(this.outputChannel, message, { tag: 'Memory' });
      postMemoryActionStatus(this, { state: 'success', message });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to update memories from webview', error, { tag: 'Webview' });
      postMemoryActionStatus(this, { state: 'error', message: 'Failed to update memories. See logs for details.' });
      postInputNotice(this, 'Failed to update memories. See logs for details.');
    }
  },

  async dropMemoriesNow(this: ChatWebviewRuntime, confirmed?: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before dropping memories.');
      postMemoryActionStatus(this, idleMemoryActionStatus);
      return;
    }

    if (confirmed !== true) {
      postMemoryActionStatus(this, idleMemoryActionStatus);
      return;
    }

    postMemoryActionStatus(this, { state: 'running', message: 'Dropping generated memories…' });
    try {
      const memories = new WorkspaceMemories(this.context);
      const result = await memories.dropMemories(getWorkspaceFolderUrisByPriority()[0]);
      const message = formatMemoryDropMessage(result);
      appendLog(this.outputChannel, message, { tag: 'Memory' });
      postMemoryActionStatus(this, { state: 'success', message });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to drop memories from webview', error, { tag: 'Webview' });
      postMemoryActionStatus(this, { state: 'error', message: 'Failed to drop memories. See logs for details.' });
      postInputNotice(this, 'Failed to drop memories. See logs for details.');
    }
  },

  showLogs(this: ChatWebviewRuntime): void {
    try {
      this.outputChannel?.show();
    } catch {
      // Ignore output-channel failures.
    }
  },

  async postToolCatalog(this: ChatWebviewRuntime): Promise<void> {
    try {
      this.postMessage({ type: 'toolsCatalogState', toolsCatalog: await buildToolCatalogForUI(), reveal: true });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to build tool catalog for webview', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to list tools. See logs for details.');
      this.postMessage({ type: 'toolsCatalogState', toolsCatalog: { total: 0, shown: 0, filter: getToolFilter(), tools: [] }, reveal: true });
    }
  },

  async listTools(this: ChatWebviewRuntime): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before listing tools.');
      await this.postToolCatalog();
      return;
    }

    await this.postToolCatalog();
  },

  async runTool(this: ChatWebviewRuntime, toolId?: string, args?: Record<string, unknown>, confirmed?: boolean): Promise<void> {
    const id = typeof toolId === 'string' ? toolId.trim() : '';
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before running a tool manually.');
      if (id) {
        this.postMessage({
          type: 'manualToolResult',
          toolId: id,
          success: false,
          error: 'Stop the current task before running a tool manually.',
        });
      } else {
        await this.postToolCatalog();
      }
      return;
    }

    if (!id) {
      await this.postToolCatalog();
      postInputNotice(this, 'Choose a tool from the inline tool list, edit JSON arguments, then click Run.');
      return;
    }

    const filter = getToolFilter();
    if (!isToolAllowedByFilter(id, filter)) {
      postInputNotice(this, 'That tool is blocked by the current Allowed tools filter.');
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: 'Tool is blocked by the current Allowed tools filter.',
      });
      await this.postToolCatalog();
      return;
    }

    const allTools = await toolRegistry.getTools();
    let tool: (typeof allTools)[number] | undefined;
    for (const candidate of allTools) {
      if (candidate.id === id) {
        tool = candidate;
        break;
      }
    }
    if (!tool) {
      postInputNotice(this, `Tool "${id}" is not registered.`);
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: `Tool "${id}" is not registered.`,
      });
      await this.postToolCatalog();
      return;
    }

    if (this.mode === 'plan' && tool.metadata?.readOnly !== true) {
      postInputNotice(this, 'Plan mode blocks manual non-read-only tool runs. Switch to Build mode first.');
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: 'Plan mode blocks manual non-read-only tool runs. Switch to Build mode first.',
      });
      return;
    }

    const nextArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const requiresManualConfirmation = tool.metadata?.readOnly !== true || tool.metadata?.requiresApproval === true;
    if (requiresManualConfirmation && confirmed !== true) {
      this.postMessage({
        type: 'manualToolConfirmationRequired',
        toolId: tool.id,
        toolName: tool.name || tool.id,
        reasons: collectManualToolConfirmationReasons(tool),
      });
      return;
    }

    try {
      this.outputChannel?.show();
    } catch {
      // Ignore output-channel failures.
    }
    appendLog(this.outputChannel, `\nRunning ${tool.name || tool.id}...`, { tag: 'ManualTool' });
    appendLog(this.outputChannel, `Args: ${summarizeToolArgsForDebug(nextArgs, { redactionLevel: getDebugRedactionLevel() })}`, { tag: 'ManualTool' });

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const context = {
        workspaceFolder: getWorkspaceFolderUrisByPriority()[0],
        activeEditor: vscode.window.activeTextEditor,
        extensionContext: this.context,
        cancellationToken: tokenSource.token,
        progress: { report: () => {} },
        log: (msg: string) => appendLog(this.outputChannel, msg, { tag: 'ManualTool' }),
      };

      const result = await toolRegistry.executeTool(tool.id, nextArgs, context);
      const formatted = formatManualToolResultData(result.data);
      appendLog(this.outputChannel, `\nResult: ${result.success ? '✅' : '❌'}`, { tag: 'ManualTool' });
      appendLog(this.outputChannel, formatted.text, { tag: 'ManualTool' });
      if (result.error) appendLog(this.outputChannel, `Error: ${result.error}`, { tag: 'ManualTool' });

      this.postMessage({
        type: 'manualToolResult',
        toolId: tool.id,
        success: result.success,
        error: result.error,
        data: formatted.text,
        truncated: formatted.truncated,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, `Failed to run manual tool "${id}" from webview`, error, { tag: 'ManualTool' });
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      postInputNotice(this, 'Failed to run tool manually. See logs for details.');
    } finally {
      tokenSource.dispose();
    }
  },

  async createToolsConfig(this: ChatWebviewRuntime): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before creating a workspace tools config.');
      await this.postToolCatalog();
      return;
    }

    try {
      await createSampleToolsConfig();
      await this.postToolCatalog();
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to create workspace tools config from webview', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to create workspace tools config. See logs for details.');
      await this.postToolCatalog();
    }
  },

  async setMemoryAdvancedLimits(this: ChatWebviewRuntime, limits: Partial<MemoryAdvancedLimits>): Promise<void> {
    const postCurrentState = () => this.postMessage({
      type: 'memoryAdvancedLimitsState',
      memoryAdvancedLimits: getMemoryAdvancedLimits(),
    });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory limits.');
      postCurrentState();
      return;
    }

    const current = getMemoryAdvancedLimits();
    const next = { ...current, ...(limits || {}) };
    const numeric = {
      maxRawMemoriesForGlobal: Number(next.maxRawMemoriesForGlobal),
      maxRolloutAgeDays: Number(next.maxRolloutAgeDays),
      maxRolloutsPerStartup: Number(next.maxRolloutsPerStartup),
      minRolloutIdleHours: Number(next.minRolloutIdleHours),
      maxStateOutputs: Number(next.maxStateOutputs),
      maxRecords: Number(next.maxRecords),
      maxSearchResults: Number(next.maxSearchResults),
      maxResultsPerKind: Number(next.maxResultsPerKind),
      searchNeighborWindow: Number(next.searchNeighborWindow),
    };

    if (
      !Number.isFinite(numeric.maxRawMemoriesForGlobal) || numeric.maxRawMemoriesForGlobal < 1 ||
      !Number.isFinite(numeric.maxRolloutAgeDays) || numeric.maxRolloutAgeDays < 1 ||
      !Number.isFinite(numeric.maxRolloutsPerStartup) || numeric.maxRolloutsPerStartup < 1 ||
      !Number.isFinite(numeric.minRolloutIdleHours) || numeric.minRolloutIdleHours < 0 ||
      !Number.isFinite(numeric.maxStateOutputs) || numeric.maxStateOutputs < 10 ||
      !Number.isFinite(numeric.maxRecords) || numeric.maxRecords < 100 ||
      !Number.isFinite(numeric.maxSearchResults) || numeric.maxSearchResults < 1 ||
      !Number.isFinite(numeric.maxResultsPerKind) || numeric.maxResultsPerKind < 1 ||
      !Number.isFinite(numeric.searchNeighborWindow) || numeric.searchNeighborWindow < 0
    ) {
      postInputNotice(this, 'Memory limits must satisfy the minimum values shown in the UI.');
      postCurrentState();
      return;
    }

    const normalized: MemoryAdvancedLimits = {
      maxRawMemoriesForGlobal: Math.min(2000, Math.floor(numeric.maxRawMemoriesForGlobal)),
      maxRolloutAgeDays: Math.min(3650, Math.floor(numeric.maxRolloutAgeDays)),
      maxRolloutsPerStartup: Math.min(2000, Math.floor(numeric.maxRolloutsPerStartup)),
      minRolloutIdleHours: Math.min(24 * 30, numeric.minRolloutIdleHours),
      maxStateOutputs: Math.min(5000, Math.floor(numeric.maxStateOutputs)),
      maxRecords: Math.min(50000, Math.floor(numeric.maxRecords)),
      maxSearchResults: Math.min(100, Math.floor(numeric.maxSearchResults)),
      maxResultsPerKind: Math.min(20, Math.floor(numeric.maxResultsPerKind)),
      searchNeighborWindow: Math.min(5, Math.floor(numeric.searchNeighborWindow)),
    };
    if (memoryAdvancedLimitsEqual(normalized, current)) {
      this.postMessage({ type: 'memoryAdvancedLimitsState', memoryAdvancedLimits: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('memories.maxRawMemoriesForGlobal', normalized.maxRawMemoriesForGlobal, true);
      await config.update('memories.maxRolloutAgeDays', normalized.maxRolloutAgeDays, true);
      await config.update('memories.maxRolloutsPerStartup', normalized.maxRolloutsPerStartup, true);
      await config.update('memories.minRolloutIdleHours', normalized.minRolloutIdleHours, true);
      await config.update('memories.maxStateOutputs', normalized.maxStateOutputs, true);
      await config.update('memories.maxRecords', normalized.maxRecords, true);
      await config.update('memories.maxSearchResults', normalized.maxSearchResults, true);
      await config.update('memories.maxResultsPerKind', normalized.maxResultsPerKind, true);
      await config.update('memories.searchNeighborWindow', normalized.searchNeighborWindow, true);
      this.postMessage({ type: 'memoryAdvancedLimitsState', memoryAdvancedLimits: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memory limits', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory limits. See logs for details.');
      postCurrentState();
    }
  },

  async setExplorePrepass(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'subagents.explorePrepass.enabled',
      stateType: 'explorePrepassState',
      stateField: 'explorePrepass',
      getCurrent: getExplorePrepassEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing explore prepass behavior.',
      failureNotice: 'Failed to update explore prepass behavior. See logs for details.',
      logLabel: 'Failed to persist explore prepass setting',
      extraState: async () => ({ explorePrepassMaxChars: getExplorePrepassMaxChars() }),
    });
  },

  async setExplorePrepassMaxChars(this: ChatWebviewRuntime, maxChars: number): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing explore prepass limits.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
      return;
    }

    if (!Number.isFinite(maxChars) || maxChars < 500) {
      postInputNotice(this, 'Explore prepass max chars must be at least 500.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
      return;
    }

    const normalized = Math.floor(maxChars);
    const current = getExplorePrepassMaxChars();
    if (normalized === current) {
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('subagents.explorePrepass.maxChars', normalized, true);
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist explore prepass max chars', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update explore prepass limit. See logs for details.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
    }
  },

  async setSubagentModelOverride(this: ChatWebviewRuntime, model: string): Promise<void> {
    const postCurrentState = () => this.postMessage({
      type: 'subagentModelOverrideState',
      subagentModelOverride: getSubagentModelOverride(),
    });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing the subagent model.');
      postCurrentState();
      return;
    }

    const normalized = normalizeSubagentModelOverride(model);
    const current = getSubagentModelOverride();
    if (normalized === current) {
      this.postMessage({ type: 'subagentModelOverrideState', subagentModelOverride: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('subagents.model', normalized, true);
      this.postMessage({ type: 'subagentModelOverrideState', subagentModelOverride: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist subagent model override', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update subagent model. See logs for details.');
      postCurrentState();
    }
  },

  async setSubagentTaskMaxOutputChars(this: ChatWebviewRuntime, maxChars: number): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'subagentTaskMaxOutputCharsState', subagentTaskMaxOutputChars: getSubagentTaskMaxOutputChars() });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing subagent output limits.');
      postCurrentState();
      return;
    }

    if (!Number.isFinite(maxChars) || maxChars < 500) {
      postInputNotice(this, 'Subagent task output cap must be at least 500 characters.');
      postCurrentState();
      return;
    }

    const normalized = Math.floor(maxChars);
    const current = getSubagentTaskMaxOutputChars();
    if (normalized === current) {
      this.postMessage({ type: 'subagentTaskMaxOutputCharsState', subagentTaskMaxOutputChars: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('subagents.task.maxOutputChars', normalized, true);
      this.postMessage({ type: 'subagentTaskMaxOutputCharsState', subagentTaskMaxOutputChars: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist subagent task output cap', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update subagent output limit. See logs for details.');
      postCurrentState();
    }
  },

  async setAutoCompaction(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    await updateBooleanWebviewSetting({
      runtime: this,
      configKey: 'compaction.auto',
      stateType: 'autoCompactionState',
      stateField: 'autoCompaction',
      getCurrent: getAutoCompactionEnabled,
      enabled,
      blockNotice: 'Stop the current task before changing auto-compaction behavior.',
      failureNotice: 'Failed to update auto-compaction behavior. See logs for details.',
      logLabel: 'Failed to persist auto-compaction setting',
    });
  },

  async setCompactionPruneSettings(this: ChatWebviewRuntime, settings: Partial<CompactionPruneSettings>): Promise<void> {
    const postCurrentState = () => {
      const current = getCompactionPruneSettings();
      this.postMessage({
        type: 'compactionPruneState',
        compactionPrune: current.prune,
        compactionPruneProtectTokens: current.pruneProtectTokens,
        compactionPruneMinimumTokens: current.pruneMinimumTokens,
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing compaction prune behavior.');
      postCurrentState();
      return;
    }

    const current = getCompactionPruneSettings();
    const nextPrune = settings.prune ?? current.prune;
    const nextProtectTokens = Number(settings.pruneProtectTokens ?? current.pruneProtectTokens);
    const nextMinimumTokens = Number(settings.pruneMinimumTokens ?? current.pruneMinimumTokens);
    if (typeof nextPrune !== 'boolean' || !Number.isFinite(nextProtectTokens) || nextProtectTokens < 0 || !Number.isFinite(nextMinimumTokens) || nextMinimumTokens < 0) {
      postInputNotice(this, 'Compaction prune token limits must be zero or greater.');
      postCurrentState();
      return;
    }

    const normalizedProtectTokens = Math.floor(nextProtectTokens);
    const normalizedMinimumTokens = Math.floor(nextMinimumTokens);
    const normalized: CompactionPruneSettings = {
      prune: nextPrune,
      pruneProtectTokens: normalizedProtectTokens,
      pruneMinimumTokens: normalizedMinimumTokens,
    };
    if (compactionPruneSettingsEqual(normalized, current)) {
      this.postMessage({
        type: 'compactionPruneState',
        compactionPrune: current.prune,
        compactionPruneProtectTokens: current.pruneProtectTokens,
        compactionPruneMinimumTokens: current.pruneMinimumTokens,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('compaction.prune', normalized.prune, true);
      await config.update('compaction.pruneProtectTokens', normalized.pruneProtectTokens, true);
      await config.update('compaction.pruneMinimumTokens', normalized.pruneMinimumTokens, true);
      this.postMessage({
        type: 'compactionPruneState',
        compactionPrune: normalized.prune,
        compactionPruneProtectTokens: normalized.pruneProtectTokens,
        compactionPruneMinimumTokens: normalized.pruneMinimumTokens,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist compaction prune settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update compaction prune behavior. See logs for details.');
      postCurrentState();
    }
  },

  async setCompactionToolOutputMode(this: ChatWebviewRuntime, mode: string): Promise<void> {
    const normalized = normalizeCompactionToolOutputMode(mode);
    if (!normalized) {
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: getCompactionToolOutputMode() });
      return;
    }

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing tool-output compaction behavior.');
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: getCompactionToolOutputMode() });
      return;
    }

    const current = getCompactionToolOutputMode();
    if (normalized === current) {
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('compaction.toolOutputMode', normalized, true);
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist tool-output compaction setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update tool-output compaction behavior. See logs for details.');
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: getCompactionToolOutputMode() });
    }
  },

  async setModelLimits(this: ChatWebviewRuntime, limits: ModelLimits): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'modelLimitsState', modelLimits: getModelLimits() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing model token limits.');
      postCurrentState();
      return;
    }

    const validationError = getModelLimitsValidationError(limits);
    if (validationError) {
      postInputNotice(this, validationError);
      postCurrentState();
      return;
    }

    const current = getModelLimits();
    const next = normalizeModelLimits(limits);
    if (modelLimitsEqual(next, current)) {
      this.postMessage({ type: 'modelLimitsState', modelLimits: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('modelLimits', next, true);
      this.postMessage({ type: 'modelLimitsState', modelLimits: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist model token limits', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update model token limits. See logs for details.');
      postCurrentState();
    }
  },

  async setGenerationSettings(this: ChatWebviewRuntime, settings: Partial<GenerationSettings>): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing generation settings.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }

    const currentSettings = getGenerationSettings();
    const nextTemperature = Number(settings.temperature ?? currentSettings.temperature);
    const nextTopP = Number(settings.topP ?? currentSettings.topP);
    const nextTopK = Number(settings.topK ?? currentSettings.topK);
    const nextMaxOutputTokens = Number(settings.maxOutputTokens ?? currentSettings.maxOutputTokens);
    const nextMaxIterations = Number(settings.maxIterations ?? currentSettings.maxIterations);
    const nextMaxRetries = Number(settings.maxRetries ?? currentSettings.maxRetries);
    const nextRetryWithPartialOutput = typeof settings.retryWithPartialOutput === 'boolean'
      ? settings.retryWithPartialOutput
      : currentSettings.retryWithPartialOutput;
    const nextTimeoutMs = Number(settings.timeoutMs ?? currentSettings.timeoutMs);
    const nextTextVerbosity = Object.prototype.hasOwnProperty.call(settings, 'textVerbosity')
      ? normalizeTextVerbosity(settings.textVerbosity, '__invalid__')
      : currentSettings.textVerbosity;
    if (nextTextVerbosity === '__invalid__') {
      postInputNotice(this, 'Text verbosity must be provider default, low, medium, or high.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTemperature) || nextTemperature < 0 || nextTemperature > 2) {
      postInputNotice(this, 'Temperature must be between 0 and 2.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTopP) || nextTopP < 0 || nextTopP > 1) {
      postInputNotice(this, 'Top-p must be between 0 and 1, where 0 uses the provider default.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTopK) || nextTopK < 0) {
      postInputNotice(this, 'Top-k must be zero or greater, where 0 uses the provider default.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextMaxOutputTokens) || nextMaxOutputTokens <= 0) {
      postInputNotice(this, 'Max output tokens must be a positive number.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextMaxIterations) || (nextMaxIterations !== -1 && nextMaxIterations <= 0)) {
      postInputNotice(this, 'Max iterations must be -1 for no limit or a positive number.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextMaxRetries) || nextMaxRetries < 0) {
      postInputNotice(this, 'Max retries must be zero or greater.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTimeoutMs) || nextTimeoutMs < 0) {
      postInputNotice(this, 'LLM timeout must be zero or greater.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }

    const normalizedTemperature = Math.round(nextTemperature * 100) / 100;
    const normalizedTopP = Math.round(nextTopP * 1000) / 1000;
    const normalizedTopK = Math.floor(nextTopK);
    const normalizedMaxOutputTokens = Math.floor(nextMaxOutputTokens);
    const normalizedMaxIterations = nextMaxIterations === -1 ? -1 : Math.floor(nextMaxIterations);
    const normalizedMaxRetries = Math.floor(nextMaxRetries);
    const normalizedTimeoutMs = Math.floor(nextTimeoutMs);
    const normalizedSettings: GenerationSettings = {
      temperature: normalizedTemperature,
      topP: normalizedTopP,
      topK: normalizedTopK,
      maxOutputTokens: normalizedMaxOutputTokens,
      maxIterations: normalizedMaxIterations,
      maxRetries: normalizedMaxRetries,
      retryWithPartialOutput: nextRetryWithPartialOutput,
      timeoutMs: normalizedTimeoutMs,
      textVerbosity: nextTextVerbosity,
    };
    if (generationSettingsEqual(normalizedSettings, currentSettings)) {
      this.postMessage({ type: 'generationSettingsState', generationSettings: currentSettings });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('temperature', normalizedSettings.temperature, true);
      await config.update('topP', normalizedSettings.topP, true);
      await config.update('topK', normalizedSettings.topK, true);
      await config.update('maxOutputTokens', normalizedSettings.maxOutputTokens, true);
      await config.update('maxIterations', normalizedSettings.maxIterations, true);
      await config.update('llm.maxRetries', normalizedSettings.maxRetries, true);
      await config.update('llm.retryWithPartialOutput', normalizedSettings.retryWithPartialOutput, true);
      await config.update('llm.timeoutMs', normalizedSettings.timeoutMs, true);
      await config.update('llm.textVerbosity', normalizedSettings.textVerbosity, true);
      this.postMessage({
        type: 'generationSettingsState',
        generationSettings: normalizedSettings,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist generation settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update generation settings. See logs for details.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
    }
  },

  async authenticateProvider(this: ChatWebviewRuntime): Promise<void> {
    const provider = this.llmProvider;
    if (!provider?.authenticate) {
      await service.postProviderState().catch(() => {});
      return;
    }

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before signing in to a provider.');
      await service.postProviderState().catch(() => {});
      return;
    }

    try {
      await provider.authenticate();
      provider.clearModelCache?.();
      await this.loadModels();
      await service.postProviderState();
      postInputNotice(this, `Connected to ${provider.name}.`);
    } catch (error) {
      await service.postProviderState().catch(() => {});
      postInputNotice(this, getToastErrorMessage(error, this.llmProvider?.id));
    }
  },

  async disconnectProvider(this: ChatWebviewRuntime): Promise<void> {
    const provider = this.llmProvider;
    if (!provider?.disconnect) {
      await service.postProviderState().catch(() => {});
      return;
    }

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before signing out of a provider.');
      await service.postProviderState().catch(() => {});
      return;
    }

    try {
      await provider.disconnect();
      provider.clearModelCache?.();
      await this.loadModels();
      await service.postProviderState();
      postInputNotice(this, `Disconnected ${provider.name}.`);
    } catch (error) {
      await service.postProviderState().catch(() => {});
      postInputNotice(this, getToastErrorMessage(error, this.llmProvider?.id));
    }
  },

  postMessage(this: ChatWebviewRuntime, message: unknown): void {
    this.view?.webview.postMessage(message);
  },

  getHtml(this: ChatWebviewRuntime, webview: vscode.Webview): string {
    const nonce = getNonce();
    const version = String((this.context as any)?.extension?.packageJSON?.version || '');
    const versionSuffix = version ? `(${version})` : '';

    let scripts = renderBrowserChatProtocolBootstrapScript(nonce);
    globalThis.LINGYUN_TEST_BUILD === true &&
      this.context.extensionMode === vscode.ExtensionMode.Test &&
      (scripts = `${renderWebviewTestBridgeScript(nonce)}\n${scripts}`);
    for (const parts of CHAT_WEBVIEW_SCRIPT_PARTS) {
      const uri = webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'media', ...parts)
      );
      scripts += `\n<script nonce="${nonce}" src="${String(uri)}"></script>`;
    }
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'images', 'icon.png')
    );

    const templatePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.html').fsPath;
    const template = fs.readFileSync(templatePath, 'utf8');

    return template
      .replace(/{{CSP_SOURCE}}/g, webview.cspSource)
      .replace(
        /{{CSP_SCRIPT_EXTRA}}/g,
        globalThis.LINGYUN_TEST_BUILD === true && this.context.extensionMode === vscode.ExtensionMode.Test
          ? "'unsafe-eval'"
          : ''
      )
      .replace(/{{NONCE}}/g, nonce)
      .replace(/{{SCRIPTS}}/g, scripts)
      .replace(/{{LOGO_URI}}/g, String(logoUri))
      .replace(/{{VERSION_SUFFIX}}/g, versionSuffix);
  },
  });
  globalThis.LINGYUN_TEST_BUILD === true &&
    ((service as unknown as { evaluateInWebview(expression: string): Promise<unknown> }).evaluateInWebview = (
      expression: string
    ) => evaluateInWebviewTestImpl(runtime, expression));
  Object.assign(runtime, service);
  return service as unknown as ChatWebviewService;
}

function createChatWebviewDepsForController(controller: ChatController): ChatWebviewDeps {
  return {
    context: controller.context,
    get outputChannel() {
      return controller.outputChannel;
    },
    get view() {
      return controller.view;
    },
    set view(value) {
      controller.view = value;
    },
    get viewDisposables() {
      return controller.viewDisposables;
    },
    set viewDisposables(value) {
      controller.viewDisposables = value;
    },
    get currentModel() {
      return controller.currentModel;
    },
    set currentModel(value) {
      controller.currentModel = value;
    },
    get availableModels() {
      return controller.availableModels;
    },
    set availableModels(value) {
      controller.availableModels = value;
    },
    get activeSessionId() {
      return controller.activeSessionId;
    },
    get inputHistoryEntries() {
      return controller.inputHistoryEntries;
    },
    get skillNamesForUiPromise() {
      return controller.skillNamesForUiPromise;
    },
    set skillNamesForUiPromise(value) {
      controller.skillNamesForUiPromise = value;
    },
    get mode() {
      return controller.mode;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    get autoApproveThisRun() {
      return controller.autoApproveThisRun;
    },
    set autoApproveThisRun(value) {
      controller.autoApproveThisRun = value;
    },
    get pendingApprovals() {
      return controller.pendingApprovals;
    },
    get initAcked() {
      return controller.initAcked;
    },
    set initAcked(value) {
      controller.initAcked = value;
    },
    get initInterval() {
      return controller.initInterval;
    },
    set initInterval(value) {
      controller.initInterval = value;
    },
    get initInFlight() {
      return controller.initInFlight;
    },
    set initInFlight(value) {
      controller.initInFlight = value;
    },
    get webviewClientInstanceId() {
      return controller.webviewClientInstanceId;
    },
    set webviewClientInstanceId(value) {
      controller.webviewClientInstanceId = value;
    },
    get webviewCrashToastClientId() {
      return controller.webviewCrashToastClientId;
    },
    set webviewCrashToastClientId(value) {
      controller.webviewCrashToastClientId = value;
    },
    get pendingComposerAttachments() {
      return controller.pendingComposerAttachments;
    },
    set pendingComposerAttachments(value) {
      controller.pendingComposerAttachments = value;
    },
    get composerSubmissionState() {
      return controller.composerSubmissionState;
    },
    set composerSubmissionState(value) {
      controller.composerSubmissionState = value;
    },
    get llmProvider() {
      return controller.llmProvider;
    },
    get toolDiffBeforeByToolCallId() {
      return controller.toolDiffBeforeByToolCallId;
    },
    get toolDiffSnapshotsByToolCallId() {
      return controller.toolDiffSnapshotsByToolCallId;
    },
    abortCurrentRun: (reason?: string) => controller.abortCurrentRun(reason),
    get queueManager() {
      return controller.queueManager;
    },
    get runner() {
      return controller.runner;
    },
    createNewSession: () => controller.sessionApi.createNewSession(),
    compactCurrentSession: () => controller.sessionApi.compactCurrentSession(),
    undo: () => controller.revertApi.undo(),
    redo: () => controller.revertApi.redo(),
    redoAll: () => controller.revertApi.redoAll(),
    discardUndone: (confirmed?: boolean) => controller.revertApi.discardUndone(confirmed),
    viewRevertDiff: () => controller.revertApi.viewRevertDiff(),
    switchToSession: (sessionId: string) => controller.sessionApi.switchToSession(sessionId),
    postSessions: () => controller.sessionApi.postSessions(),
    handleUserMessage: (content: string | ChatUserInput, options?: ChatUserMessageOptions) =>
      controller.runnerInputApi.handleUserMessage(content, options),
    approveAllPendingApprovals: (options?: { includeManual?: boolean }) =>
      controller.approvalsApi.approveAllPendingApprovals(options),
    postApprovalState: () => controller.approvalsApi.postApprovalState(),
    handleAlwaysAllowApproval: (approvalId: string) => controller.approvalsApi.handleAlwaysAllowApproval(approvalId),
    getAutoApprovedToolsForUI: () => controller.approvalsApi.getAutoApprovedToolsForUI(),
    revokeAutoApprovedTool: (toolId: string) => controller.approvalsApi.revokeAutoApprovedTool(toolId),
    clearAutoApprovedToolsForUI: () => controller.approvalsApi.clearAutoApprovedToolsForUI(),
    clearCurrentSession: () => controller.sessionApi.clearCurrentSession(),
    clearSavedSessions: () => controller.sessionApi.clearSavedSessions(),
    executePendingPlan: (planMessageId?: string) => controller.runnerInputApi.executePendingPlan(planMessageId),
    loadModels: () => controller.modelApi.loadModels(),
    postModelState: () => controller.modelApi.postModelState(),
    postModelPickerState: (reveal?: boolean) => controller.modelApi.postModelPickerState(reveal),
    refreshModelsForUI: () => controller.modelApi.refreshModelsForUI(),
    clearRecentModels: () => controller.modelApi.clearRecentModels(),
    setCurrentModel: (modelId: string) => controller.modelApi.setCurrentModel(modelId),
    setReasoningEffort: (reasoningEffort: string) => controller.modelApi.setReasoningEffort(reasoningEffort),
    openAdvancedModelSettings: () => controller.modelApi.openAdvancedModelSettings(),
    toggleFavoriteModel: (modelId: string) => controller.modelApi.toggleFavoriteModel(modelId),
    getActiveSession: () => controller.sessionApi.getActiveSession(),
    setModeAndPersist: (
      mode: 'build' | 'plan',
      options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
    ) => controller.modeApi.setModeAndPersist(mode, options),
    cancelPendingPlan: (planMessageId: string) => controller.runnerInputApi.cancelPendingPlan(planMessageId),
    revisePendingPlan: (planMessageId: string, instructions: string) =>
      controller.runnerInputApi.revisePendingPlan(planMessageId, instructions),
    handleApprovalResponse: (approvalId: string, approved: boolean) =>
      controller.approvalsApi.handleApprovalResponse(approvalId, approved),
    retryToolCall: (approvalId: string) => controller.runnerInputApi.retryToolCall(approvalId),
    ensureSessionsLoaded: () => controller.sessionApi.ensureSessionsLoaded(),
    onSessionPersistenceConfigChanged: () => controller.sessionApi.onSessionPersistenceConfigChanged(),
    getModelLabel: (modelId: string) => controller.modelApi.getModelLabel(modelId),
    getRenderableMessages: () => controller.sessionApi.getRenderableMessages(),
    getRevertBarStateForUI: () => controller.revertApi.getRevertBarStateForUI(),
    getContextForUI: () => controller.sessionApi.getContextForUI(),
    getSessionsForUI: () => controller.sessionApi.getSessionsForUI(),
    getSkillNamesForUI: () => controller.skillsApi.getSkillNamesForUI(),
    getUndoRedoAvailability: () => controller.revertApi.getUndoRedoAvailability(),
    isModelFavorite: (modelId: string) => controller.modelApi.isModelFavorite(modelId),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
  };
}

export function createChatWebviewServiceForController(controller: ChatController): ChatWebviewService {
  return createChatWebviewService(createChatWebviewDepsForController(controller));
}
