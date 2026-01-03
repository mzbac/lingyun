import * as vscode from 'vscode';
import type { LLMProvider, Message, ToolDefinition } from '../core/types';

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

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
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get Copilot token: ${response.status} ${text}`);
    }

    const data = await response.json() as { token: string; expires_at: number };

    this.copilotToken = data.token;
    this.tokenExpiry = data.expires_at * 1000;

    return this.copilotToken;
  }

  private formatTools(tools: ToolDefinition[]): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: object };
  }> {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.id,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async chat(
    messages: Message[],
    options: {
      model?: string;
      temperature?: number;
      tools?: ToolDefinition[];
      onToken?: (token: string) => void;
    } = {}
  ): Promise<Message> {
    const token = await this.getCopilotToken();
    const model = options.model || MODELS.GPT_4O;
    const temperature = options.temperature ?? 0.7;
    const stream = !!options.onToken;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => {
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.content,
        };
        if (m.name) msg.name = m.name;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        return msg;
      }),
      temperature,
      stream,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
      body.tool_choice = 'auto';
    }

    const response = await fetch(COPILOT_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': stream ? 'text/event-stream' : 'application/json',
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'lingyun/0.1.0',
        'Openai-Organization': 'github-copilot',
        'Copilot-Integration-Id': 'vscode-chat',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Copilot API error: ${response.status} ${text}`);
    }

    if (stream && options.onToken) {
      return this.handleStream(response, options.onToken);
    }

    return this.handleResponse(response);
  }

  private async handleResponse(response: Response): Promise<Message> {
    const data = await response.json() as {
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No response from Copilot');
    }

    return {
      role: choice.message.role as 'assistant',
      content: choice.message.content || '',
      tool_calls: choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        type: tc.type as 'function',
        function: tc.function,
      })),
    };
  }

  private async handleStream(
    response: Response,
    onToken: (token: string) => void
  ): Promise<Message> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let content = '';
    const toolCalls: Message['tool_calls'] = [];
    let currentToolCall: {
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{
                delta: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    type?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
            };

            const delta = parsed.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              content += delta.content;
              onToken(delta.content);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  if (currentToolCall) {
                    toolCalls.push(currentToolCall);
                  }
                  currentToolCall = {
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    },
                  };
                } else if (currentToolCall) {
                  if (tc.function?.name) {
                    currentToolCall.function.name += tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    currentToolCall.function.arguments += tc.function.arguments;
                  }
                }
              }
            }
          } catch {
            // Ignore JSON parse errors for incomplete chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (currentToolCall) {
      toolCalls.push(currentToolCall);
    }

    return {
      role: 'assistant',
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
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
    this.cachedModels = null;
  }
}
