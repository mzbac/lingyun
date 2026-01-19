/**
 * Tool Registry Tests
 */

import * as assert from 'assert';
import { ToolRegistry } from '../../core/registry';
import type { ToolProvider, ToolDefinition, ToolContext } from '../../core/types';
import type * as vscode from 'vscode';

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

  // ===========================================================================
  // Tool Filtering
  // ===========================================================================

  test('getTools - filters by category', async () => {
    registry.registerTool({
      id: 'cat_file1',
      name: 'File 1',
      description: 'File tool',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'cat_file1' },
      metadata: { category: 'file' },
    }, async () => ({ success: true }));

    registry.registerTool({
      id: 'cat_shell1',
      name: 'Shell 1',
      description: 'Shell tool',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'cat_shell1' },
      metadata: { category: 'shell' },
    }, async () => ({ success: true }));

    const fileTools = await registry.getTools({ category: 'file' });
    assert.strictEqual(fileTools.length, 1);
    assert.strictEqual(fileTools[0].id, 'cat_file1');

    const shellTools = await registry.getTools({ category: 'shell' });
    assert.strictEqual(shellTools.length, 1);
    assert.strictEqual(shellTools[0].id, 'cat_shell1');
  });

  test('getTools - filters by tags', async () => {
    registry.registerTool({
      id: 'tag_read',
      name: 'Read',
      description: 'Read tool',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'tag_read' },
      metadata: { tags: ['safe', 'readonly'] },
    }, async () => ({ success: true }));

    registry.registerTool({
      id: 'tag_write',
      name: 'Write',
      description: 'Write tool',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'tag_write' },
      metadata: { tags: ['dangerous', 'write'] },
    }, async () => ({ success: true }));

    const safeTools = await registry.getTools({ tags: ['safe'] });
    assert.strictEqual(safeTools.length, 1);
    assert.strictEqual(safeTools[0].id, 'tag_read');
  });

  // ===========================================================================
  // LLM Format
  // ===========================================================================

  test('getToolsForLLM - returns OpenAI format', async () => {
    registry.registerTool({
      id: 'llm_test',
      name: 'LLM Test',
      description: 'A test tool for LLM',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      execution: { type: 'function', handler: 'llm_test' },
    }, async () => ({ success: true }));

    const llmTools = await registry.getToolsForLLM();
    
    assert.strictEqual(llmTools.length, 1);
    assert.strictEqual(llmTools[0].type, 'function');
    assert.strictEqual(llmTools[0].function.name, 'llm_test');
    assert.strictEqual(llmTools[0].function.description, 'A test tool for LLM');
    assert.deepStrictEqual(llmTools[0].function.parameters, {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    });
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
