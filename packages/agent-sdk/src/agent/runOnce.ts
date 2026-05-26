import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type ModelMessage,
  type TextStreamPart,
} from 'ai';

import {
  extractPlanFromReasoning,
  createAssistantHistoryMessage,
  extractUsageTokens,
  finalizeStreamingParts,
  getMessageText,
  normalizeTemperatureForModel,
  getReservedOutputTokens,
  isOverflow as isContextOverflow,
  markPreviousAssistantToolOutputs,
  setDynamicToolError,
  setDynamicToolOutput,
  stripThinkBlocks,
  stripToolBlocks,
  toToolCall,
  upsertDynamicToolCall,
  type CompactionConfig,
  type ModelLimit,
} from '@kooka/core';

import type { AgentCallbacks, LLMProvider, ToolDefinition, ToolResult } from '../types.js';
import type { LingyunHookName } from '../plugins/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ProviderBehavior } from './providerBehavior.js';
import { combineAbortSignals } from '../abort.js';
import { invokeCallbackSafely } from './callbacks.js';
import { compactSessionInternal } from './compaction.js';
import { DEFAULT_MAX_ITERATIONS } from './constants.js';
import { SemanticHandleRegistry } from './semanticHandles.js';
import { buildStreamReplay, type StreamReplayUpdate } from './streamAdapters.js';
import { delay as getRetryDelayMs, retryable as getRetryableLlmError, sleep as retrySleep } from './retry.js';
import { createThreadGoalToolResponse, LingyunSession, resolveThreadGoalStatusAfterBudgetLimit } from './session.js';
import { streamTextWithLingyunDefaults } from '../llm/streamText.js';

type PluginManagerLike = {
  trigger: <Name extends LingyunHookName, Output>(
    name: Name,
    input: unknown,
    output: Output,
  ) => Promise<Output>;
};

type UsageTokens = NonNullable<ReturnType<typeof extractUsageTokens>>;
type AccountedGoalAtIterationStart = { id: string; status: 'active' | 'budgetLimited' };

function usageTokenDeltaForGoal(tokens: UsageTokens | undefined): number {
  if (!tokens) return 0;
  return Math.max(0, Math.floor((tokens.input ?? 0) + (tokens.output ?? 0)));
}

function accountThreadGoalIteration(params: {
  session: LingyunSession;
  activeGoalAtIterationStart: AccountedGoalAtIterationStart | undefined;
  tokens: UsageTokens | undefined;
  iterationStartedAt: number;
}): void {
  const { session, activeGoalAtIterationStart, tokens, iterationStartedAt } = params;
  if (!activeGoalAtIterationStart) return;

  const goal = session.threadGoal;
  if (!goal || goal.id !== activeGoalAtIterationStart.id) return;

  const tokenDelta = usageTokenDeltaForGoal(tokens);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - iterationStartedAt) / 1000));
  if (tokenDelta === 0 && elapsedSeconds === 0) return;

  goal.tokensUsed = Math.max(0, Math.floor(goal.tokensUsed + tokenDelta));
  goal.timeUsedSeconds = Math.max(0, Math.floor(goal.timeUsedSeconds + elapsedSeconds));
  goal.status = resolveThreadGoalStatusAfterBudgetLimit({
    currentStatus: goal.status,
    requestedStatus: goal.status,
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    budgetLimitEligible: activeGoalAtIterationStart.status === 'active',
  });
  goal.updatedAt = Date.now();
}

function parseToolInputObject(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== 'string') return undefined;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function refreshUpdateGoalToolOutputs(
  message: ReturnType<typeof createAssistantHistoryMessage>,
  session: LingyunSession,
  threadId: string | undefined,
): void {
  const goal = session.threadGoal;
  if (!goal) return;

  for (const part of message.parts as any[]) {
    if (!part || part.type !== 'dynamic-tool' || part.toolName !== 'update_goal') continue;
    if (part.state !== 'output-available') continue;
    const output = part.output;
    if (!output || typeof output !== 'object' || output.success !== true) continue;

    const status = parseToolInputObject(part.input)?.status;
    if (status !== 'complete' && status !== 'blocked') continue;
    if (status === 'complete' && goal.status !== 'complete') continue;
    if (status === 'blocked' && goal.status !== 'blocked' && goal.status !== 'budgetLimited') continue;

    const response = createThreadGoalToolResponse(goal, {
      includeCompletionReport: goal.status === 'complete',
      threadId,
    });
    const outputText = JSON.stringify(response, null, 2);
    part.output = {
      ...output,
      data: outputText,
      metadata: {
        ...((output as ToolResult).metadata || {}),
        outputText,
      },
    };
  }
}

export async function runOnce(params: {
  session: LingyunSession;
  callbacks?: AgentCallbacks;
  signal?: AbortSignal;

  modelId: string;
  mode: 'build' | 'plan';
  sessionId?: string;
  sessionIdFallback?: string;
  syntheticResumeUserText?: string;

  llm: LLMProvider;
  plugins: PluginManagerLike;
  registry: Pick<ToolRegistry, 'getTools'>;
  providerBehavior: ProviderBehavior;
  reasoningEffort: string;
  textVerbosity: string;
  openaiCompatibleThinking?: string;
  compactionConfig: CompactionConfig;

  temperature: number;
  topP?: number;
  topK?: number;
  maxRetries: number;
  maxIterations: number;
  retryWithPartialOutput: boolean;
  getMaxOutputTokens: () => number;
  getModelLimit: (modelId: string) => ModelLimit | undefined;

  composeSystemPrompt: (modelId: string, options?: { signal?: AbortSignal }) => Promise<string[]>;
  filterTools: (tools: ToolDefinition[]) => ToolDefinition[];
  createAISDKTools: (
    tools: ToolDefinition[],
    mode: 'build' | 'plan',
    session: LingyunSession,
    semanticHandles: SemanticHandleRegistry,
    callbacks: AgentCallbacks | undefined,
    toolNameToDefinition: Map<string, ToolDefinition>,
  ) => Record<string, unknown>;
  toModelMessages: (
    session: LingyunSession,
    tools: Record<string, unknown>,
    modelId: string,
    options?: { syntheticResumeUserText?: string },
  ) => Promise<ModelMessage[]>;
  pruneToolResultForHistory: (output: unknown, toolLabel: string) => Promise<ToolResult>;
  drainPendingInputs: (
    session: LingyunSession,
    callbacks: AgentCallbacks | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<number>;
}): Promise<string> {
  const { session, callbacks, signal, modelId, mode, llm, plugins, registry, providerBehavior } = params;
  const sessionId = params.sessionId;
  const retryWithPartialOutput = !!params.retryWithPartialOutput;
  const temperature = normalizeTemperatureForModel(modelId, params.temperature);

  const semanticHandles = new SemanticHandleRegistry();
  semanticHandles.importState(session.semanticHandles);

  function getProviderAuthRetryLabel(error: unknown, context: { modelId: string; mode: 'plan' | 'build' }): string | undefined {
    return llm.getAuthRetryLabel?.(error, context);
  }

  try {
    const callbacksSafe = callbacks;
    const modelMiddleware = [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })];
    const wrapModel = (rawModel: unknown) =>
      wrapLanguageModel({
        model: rawModel as any,
        middleware: modelMiddleware,
      });

    const loadModel = async () => wrapModel(await llm.getModel(modelId));
    const loadModelWithAuthRetry = async (): Promise<any> => {
      try {
        return await loadModel();
      } catch (error) {
        const context = { modelId, mode };
        const authRetryLabel = getProviderAuthRetryLabel(error, context);
        if (!authRetryLabel || signal?.aborted) {
          throw error;
        }

        invokeCallbackSafely(
          callbacksSafe?.onStatusChange,
          { label: 'onStatusChange', onDebug: callbacksSafe?.onDebug },
          {
            type: 'retry',
            attempt: 1,
            nextRetryTime: Date.now(),
            message: `Refreshing ${authRetryLabel} auth…`,
          },
        );

        try {
          llm.onRequestError?.(error, context);
        } catch {
          // ignore
        }

        try {
          return await loadModel();
        } catch (retryError) {
          if (!signal?.aborted) {
            try {
              llm.onRequestError?.(retryError, context);
            } catch {
              // ignore
            }
          }
          throw retryError;
        }
      }
    };

    let model: any = await loadModelWithAuthRetry();

    const systemParts = await params.composeSystemPrompt(modelId, { signal });
    session.setSystemPromptSnapshot(systemParts);
    const tools = params.filterTools(await registry.getTools());
    const toolNameToDefinition = new Map<string, ToolDefinition>();

    const providerOptionParams = {
      reasoningEffort: params.reasoningEffort,
      textVerbosity: params.textVerbosity,
      openaiCompatibleThinking: params.openaiCompatibleThinking,
    };
    const treatReasoningAsText = providerBehavior.shouldTreatReasoningAsText(modelId, providerOptionParams);

    const callParams = await plugins.trigger(
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
        temperature,
        topP: params.topP,
        topK: params.topK,
        options: providerBehavior.getChatProviderOptions(modelId, providerOptionParams),
      },
    );

    let lastResponse = '';
    let syntheticResumeUserText = params.syntheticResumeUserText;

    const maxIterations =
      params.maxIterations === -1
        ? Number.POSITIVE_INFINITY
        : Number.isFinite(params.maxIterations) && params.maxIterations > 0
          ? Math.floor(params.maxIterations)
          : DEFAULT_MAX_ITERATIONS;

    async function completeChat(messageId: string, assistantText: string, returnedText: string): Promise<void> {
      await plugins.trigger(
        'experimental.chat.complete',
        {
          sessionId,
          mode,
          modelId,
          messageId,
          assistantText,
          returnedText,
        },
        {},
      );
      invokeCallbackSafely(
        callbacksSafe?.onComplete,
        { label: 'onComplete', onDebug: callbacksSafe?.onDebug },
        returnedText,
      );
    }

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const iterationStartedAt = Date.now();
      const activeGoalAtIterationStart =
        mode === 'build' &&
        (session.threadGoal?.status === 'active' || session.threadGoal?.status === 'budgetLimited')
          ? { id: session.threadGoal.id, status: session.threadGoal.status }
          : undefined;

      await invokeCallbackSafely(
        callbacksSafe?.onIterationStart,
        {
          label: `onIterationStart iteration=${iteration}`,
          onDebug: callbacksSafe?.onDebug,
        },
        iteration,
      );
      invokeCallbackSafely(callbacksSafe?.onThinking, { label: 'onThinking', onDebug: callbacksSafe?.onDebug });

      await params.drainPendingInputs(session, callbacksSafe, signal);

      const abortController = new AbortController();
      const combined = signal
        ? combineAbortSignals([signal, abortController.signal])
        : abortController.signal;

      const aiTools = params.createAISDKTools(
        tools,
        mode,
        session,
        semanticHandles,
        callbacksSafe,
        toolNameToDefinition,
      );
      const modelMessages = await params.toModelMessages(session, aiTools, modelId, {
        syntheticResumeUserText,
      });
      syntheticResumeUserText = undefined;
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

      const maxRetries = Math.max(0, Math.floor(params.maxRetries ?? 0));
      let retryAttempt = 0;
      let authRefreshAttempt = 0;

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
          const streamAdapter = providerBehavior.createStreamAdapter(modelId);
          const stream = streamTextWithLingyunDefaults({
            model: model as any,
            messages: promptMessages,
            tools: aiTools as any,
            maxRetries: 0,
            temperature: (callParams as any).temperature,
            topP: (callParams as any).topP,
            topK: (callParams as any).topK,
            ...((callParams as any).options ? { providerOptions: (callParams as any).options } : {}),
            maxOutputTokens: params.getMaxOutputTokens(),
            abortSignal: combined,
          });

          for await (const part of stream.fullStream as AsyncIterable<TextStreamPart<any>>) {
            streamAdapter.onPart(part);
            switch (part.type) {
              case 'text-delta': {
                invokeCallbackSafely(
                  callbacksSafe?.onToken,
                  { label: 'onToken', onDebug: callbacksSafe?.onDebug },
                  part.text,
                );
                attemptText += part.text;
                invokeCallbackSafely(
                  callbacksSafe?.onAssistantToken,
                  { label: 'onAssistantToken', onDebug: callbacksSafe?.onDebug },
                  part.text,
                );
                break;
              }
              case 'reasoning-delta': {
                if (treatReasoningAsText) {
                  invokeCallbackSafely(
                    callbacksSafe?.onToken,
                    { label: 'onToken', onDebug: callbacksSafe?.onDebug },
                    part.text,
                  );
                  attemptText += part.text;
                  invokeCallbackSafely(
                    callbacksSafe?.onAssistantToken,
                    { label: 'onAssistantToken', onDebug: callbacksSafe?.onDebug },
                    part.text,
                  );
                } else {
                  attemptReasoning += part.text;
                  invokeCallbackSafely(
                    callbacksSafe?.onThoughtToken,
                    { label: 'onThoughtToken', onDebug: callbacksSafe?.onDebug },
                    part.text,
                  );
                }
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
                let output = await params.pruneToolResultForHistory(rawOutput, toolLabel);

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
              case 'error': {
                if (streamAdapter.shouldIgnoreError(part.error, { sawFinishPart, attemptText })) {
                  break;
                }
                throw part.error;
              }
              default:
                break;
            }
          }

          streamFinishReason = await stream.finishReason;
          streamUsage = await stream.usage;
          streamReplayUpdates = streamAdapter.getReplayUpdates();
          break;
        } catch (e) {
          const context = { modelId, mode };
          const authRetryLabel = getProviderAuthRetryLabel(e, context);
          const isAuthRetry = !!authRetryLabel;

          const retryable = isAuthRetry
            ? { kind: 'auth_expired' as const, message: `${authRetryLabel} auth expired`, retryAfterMs: undefined }
            : getRetryableLlmError(e);
          const allowRetryAfterOutput = retryWithPartialOutput && !!attemptText.trim();
          const canRetry =
            !!retryable &&
            (isAuthRetry ? authRefreshAttempt < 1 : retryAttempt < maxRetries) &&
            !sawToolCall &&
            (!attemptText.trim() || allowRetryAfterOutput) &&
            !combined.aborted;
          if (canRetry) {
            if (isAuthRetry) {
              authRefreshAttempt += 1;
            } else {
              retryAttempt += 1;
            }

            const totalRetryAttempt = retryAttempt + authRefreshAttempt;
            const waitMs = isAuthRetry ? 0 : getRetryDelayMs(retryAttempt, retryable.retryAfterMs);
            invokeCallbackSafely(
              callbacksSafe?.onStatusChange,
              { label: 'onStatusChange', onDebug: callbacksSafe?.onDebug },
              {
                type: 'retry',
                attempt: totalRetryAttempt,
                nextRetryTime: Date.now() + waitMs,
                message: isAuthRetry ? `Refreshing ${authRetryLabel} auth…` : retryable.message,
              },
            );

            if (!combined.aborted && isAuthRetry) {
              try {
                llm.onRequestError?.(e, context);
              } catch {
                // ignore
              }
              model = wrapModel(await llm.getModel(modelId));
            }

            if (waitMs > 0) {
              await retrySleep(waitMs, combined);
            }
            continue;
          }

          if (retryable) {
            const wrapped = new Error(retryable.message);
            (wrapped as any).cause = e;
            if (!combined.aborted) {
              try {
                llm.onRequestError?.(e, { modelId, mode });
              } catch {
                // ignore
              }
            }
            throw wrapped;
          }

          if (!combined.aborted) {
            try {
              llm.onRequestError?.(e, { modelId, mode });
            } catch {
              // ignore
            }
          }
          throw e;
        }
      }

      const tokens = extractUsageTokens(streamUsage);
      accountThreadGoalIteration({
        session,
        activeGoalAtIterationStart,
        tokens,
        iterationStartedAt,
      });
      const goalBudgetLimitedAfterIteration =
        !!activeGoalAtIterationStart &&
        session.threadGoal?.id === activeGoalAtIterationStart.id &&
        session.threadGoal.status === 'budgetLimited';
      refreshUpdateGoalToolOutputs(assistantMessage, session, session.sessionId ?? sessionId);
      const replay = buildStreamReplay({
        text: attemptText,
        reasoning: attemptReasoning,
        updates: streamReplayUpdates,
      });

      assistantMessage.metadata = {
        mode: params.mode,
        finishReason: streamFinishReason,
        replay,
        ...(tokens ? { tokens } : {}),
      };

      const cleanedText = stripToolBlocks(stripThinkBlocks(attemptText)).trim();
      assistantMessage.parts = assistantMessage.parts.filter(
        (p: any) => p.type !== 'text' && p.type !== 'reasoning',
      );

      let finalText = cleanedText;
      if (!finalText && mode === 'plan' && attemptReasoning.trim()) {
        finalText = extractPlanFromReasoning(attemptReasoning) ?? '';
      }
      if (finalText) {
        const textOutput = await plugins.trigger(
          'experimental.text.complete',
          { sessionId, messageId: assistantMessage.id },
          { text: finalText },
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

      if (params.compactionConfig.prune && params.compactionConfig.toolOutputMode === 'afterToolCall') {
        markPreviousAssistantToolOutputs(session.history);
      }
      await invokeCallbackSafely(
        callbacksSafe?.onIterationEnd,
        {
          label: `onIterationEnd iteration=${iteration}`,
          onDebug: callbacksSafe?.onDebug,
        },
        iteration,
      );

      if (goalBudgetLimitedAfterIteration) {
        await completeChat(assistantMessage.id, lastAssistantText, lastResponse);
        return lastResponse;
      }

      const modelLimit = params.getModelLimit(modelId);
      const reservedOutputTokens = getReservedOutputTokens({
        modelLimit,
        maxOutputTokens: params.getMaxOutputTokens(),
      });

      if (
        streamFinishReason === 'tool-calls' &&
        isContextOverflow({
          lastTokens: assistantMessage.metadata?.tokens,
          modelLimit,
          reservedOutputTokens,
          config: params.compactionConfig,
        })
      ) {
        await compactSessionInternal({
          session,
          auto: true,
          modelId,
          mode,
          sessionIdFallback: params.sessionIdFallback,
          callbacks: callbacksSafe,
          llm,
          plugins,
          providerBehavior,
          compactionConfig: params.compactionConfig,
          providerOptionParams,
          maxOutputTokens: params.getMaxOutputTokens(),
        });
        continue;
      }

      const hasToolParts = assistantMessage.parts.some((part: any) => part.type === 'dynamic-tool');
      if (streamFinishReason === 'tool-calls' || hasToolParts) continue;

      const drained = await params.drainPendingInputs(session, callbacksSafe, signal);
      if (drained > 0) continue;

      await completeChat(assistantMessage.id, lastAssistantText, lastResponse);
      return lastResponse;
    }

    invokeCallbackSafely(callbacksSafe?.onComplete, { label: 'onComplete', onDebug: callbacksSafe?.onDebug }, lastResponse);
    return lastResponse;
  } finally {
    session.semanticHandles = semanticHandles.exportState();
  }
}
