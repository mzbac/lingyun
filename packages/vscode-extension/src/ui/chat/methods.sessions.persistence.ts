import * as vscode from 'vscode';

import { parseUserHistoryInput } from '@kooka/core';

import type { AgentSessionState } from '../../core/agent';
import { WorkspaceMemories } from '../../core/memories';
import { appendErrorLog } from '../../core/logger';
import { resolveModelIdWithWorkspaceDefaults } from '../../core/modelSelection';
import { createBlankSessionSignals, normalizeSessionSignals } from '../../core/sessionSignals';
import { SessionStore } from '../../core/sessionStore';
import { bindChatControllerService } from './controllerService';
import { createDefaultSessionTitle } from './sessionTitle';
import type { ChatSessionInfo } from './types';
import type { ChatSessionRuntimeService } from './methods.sessions.runtime';

type PendingApprovalEntry = {
  resolve: (approved: boolean) => void;
  toolName: string;
  stepId?: string;
};

export interface ChatSessionPersistenceService {
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
  onSessionPersistenceConfigChanged(): Promise<void>;
  clearSavedSessions(): Promise<void>;
}

export interface ChatSessionPersistenceDeps {
  context: vscode.ExtensionContext;
  outputChannel?: vscode.OutputChannel;
  view?: vscode.WebviewView;
  llmProviderId?: string;
  currentModel: string;
  activeSessionId: string;
  sessions: Map<string, ChatSessionInfo>;
  isProcessing: boolean;
  abortRequested: boolean;
  pendingApprovals: Map<string, PendingApprovalEntry>;
  sessionsLoadedFromDisk: boolean;
  sessionsLoadPromise?: Promise<void>;
  sessionStore?: SessionStore<ChatSessionInfo>;
  sessionSaveTimer?: NodeJS.Timeout;
  dirtySessionIds: Set<string>;
  inputHistoryEntries: string[];
  inputHistoryLoadedFromDisk: boolean;
  inputHistoryStore?: unknown;
  loopManager: {
    normalizeStoredSessionState(raw: unknown): ChatSessionInfo['loop'];
    clearAllRuntimeData(): void;
  };
  queueManager: {
    releaseSession(session: ChatSessionInfo | undefined): void;
    clearAllRuntimeData(): void;
  };
  runtime: Pick<
    ChatSessionRuntimeService,
    'getBlankAgentState' | 'switchToSessionSync' | 'initializeSessions' | 'persistActiveSession'
  >;
  ensureInputHistoryLoaded(): Promise<void>;
  sendInit(force?: boolean): Promise<void>;
  postMessage(message: unknown): void;
}

type ChatSessionPersistenceRuntime = ChatSessionPersistenceDeps & ChatSessionPersistenceService;

export function createChatSessionPersistenceService(
  controller: ChatSessionPersistenceDeps
): ChatSessionPersistenceService {
  const runtime = controller as ChatSessionPersistenceRuntime;
  const service = bindChatControllerService(runtime, {
    isSessionPersistenceEnabled(this: ChatSessionPersistenceRuntime): boolean {
      return (
        vscode.workspace.getConfiguration('lingyun').get<boolean>('sessions.persist', false) ?? false
      );
    },

    getSessionPersistenceLimits(
      this: ChatSessionPersistenceRuntime
    ): { maxSessions: number; maxSessionBytes: number } {
      const config = vscode.workspace.getConfiguration('lingyun');
      const maxSessions = config.get<number>('sessions.maxSessions', 20) ?? 20;
      const maxSessionBytes = config.get<number>('sessions.maxSessionBytes', 2_000_000) ?? 2_000_000;

      return {
        maxSessions: Math.max(1, Number.isFinite(maxSessions) ? Math.floor(maxSessions) : 20),
        maxSessionBytes: Math.max(
          1_000,
          Number.isFinite(maxSessionBytes) ? Math.floor(maxSessionBytes) : 2_000_000
        ),
      };
    },

    getOrCreateSessionStore(this: ChatSessionPersistenceRuntime): SessionStore<ChatSessionInfo> | undefined {
      if (!this.isSessionPersistenceEnabled()) return undefined;

      const baseUri = this.context?.storageUri ?? this.context?.globalStorageUri;
      if (!baseUri) return undefined;

      if (this.sessionStore) return this.sessionStore;

      const { maxSessions, maxSessionBytes } = this.getSessionPersistenceLimits();
      this.sessionStore = new SessionStore<ChatSessionInfo>(baseUri, {
        maxSessions,
        maxSessionBytes,
        pruneSession: (session, limit) => this.pruneSessionForStorage(session, limit),
      });

      return this.sessionStore;
    },

    pruneSessionForStorage(
      this: ChatSessionPersistenceRuntime,
      session: ChatSessionInfo,
      maxSessionBytes: number
    ): ChatSessionInfo {
      const base: ChatSessionInfo = {
        ...session,
        messages: [...(session.messages || [])],
        loop: this.loopManager.normalizeStoredSessionState(session.loop),
      };

      const measure = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

      while (measure(base) > maxSessionBytes && base.messages.length > 1) {
        base.messages.shift();
      }

      if (measure(base) > maxSessionBytes && base.messages.length === 1) {
        const msg = { ...base.messages[0] };
        const keepChars = Math.max(1_000, Math.floor(maxSessionBytes / 4));

        if (typeof msg.content === 'string' && msg.content.length > keepChars) {
          msg.content = msg.content.slice(-keepChars);
        }

        if (msg.toolCall?.result && msg.toolCall.result.length > keepChars) {
          msg.toolCall = { ...msg.toolCall, result: msg.toolCall.result.slice(-keepChars) };
        }

        if (msg.toolCall?.diff && msg.toolCall.diff.length > keepChars) {
          msg.toolCall = {
            ...(msg.toolCall || {}),
            diff: msg.toolCall.diff.slice(0, keepChars) + '\n\n... [TRUNCATED]',
          };
        }

        base.messages = [msg];
      }

      return base;
    },

    markSessionDirty(this: ChatSessionPersistenceRuntime, sessionId: string): void {
      if (!this.isSessionPersistenceEnabled()) return;
      this.dirtySessionIds.add(sessionId);
      this.scheduleSessionSave();
    },

    scheduleSessionSave(this: ChatSessionPersistenceRuntime): void {
      if (!this.isSessionPersistenceEnabled()) return;
      if (this.sessionSaveTimer) return;

      const delayMs = this.isProcessing ? 2000 : 500;
      this.sessionSaveTimer = setTimeout(() => {
        this.sessionSaveTimer = undefined;
        void this.flushSessionSave().catch(error => {
          appendErrorLog(this.outputChannel, 'Failed to persist sessions', error, { tag: 'Sessions' });
        });
      }, delayMs);
    },

    pruneSessionsInMemory(this: ChatSessionPersistenceRuntime, maxSessions: number): void {
      if (this.sessions.size <= maxSessions) return;

      const ids = [...this.sessions.keys()];
      let keep = ids.slice(-maxSessions);
      if (!keep.includes(this.activeSessionId)) {
        keep = keep.slice(1);
        keep.push(this.activeSessionId);
      }

      const keepSet = new Set(keep);
      for (const id of ids) {
        if (keepSet.has(id)) continue;
        this.queueManager.releaseSession(this.sessions.get(id));
        this.sessions.delete(id);
        this.dirtySessionIds.delete(id);
      }

      if (!this.sessions.has(this.activeSessionId)) {
        const fallback = this.sessions.keys().next().value as string | undefined;
        if (fallback) {
          this.runtime.switchToSessionSync(fallback);
        }
      }
    },

    async flushSessionSave(this: ChatSessionPersistenceRuntime): Promise<void> {
      const store = this.getOrCreateSessionStore();
      if (!store) return;

      const { maxSessions } = this.getSessionPersistenceLimits();
      if (!this.isProcessing) {
        this.pruneSessionsInMemory(maxSessions);
      }

      const dirtyIds = [...this.dirtySessionIds];
      this.dirtySessionIds.clear();

      await store.save({
        sessionsById: this.sessions,
        activeSessionId: this.activeSessionId,
        order: [...this.sessions.keys()],
        dirtySessionIds: dirtyIds.length > 0 ? dirtyIds : undefined,
      });

      if (dirtyIds.length > 0) {
        void new WorkspaceMemories(this.context).scheduleUpdateFromSessions(undefined, { delayMs: 1500 }).catch(() => {
          // Ignore background refresh failures during session persistence.
        });
      }
    },

    normalizeLoadedSession(this: ChatSessionPersistenceRuntime, raw: ChatSessionInfo): ChatSessionInfo {
      const now = Date.now();

      const queuedInputsRaw = (raw as any).queuedInputs;
      const queuedInputs =
        Array.isArray(queuedInputsRaw)
          ? queuedInputsRaw
              .filter((v: any) => v && typeof v === 'object')
              .map((v: any) => ({
                id: typeof v.id === 'string' && v.id ? v.id : crypto.randomUUID(),
                createdAt: typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) ? v.createdAt : now,
                message: typeof v.message === 'string' ? v.message : '',
                displayContent: typeof v.displayContent === 'string' ? v.displayContent : '',
                attachmentCount:
                  typeof v.attachmentCount === 'number' && Number.isFinite(v.attachmentCount)
                    ? Math.max(0, Math.floor(v.attachmentCount))
                    : 0,
              }))
              .slice(-50)
          : [];

      return {
        id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
        title:
          typeof raw.title === 'string' && raw.title.trim()
            ? raw.title
            : createDefaultSessionTitle(new Date(now)),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
        signals: normalizeSessionSignals((raw as any).signals, now),
        messages: Array.isArray(raw.messages) ? raw.messages : [],
        agentState: this.normalizeLoadedAgentState((raw as any).agentState),
        currentModel: resolveModelIdWithWorkspaceDefaults(
          this.llmProviderId,
          typeof raw.currentModel === 'string' ? raw.currentModel : this.currentModel,
        ),
        mode: raw.mode === 'plan' ? 'plan' : 'build',
        stepCounter: typeof raw.stepCounter === 'number' ? raw.stepCounter : 0,
        activeStepId: typeof raw.activeStepId === 'string' ? raw.activeStepId : undefined,
        pendingPlan:
          raw.pendingPlan && typeof raw.pendingPlan === 'object' ? raw.pendingPlan : undefined,
        queuedInputs,
        loop: this.loopManager.normalizeStoredSessionState((raw as any).loop),
        parentSessionId:
          typeof (raw as any).parentSessionId === 'string' ? String((raw as any).parentSessionId) : undefined,
        subagentType:
          typeof (raw as any).subagentType === 'string' ? String((raw as any).subagentType) : undefined,
        revert:
          raw.revert &&
          typeof raw.revert === 'object' &&
          typeof (raw.revert as any).messageId === 'string' &&
          typeof (raw.revert as any).snapshotHash === 'string' &&
          (raw.revert as any).baselineAgentState
            ? (raw.revert as ChatSessionInfo['revert'])
            : undefined,
        runtime:
          raw.runtime && typeof raw.runtime === 'object'
            ? raw.runtime
            : { wasRunning: false, updatedAt: now },
      };
    },

    normalizeLoadedAgentState(this: ChatSessionPersistenceRuntime, raw: unknown): AgentSessionState {
      if (!raw || typeof raw !== 'object') return this.runtime.getBlankAgentState();

      const state = raw as any;
      const history = Array.isArray(state.history) ? state.history : [];

      const isValid = history.every((msg: any) => {
        if (!msg || typeof msg !== 'object') return false;
        if (typeof msg.id !== 'string' || !msg.id) return false;
        if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') return false;
        return Array.isArray(msg.parts);
      });

      if (!isValid) return this.runtime.getBlankAgentState();

      const fileHandlesRaw = state.fileHandles;
      let fileHandles: AgentSessionState['fileHandles'] | undefined;
      if (fileHandlesRaw && typeof fileHandlesRaw === 'object') {
        const nextId = (fileHandlesRaw as any).nextId;
        const byIdRaw = (fileHandlesRaw as any).byId;
        if (
          typeof nextId === 'number' &&
          Number.isFinite(nextId) &&
          nextId >= 1 &&
          byIdRaw &&
          typeof byIdRaw === 'object'
        ) {
          const byId: Record<string, string> = {};
          for (const [id, filePath] of Object.entries(byIdRaw as Record<string, unknown>)) {
            if (typeof id !== 'string' || !/^F\\d+$/.test(id)) continue;
            if (typeof filePath !== 'string' || !filePath.trim()) continue;
            byId[id] = filePath.trim();
          }
          fileHandles = { nextId: Math.floor(nextId), byId };
        }
      }

      const semanticHandlesRaw = state.semanticHandles;
      const semanticHandles =
        semanticHandlesRaw && typeof semanticHandlesRaw === 'object'
          ? (semanticHandlesRaw as AgentSessionState['semanticHandles'])
          : undefined;

      const pendingInputsRaw = (state as any).pendingInputs;
      const pendingInputs =
        Array.isArray(pendingInputsRaw)
          ? pendingInputsRaw
              .map((input: unknown) => parseUserHistoryInput(input))
              .filter((input): input is NonNullable<AgentSessionState['pendingInputs']>[number] => input !== undefined)
          : undefined;

      const compactionSyntheticContextsRaw = (state as any).compactionSyntheticContexts;
      const compactionSyntheticContexts =
        Array.isArray(compactionSyntheticContextsRaw)
          ? compactionSyntheticContextsRaw
              .filter(
                (context: unknown): context is NonNullable<AgentSessionState['compactionSyntheticContexts']>[number] =>
                  !!context &&
                  typeof context === 'object' &&
                  (((context as any).transientContext === 'explore' ||
                    (context as any).transientContext === 'memoryRecall') &&
                    typeof (context as any).text === 'string'),
              )
              .map((context) => ({
                transientContext: context.transientContext,
                text: context.text,
              }))
          : undefined;

      return {
        history,
        fileHandles,
        semanticHandles,
        ...(pendingInputs ? { pendingInputs } : {}),
        ...(compactionSyntheticContexts ? { compactionSyntheticContexts } : {}),
      };
    },

    recoverInterruptedSessions(this: ChatSessionPersistenceRuntime): void {
      let changed = false;
      const now = Date.now();

      for (const session of this.sessions.values()) {
        if (!session.runtime?.wasRunning) continue;
        changed = true;

        const lastRunningStep = [...session.messages]
          .reverse()
          .find(m => m.role === 'step' && m.step?.status === 'running');
        if (lastRunningStep?.step) {
          lastRunningStep.step.status = 'canceled';
        }

        const lastTool = [...session.messages]
          .reverse()
          .find(
            m =>
              m.role === 'tool' &&
              (m.toolCall?.status === 'running' || m.toolCall?.status === 'pending')
          );
        if (lastTool?.toolCall && lastTool.toolCall.status !== 'rejected') {
          lastTool.toolCall.status = 'error';
          lastTool.toolCall.result =
            lastTool.toolCall.result || 'Interrupted (VS Code closed or extension reloaded).';
        }

        if (session.loop?.nextFireAt) {
          session.loop.nextFireAt = undefined;
        }

        session.runtime = { wasRunning: false, updatedAt: now };
        session.activeStepId = undefined;

        session.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'Previous run was interrupted (VS Code closed or extension reloaded). You can continue by sending a message.',
          timestamp: now,
        });

        this.dirtySessionIds.add(session.id);
      }

      if (changed) {
        this.isProcessing = false;
        this.abortRequested = false;
        this.pendingApprovals.clear();
        this.scheduleSessionSave();
      }
    },

    async ensureSessionsLoaded(this: ChatSessionPersistenceRuntime): Promise<void> {
      if (!this.isSessionPersistenceEnabled()) return;
      if (this.sessionsLoadedFromDisk) return;
      if (this.sessionsLoadPromise) return this.sessionsLoadPromise;

      this.sessionsLoadPromise = (async () => {
        try {
          await this.ensureInputHistoryLoaded();

          const store = this.getOrCreateSessionStore();
          if (!store) return;

          const loaded = await store.loadAll();
          if (!loaded) return;

          const nextSessions = new Map<string, ChatSessionInfo>();
          for (const id of loaded.index.order) {
            const session = loaded.sessionsById.get(id);
            if (!session) continue;
            nextSessions.set(id, this.normalizeLoadedSession(session));
          }

          if (nextSessions.size === 0) return;

          this.sessions = nextSessions;
          const nextActive = this.sessions.has(loaded.index.activeSessionId)
            ? loaded.index.activeSessionId
            : this.sessions.keys().next().value;

          if (nextActive) {
            this.activeSessionId = nextActive;
            this.runtime.switchToSessionSync(nextActive);
          }

          this.recoverInterruptedSessions();
        } catch (error) {
          appendErrorLog(this.outputChannel, 'Failed to load persisted sessions', error, {
            tag: 'Sessions',
          });
        } finally {
          this.sessionsLoadedFromDisk = true;
        }
      })().finally(() => {
        this.sessionsLoadPromise = undefined;
      });

      return this.sessionsLoadPromise;
    },

    async onSessionPersistenceConfigChanged(this: ChatSessionPersistenceRuntime): Promise<void> {
      const enabled = this.isSessionPersistenceEnabled();

      if (!enabled) {
        this.sessionStore = undefined;
        this.sessionsLoadedFromDisk = false;
        this.sessionsLoadPromise = undefined;
        this.dirtySessionIds.clear();
        this.inputHistoryStore = undefined;
        this.inputHistoryLoadedFromDisk = false;
        if (this.sessionSaveTimer) {
          clearTimeout(this.sessionSaveTimer);
          this.sessionSaveTimer = undefined;
        }
        return;
      }

      this.sessionStore = undefined;
      this.getOrCreateSessionStore();

      if (!this.sessionsLoadedFromDisk) {
        await this.ensureSessionsLoaded();
      }
      if (!this.inputHistoryLoadedFromDisk) {
        await this.ensureInputHistoryLoaded();
      }

      for (const id of this.sessions.keys()) {
        this.dirtySessionIds.add(id);
      }
      this.scheduleSessionSave();

      if (this.view) {
        await this.sendInit(true);
      }
    },

    async clearSavedSessions(this: ChatSessionPersistenceRuntime): Promise<void> {
      if (this.isProcessing) {
        vscode.window.showInformationMessage('LingYun: Stop the current task before clearing saved sessions.');
        return;
      }

      const baseUri = this.context?.storageUri ?? this.context?.globalStorageUri;
      if (baseUri) {
        const { maxSessions, maxSessionBytes } = this.getSessionPersistenceLimits();
        const store =
          this.sessionStore ??
          new SessionStore<ChatSessionInfo>(baseUri, {
            maxSessions,
            maxSessionBytes,
            pruneSession: (session, limit) => this.pruneSessionForStorage(session, limit),
          });

        await store.clear();

        try {
          await vscode.workspace.fs.delete(vscode.Uri.joinPath(baseUri, 'todos'), {
            recursive: true,
            useTrash: false,
          });
        } catch {
          // Ignore missing todo store.
        }
      }

      this.sessionStore = undefined;
      this.sessionsLoadedFromDisk = true;
      this.sessionsLoadPromise = undefined;
      this.dirtySessionIds.clear();
      this.inputHistoryEntries = [];
      this.inputHistoryStore = undefined;
      this.inputHistoryLoadedFromDisk = true;
      this.loopManager.clearAllRuntimeData();
      this.queueManager.clearAllRuntimeData();

      this.activeSessionId = crypto.randomUUID();
      this.runtime.initializeSessions();
      this.runtime.persistActiveSession();

      if (this.view) {
        this.postMessage({ type: 'cleared' });
        await this.sendInit(true);
      }

      vscode.window.showInformationMessage('LingYun: Saved sessions cleared.');
    },
  });
  Object.assign(runtime, service);
  return service;
}
