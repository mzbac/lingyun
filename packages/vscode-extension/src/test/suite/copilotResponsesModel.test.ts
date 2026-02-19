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
});

