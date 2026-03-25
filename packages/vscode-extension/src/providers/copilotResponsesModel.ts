import { createResponsesModel } from './responsesModel';

type CopilotResponsesModelOptions = {
  baseURL: string;
  apiKey: string;
  modelId: string;
  headers: Record<string, string>;
};

export function createCopilotResponsesModel(options: CopilotResponsesModelOptions) {
  return createResponsesModel({
    ...options,
    provider: 'copilot',
    errorLabel: 'Copilot Responses',
    behavior: {
      providerOptionKeys: ['openai', 'copilot'],
      systemPromptMode: 'input',
      includeSamplingOptions: true,
      reasoningReplayProviderKey: 'copilot',
      finishProviderMetadataKey: 'copilot',
    },
  });
}
