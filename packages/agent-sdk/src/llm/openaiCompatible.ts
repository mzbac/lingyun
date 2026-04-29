import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { Agent, fetch as undiciFetch } from 'undici';
import { wrapChatModelErrors } from '@kooka/core';

import type { LLMProvider } from '../types.js';
import { combineAbortSignals, timeoutSignal } from '../abort.js';

export interface OpenAICompatibleProviderOptions {
  baseURL: string;
  name?: string;
  apiKey?: string;
  defaultModelId?: string;
  timeoutMs?: number;
}

function normalizeBaseURL(input: string): string {
  return input.replace(/\/+$/, '');
}

function setHeader(headers: Record<string, string>, name: unknown, value: unknown): void {
  if (value === undefined || value === null) return;
  const key = String(name).trim();
  if (!key) return;

  const normalized = key.toLowerCase();
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === normalized) delete headers[existing];
  }

  headers[key] = String(value);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
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
    for (const [key, value] of Object.entries(initHeaders as Record<string, unknown>)) {
      setHeader(headers, key, value);
    }
  }
}

type FetchWithDefaults = { fetch: FetchFunction; dispose: () => void };

function createFetchWithStreamingDefaults(timeoutMs?: number): FetchWithDefaults {
  const timeoutValue = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const dispatcher = new Agent({ bodyTimeout: 0 });

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

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.baseURL?.trim()) {
      throw new Error('OpenAICompatibleProvider requires baseURL');
    }

    this.baseURL = normalizeBaseURL(options.baseURL.trim());
    this.apiKey = options.apiKey?.trim() || undefined;
    this.defaultModelId = options.defaultModelId?.trim() || undefined;
    this.timeoutMs = options.timeoutMs;
    this.name = options.name || 'OpenAI-Compatible';

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

  dispose(): void {
    this.disposeFetch();
  }
}
