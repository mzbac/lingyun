import * as path from 'path';
import {
  convertToModelMessages,
  extractReasoningMiddleware,
  jsonSchema,
  streamText,
  tool as aiTool,
  wrapLanguageModel,
  type ModelMessage,
  type TextStreamPart,
} from 'ai';

import type { ToolCall, ToolDefinition, ToolResult, AgentCallbacks, AgentConfig, LLMProvider, LingyunEvent, LingyunRun } from '../types.js';
import { combineAbortSignals } from '../abort.js';
import {
  COMPACTION_AUTO_CONTINUE_TEXT,
  COMPACTION_MARKER_TEXT,
  COMPACTION_PROMPT_TEXT,
  COMPACTION_SYSTEM_PROMPT,
  TOOL_ERROR_CODES,
  extractPlanFromReasoning,
  createAssistantHistoryMessage,
  createHistoryForCompactionPrompt,
  createHistoryForModel,
  createUserHistoryMessage,
  evaluatePermission,
  evaluateShellCommand,
  extractSkillMentions,
  extractUsageTokens,
  finalizeStreamingParts,
  findExternalPathReferencesInShellCommand,
  getSkillIndex,
  getDefaultLingyunPermissionRuleset,
  getEffectiveHistory,
  getMessageText,
  getUserHistoryInputText,
  getReservedOutputTokens,
  isOverflow as isContextOverflow,
  isPathInsideWorkspace,
  listBuiltinSubagents,
  loadSkillFile,
  normalizeSessionId,
  markPreviousAssistantToolOutputs,
  redactFsPathForPrompt,
  requireString,
  resolveBuiltinSubagent,
  selectSkillsForText,
  toToolCall,
  stripThinkBlocks,
  stripToolBlocks,
  setDynamicToolError,
  setDynamicToolOutput,
  upsertDynamicToolCall,
  type AgentHistoryMessage,
  type CompactionConfig,
  type ModelLimit,
  type PermissionAction,
  type PermissionRuleset,
  type SkillInfo,
  type UserHistoryInput,
} from '@kooka/core';
import { PluginManager } from '../plugins/pluginManager.js';
import type { LingyunHookName, LingyunPluginToolEntry } from '../plugins/types.js';
import { insertModeReminders } from './reminders.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { EDIT_TOOL_IDS, MAX_TOOL_RESULT_LENGTH } from './constants.js';
import { delay as getRetryDelayMs, retryable as getRetryableLlmError, sleep as retrySleep } from './retry.js';
import { createProviderBehavior } from './providerBehavior.js';
import type { ProviderBehavior } from './providerBehavior.js';
import { buildStreamReplay, type StreamReplayUpdate } from './streamAdapters.js';
import type { ToolRegistry } from '../tools/registry.js';
import { DEFAULT_SKILL_PATHS } from '../tools/builtin/index.js';
import { SemanticHandleRegistry, type SemanticHandlesState, type FileHandleLike } from './semanticHandles.js';
import { PromptComposer, SkillsPromptProvider } from './promptComposer.js';
import { FileHandleRegistry } from './fileHandles.js';

type AsyncQueueState<T> = {
  values: T[];
  resolvers: Array<(value: IteratorResult<T>) => void>;
  rejecters: Array<(error: unknown) => void>;
  closed: boolean;
  error?: unknown;
};

class AsyncQueue<T> implements AsyncIterable<T> {
  private state: AsyncQueueState<T> = {
    values: [],
    resolvers: [],
    rejecters: [],
    closed: false,
  };

  push(value: T): void {
    if (this.state.closed) return;
    const resolver = this.state.resolvers.shift();
    const rejecter = this.state.rejecters.shift();
    if (resolver && rejecter) {
      resolver({ value, done: false });
      return;
    }
    this.state.values.push(value);
  }

  close(): void {
    if (this.state.closed) return;
    this.state.closed = true;
    for (const resolve of this.state.resolvers) {
      resolve({ value: undefined as any, done: true });
    }
    this.state.resolvers = [];
    this.state.rejecters = [];
  }

  fail(error: unknown): void {
    if (this.state.closed) return;
    this.state.closed = true;
    this.state.error = error;
    for (const reject of this.state.rejecters) {
      reject(error);
    }
    this.state.resolvers = [];
    this.state.rejecters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.state.error) {
          return Promise.reject(this.state.error);
        }
        const value = this.state.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.state.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.state.resolvers.push(resolve);
          this.state.rejecters.push(reject);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as any, done: true });
      },
      throw: (error) => {
        this.fail(error);
        return Promise.reject(error);
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function invokeCallbackSafely<TArgs extends unknown[]>(
  fn: ((...args: TArgs) => void | Promise<void>) | undefined,
  params: { label: string; onDebug?: (message: string) => void },
  ...args: TArgs
): void | Promise<void> {
  if (!fn) return;

  const report = (kind: 'rejected' | 'threw', error: unknown) => {
    try {
      params.onDebug?.(
        `[Callbacks] ${params.label} ${kind} (${error instanceof Error ? error.name : typeof error})`,
      );
    } catch {
      // ignore
    }
  };

  try {
    const result = fn(...args);
    if (result && typeof (result as Promise<void>).then === 'function') {
      return Promise.resolve(result)
        .catch((error) => {
          report('rejected', error);
        })
        .then(() => undefined);
    }
  } catch (error) {
    report('threw', error);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const DOTENV_ALLOWLIST_SUFFIXES = ['.env.sample', '.env.example', '.example', '.env.template'];
const DOTENV_TOKEN_REGEX = /(^|[^A-Za-z0-9_])(\.env(?:\.[A-Za-z0-9_.-]+)?)(?=$|[^A-Za-z0-9_.-])/g;

function stripShellToken(token: string): string {
  return token.replace(/^[`"'()[\]{}<>,;|&]+|[`"'()[\]{}<>,;|&]+$/g, '');
}

function isProtectedDotEnvBasename(value: string): boolean {
  const basename = path.basename(value).toLowerCase();
  return /^\.env(\.|$)/.test(basename) && !DOTENV_ALLOWLIST_SUFFIXES.some((allowed) => basename.endsWith(allowed));
}

function findProtectedDotEnvMentions(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(DOTENV_TOKEN_REGEX)) {
    const candidate = match[2];
    if (candidate && isProtectedDotEnvBasename(candidate)) {
      out.add(candidate);
    }
  }
  return [...out];
}

function collectDotEnvApprovalTargets(def: ToolDefinition, args: Record<string, unknown>): string[] {
  const out = new Set<string>();

  const filePath = asString((args as any).filePath);
  if (filePath && isProtectedDotEnvBasename(filePath)) {
    out.add(filePath);
  }

  if (def.id === 'grep') {
    const searchPath = asString((args as any).path);
    if (searchPath && isProtectedDotEnvBasename(searchPath)) {
      out.add(searchPath);
    }
    const include = asString((args as any).include);
    if (include) {
      for (const token of include.split(/\s+/).map(stripShellToken).filter(Boolean)) {
        if (isProtectedDotEnvBasename(token)) {
          out.add(token);
        }
      }
      for (const token of findProtectedDotEnvMentions(include)) {
        out.add(token);
      }
    }
  }

  const isShellExecutionTool = def.id === 'bash' || def.execution?.type === 'shell';
  if (isShellExecutionTool) {
    const commandText =
      asString((args as any).command) ||
      (def.execution?.type === 'shell' ? asString((def.execution as unknown as Record<string, unknown>).script) : undefined);
    if (commandText) {
      for (const token of commandText.split(/\s+/).map(stripShellToken).filter(Boolean)) {
        const rhs = token.includes('=') ? token.slice(token.lastIndexOf('=') + 1) : token;
        if (rhs && isProtectedDotEnvBasename(rhs)) {
          out.add(rhs);
        }
      }
      for (const token of findProtectedDotEnvMentions(commandText)) {
        out.add(token);
      }
    }
  }

  return [...out];
}

export class LingyunSession {
  history: AgentHistoryMessage[] = [];
  pendingPlan?: string;
  sessionId?: string;
  parentSessionId?: string;
  subagentType?: string;
  modelId?: string;
  mentionedSkills: string[] = [];
  fileHandles?: {
    nextId: number;
    byId: Record<string, string>;
  };
  semanticHandles?: SemanticHandlesState;

  constructor(
    init?: Partial<
      Pick<
        LingyunSession,
        | 'history'
        | 'pendingPlan'
        | 'sessionId'
        | 'parentSessionId'
        | 'subagentType'
        | 'modelId'
        | 'mentionedSkills'
        | 'fileHandles'
        | 'semanticHandles'
      >
    >,
  ) {
    if (init?.history) this.history = [...init.history];
    if (init?.pendingPlan) this.pendingPlan = init.pendingPlan;
    if (init?.sessionId) this.sessionId = init.sessionId;
    if (init?.parentSessionId) this.parentSessionId = init.parentSessionId;
    if (init?.subagentType) this.subagentType = init.subagentType;
    if (init?.modelId) this.modelId = init.modelId;
    if (init?.mentionedSkills) this.mentionedSkills = [...init.mentionedSkills];
    if (init?.fileHandles) this.fileHandles = init.fileHandles;
    if (init?.semanticHandles) this.semanticHandles = init.semanticHandles;
  }

  getHistory(): AgentHistoryMessage[] {
    return [...this.history];
  }
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
    await this.compactSessionInternal(session, { auto: options?.auto === true, modelId }, callbacks);
  }

  private getMode(): 'build' | 'plan' {
    return this.config.mode === 'plan' ? 'plan' : 'build';
  }

  private getModelLimit(modelId: string): ModelLimit | undefined {
    return this.modelLimits?.[modelId];
  }

  private getPermissionRuleset(mode: 'build' | 'plan'): PermissionRuleset {
    return getDefaultLingyunPermissionRuleset(mode);
  }

  private getPermissionName(def: ToolDefinition): string {
    const explicit = def.metadata?.permission;
    if (explicit && explicit.trim()) return explicit.trim();

    if (EDIT_TOOL_IDS.has(def.id)) return 'edit';
    return def.id;
  }

  private normalizePermissionPath(input: string): string {
    const workspaceRoot = this.workspaceRoot;
    if (!workspaceRoot) return input;

    try {
      const abs = path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspaceRoot, input);
      const rel = path.relative(workspaceRoot, abs);
      if (!rel || rel === '.') return '.';
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return abs;
      }
      return rel.replace(/\\/g, '/');
    } catch {
      return input;
    }
  }

  private getPermissionPatterns(def: ToolDefinition, args: any): string[] {
    const patternsMeta = def.metadata?.permissionPatterns;
    if (!patternsMeta || patternsMeta.length === 0) {
      return ['*'];
    }

    const patterns: string[] = [];
    for (const item of patternsMeta) {
      if (!item || typeof item.arg !== 'string' || !item.arg) continue;
      const raw = args?.[item.arg];
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value) continue;
      if (item.kind === 'path') {
        patterns.push(this.normalizePermissionPath(value));
      } else {
        patterns.push(value);
      }
    }

    return patterns.length > 0 ? patterns : ['*'];
  }

  private getExternalPathPatterns(def: ToolDefinition, args: any): string[] {
    if (!def.metadata?.supportsExternalPaths) return [];

    const patternsMeta = def.metadata?.permissionPatterns;
    if (!patternsMeta || patternsMeta.length === 0) return [];

    const workspaceRoot = this.workspaceRoot;
    if (!workspaceRoot) return [];

    const out = new Set<string>();
    for (const item of patternsMeta) {
      if (!item || typeof item.arg !== 'string' || !item.arg) continue;
      if (item.kind !== 'path') continue;
      const raw = args?.[item.arg];
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value) continue;
      const normalized = this.normalizePermissionPath(value);
      if (path.isAbsolute(normalized)) {
        out.add(normalized);
      }
    }

    return [...out];
  }

  private combinePermissionActions(current: PermissionAction, next: PermissionAction): PermissionAction {
    if (current === 'deny' || next === 'deny') return 'deny';
    if (current === 'ask' || next === 'ask') return 'ask';
    return 'allow';
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
          const callId = String(options.toolCallId);
          let resolvedArgs: any = args ?? {};
          const sessionId = session.sessionId ?? this.config.sessionId;

          // tool.execute.before
          {
            const before = await this.plugins.trigger(
              'tool.execute.before',
              { tool: toolName, sessionId, callId },
              { args: resolvedArgs }
            );
            if (before && typeof (before as any).args === 'object' && (before as any).args !== null) {
              resolvedArgs = (before as any).args;
            }
          }

          if (
            isRecord(resolvedArgs) &&
            (def.id === 'read' ||
              def.id === 'read_range' ||
              def.id === 'edit' ||
              def.id === 'write' ||
              def.id === 'lsp' ||
              def.id === 'symbols_peek') &&
            typeof (resolvedArgs as any).fileId === 'string'
          ) {
            const filePathRaw = typeof (resolvedArgs as any).filePath === 'string' ? String((resolvedArgs as any).filePath) : '';
            if (!filePathRaw.trim()) {
              const fileId = String((resolvedArgs as any).fileId);
              const resolvedPath = this.fileHandles.resolveFileId(session, fileId);
              if (!resolvedPath) {
                return {
                  success: false,
                  error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
                  metadata: { errorCode: TOOL_ERROR_CODES.unknown_file_id, fileId },
                };
              }
              resolvedArgs = { ...resolvedArgs, filePath: resolvedPath };
            }
          }

          if (isRecord(resolvedArgs) && def.id === 'symbols_peek') {
            const symbolId = typeof (resolvedArgs as any).symbolId === 'string' ? String((resolvedArgs as any).symbolId) : '';
            const matchId = typeof (resolvedArgs as any).matchId === 'string' ? String((resolvedArgs as any).matchId) : '';
            const locId = typeof (resolvedArgs as any).locId === 'string' ? String((resolvedArgs as any).locId) : '';

            const handleId = symbolId.trim() || matchId.trim() || locId.trim();
            if (handleId) {
              const handle =
                symbolId.trim()
                  ? semanticHandles.resolveSymbol(handleId)
                  : matchId.trim()
                    ? semanticHandles.resolveMatch(handleId)
                    : semanticHandles.resolveLocation(handleId);

              if (!handle) {
                const errorCode = symbolId.trim()
                  ? TOOL_ERROR_CODES.unknown_symbol_id
                  : matchId.trim()
                    ? TOOL_ERROR_CODES.unknown_match_id
                    : TOOL_ERROR_CODES.unknown_loc_id;
                return {
                  success: false,
                  error:
                    `${errorCode}: ${handleId}. Re-run symbols_search (for symbolId) or grep (for matchId) and use the returned handle.`,
                  metadata: { errorCode, handleId },
                };
              }

              const fileId = handle.fileId;
              const filePath = this.fileHandles.resolveFileId(session, fileId);
              if (!filePath) {
                return {
                  success: false,
                  error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
                  metadata: { errorCode: TOOL_ERROR_CODES.unknown_file_id, fileId },
                };
              }

              const line = handle.range.start.line;
              const character = handle.range.start.character;

              resolvedArgs = {
                ...resolvedArgs,
                fileId,
                filePath,
                line,
                character,
              };
            }
          }

          const tc = toToolCall(callId, toolName, resolvedArgs);

          const permission = this.getPermissionName(def);

	          if (mode === 'plan') {
	            const allowNonReadOnlyInPlan = def.id === 'task' || def.id === 'todowrite';
	            if (!def.metadata?.readOnly && !allowNonReadOnlyInPlan) {
	              const reason = 'Tool is disabled in Plan mode. Switch to Build mode to use it.';
	              invokeCallbackSafely(callbacks?.onToolBlocked, { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug }, tc, def, reason);
	              return { success: false, error: reason };
	            }
	          }

          const patterns = this.getPermissionPatterns(def, resolvedArgs);
          const ruleset = this.getPermissionRuleset(mode);

          let permissionAction: PermissionAction = 'allow';
          for (const pattern of patterns) {
            const rule = evaluatePermission(permission, pattern, ruleset);
            const action = rule?.action ?? 'ask';
            permissionAction = this.combinePermissionActions(permissionAction, action);
          }

	          if (permissionAction === 'deny') {
	            const reason = mode === 'plan' ? 'Tool is disabled in Plan mode. Switch to Build mode to use it.' : 'Tool is denied by permissions.';
	            invokeCallbackSafely(callbacks?.onToolBlocked, { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug }, tc, def, reason);
	            return { success: false, error: reason };
	          }

          let requiresApproval = permissionAction === 'ask' || !!def.metadata?.requiresApproval;
          const dotEnvApprovalTargets = collectDotEnvApprovalTargets(def, resolvedArgs);
          if (dotEnvApprovalTargets.length > 0) {
            requiresApproval = true;
          }

          const isShellExecutionTool = def.id === 'bash' || def.execution?.type === 'shell';

          const workspaceRoot = this.workspaceRoot;
          if (isShellExecutionTool && !this.allowExternalPaths && workspaceRoot) {
            const cwdRaw =
              typeof resolvedArgs?.workdir === 'string'
                ? resolvedArgs.workdir
                : def.execution?.type === 'shell' && typeof (def.execution as any).cwd === 'string'
                  ? String((def.execution as any).cwd)
                  : '';

            const cwd =
              cwdRaw && cwdRaw.trim()
                ? path.isAbsolute(cwdRaw.trim())
                  ? path.resolve(cwdRaw.trim())
                  : path.resolve(workspaceRoot, cwdRaw.trim())
                : workspaceRoot;

            const commandText =
              typeof resolvedArgs?.command === 'string'
                ? resolvedArgs.command
                : def.execution?.type === 'shell' && typeof (def.execution as any).script === 'string'
                  ? String((def.execution as any).script)
                  : undefined;

            const externalRefs = new Set<string>();
            if (!isPathInsideWorkspace(cwd, workspaceRoot)) {
              externalRefs.add(cwd);
            }
            if (typeof commandText === 'string' && commandText.trim()) {
              for (const p of findExternalPathReferencesInShellCommand(commandText, { cwd, workspaceRoot })) {
                externalRefs.add(p);
              }
            }

	            if (externalRefs.size > 0) {
	              const reason =
	                'External paths are disabled. This shell command references paths outside the current workspace. Enable allowExternalPaths to allow external path access.';
	              invokeCallbackSafely(callbacks?.onToolBlocked, { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug }, tc, def, reason);
	              const blockedPaths = [...externalRefs];
	              const blockedPathsMax = 20;
              return {
                success: false,
                error: reason,
                metadata: {
                  errorCode: TOOL_ERROR_CODES.external_paths_disabled,
                  blockedSettingKey: 'lingyun.security.allowExternalPaths',
                  isOutsideWorkspace: true,
                  blockedPaths: blockedPaths.slice(0, blockedPathsMax),
                  blockedPathsTruncated: blockedPaths.length > blockedPathsMax,
                },
              };
            }
          }

          const commandForSafety =
            typeof resolvedArgs?.command === 'string'
              ? resolvedArgs.command
              : def.execution?.type === 'shell' && typeof (def.execution as any).script === 'string'
                ? String((def.execution as any).script)
                : undefined;

	          if (isShellExecutionTool && typeof commandForSafety === 'string') {
	            const safety = evaluateShellCommand(commandForSafety);
	            if (safety.verdict === 'deny') {
	              const reason = `Blocked command: ${safety.reason}`;
	              invokeCallbackSafely(callbacks?.onToolBlocked, { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug }, tc, def, reason);
	              return { success: false, error: reason };
	            }
	            if (safety.verdict === 'needs_approval') {
              requiresApproval = true;
            }
          }

	          const externalPaths = this.getExternalPathPatterns(def, resolvedArgs);
	          if (externalPaths.length > 0 && !this.allowExternalPaths) {
	            const reason = 'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.';
	            invokeCallbackSafely(callbacks?.onToolBlocked, { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug }, tc, def, reason);
            return {
	              success: false,
	              error: reason,
              metadata: {
                errorCode: TOOL_ERROR_CODES.external_paths_disabled,
                blockedSettingKey: 'lingyun.security.allowExternalPaths',
                isOutsideWorkspace: true,
              },
            };
          }

          // permission.ask plugin hook
          {
            const permissionDecision = await this.plugins.trigger(
              'permission.ask',
              {
                tool: toolName,
                sessionId,
                callId,
                patterns,
                metadata: {
                  mode,
                  requiresApproval,
                  permission,
                },
              },
              { status: requiresApproval ? 'ask' : 'allow' }
            );

	            if ((permissionDecision as any)?.status === 'deny') {
	              const reason = 'Tool is denied by a plugin permission hook.';
	              invokeCallbackSafely(callbacks?.onToolBlocked, { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug }, tc, def, reason);
	              return { success: false, error: reason };
	            }

            if ((permissionDecision as any)?.status === 'allow') {
              requiresApproval = false;
            }

            if ((permissionDecision as any)?.status === 'ask') {
              requiresApproval = true;
            }
          }

	          const allowAutoApprove = mode !== 'plan' && !!this.config.autoApprove;
	          if (requiresApproval && !allowAutoApprove) {
	            let approved = false;
	            try {
	              approved = (await callbacks?.onRequestApproval?.(tc, def)) ?? false;
	            } catch (error) {
	              invokeCallbackSafely(
	                callbacks?.onDebug,
	                { label: 'onRequestApproval error' },
	                `[Callbacks] onRequestApproval threw (${error instanceof Error ? error.name : typeof error})`,
	              );
	              approved = false;
	            }
	            if (!approved) {
	              return { success: false, error: 'User rejected this action' };
	            }
	          }

          const ctx = this.createToolContext(options.abortSignal, session, callbacks);
          let result = await this.registry.executeTool(def.id, resolvedArgs ?? {}, ctx);

          const fileHandleProvider = {
            getOrCreate: (filePath: string): FileHandleLike => this.fileHandles.getOrCreate(session, filePath),
          };

          if (def.id === 'glob') {
            result = this.fileHandles.decorateGlobResult(session, result);
          }
          if (def.id === 'grep') {
            result = this.fileHandles.decorateGrepResult(session, result, semanticHandles);
          }
          if (def.id === 'symbols_search') {
            result = semanticHandles.decorateSymbolsSearchResult(result, fileHandleProvider);
          }
          if (def.id === 'symbols_peek') {
            result = semanticHandles.decorateSymbolsPeekResult(result, fileHandleProvider);
          }

          // tool.execute.after
          {
            const baseText = await this.formatToolResult(result, def.name);
            const output = await this.plugins.trigger(
              'tool.execute.after',
              { tool: toolName, sessionId, callId },
              {
                title: def.name,
                output: baseText,
                metadata: isRecord(result.metadata) ? { ...result.metadata } : {},
              }
            );

            const mergedMeta: Record<string, unknown> = {
              ...(isRecord(result.metadata) ? result.metadata : {}),
              ...(isRecord((output as any).metadata) ? (output as any).metadata : {}),
            };

            if (typeof (output as any).title === 'string' && (output as any).title.trim()) {
              mergedMeta.title = (output as any).title;
            }
            if (typeof (output as any).output === 'string') {
              mergedMeta.outputText = (output as any).output;
            }

            result = { ...result, metadata: mergedMeta };
          }

          return result;
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

  private async compactSessionInternal(
    session: LingyunSession,
    params: { auto: boolean; modelId: string },
    callbacks?: AgentCallbacks
  ): Promise<void> {
    const maybeAwait = async (value: unknown) => {
      if (value && typeof (value as Promise<unknown>).then === 'function') {
        await value;
      }
    };

    const markerMessage = createUserHistoryMessage(COMPACTION_MARKER_TEXT, { synthetic: true, compaction: { auto: params.auto } });
    session.history.push(markerMessage);
    const markerIndex = session.history.length - 1;

    try {
      await maybeAwait(callbacks?.onCompactionStart?.({ auto: params.auto, markerMessageId: markerMessage.id }));
    } catch {
      // ignore
    }

    const abortController = new AbortController();
    const signal = abortController.signal;

    try {
      const compacting = await this.plugins.trigger(
        'experimental.session.compacting',
        { sessionId: session.sessionId ?? this.config.sessionId },
        { context: [] as string[], prompt: undefined as string | undefined }
      );

      const extraContext = Array.isArray((compacting as any).context) ? ((compacting as any).context as any[]).filter(Boolean) : [];
      const promptText =
        typeof (compacting as any).prompt === 'string' && (compacting as any).prompt.trim()
          ? (compacting as any).prompt
          : [COMPACTION_PROMPT_TEXT, ...extraContext].join('\n\n');

      const rawModel = await this.llm.getModel(params.modelId);
      const compactionModel = wrapLanguageModel({
        model: rawModel as any,
        middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
      });

      const effective = getEffectiveHistory(session.history);
      const prepared = createHistoryForCompactionPrompt(effective, this.compactionConfig);
      const withoutIds = prepared.map(({ id: _id, ...rest }: AgentHistoryMessage) => rest);

      const compactionUser = createUserHistoryMessage(promptText, { synthetic: true });
	      const convertedCompactionModelMessages = await convertToModelMessages(
	        [...withoutIds, compactionUser as any],
	        { tools: {} as any },
	      );
	      const compactionModelMessages = this.providerBehavior.transformModelMessages(
	        params.modelId,
	        convertedCompactionModelMessages,
	      );

      const stream = streamText({
        model: compactionModel as any,
        system: COMPACTION_SYSTEM_PROMPT,
        messages: compactionModelMessages,
        maxRetries: 0,
        temperature: 0.0,
        maxOutputTokens: this.getMaxOutputTokens(),
        abortSignal: signal,
      });

      const summaryTextRaw = await stream.text;
      const summaryUsage = await stream.usage;
      const finishReason = await stream.finishReason;
      const summaryText = stripThinkBlocks(String(summaryTextRaw || '')).trim();

      const summaryMessage = createAssistantHistoryMessage();
      const summaryTokens = extractUsageTokens(summaryUsage);
      summaryMessage.metadata = {
        mode: this.getMode(),
        finishReason,
        summary: true,
        ...(summaryTokens ? { tokens: summaryTokens } : {}),
      };
      if (summaryText) {
        summaryMessage.parts.push({ type: 'text', text: summaryText, state: 'done' });
      }
      session.history.push(summaryMessage);

      if (params.auto) {
        session.history.push(createUserHistoryMessage(COMPACTION_AUTO_CONTINUE_TEXT, { synthetic: true }));
      }

      session.history = getEffectiveHistory(session.history);

      try {
        await maybeAwait(
          callbacks?.onCompactionEnd?.({
            auto: params.auto,
            markerMessageId: markerMessage.id,
            summaryMessageId: summaryMessage.id,
            status: 'done',
          })
        );
      } catch {
        // ignore
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /aborterror/i.test(message) || /aborted/i.test(message) ? 'canceled' : 'error';

      if (session.history[markerIndex]?.id === markerMessage.id) {
        session.history.splice(markerIndex, 1);
      }

      try {
        await maybeAwait(callbacks?.onCompactionEnd?.({ auto: params.auto, markerMessageId: markerMessage.id, status, error: message }));
      } catch {
        // ignore
      }

      throw error;
    }
  }

  private async runOnce(session: LingyunSession, callbacks?: AgentCallbacks, signal?: AbortSignal): Promise<string> {
    const modelId = (this.config.model || '').trim();
    if (!modelId) {
      throw new Error('No model configured');
    }

    await this.ensurePluginToolsRegistered();

    const mode = this.getMode();
    const sessionId = session.sessionId ?? this.config.sessionId;

    const semanticHandles = new SemanticHandleRegistry();
    semanticHandles.importState(session.semanticHandles);

    try {
      const rawModel = await this.llm.getModel(modelId);
      const model = wrapLanguageModel({
        model: rawModel as any,
        middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
      });

      const systemParts = await this.composeSystemPrompt(modelId, { signal });
      const tools = this.filterTools(await this.registry.getTools());
      const toolNameToDefinition = new Map<string, ToolDefinition>();

      const callbacksSafe = callbacks;

	      const callParams = await this.plugins.trigger(
	        'chat.params',
        {
          sessionId,
          mode,
          modelId,
          message: (() => {
            const lastUserMessage = [...session.history].reverse().find((msg) => msg.role === 'user');
            return lastUserMessage ? getMessageText(lastUserMessage) : undefined;
          })(),
        },
	        {
	          temperature: this.config.temperature ?? 0.0,
	          topP: undefined,
	          topK: undefined,
	          options: this.providerBehavior.getChatProviderOptions(modelId, { copilotReasoningEffort: this.copilotReasoningEffort }),
	        }
	      );

      let lastResponse = '';

      const maxIterations = 50;
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        await invokeCallbackSafely(callbacksSafe?.onIterationStart, {
          label: `onIterationStart iteration=${iteration}`,
          onDebug: callbacksSafe?.onDebug,
        }, iteration);
        invokeCallbackSafely(callbacksSafe?.onThinking, { label: 'onThinking', onDebug: callbacksSafe?.onDebug });

        const abortController = new AbortController();
        const combined = signal ? combineAbortSignals([signal, abortController.signal]) : abortController.signal;

        const aiTools = this.createAISDKTools(tools, mode, session, semanticHandles, callbacksSafe, toolNameToDefinition);
        const modelMessages = await this.toModelMessages(session, aiTools, modelId);
        const promptMessages: ModelMessage[] = [
          ...systemParts.map((text) => ({ role: 'system', content: text } as any)),
          ...modelMessages,
        ];

        let assistantMessage = createAssistantHistoryMessage();
	        let attemptText = '';
	        let attemptReasoning = '';
	        let streamFinishReason: string | undefined;
	        let streamUsage: unknown;
	        let streamReplayUpdates: StreamReplayUpdate[] = [];

	        const maxRetries = Math.max(0, Math.floor(this.config.maxRetries ?? 0));
	        let retryAttempt = 0;

	        while (true) {
          assistantMessage = createAssistantHistoryMessage();
	          attemptText = '';
	          attemptReasoning = '';
	          streamFinishReason = undefined;
	          streamUsage = undefined;
	          streamReplayUpdates = [];

	          let sawToolCall = false;
	          let sawFinishPart = false;

	          try {
	            const streamAdapter = this.providerBehavior.createStreamAdapter(modelId);
	            const stream = streamText({
	              model: model as any,
	              messages: promptMessages,
	              tools: aiTools as any,
              maxRetries: 0,
              temperature: (callParams as any).temperature,
              topP: (callParams as any).topP,
              topK: (callParams as any).topK,
              ...((callParams as any).options ? { providerOptions: (callParams as any).options } : {}),
              maxOutputTokens: this.getMaxOutputTokens(),
	              abortSignal: combined,
	            });

	            for await (const part of stream.fullStream as AsyncIterable<TextStreamPart<any>>) {
	              streamAdapter.onPart(part);
	              switch (part.type) {
                case 'text-delta': {
	                  invokeCallbackSafely(callbacksSafe?.onToken, { label: 'onToken', onDebug: callbacksSafe?.onDebug }, part.text);
	                  attemptText += part.text;
                  invokeCallbackSafely(callbacksSafe?.onAssistantToken, { label: 'onAssistantToken', onDebug: callbacksSafe?.onDebug }, part.text);
                  break;
                }
                case 'reasoning-delta': {
                  attemptReasoning += part.text;
                  invokeCallbackSafely(callbacksSafe?.onThoughtToken, { label: 'onThoughtToken', onDebug: callbacksSafe?.onDebug }, part.text);
                  break;
                }
                case 'tool-call': {
                  sawToolCall = true;
                  const toolName = String(part.toolName);
                  const toolCallId = String(part.toolCallId);

		                  const def = toolNameToDefinition.get(toolName);
		                  if (def) {
		                    invokeCallbackSafely(
		                      callbacksSafe?.onStatusChange,
		                      { label: 'onStatusChange', onDebug: callbacksSafe?.onDebug },
		                      { type: 'running', message: '' },
		                    );
		                    invokeCallbackSafely(
		                      callbacksSafe?.onToolCall,
		                      { label: `onToolCall tool=${def.id}`, onDebug: callbacksSafe?.onDebug },
		                      toToolCall(toolCallId, toolName, part.input),
	                      def,
	                    );
	                  }

                  upsertDynamicToolCall(assistantMessage, {
                    toolName,
                    toolCallId,
                    input: part.input,
                  });
                  break;
                }
                case 'tool-result': {
                  const toolName = String(part.toolName);
                  const toolCallId = String(part.toolCallId);
                  const def = toolNameToDefinition.get(toolName);
                  const toolLabel = def?.name || toolName;

                  const rawOutput = part.output as any;
                  let output = await this.pruneToolResultForHistory(rawOutput, toolLabel);

                  const isTaskTool = def?.id === 'task' || toolName === 'task';
                  if (isTaskTool && output.metadata && typeof output.metadata === 'object') {
                    // Do not persist child session snapshots inside the parent session history.
                    const meta = { ...(output.metadata as Record<string, unknown>) };
                    delete (meta as any).childSession;
                    delete (meta as any).task;
                    output = { ...output, metadata: meta };
                  }
                  setDynamicToolOutput(assistantMessage, {
                    toolName,
                    toolCallId,
                    input: part.input,
                    output,
                  });

	                  const tc = toToolCall(toolCallId, toolName, part.input);
	                  if (isTaskTool && rawOutput && typeof rawOutput === 'object' && typeof rawOutput.success === 'boolean') {
	                    invokeCallbackSafely(
	                      callbacksSafe?.onToolResult,
	                      { label: `onToolResult tool=${def?.id || toolName}`, onDebug: callbacksSafe?.onDebug },
	                      tc,
	                      rawOutput as ToolResult,
	                    );
	                  } else {
	                    invokeCallbackSafely(
	                      callbacksSafe?.onToolResult,
	                      { label: `onToolResult tool=${def?.id || toolName}`, onDebug: callbacksSafe?.onDebug },
	                      tc,
	                      output,
	                    );
	                  }
	                  invokeCallbackSafely(
	                    callbacksSafe?.onStatusChange,
	                    { label: 'onStatusChange', onDebug: callbacksSafe?.onDebug },
	                    { type: 'running', message: '' },
	                  );
	                  break;
	                }
                case 'tool-error': {
                  const toolName = String(part.toolName);
                  const toolCallId = String(part.toolCallId);
                  const def = toolNameToDefinition.get(toolName);
                  const errorText = part.error instanceof Error ? part.error.message : String(part.error);

                  setDynamicToolError(assistantMessage, {
                    toolName,
                    toolCallId,
                    input: part.input,
                    errorText,
                  });

	                  const tc = toToolCall(toolCallId, toolName, part.input);
	                  invokeCallbackSafely(
	                    callbacksSafe?.onToolResult,
	                    { label: `onToolResult tool=${def?.id || toolName}`, onDebug: callbacksSafe?.onDebug },
	                    tc,
	                    { success: false, error: errorText },
	                  );
	                  break;
		                }
	                case 'finish-step': {
	                  sawFinishPart = true;
	                  break;
	                }
	                case 'finish': {
	                  sawFinishPart = true;
	                  break;
                }
	                case 'error':
	                  {
	                    if (streamAdapter.shouldIgnoreError(part.error, { sawFinishPart, attemptText })) {
	                      break;
	                    }
	                  }
	                  throw part.error;
	                default:
                  break;
              }
            }

	            streamFinishReason = await stream.finishReason;
	            streamUsage = await stream.usage;
	            streamReplayUpdates = streamAdapter.getReplayUpdates();
	            break;
	          } catch (e) {
	            const retryable = getRetryableLlmError(e);
	            const canRetry =
              !!retryable && retryAttempt < maxRetries && !sawToolCall && !attemptText.trim() && !combined.aborted;
	            if (canRetry) {
	              retryAttempt += 1;
	              const waitMs = getRetryDelayMs(retryAttempt, retryable.retryAfterMs);
	              invokeCallbackSafely(
	                callbacksSafe?.onStatusChange,
	                { label: 'onStatusChange', onDebug: callbacksSafe?.onDebug },
	                {
	                  type: 'retry',
	                  attempt: retryAttempt,
	                  nextRetryTime: Date.now() + waitMs,
	                  message: retryable.message,
	                },
	              );
	              await retrySleep(waitMs, combined).catch(() => {});
	              continue;
	            }

            if (retryable) {
              const wrapped = new Error(retryable.message);
              (wrapped as any).cause = e;
              if (!combined.aborted) {
                try {
                  this.llm.onRequestError?.(e, { modelId, mode });
                } catch {
                  // ignore
                }
              }
              throw wrapped;
            }

            if (!combined.aborted) {
              try {
                this.llm.onRequestError?.(e, { modelId, mode });
              } catch {
                // ignore
              }
            }
            throw e;
          }
	        }

		        const tokens = extractUsageTokens(streamUsage);
		        const replay = buildStreamReplay({ text: attemptText, reasoning: attemptReasoning, updates: streamReplayUpdates });

		        assistantMessage.metadata = {
		          mode: this.getMode(),
	          finishReason: streamFinishReason,
	          replay,
          ...(tokens ? { tokens } : {}),
        };

        const cleanedText = stripToolBlocks(stripThinkBlocks(attemptText)).trim();
        assistantMessage.parts = assistantMessage.parts.filter((p: any) => p.type !== 'text' && p.type !== 'reasoning');

        let finalText = cleanedText;
        if (!finalText && mode === 'plan' && attemptReasoning.trim()) {
          finalText = extractPlanFromReasoning(attemptReasoning) ?? '';
        }
        if (finalText) {
          const textOutput = await this.plugins.trigger(
            'experimental.text.complete',
            { sessionId, messageId: assistantMessage.id },
            { text: finalText }
          );
          finalText = typeof (textOutput as any).text === 'string' ? (textOutput as any).text : finalText;
        }

        if (finalText) {
          assistantMessage.parts.unshift({ type: 'text', text: finalText, state: 'streaming' });
        }
        if (attemptReasoning.trim()) {
          assistantMessage.parts.unshift({ type: 'reasoning', text: attemptReasoning, state: 'streaming' });
        }

        finalizeStreamingParts(assistantMessage);
        session.history.push(assistantMessage);

        const lastAssistantText = getMessageText(assistantMessage).trim();
        lastResponse = lastAssistantText || lastResponse;

        if (this.compactionConfig.prune && this.compactionConfig.toolOutputMode === 'afterToolCall') {
          markPreviousAssistantToolOutputs(session.history);
        }
        await invokeCallbackSafely(callbacksSafe?.onIterationEnd, {
          label: `onIterationEnd iteration=${iteration}`,
          onDebug: callbacksSafe?.onDebug,
        }, iteration);

        const modelLimit = this.getModelLimit(modelId);
        const reservedOutputTokens = getReservedOutputTokens({ modelLimit, maxOutputTokens: this.getMaxOutputTokens() });

        if (
          streamFinishReason === 'tool-calls' &&
          isContextOverflow({
            lastTokens: assistantMessage.metadata?.tokens,
            modelLimit,
            reservedOutputTokens,
            config: this.compactionConfig,
          })
        ) {
          await this.compactSessionInternal(session, { auto: true, modelId }, callbacksSafe);
          continue;
        }

        const hasToolParts = assistantMessage.parts.some((part: any) => part.type === 'dynamic-tool');
        if (streamFinishReason === 'tool-calls' || hasToolParts) continue;

        await this.plugins.trigger(
          'experimental.chat.complete',
          {
            sessionId,
            mode,
            modelId,
            messageId: assistantMessage.id,
            assistantText: lastAssistantText,
            returnedText: lastResponse,
          },
          {},
        );

        invokeCallbackSafely(callbacksSafe?.onComplete, { label: 'onComplete', onDebug: callbacksSafe?.onDebug }, lastResponse);
        return lastResponse;
      }

      invokeCallbackSafely(callbacksSafe?.onComplete, { label: 'onComplete', onDebug: callbacksSafe?.onDebug }, lastResponse);
      return lastResponse;
    } finally {
      session.semanticHandles = semanticHandles.exportState();
    }
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
