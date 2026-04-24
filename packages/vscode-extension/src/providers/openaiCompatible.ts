import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { LLMProvider } from '../core/types';
import type { ModelInfo } from './modelCatalog';
import { createFetchWithStreamingDefaults, normalizeBaseURL } from './openaiFetch';
import { createProviderHttpError } from './providerErrors';

export interface OpenAICompatibleProviderOptions {
  baseURL: string;
  name?: string;
  apiKey?: string;
  defaultModelId?: string;
  modelDisplayNames?: Record<string, string>;
  timeoutMs?: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openaiCompatible';
  readonly name: string;

  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly defaultModelId?: string;
  private readonly modelDisplayNames: Record<string, string>;
  private readonly timeoutMs?: number;
  private readonly provider;
  private readonly fetchFn: FetchFunction;
  private readonly disposeFetch: () => void;

  private cachedModels: ModelInfo[] | null = null;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.baseURL?.trim()) {
      throw new Error('OpenAICompatibleProvider requires baseURL');
    }

    this.baseURL = normalizeBaseURL(options.baseURL);
    this.apiKey = options.apiKey;
    this.defaultModelId = options.defaultModelId;
    this.modelDisplayNames = options.modelDisplayNames || {};
    this.timeoutMs = options.timeoutMs;
    this.name = options.name || 'OpenAI-Compatible (Local)';

    const fetchWithDefaults = createFetchWithStreamingDefaults(this.timeoutMs);
    this.fetchFn = fetchWithDefaults.fetch;
    this.disposeFetch = fetchWithDefaults.dispose;
    this.provider = createOpenAICompatible({
      name: this.name,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      fetch: this.fetchFn,
      includeUsage: true,
    });
  }

  async getModel(modelId: string): Promise<unknown> {
    const resolved = modelId || this.defaultModelId;
    if (!resolved) {
      throw new Error('No model configured. Set lingyun.model or lingyun.openaiCompatible.defaultModelId.');
    }

    return this.provider.chatModel(resolved);
  }

  async getModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchFn(`${this.baseURL}/models`, { headers });
    if (!response.ok) {
      const text = await response.text();
      throw createProviderHttpError({
        message: `Failed to list models: ${response.status} ${text}`,
        url: `${this.baseURL}/models`,
        response,
        responseBody: text,
      });
    }

    const data = (await response.json()) as { data?: Array<{ id: string; owned_by?: string }> };

    const models = (data.data || []).map(m => ({
      id: m.id,
      name: this.modelDisplayNames[m.id] || m.id,
      vendor: m.owned_by || 'openai-compatible',
      family: 'local',
    }));

    this.cachedModels = models;
    return models;
  }

  clearModelCache(): void {
    this.cachedModels = null;
  }

  dispose(): void {
    this.cachedModels = null;
    this.disposeFetch();
  }
}
