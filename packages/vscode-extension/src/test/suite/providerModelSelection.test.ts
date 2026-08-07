import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { resolveModelIdForProvider } from '../../core/modelSelection';
import { ChatController } from '../../ui/chat';
import { createChatTestExtensionContext, createWritableChatTestExtensionContext } from './chatControllerHarness';

function createBlankAgentState(): AgentSessionState {
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
}

function createMockAgent(): AgentLoop {
  let exportedState = createBlankAgentState();

  return {
    syncSession(params?: { state?: AgentSessionState }) {
      exportedState = params?.state ?? createBlankAgentState();
    },
    exportState() {
      return exportedState;
    },
    getHistory() {
      return exportedState.history;
    },
  } as unknown as AgentLoop;
}

async function withProviderConfig(
  updates: Record<string, unknown>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('lingyun');
  const previous = new Map<string, unknown>();

  for (const key of Object.keys(updates)) {
    previous.set(key, config.get(key));
    await config.update(key, updates[key], vscode.ConfigurationTarget.Global);
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
  }
}

suite('Provider model selection', () => {
  test('falls back to the codex default when the configured model is the copilot default', () => {
    assert.strictEqual(
      resolveModelIdForProvider({
        providerId: 'codexSubscription',
        configuredModel: 'gpt-4o',
        codexSubscriptionDefaultModelId: 'gpt-5.4',
      }),
      'gpt-5.4',
    );
  });

  test('preserves an explicit codex model selection', () => {
    assert.strictEqual(
      resolveModelIdForProvider({
        providerId: 'codexSubscription',
        configuredModel: 'gpt-5.3-codex',
        codexSubscriptionDefaultModelId: 'gpt-5.4',
      }),
      'gpt-5.3-codex',
    );
  });

  test('falls back to the OpenAI-compatible default when the configured model is the copilot default', () => {
    assert.strictEqual(
      resolveModelIdForProvider({
        providerId: 'openaiCompatible',
        configuredModel: 'gpt-4o',
        openaiCompatibleDefaultModelId: 'local-coder',
      }),
      'local-coder',
    );
  });

  test('preserves an explicit OpenAI-compatible model selection', () => {
    assert.strictEqual(
      resolveModelIdForProvider({
        providerId: 'openaiCompatible',
        configuredModel: 'qwen3-coder',
        openaiCompatibleDefaultModelId: 'local-coder',
      }),
      'qwen3-coder',
    );
  });
});

suite('Chat controller codex provider integration', () => {
  test('constructor uses the codex default model instead of the copilot default', async () => {
    await withProviderConfig(
      {
        llmProvider: 'codexSubscription',
        model: 'gpt-4o',
        'codexSubscription.defaultModelId': 'gpt-5.4',
        'sessions.persist': false,
      },
      async () => {
        const controller = new ChatController(
          createChatTestExtensionContext(),
          createMockAgent(),
          { id: 'codexSubscription', name: 'ChatGPT Codex Subscription' } as any,
        );

        assert.strictEqual(controller.currentModel, 'gpt-5.4');
        assert.strictEqual(controller.sessionApi.getActiveSession().currentModel, 'gpt-5.4');
      },
    );
  });

  test('setBackend resets to the codex default model when switching providers', async () => {
    await withProviderConfig(
      {
        llmProvider: 'codexSubscription',
        model: 'gpt-4o',
        'codexSubscription.defaultModelId': 'gpt-5.4',
        'sessions.persist': false,
      },
      async () => {
        const controller = new ChatController(
          createChatTestExtensionContext(),
          createMockAgent(),
          { id: 'copilot', name: 'GitHub Copilot' } as any,
        );

        await controller.sessionApi.setBackend(createMockAgent(), {
          id: 'codexSubscription',
          name: 'ChatGPT Codex Subscription',
        } as any);

        assert.strictEqual(controller.currentModel, 'gpt-5.4');
        assert.strictEqual(controller.sessionApi.getActiveSession().currentModel, 'gpt-5.4');
      },
    );
  });

  test('setBackend re-applies the configured model after restoring a persisted session with a stale model', async () => {
    const storageRoot = vscode.Uri.file(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingyun-test-stale-model-')));
    const context = createWritableChatTestExtensionContext(storageRoot);

    // Simulate a session persisted before the provider/model switch: it still
    // remembers a gpt-5.x model that the current OpenAI-compatible server rejects.
    const staleSessionId = 'stale-session-1';
    const sessionsDir = vscode.Uri.joinPath(storageRoot, 'sessions');
    await vscode.workspace.fs.createDirectory(sessionsDir);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(sessionsDir, 'index.json'),
      Buffer.from(
        JSON.stringify({
          version: 3,
          activeSessionId: staleSessionId,
          order: [staleSessionId],
          sessionsMeta: {
            [staleSessionId]: { title: 'Stale', createdAt: 1, updatedAt: 1 },
          },
        }),
      ),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(sessionsDir, `${staleSessionId}.json`),
      Buffer.from(
        JSON.stringify({
          id: staleSessionId,
          title: 'Stale',
          createdAt: 1,
          updatedAt: 1,
          currentModel: 'gpt-5.3-codex',
          mode: 'build',
          stepCounter: 0,
        }),
      ),
    );

    try {
      await withProviderConfig(
        {
          llmProvider: 'openaiCompatible',
          model: 'deepseek-v4-flash',
          'sessions.persist': true,
        },
        async () => {
          const controller = new ChatController(context, createMockAgent(), {
            id: 'openaiCompatible',
            name: 'OpenAI-Compatible',
          } as any);

          await controller.sessionApi.setBackend(createMockAgent(), {
            id: 'openaiCompatible',
            name: 'OpenAI-Compatible',
          } as any);

          assert.strictEqual(
            controller.currentModel,
            'deepseek-v4-flash',
            'the configured model should win over the stale persisted session model',
          );
          assert.strictEqual(
            controller.sessionApi.getActiveSession().currentModel,
            'deepseek-v4-flash',
            'the restored session should adopt the configured model',
          );
        },
      );
    } finally {
      await fs.promises.rm(storageRoot.fsPath, { recursive: true, force: true });
    }
  });
});
