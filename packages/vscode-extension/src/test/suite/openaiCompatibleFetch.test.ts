import * as assert from 'assert';
import http from 'node:http';

import { createFetchWithStreamingDefaults, createTimeoutSignal } from '../../providers/openaiFetch';
import { OpenAICompatibleProvider } from '../../providers/openaiCompatible';
import { fetchProviderResponse } from '../../providers/providerErrors';

async function readStreamParts(stream: ReadableStream<any>): Promise<any[]> {
  const reader = stream.getReader();
  const parts: any[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  return parts;
}

suite('OpenAICompatibleProvider fetch', () => {
  test('uses Responses API for OpenAI-compatible models at or above GPT-5.3', async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:0',
      createResponsesModel: (({ modelId }: any) => ({
        specificationVersion: 'v3',
        provider: 'openaiCompatible',
        modelId,
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error('Not implemented');
        },
        doStream: async () => {
          throw new Error('Not implemented');
        },
      })) as any,
    });

    let chatCalls = 0;

    (provider as any).provider = {
      chatModel: () => {
        chatCalls += 1;
        return { type: 'chat' };
      },
    };

    try {
      for (const modelId of ['gpt-5.3', 'gpt-5.3-codex', 'gpt-5.4', 'gpt-5.5', 'gpt-5.5-codex', 'gpt-6']) {
        const model = (await provider.getModel(modelId)) as any;

        assert.strictEqual(model?.specificationVersion, 'v3');
        assert.strictEqual(model?.modelId, modelId);
      }
      assert.strictEqual(chatCalls, 0);
    } finally {
      provider.dispose();
    }
  });

  test('omits Authorization on blank-key OpenAI-compatible Responses requests', async () => {
    let observedAuth = 'not-called';
    let observedUrl = '';
    let observedBody: any;
    const server = http.createServer((req, res) => {
      observedAuth = String(req.headers.authorization || '');
      observedUrl = req.url || '';
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        observedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_blank_responses_1' });
        res.end('data: {"type":"response.completed","response":{"id":"resp_blank_key","model":"gpt-5.3"}}\n\n');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      apiKey: '   ',
    });

    try {
      const model = (await provider.getModel('gpt-5.3')) as any;
      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);
      const parts = await readStreamParts(result.stream);

      assert.strictEqual(observedUrl, '/responses');
      assert.strictEqual(observedAuth, '');
      assert.strictEqual(observedBody.model, 'gpt-5.3');
      assert.deepStrictEqual(parts.map((part: any) => part.type), ['response-metadata', 'finish']);
      assert.strictEqual(result.response.headers['x-request-id'], 'req_blank_responses_1');
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('uses chat model path for GPT-5 models below GPT-5.3', async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:0',
      createResponsesModel: (() => {
        throw new Error('unexpected Responses model');
      }) as any,
    });

    let chatCalls = 0;
    const chatModel = { type: 'chat' };

    (provider as any).provider = {
      chatModel: () => {
        chatCalls += 1;
        return chatModel;
      },
    };

    try {
      assert.strictEqual(await provider.getModel('gpt-5'), chatModel);
      assert.strictEqual(await provider.getModel('gpt-5-mini'), chatModel);
      assert.strictEqual(await provider.getModel('gpt-5.2'), chatModel);

      assert.strictEqual(chatCalls, 3);
    } finally {
      provider.dispose();
    }
  });

  test('uses chat model path for non-GPT-5 models', async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:0',
    });

    let chatCalls = 0;
    const chatModel = { type: 'chat' };

    (provider as any).provider = {
      chatModel: () => {
        chatCalls += 1;
        return chatModel;
      },
    };

    try {
      const model = await provider.getModel('gpt-4o');

      assert.strictEqual(model, chatModel);
      assert.strictEqual(chatCalls, 1);
    } finally {
      provider.dispose();
    }
  });

  test('trims requested model IDs and falls back to the configured default for blank IDs', async () => {
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:0',
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

  test('annotates chat-model generate errors with provider and model metadata', async () => {
    const provider = new OpenAICompatibleProvider({ baseURL: 'http://127.0.0.1:0' });
    const rawCause: any = Object.assign(new TypeError('cause failed for metadata-model at http://10.0.0.8:8080/v1 token=cause-secret'), {
      stack: 'TypeError: cause failed for metadata-model at http://10.0.0.8:8080/v1 token=cause-secret\n    at provider-cause',
      responseBody: 'cause body for metadata-model at http://10.0.0.9:8080/v1 token=body-secret',
      error: {
        message: 'nested cause error for metadata-model at http://10.0.0.10:8080/v1 token=nested-secret',
      },
      data: {
        error: {
          message: 'nested data error for metadata-model at http://10.0.0.11:8080/v1 token=data-secret',
        },
      },
      headers: {
        authorization: 'Bearer cause-header-token',
        'x-request-id': 'cause_req_1',
      },
      response: {
        body: 'nested response body for metadata-model at http://10.0.0.12:8080/v1 token=response-secret',
        headers: {
          cookie: 'secret=cause-cookie',
          'x-request-id': 'cause_response_req_1',
        },
      },
    });
    const rawError: any = Object.assign(new Error('quota exceeded for metadata-model at http://127.0.0.1:8080/v1 with token=raw-secret'), {
      name: 'AI_APICallError',
      stack: 'AI_APICallError: quota exceeded for metadata-model at http://127.0.0.1:8080/v1 with token=raw-secret\n    at provider',
      cause: rawCause,
      statusCode: 429,
      url: 'https://api.example.test/v1/chat/completions',
      responseHeaders: {
        'x-request-id': 'req_generate_1',
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
        'x-request-id': 'req_generate_1',
        'retry-after-ms': '1500',
        'set-cookie': '<redacted>',
      });
      assert.deepStrictEqual(thrown.headers, thrown.responseHeaders);
      assert.strictEqual(thrown.requestId, 'req_generate_1');
      assert.strictEqual(thrown.retryAfterMs, 1500);
      assert.strictEqual(thrown.errorCode, 'rate_limit_exceeded');
      assert.strictEqual(thrown.message, 'quota exceeded for <model> at http://<private-ip>:8080/v1 with token=<redacted>');
      assert.doesNotMatch(thrown.message, /metadata-model|127\.0\.0\.1|raw-secret/);
      assert.match(thrown.stack, /quota exceeded for <model> at http:\/\/<private-ip>:8080\/v1 with token=<redacted>/);
      assert.doesNotMatch(thrown.stack, /metadata-model|127\.0\.0\.1|raw-secret/);
      assert.strictEqual(thrown.cause, rawCause);
      assert.strictEqual(rawCause.message, 'cause failed for <model> at http://<private-ip>:8080/v1 token=<redacted>');
      assert.match(rawCause.stack, /cause failed for <model> at http:\/\/<private-ip>:8080\/v1 token=<redacted>/);
      assert.strictEqual(rawCause.responseBody, 'cause body for <model> at http://<private-ip>:8080/v1 token=<redacted>');
      assert.strictEqual(rawCause.error.message, 'nested cause error for <model> at http://<private-ip>:8080/v1 token=<redacted>');
      assert.strictEqual(rawCause.data.error.message, 'nested data error for <model> at http://<private-ip>:8080/v1 token=<redacted>');
      assert.strictEqual(rawCause.response.body, 'nested response body for <model> at http://<private-ip>:8080/v1 token=<redacted>');
      assert.deepStrictEqual(rawCause.headers, {
        authorization: '<redacted>',
        'x-request-id': 'cause_req_1',
      });
      assert.deepStrictEqual(rawCause.response.headers, {
        cookie: '<redacted>',
        'x-request-id': 'cause_response_req_1',
      });
      assert.doesNotMatch(
        [
          rawCause.message,
          rawCause.stack,
          rawCause.responseBody,
          rawCause.error.message,
          rawCause.data.error.message,
          rawCause.response.body,
          JSON.stringify(rawCause.headers),
          JSON.stringify(rawCause.response.headers),
        ].join('\n'),
        /metadata-model|10\.0\.0\.(?:8|9|10|11|12)|cause-secret|body-secret|nested-secret|data-secret|response-secret|cause-header-token|cause-cookie/,
      );
    } finally {
      provider.dispose();
    }
  });

  test('annotates native-like read-only chat-model errors without replacing the thrown error', async () => {
    const provider = new OpenAICompatibleProvider({ baseURL: 'http://127.0.0.1:0' });
    const rawError: any = new Error('native-like failure for readonly-model at http://127.0.0.1:8080/v1 token=readonly-secret');
    Object.defineProperties(rawError, {
      message: {
        configurable: true,
        enumerable: false,
        get: () => 'native-like failure for readonly-model at http://127.0.0.1:8080/v1 token=readonly-secret',
      },
      provider: {
        configurable: true,
        enumerable: true,
        get: () => 'upstream-provider',
      },
      responseHeaders: {
        configurable: true,
        enumerable: true,
        get: () => ({ authorization: 'Bearer readonly-header-token', 'x-request-id': 'readonly_req_1' }),
      },
      responseBody: {
        configurable: true,
        enumerable: true,
        get: () => 'body for readonly-model at http://10.0.0.13:8080/v1 token=readonly-body-secret',
      },
    });
    rawError.statusCode = 429;
    rawError.code = 'rate_limit_exceeded';

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
      const model = (await provider.getModel('readonly-model')) as any;
      let thrown: any;
      try {
        await model.doGenerate({});
      } catch (error) {
        thrown = error;
      }

      assert.strictEqual(thrown, rawError);
      assert.strictEqual(thrown.provider, 'openaiCompatible');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.modelId, 'readonly-model');
      assert.strictEqual(thrown.status, 429);
      assert.strictEqual(thrown.statusCode, 429);
      assert.deepStrictEqual(thrown.responseHeaders, {
        authorization: '<redacted>',
        'x-request-id': 'readonly_req_1',
      });
      assert.strictEqual(thrown.responseBody, 'body for <model> at http://<private-ip>:8080/v1 token=<redacted>');
      assert.strictEqual(thrown.requestId, 'readonly_req_1');
      assert.strictEqual(thrown.errorCode, 'rate_limit_exceeded');
      assert.doesNotMatch(thrown.responseBody, /readonly-model|10\.0\.0\.13|readonly-body-secret/);
    } finally {
      provider.dispose();
    }
  });

  test('annotates streamed chat-model error parts with provider and model metadata', async () => {
    const provider = new OpenAICompatibleProvider({ baseURL: 'http://127.0.0.1:0' });
    const rawError = Object.assign(new Error('stream failed'), {
      name: 'AI_APICallError',
      status: 503,
      headers: {
        'x-request-id': 'req_stream_1',
        authorization: 'Bearer leaked-token',
        'set-cookie': 'secret=session',
      },
      responseBody: JSON.stringify({
        error: {
          message: 'Bearer leaked-token failed against http://127.0.0.1:8080/v1 for stream-metadata-model',
        },
      }),
      body: 'token=leaked-token host=http://10.0.0.2:8080 model=stream-metadata-model',
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
      assert.deepStrictEqual(value.error.responseHeaders, {
        'x-request-id': 'req_stream_1',
        authorization: '<redacted>',
        'set-cookie': '<redacted>',
      });
      assert.deepStrictEqual(value.error.headers, value.error.responseHeaders);
      assert.strictEqual(
        value.error.responseBody,
        '{"error":{"message":"Bearer <redacted> failed against http://<private-ip>:8080/v1 for <model>"}}',
      );
      assert.strictEqual(value.error.body, 'token=<redacted> host=http://<private-ip>:8080 model=<model>');
      assert.doesNotMatch(value.error.responseBody, /leaked-token|127\.0\.0\.1|stream-metadata-model/);
      assert.doesNotMatch(value.error.body, /leaked-token|10\.0\.0\.2|stream-metadata-model/);
      assert.strictEqual(value.error.errorType, 'server_error');
    } finally {
      provider.dispose();
    }
  });

  test('allows slow streaming response gaps without timing out', async function () {
    this.timeout(5000);
    const GAP_MS = 800;
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: first\n\n');

      setTimeout(() => {
        if (res.writableEnded || res.destroyed) return;
        res.write('data: second\n\n');
        res.end();
      }, GAP_MS);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const url = `http://127.0.0.1:${address.port}/stream`;

    const provider = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}` });

    try {
      const response = await (provider as any).fetchFn(url);
      const text = await response.text();
      assert.ok(text.includes('first'));
      assert.ok(text.includes('second'));
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
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

    const fetchWithDefaults = createFetchWithStreamingDefaults();
    try {
      const response = await fetchWithDefaults.fetch(`http://127.0.0.1:${address.port}/headers`, {
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
      fetchWithDefaults.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
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

    const fetchWithDefaults = createFetchWithStreamingDefaults();
    try {
      const request = new Request(`http://127.0.0.1:${address.port}/request-headers`, {
        headers: {
          Authorization: 'Bearer request-token',
          'Accept-Encoding': 'gzip',
          'X-Request-Only': 'present',
          'X-Override': 'request-value',
        },
      });

      const response = await fetchWithDefaults.fetch(request, {
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
      fetchWithDefaults.dispose();
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
      const signal = createTimeoutSignal(60_000);

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

    const fetchWithDefaults = createFetchWithStreamingDefaults(40);
    try {
      let thrown: any;
      try {
        await fetchProviderResponse(fetchWithDefaults.fetch, `http://127.0.0.1:${address.port}/hang`, undefined, {
          message: 'Model discovery failed',
          url: `http://127.0.0.1:${address.port}/hang`,
          provider: 'openaiCompatible',
          modelId: 'local-test',
        });
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected fetch to time out');
      assert.strictEqual(thrown.name, 'ProviderFetchError');
      assert.strictEqual(thrown.code, 'request_timeout');
      assert.strictEqual(thrown.type, 'timeout');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.modelId, 'local-test');
      assert.match(thrown.message, /timed out/i);
    } finally {
      fetchWithDefaults.dispose();
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

    const fetchWithDefaults = createFetchWithStreamingDefaults(60_000);
    const controller = new AbortController();
    const abortCause = new Error('user cancelled provider request');
    abortCause.name = 'AbortError';
    controller.abort(abortCause);

    try {
      let thrown: any;
      try {
        await fetchProviderResponse(fetchWithDefaults.fetch, 'http://127.0.0.1:9/aborted', { signal: controller.signal }, {
          message: 'Responses request failed',
          url: 'http://127.0.0.1:9/aborted',
          provider: 'openaiCompatible',
          modelId: 'local-test',
        });
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected fetch to reject');
      assert.strictEqual(thrown.name, 'ProviderFetchError');
      assert.strictEqual(thrown.code, 'request_aborted');
      assert.strictEqual(thrown.type, 'aborted');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.modelId, 'local-test');
      assert.strictEqual(thrown.cause, abortCause);
    } finally {
      fetchWithDefaults.dispose();
      if (anyDescriptor) {
        Object.defineProperty(AbortSignal, 'any', anyDescriptor);
      } else {
        delete (AbortSignal as any).any;
      }
    }
  });

  test('attaches fallback token metadata to discovered models', async () => {
    let requestAccept = '';
    const server = http.createServer((req, res) => {
      requestAccept = String(req.headers.accept || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: ' local-coder ', owned_by: 'local-lab' }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      modelDisplayNames: { 'local-coder': 'Local Coder' },
      fallbackMaxInputTokens: 65536,
      fallbackMaxOutputTokens: 8192,
    });

    try {
      const models = await provider.getModels();
      assert.strictEqual(requestAccept, 'application/json');
      assert.deepStrictEqual(models, [
        {
          id: 'local-coder',
          name: 'Local Coder',
          vendor: 'local-lab',
          family: 'local',
          maxInputTokens: 65536,
          maxOutputTokens: 8192,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('ignores non-string owned_by metadata from discovered OpenAI-compatible models', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'null-owner-model', owned_by: null, context_length: 8192 },
          { id: 'object-owner-model', owned_by: { name: 'local-lab' }, max_output_tokens: 2048 },
        ],
      }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 8192,
    });

    try {
      const models = await provider.getModels();

      assert.deepStrictEqual(models, [
        {
          id: 'null-owner-model',
          name: 'null-owner-model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 8192,
          maxOutputTokens: 8192,
        },
        {
          id: 'object-owner-model',
          name: 'object-owner-model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 2048,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('uses token-limit metadata from discovered OpenAI-compatible models before configured fallbacks', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
            id: 'metadata-model',
            owned_by: 'metadata-lab',
            context_length: 131072,
            max_output_tokens: 16384,
          },
          {
            id: 'fallback-metadata-model',
            owned_by: 'metadata-lab',
          },
          {
            id: 'vllm-model',
            owned_by: 'vllm',
            max_model_len: '65536',
            max_completion_tokens: '4096',
          },
          {
            id: 'litellm-model',
            owned_by: 'litellm',
            model_info: {
              max_input_tokens: '200000',
              max_output_tokens: '12000',
            },
          },
          {
            id: 'litellm-params-model',
            owned_by: 'litellm',
            litellm_params: {
              max_tokens: '8192',
            },
          },
          {
            id: 'litellm-params-explicit-model',
            owned_by: 'litellm',
            litellm_params: {
              max_input_tokens: '200000',
              max_output_tokens: '4096',
            },
          },
          {
            id: 'openrouter-model',
            owned_by: 'openrouter',
            top_provider: {
              context_length: '262144',
              max_completion_tokens: '32768',
            },
          },
        ],
      }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 8192,
    });

    try {
      const models = await provider.getModels();

      assert.deepStrictEqual(models, [
        {
          id: 'metadata-model',
          name: 'metadata-model',
          vendor: 'metadata-lab',
          family: 'local',
          maxInputTokens: 131072,
          maxOutputTokens: 16384,
        },
        {
          id: 'fallback-metadata-model',
          name: 'fallback-metadata-model',
          vendor: 'metadata-lab',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 8192,
        },
        {
          id: 'vllm-model',
          name: 'vllm-model',
          vendor: 'vllm',
          family: 'local',
          maxInputTokens: 65536,
          maxOutputTokens: 4096,
        },
        {
          id: 'litellm-model',
          name: 'litellm-model',
          vendor: 'litellm',
          family: 'local',
          maxInputTokens: 200000,
          maxOutputTokens: 12000,
        },
        {
          id: 'litellm-params-model',
          name: 'litellm-params-model',
          vendor: 'litellm',
          family: 'local',
          maxInputTokens: 8192,
          maxOutputTokens: 8192,
        },
        {
          id: 'litellm-params-explicit-model',
          name: 'litellm-params-explicit-model',
          vendor: 'litellm',
          family: 'local',
          maxInputTokens: 200000,
          maxOutputTokens: 4096,
        },
        {
          id: 'openrouter-model',
          name: 'openrouter-model',
          vendor: 'openrouter',
          family: 'local',
          maxInputTokens: 262144,
          maxOutputTokens: 32768,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('deduplicates discovered OpenAI-compatible models after trimming IDs', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
            id: ' duplicate-model ',
            owned_by: 'first-lab',
            display_name: 'First Duplicate',
            context_length: 8192,
            max_output_tokens: 1024,
          },
          {
            id: 'duplicate-model',
            owned_by: 'second-lab',
            display_name: 'Second Duplicate',
            context_length: 16384,
            max_output_tokens: 2048,
          },
          {
            id: 'other-model',
            owned_by: 'other-lab',
          },
        ],
      }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 4096,
    });

    try {
      const models = await provider.getModels();

      assert.deepStrictEqual(models, [
        {
          id: 'duplicate-model',
          name: 'First Duplicate',
          vendor: 'first-lab',
          family: 'local',
          maxInputTokens: 8192,
          maxOutputTokens: 1024,
        },
        {
          id: 'other-model',
          name: 'other-model',
          vendor: 'other-lab',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('coalesces concurrent model discovery requests', async () => {
    let requestCount = 0;
    let releaseResponse!: () => void;
    let markRequestObserved!: () => void;
    let pendingLoads: Array<Promise<unknown>> = [];
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requestObserved = new Promise<void>((resolve) => {
      markRequestObserved = resolve;
    });

    const server = http.createServer(async (_req, res) => {
      requestCount += 1;
      markRequestObserved();
      await responseGate;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'concurrent-model', owned_by: 'local-lab' }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
    });

    try {
      const first = provider.getModels();
      const second = provider.getModels();
      pendingLoads = [first, second];
      await requestObserved;
      assert.strictEqual(requestCount, 1);

      releaseResponse();
      const [firstModels, secondModels] = await Promise.all([first, second]);
      assert.strictEqual(firstModels, secondModels);
      assert.deepStrictEqual(firstModels.map((model) => model.id), ['concurrent-model']);

      const cached = await provider.getModels();
      assert.strictEqual(cached, firstModels);
      assert.strictEqual(requestCount, 1);
    } finally {
      releaseResponse();
      await Promise.allSettled(pendingLoads);
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('appends configured default model metadata when discovery omits it', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'remote-model', owned_by: 'remote-lab' }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      defaultModelId: 'configured-model',
      modelDisplayNames: { 'configured-model': 'Configured Model' },
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 4096,
    });

    try {
      const models = await provider.getModels();
      assert.deepStrictEqual(models, [
        {
          id: 'remote-model',
          name: 'remote-model',
          vendor: 'remote-lab',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
        {
          id: 'configured-model',
          name: 'Configured Model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('falls back to configured default model metadata when discovery returns no models', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      defaultModelId: 'configured-model',
      modelDisplayNames: { 'configured-model': 'Configured Model' },
      fallbackMaxOutputTokens: 4096,
    });

    try {
      const models = await provider.getModels();
      assert.deepStrictEqual(models, [
        {
          id: 'configured-model',
          name: 'Configured Model',
          vendor: 'openai-compatible',
          family: 'local',
          maxOutputTokens: 4096,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('falls back to configured default model metadata when discovery returns 204 No Content', async () => {
    let requestCount = 0;
    const server = http.createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(204);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      defaultModelId: 'configured-model',
      modelDisplayNames: { 'configured-model': 'Configured Model' },
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 4096,
    });

    try {
      const models = await provider.getModels();
      assert.deepStrictEqual(models, [
        {
          id: 'configured-model',
          name: 'Configured Model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
      ]);

      const cached = await provider.getModels();
      assert.strictEqual(cached, models);
      assert.strictEqual(requestCount, 1);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('falls back to configured default model metadata when model-list endpoint is unsupported', async () => {
    let requestCount = 0;
    const server = http.createServer((_req, res) => {
      requestCount += 1;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'model list endpoint not found' } }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      defaultModelId: 'configured-model',
      modelDisplayNames: { 'configured-model': 'Configured Model' },
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 4096,
    });

    try {
      const models = await provider.getModels();
      assert.deepStrictEqual(models, [
        {
          id: 'configured-model',
          name: 'Configured Model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
      ]);

      const cached = await provider.getModels();
      assert.strictEqual(cached, models);
      assert.strictEqual(requestCount, 1);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('falls back to configured default model metadata when model-list discovery is transiently unavailable without caching the fallback', async () => {
    let requestCount = 0;
    const server = http.createServer((_req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(503, {
          'Content-Type': 'application/json',
          'x-request-id': 'req_models_transient_1',
          'retry-after': '2',
        });
        res.end(
          JSON.stringify({
            error: {
              message: 'model catalog unavailable',
              code: 'catalog_down',
              type: 'server_error',
            },
          }),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'remote-model',
              owned_by: 'remote-provider',
              context_window: 131072,
              max_output_tokens: 12000,
            },
          ],
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      defaultModelId: 'configured-model',
      modelDisplayNames: { 'configured-model': 'Configured Model' },
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 4096,
    });

    try {
      const fallbackModels = await provider.getModels();
      assert.deepStrictEqual(fallbackModels, [
        {
          id: 'configured-model',
          name: 'Configured Model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
      ]);

      const recoveredModels = await provider.getModels();
      assert.deepStrictEqual(recoveredModels, [
        {
          id: 'remote-model',
          name: 'remote-model',
          vendor: 'remote-provider',
          family: 'local',
          maxInputTokens: 131072,
          maxOutputTokens: 12000,
        },
        {
          id: 'configured-model',
          name: 'Configured Model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
      ]);

      const cached = await provider.getModels();
      assert.strictEqual(cached, recoveredModels);
      assert.strictEqual(requestCount, 2);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('falls back to configured default model metadata when model-list discovery has a transient fetch failure without caching the fallback', async () => {
    let requestCount = 0;
    const fetchError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:0',
      defaultModelId: 'configured-model',
      modelDisplayNames: { 'configured-model': 'Configured Model' },
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 4096,
      fetch: (async () => {
        requestCount += 1;
        throw fetchError;
      }) as any,
    });

    try {
      const models = await provider.getModels();
      assert.deepStrictEqual(models, [
        {
          id: 'configured-model',
          name: 'Configured Model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 32768,
          maxOutputTokens: 4096,
        },
      ]);

      const nextFallback = await provider.getModels();
      assert.notStrictEqual(nextFallback, models);
      assert.deepStrictEqual(nextFallback, models);
      assert.strictEqual(requestCount, 2);
    } finally {
      provider.dispose();
    }
  });

  test('does not fall back on aborted model-list discovery even when a default model is configured', async () => {
    const abortError = new Error('user cancelled model discovery');
    abortError.name = 'AbortError';
    const provider = new OpenAICompatibleProvider({
      baseURL: 'http://127.0.0.1:0',
      defaultModelId: 'configured-model',
      fetch: (async () => {
        throw abortError;
      }) as any,
    });

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.strictEqual(thrown.name, 'ProviderFetchError');
      assert.strictEqual(thrown.code, 'request_aborted');
      assert.strictEqual(thrown.type, 'aborted');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.cause, abortError);
    } finally {
      provider.dispose();
    }
  });

  test('does not fall back on model-list auth errors even when a default model is configured', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'x-request-id': 'req_models_auth_1',
        'set-cookie': 'session=secret',
      });
      res.end(
        JSON.stringify({
          error: {
            message: 'invalid api key',
            code: 'invalid_api_key',
            type: 'auth_error',
          },
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      defaultModelId: 'configured-model',
    });

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.strictEqual(thrown.name, 'ProviderHttpError');
      assert.match(thrown.message, /Failed to list models: HTTP 401/);
      assert.match(thrown.message, /invalid api key/);
      assert.strictEqual(thrown.status, 401);
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.requestId, 'req_models_auth_1');
      assert.strictEqual(thrown.responseHeaders?.['set-cookie'], '<redacted>');
      assert.strictEqual(thrown.code, 'invalid_api_key');
      assert.strictEqual(thrown.type, 'auth_error');
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('attaches structured metadata to malformed successful model-list responses', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-request-id': 'req_bad_json_1',
      });
      res.end('{"data": [');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
    });

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.strictEqual(thrown.name, 'ProviderParseError');
      assert.match(thrown.message, /Failed to parse model list: invalid JSON response \(HTTP 200/);
      assert.strictEqual(thrown.status, 200);
      assert.strictEqual(thrown.statusCode, 200);
      assert.strictEqual(thrown.url, `http://127.0.0.1:${address.port}/models`);
      assert.strictEqual(thrown.provider, 'openaiCompatible');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.code, 'invalid_json');
      assert.strictEqual(thrown.type, 'invalid_response');
      assert.strictEqual(thrown.responseHeaders?.['x-request-id'], 'req_bad_json_1');
      assert.match(thrown.responseBody, /"data"/);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('skips malformed OpenAI-compatible model entries when valid models remain', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          null,
          'bad-entry',
          { owned_by: 'missing-id' },
          {
            id: ' valid-model ',
            owned_by: 'local-lab',
            display_name: 'Valid Model',
            context_length: '8192',
            max_output_tokens: '1024',
          },
        ],
      }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      fallbackMaxInputTokens: 32768,
      fallbackMaxOutputTokens: 4096,
    });

    try {
      const models = await provider.getModels();

      assert.deepStrictEqual(models, [
        {
          id: 'valid-model',
          name: 'Valid Model',
          vendor: 'local-lab',
          family: 'local',
          maxInputTokens: 8192,
          maxOutputTokens: 1024,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('attaches structured metadata to invalid successful model-list payloads', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-request-id': 'req_bad_payload_1',
      });
      res.end(JSON.stringify({ data: [{ owned_by: 'bad' }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
    });

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.strictEqual(thrown.name, 'ProviderValidationError');
      assert.match(thrown.message, /Failed to parse model list: invalid response payload \(HTTP 200/);
      assert.match(thrown.message, /model list entry 0 missing id/);
      assert.strictEqual(thrown.status, 200);
      assert.strictEqual(thrown.statusCode, 200);
      assert.strictEqual(thrown.url, `http://127.0.0.1:${address.port}/models`);
      assert.strictEqual(thrown.provider, 'openaiCompatible');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.strictEqual(thrown.code, 'invalid_response_payload');
      assert.strictEqual(thrown.type, 'invalid_response');
      assert.strictEqual(thrown.responseHeaders?.['x-request-id'], 'req_bad_payload_1');
      assert.strictEqual(thrown.requestId, 'req_bad_payload_1');
      assert.match(thrown.responseBody, /owned_by/);
      assert.strictEqual(thrown.validationMessage, 'model list entry 0 missing id');
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('trims OpenAI-compatible string options before model discovery', async () => {
    let requestUrl = '';
    let requestAuth = '';
    const server = http.createServer((req, res) => {
      requestUrl = req.url || '';
      requestAuth = String(req.headers.authorization || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `  http://127.0.0.1:${address.port}/  `,
      apiKey: '  test-api-key  ',
      defaultModelId: '  configured-model  ',
    });

    try {
      const models = await provider.getModels();

      assert.strictEqual(requestUrl, '/models');
      assert.strictEqual(requestAuth, 'Bearer test-api-key');
      assert.deepStrictEqual(models.map((model) => model.id), ['configured-model']);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('does not send Authorization for blank OpenAI-compatible API keys', async () => {
    let requestAuth = '';
    const server = http.createServer((req, res) => {
      requestAuth = String(req.headers.authorization || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      apiKey: '   ',
      defaultModelId: 'configured-model',
    });

    try {
      await provider.getModels();

      assert.strictEqual(requestAuth, '');
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('attaches structured metadata to model-list HTTP errors', async () => {
    let requestAuth = '';
    const server = http.createServer((req, res) => {
      requestAuth = String(req.headers.authorization || '');
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'x-request-id': 'req_models_1',
        'retry-after': '2',
        'set-cookie': 'session=secret',
      });
      res.end(
        JSON.stringify({
          error: {
            message: 'model catalog unavailable',
            code: 'catalog_down',
            type: 'server_error',
            param: 'models',
          },
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `http://127.0.0.1:${address.port}`,
      apiKey: 'test-api-key',
    });

    try {
      let thrown: any;
      try {
        await provider.getModels();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected getModels to reject');
      assert.strictEqual(requestAuth, 'Bearer test-api-key');
      assert.strictEqual(thrown.name, 'ProviderHttpError');
      assert.match(thrown.message, /Failed to list models: HTTP 503/);
      assert.match(thrown.message, /model catalog unavailable/);
      assert.strictEqual(thrown.status, 503);
      assert.strictEqual(thrown.statusCode, 503);
      assert.strictEqual(thrown.url, `http://127.0.0.1:${address.port}/models`);
      assert.strictEqual(thrown.provider, 'openaiCompatible');
      assert.strictEqual(thrown.providerId, 'openaiCompatible');
      assert.match(thrown.responseBody, /model catalog unavailable/);
      assert.strictEqual(thrown.responseHeaders?.['x-request-id'], 'req_models_1');
      assert.strictEqual(thrown.headers?.['x-request-id'], 'req_models_1');
      assert.strictEqual(thrown.responseHeaders?.['set-cookie'], '<redacted>');
      assert.strictEqual(thrown.headers?.['set-cookie'], '<redacted>');
      assert.strictEqual(thrown.requestId, 'req_models_1');
      assert.strictEqual(thrown.retryAfterMs, 2000);
      assert.strictEqual(thrown.code, 'catalog_down');
      assert.strictEqual(thrown.errorCode, 'catalog_down');
      assert.strictEqual(thrown.type, 'server_error');
      assert.strictEqual(thrown.errorType, 'server_error');
      assert.strictEqual(thrown.param, 'models');
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
