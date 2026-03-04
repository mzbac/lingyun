import * as assert from 'assert';

import { simulateReadableStream } from 'ai/test';
import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3StreamResult, LanguageModelV3Usage } from '@ai-sdk/provider';

import { LingyunAgent, LingyunSession, ToolRegistry, type LLMProvider } from '@kooka/agent-sdk';

function usage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
    raw: {},
  };
}

class FlakyCopilotProvider implements LLMProvider {
  readonly id = 'copilot';
  readonly name = 'GitHub Copilot (Mock)';

  streamCalls = 0;
  getModelCalls = 0;
  onRequestErrorCalls = 0;

  async getModel(modelId: string): Promise<unknown> {
    this.getModelCalls += 1;

    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'copilot',
      modelId,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Not implemented');
      },
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        this.streamCalls += 1;

        if (this.streamCalls === 1) {
          const err: any = new Error('401 Unauthorized');
          err.statusCode = 401;
          err.url = 'https://api.githubcopilot.com/chat/completions';
          throw err;
        }

        const chunks: LanguageModelV3StreamPart[] = [
          { type: 'text-start', id: 't0' },
          { type: 'text-delta', id: 't0', delta: 'ok' },
          { type: 'text-end', id: 't0' },
          { type: 'finish', usage: usage(), finishReason: { unified: 'stop', raw: 'stop' } },
        ];

        return { stream: simulateReadableStream<LanguageModelV3StreamPart>({ chunks }) };
      },
    };

    return model;
  }

  onRequestError(): void {
    this.onRequestErrorCalls += 1;
  }
}

suite('Copilot auth retry', () => {
  test('retries once on 401 even when maxRetries=0', async () => {
    const llm = new FlakyCopilotProvider();
    const registry = new ToolRegistry();

    const agent = new LingyunAgent(llm, { model: 'mock-model', maxRetries: 0 }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'ok');
    assert.strictEqual(llm.streamCalls, 2, 'expected the request to be re-attempted after auth refresh');
    assert.strictEqual(llm.onRequestErrorCalls, 1, 'expected onRequestError to run before retrying');
    assert.strictEqual(llm.getModelCalls, 2, 'expected model to be recreated to pick up a fresh auth token');
  });
});

