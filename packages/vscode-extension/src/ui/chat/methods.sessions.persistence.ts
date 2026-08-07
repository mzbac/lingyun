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
import { appendErrorLog, appendLog } from '../../core/logger';
import { resolveModelIdWithWorkspaceDefaults } from '../../core/modelSelection';
import { normalizeSessionSignals } from '../../core/sessionSignals';
import { SessionStore } from '../../core/sessionStore';
import { bindChatControllerService } from './controllerService';
import { postInputNotice } from './inputNotice';
import { compareSessionRecency } from './sessionOrdering';
import { createDefaultSessionTitle, createSessionPreview } from './sessionTitle';
import { getSessionsMaxSessionBytes, getSessionsMaxSessions, getSessionsPersistEnabled } from './webviewSettings';
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
type InterruptedSessionMessages = {
  lastRunningStep?: ChatMessage;
  lastTool?: ChatMessage;
};
type SessionRecencyCandidate = {
  session: ChatSessionInfo;
  index: number;
};

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

function findLatestInterruptedSessionMessages(messages: ChatMessage[]): InterruptedSessionMessages {
  let lastRunningStep: ChatMessage | undefined;
  let lastTool: ChatMessage | undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!lastRunningStep && message?.role === 'step' && message.step?.status === 'running') {
      lastRunningStep = message;
    }
    if (
      !lastTool &&
      message?.role === 'tool' &&
      (message.toolCall?.status === 'running' || message.toolCall?.status === 'pending')
    ) {
      lastTool = message;
    }
    if (lastRunningStep && lastTool) break;
  }

  return { lastRunningStep, lastTool };
}

function collectSessionIdsToKeep(
  sessions: Map<string, ChatSessionInfo>,
  maxSessions: number,
  activeSessionId: string
): Set<string> {
  const limit = Number.isFinite(maxSessions) ? Math.max(1, Math.floor(maxSessions)) : 1;
  const activeExists = sessions.has(activeSessionId);
  const candidateLimit = Math.max(0, limit - (activeExists ? 1 : 0));
  const recent: SessionRecencyCandidate[] = [];
  let active: SessionRecencyCandidate | undefined;
  let index = 0;

  const compareCandidates = (
    left: SessionRecencyCandidate,
    right: SessionRecencyCandidate
  ): number => {
    const timestampOrder = compareSessionRecency(left.session, right.session);
    if (timestampOrder !== 0) return timestampOrder;
    if (left.index === right.index) return 0;
    return left.index > right.index ? 1 : -1;
  };

  const siftUp = (candidate: SessionRecencyCandidate): void => {
    let childIndex = recent.length;
    recent.push(candidate);
    while (childIndex > 0) {
      const parentIndex = (childIndex - 1) >> 1;
      if (compareCandidates(recent[parentIndex], recent[childIndex]) <= 0) break;
      [recent[parentIndex], recent[childIndex]] = [recent[childIndex], recent[parentIndex]];
      childIndex = parentIndex;
    }
  };

  const siftDown = (): void => {
    let parentIndex = 0;
    while (true) {
      const leftIndex = parentIndex * 2 + 1;
      if (leftIndex >= recent.length) return;
      const rightIndex = leftIndex + 1;
      let oldestIndex = leftIndex;
      if (
        rightIndex < recent.length &&
        compareCandidates(recent[rightIndex], recent[leftIndex]) < 0
      ) {
        oldestIndex = rightIndex;
      }
      if (compareCandidates(recent[parentIndex], recent[oldestIndex]) <= 0) return;
      [recent[parentIndex], recent[oldestIndex]] = [recent[oldestIndex], recent[parentIndex]];
      parentIndex = oldestIndex;
    }
  };

  for (const session of sessions.values()) {
    const candidate = { session, index };
    index++;
    if (session.id === activeSessionId) {
      active = candidate;
      continue;
    }
    if (candidateLimit === 0) continue;
    if (recent.length < candidateLimit) {
      siftUp(candidate);
      continue;
    }
    if (compareCandidates(candidate, recent[0]) <= 0) continue;
    recent[0] = candidate;
    siftDown();
  }

  if (active) recent.push(active);
  recent.sort(compareCandidates);
  const keep = new Set<string>();
  for (const candidate of recent) keep.add(candidate.session.id);
  return keep;
}

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
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) {
      if (i in value) out[i] = sanitizeGenericStorageValue(value[i], depth + 1);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      out[key] = sanitizeGenericStorageValue(record[key], depth + 1);
    }
  }
  return out;
}

function asStorageRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOwnStorageKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function storageValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      if ((index in left) !== (index in right)) return false;
      if (index in left && !storageValuesEqual(left[index], right[index])) return false;
    }
    return true;
  }

  const leftRecord = asStorageRecord(left);
  const rightRecord = asStorageRecord(right);
  if (!leftRecord || !rightRecord) return false;

  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!hasOwnStorageKey(rightRecord, key)) return false;
    if (!storageValuesEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

function removeChangedExactReplayArtifacts(originalState: unknown, sanitizedState: unknown): void {
  const originalHistory = asStorageRecord(originalState)?.history;
  const sanitizedHistory = asStorageRecord(sanitizedState)?.history;
  if (!Array.isArray(originalHistory) || !Array.isArray(sanitizedHistory)) return;

  const messageCount = Math.min(originalHistory.length, sanitizedHistory.length);
  for (let messageIndex = 0; messageIndex < messageCount; messageIndex++) {
    const originalMessage = asStorageRecord(originalHistory[messageIndex]);
    const sanitizedMessage = asStorageRecord(sanitizedHistory[messageIndex]);
    if (!originalMessage || !sanitizedMessage) continue;

    const originalMetadata = asStorageRecord(originalMessage.metadata);
    const sanitizedMetadata = asStorageRecord(sanitizedMessage.metadata);
    if (originalMetadata && hasOwnStorageKey(originalMetadata, 'replay')) {
      const replayUnchanged = !!sanitizedMetadata
        && hasOwnStorageKey(sanitizedMetadata, 'replay')
        && storageValuesEqual(originalMetadata.replay, sanitizedMetadata.replay);
      if (!replayUnchanged && sanitizedMetadata) {
        delete sanitizedMetadata.replay;
      }
    }

    const originalParts = originalMessage.parts;
    const sanitizedParts = sanitizedMessage.parts;
    if (!Array.isArray(originalParts) || !Array.isArray(sanitizedParts)) continue;

    const partCount = Math.min(originalParts.length, sanitizedParts.length);
    for (let partIndex = 0; partIndex < partCount; partIndex++) {
      const originalPart = asStorageRecord(originalParts[partIndex]);
      const sanitizedPart = asStorageRecord(sanitizedParts[partIndex]);
      if (!originalPart || !sanitizedPart) continue;

      const originalCallMetadata = asStorageRecord(originalPart.callProviderMetadata);
      const originalOpenAICompatible = asStorageRecord(originalCallMetadata?.openaiCompatible);
      if (!originalOpenAICompatible || !hasOwnStorageKey(originalOpenAICompatible, 'kookaReplay')) {
        continue;
      }

      const sanitizedCallMetadata = asStorageRecord(sanitizedPart.callProviderMetadata);
      const sanitizedOpenAICompatible = asStorageRecord(sanitizedCallMetadata?.openaiCompatible);
      const markerUnchanged = !!sanitizedOpenAICompatible
        && hasOwnStorageKey(sanitizedOpenAICompatible, 'kookaReplay')
        && storageValuesEqual(
          originalOpenAICompatible.kookaReplay,
          sanitizedOpenAICompatible.kookaReplay
        );
      if (markerUnchanged || !sanitizedOpenAICompatible) continue;

      delete sanitizedOpenAICompatible.kookaReplay;
      if (Object.keys(sanitizedOpenAICompatible).length === 0 && sanitizedCallMetadata) {
        delete sanitizedCallMetadata.openaiCompatible;
      }
      if (sanitizedCallMetadata && Object.keys(sanitizedCallMetadata).length === 0) {
        delete sanitizedPart.callProviderMetadata;
      }
    }
  }
}

function sanitizeAgentStateForStorage(agentState: AgentSessionState): AgentSessionState {
  const sanitized = sanitizeGenericStorageValue(agentState) as AgentSessionState;
  removeChangedExactReplayArtifacts(agentState, sanitized);
  return sanitized;
}

function sanitizeToolArgValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 20) return '[omitted:depth]';
  const normalizedKey = normalizeStorageKey(key);
  if (OMIT_PERSISTED_ARG_KEYS.has(normalizedKey)) return '[omitted from persisted session]';
  if (REDACT_PERSISTED_ARG_KEYS.has(normalizedKey)) return '[redacted]';
  if (typeof value === 'string') return redactStringForStorage(value, MAX_PERSISTED_ARG_STRING_CHARS);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) {
      if (i in value) out[i] = sanitizeToolArgValue('', value[i], depth + 1);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const childKey in record) {
    if (Object.prototype.hasOwnProperty.call(record, childKey)) {
      out[childKey] = sanitizeToolArgValue(childKey, record[childKey], depth + 1);
    }
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

function sanitizeBatchFilesForStorage(batchFiles: unknown): string[] | undefined {
  if (!Array.isArray(batchFiles)) return undefined;
  const sanitized = new Array<string>(batchFiles.length);
  for (let i = 0; i < batchFiles.length; i++) {
    sanitized[i] = redactStringForStorage(String(batchFiles[i] || ''), 1_000);
  }
  return sanitized;
}

function sanitizeToolCallForStorage(toolCall: NonNullable<ChatMessage['toolCall']>): NonNullable<ChatMessage['toolCall']> {
  const sanitized: NonNullable<ChatMessage['toolCall']> = {
    ...toolCall,
    args: sanitizeToolArgsForStorage(toolCall.args),
    result: toolCall.result ? redactStringForStorage(toolCall.result, 4_000) : undefined,
    path: toolCall.path ? redactStringForStorage(toolCall.path, 1_000) : undefined,
    approvalReason: toolCall.approvalReason ? redactStringForStorage(toolCall.approvalReason, 1_000) : undefined,
    blockedReason: toolCall.blockedReason ? redactStringForStorage(toolCall.blockedReason, 1_000) : undefined,
    batchFiles: sanitizeBatchFilesForStorage(toolCall.batchFiles),
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

function sanitizeMessagesForStorage(messages: ChatMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const sanitized = new Array<ChatMessage>(messages.length);
  for (let i = 0; i < messages.length; i++) {
    sanitized[i] = sanitizeMessageForStorage(messages[i]);
  }
  return sanitized;
}

export function sanitizeSessionForStorage(session: ChatSessionInfo): ChatSessionInfo {
  return {
    ...session,
    title: redactStringForStorage(session.title, 500),
    firstUserMessagePreview: session.firstUserMessagePreview
      ? redactStringForStorage(session.firstUserMessagePreview, 500)
      : undefined,
    signals: sanitizeGenericStorageValue(session.signals) as ChatSessionInfo['signals'],
    messages: sanitizeMessagesForStorage(session.messages),
    agentState: sanitizeAgentStateForStorage(session.agentState),
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
  for (const message of messages) {
    if (message?.role !== 'user') continue;
    return createSessionPreview(message.content || '');
  }
  return undefined;
}

function normalizeLoadedQueuedInputs(raw: unknown, now: number): ChatSessionInfo['queuedInputs'] {
  if (!Array.isArray(raw)) return [];

  const maxQueuedInputs = Math.min(raw.length, 50);
  const normalized: NonNullable<ChatSessionInfo['queuedInputs']> = new Array(maxQueuedInputs);
  let writeIndex = maxQueuedInputs;
  let count = 0;
  for (let i = raw.length - 1; i >= 0 && count < maxQueuedInputs; i--) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;

    const value = item as Record<string, unknown>;
    writeIndex--;
    normalized[writeIndex] = {
      id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
      createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : now,
      message: typeof value.message === 'string' ? value.message : '',
      displayContent: typeof value.displayContent === 'string' ? value.displayContent : '',
      attachmentCount:
        typeof value.attachmentCount === 'number' && Number.isFinite(value.attachmentCount)
          ? Math.max(0, Math.floor(value.attachmentCount))
          : 0,
    };
    count++;
  }

  if (count === 0) return [];
  if (writeIndex === 0) return normalized;

  const compacted: NonNullable<ChatSessionInfo['queuedInputs']> = new Array(count);
  for (let i = 0; i < count; i++) {
    compacted[i] = normalized[writeIndex + i];
  }
  return compacted;
}

function normalizeLoadedPendingInputs(raw: unknown): AgentSessionState['pendingInputs'] {
  if (!Array.isArray(raw)) return undefined;

  const pendingInputs: NonNullable<AgentSessionState['pendingInputs']> = [];
  for (const input of raw) {
    const normalized = parseUserHistoryInput(input);
    if (normalized !== undefined) pendingInputs.push(normalized);
  }
  return pendingInputs;
}

function normalizeLoadedCompactionSyntheticContexts(raw: unknown): AgentSessionState['compactionSyntheticContexts'] {
  if (!Array.isArray(raw)) return undefined;

  const contexts: NonNullable<AgentSessionState['compactionSyntheticContexts']> = [];
  for (const context of raw) {
    if (!context || typeof context !== 'object') continue;

    const value = context as Record<string, unknown>;
    const transientContext = value.transientContext;
    if (transientContext !== 'explore' && transientContext !== 'memoryRecall' && transientContext !== 'goal') {
      continue;
    }
    if (typeof value.text !== 'string') continue;

    contexts.push({ transientContext, text: value.text });
  }
  return contexts;
}

export function createChatSessionPersistenceService(
  controller: ChatSessionPersistenceDeps
): ChatSessionPersistenceService {
  const runtime = controller as ChatSessionPersistenceRuntime;
  const service = bindChatControllerService(runtime, {
    isSessionPersistenceEnabled(this: ChatSessionPersistenceRuntime): boolean {
      return getSessionsPersistEnabled();
    },

    getSessionPersistenceLimits(
      this: ChatSessionPersistenceRuntime
    ): { maxSessions: number; maxSessionBytes: number } {
      return {
        maxSessions: getSessionsMaxSessions(),
        maxSessionBytes: getSessionsMaxSessionBytes(),
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

      if (measure(base) > maxSessionBytes && base.messages.length > 1) {
        const originalMessages = base.messages;
        let low = 0;
        let high = originalMessages.length - 1;
        let bestStart = high;

        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          base.messages = originalMessages.slice(mid);
          if (measure(base) <= maxSessionBytes) {
            bestStart = mid;
            high = mid - 1;
          } else {
            low = mid + 1;
          }
        }

        base.messages = originalMessages.slice(bestStart);
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

      const keepSet = collectSessionIdsToKeep(this.sessions, maxSessions, this.activeSessionId);
      for (const [id, session] of this.sessions) {
        if (keepSet.has(id)) continue;
        this.queueManager.releaseSession(session);
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

      const dirtyIds = this.dirtySessionIds;
      this.dirtySessionIds = new Set<string>();
      const sessionIdsToPersist =
        this.sessions.size > maxSessions
          ? collectSessionIdsToKeep(this.sessions, maxSessions, this.activeSessionId)
          : this.sessions.keys();

      await store.save({
        sessionsById: this.sessions,
        activeSessionId: this.activeSessionId,
        order: sessionIdsToPersist,
        dirtySessionIds: dirtyIds.size > 0 ? dirtyIds : undefined,
      });

      if (dirtyIds.size > 0) {
        void new WorkspaceMemories(this.context).scheduleUpdateFromSessions(undefined, { delayMs: 1500 }).catch(() => {
          // Ignore background refresh failures during session persistence.
        });
      }
    },

    normalizeLoadedSession(this: ChatSessionPersistenceRuntime, raw: ChatSessionInfo): ChatSessionInfo {
      const now = Date.now();
      const queuedInputs = normalizeLoadedQueuedInputs((raw as any).queuedInputs, now);

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

      let historyIsValid = true;
      for (const msg of rawHistory) {
        if (!msg || typeof msg !== 'object') {
          historyIsValid = false;
          break;
        }
        if (typeof msg.id !== 'string' || !msg.id) {
          historyIsValid = false;
          break;
        }
        if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
          historyIsValid = false;
          break;
        }
        if (!Array.isArray(msg.parts)) {
          historyIsValid = false;
          break;
        }
      }

      if (!historyIsValid) return this.runtime.getBlankAgentState();
      const history = cloneAgentHistoryMessages(rawHistory);

      const fileHandlesRaw = state.fileHandles;
      const fileHandles = normalizeFileHandlesState(fileHandlesRaw);

      const semanticHandlesRaw = state.semanticHandles;
      const semanticHandles = normalizeSemanticHandlesState(semanticHandlesRaw);

      const pendingInputs = normalizeLoadedPendingInputs((state as any).pendingInputs);

      const mentionedSkillsRaw = (state as any).mentionedSkills;
      const mentionedSkills = normalizeOptionalMentionedSkills(mentionedSkillsRaw);
      const systemPromptSnapshot = normalizeSystemPromptSnapshot((state as any).systemPromptSnapshot);

      const compactionSyntheticContexts = normalizeLoadedCompactionSyntheticContexts((state as any).compactionSyntheticContexts);

      const loadedState: AgentSessionState = {
        history,
        fileHandles,
        semanticHandles,
        stats: getAgentHistoryStats(history),
      };
      if (systemPromptSnapshot) loadedState.systemPromptSnapshot = systemPromptSnapshot;
      if (pendingInputs) loadedState.pendingInputs = pendingInputs;
      if (mentionedSkills && mentionedSkills.length > 0) loadedState.mentionedSkills = mentionedSkills;
      if (compactionSyntheticContexts) loadedState.compactionSyntheticContexts = compactionSyntheticContexts;
      return loadedState;
    },

    recoverInterruptedSessions(this: ChatSessionPersistenceRuntime): void {
      let changed = false;
      const now = Date.now();

      for (const session of this.sessions.values()) {
        if (!session.runtime?.wasRunning) continue;
        changed = true;

        const { lastRunningStep, lastTool } = findLatestInterruptedSessionMessages(session.messages);
        if (lastRunningStep?.step) {
          lastRunningStep.step.status = 'canceled';
        }

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

          if (!loaded.indexValid) {
            appendErrorLog(
              this.outputChannel,
              'Saved sessions index is unreadable or from an unsupported schema version. Existing session files were kept on disk and will not be overwritten or deleted.',
              new Error('SessionStore.loadAll: invalid sessions index'),
              { tag: 'Sessions' },
            );
            postInputNotice(
              this,
              'Could not restore saved sessions (storage index is unreadable or from an unsupported version). Your old session files were kept on disk.',
            );
            return;
          }

          if (loaded.migratedFromVersion !== undefined) {
            appendLog(this.outputChannel, `Migrated saved sessions index from schema version ${loaded.migratedFromVersion}.`, {
              level: 'info',
              tag: 'Sessions',
            });
          }

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
      const store = this.getOrCreateSessionStore();

      if (!this.sessionsLoadedFromDisk) {
        await this.ensureSessionsLoaded();
      } else if (store) {
        // Recreating the store instance discards its in-memory load state.
        // Re-read the index so the fresh store is authoritative for pruning
        // again (and surface diagnostics if the index is unreadable).
        const loaded = await store.loadAll();
        if (loaded && !loaded.indexValid) {
          appendErrorLog(
            this.outputChannel,
            'Saved sessions index is unreadable or from an unsupported schema version. Existing session files were kept on disk and will not be overwritten or deleted.',
            new Error('SessionStore.loadAll: invalid sessions index'),
            { tag: 'Sessions' },
          );
        }
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
