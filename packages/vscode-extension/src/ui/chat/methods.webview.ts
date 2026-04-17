import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readTodos } from '../../core/todo';
import { appendErrorLog } from '../../core/logger';
import { getConfiguredReasoningEffort } from '../../core/reasoningEffort';
import type { ModelInfo } from '../../providers/modelCatalog';
import type { LLMProviderWithUi, ProviderAuthUiState } from '../../providers/providerUi';
import { formatErrorForUser, getNonce } from './utils';
import { getWorkspaceFolderUrisByPriority, resolveExistingFilePath } from './fileLinks';
import { buildApprovalStateForUI } from './approvalState';
import type { PendingApprovalEntry } from './controllerPorts';
import type { ChatImageAttachment, ChatUserInput } from './types';
import { bindChatControllerService } from './controllerService';
import { createLingyunDiffUri } from './diffContentProvider';
import type { AgentLoop } from '../../core/agent';
import type { ChatLoopService } from './methods.loop';
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
  WEBVIEW_MESSAGE_ERROR,
  WEBVIEW_MESSAGE_INIT_ACK,
  WEBVIEW_MESSAGE_READY,
} from './webviewProtocol';
import { handleWebviewInitAckMessage, handleWebviewReadyMessage } from './webviewHandshake';
import { handleWebviewCrashMessage, resetWebviewCrashToastState } from './webviewCrash';

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeCandidatePath(raw: string): string {
  let value = stripWrappingQuotes(raw || '');
  if (!value) return '';
  if (value.startsWith('file://')) {
    try {
      return vscode.Uri.parse(value).fsPath;
    } catch {
      // ignore
    }
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    try {
      value = path.join(os.homedir(), value.slice(2));
    } catch {
      // ignore
    }
  }
  return value;
}

const MAX_WEBVIEW_IMAGE_ATTACHMENTS = 8;
const MAX_WEBVIEW_IMAGE_DATA_URL_LENGTH = 12_000_000;

function parseWebviewImageAttachments(raw: unknown): ChatImageAttachment[] {
  if (!Array.isArray(raw)) return [];

  const normalized: ChatImageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const record = item as Record<string, unknown>;
    const mediaType = typeof record.mediaType === 'string' ? record.mediaType.trim() : '';
    const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl.trim() : '';
    const filenameRaw = typeof record.filename === 'string' ? record.filename.trim() : '';

    if (!mediaType.toLowerCase().startsWith('image/')) continue;
    if (!dataUrl.startsWith('data:image/')) continue;
    if (dataUrl.length > MAX_WEBVIEW_IMAGE_DATA_URL_LENGTH) continue;

    normalized.push({
      mediaType,
      dataUrl,
      ...(filenameRaw ? { filename: filenameRaw } : {}),
    });

    if (normalized.length >= MAX_WEBVIEW_IMAGE_ATTACHMENTS) break;
  }

  return normalized;
}

function getToastErrorMessage(error: unknown, llmProviderId?: string): string {
  const formatted = formatErrorForUser(error, { llmProviderId });
  const firstLine = formatted
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  return firstLine || 'Unknown error';
}

export interface ChatWebviewService {
  resolveWebviewView(webviewView: vscode.WebviewView): void;
  startInitPusher(): void;
  sendInit(force?: boolean): Promise<void>;
  getProviderAuthStateForUI(): Promise<ProviderAuthUiState>;
  postProviderState(): Promise<void>;
  authenticateProvider(): Promise<void>;
  disconnectProvider(): Promise<void>;
  postMessage(message: unknown): void;
  getHtml(webview: vscode.Webview): string;
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
  mode: 'build' | 'plan';
  isProcessing: boolean;
  abortRequested: boolean;
  autoApproveThisRun: boolean;
  pendingApprovals: Map<string, PendingApprovalEntry>;
  initAcked: boolean;
  initInterval?: NodeJS.Timeout;
  initInFlight: boolean;
  webviewClientInstanceId?: string;
  webviewCrashToastClientId?: string;
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
  agent: Pick<AgentLoop, 'abort'>;
  queueManager: Pick<ChatQueueManager, 'clearActiveSession' | 'flushAutosendForActiveSession' | 'getQueuedInputs'>;
  runner: Pick<RunCoordinator, 'steerQueuedInput'>;
  createNewSession(): Promise<void>;
  compactCurrentSession(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  redoAll(): Promise<void>;
  discardUndone(): Promise<void>;
  viewRevertDiff(): Promise<void>;
  switchToSession(sessionId: string): Promise<void>;
  handleUserMessage(content: string | ChatUserInput): Promise<void>;
  configureLoopForActiveSession(): Promise<void>;
  approveAllPendingApprovals(options?: { includeManual?: boolean }): void;
  handleAlwaysAllowApproval(approvalId: string): Promise<void>;
  rejectAllPendingApprovals(reason: string): void;
  clearCurrentSession(): Promise<void>;
  executePendingPlan(planMessageId?: string): Promise<void>;
  loadModels(): Promise<void>;
  pickModel(): Promise<void>;
  setCurrentModel(modelId: string): Promise<void>;
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
  markActiveStepStatus(status: 'running' | 'done' | 'error' | 'canceled'): void;
  ensureSessionsLoaded(): Promise<void>;
  getModelLabel(modelId: string): string;
  getRenderableMessages(): ReturnType<ChatSessionsService['getRenderableMessages']>;
  getRevertBarStateForUI(): ReturnType<ChatRevertService['getRevertBarStateForUI']>;
  getContextForUI(): ReturnType<ChatSessionsService['getContextForUI']>;
  getLoopStateForUI(): ReturnType<ChatLoopService['getLoopStateForUI']>;
  getSessionsForUI(): ReturnType<ChatSessionsService['getSessionsForUI']>;
  getSkillNamesForUI(): Promise<Awaited<ReturnType<ChatSkillsService['getSkillNamesForUI']>>>;
  getUndoRedoAvailability(): ReturnType<ChatRevertService['getUndoRedoAvailability']>;
  isModelFavorite(modelId: string): Promise<boolean>;
  persistActiveSession(): void;
  postMessage(message: unknown): void;
}

type ChatWebviewRuntime = ChatWebviewDeps & ChatWebviewService;

type BrowserChatProtocol = {
  ready: typeof WEBVIEW_MESSAGE_READY;
  initAck: typeof WEBVIEW_MESSAGE_INIT_ACK;
  webviewError: typeof WEBVIEW_MESSAGE_ERROR;
};

type ChatWebviewInitMessage = {
  type: 'init';
  sessions: ReturnType<ChatSessionsService['getSessionsForUI']>;
  activeSessionId: string;
  messages: ReturnType<ChatSessionsService['getRenderableMessages']>;
  inputHistory: string[];
  revertState: ReturnType<ChatRevertService['getRevertBarStateForUI']>;
  context: ReturnType<ChatSessionsService['getContextForUI']>;
  todos: Awaited<ReturnType<typeof readTodos>>;
  loop: ReturnType<ChatLoopService['getLoopStateForUI']>;
  currentModel: string;
  currentModelLabel: string;
  currentModelIsFavorite: boolean;
  currentReasoningEffort: ReturnType<typeof getConfiguredReasoningEffort>;
  providerAuth: ProviderAuthUiState;
  mode: 'build' | 'plan';
  planPending: boolean;
  activePlanMessageId: string;
  processing: boolean;
  queuedInputs: ReturnType<ChatQueueManager['getQueuedInputs']>;
  pendingApprovals: number;
  manualApprovals: number;
  autoApproveThisRun: boolean;
  skills: Awaited<ReturnType<ChatSkillsService['getSkillNamesForUI']>>;
} & ReturnType<ChatRevertService['getUndoRedoAvailability']>;

function createBrowserChatProtocol(): BrowserChatProtocol {
  return {
    ready: WEBVIEW_MESSAGE_READY,
    initAck: WEBVIEW_MESSAGE_INIT_ACK,
    webviewError: WEBVIEW_MESSAGE_ERROR,
  };
}

function renderBrowserChatProtocolBootstrapScript(nonce: string): string {
  const protocolJson = JSON.stringify(createBrowserChatProtocol());
  return `<script nonce="${nonce}">window.LINGYUN_CHAT_PROTOCOL = Object.freeze(${protocolJson});</script>`;
}

async function buildWebviewInitMessage(
  runtime: ChatWebviewRuntime,
  params: { modelLabel: string; currentModelIsFavorite: boolean }
): Promise<ChatWebviewInitMessage> {
  const todos = await readTodos(runtime.context, runtime.activeSessionId);
  const skills = await runtime.getSkillNamesForUI();
  const providerAuth = await runtime.getProviderAuthStateForUI();
  const pendingPlan = runtime.getActiveSession().pendingPlan;
  const approvalState = buildApprovalStateForUI({
    pendingApprovals: runtime.pendingApprovals,
    autoApproveThisRun: runtime.autoApproveThisRun,
  });

  return {
    type: 'init',
    sessions: runtime.getSessionsForUI(),
    activeSessionId: runtime.activeSessionId,
    messages: runtime.getRenderableMessages(),
    inputHistory: runtime.inputHistoryEntries,
    revertState: runtime.getRevertBarStateForUI(),
    context: runtime.getContextForUI(),
    todos,
    loop: runtime.getLoopStateForUI(),
    currentModel: runtime.currentModel,
    currentModelLabel: params.modelLabel,
    currentModelIsFavorite: params.currentModelIsFavorite,
    currentReasoningEffort: getConfiguredReasoningEffort(),
    providerAuth,
    mode: runtime.mode,
    planPending: !!pendingPlan,
    activePlanMessageId: pendingPlan?.planMessageId ?? '',
    processing: runtime.isProcessing,
    queuedInputs: runtime.queueManager.getQueuedInputs(),
    pendingApprovals: approvalState.count,
    manualApprovals: approvalState.manualCount,
    autoApproveThisRun: approvalState.autoApproveThisRun,
    skills,
    ...runtime.getUndoRedoAvailability(),
  };
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
        if (this.initInterval) {
          clearInterval(this.initInterval);
          this.initInterval = undefined;
        }
      })
    );

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (data) => {
        switch (getWebviewMessageType(data)) {
          case 'newSession':
            await this.createNewSession();
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

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;

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
                  void vscode.window.showWarningMessage(`LingYun: ${blockedExternalMessage}`);
                } else {
                  void vscode.window.showInformationMessage('LingYun: file not found.');
                }
                break;
              }

              const doc = await vscode.workspace.openTextDocument(resolved.uri);
              const editor = await vscode.window.showTextDocument(doc, { preview: false });
              const pos = new vscode.Position(line - 1, character - 1);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            } catch {
              // ignore open failures
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

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;

            const deduped: string[] = [];
            const seen = new Set<string>();
            for (const item of candidatesRaw) {
              const raw =
                item && typeof item === 'object' && typeof (item as any).raw === 'string'
                  ? String((item as any).raw).trim()
                  : '';
              if (!raw) continue;
              if (seen.has(raw)) continue;
              seen.add(raw);
              deduped.push(raw);
              if (deduped.length >= 200) break;
            }

            const results: Array<{ raw: string; ok: boolean; path?: string }> = [];

            for (const raw of deduped) {
              const normalized = normalizeCandidatePath(raw);
              if (!normalized) {
                results.push({ raw, ok: false });
                continue;
              }
              const candidates: string[] = [];
              if ((normalized.startsWith('a/') || normalized.startsWith('b/')) && normalized.length > 2) {
                candidates.push(normalized.slice(2));
              }
              candidates.push(normalized);

              let resolved:
                | { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }
                | undefined;

              for (const candidate of candidates) {
                const attempt = await resolveExistingFilePath(candidate, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                  break;
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
              void vscode.window.showInformationMessage(
                'LingYun: diff snapshot is unavailable (try rerunning the tool).'
              );
              break;
            }

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;
            if (!allowExternalPaths && snapshot.isExternal) {
              void vscode.window.showWarningMessage(
                'LingYun: external paths are disabled. Enable lingyun.security.allowExternalPaths to view this diff.'
              );
              break;
            }

            const fileName = path.basename(snapshot.absPath || snapshot.displayPath || 'file');
            const left = createLingyunDiffUri({ toolCallId, side: 'before', fileName });
            const right = createLingyunDiffUri({ toolCallId, side: 'after', fileName });
            const title = `LingYun Diff: ${snapshot.displayPath || fileName}`;

            try {
              await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
            } catch {
              void vscode.window.showErrorMessage('LingYun: failed to open diff editor.');
            }

            break;
          }
          case 'compactSession':
            await this.compactCurrentSession();
            break;
          case 'undo':
            await this.undo();
            break;
          case 'redo':
            await this.redo();
            break;
          case 'redoAll':
            await this.redoAll();
            break;
          case 'discardUndone':
            await this.discardUndone();
            break;
          case 'viewRevertDiff':
            await this.viewRevertDiff();
            break;
          case 'switchSession':
            if (typeof data.sessionId === 'string') {
              await this.switchToSession(data.sessionId);
            }
            break;
          case 'send':
            {
              const payload = data as Record<string, unknown>;
              const input: ChatUserInput = {
                message: typeof payload.message === 'string' ? payload.message : '',
                attachments: parseWebviewImageAttachments(payload.attachments),
              };
              await this.handleUserMessage(input);
            }
            break;
          case 'clearQueue': {
            this.queueManager.clearActiveSession();
            break;
          }
          case 'configureLoop':
            await this.configureLoopForActiveSession();
            break;
          case 'steerQueuedInput': {
            const id = typeof (data as any).id === 'string' ? String((data as any).id) : '';
            if (!id) break;
            await this.runner.steerQueuedInput(id);
            break;
          }
          case 'abort':
            // If we're blocked waiting for tool approval, resolve those promises so the agent can unwind.
            this.rejectAllPendingApprovals('Canceled by user.');
            this.agent.abort();
            this.abortRequested = true;
            this.markActiveStepStatus('canceled');
            this.persistActiveSession();
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
          case 'pickModel':
            await this.pickModel();
            break;
          case 'authenticateProvider':
            await service.authenticateProvider();
            break;
          case 'disconnectProvider':
            await service.disconnectProvider();
            break;
          case 'changeModel':
            if (typeof data.model === 'string') {
              await this.setCurrentModel(data.model);
            }
            break;
          case 'toggleFavoriteModel': {
            const modelId =
              typeof data.model === 'string' && data.model.trim()
                ? data.model.trim()
                : this.currentModel;
            if (modelId) {
              await this.toggleFavoriteModel(modelId);
            }
            break;
          }
          case 'changeMode':
            if (this.isProcessing) {
              vscode.window.showInformationMessage(
                'LingYun: Stop the current task before switching modes.'
              );
              break;
            }
            if (data.mode !== 'plan' && data.mode !== 'build') break;
            if (data.mode === 'build') {
              const pendingPlan = this.getActiveSession().pendingPlan;
              if (pendingPlan) {
                await this.executePendingPlan(pendingPlan.planMessageId);
                break;
              }
            }
            await this.setModeAndPersist(data.mode);
            break;
          case 'executePlan':
            await this.executePendingPlan(
              typeof data.planMessageId === 'string' ? data.planMessageId : undefined
            );
            break;
          case 'cancelPlan':
            if (this.getActiveSession().pendingPlan?.planMessageId === data.planMessageId) {
              const choice = await vscode.window.showWarningMessage(
                'Cancel this plan?',
                { modal: true },
                'Cancel Plan'
              );
              if (choice !== 'Cancel Plan') return;
            }
            await this.cancelPendingPlan(data.planMessageId);
            break;
          case 'revisePlan':
            {
              const pendingPlan = this.getActiveSession().pendingPlan;
              if (!pendingPlan) return;
              if (pendingPlan.planMessageId !== data.planMessageId) return;
            }

            if (typeof data.instructions === 'string' && data.instructions.trim()) {
              await this.revisePendingPlan(data.planMessageId, data.instructions);
              return;
            }

            {
              const instructions = await vscode.window.showInputBox({
                title: 'Revise plan',
                prompt: 'Answer the plan questions or add constraints',
                placeHolder: 'e.g. Use TypeScript, keep changes minimal, focus on UI streaming, …',
                ignoreFocusOut: true,
              });

              if (instructions && instructions.trim()) {
                await this.revisePendingPlan(data.planMessageId, instructions.trim());
              }
            }
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
            }
            break;
          case 'alwaysAllowTool': {
            if (typeof data.approvalId === 'string' && data.approvalId.trim()) {
              await this.handleAlwaysAllowApproval(data.approvalId.trim());
            }
            break;
          }
          case WEBVIEW_MESSAGE_ERROR: {
            const message = parseWebviewErrorMessage(data);
            handleWebviewCrashMessage(this, message?.error);
            break;
          }
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
    try {
      await this.ensureSessionsLoaded();
      if (this.availableModels.length === 0) {
        await this.loadModels();
      }

      const modelLabel = this.getModelLabel(this.currentModel) || this.currentModel;
      const currentModelIsFavorite = await this.isModelFavorite(this.currentModel);
      this.postMessage(
        await buildWebviewInitMessage(this, {
          modelLabel,
          currentModelIsFavorite,
        })
      );
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
      } catch (postError) {
        appendErrorLog(this.outputChannel, 'Failed to post init fallback', postError, {
          tag: 'Webview',
        });
      }
    } finally {
      this.initInFlight = false;
      void this.queueManager.flushAutosendForActiveSession();
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
    this.postMessage({ type: 'providerState', providerAuth });
  },

  async authenticateProvider(this: ChatWebviewRuntime): Promise<void> {
    const provider = this.llmProvider;
    if (!provider?.authenticate) return;

    try {
      await provider.authenticate();
      provider.clearModelCache?.();
      await this.loadModels();
      await service.postProviderState();
      void vscode.window.showInformationMessage(`LingYun: Connected to ${provider.name}.`);
    } catch (error) {
      await service.postProviderState().catch(() => {});
      void vscode.window.showErrorMessage(`LingYun: ${getToastErrorMessage(error, this.llmProvider?.id)}`);
    }
  },

  async disconnectProvider(this: ChatWebviewRuntime): Promise<void> {
    const provider = this.llmProvider;
    if (!provider?.disconnect) return;

    try {
      await provider.disconnect();
      provider.clearModelCache?.();
      await this.loadModels();
      await service.postProviderState();
      void vscode.window.showInformationMessage(`LingYun: Disconnected ${provider.name}.`);
    } catch (error) {
      await service.postProviderState().catch(() => {});
      void vscode.window.showErrorMessage(`LingYun: ${getToastErrorMessage(error, this.llmProvider?.id)}`);
    }
  },

  postMessage(this: ChatWebviewRuntime, message: unknown): void {
    this.view?.webview.postMessage(message);
  },

  getHtml(this: ChatWebviewRuntime, webview: vscode.Webview): string {
    const nonce = getNonce();
    const version = String((this.context as any)?.extension?.packageJSON?.version || '');
    const versionSuffix = version ? `(${version})` : '';

    const scriptFiles = [
      ['chat', 'bootstrap.js'],
      ['chat', 'render-utils.js'],
      ['chat', 'render-messages.js'],
      ['chat', 'context.js'],
      ['chat', 'main.js'],
    ];
    const scripts = [
      renderBrowserChatProtocolBootstrapScript(nonce),
      ...scriptFiles.map(parts => {
        const uri = webview.asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'media', ...parts)
        );
        return `<script nonce="${nonce}" src="${String(uri)}"></script>`;
      }),
    ].join('\n');
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'images', 'icon.png')
    );

    const templatePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.html').fsPath;
    const template = fs.readFileSync(templatePath, 'utf8');

    return template
      .replace(/{{CSP_SOURCE}}/g, webview.cspSource)
      .replace(/{{NONCE}}/g, nonce)
      .replace(/{{SCRIPTS}}/g, scripts)
      .replace(/{{LOGO_URI}}/g, String(logoUri))
      .replace(/{{VERSION_SUFFIX}}/g, versionSuffix);
  },
  });
  Object.assign(runtime, service);
  return service;
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
    get mode() {
      return controller.mode;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    get abortRequested() {
      return controller.abortRequested;
    },
    set abortRequested(value) {
      controller.abortRequested = value;
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
    get llmProvider() {
      return controller.llmProvider;
    },
    get toolDiffBeforeByToolCallId() {
      return controller.toolDiffBeforeByToolCallId;
    },
    get toolDiffSnapshotsByToolCallId() {
      return controller.toolDiffSnapshotsByToolCallId;
    },
    get agent() {
      return controller.agent;
    },
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
    discardUndone: () => controller.revertApi.discardUndone(),
    viewRevertDiff: () => controller.revertApi.viewRevertDiff(),
    switchToSession: (sessionId: string) => controller.sessionApi.switchToSession(sessionId),
    handleUserMessage: (content: string | ChatUserInput) => controller.runnerInputApi.handleUserMessage(content),
    configureLoopForActiveSession: () => controller.loopApi.configureLoopForActiveSession(),
    approveAllPendingApprovals: (options?: { includeManual?: boolean }) =>
      controller.approvalsApi.approveAllPendingApprovals(options),
    handleAlwaysAllowApproval: (approvalId: string) => controller.approvalsApi.handleAlwaysAllowApproval(approvalId),
    rejectAllPendingApprovals: (reason: string) => controller.approvalsApi.rejectAllPendingApprovals(reason),
    clearCurrentSession: () => controller.sessionApi.clearCurrentSession(),
    executePendingPlan: (planMessageId?: string) => controller.runnerPlanApi.executePendingPlan(planMessageId),
    loadModels: () => controller.modelApi.loadModels(),
    pickModel: () => controller.modelApi.pickModel(),
    setCurrentModel: (modelId: string) => controller.modelApi.setCurrentModel(modelId),
    toggleFavoriteModel: (modelId: string) => controller.modelApi.toggleFavoriteModel(modelId),
    getActiveSession: () => controller.sessionApi.getActiveSession(),
    setModeAndPersist: (
      mode: 'build' | 'plan',
      options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
    ) => controller.modeApi.setModeAndPersist(mode, options),
    cancelPendingPlan: (planMessageId: string) => controller.runnerPlanApi.cancelPendingPlan(planMessageId),
    revisePendingPlan: (planMessageId: string, instructions: string) =>
      controller.runnerPlanApi.revisePendingPlan(planMessageId, instructions),
    handleApprovalResponse: (approvalId: string, approved: boolean) =>
      controller.approvalsApi.handleApprovalResponse(approvalId, approved),
    retryToolCall: (approvalId: string) => controller.runnerInputApi.retryToolCall(approvalId),
    markActiveStepStatus: (status: 'running' | 'done' | 'error' | 'canceled') =>
      controller.approvalsApi.markActiveStepStatus(status),
    ensureSessionsLoaded: () => controller.sessionApi.ensureSessionsLoaded(),
    getModelLabel: (modelId: string) => controller.modelApi.getModelLabel(modelId),
    getRenderableMessages: () => controller.sessionApi.getRenderableMessages(),
    getRevertBarStateForUI: () => controller.revertApi.getRevertBarStateForUI(),
    getContextForUI: () => controller.sessionApi.getContextForUI(),
    getLoopStateForUI: () => controller.loopApi.getLoopStateForUI(),
    getSessionsForUI: () => controller.sessionApi.getSessionsForUI(),
    getSkillNamesForUI: () => controller.skillsApi.getSkillNamesForUI(),
    getUndoRedoAvailability: () => controller.revertApi.getUndoRedoAvailability(),
    isModelFavorite: (modelId: string) => controller.modelApi.isModelFavorite(modelId),
    persistActiveSession: () => controller.sessionApi.persistActiveSession(),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
  };
}

export function createChatWebviewServiceForController(controller: ChatController): ChatWebviewService {
  return createChatWebviewService(createChatWebviewDepsForController(controller));
}
