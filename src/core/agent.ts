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
const MEMORY_STORAGE_KEY = 'lingyun.workspaceMemory';
const MEMORY_TARGET_LENGTH = 1200;

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
  private memorySummary?: string;
  private memoryLoaded = false;

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

    await this.ensureMemoryLoaded();
    if (this.isMemoryEnabled() && this.config.autoClearMemory) {
      await this.clearMemory();
    }

    const memory = this.isMemoryEnabled() ? this.memorySummary : undefined;

    const systemPrompt = this.config.systemPrompt || getSystemPrompt();
    const systemWithMemory = memory
      ? `${systemPrompt}\n\n## Workspace Memory\n${memory}`
      : systemPrompt;

    this.history.push({ role: 'system', content: systemWithMemory });
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
    let planned = false;
    let readyToAnswer = false;

    while (iterations < maxIterations && !this.aborted && !readyToAnswer) {
      iterations++;
      callbacks?.onThinking?.();

      const tools = await toolRegistry.getTools();
      const filteredTools = this.filterTools(tools);

      if (!planned) {
        const planningPrompt: Message = {
          role: 'assistant',
          content:
            'Planning turn: Draft a short, numbered plan to solve the user request using the available tools. Focus on the minimal steps needed. Always include READY_TO_ANSWER: no.',
        };

        this.history.push(planningPrompt);

        const planningResponse = await this.llm.chat(this.history, {
          model: this.config.model,
          temperature: this.config.temperature,
          tools: filteredTools,
          onToken: callbacks?.onToken,
        });

        this.history.push(planningResponse);
        lastResponse = planningResponse.content;
        planned = true;
        readyToAnswer = this.isReadyToAnswer(planningResponse);
        this.trimHistoryIfNeeded();

        if (readyToAnswer) {
          callbacks?.onComplete?.(lastResponse);
          return lastResponse;
        }

        continue;
      }

      const response = await this.llm.chat(this.history, {
        model: this.config.model,
        temperature: this.config.temperature,
        tools: filteredTools,
        onToken: callbacks?.onToken,
      });

      this.history.push(response);
      lastResponse = response.content;

      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolResults = await this.executeToolCalls(
          response.tool_calls,
          filteredTools,
          callbacks
        );

        for (const result of toolResults) {
          this.history.push(result);
        }
      }

      this.trimHistoryIfNeeded();

      const reflectionPrompt: Message = {
        role: 'assistant',
        content:
          'Reflection turn: Verify the latest tool results, call out any gaps, and decide if more tools are needed. If ready to answer, state READY_TO_ANSWER: yes and provide the final answer. Otherwise, set READY_TO_ANSWER: no and outline the next tool actions.',
      };

      this.history.push(reflectionPrompt);

      callbacks?.onThinking?.();

      const reflectionResponse = await this.llm.chat(this.history, {
        model: this.config.model,
        temperature: this.config.temperature,
        tools: filteredTools,
        onToken: callbacks?.onToken,
      });

      this.history.push(reflectionResponse);
      lastResponse = reflectionResponse.content;
      readyToAnswer = this.isReadyToAnswer(reflectionResponse);

      if (reflectionResponse.tool_calls && reflectionResponse.tool_calls.length > 0) {
        const reflectionResults = await this.executeToolCalls(
          reflectionResponse.tool_calls,
          filteredTools,
          callbacks
        );

        for (const result of reflectionResults) {
          this.history.push(result);
        }

        this.trimHistoryIfNeeded();
        continue;
      }

      if (readyToAnswer) {
        callbacks?.onComplete?.(lastResponse);
        return lastResponse;
      }

      await this.trimHistoryIfNeeded();
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

  private isMemoryEnabled(): boolean {
    const configEnabled = this.config.memoryEnabled;
    const settingEnabled = vscode.workspace.getConfiguration('lingyun').get<boolean>('memory.enabled', true);
    return configEnabled ?? settingEnabled ?? true;
  }

  private getMemoryStorageKey(): string {
    const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.toString() || 'global';
    return `${MEMORY_STORAGE_KEY}:${workspaceId}`;
  }

  private async ensureMemoryLoaded(): Promise<void> {
    if (this.memoryLoaded) return;

    const stored = this.context.workspaceState.get<string>(this.getMemoryStorageKey());
    this.memorySummary = stored || undefined;
    this.memoryLoaded = true;
  }

  private async saveMemory(summary?: string): Promise<void> {
    await this.context.workspaceState.update(this.getMemoryStorageKey(), summary);
    this.memoryLoaded = true;
  }

  private async captureMemorySnapshot(messages: Message[], reason: 'trim' | 'clear'): Promise<void> {
    if (!this.isMemoryEnabled() || messages.length === 0) return;

    await this.ensureMemoryLoaded();

    const combinedContent = messages
      .map(msg => `[${msg.role}] ${msg.content}`)
      .join('\n\n')
      .slice(0, MAX_TOOL_RESULT_LENGTH);

    try {
      const summary = await this.llm.chat([
        {
          role: 'system',
          content:
            'You create short memory notes about a conversation for an autonomous coding agent. Keep it concise, factual, and actionable.',
        },
        {
          role: 'user',
          content: `Reason for summary: ${reason}.\n\nSummarize the following context so future tasks know what changed, key decisions, file paths, and unresolved questions. Limit to ${MEMORY_TARGET_LENGTH} characters.\n\n${combinedContent}`,
        },
      ], { model: this.config.model });

      const merged = await this.mergeMemorySummaries(summary.content.trim());
      this.memorySummary = merged;
      await this.saveMemory(merged);
    } catch (error) {
      console.error('Failed to create memory summary', error);
    }
  }

  private async mergeMemorySummaries(newSummary: string): Promise<string> {
    if (!this.memorySummary) {
      return newSummary;
    }

    const combined = `${this.memorySummary}\n\n${newSummary}`;
    if (combined.length <= MEMORY_TARGET_LENGTH) {
      return combined;
    }

    try {
      const merged = await this.llm.chat([
        {
          role: 'system',
          content:
            `Merge two short memory notes into one concise summary under ${MEMORY_TARGET_LENGTH} characters. Preserve key details, file names, and follow-ups.`,
        },
        { role: 'user', content: `Existing memory:\n${this.memorySummary}\n\nNew memory:\n${newSummary}` },
      ], { model: this.config.model });

      return merged.content.trim();
    } catch (error) {
      console.error('Failed to merge memory summaries', error);
      return combined.slice(0, MEMORY_TARGET_LENGTH);
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private getHistoryTokenCount(): number {
    return this.history.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content || '');
    }, 0);
  }

  private async trimHistoryIfNeeded(): Promise<void> {
    if (!this.isMemoryEnabled()) {
      while (this.getHistoryTokenCount() > MAX_HISTORY_TOKENS && this.history.length > 3) {
        const indexToRemove = this.history.findIndex((msg, i) => i > 0 && msg.role !== 'system');
        if (indexToRemove > 0) {
          this.history.splice(indexToRemove, 1);
        } else {
          break;
        }
      }
      return;
    }

    const removed: Message[] = [];
    while (this.getHistoryTokenCount() > MAX_HISTORY_TOKENS && this.history.length > 3) {
      const indexToRemove = this.history.findIndex((msg, i) => i > 0 && msg.role !== 'system');
      if (indexToRemove > 0) {
        const [msg] = this.history.splice(indexToRemove, 1);
        if (msg) {
          removed.push(msg);
        }
      } else {
        break;
      }
    }

    if (removed.length > 0) {
      await this.captureMemorySnapshot(removed, 'trim');
    }
  }

  private isReadyToAnswer(message: Message): boolean {
    const content = message.content || '';
    return /ready[_\s]*to[_\s]*answer\s*:\s*yes/i.test(content);
  }

  abort(): void {
    this.aborted = true;
    for (const source of this.activeCancellations) {
      source.cancel();
    }
    this.disposeAllCancellations();
  }

  async clear(): Promise<void> {
    if (this.history.length > 0) {
      await this.captureMemorySnapshot(this.history.filter(msg => msg.role !== 'system'), 'clear');
    }
    this.history = [];
  }

  async clearMemory(): Promise<void> {
    this.memorySummary = undefined;
    await this.saveMemory();
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  async getMemorySummary(): Promise<string | undefined> {
    await this.ensureMemoryLoaded();
    if (!this.isMemoryEnabled()) return undefined;
    return this.memorySummary;
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
