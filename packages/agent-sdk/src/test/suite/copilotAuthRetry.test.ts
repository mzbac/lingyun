import * as assert from 'assert';

import { simulateReadableStream } from 'ai/test';
import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3StreamResult, LanguageModelV3Usage } from '@ai-sdk/provider';

import { LingyunAgent, LingyunSession, ToolRegistry, type LLMProvider } from '../../index.js';

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

class FlakyCodexSubscriptionProvider implements LLMProvider {
  readonly id = 'codexSubscription';
  readonly name = 'ChatGPT Codex Subscription (Mock)';

  streamCalls = 0;
  getModelCalls = 0;
  onRequestErrorCalls = 0;

  async getModel(modelId: string): Promise<unknown> {
    this.getModelCalls += 1;

    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'codexSubscription',
      modelId,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Not implemented');
      },
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        this.streamCalls += 1;

        if (this.streamCalls === 1) {
          const err: any = new Error('ChatGPT Codex Subscription request failed');
          err.statusCode = 401;
          err.url = 'https://chatgpt.com/backend-api/codex/responses';
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

  getAuthRetryLabel(error: unknown): string | undefined {
    return (error as any)?.statusCode === 401 ? 'ChatGPT Codex Subscription' : undefined;
  }

  onRequestError(): void {
    this.onRequestErrorCalls += 1;
  }
}

class FlakyModelLoadAuthProvider implements LLMProvider {
  readonly id = 'codexSubscription';
  readonly name = 'ChatGPT Codex Subscription (Mock)';

  streamCalls = 0;
  getModelCalls = 0;
  onRequestErrorCalls = 0;

  async getModel(modelId: string): Promise<unknown> {
    this.getModelCalls += 1;

    if (this.getModelCalls === 1) {
      const err: any = new Error('Token refresh failed');
      err.statusCode = 401;
      err.url = 'https://auth.openai.com/oauth/token';
      throw err;
    }

    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'codexSubscription',
      modelId,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Not implemented');
      },
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        this.streamCalls += 1;

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

  getAuthRetryLabel(error: unknown): string | undefined {
    return (error as any)?.statusCode === 401 ? 'ChatGPT Codex Subscription' : undefined;
  }

  onRequestError(): void {
    this.onRequestErrorCalls += 1;
  }
}

suite('Provider auth retry', () => {
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

  test('uses provider-declared auth retry for Codex subscription', async () => {
    const llm = new FlakyCodexSubscriptionProvider();
    const registry = new ToolRegistry();

    const agent = new LingyunAgent(llm, { model: 'gpt-5.4', maxRetries: 0 }, registry, { allowExternalPaths: false });
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

  test('uses provider-declared auth retry when model acquisition fails', async () => {
    const llm = new FlakyModelLoadAuthProvider();
    const registry = new ToolRegistry();

    const agent = new LingyunAgent(llm, { model: 'gpt-5.4', maxRetries: 0 }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'ok');
    assert.strictEqual(llm.getModelCalls, 2, 'expected model acquisition to be retried after auth refresh');
    assert.strictEqual(llm.onRequestErrorCalls, 1, 'expected onRequestError to run before retrying model acquisition');
    assert.strictEqual(llm.streamCalls, 1, 'expected the request to stream once after model acquisition recovers');
  });
});
