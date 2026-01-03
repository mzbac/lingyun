import * as vscode from 'vscode';

import { toolRegistry } from './core/registry';
import { AgentLoop, createAgent } from './core/agent';
import type {
  LingyunAPI,
  ToolProvider,
  ToolDefinition,
  ToolHandler,
  ToolResult,
  AgentConfig,
} from './core/types';

import { CopilotProvider, MODELS } from './providers/copilot';
import { WorkspaceToolProvider, createSampleToolsConfig } from './providers/workspace';
import type { LLMProvider } from './core/types';

import { registerFileTools } from './tools/builtin/file';
import { registerShellTools } from './tools/builtin/shell';

import { ChatViewProvider } from './ui/chat';
import { requestApproval } from './ui/approval';

class ExtensionState implements vscode.Disposable {
  llmProvider: LLMProvider | undefined;
  agent: AgentLoop | undefined;
  workspaceProvider: WorkspaceToolProvider | undefined;
  outputChannel: vscode.OutputChannel | undefined;
  chatProvider: ChatViewProvider | undefined;

  readonly onDidRegisterToolEmitter = new vscode.EventEmitter<ToolDefinition>();
  readonly onDidUnregisterToolEmitter = new vscode.EventEmitter<string>();

  private disposables: vscode.Disposable[] = [];

  addDisposable(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  dispose(): void {
    this.chatProvider = undefined;

    if (this.workspaceProvider) {
      this.workspaceProvider.dispose?.();
      this.workspaceProvider = undefined;
    }

    if (this.llmProvider?.dispose) {
      this.llmProvider.dispose();
    }
    this.llmProvider = undefined;

    toolRegistry.dispose();

    this.onDidRegisterToolEmitter.dispose();
    this.onDidUnregisterToolEmitter.dispose();

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    this.outputChannel?.dispose();
    this.outputChannel = undefined;

    this.agent = undefined;
  }
}

let extensionState: ExtensionState | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<LingyunAPI> {
  extensionState = new ExtensionState();

  extensionState.outputChannel = vscode.window.createOutputChannel('LingYun');
  log('Activating LingYun...');

  log('Using GitHub Copilot provider');
  extensionState.llmProvider = new CopilotProvider();

  extensionState.agent = createAgent(extensionState.llmProvider, context, {
    model: getConfig('model') || MODELS.GPT_4O,
    maxIterations: getConfig('maxIterations') || 20,
    autoApprove: getConfig('autoApprove') || false,
  });

  for (const d of registerFileTools()) {
    extensionState.addDisposable(d);
  }
  for (const d of registerShellTools()) {
    extensionState.addDisposable(d);
  }

  log(`Registered ${await toolRegistry.getToolCount()} built-in tools`);

  extensionState.workspaceProvider = new WorkspaceToolProvider(context);
  await extensionState.workspaceProvider.initialize();
  extensionState.addDisposable(toolRegistry.registerProvider(extensionState.workspaceProvider));

  extensionState.workspaceProvider.onDidChange(() => {
    log('Workspace tools reloaded');
  });

  toolRegistry.onDidRegisterTool(tool => extensionState?.onDidRegisterToolEmitter.fire(tool));
  toolRegistry.onDidUnregisterTool(id => extensionState?.onDidUnregisterToolEmitter.fire(id));

  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.start', cmdStart)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.abort', cmdAbort)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.clear', cmdClear)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.showLogs', cmdShowLogs)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.listTools', cmdListTools)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.createToolsConfig', cmdCreateToolsConfig)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.runTool', cmdRunTool)
  );

  extensionState.chatProvider = new ChatViewProvider(
    context,
    extensionState.agent,
    extensionState.llmProvider as { getModels?: () => Promise<import('./providers/copilot').ModelInfo[]> }
  );
  extensionState.addDisposable(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      extensionState.chatProvider
    )
  );

  extensionState.addDisposable(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('lingyun') && extensionState?.agent) {
        extensionState.agent.updateConfig({
          model: getConfig('model') || MODELS.GPT_4O,
          maxIterations: getConfig('maxIterations') || 20,
          autoApprove: getConfig('autoApprove') || false,
        });
        log('Configuration updated');
      }
    })
  );

  context.subscriptions.push(extensionState);

  log('LingYun activated');

  return createAPI();
}

export function deactivate(): void {
  if (extensionState) {
    extensionState.dispose();
    extensionState = undefined;
  }
}

function createAPI(): LingyunAPI {
  if (!extensionState) {
    throw new Error('Extension not activated');
  }

  return {
    version: '1.0.0',

    registerToolProvider(provider: ToolProvider): vscode.Disposable {
      return toolRegistry.registerProvider(provider);
    },

    registerTool(definition: ToolDefinition, handler: ToolHandler): vscode.Disposable {
      return toolRegistry.registerTool(definition, handler);
    },

    async getTools(): Promise<ToolDefinition[]> {
      return toolRegistry.getTools();
    },

    async executeTool(toolId: string, args: Record<string, unknown>): Promise<ToolResult> {
      const tokenSource = new vscode.CancellationTokenSource();
      try {
        const context = {
          workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
          activeEditor: vscode.window.activeTextEditor,
          extensionContext: {} as vscode.ExtensionContext,
          cancellationToken: tokenSource.token,
          progress: { report: () => {} },
          log: (msg: string) => log(msg),
        };
        return await toolRegistry.executeTool(toolId, args, context);
      } finally {
        tokenSource.dispose();
      }
    },

    async runAgent(task: string, config?: AgentConfig): Promise<string> {
      if (!extensionState?.agent) {
        throw new Error('Agent not initialized');
      }
      if (config) {
        extensionState.agent.updateConfig(config);
      }
      return extensionState.agent.run(task, {
        onRequestApproval: async (tc, def) => requestApproval(tc, def),
      });
    },

    onDidRegisterTool: extensionState.onDidRegisterToolEmitter.event,
    onDidUnregisterTool: extensionState.onDidUnregisterToolEmitter.event,
  };
}

async function cmdStart(): Promise<void> {
  await vscode.commands.executeCommand('lingyun.chatView.focus');

  const task = await vscode.window.showInputBox({
    prompt: 'What would you like the agent to do?',
    placeHolder: 'e.g., Read the README and summarize it',
  });

  if (!task) return;

  extensionState?.chatProvider?.sendMessage(task);
}

function cmdAbort(): void {
  if (extensionState?.agent?.running) {
    extensionState.agent.abort();
    log('Agent aborted');
    vscode.window.showInformationMessage('Agent aborted');
  } else {
    vscode.window.showInformationMessage('No agent running');
  }
}

function cmdClear(): void {
  extensionState?.agent?.clear();
  log('Conversation cleared');
  vscode.window.showInformationMessage('Conversation cleared');
}

function cmdShowLogs(): void {
  extensionState?.outputChannel?.show();
}

async function cmdListTools(): Promise<void> {
  const tools = await toolRegistry.getTools();
  const providers = toolRegistry.getProviders();

  const items = tools.map(tool => ({
    label: tool.name,
    description: tool.id,
    detail: tool.description,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `${tools.length} tools from ${providers.length} providers`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected) {
    const tool = tools.find(t => t.id === selected.description);
    if (tool) {
      const doc = `# ${tool.name}\n\nID: \`${tool.id}\`\n\n${tool.description}\n\n## Parameters\n\`\`\`json\n${JSON.stringify(tool.parameters, null, 2)}\n\`\`\``;
      const uri = vscode.Uri.parse('untitled:tool-info.md');
      const document = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), doc);
      await vscode.workspace.applyEdit(edit);
      await vscode.window.showTextDocument(document);
    }
  }
}

async function cmdCreateToolsConfig(): Promise<void> {
  await createSampleToolsConfig();
}

async function cmdRunTool(): Promise<void> {
  const tools = await toolRegistry.getTools();

  const items = tools.map(tool => ({
    label: tool.name,
    description: tool.id,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a tool to run',
  });

  if (!selected) return;

  const tool = tools.find(t => t.id === selected.description);
  if (!tool) return;

  const args: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(tool.parameters.properties)) {
    const required = tool.parameters.required?.includes(name);
    const value = await vscode.window.showInputBox({
      prompt: `${name}${required ? ' (required)' : ''}`,
      placeHolder: schema.description,
    });

    if (value !== undefined && value !== '') {
      if (schema.type === 'number') {
        args[name] = parseFloat(value);
      } else if (schema.type === 'boolean') {
        args[name] = value.toLowerCase() === 'true';
      } else if (schema.type === 'array' || schema.type === 'object') {
        try {
          args[name] = JSON.parse(value);
        } catch {
          args[name] = value;
        }
      } else {
        args[name] = value;
      }
    }
  }

  extensionState?.outputChannel?.show();
  log(`\nRunning ${tool.name}...`);
  log(`Args: ${JSON.stringify(args)}`);

  const tokenSource = new vscode.CancellationTokenSource();
  try {
    const context = {
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
      activeEditor: vscode.window.activeTextEditor,
      extensionContext: {} as vscode.ExtensionContext,
      cancellationToken: tokenSource.token,
      progress: { report: () => {} },
      log: (msg: string) => log(msg),
    };

    const result = await toolRegistry.executeTool(tool.id, args, context);

    log(`\nResult: ${result.success ? '✅' : '❌'}`);
    log(typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2));

    if (result.error) {
      log(`Error: ${result.error}`);
    }
  } finally {
    tokenSource.dispose();
  }
}

function getConfig<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration('lingyun').get<T>(key);
}

function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  extensionState?.outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

export { MODELS } from './providers/copilot';
export type {
  ToolDefinition,
  ToolProvider,
  ToolHandler,
  ToolResult,
  ToolContext,
  AgentConfig,
  LingyunAPI,
} from './core/types';
