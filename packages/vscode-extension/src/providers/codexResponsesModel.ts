import type { FetchFunction } from '@ai-sdk/provider-utils';
import { createResponsesModel } from './responsesModel';

export type CodexResponsesModelOptions = {
  baseURL: string;
  apiKey: string;
  modelId: string;
  headers: Record<string, string>;
  provider?: string;
  fetch?: FetchFunction;
  errorLabel?: string;
};

export function createCodexResponsesModel(options: CodexResponsesModelOptions) {
  return createResponsesModel({
    ...options,
    provider: options.provider ?? 'codexSubscription',
    errorLabel: options.errorLabel ?? 'ChatGPT Codex',
    behavior: {
      providerOptionKeys: ['openai', 'codexSubscription'],
      systemPromptMode: 'instructions',
      includeSamplingOptions: false,
    },
  });
}
