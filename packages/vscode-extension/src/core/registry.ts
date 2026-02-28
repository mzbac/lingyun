import * as vscode from 'vscode';

import {
  ToolRegistry as AgentToolRegistry,
  type ToolContext as AgentToolContext,
  type ToolDefinition as AgentToolDefinition,
  type ToolProvider as AgentToolProvider,
  type ToolResult as AgentToolResult,
  type ToolHandler as AgentToolHandler,
} from '@kooka/agent-sdk';

import type { ToolContext, ToolDefinition, ToolProvider, ToolHandler, ToolResult } from './types';
import { createAbortSignalFromCancellationToken, createCancellationTokenFromAbortSignal } from './cancellation';
import { getPrimaryWorkspaceFolderUri } from './workspaceContext';

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertValidToolId(toolId: unknown, source: string): asserts toolId is string {
  if (typeof toolId !== 'string' || !TOOL_ID_PATTERN.test(toolId)) {
    throw new Error(
      `Invalid tool id ${JSON.stringify(toolId)} from ${source}. Tool ids must match ${TOOL_ID_PATTERN.toString()}.`,
    );
  }
}

function parseConfigTimeoutMs(): number | undefined {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('toolTimeoutMs');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  if (!Number.isFinite(parsed as number) || (parsed as number) <= 0) return undefined;
  return Math.floor(parsed as number);
}

function toAgentToolContext(context: ToolContext): { agentContext: AgentToolContext; dispose: () => void } {
  const allowExternalPaths =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
  const workspaceRoot = context.workspaceFolder?.scheme === 'file' ? context.workspaceFolder.fsPath : undefined;

  const { signal, dispose } = createAbortSignalFromCancellationToken(context.cancellationToken);
  return {
    agentContext: {
      workspaceRoot,
      allowExternalPaths,
      sessionId: context.sessionId,
      signal,
      log: context.log,
    },
    dispose,
  };
}

type ProviderEntry = {
  id: string;
  name: string;
  dispose: () => void;
  onDidUnregister?: () => void;
  toolIds: Set<string>;
};

export class ToolRegistry {
  private extensionContext?: vscode.ExtensionContext;
  private readonly registry = new AgentToolRegistry({ defaultTimeoutMs: () => parseConfigTimeoutMs() ?? 0 });

  private providers = new Map<string, ProviderEntry>();
  private builtinToolIds = new Set<string>();

  private _onDidRegisterTool = new vscode.EventEmitter<ToolDefinition>();
  private _onDidUnregisterTool = new vscode.EventEmitter<string>();

  readonly onDidRegisterTool = this._onDidRegisterTool.event;
  readonly onDidUnregisterTool = this._onDidUnregisterTool.event;

  setExtensionContext(context: vscode.ExtensionContext): void {
    this.extensionContext = context;
  }

  getAgentRegistry(): AgentToolRegistry {
    return this.registry;
  }

  private buildVscodeToolContext(agentContext: AgentToolContext): { context: ToolContext; dispose: () => void } {
    const workspaceFolder = getPrimaryWorkspaceFolderUri();
    const activeEditor = vscode.window.activeTextEditor;
    const extensionContext = this.extensionContext ?? ({} as vscode.ExtensionContext);

    const { token, dispose } = createCancellationTokenFromAbortSignal(agentContext.signal);

    return {
      context: {
        workspaceFolder,
        activeEditor,
        extensionContext,
        sessionId: agentContext.sessionId,
        cancellationToken: token,
        progress: { report: () => {} },
        log: agentContext.log,
      },
      dispose,
    };
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): vscode.Disposable {
    assertValidToolId(definition?.id, 'builtin tool registration');

    const agentDefinition = definition as unknown as AgentToolDefinition;
    const agentHandler: AgentToolHandler = async (args, agentContext) => {
      const { context, dispose } = this.buildVscodeToolContext(agentContext);
      try {
        return (await handler(args, context)) as unknown as AgentToolResult;
      } finally {
        dispose();
      }
    };

    const disposable = this.registry.registerTool(agentDefinition, agentHandler);
    this.builtinToolIds.add(definition.id);
    this._onDidRegisterTool.fire(definition);

    return new vscode.Disposable(() => {
      disposable.dispose();
      this.builtinToolIds.delete(definition.id);
      this._onDidUnregisterTool.fire(definition.id);
    });
  }

  registerProvider(provider: ToolProvider): vscode.Disposable {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }

    const entry: ProviderEntry = {
      id: provider.id,
      name: provider.name,
      toolIds: new Set(),
      dispose: () => {},
      ...(provider.onDidUnregister ? { onDidUnregister: provider.onDidUnregister } : {}),
    };

    const agentProvider: AgentToolProvider = {
      id: provider.id,
      name: provider.name,
      getTools: async () => {
        const tools = await Promise.resolve(provider.getTools());
        for (const tool of tools) {
          try {
            assertValidToolId(tool?.id, `provider "${provider.id}"`);
          } catch {
            continue;
          }
          entry.toolIds.add(tool.id);
        }
        return tools as unknown as AgentToolDefinition[];
      },
      executeTool: async (toolId, args, agentContext) => {
        const { context, dispose } = this.buildVscodeToolContext(agentContext);
        try {
          return (await provider.executeTool(toolId, args, context)) as unknown as AgentToolResult;
        } finally {
          dispose();
        }
      },
      dispose: () => provider.dispose?.(),
    };

    const agentDisposable = this.registry.registerProvider(agentProvider);
    entry.dispose = () => agentDisposable.dispose();
    this.providers.set(provider.id, entry);

    Promise.resolve(provider.getTools())
      .then((tools) => {
        for (const tool of tools) {
          try {
            assertValidToolId(tool?.id, `provider "${provider.id}"`);
          } catch {
            continue;
          }
          entry.toolIds.add(tool.id);
          this._onDidRegisterTool.fire(tool);
        }
      })
      .catch(() => {
        // ignore
      });

    provider.onDidRegister?.();

    return new vscode.Disposable(() => {
      this.unregisterProvider(provider.id);
    });
  }

  unregisterProvider(providerId: string): void {
    const entry = this.providers.get(providerId);
    if (!entry) return;

    try {
      entry.dispose();
    } catch {
      // ignore
    }

    try {
      entry.onDidUnregister?.();
    } catch {
      // ignore
    }

    for (const toolId of entry.toolIds) {
      this._onDidUnregisterTool.fire(toolId);
    }

    this.providers.delete(providerId);
  }

  async getTools(): Promise<ToolDefinition[]> {
    return (await this.registry.getTools()) as unknown as ToolDefinition[];
  }

  async getToolsForLLM(): Promise<Array<{
    type: 'function';
    function: { name: string; description: string; parameters: object };
  }>> {
    const tools = await this.getTools();
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.id,
        description: tool.description,
        parameters: tool.parameters as unknown as object,
      },
    }));
  }

  getProviders(): { id: string; name: string }[] {
    return [
      { id: 'builtin', name: 'Built-in Tools' },
      ...Array.from(this.providers.values()).map((p) => ({ id: p.id, name: p.name })),
    ];
  }

  async getToolCount(): Promise<number> {
    const tools = await this.getTools();
    return tools.length;
  }

  async executeTool(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const { agentContext, dispose } = toAgentToolContext(context);
    try {
      return (await this.registry.executeTool(toolId, args, agentContext)) as unknown as ToolResult;
    } finally {
      dispose();
    }
  }

  dispose(): void {
    for (const entry of this.providers.values()) {
      try {
        entry.dispose();
      } catch {
        // ignore
      }
    }
    this.providers.clear();
    this.builtinToolIds.clear();
    this._onDidRegisterTool.dispose();
    this._onDidUnregisterTool.dispose();
  }
}

export const toolRegistry = new ToolRegistry();
