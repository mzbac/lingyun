import * as vscode from 'vscode';
import * as path from 'path';
import type { AgentSessionState } from '../../core/agent';
import { findGitRoot } from '../../core/instructions';
import { getSnapshotProjectId, WorkspaceSnapshot, type SnapshotPatch } from '../../core/snapshot';
import { getPrimaryWorkspaceFolderUri } from '../../core/workspaceContext';
import type { ChatMessage, RevertBarState } from './types';
import { bindChatControllerService } from './controllerService';
import type { AgentLoop } from '../../core/agent';
import type { ChatController } from './controller';
import type { PendingApprovalEntry } from './controllerPorts';
import type { ChatLoopManager } from './loopManager';
import type { ChatSessionsService } from './methods.sessions';

function derivePendingPlanFromMessages(
  messages: ChatMessage[],
  params?: {
    beforeIndex?: number;
    fallback?: { task: string; planMessageId: string };
  },
): { task: string; planMessageId: string } | undefined {
  const limit = typeof params?.beforeIndex === 'number' ? params.beforeIndex : messages.length;
  for (let i = Math.min(messages.length, limit) - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'plan') continue;

    const status = msg.plan?.status;
    if (status === 'done' || status === 'canceled') continue;

    const task =
      typeof msg.plan?.task === 'string'
        ? msg.plan.task.trim()
        : params?.fallback?.planMessageId === msg.id
          ? params.fallback.task.trim()
          : '';
    if (!task) continue;

    return { task, planMessageId: msg.id };
  }
  return undefined;
}

function cloneAgentState(state: AgentSessionState): AgentSessionState {
  try {
    return structuredClone(state);
  } catch {
    return JSON.parse(JSON.stringify(state)) as AgentSessionState;
  }
}

export interface ChatRevertService {
  getWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined>;
  getUndoRedoAvailability(): { canUndo: boolean; canRedo: boolean };
  getRevertBarStateForUI(): RevertBarState | null;
  postRevertBarState(): void;
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
}

export interface ChatRevertDeps {
  context: vscode.ExtensionContext;
  view?: vscode.WebviewView;
  snapshot?: WorkspaceSnapshot;
  snapshotUnavailableReason?: string;
  messages: ChatMessage[];
  isProcessing: boolean;
  currentModel: string;
  mode: 'build' | 'plan';
  pendingApprovals: Map<string, PendingApprovalEntry>;
  agent: Pick<AgentLoop, 'clear' | 'exportState' | 'syncSession'>;
  loopManager: Pick<ChatLoopManager, 'releaseSession' | 'syncActiveSession'>;
  ensureSessionsLoaded(): Promise<void>;
  getActiveSession(): ReturnType<ChatSessionsService['getActiveSession']>;
  persistActiveSession(): void;
  postLoopState(session?: ReturnType<ChatSessionsService['getActiveSession']>): void;
  sendInit(force?: boolean): Promise<void>;
  postMessage(message: unknown): void;
}

type ChatRevertRuntime = ChatRevertDeps & ChatRevertService;

export function createChatRevertService(controller: ChatRevertDeps): ChatRevertService {
  const runtime = controller as ChatRevertRuntime;
  const service = bindChatControllerService(runtime, {
  async getWorkspaceSnapshot(this: ChatRevertRuntime): Promise<WorkspaceSnapshot | undefined> {
    if (this.snapshot) return this.snapshot;
    if (this.snapshotUnavailableReason) return undefined;

    const workspaceRoot = getPrimaryWorkspaceFolderUri();
    if (!workspaceRoot || workspaceRoot.scheme !== 'file') {
      this.snapshotUnavailableReason = 'No workspace folder available for snapshots.';
      return undefined;
    }

    const gitRoot = await findGitRoot(workspaceRoot, workspaceRoot);
    const gitMarker = vscode.Uri.joinPath(gitRoot, '.git');
    try {
      await vscode.workspace.fs.stat(gitMarker);
    } catch {
      this.snapshotUnavailableReason = 'Undo/redo requires a Git repository in the workspace.';
      return undefined;
    }

    const storageBase = this.context.storageUri ?? this.context.globalStorageUri;
    if (!storageBase || storageBase.scheme !== 'file') {
      this.snapshotUnavailableReason = 'VS Code storage is not available for snapshots.';
      return undefined;
    }

    const projectId = await getSnapshotProjectId(gitRoot.fsPath);
    const storageDir = path.join(storageBase.fsPath, 'snapshot', projectId);
    this.snapshot = new WorkspaceSnapshot({ worktree: gitRoot.fsPath, storageDir });
    return this.snapshot;
  },

  getUndoRedoAvailability(this: ChatRevertRuntime): { canUndo: boolean; canRedo: boolean } {
    const session = this.getActiveSession();
    const boundaryId = session.revert?.messageId;

    const boundaryIndex = boundaryId
      ? this.messages.findIndex(m => m.id === boundaryId)
      : this.messages.length;
    const canUndo = [...this.messages]
      .slice(0, Math.max(0, boundaryIndex))
      .some(m => m.role === 'user');

    const canRedo = !!boundaryId && boundaryIndex >= 0 && boundaryIndex < this.messages.length;
    return { canUndo, canRedo };
  },

  getRevertBarStateForUI(this: ChatRevertRuntime): RevertBarState | null {
    const session = this.getActiveSession();
    const boundaryId = session.revert?.messageId;
    if (!boundaryId) return null;

    const boundaryIndex = this.messages.findIndex(m => m.id === boundaryId);
    if (boundaryIndex < 0) return null;

    const revertedUsers = this.messages.slice(boundaryIndex).filter(m => m.role === 'user').length;
    const files = Array.isArray(session.revert?.files) ? session.revert.files : [];

    return {
      active: true,
      revertedMessages: revertedUsers,
      files,
    };
  },

  postRevertBarState(this: ChatRevertRuntime): void {
    if (!this.view) return;
    this.postMessage({
      type: 'revertState',
      revertState: this.getRevertBarStateForUI(),
      ...this.getUndoRedoAvailability(),
    });
  },

  async undo(this: ChatRevertRuntime): Promise<void> {
    if (this.isProcessing) {
      void vscode.window.showInformationMessage('LingYun: Stop the current task before undo.');
      return;
    }

    await this.ensureSessionsLoaded();

    const session = this.getActiveSession();
    const boundaryId = session.revert?.messageId;
    const boundaryIndex = boundaryId
      ? this.messages.findIndex(m => m.id === boundaryId)
      : this.messages.length;

    const userIndex = (() => {
      for (let i = Math.min(this.messages.length, boundaryIndex) - 1; i >= 0; i--) {
        if (this.messages[i]?.role === 'user') return i;
      }
      return -1;
    })();

    if (userIndex === -1) {
      void vscode.window.showInformationMessage('LingYun: Nothing to undo.');
      return;
    }

    const target = this.messages[userIndex];
    await this.applyRevert(target.id);
    this.postMessage({ type: 'setInput', value: target.content || '' });
  },

  async redo(this: ChatRevertRuntime): Promise<void> {
    if (this.isProcessing) {
      void vscode.window.showInformationMessage('LingYun: Stop the current task before redo.');
      return;
    }

    await this.ensureSessionsLoaded();

    const session = this.getActiveSession();
    if (!session.revert) {
      void vscode.window.showInformationMessage('LingYun: Nothing to redo.');
      return;
    }

    const boundaryIndex = this.messages.findIndex(m => m.id === session.revert?.messageId);
    if (boundaryIndex === -1) {
      session.revert = undefined;
      await this.sendInit(true);
      return;
    }

    for (let i = boundaryIndex + 1; i < this.messages.length; i++) {
      if (this.messages[i]?.role === 'user') {
        await this.applyRevert(this.messages[i].id);
        return;
      }
    }

    await this.clearRevert();
  },

  async redoAll(this: ChatRevertRuntime): Promise<void> {
    if (this.isProcessing) {
      void vscode.window.showInformationMessage('LingYun: Stop the current task before redo.');
      return;
    }

    await this.ensureSessionsLoaded();

    const session = this.getActiveSession();
    if (!session.revert) {
      void vscode.window.showInformationMessage('LingYun: Nothing to redo.');
      return;
    }

    await this.clearRevert();
  },

  async discardUndone(this: ChatRevertRuntime): Promise<void> {
    if (this.isProcessing) {
      void vscode.window.showInformationMessage('LingYun: Stop the current task before discarding.');
      return;
    }

    await this.ensureSessionsLoaded();

    const session = this.getActiveSession();
    if (!session.revert) {
      void vscode.window.showInformationMessage('LingYun: Nothing to discard.');
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      'Discard undone history? This cannot be undone.',
      { modal: true },
      'Discard'
    );
    if (choice !== 'Discard') return;

    this.commitRevertedConversationIfNeeded();
  },

  async viewRevertDiff(this: ChatRevertRuntime): Promise<void> {
    await this.ensureSessionsLoaded();

    const session = this.getActiveSession();
    const revert = session.revert;
    if (!revert) {
      void vscode.window.showInformationMessage('LingYun: No undo state to show.');
      return;
    }

    const snapshot = await this.getWorkspaceSnapshot();
    if (!snapshot) {
      void vscode.window.showWarningMessage(
        this.snapshotUnavailableReason || 'LingYun: Undo/redo is unavailable.'
      );
      return;
    }

    try {
      const diff = await snapshot.diff(revert.snapshotHash);
      if (!diff.trim()) {
        void vscode.window.showInformationMessage('LingYun: No changes to show.');
        return;
      }

      const doc = await vscode.workspace.openTextDocument({ language: 'diff', content: diff });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `LingYun: Failed to show changes: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  commitRevertedConversationIfNeeded(this: ChatRevertRuntime): void {
    const session = this.getActiveSession();
    if (!session.revert) return;

    const previousPendingPlan = session.pendingPlan;

    const boundaryIndex = this.messages.findIndex(m => m.id === session.revert?.messageId);
    if (boundaryIndex >= 0) {
      this.messages.splice(boundaryIndex);
    }

    session.revert = undefined;
    this.pendingApprovals.clear();
    session.pendingPlan = derivePendingPlanFromMessages(this.messages, { fallback: previousPendingPlan });
    this.loopManager.syncActiveSession();
    this.persistActiveSession();
    this.postMessage({
      type: 'planPending',
      value: !!session.pendingPlan,
      planMessageId: session.pendingPlan?.planMessageId ?? '',
    });
    this.postLoopState(session);
    this.postRevertBarState();
  },

  collectPatchesFromIndex(this: ChatRevertRuntime, startIndex: number): SnapshotPatch[] {
    const patches: SnapshotPatch[] = [];
    for (const msg of this.messages.slice(Math.max(0, startIndex))) {
      if (msg.role !== 'step') continue;
      const patch = msg.step?.patch;
      if (!patch?.baseHash || !Array.isArray(patch.files) || patch.files.length === 0) continue;
      patches.push({ baseHash: patch.baseHash, files: patch.files });
    }
    return patches;
  },

  deriveAgentStateBeforeUserMessage(
    this: ChatRevertRuntime,
    params: { baseline: AgentSessionState; boundaryIndex: number }
  ): AgentSessionState {
    const { baseline, boundaryIndex } = params;
    const boundaryMsg = this.messages[boundaryIndex];

    const checkpoint = boundaryMsg?.checkpoint;
    if (
      checkpoint &&
      typeof checkpoint.historyLength === 'number' &&
      checkpoint.historyLength >= 0 &&
      Number.isFinite(checkpoint.historyLength)
    ) {
      const length = Math.min(baseline.history.length, Math.floor(checkpoint.historyLength));
      return {
        ...baseline,
        history: baseline.history.slice(0, length),
      };
    }

    const chatUserCount = this.messages.slice(0, boundaryIndex + 1).filter(m => m.role === 'user').length;

    const userIndices: number[] = [];
    for (let i = 0; i < baseline.history.length; i++) {
      if (baseline.history[i]?.role === 'user') userIndices.push(i);
    }

    const boundaryHistoryIndex = chatUserCount > 0 ? userIndices[chatUserCount - 1] : undefined;
    if (typeof boundaryHistoryIndex === 'number') {
      return {
        ...baseline,
        history: baseline.history.slice(0, boundaryHistoryIndex),
      };
    }

    return {
      ...baseline,
      history: baseline.history.slice(0, Math.min(1, baseline.history.length)),
    };
  },

  async applyRevert(this: ChatRevertRuntime, boundaryMessageId: string): Promise<void> {
    if (this.isProcessing) return;

    await this.ensureSessionsLoaded();

    const session = this.getActiveSession();
    const boundaryIndex = this.messages.findIndex(m => m.id === boundaryMessageId);
    if (boundaryIndex === -1 || this.messages[boundaryIndex]?.role !== 'user') {
      void vscode.window.showWarningMessage('LingYun: Unable to undo—selected message was not found.');
      return;
    }

    const snapshot = await this.getWorkspaceSnapshot();
    if (!snapshot) {
      void vscode.window.showWarningMessage(
        this.snapshotUnavailableReason || 'LingYun: Undo/redo is unavailable.'
      );
      return;
    }

    const existing = session.revert;
    const baselineSnapshotHash = existing?.snapshotHash ?? (await snapshot.track());
    const baselineAgentState = cloneAgentState(existing?.baselineAgentState ?? this.agent.exportState());
    const baselinePendingPlan = existing?.baselinePendingPlan
      ? { ...existing.baselinePendingPlan }
      : session.pendingPlan
        ? { ...session.pendingPlan }
        : undefined;

    try {
      if (existing) {
        await snapshot.restore(baselineSnapshotHash);
        this.agent.syncSession({
          state: cloneAgentState(baselineAgentState),
          execution: {
            model: this.currentModel,
            mode: this.mode,
          },
        });
      }

      const patches = this.collectPatchesFromIndex(boundaryIndex);
      await snapshot.revert(patches);
      const files = await snapshot.numstat(baselineSnapshotHash);

      session.revert = {
        messageId: boundaryMessageId,
        snapshotHash: baselineSnapshotHash,
        baselineAgentState,
        baselinePendingPlan,
        files,
        updatedAt: Date.now(),
      };

      this.pendingApprovals.clear();

      const truncated = this.deriveAgentStateBeforeUserMessage({
        baseline: baselineAgentState,
        boundaryIndex,
      });
      this.agent.syncSession({
        state: cloneAgentState(truncated),
        execution: {
          model: this.currentModel,
          mode: this.mode,
        },
      });

      session.pendingPlan = derivePendingPlanFromMessages(this.messages, {
        beforeIndex: boundaryIndex,
        fallback: baselinePendingPlan,
      });
      this.loopManager.syncActiveSession();
      this.persistActiveSession();
      await this.sendInit(true);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `LingYun: Undo failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  async clearRevert(this: ChatRevertRuntime): Promise<void> {
    const session = this.getActiveSession();
    const revert = session.revert;
    if (!revert) return;

    const snapshot = await this.getWorkspaceSnapshot();
    if (!snapshot) {
      session.revert = undefined;
      await this.sendInit(true);
      return;
    }

    try {
      await snapshot.restore(revert.snapshotHash);
      this.agent.syncSession({
        state: cloneAgentState(revert.baselineAgentState),
        execution: {
          model: this.currentModel,
          mode: this.mode,
        },
      });

      session.pendingPlan = revert.baselinePendingPlan;
      session.revert = undefined;
      this.loopManager.syncActiveSession();
      this.persistActiveSession();
      await this.sendInit(true);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `LingYun: Redo failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
  });
  Object.assign(runtime, service);
  return service;
}

function createChatRevertDepsForController(controller: ChatController): ChatRevertDeps {
  return {
    context: controller.context,
    get view() {
      return controller.view;
    },
    get snapshot() {
      return controller.snapshot;
    },
    set snapshot(value) {
      controller.snapshot = value;
    },
    get snapshotUnavailableReason() {
      return controller.snapshotUnavailableReason;
    },
    set snapshotUnavailableReason(value) {
      controller.snapshotUnavailableReason = value;
    },
    get messages() {
      return controller.messages;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    get currentModel() {
      return controller.currentModel;
    },
    get mode() {
      return controller.mode;
    },
    get pendingApprovals() {
      return controller.pendingApprovals;
    },
    get agent() {
      return controller.agent;
    },
    get loopManager() {
      return controller.loopManager;
    },
    ensureSessionsLoaded: () => controller.sessionApi.ensureSessionsLoaded(),
    getActiveSession: () => controller.sessionApi.getActiveSession(),
    persistActiveSession: () => controller.sessionApi.persistActiveSession(),
    postLoopState: () => controller.loopApi.postLoopState(),
    sendInit: (force?: boolean) => controller.webviewApi.sendInit(force),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
  };
}

export function createChatRevertServiceForController(controller: ChatController): ChatRevertService {
  return createChatRevertService(createChatRevertDepsForController(controller));
}
