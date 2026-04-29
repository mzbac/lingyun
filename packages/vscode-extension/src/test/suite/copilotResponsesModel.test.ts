import * as assert from 'assert';

import { createCopilotResponsesModel } from '../../providers/copilotResponsesModel';

function encodeSseEvents(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function encodeSseText(body: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

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

function assertStreamResponseMetadata(error: any, requestId: string): void {
  assert.strictEqual(error?.requestId, requestId);
  assert.strictEqual(error?.responseHeaders?.['x-request-id'], requestId);
  assert.strictEqual(error?.headers?.['x-request-id'], requestId);
}

suite('CopilotResponsesModel', () => {
  test('forces temperature=1 for fixed-temperature responses models', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | undefined;

    try {
      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(encodeSseEvents([{ type: 'response.completed', response: { id: 'resp_1', model: 'gpt-5.4' } }]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: 0.2,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      assert.strictEqual(capturedBody?.temperature, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('omits unset optional fields from serialized responses request body', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | undefined;

    try {
      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(encodeSseEvents([{ type: 'response.completed', response: { id: 'resp_1', model: 'gpt-5.4' } }]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: undefined,
      } as any);

      for (const key of ['include', 'instructions', 'tools', 'tool_choice', 'top_p', 'max_output_tokens', 'text', 'reasoning']) {
        assert.ok(!Object.prototype.hasOwnProperty.call(capturedBody || {}, key), `expected ${key} to be omitted`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('serializes xhigh reasoning effort for GPT-5.5 responses requests', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | undefined;

    try {
      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(encodeSseEvents([{ type: 'response.completed', response: { id: 'resp_1', model: 'gpt-5.5' } }]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.5',
        headers: {},
      });

      await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        providerOptions: {
          openai: { reasoningEffort: 'xhigh' },
          copilot: { reasoningEffort: 'xhigh' },
        },
        tools: [],
        toolChoice: undefined,
        temperature: 0.2,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      assert.strictEqual(capturedBody?.model, 'gpt-5.5');
      assert.deepStrictEqual(capturedBody?.include, ['reasoning.encrypted_content']);
      assert.deepStrictEqual(capturedBody?.reasoning, { effort: 'xhigh' });
      assert.strictEqual(capturedBody?.temperature, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('matches the v2.1.10 Copilot request body contract for agent history', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | undefined;

    try {
      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(
          encodeSseEvents([
            {
              type: 'response.completed',
              response: {
                id: 'resp_1',
                model: 'gpt-5.3-codex',
                usage: {
                  input_tokens: 0,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens: 0,
                  output_tokens_details: { reasoning_tokens: 0 },
                },
              },
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.3-codex',
        headers: {},
      });

      await model.doStream({
        prompt: [
          { role: 'system', content: 'System rule' },
          { role: 'user', content: [{ type: 'text', text: 'Inspect src' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'reasoning',
                text: 'hidden',
                providerOptions: {
                  copilot: {
                    reasoningOpaque: 'rs_opaque',
                    reasoningEncryptedContent: 'enc_123',
                  },
                },
              },
              { type: 'text', text: 'I will inspect the files.' },
              { type: 'tool-call', toolCallId: 'call_1', toolName: 'glob', input: '{"pattern":"src/**/*.ts"}' },
              { type: 'tool-result', toolCallId: 'call_1', output: { type: 'text', value: 'src/index.ts' } },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call_2',
                output: { type: 'json', value: { ok: true } },
              },
            ],
          },
        ],
        providerOptions: {
          openai: { reasoningEffort: 'high' },
          copilot: { textVerbosity: 'low' },
        },
        tools: [
          {
            type: 'function',
            name: 'glob',
            description: 'Find files',
            inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } },
          },
        ],
        toolChoice: { type: 'tool', toolName: 'glob' },
        temperature: 0.4,
        topP: 0.8,
        maxOutputTokens: 128,
      } as any);

      assert.deepStrictEqual(capturedBody, {
        model: 'gpt-5.3-codex',
        input: [
          { role: 'system', content: 'System rule' },
          { role: 'user', content: [{ type: 'input_text', text: 'Inspect src' }] },
          {
            type: 'reasoning',
            id: 'rs_opaque',
            summary: [],
            encrypted_content: 'enc_123',
          },
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'glob',
            arguments: '{"pattern":"src/**/*.ts"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: 'src/index.ts',
          },
          {
            role: 'assistant',
            content: [{ type: 'output_text', text: 'I will inspect the files.', annotations: [] }],
          },
          {
            type: 'function_call_output',
            call_id: 'call_2',
            output: '{"ok":true}',
          },
        ],
        stream: true,
        store: false,
        include: ['reasoning.encrypted_content'],
        tools: [
          {
            type: 'function',
            name: 'glob',
            description: 'Find files',
            parameters: { type: 'object', properties: { pattern: { type: 'string' } } },
            strict: false,
          },
        ],
        tool_choice: { type: 'function', name: 'glob' },
        temperature: 1,
        top_p: 0.8,
        max_output_tokens: 128,
        text: { verbosity: 'low' },
        reasoning: { effort: 'high' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses top-level instructions when providerOptions override them explicitly', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | undefined;

    try {
      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(
          encodeSseEvents([
            {
              type: 'response.completed',
              response: {
                id: 'resp_2',
                model: 'gpt-5.4',
                usage: {
                  input_tokens: 0,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens: 0,
                  output_tokens_details: { reasoning_tokens: 0 },
                },
              },
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      await model.doStream({
        prompt: [
          { role: 'system', content: 'System rule' },
          { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
        ],
        providerOptions: {
          openai: { instructions: 'Override instructions' },
          copilot: { instructions: 'Override instructions' },
        },
        tools: [],
        toolChoice: undefined,
        temperature: 0.2,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      assert.strictEqual(capturedBody?.instructions, 'Override instructions');
      assert.deepStrictEqual(capturedBody?.input, [
        { role: 'user', content: [{ type: 'input_text', text: 'Say hello' }] },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not duplicate assistant text when message.done also includes full content', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'Hello',
          },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg_1',
              content: [{ type: 'output_text', text: 'Hello' }],
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.3-codex',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.3-codex',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const text = parts
        .filter((part) => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('');

      assert.strictEqual(text, 'Hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('surfaces response.failed details instead of a generic stream error', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.failed',
            response: {
              id: 'resp_failed',
              status: 'failed',
              error: {
                code: 'model_not_found',
                type: 'invalid_request_error',
                message: 'Model gpt-5.5 is not available for this account.',
              },
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream_failed_1' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.5',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.match(String(parts[0].error?.message ?? ''), /Model <model> is not available/);
      assert.doesNotMatch(String(parts[0].error?.message ?? ''), /gpt-5\.5/);
      assert.match(String(parts[0].error?.message ?? ''), /code=model_not_found/);
      assert.doesNotMatch(String(parts[0].error?.message ?? ''), /Connection terminated/);
      assert.strictEqual(parts[0].error?.name, 'ResponsesStreamError');
      assert.strictEqual(parts[0].error?.url, 'https://example.invalid/responses');
      assert.strictEqual(parts[0].error?.provider, 'copilot');
      assert.strictEqual(parts[0].error?.providerId, 'copilot');
      assert.strictEqual(parts[0].error?.modelId, 'gpt-5.5');
      assert.strictEqual(parts[0].error?.eventType, 'response.failed');
      assert.strictEqual(parts[0].error?.responseId, 'resp_failed');
      assert.strictEqual(parts[0].error?.responseStatus, 'failed');
      assertStreamResponseMetadata(parts[0].error, 'req_stream_failed_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses SSE event field when response.failed payload omits type', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () =>
        new Response(
          encodeSseText(
            'event: response.failed\n' +
            'data: {"response":{"id":"resp_event_failed","status":"failed","error":{"code":"model_not_found","type":"invalid_request_error","message":"Model is unavailable."}}}\n\n',
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream_event_failed_1' },
          },
        );

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);
      const error = parts[0].error;

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.strictEqual(error?.name, 'ResponsesStreamError');
      assert.match(String(error?.message ?? ''), /Model is unavailable/);
      assert.match(String(error?.message ?? ''), /code=model_not_found/);
      assert.strictEqual(error?.eventType, 'response.failed');
      assert.strictEqual(error?.responseId, 'resp_event_failed');
      assert.strictEqual(error?.responseStatus, 'failed');
      assertStreamResponseMetadata(error, 'req_stream_event_failed_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('attaches retry delay metadata to rate-limited response.failed stream errors', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.failed',
            response: {
              id: 'resp_rate_limited',
              status: 'failed',
              error: {
                code: 'rate_limit_exceeded',
                type: 'rate_limit_error',
                message: 'Rate limit reached for gpt-5.4. Please try again in 11.054s.',
                status_code: '429',
              },
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.strictEqual(parts[0].error?.name, 'ResponsesStreamError');
      assert.match(String(parts[0].error?.message ?? ''), /Rate limit reached/);
      assert.match(String(parts[0].error?.message ?? ''), /httpStatus=429/);
      assert.strictEqual(parts[0].error?.status, 429);
      assert.strictEqual(parts[0].error?.statusCode, 429);
      assert.strictEqual(parts[0].error?.code, 'rate_limit_exceeded');
      assert.strictEqual(parts[0].error?.type, 'rate_limit_error');
      assert.strictEqual(parts[0].error?.retryAfterMs, 11054);
      assert.strictEqual(parts[0].error?.url, 'https://example.invalid/responses');
      assert.strictEqual(parts[0].error?.provider, 'copilot');
      assert.strictEqual(parts[0].error?.providerId, 'copilot');
      assert.strictEqual(parts[0].error?.modelId, 'gpt-5.4');
      assert.strictEqual(parts[0].error?.eventType, 'response.failed');
      assert.strictEqual(parts[0].error?.responseId, 'resp_rate_limited');
      assert.strictEqual(parts[0].error?.responseStatus, 'failed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('treats numeric stream retry_after epoch timestamps as absolute retry times', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const retryAtSeconds = Math.ceil(Date.now() / 1000) + 3;
        const events = [
          {
            type: 'response.failed',
            response: {
              id: 'resp_rate_limited_epoch',
              status: 'failed',
              error: {
                code: 'rate_limit_exceeded',
                type: 'rate_limit_error',
                message: 'Rate limit reached for gpt-5.4.',
                retry_after: retryAtSeconds,
              },
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.strictEqual(parts[0].error?.name, 'ResponsesStreamError');
      assert.strictEqual(parts[0].error?.code, 'rate_limit_exceeded');
      assert.ok(
        typeof parts[0].error?.retryAfterMs === 'number' &&
          parts[0].error.retryAfterMs > 0 &&
          parts[0].error.retryAfterMs <= 4000,
      );
      assert.strictEqual(parts[0].error?.eventType, 'response.failed');
      assert.strictEqual(parts[0].error?.responseId, 'resp_rate_limited_epoch');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('surfaces response.incomplete as a structured stream error', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.incomplete',
            response: {
              id: 'resp_incomplete',
              status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.strictEqual(parts[0].error?.name, 'ResponsesStreamError');
      assert.match(String(parts[0].error?.message ?? ''), /Incomplete response returned/);
      assert.match(String(parts[0].error?.message ?? ''), /reason=max_output_tokens/);
      assert.strictEqual(parts[0].error?.code, 'response_incomplete');
      assert.strictEqual(parts[0].error?.type, 'incomplete_response');
      assert.strictEqual(parts[0].error?.eventType, 'response.incomplete');
      assert.strictEqual(parts[0].error?.responseId, 'resp_incomplete');
      assert.strictEqual(parts[0].error?.responseStatus, 'incomplete');
      assert.strictEqual(parts[0].error?.provider, 'copilot');
      assert.strictEqual(parts[0].error?.modelId, 'gpt-5.4');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('attaches structured metadata to non-ok HTTP responses', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { message: 'Token expired' } }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req_http_1',
          },
        });

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      let thrown: any;
      try {
        await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
          tools: [],
          toolChoice: undefined,
          temperature: undefined,
          topP: undefined,
          maxOutputTokens: 16,
        } as any);
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected doStream to reject');
      assert.strictEqual(thrown.status, 401);
      assert.strictEqual(thrown.statusCode, 401);
      assert.strictEqual(thrown.url, 'https://example.invalid/responses');
      assert.match(thrown.responseBody, /Token expired/);
      assert.strictEqual(thrown.responseHeaders?.['x-request-id'], 'req_http_1');
      assert.strictEqual(thrown.headers?.['x-request-id'], 'req_http_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('wraps Responses request fetch failures with provider metadata', async () => {
    const originalFetch = globalThis.fetch;
    const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

    try {
      globalThis.fetch = async () => {
        throw cause;
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      let thrown: any;
      try {
        await model.doStream({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
          tools: [],
          toolChoice: undefined,
          temperature: undefined,
          topP: undefined,
          maxOutputTokens: 16,
        } as any);
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected doStream to reject');
      assert.strictEqual(thrown.name, 'ProviderFetchError');
      assert.match(String(thrown.message), /Copilot Responses request failed: socket hang up/);
      assert.strictEqual(thrown.cause, cause);
      assert.strictEqual(thrown.url, 'https://example.invalid/responses');
      assert.strictEqual(thrown.provider, 'copilot');
      assert.strictEqual(thrown.providerId, 'copilot');
      assert.strictEqual(thrown.modelId, 'gpt-5.4');
      assert.strictEqual(thrown.code, 'ECONNRESET');
      assert.strictEqual(thrown.type, 'network_error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('surfaces nested error event details instead of Responses stream error', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'error',
            error: {
              code: 'unsupported_model',
              type: 'invalid_request_error',
              message: 'Unsupported model gpt-5.5 for the Codex subscription endpoint.',
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.5',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.match(String(parts[0].error?.message ?? ''), /Unsupported model <model>/);
      assert.doesNotMatch(String(parts[0].error?.message ?? ''), /gpt-5\.5/);
      assert.match(String(parts[0].error?.message ?? ''), /code=unsupported_model/);
      assert.doesNotMatch(String(parts[0].error?.message ?? ''), /^Responses stream error$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('surfaces nested data.error event details instead of Responses stream error', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'error',
            data: {
              error: {
                message: 'remote stream failure',
                code: 'rate_limit_exceeded',
                type: 'rate_limit_error',
                param: 'input',
                retry_after_ms: 1500,
              },
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);
      const error = parts[0].error;
      const message = String(error?.message ?? '');

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.strictEqual(error?.name, 'ResponsesStreamError');
      assert.match(message, /remote stream failure/);
      assert.match(message, /code=rate_limit_exceeded/);
      assert.match(message, /type=rate_limit_error/);
      assert.match(message, /param=input/);
      assert.doesNotMatch(message, /^Responses stream error$/);
      assert.strictEqual(error?.code, 'rate_limit_exceeded');
      assert.strictEqual(error?.errorCode, 'rate_limit_exceeded');
      assert.strictEqual(error?.type, 'rate_limit_error');
      assert.strictEqual(error?.errorType, 'rate_limit_error');
      assert.strictEqual(error?.param, 'input');
      assert.strictEqual(error?.retryAfterMs, 1500);
      assert.strictEqual(error?.eventType, 'error');
      assert.strictEqual(error?.provider, 'copilot');
      assert.strictEqual(error?.providerId, 'copilot');
      assert.strictEqual(error?.modelId, 'gpt-5.4');
      assert.strictEqual(error?.url, 'https://example.invalid/responses');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('surfaces flat OAuth-style error event details instead of Responses stream error', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'error',
            error: 'temporarily_unavailable',
            error_description: 'Provider temporarily unavailable',
            retry_after: 2,
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);
      const error = parts[0].error;
      const message = String(error?.message ?? '');

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.strictEqual(error?.name, 'ResponsesStreamError');
      assert.match(message, /Provider temporarily unavailable/);
      assert.match(message, /code=temporarily_unavailable/);
      assert.doesNotMatch(message, /^Responses stream error$/);
      assert.strictEqual(error?.code, 'temporarily_unavailable');
      assert.strictEqual(error?.errorCode, 'temporarily_unavailable');
      assert.strictEqual(error?.retryAfterMs, 2000);
      assert.strictEqual(error?.eventType, 'error');
      assert.strictEqual(error?.provider, 'copilot');
      assert.strictEqual(error?.providerId, 'copilot');
      assert.strictEqual(error?.modelId, 'gpt-5.4');
      assert.strictEqual(error?.url, 'https://example.invalid/responses');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('redacts sensitive provider-supplied Responses stream error messages', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'error',
            data: {
              error: {
                message: 'remote stream failure for http://10.0.0.4:11434/v1 token=raw-secret and model gpt-5.4',
                code: 'rate_limit_exceeded',
                type: 'rate_limit_error',
                retry_after_ms: 1500,
              },
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);
      const error = parts[0].error;
      const message = String(error?.message ?? '');

      assert.deepStrictEqual(parts.map((part) => part.type), ['error']);
      assert.strictEqual(error?.name, 'ResponsesStreamError');
      assert.match(message, /remote stream failure/);
      assert.match(message, /code=rate_limit_exceeded/);
      assert.doesNotMatch(message, /raw-secret/);
      assert.doesNotMatch(message, /10\.0\.0\.4/);
      assert.doesNotMatch(message, /11434/);
      assert.doesNotMatch(message, /gpt-5\.4/);
      assert.match(message, /model <model>/);
      assert.strictEqual(error?.code, 'rate_limit_exceeded');
      assert.strictEqual(error?.type, 'rate_limit_error');
      assert.strictEqual(error?.retryAfterMs, 1500);
      assert.strictEqual(error?.provider, 'copilot');
      assert.strictEqual(error?.modelId, 'gpt-5.4');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('surfaces malformed SSE JSON as a structured stream parse error', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () =>
        new Response(
          encodeSseText(
            'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.4"}}\n\n' +
              'data: {"type":"response.output_text.delta"\n\n',
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream_parse_1' },
          },
        );

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);

      assert.deepStrictEqual(parts.map((part) => part.type), ['response-metadata', 'error']);
      assert.strictEqual(parts[1].error?.name, 'ResponsesStreamError');
      assert.match(String(parts[1].error?.message ?? ''), /Responses stream contained invalid JSON event data/);
      assert.match(String(parts[1].error?.message ?? ''), /code=invalid_sse_json/);
      assert.strictEqual(parts[1].error?.code, 'invalid_sse_json');
      assert.strictEqual(parts[1].error?.type, 'invalid_response');
      assert.strictEqual(parts[1].error?.eventType, 'stream.parse_error');
      assert.strictEqual(parts[1].error?.lastEventType, 'response.created');
      assert.strictEqual(parts[1].error?.parseErrorName, 'SyntaxError');
      assert.ok(parts[1].error?.dataLength > 0);
      assert.strictEqual(parts[1].error?.provider, 'copilot');
      assert.strictEqual(parts[1].error?.providerId, 'copilot');
      assert.strictEqual(parts[1].error?.modelId, 'gpt-5.4');
      assert.strictEqual(parts[1].error?.url, 'https://example.invalid/responses');
      assertStreamResponseMetadata(parts[1].error, 'req_stream_parse_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('wraps underlying SSE read failures with structured stream metadata', async () => {
    const originalFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    const cause = Object.assign(new TypeError('socket reset while reading http://10.0.0.4:11434/v1 token=raw-secret model=gpt-5.4'), {
      responseBody: 'read failure body http://10.0.0.4:11434/v1 token=raw-secret model=gpt-5.4',
      error: {
        message: 'nested read error http://10.0.0.4:11434/v1 token=raw-secret model=gpt-5.4',
      },
      data: {
        error: {
          message: 'nested read data error http://10.0.0.4:11434/v1 token=raw-secret model=gpt-5.4',
        },
      },
      headers: {
        authorization: 'Bearer raw-secret',
        'x-request-id': 'req_read_1',
      },
    });
    cause.stack = 'TypeError: socket reset while reading http://10.0.0.4:11434/v1 token=raw-secret model=gpt-5.4';

    try {
      globalThis.fetch = async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!(this as { emitted?: boolean }).emitted) {
                (this as { emitted?: boolean }).emitted = true;
                controller.enqueue(encoder.encode('data: {"type":"response.created","response":{"id":"resp_read_1","model":"gpt-5.4"}}\n\n'));
                return;
              }
              controller.error(cause);
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream_read_1' },
          },
        );

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);
      const error = parts[1].error;
      const message = String(error?.message ?? '');

      assert.deepStrictEqual(parts.map((part) => part.type), ['response-metadata', 'error']);
      assert.strictEqual(error?.name, 'ResponsesStreamError');
      assert.match(message, /Responses stream read failed/);
      assert.match(message, /code=stream_read_error/);
      assert.doesNotMatch(message, /raw-secret/);
      assert.doesNotMatch(message, /10\.0\.0\.4/);
      assert.strictEqual(error?.code, 'stream_read_error');
      assert.strictEqual(error?.type, 'network_error');
      assert.strictEqual(error?.eventType, 'stream.read_error');
      assert.strictEqual(error?.lastEventType, 'response.created');
      assert.strictEqual(error?.cause, cause);
      assert.strictEqual(cause.message.includes('raw-secret'), false);
      assert.strictEqual(cause.message.includes('10.0.0.4'), false);
      assert.strictEqual(cause.message.includes('gpt-5.4'), false);
      assert.strictEqual(cause.stack?.includes('raw-secret'), false);
      assert.strictEqual(cause.stack?.includes('10.0.0.4'), false);
      assert.strictEqual(cause.responseBody.includes('raw-secret'), false);
      assert.strictEqual(cause.responseBody.includes('10.0.0.4'), false);
      assert.strictEqual(cause.responseBody.includes('gpt-5.4'), false);
      assert.strictEqual(cause.error.message.includes('raw-secret'), false);
      assert.strictEqual(cause.error.message.includes('10.0.0.4'), false);
      assert.strictEqual(cause.data.error.message.includes('raw-secret'), false);
      assert.strictEqual(cause.data.error.message.includes('10.0.0.4'), false);
      assert.strictEqual(cause.headers.authorization, '<redacted>');
      assert.strictEqual(cause.headers['x-request-id'], 'req_read_1');
      assert.strictEqual(error?.causeName, 'TypeError');
      assert.strictEqual(error?.provider, 'copilot');
      assert.strictEqual(error?.providerId, 'copilot');
      assert.strictEqual(error?.modelId, 'gpt-5.4');
      assert.strictEqual(error?.url, 'https://example.invalid/responses');
      assertStreamResponseMetadata(error, 'req_stream_read_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('classifies aborted SSE read failures as non-retryable abort errors', async () => {
    const originalFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    const cause = new Error('user cancelled while reading stream');
    cause.name = 'AbortError';

    try {
      globalThis.fetch = async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!(this as { emitted?: boolean }).emitted) {
                (this as { emitted?: boolean }).emitted = true;
                controller.enqueue(encoder.encode('data: {"type":"response.created","response":{"id":"resp_abort_1","model":"gpt-5.4"}}\n\n'));
                return;
              }
              controller.error(cause);
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);
      const error = parts[1].error;
      const message = String(error?.message ?? '');

      assert.deepStrictEqual(parts.map((part) => part.type), ['response-metadata', 'error']);
      assert.strictEqual(error?.name, 'ResponsesStreamError');
      assert.match(message, /Responses stream read failed/);
      assert.match(message, /code=request_aborted/);
      assert.strictEqual(error?.code, 'request_aborted');
      assert.strictEqual(error?.type, 'aborted');
      assert.strictEqual(error?.eventType, 'stream.read_error');
      assert.strictEqual(error?.lastEventType, 'response.created');
      assert.strictEqual(error?.cause, cause);
      assert.strictEqual(error?.causeName, 'AbortError');
      assert.strictEqual(error?.provider, 'copilot');
      assert.strictEqual(error?.providerId, 'copilot');
      assert.strictEqual(error?.modelId, 'gpt-5.4');
      assert.strictEqual(error?.url, 'https://example.invalid/responses');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('wraps unexpected Responses stream adapter exceptions with structured metadata', async () => {
    const originalFetch = globalThis.fetch;
    const originalDecode = TextDecoder.prototype.decode;
    const encoder = new TextEncoder();
    let decodeCalls = 0;
    const cause = Object.assign(new TypeError('decoder failed for http://10.0.0.5:8080/v1 token=raw-secret model=gpt-5.4'), {
      responseBody: 'adapter failure body http://10.0.0.5:8080/v1 token=raw-secret model=gpt-5.4',
      error: {
        message: 'nested adapter error http://10.0.0.5:8080/v1 token=raw-secret model=gpt-5.4',
      },
      response: {
        body: 'adapter response body http://10.0.0.5:8080/v1 token=raw-secret model=gpt-5.4',
        headers: {
          cookie: 'session=raw-secret',
          'x-request-id': 'req_adapter_1',
        },
      },
    });
    cause.stack = 'TypeError: decoder failed for http://10.0.0.5:8080/v1 token=raw-secret model=gpt-5.4';

    try {
      globalThis.fetch = async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"response.created","response":{"id":"resp_adapter_1","model":"gpt-5.4"}}\n\n'));
              controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","item_id":"item_1","delta":"hello"}\n\n'));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream_adapter_1' },
          },
        );

      TextDecoder.prototype.decode = function (this: any, input?: any, options?: any) {
        decodeCalls += 1;
        if (decodeCalls > 1) {
          throw cause;
        }
        return originalDecode.call(this, input, options);
      } as typeof TextDecoder.prototype.decode;

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);
      const error = parts[1].error;
      const message = String(error?.message ?? '');

      assert.deepStrictEqual(parts.map((part) => part.type), ['response-metadata', 'error']);
      assert.strictEqual(error?.name, 'ResponsesStreamError');
      assert.match(message, /Responses stream adapter failed/);
      assert.match(message, /code=stream_adapter_error/);
      assert.doesNotMatch(message, /raw-secret/);
      assert.doesNotMatch(message, /10\.0\.0\.5/);
      assert.strictEqual(error?.code, 'stream_adapter_error');
      assert.strictEqual(error?.type, 'invalid_response');
      assert.strictEqual(error?.eventType, 'stream.adapter_error');
      assert.strictEqual(error?.lastEventType, 'response.created');
      assert.strictEqual(error?.cause, cause);
      assert.strictEqual(cause.message.includes('raw-secret'), false);
      assert.strictEqual(cause.message.includes('10.0.0.5'), false);
      assert.strictEqual(cause.message.includes('gpt-5.4'), false);
      assert.strictEqual(cause.stack?.includes('raw-secret'), false);
      assert.strictEqual(cause.stack?.includes('10.0.0.5'), false);
      assert.strictEqual(cause.responseBody.includes('raw-secret'), false);
      assert.strictEqual(cause.responseBody.includes('10.0.0.5'), false);
      assert.strictEqual(cause.responseBody.includes('gpt-5.4'), false);
      assert.strictEqual(cause.error.message.includes('raw-secret'), false);
      assert.strictEqual(cause.error.message.includes('10.0.0.5'), false);
      assert.strictEqual(cause.response.body.includes('raw-secret'), false);
      assert.strictEqual(cause.response.body.includes('10.0.0.5'), false);
      assert.strictEqual(cause.response.body.includes('gpt-5.4'), false);
      assert.strictEqual(cause.response.headers.cookie, '<redacted>');
      assert.strictEqual(cause.response.headers['x-request-id'], 'req_adapter_1');
      assert.strictEqual(error?.causeName, 'TypeError');
      assert.strictEqual(error?.provider, 'copilot');
      assert.strictEqual(error?.providerId, 'copilot');
      assert.strictEqual(error?.modelId, 'gpt-5.4');
      assert.strictEqual(error?.url, 'https://example.invalid/responses');
      assertStreamResponseMetadata(error, 'req_stream_adapter_1');
    } finally {
      TextDecoder.prototype.decode = originalDecode;
      globalThis.fetch = originalFetch;
    }
  });

  test('matches the v2.1.10 doGenerate contract for response metadata, reasoning, text, and tool calls', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.created',
            response: {
              id: 'resp_1',
              model: 'gpt-5.3-codex',
              created_at: 1_700_000_000,
            },
          },
          {
            type: 'response.output_item.added',
            output_index: 2,
            item: {
              type: 'reasoning',
              id: 'rs_1',
            },
          },
          {
            type: 'response.reasoning_summary_text.delta',
            item_id: 'rs_1',
            summary_index: 0,
            delta: 'Check files',
          },
          {
            type: 'response.reasoning_summary_part.done',
            item_id: 'rs_1',
            summary_index: 0,
          },
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'I will inspect.',
          },
          {
            type: 'response.output_item.added',
            output_index: 1,
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'glob',
              arguments: '',
            },
          },
          {
            type: 'response.function_call_arguments.delta',
            output_index: 1,
            delta: '{"pattern":"src/**/*.ts"}',
          },
          {
            type: 'response.output_item.done',
            output_index: 1,
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'glob',
              arguments: '{"pattern":"src/**/*.ts"}',
            },
          },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg_1',
              content: [{ type: 'output_text', text: 'I will inspect.' }],
            },
          },
          {
            type: 'response.output_item.done',
            output_index: 2,
            item: {
              type: 'reasoning',
              id: 'rs_1',
              encrypted_content: 'enc_123',
              summary: [{ text: 'Check files' }],
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.3-codex',
              created_at: 1_700_000_000,
              usage: {
                input_tokens: 7,
                input_tokens_details: { cached_tokens: 1 },
                output_tokens: 11,
                output_tokens_details: { reasoning_tokens: 3 },
              },
            },
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.3-codex',
        headers: {},
      });

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      assert.deepStrictEqual(result.content, [
        { type: 'text', text: 'I will inspect.' },
        { type: 'reasoning', text: 'Check files' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'glob',
          input: '{"pattern":"src/**/*.ts"}',
        },
      ]);
      assert.deepStrictEqual(result.finishReason, { unified: 'tool-calls', raw: undefined });
      assert.deepStrictEqual(result.usage, {
        inputTokens: { total: 7, noCache: 6, cacheRead: 1, cacheWrite: 0 },
        outputTokens: { total: 11, text: 8, reasoning: 3 },
        raw: {
          input_tokens: 7,
          input_tokens_details: { cached_tokens: 1 },
          output_tokens: 11,
          output_tokens_details: { reasoning_tokens: 3 },
        },
      });
      assert.deepStrictEqual(result.response, {
        id: 'resp_1',
        modelId: 'gpt-5.3-codex',
        timestamp: new Date(1_700_000_000 * 1000),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('accepts a complete final SSE event without a trailing blank line', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () =>
        new Response(
          encodeSseText(
            'data: {"type":"response.completed","response":{"id":"resp_no_boundary","model":"gpt-5.4"}}',
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const parts = await readStreamParts(result.stream);

      assert.deepStrictEqual(parts.map((part) => part.type), ['response-metadata', 'finish']);
      assert.strictEqual(parts[0].id, 'resp_no_boundary');
      assert.strictEqual(parts[0].modelId, 'gpt-5.4');
      assert.strictEqual(parts[1].finishReason?.unified, 'stop');
      assert.strictEqual(parts[1].finishReason?.raw, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses SSE event field when response.completed payload omits type', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () =>
        new Response(
          encodeSseText(
            'event: response.completed\n' +
            'data: {"response":{"id":"resp_event_completed","model":"gpt-5.4","created_at":1700000000,"usage":{"input_tokens":1,"output_tokens":2}}}\n\n',
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      assert.deepStrictEqual(result.finishReason, { unified: 'stop', raw: undefined });
      assert.deepStrictEqual(result.response, {
        id: 'resp_event_completed',
        modelId: 'gpt-5.4',
        timestamp: new Date(1_700_000_000 * 1000),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('matches the v2.1.10 pending tool-call EOF contract by surfacing a stream error', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'glob',
              arguments: '',
            },
          },
          {
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            delta: '{"pattern":"src/**/*.ts"}',
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream_tool_eof_1' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.3-codex',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      assert.deepStrictEqual(
        parts.map((part) => part.type),
        ['tool-input-start', 'tool-input-delta', 'error'],
      );
      assert.strictEqual(parts[2].error?.name, 'ResponsesStreamError');
      assert.match(String(parts[2].error?.message ?? ''), /Responses stream terminated before response\.completed/);
      assert.match(String(parts[2].error?.message ?? ''), /code=stream_terminated/);
      assert.match(String(parts[2].error?.message ?? ''), /lastEvent=response\.function_call_arguments\.delta/);
      assert.strictEqual(parts[2].error?.provider, 'copilot');
      assert.strictEqual(parts[2].error?.modelId, 'gpt-5.3-codex');
      assert.strictEqual(parts[2].error?.code, 'stream_terminated');
      assert.strictEqual(parts[2].error?.lastEventType, 'response.function_call_arguments.delta');
      assert.strictEqual(parts[2].error?.pendingToolCallCount, 1);
      assertStreamResponseMetadata(parts[2].error, 'req_stream_tool_eof_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('surfaces a stream error when assistant text EOF arrives before response.completed', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'partial output',
          },
        ];

        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_stream_text_eof_1' },
        });
      };

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      assert.deepStrictEqual(
        parts.map((part) => part.type),
        ['text-start', 'text-delta', 'text-end', 'error'],
      );
      assert.strictEqual(
        parts.filter((part) => part.type === 'text-delta').map((part) => part.delta).join(''),
        'partial output',
      );
      assert.strictEqual(parts.filter((part) => part.type === 'finish').length, 0);
      assert.strictEqual(parts[3].error?.name, 'ResponsesStreamError');
      assert.match(String(parts[3].error?.message ?? ''), /Responses stream terminated before response\.completed/);
      assert.match(String(parts[3].error?.message ?? ''), /code=stream_terminated/);
      assert.match(String(parts[3].error?.message ?? ''), /lastEvent=response\.output_text\.delta/);
      assert.strictEqual(parts[3].error?.provider, 'copilot');
      assert.strictEqual(parts[3].error?.modelId, 'gpt-5.4');
      assert.strictEqual(parts[3].error?.code, 'stream_terminated');
      assert.strictEqual(parts[3].error?.lastEventType, 'response.output_text.delta');
      assert.strictEqual(parts[3].error?.openTextCount, 1);
      assertStreamResponseMetadata(parts[3].error, 'req_stream_text_eof_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ignores late text and reasoning deltas after the v2.1.10 turn has already finalized them', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.reasoning_summary_text.delta',
            item_id: 'rs_1',
            summary_index: 0,
            delta: 'Plan',
          },
          {
            type: 'response.reasoning_summary_part.done',
            item_id: 'rs_1',
            summary_index: 0,
          },
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'Hello',
          },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg_1',
              content: [{ type: 'output_text', text: 'Hello' }],
            },
          },
          {
            type: 'response.output_item.done',
            output_index: 1,
            item: {
              type: 'reasoning',
              id: 'rs_1',
              encrypted_content: 'enc_123',
              summary: [{ text: 'Plan' }],
            },
          },
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: ' late',
          },
          {
            type: 'response.reasoning_summary_text.delta',
            item_id: 'rs_1',
            summary_index: 0,
            delta: ' late',
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.3-codex',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.3-codex',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      assert.strictEqual(
        parts.filter((part) => part.type === 'text-delta').map((part) => part.delta).join(''),
        'Hello',
      );
      assert.strictEqual(
        parts.filter((part) => part.type === 'reasoning-delta').map((part) => part.delta).join(''),
        'Plan',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not duplicate assistant text when output_text.done uses a different item id', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'Hello',
          },
          {
            type: 'response.output_text.done',
            item_id: 'msg_1',
            output_index: 0,
            text: 'Hello',
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.4',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const text = parts
        .filter((part) => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('');

      assert.strictEqual(text, 'Hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not duplicate assistant text when message.done follows output_text.done on a different item id', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'Hello',
          },
          {
            type: 'response.output_text.done',
            item_id: 'msg_1',
            output_index: 0,
            text: 'Hello',
          },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg_1',
              content: [{ type: 'output_text', text: 'Hello' }],
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.4',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const text = parts
        .filter((part) => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('');

      assert.strictEqual(text, 'Hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ignores late text deltas that arrive on the finalized message id alias', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'Hello',
          },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg_1',
              content: [{ type: 'output_text', text: 'Hello' }],
            },
          },
          {
            type: 'response.output_text.delta',
            item_id: 'msg_1',
            output_index: 0,
            delta: ' late',
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.4',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const text = parts
        .filter((part) => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('');

      assert.strictEqual(text, 'Hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not duplicate assistant text when content_part.done uses a different item id', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'Hello',
          },
          {
            type: 'response.content_part.done',
            item_id: 'msg_1',
            output_index: 0,
            part: {
              type: 'output_text',
              text: 'Hello',
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.4',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const text = parts
        .filter((part) => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('');

      assert.strictEqual(text, 'Hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ignores late text deltas that arrive on a content_part.done message id alias', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_text.delta',
            item_id: 'item_text_1',
            output_index: 0,
            delta: 'Hello',
          },
          {
            type: 'response.content_part.done',
            item_id: 'msg_1',
            output_index: 0,
            part: {
              type: 'output_text',
              text: 'Hello',
            },
          },
          {
            type: 'response.output_text.delta',
            item_id: 'msg_1',
            output_index: 0,
            delta: ' late',
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.4',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const text = parts
        .filter((part) => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('');

      assert.strictEqual(text, 'Hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('emits a tool call when function_call_arguments.done finalizes the call', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'test_echo',
              arguments: '',
            },
          },
          {
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            delta: '{"message":"x"',
          },
          {
            type: 'response.function_call_arguments.done',
            output_index: 0,
            call_id: 'call_1',
            name: 'test_echo',
            arguments: '{"message":"x"}',
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.4',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const toolCalls = parts.filter((part) => part.type === 'tool-call');
      assert.strictEqual(toolCalls.length, 1);
      assert.strictEqual(toolCalls[0].toolCallId, 'call_1');
      assert.strictEqual(toolCalls[0].toolName, 'test_echo');
      assert.strictEqual(toolCalls[0].input, '{"message":"x"}');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not duplicate a tool call when output_item.done follows function_call_arguments.done', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'test_echo',
              arguments: '',
            },
          },
          {
            type: 'response.function_call_arguments.done',
            output_index: 0,
            call_id: 'call_1',
            name: 'test_echo',
            arguments: '{"message":"x"}',
          },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'function_call',
              call_id: 'call_1',
              name: 'test_echo',
              arguments: '{"message":"x"}',
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.4',
              created_at: 0,
              usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 0,
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

      const model = createCopilotResponsesModel({
        baseURL: 'https://example.invalid',
        apiKey: 'test',
        modelId: 'gpt-5.4',
        headers: {},
      });

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        tools: [],
        toolChoice: undefined,
        temperature: undefined,
        topP: undefined,
        maxOutputTokens: 16,
      } as any);

      const reader = result.stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }

      const toolCalls = parts.filter((part) => part.type === 'tool-call');
      assert.strictEqual(toolCalls.length, 1);
      assert.strictEqual(toolCalls[0].toolCallId, 'call_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
