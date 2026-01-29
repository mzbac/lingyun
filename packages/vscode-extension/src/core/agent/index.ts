import * as vscode from 'vscode';
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
import type {
  ToolDefinition,
  ToolContext,
  ToolResult,
  AgentConfig,
  AgentCallbacks,
  LLMProvider,
} from '../types';
import type { ToolRegistry } from '../registry';
import { toolRegistry as defaultToolRegistry } from '../registry';
import { findGitRoot, loadInstructions } from '../instructions';
import {
  COMPACTION_AUTO_CONTINUE_TEXT,
  COMPACTION_MARKER_TEXT,
  COMPACTION_PROMPT_TEXT,
  COMPACTION_SYSTEM_PROMPT,
  createHistoryForCompactionPrompt,
  createHistoryForModel,
  extractUsageTokens,
  getCompactionConfig,
  getMemoryFlushConfig,
  getEffectiveHistory,
  getModelLimit,
  getReservedOutputTokens,
  isOverflow as isContextOverflow,
  markPreviousAssistantToolOutputs,
} from '../compaction';
import {
  extractSkillMentions,
  type AgentHistoryMessage,
  createAssistantHistoryMessage,
  createUserHistoryMessage,
  listBuiltinSubagents,
  normalizeSessionId,
  redactFsPathForPrompt,
  renderSkillsSectionForPrompt,
  resolveBuiltinSubagent,
  finalizeStreamingParts,
  getMessageText,
  selectSkillsForText,
  setDynamicToolError,
  setDynamicToolOutput,
  upsertDynamicToolCall,
} from '@kooka/core';
import { isRecord } from '../utils/guards';
import { FileHandleRegistry, type FileHandlesState } from './fileHandles';
import { SemanticHandleRegistry, type SemanticHandlesState } from './semanticHandles';
import { toToolCall } from './toolCall';
import { createAISDKTools } from './aiSdkTools';

import { MAX_TOOL_RESULT_LENGTH, THINK_BLOCK_REGEX, TOOL_BLOCK_REGEX, getStatusForTool } from './constants';
import {
  hashJsonLines,
  sha256Hex,
  summarizeErrorForDebug,
  truncateForDebug,
} from './debug';
import { insertModeReminders } from './reminders';
import { DEFAULT_SYSTEM_PROMPT } from './prompts';
import { extractPlanFromReasoning } from './planExtract';
import { PluginManager } from '../hooks/pluginManager';
import { delay as getRetryDelayMs, retryable as getRetryableLlmError, sleep as retrySleep } from './retry';
import { generateSessionTitle as generateSessionTitleInternal } from '../sessionTitle';
import { getSkillIndex, loadSkillFile } from '../skills';

let cachedSkillsPromptTextPromise: Promise<string | undefined> | undefined;

async function getCachedSkillsPromptText(options: {
  extensionContext: vscode.ExtensionContext;
  workspaceRoot?: vscode.Uri;
}): Promise<string | undefined> {
  if (cachedSkillsPromptTextPromise) return cachedSkillsPromptTextPromise;

  const enabled =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
  if (!enabled) {
    cachedSkillsPromptTextPromise = Promise.resolve(undefined);
    return cachedSkillsPromptTextPromise;
  }

  const allowExternalPaths =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
  const searchPaths =
    vscode.workspace.getConfiguration('lingyun').get<string[]>('skills.paths', []) ?? [];
  const maxPromptSkillsRaw =
    vscode.workspace.getConfiguration('lingyun').get<number>('skills.maxPromptSkills', 50);
  const maxPromptSkills =
    Number.isFinite(maxPromptSkillsRaw as number) && (maxPromptSkillsRaw as number) >= 0
      ? Math.floor(maxPromptSkillsRaw as number)
      : 50;

  const workspaceRoot = options.workspaceRoot?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  cachedSkillsPromptTextPromise = getSkillIndex({
    extensionContext: options.extensionContext,
    workspaceRoot,
    searchPaths,
    allowExternalPaths,
    watchWorkspace: true,
  })
    .then((index) =>
      renderSkillsSectionForPrompt({
        skills: index.skills,
        maxSkills: maxPromptSkills,
        workspaceRoot,
      }),
    )
    .catch(() => undefined);

  return cachedSkillsPromptTextPromise;
}

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\/+$/, '') || '/';
  const parent = path.posix.dirname(normalized);
  if (parent === normalized) return uri;
  return uri.with({ path: parent });
}

function stripThinkBlocks(content: string): string {
  return content.replace(THINK_BLOCK_REGEX, '');
}

function stripToolBlocks(content: string): string {
  return content.replace(TOOL_BLOCK_REGEX, '');
}

export type AgentSessionState = {
  history: AgentHistoryMessage[];
  pendingPlan?: string;
  fileHandles?: FileHandlesState;
  semanticHandles?: SemanticHandlesState;
  mentionedSkills?: string[];
};

export class AgentLoop {
  private history: AgentHistoryMessage[] = [];
  private aborted = false;
  private _running = false;
  private activeCancellations: vscode.CancellationTokenSource[] = [];
  private activeAbortController?: AbortController;
  private pendingPlan?: string;
  private instructionsText?: string;
  private instructionsKey?: string;
  private skillsPromptText?: string;
  private mentionedSkills = new Set<string>();
  private readonly plugins: PluginManager;
  private readonly fileHandles = new FileHandleRegistry(
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  );
  private readonly semanticHandles = new SemanticHandleRegistry();

  constructor(
    private llm: LLMProvider,
    private context: vscode.ExtensionContext,
    private config: AgentConfig = {},
    private registry: ToolRegistry = defaultToolRegistry,
    plugins?: PluginManager,
  ) {
    this.plugins = plugins ?? new PluginManager(context);
  }

  private buildProviderOptions(options: Record<string, unknown> | undefined, modelId: string): Record<string, unknown> | undefined {
    let resolved = options;

    // Copilot (OpenAI-compatible) supports `reasoning_effort` / `text_verbosity` via providerOptions.
    // Only apply to GPT-5 family models by default, and only when not explicitly set by plugins.
    if (this.llm.id === 'copilot') {
      const configuredEffortRaw =
        vscode.workspace.getConfiguration('lingyun').get<string>('copilot.reasoningEffort', 'xhigh') ?? '';
      const configuredEffort = configuredEffortRaw.trim();
      const isGpt5 = /^gpt-5([.-]|$)/i.test(modelId);

      if (configuredEffort && isGpt5) {
        const merged: Record<string, unknown> = { ...(resolved ?? {}) };
        const existingCopilot = merged['copilot'];
        const copilotOptions: Record<string, unknown> = isRecord(existingCopilot) ? { ...existingCopilot } : {};
        if (copilotOptions['reasoningEffort'] === undefined) {
          copilotOptions['reasoningEffort'] = configuredEffort;
        }
        merged['copilot'] = copilotOptions;
        resolved = merged;
      }
    }

    return resolved;
  }

  private getMode(): 'build' | 'plan' {
    return this.config.mode === 'plan' ? 'plan' : 'build';
  }

  private composeSystemPrompt(_mode: 'build' | 'plan'): string[] {
    const basePrompt = this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const parts = [basePrompt];
    if (this.instructionsText) {
      parts.push(this.instructionsText);
    }
    if (this.skillsPromptText) {
      parts.push(this.skillsPromptText);
    }
    return parts;
  }

  private getWorkspaceRootForContext(): vscode.Uri | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const workspaceFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    return workspaceFolder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private async injectSkillsForUserText(text: string): Promise<void> {
    const enabled =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
    if (!enabled) return;

    const mentions = extractSkillMentions(text);
    if (mentions.length === 0) return;

    const allowExternalPaths =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
    const searchPaths =
      vscode.workspace.getConfiguration('lingyun').get<string[]>('skills.paths', []) ?? [];

    const maxInjectCharsRaw =
      vscode.workspace.getConfiguration('lingyun').get<number>('skills.maxInjectChars', 20000);
    const maxInjectChars =
      Number.isFinite(maxInjectCharsRaw as number) && (maxInjectCharsRaw as number) > 0
        ? Math.floor(maxInjectCharsRaw as number)
        : 20000;

    const workspaceRoot = this.getWorkspaceRootForContext()?.fsPath;
    let index: Awaited<ReturnType<typeof getSkillIndex>>;
    try {
      index = await getSkillIndex({
        extensionContext: this.context,
        workspaceRoot,
        searchPaths,
        allowExternalPaths,
        watchWorkspace: true,
      });
    } catch {
      return;
    }

    const { selected } = selectSkillsForText(text, index);
    if (selected.length === 0) return;

    const maxInjectSkillsRaw =
      vscode.workspace.getConfiguration('lingyun').get<number>('skills.maxInjectSkills', 5);
    const maxInjectSkills =
      Number.isFinite(maxInjectSkillsRaw as number) && (maxInjectSkillsRaw as number) > 0
        ? Math.floor(maxInjectSkillsRaw as number)
        : 5;

    const selectedForInject = selected.slice(0, maxInjectSkills);
    const activeLabel = selectedForInject.map((s) => `$${s.name}`).join(', ');

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
      this.mentionedSkills.add(skill.name);
      let body: string;
      try {
        body = (await loadSkillFile(skill)).content;
      } catch {
        continue;
      }

      let truncated = false;
      if (body.length > maxInjectChars) {
        body = body.slice(0, maxInjectChars);
        truncated = true;
      }

      blocks.push(
        [
          '<skill>',
          `<name>${skill.name}</name>`,
          `<path>${redactFsPathForPrompt(skill.filePath, { workspaceRoot })}</path>`,
          body.trimEnd(),
          truncated ? '\n\n... [TRUNCATED]' : '',
          '</skill>',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    if (blocks.length > 0) {
      this.history.push(createUserHistoryMessage(blocks.join('\n\n'), { synthetic: true, skill: true }));
    }
  }

  private stripTurnSkillMessages(): void {
    this.history = this.history.filter((msg) => !(msg.role === 'user' && msg.metadata?.skill));
  }

  private async refreshInstructions(): Promise<void> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const workspaceRoot = this.getWorkspaceRootForContext();
    const startDir = activeUri ? dirnameUri(activeUri) : (workspaceRoot ?? vscode.Uri.file(process.cwd()));
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

    this.skillsPromptText = await getCachedSkillsPromptText({
      extensionContext: this.context,
      workspaceRoot,
    });
  }

  exportState(): AgentSessionState {
    return {
      history: this.history.filter((msg) => !(msg.role === 'user' && msg.metadata?.skill)),
      pendingPlan: this.pendingPlan,
      fileHandles: this.fileHandles.exportState(),
      semanticHandles: this.semanticHandles.exportState(),
      mentionedSkills: [...this.mentionedSkills],
    };
  }

  resolveFileId(fileId: string): string | undefined {
    return this.fileHandles.resolve(fileId);
  }

  importState(state: AgentSessionState): void {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    this.disposeAllCancellations();
    this.aborted = false;
    this.pendingPlan = state.pendingPlan;
    this.history = [...(state.history || [])];
    this.mentionedSkills = new Set(Array.isArray(state.mentionedSkills) ? state.mentionedSkills : []);
    this.fileHandles.importState(state.fileHandles);
    this.semanticHandles.importState(state.semanticHandles);
    // The system prompt is rebuilt dynamically; refresh project instructions for the current editor/workspace.
    this.instructionsKey = undefined;
  }

  get running(): boolean {
    return this._running;
  }

  async plan(task: string, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    const previousMode = this.getMode();
    if (previousMode !== 'plan') {
      this.config = { ...this.config, mode: 'plan' };
    }

    this._running = true;
    this.aborted = false;
    this.pendingPlan = undefined;

    await this.refreshInstructions();

    const planningSystem = this.composeSystemPrompt(this.getMode());
    await this.injectSkillsForUserText(task);
    this.history.push(createUserHistoryMessage(task));

    try {
      const plan = (await this.loop(planningSystem, callbacks)).trim();
      this.pendingPlan = plan;
      return plan;
    } finally {
      this.stripTurnSkillMessages();
      this._running = false;
      this.disposeAllCancellations();
      if (previousMode !== 'plan') {
        this.config = { ...this.config, mode: previousMode };
      }
    }
  }

  async execute(callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.history.length === 0) {
      throw new Error('No active task. Call plan() or run() first.');
    }

    this._running = true;
    this.aborted = false;

    try {
      if (this.pendingPlan) {
        this.history.push(createUserHistoryMessage(`## Approved Plan\n${this.pendingPlan}`, { synthetic: true }));
        this.pendingPlan = undefined;
      }

      await this.refreshInstructions();
      return await this.loop(this.composeSystemPrompt(this.getMode()), callbacks);
    } finally {
      this._running = false;
      this.disposeAllCancellations();
    }
  }

  async run(task: string, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    this._running = true;
    this.aborted = false;
    this.history = [];
    this.fileHandles.reset();
    this.semanticHandles.reset();

    await this.refreshInstructions();

    await this.injectSkillsForUserText(task);
    this.history.push(createUserHistoryMessage(task));

    try {
      return await this.loop(this.composeSystemPrompt(this.getMode()), callbacks);
    } finally {
      this.stripTurnSkillMessages();
      this._running = false;
      this.disposeAllCancellations();
    }
  }

  async continue(message: string, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    this._running = true;
    this.aborted = false;
    this.pendingPlan = undefined;
    await this.refreshInstructions();

    await this.injectSkillsForUserText(message);
    this.history.push(createUserHistoryMessage(message));

    try {
      return await this.loop(this.composeSystemPrompt(this.getMode()), callbacks);
    } finally {
      this.stripTurnSkillMessages();
      this._running = false;
      this.disposeAllCancellations();
    }
  }

  async resume(callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.history.length === 0) {
      throw new Error('No active task to resume. Start a task first.');
    }

    this._running = true;
    this.aborted = false;

    try {
      await this.refreshInstructions();
      return await this.loop(this.composeSystemPrompt(this.getMode()), callbacks);
    } finally {
      this._running = false;
      this.disposeAllCancellations();
    }
  }

  async compactSession(): Promise<void> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    if (this.history.length === 0) return;

    const modelId = this.config.model;
    if (!modelId) {
      throw new Error('No model configured. Set lingyun.model.');
    }

    this._running = true;
    this.aborted = false;

    try {
      await this.compactSessionInternal({ auto: false, modelId });
    } finally {
      this._running = false;
      this.disposeAllCancellations();
    }
  }

  private async loop(baseSystem: string[], callbacks?: AgentCallbacks): Promise<string> {
    let lastResponse = '';

    const maybeAwait = async (value: unknown) => {
      if (value && typeof (value as Promise<unknown>).then === 'function') {
        await value;
      }
    };

    for (let iteration = 0; !this.aborted; iteration++) {
      await maybeAwait(callbacks?.onIterationStart?.(iteration));
      callbacks?.onThinking?.();
      const lingyunConfig = vscode.workspace.getConfiguration('lingyun');
      const debugLlmEnabled = lingyunConfig.get<boolean>('debug.llm') ?? false;
      const debugToolsEnabled = lingyunConfig.get<boolean>('debug.tools') ?? false;

      const modelId = this.config.model;
      if (!modelId) {
        await maybeAwait(callbacks?.onIterationEnd?.(iteration));
        throw new Error('No model configured. Set lingyun.model.');
      }

      const rawModel = await this.llm.getModel(modelId);
      const model = wrapLanguageModel({
        model: rawModel as any,
        middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
      });

      const allTools = await this.registry.getTools();
      const toolFilterAllowed = this.filterTools(allTools);
      const modeAllowed = this.filterToolsForMode(toolFilterAllowed);

      const sessionId = this.config.sessionId;
      const mode = this.getMode();

      const toolNameToDefinition = new Map<string, ToolDefinition>();
      const tools = createAISDKTools({
        tools: modeAllowed,
        mode,
        callbacks,
        toolNameToDefinition,
        getConfig: () => this.config,
        registry: this.registry,
        plugins: this.plugins,
        fileHandles: this.fileHandles,
        semanticHandles: this.semanticHandles,
        createToolContext: this.createToolContext.bind(this),
        formatToolResult: this.formatToolResult.bind(this),
      });

      const taskDef = toolNameToDefinition.get('task');
      if (taskDef) {
        (tools as any).task = aiTool({
          id: 'task' as any,
          description: taskDef.description,
          inputSchema: jsonSchema(taskDef.parameters as any),
          execute: async (args: any, options: any) => {
            const resolvedArgs: any = args ?? {};

            if (this.config.parentSessionId || this.config.subagentType) {
              return {
                success: false,
                error: 'Subagents cannot spawn other subagents via task.',
                metadata: { errorType: 'task_recursion_denied' },
              };
            }

            const parentMode = this.getMode();

            const descriptionRaw = typeof resolvedArgs.description === 'string' ? resolvedArgs.description.trim() : '';
            const promptRaw = typeof resolvedArgs.prompt === 'string' ? resolvedArgs.prompt : '';
            const subagentTypeRaw =
              typeof resolvedArgs.subagent_type === 'string' ? resolvedArgs.subagent_type.trim() : '';
            const sessionIdRaw = typeof resolvedArgs.session_id === 'string' ? resolvedArgs.session_id.trim() : '';
            const requestedSessionId = normalizeSessionId(sessionIdRaw) || '';

            if (!descriptionRaw) return { success: false, error: 'Missing required argument: description' };
            if (!promptRaw) return { success: false, error: 'Missing required argument: prompt' };
            if (!subagentTypeRaw) return { success: false, error: 'Missing required argument: subagent_type' };

            const subagent = resolveBuiltinSubagent(subagentTypeRaw);
            if (!subagent) {
              const names = listBuiltinSubagents().map((a) => a.name).join(', ');
              return {
                success: false,
                error: `Unknown subagent_type: ${subagentTypeRaw}. Available: ${names || '(none)'}`,
                metadata: { errorType: 'unknown_subagent_type', subagentType: subagentTypeRaw },
              };
            }

            if (parentMode === 'plan' && subagent.name !== 'explore') {
              return {
                success: false,
                error: 'Only the explore subagent is allowed in Plan mode.',
                metadata: { errorType: 'subagent_denied_in_plan', subagentType: subagent.name },
              };
            }

            const parentSessionId = this.config.sessionId;
            const childSessionId = requestedSessionId || crypto.randomUUID();
            const now = Date.now();

            // Best-effort: load existing child session state from persisted sessions when session_id is provided.
            let existingMessages: any[] = [];
            let existingAgentState: AgentSessionState | undefined;
            let existingCreatedAt: number | undefined;
            let existingCurrentModel: string | undefined;
            if (requestedSessionId) {
              try {
                const baseUri = this.context.storageUri ?? this.context.globalStorageUri;
                if (baseUri) {
                  const sessionUri = vscode.Uri.joinPath(baseUri, 'sessions', `${childSessionId}.json`);
                  const bytes = await vscode.workspace.fs.readFile(sessionUri);
                  const raw = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                  if (raw && typeof raw === 'object') {
                    if (Array.isArray((raw as any).messages)) {
                      existingMessages = (raw as any).messages;
                    }
                    if ((raw as any).agentState && typeof (raw as any).agentState === 'object') {
                      existingAgentState = (raw as any).agentState as AgentSessionState;
                    }
                    if (typeof (raw as any).createdAt === 'number') {
                      existingCreatedAt = (raw as any).createdAt;
                    }
                    if (typeof (raw as any).currentModel === 'string' && String((raw as any).currentModel).trim()) {
                      existingCurrentModel = String((raw as any).currentModel).trim();
                    }
                  }
                }
              } catch {
                // ignore missing/invalid persisted sessions
              }
            }

            const parentModelId = this.config.model;
            if (!parentModelId) {
              return {
                success: false,
                error: 'No model configured. Set lingyun.model.',
                metadata: { errorType: 'missing_model' },
              };
            }

            const configuredSubagentModel =
              typeof this.config.subagentModel === 'string' ? this.config.subagentModel.trim() : '';

            const desiredChildModelId = existingCurrentModel || configuredSubagentModel || parentModelId;
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
                callbacks?.onDebug?.(
                  `[Task] subagent model fallback requested=${desiredChildModelId} using=${parentModelId} error=${summarizeErrorForDebug(error)}`,
                );
                childModelId = parentModelId;
              }
            }

            const basePrompt = this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
            const childAgent = new AgentLoop(
              this.llm,
              this.context,
              {
                model: childModelId,
                mode: 'build',
                temperature: this.config.temperature,
                maxRetries: this.config.maxRetries,
                toolFilter: subagent.toolFilter?.length ? subagent.toolFilter : undefined,
                autoApprove: this.config.autoApprove,
                systemPrompt: `${basePrompt}\n\n${subagent.prompt}`,
                sessionId: childSessionId,
                parentSessionId,
                subagentType: subagent.name,
              },
              this.registry,
              this.plugins,
            );

            if (existingAgentState) {
              try {
                childAgent.importState(existingAgentState);
              } catch {
                // ignore invalid saved state; start fresh
              }
            }

            const childMessages: any[] = Array.isArray(existingMessages) ? [...existingMessages] : [];
            const turnId = crypto.randomUUID();

            childMessages.push({
              id: turnId,
              role: 'user',
              content: promptRaw,
              timestamp: now,
            });

            let assistantMsg: any | undefined;
            const toolSummary = new Map<
              string,
              { id: string; tool: string; status: 'running' | 'success' | 'error' }
            >();

            const childCallbacks: AgentCallbacks = {
              onRequestApproval: async (tc, def) => {
                return (await callbacks?.onRequestApproval?.(tc, def)) ?? false;
              },
              onToolCall: async (tc, def) => {
                toolSummary.set(tc.id, { id: tc.id, tool: def.id, status: 'running' });
                if (def.metadata?.requiresApproval) {
                  await callbacks?.onToolCall?.(tc, def);
                }

                childMessages.push({
                  id: crypto.randomUUID(),
                  role: 'tool',
                  content: '',
                  timestamp: Date.now(),
                  turnId,
                  toolCall: {
                    id: def.id,
                    name: def.name,
                    args: tc.function.arguments,
                    status: 'running',
                    approvalId: tc.id,
                  },
                });
              },
              onToolResult: (tc, result) => {
                const def = toolNameToDefinition.get(tc.function.name);
                if (def?.metadata?.requiresApproval) {
                  callbacks?.onToolResult?.(tc, result);
                }

                const summary = toolSummary.get(tc.id);
                toolSummary.set(tc.id, {
                  id: tc.id,
                  tool: summary?.tool ?? tc.function.name,
                  status: result.success ? 'success' : 'error',
                });

                const toolMsg = [...childMessages]
                  .reverse()
                  .find((m) => m?.role === 'tool' && m?.toolCall?.approvalId === tc.id);
                if (toolMsg?.toolCall) {
                  toolMsg.toolCall.status = result.success ? 'success' : 'error';
                  let resultStr = '';
                  if (result.data === undefined || result.data === null) {
                    resultStr = result.error || (result.success ? 'Done' : 'No data');
                  } else if (typeof result.data === 'string') {
                    resultStr = result.data;
                  } else {
                    resultStr = JSON.stringify(result.data, null, 2);
                  }
                  toolMsg.toolCall.result = resultStr.substring(0, 4000);
                }
              },
              onAssistantToken: (token) => {
                if (!token) return;
                if (!assistantMsg) {
                  assistantMsg = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: '',
                    timestamp: Date.now(),
                    turnId,
                  };
                  childMessages.push(assistantMsg);
                }
                assistantMsg.content += token;
              },
            };

            const text = existingAgentState
              ? await childAgent.continue(promptRaw, childCallbacks)
              : await childAgent.run(promptRaw, childCallbacks);

            const title = `${descriptionRaw} (@${subagent.name} subagent)`;
            const outputText =
              text.trimEnd() + '\n\n' + ['<task_metadata>', `session_id: ${childSessionId}`, '</task_metadata>'].join('\n');

            const summary = [...toolSummary.values()].sort((a, b) => a.id.localeCompare(b.id));

            return {
              success: true,
              data: {
                session_id: childSessionId,
                subagent_type: subagent.name,
                text,
              },
              metadata: {
                title,
                outputText,
                task: {
                  description: descriptionRaw,
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
                  id: childSessionId,
                  title,
                  createdAt: existingCreatedAt ?? now,
                  updatedAt: Date.now(),
                  messages: childMessages,
                  agentState: childAgent.exportState(),
                  currentModel: childModelId,
                  mode: 'build',
                  stepCounter: 0,
                },
              },
            };
          },
          toModelOutput: async (options: any) => {
            const output = options.output as ToolResult;
            const content = await this.formatToolResult(output, taskDef.name);
            return { type: 'text', value: content };
          },
        });
      }

      const abortController = new AbortController();
      this.activeAbortController = abortController;

      // Let plugins customize the system prompt in a way that preserves caching.
      let systemParts = [...baseSystem];
      const systemHeader = systemParts[0];
      const originalSystem = [...systemParts];
      const systemOutput = await this.plugins.trigger(
        'experimental.chat.system.transform',
        { sessionId, mode, modelId },
        { system: systemParts },
      );
      systemParts = Array.isArray(systemOutput.system) ? systemOutput.system : systemParts;
      if (systemParts.length === 0) systemParts = originalSystem;
      if (systemParts.length > 2 && systemParts[0] === systemHeader) {
        const rest = systemParts.slice(1);
        systemParts = [systemHeader, rest.join('\n')];
      }
      if (systemParts.length === 0) {
        systemParts = [''];
      }

      const modelMessages = await this.toModelMessages(tools, modelId);
      const promptMessages: ModelMessage[] = [
        ...systemParts.map(text => ({ role: 'system', content: text } as any)),
        ...modelMessages,
      ];
      if (debugLlmEnabled) {
        try {
          const systemHash = sha256Hex(JSON.stringify(systemParts));
          const systemBytes = Buffer.byteLength(systemParts.join('\n'), 'utf8');
          const { sha256: messagesHash, bytes: messagesBytes } = hashJsonLines(promptMessages as any);

          const toolSignature = modeAllowed
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(def => ({
              id: def.id,
              description: def.description,
              parameters: def.parameters,
              metadata: {
                permission: def.metadata?.permission,
                requiresApproval: !!def.metadata?.requiresApproval,
                readOnly: def.metadata?.readOnly !== false,
              },
            }));
          const { sha256: toolsHash, bytes: toolsBytes } = hashJsonLines(toolSignature);

          const requestHash = sha256Hex(
            JSON.stringify({
              mode: this.getMode(),
              modelId,
              temperature: this.config.temperature ?? 0.0,
              maxOutputTokens: this.getMaxOutputTokens(),
              maxRetries: this.config.maxRetries ?? 0,
              systemHash,
              messagesHash,
              toolsHash,
            })
          );

          const short = (value: string) => value.slice(0, 12);
          callbacks?.onDebug?.(
            [
              `[LLM] iter=${iteration} mode=${this.getMode()} model=${modelId} temp=${String(this.config.temperature ?? 0.0)} maxOutput=${String(this.getMaxOutputTokens())}`,
              `  system sha=${short(systemHash)} bytes=${systemBytes}`,
              `  messages sha=${short(messagesHash)} count=${modelMessages.length} bytes=${messagesBytes}`,
              `  tools sha=${short(toolsHash)} count=${modeAllowed.length} bytes=${toolsBytes}`,
              `  request sha=${short(requestHash)}`,
            ].join('\n')
          );
        } catch (e) {
          callbacks?.onDebug?.(`[LLM] fingerprint failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const lastUserMessage = [...this.history].reverse().find(msg => msg.role === 'user');
      const callParams = await this.plugins.trigger(
        'chat.params',
        {
          sessionId,
          mode,
          modelId,
          message: lastUserMessage ? getMessageText(lastUserMessage) : undefined,
        },
        {
          temperature: this.config.temperature ?? 0.0,
          topP: undefined,
          topK: undefined,
          options: undefined,
        },
      );

      const providerOptions = this.buildProviderOptions(callParams.options, modelId);

      let assistantMessage = createAssistantHistoryMessage();
      let attemptText = '';
      let attemptReasoning = '';
      let reasoningChunks = 0;
      let reasoningWhitespaceChunks = 0;
      let textChunks = 0;
      let sawThinkTagInTextDelta = false;
      let streamFinishReason: string | undefined;
      let streamUsage: unknown;

      const maxRetries = Math.max(0, Math.floor(this.config.maxRetries ?? 0));
      let retryAttempt = 0;
      try {
        while (!this.aborted) {
          assistantMessage = createAssistantHistoryMessage();
          attemptText = '';
          attemptReasoning = '';
          reasoningChunks = 0;
          reasoningWhitespaceChunks = 0;
          textChunks = 0;
          sawThinkTagInTextDelta = false;
          streamFinishReason = undefined;
          streamUsage = undefined;

          let sawToolCall = false;
          let streamError: unknown;
          const streamStartedAt = Date.now();
          let lastStreamPartAt = streamStartedAt;
          let firstStreamPartAt: number | undefined;
          let streamParts = 0;

          try {
            const stream = streamText({
              model: model as any,
              messages: promptMessages,
              tools: tools as any,
              maxRetries: this.config.maxRetries ?? 0,
              temperature: callParams.temperature,
              topP: callParams.topP,
              topK: callParams.topK,
              ...(providerOptions ? { providerOptions: providerOptions as any } : {}),
              maxOutputTokens: this.getMaxOutputTokens(),
              abortSignal: abortController.signal,
            });

            for await (const part of stream.fullStream as AsyncIterable<TextStreamPart<any>>) {
              if (this.aborted) break;

              streamParts += 1;
              lastStreamPartAt = Date.now();
              if (!firstStreamPartAt) firstStreamPartAt = lastStreamPartAt;

              switch (part.type) {
                case 'text-delta': {
                  textChunks += 1;
                  if (!sawThinkTagInTextDelta && part.text.includes('<think')) {
                    sawThinkTagInTextDelta = true;
                  }
                  callbacks?.onToken?.(part.text);
                  attemptText += part.text;
                  callbacks?.onAssistantToken?.(part.text);
                  break;
                }
                case 'reasoning-delta': {
                  reasoningChunks += 1;
                  if (!part.text.trim()) reasoningWhitespaceChunks += 1;
                  attemptReasoning += part.text;
                  callbacks?.onThoughtToken?.(part.text);
                  break;
                }
                case 'tool-call': {
                  sawToolCall = true;
                  const toolName = String(part.toolName);
                  const toolCallId = String(part.toolCallId);
                  upsertDynamicToolCall(assistantMessage, { toolName, toolCallId, input: part.input });

                  const def = toolNameToDefinition.get(toolName);
                  if (def) {
                    const tc = toToolCall(toolCallId, toolName, part.input);
                    const status = getStatusForTool(def.id, 'executing');
                    callbacks?.onStatusChange?.({ type: 'running', message: status });
                    await callbacks?.onToolCall?.(tc, def);
                  } else if (debugToolsEnabled) {
                    callbacks?.onDebug?.(`[Tool] unknown tool=${toolName} call=${toolCallId}`);
                  }
                  break;
                }
                case 'tool-result': {
                  const toolName = String(part.toolName);
                  const toolCallId = String(part.toolCallId);
                  const def = toolNameToDefinition.get(toolName);
                  const rawOutput = part.output as any;
                  let output = await this.pruneToolResultForHistory(rawOutput, def?.name ?? toolName);

                  const isTaskTool = def?.id === 'task' || toolName === 'task';
                  if (isTaskTool && output.metadata && typeof output.metadata === 'object') {
                    // Do not persist child session snapshots inside the main session history.
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
                    callbacks?.onToolResult?.(tc, rawOutput as ToolResult);
                  } else {
                    callbacks?.onToolResult?.(tc, output);
                  }
                  callbacks?.onStatusChange?.({ type: 'running', message: '' });
                  break;
                }
                case 'tool-error': {
                  const toolName = String(part.toolName);
                  const toolCallId = String(part.toolCallId);
                  const errorText = part.error instanceof Error ? part.error.message : String(part.error);
                  if (debugToolsEnabled) {
                    const errorType = part.error instanceof Error ? part.error.constructor.name : 'UnknownError';
                    callbacks?.onDebug?.(
                      `[Tool] error tool=${toolName} call=${toolCallId} ${errorType}: ${truncateForDebug(errorText, 500)}`,
                    );
                  }

                  setDynamicToolError(assistantMessage, {
                    toolName,
                    toolCallId,
                    input: part.input,
                    errorText,
                  });

                  const tc = toToolCall(toolCallId, toolName, part.input);
                  callbacks?.onToolResult?.(tc, { success: false, error: errorText });
                  break;
                }
                case 'error':
                  streamError = part.error;
                  break;
                default:
                  break;
              }

              if (streamError) break;
            }

            if (streamError) {
              throw streamError;
            }

            if (this.aborted) {
              throw new Error('Agent aborted');
            }

            streamFinishReason = await stream.finishReason;
            streamUsage = await stream.usage;
            break; // success
	          } catch (e) {
	            const retryable = getRetryableLlmError(e);
	            const canRetry =
	              !!retryable &&
	              retryAttempt < maxRetries &&
              !sawToolCall &&
              !attemptText.trim() &&
              !abortController.signal.aborted &&
              !this.aborted;
            if (
              canRetry
            ) {
              retryAttempt += 1;
              const waitMs = getRetryDelayMs(retryAttempt, retryable.retryAfterMs);
              callbacks?.onStatusChange?.({
                type: 'retry',
                attempt: retryAttempt,
                nextRetryTime: Date.now() + waitMs,
                message: retryable.message,
              });
              await retrySleep(waitMs, abortController.signal).catch(() => {});
              continue;
            }

            if (debugLlmEnabled) {
              const now = Date.now();
              const elapsedMs = now - streamStartedAt;
              const idleMs = now - lastStreamPartAt;
              const firstChunkMs = firstStreamPartAt ? firstStreamPartAt - streamStartedAt : -1;
              const receivedChars = attemptText.length + attemptReasoning.length;
              callbacks?.onDebug?.(
                `[LLM] stream error retryable=${retryable ? retryable.message : 'no'} attempt=${String(retryAttempt)}/${String(maxRetries)} elapsedMs=${String(elapsedMs)} idleMs=${String(idleMs)} firstChunkMs=${String(firstChunkMs)} parts=${String(streamParts)} chars=${String(receivedChars)} ${summarizeErrorForDebug(e)}`.trim(),
              );
            }

	            if (retryable) {
	              const wrapped = new Error(retryable.message);
	              (wrapped as any).cause = e;
	              if (!abortController.signal.aborted && !this.aborted) {
	                try {
	                  this.llm.onRequestError?.(e, { modelId, mode: this.getMode() });
	                } catch {
	                  // ignore
	                }
	              }
	              throw wrapped;
	            }
	            if (!abortController.signal.aborted && !this.aborted) {
	              try {
	                this.llm.onRequestError?.(e, { modelId, mode: this.getMode() });
	              } catch {
	                // ignore
	              }
	            }
	            throw e;
	          }
	        }
	      } finally {
	        this.activeAbortController = undefined;
      }

      const tokens = extractUsageTokens(streamUsage);
      assistantMessage.metadata = {
        mode: this.getMode(),
        finishReason: streamFinishReason,
        ...(tokens ? { tokens } : {}),
      };
      if (debugLlmEnabled) {
        const reasoningChars = attemptReasoning.length;
        const reasoningNonWhitespaceChars = attemptReasoning.trim().length;
        const total = tokens?.total;
        const details = tokens
          ? `input=${String(tokens.input ?? 0)} output=${String(tokens.output ?? 0)} cacheRead=${String(tokens.cacheRead ?? 0)} cacheWrite=${String(tokens.cacheWrite ?? 0)} total=${String(total ?? 0)}`
          : 'usage=missing';
        callbacks?.onDebug?.(
          `[LLM] iter=${iteration} finish=${String(streamFinishReason || '')} ${details} textChunks=${String(textChunks)} reasoningChunks=${String(reasoningChunks)} reasoningWhitespaceChunks=${String(reasoningWhitespaceChunks)} reasoningChars=${String(reasoningChars)} reasoningNonWsChars=${String(reasoningNonWhitespaceChars)} sawThinkInTextDelta=${String(sawThinkTagInTextDelta)}`.trim(),
        );
      }

      const cleanedText = stripToolBlocks(stripThinkBlocks(attemptText)).trim();
      assistantMessage.parts = assistantMessage.parts.filter(p => p.type !== 'text' && p.type !== 'reasoning');

      let finalText = cleanedText;
      if (!finalText && this.getMode() === 'plan' && attemptReasoning.trim()) {
        finalText = extractPlanFromReasoning(attemptReasoning) ?? '';
      }

      if (finalText) {
        const textOutput = await this.plugins.trigger(
          'experimental.text.complete',
          { sessionId, messageId: assistantMessage.id },
          { text: finalText },
        );
        finalText = textOutput.text;
      }

      if (finalText) {
        assistantMessage.parts.unshift({ type: 'text', text: finalText, state: 'streaming' });
      }

      finalizeStreamingParts(assistantMessage);
      this.history.push(assistantMessage);

      const lastAssistantText = getMessageText(assistantMessage).trim();
      lastResponse = lastAssistantText || lastResponse;

      const compactionConfig = getCompactionConfig();
      if (compactionConfig.prune && compactionConfig.toolOutputMode === 'afterToolCall') {
        markPreviousAssistantToolOutputs(this.history);
      }
      await maybeAwait(callbacks?.onIterationEnd?.(iteration));

      const modelLimit = getModelLimit(modelId);
      const reservedOutputTokens = getReservedOutputTokens({
        modelLimit,
        maxOutputTokens: this.getMaxOutputTokens(),
      });

      if (
        streamFinishReason === 'tool-calls' &&
        isContextOverflow({
          lastTokens: assistantMessage.metadata?.tokens,
          modelLimit,
          reservedOutputTokens,
          config: compactionConfig,
        })
      ) {
        await this.compactSessionInternal({ auto: true, modelId }, callbacks);
        continue;
      }

      const hasToolParts = assistantMessage.parts.some((part) => part.type === 'dynamic-tool');
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

      callbacks?.onComplete?.(lastResponse);
      return lastResponse;
    }

    if (this.aborted) {
      throw new Error('Agent aborted');
    }

    callbacks?.onComplete?.(lastResponse);
    return lastResponse;
  }

  private async toModelMessages(tools: Record<string, unknown>, modelId: string): Promise<ModelMessage[]> {
    const effective = getEffectiveHistory(this.history);
    const prepared = createHistoryForModel(effective);
    const allowExternalPaths =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
    const reminded = insertModeReminders(prepared, this.getMode(), { allowExternalPaths });
    const withoutIds = reminded.map(({ id: _id, ...rest }) => rest);

    const messagesOutput = await this.plugins.trigger(
      'experimental.chat.messages.transform',
      { sessionId: this.config.sessionId, mode: this.getMode(), modelId },
      { messages: [...withoutIds] as unknown[] },
    );

    const messages = Array.isArray(messagesOutput.messages) ? messagesOutput.messages : withoutIds;
    return convertToModelMessages(messages as any, { tools: tools as any });
  }

	  private async compactSessionInternal(params: { auto: boolean; modelId: string }, callbacks?: AgentCallbacks): Promise<void> {
	    if (this.aborted) return;

	    const maybeAwait = async (value: unknown) => {
	      if (value && typeof (value as Promise<unknown>).then === 'function') {
	        await value;
	      }
	    };

	    // Marker that becomes the new compaction boundary.
	    const markerMessage = createUserHistoryMessage(COMPACTION_MARKER_TEXT, {
	      synthetic: true,
	      compaction: { auto: params.auto },
	    });
	    this.history.push(markerMessage);
	    const markerIndex = this.history.length - 1;

	    try {
	      await maybeAwait(callbacks?.onCompactionStart?.({ auto: params.auto, markerMessageId: markerMessage.id }));
	    } catch {
	      // Ignore UI callback failures; compaction must still proceed.
	    }

	    const abortController = new AbortController();
	    this.activeAbortController = abortController;

	    try {
	      const compacting = await this.plugins.trigger(
	        'experimental.session.compacting',
	        { sessionId: this.config.sessionId },
	        { context: [] as string[], prompt: undefined as string | undefined },
	      );

	      const extraContext = Array.isArray(compacting.context) ? compacting.context.filter(Boolean) : [];
	      const promptText =
	        typeof compacting.prompt === 'string' && compacting.prompt.trim()
	          ? compacting.prompt
	          : [COMPACTION_PROMPT_TEXT, ...extraContext].join('\n\n');

	      const rawModel = await this.llm.getModel(params.modelId);
	      const compactionModel = wrapLanguageModel({
	        model: rawModel as any,
	        middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
	      });

      const effective = getEffectiveHistory(this.history);
      const prepared = createHistoryForCompactionPrompt(effective, getCompactionConfig());
      const withoutIds = prepared.map(({ id: _id, ...rest }) => rest);

	      const compactionUser = createUserHistoryMessage(promptText, { synthetic: true });
	      const compactionModelMessages = await convertToModelMessages([...withoutIds, compactionUser as any], { tools: {} as any });

      const stream = streamText({
        model: compactionModel as any,
        system: COMPACTION_SYSTEM_PROMPT,
        messages: compactionModelMessages,
        maxRetries: 0,
        temperature: 0.0,
        maxOutputTokens: this.getMaxOutputTokens(),
        abortSignal: abortController.signal,
      });

      const summaryTextRaw = await stream.text;
      const summaryUsage = await stream.usage;
      const finishReason = await stream.finishReason;
      const summaryText = stripThinkBlocks(String(summaryTextRaw || '')).trim();

      const memoryFlushConfig = getMemoryFlushConfig();
      if (memoryFlushConfig.enabled && summaryText) {
        const timestamp = new Date().toISOString();
        const filePath = memoryFlushConfig.filePath ?? 'MEMORY.md';
        let body = summaryText;
        if (body.length > memoryFlushConfig.maxChars) {
          body = body.slice(0, memoryFlushConfig.maxChars).trimEnd() + '…';
        }
        const headerLines = [
          `## Compaction memory (${timestamp})`,
          this.config.sessionId ? `Session: ${this.config.sessionId}` : undefined,
          `Model: ${params.modelId}`,
          '',
        ].filter((line) => typeof line === 'string') as string[];
        const content = `${headerLines.join('\n')}${body}`.trimEnd();
        try {
          await this.registry.executeTool(
            'memory_write',
            { content, filePath, mode: 'append' },
            this.createToolContext(abortController.signal),
          );
        } catch (error) {
          callbacks?.onDebug?.(
            `[Compaction] memory flush failed: ${summarizeErrorForDebug(error)}`,
          );
        }
      }

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
      this.history.push(summaryMessage);

      if (params.auto) {
        this.history.push(createUserHistoryMessage(COMPACTION_AUTO_CONTINUE_TEXT, { synthetic: true }));
      }

      // Keep only the effective history after compaction to avoid unbounded growth.
      this.history = getEffectiveHistory(this.history);

      try {
        await maybeAwait(
          callbacks?.onCompactionEnd?.({
            auto: params.auto,
            markerMessageId: markerMessage.id,
            summaryMessageId: summaryMessage.id,
            status: 'done',
          }),
        );
      } catch {
        // Ignore UI callback failures; compaction already succeeded.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /aborterror/i.test(message) || /aborted/i.test(message) ? 'canceled' : 'error';

      // If the summary wasn't produced, discard the marker to avoid polluting the prompt boundary.
      if (this.history[markerIndex]?.id === markerMessage.id) {
        this.history.splice(markerIndex, 1);
      }

      try {
        await maybeAwait(
          callbacks?.onCompactionEnd?.({
            auto: params.auto,
            markerMessageId: markerMessage.id,
            status,
            error: message,
          }),
        );
      } catch {
        // Ignore UI callback failures; rethrow original compaction error.
      }

      throw error;
    } finally {
      this.activeAbortController = undefined;
    }
  }

  private filterToolsForMode(tools: ToolDefinition[]): ToolDefinition[] {
    // Tool availability is enforced at execution time in createAISDKTools so that
    // blocked tools still show a clear error instead of appearing "missing".
    return tools;
  }

  private filterTools(tools: ToolDefinition[]): ToolDefinition[] {
    const filter = this.config.toolFilter;
    if (!filter || filter.length === 0) {
      return tools;
    }

    return tools.filter(tool => {
      return filter.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(tool.id);
        }
        return tool.id === pattern || tool.id.startsWith(pattern + '.');
      });
    });
  }

  private getMaxOutputTokens(): number {
    const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('openaiCompatible.maxTokens');
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : undefined;

    if (Number.isFinite(parsed as number) && (parsed as number) > 0) {
      return Math.floor(parsed as number);
    }

    return 32000;
  }

  private createToolContext(abortSignal?: AbortSignal): ToolContext {
    const tokenSource = new vscode.CancellationTokenSource();
    this.activeCancellations.push(tokenSource);

    if (abortSignal) {
      if (abortSignal.aborted) {
        tokenSource.cancel();
      } else {
        abortSignal.addEventListener('abort', () => tokenSource.cancel(), { once: true });
      }
    }

    return {
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
      activeEditor: vscode.window.activeTextEditor,
      extensionContext: this.context,
      sessionId: this.config.sessionId,
      cancellationToken: tokenSource.token,
      progress: {
        report: () => {},
      },
      log: (message: string) => {
        console.log(`[Tool] ${message}`);
      },
    };
  }

  private disposeAllCancellations(): void {
    for (const source of this.activeCancellations) {
      source.dispose();
    }
    this.activeCancellations = [];
  }

  private async formatToolResult(result: ToolResult, toolName: string): Promise<string> {
    let content: string;

    const outputOverride = isRecord(result.metadata) ? result.metadata.outputText : undefined;
    if (typeof outputOverride === 'string' && outputOverride) {
      content = outputOverride;
      if (content.length > MAX_TOOL_RESULT_LENGTH) {
        content = content.substring(0, MAX_TOOL_RESULT_LENGTH) +
          '\n\n... [TRUNCATED]';
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
      content = content.substring(0, MAX_TOOL_RESULT_LENGTH) +
        '\n\n... [TRUNCATED]';
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
        metadata: { ...(result.metadata || {}), truncated: rawError.length > MAX_TOOL_RESULT_LENGTH || result.metadata?.truncated },
      };
    }

    const formatted = await this.formatToolResult(result, toolLabel);
    return {
      ...result,
      data: formatted,
      metadata: { ...(result.metadata || {}), truncated: formatted.includes('[TRUNCATED]') || result.metadata?.truncated },
    };
  }

  abort(): void {
    this.aborted = true;
    this.activeAbortController?.abort();
    this.activeAbortController = undefined;
    for (const source of this.activeCancellations) {
      source.cancel();
    }
    this.disposeAllCancellations();
  }

  async clear(): Promise<void> {
    this.history = [];
    this.pendingPlan = undefined;
    this.fileHandles.reset();
    this.semanticHandles.reset();
  }

  getHistory(): AgentHistoryMessage[] {
    return [...this.history];
  }

  setMode(mode: 'build' | 'plan'): void {
    this.config = { ...this.config, mode };
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
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
}

export function createAgent(
  llm: LLMProvider,
  context: vscode.ExtensionContext,
  config?: AgentConfig,
  plugins?: PluginManager,
): AgentLoop {
  return new AgentLoop(llm, context, config, defaultToolRegistry, plugins);
}
