import * as vscode from 'vscode';

import { getMessageText } from '@kooka/core';

import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { getModelLimit } from '../../core/compaction';
import { resolveConfiguredModelId } from '../../core/modelSelection';
import { createBlankSessionSignals } from '../../core/sessionSignals';
import type { LLMProvider } from '../../core/types';
import type { ModelInfo } from '../../providers/modelCatalog';
import type { OfficeSync } from '../office/sync';
import { bindChatControllerService } from './controllerService';
import { createDefaultSessionTitle, getSessionDisplayTitle } from './sessionTitle';
import { formatErrorForUser, isCancellationMessage } from './utils';
import type { ChatMessage, ChatSessionInfo } from './types';
import type { PendingApprovalEntry } from './controllerPorts';
import type { ChatSessionPersistenceService } from './methods.sessions.persistence';

export interface ChatSessionRuntimeService {
  initializeSessions(): void;
  getBlankAgentState(): AgentSessionState;
  getActiveSession(): ChatSessionInfo;
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
  getRenderableMessages(): ChatMessage[];
  persistActiveSession(): void;
  getSessionsForUI(): Array<{ id: string; title: string }>;
  postSessions(): void;
  createNewSession(): Promise<void>;
  switchToSession(sessionId: string): Promise<void>;
  switchToSessionSync(sessionId: string): void;
  setBackend(agent: AgentLoop, llmProvider?: LLMProvider): Promise<void>;
  clearCurrentSession(): Promise<void>;
  compactCurrentSession(): Promise<void>;
}

export interface ChatSessionRuntimeDeps {
  view?: vscode.WebviewView;
  outputChannel?: vscode.OutputChannel;
  officeSync?: Pick<OfficeSync, 'sync'>;
  agent: AgentLoop;
  llmProvider?: LLMProvider;
  availableModels: ModelInfo[];
  currentModel: string;
  mode: 'build' | 'plan';
  activeSessionId: string;
  messages: ChatMessage[];
  sessions: Map<string, ChatSessionInfo>;
  signals: ReturnType<typeof createBlankSessionSignals>;
  stepCounter: number;
  activeStepId?: string;
  abortRequested: boolean;
  isProcessing: boolean;
  pendingApprovals: Map<string, PendingApprovalEntry>;
  initAcked: boolean;
  loopManager: {
    normalizeSessionState(raw: unknown): ChatSessionInfo['loop'];
    syncActiveSession(options?: { resetSchedule?: boolean }): void;
    releaseSession(session: ChatSessionInfo | undefined): void;
    clearAllRuntimeData(): void;
  };
  queueManager: {
    clearActiveSession(options?: { persist?: boolean }): void;
    clearAllRuntimeData(): void;
  };
  persistence: Pick<ChatSessionPersistenceService, 'ensureSessionsLoaded' | 'markSessionDirty'>;
  sendInit(force?: boolean): Promise<void>;
  postMessage(message: unknown): void;
  postLoopState(): void;
}

type ChatSessionRuntimeRuntime = ChatSessionRuntimeDeps & ChatSessionRuntimeService;

function positiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function findModelInfo(models: ModelInfo[], modelId: string): ModelInfo | undefined {
  const normalized = modelId.trim();
  if (!normalized) return undefined;
  return models.find((model) => model.id === normalized);
}

export function createChatSessionRuntimeService(
  controller: ChatSessionRuntimeDeps
): ChatSessionRuntimeService {
  const runtime = controller as ChatSessionRuntimeRuntime;
  const service = bindChatControllerService(runtime, {
    initializeSessions(this: ChatSessionRuntimeRuntime): void {
      this.sessions.clear();
      const initialId = this.activeSessionId || crypto.randomUUID();
      const session: ChatSessionInfo = {
        id: initialId,
        title: createDefaultSessionTitle(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        signals: createBlankSessionSignals(),
        messages: [],
        agentState: this.getBlankAgentState(),
        currentModel: this.currentModel,
        mode: this.mode,
        stepCounter: 0,
        queuedInputs: [],
        loop: this.loopManager.normalizeSessionState(undefined),
      };
      this.sessions.set(initialId, session);
      this.switchToSessionSync(initialId);
    },

    getBlankAgentState(this: ChatSessionRuntimeRuntime): AgentSessionState {
      return {
        history: [],
        fileHandles: { nextId: 1, byId: {} },
        semanticHandles: {
          nextMatchId: 1,
          nextSymbolId: 1,
          nextLocId: 1,
          matches: {},
          symbols: {},
          locations: {},
        },
        pendingInputs: [],
        compactionSyntheticContexts: [],
      };
    },

    getActiveSession(this: ChatSessionRuntimeRuntime): ChatSessionInfo {
      const session = this.sessions.get(this.activeSessionId);
      if (!session) {
        throw new Error('Active session missing');
      }
      return session;
    },

    getContextForUI(this: ChatSessionRuntimeRuntime): {
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

        const modelLimit = getModelLimit(this.currentModel, this.llmProvider?.id);
        const modelInfo = findModelInfo(this.availableModels, this.currentModel);
        const configuredMaxOutputTokens = positiveFiniteNumber(
          vscode.workspace.getConfiguration('lingyun').get<unknown>('maxOutputTokens')
        );

        const totalTokens = tokens?.total;
        const contextLimitTokens =
          positiveFiniteNumber(modelLimit?.context) ?? positiveFiniteNumber(modelInfo?.maxInputTokens);
        const outputLimitTokens =
          positiveFiniteNumber(modelLimit?.output) ??
          positiveFiniteNumber(modelInfo?.maxOutputTokens) ??
          configuredMaxOutputTokens ??
          32000;
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
          outputLimitTokens,
          percent,
        };
      } catch {
        return {};
      }
    },

    getRenderableMessages(this: ChatSessionRuntimeRuntime): ChatMessage[] {
      const session = this.getActiveSession();
      const boundaryId = session.revert?.messageId;
      if (!boundaryId) return this.messages;

      const boundaryIndex = this.messages.findIndex(m => m.id === boundaryId);
      if (boundaryIndex < 0) return this.messages;

      return this.messages.slice(0, boundaryIndex);
    },

    persistActiveSession(this: ChatSessionRuntimeRuntime): void {
      const session = this.getActiveSession();
      session.updatedAt = Date.now();
      session.signals = this.signals;
      session.messages = this.messages;
      session.agentState = this.agent.exportState();
      session.currentModel = this.currentModel;
      session.mode = this.mode;
      session.stepCounter = this.stepCounter;
      session.activeStepId = this.activeStepId;
      session.runtime = { wasRunning: this.isProcessing, updatedAt: Date.now() };
      this.persistence.markSessionDirty(session.id);
    },

    getSessionsForUI(this: ChatSessionRuntimeRuntime): Array<{ id: string; title: string }> {
      return [...this.sessions.values()].map(s => ({
        id: s.id,
        title: s.parentSessionId ? `↳ ${getSessionDisplayTitle(s)}` : getSessionDisplayTitle(s),
      }));
    },

    postSessions(this: ChatSessionRuntimeRuntime): void {
      this.postMessage({
        type: 'sessions',
        sessions: this.getSessionsForUI(),
        activeSessionId: this.activeSessionId,
      });
      this.officeSync?.sync();
    },

    async createNewSession(this: ChatSessionRuntimeRuntime): Promise<void> {
      if (this.isProcessing) {
        vscode.window.showInformationMessage(
          'LingYun: Stop the current task before starting a new session.'
        );
        return;
      }

      await this.persistence.ensureSessionsLoaded();
      this.persistActiveSession();

      const id = crypto.randomUUID();
      const now = Date.now();

      const session: ChatSessionInfo = {
        id,
        title: createDefaultSessionTitle(new Date(now)),
        createdAt: now,
        updatedAt: now,
        signals: createBlankSessionSignals(now),
        messages: [],
        agentState: this.getBlankAgentState(),
        currentModel: this.currentModel,
        mode: this.mode,
        stepCounter: 0,
        queuedInputs: [],
        loop: this.loopManager.normalizeSessionState(undefined),
      };

      this.sessions.set(id, session);
      this.switchToSessionSync(id);
      this.persistence.markSessionDirty(id);
      await this.sendInit(true);
    },

    async switchToSession(this: ChatSessionRuntimeRuntime, sessionId: string): Promise<void> {
      if (this.isProcessing) {
        vscode.window.showInformationMessage(
          'LingYun: Stop the current task before switching sessions.'
        );
        return;
      }
      await this.persistence.ensureSessionsLoaded();
      if (!this.sessions.has(sessionId)) return;

      this.persistActiveSession();
      this.switchToSessionSync(sessionId);
      await this.sendInit(true);
    },

    switchToSessionSync(this: ChatSessionRuntimeRuntime, sessionId: string): void {
      const session = this.sessions.get(sessionId);
      if (!session) return;

      this.activeSessionId = sessionId;
      this.messages = session.messages;
      this.signals = session.signals;
      this.stepCounter = session.stepCounter;
      this.activeStepId = session.activeStepId;
      this.currentModel = session.currentModel;
      this.mode = session.mode;

      this.agent.syncSession({
        state: session.agentState,
        execution: {
          model: this.currentModel,
          mode: this.mode,
        },
        session: {
          sessionId,
          parentSessionId: session.parentSessionId,
          subagentType: session.subagentType,
        },
      });

      this.loopManager.syncActiveSession({ resetSchedule: true });
      this.officeSync?.sync();
    },

    async setBackend(
      this: ChatSessionRuntimeRuntime,
      agent: AgentLoop,
      llmProvider?: LLMProvider
    ): Promise<void> {
      this.agent = agent;
      this.llmProvider = llmProvider;
      this.isProcessing = false;
      this.loopManager.clearAllRuntimeData();
      this.availableModels = [];
      this.currentModel = resolveConfiguredModelId(this.llmProvider?.id);
      this.mode =
        (vscode.workspace.getConfiguration('lingyun').get<string>('mode') || this.mode) === 'plan'
          ? 'plan'
          : 'build';
      this.stepCounter = 0;
      this.activeStepId = undefined;
      this.abortRequested = false;
      this.pendingApprovals.clear();
      this.initAcked = false;

      await this.persistence.ensureSessionsLoaded();
      for (const session of this.sessions.values()) {
        session.currentModel = this.currentModel;
      }

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

    async clearCurrentSession(this: ChatSessionRuntimeRuntime): Promise<void> {
      if (this.isProcessing) {
        vscode.window.showInformationMessage('LingYun: Stop the current task before clearing the session.');
        return;
      }

      const session = this.getActiveSession();
      session.signals = createBlankSessionSignals();
      session.messages = [];
      session.pendingPlan = undefined;
      this.queueManager.clearActiveSession({ persist: false });
      this.loopManager.releaseSession(session);
      if (session.loop) {
        session.loop.lastFiredAt = undefined;
      }
      session.stepCounter = 0;
      session.activeStepId = undefined;
      session.agentState = this.getBlankAgentState();
      this.switchToSessionSync(session.id);

      this.stepCounter = 0;
      this.activeStepId = undefined;
      this.abortRequested = false;

      this.postMessage({ type: 'cleared' });
      this.postMessage({ type: 'planPending', value: false, planMessageId: '' });
      this.persistActiveSession();
    },

    async compactCurrentSession(this: ChatSessionRuntimeRuntime): Promise<void> {
      if (this.isProcessing) {
        vscode.window.showInformationMessage('LingYun: Stop the current task before compacting.');
        return;
      }

      if (!this.view) {
        void vscode.window.showInformationMessage('LINGYUN: AGENT view is not ready.');
        return;
      }

      await this.persistence.ensureSessionsLoaded();

      if (this.agent.getHistory().length === 0) {
        void vscode.window.showInformationMessage('LingYun: Nothing to compact yet.');
        return;
      }

      const startedAt = Date.now();
      const operationId = crypto.randomUUID();
      const maxCompactionSummaryChars = 20000;

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
      this.loopManager.syncActiveSession();
      this.postMessage({ type: 'processing', value: true });
      this.postLoopState();

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
              summaryText.length > maxCompactionSummaryChars
                ? summaryText.slice(0, maxCompactionSummaryChars) + '\n\n[Summary truncated in UI]'
                : summaryText;
            operationMsg.operation.summaryTruncated = summaryText.length > maxCompactionSummaryChars;
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
        const formatted = formatErrorForUser(error, { llmProviderId: this.llmProvider?.id });
        const canceled = this.abortRequested || isCancellationMessage(formatted);
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
        this.loopManager.syncActiveSession();
        this.postMessage({ type: 'processing', value: false });
        this.postLoopState();
        this.persistActiveSession();
      }
    },
  });
  Object.assign(runtime, service);
  return service;
}
