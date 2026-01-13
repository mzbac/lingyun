#!/usr/bin/env node
/**
 * Manual Test Script
 * 
 * Quick smoke tests that can run without VSCode.
 * Run with: npm run compile && node scripts/test-manual.js
 */

const Module = require('module');
const path = require('path');

// Minimal mock for vscode module
const vscode = {
  EventEmitter: class {
    constructor() { this.listeners = []; }
    get event() { 
      return (listener) => { 
        this.listeners.push(listener); 
        return { dispose: () => {} }; 
      }; 
    }
    fire(data) { this.listeners.forEach(l => l(data)); }
    dispose() { this.listeners = []; }
  },
  Uri: {
    file: (path) => ({ fsPath: path, path }),
    parse: (s) => ({ fsPath: s, path: s }),
    joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
    getConfiguration: () => ({ get: () => undefined }),
    fs: {
      readFile: async () => Buffer.from('test content'),
      writeFile: async () => {},
    },
    findFiles: async () => [],
    asRelativePath: (uri) => uri.fsPath || uri,
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: async (msg) => console.log('INFO:', msg),
    showWarningMessage: async (msg) => { console.log('WARN:', msg); return 'Allow'; },
    showErrorMessage: async (msg) => console.log('ERROR:', msg),
    createOutputChannel: () => ({
      appendLine: (msg) => console.log(msg),
      append: (msg) => process.stdout.write(msg),
      show: () => {},
    }),
  },
  CancellationTokenSource: class {
    constructor() {
      this.token = { 
        isCancellationRequested: false, 
        onCancellationRequested: () => ({ dispose: () => {} }) 
      };
    }
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
  },
  Disposable: class { constructor(fn) { this.fn = fn; } dispose() { this.fn?.(); } },
};

// Intercept require to mock vscode
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return vscode;
  }
  return originalRequire.apply(this, arguments);
};

// Now we can import our modules
const { ToolRegistry } = require('../dist/core/registry');

// =============================================================================
// Tests
// =============================================================================

async function runTests() {
  console.log('🧪 Running Manual Tests\n');
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;

  // Test 1: Registry creation
  try {
    const registry = new ToolRegistry();
    console.log('✅ Registry creation');
    passed++;
    registry.dispose();
  } catch (e) {
    console.log('❌ Registry creation:', e.message);
    failed++;
  }

  // Test 2: Tool registration
  try {
    const registry = new ToolRegistry();
    const disposable = registry.registerTool(
      {
        id: 'test.hello',
        name: 'Hello',
        description: 'Says hello',
        parameters: { type: 'object', properties: { name: { type: 'string' } } },
        execution: { type: 'function', handler: 'test.hello' },
      },
      async (args) => ({ success: true, data: `Hello, ${args.name}!` })
    );
    
    const tools = await registry.getTools();
    if (tools.length !== 1) throw new Error(`Expected 1 tool, got ${tools.length}`);
    if (tools[0].id !== 'test.hello') throw new Error(`Expected 'test.hello', got ${tools[0].id}`);
    
    console.log('✅ Tool registration');
    passed++;
    
    disposable.dispose();
    registry.dispose();
  } catch (e) {
    console.log('❌ Tool registration:', e.message);
    failed++;
  }

  // Test 3: Tool execution
  try {
    const registry = new ToolRegistry();
    registry.registerTool(
      {
        id: 'test.echo',
        name: 'Echo',
        description: 'Echoes input',
        parameters: { type: 'object', properties: { msg: { type: 'string' } } },
        execution: { type: 'function', handler: 'test.echo' },
      },
      async (args) => ({ success: true, data: args.msg })
    );

    const context = {
      workspaceFolder: { fsPath: '/test' },
      cancellationToken: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
      progress: { report: () => {} },
      log: () => {},
    };

    const result = await registry.executeTool('test.echo', { msg: 'Hello World' }, context);
    
    if (!result.success) throw new Error('Execution failed');
    if (result.data !== 'Hello World') throw new Error(`Expected 'Hello World', got ${result.data}`);
    
    console.log('✅ Tool execution');
    passed++;
    
    registry.dispose();
  } catch (e) {
    console.log('❌ Tool execution:', e.message);
    failed++;
  }

  // Test 4: Tool disposal
  try {
    const registry = new ToolRegistry();
    const disposable = registry.registerTool(
      {
        id: 'test.dispose',
        name: 'Dispose',
        description: 'Will be disposed',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.dispose' },
      },
      async () => ({ success: true })
    );

    let tools = await registry.getTools();
    if (tools.length !== 1) throw new Error('Tool not registered');

    disposable.dispose();

    tools = await registry.getTools();
    if (tools.length !== 0) throw new Error('Tool not disposed');

    console.log('✅ Tool disposal');
    passed++;
    
    registry.dispose();
  } catch (e) {
    console.log('❌ Tool disposal:', e.message);
    failed++;
  }

  // Test 5: Provider registration
  try {
    const registry = new ToolRegistry();
    
    const provider = {
      id: 'test-provider',
      name: 'Test Provider',
      getTools: () => [
        { id: 'provider.a', name: 'A', description: 'Tool A', parameters: { type: 'object', properties: {} }, execution: { type: 'function', handler: 'a' } },
        { id: 'provider.b', name: 'B', description: 'Tool B', parameters: { type: 'object', properties: {} }, execution: { type: 'function', handler: 'b' } },
      ],
      executeTool: async () => ({ success: true, data: 'from provider' }),
    };

    registry.registerProvider(provider);
    
    const tools = await registry.getTools();
    if (tools.length !== 2) throw new Error(`Expected 2 tools, got ${tools.length}`);
    
    console.log('✅ Provider registration');
    passed++;
    
    registry.dispose();
  } catch (e) {
    console.log('❌ Provider registration:', e.message);
    failed++;
  }

  // Test 6: Unknown tool error
  try {
    const registry = new ToolRegistry();
    
    const context = {
      workspaceFolder: { fsPath: '/test' },
      cancellationToken: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
      progress: { report: () => {} },
      log: () => {},
    };

    const result = await registry.executeTool('nonexistent.tool', {}, context);
    
    if (result.success) throw new Error('Should have failed');
    if (!result.error.includes('Unknown tool')) throw new Error('Wrong error message');
    
    console.log('✅ Unknown tool error handling');
    passed++;
    
    registry.dispose();
  } catch (e) {
    console.log('❌ Unknown tool error handling:', e.message);
    failed++;
  }

  // Test 7: LLM format
  try {
    const registry = new ToolRegistry();
    registry.registerTool(
      {
        id: 'llm.test',
        name: 'LLM Test',
        description: 'A tool for LLM testing',
        parameters: { 
          type: 'object', 
          properties: { 
            query: { type: 'string', description: 'Search query' } 
          },
          required: ['query']
        },
        execution: { type: 'function', handler: 'llm.test' },
      },
      async () => ({ success: true })
    );

    const llmTools = await registry.getToolsForLLM();
    
    if (llmTools.length !== 1) throw new Error(`Expected 1 tool, got ${llmTools.length}`);
    if (llmTools[0].type !== 'function') throw new Error('Wrong type');
    if (llmTools[0].function.name !== 'llm.test') throw new Error('Wrong name');
    if (!llmTools[0].function.parameters) throw new Error('Missing parameters');
    
    console.log('✅ LLM format conversion');
    passed++;
    
    registry.dispose();
  } catch (e) {
    console.log('❌ LLM format conversion:', e.message);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
