import * as assert from 'assert';
import http from 'node:http';
import { Agent, fetch as undiciFetch } from 'undici';

import { OpenAICompatibleProvider } from '../../providers/openaiCompatible';

suite('OpenAICompatibleProvider fetch', () => {
  test('uses chat model path for GPT-5 models', async () => {
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
      const model = await provider.getModel('gpt-5');

      assert.strictEqual(model, chatModel);
      assert.strictEqual(chatCalls, 1);
    } finally {
      provider.dispose();
    }
  });

  test('uses chat model path for GPT-5-mini', async () => {
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
      const model = await provider.getModel('gpt-5-mini');

      assert.strictEqual(model, chatModel);
      assert.strictEqual(chatCalls, 1);
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

  test('disables undici body timeout for streaming responses', async () => {
    const GAP_MS = 2000;
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

    const originalFetch = globalThis.fetch;
    const failingDispatcher = new Agent({ bodyTimeout: 500 });
    (globalThis as any).fetch = (input: any, init?: any) =>
      undiciFetch(input, { ...(init ?? {}), dispatcher: failingDispatcher } as any) as any;

    const provider = new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}` });

    try {
      await assert.rejects(
        async () => {
          const response = await fetch(url);
          await response.text();
        },
        (err: any) => err?.cause?.code === 'UND_ERR_BODY_TIMEOUT'
      );

      const response = await (provider as any).fetchFn(url);
      const text = await response.text();
      assert.ok(text.includes('first'));
      assert.ok(text.includes('second'));
    } finally {
      (globalThis as any).fetch = originalFetch;
      provider.dispose();
      await failingDispatcher.close().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
