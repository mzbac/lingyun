import type { ModelMessage } from 'ai';

import type { AgentHistoryMessage } from '@kooka/core';
import {
  applyAssistantReplayForPrompt,
  applyCopilotImageInputPattern,
  applyCopilotReasoningFields,
  applyOpenAICompatibleReasoningField,
  isCopilotResponsesModelId,
} from '@kooka/core';

import { createStreamAdapter, type StreamAdapter } from './streamAdapters.js';

export type ProviderBehavior = {
  /**
   * Provider-specific providerOptions to pass to `streamText()`.
   */
  getChatProviderOptions: (modelId: string, params: { reasoningEffort: string }) => unknown;
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
};

export function createProviderBehavior(llmId: string): ProviderBehavior {
  function getGpt5ReasoningEffort(modelId: string, params: { reasoningEffort: string }): string | undefined {
    const reasoningEffort = String(params.reasoningEffort || '').trim();
    if (!reasoningEffort) return undefined;

    const lower = String(modelId || '').trim().toLowerCase();
    return lower.startsWith('gpt-5') ? reasoningEffort : undefined;
  }

  if (llmId === 'copilot') {
    return {
      getChatProviderOptions(modelId, params) {
        const reasoningEffort = getGpt5ReasoningEffort(modelId, params);
        if (!reasoningEffort) return undefined;

        const providerOptions: Record<string, unknown> = {
          copilot: { reasoningEffort },
        };

        // Copilot's /responses path expects the OpenAI Responses providerOptions namespace.
        if (isCopilotResponsesModelId(modelId)) {
          providerOptions.openai = { reasoningEffort };
        }

        return providerOptions;
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
    };
  }

  if (llmId === 'codexSubscription') {
    return {
      getChatProviderOptions(modelId, params) {
        const reasoningEffort = getGpt5ReasoningEffort(modelId, params);
        if (!reasoningEffort) return undefined;

        return {
          codexSubscription: { reasoningEffort },
          openai: { reasoningEffort },
        };
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
    };
  }

  if (llmId === 'openaiCompatible') {
    return {
      getChatProviderOptions() {
        return undefined;
      },
      prepareHistoryForPrompt(history) {
        return applyAssistantReplayForPrompt(history);
      },
      transformModelMessages(_modelId, messages) {
        return applyOpenAICompatibleReasoningField(messages);
      },
      createStreamAdapter(modelId) {
        return createStreamAdapter({ llmId: 'openaiCompatible', modelId });
      },
      normalizeSystemPrompts(system) {
        if (system.length <= 1) return system;
        return [system.filter(Boolean).join('\n')];
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
  };
}
