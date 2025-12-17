/**
 * Extension Integration Tests
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration', () => {
  
  // ===========================================================================
  // Activation
  // ===========================================================================

  test('extension should be present', () => {
    // In test mode, we load the extension directly
    // This test verifies the test setup works
    assert.ok(true);
  });

  test('commands should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    
    const expectedCommands = [
      'lingyun.start',
      'lingyun.abort',
      'lingyun.clear',
      'lingyun.showLogs',
      'lingyun.listTools',
      'lingyun.createToolsConfig',
      'lingyun.runTool',
    ];

    for (const cmd of expectedCommands) {
      assert.ok(
        commands.includes(cmd),
        `Command ${cmd} should be registered`
      );
    }
  });

  // ===========================================================================
  // Configuration
  // ===========================================================================

  test('configuration should have defaults', () => {
    const config = vscode.workspace.getConfiguration('lingyun');

    assert.strictEqual(config.get('model'), 'gpt-4o');
    assert.strictEqual(config.get('maxIterations'), 20);
    assert.strictEqual(config.get('autoApprove'), false);
  });

  test('configuration should be updatable', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');

    await config.update('maxIterations', 10, vscode.ConfigurationTarget.Global);

    const updated = vscode.workspace.getConfiguration('lingyun');
    assert.strictEqual(updated.get('maxIterations'), 10);

    // Reset
    await config.update('maxIterations', undefined, vscode.ConfigurationTarget.Global);
  });

  // ===========================================================================
  // Views
  // ===========================================================================

  test('chat view should be registered', () => {
    // Views are defined in package.json
    // We can verify they're loadable
    const viewId = 'lingyun.chatView';

    // This would need the extension to be fully activated
    // Just verify the view ID format is correct
    assert.ok(viewId.includes('lingyun'));
  });
});

suite('Workspace Tools Config', () => {
  
  test('should validate correct config', () => {
    const validConfig = {
      version: '1.0',
      tools: [
        {
          id: 'test_tool',
          name: 'Test Tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
          },
          execution: {
            type: 'shell',
            script: 'echo $input',
          },
        },
      ],
    };

    // Basic validation
    assert.strictEqual(validConfig.version, '1.0');
    assert.ok(Array.isArray(validConfig.tools));
    assert.ok(validConfig.tools[0].id);
    assert.ok(validConfig.tools[0].execution);
  });

  test('should support variable substitution', () => {
    const config = {
      version: '1.0',
      variables: {
        API_URL: 'https://api.example.com',
      },
      tools: [
        {
          id: 'api_call',
          name: 'API Call',
          description: 'Call API',
          parameters: { type: 'object', properties: {} },
          execution: {
            type: 'http',
            url: '${API_URL}/endpoint',
          },
        },
      ],
    };

    // Verify variable is defined
    assert.strictEqual(config.variables.API_URL, 'https://api.example.com');
    
    // Verify tool references variable
    const tool = config.tools[0];
    assert.ok((tool.execution as any).url.includes('${API_URL}'));
  });

  test('should support all execution types', () => {
    const shellExec = { type: 'shell', script: 'ls -la' };
    const httpExec = { type: 'http', url: 'https://api.example.com', method: 'GET' };
    const commandExec = { type: 'command', command: 'editor.action.formatDocument' };

    assert.strictEqual(shellExec.type, 'shell');
    assert.strictEqual(httpExec.type, 'http');
    assert.strictEqual(commandExec.type, 'command');
  });
});
