import type { ToolExecutionOptions } from 'ai';

import type {
  AgentCallbacks,
  AgentConfig,
  LLMProvider,
  LingyunRun,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from '../types.js';
import {
  TOOL_ERROR_CODES,
  listBuiltinSubagents,
  normalizeSessionId,
  requireString,
  resolveBuiltinSubagent,
  stripSkillInjectedMessages,
  type UserHistoryInput,
} from '@kooka/core';

import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { invokeCallbackSafely } from './callbacks.js';
import { LingyunSession } from './session.js';
import { snapshotSession } from '../persistence/sessionSnapshot.js';

export type TaskSubagentRunnerDeps = {
  llm: LLMProvider;
  getConfig: () => AgentConfig;
  getMode: () => 'build' | 'plan';
  getTaskMaxOutputChars: () => number;
  taskSessions: Map<string, LingyunSession>;
  maxTaskSessions: number;
  createSubagentAgent: (config: AgentConfig) => {
    run: (params: {
      session: LingyunSession;
      input: UserHistoryInput;
      callbacks?: AgentCallbacks;
      signal?: AbortSignal;
    }) => LingyunRun;
  };
};

export class TaskSubagentRunner {
  private readonly llm: LLMProvider;
  private readonly getConfig: () => AgentConfig;
  private readonly getMode: () => 'build' | 'plan';
  private readonly getTaskMaxOutputChars: () => number;
  private readonly taskSessions: Map<string, LingyunSession>;
  private readonly maxTaskSessions: number;
  private readonly createSubagentAgent: TaskSubagentRunnerDeps['createSubagentAgent'];

  constructor(deps: TaskSubagentRunnerDeps) {
    this.llm = deps.llm;
    this.getConfig = deps.getConfig;
    this.getMode = deps.getMode;
    this.getTaskMaxOutputChars = deps.getTaskMaxOutputChars;
    this.taskSessions = deps.taskSessions;
    this.maxTaskSessions = deps.maxTaskSessions;
    this.createSubagentAgent = deps.createSubagentAgent;
  }

  private resolveTaskToolSpec(
    resolvedArgs: Record<string, unknown>,
    parentMode: 'build' | 'plan',
  ): ToolResult | { description: string; prompt: string; subagent: NonNullable<ReturnType<typeof resolveBuiltinSubagent>> } {
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

    return { description: descriptionResult.value, prompt: promptResult.value, subagent };
  }

  private getOrCreateTaskChildSession(params: {
    parentSession: LingyunSession;
    subagentType: string;
    sessionIdRaw: string;
  }): { parentSessionId: string | undefined; childSessionId: string; childSession: LingyunSession } {
    const config = this.getConfig();
    const parentSessionId = params.parentSession.sessionId ?? config.sessionId;
    const requestedSessionId = normalizeSessionId(params.sessionIdRaw) || '';
    const childSessionId = requestedSessionId || crypto.randomUUID();

    const existing = this.taskSessions.get(childSessionId);
    const childSession =
      existing ??
      new LingyunSession({
        sessionId: childSessionId,
        parentSessionId,
        subagentType: params.subagentType,
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
      childSession.subagentType = params.subagentType;
      // Refresh LRU order.
      this.taskSessions.delete(childSessionId);
      this.taskSessions.set(childSessionId, childSession);
    }

    return { parentSessionId, childSessionId, childSession };
  }

  private async resolveTaskChildModel(params: {
    childSession: LingyunSession;
    parentModelId: string;
    callbacks?: AgentCallbacks;
  }): Promise<{ childModelId: string; desiredChildModelId: string; childModelWarning?: string }> {
    const config = this.getConfig();
    const configuredSubagentModel = typeof config.subagentModel === 'string' ? config.subagentModel.trim() : '';

    const desiredChildModelId = params.childSession.modelId || configuredSubagentModel || params.parentModelId;
    let childModelId = params.parentModelId;
    let childModelWarning: string | undefined;
    if (desiredChildModelId !== params.parentModelId) {
      try {
        await this.llm.getModel(desiredChildModelId);
        childModelId = desiredChildModelId;
      } catch (error) {
        childModelWarning =
          `Subagent model "${desiredChildModelId}" is unavailable; ` +
          `using parent model "${params.parentModelId}".`;
        invokeCallbackSafely(
          params.callbacks?.onNotice,
          { label: 'onNotice subagent_model_fallback', onDebug: params.callbacks?.onDebug },
          { level: 'warning', message: childModelWarning },
        );
        invokeCallbackSafely(
          params.callbacks?.onDebug,
          { label: 'onDebug subagent_model_fallback' },
          `[Task] subagent model fallback requested=${desiredChildModelId} using=${params.parentModelId} error=${error instanceof Error ? error.name : typeof error}`,
        );
        childModelId = params.parentModelId;
      }
    }

    params.childSession.modelId = childModelId;
    return { childModelId, desiredChildModelId, ...(childModelWarning ? { childModelWarning } : {}) };
  }

  private formatTaskOutputText(text: string, childSessionId: string): string {
    const baseText = String(text || '').trimEnd();
    const metadataBlock =
      '\n\n' + ['<task_metadata>', `session_id: ${childSessionId}`, '</task_metadata>'].join('\n');

    const maxChars = this.getTaskMaxOutputChars();
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

  async executeTaskTool(params: {
    def: ToolDefinition;
    session: LingyunSession;
    callbacks: AgentCallbacks | undefined;
    args: Record<string, unknown>;
    options: ToolExecutionOptions;
  }): Promise<ToolResult> {
    const config = this.getConfig();

    if (params.session.parentSessionId || params.session.subagentType) {
      return {
        success: false,
        error: 'Subagents cannot spawn other subagents via task.',
        metadata: { errorCode: TOOL_ERROR_CODES.task_recursion_denied },
      };
    }

    const parentMode = this.getMode();
    const spec = this.resolveTaskToolSpec(params.args, parentMode);
    if ('success' in spec) return spec;

    const sessionIdRaw =
      typeof params.args.session_id === 'string' && params.args.session_id.trim()
        ? String(params.args.session_id).trim()
        : '';

    const { parentSessionId, childSessionId, childSession } = this.getOrCreateTaskChildSession({
      parentSession: params.session,
      subagentType: spec.subagent.name,
      sessionIdRaw,
    });

    const parentToolCallId = params.options.toolCallId;

    const parentModelId = config.model;
    if (!parentModelId) {
      return {
        success: false,
        error: 'No model configured. Set AgentConfig.model.',
        metadata: { errorCode: TOOL_ERROR_CODES.missing_model },
      };
    }

    const { childModelId, desiredChildModelId, childModelWarning } = await this.resolveTaskChildModel({
      childSession,
      parentModelId,
      callbacks: params.callbacks,
    });

    invokeCallbackSafely(
      params.callbacks?.onSubagentEvent,
      { label: 'onSubagentEvent type=subagent_start', onDebug: params.callbacks?.onDebug },
      {
        type: 'subagent_start',
        parentSessionId,
        parentToolCallId,
        sessionId: childSessionId,
        subagentType: spec.subagent.name,
        description: spec.description,
        modelId: childModelId,
      },
    );

    const basePrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const subagentConfig: AgentConfig = {
      model: childModelId,
      mode: parentMode,
      temperature: config.temperature,
      maxRetries: config.maxRetries,
      maxOutputTokens: config.maxOutputTokens,
      autoApprove: parentMode === 'plan' ? false : config.autoApprove,
      toolFilter: spec.subagent.toolFilter?.length ? spec.subagent.toolFilter : undefined,
      systemPrompt: `${basePrompt}\n\n${spec.subagent.prompt}`,
      sessionId: childSessionId,
    };

    const subagentRunner = this.createSubagentAgent(subagentConfig);

    const toolSummary = new Map<string, { id: string; tool: string; status: 'running' | 'success' | 'error' }>();

    const childCallbacks: AgentCallbacks = {
      onRequestApproval: async (tool, definition) => {
        invokeCallbackSafely(
          params.callbacks?.onSubagentEvent,
          {
            label: `onSubagentEvent type=subagent_request_approval tool=${definition.id}`,
            onDebug: params.callbacks?.onDebug,
          },
          {
            type: 'subagent_request_approval',
            parentSessionId,
            parentToolCallId,
            sessionId: childSessionId,
            subagentType: spec.subagent.name,
            tool,
            definition,
          },
        );

        let approved = false;
        try {
          approved = (await params.callbacks?.onRequestApproval?.(tool, definition)) ?? false;
        } catch {
          approved = false;
        }

        invokeCallbackSafely(
          params.callbacks?.onSubagentEvent,
          {
            label: `onSubagentEvent type=subagent_approval_resolved tool=${definition.id}`,
            onDebug: params.callbacks?.onDebug,
          },
          {
            type: 'subagent_approval_resolved',
            parentSessionId,
            parentToolCallId,
            sessionId: childSessionId,
            subagentType: spec.subagent.name,
            tool,
            definition,
            approved,
          },
        );

        return approved;
      },
      onToolCall: (tool, definition) => {
        toolSummary.set(tool.id, { id: tool.id, tool: definition.id, status: 'running' });
        invokeCallbackSafely(
          params.callbacks?.onSubagentEvent,
          { label: `onSubagentEvent type=subagent_tool_call tool=${definition.id}`, onDebug: params.callbacks?.onDebug },
          {
            type: 'subagent_tool_call',
            parentSessionId,
            parentToolCallId,
            sessionId: childSessionId,
            subagentType: spec.subagent.name,
            tool,
            definition,
          },
        );
      },
      onToolResult: (tool: ToolCall, result: ToolResult) => {
        const prev = toolSummary.get(tool.id);
        const nextStatus: 'success' | 'error' = result.success ? 'success' : 'error';
        toolSummary.set(tool.id, {
          id: tool.id,
          tool: prev?.tool ?? tool.function.name,
          status: nextStatus,
        });
        invokeCallbackSafely(
          params.callbacks?.onSubagentEvent,
          { label: `onSubagentEvent type=subagent_tool_result tool=${tool.function.name}`, onDebug: params.callbacks?.onDebug },
          {
            type: 'subagent_tool_result',
            parentSessionId,
            parentToolCallId,
            sessionId: childSessionId,
            subagentType: spec.subagent.name,
            tool,
            result,
          },
        );
      },
    };

    try {
      const run = subagentRunner.run({
        session: childSession,
        input: spec.prompt,
        callbacks: childCallbacks,
        signal: params.options.abortSignal,
      });
      const drain = (async () => {
        for await (const _event of run.events) {
          // drain
        }
      })();
      const done = await run.done;
      await drain;
      const text = done.text || '';

      invokeCallbackSafely(
        params.callbacks?.onSubagentEvent,
        { label: 'onSubagentEvent type=subagent_complete', onDebug: params.callbacks?.onDebug },
        {
          type: 'subagent_complete',
          parentSessionId,
          parentToolCallId,
          sessionId: childSessionId,
          subagentType: spec.subagent.name,
          status: 'done',
        },
      );

      const outputText = this.formatTaskOutputText(text, childSessionId);
      const summary = [...toolSummary.values()].sort((a, b) => a.id.localeCompare(b.id));

      return {
        success: true,
        data: {
          session_id: childSessionId,
          subagent_type: spec.subagent.name,
          text,
        },
        metadata: {
          title: spec.description,
          outputText,
          task: {
            description: spec.description,
            subagent_type: spec.subagent.name,
            session_id: childSessionId,
            parent_session_id: parentSessionId,
            summary,
            model_id: childModelId,
            ...(childModelWarning
              ? { model_warning: childModelWarning, requested_model_id: desiredChildModelId }
              : {}),
          },
          childSession: snapshotSession(childSession, {
            sessionId: childSessionId,
            includeFileHandles: true,
          }),
        },
      };
    } catch (error) {
      invokeCallbackSafely(
        params.callbacks?.onSubagentEvent,
        { label: 'onSubagentEvent type=subagent_complete', onDebug: params.callbacks?.onDebug },
        {
          type: 'subagent_complete',
          parentSessionId,
          parentToolCallId,
          sessionId: childSessionId,
          subagentType: spec.subagent.name,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { errorCode: TOOL_ERROR_CODES.task_subagent_failed },
      };
    } finally {
      // Avoid leaking subagent's temporary skill injection messages to later turns.
      childSession.history = stripSkillInjectedMessages(childSession.history);
    }
  }
}
