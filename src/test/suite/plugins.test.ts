import * as assert from 'assert';
import * as vscode from 'vscode';

import { PluginManager } from '../../core/hooks/pluginManager';
import { PluginToolProvider } from '../../core/hooks/pluginToolProvider';

suite('Plugins', () => {
  test('plugin tool map - registers tool entries and executes', async () => {
    const context = createMockExtensionContext();
    const plugins = new PluginManager(context);

    plugins.registerHooks('test', {
      tool: {
        'plugin.echo': {
          name: 'Plugin Echo',
          description: 'Echo tool from plugin',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          execute: async (args) => {
            return { success: true, data: `Echo: ${String(args.message)}` };
          },
        },
      },
    });

    const entries = await plugins.listPluginTools();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].toolId, 'plugin.echo');

    const provider = new PluginToolProvider({
      entries,
      existingToolIds: new Set<string>(),
      log: () => {},
    });

    const tools = provider.getTools();
    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].id, 'plugin.echo');

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const result = await provider.executeTool(
        'plugin.echo',
        { message: 'Hello' },
        {
          workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
          activeEditor: vscode.window.activeTextEditor,
          extensionContext: context,
          cancellationToken: tokenSource.token,
          progress: { report: () => {} },
          log: () => {},
        },
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, 'Echo: Hello');
    } finally {
      tokenSource.dispose();
    }
  });
});

function createMockExtensionContext(): vscode.ExtensionContext {
  const envVarCollection: vscode.GlobalEnvironmentVariableCollection = {
    persistent: true,
    description: undefined,
    replace: () => {},
    append: () => {},
    prepend: () => {},
    get: () => undefined,
    forEach: () => {},
    delete: () => {},
    clear: () => {},
    getScoped: () => envVarCollection,
    [Symbol.iterator]: function* () {
      // no-op iterator for tests
    },
  };

  return {
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: async () => {},
      keys: () => [],
    },
    globalState: {
      get: () => undefined,
      update: async () => {},
      keys: () => [],
      setKeysForSync: () => {},
    },
    extensionPath: '/mock/extension',
    extensionUri: vscode.Uri.file('/mock/extension'),
    asAbsolutePath: (p: string) => `/mock/extension/${p}`,
    storagePath: '/mock/storage',
    storageUri: vscode.Uri.file('/mock/storage'),
    globalStoragePath: '/mock/global',
    globalStorageUri: vscode.Uri.file('/mock/global'),
    logPath: '/mock/log',
    logUri: vscode.Uri.file('/mock/log'),
    extensionMode: vscode.ExtensionMode.Test,
    environmentVariableCollection: envVarCollection,
    extension: undefined as any,
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    },
    storage: undefined as any,
    globalStorage: undefined as any,
    log: undefined as any,
    extensionRuntime: undefined as any,
  } as unknown as vscode.ExtensionContext;
}

