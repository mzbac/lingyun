import * as assert from 'assert';
import type { FetchFunction } from '@ai-sdk/provider-utils';

import { CodexSubscriptionProvider } from '../../providers/codexSubscription';

function encodeSseEvents(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function createTestContext(): any {
  return {
    extension: { packageJSON: { version: '2.2.0-test' } },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
      onDidChange: () => ({ dispose() {} }),
    },
  };
}

function requestUrl(input: unknown): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : String((input as { url?: string })?.url || input);
}

suite('CodexSubscriptionProvider', () => {
  test('loads provider-aware model metadata from the Codex models endpoint', async () => {
    let fetchCount = 0;
    let capturedUrl = '';
    let requestHeaders: Headers | undefined;

    const fetchFn: FetchFunction = async (input, init) => {
      fetchCount += 1;
      capturedUrl = requestUrl(input);
      requestHeaders = new Headers(init?.headers);

      return new Response(
        JSON.stringify({
          models: [
            {
              slug: 'hidden-model',
              display_name: 'Hidden Model',
              visibility: 'hidden',
              priority: 0,
              context_window: 999999,
            },
            {
              slug: 'gpt-5.3-codex',
              display_name: 'GPT-5.3 Codex',
              visibility: 'list',
              priority: 1,
              context_window: 400000,
              max_output_tokens: 128000,
            },
            {
              slug: 'gpt-5.4',
              display_name: 'GPT-5.4',
              visibility: 'list',
              priority: 2,
              context_window: 272000,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
      fetch: fetchFn,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    try {
      const models = await provider.getModels();
      const modelsAgain = await provider.getModels();

      assert.strictEqual(fetchCount, 1);
      assert.strictEqual(modelsAgain, models);
      assert.strictEqual(
        capturedUrl,
        'https://chatgpt.com/backend-api/codex/models?client_version=2.2.0-test',
      );
      assert.strictEqual(requestHeaders?.get('authorization'), 'Bearer test-access-token');
      assert.strictEqual(requestHeaders?.get('ChatGPT-Account-Id'), 'org_123');
      assert.strictEqual(requestHeaders?.get('originator'), 'lingyun');
      assert.strictEqual(requestHeaders?.get('user-agent'), 'lingyun/2.2.0-test');
      assert.strictEqual(requestHeaders?.get('accept'), 'application/json');

      assert.deepStrictEqual(models, [
        {
          id: 'gpt-5.3-codex',
          name: 'GPT-5.3 Codex',
          vendor: 'chatgpt',
          family: 'gpt-codex',
          maxInputTokens: 380000,
          maxOutputTokens: 128000,
        },
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          vendor: 'chatgpt',
          family: 'gpt-5',
          maxInputTokens: 258400,
          maxOutputTokens: 128000,
        },
      ]);
      assert.ok(!models.some((model) => model.id === 'gpt-5.2'));
      assert.ok(!models.some((model) => model.id === 'hidden-model'));
    } finally {
      provider.dispose();
    }
  });

  test('falls back to the hardcoded model list when metadata loading fails', async () => {
    const logLines: string[] = [];
    const fetchFn: FetchFunction = async () =>
      new Response(JSON.stringify({ detail: 'server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
      outputChannel: {
        appendLine(line: string) {
          logLines.push(line);
        },
      } as any,
      fetch: fetchFn,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    try {
      const models = await provider.getModels();
      assert.ok(
        logLines.some((line) => line.includes('Failed to load Codex models (falling back to bundled list)')),
        'expected model discovery fallback to be logged',
      );
      assert.ok(logLines.some((line) => line.includes('status=500')), 'expected model discovery status to be logged');
      assert.deepStrictEqual(
        models.map((model) => model.id),
        [
          'gpt-5.5',
          'gpt-5.4',
          'gpt-5.3-codex',
          'gpt-5.2',
          'gpt-5.2-codex',
          'gpt-5.1-codex',
          'gpt-5.1-codex-max',
          'gpt-5.1-codex-mini',
        ],
      );
      assert.strictEqual(models.find((model) => model.id === 'gpt-5.5')?.maxInputTokens, 950000);
      assert.strictEqual(models.find((model) => model.id === 'gpt-5.4')?.maxInputTokens, 950000);
      assert.strictEqual(models.find((model) => model.id === 'gpt-5.3-codex')?.maxInputTokens, 380000);
      assert.ok(models.every((model) => model.maxOutputTokens === 128000));
    } finally {
      provider.dispose();
    }
  });

  test('includes configured default model in bundled fallback after metadata loading fails', async () => {
    const logLines: string[] = [];
    const fetchFn: FetchFunction = async () =>
      new Response(JSON.stringify({ detail: 'server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: '  custom-codex-default  ',
      timeoutMs: 0,
      outputChannel: {
        appendLine(line: string) {
          logLines.push(line);
        },
      } as any,
      fetch: fetchFn,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    try {
      const models = await provider.getModels();
      assert.ok(
        logLines.some((line) => line.includes('Failed to load Codex models (falling back to bundled list)')),
        'expected model discovery fallback to be logged',
      );
      assert.deepStrictEqual(
        models.map((model) => model.id),
        [
          'gpt-5.5',
          'gpt-5.4',
          'gpt-5.3-codex',
          'gpt-5.2',
          'gpt-5.2-codex',
          'gpt-5.1-codex',
          'gpt-5.1-codex-max',
          'gpt-5.1-codex-mini',
          'custom-codex-default',
        ],
      );
      assert.deepStrictEqual(models[models.length - 1], {
        id: 'custom-codex-default',
        name: 'custom-codex-default',
        vendor: 'chatgpt',
        family: 'gpt-codex',
      });
    } finally {
      provider.dispose();
    }
  });

  test('does not cache bundled Codex model fallback after transient model-list failures', async () => {
    const logLines: string[] = [];
    let fetchCount = 0;
    const fetchFn: FetchFunction = async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ detail: 'server overloaded' }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'codex_models_transient_1',
            'retry-after': '2',
          },
        });
      }

      return new Response(
        JSON.stringify({
          models: [
            {
              slug: 'custom-codex-recovered',
              display_name: 'Custom Codex Recovered',
              visibility: 'list',
              priority: 1,
              context_window: 111000,
              max_output_tokens: 22000,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
      outputChannel: {
        appendLine(line: string) {
          logLines.push(line);
        },
      } as any,
      fetch: fetchFn,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    try {
      const fallbackModels = await provider.getModels();
      assert.ok(
        logLines.some((line) => line.includes('Failed to load Codex models (falling back to bundled list)')),
        'expected transient model discovery fallback to be logged',
      );
      assert.deepStrictEqual(
        fallbackModels.map((model) => model.id),
        [
          'gpt-5.5',
          'gpt-5.4',
          'gpt-5.3-codex',
          'gpt-5.2',
          'gpt-5.2-codex',
          'gpt-5.1-codex',
          'gpt-5.1-codex-max',
          'gpt-5.1-codex-mini',
        ],
      );

      const recoveredModels = await provider.getModels();
      assert.deepStrictEqual(recoveredModels, [
        {
          id: 'custom-codex-recovered',
          name: 'Custom Codex Recovered',
          vendor: 'chatgpt',
          family: 'gpt-codex',
          maxInputTokens: 105450,
          maxOutputTokens: 22000,
        },
        {
          id: 'gpt-5.3-codex',
          name: 'GPT-5.3 Codex',
          vendor: 'chatgpt',
          family: 'gpt-codex',
          maxInputTokens: 380000,
          maxOutputTokens: 128000,
        },
      ]);

      const cached = await provider.getModels();
      assert.strictEqual(cached, recoveredModels);
      assert.strictEqual(fetchCount, 2);
    } finally {
      provider.dispose();
    }
  });

  test('falls back to the hardcoded model list when Codex model JSON is malformed', async () => {
    const logLines: string[] = [];
    const fetchFn: FetchFunction = async () =>
      new Response('{"models":', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'codex_models_parse',
        },
      });

    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
      outputChannel: {
        appendLine(line: string) {
          logLines.push(line);
        },
      } as any,
      fetch: fetchFn,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    try {
      const models = await provider.getModels();

      assert.ok(
        logLines.some((line) => line.includes('Failed to load Codex models (falling back to bundled list)')),
        'expected model discovery fallback to be logged',
      );
      assert.ok(logLines.some((line) => line.includes('ProviderParseError')), 'expected parse error to be logged');
      assert.ok(logLines.some((line) => line.includes('status=200')), 'expected response status to be logged');
      assert.ok(logLines.some((line) => line.includes('code=invalid_json')), 'expected parse error code to be logged');
      assert.deepStrictEqual(
        models.map((model) => model.id),
        [
          'gpt-5.5',
          'gpt-5.4',
          'gpt-5.3-codex',
          'gpt-5.2',
          'gpt-5.2-codex',
          'gpt-5.1-codex',
          'gpt-5.1-codex-max',
          'gpt-5.1-codex-mini',
        ],
      );
    } finally {
      provider.dispose();
    }
  });

  test('does not fall back to bundled Codex models when sign-in is required', async () => {
    const logLines: string[] = [];
    let fetchCount = 0;
    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
      outputChannel: {
        appendLine(line: string) {
          logLines.push(line);
        },
      } as any,
      fetch: (async () => {
        fetchCount += 1;
        return new Response('{}', { status: 200 });
      }) as FetchFunction,
    });

    (provider as any).auth.getValidSession = async () => {
      throw new Error('Sign in to ChatGPT Codex Subscription to use this provider.');
    };

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.match(thrown.message, /Sign in to ChatGPT Codex Subscription/);
      assert.strictEqual(fetchCount, 0, 'expected no model request without a valid session');
      assert.ok(
        !logLines.some((line) => line.includes('falling back to bundled list')),
        'expected sign-in failures not to be logged as model discovery fallback',
      );
    } finally {
      provider.dispose();
    }
  });

  test('does not fall back to bundled Codex models on model-list auth errors', async () => {
    const logLines: string[] = [];
    let invalidated = false;
    let fetchCount = 0;
    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
      outputChannel: {
        appendLine(line: string) {
          logLines.push(line);
        },
      } as any,
      fetch: (async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({
            error: {
              message: 'access token expired',
              code: 'invalid_token',
              type: 'auth_error',
            },
          }),
          {
            status: 401,
            statusText: 'Unauthorized',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'codex_models_auth_1',
              'set-cookie': 'session=secret',
            },
          },
        );
      }) as FetchFunction,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'expired-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });
    (provider as any).auth.invalidateAccessToken = () => {
      invalidated = true;
    };

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.strictEqual(fetchCount, 1);
      assert.strictEqual(invalidated, true, 'expected rejected access token to be invalidated');
      assert.strictEqual(thrown.name, 'ProviderHttpError');
      assert.match(thrown.message, /Failed to list Codex models: HTTP 401 Unauthorized/);
      assert.strictEqual(thrown.status, 401);
      assert.strictEqual(thrown.statusCode, 401);
      assert.strictEqual(thrown.provider, 'codexSubscription');
      assert.strictEqual(thrown.providerId, 'codexSubscription');
      assert.strictEqual(thrown.requestId, 'codex_models_auth_1');
      assert.strictEqual(thrown.responseHeaders?.['set-cookie'], '<redacted>');
      assert.strictEqual(thrown.code, 'invalid_token');
      assert.strictEqual(thrown.type, 'auth_error');
      assert.ok(
        !logLines.some((line) => line.includes('falling back to bundled list')),
        'expected auth failures not to be logged as model discovery fallback',
      );
    } finally {
      provider.dispose();
    }
  });

  test('does not fall back to bundled Codex models on aborted model-list discovery', async () => {
    const abortError = new Error('user cancelled model discovery');
    abortError.name = 'AbortError';
    const logLines: string[] = [];
    let fetchCount = 0;
    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
      outputChannel: {
        appendLine(line: string) {
          logLines.push(line);
        },
      } as any,
      fetch: (async () => {
        fetchCount += 1;
        throw abortError;
      }) as FetchFunction,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.strictEqual(fetchCount, 1);
      assert.strictEqual(thrown.name, 'ProviderFetchError');
      assert.strictEqual(thrown.code, 'request_aborted');
      assert.strictEqual(thrown.type, 'aborted');
      assert.strictEqual(thrown.provider, 'codexSubscription');
      assert.strictEqual(thrown.providerId, 'codexSubscription');
      assert.strictEqual(thrown.cause, abortError);
      assert.ok(
        !logLines.some((line) => line.includes('falling back to bundled list')),
        'expected abort failures not to be logged as model discovery fallback',
      );
    } finally {
      provider.dispose();
    }
  });

  test('uses ChatGPT Codex Responses API with OAuth headers', async () => {
    let capturedUrl = '';
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;

    const fetchFn: FetchFunction = async (input, init) => {
      capturedUrl = requestUrl(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;

      const events = [
        {
          type: 'response.output_text.delta',
          item_id: 'item_text_1',
          output_index: 0,
          delta: 'Hello from Codex',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'message',
            id: 'msg_1',
            content: [{ type: 'output_text', text: 'Hello from Codex' }],
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            model: 'gpt-5.3-codex',
            created_at: 0,
            usage: {
              input_tokens: 12,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 5,
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ];

      return new Response(encodeSseEvents(events), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const provider = new CodexSubscriptionProvider({
      context: createTestContext(),
      defaultModelId: '  gpt-5.3-codex  ',
      timeoutMs: 0,
      fetch: fetchFn,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    try {
      const model = (await provider.getModel('   ')) as any;
      const result = await model.doGenerate({
        prompt: [
          { role: 'system', content: 'Follow the workspace instructions exactly.' },
          { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
        ],
        providerOptions: {
          codexSubscription: { reasoningEffort: 'high' },
        },
        tools: [],
        toolChoice: undefined,
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 64,
      } as any);

      assert.strictEqual(capturedUrl, 'https://chatgpt.com/backend-api/codex/responses');
      assert.strictEqual(requestHeaders?.get('authorization'), 'Bearer test-access-token');
      assert.strictEqual(requestHeaders?.get('ChatGPT-Account-Id'), 'org_123');
      assert.strictEqual(requestHeaders?.get('originator'), 'lingyun');
      assert.strictEqual(requestHeaders?.get('user-agent'), 'lingyun/2.2.0-test');
      assert.strictEqual(requestHeaders?.get('accept'), 'text/event-stream');
      assert.strictEqual(requestBody?.model, 'gpt-5.3-codex');
      assert.strictEqual(requestBody?.store, false);
      assert.strictEqual(requestBody?.stream, true);
      assert.deepStrictEqual(requestBody?.include, ['reasoning.encrypted_content']);
      assert.strictEqual(requestBody?.instructions, 'Follow the workspace instructions exactly.');
      assert.deepStrictEqual(requestBody?.reasoning, { effort: 'high' });
      assert.ok(!Object.prototype.hasOwnProperty.call(requestBody || {}, 'temperature'));
      assert.ok(!Object.prototype.hasOwnProperty.call(requestBody || {}, 'top_p'));
      assert.ok(!Object.prototype.hasOwnProperty.call(requestBody || {}, 'max_output_tokens'));

      const input = requestBody?.input as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(input));
      assert.strictEqual(input[0]?.role, 'user');
      assert.deepStrictEqual(input[0]?.content, [{ type: 'input_text', text: 'Say hello' }]);
      assert.deepStrictEqual(result.content, [{ type: 'text', text: 'Hello from Codex' }]);
    } finally {
      provider.dispose();
    }
  });
});
