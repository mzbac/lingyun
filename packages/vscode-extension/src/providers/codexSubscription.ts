import * as vscode from 'vscode';

import { normalizeResponsesStreamModel } from '../core/utils/normalizeResponsesStream';
import { createCodexResponsesModel } from './codexResponsesModel';
import {
  CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID,
  CODEX_SUBSCRIPTION_FALLBACK_MODELS,
  type CodexModelsResponse,
  normalizeCodexModelsResponse,
} from './codexSubscriptionModels';
import { OpenAIAccountAuth } from './openaiAccountAuth';
import { createFetchWithStreamingDefaults } from './openaiFetch';
import type { ModelInfo } from './modelCatalog';
import type { LLMProviderWithUi, ProviderAuthStatus } from './providerUi';
import { appendErrorLog } from '../core/logger';

const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_ORIGINATOR = 'lingyun';
const AUTH_SECRET_STORAGE_KEY = 'providers.codexSubscription.auth';

export interface CodexSubscriptionProviderOptions {
  context: vscode.ExtensionContext;
  defaultModelId?: string;
  timeoutMs?: number;
  outputChannel?: vscode.OutputChannel;
}

export class CodexSubscriptionProvider implements LLMProviderWithUi {
  readonly id = 'codexSubscription';
  readonly name = 'ChatGPT Codex Subscription';

  private readonly auth: OpenAIAccountAuth;
  private readonly context: vscode.ExtensionContext;
  private readonly defaultModelId?: string;
  private readonly outputChannel?: vscode.OutputChannel;
  private fetchFn: ReturnType<typeof createFetchWithStreamingDefaults>['fetch'];
  private readonly disposeFetch: () => void;

  private cachedModels: ModelInfo[] | null = null;
  private modelLoadPromise: Promise<ModelInfo[]> | null = null;

  constructor(options: CodexSubscriptionProviderOptions) {
    this.context = options.context;
    this.defaultModelId = options.defaultModelId || CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID;
    this.outputChannel = options.outputChannel;
    const fetchWithDefaults = createFetchWithStreamingDefaults(options.timeoutMs);
    this.fetchFn = fetchWithDefaults.fetch;
    this.disposeFetch = fetchWithDefaults.dispose;
    this.auth = new OpenAIAccountAuth({
      context: options.context,
      secretStorageKey: AUTH_SECRET_STORAGE_KEY,
      providerName: this.name,
      clientId: CODEX_CLIENT_ID,
      issuer: OPENAI_AUTH_ISSUER,
      authorizeParams: {
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: CODEX_ORIGINATOR,
      },
      browserInstructions: 'Complete ChatGPT authorization in your browser.',
      redirectPort: 1455,
      redirectPath: '/auth/callback',
      useExternalUri: false,
    });
  }

  private isAuthError(error: unknown): boolean {
    const statusCode = (() => {
      const candidates = [
        (error as any)?.status,
        (error as any)?.statusCode,
        (error as any)?.response?.status,
        (error as any)?.cause?.status,
        (error as any)?.cause?.statusCode,
      ];

      for (const value of candidates) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }
      }

      return undefined;
    })();

    const message = error instanceof Error ? error.message : String(error);
    return (
      statusCode === 401 ||
      statusCode === 403 ||
      /\b401\b/i.test(message) ||
      /\b403\b/i.test(message) ||
      /unauthori[sz]ed|forbidden|invalid token|expired/i.test(message)
    );
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const state = await this.auth.getAuthState();
    return {
      ...state,
      primaryActionLabel: state.authenticated ? undefined : 'Sign in',
      secondaryActionLabel: state.authenticated ? 'Sign out' : undefined,
    };
  }

  async authenticate(): Promise<void> {
    await this.auth.authenticate();
    this.clearModelCache();
  }

  async disconnect(): Promise<void> {
    await this.auth.disconnect();
    this.clearModelCache();
  }

  getAuthRetryLabel(error: unknown, _context?: { modelId: string; mode: 'plan' | 'build' }): string | undefined {
    return this.isAuthError(error) ? this.name : undefined;
  }

  onRequestError(error: unknown, _context?: { modelId: string; mode: 'plan' | 'build' }): void {
    if (this.isAuthError(error)) {
      this.auth.invalidateAccessToken();
      this.clearModelCache();
    }
  }

  private getExtensionVersion(): string {
    return typeof this.context.extension?.packageJSON?.version === 'string'
      ? this.context.extension.packageJSON.version.trim() || '0.0.0'
      : '0.0.0';
  }

  private createRequestHeaders(session: { accountId?: string }): Record<string, string> {
    const headers: Record<string, string> = {
      originator: CODEX_ORIGINATOR,
      'User-Agent': `lingyun/${this.getExtensionVersion()}`,
      session_id: crypto.randomUUID(),
    };
    if (session.accountId) {
      headers['ChatGPT-Account-Id'] = session.accountId;
    }
    return headers;
  }

  async getModel(modelId: string): Promise<unknown> {
    const session = await this.auth.getValidSession();
    const resolved = modelId || this.defaultModelId;
    if (!resolved) {
      throw new Error('No model configured. Set lingyun.model or lingyun.codexSubscription.defaultModelId.');
    }

    const raw = createCodexResponsesModel({
      baseURL: CODEX_BASE_URL,
      apiKey: session.accessToken,
      modelId: resolved,
      headers: this.createRequestHeaders(session),
      fetch: this.fetchFn,
      errorLabel: this.name,
      provider: this.id,
    });
    return normalizeResponsesStreamModel(raw, { canonicalizeTextPartIds: true });
  }

  async getModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;
    if (this.modelLoadPromise) return this.modelLoadPromise;

    this.modelLoadPromise = (async () => {
      try {
        const session = await this.auth.getValidSession();
        const url = new URL(`${CODEX_BASE_URL}/models`);
        url.searchParams.set('client_version', this.getExtensionVersion());

        const response = await this.fetchFn(url.toString(), {
          headers: {
            ...this.createRequestHeaders(session),
            Authorization: `Bearer ${session.accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const text = await response.text();
          throw Object.assign(new Error(`Failed to list Codex models: ${response.status} ${text}`), {
            status: response.status,
          });
        }

        const payload = (await response.json()) as CodexModelsResponse;
        this.cachedModels = normalizeCodexModelsResponse(payload);
        return this.cachedModels;
      } catch (error) {
        if (this.isAuthError(error)) {
          this.auth.invalidateAccessToken();
        }
        appendErrorLog(this.outputChannel, 'Failed to load Codex models (falling back to bundled list)', error, {
          tag: 'Codex',
        });
      }

      this.cachedModels = CODEX_SUBSCRIPTION_FALLBACK_MODELS.map((model) => ({ ...model }));
      return this.cachedModels;
    })();

    try {
      return await this.modelLoadPromise;
    } finally {
      this.modelLoadPromise = null;
    }
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
