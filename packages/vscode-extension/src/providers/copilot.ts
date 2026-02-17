import * as vscode from 'vscode';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LLMProvider } from '../core/types';

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

export const FALLBACK_MODELS = {
  GPT_4_1: 'gpt-4.1',
  GPT_4O: 'gpt-4o',
} as const;

export const MODELS = FALLBACK_MODELS;

function shouldUseResponsesApi(modelID: string): boolean {
  // Minimize impact: only route the known Copilot-only model to `/responses`.
  // Copilot rejects `gpt-5.3-codex` on `/chat/completions`.
  return modelID.toLowerCase() === 'gpt-5.3-codex';
}

function hasResponsesMethod(provider: unknown): provider is { responses: (modelId: string) => unknown } {
  return provider !== null && provider !== undefined && typeof (provider as { responses?: unknown }).responses === 'function';
}

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  family: string;
  maxInputTokens?: number;
}

export class CopilotProvider implements LLMProvider {
  readonly id = 'copilot';
  readonly name = 'GitHub Copilot';

  private copilotToken: string | null = null;
  private tokenExpiry: number = 0;
  private cachedModels: ModelInfo[] | null = null;

  private cachedProviderToken: string | null = null;
  private cachedProviderEditorVersion: string | null = null;
  private cachedProviderPluginVersion: string | null = null;
  private provider:
    | ReturnType<typeof createOpenAICompatible>
    | null = null;
  private responsesProvider: ReturnType<typeof createOpenAI> | null = null;

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

    const githubToken = await this.getGitHubToken();

    const response = await fetch(COPILOT_TOKEN_URL, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get Copilot token: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { token: string; expires_at: number };

    this.copilotToken = data.token;
    this.tokenExpiry = data.expires_at * 1000;

    return this.copilotToken;
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
      this.responsesProvider &&
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
      includeUsage: true,
    });
    this.responsesProvider = createOpenAI({
      baseURL: COPILOT_BASE_URL,
      apiKey: token,
      headers,
    });
  }

  onRequestError(error: unknown, _context?: { modelId: string; mode: 'plan' | 'build' }): void {
    // Ensure the next request uses a fresh client instance and re-evaluated headers.
    this.provider = null;
    this.responsesProvider = null;
    this.cachedProviderToken = null;
    this.cachedProviderEditorVersion = null;
    this.cachedProviderPluginVersion = null;

    // If the token was rejected, force-refresh it on the next call.
    const message = error instanceof Error ? error.message : String(error);
    if (/\b401\b/i.test(message) || /\b403\b/i.test(message) || /unauthori[sz]ed|forbidden|invalid token|expired/i.test(message)) {
      this.copilotToken = null;
      this.tokenExpiry = 0;
    }
  }

  async getModel(modelId: string): Promise<unknown> {
    await this.ensureProvider();
    const resolvedModel = modelId || MODELS.GPT_4O;
    if (!this.provider) {
      throw new Error('Copilot provider is not initialized');
    }
    if (shouldUseResponsesApi(resolvedModel) && hasResponsesMethod(this.responsesProvider)) {
      return this.responsesProvider.responses(resolvedModel);
    }
    return this.provider.chatModel(resolvedModel);
  }

  async getModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) {
      return this.cachedModels;
    }

    try {
      const vscodeLmModels = await vscode.lm.selectChatModels({});
      if (vscodeLmModels && vscodeLmModels.length > 0) {
        this.cachedModels = vscodeLmModels.map(m => ({
          id: m.id,
          name: m.name,
          vendor: m.vendor,
          family: m.family,
          maxInputTokens: m.maxInputTokens,
        }));
        return this.cachedModels;
      }
    } catch (error) {
      console.log('VSCode LM API not available:', error);
    }

    this.cachedModels = Object.values(FALLBACK_MODELS).map(id => ({
      id,
      name: id,
      vendor: 'copilot',
      family: id.split('-')[0],
    }));
    return this.cachedModels;
  }

  clearModelCache(): void {
    this.cachedModels = null;
  }

  dispose(): void {
    this.copilotToken = null;
    this.tokenExpiry = 0;
    this.cachedModels = null;
    this.provider = null;
    this.responsesProvider = null;
    this.cachedProviderToken = null;
    this.cachedProviderEditorVersion = null;
    this.cachedProviderPluginVersion = null;
  }
}
