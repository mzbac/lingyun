import * as vscode from 'vscode';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { isCopilotResponsesModelId } from '@kooka/core';
import type { LLMProvider } from '../core/types';
import { getDebugSettings } from '../core/debugSettings';
import { appendErrorLog } from '../core/logger';
import { normalizeResponsesStreamModel } from '../core/utils/normalizeResponsesStream';
import { wrapChatModelErrors } from './chatModelErrors';
import { createCopilotResponsesModel } from './copilotResponsesModel';
import type { ModelInfo } from './modelCatalog';
import { createFetchWithStreamingDefaults } from './openaiFetch';
import { createProviderHttpError, fetchProviderResponse, isProviderAuthError, parseProviderJsonResponse, readProviderResponseBody } from './providerErrors';

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

export const MODELS = {
  GPT_5_5: 'gpt-5.5',
  GPT_5_4: 'gpt-5.4',
  GPT_5_3_CODEX: 'gpt-5.3-codex',
  GPT_4_1: 'gpt-4.1',
  GPT_4O: 'gpt-4o',
} as const;

const COPILOT_DEFAULT_MAX_OUTPUT_TOKENS = 128000;

export const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: MODELS.GPT_5_5,
    name: 'GPT-5.5',
    vendor: 'copilot',
    family: 'gpt-5',
    maxInputTokens: 950000,
    maxOutputTokens: COPILOT_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: MODELS.GPT_5_4,
    name: 'GPT-5.4',
    vendor: 'copilot',
    family: 'gpt-5',
    maxInputTokens: 950000,
    maxOutputTokens: COPILOT_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: MODELS.GPT_5_3_CODEX,
    name: 'GPT-5.3 Codex',
    vendor: 'copilot',
    family: 'gpt-codex',
    maxInputTokens: 380000,
    maxOutputTokens: COPILOT_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: MODELS.GPT_4_1,
    name: MODELS.GPT_4_1,
    vendor: 'copilot',
    family: 'gpt-4',
  },
  {
    id: MODELS.GPT_4O,
    name: MODELS.GPT_4O,
    vendor: 'copilot',
    family: 'gpt-4o',
  },
];

type CopilotTokenResponse = {
  token: string;
  expires_at: unknown;
};

function positiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function validateCopilotTokenPayload(value: unknown): string | undefined {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!record) return 'Copilot token response must be a JSON object';
  if (typeof record.token !== 'string' || !record.token.trim()) {
    return 'Copilot token response missing token';
  }
  if (positiveFiniteNumber(record.expires_at) === undefined) {
    return 'Copilot token response expires_at must be a positive number';
  }
  return undefined;
}

function finitePositiveInteger(value: unknown): number | undefined {
  const numeric = positiveFiniteNumber(value);
  return numeric === undefined ? undefined : Math.floor(numeric);
}

function normalizeCopilotModelInfo(model: vscode.LanguageModelChat): ModelInfo | undefined {
  const id = typeof model.id === 'string' ? model.id.trim() : '';
  if (!id) return undefined;

  const maxInputTokens = finitePositiveInteger(model.maxInputTokens);
  const maxOutputTokens = finitePositiveInteger((model as any).maxOutputTokens);

  return {
    id,
    name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id,
    vendor: typeof model.vendor === 'string' && model.vendor.trim() ? model.vendor.trim() : 'copilot',
    family: typeof model.family === 'string' && model.family.trim() ? model.family.trim() : 'unknown',
    ...(maxInputTokens ? { maxInputTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };
}

const FALLBACK_MODEL_MAP = new Map(FALLBACK_MODELS.map((model) => [model.id, model]));

function mergeKnownCopilotFallbackMetadata(model: ModelInfo): ModelInfo {
  const fallback = FALLBACK_MODEL_MAP.get(model.id);
  if (!fallback) return model;

  const maxInputTokens = model.maxInputTokens ?? fallback.maxInputTokens;
  const maxOutputTokens = model.maxOutputTokens ?? fallback.maxOutputTokens;

  return {
    ...model,
    name: model.name && model.name !== model.id ? model.name : fallback.name,
    vendor: model.vendor || fallback.vendor,
    family: model.family && model.family !== 'unknown' ? model.family : fallback.family,
    ...(maxInputTokens ? { maxInputTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };
}

function mergeFallbackCopilotModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const merged: ModelInfo[] = [];

  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(mergeKnownCopilotFallbackMetadata(model));
  }

  for (const fallback of FALLBACK_MODELS) {
    if (seen.has(fallback.id)) continue;
    seen.add(fallback.id);
    merged.push({ ...fallback });
  }

  return merged;
}

export interface CopilotProviderOptions {
  createResponsesModel?: typeof createCopilotResponsesModel;
  outputChannel?: vscode.OutputChannel;
  timeoutMs?: number;
  fetch?: FetchFunction;
  selectChatModels?: typeof vscode.lm.selectChatModels;
}

export class CopilotProvider implements LLMProvider {
  readonly id = 'copilot';
  readonly name = 'GitHub Copilot';

  private readonly createResponsesModel: typeof createCopilotResponsesModel;
  private readonly outputChannel?: vscode.OutputChannel;
  private readonly fetchFn: FetchFunction;
  private readonly disposeFetch: () => void;
  private readonly selectChatModels: typeof vscode.lm.selectChatModels;

  private copilotToken: string | null = null;
  private tokenExpiry: number = 0;
  private copilotTokenPromise: Promise<string> | null = null;
  private cachedModels: ModelInfo[] | null = null;
  private modelLoadPromise: Promise<ModelInfo[]> | null = null;

  private cachedProviderToken: string | null = null;
  private cachedProviderEditorVersion: string | null = null;
  private cachedProviderPluginVersion: string | null = null;
  private provider:
    | ReturnType<typeof createOpenAICompatible>
    | null = null;

  constructor(options?: CopilotProviderOptions) {
    this.createResponsesModel = options?.createResponsesModel ?? createCopilotResponsesModel;
    this.outputChannel = options?.outputChannel;
    this.selectChatModels = options?.selectChatModels ?? ((selector) => vscode.lm.selectChatModels(selector));
    if (options?.fetch) {
      this.fetchFn = options.fetch;
      this.disposeFetch = () => {};
    } else {
      const fetchWithDefaults = createFetchWithStreamingDefaults(options?.timeoutMs);
      this.fetchFn = fetchWithDefaults.fetch;
      this.disposeFetch = fetchWithDefaults.dispose;
    }
  }

  private getEditorVersionHeader(): string {
    const version = typeof vscode.version === 'string' && vscode.version.trim() ? vscode.version.trim() : '0.0.0';
    return `vscode/${version}`;
  }

  private getPluginVersionHeader(): string {
    const ext = vscode.extensions.getExtension('mzbac.lingyun');
    const version = typeof ext?.packageJSON?.version === 'string' && ext.packageJSON.version.trim() ? ext.packageJSON.version.trim() : '0.0.0';
    return `lingyun/${version}`;
  }

  private async getGitHubToken(): Promise<string> {
    const session = await vscode.authentication.getSession('github', ['user:email'], {
      createIfNone: true,
    });

    if (!session) {
      throw new Error('GitHub authentication required');
    }

    return session.accessToken;
  }

  private async getCopilotToken(): Promise<string> {
    if (this.copilotToken && Date.now() < this.tokenExpiry - 60000) {
      return this.copilotToken;
    }
    if (this.copilotTokenPromise) return this.copilotTokenPromise;

    this.copilotTokenPromise = (async () => {
      const githubToken = await this.getGitHubToken();

      const response = await fetchProviderResponse(this.fetchFn, COPILOT_TOKEN_URL, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/json',
        },
      }, {
        message: 'Failed to fetch Copilot token',
        url: COPILOT_TOKEN_URL,
        provider: this.id,
      });

      if (!response.ok) {
        const text = await readProviderResponseBody(response);
        throw createProviderHttpError({
          message: 'Failed to get Copilot token',
          url: COPILOT_TOKEN_URL,
          response,
          responseBody: text,
          provider: this.id,
          redactResponseBody: true,
        });
      }

      const data = await parseProviderJsonResponse<CopilotTokenResponse>({
        message: 'Failed to parse Copilot token response',
        url: COPILOT_TOKEN_URL,
        response,
        provider: this.id,
        redactResponseBody: true,
        validate: validateCopilotTokenPayload,
      });
      const expiresAt = positiveFiniteNumber(data.expires_at);
      if (expiresAt === undefined) {
        throw new Error('Copilot token response expires_at must be a positive number');
      }

      this.copilotToken = data.token;
      this.tokenExpiry = expiresAt * 1000;

      return this.copilotToken;
    })();

    try {
      return await this.copilotTokenPromise;
    } finally {
      this.copilotTokenPromise = null;
    }
  }

  private async ensureProvider(): Promise<void> {
    const token = await this.getCopilotToken();
    const editorVersion = this.getEditorVersionHeader();
    const pluginVersion = this.getPluginVersionHeader();
    const headers = {
      'Editor-Version': editorVersion,
      'Editor-Plugin-Version': pluginVersion,
      'Openai-Organization': 'github-copilot',
      'Copilot-Integration-Id': 'vscode-chat',
    };
    if (
      this.provider &&
      this.cachedProviderToken === token &&
      this.cachedProviderEditorVersion === editorVersion &&
      this.cachedProviderPluginVersion === pluginVersion
    ) {
      return;
    }

    this.cachedProviderToken = token;
    this.cachedProviderEditorVersion = editorVersion;
    this.cachedProviderPluginVersion = pluginVersion;
    this.provider = createOpenAICompatible({
      name: 'copilot',
      baseURL: COPILOT_BASE_URL,
      apiKey: token,
      headers,
      fetch: this.fetchFn,
      includeUsage: true,
    });
  }

  private isAuthError(error: unknown): boolean {
    return isProviderAuthError(error);
  }

  getAuthRetryLabel(error: unknown, _context?: { modelId: string; mode: 'plan' | 'build' }): string | undefined {
    return this.isAuthError(error) ? this.name : undefined;
  }

  onRequestError(error: unknown, _context?: { modelId: string; mode: 'plan' | 'build' }): void {
    // Ensure the next request uses a fresh client instance and re-evaluated headers.
    this.provider = null;
    this.cachedProviderToken = null;
    this.cachedProviderEditorVersion = null;
    this.cachedProviderPluginVersion = null;

    // If the token was rejected, force-refresh it on the next call.
    if (this.isAuthError(error)) {
      this.copilotToken = null;
      this.tokenExpiry = 0;
      this.copilotTokenPromise = null;
    }
  }

  async getModel(modelId: string): Promise<unknown> {
    await this.ensureProvider();
    const requestedModelId = typeof modelId === 'string' ? modelId.trim() : '';
    const resolvedModel = requestedModelId || MODELS.GPT_4O;
    // Route models that require the OpenAI Responses API through `/responses`.
    if (isCopilotResponsesModelId(resolvedModel)) {
      const token = this.cachedProviderToken ?? (await this.getCopilotToken());
      const raw = this.createResponsesModel({
        baseURL: COPILOT_BASE_URL,
        apiKey: token,
        modelId: resolvedModel,
        headers: {
          'Editor-Version': this.cachedProviderEditorVersion ?? this.getEditorVersionHeader(),
          'Editor-Plugin-Version': this.cachedProviderPluginVersion ?? this.getPluginVersionHeader(),
          'Openai-Organization': 'github-copilot',
          'Copilot-Integration-Id': 'vscode-chat',
        },
        fetch: this.fetchFn,
      });
      return normalizeResponsesStreamModel(raw, { canonicalizeTextPartIds: true });
    }

    if (!this.provider) {
      throw new Error('Copilot provider is not initialized');
    }
    return wrapChatModelErrors(this.provider.chatModel(resolvedModel), {
      provider: this.id,
      modelId: resolvedModel,
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
    try {
      const vscodeLmModels = await this.selectChatModels({});
      const discoveredModels = vscodeLmModels
        ?.map((model) => normalizeCopilotModelInfo(model))
        .filter((model): model is ModelInfo => Boolean(model));
      if (discoveredModels && discoveredModels.length > 0) {
        this.cachedModels = mergeFallbackCopilotModels(discoveredModels);
        return this.cachedModels;
      }
    } catch (error) {
      const debug = getDebugSettings().llm;
      if (debug) {
        appendErrorLog(this.outputChannel, 'VSCode LM API not available (falling back to model list)', error, {
          tag: 'Copilot',
        });
      }
    }

    this.cachedModels = FALLBACK_MODELS.map((model) => ({ ...model }));
    return this.cachedModels;
  }

  clearModelCache(): void {
    this.cachedModels = null;
    this.modelLoadPromise = null;
  }

  dispose(): void {
    this.copilotToken = null;
    this.tokenExpiry = 0;
    this.copilotTokenPromise = null;
    this.cachedModels = null;
    this.modelLoadPromise = null;
    this.provider = null;
    this.cachedProviderToken = null;
    this.cachedProviderEditorVersion = null;
    this.cachedProviderPluginVersion = null;
    this.disposeFetch();
  }
}
