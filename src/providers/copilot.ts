import * as vscode from 'vscode';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LLMProvider } from '../core/types';

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

export const FALLBACK_MODELS = {
  GPT_4_1: 'gpt-4.1',
  GPT_4O: 'gpt-4o',
} as const;

export const MODELS = FALLBACK_MODELS;

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
  private provider:
    | ReturnType<typeof createOpenAICompatible>
    | null = null;

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
    if (this.provider && this.cachedProviderToken === token) return;

    this.cachedProviderToken = token;
    this.provider = createOpenAICompatible({
      name: 'copilot',
      baseURL: COPILOT_BASE_URL,
      apiKey: token,
      headers: {
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'lingyun/1.0.1',
        'Openai-Organization': 'github-copilot',
        'Copilot-Integration-Id': 'vscode-chat',
      },
    });
  }

  async getModel(modelId: string): Promise<unknown> {
    await this.ensureProvider();
    const resolvedModel = modelId || MODELS.GPT_4O;
    return this.provider!.chatModel(resolvedModel);
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
    this.cachedProviderToken = null;
  }
}
