import * as vscode from 'vscode';

import {
  cloneFileHandlesState,
  cloneSemanticHandlesState,
  createBlankFileHandlesState,
  createBlankSemanticHandlesState,
  cloneThreadGoal,
  LingyunAgent,
  LingyunSession,
  normalizeFileHandlesState,
  normalizeThreadGoal,
  normalizeSystemPromptSnapshot,
  normalizeCompactionSyntheticContexts,
  resolveThreadGoalStatusAfterBudgetLimit,
  type LingyunThreadGoal,
  type LingyunThreadGoalStatus,
  type LingyunCompactionSyntheticContext,
} from '@kooka/agent-sdk';
import type { AgentConfig as SdkAgentConfig } from '@kooka/agent-sdk';
import type { AgentHistoryMessage, AgentHistoryStats, UserHistoryInput } from '@kooka/core';
import {
  cloneAgentHistoryMessages,
  createUserHistoryMessage,
} from '@kooka/core';

import type {
  AgentCallbacks,
  AgentConfig,
  AgentSessionMetadata,
  AgentSessionSeed,
  LLMProvider,
} from '../types';
import type { ToolRegistry } from '../registry';
import { toolRegistry as defaultToolRegistry } from '../registry';
import { generateSessionTitle as generateSessionTitleInternal } from '../sessionTitle';
import type { PluginManager } from '../hooks/pluginManager';
import { getPrimaryWorkspaceRootPath } from '../workspaceContext';

import { BUILD_SWITCH_PROMPT, PLAN_PROMPT } from './prompts';
import { VsCodeAgentRuntimePolicy } from './runtimePolicy';

type SemanticHandlesState = NonNullable<LingyunSession['semanticHandles']>;

const MAX_THREAD_GOAL_OBJECTIVE_CHARS = 4000;

function goalObjectiveExceedsCodePointLimit(value: string, limit: number): boolean {
  let count = 0;
  for (const _ch of value) {
    count++;
    if (count > limit) return true;
  }
  return false;
}

export type AgentSessionState = {
  history: AgentHistoryMessage[];
  fileHandles?: LingyunSession['fileHandles'];
  semanticHandles?: SemanticHandlesState;
  mentionedSkills?: string[];
  threadGoal?: LingyunThreadGoal;
  systemPromptSnapshot?: string[];
  stats?: AgentHistoryStats;
  pendingInputs?: UserHistoryInput[];
  compactionSyntheticContexts?: LingyunCompactionSyntheticContext[];
};

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    return /abort/i.test(error.message);
  }
  return /abort/i.test(String(error));
}

function defaultEditedGoalStatus(status: LingyunThreadGoalStatus | undefined): LingyunThreadGoalStatus {
  return status === 'paused' || status === 'blocked' || status === 'usageLimited' ? status : 'active';
}

function cloneRequiredThreadGoal(goal: LingyunThreadGoal): LingyunThreadGoal {
  const cloned = cloneThreadGoal(goal);
  if (!cloned) {
    throw new Error('Failed to clone thread goal.');
  }
  return cloned;
}

function hasOwnEnumerableProperty(value: object): boolean {
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  }
  return false;
}

function toSdkAgentConfig(config: AgentConfig): SdkAgentConfig {
  const { planFirst: _planFirst, ...rest } = config;
  return {
    ...rest,
    mode: rest.mode === 'plan' ? 'plan' : 'build',
  };
}

export class AgentLoop {
  private _running = false;
  private activeAbortController?: AbortController;
  private readonly plugins?: PluginManager;
  private readonly runtimePolicy: VsCodeAgentRuntimePolicy;

  private session = new LingyunSession({
      history: [],
      fileHandles: createBlankFileHandlesState(),
      semanticHandles: createBlankSemanticHandlesState(),
      mentionedSkills: [],
    });


  private readonly agent: LingyunAgent;

  private config: AgentConfig;
  private sessionMetadata: AgentSessionMetadata = {};

  constructor(
    private readonly llm: LLMProvider,
    private readonly context: vscode.ExtensionContext,
    config: AgentConfig | undefined,
    private readonly registry: ToolRegistry,
    plugins?: PluginManager,
  ) {
    this.config = { ...(config || {}) };
    this.syncSessionMetadata();
    this.plugins = plugins;
    this.runtimePolicy = new VsCodeAgentRuntimePolicy(this.context);

    const allowExternalPaths =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
    const workspaceRoot = getPrimaryWorkspaceRootPath();

    this.agent = new LingyunAgent(
      this.llm,
      toSdkAgentConfig(this.config),
      this.registry.getAgentRegistry(),
      {
        workspaceRoot,
        allowExternalPaths,
        plugins,
        prompts: {
          planPrompt: PLAN_PROMPT,
          buildSwitchPrompt: BUILD_SWITCH_PROMPT,
        },
        runtimePolicy: this.runtimePolicy,
      },
    );
  }

  private getMode(): 'build' | 'plan' {
    return this.config.mode === 'plan' ? 'plan' : 'build';
  }

  private extractSessionMetadata(session: AgentSessionSeed | undefined): AgentSessionMetadata {
    const next: AgentSessionMetadata = {};
    if (session && 'parentSessionId' in session) {
      next.parentSessionId = session.parentSessionId;
    }
    if (session && 'subagentType' in session) {
      next.subagentType = session.subagentType;
    }
    return next;
  }

  private syncSessionMetadata(): void {
    this.session.sessionId = this.config.sessionId;
    this.session.parentSessionId = this.sessionMetadata.parentSessionId;
    this.session.subagentType = this.sessionMetadata.subagentType;
    this.session.modelId = this.config.model;
  }

  exportState(): AgentSessionState {
    const history = cloneAgentHistoryMessages(this.session.history);
    const fileHandles = cloneFileHandlesState(this.session.fileHandles);
    const systemPromptSnapshot = this.session.getSystemPromptSnapshot();

    return {
      history,
      fileHandles,
      semanticHandles: cloneSemanticHandlesState(this.session.semanticHandles),
      mentionedSkills: [...(this.session.mentionedSkills || [])],
      ...(this.session.threadGoal ? { threadGoal: cloneThreadGoal(this.session.threadGoal) } : {}),
      ...(systemPromptSnapshot ? { systemPromptSnapshot } : {}),
      stats: this.session.getStats(),
      pendingInputs: this.session.getPendingInputs(),
      compactionSyntheticContexts: normalizeCompactionSyntheticContexts(this.session.compactionSyntheticContexts),
    };

  }

  resolveFileId(fileId: string): string | undefined {
    const id = String(fileId || '').trim();
    if (!id) return undefined;
    const fileHandles = this.session.fileHandles;
    const resolved = fileHandles?.byId?.[id];
    return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : undefined;
  }

  importState(state: AgentSessionState): void {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    const history = Array.isArray(state.history) ? cloneAgentHistoryMessages(state.history) : [];
    this.session.history = history;
    this.session.setMentionedSkills(state.mentionedSkills);
    this.session.threadGoal = cloneThreadGoal(normalizeThreadGoal(state.threadGoal));
    this.session.setSystemPromptSnapshot(normalizeSystemPromptSnapshot(state.systemPromptSnapshot));
    this.session.setPendingInputs(state.pendingInputs);
    this.session.setCompactionSyntheticContexts(state.compactionSyntheticContexts);

    this.session.fileHandles = normalizeFileHandlesState(state.fileHandles) ?? createBlankFileHandlesState();

    this.session.semanticHandles = state.semanticHandles
      ? cloneSemanticHandlesState(state.semanticHandles)
      : createBlankSemanticHandlesState();
  }

  get running(): boolean {
    return this._running;
  }

  getHistory(): AgentHistoryMessage[] {
    return cloneAgentHistoryMessages(this.session.history);
  }

  getThreadGoal(): LingyunThreadGoal | undefined {
    return cloneThreadGoal(this.session.threadGoal);
  }

  setThreadGoal(goal: LingyunThreadGoal | undefined): void {
    this.session.threadGoal = cloneThreadGoal(normalizeThreadGoal(goal));
  }

  setThreadGoalObjective(params: {
    objective: string;
    tokenBudget?: number;
    status?: LingyunThreadGoalStatus;
    replaceExisting?: boolean;
    preserveUsage?: boolean;
  }): LingyunThreadGoal {
    const objective = String(params.objective || '').trim();
    if (!objective) {
      throw new Error('Goal objective must not be empty.');
    }
    if (goalObjectiveExceedsCodePointLimit(objective, MAX_THREAD_GOAL_OBJECTIVE_CHARS)) {
      throw new Error(`Goal objective must be at most ${MAX_THREAD_GOAL_OBJECTIVE_CHARS} characters.`);
    }

    const now = Date.now();
    const existing = this.session.threadGoal;
    if (existing && !params.replaceExisting) {
      throw new Error('This session already has a goal. Use /goal edit to replace it, or /goal clear first.');
    }
    const preserveUsage = !!params.replaceExisting && !!params.preserveUsage;

    if (
      params.tokenBudget !== undefined &&
      (typeof params.tokenBudget !== 'number' ||
        !Number.isFinite(params.tokenBudget) ||
        !Number.isSafeInteger(params.tokenBudget) ||
        params.tokenBudget <= 0)
    ) {
      throw new Error('Goal token budget must be a positive integer when provided.');
    }
    const tokenBudget = params.tokenBudget;
    const tokensUsed = preserveUsage ? existing?.tokensUsed ?? 0 : 0;
    const requestedStatus = params.status ?? (preserveUsage ? defaultEditedGoalStatus(existing?.status) : 'active');
    const status = resolveThreadGoalStatusAfterBudgetLimit({
      currentStatus: existing?.status,
      requestedStatus,
      tokenBudget: tokenBudget ?? (preserveUsage ? existing?.tokenBudget : undefined),
      tokensUsed,
    });
    const goal: LingyunThreadGoal = {
      id: preserveUsage && existing?.id ? existing.id : crypto.randomUUID(),
      ...(this.session.sessionId ? { sessionId: this.session.sessionId } : {}),
      objective,
      status,
      ...(tokenBudget ? { tokenBudget } : preserveUsage && existing?.tokenBudget ? { tokenBudget: existing.tokenBudget } : {}),
      tokensUsed,
      timeUsedSeconds: preserveUsage ? existing?.timeUsedSeconds ?? 0 : 0,
      createdAt: preserveUsage ? existing?.createdAt ?? now : now,
      updatedAt: now,
    };

    this.session.threadGoal = goal;
    return cloneRequiredThreadGoal(goal);
  }

  updateThreadGoalStatus(status: LingyunThreadGoalStatus): LingyunThreadGoal {
    const goal = this.session.threadGoal;
    if (!goal) {
      throw new Error('No goal is set for this session.');
    }
    goal.status = resolveThreadGoalStatusAfterBudgetLimit({
      currentStatus: goal.status,
      requestedStatus: status,
      tokenBudget: goal.tokenBudget,
      tokensUsed: goal.tokensUsed,
    });
    goal.updatedAt = Date.now();
    return cloneRequiredThreadGoal(goal);
  }

  clearThreadGoal(): void {
    this.session.threadGoal = undefined;
  }

  setMode(mode: 'build' | 'plan'): void {
    this.config = { ...this.config, mode };
    this.agent.setMode(mode);
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...(config || {}) };
    this.agent.updateConfig(toSdkAgentConfig(this.config));
    this.syncSessionMetadata();
  }

  syncSession(params: {
    state?: AgentSessionState;
    execution?: Partial<AgentConfig>;
    session?: AgentSessionSeed;
  }): void {
    if (params.state) {
      this.importState(params.state);
    }

    if (params.execution && hasOwnEnumerableProperty(params.execution)) {
      this.updateConfig(params.execution);
    }
    if (params.session && hasOwnEnumerableProperty(params.session)) {
      if (params.session.sessionId !== undefined) {
        this.updateConfig({ sessionId: params.session.sessionId });
      }
      this.sessionMetadata = { ...this.sessionMetadata, ...this.extractSessionMetadata(params.session) };
    }

    this.syncSessionMetadata();
  }

  async generateSessionTitle(message: string, options?: { maxChars?: number; modelId?: string }): Promise<string | undefined> {
    const modelId = (options?.modelId || this.config.model || '').trim();
    if (!modelId) return undefined;

    try {
      return await generateSessionTitleInternal({
        llm: this.llm,
        modelId,
        message,
        maxRetries: this.config.maxRetries ?? 0,
        maxOutputTokens: 64,
        maxChars: options?.maxChars ?? 50,
      });
    } catch {
      return undefined;
    }
  }

  private startRun(): AbortSignal {
    this._running = true;
    this.activeAbortController?.abort();
    this.activeAbortController = new AbortController();
    return this.activeAbortController.signal;
  }

  private endRun(): void {
    this._running = false;
    this.activeAbortController = undefined;
  }

  private async withRun<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.startRun();
    try {
      return await fn(signal);
    } catch (error) {
      // Only show "Agent aborted" when the user explicitly aborted the run.
      // Timeout-driven AbortSignals (or provider-side aborts) should preserve the original error so the UI can show details.
      if (this.activeAbortController?.signal.aborted && isAbortError(error)) {
        throw new Error('Agent aborted');
      }
      throw error;
    } finally {
      this.endRun();
    }
  }

  async plan(task: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    return await this.withRun(async (signal) => {
      const run = this.agent.run({
        session: this.session,
        input: task,
        callbacks,
        signal,
        configOverride: { mode: 'plan' },
      });
      const result = await run.done;
      return String(result.text || '').trim();
    });
  }

  async execute(callbacks?: AgentCallbacks, options?: { approvedPlan?: string }): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.session.history.length === 0) {
      throw new Error('No active task. Call plan() or run() first.');
    }

    const approvedPlan = String(options?.approvedPlan || '').trim();
    if (approvedPlan) {
      this.session.history.push(createUserHistoryMessage(`## Approved Plan\n${approvedPlan}`, { synthetic: true }));
    }

    return await this.withRun(async (signal) => {
      return await this.agent.resume({ session: this.session, callbacks, signal });
    });
  }

  async run(task: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    this.session = new LingyunSession({
      history: [],
      sessionId: this.config.sessionId,
      parentSessionId: this.sessionMetadata.parentSessionId,
      subagentType: this.sessionMetadata.subagentType,
      modelId: this.config.model,
      mentionedSkills: [...(this.session.mentionedSkills || [])],
      threadGoal: this.session.threadGoal,
      fileHandles: createBlankFileHandlesState(),
      semanticHandles: createBlankSemanticHandlesState(),
    });

    return await this.withRun(async (signal) => {
      const run = this.agent.run({
        session: this.session,
        input: task,
        callbacks,
        signal,
      });
      const result = await run.done;
      return result.text;
    });
  }

  async continue(message: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    return await this.withRun(async (signal) => {
      const run = this.agent.run({
        session: this.session,
        input: message,
        callbacks,
        signal,
      });
      const result = await run.done;
      return result.text;
    });
  }

  async resume(callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.session.history.length === 0) {
      throw new Error('No active task to resume. Start a task first.');
    }

    return await this.withRun(async (signal) => {
      return await this.agent.resume({ session: this.session, callbacks, signal });
    });
  }

  async compactSession(): Promise<void> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.session.history.length === 0) return;

    await this.withRun(async () => {
      await this.agent.compactSession(this.session, undefined, { modelId: this.config.model, auto: false });
    });
  }

  abort(): void {
    this.activeAbortController?.abort();
  }

  steer(input: UserHistoryInput): void {
    if (!this._running) {
      throw new Error('Agent is not running');
    }
    this.session.enqueuePendingInput(input);
  }

  async clear(): Promise<void> {
    this.session.clearRuntimeState();
  }
}

export function createAgent(
  llm: LLMProvider,
  context: vscode.ExtensionContext,
  config?: AgentConfig,
  plugins?: PluginManager,
): AgentLoop {
  return new AgentLoop(llm, context, config, defaultToolRegistry, plugins);
}
