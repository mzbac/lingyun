import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

import {
  getBuiltinTools,
  getSkillIndex,
  loadSkillFile,
  LingyunAgent,
  LingyunSession,
  PluginManager,
  ToolRegistry,
  type AgentHistoryMessage,
  type LLMProvider,
  type ToolDefinition,
  type ToolResult,
} from '@kooka/agent-sdk';

function getMessageText(message: AgentHistoryMessage): string {
  return message.parts
    .filter((p: any): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p: { type: 'text'; text: string }) => p.text)
    .join('');
}

const bashTool = getBuiltinTools().find((t) => t.tool.id === 'bash')!.tool;

type ScriptedResponse =
  | { kind: 'text'; content: string; usage?: UsageOverride }
  | {
      kind: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
      usage?: UsageOverride;
      finishReason?: 'tool-calls' | 'stop' | 'other';
    }
  | { kind: 'stream'; chunks: LanguageModelV3StreamPart[] };

type UsageOverride = {
  inputTotal?: number;
  inputNoCache?: number;
  cacheRead?: number;
  cacheWrite?: number;
  outputTotal?: number;
};

function usage(override?: UsageOverride): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
    raw: {},
    ...(override
      ? {
          inputTokens: {
            total: override.inputTotal ?? ((override.inputNoCache ?? 0) + (override.cacheRead ?? 0)),
            noCache: override.inputNoCache ?? 0,
            cacheRead: override.cacheRead ?? 0,
            cacheWrite: override.cacheWrite ?? 0,
          },
          outputTokens: { total: override.outputTotal ?? 0, text: 0, reasoning: 0 },
        }
      : {}),
  };
}

function streamPartsForText(text: string, override?: UsageOverride): LanguageModelV3StreamPart[] {
  const id = 'text_0';
  return [
    { type: 'text-start' as const, id },
    ...Array.from(text).map((ch) => ({ type: 'text-delta' as const, id, delta: ch })),
    { type: 'text-end' as const, id },
    { type: 'finish' as const, usage: usage(override), finishReason: { unified: 'stop', raw: 'stop' } },
  ];
}

function streamPartsForToolCall(call: Extract<ScriptedResponse, { kind: 'tool-call' }>): LanguageModelV3StreamPart[] {
  const finish = call.finishReason ?? 'tool-calls';
  return [
    { type: 'tool-call' as const, toolCallId: call.toolCallId, toolName: call.toolName, input: JSON.stringify(call.input) },
    { type: 'finish' as const, usage: usage(call.usage), finishReason: { unified: finish as any, raw: finish as any } },
  ];
}

function generateResultForResponse(response: ScriptedResponse): LanguageModelV3GenerateResult {
  if (response.kind === 'stream') {
    return {
      content: [{ type: 'text', text: '' } as any],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: usage(),
      warnings: [],
      providerMetadata: {},
      response: { id: 'resp', modelId: 'mock', timestamp: new Date() },
    };
  }

  if (response.kind === 'tool-call') {
    return {
      content: [{ type: 'tool-call', toolCallId: response.toolCallId, toolName: response.toolName, input: JSON.stringify(response.input) } as any],
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
      usage: usage(),
      warnings: [],
      providerMetadata: {},
      response: { id: 'resp', modelId: 'mock', timestamp: new Date() },
    };
  }

  return {
    content: [{ type: 'text', text: response.content } as any],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: usage(),
    warnings: [],
    providerMetadata: {},
    response: { id: 'resp', modelId: 'mock', timestamp: new Date() },
  };
}

class MockLLMProvider implements LLMProvider {
  readonly id = 'mock';
  readonly name = 'Mock LLM';

  private responses: ScriptedResponse[] = [];
  callCount = 0;
  lastPrompt: unknown;

  queueResponse(response: ScriptedResponse): void {
    this.responses.push(response);
  }

  private nextResponse(): ScriptedResponse {
    return this.responses.shift() ?? { kind: 'text', content: 'No response configured' };
  }

  async getModel(modelId: string): Promise<unknown> {
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId,
      supportedUrls: {},
      doGenerate: async (options: any) => {
        this.callCount++;
        this.lastPrompt = options?.prompt;
        const response = this.nextResponse();
        return generateResultForResponse(response);
      },
      doStream: async (options: any): Promise<LanguageModelV3StreamResult> => {
        this.callCount++;
        this.lastPrompt = options?.prompt;

        const response = this.nextResponse();
        const chunks =
          response.kind === 'tool-call'
            ? streamPartsForToolCall(response)
            : response.kind === 'stream'
              ? response.chunks
              : streamPartsForText(response.content, response.usage);

        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({ chunks }),
        };
      },
    };

    return model;
  }
}

suite('LingYun Agent SDK', () => {
  test('runs a tool-call loop and stores tool parts', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    registry.registerTool(
      {
        id: 'test_echo',
        name: 'Echo',
        description: 'Echoes back input',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        execution: { type: 'function', handler: 'test_echo' },
      },
      async (args): Promise<ToolResult> => ({
        success: true,
        data: `Echo: ${String(args.message)}`,
      })
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'test_echo',
      input: { message: 'hi' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'say hi' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'done');
    assert.strictEqual(result.session, session);

    const history = session.getHistory();
    assert.strictEqual(history[0]?.role, 'user');
    assert.ok(history.some((m) => m.role === 'assistant'), 'expected at least one assistant message');

    const toolAssistant = history.find(
      (m) => m.role === 'assistant' && m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_1')
    )!;
    const toolPart = toolAssistant.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_1') as any;
    assert.ok(toolPart, 'expected dynamic-tool part');
    assert.strictEqual(toolPart.toolName, 'test_echo');
    assert.strictEqual(toolPart.state, 'output-available');
    assert.strictEqual(toolPart.output?.success, true);
    assert.ok(String(toolPart.output?.data).includes('Echo: hi'));

    const finalAssistant = [...history].reverse().find((m) => m.role === 'assistant' && getMessageText(m).trim())!;
    assert.strictEqual(getMessageText(finalAssistant).trim(), 'done');
  });

  test('prompt - injects external path access reminder', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({ kind: 'text', content: 'ok' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: true });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    const prompt = JSON.stringify(llm.lastPrompt ?? '');
    assert.ok(prompt.includes('<system-reminder>'), 'system-reminder tag should be present in prompt');
    assert.ok(prompt.includes('External paths are enabled'), 'external path reminder should reflect setting');
  });

  test('file handles - glob assigns fileId and read resolves it', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    let readArgs: any;

    registry.registerTool(
      {
        id: 'glob',
        name: 'Glob Files',
        description: 'Find files matching a glob pattern',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } },
          required: ['pattern'],
        },
        execution: { type: 'function', handler: 'test.glob' },
      },
      async () => ({
        success: true,
        data: {
          files: ['src/foo.ts', 'src/bar.ts'],
          truncated: false,
        },
      })
    );

    registry.registerTool(
      {
        id: 'read',
        name: 'Read File',
        description: 'Reads a file',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            filePath: { type: 'string' },
          },
          required: [],
        },
        execution: { type: 'function', handler: 'test.read' },
      },
      async (args): Promise<ToolResult> => {
        readArgs = args;
        return { success: true, data: 'ok' };
      }
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_glob',
      toolName: 'glob',
      input: { pattern: '**/*.ts' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_read',
      toolName: 'read',
      input: { fileId: 'F1' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'Done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'Use file handles' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(session.fileHandles?.byId?.F1, 'src/foo.ts');
    assert.strictEqual(readArgs?.filePath, 'src/foo.ts');
  });

  test('blocks shell tool when allowExternalPaths=false and command references /etc', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-'));
    try {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();

      let called = false;
      const bash: ToolDefinition = {
        id: 'bash',
        name: 'Run Command',
        description: 'Run a shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            workdir: { type: 'string' },
          },
          required: ['command'],
        },
        execution: { type: 'function', handler: 'test.bash' },
        metadata: {
          permission: 'bash',
          supportsExternalPaths: true,
          permissionPatterns: [
            { arg: 'command', kind: 'command' },
            { arg: 'workdir', kind: 'path' },
          ],
        },
      };

      registry.registerTool(bash, async () => {
        called = true;
        return { success: true, data: 'should-not-run' };
      });

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_etc',
        toolName: 'bash',
        input: { command: 'cat /etc/passwd' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot: tmp,
        allowExternalPaths: false,
      });
      const session = new LingyunSession();

      const run = agent.run({ session, input: 'try' });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'ok');
      assert.strictEqual(called, false, 'bash handler should not be invoked when blocked');

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');

      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_etc') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || toolPart.output?.data || '').includes('External paths are disabled'));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('plugin auto-discovery is disabled by default (opt-in)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-plugins-'));
    try {
      const pluginDir = path.join(tmp, '.lingyun', 'plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      const pluginPath = path.join(pluginDir, 'p1.js');
      await fs.writeFile(
        pluginPath,
        [
          "module.exports = {",
          "  tool: {",
          "    hello: {",
          "      description: 'hello tool',",
          "      parameters: { type: 'object', properties: {}, required: [] },",
          "      execute: async () => ({ success: true, data: 'ok' }),",
          "    }",
          "  }",
          "};",
          '',
        ].join('\n')
      );

      const pluginsDefault = new PluginManager({ workspaceRoot: tmp });
      const toolsDefault = await pluginsDefault.getPluginTools();
      assert.strictEqual(toolsDefault.length, 0);

      const pluginsEnabled = new PluginManager({ workspaceRoot: tmp, autoDiscover: true });
      const toolsEnabled = await pluginsEnabled.getPluginTools();
      assert.strictEqual(toolsEnabled.length, 1);
      assert.strictEqual(toolsEnabled[0]!.toolId, 'hello');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('rejects plugin tool id collisions across plugins', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-plugin-collision-'));
    try {
      const plugin1 = path.join(tmp, 'p1.js');
      const plugin2 = path.join(tmp, 'p2.js');

      const pluginBody = (label: string) =>
        [
          'module.exports = {',
          '  tool: {',
          '    collision: {',
          `      description: 'collision tool (${label})',`,
          "      parameters: { type: 'object', properties: {}, required: [] },",
          `      execute: async () => ({ success: true, data: '${label}' }),`,
          '    }',
          '  }',
          '};',
          '',
        ].join('\n');

      await fs.writeFile(plugin1, pluginBody('one'));
      await fs.writeFile(plugin2, pluginBody('two'));

      const plugins = new PluginManager({ workspaceRoot: tmp, plugins: [plugin1, plugin2], autoDiscover: false });
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { workspaceRoot: tmp, plugins });
      const session = new LingyunSession();

      const run = agent.run({ session, input: 'hi' });
      await assert.rejects(run.done, /Plugin tool id collision/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('discovers skills under ~/.codex/skills when allowExternalPaths=true', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skills-'));
    const skillBase = `lingyun-sdk-test-skill-${Date.now()}`;
    const skillDir = path.join(os.homedir(), '.codex', 'skills', skillBase);
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        ['---', 'name: sdk-test-skill', 'description: skill for sdk tests', '---', '', '# Hello', 'From skill'].join('\n')
      );

      const searchPath = `~/.codex/skills/${skillBase}`;

      const indexBlocked = await getSkillIndex({
        workspaceRoot,
        searchPaths: [searchPath],
        allowExternalPaths: false,
      });
      assert.strictEqual(indexBlocked.byName.has('sdk-test-skill'), false);
      assert.ok(indexBlocked.scannedDirs.some((d) => d.status === 'skipped_external'));

      const indexAllowed = await getSkillIndex({
        workspaceRoot,
        searchPaths: [searchPath],
        allowExternalPaths: true,
      });
      const skill = indexAllowed.byName.get('sdk-test-skill');
      assert.ok(skill, 'expected skill to be discovered');
      assert.strictEqual(skill!.source, 'external');

      const loaded = await loadSkillFile(skill!);
      assert.ok(loaded.content.includes('From skill'));
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(skillDir, { recursive: true, force: true });
    }
  });

  test('injects skill blocks before the user prompt and does not persist them', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skill-inject-'));
    const skillDir = path.join(workspaceRoot, '.lingyun', 'skills', 'ask');
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: ask-questions-if-underspecified',
          'description: Clarify requirements before implementing.',
          '---',
          '',
          '# Ask Questions If Underspecified',
          '',
          '- Ask 1-5 must-have questions first.',
        ].join('\n')
      );

      const llm = new MockLLMProvider();
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const registry = new ToolRegistry();
      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: false,
        skills: { enabled: true, paths: ['.lingyun/skills'] },
      });
      const session = new LingyunSession();

      const input = `SENTINEL_${Date.now()} use $ask-questions-if-underspecified`;
      const run = agent.run({ session, input });
      for await (const _event of run.events) {
        // drain
      }
      await run.done;

      const promptJson = JSON.stringify(llm.lastPrompt ?? '');
      const idxSkill = promptJson.lastIndexOf('<skill>');
      const idxInput = promptJson.lastIndexOf(input);
      assert.ok(idxSkill >= 0, 'expected <skill> block to be present in the prompt');
      assert.ok(idxInput >= 0, 'expected user input to be present in the prompt');
      assert.ok(idxInput > idxSkill, 'expected user input to appear after the injected <skill> block');

      const history = session.getHistory();
      assert.strictEqual(history.some((m) => m.role === 'user' && m.metadata?.skill), false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('requires approval for curl-like bash commands by default', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-bash-approve-'));
    try {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();

      let called = false;
      registry.registerTool(bashTool, async () => {
        called = true;
        return { success: true, data: 'should-not-run' };
      });

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_curl',
        toolName: 'bash',
        input: { command: 'curl https://example.com' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      let approvalCalls = 0;
      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { workspaceRoot: tmp });
      const session = new LingyunSession();

      const run = agent.run({
        session,
        input: 'try',
        callbacks: {
          onRequestApproval: async () => {
            approvalCalls += 1;
            return false;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'ok');
      assert.strictEqual(approvalCalls, 1);
      assert.strictEqual(called, false, 'bash handler should not be invoked when approval is rejected');

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');

      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_curl') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || '').includes('User rejected'));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
