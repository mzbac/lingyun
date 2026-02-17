import * as assert from 'assert';
import { simulateReadableStream } from 'ai/test';
import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider';

import { normalizeResponsesStreamModel } from '../../core/utils/normalizeResponsesStream';

function usage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
    raw: {},
  };
}

function finishPart(): LanguageModelV3StreamPart {
  return {
    type: 'finish' as const,
    usage: usage(),
    finishReason: { unified: 'stop', raw: 'stop' },
  };
}

function makeModel(chunks: LanguageModelV3StreamPart[]): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test',
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: 'text', text: '' } as any],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: usage(),
      warnings: [],
      providerMetadata: {},
      response: { id: 'resp', modelId: 'test', timestamp: new Date() },
    }),
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({ chunks }),
    }),
  };
}

function makeModelThatErrorsAfter(
  chunksBeforeError: LanguageModelV3StreamPart[],
  error: Error,
): LanguageModelV3 {
  const base = makeModel([]);
  let index = 0;
  return {
    ...base,
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        pull(controller) {
          if (index < chunksBeforeError.length) {
            controller.enqueue(chunksBeforeError[index]!);
            index += 1;
            return;
          }
          if (index === chunksBeforeError.length) {
            index += 1;
            controller.error(error);
            return;
          }
          controller.close();
        },
      }),
    }),
  };
}

async function readAll(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const reader = stream.getReader();
  const parts: LanguageModelV3StreamPart[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  return parts;
}

suite('normalizeResponsesStreamModel', () => {
  test('inserts text-start before text-delta when missing', async () => {
    const raw = makeModel([
      { type: 'text-delta', id: 't0', delta: 'A' },
      { type: 'text-end', id: 't0' },
      finishPart(),
    ]);
    const normalized = normalizeResponsesStreamModel(raw);
    const result = await normalized.doStream({} as any);
    const parts = await readAll(result.stream);

    assert.deepStrictEqual(
      parts.map(p => p.type),
      ['text-start', 'text-delta', 'text-end', 'finish'],
    );
    assert.deepStrictEqual(parts[0], { type: 'text-start', id: 't0' });
  });

  test('drops duplicate text-start for the same id', async () => {
    const raw = makeModel([
      { type: 'text-delta', id: 't0', delta: 'A' },
      { type: 'text-start', id: 't0' }, // out-of-order duplicate
      { type: 'text-delta', id: 't0', delta: 'B' },
      { type: 'text-end', id: 't0' },
      finishPart(),
    ]);
    const normalized = normalizeResponsesStreamModel(raw);
    const result = await normalized.doStream({} as any);
    const parts = await readAll(result.stream);

    const starts = parts.filter(p => p.type === 'text-start');
    assert.strictEqual(starts.length, 1);
    assert.deepStrictEqual(
      parts.map(p => p.type),
      ['text-start', 'text-delta', 'text-delta', 'text-end', 'finish'],
    );
  });

  test('flushes dangling text parts before finish', async () => {
    const raw = makeModel([
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'A' },
      finishPart(), // missing text-end
    ]);
    const normalized = normalizeResponsesStreamModel(raw);
    const result = await normalized.doStream({} as any);
    const parts = await readAll(result.stream);

    assert.deepStrictEqual(
      parts.map(p => p.type),
      ['text-start', 'text-delta', 'text-end', 'finish'],
    );
  });

  test('recovers summaryParts parser error before finish', async () => {
    const raw = makeModelThatErrorsAfter(
      [{ type: 'text-delta', id: 't0', delta: 'A' }],
      new TypeError("Cannot read properties of undefined (reading 'summaryParts')"),
    );
    const normalized = normalizeResponsesStreamModel(raw);
    const result = await normalized.doStream({} as any);
    const parts = await readAll(result.stream);

    assert.deepStrictEqual(
      parts.map(p => p.type),
      ['text-start', 'text-delta', 'text-end', 'finish'],
    );
  });

  test('swallows parser error emitted after finish', async () => {
    const raw = makeModelThatErrorsAfter(
      [{ type: 'text-delta', id: 't0', delta: 'A' }, finishPart()],
      new TypeError("Cannot read properties of undefined (reading 'summaryParts')"),
    );
    const normalized = normalizeResponsesStreamModel(raw);
    const result = await normalized.doStream({} as any);
    const parts = await readAll(result.stream);

    assert.deepStrictEqual(
      parts.map(p => p.type),
      ['text-start', 'text-delta', 'text-end', 'finish'],
    );
  });
});
