import type { FetchFunction } from '@ai-sdk/provider-utils';
import { createResponsesModel } from './responsesModel';

export type OpenAICompatibleResponsesModelOptions = {
  baseURL: string;
  apiKey?: string;
  modelId: string;
  headers?: Record<string, string>;
  fetch?: FetchFunction;
};

export function createOpenAICompatibleResponsesModel(options: OpenAICompatibleResponsesModelOptions) {
  return createResponsesModel({
    ...options,
    headers: options.headers ?? {},
    provider: 'openaiCompatible',
    errorLabel: 'OpenAI-compatible Responses',
    behavior: {
      providerOptionKeys: ['openaiCompatible', 'openai'],
      systemPromptMode: 'instructions',
      includeSamplingOptions: true,
      finishProviderMetadataKey: 'openaiCompatible',
    },
  });
}
