import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import {
  getOpenAICompatibleMaxInputTokens,
  getOpenAICompatibleMaxOutputTokens,
  shouldUseResponsesApiForModelId,
  stringMetadata,
  transformOpenAICompatibleRequestBody,
  validOpenAICompatibleModelRecord,
  type OpenAICompatibleModelRecord,
} from '@kooka/core';
import type { LLMProvider } from '../core/types';
import { normalizeResponsesStreamModel } from '../core/utils/normalizeResponsesStream';
import { wrapChatModelErrors } from './chatModelErrors';
import { createFallbackModelInfo, type ModelInfo } from './modelCatalog';
import { createFetchWithStreamingDefaults, normalizeBaseURL } from './openaiFetch';
import { createOpenAICompatibleResponsesModel } from './openaiCompatibleResponsesModel';
import { createProviderHttpError, fetchProviderResponse, isProviderAbortError, isProviderAuthError, parseProviderJsonResponse, readProviderResponseBody } from './providerErrors';

export interface OpenAICompatibleProviderOptions {
  baseURL: string;
  name?: string;
  apiKey?: string;
  defaultModelId?: string;
  modelDisplayNames?: Record<string, string>;
  fallbackMaxInputTokens?: number;
  fallbackMaxOutputTokens?: number;
  timeoutMs?: number;
  allowInsecureTLS?: boolean;
  fetch?: FetchFunction;
  createResponsesModel?: typeof createOpenAICompatibleResponsesModel;
}

type OpenAICompatibleModelsResponse = {
  data: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidOpenAICompatibleModelMessage(index: number, value: unknown): string | undefined {
  if (!isRecord(value)) return `model list entry ${index} must be a JSON object`;
  if (typeof value.id !== 'string' || !value.id.trim()) return `model list entry ${index} missing id`;
  return undefined;
}

function validateOpenAICompatibleModelsPayload(value: unknown): string | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record) return 'model list response must be a JSON object';
  if (!Array.isArray(record.data)) return 'model list response missing data array';

  let firstInvalidMessage: string | undefined;
  let validCount = 0;

  for (const [index, item] of record.data.entries()) {
    if (validOpenAICompatibleModelRecord(item)) {
      validCount += 1;
      continue;
    }
    firstInvalidMessage ??= invalidOpenAICompatibleModelMessage(index, item);
  }

  if (validCount === 0 && firstInvalidMessage) return firstInvalidMessage;
  return undefined;
}

function isUnsupportedModelListStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

function isTransientModelListStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 529
  );
}

function getProviderErrorString(error: unknown, keys: string[]): string | undefined {
  const record = isRecord(error) ? error : undefined;
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isTransientModelListFetchError(error: unknown): boolean {
  if (isProviderAbortError(error)) return false;

  const type = getProviderErrorString(error, ['type', 'errorType'])?.toLowerCase();
  const code = getProviderErrorString(error, ['code', 'errorCode'])?.toLowerCase();

  return type === 'network_error' || type === 'timeout' || code === 'network_error' || code === 'request_timeout';
}

function shouldUseDefaultModelFallback(error: unknown, status?: number): boolean {
  return !isProviderAbortError(error) && !isProviderAuthError(error) && (
    (typeof status === 'number' && (isUnsupportedModelListStatus(status) || isTransientModelListStatus(status))) ||
    isTransientModelListFetchError(error)
  );
}

function shouldCacheDefaultModelFallback(error: unknown, status?: number): boolean {
  return !isProviderAbortError(error) && !isProviderAuthError(error) && (
    typeof status === 'number' && isUnsupportedModelListStatus(status)
  );
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openaiCompatible';
  readonly name: string;

  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly defaultModelId?: string;
  private readonly modelDisplayNames: Record<string, string>;
  private readonly fallbackMaxInputTokens?: number;
  private readonly fallbackMaxOutputTokens?: number;
  private readonly timeoutMs?: number;
  private readonly createResponsesModel: typeof createOpenAICompatibleResponsesModel;
  private readonly provider;
  private readonly fetchFn: FetchFunction;
  private readonly disposeFetch: () => void;

  private cachedModels: ModelInfo[] | null = null;
  private modelLoadPromise: Promise<ModelInfo[]> | null = null;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.baseURL?.trim()) {
      throw new Error('OpenAICompatibleProvider requires baseURL');
    }

    this.baseURL = normalizeBaseURL(options.baseURL.trim());
    this.apiKey = options.apiKey?.trim() || undefined;
    this.defaultModelId = options.defaultModelId?.trim() || undefined;
    this.modelDisplayNames = options.modelDisplayNames || {};
    this.fallbackMaxInputTokens = options.fallbackMaxInputTokens;
    this.fallbackMaxOutputTokens = options.fallbackMaxOutputTokens;
    this.timeoutMs = options.timeoutMs;
    this.createResponsesModel = options.createResponsesModel ?? createOpenAICompatibleResponsesModel;
    this.name = options.name || 'OpenAI-Compatible (Local)';

    if (options.fetch) {
      this.fetchFn = options.fetch;
      this.disposeFetch = () => {};
    } else {
      const fetchWithDefaults = createFetchWithStreamingDefaults(this.timeoutMs, {
        allowInsecureTLS: options.allowInsecureTLS,
      });
      this.fetchFn = fetchWithDefaults.fetch;
      this.disposeFetch = fetchWithDefaults.dispose;
    }
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
      throw new Error('No model configured. Set lingyun.model or lingyun.openaiCompatible.defaultModelId.');
    }

    if (shouldUseResponsesApiForModelId(resolved)) {
      const raw = this.createResponsesModel({
        baseURL: this.baseURL,
        apiKey: this.apiKey,
        modelId: resolved,
        fetch: this.fetchFn,
      });
      return normalizeResponsesStreamModel(raw, { canonicalizeTextPartIds: true });
    }

    return wrapChatModelErrors(this.provider.chatModel(resolved), {
      provider: this.id,
      modelId: resolved,
    });
  }

  async getModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;
    if (this.modelLoadPromise) return this.modelLoadPromise;

    this.modelLoadPromise = this.loadModels();
    try {
      return await this.modelLoadPromise;
    } finally {
      this.modelLoadPromise = null;
    }
  }

  private async loadModels(): Promise<ModelInfo[]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const modelsUrl = `${this.baseURL}/models`;
    let response: Response;
    try {
      response = await fetchProviderResponse(this.fetchFn, modelsUrl, { headers }, {
        message: 'Failed to fetch model list',
        url: modelsUrl,
        provider: this.id,
      });
    } catch (error) {
      if (this.defaultModelId && shouldUseDefaultModelFallback(error)) {
        const fallbackModels = [this.createDefaultModelInfo()];
        if (shouldCacheDefaultModelFallback(error)) {
          this.cachedModels = fallbackModels;
        }
        return fallbackModels;
      }
      throw error;
    }
    if (!response.ok) {
      const text = await readProviderResponseBody(response);
      const error = createProviderHttpError({
        message: 'Failed to list models',
        url: modelsUrl,
        response,
        responseBody: text,
        provider: this.id,
      });
      if (this.defaultModelId && shouldUseDefaultModelFallback(error, response.status)) {
        const fallbackModels = [this.createDefaultModelInfo()];
        if (shouldCacheDefaultModelFallback(error, response.status)) {
          this.cachedModels = fallbackModels;
        }
        return fallbackModels;
      }
      throw error;
    }

    if (response.status === 204) {
      this.cachedModels = this.defaultModelId ? [this.createDefaultModelInfo()] : [];
      return this.cachedModels;
    }

    const data = await parseProviderJsonResponse<OpenAICompatibleModelsResponse>({
      message: 'Failed to parse model list',
      url: modelsUrl,
      response,
      provider: this.id,
      validate: validateOpenAICompatibleModelsPayload,
    });
    const rawModels = data.data;

    const seenModelIds = new Set<string>();
    const models: ModelInfo[] = [];
    for (const rawModel of rawModels) {
      const model = validOpenAICompatibleModelRecord(rawModel);
      if (!model) continue;

      const modelId = model.id.trim();
      if (seenModelIds.has(modelId)) continue;
      seenModelIds.add(modelId);

      models.push(createFallbackModelInfo(modelId, {
        name: this.modelDisplayNames[modelId] || stringMetadata(model.display_name) || stringMetadata(model.name) || modelId,
        vendor: stringMetadata(model.owned_by) || 'openai-compatible',
        family: 'local',
        maxInputTokens: getOpenAICompatibleMaxInputTokens(model) ?? this.fallbackMaxInputTokens,
        maxOutputTokens: getOpenAICompatibleMaxOutputTokens(model) ?? this.fallbackMaxOutputTokens,
      }));
    }

    if (this.defaultModelId && !seenModelIds.has(this.defaultModelId)) {
      models.push(this.createDefaultModelInfo());
    }

    this.cachedModels = models;
    return models;
  }

  private createDefaultModelInfo(): ModelInfo {
    const modelId = this.defaultModelId;
    if (!modelId) {
      throw new Error('OpenAI-compatible default model is not configured');
    }
    return createFallbackModelInfo(modelId, {
      name: this.modelDisplayNames[modelId] || modelId,
      vendor: 'openai-compatible',
      family: 'local',
      maxInputTokens: this.fallbackMaxInputTokens,
      maxOutputTokens: this.fallbackMaxOutputTokens,
    });
  }

  clearModelCache(): void {
    this.cachedModels = null;
    this.modelLoadPromise = null;
  }

  dispose(): void {
    this.cachedModels = null;
    this.modelLoadPromise = null;
    this.disposeFetch();
  }
}
