import * as assert from 'assert';
import { simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

import type { LLMProvider } from '../../core/types';
import { generateSessionTitle } from '../../core/sessionTitle';
import { createCopilotResponsesModel } from '../../providers/copilotResponsesModel';
import { createResponsesModel } from '../../providers/responsesModel';

function usage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
    raw: {},
  };
}

function streamPartsForText(text: string): LanguageModelV3StreamPart[] {
  const id = 'text_0';
  return [
    { type: 'text-start' as const, id },
    ...Array.from(text).map((ch) => ({ type: 'text-delta' as const, id, delta: ch })),
    { type: 'text-end' as const, id },
    {
      type: 'finish' as const,
      usage: usage(),
      finishReason: { unified: 'stop', raw: 'stop' },
    },
  ];
}

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

class MockStreamLLMProvider implements LLMProvider {
  readonly id = 'mock';
  readonly name = 'Mock';
  lastTemperature: number | undefined;

  constructor(private responseText: string) {}

  async getModel(modelId: string): Promise<unknown> {
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Not implemented');
      },
      doStream: async (options): Promise<LanguageModelV3StreamResult> => {
        this.lastTemperature = options.temperature;
        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: streamPartsForText(this.responseText),
          }),
        };
      },
    };

    return model;
  }
}

class MockResponsesLLMProvider implements LLMProvider {
  readonly id = 'copilot';
  readonly name = 'Mock Copilot';

  constructor(private events: unknown[]) {}

  async getModel(modelId: string): Promise<unknown> {
    return createResponsesModel({
      baseURL: 'https://example.invalid',
      apiKey: 'test',
      modelId,
      headers: {},
      provider: 'copilot',
      errorLabel: 'Copilot Responses',
      behavior: {
        providerOptionKeys: ['openai', 'copilot'],
        systemPromptMode: 'input',
        includeSamplingOptions: true,
        reasoningReplayProviderKey: 'copilot',
        finishProviderMetadataKey: 'copilot',
      },
      fetch: async () =>
        new Response(encodeSseEvents(this.events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    });
  }
}

class MockFailingLLMProvider implements LLMProvider {
  readonly id = 'copilot';
  readonly name = 'Mock Copilot';
  onRequestErrorCalls: Array<{ error: unknown; context: unknown }> = [];

  async getModel(modelId: string): Promise<unknown> {
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'copilot',
      modelId,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Not implemented');
      },
      doStream: async () => {
        const error = Object.assign(new Error('401 expired token'), { status: 401 });
        throw error;
      },
    };

    return model;
  }

  onRequestError(error: unknown, context?: unknown): void {
    this.onRequestErrorCalls.push({ error, context });
  }
}

class CapturingCopilotTitleProvider implements LLMProvider {
  readonly id = 'copilot';
  readonly name = 'Mock Copilot';

  async getModel(modelId: string): Promise<unknown> {
    return createCopilotResponsesModel({
      baseURL: 'https://example.invalid',
      apiKey: 'test',
      modelId,
      headers: {},
    });
  }
}

suite('sessionTitle', () => {
  test('generates a cleaned single-line title', async () => {
    const llm = new MockStreamLLMProvider('Debugging snake movement\nExtra line');
    const title = await generateSessionTitle({
      llm,
      modelId: 'mock-model',
      message: 'make snake move',
    });

    assert.strictEqual(title, 'Debugging snake movement');
  });

  test('truncates long titles', async () => {
    const llm = new MockStreamLLMProvider('A'.repeat(200));
    const title = await generateSessionTitle({
      llm,
      modelId: 'mock-model',
      message: 'x',
      maxChars: 50,
    });

    assert.ok(title);
    assert.ok(title!.length <= 50);
    assert.ok(title!.endsWith('...'));
  });

  test('forces temperature=1 for fixed-temperature models', async () => {
    const llm = new MockStreamLLMProvider('Title');
    const title = await generateSessionTitle({
      llm,
      modelId: 'gpt-5.3-codex',
      message: 'x',
    });

    assert.strictEqual(title, 'Title');
    assert.strictEqual(llm.lastTemperature, 1);
  });

  test('extracts title text when Responses stream only sends output_text.done', async () => {
    const llm = new MockResponsesLLMProvider([
      {
        type: 'response.output_text.done',
        item_id: 'text_1',
        output_index: 0,
        text: 'Debugging Copilot session titles',
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          model: 'gpt-5.4',
          usage: {
            input_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ]);

    const title = await generateSessionTitle({
      llm,
      modelId: 'gpt-5.4',
      message: 'the session title no longer summarised when using Copilot GPT-5.4',
    });

    assert.strictEqual(title, 'Debugging Copilot session titles');
  });

  test('extracts title text when Responses stream only sends content_part.done', async () => {
    const llm = new MockResponsesLLMProvider([
      {
        type: 'response.content_part.done',
        item_id: 'msg_1',
        output_index: 0,
        part: {
          type: 'output_text',
          text: 'Fixing session title fallback',
        },
      },
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
    ]);

    const title = await generateSessionTitle({
      llm,
      modelId: 'gpt-5.4',
      message: 'copilot responses only returns the fallback session title',
    });

    assert.strictEqual(title, 'Fixing session title fallback');
  });

  test('extracts title text when Responses stream only sends output_item.done (text parts)', async () => {
    const llm = new MockResponsesLLMProvider([
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_1',
          content: [
            {
              type: 'text',
              text: 'Naming Copilot sessions',
            },
          ],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_4',
          model: 'gpt-5.4',
          usage: {
            input_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ]);

    const title = await generateSessionTitle({
      llm,
      modelId: 'gpt-5.4',
      message: 'copilot responses returns message content parts as `text` instead of `output_text`',
    });

    assert.strictEqual(title, 'Naming Copilot sessions');
  });

  test('extracts title text when Responses stream only sends output_item.done (output_text parts)', async () => {
    const llm = new MockResponsesLLMProvider([
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_2',
          content: [
            {
              type: 'output_text',
              text: 'Summarizing Responses output_item.done',
            },
          ],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_5',
          model: 'gpt-5.4',
          usage: {
            input_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ]);

    const title = await generateSessionTitle({
      llm,
      modelId: 'gpt-5.4',
      message: 'copilot responses emits output_item.done content parts as `output_text`',
    });

    assert.strictEqual(title, 'Summarizing Responses output_item.done');
  });

  test('extracts title text when output_item.done omits output_index (mixed text parts)', async () => {
    const llm = new MockResponsesLLMProvider([
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          id: 'msg_3',
          content: [
            {
              type: 'text',
              text: 'Naming ',
            },
            {
              type: 'output_text',
              text: 'Copilot sessions',
            },
          ],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_6',
          model: 'gpt-5.4',
          usage: {
            input_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ]);

    const title = await generateSessionTitle({
      llm,
      modelId: 'gpt-5.4',
      message: 'copilot responses output_item.done may not include output_index',
    });

    assert.strictEqual(title, 'Naming Copilot sessions');
  });

  test('notifies provider request-error hook when title generation fails', async () => {
    const llm = new MockFailingLLMProvider();

    await assert.rejects(() =>
      generateSessionTitle({
        llm,
        modelId: 'gpt-5.4',
        message: 'copilot title request failed',
      }),
    );

    assert.strictEqual(llm.onRequestErrorCalls.length, 1);
    assert.deepStrictEqual(llm.onRequestErrorCalls[0]?.context, {
      modelId: 'gpt-5.4',
      mode: 'build',
    });
  });

  test('uses top-level instructions for Copilot GPT-5.4 title generation', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | undefined;

    try {
      globalThis.fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(
          encodeSseEvents([
            {
              type: 'response.output_text.done',
              item_id: 'text_1',
              output_index: 0,
              text: 'Copilot title via instructions',
            },
            {
              type: 'response.completed',
              response: {
                id: 'resp_3',
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

      const llm = new CapturingCopilotTitleProvider();
      const title = await generateSessionTitle({
        llm,
        modelId: 'gpt-5.4',
        message: 'copilot title should use top-level instructions',
      });

      assert.strictEqual(title, 'Copilot title via instructions');
      assert.ok(String(capturedBody?.instructions || '').includes('You are a title generator.'));
      const input = (capturedBody?.input ?? []) as Array<Record<string, unknown>>;
      assert.deepStrictEqual(
        input.map((entry) => entry.role ?? entry.type),
        ['user', 'user'],
      );
      assert.ok(
        input.every((entry) => entry.role !== 'system'),
        'copilot title generation should not send the title prompt as a system input item',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
