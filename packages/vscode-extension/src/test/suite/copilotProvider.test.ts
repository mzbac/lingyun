import * as assert from 'assert';
import * as vscode from 'vscode';

import { CopilotProvider } from '../../providers/copilot';

suite('CopilotProvider', () => {
  test('uses Responses API for Copilot Responses-only models', async () => {
    for (const modelId of ['gpt-5.3-codex', 'gpt-5.4']) {
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
        const model = (await provider.getModel(modelId)) as any;

        assert.strictEqual(model?.specificationVersion, 'v3');
        assert.strictEqual(model?.modelId, modelId);
        assert.strictEqual(typeof model?.doStream, 'function');
        assert.strictEqual(chatCalls, 0);
      } finally {
        provider.dispose();
      }
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

  test('uses chat model path for Copilot Claude models instead of Responses API', async () => {
    let responsesCalls = 0;
    const provider = new CopilotProvider({
      createResponsesModel: (() => {
        responsesCalls += 1;
        return { type: 'responses' } as any;
      }) as any,
    });
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
      const model = await provider.getModel('claude-sonnet-4.5');

      assert.strictEqual(model, fakeChatModel);
      assert.strictEqual(chatCalls, 1);
      assert.strictEqual(responsesCalls, 0);
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

  test('attaches structured metadata to Copilot token HTTP errors', async () => {
    const provider = new CopilotProvider();
    const originalFetch = globalThis.fetch;

    (provider as any).getGitHubToken = async () => 'github-token';

    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ message: 'Copilot entitlement expired' }), {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'x-github-request-id': 'copilot_req_1',
          },
        });

      let thrown: any;
      try {
        await (provider as any).getCopilotToken();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getCopilotToken to reject');
      assert.strictEqual(thrown.status, 403);
      assert.strictEqual(thrown.statusCode, 403);
      assert.strictEqual(thrown.url, 'https://api.github.com/copilot_internal/v2/token');
      assert.match(thrown.responseBody, /Copilot entitlement expired/);
      assert.strictEqual(thrown.responseHeaders?.['x-github-request-id'], 'copilot_req_1');
      assert.strictEqual(provider.getAuthRetryLabel?.(thrown, { modelId: 'gpt-4o', mode: 'build' }), provider.name);
    } finally {
      globalThis.fetch = originalFetch;
      provider.dispose();
    }
  });
});
