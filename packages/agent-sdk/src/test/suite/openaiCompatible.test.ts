import * as assert from 'assert';
import http from 'node:http';

import { timeoutSignal } from '../../abort.js';
import { OpenAICompatibleProvider } from '../../index.js';

suite('OpenAICompatibleProvider fetch', () => {
  test('trims OpenAI-compatible string options before provider construction', async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: '  http://127.0.0.1:12345/  ',
      apiKey: '  test-api-key  ',
      defaultModelId: '  configured-model  ',
    });

    let requestedModelId = '';
    const chatModel = { type: 'chat' };
    (provider as any).provider = {
      chatModel: (modelId: string) => {
        requestedModelId = modelId;
        return chatModel;
      },
    };

    try {
      assert.strictEqual((provider as any).baseURL, 'http://127.0.0.1:12345');
      assert.strictEqual((provider as any).apiKey, 'test-api-key');

      const model = await provider.getModel('');

      assert.strictEqual(model, chatModel);
      assert.strictEqual(requestedModelId, 'configured-model');
    } finally {
      provider.dispose();
    }
  });

  test('trims requested model IDs and falls back to the configured default for blank IDs', async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:12345',
      defaultModelId: 'configured-model',
    });

    const requestedModelIds: string[] = [];
    const chatModel = { type: 'chat' };
    (provider as any).provider = {
      chatModel: (modelId: string) => {
        requestedModelIds.push(modelId);
        return chatModel;
      },
    };

    try {
      assert.strictEqual(await provider.getModel('  explicit-model  '), chatModel);
      assert.strictEqual(await provider.getModel('   '), chatModel);

      assert.deepStrictEqual(requestedModelIds, ['explicit-model', 'configured-model']);
    } finally {
      provider.dispose();
    }
  });

  test('normalizes blank OpenAI-compatible API key and default model options to unset', async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:12345',
      apiKey: '   ',
      defaultModelId: '   ',
    });

    try {
      assert.strictEqual((provider as any).apiKey, undefined);
      assert.strictEqual((provider as any).defaultModelId, undefined);

      await assert.rejects(
        () => provider.getModel(''),
        /No model configured/,
      );
    } finally {
      provider.dispose();
    }
  });

  test('annotates chat-model generate errors with provider and model metadata', async () => {
    const provider = new OpenAICompatibleProvider({ baseURL: 'http://127.0.0.1:12345' });
    const rawError: any = Object.assign(new Error('quota exceeded'), {
      name: 'AI_APICallError',
      statusCode: 429,
      url: 'https://api.example.test/v1/chat/completions',
      responseHeaders: {
        'x-request-id': 'sdk_req_generate_1',
        'retry-after-ms': '1500',
        'set-cookie': 'secret=session',
      },
      code: 'rate_limit_exceeded',
    });
    const rawModel = {
      specificationVersion: 'v3',
      provider: 'openai-compatible',
      modelId: 'raw-model',
      supportedUrls: {},
      doGenerate: async () => {
        throw rawError;
      },
      doStream: async () => ({ stream: new ReadableStream() }),
    };

    (provider as any).provider = { chatModel: () => rawModel };

    try {
      const model = (await provider.getModel('  metadata-model  ')) as any;
      let thrown: any;
      try {
        await model.doGenerate({});
      } catch (error) {
        thrown = error;
      }

      assert.strictEqual(thrown, rawError);
      assert.strictEqual(thrown.provider, 'openaiCompatible');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.modelId, 'metadata-model');
      assert.strictEqual(thrown.status, 429);
      assert.strictEqual(thrown.statusCode, 429);
      assert.strictEqual(thrown.url, 'https://api.example.test/v1/chat/completions');
      assert.deepStrictEqual(thrown.responseHeaders, {
        'x-request-id': 'sdk_req_generate_1',
        'retry-after-ms': '1500',
        'set-cookie': '<redacted>',
      });
      assert.deepStrictEqual(thrown.headers, thrown.responseHeaders);
      assert.strictEqual(thrown.requestId, 'sdk_req_generate_1');
      assert.strictEqual(thrown.retryAfterMs, 1500);
      assert.strictEqual(thrown.errorCode, 'rate_limit_exceeded');
    } finally {
      provider.dispose();
    }
  });

  test('annotates streamed chat-model error parts with provider and model metadata', async () => {
    const provider = new OpenAICompatibleProvider({ baseURL: 'http://127.0.0.1:12345' });
    const rawError = Object.assign(new Error('stream failed'), {
      name: 'AI_APICallError',
      status: 503,
      headers: { 'x-request-id': 'sdk_req_stream_1' },
      responseBody: '{"error":"overloaded"}',
      type: 'server_error',
    });
    const rawModel = {
      specificationVersion: 'v3',
      provider: 'openai-compatible',
      modelId: 'raw-model',
      supportedUrls: {},
      doGenerate: async () => ({}),
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'error', error: rawError });
            controller.close();
          },
        }),
      }),
    };

    (provider as any).provider = { chatModel: () => rawModel };

    try {
      const model = (await provider.getModel('stream-metadata-model')) as any;
      const result = await model.doStream({});
      const reader = result.stream.getReader();
      const { value, done } = await reader.read();
      reader.releaseLock();

      assert.strictEqual(done, false);
      assert.strictEqual(value.error, rawError);
      assert.strictEqual(value.error.provider, 'openaiCompatible');
      assert.strictEqual(value.error.providerId, 'openaiCompatible');
      assert.strictEqual(value.error.modelId, 'stream-metadata-model');
      assert.strictEqual(value.error.status, 503);
      assert.strictEqual(value.error.statusCode, 503);
      assert.deepStrictEqual(value.error.responseHeaders, { 'x-request-id': 'sdk_req_stream_1' });
      assert.deepStrictEqual(value.error.headers, { 'x-request-id': 'sdk_req_stream_1' });
      assert.strictEqual(value.error.responseBody, '{"error":"overloaded"}');
      assert.strictEqual(value.error.errorType, 'server_error');
    } finally {
      provider.dispose();
    }
  });

  test('preserves custom accept-encoding case-insensitively and skips empty headers', async () => {
    let observedHeaders: http.IncomingHttpHeaders | undefined;
    const server = http.createServer((req, res) => {
      observedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}` });
    try {
      const response = await (provider as any).fetchFn(`http://127.0.0.1:${address.port}/headers`, {
        headers: {
          'AcCePt-EnCoDiNg': 'br',
          'x-count': 42,
          'x-optional': undefined,
          'x-empty': null,
        } as any,
      });
      await response.text();

      assert.strictEqual(observedHeaders?.['accept-encoding'], 'br');
      assert.strictEqual(observedHeaders?.['x-count'], '42');
      assert.strictEqual(observedHeaders?.['x-optional'], undefined);
      assert.strictEqual(observedHeaders?.['x-empty'], undefined);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('unrefs fallback timeout timers when AbortSignal.timeout is unavailable', () => {
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    const originalSetTimeout = globalThis.setTimeout;
    let unrefCalled = false;

    Object.defineProperty(AbortSignal, 'timeout', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    globalThis.setTimeout = ((_callback: (...args: unknown[]) => void, _delay?: number) => ({
      unref: () => {
        unrefCalled = true;
      },
    })) as unknown as typeof setTimeout;

    try {
      const signal = timeoutSignal(60_000);

      assert.strictEqual(signal.aborted, false);
      assert.strictEqual(unrefCalled, true);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      if (timeoutDescriptor) {
        Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
      } else {
        delete (AbortSignal as any).timeout;
      }
    }
  });

  test('uses fallback timeout when AbortSignal.timeout is unavailable', async () => {
    const server = http.createServer((_req, _res) => {
      // Intentionally leave the request open so only the shared fetch timeout can complete it.
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    Object.defineProperty(AbortSignal, 'timeout', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const provider = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}`, timeoutMs: 40 });
    try {
      let thrown: any;
      try {
        await (provider as any).fetchFn(`http://127.0.0.1:${address.port}/hang`);
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected fetch to time out');
      assert.strictEqual(thrown.name, 'TimeoutError');
      assert.match(String(thrown.message), /timed out/i);
    } finally {
      provider.dispose();
      if (timeoutDescriptor) {
        Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
      } else {
        delete (AbortSignal as any).timeout;
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('preserves user abort reason when AbortSignal.any is unavailable', async () => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    Object.defineProperty(AbortSignal, 'any', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const provider = new OpenAICompatibleProvider({ baseURL: 'http://127.0.0.1:9', timeoutMs: 60_000 });
    const controller = new AbortController();
    const abortCause = new Error('user cancelled provider request');
    abortCause.name = 'AbortError';
    controller.abort(abortCause);

    try {
      let thrown: any;
      try {
        await (provider as any).fetchFn('http://127.0.0.1:9/aborted', { signal: controller.signal });
      } catch (error) {
        thrown = error;
      }

      assert.strictEqual(thrown, abortCause);
    } finally {
      provider.dispose();
      if (anyDescriptor) {
        Object.defineProperty(AbortSignal, 'any', anyDescriptor);
      } else {
        delete (AbortSignal as any).any;
      }
    }
  });

  test('preserves Request headers and lets init headers override them', async () => {
    let observedHeaders: http.IncomingHttpHeaders | undefined;
    const server = http.createServer((req, res) => {
      observedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}` });
    try {
      const request = new Request(`http://127.0.0.1:${address.port}/request-headers`, {
        headers: {
          Authorization: 'Bearer request-token',
          'Accept-Encoding': 'gzip',
          'X-Request-Only': 'present',
          'X-Override': 'request-value',
        },
      });

      const response = await (provider as any).fetchFn(request, {
        headers: {
          'x-override': 'init-value',
          'x-init-only': 'present',
        },
      });
      await response.text();

      assert.strictEqual(observedHeaders?.authorization, 'Bearer request-token');
      assert.strictEqual(observedHeaders?.['accept-encoding'], 'gzip');
      assert.strictEqual(observedHeaders?.['x-request-only'], 'present');
      assert.strictEqual(observedHeaders?.['x-init-only'], 'present');
      assert.strictEqual(observedHeaders?.['x-override'], 'init-value');
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
