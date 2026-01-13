import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { LLMProvider } from '../core/types';
import type { ModelInfo } from './copilot';
import { Agent, fetch as undiciFetch } from 'undici';

export interface OpenAICompatibleProviderOptions {
  baseURL: string;
  name?: string;
  apiKey?: string;
  defaultModelId?: string;
  modelDisplayNames?: Record<string, string>;
  timeoutMs?: number;
}

function normalizeBaseURL(input: string): string {
  return input.replace(/\/+$/, '');
}

function toHeaderRecord(initHeaders: unknown): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!initHeaders) return headers;

  if (Array.isArray(initHeaders)) {
    for (const [k, v] of initHeaders) headers[String(k)] = String(v);
    return headers;
  }

  if (initHeaders instanceof Headers) {
    for (const [k, v] of initHeaders.entries()) headers[k] = v;
    return headers;
  }

  if (typeof initHeaders === 'object') {
    Object.assign(headers, initHeaders as Record<string, string>);
  }

  return headers;
}

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as any)?.any;
  if (typeof any === 'function') {
    return any(signals);
  }

  if (signals.length === 1) return signals[0];

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

type FetchWithDefaults = { fetch: FetchFunction; dispose: () => void };

function createFetchWithStreamingDefaults(timeoutMs?: number): FetchWithDefaults {
  const timeoutValue = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const dispatcher = new Agent({ bodyTimeout: 0 });

  const fetchFn: FetchFunction = (input, init?) => {
    const headers: Record<string, string> = {};

    Object.assign(headers, toHeaderRecord(init?.headers));

    // Some local OpenAI-compatible servers misbehave with compressed SSE streams.
    // Disabling compression also avoids undici reporting truncated decompression as "terminated".
    if (!('accept-encoding' in headers) && !('Accept-Encoding' in headers)) {
      headers['accept-encoding'] = 'identity';
    }

    const signals: AbortSignal[] = [];
    if (init?.signal) signals.push(init.signal);

    if (timeoutValue > 0) {
      const timeoutFn = (AbortSignal as any)?.timeout;
      if (typeof timeoutFn === 'function') {
        signals.push(timeoutFn(timeoutValue));
      }
    }

    const signal = signals.length > 0 ? combineAbortSignals(signals) : undefined;

    return undiciFetch(input as any, { ...(init as any), dispatcher, headers, signal } as any) as any;
  };

  return { fetch: fetchFn, dispose: () => dispatcher.close() };
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
      throw new Error(`Failed to list models: ${response.status} ${text}`);
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
