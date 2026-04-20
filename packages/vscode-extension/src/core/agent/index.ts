import * as vscode from 'vscode';

import {
  cloneFileHandlesState,
  cloneSemanticHandlesState,
  createBlankFileHandlesState,
  createBlankSemanticHandlesState,
  LingyunAgent,
  LingyunSession,
  normalizeFileHandlesState,
  stripTransientSyntheticMessages,
  type LingyunCompactionSyntheticContext,
} from '@kooka/agent-sdk';
import type { AgentConfig as SdkAgentConfig } from '@kooka/agent-sdk';
import type { AgentHistoryMessage, UserHistoryInput } from '@kooka/core';
import {
  cloneAgentHistoryMessages,
  cloneUserHistoryInput,
  createUserHistoryMessage,
  parseUserHistoryInput,
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

export type AgentSessionState = {
  history: AgentHistoryMessage[];
  fileHandles?: LingyunSession['fileHandles'];
  semanticHandles?: SemanticHandlesState;
  mentionedSkills?: string[];
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
    const history = cloneAgentHistoryMessages(stripTransientSyntheticMessages(this.session.history));
    const fileHandles = cloneFileHandlesState(this.session.fileHandles);

    return {
      history,
      fileHandles,
      semanticHandles: cloneSemanticHandlesState(this.session.semanticHandles),
      mentionedSkills: [...(this.session.mentionedSkills || [])],
      pendingInputs: this.session.getPendingInputs().map((input) => cloneUserHistoryInput(input)),
      compactionSyntheticContexts: this.session.compactionSyntheticContexts.map((context) => ({ ...context })),
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

    const history = Array.isArray(state.history) ? [...state.history] : [];
    this.session.history = history;
    this.session.setMentionedSkills(state.mentionedSkills);
    this.session.setPendingInputs(
      Array.isArray(state.pendingInputs)
        ? state.pendingInputs
            .map((input) => parseUserHistoryInput(input))
            .filter((input): input is UserHistoryInput => input !== undefined)
        : [],
    );
    this.session.compactionSyntheticContexts = Array.isArray(state.compactionSyntheticContexts)
      ? state.compactionSyntheticContexts
          .filter(
            (context): context is LingyunCompactionSyntheticContext =>
              !!context &&
              typeof context === 'object' &&
              ((context as any).transientContext === 'explore' ||
                (context as any).transientContext === 'memoryRecall') &&
              typeof (context as any).text === 'string',
          )
          .map((context) => ({ ...context }))
      : [];

    this.session.fileHandles = normalizeFileHandlesState(state.fileHandles) ?? createBlankFileHandlesState();

    this.session.semanticHandles = state.semanticHandles
      ? cloneSemanticHandlesState(state.semanticHandles)
      : createBlankSemanticHandlesState();
  }

  get running(): boolean {
    return this._running;
  }

  getHistory(): AgentHistoryMessage[] {
    return [...this.session.history];
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

    if (params.execution && Object.keys(params.execution).length > 0) {
      this.updateConfig(params.execution);
    }
    if (params.session && Object.keys(params.session).length > 0) {
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
