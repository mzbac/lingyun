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

export type ChatProviderOptionParams = {
  reasoningEffort: string;
  textVerbosity: string;
  openaiCompatibleThinking?: string;
};

export type ProviderBehavior = {
  /**
   * Provider-specific providerOptions to pass to `streamText()`.
   */
  getChatProviderOptions: (modelId: string, params: ChatProviderOptionParams) => unknown;
  /**
   * Provider-specific history transforms before `convertToModelMessages()`.
   */
  prepareHistoryForPrompt: (
    history: AgentHistoryMessage[],
    modelId: string,
    params: ChatProviderOptionParams,
  ) => AgentHistoryMessage[];
  /**
   * Provider-specific transforms after `convertToModelMessages()`.
   */
  transformModelMessages: (modelId: string, messages: ModelMessage[], params: ChatProviderOptionParams) => ModelMessage[];
  /**
   * Whether provider-emitted reasoning deltas should be treated as visible assistant text.
   */
  shouldTreatReasoningAsText: (modelId: string, params: ChatProviderOptionParams) => boolean;
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

  function getOpenAICompatibleThinkingMode(params: Pick<ChatProviderOptionParams, 'openaiCompatibleThinking'>): 'auto' | 'disabled' | 'enabled' {
    const normalized = String(params.openaiCompatibleThinking || '').trim().toLowerCase();
    if (normalized === 'disabled' || normalized === 'off' || normalized === 'false') return 'disabled';
    if (normalized === 'enabled' || normalized === 'on' || normalized === 'true') return 'enabled';
    return 'auto';
  }

  function isDeepSeekFamilyModel(modelId: string): boolean {
    const normalized = normalizeModelId(modelId);
    return /(^|[/:_-])deepseek([/:_-]|$)/.test(normalized);
  }

  function isDeepSeekReasoningModel(modelId: string): boolean {
    const normalized = normalizeModelId(modelId);
    if (!isDeepSeekFamilyModel(normalized)) return false;
    return (
      /(^|[/:_-])deepseek([/:_-])?reasoner([/:_-]|$)/.test(normalized) ||
      /(^|[/:_-])deepseek([/:_-])?r1([/:_-]|$)/.test(normalized) ||
      /(^|[/:_-])r1([/:_-]|$)/.test(normalized)
    );
  }

  function isDeepSeekNonReasoningChatModel(modelId: string): boolean {
    const normalized = normalizeModelId(modelId);
    if (/(^|[/:_-])ds[-_]?4([/:_-]|$)/.test(normalized)) return true;
    return isDeepSeekFamilyModel(normalized) && !isDeepSeekReasoningModel(normalized);
  }

  function getOpenAICompatibleThinkValue(modelId: string, params: ChatProviderOptionParams): boolean | undefined {
    if (shouldUseResponsesApiForModelId(modelId)) return undefined;

    const mode = getOpenAICompatibleThinkingMode(params);
    if (mode === 'disabled') return false;
    if (mode === 'enabled') return true;
    return isDeepSeekNonReasoningChatModel(modelId) ? false : undefined;
  }

  function isOpenAICompatibleThinkingDisabled(modelId: string, params: ChatProviderOptionParams): boolean {
    return getOpenAICompatibleThinkValue(modelId, params) === false;
  }

  function shouldReplayOpenAICompatibleReasoning(modelId: string, params: ChatProviderOptionParams): boolean {
    const think = getOpenAICompatibleThinkValue(modelId, params);
    if (think === false) return false;
    if (think === true) return true;
    return !isDeepSeekNonReasoningChatModel(modelId) && !isDeepSeekReasoningModel(modelId);
  }

  function omitEmptyProviderOptions(options: Record<string, unknown>): Record<string, unknown> | undefined {
    let next: Record<string, unknown> | undefined;
    for (const key in options) {
      if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
      const value = options[key];
      if (!value || typeof value !== 'object') continue;

      let hasProviderOption = false;
      for (const optionKey in value as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(value, optionKey)) continue;
        hasProviderOption = true;
        break;
      }
      if (!hasProviderOption) continue;

      if (!next) next = {};
      next[key] = value;
    }
    return next;
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
      shouldTreatReasoningAsText() {
        return false;
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
          codexSubscription.reasoningSummary = 'auto';
          openai.reasoningEffort = reasoningEffort;
          openai.reasoningSummary = 'auto';
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
      shouldTreatReasoningAsText() {
        return false;
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
        if (!shouldUseResponsesApiForModelId(modelId)) {
          const openaiCompatible: Record<string, unknown> = {};
          const think = getOpenAICompatibleThinkValue(modelId, params);
          if (typeof think === 'boolean') openaiCompatible.think = think;
          return omitEmptyProviderOptions({ openaiCompatible });
        }
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
      prepareHistoryForPrompt(history, modelId, params) {
        return applyAssistantReplayForPrompt(history, {
          includeReasoning: shouldReplayOpenAICompatibleReasoning(modelId, params),
        });
      },
      transformModelMessages(modelId, messages, params) {
        return shouldUseResponsesApiForModelId(modelId)
          ? messages
          : applyOpenAICompatibleReasoningField(messages, {
              includeReasoning: shouldReplayOpenAICompatibleReasoning(modelId, params),
            });
      },
      shouldTreatReasoningAsText(modelId, params) {
        return isOpenAICompatibleThinkingDisabled(modelId, params);
      },
      createStreamAdapter(modelId) {
        return createStreamAdapter({ llmId: 'openaiCompatible', modelId });
      },
      normalizeSystemPrompts(system) {
        if (system.length <= 1) return system;
        let combined = '';
        for (const part of system) {
          if (!part) continue;
          combined = combined ? `${combined}\n${part}` : part;
        }
        return [combined];
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
    shouldTreatReasoningAsText() {
      return false;
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
