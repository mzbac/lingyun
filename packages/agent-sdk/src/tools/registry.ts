import type { ToolDefinition, ToolHandler, ToolProvider, ToolContext, ToolResult } from '../types.js';
import { combineAbortSignals } from '../abort.js';

export type Disposable = { dispose: () => void };

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
  private simpleProvider: SimpleToolProvider;
  private providerTools = new Map<string, ToolDefinition[]>();
  private toolToProvider = new Map<string, string>();
  private refreshPromise: Promise<void> | undefined;

  constructor(private readonly options?: { defaultTimeoutMs?: number | (() => number) }) {
    this.simpleProvider = new SimpleToolProvider('builtin', 'Built-in Tools');
    this.providers.set('builtin', this.simpleProvider);
    this.providerTools.set('builtin', this.simpleProvider.getTools());
  }

  registerProvider(provider: ToolProvider): Disposable {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }

    this.providers.set(provider.id, provider);
    void this.refreshProviderTools(provider.id).then(
      () => this.rebuildToolIndex(),
      () => {
        // ignore provider listing errors; host can observe via tool execution failures
      },
    );

    return {
      dispose: () => {
        this.unregisterProvider(provider.id);
      },
    };
  }

  unregisterProvider(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    this.providers.delete(providerId);
    this.providerTools.delete(providerId);
    this.rebuildToolIndex();

    try {
      provider.dispose?.();
    } catch {
      // ignore
    }
  }

  private async refreshProviderTools(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    const raw = await Promise.resolve(provider.getTools());
    const next: ToolDefinition[] = [];

    for (const tool of raw) {
      try {
        assertValidToolId(tool?.id, `provider "${providerId}"`);
      } catch (error) {
        console.error('[ToolRegistry] Skipping tool:', error);
        continue;
      }
      next.push(tool);
    }

    this.providerTools.set(providerId, next);
  }

  private rebuildToolIndex(): void {
    const next = new Map<string, string>();

    for (const [providerId] of this.providers) {
      const tools = this.providerTools.get(providerId) ?? [];
      for (const tool of tools) {
        if (next.has(tool.id)) {
          const existing = next.get(tool.id);
          console.warn(
            `[ToolRegistry] Duplicate tool id "${tool.id}" from provider "${providerId}" (already provided by "${existing}"); skipping.`,
          );
          continue;
        }
        next.set(tool.id, providerId);
      }
    }

    this.toolToProvider = next;
  }

  private async refreshAllTools(): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    this.refreshPromise = (async () => {
      const providerIds = [...this.providers.keys()];
      await Promise.all(
        providerIds.map(async (providerId) => {
          try {
            await this.refreshProviderTools(providerId);
          } catch {
            // keep existing snapshot on listing failures
          }
        }),
      );
      this.rebuildToolIndex();
    })();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): Disposable {
    assertValidToolId(definition?.id, 'builtin tool registration');
    this.simpleProvider.addTool(definition, handler);
    this.toolToProvider.set(definition.id, 'builtin');
    this.providerTools.set('builtin', this.simpleProvider.getTools());
    return {
      dispose: () => {
        this.simpleProvider.removeTool(definition.id);
        this.providerTools.set('builtin', this.simpleProvider.getTools());
        this.rebuildToolIndex();
      },
    };
  }

  async getTools(): Promise<ToolDefinition[]> {
    await this.refreshAllTools();

    const all: ToolDefinition[] = [];
    const seen = new Set<string>();
    for (const provider of this.providers.values()) {
      const tools = this.providerTools.get(provider.id) ?? [];
      for (const tool of tools) {
        if (seen.has(tool.id)) continue;
        if (this.toolToProvider.get(tool.id) !== provider.id) continue;
        seen.add(tool.id);
        all.push(tool);
      }
    }
    return all;
  }

  async getTool(toolId: string): Promise<ToolDefinition | undefined> {
    await this.refreshAllTools();

    const providerId = this.toolToProvider.get(toolId);
    if (!providerId) return undefined;
    const provider = this.providers.get(providerId);
    if (!provider) return undefined;

    const tools = this.providerTools.get(providerId) ?? [];
    return tools.find((t) => t.id === toolId);
  }

  async executeTool(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();

    let providerId = this.toolToProvider.get(toolId);
    if (!providerId) {
      await this.refreshAllTools();
      providerId = this.toolToProvider.get(toolId);
      if (!providerId) {
        return { success: false, error: `Unknown tool: ${toolId}` };
      }
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      return { success: false, error: `Provider not found: ${providerId}` };
    }

    try {
      const tool = (this.providerTools.get(providerId) ?? []).find((t) => t.id === toolId);
      const defaultTimeoutRaw = this.options?.defaultTimeoutMs;
      const defaultTimeout =
        typeof defaultTimeoutRaw === 'function' ? defaultTimeoutRaw() : defaultTimeoutRaw;
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
