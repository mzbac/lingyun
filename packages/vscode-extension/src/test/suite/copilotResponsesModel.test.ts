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

  test('matches the v2.1.10 message.done-only fallback when no text deltas are streamed', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg_1',
              content: [{ type: 'output_text', text: 'Hello from fallback' }],
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

      assert.deepStrictEqual(
        parts.map((part) => part.type),
        ['text-start', 'text-delta', 'text-end', 'finish'],
      );
      assert.strictEqual(parts[1].delta, 'Hello from fallback');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('matches the v2.1.10 gpt-5.3-codex tool-call turn contract and dedupes overlapping reasoning summaries', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        const events = [
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
            delta: 'Checking files',
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
            delta: 'I will inspect the tree.',
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
              content: [{ type: 'output_text', text: 'I will inspect the tree.' }],
            },
          },
          {
            type: 'response.output_item.done',
            output_index: 2,
            item: {
              type: 'reasoning',
              id: 'rs_1',
              encrypted_content: 'enc_456',
              summary: [{ text: 'Checking files' }],
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              model: 'gpt-5.3-codex',
              created_at: 0,
              usage: {
                input_tokens: 7,
                input_tokens_details: { cached_tokens: 0 },
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
        [
          'reasoning-start',
          'reasoning-delta',
          'reasoning-end',
          'text-start',
          'text-delta',
          'tool-input-start',
          'tool-input-delta',
          'tool-input-end',
          'tool-call',
          'text-end',
          'finish',
        ],
      );
      assert.strictEqual(parts[4].delta, 'I will inspect the tree.');
      assert.strictEqual(
        parts.filter((part) => part.type === 'reasoning-delta').map((part) => part.delta).join(''),
        'Checking files',
      );
      assert.strictEqual(parts[8].toolCallId, 'call_1');
      assert.strictEqual(parts[8].toolName, 'glob');
      assert.strictEqual(parts[8].input, '{"pattern":"src/**/*.ts"}');
      assert.deepStrictEqual(parts[10].finishReason, { unified: 'tool-calls', raw: undefined });
      assert.deepStrictEqual(parts[10].providerMetadata, {
        copilot: {
          reasoningOpaque: 'rs_1',
          reasoningEncryptedContent: 'enc_456',
        },
      });
    } finally {
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

      assert.deepStrictEqual(
        parts.map((part) => part.type),
        ['tool-input-start', 'tool-input-delta', 'error'],
      );
      assert.match(String(parts[2].error?.message ?? ''), /Connection terminated/);
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

      assert.deepStrictEqual(
        parts.map((part) => part.type),
        ['text-start', 'text-delta', 'text-end', 'error'],
      );
      assert.strictEqual(
        parts.filter((part) => part.type === 'text-delta').map((part) => part.delta).join(''),
        'partial output',
      );
      assert.strictEqual(parts.filter((part) => part.type === 'finish').length, 0);
      assert.match(String(parts[3].error?.message ?? ''), /Connection terminated/);
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
