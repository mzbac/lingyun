import * as vscode from 'vscode';
import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { getModelLimit } from '../../core/compaction';
import { getMessageText } from '@kooka/core';
import { SessionStore } from '../../core/sessionStore';
import type { ChatMessage, ChatSessionInfo } from './types';
import { formatErrorForUser } from './utils';
import { createDefaultSessionTitle } from './sessionTitle';
import { ChatViewProvider } from '../chat';

Object.assign(ChatViewProvider.prototype, {
  initializeSessions(this: ChatViewProvider): void {
    this.sessions.clear();
    const initialId = this.activeSessionId || crypto.randomUUID();
    const session: ChatSessionInfo = {
      id: initialId,
      title: createDefaultSessionTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      agentState: this.getBlankAgentState(),
      currentModel: this.currentModel,
      mode: this.mode,
      stepCounter: 0,
    };
    this.sessions.set(initialId, session);
    this.switchToSessionSync(initialId);
  },

  isSessionPersistenceEnabled(this: ChatViewProvider): boolean {
    return (
      vscode.workspace.getConfiguration('lingyun').get<boolean>('sessions.persist', false) ?? false
    );
  },

  getSessionPersistenceLimits(this: ChatViewProvider): { maxSessions: number; maxSessionBytes: number } {
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

  getOrCreateSessionStore(this: ChatViewProvider): SessionStore<ChatSessionInfo> | undefined {
    if (!this.isSessionPersistenceEnabled()) return undefined;

    const baseUri = this.context.storageUri ?? this.context.globalStorageUri;
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
    this: ChatViewProvider,
    session: ChatSessionInfo,
    maxSessionBytes: number
  ): ChatSessionInfo {
    const base: ChatSessionInfo = {
      ...session,
      messages: [...(session.messages || [])],
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

  markSessionDirty(this: ChatViewProvider, sessionId: string): void {
    if (!this.isSessionPersistenceEnabled()) return;
    this.dirtySessionIds.add(sessionId);
    this.scheduleSessionSave();
  },

  scheduleSessionSave(this: ChatViewProvider): void {
    if (!this.isSessionPersistenceEnabled()) return;
    if (this.sessionSaveTimer) return;

    const delayMs = this.isProcessing ? 2000 : 500;
    this.sessionSaveTimer = setTimeout(() => {
      this.sessionSaveTimer = undefined;
      void this.flushSessionSave();
    }, delayMs);
  },

  pruneSessionsInMemory(this: ChatViewProvider, maxSessions: number): void {
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
      this.sessions.delete(id);
      this.dirtySessionIds.delete(id);
    }

    if (!this.sessions.has(this.activeSessionId)) {
      const fallback = this.sessions.keys().next().value as string | undefined;
      if (fallback) {
        this.switchToSessionSync(fallback);
      }
    }
  },

  async flushSessionSave(this: ChatViewProvider): Promise<void> {
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
  },

  normalizeLoadedSession(this: ChatViewProvider, raw: ChatSessionInfo): ChatSessionInfo {
    const now = Date.now();
    return {
      id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
      title:
        typeof raw.title === 'string' && raw.title.trim()
          ? raw.title
          : createDefaultSessionTitle(new Date(now)),
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      agentState: this.normalizeLoadedAgentState((raw as any).agentState),
      currentModel: typeof raw.currentModel === 'string' ? raw.currentModel : this.currentModel,
      mode: raw.mode === 'plan' ? 'plan' : 'build',
      stepCounter: typeof raw.stepCounter === 'number' ? raw.stepCounter : 0,
      activeStepId: typeof raw.activeStepId === 'string' ? raw.activeStepId : undefined,
      pendingPlan:
        raw.pendingPlan && typeof raw.pendingPlan === 'object' ? raw.pendingPlan : undefined,
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

  normalizeLoadedAgentState(this: ChatViewProvider, raw: unknown): AgentSessionState {
    if (!raw || typeof raw !== 'object') return this.getBlankAgentState();

    const state = raw as any;
    const history = Array.isArray(state.history) ? state.history : [];

    const isValid = history.every((msg: any) => {
      if (!msg || typeof msg !== 'object') return false;
      if (typeof msg.id !== 'string' || !msg.id) return false;
      if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') return false;
      return Array.isArray(msg.parts);
    });

    if (!isValid) return this.getBlankAgentState();

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

    return {
      history,
      pendingPlan: typeof state.pendingPlan === 'string' ? state.pendingPlan : undefined,
      fileHandles,
    };
  },

  recoverInterruptedSessions(this: ChatViewProvider): void {
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

  async ensureSessionsLoaded(this: ChatViewProvider): Promise<void> {
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
          this.switchToSessionSync(nextActive);
        }

        this.recoverInterruptedSessions();
      } catch (error) {
        console.error('Failed to load persisted sessions:', error);
      } finally {
        this.sessionsLoadedFromDisk = true;
      }
    })().finally(() => {
      this.sessionsLoadPromise = undefined;
    });

    return this.sessionsLoadPromise;
  },

  getBlankAgentState(this: ChatViewProvider): AgentSessionState {
    return { history: [], pendingPlan: undefined, fileHandles: { nextId: 1, byId: {} } };
  },

  getActiveSession(this: ChatViewProvider): ChatSessionInfo {
    const session = this.sessions.get(this.activeSessionId);
    if (!session) {
      throw new Error('Active session missing');
    }
    return session;
  },

  getContextForUI(this: ChatViewProvider): {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    contextLimitTokens?: number;
    outputLimitTokens?: number;
    percent?: number;
  } {
    try {
      const history = this.agent.getHistory();
      let tokens:
        | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
        | undefined;

      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i] as any;
        if (msg?.role !== 'assistant') continue;
        const candidate = msg?.metadata?.tokens;
        const total = candidate?.total;
        if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
          tokens = candidate;
          break;
        }
      }

      const modelLimit = getModelLimit(this.currentModel);
      const maxOutputTokens =
        vscode.workspace.getConfiguration('lingyun').get<number>('openaiCompatible.maxTokens') ??
        32000;

      const totalTokens = tokens?.total;
      const contextLimitTokens =
        modelLimit?.context && modelLimit.context > 0 ? modelLimit.context : undefined;
      const percent =
        totalTokens && contextLimitTokens && contextLimitTokens > 0
          ? Math.max(0, Math.min(999, Math.round((totalTokens / contextLimitTokens) * 100)))
          : undefined;

      return {
        totalTokens,
        inputTokens: tokens?.input,
        outputTokens: tokens?.output,
        cacheReadTokens: tokens?.cacheRead,
        cacheWriteTokens: tokens?.cacheWrite,
        contextLimitTokens,
        outputLimitTokens: Math.max(0, Math.floor(maxOutputTokens)),
        percent,
      };
    } catch {
      return {};
    }
  },

  getRenderableMessages(this: ChatViewProvider): ChatMessage[] {
    const session = this.getActiveSession();
    const boundaryId = session.revert?.messageId;
    if (!boundaryId) return this.messages;

    const boundaryIndex = this.messages.findIndex(m => m.id === boundaryId);
    if (boundaryIndex < 0) return this.messages;

    // hide reverted messages; show revert UI outside the chat stream.
    return this.messages.slice(0, boundaryIndex);
  },

  persistActiveSession(this: ChatViewProvider): void {
    const session = this.getActiveSession();
    session.updatedAt = Date.now();
    session.messages = this.messages;
    session.agentState = this.agent.exportState();
    session.currentModel = this.currentModel;
    session.mode = this.mode;
    session.stepCounter = this.stepCounter;
    session.activeStepId = this.activeStepId;
    session.pendingPlan = this.pendingPlan;
    session.runtime = { wasRunning: this.isProcessing, updatedAt: Date.now() };
    this.markSessionDirty(session.id);
  },

  getSessionsForUI(this: ChatViewProvider): Array<{ id: string; title: string }> {
    return [...this.sessions.values()].map(s => ({ id: s.id, title: s.title }));
  },

  postSessions(this: ChatViewProvider): void {
    this.postMessage({
      type: 'sessions',
      sessions: this.getSessionsForUI(),
      activeSessionId: this.activeSessionId,
    });
  },

  async createNewSession(this: ChatViewProvider): Promise<void> {
    if (this.isProcessing) {
      vscode.window.showInformationMessage(
        'LingYun: Stop the current task before starting a new session.'
      );
      return;
    }

    this.persistActiveSession();

    const id = crypto.randomUUID();
    const now = Date.now();

    const session: ChatSessionInfo = {
      id,
      title: createDefaultSessionTitle(new Date(now)),
      createdAt: now,
      updatedAt: now,
      messages: [],
      agentState: this.getBlankAgentState(),
      currentModel: this.currentModel,
      mode: this.mode,
      stepCounter: 0,
    };

    this.sessions.set(id, session);
    this.switchToSessionSync(id);
    this.markSessionDirty(id);
    await this.sendInit(true);
  },

  async switchToSession(this: ChatViewProvider, sessionId: string): Promise<void> {
    if (this.isProcessing) {
      vscode.window.showInformationMessage(
        'LingYun: Stop the current task before switching sessions.'
      );
      return;
    }
    if (!this.sessions.has(sessionId)) return;

    this.persistActiveSession();
    this.switchToSessionSync(sessionId);
    await this.sendInit(true);
  },

  switchToSessionSync(this: ChatViewProvider, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.activeSessionId = sessionId;
    this.messages = session.messages;
    this.pendingPlan = session.pendingPlan;
    this.stepCounter = session.stepCounter;
    this.activeStepId = session.activeStepId;
    this.currentModel = session.currentModel;
    this.mode = session.mode;

    this.agent.importState(session.agentState);
    this.agent.updateConfig({ model: this.currentModel, mode: this.mode, sessionId });
    this.agent.setMode(this.mode);
  },

  async setBackend(
    this: ChatViewProvider,
    agent: AgentLoop,
    llmProvider?: ChatViewProvider['llmProvider']
  ): Promise<void> {
    this.agent = agent;
    this.llmProvider = llmProvider;
    this.pendingPlan = undefined;
    this.isProcessing = false;
    this.availableModels = [];
    this.currentModel = vscode.workspace.getConfiguration('lingyun').get('model') || this.currentModel;
    this.mode =
      (vscode.workspace.getConfiguration('lingyun').get<string>('mode') || this.mode) === 'plan'
        ? 'plan'
        : 'build';
    this.stepCounter = 0;
    this.activeStepId = undefined;
    this.abortRequested = false;
    this.pendingApprovals.clear();
    this.initAcked = false;

    await this.ensureSessionsLoaded();

    if (this.sessions.size === 0) {
      this.activeSessionId = crypto.randomUUID();
      this.initializeSessions();
    } else if (!this.sessions.has(this.activeSessionId)) {
      const fallback = this.sessions.keys().next().value as string | undefined;
      this.activeSessionId = fallback || crypto.randomUUID();
      if (fallback) {
        this.switchToSessionSync(fallback);
      } else {
        this.initializeSessions();
      }
    } else {
      this.switchToSessionSync(this.activeSessionId);
    }

    if (this.view) {
      this.postMessage({ type: 'cleared' });
      this.postMessage({ type: 'processing', value: false });
      this.postMessage({ type: 'planPending', value: false, planMessageId: '' });
      await this.sendInit(true);
    }
  },

  async clearCurrentSession(this: ChatViewProvider): Promise<void> {
    if (this.isProcessing) {
      vscode.window.showInformationMessage('LingYun: Stop the current task before clearing the session.');
      return;
    }

    const session = this.getActiveSession();
    session.messages = [];
    session.pendingPlan = undefined;
    session.stepCounter = 0;
    session.activeStepId = undefined;
    session.agentState = this.getBlankAgentState();
    this.switchToSessionSync(session.id);

    this.stepCounter = 0;
    this.activeStepId = undefined;
    this.abortRequested = false;
    this.pendingPlan = undefined;

    this.postMessage({ type: 'cleared' });
    this.postMessage({ type: 'planPending', value: false, planMessageId: '' });
    this.persistActiveSession();
  },

  async compactCurrentSession(this: ChatViewProvider): Promise<void> {
    if (this.isProcessing) {
      vscode.window.showInformationMessage('LingYun: Stop the current task before compacting.');
      return;
    }

    if (!this.view) {
      void vscode.window.showInformationMessage('LINGYUN: AGENT view is not ready.');
      return;
    }

    await this.ensureSessionsLoaded();

    if (this.agent.getHistory().length === 0) {
      void vscode.window.showInformationMessage('LingYun: Nothing to compact yet.');
      return;
    }

    const startedAt = Date.now();
    const operationId = crypto.randomUUID();
    const MAX_COMPACTION_SUMMARY_CHARS = 20000;

    const operationMsg: ChatMessage = {
      id: operationId,
      role: 'operation',
      content: '',
      timestamp: startedAt,
      operation: {
        kind: 'compact',
        status: 'running',
        label: 'Compacting context…',
        startedAt,
        auto: false,
      },
    };

    this.messages.push(operationMsg);
    this.postMessage({
      type: 'operationStart',
      operation: {
        id: operationId,
        kind: 'compact',
        status: 'running',
        label: 'Compacting context…',
        startedAt,
      },
    });
    this.postMessage({ type: 'message', message: operationMsg });
    this.persistActiveSession();

    this.isProcessing = true;
    this.postMessage({ type: 'processing', value: true });

    try {
      await this.agent.compactSession();

      const endedAt = Date.now();
      if (operationMsg.operation) {
        operationMsg.operation.status = 'done';
        operationMsg.operation.label = 'Context compacted';
        operationMsg.operation.detail = 'Summarized older messages into a compact note.';
        operationMsg.operation.endedAt = endedAt;

        const history = this.agent.getHistory();
        const summary = [...history].reverse().find(m => m.role === 'assistant' && (m as any).metadata?.summary);
        const summaryText = summary ? getMessageText(summary) : '';
        if (summaryText.trim()) {
          operationMsg.operation.summaryText =
            summaryText.length > MAX_COMPACTION_SUMMARY_CHARS
              ? summaryText.slice(0, MAX_COMPACTION_SUMMARY_CHARS) + '\n\n[Summary truncated in UI]'
              : summaryText;
          operationMsg.operation.summaryTruncated = summaryText.length > MAX_COMPACTION_SUMMARY_CHARS;
        }
      }

      this.postMessage({ type: 'updateMessage', message: operationMsg });
      this.postMessage({
        type: 'operationEnd',
        operation: {
          id: operationId,
          kind: 'compact',
          status: 'done',
          label: 'Context compacted',
          startedAt,
          endedAt,
        },
      });
      this.postMessage({ type: 'context', context: this.getContextForUI() });
      this.persistActiveSession();
    } catch (error) {
      const endedAt = Date.now();
      const formatted = formatErrorForUser(error);
      const canceled =
        this.abortRequested ||
        /agent aborted/i.test(formatted) ||
        /aborterror/i.test(formatted);
      const status: 'running' | 'done' | 'error' | 'canceled' = canceled ? 'canceled' : 'error';
      const label = canceled ? 'Compaction canceled' : 'Compaction failed';

      if (operationMsg.operation) {
        operationMsg.operation.status = status;
        operationMsg.operation.label = label;
        operationMsg.operation.detail = canceled ? undefined : formatted;
        operationMsg.operation.endedAt = endedAt;
      }

      this.postMessage({ type: 'updateMessage', message: operationMsg });
      this.postMessage({
        type: 'operationEnd',
        operation: {
          id: operationId,
          kind: 'compact',
          status,
          label,
          startedAt,
          endedAt,
        },
      });
      this.postMessage({ type: 'context', context: this.getContextForUI() });
      this.persistActiveSession();
    } finally {
      this.isProcessing = false;
      this.abortRequested = false;
      this.postMessage({ type: 'processing', value: false });
      this.persistActiveSession();
    }
  },

  async onSessionPersistenceConfigChanged(this: ChatViewProvider): Promise<void> {
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

    // Recreate store to pick up updated limits.
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

  async clearSavedSessions(this: ChatViewProvider): Promise<void> {
    if (this.isProcessing) {
      vscode.window.showInformationMessage('LingYun: Stop the current task before clearing saved sessions.');
      return;
    }

    const baseUri = this.context.storageUri ?? this.context.globalStorageUri;
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

    this.activeSessionId = crypto.randomUUID();
    this.initializeSessions();
    this.persistActiveSession();

    if (this.view) {
      this.postMessage({ type: 'cleared' });
      await this.sendInit(true);
    }

    vscode.window.showInformationMessage('LingYun: Saved sessions cleared.');
  },
});
