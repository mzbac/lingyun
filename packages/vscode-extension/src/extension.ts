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
import { OpenAICompatibleProvider } from './providers/openaiCompatible';
import { WorkspaceToolProvider, createSampleToolsConfig } from './providers/workspace';
import type { LLMProvider } from './core/types';

import { registerBuiltinTools } from './tools/builtin';

import { PluginManager } from './core/hooks/pluginManager';
import { PluginToolProvider } from './core/hooks/pluginToolProvider';
import { getSkillIndex } from './core/skills';
import { WorkspaceMemories, getMemoriesConfig } from './core/memories';

import { ChatViewProvider } from './ui/chat';
import { LingyunDiffContentProvider, LINGYUN_DIFF_SCHEME } from './ui/chat/diffContentProvider';
import { requestApproval } from './ui/approval';

class ExtensionState implements vscode.Disposable {
  llmProvider: LLMProvider | undefined;
  agent: AgentLoop | undefined;
  workspaceProvider: WorkspaceToolProvider | undefined;
  outputChannel: vscode.OutputChannel | undefined;
  chatProvider: ChatViewProvider | undefined;
  plugins: PluginManager | undefined;
  memories: WorkspaceMemories | undefined;

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

    this.plugins = undefined;
    this.memories = undefined;

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

function createAgentConfig(): AgentConfig {
  const temperatureRaw = getConfig<unknown>('temperature');
  const temperatureParsed =
    typeof temperatureRaw === 'number'
      ? temperatureRaw
      : typeof temperatureRaw === 'string'
        ? Number(temperatureRaw)
        : undefined;

  const temperature = Number.isFinite(temperatureParsed as number)
    ? (temperatureParsed as number)
    : undefined;

  const maxRetriesRaw = getConfig<unknown>('llm.maxRetries');
  const maxRetriesParsed =
    typeof maxRetriesRaw === 'number'
      ? maxRetriesRaw
      : typeof maxRetriesRaw === 'string'
        ? Number(maxRetriesRaw)
        : undefined;

  const maxRetries =
    Number.isFinite(maxRetriesParsed as number) && (maxRetriesParsed as number) >= 0
      ? Math.floor(maxRetriesParsed as number)
      : undefined;

  return {
    model: getConfig('model') || MODELS.GPT_4O,
    subagentModel: getConfig('subagents.model') || undefined,
    mode: (getConfig<'build' | 'plan'>('mode') || 'build'),
    temperature,
    maxRetries,
    autoApprove: getConfig('autoApprove') || false,
    toolFilter: getConfig('toolFilter') || [],
  };
}

function createLLMProviderFromConfig(): LLMProvider {
  const selection = getConfig<string>('llmProvider') || 'copilot';

  if (selection === 'openaiCompatible') {
    const baseURL = getConfig<string>('openaiCompatible.baseURL') || '';
    if (!baseURL.trim()) {
      log('openaiCompatible provider selected but baseURL is empty; falling back to Copilot');
      vscode.window.showWarningMessage(
        'LingYun: openaiCompatible provider selected but lingyun.openaiCompatible.baseURL is not set. Falling back to Copilot.'
      );
      return new CopilotProvider();
    }

    const apiKeyEnv = getConfig<string>('openaiCompatible.apiKeyEnv') || 'OPENAI_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    const defaultModelId = getConfig<string>('openaiCompatible.defaultModelId') || undefined;
    const modelDisplayNames =
      getConfig<Record<string, string>>('openaiCompatible.modelDisplayNames') || undefined;
    const timeoutMsRaw = getConfig<unknown>('llm.timeoutMs');
    const timeoutMsParsed =
      typeof timeoutMsRaw === 'number'
        ? timeoutMsRaw
        : typeof timeoutMsRaw === 'string'
          ? Number(timeoutMsRaw)
          : undefined;
    const timeoutMs =
      Number.isFinite(timeoutMsParsed as number) && (timeoutMsParsed as number) >= 0
        ? Math.floor(timeoutMsParsed as number)
        : undefined;

    log('Using OpenAI-compatible provider');
    return new OpenAICompatibleProvider({
      baseURL,
      apiKey,
      defaultModelId,
      modelDisplayNames,
      timeoutMs,
    });
  }

  log('Using GitHub Copilot provider');
  return new CopilotProvider();
}

async function initializeLLMAndAgent(context: vscode.ExtensionContext): Promise<void> {
  if (!extensionState) {
    throw new Error('Extension not activated');
  }

  extensionState.llmProvider?.dispose?.();
  extensionState.llmProvider = createLLMProviderFromConfig();
  extensionState.agent = createAgent(extensionState.llmProvider, context, createAgentConfig(), extensionState.plugins);
  extensionState.chatProvider?.setBackend(
    extensionState.agent,
    extensionState.llmProvider
  );
}

async function warmSkillIndexOnStartup(context: vscode.ExtensionContext): Promise<void> {
  const enabled = getConfig<boolean>('skills.enabled') ?? true;
  if (!enabled) return;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const allowExternalPaths = getConfig<boolean>('security.allowExternalPaths') ?? false;
  const searchPaths = getConfig<string[]>('skills.paths') ?? [];

  try {
    await getSkillIndex({
      extensionContext: context,
      workspaceRoot,
      searchPaths,
      allowExternalPaths,
      watchWorkspace: true,
    });
  } catch (error) {
    const debug = getConfig<boolean>('debug.tools') ?? false;
    if (debug) {
      log(`Failed to warm skills index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function refreshMemoriesOnStartup(context: vscode.ExtensionContext): Promise<void> {
  if (!extensionState) return;

  const config = getMemoriesConfig();
  if (!config.enabled) return;

  extensionState.memories ??= new WorkspaceMemories(context);

  try {
    const result = await extensionState.memories.updateFromSessions();
    log(
      `Memories refreshed on startup: scanned=${result.scannedSessions} processed=${result.processedSessions} retained=${result.retainedOutputs}`,
    );
  } catch (error) {
    log(`Failed to refresh memories on startup: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<LingyunAPI> {
  extensionState = new ExtensionState();

  extensionState.outputChannel = vscode.window.createOutputChannel('LingYun');
  log('Activating LingYun...');

  extensionState.plugins = new PluginManager(context, { log });

  await initializeLLMAndAgent(context);
  void warmSkillIndexOnStartup(context);
  extensionState.memories = new WorkspaceMemories(context);
  void refreshMemoriesOnStartup(context);

  for (const d of registerBuiltinTools()) {
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

  if (extensionState.plugins) {
    try {
      const existingToolIds = new Set((await toolRegistry.getTools()).map(tool => tool.id));
      const entries = await extensionState.plugins.listPluginTools();
      const provider = new PluginToolProvider({ entries, existingToolIds, log });
      const pluginTools = provider.getTools();
      if (pluginTools.length > 0) {
        extensionState.addDisposable(toolRegistry.registerProvider(provider));
        log(`Registered ${pluginTools.length} plugin tools`);
      }
    } catch (error) {
      log(`Failed to load plugin tools: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
    vscode.commands.registerCommand('lingyun.undo', cmdUndo)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.redo', cmdRedo)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.clearSavedSessions', cmdClearSavedSessions)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.compactSession', cmdCompactSession)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.updateMemories', cmdUpdateMemories)
  );
  extensionState.addDisposable(
    vscode.commands.registerCommand('lingyun.dropMemories', cmdDropMemories)
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

  if (!extensionState.agent) {
    throw new Error('Agent not initialized');
  }

  extensionState.chatProvider = new ChatViewProvider(
    context,
    extensionState.agent,
    extensionState.llmProvider,
    extensionState.outputChannel
  );
  extensionState.addDisposable(
    vscode.workspace.registerTextDocumentContentProvider(
      LINGYUN_DIFF_SCHEME,
      new LingyunDiffContentProvider(toolCallId =>
        extensionState?.chatProvider?.toolDiffSnapshotsByToolCallId.get(toolCallId)
      )
    )
  );
  extensionState.addDisposable(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      extensionState.chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  extensionState.addDisposable(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('lingyun') && extensionState?.agent) {
        const providerChanged =
          e.affectsConfiguration('lingyun.llmProvider') ||
          e.affectsConfiguration('lingyun.openaiCompatible.baseURL') ||
          e.affectsConfiguration('lingyun.openaiCompatible.defaultModelId') ||
          e.affectsConfiguration('lingyun.openaiCompatible.modelDisplayNames') ||
          e.affectsConfiguration('lingyun.openaiCompatible.apiKeyEnv') ||
          e.affectsConfiguration('lingyun.openaiCompatible.maxTokens') ||
          e.affectsConfiguration('lingyun.llm.timeoutMs');

        const sessionsChanged =
          e.affectsConfiguration('lingyun.sessions.persist') ||
          e.affectsConfiguration('lingyun.sessions.maxSessions') ||
          e.affectsConfiguration('lingyun.sessions.maxSessionBytes');
        const memoriesChanged =
          e.affectsConfiguration('lingyun.features.memories') ||
          e.affectsConfiguration('lingyun.memories.maxRawMemoriesForGlobal') ||
          e.affectsConfiguration('lingyun.memories.maxRolloutAgeDays') ||
          e.affectsConfiguration('lingyun.memories.maxRolloutsPerStartup') ||
          e.affectsConfiguration('lingyun.memories.minRolloutIdleHours') ||
          e.affectsConfiguration('lingyun.memories.maxStateOutputs') ||
          e.affectsConfiguration('lingyun.memories.phase1Model') ||
          e.affectsConfiguration('lingyun.memories.phase2Model');

        if (providerChanged) {
          initializeLLMAndAgent(context).catch(err => {
            log(`Failed to reinitialize provider: ${err instanceof Error ? err.message : String(err)}`);
          });
          return;
        }

        const nextConfig = createAgentConfig();
        extensionState.agent.updateConfig(nextConfig);
        extensionState.agent.setMode(nextConfig.mode ?? 'build');
        log('Configuration updated');

        if (e.affectsConfiguration('lingyun.autoApprove') && nextConfig.autoApprove) {
          extensionState.chatProvider?.onAutoApproveEnabled();
        }

        if (sessionsChanged) {
          extensionState.chatProvider?.onSessionPersistenceConfigChanged().catch(err => {
            log(`Failed to update session persistence: ${err instanceof Error ? err.message : String(err)}`);
          });
          void maybeWarnSessionPersistence(context);
        }

        if (memoriesChanged || sessionsChanged) {
          void refreshMemoriesOnStartup(context);
        }
      }
    })
  );

  context.subscriptions.push(extensionState);

  log('LingYun activated');
  void maybeWarnSessionPersistence(context);

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

async function cmdClear(): Promise<void> {
  if (extensionState?.chatProvider) {
    await extensionState.chatProvider.clearCurrentSession();
  } else {
    await extensionState?.agent?.clear();
  }
  log('Conversation cleared');
  vscode.window.showInformationMessage('Conversation cleared');
}

async function cmdUndo(): Promise<void> {
  await vscode.commands.executeCommand('lingyun.chatView.focus');
  if (!extensionState?.chatProvider) {
    vscode.window.showInformationMessage('LINGYUN: AGENT view is not ready.');
    return;
  }
  await extensionState.chatProvider.undo();
}

async function cmdRedo(): Promise<void> {
  await vscode.commands.executeCommand('lingyun.chatView.focus');
  if (!extensionState?.chatProvider) {
    vscode.window.showInformationMessage('LINGYUN: AGENT view is not ready.');
    return;
  }
  await extensionState.chatProvider.redo();
}

async function cmdClearSavedSessions(): Promise<void> {
  await extensionState?.chatProvider?.clearSavedSessions();
}

async function cmdCompactSession(): Promise<void> {
  await vscode.commands.executeCommand('lingyun.chatView.focus');
  if (!extensionState?.chatProvider) {
    vscode.window.showInformationMessage('LINGYUN: AGENT view is not ready.');
    return;
  }
  await extensionState.chatProvider.compactCurrentSession();
}

async function cmdUpdateMemories(): Promise<void> {
  if (!extensionState?.memories) return;

  try {
    const result = await extensionState.memories.updateFromSessions();
    const message = result.enabled
      ? `Memories updated: scanned ${result.scannedSessions}, processed ${result.processedSessions}, retained ${result.retainedOutputs}.`
      : 'Memories feature is disabled.';
    log(message);
    void vscode.window.showInformationMessage(`LingYun: ${message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to update memories: ${message}`);
    void vscode.window.showErrorMessage(`LingYun: Failed to update memories (${message}).`);
  }
}

async function cmdDropMemories(): Promise<void> {
  if (!extensionState?.memories) return;

  const choice = await vscode.window.showWarningMessage(
    'Delete generated memories (stored memory artifacts and stage-1 outputs)?',
    { modal: true },
    'Delete'
  );
  if (choice !== 'Delete') return;

  try {
    const result = await extensionState.memories.dropMemories();
    const message = `Dropped memories: removed ${result.removedStateOutputs} stored outputs.`;
    log(message);
    void vscode.window.showInformationMessage(`LingYun: ${message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to drop memories: ${message}`);
    void vscode.window.showErrorMessage(`LingYun: Failed to drop memories (${message}).`);
  }
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

async function maybeWarnSessionPersistence(context: vscode.ExtensionContext): Promise<void> {
  const enabled = getConfig<boolean>('sessions.persist') ?? false;
  if (!enabled) return;

  const warnedKey = 'lingyun.sessions.persist.warned';
  const alreadyWarned = context.globalState.get<boolean>(warnedKey) ?? false;
  if (alreadyWarned) return;

  await context.globalState.update(warnedKey, true);
  void vscode.window.showInformationMessage(
    'LingYun: Session persistence stores chat sessions on disk and may include sensitive data.'
  );
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
