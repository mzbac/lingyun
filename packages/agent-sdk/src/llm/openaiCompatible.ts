import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { Agent, fetch as undiciFetch } from 'undici';
import { transformOpenAICompatibleRequestBody, wrapChatModelErrors } from '@kooka/core';

import type { LLMModelInfo, LLMProvider } from '../types.js';
import { combineAbortSignals, timeoutSignal } from '../abort.js';

export interface OpenAICompatibleProviderOptions {
  baseURL: string;
  name?: string;
  apiKey?: string;
  defaultModelId?: string;
  timeoutMs?: number;
  allowInsecureTLS?: boolean;
}

type OpenAICompatibleModelRecord = {
  id?: unknown;
  owned_by?: unknown;
  name?: unknown;
  display_name?: unknown;
  context_length?: unknown;
  contextLength?: unknown;
  context_window?: unknown;
  contextWindow?: unknown;
  max_context_window?: unknown;
  maxContextWindow?: unknown;
  max_model_len?: unknown;
  maxModelLen?: unknown;
  max_input_tokens?: unknown;
  maxInputTokens?: unknown;
  input_token_limit?: unknown;
  inputTokenLimit?: unknown;
  max_output_tokens?: unknown;
  maxOutputTokens?: unknown;
  max_completion_tokens?: unknown;
  maxCompletionTokens?: unknown;
  output_token_limit?: unknown;
  outputTokenLimit?: unknown;
  max_tokens?: unknown;
  maxTokens?: unknown;
  model_info?: unknown;
  modelInfo?: unknown;
  litellm_params?: unknown;
  litellmParams?: unknown;
  top_provider?: unknown;
  topProvider?: unknown;
  metadata?: unknown;
};

const OPENAI_COMPATIBLE_NESTED_METADATA_KEYS = [
  'model_info',
  'modelInfo',
  'litellm_params',
  'litellmParams',
  'top_provider',
  'topProvider',
  'metadata',
] as const;

const OPENAI_COMPATIBLE_MAX_INPUT_TOKEN_KEYS = [
  'max_input_tokens',
  'maxInputTokens',
  'input_token_limit',
  'inputTokenLimit',
  'context_length',
  'contextLength',
  'context_window',
  'contextWindow',
  'max_context_window',
  'maxContextWindow',
  'max_model_len',
  'maxModelLen',
  'max_tokens',
  'maxTokens',
] as const;

const OPENAI_COMPATIBLE_MAX_OUTPUT_TOKEN_KEYS = [
  'max_output_tokens',
  'maxOutputTokens',
  'max_completion_tokens',
  'maxCompletionTokens',
  'output_token_limit',
  'outputTokenLimit',
  'max_tokens',
  'maxTokens',
] as const;

function normalizeBaseURL(input: string): string {
  return input.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveFiniteRecordMetadataNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = positiveFiniteNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function positiveFiniteModelMetadataNumber(model: OpenAICompatibleModelRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = positiveFiniteNumber(model[key as keyof OpenAICompatibleModelRecord]);
    if (value !== undefined) return value;
  }

  for (const nestedKey of OPENAI_COMPATIBLE_NESTED_METADATA_KEYS) {
    const nested = model[nestedKey];
    if (!isRecord(nested)) continue;

    const value = positiveFiniteRecordMetadataNumber(nested, keys);
    if (value !== undefined) return value;
  }

  return undefined;
}

function getOpenAICompatibleMaxInputTokens(model: OpenAICompatibleModelRecord): number | undefined {
  return positiveFiniteModelMetadataNumber(model, OPENAI_COMPATIBLE_MAX_INPUT_TOKEN_KEYS);
}

function getOpenAICompatibleMaxOutputTokens(model: OpenAICompatibleModelRecord): number | undefined {
  return positiveFiniteModelMetadataNumber(model, OPENAI_COMPATIBLE_MAX_OUTPUT_TOKEN_KEYS);
}

function validOpenAICompatibleModelRecord(value: unknown): (OpenAICompatibleModelRecord & { id: string }) | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'string' || !value.id.trim()) return undefined;
  return value as OpenAICompatibleModelRecord & { id: string };
}

const hasOwnHeader = Object.prototype.hasOwnProperty;

function setHeader(headers: Record<string, string>, name: unknown, value: unknown): void {
  if (value === undefined || value === null) return;
  const key = String(name).trim();
  if (!key) return;

  const normalized = key.toLowerCase();
  for (const existing in headers) {
    if (!hasOwnHeader.call(headers, existing)) continue;
    if (existing.toLowerCase() === normalized) delete headers[existing];
  }

  headers[key] = String(value);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  for (const key in headers) {
    if (!hasOwnHeader.call(headers, key)) continue;
    if (key.toLowerCase() === normalized) return true;
  }
  return false;
}

function isRequestInput(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function inputHeaders(input: unknown): Headers | undefined {
  return isRequestInput(input) ? input.headers : undefined;
}

function requestInputUrl(input: string | URL | Request): string | URL {
  return isRequestInput(input) ? input.url : input;
}

type RequestInputInit = RequestInit & {
  cache?: Request['cache'];
  credentials?: Request['credentials'];
  duplex?: 'half';
  integrity?: Request['integrity'];
  keepalive?: Request['keepalive'];
  mode?: Request['mode'];
  redirect?: Request['redirect'];
  referrer?: Request['referrer'];
  referrerPolicy?: Request['referrerPolicy'];
};

function requestInputInit(input: string | URL | Request): RequestInputInit {
  if (!isRequestInput(input)) return {};

  const init: RequestInputInit = {
    cache: input.cache,
    credentials: input.credentials,
    integrity: input.integrity,
    keepalive: input.keepalive,
    method: input.method,
    mode: input.mode,
    redirect: input.redirect,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    signal: input.signal,
  };

  if (input.body) {
    init.body = input.body;
    init.duplex = 'half';
  }

  return init;
}

function mergeHeaders(headers: Record<string, string>, initHeaders: unknown): void {
  if (!initHeaders) return;

  if (Array.isArray(initHeaders)) {
    for (const [k, v] of initHeaders) setHeader(headers, k, v);
    return;
  }

  if (initHeaders instanceof Headers) {
    for (const [k, v] of initHeaders.entries()) setHeader(headers, k, v);
    return;
  }

  if (typeof initHeaders === 'object') {
    const headerRecord = initHeaders as Record<string, unknown>;
    for (const key in headerRecord) {
      if (!hasOwnHeader.call(headerRecord, key)) continue;
      const value = headerRecord[key];
      setHeader(headers, key, value);
    }
  }
}

type FetchWithDefaults = { fetch: FetchFunction; dispose: () => void };

function createFetchWithStreamingDefaults(timeoutMs?: number, options?: { allowInsecureTLS?: boolean }): FetchWithDefaults {
  const timeoutValue = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const dispatcher = new Agent({
    // Streaming model responses can legitimately spend a long time before headers.
    // Use LingYun's AbortSignal timeout below as the single request timeout source.
    bodyTimeout: 0,
    headersTimeout: 0,
    ...(options?.allowInsecureTLS ? { connect: { rejectUnauthorized: false } } : {}),
  });

  const fetchFn: FetchFunction = (input, init?) => {
    const requestDefaults = requestInputInit(input);
    const headers: Record<string, string> = {};

    mergeHeaders(headers, inputHeaders(input));
    mergeHeaders(headers, init?.headers);

    // Some OpenAI-compatible servers misbehave with compressed SSE streams.
    if (!hasHeader(headers, 'accept-encoding')) {
      headers['accept-encoding'] = 'identity';
    }

    const signals: AbortSignal[] = [];
    if (requestDefaults.signal) signals.push(requestDefaults.signal);
    if (init?.signal) signals.push(init.signal);

    if (timeoutValue > 0) {
      signals.push(timeoutSignal(timeoutValue));
    }

    const signal = signals.length > 0 ? combineAbortSignals(signals) : undefined;
    return undiciFetch(requestInputUrl(input) as any, { ...requestDefaults, ...(init as any), dispatcher, headers, signal } as any) as any;
  };

  return { fetch: fetchFn, dispose: () => dispatcher.close() };
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
