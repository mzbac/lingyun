import * as vscode from 'vscode';

import {
  normalizeFileHandlesState,
  normalizeOptionalMentionedSkills,
  normalizeSemanticHandlesState,
  normalizeSystemPromptSnapshot,
} from '@kooka/agent-sdk';
import { cloneAgentHistoryMessages, getAgentHistoryStats, parseUserHistoryInput } from '@kooka/core';

import type { AgentSessionState } from '../../core/agent';
import { WorkspaceMemories } from '../../core/memories';
import { redactSensitive } from '../../core/agent/debug';
import { appendErrorLog } from '../../core/logger';
import { resolveModelIdWithWorkspaceDefaults } from '../../core/modelSelection';
import { normalizeSessionSignals } from '../../core/sessionSignals';
import { SessionStore } from '../../core/sessionStore';
import { bindChatControllerService } from './controllerService';
import { postInputNotice } from './inputNotice';
import { createDefaultSessionTitle, createSessionPreview } from './sessionTitle';
import type { ChatMessage, ChatSessionInfo } from './types';
import type { PendingApprovalEntry } from './controllerPorts';
import type { ChatSessionRuntimeService } from './methods.sessions.runtime';

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

const SESSION_STORAGE_REDACTION = { redactionLevel: 'full' as const };
const MAX_PERSISTED_STRING_CHARS = 20_000;
const MAX_PERSISTED_ARG_STRING_CHARS = 2_000;

const OMIT_PERSISTED_ARG_KEYS = new Set([
  'body',
  'content',
  'diff',
  'newstring',
  'oldstring',
  'patch',
  'patchtext',
]);

const REDACT_PERSISTED_ARG_KEYS = new Set([
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'credential',
  'credentials',
  'headers',
  'password',
  'passwd',
  'privatekey',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'setcookie',
  'token',
  'xapikey',
]);

function normalizeStorageKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function redactStringForStorage(value: string, maxChars = MAX_PERSISTED_STRING_CHARS): string {
  const redacted = redactSensitive(value, SESSION_STORAGE_REDACTION);
  if (redacted.length <= maxChars) return redacted;
  return redacted.slice(0, maxChars) + '\n\n... [TRUNCATED FOR STORAGE]';
}

function sanitizeGenericStorageValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return '[omitted:depth]';
  if (typeof value === 'string') return redactStringForStorage(value);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(item => sanitizeGenericStorageValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitizeGenericStorageValue(child, depth + 1);
  }
  return out;
}

function sanitizeToolArgValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 20) return '[omitted:depth]';
  const normalizedKey = normalizeStorageKey(key);
  if (OMIT_PERSISTED_ARG_KEYS.has(normalizedKey)) return '[omitted from persisted session]';
  if (REDACT_PERSISTED_ARG_KEYS.has(normalizedKey)) return '[redacted]';
  if (typeof value === 'string') return redactStringForStorage(value, MAX_PERSISTED_ARG_STRING_CHARS);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(item => sanitizeToolArgValue('', item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = sanitizeToolArgValue(childKey, childValue, depth + 1);
  }
  return out;
}

function sanitizeToolArgsForStorage(rawArgs: string): string {
  try {
    const parsed = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    return JSON.stringify(sanitizeToolArgValue('', parsed));
  } catch {
    return redactStringForStorage(String(rawArgs || ''), MAX_PERSISTED_ARG_STRING_CHARS);
  }
}

function sanitizeToolCallForStorage(toolCall: NonNullable<ChatMessage['toolCall']>): NonNullable<ChatMessage['toolCall']> {
  const sanitized: NonNullable<ChatMessage['toolCall']> = {
    ...toolCall,
    args: sanitizeToolArgsForStorage(toolCall.args),
    result: toolCall.result ? redactStringForStorage(toolCall.result, 4_000) : undefined,
    path: toolCall.path ? redactStringForStorage(toolCall.path, 1_000) : undefined,
    approvalReason: toolCall.approvalReason ? redactStringForStorage(toolCall.approvalReason, 1_000) : undefined,
    blockedReason: toolCall.blockedReason ? redactStringForStorage(toolCall.blockedReason, 1_000) : undefined,
    batchFiles: Array.isArray(toolCall.batchFiles)
      ? toolCall.batchFiles.map(file => redactStringForStorage(file, 1_000))
      : undefined,
    lsp: sanitizeGenericStorageValue(toolCall.lsp),
    todos: sanitizeGenericStorageValue(toolCall.todos),
  };

  if (toolCall.diff || toolCall.diffView) {
    sanitized.diff = undefined;
    sanitized.diffView = undefined;
    sanitized.diffTruncated = undefined;
    sanitized.diffStats = toolCall.diffStats;
    sanitized.diffUnavailableReason = toolCall.diffUnavailableReason || 'Diff omitted from persisted session for privacy';
  }

  return sanitized;
}

function sanitizeMessageForStorage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content: redactStringForStorage(message.content),
    plan: message.plan ? sanitizeGenericStorageValue(message.plan) as ChatMessage['plan'] : undefined,
    revert: message.revert ? sanitizeGenericStorageValue(message.revert) as ChatMessage['revert'] : undefined,
    operation: message.operation ? sanitizeGenericStorageValue(message.operation) as ChatMessage['operation'] : undefined,
    toolCall: message.toolCall ? sanitizeToolCallForStorage(message.toolCall) : undefined,
  };
}

export function sanitizeSessionForStorage(session: ChatSessionInfo): ChatSessionInfo {
  return {
    ...session,
    title: redactStringForStorage(session.title, 500),
    firstUserMessagePreview: session.firstUserMessagePreview
      ? redactStringForStorage(session.firstUserMessagePreview, 500)
      : undefined,
    signals: sanitizeGenericStorageValue(session.signals) as ChatSessionInfo['signals'],
    messages: (session.messages || []).map(sanitizeMessageForStorage),
    agentState: sanitizeGenericStorageValue(session.agentState) as AgentSessionState,
    queuedInputs: session.queuedInputs
      ? sanitizeGenericStorageValue(session.queuedInputs) as ChatSessionInfo['queuedInputs']
      : undefined,
    pendingPlan: session.pendingPlan
      ? sanitizeGenericStorageValue(session.pendingPlan) as ChatSessionInfo['pendingPlan']
      : undefined,
    revert: session.revert ? sanitizeGenericStorageValue(session.revert) as ChatSessionInfo['revert'] : undefined,
  };
}

function deriveFirstUserMessagePreview(raw: ChatSessionInfo): string | undefined {
  const stored = createSessionPreview((raw as any).firstUserMessagePreview || '');
  if (stored) return stored;

  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const firstUserMessage = messages.find(message => message?.role === 'user');
  return createSessionPreview(firstUserMessage?.content || '');
}

export function createChatSessionPersistenceService(
  controller: ChatSessionPersistenceDeps
): ChatSessionPersistenceService {
  const runtime = controller as ChatSessionPersistenceRuntime;
  const service = bindChatControllerService(runtime, {
    isSessionPersistenceEnabled(this: ChatSessionPersistenceRuntime): boolean {
      return (
        vscode.workspace.getConfiguration('lingyun').get<boolean>('sessions.persist', true) ?? true
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
      const base = sanitizeSessionForStorage(session);

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
        firstUserMessagePreview: deriveFirstUserMessagePreview(raw),
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
      const rawHistory = Array.isArray(state.history) ? state.history : [];

      const isValid = rawHistory.every((msg: any) => {
        if (!msg || typeof msg !== 'object') return false;
        if (typeof msg.id !== 'string' || !msg.id) return false;
        if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') return false;
        return Array.isArray(msg.parts);
      });

      if (!isValid) return this.runtime.getBlankAgentState();
      const history = cloneAgentHistoryMessages(rawHistory);

      const fileHandlesRaw = state.fileHandles;
      const fileHandles = normalizeFileHandlesState(fileHandlesRaw);

      const semanticHandlesRaw = state.semanticHandles;
      const semanticHandles = normalizeSemanticHandlesState(semanticHandlesRaw);

      const pendingInputsRaw = (state as any).pendingInputs;
      const pendingInputs =
        Array.isArray(pendingInputsRaw)
          ? pendingInputsRaw
              .map((input: unknown) => parseUserHistoryInput(input))
              .filter((input): input is NonNullable<AgentSessionState['pendingInputs']>[number] => input !== undefined)
          : undefined;

      const mentionedSkillsRaw = (state as any).mentionedSkills;
      const mentionedSkills = normalizeOptionalMentionedSkills(mentionedSkillsRaw);
      const systemPromptSnapshot = normalizeSystemPromptSnapshot((state as any).systemPromptSnapshot);

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
        ...(systemPromptSnapshot ? { systemPromptSnapshot } : {}),
        stats: getAgentHistoryStats(history),
        ...(pendingInputs ? { pendingInputs } : {}),
        ...(mentionedSkills && mentionedSkills.length > 0 ? { mentionedSkills } : {}),
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
        postInputNotice(this, 'Stop the current task before clearing saved sessions.');
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
      this.queueManager.clearAllRuntimeData();

      this.activeSessionId = crypto.randomUUID();
      this.runtime.initializeSessions();
      this.runtime.persistActiveSession();

      if (this.view) {
        this.postMessage({ type: 'cleared' });
        await this.sendInit(true);
      }

      postInputNotice(this, 'Saved sessions cleared.');
    },
  });
  Object.assign(runtime, service);
  return service;
}
