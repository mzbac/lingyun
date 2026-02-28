import * as vscode from 'vscode';
import * as path from 'path';

import { LingyunAgent, LingyunSession } from '@kooka/agent-sdk';
import type { AgentHistoryMessage, UserHistoryInput } from '@kooka/core';
import { createAssistantHistoryMessage, createUserHistoryMessage, resolveBuiltinSubagent } from '@kooka/core';

import type { AgentCallbacks, AgentConfig, LLMProvider } from '../types';
import type { ToolRegistry } from '../registry';
import { toolRegistry as defaultToolRegistry } from '../registry';
import { getCompactionConfig, getModelLimit } from '../compaction';
import { findGitRoot, loadInstructions } from '../instructions';
import { generateSessionTitle as generateSessionTitleInternal } from '../sessionTitle';
import type { PluginManager } from '../hooks/pluginManager';
import { getPrimaryWorkspaceFolderUri, getPrimaryWorkspaceRootPath } from '../workspaceContext';

import { BUILD_SWITCH_PROMPT, DEFAULT_SYSTEM_PROMPT, PLAN_PROMPT } from './prompts';

type SemanticHandlesState = NonNullable<LingyunSession['semanticHandles']>;

export type AgentSessionState = {
  history: AgentHistoryMessage[];
  pendingPlan?: string;
  fileHandles?: { nextId: number; byId: Record<string, string> };
  semanticHandles?: SemanticHandlesState;
  mentionedSkills?: string[];
};

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\/+$/, '') || '/';
  const parent = path.posix.dirname(normalized);
  if (parent === normalized) return uri;
  return uri.with({ path: parent });
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    return /abort/i.test(error.message);
  }
  return /abort/i.test(String(error));
}

function createBlankSemanticHandlesState(): SemanticHandlesState {
  return {
    nextMatchId: 1,
    nextSymbolId: 1,
    nextLocId: 1,
    matches: {},
    symbols: {},
    locations: {},
  };
}

export class AgentLoop {
  private _running = false;
  private activeAbortController?: AbortController;
  private readonly plugins?: PluginManager;

  private session = new LingyunSession({
    history: [],
    fileHandles: { nextId: 1, byId: {} },
    semanticHandles: createBlankSemanticHandlesState(),
    mentionedSkills: [],
  });

  private readonly agent: LingyunAgent;

  private config: AgentConfig;

  private instructionsText?: string;
  private instructionsKey?: string;

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

    const allowExternalPaths =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
    const workspaceRoot = getPrimaryWorkspaceRootPath();

    this.agent = new LingyunAgent(
      this.llm,
      {
        model: this.config.model,
        subagentModel: this.config.subagentModel,
        systemPrompt: this.composeSystemPromptText(),
        mode: this.getMode(),
        temperature: this.config.temperature,
        maxRetries: this.config.maxRetries,
        toolFilter: this.config.toolFilter,
        autoApprove: this.config.autoApprove,
        sessionId: this.config.sessionId,
      },
      this.registry.getAgentRegistry(),
      {
        workspaceRoot,
        allowExternalPaths,
        plugins,
        prompts: {
          planPrompt: PLAN_PROMPT,
          buildSwitchPrompt: BUILD_SWITCH_PROMPT,
        },
      },
    );
  }

  private async maybeRunExplorePrepass(input: UserHistoryInput, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (this.config.parentSessionId || this.config.subagentType) return;

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const enabled = cfg.get<boolean>('subagents.explorePrepass.enabled', false) ?? false;
    if (!enabled) return;

    const subagent = resolveBuiltinSubagent('explore');
    if (!subagent) return;

    const maxCharsRaw = cfg.get<number>('subagents.explorePrepass.maxChars', 8000) ?? 8000;
    const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 8000;

    const allowExternalPaths = cfg.get<boolean>('security.allowExternalPaths', false) ?? false;
    const reasoningEffort = cfg.get<string>('copilot.reasoningEffort', 'xhigh') ?? 'xhigh';
    const taskMaxOutputChars = cfg.get<number>('subagents.task.maxOutputChars', 8000) ?? 8000;

    let exploreModelId = (this.config.model || '').trim();
    const configuredSubagentModel = (this.config.subagentModel || '').trim();
    if (configuredSubagentModel && configuredSubagentModel !== exploreModelId) {
      try {
        await this.llm.getModel(configuredSubagentModel);
        exploreModelId = configuredSubagentModel;
      } catch {
        // ignore, fall back to parent model
      }
    }

    if (!exploreModelId) return;

    const exploreSession = new LingyunSession({
      history: [],
      sessionId: `${this.config.sessionId || 'session'}:auto-explore:${Date.now()}`,
      parentSessionId: this.config.sessionId,
      subagentType: 'explore',
      modelId: exploreModelId,
      mentionedSkills: [...(this.session.mentionedSkills || [])],
      fileHandles: { nextId: 1, byId: {} },
      semanticHandles: createBlankSemanticHandlesState(),
    });

    const workspaceRoot = getPrimaryWorkspaceRootPath();
    const compactionConfig = getCompactionConfig();
    const modelLimit = getModelLimit(exploreModelId);

    const exploreAgent = new LingyunAgent(
      this.llm,
      {
        model: exploreModelId,
        mode: 'plan',
        temperature: this.config.temperature,
        maxRetries: this.config.maxRetries,
        maxOutputTokens: undefined,
        toolFilter: subagent.toolFilter,
        autoApprove: this.config.autoApprove,
        systemPrompt: `${this.composeSystemPromptText()}\n\n${subagent.prompt}`,
        sessionId: exploreSession.sessionId,
      },
      this.registry.getAgentRegistry(),
      {
        workspaceRoot,
        allowExternalPaths,
        plugins: this.plugins,
        copilot: { reasoningEffort },
        subagents: { taskMaxOutputChars },
        modelLimits: modelLimit ? { [exploreModelId]: modelLimit } : undefined,
        compaction: compactionConfig,
        prompts: {
          planPrompt: PLAN_PROMPT,
          buildSwitchPrompt: BUILD_SWITCH_PROMPT,
        },
      },
    );

    const run = exploreAgent.run({
      session: exploreSession,
      input,
      signal,
    });

    const drain = (async () => {
      for await (const _event of run.events) {
        // drain
      }
    })();

    const result = await run.done;
    await drain;

    let exploreText = String(result.text || '').trimEnd();
    let truncated = false;
    if (exploreText.length > maxChars) {
      exploreText = exploreText.slice(0, maxChars).trimEnd();
      truncated = true;
    }

    const injected = [
      '<subagent_explore_context>',
      exploreText,
      truncated ? '\n\n... [TRUNCATED]' : '',
      '</subagent_explore_context>',
    ]
      .filter(Boolean)
      .join('\n');

    const message = createAssistantHistoryMessage();
    message.metadata = { synthetic: true };
    message.parts.push({ type: 'text', text: injected, state: 'done' } as any);
    this.session.history.push(message);
  }

  private getMode(): 'build' | 'plan' {
    return this.config.mode === 'plan' ? 'plan' : 'build';
  }

  private getWorkspaceRootForContext(): vscode.Uri | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const workspaceFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    return workspaceFolder?.uri ?? getPrimaryWorkspaceFolderUri();
  }

  private async refreshInstructions(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRootForContext();
    const activeEditor = vscode.window.activeTextEditor;

    const isActiveEditorInWorkspace =
      !!workspaceRoot && !!activeEditor && workspaceRoot.scheme === 'file' && activeEditor.document.uri.scheme === 'file';

    const startDir =
      isActiveEditorInWorkspace && activeEditor ? dirnameUri(activeEditor.document.uri) : workspaceRoot;
    if (!startDir) return;

    const stopDir = workspaceRoot ? await findGitRoot(startDir, workspaceRoot) : startDir;

    const extraInstructionPatterns =
      vscode.workspace.getConfiguration('lingyun').get<string[]>('instructions') || [];

    const key = [
      startDir.toString(),
      stopDir.toString(),
      workspaceRoot?.toString() || '',
      JSON.stringify(extraInstructionPatterns),
    ].join('|');

    const instructionsChanged = this.instructionsKey !== key;
    if (instructionsChanged) {
      this.instructionsKey = key;

      try {
        const loaded = await loadInstructions({
          startDir,
          workspaceRoot,
          stopDir,
          extraInstructionPatterns,
          includeGlobal: true,
        });
        this.instructionsText = loaded.text;
      } catch {
        this.instructionsText = undefined;
      }
    }
  }

  private composeSystemPromptText(): string {
    const basePrompt = this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const parts: string[] = [basePrompt];
    if (this.instructionsText) {
      parts.push(this.instructionsText);
    }
    return parts.filter(Boolean).join('\n\n');
  }

  private syncSessionMetadata(): void {
    this.session.sessionId = this.config.sessionId;
    this.session.parentSessionId = this.config.parentSessionId;
    this.session.subagentType = this.config.subagentType;
    this.session.modelId = this.config.model;
  }

  private syncAgentConfig(): void {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const allowExternalPaths = cfg.get<boolean>('security.allowExternalPaths', false) ?? false;
    this.agent.setAllowExternalPaths(allowExternalPaths);

    const reasoningEffort = cfg.get<string>('copilot.reasoningEffort', 'xhigh') ?? 'xhigh';
    this.agent.setCopilotReasoningEffort(reasoningEffort);

    const taskMaxOutputChars = cfg.get<number>('subagents.task.maxOutputChars', 8000) ?? 8000;
    this.agent.setTaskMaxOutputChars(taskMaxOutputChars);

    const compactionConfig = getCompactionConfig();
    this.agent.setCompactionConfig(compactionConfig);

    const modelId = (this.config.model || '').trim();
    const modelLimit = modelId ? getModelLimit(modelId) : undefined;
    this.agent.setModelLimits(modelLimit ? { [modelId]: modelLimit } : undefined);

    this.agent.updateConfig({
      model: this.config.model,
      subagentModel: this.config.subagentModel,
      systemPrompt: this.composeSystemPromptText(),
      mode: this.getMode(),
      temperature: this.config.temperature,
      maxRetries: this.config.maxRetries,
      toolFilter: this.config.toolFilter,
      autoApprove: this.config.autoApprove,
      sessionId: this.config.sessionId,
    });

    this.syncSessionMetadata();
  }

  exportState(): AgentSessionState {
    const history = this.session.history.filter((msg) => !(msg.role === 'user' && msg.metadata?.skill));
    const fileHandles = this.session.fileHandles
      ? {
          nextId: this.session.fileHandles.nextId,
          byId: { ...(this.session.fileHandles.byId || {}) },
        }
      : undefined;

    return {
      history,
      pendingPlan: this.session.pendingPlan,
      fileHandles,
      semanticHandles: this.session.semanticHandles,
      mentionedSkills: [...(this.session.mentionedSkills || [])],
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
    this.session.pendingPlan = typeof state.pendingPlan === 'string' ? state.pendingPlan : undefined;
    this.session.mentionedSkills = Array.isArray(state.mentionedSkills) ? [...state.mentionedSkills] : [];

    const fileHandlesRaw = state.fileHandles;
    if (fileHandlesRaw && typeof fileHandlesRaw === 'object') {
      const nextId = (fileHandlesRaw as any).nextId;
      const byId = (fileHandlesRaw as any).byId;
      this.session.fileHandles =
        typeof nextId === 'number' && Number.isFinite(nextId) && byId && typeof byId === 'object'
          ? { nextId: Math.max(1, Math.floor(nextId)), byId: { ...(byId as Record<string, string>) } }
          : { nextId: 1, byId: {} };
    } else {
      this.session.fileHandles = { nextId: 1, byId: {} };
    }

    this.session.semanticHandles = state.semanticHandles ? state.semanticHandles : createBlankSemanticHandlesState();

    // The system prompt is rebuilt dynamically; refresh project instructions for the current editor/workspace.
    this.instructionsKey = undefined;
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
    this.syncAgentConfig();
  }

  syncSession(params: {
    state?: AgentSessionState;
    model?: string;
    mode?: 'build' | 'plan';
    sessionId?: string;
    parentSessionId?: string;
    subagentType?: string;
  }): void {
    if (params.state) {
      this.importState(params.state);
    }

    const nextConfig: Partial<AgentConfig> = {};
    if (params.model !== undefined) nextConfig.model = params.model;
    if (params.mode !== undefined) nextConfig.mode = params.mode;
    if (params.sessionId !== undefined) nextConfig.sessionId = params.sessionId;
    if (params.parentSessionId !== undefined) nextConfig.parentSessionId = params.parentSessionId;
    if (params.subagentType !== undefined) nextConfig.subagentType = params.subagentType;

    if (Object.keys(nextConfig).length > 0) {
      this.updateConfig(nextConfig);
    } else {
      this.syncSessionMetadata();
    }
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

  private async withRun<T>(params: { explorePrepassInput?: UserHistoryInput }, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.startRun();
    try {
      await this.refreshInstructions();
      this.syncAgentConfig();
      if (params.explorePrepassInput) {
        await this.maybeRunExplorePrepass(params.explorePrepassInput, signal);
      }
      return await fn(signal);
    } catch (error) {
      if (isAbortError(error)) {
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

    const previousMode = this.getMode();
    if (previousMode !== 'plan') {
      this.config = { ...this.config, mode: 'plan' };
      this.agent.setMode('plan');
    }

    this.session.pendingPlan = undefined;

    try {
      const plan = await this.withRun({ explorePrepassInput: task }, async (signal) => {
        const run = this.agent.run({
          session: this.session,
          input: task,
          callbacks,
          signal,
        });
        const result = await run.done;
        return String(result.text || '').trim();
      });

      this.session.pendingPlan = plan;
      return plan;
    } finally {
      if (previousMode !== 'plan') {
        this.config = { ...this.config, mode: previousMode };
        this.agent.setMode(previousMode);
      }
    }
  }

  async execute(callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.session.history.length === 0) {
      throw new Error('No active task. Call plan() or run() first.');
    }

    const pendingPlan = typeof this.session.pendingPlan === 'string' ? this.session.pendingPlan.trim() : '';
    if (pendingPlan) {
      this.session.history.push(createUserHistoryMessage(`## Approved Plan\n${pendingPlan}`, { synthetic: true }));
      this.session.pendingPlan = undefined;
    }

    return await this.withRun({}, async (signal) => {
      return await this.agent.resume({ session: this.session, callbacks, signal });
    });
  }

  async run(task: UserHistoryInput, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    this.session = new LingyunSession({
      history: [],
      pendingPlan: undefined,
      sessionId: this.config.sessionId,
      parentSessionId: this.config.parentSessionId,
      subagentType: this.config.subagentType,
      modelId: this.config.model,
      mentionedSkills: [...(this.session.mentionedSkills || [])],
      fileHandles: { nextId: 1, byId: {} },
      semanticHandles: createBlankSemanticHandlesState(),
    });

    return await this.withRun({ explorePrepassInput: task }, async (signal) => {
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

    this.session.pendingPlan = undefined;

    return await this.withRun({ explorePrepassInput: message }, async (signal) => {
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

    return await this.withRun({}, async (signal) => {
      return await this.agent.resume({ session: this.session, callbacks, signal });
    });
  }

  async compactSession(): Promise<void> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.session.history.length === 0) return;

    await this.withRun({}, async () => {
      await this.agent.compactSession(this.session, undefined, { modelId: this.config.model, auto: false });
    });
  }

  abort(): void {
    this.activeAbortController?.abort();
  }

  async clear(): Promise<void> {
    this.session.history = [];
    this.session.pendingPlan = undefined;
    this.session.fileHandles = { nextId: 1, byId: {} };
    this.session.semanticHandles = createBlankSemanticHandlesState();
    this.session.mentionedSkills = [];
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
