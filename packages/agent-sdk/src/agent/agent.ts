import * as path from 'path';
import {
  convertToModelMessages,
  jsonSchema,
  tool as aiTool,
  type ModelMessage,
} from 'ai';

import type { ToolCall, ToolDefinition, ToolResult, AgentCallbacks, AgentConfig, LLMProvider, LingyunEvent, LingyunRun } from '../types.js';
import {
  TOOL_ERROR_CODES,
  createHistoryForModel,
  createUserHistoryMessage,
  extractSkillMentions,
  getSkillIndex,
  getEffectiveHistory,
  getUserHistoryInputText,
  listBuiltinSubagents,
  loadSkillFile,
  normalizeSessionId,
  redactFsPathForPrompt,
  requireString,
  resolveBuiltinSubagent,
  selectSkillsForText,
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

export { LingyunSession };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export type LingyunAgentRuntimeOptions = {
  plugins?: LingyunPluginManager;
  workspaceRoot?: string;
  allowExternalPaths?: boolean;
  copilot?: {
    reasoningEffort?: string;
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
};

export type LingyunPluginManager = {
  trigger: <Name extends LingyunHookName, Output>(name: Name, input: unknown, output: Output) => Promise<Output>;
  getPluginTools?: () => Promise<LingyunPluginToolEntry[]>;
};

export class LingyunAgent {
  private readonly plugins: LingyunPluginManager;
  private readonly workspaceRoot?: string;
  private readonly fileHandles: FileHandleRegistry;
  private allowExternalPaths: boolean;
  private copilotReasoningEffort: string;
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
  private taskMaxOutputChars: number;
  private modelLimits?: Record<string, ModelLimit>;
  private compactionConfig: CompactionConfig;
  private registeredPluginTools = new Set<string>();
  private readonly taskSessions = new Map<string, LingyunSession>();
  private readonly maxTaskSessions = 50;
  private readonly providerBehavior: ProviderBehavior;

  constructor(
    private readonly llm: LLMProvider,
    private config: AgentConfig,
    private readonly registry: ToolRegistry,
    runtime?: LingyunAgentRuntimeOptions
  ) {
    this.plugins = runtime?.plugins ?? new PluginManager({ workspaceRoot: runtime?.workspaceRoot });
    this.workspaceRoot = runtime?.workspaceRoot ? path.resolve(runtime.workspaceRoot) : undefined;
    this.fileHandles = new FileHandleRegistry({ workspaceRoot: this.workspaceRoot });
    this.allowExternalPaths = !!runtime?.allowExternalPaths;
    this.copilotReasoningEffort = typeof runtime?.copilot?.reasoningEffort === 'string' ? runtime.copilot.reasoningEffort.trim() : '';
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
      getBasePrompt: () => this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      getSessionId: () => this.config.sessionId,
      getMode: () => this.getMode(),
    });
  }

  updateConfig(next: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...(next ?? {}) };
  }

  setMode(mode: 'build' | 'plan'): void {
    this.config = { ...this.config, mode };
  }

  setModelLimits(modelLimits?: Record<string, ModelLimit>): void {
    this.modelLimits = modelLimits;
  }

  setCompactionConfig(compaction?: Partial<CompactionConfig>): void {
    if (!compaction) return;
    const current = this.compactionConfig;
    const toolOutputMode =
      compaction.toolOutputMode === 'afterToolCall' || compaction.toolOutputMode === 'onCompaction'
        ? compaction.toolOutputMode
        : current.toolOutputMode;

    this.compactionConfig = {
      auto: typeof compaction.auto === 'boolean' ? compaction.auto : current.auto,
      prune: typeof compaction.prune === 'boolean' ? compaction.prune : current.prune,
      pruneProtectTokens:
        typeof compaction.pruneProtectTokens === 'number' && Number.isFinite(compaction.pruneProtectTokens)
          ? Math.max(0, Math.floor(compaction.pruneProtectTokens))
          : current.pruneProtectTokens,
      pruneMinimumTokens:
        typeof compaction.pruneMinimumTokens === 'number' && Number.isFinite(compaction.pruneMinimumTokens)
          ? Math.max(0, Math.floor(compaction.pruneMinimumTokens))
          : current.pruneMinimumTokens,
      toolOutputMode,
    };
  }

  setTaskMaxOutputChars(maxOutputChars: number): void {
    if (typeof maxOutputChars !== 'number' || !Number.isFinite(maxOutputChars) || maxOutputChars <= 0) return;
    this.taskMaxOutputChars = Math.floor(maxOutputChars);
  }

  setCopilotReasoningEffort(reasoningEffort: string | undefined): void {
    this.copilotReasoningEffort = typeof reasoningEffort === 'string' ? reasoningEffort.trim() : '';
  }

  setAllowExternalPaths(allowExternalPaths: boolean): void {
    const next = !!allowExternalPaths;
    if (this.allowExternalPaths === next) return;
    this.allowExternalPaths = next;
  }

  async compactSession(session: LingyunSession, callbacks?: AgentCallbacks, options?: { modelId?: string; auto?: boolean }): Promise<void> {
    if (!session.history.length) return;
    const modelId = (options?.modelId ?? this.config.model ?? '').trim();
    if (!modelId) {
      throw new Error('No model configured');
    }
    await compactSessionInternal({
      session,
      auto: options?.auto === true,
      modelId,
      mode: this.getMode(),
      sessionIdFallback: this.config.sessionId,
      callbacks,
      llm: this.llm,
      plugins: this.plugins,
      providerBehavior: this.providerBehavior,
      compactionConfig: this.compactionConfig,
      maxOutputTokens: this.getMaxOutputTokens(),
    });
  }

  private getMode(): 'build' | 'plan' {
    return this.config.mode === 'plan' ? 'plan' : 'build';
  }

  private getModelLimit(modelId: string): ModelLimit | undefined {
    return this.modelLimits?.[modelId];
  }

  private getMaxOutputTokens(): number {
    const max = this.config.maxOutputTokens;
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

  private async toModelMessages(session: LingyunSession, tools: Record<string, unknown>, modelId: string): Promise<ModelMessage[]> {
    const effective = getEffectiveHistory(session.history);
    const prepared = createHistoryForModel(effective);
    const reminded = insertModeReminders(prepared, this.getMode(), {
      allowExternalPaths: this.allowExternalPaths,
      prompts: this.reminderPrompts,
    });
    const withoutIds = reminded.map(({ id: _id, ...rest }) => rest);

    const messagesOutput = await this.plugins.trigger(
      'experimental.chat.messages.transform',
      { sessionId: session.sessionId ?? this.config.sessionId, mode: this.getMode(), modelId },
      { messages: [...withoutIds] as unknown[] }
    );

    const messages = Array.isArray((messagesOutput as any).messages) ? (messagesOutput as any).messages : withoutIds;
    const replayed = this.providerBehavior.prepareHistoryForPrompt(messages as unknown as AgentHistoryMessage[]);
    const converted = await convertToModelMessages(replayed as any, { tools: tools as any });
    return this.providerBehavior.transformModelMessages(modelId, converted);
  }

  private createToolContext(signal: AbortSignal, session: LingyunSession, callbacks?: AgentCallbacks) {
    return {
      workspaceRoot: this.workspaceRoot,
      allowExternalPaths: this.allowExternalPaths,
      sessionId: session.sessionId ?? this.config.sessionId,
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
    callbacks: AgentCallbacks | undefined,
    toolNameToDefinition: Map<string, ToolDefinition>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const def of tools) {
      const toolName = def.id;
      toolNameToDefinition.set(toolName, def);

      if (toolName === 'task') {
        out[toolName] = aiTool({
          id: toolName as any,
          description: def.description,
          inputSchema: jsonSchema(def.parameters as any),
          execute: async (args: any, options: any) => {
            const resolvedArgs: any = args ?? {};

            if (session.parentSessionId || session.subagentType) {
              return {
                success: false,
                error: 'Subagents cannot spawn other subagents via task.',
                metadata: { errorCode: TOOL_ERROR_CODES.task_recursion_denied },
              };
            }

            const parentMode = this.getMode();

            const descriptionResult = requireString(resolvedArgs, 'description');
            if ('error' in descriptionResult) return { success: false, error: descriptionResult.error };
            const promptResult = requireString(resolvedArgs, 'prompt');
            if ('error' in promptResult) return { success: false, error: promptResult.error };
            const typeResult = requireString(resolvedArgs, 'subagent_type');
            if ('error' in typeResult) return { success: false, error: typeResult.error };

            const subagentTypeRaw = typeResult.value.trim();
            const subagent = resolveBuiltinSubagent(subagentTypeRaw);
            if (!subagent) {
              const names = listBuiltinSubagents().map((a: { name: string }) => a.name).join(', ');
              return {
                success: false,
                error: `Unknown subagent_type: ${subagentTypeRaw}. Available: ${names || '(none)'}`,
                metadata: { errorCode: TOOL_ERROR_CODES.unknown_subagent_type, subagentType: subagentTypeRaw },
              };
            }

            if (parentMode === 'plan' && subagent.name !== 'explore') {
              return {
                success: false,
                error: 'Only the explore subagent is allowed in Plan mode.',
                metadata: { errorCode: TOOL_ERROR_CODES.subagent_denied_in_plan, subagentType: subagent.name },
              };
            }

            const sessionIdRaw =
              typeof resolvedArgs.session_id === 'string' && resolvedArgs.session_id.trim()
                ? String(resolvedArgs.session_id).trim()
                : '';

            const parentSessionId = session.sessionId ?? this.config.sessionId;
            const requestedSessionId = normalizeSessionId(sessionIdRaw) || '';
            const childSessionId = requestedSessionId || crypto.randomUUID();

            const existing = this.taskSessions.get(childSessionId);
            const childSession =
              existing ??
              new LingyunSession({
                sessionId: childSessionId,
                parentSessionId,
                subagentType: subagent.name,
              });

            if (!existing) {
              this.taskSessions.set(childSessionId, childSession);
              while (this.taskSessions.size > this.maxTaskSessions) {
                const oldestKey = this.taskSessions.keys().next().value as string | undefined;
                if (!oldestKey) break;
                if (oldestKey === childSessionId) break;
                this.taskSessions.delete(oldestKey);
              }
            } else {
              childSession.parentSessionId = parentSessionId;
              childSession.subagentType = subagent.name;
              // Refresh LRU order.
              this.taskSessions.delete(childSessionId);
              this.taskSessions.set(childSessionId, childSession);
            }

            const parentModelId = this.config.model;
            if (!parentModelId) {
              return {
                success: false,
                error: 'No model configured. Set AgentConfig.model.',
                metadata: { errorCode: TOOL_ERROR_CODES.missing_model },
              };
            }

            const configuredSubagentModel =
              typeof this.config.subagentModel === 'string' ? this.config.subagentModel.trim() : '';

            const desiredChildModelId = childSession.modelId || configuredSubagentModel || parentModelId;
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
                  callbacks?.onNotice,
                  { label: 'onNotice subagent_model_fallback', onDebug: callbacks?.onDebug },
                  { level: 'warning', message: childModelWarning },
                );
                invokeCallbackSafely(
                  callbacks?.onDebug,
                  { label: 'onDebug subagent_model_fallback' },
                  `[Task] subagent model fallback requested=${desiredChildModelId} using=${parentModelId} error=${error instanceof Error ? error.name : typeof error}`,
                );
                childModelId = parentModelId;
              }
            }

            childSession.modelId = childModelId;

            const basePrompt = this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
            const subagentConfig: AgentConfig = {
              model: childModelId,
              mode: 'build',
              temperature: this.config.temperature,
              maxRetries: this.config.maxRetries,
              maxOutputTokens: this.config.maxOutputTokens,
              autoApprove: this.config.autoApprove,
              toolFilter: subagent.toolFilter?.length ? subagent.toolFilter : undefined,
              systemPrompt: `${basePrompt}\n\n${subagent.prompt}`,
              sessionId: childSessionId,
            };

            const subagentRunner = new LingyunAgent(this.llm, subagentConfig, this.registry, {
              plugins: this.plugins,
              workspaceRoot: this.workspaceRoot,
              allowExternalPaths: this.allowExternalPaths,
              skills: this.skillsConfig,
              modelLimits: this.modelLimits,
              compaction: this.compactionConfig,
            });

            const toolSummary = new Map<
              string,
              { id: string; tool: string; status: 'running' | 'success' | 'error' }
            >();

            const childCallbacks: AgentCallbacks = {
              onRequestApproval: callbacks?.onRequestApproval,
              onToolCall: (tool, definition) => {
                toolSummary.set(tool.id, { id: tool.id, tool: definition.id, status: 'running' });
              },
              onToolResult: (tool, result) => {
                const prev = toolSummary.get(tool.id);
                const nextStatus: 'success' | 'error' = result.success ? 'success' : 'error';
                toolSummary.set(tool.id, {
                  id: tool.id,
                  tool: prev?.tool ?? tool.function.name,
                  status: nextStatus,
                });
              },
            };

            try {
              const run = subagentRunner.run({
                session: childSession,
                input: promptResult.value,
                callbacks: childCallbacks,
                signal: options.abortSignal,
              });
              const drain = (async () => {
                for await (const _event of run.events) {
                  // drain
                }
              })();
              const done = await run.done;
              await drain;
              const text = done.text || '';

              const outputText = this.formatTaskOutputText(text, childSessionId);

              const summary = [...toolSummary.values()].sort((a, b) => a.id.localeCompare(b.id));

              return {
                success: true,
                data: {
                  session_id: childSessionId,
                  subagent_type: subagent.name,
                  text,
                },
                metadata: {
                  title: descriptionResult.value,
                  outputText,
                  task: {
                    description: descriptionResult.value,
                    subagent_type: subagent.name,
                    session_id: childSessionId,
                    parent_session_id: parentSessionId,
                    summary,
                    model_id: childModelId,
                    ...(childModelWarning
                      ? { model_warning: childModelWarning, requested_model_id: desiredChildModelId }
                      : {}),
                  },
                  childSession: {
                    sessionId: childSessionId,
                    parentSessionId,
                    subagentType: subagent.name,
                    modelId: childModelId,
                    history: childSession.getHistory(),
                    pendingPlan: childSession.pendingPlan,
                    fileHandles: childSession.fileHandles,
                    semanticHandles: childSession.semanticHandles,
                  },
                },
              };
            } catch (error) {
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { errorCode: TOOL_ERROR_CODES.task_subagent_failed },
              };
            } finally {
              // Avoid leaking subagent's temporary skill injection messages to later turns.
              childSession.history = childSession.history.filter((msg) => !(msg.role === 'user' && msg.metadata?.skill));
            }
          },
          toModelOutput: async (options: any) => {
            const output = options.output as ToolResult;
            const content = await this.formatToolResult(output, def.name);
            return { type: 'text', value: content };
          },
        });
        continue;
      }

      out[toolName] = aiTool({
        id: toolName as any,
        description: def.description,
        inputSchema: jsonSchema(def.parameters as any),
        execute: async (args: any, options: any) => {
          return executeToolWithPolicies({
            host: {
              config: this.config,
              plugins: this.plugins,
              registry: this.registry,
              fileHandles: this.fileHandles,
              allowExternalPaths: this.allowExternalPaths,
              workspaceRoot: this.workspaceRoot,
              createToolContext: (signal, scopedSession, scopedCallbacks) =>
                this.createToolContext(signal, scopedSession, scopedCallbacks),
              formatToolResult: (result, toolLabel) => this.formatToolResult(result, toolLabel),
            },
            def,
            toolName,
            mode,
            session,
            semanticHandles,
            callbacks,
            args,
            options: { toolCallId: String(options.toolCallId), abortSignal: options.abortSignal },
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

  private formatTaskOutputText(text: string, childSessionId: string): string {
    const baseText = String(text || '').trimEnd();
    const metadataBlock =
      '\n\n' + ['<task_metadata>', `session_id: ${childSessionId}`, '</task_metadata>'].join('\n');

    const maxChars = this.taskMaxOutputChars;
    if (!maxChars || !Number.isFinite(maxChars) || maxChars <= 0) {
      return baseText + metadataBlock;
    }

    const full = baseText + metadataBlock;
    if (full.length <= maxChars) return full;

    const marker = '\n\n... [TRUNCATED]';
    const reserved = marker.length + metadataBlock.length;
    if (reserved >= maxChars) {
      if (metadataBlock.length <= maxChars) return metadataBlock;
      return metadataBlock.slice(metadataBlock.length - maxChars);
    }

    const available = maxChars - reserved;
    const truncatedText = available > 0 ? baseText.slice(0, available).trimEnd() : '';
    return truncatedText + marker + metadataBlock;
  }

  private filterTools(tools: ToolDefinition[]): ToolDefinition[] {
    const filter = this.config.toolFilter;
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

  private async composeSystemPrompt(modelId: string, options?: { signal?: AbortSignal }): Promise<string[]> {
    return this.promptComposer.composeSystemPrompts(modelId, { signal: options?.signal });
  }

  private async runOnce(session: LingyunSession, callbacks?: AgentCallbacks, signal?: AbortSignal): Promise<string> {
    const modelId = (this.config.model || '').trim();
    if (!modelId) {
      throw new Error('No model configured');
    }

    await this.ensurePluginToolsRegistered();

    const mode = this.getMode();
    const sessionId = session.sessionId ?? this.config.sessionId;

    return runOnceLoop({
      session,
      callbacks,
      signal,
      modelId,
      mode,
      sessionId,
      sessionIdFallback: this.config.sessionId,
      llm: this.llm,
      plugins: this.plugins,
      registry: this.registry,
      providerBehavior: this.providerBehavior,
      copilotReasoningEffort: this.copilotReasoningEffort,
      compactionConfig: this.compactionConfig,
      temperature: this.config.temperature ?? 0.0,
      maxRetries: this.config.maxRetries ?? 0,
      getMaxOutputTokens: () => this.getMaxOutputTokens(),
      getModelLimit: (id) => this.getModelLimit(id),
      composeSystemPrompt: (id, options) => this.composeSystemPrompt(id, options),
      filterTools: (tools) => this.filterTools(tools),
      createAISDKTools: (tools, toolMode, scopedSession, semanticHandles, scopedCallbacks, toolNameToDefinition) =>
        this.createAISDKTools(
          tools,
          toolMode,
          scopedSession,
          semanticHandles,
          scopedCallbacks,
          toolNameToDefinition,
        ),
      toModelMessages: (scopedSession, tools, id) => this.toModelMessages(scopedSession, tools, id),
      pruneToolResultForHistory: (output, toolLabel) => this.pruneToolResultForHistory(output, toolLabel),
    });
  }

  private async injectSkillsForUserText(
    session: LingyunSession,
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
      allowExternalPaths: this.allowExternalPaths,
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

  run(params: { session: LingyunSession; input: UserHistoryInput; callbacks?: AgentCallbacks; signal?: AbortSignal }): LingyunRun {
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
        await this.injectSkillsForUserText(params.session, getUserHistoryInputText(params.input), proxy, params.signal);
        params.session.history.push(createUserHistoryMessage(params.input));
        const text = await this.runOnce(params.session, proxy, params.signal);
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
        params.session.history = params.session.history.filter((msg) => !(msg.role === 'user' && msg.metadata?.skill));
      }
    })();

    return { events: queue, done };
  }

  async resume(params: { session: LingyunSession; callbacks?: AgentCallbacks; signal?: AbortSignal }): Promise<string> {
    return this.runOnce(params.session, params.callbacks, params.signal);
  }
}
