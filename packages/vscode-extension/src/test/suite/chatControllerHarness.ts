import * as vscode from 'vscode';

import type { AgentLoop } from '../../core/agent';
import type { LLMProviderWithUi } from '../../providers/providerUi';
import { ChatController } from '../../ui/chat';

function createMockMemento(): vscode.Memento {
  const values = new Map<string, unknown>();

  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return values.has(key) ? (values.get(key) as T) : defaultValue;
    },
    update(key: string, value: unknown): Thenable<void> {
      values.set(key, value);
      return Promise.resolve();
    },
    keys(): readonly string[] {
      return [...values.keys()];
    },
  };
}

export function createChatTestExtensionContext(): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file('/Users/anchenli/dev/lingyun.public/packages/vscode-extension'),
    globalState: createMockMemento(),
    workspaceState: createMockMemento(),
    storageUri: undefined,
    globalStorageUri: undefined,
  } as unknown as vscode.ExtensionContext;
}

export function createWritableChatTestExtensionContext(storageRoot: vscode.Uri): vscode.ExtensionContext {
  const context = createChatTestExtensionContext() as any;
  context.storageUri = storageRoot;
  context.globalStorageUri = storageRoot;
  context.storagePath = storageRoot.fsPath;
  context.globalStoragePath = storageRoot.fsPath;
  return context as vscode.ExtensionContext;
}

export function createStandaloneChatController(options?: {
  context?: vscode.ExtensionContext;
  agent?: AgentLoop;
  llmProvider?: LLMProviderWithUi;
  outputChannel?: vscode.OutputChannel;
}): ChatController {
  const agent =
    options?.agent ??
    ({
      syncSession() {},
      exportState() {
        return {
          history: [],
          fileHandles: { nextId: 1, byId: {} },
          semanticHandles: {
            nextMatchId: 1,
            nextSymbolId: 1,
            nextLocId: 1,
            matches: {},
            symbols: {},
            locations: {},
          },
          pendingInputs: [],
        };
      },
      getHistory() {
        return [];
      },
    } as unknown as AgentLoop);

  return new ChatController(
    options?.context ?? createChatTestExtensionContext(),
    agent,
    options?.llmProvider,
    options?.outputChannel
  );
}
