import {
  extractReasoningMiddleware,
  streamText,
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
import { SemanticHandleRegistry } from './semanticHandles.js';
import { buildStreamReplay, type StreamReplayUpdate } from './streamAdapters.js';
import { delay as getRetryDelayMs, retryable as getRetryableLlmError, sleep as retrySleep } from './retry.js';
import { LingyunSession } from './session.js';

type PluginManagerLike = {
  trigger: <Name extends LingyunHookName, Output>(
    name: Name,
    input: unknown,
    output: Output,
  ) => Promise<Output>;
};

export async function runOnce(params: {
  session: LingyunSession;
  callbacks?: AgentCallbacks;
  signal?: AbortSignal;

  modelId: string;
  mode: 'build' | 'plan';
  sessionId?: string;
  sessionIdFallback?: string;

  llm: LLMProvider;
  plugins: PluginManagerLike;
  registry: Pick<ToolRegistry, 'getTools'>;
  providerBehavior: ProviderBehavior;
  copilotReasoningEffort: string;
  compactionConfig: CompactionConfig;

  temperature: number;
  maxRetries: number;
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
  ) => Promise<ModelMessage[]>;
  pruneToolResultForHistory: (output: unknown, toolLabel: string) => Promise<ToolResult>;
}): Promise<string> {
  const { session, callbacks, signal, modelId, mode, llm, plugins, registry, providerBehavior } = params;
  const sessionId = params.sessionId;

  const semanticHandles = new SemanticHandleRegistry();
  semanticHandles.importState(session.semanticHandles);

  try {
    const rawModel = await llm.getModel(modelId);
    const model = wrapLanguageModel({
      model: rawModel as any,
      middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
    });

    const systemParts = await params.composeSystemPrompt(modelId, { signal });
    const tools = params.filterTools(await registry.getTools());
    const toolNameToDefinition = new Map<string, ToolDefinition>();

    const callbacksSafe = callbacks;

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
        temperature: params.temperature,
        topP: undefined,
        topK: undefined,
        options: providerBehavior.getChatProviderOptions(modelId, {
          copilotReasoningEffort: params.copilotReasoningEffort,
        }),
      },
    );

    let lastResponse = '';

    const maxIterations = 50;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      await invokeCallbackSafely(
        callbacksSafe?.onIterationStart,
        {
          label: `onIterationStart iteration=${iteration}`,
          onDebug: callbacksSafe?.onDebug,
        },
        iteration,
      );
      invokeCallbackSafely(callbacksSafe?.onThinking, { label: 'onThinking', onDebug: callbacksSafe?.onDebug });

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
      const modelMessages = await params.toModelMessages(session, aiTools, modelId);
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
          const stream = streamText({
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
                attemptReasoning += part.text;
                invokeCallbackSafely(
                  callbacksSafe?.onThoughtToken,
                  { label: 'onThoughtToken', onDebug: callbacksSafe?.onDebug },
                  part.text,
                );
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
          maxOutputTokens: params.getMaxOutputTokens(),
        });
        continue;
      }

      const hasToolParts = assistantMessage.parts.some((part: any) => part.type === 'dynamic-tool');
      if (streamFinishReason === 'tool-calls' || hasToolParts) continue;

      await plugins.trigger(
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

