import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import {
  createFetchWithStreamingDefaults,
  getOpenAICompatibleMaxInputTokens,
  getOpenAICompatibleMaxOutputTokens,
  normalizeBaseURL,
  stringMetadata,
  transformOpenAICompatibleRequestBody,
  validOpenAICompatibleModelRecord,
  wrapChatModelErrors,
} from '@kooka/core';

import type { LLMModelInfo, LLMProvider } from '../types.js';

export interface OpenAICompatibleProviderOptions {
  baseURL: string;
  name?: string;
  apiKey?: string;
  defaultModelId?: string;
  timeoutMs?: number;
  allowInsecureTLS?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openaiCompatible';
  readonly name: string;

  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly defaultModelId?: string;
  private readonly timeoutMs?: number;
  private readonly provider;
  private readonly fetchFn: FetchFunction;
  private readonly disposeFetch: () => void;
  private cachedModels: LLMModelInfo[] | null = null;
  private modelLoadPromise: Promise<LLMModelInfo[]> | null = null;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.baseURL?.trim()) {
      throw new Error('OpenAICompatibleProvider requires baseURL');
    }

    this.baseURL = normalizeBaseURL(options.baseURL.trim());
    this.apiKey = options.apiKey?.trim() || undefined;
    this.defaultModelId = options.defaultModelId?.trim() || undefined;
    this.timeoutMs = options.timeoutMs;
    this.name = options.name || 'OpenAI-Compatible';

    const fetchWithDefaults = createFetchWithStreamingDefaults(this.timeoutMs, {
      allowInsecureTLS: options.allowInsecureTLS,
    });
    this.fetchFn = fetchWithDefaults.fetch;
    this.disposeFetch = fetchWithDefaults.dispose;

    this.provider = createOpenAICompatible({
      name: this.id,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      fetch: this.fetchFn,
      includeUsage: true,
      transformRequestBody: transformOpenAICompatibleRequestBody,
    });
  }

  async getModel(modelId: string): Promise<unknown> {
    const requestedModelId = typeof modelId === 'string' ? modelId.trim() : '';
    const resolved = requestedModelId || this.defaultModelId;
    if (!resolved) {
      throw new Error('No model configured. Provide modelId (or defaultModelId).');
    }

    return wrapChatModelErrors(this.provider.chatModel(resolved), {
      provider: this.id,
      modelId: resolved,
    });
  }

  async getModels(): Promise<LLMModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;
    if (this.modelLoadPromise) return this.modelLoadPromise;

    this.modelLoadPromise = this.loadModels();
    try {
      return await this.modelLoadPromise;
    } finally {
      this.modelLoadPromise = null;
    }
  }

  private createDefaultModelInfo(): LLMModelInfo {
    const modelId = this.defaultModelId;
    if (!modelId) {
      throw new Error('OpenAI-compatible default model is not configured');
    }
    return {
      id: modelId,
      name: modelId,
      vendor: 'openai-compatible',
      family: 'local',
    };
  }

  private async loadModels(): Promise<LLMModelInfo[]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchFn(`${this.baseURL}/models`, { headers });
    if (!response.ok) {
      if (this.defaultModelId && (response.status === 404 || response.status === 405 || response.status === 501)) {
        this.cachedModels = [this.createDefaultModelInfo()];
        return this.cachedModels;
      }
      throw new Error(`Failed to list OpenAI-compatible models: HTTP ${response.status}`);
    }

    const payload = await response.json() as unknown;
    const payloadRecord = isRecord(payload) ? payload : undefined;
    const rawModels: unknown[] = Array.isArray(payloadRecord?.data) ? payloadRecord.data : [];
    const seenModelIds = new Set<string>();
    const models: LLMModelInfo[] = [];
    for (const rawModel of rawModels) {
      const model = validOpenAICompatibleModelRecord(rawModel);
      if (!model) continue;

      const modelId = model.id.trim();
      if (seenModelIds.has(modelId)) continue;
      seenModelIds.add(modelId);

      const maxInputTokens = getOpenAICompatibleMaxInputTokens(model);
      const maxOutputTokens = getOpenAICompatibleMaxOutputTokens(model);
      const info: LLMModelInfo = {
        id: modelId,
        name: stringMetadata(model.display_name) || stringMetadata(model.name) || modelId,
        vendor: stringMetadata(model.owned_by) || 'openai-compatible',
        family: 'local',
      };
      if (maxInputTokens !== undefined) {
        info.maxInputTokens = maxInputTokens;
      }
      if (maxOutputTokens !== undefined) {
        info.maxOutputTokens = maxOutputTokens;
      }
      models.push(info);
    }

    if (this.defaultModelId && !models.some((model) => model.id === this.defaultModelId)) {
      models.push(this.createDefaultModelInfo());
    }

    this.cachedModels = models;
    return models;
  }

  dispose(): void {
    this.cachedModels = null;
    this.modelLoadPromise = null;
    this.disposeFetch();
  }
}
