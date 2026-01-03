import * as vscode from 'vscode';
import type {
  Message,
  ToolCall,
  ToolDefinition,
  ToolContext,
  ToolResult,
  AgentConfig,
  AgentCallbacks,
  LLMProvider,
} from '../core/types';
import { toolRegistry } from '../core/registry';

const SUMMARIZE_THRESHOLD = 20000;
const MAX_TOOL_RESULT_LENGTH = 40000;
const MAX_HISTORY_TOKENS = 50000;

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant integrated into VSCode.

You have access to tools to interact with the workspace, files, and shell.

## Tool Usage Guidelines
- Use file.list or file.search FIRST to discover relevant files, then file.read specific ones
- Batch your work: gather context before making changes
- file.read has ~50KB limit; use startLine/endLine params for large files
- shell.run is slower than file.* tools; prefer file tools when possible
- For project info: check package.json, README.md, and config files

## Copilot Loop (plan → act → reflect)
- Outline a short, high-level plan before acting; keep it concise and focused on next steps.
- Act using the built-in tools, explicitly verifying retrieved context (e.g., file contents) before making decisions.
- After each batch of tool calls, summarize what you learned/changed and adjust the plan.
- Request explicit confirmation before destructive actions (file writes, shell commands that delete/overwrite, etc.).

## Behavior
- Read existing files before modifying them
- Explain your approach briefly
- Ask for confirmation before significant changes (file writes, shell commands)
- Be concise in responses

Be helpful, precise, and efficient.`;

function getSystemPrompt(): string {
  return DEFAULT_SYSTEM_PROMPT;
}

export class AgentLoop {
  private history: Message[] = [];
  private aborted = false;
  private _running = false;
  private activeCancellations: vscode.CancellationTokenSource[] = [];

  constructor(
    private llm: LLMProvider,
    private context: vscode.ExtensionContext,
    private config: AgentConfig = {}
  ) {}

  get running(): boolean {
    return this._running;
  }

  async run(task: string, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    this._running = true;
    this.aborted = false;
    this.history = [];

    const systemPrompt = this.config.systemPrompt || getSystemPrompt();
    this.history.push({ role: 'system', content: systemPrompt });
    this.history.push({ role: 'user', content: task });

    try {
      return await this.loop(callbacks);
    } finally {
      this._running = false;
      this.disposeAllCancellations();
    }
  }

  async continue(message: string, callbacks?: AgentCallbacks): Promise<string> {
    if (this._running) {
      throw new Error('Agent is already running');
    }

    this._running = true;
    this.aborted = false;
    this.history.push({ role: 'user', content: message });

    try {
      return await this.loop(callbacks);
    } finally {
      this._running = false;
      this.disposeAllCancellations();
    }
  }

  private async loop(callbacks?: AgentCallbacks): Promise<string> {
    const maxIterations = this.config.maxIterations || 20;
    let iterations = 0;
    let lastResponse = '';

    while (iterations < maxIterations && !this.aborted) {
      iterations++;
      callbacks?.onThinking?.();

      const tools = await toolRegistry.getTools();
      const filteredTools = this.filterTools(tools);

      const response = await this.llm.chat(this.history, {
        model: this.config.model,
        temperature: this.config.temperature,
        tools: filteredTools,
        onToken: callbacks?.onToken,
      });

      this.history.push(response);
      lastResponse = response.content;

      if (!response.tool_calls || response.tool_calls.length === 0) {
        callbacks?.onComplete?.(lastResponse);
        return lastResponse;
      }

      const toolResults = await this.executeToolCalls(
        response.tool_calls,
        filteredTools,
        callbacks
      );

      for (const result of toolResults) {
        this.history.push(result);
      }

      this.trimHistoryIfNeeded();
    }

    if (this.aborted) {
      throw new Error('Agent aborted');
    }

    if (iterations >= maxIterations) {
      callbacks?.onError?.(new Error('Max iterations reached'));
    }

    callbacks?.onComplete?.(lastResponse);
    return lastResponse;
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    tools: ToolDefinition[],
    callbacks?: AgentCallbacks
  ): Promise<Message[]> {
    const results: Message[] = [];

    for (const tc of toolCalls) {
      if (this.aborted) break;

      const toolDef = tools.find(t => t.id === tc.function.name);
      if (!toolDef) {
        results.push({
          role: 'tool',
          content: JSON.stringify({ error: `Unknown tool: ${tc.function.name}` }),
          tool_call_id: tc.id,
        });
        continue;
      }

      callbacks?.onToolCall?.(tc, toolDef);

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        results.push({
          role: 'tool',
          content: JSON.stringify({ error: 'Invalid arguments JSON' }),
          tool_call_id: tc.id,
        });
        continue;
      }

      if (toolDef.metadata?.requiresApproval && !this.config.autoApprove) {
        const approved = await callbacks?.onRequestApproval?.(tc, toolDef);
        if (!approved) {
          results.push({
            role: 'tool',
            content: JSON.stringify({ error: 'User rejected this action' }),
            tool_call_id: tc.id,
          });
          continue;
        }
      }

      const context = this.createToolContext();
      const result = await toolRegistry.executeTool(tc.function.name, args, context);
      callbacks?.onToolResult?.(tc, result);

      const content = await this.formatToolResult(result, toolDef.name);
      results.push({
        role: 'tool',
        content,
        tool_call_id: tc.id,
      });
    }

    return results;
  }

  private filterTools(tools: ToolDefinition[]): ToolDefinition[] {
    if (!this.config.toolFilter || this.config.toolFilter.length === 0) {
      return tools;
    }

    return tools.filter(tool => {
      return this.config.toolFilter!.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(tool.id);
        }
        return tool.id === pattern || tool.id.startsWith(pattern + '.');
      });
    });
  }

  private createToolContext(): ToolContext {
    const tokenSource = new vscode.CancellationTokenSource();
    this.activeCancellations.push(tokenSource);

    return {
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
      activeEditor: vscode.window.activeTextEditor,
      extensionContext: this.context,
      cancellationToken: tokenSource.token,
      progress: {
        report: () => {},
      },
      log: (message: string) => {
        console.log(`[Tool] ${message}`);
      },
    };
  }

  private disposeAllCancellations(): void {
    for (const source of this.activeCancellations) {
      source.dispose();
    }
    this.activeCancellations = [];
  }

  private async summarizeContent(content: string, toolName: string): Promise<string> {
    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: 'You are a helpful assistant. Summarize the following tool output concisely while preserving all key information, code snippets, file paths, and important details. Keep the summary focused and actionable.'
        },
        {
          role: 'user',
          content: `Summarize this output from the "${toolName}" tool:\n\n${content.substring(0, MAX_TOOL_RESULT_LENGTH)}`
        }
      ], { model: this.config.model });

      return `[SUMMARIZED - original was ${content.length} chars]\n${response.content}`;
    } catch (error) {
      console.error('Summarization failed:', error);
      return content.substring(0, MAX_TOOL_RESULT_LENGTH) +
        '\n\n... [TRUNCATED - summarization failed]';
    }
  }

  private async formatToolResult(result: ToolResult, toolName: string): Promise<string> {
    let content: string;

    if (result.success) {
      if (typeof result.data === 'string') {
        content = result.data;
      } else if (result.data === undefined || result.data === null) {
        content = 'Done';
      } else {
        content = JSON.stringify(result.data, null, 2);
      }
    } else {
      content = JSON.stringify({ error: result.error });
    }

    if (content.length > SUMMARIZE_THRESHOLD) {
      content = await this.summarizeContent(content, toolName);
    }

    if (content.length > MAX_TOOL_RESULT_LENGTH) {
      content = content.substring(0, MAX_TOOL_RESULT_LENGTH) +
        '\n\n... [TRUNCATED]';
    }

    return content;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private getHistoryTokenCount(): number {
    return this.history.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content || '');
    }, 0);
  }

  private trimHistoryIfNeeded(): void {
    while (this.getHistoryTokenCount() > MAX_HISTORY_TOKENS && this.history.length > 3) {
      const indexToRemove = this.history.findIndex((msg, i) =>
        i > 0 && msg.role !== 'system'
      );
      if (indexToRemove > 0) {
        this.history.splice(indexToRemove, 1);
      } else {
        break;
      }
    }
  }

  abort(): void {
    this.aborted = true;
    for (const source of this.activeCancellations) {
      source.cancel();
    }
    this.disposeAllCancellations();
  }

  clear(): void {
    this.history = [];
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export function createAgent(
  llm: LLMProvider,
  context: vscode.ExtensionContext,
  config?: AgentConfig
): AgentLoop {
  return new AgentLoop(llm, context, config);
}
