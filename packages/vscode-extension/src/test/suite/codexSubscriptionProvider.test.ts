import * as assert from 'assert';

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

suite('CodexSubscriptionProvider', () => {
  test('loads provider-aware model metadata from the Codex models endpoint', async () => {
    const provider = new CodexSubscriptionProvider({
      context: {
        extension: { packageJSON: { version: '2.2.0-test' } },
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined,
          onDidChange: () => ({ dispose() {} }),
        },
      } as any,
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
    });

    let fetchCount = 0;
    let requestUrl = '';
    let requestHeaders: Headers | undefined;

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    (provider as any).fetchFn = async (input: unknown, init?: RequestInit) => {
      fetchCount += 1;
      requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : String((input as { url?: string })?.url || input);
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

    try {
      const models = await provider.getModels();
      const modelsAgain = await provider.getModels();

      assert.strictEqual(fetchCount, 1);
      assert.strictEqual(modelsAgain, models);
      assert.strictEqual(
        requestUrl,
        'https://chatgpt.com/backend-api/codex/models?client_version=2.2.0-test',
      );
      assert.strictEqual(requestHeaders?.get('authorization'), 'Bearer test-access-token');
      assert.strictEqual(requestHeaders?.get('ChatGPT-Account-Id'), 'org_123');
      assert.strictEqual(requestHeaders?.get('originator'), 'opencode');
      assert.strictEqual(requestHeaders?.get('user-agent'), 'lingyun/2.2.0-test');
      assert.strictEqual(requestHeaders?.get('accept'), 'application/json');

      assert.deepStrictEqual(models.slice(0, 2), [
        {
          id: 'gpt-5.3-codex',
          name: 'GPT-5.3 Codex',
          vendor: 'chatgpt',
          family: 'gpt-codex',
          maxInputTokens: 400000,
          maxOutputTokens: 128000,
        },
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          vendor: 'chatgpt',
          family: 'gpt-5',
          maxInputTokens: 272000,
          maxOutputTokens: undefined,
        },
      ]);
      assert.ok(models.some((model) => model.id === 'gpt-5.2'));
      assert.ok(!models.some((model) => model.id === 'hidden-model'));
    } finally {
      provider.dispose();
    }
  });

  test('falls back to the hardcoded model list when metadata loading fails', async () => {
    const provider = new CodexSubscriptionProvider({
      context: {
        extension: { packageJSON: { version: '2.2.0-test' } },
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined,
          onDidChange: () => ({ dispose() {} }),
        },
      } as any,
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
    });

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    (provider as any).fetchFn = async () =>
      new Response(JSON.stringify({ detail: 'server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

    try {
      const models = await provider.getModels();
      assert.deepStrictEqual(
        models.map((model) => model.id),
        [
          'gpt-5.4',
          'gpt-5.3-codex',
          'gpt-5.2',
          'gpt-5.2-codex',
          'gpt-5.1-codex',
          'gpt-5.1-codex-max',
          'gpt-5.1-codex-mini',
        ],
      );
      assert.ok(models.every((model) => model.maxInputTokens === undefined));
    } finally {
      provider.dispose();
    }
  });

  test('uses ChatGPT Codex Responses API with OAuth headers', async () => {
    const provider = new CodexSubscriptionProvider({
      context: {
        extension: { packageJSON: { version: '2.2.0-test' } },
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined,
          onDidChange: () => ({ dispose() {} }),
        },
      } as any,
      defaultModelId: 'gpt-5.3-codex',
      timeoutMs: 0,
    });

    let requestUrl = '';
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;

    (provider as any).auth.getValidSession = async () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 60_000,
      accountId: 'org_123',
    });

    (provider as any).fetchFn = async (input: unknown, init?: RequestInit) => {
      requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : String((input as { url?: string })?.url || input);
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

    try {
      const model = (await provider.getModel('')) as any;
      const result = await model.doGenerate({
        prompt: [
          { role: 'system', content: 'Follow the workspace instructions exactly.' },
          { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
        ],
        tools: [],
        toolChoice: undefined,
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 64,
      } as any);

      assert.strictEqual(requestUrl, 'https://chatgpt.com/backend-api/codex/responses');
      assert.strictEqual(requestHeaders?.get('authorization'), 'Bearer test-access-token');
      assert.strictEqual(requestHeaders?.get('ChatGPT-Account-Id'), 'org_123');
      assert.strictEqual(requestHeaders?.get('originator'), 'opencode');
      assert.strictEqual(requestHeaders?.get('user-agent'), 'lingyun/2.2.0-test');
      assert.strictEqual(requestHeaders?.get('accept'), 'text/event-stream');
      assert.strictEqual(requestBody?.model, 'gpt-5.3-codex');
      assert.strictEqual(requestBody?.store, false);
      assert.strictEqual(requestBody?.stream, true);
      assert.deepStrictEqual(requestBody?.include, ['reasoning.encrypted_content']);
      assert.strictEqual(requestBody?.instructions, 'Follow the workspace instructions exactly.');
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
