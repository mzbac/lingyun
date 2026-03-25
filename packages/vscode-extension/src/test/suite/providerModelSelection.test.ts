import * as assert from 'assert';
import * as vscode from 'vscode';

import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { resolveModelIdForProvider } from '../../core/modelSelection';
import { ChatController } from '../../ui/chat';
import { createChatTestExtensionContext } from './chatControllerHarness';

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
});
