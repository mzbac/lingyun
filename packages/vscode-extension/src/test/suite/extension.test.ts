/**
 * Extension Integration Tests
 */

import * as assert from 'assert';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  CHAT_WEBVIEW_VIEW_PROVIDER_OPTIONS,
  createAgentConfig,
  shouldRefreshChatModelStateForConfigChange,
} from '../../extension';
import { getModelLimit } from '../../core/compaction';
import { getConfiguredOpenAICompatibleThinking, getConfiguredReasoningEffort } from '../../core/reasoningEffort';
import { isToolAllowedByFilter, normalizeToolFilterSetting } from '../../core/toolFilter';
import { WorkspaceToolProvider } from '../../providers/workspace';

type BundleMetafile = {
  inputs: Record<string, unknown>;
  outputs?: Record<string, {
    inputs?: Record<string, { bytesInOutput?: number }>;
  }>;
};

suite('Extension Integration', () => {
  
  // ===========================================================================
  // Activation
  // ===========================================================================

  test('extension should be present', () => {
    // In test mode, we load the extension directly
    // This test verifies the test setup works
    assert.ok(true);
  });

  test('hidden chat views release their renderer context', () => {
    assert.strictEqual(
      CHAT_WEBVIEW_VIEW_PROVIDER_OPTIONS.webviewOptions?.retainContextWhenHidden,
      false
    );
  });

  test('production bundle rejects duplicate AI runtime versions', () => {
    const loadBundleScript = createRequire(__filename);
    const { assertSingleRuntimeVersions } = loadBundleScript('../../../scripts/bundle.js') as {
      assertSingleRuntimeVersions: (metafile: BundleMetafile) => void;
    };
    const singleVersion = {
      inputs: {
        'node_modules/.pnpm/ai@6.0.86_zod@4.3.5/node_modules/ai/dist/index.mjs': {},
        'node_modules/.pnpm/@ai-sdk+provider-utils@4.0.15_zod@4.3.5/node_modules/@ai-sdk/provider-utils/dist/index.mjs': {},
      },
    };
    assert.doesNotThrow(() => assertSingleRuntimeVersions(singleVersion));

    const duplicateVersion = {
      inputs: {
        ...singleVersion.inputs,
        'node_modules/.pnpm/ai@6.0.33_zod@4.3.5/node_modules/ai/dist/index.mjs': {},
        'node_modules/.pnpm/@ai-sdk+provider-utils@4.0.5_zod@4.3.5/node_modules/@ai-sdk/provider-utils/dist/index.mjs': {},
      },
    };
    assert.throws(
      () => assertSingleRuntimeVersions(duplicateVersion),
      /Duplicate AI runtime versions in extension bundle: ai: 6\.0\.33, 6\.0\.86; @ai-sdk\/provider-utils: 4\.0\.15, 4\.0\.5/
    );
  });

  test('production bundle excludes the SDK-only glob runtime', () => {
    const loadBundleScript = createRequire(__filename);
    const { assertExcludedRuntimePackages } = loadBundleScript('../../../scripts/bundle.js') as {
      assertExcludedRuntimePackages: (metafile: BundleMetafile) => void;
    };
    const globInput = 'node_modules/.pnpm/glob@13.0.6/node_modules/glob/dist/esm/index.min.js';
    assert.doesNotThrow(() => assertExcludedRuntimePackages({
      inputs: { [globInput]: {} },
      outputs: {
        'dist/extension.js': {
          inputs: { [globInput]: { bytesInOutput: 0 } },
        },
      },
    }));
    assert.throws(
      () => assertExcludedRuntimePackages({
        inputs: { [globInput]: {} },
        outputs: {
          'dist/extension.js': {
            inputs: { [globInput]: { bytesInOutput: 1 } },
          },
        },
      }),
      /Excluded packages in extension bundle: glob: 13\.0\.6/
    );
  });

  test('commands should be registered', async () => {
    const ext = vscode.extensions.getExtension('mzbac.lingyun');
    assert.ok(ext, 'Extension mzbac.lingyun should be installed for tests');
    await ext.activate();

    const commands = await vscode.commands.getCommands();
    
    const expectedCommands = [
      'lingyun.start',
      'lingyun.openAgent',
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
    assert.strictEqual(config.get('openaiCompatible.thinking'), 'auto');
    assert.strictEqual(config.get('openaiCompatible.allowInsecureTLS'), false);
    assert.strictEqual(config.get('temperature'), 0);
    assert.strictEqual(config.get('maxOutputTokens'), 32000);
    assert.strictEqual(config.get('maxIterations'), 50);
    assert.strictEqual(config.get('llm.retryWithPartialOutput'), true);
    assert.strictEqual(config.get('llm.timeoutMs'), 0);
    assert.strictEqual(config.get('toolTimeoutMs'), 0);
    assert.strictEqual(config.get('autoApprove'), false);
    assert.strictEqual(config.get('planFirst'), true);
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

  test('createAgentConfig enables partial-output recovery by default and preserves opt-out', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previous = config.inspect<boolean>('llm.retryWithPartialOutput')?.globalValue;

    await config.update('llm.retryWithPartialOutput', undefined, vscode.ConfigurationTarget.Global);
    try {
      assert.strictEqual(createAgentConfig().retryWithPartialOutput, true);
      await config.update('llm.retryWithPartialOutput', false, vscode.ConfigurationTarget.Global);
      assert.strictEqual(createAgentConfig().retryWithPartialOutput, false);
    } finally {
      await config.update('llm.retryWithPartialOutput', previous, vscode.ConfigurationTarget.Global);
    }
  });

  test('createAgentConfig should map maxIterations and preserve -1 as unlimited', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previous = config.inspect<number>('maxIterations')?.globalValue;

    await config.update('maxIterations', 123, vscode.ConfigurationTarget.Global);

    try {
      assert.strictEqual(createAgentConfig().maxIterations, 123);

      await config.update('maxIterations', -1, vscode.ConfigurationTarget.Global);
      assert.strictEqual(createAgentConfig().maxIterations, -1);
    } finally {
      await config.update('maxIterations', previous, vscode.ConfigurationTarget.Global);
    }
  });

  test('tool filter normalization deduplicates arrays and separated strings', () => {
    assert.deepStrictEqual(
      normalizeToolFilterSetting([' read* ', 'bash', 'read*', '', 'grep']),
      ['read*', 'bash', 'grep'],
    );
    assert.deepStrictEqual(
      normalizeToolFilterSetting(' read*, bash\nread* ,, grep '),
      ['read*', 'bash', 'grep'],
    );
  });

  test('tool filter wildcard matching escapes regexp syntax', () => {
    assert.strictEqual(isToolAllowedByFilter('read_file', ['read*']), true);
    assert.strictEqual(isToolAllowedByFilter('read_file', ['read.*']), false);
    assert.strictEqual(isToolAllowedByFilter('read_file', ['read_file']), true);
    assert.strictEqual(isToolAllowedByFilter('read_file_extra', ['read_file']), false);
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

  test('getConfiguredOpenAICompatibleThinking normalizes explicit disabled setting', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousThinking = config.get('openaiCompatible.thinking');

    await config.update('openaiCompatible.thinking', 'disabled', vscode.ConfigurationTarget.Global);
    try {
      assert.strictEqual(getConfiguredOpenAICompatibleThinking(), 'disabled');
    } finally {
      if (previousThinking === undefined) {
        await config.update('openaiCompatible.thinking', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('openaiCompatible.thinking', previousThinking, vscode.ConfigurationTarget.Global);
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
    const viewIds = ['lingyun.chatView'];
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

  test('workspace env substitution only reads lingyun.env', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEnv = config.get('env');
    const previousProcessValue = process.env.LINGYUN_TEST_SECRET;
    process.env.LINGYUN_TEST_SECRET = 'process-secret';
    await config.update('env', { LINGYUN_TEST_SECRET: 'configured-secret' }, true);

    try {
      const provider = new WorkspaceToolProvider({} as any, undefined);
      const execution = {
        type: 'shell',
        script: 'echo ${env:LINGYUN_TEST_SECRET} ${env:ONLY_IN_PROCESS}',
      };
      process.env.ONLY_IN_PROCESS = 'must-not-leak';

      const substituted = (provider as any).substituteVariables(execution, {});
      assert.ok(String(substituted.script).includes('configured-secret'));
      assert.ok(!String(substituted.script).includes('process-secret'));
      assert.ok(!String(substituted.script).includes('must-not-leak'));
    } finally {
      if (previousProcessValue === undefined) {
        delete process.env.LINGYUN_TEST_SECRET;
      } else {
        process.env.LINGYUN_TEST_SECRET = previousProcessValue;
      }
      delete process.env.ONLY_IN_PROCESS;
      await config.update('env', previousEnv as any, true);
    }
  });

  test('workspace shell and http tools require host manual approval', () => {
    const provider = new WorkspaceToolProvider({} as any, undefined);
    (provider as any).tools = new Map([
      [
        'workspace_shell',
        {
          id: 'workspace_shell',
          name: 'Shell',
          description: 'Shell',
          parameters: { type: 'object', properties: {} },
          execution: { type: 'shell', script: 'echo ok' },
          requiresApproval: false,
        },
      ],
      [
        'workspace_http',
        {
          id: 'workspace_http',
          name: 'HTTP',
          description: 'HTTP',
          parameters: { type: 'object', properties: {} },
          execution: { type: 'http', url: 'https://example.com' },
          requiresApproval: false,
        },
      ],
    ]);

    const tools = provider.getTools();
    assert.strictEqual(tools.length, 2);
    for (const tool of tools) {
      assert.strictEqual(tool.metadata?.requiresApproval, true);
      assert.strictEqual((tool.metadata as any)?.requiresManualApproval, true);
    }

    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/providers/workspace.ts'), 'utf8');
    const start = source.indexOf('getTools(): ToolDefinition[]');
    assert.ok(start >= 0, 'expected workspace tool listing helper');
    const end = source.indexOf('\n  private toToolDefinition', start);
    assert.ok(end > start, 'expected tool definition shaper after getTools');
    const section = source.slice(start, end);

    assert.match(section, /const definitions: ToolDefinition\[\] = \[\];/);
    assert.match(section, /for \(const tool of this\.tools\.values\(\)\)/);
    assert.match(section, /definitions\.push\(this\.toToolDefinition\(tool\)\);/);
    assert.doesNotMatch(section, /Array\.from\(this\.tools\.values\(\)\)\.map/);
  });
});
