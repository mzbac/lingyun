import type { ToolDefinition, ToolHandler, ToolProvider, ToolContext, ToolResult } from '../types.js';
import { combineAbortSignals } from '../abort.js';

export type Disposable = { dispose: () => void };

class SimpleToolProvider implements ToolProvider {
  readonly id: string;
  readonly name: string;

  private tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();

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
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async executeTool(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolId}` };
    }
    return tool.handler(args, context);
  }
}

export class ToolRegistry {
  private providers = new Map<string, ToolProvider>();
  private toolToProvider = new Map<string, string>();
  private simpleProvider: SimpleToolProvider;

  constructor(private readonly options?: { defaultTimeoutMs?: number }) {
    this.simpleProvider = new SimpleToolProvider('builtin', 'Built-in Tools');
    this.providers.set('builtin', this.simpleProvider);
  }

  registerProvider(provider: ToolProvider): Disposable {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }

    this.providers.set(provider.id, provider);
    Promise.resolve(provider.getTools())
      .then((tools) => this.indexProviderTools(provider.id, tools))
      .catch(() => {
        // ignore provider listing errors; host can observe via tool execution failures
      });

    return {
      dispose: () => {
        this.unregisterProvider(provider.id);
      },
    };
  }

  unregisterProvider(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    for (const [toolId, pId] of this.toolToProvider) {
      if (pId === providerId) {
        this.toolToProvider.delete(toolId);
      }
    }

    try {
      provider.dispose?.();
    } catch {
      // ignore
    }

    this.providers.delete(providerId);
  }

  private indexProviderTools(providerId: string, tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.toolToProvider.set(tool.id, providerId);
    }
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): Disposable {
    this.simpleProvider.addTool(definition, handler);
    this.toolToProvider.set(definition.id, 'builtin');
    return {
      dispose: () => {
        this.simpleProvider.removeTool(definition.id);
        this.toolToProvider.delete(definition.id);
      },
    };
  }

  async getTools(): Promise<ToolDefinition[]> {
    const all: ToolDefinition[] = [];
    for (const provider of this.providers.values()) {
      const tools = await Promise.resolve(provider.getTools());
      all.push(...tools);
    }
    return all;
  }

  async getTool(toolId: string): Promise<ToolDefinition | undefined> {
    const providerId = this.toolToProvider.get(toolId);
    if (!providerId) return undefined;
    const provider = this.providers.get(providerId);
    if (!provider) return undefined;

    const tools = await Promise.resolve(provider.getTools());
    return tools.find((t) => t.id === toolId);
  }

  async executeTool(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
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
      const defaultTimeout = this.options?.defaultTimeoutMs;
      const timeout = Math.max(0, Math.floor((tool?.metadata?.timeout ?? defaultTimeout) || 0));

      let result: ToolResult;
      if (timeout > 0) {
        const timeoutSignal = (AbortSignal as any)?.timeout;
        const signal = timeoutSignal
          ? combineAbortSignals([context.signal, timeoutSignal(timeout)])
          : context.signal;
        result = await provider.executeTool(toolId, args, { ...context, signal });
      } else {
        result = await provider.executeTool(toolId, args, context);
      }

      return {
        ...result,
        metadata: {
          ...(result.metadata || {}),
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
      return {
        success: false,
        error: errorMessage,
        metadata: {
          duration: Date.now() - startTime,
          errorType,
        },
      };
    }
  }
}
