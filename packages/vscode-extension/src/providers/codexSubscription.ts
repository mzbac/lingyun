import * as vscode from 'vscode';

import { normalizeResponsesStreamModel } from '../core/utils/normalizeResponsesStream';
import type { ModelInfo } from './copilot';
import { createCodexResponsesModel } from './codexResponsesModel';
import { OpenAIAccountAuth } from './openaiAccountAuth';
import { createFetchWithStreamingDefaults } from './openaiFetch';
import type { LLMProviderWithUi, ProviderAuthStatus } from './providerUi';

const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_SECRET_STORAGE_KEY = 'providers.codexSubscription.auth';

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-5.4', name: 'GPT-5.4', vendor: 'chatgpt', family: 'gpt-5' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.2', name: 'GPT-5.2', vendor: 'chatgpt', family: 'gpt-5' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', vendor: 'chatgpt', family: 'gpt-codex' },
];

export interface CodexSubscriptionProviderOptions {
  context: vscode.ExtensionContext;
  defaultModelId?: string;
  timeoutMs?: number;
}

export class CodexSubscriptionProvider implements LLMProviderWithUi {
  readonly id = 'codexSubscription';
  readonly name = 'ChatGPT Codex Subscription';

  private readonly auth: OpenAIAccountAuth;
  private readonly context: vscode.ExtensionContext;
  private readonly defaultModelId?: string;
  private fetchFn: ReturnType<typeof createFetchWithStreamingDefaults>['fetch'];
  private readonly disposeFetch: () => void;

  private cachedModels: ModelInfo[] | null = null;

  constructor(options: CodexSubscriptionProviderOptions) {
    this.context = options.context;
    this.defaultModelId = options.defaultModelId || 'gpt-5.3-codex';
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
        originator: 'opencode',
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
  }

  async disconnect(): Promise<void> {
    await this.auth.disconnect();
  }

  onRequestError(error: unknown, _context?: { modelId: string; mode: 'plan' | 'build' }): void {
    if (this.isAuthError(error)) {
      this.auth.invalidateAccessToken();
    }
  }

  async getModel(modelId: string): Promise<unknown> {
    const session = await this.auth.getValidSession();
    const resolved = modelId || this.defaultModelId;
    if (!resolved) {
      throw new Error('No model configured. Set lingyun.model or lingyun.codexSubscription.defaultModelId.');
    }

    const extensionVersion =
      typeof this.context.extension?.packageJSON?.version === 'string'
        ? this.context.extension.packageJSON.version.trim()
        : '0.0.0';

    const headers: Record<string, string> = {
      originator: 'opencode',
      'User-Agent': `lingyun/${extensionVersion}`,
      session_id: crypto.randomUUID(),
    };
    if (session.accountId) {
      headers['ChatGPT-Account-Id'] = session.accountId;
    }

    const raw = createCodexResponsesModel({
      baseURL: CODEX_BASE_URL,
      apiKey: session.accessToken,
      modelId: resolved,
      headers,
      fetch: this.fetchFn,
      errorLabel: this.name,
      provider: this.id,
    });
    return normalizeResponsesStreamModel(raw, { canonicalizeTextPartIds: true });
  }

  async getModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;
    this.cachedModels = [...FALLBACK_MODELS];
    return this.cachedModels;
  }

  clearModelCache(): void {
    this.cachedModels = null;
  }

  dispose(): void {
    this.cachedModels = null;
    this.disposeFetch();
  }
}
