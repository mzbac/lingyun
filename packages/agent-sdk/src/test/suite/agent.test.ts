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

function isSymlinkUnsupportedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS' || code === 'UNKNOWN';
}

const bashTool = getBuiltinTools().find((t) => t.tool.id === 'bash')!.tool;

function registerTaskTool(registry: ToolRegistry): void {
  const task = getBuiltinTools({ skills: { enabled: false } }).find((t) => t.tool.id === 'task');
  assert.ok(task, 'expected builtin task tool to exist');
  registry.registerTool(task.tool, task.handler);
}

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
  readonly id: string = 'mock';
  readonly name: string = 'Mock LLM';

  private responses: ScriptedResponse[] = [];
  private unavailableModels = new Set<string>();
  modelCalls: string[] = [];
  callCount = 0;
  lastPrompt: unknown;

  queueResponse(response: ScriptedResponse): void {
    this.responses.push(response);
  }

  markModelUnavailable(modelId: string): void {
    this.unavailableModels.add(modelId);
  }

  private nextResponse(): ScriptedResponse {
    return this.responses.shift() ?? { kind: 'text', content: 'No response configured' };
  }

  async getModel(modelId: string): Promise<unknown> {
    this.modelCalls.push(modelId);
    if (this.unavailableModels.has(modelId)) {
      throw new Error(`model unavailable: ${modelId}`);
    }

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

class MockOpenAICompatibleProvider extends MockLLMProvider {
  override readonly id = 'openaiCompatible';
  override readonly name = 'OpenAI-Compatible';
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

  test('prompt - replays reasoning_content + raw assistant text for openaiCompatible providers', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({
      kind: 'text',
      content: '<think>hidden reasoning</think> Hello<tool_call>{}</tool_call>World',
    });
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    for await (const _event of agent.run({ session, input: 'hi' }).events) {
      // drain
    }
    await agent.run({ session, input: 'follow up' }).done;

    const prompt = llm.lastPrompt as any[];
    const assistant = prompt.find((msg) => msg?.role === 'assistant');
    assert.ok(assistant, 'expected assistant message in prompt');
    assert.strictEqual(assistant.providerOptions?.openaiCompatible?.reasoning_content, 'hidden reasoning');
    assert.ok(Array.isArray(assistant.content), 'expected multipart assistant content');
    assert.strictEqual(
      (assistant.content as any[]).some((part) => part?.type === 'reasoning'),
      false,
      'reasoning parts should be lifted to reasoning_content',
    );
    const assistantText = (assistant.content as any[])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('');
    assert.strictEqual(assistantText, ' Hello<tool_call>{}</tool_call>World');
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

  test('blocks shell tool when allowExternalPaths=false and command references env-expanded external path', async () => {
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
        execution: { type: 'function', handler: 'test.bash.env' },
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
        toolCallId: 'call_home_env',
        toolName: 'bash',
        input: { command: 'cat $HOME/.ssh/id_rsa' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot: tmp,
        allowExternalPaths: false,
      });
      const session = new LingyunSession();

      const run = agent.run({ session, input: 'try env path' });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'ok');
      assert.strictEqual(called, false, 'bash handler should not be invoked when blocked');

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');

      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_home_env') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || toolPart.output?.data || '').includes('External paths are disabled'));
      const blockedPaths = Array.isArray(toolPart.output?.metadata?.blockedPaths)
        ? (toolPart.output?.metadata?.blockedPaths as unknown[])
        : [];
      assert.ok(
        blockedPaths.some((p: unknown) => {
          const value = String(p || '');
          return value.includes('$HOME/.ssh/id_rsa') || value.endsWith('/.ssh/id_rsa') || value.endsWith('\\.ssh\\id_rsa');
        }),
        'blocked paths should include the env-expanded sensitive path',
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('blocks read tool when allowExternalPaths=false and filePath traverses a workspace symlink', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-workspace-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-outside-'));
    const linkPath = path.join(workspaceRoot, 'linked-outside');
    try {
      await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'secret');
      try {
        await fs.symlink(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (isSymlinkUnsupportedError(error)) {
          assert.ok(true, `symlink unsupported in this environment: ${String(error)}`);
          return;
        }
        throw error;
      }

      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      const readBuiltin = getBuiltinTools().find((t) => t.tool.id === 'read');
      assert.ok(readBuiltin, 'expected builtin read tool');
      registry.registerTool(readBuiltin!.tool, readBuiltin!.handler);

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_symlink_read',
        toolName: 'read',
        input: { filePath: path.join(linkPath, 'secret.txt') },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: false,
      });
      const session = new LingyunSession();
      const run = agent.run({ session, input: 'read through symlink' });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;
      assert.strictEqual(result.text, 'ok');

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');
      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_symlink_read') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked symlink call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || toolPart.output?.data || '').includes('External paths are disabled'));
    } finally {
      await fs.rm(linkPath, { recursive: true, force: true });
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
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

  test('task tool spawns a subagent and returns child session metadata (without persisting it in parent history)', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task',
      toolName: 'task',
      input: {
        description: 'Explore task',
        prompt: 'Return a short answer.',
        subagent_type: 'general',
        session_id: 'child-1',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'subagent answer' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent done' }); // parent after tool result

    let taskResult: ToolResult | undefined;

    const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const run = agent.run({
      session,
      input: 'run task',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') taskResult = result;
        },
      },
    });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'parent done');
    assert.ok(taskResult, 'expected task tool result');
    assert.strictEqual(taskResult!.success, true);

    const meta = taskResult!.metadata as any;
    assert.ok(meta?.task, 'expected metadata.task');
    assert.ok(meta?.childSession, 'expected metadata.childSession');
    assert.strictEqual(meta.task.session_id, 'child-1');
    assert.strictEqual(meta.task.parent_session_id, 'parent-1');
    assert.strictEqual(meta.task.subagent_type, 'general');
    assert.strictEqual(meta.task.model_id, 'parent-model');
    assert.strictEqual(meta.childSession.sessionId, 'child-1');
    assert.strictEqual(meta.childSession.parentSessionId, 'parent-1');
    assert.strictEqual(meta.childSession.subagentType, 'general');
    assert.strictEqual(meta.childSession.modelId, 'parent-model');

    const history = session.getHistory();
    const assistant = history.find((m) => m.role === 'assistant');
    assert.ok(assistant, 'expected assistant message');

    const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_task') as any;
    assert.ok(toolPart, 'expected task dynamic-tool part');
    assert.strictEqual(toolPart.output?.success, true);
    assert.ok(toolPart.output?.metadata, 'expected persisted tool output metadata');
    assert.ok(!('childSession' in toolPart.output.metadata), 'childSession should not be persisted in parent history');
    assert.ok(!('task' in toolPart.output.metadata), 'task metadata should not be persisted in parent history');
  });

  test('task tool ignores invalid session_id and generates a safe id', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task',
      toolName: 'task',
      input: {
        description: 'Explore task',
        prompt: 'Return a short answer.',
        subagent_type: 'general',
        session_id: '../evil',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'subagent answer' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent done' }); // parent after tool result

    let taskResult: ToolResult | undefined;

    const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const run = agent.run({
      session,
      input: 'run task',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') taskResult = result;
        },
      },
    });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'parent done');
    assert.ok(taskResult, 'expected task tool result');
    assert.strictEqual(taskResult!.success, true);

    const meta = taskResult!.metadata as any;
    assert.ok(meta?.task, 'expected metadata.task');
    assert.ok(meta?.childSession, 'expected metadata.childSession');

    const childId = String(meta.task.session_id || '');
    assert.ok(childId, 'expected a generated child session id');
    assert.notStrictEqual(childId, '../evil');
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(childId), 'expected session_id to be filename-safe');
    assert.strictEqual(meta.childSession.sessionId, childId);
  });

  test('task tool caps the in-memory taskSessions map', async function () {
    this.timeout(10_000);

    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    const runs = 2;
    const perRun = 30; // maxIterations is 50; keep each run under the limit.
    let counter = 0;

    for (let run = 1; run <= runs; run++) {
      for (let i = 1; i <= perRun; i++) {
        counter += 1;
        llm.queueResponse({
          kind: 'tool-call',
          toolCallId: `call_task_${counter}`,
          toolName: 'task',
          input: {
            description: `Task ${counter}`,
            prompt: 'Return ok.',
            subagent_type: 'general',
            session_id: `sess-${counter}`,
          },
          finishReason: 'tool-calls',
        });
        llm.queueResponse({ kind: 'text', content: 'ok' }); // subagent
      }
      llm.queueResponse({ kind: 'text', content: `done ${run}` }); // parent
    }

    const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry);
    for (let run = 1; run <= runs; run++) {
      const session = new LingyunSession({ sessionId: `parent-${run}` });
      const exec = agent.run({ session, input: `many tasks ${run}` });
      for await (const _event of exec.events) {
        // drain
      }
      await exec.done;
    }

    const taskSessions = (agent as any).taskSessions as Map<string, unknown>;
    assert.ok(taskSessions, 'expected taskSessions to exist');
    assert.ok(taskSessions.size <= 50, `expected taskSessions size <= 50, got ${String(taskSessions.size)}`);
    assert.ok(taskSessions.has('sess-60'), 'expected newest session to be retained');
    assert.ok(!taskSessions.has('sess-1'), 'expected oldest session to be evicted');
  });

  test('task tool uses subagentModel override and remembers model per session_id', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task_1',
      toolName: 'task',
      input: {
        description: 'Run with override',
        prompt: 'Return ok.',
        subagent_type: 'general',
        session_id: 'task-sess',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'child ok 1' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent ok 1' }); // parent
    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task_2',
      toolName: 'task',
      input: {
        description: 'Continue with same session',
        prompt: 'Return ok again.',
        subagent_type: 'general',
        session_id: 'task-sess',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'child ok 2' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent ok 2' }); // parent

    const agent = new LingyunAgent(llm, { model: 'parent-model', subagentModel: 'child-model-a' }, registry);
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const seen: ToolResult[] = [];
    const run1 = agent.run({
      session,
      input: 'first',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') seen.push(result);
        },
      },
    });
    for await (const _event of run1.events) {
      // drain
    }
    await run1.done;

    agent.updateConfig({ subagentModel: 'child-model-b' });

    const run2 = agent.run({
      session,
      input: 'second',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') seen.push(result);
        },
      },
    });
    for await (const _event of run2.events) {
      // drain
    }
    await run2.done;

    assert.strictEqual(seen.length, 2, 'expected two task results');
    assert.strictEqual((seen[0]!.metadata as any)?.task?.model_id, 'child-model-a');
    assert.strictEqual((seen[1]!.metadata as any)?.task?.model_id, 'child-model-a', 'should reuse persisted child model');
    assert.ok(!llm.modelCalls.includes('child-model-b'), 'should not attempt the updated override when session already has a model');
  });

  test('task tool falls back to parent model when subagentModel is unavailable', async () => {
    const llm = new MockLLMProvider();
    llm.markModelUnavailable('child-model');
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task',
      toolName: 'task',
      input: {
        description: 'Fallback',
        prompt: 'Return ok.',
        subagent_type: 'general',
        session_id: 'fallback-sess',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'child ok' }); // subagent runs on parent model
    llm.queueResponse({ kind: 'text', content: 'parent ok' });

    const notices: any[] = [];
    let taskResult: ToolResult | undefined;
    const agent = new LingyunAgent(llm, { model: 'parent-model', subagentModel: 'child-model' }, registry);
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const run = agent.run({
      session,
      input: 'go',
      callbacks: {
        onNotice: (notice) => {
          notices.push(notice);
        },
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') taskResult = result;
        },
      },
    });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.ok(taskResult, 'expected task tool result');
    const taskMeta = (taskResult!.metadata as any)?.task;
    assert.ok(taskMeta?.model_warning, 'expected model_warning');
    assert.strictEqual(taskMeta.requested_model_id, 'child-model');
    assert.strictEqual(taskMeta.model_id, 'parent-model');
    assert.ok(notices.some((n) => n.level === 'warning'), 'expected warning notice');
  });

  test('task tool rejects recursion from subagent sessions and enforces plan-mode subagent restrictions', async () => {
    {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      registerTaskTool(registry);

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_task',
        toolName: 'task',
        input: { description: 'noop', prompt: 'noop', subagent_type: 'general' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      let taskResult: ToolResult | undefined;
      const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry);
      const session = new LingyunSession({ sessionId: 'child', parentSessionId: 'parent', subagentType: 'general' });

      const run = agent.run({
        session,
        input: 'try recursion',
        callbacks: {
          onToolResult: (tool, result) => {
            if (tool.function.name === 'task') taskResult = result;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      await run.done;

      assert.ok(taskResult, 'expected task tool result');
      assert.strictEqual(taskResult!.success, false);
      assert.strictEqual(taskResult!.metadata?.errorType, 'task_recursion_denied');
    }

    {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      registerTaskTool(registry);

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_task',
        toolName: 'task',
        input: { description: 'noop', prompt: 'noop', subagent_type: 'general' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      let taskResult: ToolResult | undefined;
      const agent = new LingyunAgent(llm, { model: 'parent-model', mode: 'plan' }, registry);
      const session = new LingyunSession({ sessionId: 'parent' });

      const run = agent.run({
        session,
        input: 'plan mode',
        callbacks: {
          onToolResult: (tool, result) => {
            if (tool.function.name === 'task') taskResult = result;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      await run.done;

      assert.ok(taskResult, 'expected task tool result');
      assert.strictEqual(taskResult!.success, false);
      assert.strictEqual(taskResult!.metadata?.errorType, 'subagent_denied_in_plan');
      assert.strictEqual(taskResult!.metadata?.subagentType, 'general');
    }
  });
});
