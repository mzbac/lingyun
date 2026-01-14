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

class MockStreamLLMProvider implements LLMProvider {
  readonly id = 'mock';
  readonly name = 'Mock';

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
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
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
});

