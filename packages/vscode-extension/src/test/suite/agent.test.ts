/**
 * Agent Loop Tests (AI SDK-based)
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { convertToModelMessages } from 'ai';
import { simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

import { AgentLoop } from '../../core/agent';
import { ToolRegistry } from '../../core/registry';
import type { LLMProvider } from '../../core/types';
import { getMessageText } from '@kooka/core';
import { COMPACTED_TOOL_PLACEHOLDER, createHistoryForModel } from '../../core/compaction';
import { PluginManager } from '../../core/hooks/pluginManager';

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
    {
      type: 'finish' as const,
      usage: usage(override),
      finishReason: { unified: 'stop', raw: 'stop' },
    },
  ];
}

function streamPartsForToolCall(call: Extract<ScriptedResponse, { kind: 'tool-call' }>): LanguageModelV3StreamPart[] {
  const finish = call.finishReason ?? 'tool-calls';
  return [
    {
      type: 'tool-call' as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: JSON.stringify(call.input),
    },
    {
      type: 'finish' as const,
      usage: usage(call.usage),
      finishReason: { unified: finish as any, raw: finish as any },
    },
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
      content: [
        {
          type: 'tool-call',
          toolCallId: response.toolCallId,
          toolName: response.toolName,
          input: JSON.stringify(response.input),
        } as any,
      ],
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

  private nextResponse(): ScriptedResponse {
    return this.responses.shift() ?? { kind: 'text', content: 'No response configured' };
  }

  setNextResponse(response: ScriptedResponse): void {
    this.responses = [response];
  }

  queueResponse(response: ScriptedResponse): void {
    this.responses.push(response);
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

suite('AgentLoop', () => {
  let mockLLM: MockLLMProvider;
  let registry: ToolRegistry;
  let agent: AgentLoop;
  let mockContext: vscode.ExtensionContext;

  setup(() => {
    mockLLM = new MockLLMProvider();
    registry = new ToolRegistry();
    mockContext = createMockExtensionContext();
    agent = new AgentLoop(mockLLM, mockContext, { model: 'mock-model' }, registry);

    registry.registerTool(
      {
        id: 'test.echo',
        name: 'Echo',
        description: 'Echoes back input',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
        execution: { type: 'function', handler: 'test.echo' },
      },
      async (args) => ({
        success: true,
        data: `Echo: ${args.message}`,
      })
    );
  });

  teardown(() => {
    registry.dispose();
  });

  test('run - simple response without tools', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'Hello! How can I help you?' });

    const result = await agent.run('Hi there');

    assert.strictEqual(result, 'Hello! How can I help you?');
    assert.strictEqual(mockLLM.callCount, 1);
  });

  test('run - strips <think> blocks from assistant output', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: '<think>hidden reasoning</think>\nHello' });

    const result = await agent.run('Hi');

    assert.strictEqual(result, 'Hello');
    const history = agent.getHistory();
    const last = history[history.length - 1];
    assert.strictEqual(last.role, 'assistant');
    assert.strictEqual(getMessageText(last), 'Hello');
  });

  test('run - strips stray </think> tags from assistant output', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: '</think>\nHello' });

    const result = await agent.run('Hi');

    assert.strictEqual(result, 'Hello');
  });

  test('continue - adds to existing history', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'First' });
    await agent.run('Hello');

    mockLLM.setNextResponse({ kind: 'text', content: 'Second' });
    await agent.continue('Follow up');

    const history = agent.getHistory();
    assert.strictEqual(history[2].role, 'user');
    assert.strictEqual(getMessageText(history[2]), 'Follow up');
    assert.strictEqual(history[3].role, 'assistant');
    assert.strictEqual(getMessageText(history[3]), 'Second');
  });

  test('run - executes tool calls', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_123',
      toolName: 'test.echo',
      input: { message: 'Hello World' },
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Echo something');
    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);

    const history = agent.getHistory();
    const toolResult = findDynamicToolResult(history, 'call_123');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, true);
    assert.strictEqual(toolResult?.data, 'Echo: Hello World');
  });

  test('file handles - glob assigns fileId and read resolves it', async () => {
    let readArgs: any;

    registry.registerTool(
      {
        id: 'glob',
        name: 'Glob Files',
        description: 'Find files matching a glob pattern',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } as any },
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
            fileId: { type: 'string' } as any,
            filePath: { type: 'string' } as any,
          },
          required: [],
        },
        execution: { type: 'function', handler: 'test.read' },
      },
      async (args) => {
        readArgs = args;
        return { success: true, data: 'ok' };
      }
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_glob',
      toolName: 'glob',
      input: { pattern: '**/*.ts' },
    });
    mockLLM.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_read',
      toolName: 'read',
      input: { fileId: 'F1' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Use file handles');
    assert.strictEqual(result, 'Done');

    const state = agent.exportState();
    assert.strictEqual(state.fileHandles?.byId.F1, 'src/foo.ts');
    assert.strictEqual(readArgs?.filePath, 'src/foo.ts');
  });

  test('file handles - grep assigns fileId and lsp resolves it', async () => {
    let lspArgs: any;

    registry.registerTool(
      {
        id: 'grep',
        name: 'Search in Files',
        description: 'Search for a regex pattern in files',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } as any },
          required: ['pattern'],
        },
        execution: { type: 'function', handler: 'test.grep' },
      },
      async () => ({
        success: true,
        data: {
          matches: [
            { filePath: 'src/foo.ts', line: 10, column: 5, text: 'const foo = 1;' },
            { filePath: 'src/bar.ts', line: 2, column: 1, text: 'foo();' },
          ],
          totalMatches: 2,
          truncated: false,
        },
      })
    );

    registry.registerTool(
      {
        id: 'lsp',
        name: 'Language Features (VS Code)',
        description: 'LSP tool',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string' } as any,
            fileId: { type: 'string' } as any,
            filePath: { type: 'string' } as any,
            line: { type: 'number' } as any,
            character: { type: 'number' } as any,
          },
          required: ['operation'],
        },
        execution: { type: 'function', handler: 'test.lsp' },
      },
      async (args) => {
        lspArgs = args;
        return { success: true, data: 'ok' };
      }
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_grep',
      toolName: 'grep',
      input: { pattern: 'foo' },
    });
    mockLLM.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_lsp',
      toolName: 'lsp',
      input: { operation: 'hover', fileId: 'F1', line: 10, character: 5 },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Use grep file handles');
    assert.strictEqual(result, 'Done');

    const state = agent.exportState();
    assert.strictEqual(state.fileHandles?.byId.F1, 'src/foo.ts');
    assert.strictEqual(lspArgs?.filePath, 'src/foo.ts');

    const history = agent.getHistory();
    const grepResult = findDynamicToolResult(history, 'call_grep');
    assert.ok(grepResult);
    assert.strictEqual(grepResult?.success, true);
    assert.ok(String(grepResult?.data || '').includes('F1'));
    assert.ok(String(grepResult?.data || '').includes('LSP:'));
  });

  test('run - continues when tool calls are present even if finishReason is stop', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_stop',
      toolName: 'test.echo',
      input: { message: 'x' },
      finishReason: 'stop',
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Do tool then answer');

    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);
  });

  test('run - retries transient terminated stream errors even after reasoning', async () => {
    agent.updateConfig({ maxRetries: 1 });

    const err = {
      name: 'TypeError',
      message: 'terminated',
      responseHeaders: { 'retry-after-ms': '1' },
    };

    mockLLM.setNextResponse({
      kind: 'stream',
      chunks: [
        { type: 'reasoning-start' as const, id: 'r1' },
        { type: 'reasoning-delta' as const, id: 'r1', delta: 'some reasoning' },
        { type: 'error' as const, error: err },
      ],
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Hello' });

    const result = await agent.run('Hi');
    assert.strictEqual(result, 'Hello');
    assert.strictEqual(mockLLM.callCount, 2);

    const history = agent.getHistory();
    assert.strictEqual(history.filter(m => m.role === 'assistant').length, 1);
    assert.strictEqual(getMessageText(history[history.length - 1]), 'Hello');
  });

  test('external paths disabled - blocks tool calls even with autoApprove', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'test.external',
          name: 'External Tool',
          description: 'Tool that accepts a filePath',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
            },
            required: ['filePath'],
          },
          execution: { type: 'function', handler: 'test.external' },
          metadata: {
            permission: 'read',
            readOnly: true,
            supportsExternalPaths: true,
            permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_ext_disabled',
        toolName: 'test.external',
        input: { filePath: externalPath },
      });
      mockLLM.queueResponse({ kind: 'text', content: '' });

      const result = await agent.run('Try external path');
      assert.strictEqual(result, '');
      assert.strictEqual(executed, false);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_ext_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.ok(String(toolResult?.error || '').includes('External paths are disabled'));
      const meta = (toolResult as any)?.metadata || {};
      assert.strictEqual(meta.errorType, 'external_paths_disabled');
      assert.strictEqual(meta.blockedSettingKey, 'lingyun.security.allowExternalPaths');
      assert.strictEqual(meta.isOutsideWorkspace, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths disabled - blocks shell commands that reference external paths (bash)', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Test Bash',
          description: 'Simulates the bash tool',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_ext_disabled',
        toolName: 'bash',
        input: { command: `cat ${externalPath}` },
      });
      mockLLM.queueResponse({ kind: 'text', content: '' });

      const result = await agent.run('Try running a shell tool');
      assert.strictEqual(result, '');
      assert.strictEqual(executed, false);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_ext_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.ok(String(toolResult?.error || '').includes('references paths outside'));
      const meta = (toolResult as any)?.metadata || {};
      assert.strictEqual(meta.errorType, 'external_paths_disabled');
      assert.strictEqual(meta.blockedSettingKey, 'lingyun.security.allowExternalPaths');
      assert.ok(Array.isArray(meta.blockedPaths));
      assert.ok((meta.blockedPaths as any[]).includes(externalPath));
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths disabled - allows workspace-safe shell commands (bash)', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      let executed = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Test Bash',
          description: 'Simulates the bash tool',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash.safe' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_safe_disabled',
        toolName: 'bash',
        input: { command: 'mkdir -p snake_game' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Try running a safe shell tool', {
        onRequestApproval: async () => true,
      });
      assert.strictEqual(result, 'Done');
      assert.strictEqual(executed, true);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_safe_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths enabled - allows shell commands with external paths (bash)', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', true, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Test Bash',
          description: 'Simulates the bash tool',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_ext_enabled',
        toolName: 'bash',
        input: { command: `cat ${externalPath}` },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Try running a shell tool');
      assert.strictEqual(result, 'Done');
      assert.strictEqual(executed, true);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_ext_enabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths disabled - blocks tools with execution.type="shell" when script references external paths', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'workspace.shellTool',
          name: 'Workspace Shell Tool',
          description: 'Tool that executes a shell script',
          parameters: {
            type: 'object',
            properties: {},
          },
          execution: { type: 'shell', script: `cat ${externalPath}` },
          metadata: { requiresApproval: false },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_type_disabled',
        toolName: 'workspace.shellTool',
        input: {},
      });
      mockLLM.queueResponse({ kind: 'text', content: '' });

      const result = await agent.run('Try running a workspace shell tool');
      assert.strictEqual(result, '');
      assert.strictEqual(executed, false);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_type_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.ok(String(toolResult?.error || '').includes('references paths outside'));
      const meta = (toolResult as any)?.metadata || {};
      assert.strictEqual(meta.errorType, 'external_paths_disabled');
      assert.strictEqual(meta.blockedSettingKey, 'lingyun.security.allowExternalPaths');
      assert.ok(Array.isArray(meta.blockedPaths));
      assert.ok((meta.blockedPaths as any[]).includes(externalPath));
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths enabled - allows tool calls with external path', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', true, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'test.external2',
          name: 'External Tool 2',
          description: 'Tool that accepts a filePath',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
            },
            required: ['filePath'],
          },
          execution: { type: 'function', handler: 'test.external2' },
          metadata: {
            permission: 'read',
            readOnly: true,
            supportsExternalPaths: true,
            permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_ext_enabled',
        toolName: 'test.external2',
        input: { filePath: externalPath },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Try external path');
      assert.strictEqual(result, 'Done');
      assert.strictEqual(executed, true);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_ext_enabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('auto compaction - triggers after tool-call overflow', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousLimits = cfg.get('modelLimits');

    await cfg.update(
      'modelLimits',
      {
        'mock-model': { context: 10, output: 5 },
      },
      true
    );

    try {
      const compactionEvents: Array<
        | { type: 'start'; auto: boolean; markerMessageId: string }
        | {
            type: 'end';
            auto: boolean;
            markerMessageId: string;
            summaryMessageId?: string;
            status: 'done' | 'error' | 'canceled';
            error?: string;
          }
      > = [];

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_overflow',
        toolName: 'test.echo',
        input: { message: 'Hello World' },
        usage: { inputNoCache: 10, cacheRead: 0, outputTotal: 1 },
      });

      mockLLM.queueResponse({ kind: 'text', content: 'Summary of progress' });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Do a thing', {
        onCompactionStart: (event) => {
          compactionEvents.push({ type: 'start', auto: event.auto, markerMessageId: event.markerMessageId });
        },
        onCompactionEnd: (event) => {
          compactionEvents.push({
            type: 'end',
            auto: event.auto,
            markerMessageId: event.markerMessageId,
            summaryMessageId: event.summaryMessageId,
            status: event.status,
            error: event.error,
          });
        },
      });
      assert.strictEqual(result, 'Done');
      assert.strictEqual(mockLLM.callCount, 3, 'tool call + compaction + final response');

      const history = agent.getHistory();
      assert.ok(history.some(m => m.role === 'assistant' && m.metadata?.summary === true), 'summary message exists');
      assert.ok(history.some(m => m.role === 'user' && m.metadata?.compaction), 'compaction marker exists');

      const start = compactionEvents.find(e => e.type === 'start');
      const end = compactionEvents.find(e => e.type === 'end');
      assert.ok(start && start.auto === true, 'compaction start event exists');
      assert.ok(end && end.auto === true && end.status === 'done', 'compaction end event exists');
    } finally {
      await cfg.update('modelLimits', previousLimits as any, true);
    }
  });

  test('createHistoryForModel - replaces compacted tool output with placeholder', () => {
    const history = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'test.echo',
            toolCallId: 'call_1',
            state: 'output-available',
            input: { message: 'x' },
            output: { success: true, data: 'secret tool output' },
            compactedAt: Date.now(),
          } as any,
        ],
      },
    ] as any[];

    const prepared = createHistoryForModel(history as any);
    const toolPart = (prepared[1] as any).parts[0];
    assert.strictEqual(toolPart.output.data, COMPACTED_TOOL_PLACEHOLDER);
  });

  test('run - tool output compaction afterToolCall', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousMode = cfg.get<unknown>('compaction.toolOutputMode');
    await cfg.update('compaction.toolOutputMode', 'afterToolCall', true);

    try {
      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_compact_1',
        toolName: 'test.echo',
        input: { message: 'Hello' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Echo something');
      assert.strictEqual(result, 'Done');

      const history = agent.getHistory();
      const toolMessage = history.find(
        (m) =>
          m.role === 'assistant' &&
          m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test.echo' && p.state === 'output-available'),
      ) as any;
      assert.ok(toolMessage, 'tool message exists');

      const toolPart = toolMessage.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test.echo') as any;
      assert.ok(typeof toolPart.compactedAt === 'number', 'tool output is marked compacted after being consumed once');

      const prepared = createHistoryForModel(history as any);
      const preparedToolMessage = prepared.find(
        (m: any) =>
          m.role === 'assistant' &&
          m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test.echo' && p.state === 'output-available'),
      ) as any;
      const preparedToolPart = preparedToolMessage.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test.echo') as any;
      assert.strictEqual(preparedToolPart.output.data, COMPACTED_TOOL_PLACEHOLDER);
    } finally {
      await cfg.update('compaction.toolOutputMode', previousMode as any, true);
    }
  });

  test('run - tool output compaction onCompaction', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousMode = cfg.get<unknown>('compaction.toolOutputMode');
    await cfg.update('compaction.toolOutputMode', 'onCompaction', true);

    try {
      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_compact_2',
        toolName: 'test.echo',
        input: { message: 'Hello' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Echo something');
      assert.strictEqual(result, 'Done');

      const history = agent.getHistory();
      const toolMessage = history.find(
        (m) =>
          m.role === 'assistant' &&
          m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test.echo' && p.state === 'output-available'),
      ) as any;
      assert.ok(toolMessage, 'tool message exists');

      const toolPart = toolMessage.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test.echo') as any;
      assert.ok(toolPart.compactedAt === undefined, 'tool output is not compacted outside of session compaction');
      assert.strictEqual(toolPart.output?.data, 'Echo: Hello');
    } finally {
      await cfg.update('compaction.toolOutputMode', previousMode as any, true);
    }
  });

  test('history conversion - tool messages always follow tool calls', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_seq',
      toolName: 'test.echo',
      input: { message: 'Hello' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    await agent.run('Echo something');

    const history = agent.getHistory();
    const withoutIds = history.map(({ id: _id, ...rest }) => rest);
    const modelMessages = await convertToModelMessages(withoutIds as any);

    let previousAssistantHadToolCall = false;
    for (const msg of modelMessages as any[]) {
      if (msg.role === 'assistant') {
        const content = Array.isArray(msg.content) ? msg.content : [];
        previousAssistantHadToolCall = content.some((p: any) => p?.type === 'tool-call');
        continue;
      }

      if (msg.role === 'tool') {
        assert.strictEqual(previousAssistantHadToolCall, true, 'tool message must follow assistant tool-call');
        previousAssistantHadToolCall = false;
      } else {
        previousAssistantHadToolCall = false;
      }
    }
  });

  test('run - plan mode blocks edit tools (write)', async () => {
    agent.updateConfig({ mode: 'plan' });

    registry.registerTool(
      {
        id: 'write',
        name: 'Write File',
        description: 'Writes a file',
        parameters: {
          type: 'object',
          properties: { filePath: { type: 'string' }, content: { type: 'string' } },
          required: ['filePath', 'content'],
        },
        execution: { type: 'function', handler: 'write' },
        metadata: { category: 'file', requiresApproval: true },
      },
      async () => ({ success: true })
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_plan_1',
      toolName: 'write',
      input: { filePath: 'README.md', content: 'hi' },
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Try tool in plan mode');
    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);

    const history = agent.getHistory();
    const toolResult = findDynamicToolResult(history, 'call_plan_1');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.ok(String(toolResult?.error).toLowerCase().includes('plan mode'));
  });

  test('run - requests approval for tools', async () => {
    registry.registerTool(
      {
        id: 'test.dangerous',
        name: 'Dangerous',
        description: 'Needs approval',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.dangerous' },
        metadata: { requiresApproval: true },
      },
      async () => ({ success: true, data: 'executed' })
    );

    let approvalRequested = false;

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_danger',
      toolName: 'test.dangerous',
      input: {},
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    await agent.run('Do something dangerous', {
      onRequestApproval: async () => {
        approvalRequested = true;
        return true;
      },
    });

    assert.strictEqual(approvalRequested, true);
  });

  test('run - rejects tool when not approved', async () => {
    registry.registerTool(
      {
        id: 'test.reject',
        name: 'Reject',
        description: 'Will be rejected',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.reject' },
        metadata: { requiresApproval: true },
      },
      async () => ({ success: true, data: 'should not run' })
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_reject',
      toolName: 'test.reject',
      input: {},
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Try rejected tool', {
      onRequestApproval: async () => false,
    });

    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);
    const history = agent.getHistory();
    const toolResult = findDynamicToolResult(history, 'call_reject');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.ok(String(toolResult?.error).toLowerCase().includes('rejected'));
  });

  test('abort - stops the agent', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_abort',
      toolName: 'test.echo',
      input: { message: 'x' },
    });

    try {
      await agent.run('Abort', {
        onToolCall: () => agent.abort(),
      });
      assert.fail('Should have thrown');
    } catch (e: unknown) {
      assert.ok(e instanceof Error && e.message.toLowerCase().includes('aborted'));
    }
  });

  test('plan + execute - runs plan first, then executes', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: '1. Do the thing\n2. Verify\n3. Report' });
    const plan = await agent.plan('Do the thing');
    assert.ok(plan.includes('1.'));

    mockLLM.setNextResponse({ kind: 'text', content: 'Done' });
    const result = await agent.execute();

    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);
  });

  test('plan - preserves prior conversation when invoked mid-session', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.run('Hello');

    agent.setMode('plan');
    mockLLM.setNextResponse({ kind: 'text', content: '1. Step\n2. Step' });
    await agent.plan('Make a plan');

    const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.ok(prompt.includes('Hello'), 'planning prompt should include earlier conversation history');

    const history = agent.getHistory();
    assert.ok(history.length >= 4, 'history should retain prior turns plus the new planning turn');
  });

  test('mode switch - injects plan/build reminders', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.run('Hello');

    agent.setMode('plan');
    mockLLM.setNextResponse({ kind: 'text', content: '1. Step\n2. Step' });
    await agent.continue('Make a plan');

    const planPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.ok(planPrompt.includes('Plan mode is active'), 'plan reminder should be injected into prompt');

    agent.setMode('build');
    mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.continue('Now execute');

    const buildPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.ok(
      buildPrompt.includes('operational mode has changed from plan to build'),
      'build switch reminder should be injected into prompt after plan',
    );
  });

  test('run - fires onToken callback', async () => {
    const tokens: string[] = [];

    mockLLM.setNextResponse({ kind: 'text', content: 'Hello World' });

    await agent.run('Hi', {
      onToken: (token) => tokens.push(token),
    });

    assert.ok(tokens.length > 0);
    assert.strictEqual(tokens.join(''), 'Hello World');
  });

  test('hooks - experimental.text.complete transforms assistant output', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'experimental.text.complete': async (_input, output) => {
        output.text = `${output.text}!`;
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({ kind: 'text', content: 'Hello' });

    const result = await hooked.run('Hi');
    assert.strictEqual(result, 'Hello!');
    const history = hooked.getHistory();
    assert.strictEqual(getMessageText(history[history.length - 1]), 'Hello!');
  });

  test('hooks - tool.execute.before can mutate args', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'tool.execute.before': async (_input, output) => {
        if (output.args && typeof output.args === 'object') {
          (output.args as any).message = 'Intercepted';
        }
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_before',
      toolName: 'test.echo',
      input: { message: 'Hello World' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await hooked.run('Echo something');
    assert.strictEqual(result, 'Done');

    const toolResult = findDynamicToolResult(hooked.getHistory(), 'call_before');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, true);
    assert.strictEqual(toolResult?.data, 'Echo: Intercepted');
  });

  test('hooks - tool.execute.after can override tool output text', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'tool.execute.after': async (_input, output) => {
        output.output = 'Overridden';
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_after',
      toolName: 'test.echo',
      input: { message: 'Hello World' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await hooked.run('Echo something');
    assert.strictEqual(result, 'Done');

    const toolResult = findDynamicToolResult(hooked.getHistory(), 'call_after');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, true);
    assert.strictEqual(toolResult?.data, 'Overridden');
  });

  test('hooks - permission.ask can deny a tool call', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'permission.ask': async (_input, output) => {
        output.status = 'deny';
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_deny',
      toolName: 'test.echo',
      input: { message: 'Hello World' },
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await hooked.run('Echo something');
    assert.strictEqual(result, 'Done');

    const toolResult = findDynamicToolResult(hooked.getHistory(), 'call_deny');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.ok(String(toolResult?.error || '').toLowerCase().includes('plugin'));
  });
});

// ===========================================================================
// Test Helpers
// ===========================================================================

function findDynamicToolResult(history: ReturnType<AgentLoop['getHistory']>, toolCallId: string) {
  for (const message of history) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (part.type !== 'dynamic-tool') continue;
      if ((part as any).toolCallId !== toolCallId) continue;
      const output = (part as any).output;
      if (!output || typeof output !== 'object') return undefined;
      if (typeof (output as any).success !== 'boolean') return undefined;
      return output as any;
    }
  }
  return undefined;
}

function createMockExtensionContext(): vscode.ExtensionContext {
  const envVarCollection: vscode.GlobalEnvironmentVariableCollection = {
    persistent: true,
    description: undefined,
    replace: () => {},
    append: () => {},
    prepend: () => {},
    get: () => undefined,
    forEach: () => {},
    delete: () => {},
    clear: () => {},
    getScoped: () => envVarCollection,
    [Symbol.iterator]: function* () {
      // no-op iterator for tests
    },
  };

  return {
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: async () => {},
      keys: () => [],
    },
    globalState: {
      get: () => undefined,
      update: async () => {},
      keys: () => [],
      setKeysForSync: () => {},
    },
    extensionPath: '/mock/extension',
    extensionUri: vscode.Uri.file('/mock/extension'),
    asAbsolutePath: (p: string) => `/mock/extension/${p}`,
    storagePath: '/mock/storage',
    storageUri: vscode.Uri.file('/mock/storage'),
    globalStoragePath: '/mock/global',
    globalStorageUri: vscode.Uri.file('/mock/global'),
    logPath: '/mock/log',
    logUri: vscode.Uri.file('/mock/log'),
    extensionMode: vscode.ExtensionMode.Test,
    environmentVariableCollection: envVarCollection,
    extension: undefined as any,
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    },
    storage: undefined as any,
    globalStorage: undefined as any,
    log: undefined as any,
    extensionRuntime: undefined as any,
  } as unknown as vscode.ExtensionContext;
}
