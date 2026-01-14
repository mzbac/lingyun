import * as assert from 'assert';
import type { ToolResult } from '../../types.js';

import { OpenAICompatibleProvider } from '../../llm/openaiCompatible.js';
import { ToolRegistry } from '../../tools/registry.js';
import { LingyunAgent, LingyunSession } from '../../agent/agent.js';
import { loadLingyunE2EConfig, type LingyunE2EConfig } from './e2eEnv.js';

suite('LingYun Agent SDK (E2E)', function () {
  let cfg: LingyunE2EConfig | null = null;

  suiteSetup(async function () {
    cfg = await loadLingyunE2EConfig();
    if (!cfg) this.skip();
    this.timeout(cfg.timeoutMs + 30_000);
  });

  test('streams a small response', async function () {
    assert.ok(cfg);
    this.timeout(cfg.timeoutMs + 30_000);

    const llm = new OpenAICompatibleProvider({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      defaultModelId: cfg.model,
      timeoutMs: cfg.timeoutMs,
    });

    try {
      const registry = new ToolRegistry();
      const agent = new LingyunAgent(
        llm,
        { model: cfg.model, maxRetries: 1, maxOutputTokens: Math.min(cfg.maxOutputTokens, 2048) },
        registry,
        { allowExternalPaths: false, workspaceRoot: process.cwd() }
      );

      const session = new LingyunSession({ sessionId: 'sdk-e2e' });
      const run = agent.run({
        session,
        input: 'Reply with exactly one word: ok',
      });

      let tokenCount = 0;
      for await (const ev of run.events) {
        if (ev.type === 'assistant_token') tokenCount += 1;
      }

      const result = await run.done;
      assert.ok(result.text.trim().length > 0);
      assert.ok(tokenCount > 0, 'expected streaming tokens');
    } finally {
      llm.dispose();
    }
  });

  test('tool calls work', async function () {
    assert.ok(cfg);
    if (!cfg.enableToolCalls) this.skip();
    this.timeout(cfg.timeoutMs + 30_000);

    const llm = new OpenAICompatibleProvider({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      defaultModelId: cfg.model,
      timeoutMs: cfg.timeoutMs,
    });

    try {
      const registry = new ToolRegistry();
      registry.registerTool(
        {
          id: 'test.echo',
          name: 'Echo',
          description: 'Echo back the message argument',
          parameters: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
          execution: { type: 'function', handler: 'test.echo' },
        },
        async (args): Promise<ToolResult> => {
          return { success: true, data: `Echo: ${String(args.message)}` };
        }
      );

      const agent = new LingyunAgent(llm, { model: cfg.model, maxRetries: 1, maxOutputTokens: 512 }, registry, {
        allowExternalPaths: false,
        workspaceRoot: process.cwd(),
      });

      const session = new LingyunSession({ sessionId: 'sdk-e2e' });

      let sawToolCall = false;
      let sawToolResult = false;

      const run = agent.run({
        session,
        input:
          'You MUST call the tool test.echo exactly once with {\"message\":\"ping\"} before responding.\n' +
          'After the tool result, reply with exactly: DONE',
        callbacks: {
          onToolCall: () => {
            sawToolCall = true;
          },
          onToolResult: () => {
            sawToolResult = true;
          },
        },
      });

      for await (const _ev of run.events) {
        // drain
      }

      const result = await run.done;
      assert.ok(sawToolCall, 'expected tool call');
      assert.ok(sawToolResult, 'expected tool result');
      assert.strictEqual(result.text.trim(), 'DONE');
    } finally {
      llm.dispose();
    }
  });

  test('streams a large response without timing out', async function () {
    assert.ok(cfg);
    this.timeout(cfg.timeoutMs + 30_000);

    const llm = new OpenAICompatibleProvider({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      defaultModelId: cfg.model,
      timeoutMs: cfg.timeoutMs,
    });

    try {
      const registry = new ToolRegistry();
      const agent = new LingyunAgent(llm, { model: cfg.model, maxRetries: 1, maxOutputTokens: cfg.maxOutputTokens }, registry, {
        allowExternalPaths: false,
        workspaceRoot: process.cwd(),
      });

      const session = new LingyunSession({ sessionId: 'sdk-e2e' });

      const targetChars = cfg.largeMinChars;
      const run = agent.run({
        session,
        input:
          `Generate a plain-text response of at least ${targetChars} characters.\n` +
          `Do NOT use markdown. Do NOT include code fences. Do NOT include <think>.\n` +
          `Output only the content (no preamble).\n` +
          `Hint: repeat "0123456789" many times until you exceed ${targetChars} characters.`,
      });

      for await (const _ev of run.events) {
        // drain
      }

      const result = await run.done;
      assert.ok(result.text.length >= targetChars, `expected >= ${targetChars} chars, got ${result.text.length}`);
    } finally {
      llm.dispose();
    }
  });
});
