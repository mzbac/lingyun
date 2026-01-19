import * as vscode from 'vscode';
import type {
  ToolDefinition,
  ToolProvider,
  ToolHandler,
  ToolContext,
  ToolResult,
} from './types';

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertValidToolId(toolId: unknown, source: string): asserts toolId is string {
  if (typeof toolId !== 'string' || !TOOL_ID_PATTERN.test(toolId)) {
    throw new Error(
      `Invalid tool id ${JSON.stringify(toolId)} from ${source}. Tool ids must match ${TOOL_ID_PATTERN.toString()}.`
    );
  }
}

class SimpleToolProvider implements ToolProvider {
  readonly id: string;
  readonly name: string;
  private tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }> = new Map();

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  addTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.id, { definition, handler });
  }

  removeTool(toolId: string): boolean {
    return this.tools.delete(toolId);
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  async executeTool(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolId}` };
    }
    return tool.handler(args, context);
  }
}

export class ToolRegistry {
  private providers: Map<string, ToolProvider> = new Map();
  private toolToProvider: Map<string, string> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();
  private simpleProvider: SimpleToolProvider;
  private _onDidRegisterTool = new vscode.EventEmitter<ToolDefinition>();
  private _onDidUnregisterTool = new vscode.EventEmitter<string>();

  readonly onDidRegisterTool = this._onDidRegisterTool.event;
  readonly onDidUnregisterTool = this._onDidUnregisterTool.event;

  constructor() {
    this.simpleProvider = new SimpleToolProvider('builtin', 'Built-in Tools');
    this.providers.set('builtin', this.simpleProvider);
  }

  registerProvider(provider: ToolProvider): vscode.Disposable {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }

    this.providers.set(provider.id, provider);

    const tools = provider.getTools();
    if (tools instanceof Promise) {
      tools
        .then(t => this.indexProviderTools(provider.id, t))
        .catch(error => {
          console.error(`[Registry] Failed to get tools from provider ${provider.id}:`, error);
        });
    } else {
      this.indexProviderTools(provider.id, tools);
    }

    provider.onDidRegister?.();

    return new vscode.Disposable(() => {
      this.unregisterProvider(provider.id);
    });
  }

  unregisterProvider(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    for (const [toolId, pId] of this.toolToProvider) {
      if (pId === providerId) {
        this.toolToProvider.delete(toolId);
        this._onDidUnregisterTool.fire(toolId);
      }
    }

    provider.onDidUnregister?.();
    provider.dispose?.();
    this.providers.delete(providerId);
  }

  private indexProviderTools(providerId: string, tools: ToolDefinition[]): void {
    for (const tool of tools) {
      try {
        assertValidToolId(tool?.id, `provider "${providerId}"`);
      } catch (error) {
        console.error(`[Registry] Skipping tool:`, error);
        continue;
      }
      this.toolToProvider.set(tool.id, providerId);
      this._onDidRegisterTool.fire(tool);
    }
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): vscode.Disposable {
    assertValidToolId(definition?.id, 'builtin tool registration');
    this.simpleProvider.addTool(definition, handler);
    this.toolToProvider.set(definition.id, 'builtin');
    this.handlers.set(definition.id, handler);
    this._onDidRegisterTool.fire(definition);

    return new vscode.Disposable(() => {
      this.simpleProvider.removeTool(definition.id);
      this.toolToProvider.delete(definition.id);
      this.handlers.delete(definition.id);
      this._onDidUnregisterTool.fire(definition.id);
    });
  }

  registerHandler(handlerId: string, handler: ToolHandler): vscode.Disposable {
    this.handlers.set(handlerId, handler);
    return new vscode.Disposable(() => {
      this.handlers.delete(handlerId);
    });
  }

  async getTools(filter?: { category?: string; tags?: string[] }): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = [];

    for (const provider of this.providers.values()) {
      const tools = await Promise.resolve(provider.getTools());
      for (const tool of tools) {
        if (!this.toolToProvider.has(tool.id)) continue;
        allTools.push(tool);
      }
    }

    if (!filter) return allTools;

    return allTools.filter(tool => {
      if (filter.category && tool.metadata?.category !== filter.category) {
        return false;
      }
      if (filter.tags && filter.tags.length > 0) {
        const toolTags = tool.metadata?.tags || [];
        if (!filter.tags.some(t => toolTags.includes(t))) {
          return false;
        }
      }
      return true;
    });
  }

  async getTool(toolId: string): Promise<ToolDefinition | undefined> {
    const providerId = this.toolToProvider.get(toolId);
    if (!providerId) return undefined;

    const provider = this.providers.get(providerId);
    if (!provider) return undefined;

    const tools = await Promise.resolve(provider.getTools());
    return tools.find(t => t.id === toolId);
  }

  async getToolsForLLM(): Promise<Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: object;
    };
  }>> {
    const tools = await this.getTools();

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.id,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async executeTool(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    const providerId = this.toolToProvider.get(toolId);
    if (!providerId) {
      return { success: false, error: `Unknown tool: ${toolId}` };
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      return { success: false, error: `Provider not found: ${providerId}` };
    }

    try {
      const tool = await this.getTool(toolId);
      const configTimeoutRaw = vscode.workspace.getConfiguration('lingyun').get<unknown>('toolTimeoutMs');
      const configTimeoutParsed =
        typeof configTimeoutRaw === 'number'
          ? configTimeoutRaw
          : typeof configTimeoutRaw === 'string'
            ? Number(configTimeoutRaw)
            : undefined;
      const configTimeout =
        Number.isFinite(configTimeoutParsed as number) && (configTimeoutParsed as number) > 0
          ? Math.floor(configTimeoutParsed as number)
          : undefined;

      const timeout = (tool?.metadata?.timeout ?? configTimeout) || 0;

      let result: ToolResult;
      if (timeout > 0) {
        let timedOut = false;
        const tokenSource = new vscode.CancellationTokenSource();
        const parentListener = context.cancellationToken.onCancellationRequested(() => tokenSource.cancel());
        const timeoutId = setTimeout(() => {
          timedOut = true;
          tokenSource.cancel();
        }, timeout);

        try {
          result = await provider.executeTool(toolId, args, { ...context, cancellationToken: tokenSource.token });
          if (timedOut) {
            result = { success: false, error: 'Tool execution timeout' };
          }
        } finally {
          clearTimeout(timeoutId);
          parentListener.dispose();
          tokenSource.dispose();
        }
      } else {
        result = await provider.executeTool(toolId, args, context);
      }

      return {
        ...result,
        metadata: {
          ...result.metadata,
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

      console.error(`[Registry] Tool execution failed (${toolId}):`, error);

      return {
        success: false,
        error: errorMessage,
        metadata: {
          duration: Date.now() - startTime,
          errorType,
          stack: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  getProviders(): { id: string; name: string }[] {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
    }));
  }

  async getToolCount(): Promise<number> {
    const tools = await this.getTools();
    return tools.length;
  }

  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose?.();
    }
    this.providers.clear();
    this.toolToProvider.clear();
    this.handlers.clear();
    this._onDidRegisterTool.dispose();
    this._onDidUnregisterTool.dispose();
  }
}

export const toolRegistry = new ToolRegistry();
