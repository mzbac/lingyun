import type { ToolContext, ToolDefinition, ToolProvider, ToolResult } from '../types';
import type { LingyunPluginToolEntry } from './pluginManager';
import { isRecord } from '../utils/guards';

function isParametersSchema(value: unknown): value is ToolDefinition['parameters'] {
  if (!isRecord(value)) return false;
  if (value.type !== 'object') return false;
  if (!isRecord((value as any).properties)) return false;
  return true;
}

function normalizePluginTool(entry: LingyunPluginToolEntry): { definition: ToolDefinition; execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult | unknown> } | undefined {
  const toolId = String(entry.toolId || '').trim();
  if (!toolId) return undefined;

  const tool = entry.tool as any;
  if (!tool || typeof tool !== 'object') return undefined;
  if (typeof tool.execute !== 'function') return undefined;

  const description = typeof tool.description === 'string' ? tool.description.trim() : '';
  if (!description) return undefined;

  const parameters = tool.parameters;
  if (!isParametersSchema(parameters)) return undefined;

  const name = typeof tool.name === 'string' && tool.name.trim() ? tool.name.trim() : toolId;

  const metadata = isRecord(tool.metadata) ? (tool.metadata as any) : undefined;
  const category = metadata?.category ? metadata.category : 'plugin';

  return {
    definition: {
      id: toolId,
      name,
      description,
      parameters,
      execution: { type: 'function', handler: `plugin:${entry.pluginId}:${toolId}` },
      metadata: { ...metadata, category },
    },
    execute: tool.execute,
  };
}

export class PluginToolProvider implements ToolProvider {
  readonly id = 'plugins';
  readonly name = 'Plugin Tools';

  private tools = new Map<
    string,
    {
      definition: ToolDefinition;
      pluginId: string;
      execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult | unknown>;
    }
  >();

  constructor(params: {
    entries: LingyunPluginToolEntry[];
    existingToolIds: Set<string>;
    log: (message: string) => void;
  }) {
    for (const entry of params.entries) {
      const toolId = String(entry.toolId || '').trim();
      if (!toolId) continue;
      if (params.existingToolIds.has(toolId)) {
        params.log(`Skipping plugin tool "${toolId}" from ${entry.pluginId}: tool id already exists`);
        continue;
      }

      const normalized = normalizePluginTool(entry);
      if (!normalized) {
        params.log(`Skipping invalid plugin tool "${toolId}" from ${entry.pluginId}`);
        continue;
      }

      this.tools.set(toolId, {
        definition: normalized.definition,
        pluginId: entry.pluginId,
        execute: normalized.execute,
      });
      params.existingToolIds.add(toolId);
    }
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
    if (!tool) return { success: false, error: `Tool not found: ${toolId}` };

    try {
      const result = await tool.execute(args, context);
      if (result && typeof result === 'object' && typeof (result as any).success === 'boolean') {
        return result as ToolResult;
      }
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Plugin tool error (${tool.pluginId}): ${message}` };
    }
  }
}
