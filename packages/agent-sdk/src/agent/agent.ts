import * as path from 'path';
import {
  convertToModelMessages,
  jsonSchema,
  tool as aiTool,
  type ModelMessage,
  type ToolExecutionOptions,
} from 'ai';

import type { ToolCall, ToolDefinition, ToolResult, AgentCallbacks, AgentConfig, LLMProvider, LingyunEvent, LingyunRun } from '../types.js';
import {
  createHistoryForModel,
  createUserHistoryMessage,
  extractSkillMentions,
  getSkillIndex,
  getEffectiveHistory,
  getReservedOutputTokens,
  getUserHistoryInputText,
  isOverflow as isContextOverflow,
  loadSkillFile,
  redactFsPathForPrompt,
  resolveBuiltinSubagent,
  selectSkillsForText,
  stripSkillInjectedMessages,
  type AgentHistoryMessage,
  type CompactionConfig,
  type ModelLimit,
  type SkillInfo,
  type UserHistoryInput,
} from '@kooka/core';
import { PluginManager } from '../plugins/pluginManager.js';
import type { LingyunHookName, LingyunPluginToolEntry } from '../plugins/types.js';
import { insertModeReminders } from './reminders.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { MAX_TOOL_RESULT_LENGTH } from './constants.js';
import { createProviderBehavior } from './providerBehavior.js';
import type { ProviderBehavior } from './providerBehavior.js';
import type { ToolRegistry } from '../tools/registry.js';
import { DEFAULT_SKILL_PATHS } from '../tools/builtin/index.js';
import { SemanticHandleRegistry } from './semanticHandles.js';
import { PromptComposer, SkillsPromptProvider } from './promptComposer.js';
import { FileHandleRegistry } from './fileHandles.js';
import { compactSessionInternal } from './compaction.js';
import { executeToolWithPolicies } from './toolExecution.js';
import { runOnce as runOnceLoop } from './runOnce.js';

import { AsyncQueue } from './asyncQueue.js';
import { invokeCallbackSafely } from './callbacks.js';
import { LingyunSession } from './session.js';
import { TaskSubagentRunner } from './taskSubagentRunner.js';
import {
  appendSyntheticContextMessage,
  snapshotSyntheticContextsForCompaction,
  stripTransientSyntheticMessages,
  type LingyunAgentSyntheticContext,
} from './transientSyntheticContext.js';

export { LingyunSession };
export type { LingyunAgentSyntheticContext } from './transientSyntheticContext.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getLastAssistantTokens(
  history: AgentHistoryMessage[],
): { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number; raw?: unknown } | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'assistant') continue;
    const tokens = msg.metadata?.tokens;
    if (typeof tokens?.total === 'number' && Number.isFinite(tokens.total) && tokens.total > 0) {
      return tokens;
    }
  }
  return undefined;
}

export type LingyunAgentRuntimeOptions = {
  plugins?: LingyunPluginManager;
  workspaceRoot?: string;
  allowExternalPaths?: boolean;
  reasoning?: {
    effort?: string;
  };
  prompts?: {
    planPrompt?: string;
    buildSwitchPrompt?: string;
  };
  skills?: {
    enabled?: boolean;
    paths?: string[];
    maxPromptSkills?: number;
    maxInjectSkills?: number;
    maxInjectChars?: number;
  };
  subagents?: {
    taskMaxOutputChars?: number;
  };
  modelLimits?: Record<string, ModelLimit>;
  compaction?: Partial<CompactionConfig>;
  runtimePolicy?: LingyunAgentRuntimePolicy;
};

export type LingyunPluginManager = {
  trigger: <Name extends LingyunHookName, Output>(name: Name, input: unknown, output: Output) => Promise<Output>;
  getPluginTools?: () => Promise<LingyunPluginToolEntry[]>;
};

export type LingyunAgentRuntimeSnapshot = {
  systemPrompt?: string;
  allowExternalPaths?: boolean;
  reasoningEffort?: string;
  taskMaxOutputChars?: number;
  modelLimits?: Record<string, ModelLimit>;
  compaction?: Partial<CompactionConfig>;
};

export type LingyunAgentPreparedRun = {
  runtime?: LingyunAgentRuntimeSnapshot;
  syntheticContexts?: LingyunAgentSyntheticContext[];
};

type LingyunAgentExecutionRuntime = {
  systemPrompt: string;
  allowExternalPaths: boolean;
  reasoningEffort: string;
  taskMaxOutputChars: number;
  modelLimits?: Record<string, ModelLimit>;
  compactionConfig: CompactionConfig;
};

type LingyunAgentExecutionContext = {
  config: Readonly<AgentConfig>;
  runtime: LingyunAgentExecutionRuntime;
};

type LingyunAgentChildRunSeed = {
  sessionId: string;
  modelId: string;
  mode?: 'build' | 'plan';
  toolFilter?: string[];
  systemPrompt?: string;
  runtime?: LingyunAgentRuntimeSnapshot;
  parentSessionId?: string;
  subagentType?: string;
};

type LingyunAgentPreparedChildRun = {
  session: LingyunSession;
  config: AgentConfig;
  runtimeOptions: LingyunAgentRuntimeOptions;
};

export type LingyunAgentSyntheticRunParams = {
  input: UserHistoryInput;
  modelId: string;
  mode?: 'build' | 'plan';
  systemPrompt?: string;
  toolFilter?: string[];
  sessionId?: string;
  parentSessionId?: string;
  subagentType?: string;
  callbacks?: AgentCallbacks;
  signal?: AbortSignal;
  runtime?: LingyunAgentRuntimeSnapshot;
};

export type LingyunAgentRuntimeContext = {
  session: LingyunSession;
  input?: UserHistoryInput;
  signal?: AbortSignal;
  config: Readonly<AgentConfig>;
  llm: LLMProvider;
  warmModelLimit: (modelId: string) => Promise<ModelLimit | undefined>;
  runSyntheticPass: (params: LingyunAgentSyntheticRunParams) => Promise<string>;
};

export type LingyunAgentRuntimePolicy = {
  prepareRun?: (context: LingyunAgentRuntimeContext) => Promise<LingyunAgentPreparedRun | void>;
};

export class LingyunAgent {
  private readonly plugins: LingyunPluginManager;
  private readonly workspaceRoot?: string;
  private readonly fileHandles: FileHandleRegistry;
  private readonly runtimePolicy?: LingyunAgentRuntimePolicy;
  private readonly allowExternalPaths: boolean;
  private readonly reasoningEffort: string;
  private readonly reminderPrompts?: {
    planPrompt?: string;
    buildSwitchPrompt?: string;
  };
  private readonly skillsConfig: {
    enabled: boolean;
    paths: string[];
    maxPromptSkills: number;
    maxInjectSkills: number;
    maxInjectChars: number;
  };
  private readonly skillsPromptProvider: SkillsPromptProvider;
  private readonly promptComposer: PromptComposer;
  private readonly taskMaxOutputChars: number;
  private readonly modelLimits?: Record<string, ModelLimit>;
  private readonly compactionConfig: CompactionConfig;
  private readonly derivedModelLimits = new Map<string, ModelLimit>();
  private registeredPluginTools = new Set<string>();
  private readonly taskSessions = new Map<string, LingyunSession>();
  private readonly maxTaskSessions = 50;
  private readonly providerBehavior: ProviderBehavior;
  private readonly taskSubagentRunner: TaskSubagentRunner;

  constructor(
    private readonly llm: LLMProvider,
    private config: AgentConfig,
    private readonly registry: ToolRegistry,
    runtime?: LingyunAgentRuntimeOptions
  ) {
    this.plugins = runtime?.plugins ?? new PluginManager({ workspaceRoot: runtime?.workspaceRoot });
    this.workspaceRoot = runtime?.workspaceRoot ? path.resolve(runtime.workspaceRoot) : undefined;
    this.fileHandles = new FileHandleRegistry({ workspaceRoot: this.workspaceRoot });
    this.runtimePolicy = runtime?.runtimePolicy;
    this.allowExternalPaths = !!runtime?.allowExternalPaths;
    this.reasoningEffort = typeof runtime?.reasoning?.effort === 'string' ? runtime.reasoning.effort.trim() : '';
    this.reminderPrompts = runtime?.prompts;

    const skills = runtime?.skills ?? {};
    const paths = Array.isArray(skills.paths) && skills.paths.length > 0 ? skills.paths : DEFAULT_SKILL_PATHS;
    const maxPromptSkills =
      Number.isFinite(skills.maxPromptSkills as number) && (skills.maxPromptSkills as number) >= 0
        ? Math.floor(skills.maxPromptSkills as number)
        : 50;
    const maxInjectSkills =
      Number.isFinite(skills.maxInjectSkills as number) && (skills.maxInjectSkills as number) > 0
        ? Math.floor(skills.maxInjectSkills as number)
        : 5;
    const maxInjectChars =
      Number.isFinite(skills.maxInjectChars as number) && (skills.maxInjectChars as number) > 0
        ? Math.floor(skills.maxInjectChars as number)
        : 20_000;

    this.skillsConfig = {
      enabled: skills.enabled !== false,
      paths,
      maxPromptSkills,
      maxInjectSkills,
      maxInjectChars,
    };

    const taskMaxOutputCharsRaw = runtime?.subagents?.taskMaxOutputChars;
    this.taskMaxOutputChars =
      typeof taskMaxOutputCharsRaw === 'number' && Number.isFinite(taskMaxOutputCharsRaw) && taskMaxOutputCharsRaw > 0
        ? Math.floor(taskMaxOutputCharsRaw)
        : 8000;

    this.modelLimits = runtime?.modelLimits;

    const baseCompaction: CompactionConfig = {
      auto: true,
      prune: true,
      pruneProtectTokens: 40_000,
      pruneMinimumTokens: 20_000,
      toolOutputMode: 'afterToolCall',
    };
    const c = runtime?.compaction ?? {};
    this.compactionConfig = {
      auto: c.auto ?? baseCompaction.auto,
      prune: c.prune ?? baseCompaction.prune,
      pruneProtectTokens: Math.max(0, c.pruneProtectTokens ?? baseCompaction.pruneProtectTokens),
      pruneMinimumTokens: Math.max(0, c.pruneMinimumTokens ?? baseCompaction.pruneMinimumTokens),
      toolOutputMode: c.toolOutputMode ?? baseCompaction.toolOutputMode,
    };

    this.providerBehavior = createProviderBehavior(this.llm.id);

    this.skillsPromptProvider = new SkillsPromptProvider({
      getWorkspaceRoot: () => this.workspaceRoot,
      getAllowExternalPaths: () => this.allowExternalPaths,
      getEnabled: () => this.skillsConfig.enabled,
      getPaths: () => this.skillsConfig.paths,
      getMaxPromptSkills: () => this.skillsConfig.maxPromptSkills,
    });

    this.promptComposer = new PromptComposer({
      plugins: this.plugins,
      providerBehavior: this.providerBehavior,
      skills: this.skillsPromptProvider,
    });

    this.taskSubagentRunner = new TaskSubagentRunner({
      taskSessions: this.taskSessions,
      maxTaskSessions: this.maxTaskSessions,
      createSubagentAgent: (subagentConfig, runtime) =>
        new LingyunAgent(this.llm, subagentConfig, this.registry, runtime),
    });
  }

  private mergeCompactionConfig(
    current: CompactionConfig,
    next?: Partial<CompactionConfig>
  ): CompactionConfig {
    if (!next) return current;
    const toolOutputMode =
      next.toolOutputMode === 'afterToolCall' || next.toolOutputMode === 'onCompaction'
        ? next.toolOutputMode
        : current.toolOutputMode;

    return {
      auto: typeof next.auto === 'boolean' ? next.auto : current.auto,
      prune: typeof next.prune === 'boolean' ? next.prune : current.prune,
      pruneProtectTokens:
        typeof next.pruneProtectTokens === 'number' && Number.isFinite(next.pruneProtectTokens)
          ? Math.max(0, Math.floor(next.pruneProtectTokens))
          : current.pruneProtectTokens,
      pruneMinimumTokens:
        typeof next.pruneMinimumTokens === 'number' && Number.isFinite(next.pruneMinimumTokens)
          ? Math.max(0, Math.floor(next.pruneMinimumTokens))
          : current.pruneMinimumTokens,
      toolOutputMode,
    };
  }

  private resolveExecutionContext(
    config: Readonly<AgentConfig>,
    snapshot?: LingyunAgentRuntimeSnapshot
  ): LingyunAgentExecutionContext {
    const systemPromptRaw =
      typeof snapshot?.systemPrompt === 'string' ? snapshot.systemPrompt : config.systemPrompt;
    const systemPrompt =
      typeof systemPromptRaw === 'string' && systemPromptRaw.trim()
        ? systemPromptRaw
        : DEFAULT_SYSTEM_PROMPT;

    return {
      config,
      runtime: {
        systemPrompt,
        allowExternalPaths:
          typeof snapshot?.allowExternalPaths === 'boolean'
            ? snapshot.allowExternalPaths
            : this.allowExternalPaths,
        reasoningEffort:
          typeof snapshot?.reasoningEffort === 'string'
            ? snapshot.reasoningEffort.trim()
            : this.reasoningEffort,
        taskMaxOutputChars:
          typeof snapshot?.taskMaxOutputChars === 'number' &&
          Number.isFinite(snapshot.taskMaxOutputChars) &&
          snapshot.taskMaxOutputChars > 0
            ? Math.floor(snapshot.taskMaxOutputChars)
            : this.taskMaxOutputChars,
        modelLimits: snapshot?.modelLimits ?? this.modelLimits,
        compactionConfig: this.mergeCompactionConfig(this.compactionConfig, snapshot?.compaction),
      },
    };
  }

  private createRuntimeOptions(
    runtime: LingyunAgentExecutionRuntime,
    includeRuntimePolicy = false,
  ): LingyunAgentRuntimeOptions {
    return {
      plugins: this.plugins,
      workspaceRoot: this.workspaceRoot,
      allowExternalPaths: runtime.allowExternalPaths,
      reasoning: { effort: runtime.reasoningEffort },
      prompts: this.reminderPrompts,
      skills: this.skillsConfig,
      subagents: { taskMaxOutputChars: runtime.taskMaxOutputChars },
      modelLimits: runtime.modelLimits,
      compaction: runtime.compactionConfig,
      ...(includeRuntimePolicy && this.runtimePolicy ? { runtimePolicy: this.runtimePolicy } : {}),
    };
  }

  private prepareChildRun(
    parentSession: LingyunSession,
    parentExecution: LingyunAgentExecutionContext,
    seed: LingyunAgentChildRunSeed,
    session?: LingyunSession,
  ): LingyunAgentPreparedChildRun {
    const childSession =
      session ??
      new LingyunSession({
        history: [],
        sessionId: seed.sessionId,
        parentSessionId: seed.parentSessionId,
        subagentType: seed.subagentType,
        modelId: seed.modelId,
        mentionedSkills: [...(parentSession.mentionedSkills || [])],
      });

    childSession.sessionId = seed.sessionId;
    childSession.parentSessionId = seed.parentSessionId;
    childSession.subagentType = seed.subagentType;
    childSession.modelId = seed.modelId;

    const mode = seed.mode ?? this.getModeForConfig(parentExecution.config);
    const childConfig: AgentConfig = {
      model: seed.modelId,
      mode,
      temperature: parentExecution.config.temperature,
      maxRetries: parentExecution.config.maxRetries,
      retryWithPartialOutput: parentExecution.config.retryWithPartialOutput,
      maxOutputTokens: parentExecution.config.maxOutputTokens,
      toolFilter: seed.toolFilter,
      autoApprove: mode === 'plan' ? false : parentExecution.config.autoApprove,
      systemPrompt: seed.systemPrompt,
      sessionId: childSession.sessionId,
    };
    const childRuntime = this.resolveExecutionContext(childConfig, seed.runtime);

    return {
      session: childSession,
      config: childConfig,
      runtimeOptions: this.createRuntimeOptions(childRuntime.runtime),
    };
  }

  private async runPreparedChildRun(
    prepared: LingyunAgentPreparedChildRun,
    input: UserHistoryInput,
    callbacks?: AgentCallbacks,
    signal?: AbortSignal,
  ): Promise<string> {
    const childAgent = new LingyunAgent(
      this.llm,
      prepared.config,
      this.registry,
      prepared.runtimeOptions,
    );

    const run = childAgent.run({
      session: prepared.session,
      input,
      callbacks,
      signal,
    });

    const drain = (async () => {
      for await (const _event of run.events) {
        // drain
      }
    })();

    const result = await run.done;
    await drain;
    return String(result.text || '');
  }

  private async prepareTaskSubagentExecution(
    mode: 'build' | 'plan',
    execution: LingyunAgentExecutionContext,
    params: {
      childSessionId: string;
      childSession: LingyunSession;
      subagent: NonNullable<ReturnType<typeof resolveBuiltinSubagent>>;
      prompt: string;
      callbacks?: AgentCallbacks;
      signal?: AbortSignal;
    }
  ): Promise<{
    config: AgentConfig;
    runtimeOptions: LingyunAgentRuntimeOptions;
    childModelId: string;
    desiredChildModelId: string;
    childModelWarning?: string;
    taskMaxOutputChars: number;
  }> {
    const parentModelId = execution.config.model;
    if (!parentModelId) {
      throw new Error('No model configured. Set AgentConfig.model.');
    }

    const configuredSubagentModel =
      typeof execution.config.subagentModel === 'string' ? execution.config.subagentModel.trim() : '';
    const desiredChildModelId =
      params.childSession.modelId || configuredSubagentModel || parentModelId;

    let childModelId = parentModelId;
    let childModelWarning: string | undefined;
    if (desiredChildModelId !== parentModelId) {
      try {
        await this.llm.getModel(desiredChildModelId);
        childModelId = desiredChildModelId;
      } catch (error) {
        childModelWarning =
          `Subagent model "${desiredChildModelId}" is unavailable; ` +
          `using parent model "${parentModelId}".`;
        invokeCallbackSafely(
          params.callbacks?.onNotice,
          { label: 'onNotice subagent_model_fallback', onDebug: params.callbacks?.onDebug },
          { level: 'warning', message: childModelWarning },
        );
        invokeCallbackSafely(
          params.callbacks?.onDebug,
          { label: 'onDebug subagent_model_fallback' },
          `[Task] subagent model fallback requested=${desiredChildModelId} using=${parentModelId} error=${error instanceof Error ? error.name : typeof error}`,
        );
      }
    }

    params.childSession.modelId = childModelId;
    const prepared = this.prepareChildRun(
      params.childSession,
      execution,
      {
        sessionId: params.childSessionId,
        modelId: childModelId,
        mode,
        toolFilter: params.subagent.toolFilter?.length ? params.subagent.toolFilter : undefined,
        systemPrompt: `${execution.runtime.systemPrompt}\n\n${params.subagent.prompt}`,
        parentSessionId: params.childSession.parentSessionId,
        subagentType: params.childSession.subagentType,
      },
      params.childSession,
    );

    return {
      config: prepared.config,
      runtimeOptions: prepared.runtimeOptions,
      childModelId,
      desiredChildModelId,
      ...(childModelWarning ? { childModelWarning } : {}),
      taskMaxOutputChars: execution.runtime.taskMaxOutputChars,
    };
  }

  updateConfig(next: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...(next ?? {}) };
  }

  setMode(mode: 'build' | 'plan'): void {
    this.config = { ...this.config, mode };
  }

  async compactSession(session: LingyunSession, callbacks?: AgentCallbacks, options?: { modelId?: string; auto?: boolean }): Promise<void> {
    if (!session.history.length) return;
    const prepared = await this.prepareRun(session, undefined, undefined);
    const modelId = (options?.modelId ?? prepared.execution.config.model ?? '').trim();
    if (!modelId) {
      throw new Error('No model configured');
    }
    await compactSessionInternal({
      session,
      auto: options?.auto === true,
      modelId,
      mode: prepared.execution.config.mode === 'plan' ? 'plan' : 'build',
      sessionIdFallback: prepared.execution.config.sessionId,
      callbacks,
      llm: this.llm,
      plugins: this.plugins,
      providerBehavior: this.providerBehavior,
      compactionConfig: prepared.execution.runtime.compactionConfig,
      maxOutputTokens: this.getMaxOutputTokens(prepared.execution.config),
    });
  }

  private getModeForConfig(config: Readonly<AgentConfig>): 'build' | 'plan' {
    return config.mode === 'plan' ? 'plan' : 'build';
  }

  private getModelLimit(
    modelId: string,
    runtime?: Pick<LingyunAgentExecutionRuntime, 'modelLimits'>
  ): ModelLimit | undefined {
    return runtime?.modelLimits?.[modelId] ?? this.modelLimits?.[modelId] ?? this.derivedModelLimits.get(modelId);
  }

  async warmModelLimit(modelId: string): Promise<ModelLimit | undefined> {
    const trimmed = String(modelId || '').trim();
    if (!trimmed) return undefined;

    const configured = this.modelLimits?.[trimmed];
    if (configured) return configured;

    const cached = this.derivedModelLimits.get(trimmed);
    if (cached) return cached;

    const getModels = (this.llm as any)?.getModels;
    if (typeof getModels !== 'function') return undefined;

    try {
      const models = await Promise.resolve(getModels.call(this.llm));
      if (!Array.isArray(models)) return undefined;
      const match = models.find((model: any) => model && typeof model.id === 'string' && model.id === trimmed);
      const maxInputTokensRaw = match?.maxInputTokens;
      if (typeof maxInputTokensRaw !== 'number' || !Number.isFinite(maxInputTokensRaw) || maxInputTokensRaw <= 0) {
        return undefined;
      }

      const maxOutputTokensRaw = match?.maxOutputTokens;
      const derived: ModelLimit = {
        context: Math.floor(maxInputTokensRaw),
        ...(typeof maxOutputTokensRaw === 'number' && Number.isFinite(maxOutputTokensRaw) && maxOutputTokensRaw > 0
          ? { output: Math.floor(maxOutputTokensRaw) }
          : {}),
      };
      this.derivedModelLimits.set(trimmed, derived);
      return derived;
    } catch {
      return undefined;
    }
  }

  private async runSyntheticPass(
    parentSession: LingyunSession,
    parentConfig: Readonly<AgentConfig>,
    params: LingyunAgentSyntheticRunParams
  ): Promise<string> {
    const parentExecution = this.resolveExecutionContext(parentConfig);
    const prepared = this.prepareChildRun(parentSession, parentExecution, {
      sessionId:
        params.sessionId ??
        `${parentSession.sessionId ?? this.config.sessionId ?? 'session'}:synthetic:${Date.now()}`,
      modelId: params.modelId,
      mode: params.mode,
      toolFilter: params.toolFilter,
      systemPrompt: params.systemPrompt,
      runtime: params.runtime,
      parentSessionId: params.parentSessionId,
      subagentType: params.subagentType,
    });

    return await this.runPreparedChildRun(
      prepared,
      params.input,
      params.callbacks,
      params.signal,
    );
  }

  private async prepareRun(
    session: LingyunSession,
    input?: UserHistoryInput,
    signal?: AbortSignal,
    configOverride?: Partial<AgentConfig>
  ): Promise<{
    execution: LingyunAgentExecutionContext;
    syntheticContexts: LingyunAgentSyntheticContext[];
  }> {
    session.history = stripTransientSyntheticMessages(session.history);
    const config = { ...this.config, ...(configOverride ?? {}) };
    const prepared = await this.runtimePolicy?.prepareRun?.({
      session,
      input,
      signal,
      config,
      llm: this.llm,
      warmModelLimit: (modelId) => this.warmModelLimit(modelId),
      runSyntheticPass: (params) => this.runSyntheticPass(session, config, params),
    });
    return {
      execution: this.resolveExecutionContext(config, prepared?.runtime),
      syntheticContexts: [...(prepared?.syntheticContexts ?? [])],
    };
  }

  private getMaxOutputTokens(config: Readonly<AgentConfig>): number {
    const max = config.maxOutputTokens;
    if (typeof max === 'number' && Number.isFinite(max) && max > 0) return Math.floor(max);
    return 4096;
  }

  private async ensurePluginToolsRegistered(): Promise<void> {
    const entries = await this.plugins.getPluginTools?.();
    if (!entries) return;
    if (entries.length === 0) return;

    const existing = await this.registry.getTools();
    const existingById = new Map<string, ToolDefinition>(existing.map((t) => [t.id, t]));

    for (const entry of entries) {
      const key = `${entry.pluginId}:${entry.toolId}`;
      if (this.registeredPluginTools.has(key)) continue;

      const conflict = existingById.get(entry.toolId);
      if (conflict) {
        throw new Error(
          `Plugin tool id collision: "${entry.toolId}" from plugin "${entry.pluginId}" conflicts with existing tool "${conflict.id}" (${conflict.name}). ` +
            `Choose a unique tool id for the plugin tool.`
        );
      }

      this.registeredPluginTools.add(key);
      existingById.set(entry.toolId, {
        id: entry.toolId,
        name: entry.tool.name || entry.toolId,
        description: entry.tool.description,
        parameters: entry.tool.parameters,
        execution: { type: 'function', handler: `plugin:${key}` },
        metadata: entry.tool.metadata,
      });

      this.registry.registerTool(
        {
          id: entry.toolId,
          name: entry.tool.name || entry.toolId,
          description: entry.tool.description,
          parameters: entry.tool.parameters,
          execution: { type: 'function', handler: `plugin:${key}` },
          metadata: entry.tool.metadata,
        },
        async (args, context) => {
          const out = await entry.tool.execute(args, context);
          if (out && typeof out === 'object' && typeof (out as any).success === 'boolean') {
            return out as ToolResult;
          }
          return { success: true, data: out };
        }
      );
    }
  }

  private async toModelMessages(
    session: LingyunSession,
    tools: Record<string, unknown>,
    modelId: string,
    execution: LingyunAgentExecutionContext,
    syntheticContexts: readonly LingyunAgentSyntheticContext[] = [],
  ): Promise<ModelMessage[]> {
    const effective = [...getEffectiveHistory(session.history)];
    for (const context of syntheticContexts) {
      appendSyntheticContextMessage(effective, context);
    }
    const prepared = createHistoryForModel(effective);
    const reminded = insertModeReminders(prepared, this.getModeForConfig(execution.config), {
      allowExternalPaths: execution.runtime.allowExternalPaths,
      prompts: this.reminderPrompts,
    });
    const withoutIds = reminded.map(({ id: _id, ...rest }) => rest);

    const messagesOutput = await this.plugins.trigger(
      'experimental.chat.messages.transform',
      {
        sessionId: session.sessionId ?? execution.config.sessionId,
        mode: this.getModeForConfig(execution.config),
        modelId,
      },
      { messages: [...withoutIds] as unknown[] }
    );

    const messages = Array.isArray((messagesOutput as any).messages) ? (messagesOutput as any).messages : withoutIds;
    const replayed = this.providerBehavior.prepareHistoryForPrompt(messages as unknown as AgentHistoryMessage[]);
    const converted = await convertToModelMessages(replayed as any, { tools: tools as any });
    return this.providerBehavior.transformModelMessages(modelId, converted);
  }

  private createToolContext(
    signal: AbortSignal,
    session: LingyunSession,
    execution: LingyunAgentExecutionContext,
    callbacks?: AgentCallbacks
  ) {
    return {
      workspaceRoot: this.workspaceRoot,
      allowExternalPaths: execution.runtime.allowExternalPaths,
      sessionId: session.sessionId ?? execution.config.sessionId,
      signal,
      log: (message: string) => {
        try {
          callbacks?.onDebug?.(message);
        } catch {
          // ignore
        }
      },
    };
  }

  private async formatToolResult(result: ToolResult, toolName: string): Promise<string> {
    let content: string;

    const outputOverride = isRecord(result.metadata) ? (result.metadata as any).outputText : undefined;
    if (typeof outputOverride === 'string' && outputOverride) {
      content = outputOverride;
      if (content.length > MAX_TOOL_RESULT_LENGTH) {
        content = content.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n\n... [TRUNCATED]';
      }
      return content;
    }

    if (result.success) {
      if (typeof result.data === 'string') {
        content = result.data;
      } else if (result.data === undefined || result.data === null) {
        content = 'Done';
      } else {
        content = JSON.stringify(result.data, null, 2);
      }
    } else {
      content = JSON.stringify({ error: result.error });
    }

    if (content.length > MAX_TOOL_RESULT_LENGTH) {
      content = content.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n\n... [TRUNCATED]';
    }

    return content;
  }

  private async pruneToolResultForHistory(output: unknown, toolLabel: string): Promise<ToolResult> {
    const result: ToolResult =
      output && typeof output === 'object' && typeof (output as any).success === 'boolean'
        ? (output as ToolResult)
        : { success: true, data: output };

    if (!result.success) {
      const rawError = typeof result.error === 'string' ? result.error : String(result.error ?? 'Unknown error');
      const errorText =
        rawError.length > MAX_TOOL_RESULT_LENGTH
          ? rawError.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n\n... [TRUNCATED]'
          : rawError;
      return {
        ...result,
        error: errorText,
        metadata: { ...(result.metadata || {}), truncated: rawError.length > MAX_TOOL_RESULT_LENGTH || (result.metadata as any)?.truncated },
      };
    }

    const formatted = await this.formatToolResult(result, toolLabel);
    return {
      ...result,
      data: formatted,
      metadata: { ...(result.metadata || {}), truncated: formatted.includes('[TRUNCATED]') || (result.metadata as any)?.truncated },
    };
  }

  private createAISDKTools(
    tools: ToolDefinition[],
    mode: 'build' | 'plan',
    session: LingyunSession,
    semanticHandles: SemanticHandleRegistry,
    execution: LingyunAgentExecutionContext,
    callbacks: AgentCallbacks | undefined,
    toolNameToDefinition: Map<string, ToolDefinition>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const def of tools) {
      const toolName = def.id;
      toolNameToDefinition.set(toolName, def);

      if (toolName === 'task') {
        out[toolName] = this.createTaskTool(def, session, mode, execution, callbacks);
        continue;
      }

      out[toolName] = aiTool({
        id: toolName as any,
        description: def.description,
        inputSchema: jsonSchema(def.parameters as any),
        execute: async (args: any, options: ToolExecutionOptions) => {
          const abortSignal = options.abortSignal ?? new AbortController().signal;
          return executeToolWithPolicies({
            host: {
              config: execution.config,
              plugins: this.plugins,
              registry: this.registry,
              fileHandles: this.fileHandles,
              allowExternalPaths: execution.runtime.allowExternalPaths,
              workspaceRoot: this.workspaceRoot,
              createToolContext: (signal, scopedSession, scopedCallbacks) =>
                this.createToolContext(signal, scopedSession, execution, scopedCallbacks),
              formatToolResult: (result, toolLabel) => this.formatToolResult(result, toolLabel),
            },
            def,
            toolName,
            mode,
            session,
            semanticHandles,
            callbacks,
            args,
            options: { toolCallId: options.toolCallId, abortSignal },
          });
        },
        toModelOutput: async (options: any) => {
          const output = options.output as ToolResult;
          const content = await this.formatToolResult(output, def.name);
          return { type: 'text', value: content };
        },
      });
    }

    return out;
  }

  private createTaskTool(
    def: ToolDefinition,
    session: LingyunSession,
    mode: 'build' | 'plan',
    execution: LingyunAgentExecutionContext,
    callbacks: AgentCallbacks | undefined
  ): unknown {
    const toolName = def.id;
    return aiTool({
      id: toolName as any,
      description: def.description,
      inputSchema: jsonSchema(def.parameters as any),
      execute: async (args: any, options: ToolExecutionOptions) => {
        const resolvedArgs: Record<string, unknown> = isRecord(args) ? args : {};
        return this.taskSubagentRunner.executeTaskTool({
          mode,
          def,
          session,
          callbacks,
          args: resolvedArgs,
          options,
          prepareSubagentExecution: async ({
            childSessionId,
            childSession,
            subagent,
            prompt,
            callbacks: subagentCallbacks,
            signal,
          }) =>
            await this.prepareTaskSubagentExecution(mode, execution, {
              childSessionId,
              childSession,
              subagent,
              prompt,
              callbacks: subagentCallbacks,
              signal,
            }),
        });
      },
      toModelOutput: async (options: any) => {
        const output = options.output as ToolResult;
        const content = await this.formatToolResult(output, def.name);
        return { type: 'text', value: content };
      },
    });
  }

  private filterTools(tools: ToolDefinition[], config: Readonly<AgentConfig>): ToolDefinition[] {
    const filter = config.toolFilter;
    if (!filter || filter.length === 0) {
      return tools;
    }

    return tools.filter((tool) => {
      return filter.some((pattern) => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(tool.id);
        }
        return tool.id === pattern || tool.id.startsWith(pattern + '.');
      });
    });
  }

  private async composeSystemPrompt(
    modelId: string,
    execution: LingyunAgentExecutionContext,
    options?: { signal?: AbortSignal }
  ): Promise<string[]> {
    return this.promptComposer.composeSystemPrompts(modelId, {
      signal: options?.signal,
      basePrompt: execution.runtime.systemPrompt,
      sessionId: execution.config.sessionId,
      mode: this.getModeForConfig(execution.config),
      allowExternalPaths: execution.runtime.allowExternalPaths,
    });
  }

  private async drainPendingInputs(
    session: LingyunSession,
    execution: LingyunAgentExecutionContext,
    callbacks?: AgentCallbacks,
    signal?: AbortSignal
  ): Promise<number> {
    let drained = 0;

    while (!signal?.aborted) {
      const input = session.peekPendingInput();
      if (input === undefined) break;

      await this.injectSkillsForUserText(
        session,
        execution,
        getUserHistoryInputText(input),
        callbacks,
        signal
      );
      session.history.push(createUserHistoryMessage(input));
      session.shiftPendingInput();
      drained++;
    }

    return drained;
  }

  private async runOnce(
    session: LingyunSession,
    execution: LingyunAgentExecutionContext,
    syntheticContexts: readonly LingyunAgentSyntheticContext[] = [],
    callbacks?: AgentCallbacks,
    signal?: AbortSignal
  ): Promise<string> {
    const modelId = (execution.config.model || '').trim();
    if (!modelId) {
      throw new Error('No model configured');
    }

    await this.ensurePluginToolsRegistered();

    const mode = this.getModeForConfig(execution.config);
    const sessionId = session.sessionId ?? execution.config.sessionId;

    return runOnceLoop({
      session,
      callbacks,
      signal,
      modelId,
      mode,
      sessionId,
      sessionIdFallback: execution.config.sessionId,
      llm: this.llm,
      plugins: this.plugins,
      registry: this.registry,
      providerBehavior: this.providerBehavior,
      reasoningEffort: execution.runtime.reasoningEffort,
      compactionConfig: execution.runtime.compactionConfig,
      temperature: execution.config.temperature ?? 0.0,
      maxRetries: execution.config.maxRetries ?? 0,
      retryWithPartialOutput: execution.config.retryWithPartialOutput === true,
      getMaxOutputTokens: () => this.getMaxOutputTokens(execution.config),
      getModelLimit: (id) => this.getModelLimit(id, execution.runtime),
      composeSystemPrompt: (id, options) => this.composeSystemPrompt(id, execution, options),
      filterTools: (tools) => this.filterTools(tools, execution.config),
      createAISDKTools: (tools, toolMode, scopedSession, semanticHandles, scopedCallbacks, toolNameToDefinition) =>
        this.createAISDKTools(
          tools,
          toolMode,
          scopedSession,
          semanticHandles,
          execution,
          scopedCallbacks,
          toolNameToDefinition,
        ),
      toModelMessages: (scopedSession, tools, id) =>
        this.toModelMessages(scopedSession, tools, id, execution, syntheticContexts),
      pruneToolResultForHistory: (output, toolLabel) => this.pruneToolResultForHistory(output, toolLabel),
      drainPendingInputs: (scopedSession, scopedCallbacks, scopedSignal) =>
        this.drainPendingInputs(scopedSession, execution, scopedCallbacks, scopedSignal),
    });
  }

  private async injectSkillsForUserText(
    session: LingyunSession,
    execution: LingyunAgentExecutionContext,
    text: string,
    callbacks?: AgentCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.skillsConfig.enabled) return;

    const mentions = extractSkillMentions(text);
    if (mentions.length === 0) return;

    const index = await getSkillIndex({
      workspaceRoot: this.workspaceRoot,
      searchPaths: this.skillsConfig.paths,
      allowExternalPaths: execution.runtime.allowExternalPaths,
      signal,
    });

    const { selected } = selectSkillsForText<SkillInfo>(text, index);

    if (selected.length === 0) return;

    const maxSkills = this.skillsConfig.maxInjectSkills;
    const maxChars = this.skillsConfig.maxInjectChars;

    const selectedForInject = selected.slice(0, maxSkills);
    const activeLabel = selectedForInject.map((s: SkillInfo) => `$${s.name}`).join(', ');

    const blocks: string[] = [];
    if (activeLabel) {
      blocks.push(
        [
          '<skills>',
          `<active>${activeLabel}</active>`,
          'You MUST apply ALL active skills for the next user request.',
          'Treat skill instructions as additive. If they conflict, call it out and ask the user how to proceed (do not ignore a skill silently).',
          '</skills>',
        ].join('\n'),
      );
    }

    for (const skill of selectedForInject) {
      if (signal?.aborted) break;
      if (!session.mentionedSkills.includes(skill.name)) {
        session.mentionedSkills.push(skill.name);
      }

      let body: string;
      try {
        body = (await loadSkillFile(skill)).content;
      } catch {
        continue;
      }

      let truncated = false;
      if (body.length > maxChars) {
        body = body.slice(0, maxChars);
        truncated = true;
      }

      blocks.push(
        [
          '<skill>',
          `<name>${skill.name}</name>`,
          `<path>${redactFsPathForPrompt(skill.filePath, { workspaceRoot: this.workspaceRoot })}</path>`,
          body.trimEnd(),
          truncated ? '\n\n... [TRUNCATED]' : '',
          '</skill>',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    if (blocks.length > 0) {
      session.history.push(createUserHistoryMessage(blocks.join('\n\n'), { synthetic: true, skill: true }));
    }
  }

  run(params: {
    session: LingyunSession;
    input: UserHistoryInput;
    callbacks?: AgentCallbacks;
    signal?: AbortSignal;
    configOverride?: Partial<AgentConfig>;
  }): LingyunRun {
    const queue = new AsyncQueue<LingyunEvent>();

    const callbacks = params.callbacks;
    const proxy: AgentCallbacks = {
      ...callbacks,
      onDebug: (message) => {
        invokeCallbackSafely(callbacks?.onDebug, { label: 'onDebug' }, message);
        queue.push({ type: 'debug', message });
      },
      onNotice: (notice) => {
        const result = invokeCallbackSafely(callbacks?.onNotice, { label: 'onNotice', onDebug: callbacks?.onDebug }, notice);
        queue.push({ type: 'notice', notice });
        return result;
      },
      onStatusChange: (status) => {
        invokeCallbackSafely(callbacks?.onStatusChange, { label: 'onStatusChange', onDebug: callbacks?.onDebug }, status);
        queue.push({ type: 'status', status: status as any });
      },
      onAssistantToken: (token) => {
        invokeCallbackSafely(callbacks?.onAssistantToken, { label: 'onAssistantToken', onDebug: callbacks?.onDebug }, token);
        queue.push({ type: 'assistant_token', token });
      },
      onThoughtToken: (token) => {
        invokeCallbackSafely(callbacks?.onThoughtToken, { label: 'onThoughtToken', onDebug: callbacks?.onDebug }, token);
        queue.push({ type: 'thought_token', token });
      },
      onToolCall: (tool, definition) => {
        invokeCallbackSafely(
          callbacks?.onToolCall,
          { label: `onToolCall tool=${definition.id}`, onDebug: callbacks?.onDebug },
          tool,
          definition,
        );
        queue.push({ type: 'tool_call', tool, definition });
      },
      onToolBlocked: (tool, definition, reason) => {
        invokeCallbackSafely(callbacks?.onToolBlocked, { label: `onToolBlocked tool=${definition.id}`, onDebug: callbacks?.onDebug }, tool, definition, reason);
        queue.push({ type: 'tool_blocked', tool, definition, reason });
      },
      onToolResult: (tool, result) => {
        invokeCallbackSafely(callbacks?.onToolResult, { label: `onToolResult tool=${tool.function.name}`, onDebug: callbacks?.onDebug }, tool, result);
        queue.push({ type: 'tool_result', tool, result });
      },
      onSubagentEvent: (event) => {
        invokeCallbackSafely(
          callbacks?.onSubagentEvent,
          { label: `onSubagentEvent type=${event.type}`, onDebug: callbacks?.onDebug },
          event,
        );
        queue.push(event);
      },
      onCompactionStart: (event) => {
        const result = invokeCallbackSafely(
          callbacks?.onCompactionStart,
          { label: 'onCompactionStart', onDebug: callbacks?.onDebug },
          event,
        );
        queue.push({ type: 'compaction_start', auto: event.auto, markerMessageId: event.markerMessageId });
        return result;
      },
      onCompactionEnd: (event) => {
        const result = invokeCallbackSafely(
          callbacks?.onCompactionEnd,
          { label: 'onCompactionEnd', onDebug: callbacks?.onDebug },
          event,
        );
        queue.push({
          type: 'compaction_end',
          auto: event.auto,
          markerMessageId: event.markerMessageId,
          summaryMessageId: event.summaryMessageId,
          status: event.status,
          error: event.error,
        });
        return result;
      },
    };

    const done = (async () => {
      try {
        const prepared = await this.prepareRun(params.session, params.input, params.signal, params.configOverride);
        const { execution, syntheticContexts } = prepared;

        const modelId = (execution.config.model ?? '').trim();
        const modelLimit = modelId ? this.getModelLimit(modelId, execution.runtime) : undefined;
        const reservedOutputTokens = getReservedOutputTokens({
          modelLimit,
          maxOutputTokens: this.getMaxOutputTokens(execution.config),
        });
        const lastTokens = getLastAssistantTokens(params.session.history);

        if (
          modelId &&
          isContextOverflow({
            lastTokens,
            modelLimit,
            reservedOutputTokens,
            config: this.compactionConfig,
          })
        ) {
          await compactSessionInternal({
            session: params.session,
            auto: true,
            appendContinue: false,
            modelId,
            mode: this.getModeForConfig(execution.config),
            sessionIdFallback: execution.config.sessionId,
            callbacks: proxy,
            llm: this.llm,
            plugins: this.plugins,
            providerBehavior: this.providerBehavior,
            compactionConfig: execution.runtime.compactionConfig,
            maxOutputTokens: this.getMaxOutputTokens(execution.config),
          });
        }

        await this.injectSkillsForUserText(
          params.session,
          execution,
          getUserHistoryInputText(params.input),
          proxy,
          params.signal
        );
        params.session.history.push(createUserHistoryMessage(params.input));
        const text = await this.runOnce(
          params.session,
          execution,
          syntheticContexts,
          proxy,
          params.signal
        );
        params.session.compactionSyntheticContexts = snapshotSyntheticContextsForCompaction(syntheticContexts);
        queue.push({ type: 'status', status: { type: 'done', message: '' } as any });
        queue.close();
        return { text, session: params.session };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        invokeCallbackSafely(callbacks?.onError, { label: 'onError', onDebug: callbacks?.onDebug }, err);
        queue.push({ type: 'status', status: { type: 'error', message: err.message } as any });
        queue.fail(err);
        throw err;
      } finally {
        params.session.history = stripSkillInjectedMessages(params.session.history);
      }
    })();

    return { events: queue, done };
  }

  async resume(params: { session: LingyunSession; callbacks?: AgentCallbacks; signal?: AbortSignal }): Promise<string> {
    const prepared = await this.prepareRun(params.session, undefined, params.signal);
    return this.runOnce(
      params.session,
      prepared.execution,
      prepared.syntheticContexts,
      params.callbacks,
      params.signal
    );
  }
}
