/**
 * Tool Registry Tests
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ToolRegistry } from '../../core/registry';
import type { ToolProvider, ToolDefinition, ToolContext } from '../../core/types';

suite('ToolRegistry', () => {
  let registry: ToolRegistry;

  setup(() => {
    registry = new ToolRegistry();
  });

  teardown(() => {
    registry.dispose();
  });

  // ===========================================================================
  // Tool Registration
  // ===========================================================================

  test('registerTool - adds tool to registry', async () => {
    const definition: ToolDefinition = {
      id: 'test_hello',
      name: 'Hello',
      description: 'Says hello',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' },
        },
        required: ['name'],
      },
      execution: { type: 'function', handler: 'test_hello' },
    };

    const handler = async (args: Record<string, unknown>) => ({
      success: true,
      data: `Hello, ${args.name}!`,
    });

    registry.registerTool(definition, handler);

    const tools = await registry.getTools();
    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].id, 'test_hello');
  });

  test('registerTool - disposes correctly', async () => {
    const definition: ToolDefinition = {
      id: 'test_disposable',
      name: 'Disposable',
      description: 'Will be disposed',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'test_disposable' },
    };

    const disposable = registry.registerTool(definition, async () => ({ success: true }));
    
    let tools = await registry.getTools();
    assert.strictEqual(tools.length, 1);

    disposable.dispose();

    tools = await registry.getTools();
    assert.strictEqual(tools.length, 0);
  });

  test('registerTool - emits onDidRegisterTool event', async () => {
    let eventFired = false;
    let registeredToolId: string | undefined;

    registry.onDidRegisterTool(tool => {
      eventFired = true;
      registeredToolId = tool.id;
    });

    const definition: ToolDefinition = {
      id: 'test_event',
      name: 'Event Test',
      description: 'Tests events',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'test_event' },
    };

    registry.registerTool(definition, async () => ({ success: true }));

    assert.strictEqual(eventFired, true);
    assert.strictEqual(registeredToolId, 'test_event');
  });

  // ===========================================================================
  // Tool Provider
  // ===========================================================================

  test('registerProvider - adds provider tools', async () => {
    const provider: ToolProvider = {
      id: 'test-provider',
      name: 'Test Provider',
      getTools: () => [
        {
          id: 'provider_tool1',
          name: 'Tool 1',
          description: 'First tool',
          parameters: { type: 'object', properties: {} },
          execution: { type: 'function', handler: 'provider_tool1' },
        },
        {
          id: 'provider_tool2',
          name: 'Tool 2',
          description: 'Second tool',
          parameters: { type: 'object', properties: {} },
          execution: { type: 'function', handler: 'provider_tool2' },
        },
      ],
      executeTool: async () => ({ success: true, data: 'executed' }),
    };

    registry.registerProvider(provider);

    const tools = await registry.getTools();
    assert.strictEqual(tools.length, 2);
    
    const ids = tools.map(t => t.id);
    assert.ok(ids.includes('provider_tool1'));
    assert.ok(ids.includes('provider_tool2'));
  });

  test('registerProvider - throws on duplicate ID', () => {
    const provider1: ToolProvider = {
      id: 'duplicate',
      name: 'First',
      getTools: () => [],
      executeTool: async () => ({ success: true }),
    };

    const provider2: ToolProvider = {
      id: 'duplicate',
      name: 'Second',
      getTools: () => [],
      executeTool: async () => ({ success: true }),
    };

    registry.registerProvider(provider1);
    
    assert.throws(() => {
      registry.registerProvider(provider2);
    }, /already registered/);
  });

  test('registry LLM tools and provider lists avoid mapped snapshots', async () => {
    const definition: ToolDefinition = {
      id: 'llm_tool',
      name: 'LLM Tool',
      description: 'Tool for LLM shaping',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      execution: { type: 'function', handler: 'llm_tool' },
    };
    registry.registerTool(definition, async () => ({ success: true }));
    registry.registerProvider({
      id: 'source_provider',
      name: 'Source Provider',
      getTools: () => [],
      executeTool: async () => ({ success: true }),
    });

    assert.deepStrictEqual(await registry.getToolsForLLM(), [
      {
        type: 'function',
        function: {
          name: 'llm_tool',
          description: 'Tool for LLM shaping',
          parameters: { type: 'object', properties: { value: { type: 'string' } } },
        },
      },
    ]);
    assert.deepStrictEqual(registry.getProviders(), [
      { id: 'builtin', name: 'Built-in Tools' },
      { id: 'source_provider', name: 'Source Provider' },
    ]);

    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/registry.ts'), 'utf8');
    const llmStart = source.indexOf('async getToolsForLLM');
    assert.ok(llmStart >= 0, 'expected getToolsForLLM');
    const providersStart = source.indexOf('\n  getProviders', llmStart);
    assert.ok(providersStart > llmStart, 'expected getProviders after getToolsForLLM');
    const llmSection = source.slice(llmStart, providersStart);
    const providersEnd = source.indexOf('\n  async getToolCount', providersStart);
    assert.ok(providersEnd > providersStart, 'expected getToolCount after getProviders');
    const providersSection = source.slice(providersStart, providersEnd);

    assert.match(llmSection, /const out: Array</);
    assert.match(llmSection, /for \(const tool of tools\)/);
    assert.match(llmSection, /out\.push\(\{/);
    assert.match(llmSection, /return out;/);
    assert.doesNotMatch(llmSection, /tools\.map/);

    assert.match(providersSection, /const providers: \{ id: string; name: string \}\[\] = \[\{ id: 'builtin', name: 'Built-in Tools' \}\];/);
    assert.match(providersSection, /for \(const provider of this\.providers\.values\(\)\)/);
    assert.match(providersSection, /providers\.push\(\{ id: provider\.id, name: provider\.name \}\);/);
    assert.doesNotMatch(providersSection, /Array\.from\(this\.providers\.values\(\)\)\.map/);
  });

  // ===========================================================================
  // Tool Execution
  // ===========================================================================

  test('executeTool - calls handler with args', async () => {
    let receivedArgs: Record<string, unknown> | null = null;

    const definition: ToolDefinition = {
      id: 'test_args',
      name: 'Args Test',
      description: 'Tests args',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'number' },
        },
      },
      execution: { type: 'function', handler: 'test_args' },
    };

    registry.registerTool(definition, async (args) => {
      receivedArgs = args;
      return { success: true, data: args.value };
    });

    const context = createMockContext();
    const result = await registry.executeTool('test_args', { value: 42 }, context);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data, 42);
    assert.deepStrictEqual(receivedArgs, { value: 42 });
  });

  test('executeTool - preserves caller workspace root', async () => {
    const expectedRoot = path.join(os.tmpdir(), 'lingyun-registry-root');
    let receivedWorkspaceRoot: string | undefined;

    const definition: ToolDefinition = {
      id: 'test_workspace_root',
      name: 'Workspace Root Test',
      description: 'Tests workspace root propagation',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'test_workspace_root' },
    };

    registry.registerTool(definition, async (_args, context) => {
      receivedWorkspaceRoot = context.workspaceFolder?.fsPath;
      return { success: true };
    });

    const context = createMockContext();
    context.workspaceFolder = vscode.Uri.file(expectedRoot);

    const result = await registry.executeTool('test_workspace_root', {}, context);

    assert.strictEqual(result.success, true);
    assert.strictEqual(receivedWorkspaceRoot, expectedRoot);
  });

  test('executeTool - returns error for unknown tool', async () => {
    const context = createMockContext();
    const result = await registry.executeTool('nonexistent_tool', {}, context);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('Unknown tool'));
  });

  test('executeTool - handles handler errors', async () => {
    const definition: ToolDefinition = {
      id: 'test_error',
      name: 'Error Test',
      description: 'Throws error',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'test_error' },
    };

    registry.registerTool(definition, async () => {
      throw new Error('Something went wrong');
    });

    const context = createMockContext();
    const result = await registry.executeTool('test_error', {}, context);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Something went wrong');
  });
});

// ===========================================================================
// Test Helpers
// ===========================================================================

function createMockContext(): ToolContext {
  return {
    workspaceFolder: undefined,
    activeEditor: undefined,
    extensionContext: {} as unknown as vscode.ExtensionContext,
    cancellationToken: {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    },
    progress: { report: () => {} },
    log: () => {},
  };
}
