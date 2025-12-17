/**
 * Agent Loop Tests
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { AgentLoop } from '../../core/agent';
import { ToolRegistry } from '../../core/registry';
import type { LLMProvider, Message, ToolDefinition, ToolCall } from '../../core/types';

suite('AgentLoop', () => {
  let mockLLM: MockLLMProvider;
  let registry: ToolRegistry;
  let agent: AgentLoop;
  let mockContext: vscode.ExtensionContext;

  setup(() => {
    mockLLM = new MockLLMProvider();
    registry = new ToolRegistry();
    mockContext = createMockExtensionContext();
    agent = new AgentLoop(mockLLM, mockContext);

    // Register a test tool
    registry.registerTool({
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
    }, async (args) => ({
      success: true,
      data: `Echo: ${args.message}`,
    }));
  });

  teardown(() => {
    registry.dispose();
  });

  // ===========================================================================
  // Basic Conversation
  // ===========================================================================

  test('run - simple response without tools', async () => {
    mockLLM.setNextResponse({
      role: 'assistant',
      content: 'Hello! How can I help you?',
    });

    const result = await agent.run('Hi there');

    assert.strictEqual(result, 'Hello! How can I help you?');
    assert.strictEqual(mockLLM.callCount, 1);
  });

  test('run - tracks conversation history', async () => {
    mockLLM.setNextResponse({
      role: 'assistant',
      content: 'First response',
    });

    await agent.run('First message');
    const history = agent.getHistory();

    // System + User + Assistant
    assert.strictEqual(history.length, 3);
    assert.strictEqual(history[0].role, 'system');
    assert.strictEqual(history[1].role, 'user');
    assert.strictEqual(history[1].content, 'First message');
    assert.strictEqual(history[2].role, 'assistant');
    assert.strictEqual(history[2].content, 'First response');
  });

  test('continue - adds to existing history', async () => {
    mockLLM.setNextResponse({ role: 'assistant', content: 'First' });
    await agent.run('Hello');

    mockLLM.setNextResponse({ role: 'assistant', content: 'Second' });
    await agent.continue('Follow up');

    const history = agent.getHistory();
    
    // System + User1 + Assistant1 + User2 + Assistant2
    assert.strictEqual(history.length, 5);
    assert.strictEqual(history[3].content, 'Follow up');
    assert.strictEqual(history[4].content, 'Second');
  });

  // ===========================================================================
  // Tool Calling
  // ===========================================================================

  test('run - executes tool calls', async () => {
    // First response: request tool call
    mockLLM.setNextResponse({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_123',
        type: 'function',
        function: {
          name: 'test.echo',
          arguments: '{"message": "Hello World"}',
        },
      }],
    });

    // Second response: final answer
    mockLLM.queueResponse({
      role: 'assistant',
      content: 'The tool returned: Echo: Hello World',
    });

    const result = await agent.run('Echo something');

    assert.strictEqual(mockLLM.callCount, 2);
    assert.strictEqual(result, 'The tool returned: Echo: Hello World');
  });

  test('run - includes tool result in history', async () => {
    mockLLM.setNextResponse({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_456',
        type: 'function',
        function: {
          name: 'test.echo',
          arguments: '{"message": "test"}',
        },
      }],
    });

    mockLLM.queueResponse({
      role: 'assistant',
      content: 'Done',
    });

    await agent.run('Test tool');

    const history = agent.getHistory();
    const toolResult = history.find(m => m.role === 'tool');

    assert.ok(toolResult);
    assert.strictEqual(toolResult.tool_call_id, 'call_456');
    assert.strictEqual(toolResult.content, 'Echo: test');
  });

  // ===========================================================================
  // Callbacks
  // ===========================================================================

  test('run - fires onToken callback', async () => {
    const tokens: string[] = [];
    
    mockLLM.setNextResponse({
      role: 'assistant',
      content: 'Hello World',
    });
    mockLLM.streamTokens = true;

    await agent.run('Hi', {
      onToken: (token) => tokens.push(token),
    });

    assert.ok(tokens.length > 0);
    assert.strictEqual(tokens.join(''), 'Hello World');
  });

  test('run - fires onToolCall callback', async () => {
    let toolCallId: string | undefined;

    mockLLM.setNextResponse({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_789',
        type: 'function',
        function: { name: 'test.echo', arguments: '{"message": "x"}' },
      }],
    });

    mockLLM.queueResponse({ role: 'assistant', content: 'Done' });

    await agent.run('Test', {
      onToolCall: (tc) => { toolCallId = tc.id; },
    });

    assert.strictEqual(toolCallId, 'call_789');
  });

  test('run - fires onComplete callback', async () => {
    let completed = false;
    let finalResponse = '';

    mockLLM.setNextResponse({ role: 'assistant', content: 'Finished' });

    await agent.run('Test', {
      onComplete: (response) => {
        completed = true;
        finalResponse = response;
      },
    });

    assert.strictEqual(completed, true);
    assert.strictEqual(finalResponse, 'Finished');
  });

  // ===========================================================================
  // Approval Flow
  // ===========================================================================

  test('run - requests approval for tools', async () => {
    // Register tool requiring approval
    registry.registerTool({
      id: 'test.dangerous',
      name: 'Dangerous',
      description: 'Needs approval',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'test.dangerous' },
      metadata: { requiresApproval: true },
    }, async () => ({ success: true, data: 'executed' }));

    let approvalRequested = false;

    mockLLM.setNextResponse({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_danger',
        type: 'function',
        function: { name: 'test.dangerous', arguments: '{}' },
      }],
    });

    mockLLM.queueResponse({ role: 'assistant', content: 'Done' });

    await agent.run('Do something dangerous', {
      onRequestApproval: async () => {
        approvalRequested = true;
        return true; // Approve
      },
    });

    assert.strictEqual(approvalRequested, true);
  });

  test('run - rejects tool when not approved', async () => {
    registry.registerTool({
      id: 'test.reject',
      name: 'Reject',
      description: 'Will be rejected',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'test.reject' },
      metadata: { requiresApproval: true },
    }, async () => ({ success: true, data: 'should not run' }));

    mockLLM.setNextResponse({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_reject',
        type: 'function',
        function: { name: 'test.reject', arguments: '{}' },
      }],
    });

    mockLLM.queueResponse({ role: 'assistant', content: 'Tool was rejected' });

    await agent.run('Try rejected tool', {
      onRequestApproval: async () => false, // Reject
    });

    const history = agent.getHistory();
    const toolResult = history.find(m => m.role === 'tool');

    assert.ok(toolResult);
    assert.ok(toolResult.content.includes('rejected'));
  });

  // ===========================================================================
  // Control Flow
  // ===========================================================================

  test('abort - stops the agent', async () => {
    mockLLM.setNextResponse({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_slow',
        type: 'function',
        function: { name: 'test.echo', arguments: '{"message": "slow"}' },
      }],
    });

    // This will run forever without abort
    mockLLM.queueResponse({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_slow2',
        type: 'function',
        function: { name: 'test.echo', arguments: '{"message": "slow2"}' },
      }],
    });

    // Abort after first tool call
    setTimeout(() => agent.abort(), 50);

    try {
      await agent.run('Loop forever');
      assert.fail('Should have thrown');
    } catch (e: any) {
      assert.ok(e.message.includes('aborted'));
    }
  });

  test('clear - resets history', async () => {
    mockLLM.setNextResponse({ role: 'assistant', content: 'Hello' });
    await agent.run('Hi');

    assert.ok(agent.getHistory().length > 0);

    agent.clear();

    assert.strictEqual(agent.getHistory().length, 0);
  });

  // ===========================================================================
  // Max Iterations
  // ===========================================================================

  test('run - respects maxIterations', async () => {
    // Create agent with low max iterations
    const limitedAgent = new AgentLoop(mockLLM, mockContext, { maxIterations: 2 });

    // Always return tool calls
    for (let i = 0; i < 5; i++) {
      mockLLM.queueResponse({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: `call_${i}`,
          type: 'function',
          function: { name: 'test.echo', arguments: '{"message": "loop"}' },
        }],
      });
    }

    await limitedAgent.run('Loop test');

    // Should stop at 2 iterations
    assert.strictEqual(mockLLM.callCount, 2);
  });
});

// ===========================================================================
// Mock LLM Provider
// ===========================================================================

class MockLLMProvider implements LLMProvider {
  readonly id = 'mock';
  readonly name = 'Mock LLM';

  private responses: Message[] = [];
  private currentIndex = 0;
  callCount = 0;
  streamTokens = false;

  setNextResponse(response: Message): void {
    this.responses = [response];
    this.currentIndex = 0;
  }

  queueResponse(response: Message): void {
    this.responses.push(response);
  }

  async chat(
    messages: Message[],
    options: { onToken?: (token: string) => void } = {}
  ): Promise<Message> {
    this.callCount++;

    const response = this.responses[this.currentIndex] || {
      role: 'assistant' as const,
      content: 'No response configured',
    };

    if (this.currentIndex < this.responses.length - 1) {
      this.currentIndex++;
    }

    // Simulate streaming
    if (this.streamTokens && options.onToken && response.content) {
      for (const char of response.content) {
        options.onToken(char);
        await new Promise(r => setTimeout(r, 1));
      }
    }

    return response;
  }
}

// ===========================================================================
// Test Helpers
// ===========================================================================

function createMockExtensionContext(): vscode.ExtensionContext {
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
    extension: {} as any,
    environmentVariableCollection: {} as any,
    secrets: {} as any,
    languageModelAccessInformation: {} as any,
  };
}
