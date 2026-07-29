import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';

import { isPrivateIpv4Address } from '@kooka/core';
import { timeoutSignal } from '../../abort.js';
import { LingyunAgent, LingyunSession, OpenAICompatibleProvider, ToolRegistry } from '../../index.js';

function createSelfSignedLocalhostCert(): { key: Buffer; cert: Buffer; cleanup: () => void } | undefined {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingyun-sdk-selfsigned-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  try {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-subj',
      '/CN=localhost',
    ], { stdio: 'ignore' });
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
}

suite('OpenAICompatibleProvider fetch', () => {
  test('allows self-signed TLS when explicitly enabled', async function () {
    const cert = createSelfSignedLocalhostCert();
    if (!cert) this.skip();

    const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
      if (req.url !== '/v1/models') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'self-signed-model' }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      cert.cleanup();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({
      baseURL: `https://127.0.0.1:${address.port}/v1`,
      allowInsecureTLS: true,
    });

    try {
      const models = await provider.getModels();
      assert.strictEqual(models[0]?.id, 'self-signed-model');
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      cert.cleanup();
    }
  });

  test('sends think:false in DeepSeek chat-completions request bodies', async () => {
    let observedBody: any;
    const server = http.createServer((req, res) => {
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        observedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end([
          'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
          'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
          'data: [DONE]\n\n',
        ].join(''));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const llm = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}/v1` });
    const agent = new LingyunAgent(llm, { model: 'deepseek-v4-flash', maxOutputTokens: 16 }, new ToolRegistry());
    const session = new LingyunSession();
    try {
      const run = agent.run({ session, input: 'hi' });
      for await (const _event of run.events) {
        // drain
      }
      assert.strictEqual((await run.done).text, 'ok');

      assert.strictEqual(observedBody?.model, 'deepseek-v4-flash');
      assert.strictEqual(observedBody?.think, false);
      assert.strictEqual(observedBody?.reasoning_effort, undefined);
    } finally {
      llm.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

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

  test('loads OpenAI-compatible model metadata for derived token limits', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            {
              id: 'metadata-model',
              owned_by: 'local',
              context_window: 131072,
              max_output_tokens: 16384,
            },
          ],
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}/v1` });
    try {
      assert.deepStrictEqual(await provider.getModels(), [
        {
          id: 'metadata-model',
          name: 'metadata-model',
          vendor: 'local',
          family: 'local',
          maxInputTokens: 131072,
          maxOutputTokens: 16384,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('loads nested OpenAI-compatible model metadata while deduplicating trimmed IDs', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            {
              id: ' nested-model ',
              display_name: 'Nested One',
              owned_by: 'local',
              model_info: {
                context_length: '32000',
                max_completion_tokens: '4096',
              },
            },
            {
              id: 'nested-model',
              display_name: 'Duplicate should be ignored',
              context_window: 64000,
            },
            {
              id: 'top-provider-model',
              top_provider: {
                max_input_tokens: 96000,
                max_output_tokens: '2048',
              },
            },
          ],
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      assert.fail('Expected server to bind to a TCP port');
    }

    const provider = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}/v1` });
    try {
      assert.deepStrictEqual(await provider.getModels(), [
        {
          id: 'nested-model',
          name: 'Nested One',
          vendor: 'local',
          family: 'local',
          maxInputTokens: 32000,
          maxOutputTokens: 4096,
        },
        {
          id: 'top-provider-model',
          name: 'top-provider-model',
          vendor: 'openai-compatible',
          family: 'local',
          maxInputTokens: 96000,
          maxOutputTokens: 2048,
        },
      ]);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('annotates chat-model generate errors with provider and model metadata', async () => {
    const provider = new OpenAICompatibleProvider({ baseURL: 'http://127.0.0.1:12345' });
    const responseHeaders = Object.assign(Object.create({ 'x-inherited': 'skip' }), {
      'x-request-id': 'sdk_req_generate_1',
      'retry-after-ms': '1500',
      'x-trace': ['one', 2],
      'set-cookie': 'secret=session',
    });
    const causeHeaders = Object.assign(Object.create({ 'x-inherited-cause': 'skip' }), {
      'x-request-id': 'sdk_cause_generate_1',
      'set-cookie': 'cause=session',
    });
    const rawCause: any = {
      message: 'cause for metadata-model at http://192.168.1.5/v1 token=cause-secret',
      headers: causeHeaders,
    };
    const rawError: any = Object.assign(new Error('quota exceeded'), {
      name: 'AI_APICallError',
      statusCode: 429,
      url: 'https://api.example.test/v1/chat/completions',
      responseBody:
        'body for metadata-model at http://10.0.0.9:8080/v1 and http://8.8.8.8/v1 token=body-secret',
      responseHeaders,
      code: 'rate_limit_exceeded',
      cause: rawCause,
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
        'x-trace': 'one, 2',
        'set-cookie': '<redacted>',
      });
      assert.deepStrictEqual(thrown.headers, thrown.responseHeaders);
      assert.strictEqual(thrown.responseHeaders['x-inherited'], undefined);
      assert.strictEqual(
        thrown.responseBody,
        'body for <model> at http://<private-ip>:8080/v1 and http://8.8.8.8/v1 token=<redacted>',
      );
      assert.strictEqual(rawCause.message, 'cause for <model> at http://<private-ip>/v1 token=<redacted>');
      assert.deepStrictEqual(rawCause.headers, {
        'x-request-id': 'sdk_cause_generate_1',
        'set-cookie': '<redacted>',
      });
      assert.strictEqual(rawCause.headers['x-inherited-cause'], undefined);
      assert.strictEqual(thrown.requestId, 'sdk_req_generate_1');
      assert.strictEqual(thrown.retryAfterMs, 1500);
      assert.strictEqual(thrown.errorCode, 'rate_limit_exceeded');
    } finally {
      provider.dispose();
    }
  });

  test('provider model error header normalization avoids entry snapshots', () => {
    const source = fs.readFileSync(new URL('../../../../core/src/providerModelErrors.ts', import.meta.url), 'utf8');
    const ipSource = fs.readFileSync(new URL('../../../../core/src/ip.ts', import.meta.url), 'utf8');
    const matcherStart = source.indexOf('function fieldNameMatches');
    assert.ok(matcherStart >= 0, 'expected field-name matcher');
    const headerMatcherStart = source.indexOf('function headerNameMatches', matcherStart);
    assert.ok(headerMatcherStart > matcherStart, 'expected header-name matcher after field matcher');
    const stringifierStart = source.indexOf('function stringifyHeaderValue');
    assert.ok(stringifierStart > headerMatcherStart, 'expected header value stringifier after matchers');
    const escapeRegexStart = source.indexOf('function escapeRegex', stringifierStart);
    assert.ok(escapeRegexStart > stringifierStart, 'expected regex escaper after stringifier');
    const headerStart = source.indexOf('function sanitizedHeaderRecord', stringifierStart);
    assert.ok(headerStart > stringifierStart, 'expected sanitized header helper after stringifier');
    const sanitizerStart = source.indexOf('function sanitizeProviderDiagnosticFields', headerStart);
    assert.ok(sanitizerStart > headerStart, 'expected diagnostic field sanitizer after header helper');
    const errorChainStart = source.indexOf('\nfunction errorChain', sanitizerStart);
    assert.ok(errorChainStart > sanitizerStart, 'expected error chain helper after sanitizer');
    const firstStringStart = source.indexOf('function getFirstString', errorChainStart);
    assert.ok(firstStringStart > errorChainStart, 'expected string metadata helper after sanitizer');
    const headersToRecordStart = source.indexOf('\nfunction headersToRecord', firstStringStart);
    assert.ok(headersToRecordStart > firstStringStart, 'expected header conversion helper after metadata lookups');
    const normalizeStart = source.indexOf('function normalizeHeaderRecord', headersToRecordStart);
    assert.ok(normalizeStart > headersToRecordStart, 'expected normalized header helper');
    const getHeaderEnd = source.indexOf('\nfunction requestIdFromHeaders', normalizeStart);
    assert.ok(getHeaderEnd > normalizeStart, 'expected request id helper after header lookup');
    const recordStart = source.indexOf('function getRecordFromRecord', getHeaderEnd);
    assert.ok(recordStart > getHeaderEnd, 'expected record source helper');
    const metadataStart = source.indexOf('function errorMetadata', recordStart);
    assert.ok(metadataStart > recordStart, 'expected metadata helper after record lookup');
    const attachStart = source.indexOf('export function attachChatModelErrorMetadata', metadataStart);
    assert.ok(attachStart > metadataStart, 'expected attach metadata helper');
    const attachEnd = source.indexOf('\ntype ChatModelStreamResult', attachStart);
    assert.ok(attachEnd > attachStart, 'expected stream result type after attach helper');

    const headerSections =
      source.slice(matcherStart, stringifierStart) +
      source.slice(stringifierStart, sanitizerStart) +
      source.slice(sanitizerStart, errorChainStart) +
      source.slice(firstStringStart, headersToRecordStart) +
      source.slice(normalizeStart, getHeaderEnd) +
      source.slice(recordStart, metadataStart) +
      source.slice(metadataStart, attachStart) +
      source.slice(attachStart, attachEnd);

    assert.match(headerSections, /function fieldNameMatches/);
    assert.match(headerSections, /function headerNameMatches/);
    assert.match(source, /import \{ isPrivateIpv4Address \} from '\.\/ip';/);
    assert.match(source, /isPrivateIpv4Address\(match\)/);
    assert.doesNotMatch(source, /function isPrivateIpv4/);
    assert.match(ipSource, /export function isPrivateIpv4Address/);
    assert.match(ipSource, /charCodeAt/);
    assert.match(headerSections, /sanitizedHeaderRecord\(error\.headers\)/);
    assert.match(headerSections, /sanitizedHeaderRecord\(error\.responseHeaders\)/);
    assert.match(headerSections, /sanitizeProviderDiagnosticFields\(error\.cause, knownSensitiveValues, seen\)/);
    assert.match(headerSections, /sanitizeProviderDiagnosticFields\(error\.response, knownSensitiveValues, seen\)/);
    assert.match(headerSections, /getStringFromRecord\(record, keys\)/);
    assert.match(headerSections, /getNumberFromRecord\(record, keys\)/);
    assert.match(headerSections, /function getRecordFromRecord/);
    assert.match(headerSections, /function getRecordFromErrorRecord/);
    assert.match(headerSections, /let found = getStringFromRecord\(record, keys\)/);
    assert.match(headerSections, /found = getStringFromRecord\(data, keys\)/);
    assert.match(headerSections, /let found = getNumberFromRecord\(record, keys\)/);
    assert.match(headerSections, /found = getNumberFromRecord\(response, keys\)/);
    assert.match(headerSections, /let found = getRecordFromRecord\(record, keys\)/);
    assert.match(headerSections, /getRecordFromRecord\(record, keys\)/);
    assert.match(headerSections, /getRecordFromRecord\(response, keys\)/);
    assert.match(headerSections, /getRecordFromRecord\(data, keys\)/);
    assert.match(headerSections, /const chain = errorChain\(error\)/);
    assert.match(headerSections, /getFirstString\(chain, \['responseBody', 'body'\]\)/);
    assert.match(headerSections, /getFirstNumber\(chain, \['status', 'statusCode'\]\)/);
    assert.match(headerSections, /for \(const key in headers\)/);
    assert.match(headerSections, /Object\.prototype\.hasOwnProperty\.call\(headers, key\)/);
    assert.match(headerSections, /for \(const key in source\)/);
    assert.match(headerSections, /Object\.prototype\.hasOwnProperty\.call\(source, key\)/);
    assert.match(headerSections, /for \(const key in metadata\)/);
    assert.doesNotMatch(headerSections, /Object\.entries/);
    assert.doesNotMatch(headerSections, /for \(const key of \['headers', 'responseHeaders'\]\)/);
    assert.doesNotMatch(headerSections, /for \(const nested of \[/);
    assert.doesNotMatch(headerSections, /\.map\(\(item\) => String\(item\)\)/);
    assert.doesNotMatch(headerSections, /new Set\(keys\.map/);
    assert.doesNotMatch(headerSections, /new Set\(names\.map/);
    assert.doesNotMatch(headerSections, /getRecordFromSources/);
    assert.doesNotMatch(headerSections, /\[record, response, data\]/);
    assert.doesNotMatch(headerSections, /const found =\s*getStringFromRecord\(record, keys\) \?\?/);
    assert.doesNotMatch(headerSections, /const found =\s*getNumberFromRecord\(record, keys\) \?\?/);
    assert.doesNotMatch(headerSections, /getRecordFromRecord\(record, keys\) \?\?/);
    assert.doesNotMatch(headerSections, /getFirstString\(error,/);
    assert.doesNotMatch(headerSections, /getFirstNumber\(error,/);
    assert.doesNotMatch(headerSections, /getFirstRecord\(error,/);
    assert.doesNotMatch(ipSource, /\.split\(/);
    assert.doesNotMatch(ipSource, /\.map\(/);
    assert.doesNotMatch(ipSource, /\.some\(/);
    assert.doesNotMatch(headerSections, /\.find\(/);
  });

  test('shared private IPv4 classifier covers private and public ranges without split maps', () => {
    const cases: Array<[string, boolean]> = [
      ['10.0.0.1', true],
      ['127.0.0.1', true],
      ['172.16.0.1', true],
      ['172.31.255.255', true],
      ['192.168.1.1', true],
      ['169.254.1.1', true],
      ['172.32.0.1', false],
      ['8.8.8.8', false],
      ['999.1.1.1', false],
      ['1.2.3', false],
    ];

    for (const [address, expected] of cases) {
      assert.strictEqual(isPrivateIpv4Address(address), expected, address);
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
      const headers = Object.assign(Object.create({ 'x-inherited': 'skip' }), {
        'AcCePt-EnCoDiNg': 'br',
        'x-count': 42,
        'x-optional': undefined,
        'x-empty': null,
      });
      const response = await (provider as any).fetchFn(`http://127.0.0.1:${address.port}/headers`, {
        headers: headers as any,
      });
      await response.text();

      assert.strictEqual(observedHeaders?.['accept-encoding'], 'br');
      assert.strictEqual(observedHeaders?.['x-count'], '42');
      assert.strictEqual(observedHeaders?.['x-optional'], undefined);
      assert.strictEqual(observedHeaders?.['x-empty'], undefined);
      assert.strictEqual(observedHeaders?.['x-inherited'], undefined);
    } finally {
      provider.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('fetch header helpers avoid key-array and entry-array scans', () => {
    const source = fs.readFileSync(new URL('../../../src/llm/openaiCompatible.ts', import.meta.url), 'utf8');
    const start = source.indexOf('const hasOwnHeader = Object.prototype.hasOwnProperty;');
    assert.ok(start >= 0, 'expected header ownership helper');
    const end = source.indexOf('\ntype FetchWithDefaults', start);
    assert.ok(end > start, 'expected fetch defaults type after header helpers');
    const section = source.slice(start, end);

    assert.match(section, /for \(const existing in headers\)/);
    assert.match(section, /for \(const key in headers\)/);
    assert.match(section, /hasOwnHeader\.call\(headers,/);
    assert.match(section, /hasOwnHeader\.call\(headerRecord,/);
    assert.doesNotMatch(section, /Object\.keys\(headers\)/);
    assert.doesNotMatch(section, /Object\.entries\(/);
    assert.doesNotMatch(section, /\.some\(/);
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
