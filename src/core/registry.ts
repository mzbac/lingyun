import * as vscode from 'vscode';
import type {
  ToolDefinition,
  ToolProvider,
  ToolHandler,
  ToolContext,
  ToolResult,
} from './types';

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
      this.toolToProvider.set(tool.id, providerId);
      this._onDidRegisterTool.fire(tool);
    }
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): vscode.Disposable {
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
      allTools.push(...tools);
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

    const tool = await this.getTool(toolId);
    const timeout = tool?.metadata?.timeout || 30000;

    try {
      const result = await Promise.race([
        provider.executeTool(toolId, args, context),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
        ),
      ]);

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
