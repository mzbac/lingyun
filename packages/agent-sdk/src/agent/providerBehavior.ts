import type { ModelMessage } from 'ai';

import type { AgentHistoryMessage } from '@kooka/core';
import {
  applyAssistantReplayForPrompt,
  applyCopilotImageInputPattern,
  applyCopilotReasoningFields,
  applyOpenAICompatibleReasoningField,
  isCopilotResponsesModelId,
  isGpt5FamilyModelId,
  shouldUseResponsesApiForModelId,
} from '@kooka/core';

import { createStreamAdapter, type StreamAdapter } from './streamAdapters.js';

type ChatProviderOptionParams = {
  reasoningEffort: string;
  textVerbosity: string;
};

export type ProviderBehavior = {
  /**
   * Provider-specific providerOptions to pass to `streamText()`.
   */
  getChatProviderOptions: (modelId: string, params: ChatProviderOptionParams) => unknown;
  /**
   * Provider-specific history transforms before `convertToModelMessages()`.
   */
  prepareHistoryForPrompt: (history: AgentHistoryMessage[]) => AgentHistoryMessage[];
  /**
   * Provider-specific transforms after `convertToModelMessages()`.
   */
  transformModelMessages: (modelId: string, messages: ModelMessage[]) => ModelMessage[];
  /**
   * Provider-specific stream adapters for provider quirks.
   */
  createStreamAdapter: (modelId: string) => StreamAdapter;
  /**
   * Provider-specific normalization for system prompt messages.
   */
  normalizeSystemPrompts: (system: string[]) => string[];
  /**
   * Optional synthetic user text to append for resume-only model calls.
   */
  getSyntheticResumeUserText: (modelId: string, history: AgentHistoryMessage[]) => string | undefined;
};

export function createProviderBehavior(llmId: string): ProviderBehavior {
  function normalizeModelId(modelId: string): string {
    return String(modelId || '')
      .trim()
      .toLowerCase()
      .replace(/\./g, '-');
  }

  function isClaudeFamilyModel(modelId: string): boolean {
    const normalized = normalizeModelId(modelId);
    return /(^|[/:_-])claude([/:_-]|$)/.test(normalized);
  }

  function shouldAppendSyntheticResumeUserTurn(modelId: string, history: AgentHistoryMessage[]): boolean {
    if (!isClaudeFamilyModel(modelId)) return false;
    const last = history[history.length - 1];
    return !!last && last.role !== 'user';
  }

  function getGpt5ReasoningEffort(modelId: string, params: Pick<ChatProviderOptionParams, 'reasoningEffort'>): string | undefined {
    const reasoningEffort = String(params.reasoningEffort || '').trim();
    if (!reasoningEffort) return undefined;

    return isGpt5FamilyModelId(modelId) ? reasoningEffort : undefined;
  }

  function getTextVerbosity(params: Pick<ChatProviderOptionParams, 'textVerbosity'>): string | undefined {
    const textVerbosity = String(params.textVerbosity || '').trim();
    return textVerbosity || undefined;
  }

  function omitEmptyProviderOptions(options: Record<string, unknown>): Record<string, unknown> | undefined {
    const entries = Object.entries(options).filter(([, value]) => {
      return value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0;
    });
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (llmId === 'copilot') {
    return {
      getChatProviderOptions(modelId, params) {
        const reasoningEffort = getGpt5ReasoningEffort(modelId, params);
        const textVerbosity = getTextVerbosity(params);

        const copilot: Record<string, unknown> = {};
        if (reasoningEffort) copilot.reasoningEffort = reasoningEffort;
        if (textVerbosity) copilot.textVerbosity = textVerbosity;

        const providerOptions: Record<string, unknown> = { copilot };

        // Copilot's /responses path expects the OpenAI Responses providerOptions namespace.
        if (isCopilotResponsesModelId(modelId)) {
          const openai: Record<string, unknown> = {};
          if (reasoningEffort) openai.reasoningEffort = reasoningEffort;
          if (textVerbosity) openai.textVerbosity = textVerbosity;
          providerOptions.openai = openai;
        }

        return omitEmptyProviderOptions(providerOptions);
      },
      prepareHistoryForPrompt(history) {
        return applyAssistantReplayForPrompt(history);
      },
      transformModelMessages(modelId, messages) {
        const withReasoning = isCopilotResponsesModelId(modelId) ? messages : applyCopilotReasoningFields(messages);
        return applyCopilotImageInputPattern(withReasoning);
      },
      createStreamAdapter(modelId) {
        return createStreamAdapter({ llmId: 'copilot', modelId });
      },
      normalizeSystemPrompts(system) {
        return system;
      },
      getSyntheticResumeUserText(modelId, history) {
        return shouldAppendSyntheticResumeUserTurn(modelId, history)
          ? 'Continue if you have next steps.'
          : undefined;
      },
    };
  }

  if (llmId === 'codexSubscription') {
    return {
      getChatProviderOptions(modelId, params) {
        const reasoningEffort = getGpt5ReasoningEffort(modelId, params);
        const textVerbosity = getTextVerbosity(params);

        const codexSubscription: Record<string, unknown> = {};
        const openai: Record<string, unknown> = {};
        if (reasoningEffort) {
          codexSubscription.reasoningEffort = reasoningEffort;
          openai.reasoningEffort = reasoningEffort;
        }
        if (textVerbosity) {
          codexSubscription.textVerbosity = textVerbosity;
          openai.textVerbosity = textVerbosity;
        }

        return omitEmptyProviderOptions({ codexSubscription, openai });
      },
      prepareHistoryForPrompt(history) {
        return applyAssistantReplayForPrompt(history);
      },
      transformModelMessages(_modelId, messages) {
        return messages;
      },
      createStreamAdapter(modelId) {
        return createStreamAdapter({ llmId: 'codexSubscription', modelId });
      },
      normalizeSystemPrompts(system) {
        return system;
      },
      getSyntheticResumeUserText() {
        return undefined;
      },
    };
  }

  if (llmId === 'openaiCompatible') {
    return {
      getChatProviderOptions(modelId, params) {
        if (!shouldUseResponsesApiForModelId(modelId)) return undefined;
        const reasoningEffort = getGpt5ReasoningEffort(modelId, params);
        const textVerbosity = getTextVerbosity(params);

        const openaiCompatible: Record<string, unknown> = {};
        const openai: Record<string, unknown> = {};
        if (reasoningEffort) {
          openaiCompatible.reasoningEffort = reasoningEffort;
          openai.reasoningEffort = reasoningEffort;
        }
        if (textVerbosity) {
          openaiCompatible.textVerbosity = textVerbosity;
          openai.textVerbosity = textVerbosity;
        }

        return omitEmptyProviderOptions({ openaiCompatible, openai });
      },
      prepareHistoryForPrompt(history) {
        return applyAssistantReplayForPrompt(history);
      },
      transformModelMessages(modelId, messages) {
        return shouldUseResponsesApiForModelId(modelId) ? messages : applyOpenAICompatibleReasoningField(messages);
      },
      createStreamAdapter(modelId) {
        return createStreamAdapter({ llmId: 'openaiCompatible', modelId });
      },
      normalizeSystemPrompts(system) {
        if (system.length <= 1) return system;
        return [system.filter(Boolean).join('\n')];
      },
      getSyntheticResumeUserText(modelId, history) {
        return shouldAppendSyntheticResumeUserTurn(modelId, history)
          ? 'Continue if you have next steps.'
          : undefined;
      },
    };
  }

  return {
    getChatProviderOptions() {
      return undefined;
    },
    prepareHistoryForPrompt(history) {
      return applyAssistantReplayForPrompt(history);
    },
    transformModelMessages(_modelId, messages) {
      return messages;
    },
    createStreamAdapter(modelId) {
      return createStreamAdapter({ llmId, modelId });
    },
    normalizeSystemPrompts(system) {
      return system;
    },
    getSyntheticResumeUserText() {
      return undefined;
    },
  };
}
