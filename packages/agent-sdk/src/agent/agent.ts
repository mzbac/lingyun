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
  createAssistantHistoryMessage,
  createHistoryForModel,
  createUserHistoryMessage,
  evaluatePermission,
  evaluateShellCommand,
  extractUsageTokens,
  finalizeStreamingParts,
  findExternalPathReferencesInShellCommand,
  getEffectiveHistory,
  getMessageText,
  getReservedOutputTokens,
  isOverflow as isContextOverflow,
  isPathInsideWorkspace,
  markPrunableToolOutputs,
  setDynamicToolError,
  setDynamicToolOutput,
  upsertDynamicToolCall,
  type AgentHistoryMessage,
  type CompactionConfig,
  type ModelLimit,
  type PermissionAction,
  type PermissionRuleset,
} from '@kooka/core';
import { PluginManager } from '../plugins/pluginManager.js';
import { insertModeReminders } from './reminders.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { EDIT_TOOL_IDS, MAX_TOOL_RESULT_LENGTH, THINK_BLOCK_REGEX, TOOL_BLOCK_REGEX } from './constants.js';
import { delay as getRetryDelayMs, retryable as getRetryableLlmError, sleep as retrySleep } from './retry.js';
import type { ToolRegistry } from '../tools/registry.js';

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

function stripThinkBlocks(content: string): string {
  return content.replace(THINK_BLOCK_REGEX, '');
}

function stripToolBlocks(content: string): string {
  return content.replace(TOOL_BLOCK_REGEX, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toToolCall(toolCallId: string, toolName: string, input: unknown): ToolCall {
  let args = '{}';
  try {
    args = JSON.stringify(input ?? {});
  } catch {
    args = '{}';
  }

  return {
    id: toolCallId,
    type: 'function',
    function: {
      name: toolName,
      arguments: args,
    },
  };
}

export class LingyunSession {
  history: AgentHistoryMessage[] = [];
  pendingPlan?: string;
  sessionId?: string;
  fileHandles?: {
    nextId: number;
    byId: Record<string, string>;
  };

  constructor(init?: Partial<Pick<LingyunSession, 'history' | 'pendingPlan' | 'sessionId' | 'fileHandles'>>) {
    if (init?.history) this.history = [...init.history];
    if (init?.pendingPlan) this.pendingPlan = init.pendingPlan;
    if (init?.sessionId) this.sessionId = init.sessionId;
    if (init?.fileHandles) this.fileHandles = init.fileHandles;
  }

  getHistory(): AgentHistoryMessage[] {
    return [...this.history];
  }
}

export type LingyunAgentRuntimeOptions = {
  plugins?: PluginManager;
  workspaceRoot?: string;
  allowExternalPaths?: boolean;
  modelLimits?: Record<string, ModelLimit>;
  compaction?: Partial<CompactionConfig>;
};

export class LingyunAgent {
  private readonly plugins: PluginManager;
  private readonly workspaceRoot?: string;
  private allowExternalPaths: boolean;
  private readonly modelLimits?: Record<string, ModelLimit>;
  private readonly compactionConfig: CompactionConfig;
  private registeredPluginTools = new Set<string>();

  constructor(
    private readonly llm: LLMProvider,
    private config: AgentConfig,
    private readonly registry: ToolRegistry,
    runtime?: LingyunAgentRuntimeOptions
  ) {
    this.plugins = runtime?.plugins ?? new PluginManager({ workspaceRoot: runtime?.workspaceRoot });
    this.workspaceRoot = runtime?.workspaceRoot ? path.resolve(runtime.workspaceRoot) : undefined;
    this.allowExternalPaths = !!runtime?.allowExternalPaths;
    this.modelLimits = runtime?.modelLimits;

    const baseCompaction: CompactionConfig = {
      auto: true,
      prune: true,
      pruneProtectTokens: 40_000,
      pruneMinimumTokens: 20_000,
    };
    const c = runtime?.compaction ?? {};
    this.compactionConfig = {
      auto: c.auto ?? baseCompaction.auto,
      prune: c.prune ?? baseCompaction.prune,
      pruneProtectTokens: Math.max(0, c.pruneProtectTokens ?? baseCompaction.pruneProtectTokens),
      pruneMinimumTokens: Math.max(0, c.pruneMinimumTokens ?? baseCompaction.pruneMinimumTokens),
    };
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setAllowExternalPaths(allow: boolean): void {
    this.allowExternalPaths = !!allow;
  }

  private getMode(): 'build' | 'plan' {
    return this.config.mode === 'plan' ? 'plan' : 'build';
  }

  private getModelLimit(modelId: string): ModelLimit | undefined {
    return this.modelLimits?.[modelId];
  }

  private getPermissionRuleset(mode: 'build' | 'plan'): PermissionRuleset {
    if (mode === 'plan') {
      return [
        { permission: '*', pattern: '*', action: 'ask' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'list', pattern: '*', action: 'allow' },
        { permission: 'glob', pattern: '*', action: 'allow' },
        { permission: 'grep', pattern: '*', action: 'allow' },
        { permission: 'edit', pattern: '*', action: 'deny' },
      ];
    }

    return [{ permission: '*', pattern: '*', action: 'allow' }];
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
    const entries = await this.plugins.getPluginTools();
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
    const reminded = insertModeReminders(prepared, this.getMode());
    const withoutIds = reminded.map(({ id: _id, ...rest }) => rest);

    const messagesOutput = await this.plugins.trigger(
      'experimental.chat.messages.transform',
      { sessionId: session.sessionId ?? this.config.sessionId, mode: this.getMode(), modelId },
      { messages: [...withoutIds] as unknown[] }
    );

    const messages = Array.isArray((messagesOutput as any).messages) ? (messagesOutput as any).messages : withoutIds;
    return convertToModelMessages(messages as any, { tools: tools as any });
  }

  private createToolContext(signal: AbortSignal, session: LingyunSession, callbacks?: AgentCallbacks) {
    return {
      workspaceRoot: this.workspaceRoot,
      allowExternalPaths: this.allowExternalPaths,
      sessionId: session.sessionId ?? this.config.sessionId,
      signal,
      log: (message: string) => callbacks?.onDebug?.(message),
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

  private normalizeFileHandlePath(raw: string): string {
    const value = raw.trim();
    if (!value) return '';

    const workspaceRoot = this.workspaceRoot;
    if (!workspaceRoot) return value;

    try {
      const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
      const rel = path.relative(workspaceRoot, abs);
      if (rel && rel !== '.' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.replace(/\\/g, '/');
      }
      return abs;
    } catch {
      return value;
    }
  }

  private ensureFileHandles(session: LingyunSession): NonNullable<LingyunSession['fileHandles']> {
    if (!session.fileHandles) {
      session.fileHandles = { nextId: 1, byId: {} };
      return session.fileHandles;
    }

    const nextId = (session.fileHandles as any).nextId;
    const byId = (session.fileHandles as any).byId;
    if (typeof nextId !== 'number' || !Number.isFinite(nextId) || nextId < 1 || !byId || typeof byId !== 'object') {
      session.fileHandles = { nextId: 1, byId: {} };
      return session.fileHandles;
    }

    return session.fileHandles;
  }

  private resolveFileHandle(session: LingyunSession, fileId: string): string | undefined {
    const id = fileId.trim();
    if (!id) return undefined;

    const handles = this.ensureFileHandles(session);
    const resolved = handles.byId[id];
    return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : undefined;
  }

  private getOrCreateFileHandle(session: LingyunSession, filePath: string): { id: string; filePath: string } {
    const normalizedPath = this.normalizeFileHandlePath(filePath);
    if (!normalizedPath) {
      return { id: 'F0', filePath: filePath.trim() };
    }

    const handles = this.ensureFileHandles(session);

    for (const [existingId, existingPath] of Object.entries(handles.byId)) {
      if (existingPath === normalizedPath) {
        return { id: existingId, filePath: normalizedPath };
      }
    }

    const id = `F${handles.nextId++}`;
    handles.byId[id] = normalizedPath;
    return { id, filePath: normalizedPath };
  }

  private decorateGlobResultWithFileHandles(session: LingyunSession, result: ToolResult): ToolResult {
    if (!result.success) return result;

    const data = result.data;
    if (!isRecord(data)) return result;

    const filesRaw = (data as any).files;
    if (!Array.isArray(filesRaw)) return result;

    const files = filesRaw
      .filter((value: unknown): value is string => typeof value === 'string')
      .map((value: string) => value.trim())
      .filter(Boolean);

    const notesRaw = (data as any).notes;
    const notes = Array.isArray(notesRaw)
      ? notesRaw.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim()).filter(Boolean)
      : [];

    const truncated = Boolean((data as any).truncated);

    const lines: string[] = [];
    if (notes.length > 0) {
      lines.push(`Note: ${notes.join(' ')}`, '');
    }

    if (files.length === 0) {
      lines.push('No files found');
    } else {
      lines.push('Use fileId with read/write:', '');
      for (const filePath of files) {
        const handle = this.getOrCreateFileHandle(session, filePath);
        lines.push(`${handle.id}  ${handle.filePath}`);
      }
      if (truncated) {
        lines.push('', '(Results are truncated. Consider using a more specific path or pattern.)');
      }
    }

    return {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        outputText: lines.join('\n').trimEnd(),
      },
    };
  }

  private createAISDKTools(
    tools: ToolDefinition[],
    mode: 'build' | 'plan',
    session: LingyunSession,
    callbacks: AgentCallbacks | undefined,
    toolNameToDefinition: Map<string, ToolDefinition>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const def of tools) {
      const toolName = def.id;
      toolNameToDefinition.set(toolName, def);

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
            (def.id === 'read' || def.id === 'write') &&
            typeof (resolvedArgs as any).fileId === 'string'
          ) {
            const filePathRaw = typeof (resolvedArgs as any).filePath === 'string' ? String((resolvedArgs as any).filePath) : '';
            if (!filePathRaw.trim()) {
              const fileId = String((resolvedArgs as any).fileId);
              const resolvedPath = this.resolveFileHandle(session, fileId);
              if (!resolvedPath) {
                return {
                  success: false,
                  error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
                  metadata: { errorType: 'unknown_file_id', fileId },
                };
              }
              resolvedArgs = { ...resolvedArgs, filePath: resolvedPath };
            }
          }

          const tc = toToolCall(callId, toolName, resolvedArgs);

          const permission = this.getPermissionName(def);
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
            callbacks?.onToolBlocked?.(tc, def, reason);
            return { success: false, error: reason };
          }

          let requiresApproval = permissionAction === 'ask' || !!def.metadata?.requiresApproval;

          const isShellExecutionTool =
            def.id === 'bash' || def.id === 'shell.run' || def.id === 'shell.terminal' || def.execution?.type === 'shell';

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
              callbacks?.onToolBlocked?.(tc, def, reason);
              const blockedPaths = [...externalRefs];
              const blockedPathsMax = 20;
              return {
                success: false,
                error: reason,
                metadata: {
                  errorType: 'external_paths_disabled',
                  blockedSettingKey: 'allowExternalPaths',
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
              callbacks?.onToolBlocked?.(tc, def, reason);
              return { success: false, error: reason };
            }
            if (safety.verdict === 'needs_approval') {
              requiresApproval = true;
            }
          }

          const externalPaths = this.getExternalPathPatterns(def, resolvedArgs);
          if (externalPaths.length > 0 && !this.allowExternalPaths) {
            const reason = 'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.';
            callbacks?.onToolBlocked?.(tc, def, reason);
            return {
              success: false,
              error: reason,
              metadata: {
                errorType: 'external_paths_disabled',
                blockedSettingKey: 'allowExternalPaths',
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
              callbacks?.onToolBlocked?.(tc, def, reason);
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
            const approved = (await callbacks?.onRequestApproval?.(tc, def)) ?? false;
            if (!approved) {
              return { success: false, error: 'User rejected this action' };
            }
          }

          const ctx = this.createToolContext(options.abortSignal, session, callbacks);
          let result = await this.registry.executeTool(def.id, resolvedArgs ?? {}, ctx);

          if (def.id === 'glob') {
            result = this.decorateGlobResultWithFileHandles(session, result);
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

  private composeSystemPrompt(modelId: string): Promise<string[]> {
    const basePrompt = this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    return this.plugins
      .trigger(
        'experimental.chat.system.transform',
        { sessionId: this.config.sessionId, mode: this.getMode(), modelId },
        { system: [basePrompt] }
      )
      .then((out) => (Array.isArray((out as any).system) ? (out as any).system.filter(Boolean) : [basePrompt]));
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
      const prepared = createHistoryForModel(effective);
      const withoutIds = prepared.map(({ id: _id, ...rest }: AgentHistoryMessage) => rest);

      const compactionUser = createUserHistoryMessage(promptText, { synthetic: true });
      const compactionModelMessages = await convertToModelMessages([...withoutIds, compactionUser as any], { tools: {} as any });

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

    const rawModel = await this.llm.getModel(modelId);
    const model = wrapLanguageModel({
      model: rawModel as any,
      middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
    });

    const systemParts = await this.composeSystemPrompt(modelId);
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
        options: undefined,
      }
    );

    let lastResponse = '';

    const maxIterations = 50;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      await Promise.resolve(callbacksSafe?.onIterationStart?.(iteration));

      const abortController = new AbortController();
      const combined = signal ? combineAbortSignals([signal, abortController.signal]) : abortController.signal;

      const aiTools = this.createAISDKTools(tools, mode, session, callbacksSafe, toolNameToDefinition);
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

      const maxRetries = Math.max(0, Math.floor(this.config.maxRetries ?? 0));
      let retryAttempt = 0;

      while (true) {
        assistantMessage = createAssistantHistoryMessage();
        attemptText = '';
        attemptReasoning = '';
        streamFinishReason = undefined;
        streamUsage = undefined;

        let sawToolCall = false;

        try {
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
            switch (part.type) {
              case 'text-delta': {
                callbacksSafe?.onToken?.(part.text);
                attemptText += part.text;
                callbacksSafe?.onAssistantToken?.(part.text);
                break;
              }
              case 'reasoning-delta': {
                attemptReasoning += part.text;
                callbacksSafe?.onThoughtToken?.(part.text);
                break;
              }
              case 'tool-call': {
                sawToolCall = true;
                const toolName = String(part.toolName);
                const toolCallId = String(part.toolCallId);

                const def = toolNameToDefinition.get(toolName);
                if (def) {
                  callbacksSafe?.onStatusChange?.({ type: 'running', message: '' });
                  callbacksSafe?.onToolCall?.(toToolCall(toolCallId, toolName, part.input), def);
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

                const output = await this.pruneToolResultForHistory(part.output, toolLabel);
                setDynamicToolOutput(assistantMessage, {
                  toolName,
                  toolCallId,
                  input: part.input,
                  output,
                });

                const tc = toToolCall(toolCallId, toolName, part.input);
                callbacksSafe?.onToolResult?.(tc, output);
                callbacksSafe?.onStatusChange?.({ type: 'running', message: '' });
                break;
              }
              case 'tool-error': {
                const toolName = String(part.toolName);
                const toolCallId = String(part.toolCallId);
                const errorText = part.error instanceof Error ? part.error.message : String(part.error);

                setDynamicToolError(assistantMessage, {
                  toolName,
                  toolCallId,
                  input: part.input,
                  errorText,
                });

                const tc = toToolCall(toolCallId, toolName, part.input);
                callbacksSafe?.onToolResult?.(tc, { success: false, error: errorText });
                break;
              }
              case 'error':
                throw part.error;
              default:
                break;
            }
          }

          streamFinishReason = await stream.finishReason;
          streamUsage = await stream.usage;
          break;
        } catch (e) {
          const retryable = getRetryableLlmError(e);
          const canRetry =
            !!retryable && retryAttempt < maxRetries && !sawToolCall && !attemptText.trim() && !combined.aborted;
          if (canRetry) {
            retryAttempt += 1;
            const waitMs = getRetryDelayMs(retryAttempt, retryable.retryAfterMs);
            callbacksSafe?.onStatusChange?.({
              type: 'retry',
              attempt: retryAttempt,
              nextRetryTime: Date.now() + waitMs,
              message: retryable.message,
            });
            await retrySleep(waitMs, combined).catch(() => {});
            continue;
          }

          if (retryable) {
            const wrapped = new Error(retryable.message);
            (wrapped as any).cause = e;
            throw wrapped;
          }
          throw e;
        }
      }

      const tokens = extractUsageTokens(streamUsage);
      assistantMessage.metadata = {
        mode: this.getMode(),
        finishReason: streamFinishReason,
        ...(tokens ? { tokens } : {}),
      };

      const cleanedText = stripToolBlocks(stripThinkBlocks(attemptText)).trim();
      assistantMessage.parts = assistantMessage.parts.filter((p: any) => p.type !== 'text' && p.type !== 'reasoning');

      let finalText = cleanedText;
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

      finalizeStreamingParts(assistantMessage);
      session.history.push(assistantMessage);

      const lastAssistantText = getMessageText(assistantMessage).trim();
      lastResponse = lastAssistantText || lastResponse;

      markPrunableToolOutputs(session.history, this.compactionConfig);
      await Promise.resolve(callbacksSafe?.onIterationEnd?.(iteration));

      const modelLimit = this.getModelLimit(modelId);
      const reservedOutputTokens = getReservedOutputTokens({ modelLimit, maxOutputTokens: this.getMaxOutputTokens() });

      if (
        streamFinishReason === 'tool-calls' &&
        isContextOverflow({ lastTokens: assistantMessage.metadata?.tokens, modelLimit, reservedOutputTokens, config: this.compactionConfig })
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

      callbacksSafe?.onComplete?.(lastResponse);
      return lastResponse;
    }

    callbacksSafe?.onComplete?.(lastResponse);
    return lastResponse;
  }

  run(params: { session: LingyunSession; input: string; callbacks?: AgentCallbacks; signal?: AbortSignal }): LingyunRun {
    const queue = new AsyncQueue<LingyunEvent>();

    const callbacks = params.callbacks;
    const proxy: AgentCallbacks = {
      ...callbacks,
      onDebug: (message) => {
        callbacks?.onDebug?.(message);
        queue.push({ type: 'debug', message });
      },
      onStatusChange: (status) => {
        callbacks?.onStatusChange?.(status);
        queue.push({ type: 'status', status: status as any });
      },
      onAssistantToken: (token) => {
        callbacks?.onAssistantToken?.(token);
        queue.push({ type: 'assistant_token', token });
      },
      onThoughtToken: (token) => {
        callbacks?.onThoughtToken?.(token);
        queue.push({ type: 'thought_token', token });
      },
      onToolCall: (tool, definition) => {
        callbacks?.onToolCall?.(tool, definition);
        queue.push({ type: 'tool_call', tool, definition });
      },
      onToolBlocked: (tool, definition, reason) => {
        callbacks?.onToolBlocked?.(tool, definition, reason);
        queue.push({ type: 'tool_blocked', tool, definition, reason });
      },
      onToolResult: (tool, result) => {
        callbacks?.onToolResult?.(tool, result);
        queue.push({ type: 'tool_result', tool, result });
      },
      onCompactionStart: (event) => {
        callbacks?.onCompactionStart?.(event);
        queue.push({ type: 'compaction_start', auto: event.auto, markerMessageId: event.markerMessageId });
      },
      onCompactionEnd: (event) => {
        callbacks?.onCompactionEnd?.(event);
        queue.push({
          type: 'compaction_end',
          auto: event.auto,
          markerMessageId: event.markerMessageId,
          summaryMessageId: event.summaryMessageId,
          status: event.status,
          error: event.error,
        });
      },
    };

    const done = (async () => {
      try {
        params.session.history.push(createUserHistoryMessage(params.input));
        const text = await this.runOnce(params.session, proxy, params.signal);
        queue.push({ type: 'status', status: { type: 'done', message: '' } as any });
        queue.close();
        return { text, session: params.session };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        callbacks?.onError?.(err);
        queue.push({ type: 'status', status: { type: 'error', message: err.message } as any });
        queue.fail(err);
        throw err;
      }
    })();

    return { events: queue, done };
  }
}
