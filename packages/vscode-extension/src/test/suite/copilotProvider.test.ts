import * as assert from 'assert';
import * as vscode from 'vscode';

import { CopilotProvider } from '../../providers/copilot';

suite('CopilotProvider', () => {
  test('uses Responses API only for gpt-5.3-codex', async () => {
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
      (provider as any).cachedProviderToken = 'test-token';
      (provider as any).cachedProviderEditorVersion = `vscode/${vscode.version}`;
      const ext = vscode.extensions.getExtension('mzbac.lingyun');
      (provider as any).cachedProviderPluginVersion = `lingyun/${ext?.packageJSON?.version ?? '0.0.0'}`;
    };

    try {
      const model = (await provider.getModel('gpt-5.3-codex')) as any;

      assert.strictEqual(model?.specificationVersion, 'v3');
      assert.strictEqual(model?.modelId, 'gpt-5.3-codex');
      assert.strictEqual(typeof model?.doStream, 'function');
      assert.strictEqual(chatCalls, 0);
    } finally {
      provider.dispose();
    }
  });

  test('responses model is normalized for stream protocol quirks', async () => {
    const provider = new CopilotProvider({
      createResponsesModel: ({ modelId }: any) => {
        return {
          specificationVersion: 'v3',
          provider: 'copilot',
          modelId,
          supportedUrls: {},
          doGenerate: async () => {
            throw new Error('Not implemented');
          },
          doStream: async () => {
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'text-delta', id: 't0', delta: 'H' });
                controller.enqueue({ type: 'text-end', id: 't0' });
                controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} });
                controller.close();
              },
            });
            return { stream } as any;
          },
        };
      },
    });

    (provider as any).ensureProvider = async () => {
      (provider as any).provider = { chatModel: () => ({ type: 'chat' }) };
      (provider as any).cachedProviderToken = 'test-token';
      (provider as any).cachedProviderEditorVersion = `vscode/${vscode.version}`;
      const ext = vscode.extensions.getExtension('mzbac.lingyun');
      (provider as any).cachedProviderPluginVersion = `lingyun/${ext?.packageJSON?.version ?? '0.0.0'}`;
    };

    try {
      const model = (await provider.getModel('gpt-5.3-codex')) as any;
      const result = await model.doStream({});
      const reader = result.stream.getReader();
      const first = await reader.read();
      const second = await reader.read();

      assert.strictEqual(first.value?.type, 'text-start');
      assert.strictEqual(second.value?.type, 'text-delta');
    } finally {
      provider.dispose();
    }
  });

  test('uses chat model path for other GPT-5 models', async () => {
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
      (provider as any).cachedProviderToken = 'test-token';
    };

    try {
      const model = await provider.getModel('gpt-5');

      assert.strictEqual(model, fakeChatModel);
      assert.strictEqual(chatCalls, 1);
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
