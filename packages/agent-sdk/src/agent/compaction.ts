import {
  COMPACTION_AUTO_CONTINUE_TEXT,
  COMPACTION_MARKER_TEXT,
  COMPACTION_PROMPT_TEXT,
  COMPACTION_SYSTEM_PROMPT,
  createAssistantHistoryMessage,
  createHistoryForCompactionPrompt,
  createUserHistoryMessage,
  extractUsageTokens,
  getEffectiveHistory,
  stripThinkBlocks,
  type AgentHistoryMessage,
  type CompactionConfig,
} from '@kooka/core';
import {
  convertToModelMessages,
  extractReasoningMiddleware,
  streamText,
  wrapLanguageModel,
} from 'ai';

import type { AgentCallbacks, LLMProvider } from '../types.js';
import type { LingyunHookName } from '../plugins/types.js';
import type { ProviderBehavior } from './providerBehavior.js';
import { LingyunSession } from './session.js';

type PluginManagerLike = {
  trigger: <Name extends LingyunHookName, Output>(
    name: Name,
    input: unknown,
    output: Output,
  ) => Promise<Output>;
};

export async function compactSessionInternal(params: {
  session: LingyunSession;
  auto: boolean;
  modelId: string;
  mode: 'build' | 'plan';
  sessionIdFallback?: string;
  callbacks?: AgentCallbacks;

  llm: LLMProvider;
  plugins: PluginManagerLike;
  providerBehavior: ProviderBehavior;
  compactionConfig: CompactionConfig;
  maxOutputTokens: number;
}): Promise<void> {
  const maybeAwait = async (value: unknown) => {
    if (value && typeof (value as Promise<unknown>).then === 'function') {
      await value;
    }
  };

  const markerMessage = createUserHistoryMessage(COMPACTION_MARKER_TEXT, {
    synthetic: true,
    compaction: { auto: params.auto },
  });
  params.session.history.push(markerMessage);
  const markerIndex = params.session.history.length - 1;

  try {
    await maybeAwait(
      params.callbacks?.onCompactionStart?.({
        auto: params.auto,
        markerMessageId: markerMessage.id,
      }),
    );
  } catch {
    // ignore
  }

  const abortController = new AbortController();
  const signal = abortController.signal;

  try {
    const compacting = await params.plugins.trigger(
      'experimental.session.compacting',
      { sessionId: params.session.sessionId ?? params.sessionIdFallback },
      { context: [] as string[], prompt: undefined as string | undefined },
    );

    const extraContext = Array.isArray((compacting as any).context)
      ? ((compacting as any).context as any[]).filter(Boolean)
      : [];
    const promptText =
      typeof (compacting as any).prompt === 'string' && (compacting as any).prompt.trim()
        ? (compacting as any).prompt
        : [COMPACTION_PROMPT_TEXT, ...extraContext].join('\n\n');

    const rawModel = await params.llm.getModel(params.modelId);
    const compactionModel = wrapLanguageModel({
      model: rawModel as any,
      middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
    });

    const effective = getEffectiveHistory(params.session.history);
    const prepared = createHistoryForCompactionPrompt(effective, params.compactionConfig);
    const withoutIds = prepared.map(({ id: _id, ...rest }: AgentHistoryMessage) => rest);

    const compactionUser = createUserHistoryMessage(promptText, { synthetic: true });
    const convertedCompactionModelMessages = await convertToModelMessages(
      [...withoutIds, compactionUser as any],
      { tools: {} as any },
    );
    const compactionModelMessages = params.providerBehavior.transformModelMessages(
      params.modelId,
      convertedCompactionModelMessages,
    );

    const stream = streamText({
      model: compactionModel as any,
      system: COMPACTION_SYSTEM_PROMPT,
      messages: compactionModelMessages,
      maxRetries: 0,
      temperature: 0.0,
      maxOutputTokens: params.maxOutputTokens,
      abortSignal: signal,
    });

    const summaryTextRaw = await stream.text;
    const summaryUsage = await stream.usage;
    const finishReason = await stream.finishReason;
    const summaryText = stripThinkBlocks(String(summaryTextRaw || '')).trim();

    const summaryMessage = createAssistantHistoryMessage();
    const summaryTokens = extractUsageTokens(summaryUsage);
    summaryMessage.metadata = {
      mode: params.mode,
      finishReason,
      summary: true,
      ...(summaryTokens ? { tokens: summaryTokens } : {}),
    };
    if (summaryText) {
      summaryMessage.parts.push({ type: 'text', text: summaryText, state: 'done' });
    }
    params.session.history.push(summaryMessage);

    if (params.auto) {
      params.session.history.push(
        createUserHistoryMessage(COMPACTION_AUTO_CONTINUE_TEXT, { synthetic: true }),
      );
    }

    params.session.history = getEffectiveHistory(params.session.history);

    try {
      await maybeAwait(
        params.callbacks?.onCompactionEnd?.({
          auto: params.auto,
          markerMessageId: markerMessage.id,
          summaryMessageId: summaryMessage.id,
          status: 'done',
        }),
      );
    } catch {
      // ignore
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /aborterror/i.test(message) || /aborted/i.test(message) ? 'canceled' : 'error';

    if (params.session.history[markerIndex]?.id === markerMessage.id) {
      params.session.history.splice(markerIndex, 1);
    }

    try {
      await maybeAwait(
        params.callbacks?.onCompactionEnd?.({
          auto: params.auto,
          markerMessageId: markerMessage.id,
          status,
          error: message,
        }),
      );
    } catch {
      // ignore
    }

    throw error;
  }
}
