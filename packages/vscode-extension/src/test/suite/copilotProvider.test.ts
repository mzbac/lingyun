import * as assert from 'assert';
import * as vscode from 'vscode';

import { CopilotProvider } from '../../providers/copilot';

suite('CopilotProvider', () => {
  test('uses Responses API for Copilot Responses-routed models', async () => {
    for (const modelId of ['gpt-5.3', 'gpt-5.3-codex', 'gpt-5.4', 'gpt-5.5', 'gpt-5.5-codex', 'gpt-6']) {
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

  test('trims Copilot Responses-routed model IDs before routing', async () => {
    const provider = new CopilotProvider({
      createResponsesModel: ({ modelId }: any) => ({
        specificationVersion: 'v3',
        provider: 'copilot',
        modelId,
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error('Not implemented');
        },
        doStream: async () => {
          throw new Error('Not implemented');
        },
      }) as any,
    });
    let chatCalls = 0;

    (provider as any).ensureProvider = async () => {
      (provider as any).provider = {
        chatModel: () => {
          chatCalls += 1;
          return { type: 'chat' };
        },
      };
      (provider as any).cachedProviderToken = 'test-token';
      (provider as any).cachedProviderEditorVersion = `vscode/${vscode.version}`;
      const ext = vscode.extensions.getExtension('mzbac.lingyun');
      (provider as any).cachedProviderPluginVersion = `lingyun/${ext?.packageJSON?.version ?? '0.0.0'}`;
    };

    try {
      const model = (await provider.getModel('  gpt-5.3-codex  ')) as any;

      assert.strictEqual(model?.modelId, 'gpt-5.3-codex');
      assert.strictEqual(chatCalls, 0);
    } finally {
      provider.dispose();
    }
  });

  test('falls back to the default Copilot model for blank model IDs', async () => {
    const provider = new CopilotProvider();
    let requestedModelId = '';
    const fakeChatModel = { type: 'chat' };

    (provider as any).ensureProvider = async () => {
      (provider as any).provider = {
        chatModel: (modelId: string) => {
          requestedModelId = modelId;
          return fakeChatModel;
        },
      };
    };

    try {
      const model = await provider.getModel('   ');

      assert.strictEqual(model, fakeChatModel);
      assert.strictEqual(requestedModelId, 'gpt-4o');
    } finally {
      provider.dispose();
    }
  });

  test('uses chat model path for GPT-5 models below GPT-5.3', async () => {
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
      assert.strictEqual(await provider.getModel('gpt-5'), fakeChatModel);
      assert.strictEqual(await provider.getModel('gpt-5.2'), fakeChatModel);
      assert.strictEqual(chatCalls, 2);
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

  test('annotates Copilot chat-model errors with provider and model metadata', async () => {
    const provider = new CopilotProvider();
    const generateError: any = Object.assign(new Error('copilot rate limited'), {
      name: 'AI_APICallError',
      statusCode: 429,
      responseHeaders: { 'x-github-request-id': 'copilot_chat_generate_1' },
      retryAfterMs: 2000,
      code: 'rate_limit_exceeded',
    });
    const streamError = Object.assign(new Error('copilot stream failed'), {
      name: 'AI_APICallError',
      status: 503,
      headers: { 'x-github-request-id': 'copilot_chat_stream_1' },
      type: 'server_error',
    });
    const fakeChatModel = {
      specificationVersion: 'v3',
      provider: 'copilot-chat',
      modelId: 'raw-model',
      supportedUrls: {},
      doGenerate: async () => {
        throw generateError;
      },
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'error', error: streamError });
            controller.close();
          },
        }),
      }),
    };

    (provider as any).ensureProvider = async () => {
      (provider as any).provider = { chatModel: () => fakeChatModel };
    };

    try {
      const model = (await provider.getModel('  gpt-4o  ')) as any;
      let thrown: any;
      try {
        await model.doGenerate({});
      } catch (error) {
        thrown = error;
      }

      assert.strictEqual(thrown, generateError);
      assert.strictEqual(thrown.provider, 'copilot');
      assert.strictEqual(thrown.providerId, 'copilot');
      assert.strictEqual(thrown.modelId, 'gpt-4o');
      assert.strictEqual(thrown.status, 429);
      assert.strictEqual(thrown.statusCode, 429);
      assert.deepStrictEqual(thrown.responseHeaders, { 'x-github-request-id': 'copilot_chat_generate_1' });
      assert.strictEqual(thrown.retryAfterMs, 2000);
      assert.strictEqual(thrown.errorCode, 'rate_limit_exceeded');

      const result = await model.doStream({});
      const reader = result.stream.getReader();
      const { value, done } = await reader.read();
      reader.releaseLock();

      assert.strictEqual(done, false);
      assert.strictEqual(value.error, streamError);
      assert.strictEqual(value.error.provider, 'copilot');
      assert.strictEqual(value.error.providerId, 'copilot');
      assert.strictEqual(value.error.modelId, 'gpt-4o');
      assert.strictEqual(value.error.status, 503);
      assert.strictEqual(value.error.statusCode, 503);
      assert.deepStrictEqual(value.error.responseHeaders, { 'x-github-request-id': 'copilot_chat_stream_1' });
      assert.strictEqual(value.error.errorType, 'server_error');
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

  test('includes Responses-routed models in fallback catalog when VS Code LM discovery is unavailable', async () => {
    const provider = new CopilotProvider({
      selectChatModels: async () => [],
    });

    try {
      const models = await provider.getModels();

      assert.deepStrictEqual(
        models.map((model) => model.id),
        ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-4.1', 'gpt-4o'],
      );
      assert.deepStrictEqual(models.find((model) => model.id === 'gpt-5.5'), {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        vendor: 'copilot',
        family: 'gpt-5',
        maxInputTokens: 950000,
        maxOutputTokens: 128000,
      });
      assert.deepStrictEqual(models.find((model) => model.id === 'gpt-5.4'), {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        vendor: 'copilot',
        family: 'gpt-5',
        maxInputTokens: 950000,
        maxOutputTokens: 128000,
      });
      assert.deepStrictEqual(models.find((model) => model.id === 'gpt-5.3-codex'), {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        vendor: 'copilot',
        family: 'gpt-codex',
        maxInputTokens: 380000,
        maxOutputTokens: 128000,
      });
    } finally {
      provider.dispose();
    }
  });

  test('merges partial VS Code LM discovery with fallback Copilot models', async () => {
    const provider = new CopilotProvider({
      selectChatModels: async () => [
        {
          id: ' gpt-5.4 ',
          name: 'VS Code GPT-5.4',
          vendor: 'vscode-copilot',
          family: 'gpt-5-vscode',
          maxInputTokens: 777777,
          maxOutputTokens: '64000',
        } as any,
        {
          id: ' vscode-only-model ',
          name: '  ',
          vendor: '  ',
          family: '  ',
          maxInputTokens: '123456',
        } as any,
        {
          id: ' gpt-5.3-codex ',
          name: '  ',
          vendor: '  ',
          family: '  ',
        } as any,
        {
          id: '   ',
          name: 'Blank ID Model',
          vendor: 'copilot',
          family: 'gpt-5',
          maxInputTokens: 999999,
        } as any,
      ],
    });

    try {
      const models = await provider.getModels();

      assert.deepStrictEqual(
        models.map((model) => model.id),
        ['gpt-5.4', 'vscode-only-model', 'gpt-5.3-codex', 'gpt-5.5', 'gpt-4.1', 'gpt-4o'],
      );
      assert.deepStrictEqual(models[0], {
        id: 'gpt-5.4',
        name: 'VS Code GPT-5.4',
        vendor: 'vscode-copilot',
        family: 'gpt-5-vscode',
        maxInputTokens: 777777,
        maxOutputTokens: 64000,
      });
      assert.deepStrictEqual(models[1], {
        id: 'vscode-only-model',
        name: 'vscode-only-model',
        vendor: 'copilot',
        family: 'unknown',
        maxInputTokens: 123456,
      });
      assert.deepStrictEqual(models.find((model) => model.id === 'gpt-5.3-codex'), {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        vendor: 'copilot',
        family: 'gpt-codex',
        maxInputTokens: 380000,
        maxOutputTokens: 128000,
      });
    } finally {
      provider.dispose();
    }
  });

  test('coalesces concurrent Copilot model discovery requests', async () => {
    const lmDescriptor = Object.getOwnPropertyDescriptor(vscode.lm, 'selectChatModels');
    let requestCount = 0;
    let releaseResponse!: () => void;
    let markRequestObserved!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requestObserved = new Promise<void>((resolve) => {
      markRequestObserved = resolve;
    });

    Object.defineProperty(vscode.lm, 'selectChatModels', {
      configurable: true,
      value: async () => {
        requestCount += 1;
        markRequestObserved();
        await responseGate;
        return [
          {
            id: 'copilot-concurrent-model',
            name: 'Copilot Concurrent Model',
            vendor: 'copilot',
            family: 'gpt-5',
            maxInputTokens: 123456,
            maxOutputTokens: 8192,
          },
        ];
      },
    });

    const provider = new CopilotProvider();
    const pendingLoads: Array<Promise<unknown>> = [];
    try {
      const first = provider.getModels();
      const second = provider.getModels();
      pendingLoads.push(first, second);
      await requestObserved;
      assert.strictEqual(requestCount, 1);

      releaseResponse();
      const [firstModels, secondModels] = await Promise.all([first, second]);
      assert.strictEqual(firstModels, secondModels);
      assert.deepStrictEqual(firstModels, [
        {
          id: 'copilot-concurrent-model',
          name: 'Copilot Concurrent Model',
          vendor: 'copilot',
          family: 'gpt-5',
          maxInputTokens: 123456,
          maxOutputTokens: 8192,
        },
        {
          id: 'gpt-5.5',
          name: 'GPT-5.5',
          vendor: 'copilot',
          family: 'gpt-5',
          maxInputTokens: 950000,
          maxOutputTokens: 128000,
        },
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          vendor: 'copilot',
          family: 'gpt-5',
          maxInputTokens: 950000,
          maxOutputTokens: 128000,
        },
        {
          id: 'gpt-5.3-codex',
          name: 'GPT-5.3 Codex',
          vendor: 'copilot',
          family: 'gpt-codex',
          maxInputTokens: 380000,
          maxOutputTokens: 128000,
        },
        {
          id: 'gpt-4.1',
          name: 'gpt-4.1',
          vendor: 'copilot',
          family: 'gpt-4',
        },
        {
          id: 'gpt-4o',
          name: 'gpt-4o',
          vendor: 'copilot',
          family: 'gpt-4o',
        },
      ]);

      const cached = await provider.getModels();
      assert.strictEqual(cached, firstModels);
      assert.strictEqual(requestCount, 1);
    } finally {
      releaseResponse();
      await Promise.allSettled(pendingLoads);
      provider.dispose();
      if (lmDescriptor) {
        Object.defineProperty(vscode.lm, 'selectChatModels', lmDescriptor);
      }
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
    let requestAuth = '';
    const provider = new CopilotProvider({
      fetch: async (_input: any, init?: any) => {
        requestAuth = new Headers(init?.headers).get('authorization') || '';
        return new Response(JSON.stringify({ message: 'Copilot entitlement expired' }), {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'x-github-request-id': 'copilot_req_1',
          },
        });
      },
    });

    (provider as any).getGitHubToken = async () => 'github-token';

    try {
      let thrown: any;
      try {
        await (provider as any).getCopilotToken();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getCopilotToken to reject');
      assert.strictEqual(requestAuth, 'Bearer github-token');
      assert.strictEqual(thrown.status, 403);
      assert.strictEqual(thrown.statusCode, 403);
      assert.strictEqual(thrown.url, 'https://api.github.com/copilot_internal/v2/token');
      assert.doesNotMatch(thrown.message, /Copilot entitlement expired/);
      assert.strictEqual(thrown.responseBody, '<redacted>');
      assert.strictEqual(thrown.responseHeaders?.['x-github-request-id'], 'copilot_req_1');
      assert.strictEqual(provider.getAuthRetryLabel?.(thrown, { modelId: 'gpt-4o', mode: 'build' }), provider.name);
    } finally {
      provider.dispose();
    }
  });

  test('redacts malformed Copilot token JSON responses', async () => {
    const provider = new CopilotProvider({
      fetch: async () =>
        new Response('{"token":', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-github-request-id': 'copilot_req_parse',
          },
        }),
    });

    (provider as any).getGitHubToken = async () => 'github-token';

    try {
      let thrown: any;
      try {
        await (provider as any).getCopilotToken();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getCopilotToken to reject');
      assert.strictEqual(thrown.name, 'ProviderParseError');
      assert.strictEqual(thrown.status, 200);
      assert.strictEqual(thrown.statusCode, 200);
      assert.strictEqual(thrown.url, 'https://api.github.com/copilot_internal/v2/token');
      assert.strictEqual(thrown.responseBody, '<redacted>');
      assert.strictEqual(thrown.responseHeaders?.['x-github-request-id'], 'copilot_req_parse');
      assert.strictEqual(thrown.requestId, 'copilot_req_parse');
      assert.strictEqual(thrown.provider, 'copilot');
      assert.strictEqual(thrown.providerId, 'copilot');
      assert.strictEqual(thrown.code, 'invalid_json');
      assert.strictEqual(thrown.type, 'invalid_response');
    } finally {
      provider.dispose();
    }
  });

  test('accepts numeric string Copilot token expires_at values', async () => {
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600;
    const provider = new CopilotProvider({
      fetch: async () =>
        new Response(JSON.stringify({
          token: 'fresh-copilot-token',
          expires_at: String(expiresAtSeconds),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    (provider as any).getGitHubToken = async () => 'github-token';

    try {
      const token = await (provider as any).getCopilotToken();

      assert.strictEqual(token, 'fresh-copilot-token');
      assert.strictEqual((provider as any).copilotToken, 'fresh-copilot-token');
      assert.strictEqual((provider as any).tokenExpiry, expiresAtSeconds * 1000);
    } finally {
      provider.dispose();
    }
  });

  test('coalesces concurrent Copilot token requests', async () => {
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600;
    let githubTokenCalls = 0;
    let fetchCalls = 0;
    let releaseResponse!: () => void;
    let markRequestObserved!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requestObserved = new Promise<void>((resolve) => {
      markRequestObserved = resolve;
    });
    const provider = new CopilotProvider({
      fetch: async () => {
        fetchCalls += 1;
        markRequestObserved();
        await responseGate;
        return new Response(JSON.stringify({
          token: 'coalesced-copilot-token',
          expires_at: expiresAtSeconds,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    (provider as any).getGitHubToken = async () => {
      githubTokenCalls += 1;
      return 'github-token';
    };

    const pending: Array<Promise<unknown>> = [];
    try {
      const first = (provider as any).getCopilotToken();
      const second = (provider as any).getCopilotToken();
      pending.push(first, second);
      await requestObserved;

      assert.strictEqual(githubTokenCalls, 1);
      assert.strictEqual(fetchCalls, 1);

      releaseResponse();
      const [firstToken, secondToken] = await Promise.all([first, second]);

      assert.strictEqual(firstToken, 'coalesced-copilot-token');
      assert.strictEqual(secondToken, 'coalesced-copilot-token');
      assert.strictEqual((provider as any).copilotToken, 'coalesced-copilot-token');
      assert.strictEqual((provider as any).copilotTokenPromise, null);

      const cached = await (provider as any).getCopilotToken();
      assert.strictEqual(cached, 'coalesced-copilot-token');
      assert.strictEqual(githubTokenCalls, 1);
      assert.strictEqual(fetchCalls, 1);
    } finally {
      releaseResponse();
      await Promise.allSettled(pending);
      provider.dispose();
    }
  });

  test('clears failed Copilot token request coalescer so later calls can retry', async () => {
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600;
    let fetchCalls = 0;
    const provider = new CopilotProvider({
      fetch: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return new Response(JSON.stringify({ message: 'temporary Copilot token failure' }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          token: 'retried-copilot-token',
          expires_at: expiresAtSeconds,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    (provider as any).getGitHubToken = async () => 'github-token';

    try {
      const [first, second] = await Promise.allSettled([
        (provider as any).getCopilotToken(),
        (provider as any).getCopilotToken(),
      ]);

      assert.strictEqual(first.status, 'rejected');
      assert.strictEqual(second.status, 'rejected');
      assert.strictEqual(fetchCalls, 1);
      assert.strictEqual((provider as any).copilotToken, null);
      assert.strictEqual((provider as any).tokenExpiry, 0);
      assert.strictEqual((provider as any).copilotTokenPromise, null);

      const token = await (provider as any).getCopilotToken();
      assert.strictEqual(token, 'retried-copilot-token');
      assert.strictEqual(fetchCalls, 2);
      assert.strictEqual((provider as any).copilotToken, 'retried-copilot-token');
    } finally {
      provider.dispose();
    }
  });

  test('redacts invalid Copilot token payloads without caching token', async () => {
    const provider = new CopilotProvider({
      fetch: async () =>
        new Response(JSON.stringify({ token: '', expires_at: 'soon' }), {
          status: 200,
          statusText: 'OK',
          headers: {
            'Content-Type': 'application/json',
            'x-github-request-id': 'copilot_req_validation',
          },
        }),
    });

    (provider as any).getGitHubToken = async () => 'github-token';

    try {
      let thrown: any;
      try {
        await (provider as any).getCopilotToken();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getCopilotToken to reject');
      assert.strictEqual(thrown.name, 'ProviderValidationError');
      assert.match(thrown.message, /Failed to parse Copilot token response: invalid response payload \(HTTP 200 OK\)/);
      assert.match(thrown.message, /token/);
      assert.strictEqual(thrown.status, 200);
      assert.strictEqual(thrown.statusCode, 200);
      assert.strictEqual(thrown.url, 'https://api.github.com/copilot_internal/v2/token');
      assert.strictEqual(thrown.responseBody, '<redacted>');
      assert.strictEqual(thrown.responseHeaders?.['x-github-request-id'], 'copilot_req_validation');
      assert.strictEqual(thrown.requestId, 'copilot_req_validation');
      assert.strictEqual(thrown.provider, 'copilot');
      assert.strictEqual(thrown.providerId, 'copilot');
      assert.strictEqual(thrown.code, 'invalid_response_payload');
      assert.strictEqual(thrown.type, 'invalid_response');
      assert.match(thrown.validationMessage, /token/);
      assert.strictEqual((provider as any).copilotToken, null);
      assert.strictEqual((provider as any).tokenExpiry, 0);
    } finally {
      provider.dispose();
    }
  });
});
