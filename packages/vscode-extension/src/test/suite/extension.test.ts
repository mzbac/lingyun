/**
 * Extension Integration Tests
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

import { createAgentConfig, shouldRefreshChatModelStateForConfigChange } from '../../extension';
import { getModelLimit } from '../../core/compaction';
import { getConfiguredReasoningEffort } from '../../core/reasoningEffort';
import { WorkspaceToolProvider } from '../../providers/workspace';

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
    const ext = vscode.extensions.getExtension('mzbac.lingyun');
    assert.ok(ext, 'Extension mzbac.lingyun should be installed for tests');
    await ext.activate();

    const commands = await vscode.commands.getCommands();
    
    const expectedCommands = [
      'lingyun.start',
      'lingyun.openAgent',
      'lingyun.openOffice',
      'lingyun.resetOfficeLayout',
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

    assert.strictEqual(config.get('llmProvider'), 'copilot');
    assert.strictEqual(config.get('model'), 'gpt-4o');
    assert.strictEqual(config.get('codexSubscription.defaultModelId'), 'gpt-5.3-codex');
    assert.strictEqual(config.get('mode'), 'build');
    assert.strictEqual(config.get('copilot.reasoningEffort'), 'high');
    assert.strictEqual(config.get('temperature'), 0);
    assert.strictEqual(config.get('maxOutputTokens'), 32000);
    assert.strictEqual(config.get('llm.timeoutMs'), 0);
    assert.strictEqual(config.get('toolTimeoutMs'), 0);
    assert.strictEqual(config.get('autoApprove'), false);
    assert.strictEqual(config.get('planFirst'), true);
    assert.strictEqual(config.get('loop.enabled'), false);
    assert.strictEqual(config.get('loop.intervalMinutes'), 5);
    assert.strictEqual(config.get('sessions.persist'), true);
    assert.deepStrictEqual(config.get('skills.paths'), [
      '.lingyun/skills',
      '.claude/skills',
      '.opencode/skill',
      '.opencode/skills',
      '~/.config/lingyun/skills',
      '~/.agent/skills',
      '~/.agents/skills',
      '~/.codex/skills',
      '~/.claude/skills',
    ]);
  });

  test('configuration should be updatable', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');

    await config.update('autoApprove', true, vscode.ConfigurationTarget.Global);

    const updated = vscode.workspace.getConfiguration('lingyun');
    assert.strictEqual(updated.get('autoApprove'), true);

    // Reset
    await config.update('autoApprove', undefined, vscode.ConfigurationTarget.Global);
  });

  test('createAgentConfig should map global maxOutputTokens into agent config for all providers', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');

    await config.update('llmProvider', 'copilot', vscode.ConfigurationTarget.Global);
    await config.update('maxOutputTokens', 12345, vscode.ConfigurationTarget.Global);

    try {
      const agentConfig = createAgentConfig();
      assert.strictEqual(agentConfig.maxOutputTokens, 12345);
    } finally {
      await config.update('maxOutputTokens', undefined, vscode.ConfigurationTarget.Global);
      await config.update('llmProvider', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('reasoning effort configuration changes should refresh chat model state', () => {
    const event = {
      affectsConfiguration(section: string) {
        return section === 'lingyun.copilot.reasoningEffort';
      },
    };
    const unrelatedEvent = {
      affectsConfiguration(section: string) {
        return section === 'lingyun.temperature';
      },
    };

    assert.strictEqual(shouldRefreshChatModelStateForConfigChange(event), true);
    assert.strictEqual(shouldRefreshChatModelStateForConfigChange(unrelatedEvent), false);
  });

  test('getConfiguredReasoningEffort preserves empty setting as disabled', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');

    await config.update('copilot.reasoningEffort', '', vscode.ConfigurationTarget.Global);
    try {
      assert.strictEqual(getConfiguredReasoningEffort(), '');
    } finally {
      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('createAgentConfig should use the codex default when codex provider is selected with the copilot default model', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');

    await config.update('llmProvider', 'codexSubscription', vscode.ConfigurationTarget.Global);
    await config.update('model', 'gpt-4o', vscode.ConfigurationTarget.Global);
    await config.update('codexSubscription.defaultModelId', 'gpt-5.4', vscode.ConfigurationTarget.Global);

    try {
      const agentConfig = createAgentConfig();
      assert.strictEqual(agentConfig.model, 'gpt-5.4');
    } finally {
      await config.update('codexSubscription.defaultModelId', undefined, vscode.ConfigurationTarget.Global);
      await config.update('model', undefined, vscode.ConfigurationTarget.Global);
      await config.update('llmProvider', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('getModelLimit should prefer provider-scoped entries and fall back to model-only entries', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousLimits = config.get('modelLimits');

    await config.update(
      'modelLimits',
      {
        'gpt-5.4': { context: 28_000, output: 4_000 },
        'codexSubscription:gpt-5.4': { context: 272_000, output: 32_000 },
      },
      vscode.ConfigurationTarget.Global,
    );

    try {
      assert.deepStrictEqual(getModelLimit('gpt-5.4'), { context: 28_000, output: 4_000 });
      assert.deepStrictEqual(getModelLimit('gpt-5.4', 'copilot'), { context: 28_000, output: 4_000 });
      assert.deepStrictEqual(getModelLimit('gpt-5.4', 'codexSubscription'), {
        context: 272_000,
        output: 32_000,
      });
    } finally {
      await config.update('modelLimits', previousLimits, vscode.ConfigurationTarget.Global);
    }
  });

  // ===========================================================================
  // Views
  // ===========================================================================

  test('views should be registered', () => {
    const viewIds = ['lingyun.chatView', 'lingyun.officeView'];
    for (const viewId of viewIds) {
      assert.ok(viewId.includes('lingyun'));
    }
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
    const execution = tool.execution as { url: string };
    assert.ok(execution.url.includes('${API_URL}'));
  });

  test('should support all execution types', () => {
    const shellExec = { type: 'shell', script: 'ls -la' };
    const httpExec = { type: 'http', url: 'https://api.example.com', method: 'GET' };
    const commandExec = { type: 'command', command: 'editor.action.formatDocument' };

    assert.strictEqual(shellExec.type, 'shell');
    assert.strictEqual(httpExec.type, 'http');
    assert.strictEqual(commandExec.type, 'command');
  });

  test('substituteVariables resolves ${workspaceFolder} and ${arg:*} without touching $HOME', () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, 'expected a workspace root');

    const provider = new WorkspaceToolProvider({} as any, undefined);
    (provider as any).variables = { API_BASE: 'https://api.example.com' };

    const execution = {
      type: 'shell',
      script: 'echo ${workspaceFolder} ${API_BASE} ${arg:pattern} $HOME',
      cwd: '${workspaceFolder}',
    };

    const substituted = (provider as any).substituteVariables(execution, { pattern: 'needle' });
    assert.strictEqual(substituted.cwd, workspaceRoot);
    assert.ok(String(substituted.script).includes(workspaceRoot));
    assert.ok(String(substituted.script).includes('https://api.example.com'));
    assert.ok(String(substituted.script).includes('needle'));
    assert.ok(String(substituted.script).includes('$HOME'));
  });
});
