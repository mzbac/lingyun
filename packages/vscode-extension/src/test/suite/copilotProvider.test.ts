import * as assert from 'assert';
import * as vscode from 'vscode';

import { CopilotProvider } from '../../providers/copilot';

suite('CopilotProvider', () => {
  test('uses Responses API only for gpt-5.3-codex', async () => {
    const provider = new CopilotProvider();
    let responsesCalls = 0;
    let chatCalls = 0;

    const fakeResponsesModel = { type: 'responses' };
    const fakeChatModel = { type: 'chat' };

    (provider as any).ensureProvider = async () => {
      (provider as any).provider = {
        chatModel: () => {
          chatCalls += 1;
          return fakeChatModel;
        },
      };
      (provider as any).responsesProvider = {
        responses: () => {
          responsesCalls += 1;
          return fakeResponsesModel;
        },
      };
    };

    try {
      const model = await provider.getModel('gpt-5.3-codex');

      assert.strictEqual(model, fakeResponsesModel);
      assert.strictEqual(responsesCalls, 1);
      assert.strictEqual(chatCalls, 0);
    } finally {
      provider.dispose();
    }
  });

  test('uses chat model path for other GPT-5 models', async () => {
    const provider = new CopilotProvider();
    let chatCalls = 0;
    let responsesCalls = 0;

    const fakeChatModel = { type: 'chat' };

    (provider as any).ensureProvider = async () => {
      (provider as any).provider = {
        chatModel: () => {
          chatCalls += 1;
          return fakeChatModel;
        },
      };
      (provider as any).responsesProvider = {
        responses: () => {
          responsesCalls += 1;
          return { type: 'responses' };
        },
      };
    };

    try {
      const model = await provider.getModel('gpt-5');

      assert.strictEqual(model, fakeChatModel);
      assert.strictEqual(chatCalls, 1);
      assert.strictEqual(responsesCalls, 0);
    } finally {
      provider.dispose();
    }
  });

  test('uses chat model path for non-GPT-5 models', async () => {
    const provider = new CopilotProvider();
    let chatCalls = 0;

    const fakeChatModel = { type: 'chat' };

    (provider as any).ensureProvider = async () => {
      (provider as any).provider = {
        chatModel: () => {
          chatCalls += 1;
          return fakeChatModel;
        },
      };
    };

    try {
      const model = await provider.getModel('gpt-4o');

      assert.strictEqual(model, fakeChatModel);
      assert.strictEqual(chatCalls, 1);
    } finally {
      provider.dispose();
    }
  });

  test('uses dynamic VS Code + extension version headers', async () => {
    const provider = new CopilotProvider();

    // Avoid auth/network in tests.
    (provider as any).getCopilotToken = async () => 'test-token';

    await provider.getModel('gpt-4o');

    assert.strictEqual((provider as any).cachedProviderEditorVersion, `vscode/${vscode.version}`);

    const ext = vscode.extensions.getExtension('mzbac.lingyun');
    assert.ok(ext, 'Expected mzbac.lingyun extension to be available during tests');
    assert.strictEqual((provider as any).cachedProviderPluginVersion, `lingyun/${ext.packageJSON.version}`);
  });

  test('clears cached client and token after auth-like errors', () => {
    const provider = new CopilotProvider();

    (provider as any).copilotToken = 'stale-token';
    (provider as any).tokenExpiry = Date.now() + 60_000;
    (provider as any).cachedProviderToken = 'stale-token';
    (provider as any).provider = { fake: true };

    provider.onRequestError?.(new Error('401 Unauthorized'), { modelId: 'gpt-4o', mode: 'plan' });

    assert.strictEqual((provider as any).provider, null);
    assert.strictEqual((provider as any).cachedProviderToken, null);
    assert.strictEqual((provider as any).copilotToken, null);
    assert.strictEqual((provider as any).tokenExpiry, 0);
  });
});
