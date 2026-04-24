import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { TOOL_ERROR_CODES } from '@kooka/core';

import type { ToolCall, ToolDefinition, ToolResult } from '../../core/types';
import { createStandaloneChatController } from './chatControllerHarness';

const editToolDefinition: ToolDefinition = {
  id: 'edit',
  name: 'Edit',
  description: 'Edit file',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string' },
      oldString: { type: 'string' },
      newString: { type: 'string' },
    },
    required: ['filePath', 'oldString', 'newString'],
  },
  execution: { type: 'function', handler: 'test.edit' },
};

const readToolDefinition: ToolDefinition = {
  id: 'read',
  name: 'Read',
  description: 'Read file',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string' },
    },
    required: ['filePath'],
  },
  execution: { type: 'function', handler: 'test.read' },
};

const workspaceHttpToolDefinition: ToolDefinition = {
  id: 'workspace_kb_search',
  name: 'Knowledge Search',
  description: 'Search external knowledge base',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
  },
  execution: { type: 'http', url: 'https://kb.example.com/search', method: 'POST' },
  metadata: {
    category: 'workspace',
    requiresApproval: false,
  },
};

const skillToolDefinition: ToolDefinition = {
  id: 'skill',
  name: 'Skills',
  description: 'Load reusable task instructions',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
  },
  execution: { type: 'function', handler: 'builtin.skill' },
  metadata: {
    category: 'help',
    requiresApproval: false,
    permission: 'read',
    readOnly: true,
  },
};

function createToolLifecycleHarness() {
  const controller = createStandaloneChatController();
  const posted: unknown[] = [];

  controller.view = {} as vscode.WebviewView;
  controller.currentTurnId = 'turn-1';
  controller.mode = 'build';
  controller.currentModel = 'mock-model';
  controller.stepCounter = 0;
  controller.webviewApi.postMessage = (message: unknown) => {
    posted.push(message);
  };
  controller.sessionApi.isSessionPersistenceEnabled = () => false;
  controller.sessionApi.getContextForUI = () => ({}) as any;

  return {
    controller,
    posted,
    callbacks: controller.runnerCallbacksApi.createAgentCallbacks(),
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('timed out waiting for condition');
}

suite('Chat tool lifecycle callbacks', () => {
  test('glob results capture preview batch files and file-touch signals', async () => {
    const { controller, posted, callbacks } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-glob-1',
      type: 'function',
      function: { name: 'glob', arguments: JSON.stringify({ pattern: '**/*.ts' }) },
    };
    await callbacks.onToolCall?.(tc, {
      id: 'glob',
      name: 'Glob',
      description: 'Find files',
      parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
      execution: { type: 'function', handler: 'test.glob' },
    });

    const result: ToolResult = {
      success: true,
      data: {
        files: ['src/a.ts', 'src/b.ts'],
      },
      metadata: {
        outputText: ['src/a.ts', 'src/b.ts'].join('\n'),
      },
    };
    callbacks.onToolResult?.(tc, result);

    const toolMsg = controller.messages.find(message => message.toolCall?.approvalId === 'call-glob-1');
    assert.ok(toolMsg?.toolCall, 'expected tool message');
    assert.deepStrictEqual(toolMsg?.toolCall?.batchFiles, ['src/a.ts', 'src/b.ts']);
    assert.strictEqual(toolMsg?.toolCall?.additionalCount, 0);

    const signals = controller.signals;
    assert.ok(signals.filesTouched.includes('src/a.ts'), 'expected first file touch recorded');
    assert.ok(signals.filesTouched.includes('src/b.ts'), 'expected second file touch recorded');
    assert.ok(posted.some(message => (message as any)?.type === 'updateTool'), 'expected tool update');
  });

  test('failed tool results record failed-attempt structured memory', async () => {
    const { controller, callbacks } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-read-failure',
      type: 'function',
      function: { name: 'read', arguments: JSON.stringify({ filePath: '.env' }) },
    };
    await callbacks.onToolCall?.(tc, readToolDefinition);
    callbacks.onToolResult?.(tc, {
      success: false,
      error: 'permission denied',
      metadata: {},
    });

    assert.ok(
      controller.signals.structuredMemories.some(
        (item) => item.kind === 'failed_attempt' && item.text.toLowerCase().includes('permission denied'),
      ),
      'expected failed tool result to produce a failed_attempt structured memory',
    );
  });

  test('external tool context marks the session and suppresses derived memory capture', async () => {
    const { controller, callbacks } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-http-context',
      type: 'function',
      function: { name: 'workspace_kb_search', arguments: JSON.stringify({ query: 'deployment runbook' }) },
    };
    await callbacks.onToolCall?.(tc, workspaceHttpToolDefinition);
    const contextBeforeResult = controller.signals.memoryContext;
    assert.strictEqual(
      contextBeforeResult,
      undefined,
      'external context should only be marked after successful execution',
    );
    callbacks.onToolResult?.(tc, {
      success: true,
      data: 'Step 1: use the external deployment runbook. This must not become durable project memory.',
      metadata: {},
    });
    callbacks.onComplete?.('Use the external deployment runbook for this incident.');

    const contextAfterResult = controller.signals.memoryContext;
    assert.strictEqual(contextAfterResult?.external, true);
    assert.ok(contextAfterResult?.sources.includes('workspace_kb_search:http'));
    assert.strictEqual(
      controller.signals.structuredMemories.some((item) => item.text.includes('external deployment runbook')),
      false,
      'external tool and assistant text should not become structured memory',
    );
    assert.strictEqual(
      controller.signals.assistantOutcomes.some((item) => item.includes('external deployment runbook')),
      false,
      'assistant outcome should not be captured after external context enters the turn',
    );
  });

  test('failed external tool results do not taint the session or become memory signals', async () => {
    const { controller, callbacks } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-http-failure',
      type: 'function',
      function: { name: 'workspace_kb_search', arguments: JSON.stringify({ query: 'deployment runbook' }) },
    };
    await callbacks.onToolCall?.(tc, workspaceHttpToolDefinition);
    callbacks.onToolResult?.(tc, {
      success: false,
      error: '403 from external deployment runbook. This must not become a failed_attempt memory.',
      metadata: {},
    });
    callbacks.onComplete?.('The external deployment runbook request failed with 403.');

    assert.strictEqual(
      controller.signals.memoryContext,
      undefined,
      'failed external calls should not mark the whole session as external-context',
    );
    assert.deepStrictEqual(controller.signals.toolsUsed, []);
    assert.strictEqual(
      controller.signals.structuredMemories.some((item) => item.text.includes('external deployment runbook')),
      false,
      'failed external tool output should not become structured memory',
    );
    assert.strictEqual(
      controller.signals.assistantOutcomes.some((item) => item.includes('external deployment runbook')),
      false,
      'assistant outcome should not be captured after an external tool attempt in the turn',
    );
  });

  test('memory-excluded turns suppress tool and assistant memory signals', async () => {
    const { controller, callbacks } = createToolLifecycleHarness();
    controller.messages.push({
      id: 'turn-1',
      role: 'user',
      content: 'Do not use memory. Answer only from this prompt.',
      timestamp: Date.now(),
      memoryExcluded: true,
    });
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-read-memory-excluded',
      type: 'function',
      function: { name: 'read', arguments: JSON.stringify({ filePath: 'README.md' }) },
    };
    await callbacks.onToolCall?.(tc, readToolDefinition);
    callbacks.onToolResult?.(tc, {
      success: true,
      data: 'Prefer the temporary no-memory workflow for this prompt only.',
      metadata: {},
    });
    callbacks.onComplete?.('Prefer the temporary no-memory workflow for this prompt only.');

    assert.deepStrictEqual(controller.signals.toolsUsed, []);
    assert.deepStrictEqual(controller.signals.filesTouched, []);
    assert.strictEqual(controller.signals.structuredMemories.length, 0);
    assert.deepStrictEqual(controller.signals.assistantOutcomes, []);
  });

  test('skill tool results suppress memory signals', async () => {
    const { controller, callbacks } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-skill',
      type: 'function',
      function: { name: 'skill', arguments: JSON.stringify({ name: 'rollout-checklist' }) },
    };
    await callbacks.onToolCall?.(tc, skillToolDefinition);
    callbacks.onToolResult?.(tc, {
      success: true,
      data: [
        '## Skill: rollout-checklist',
        '',
        '**Base directory**: .lingyun/skills/rollout-checklist',
        '',
        'Step 1: use skill-tool-lifecycle-marker before release validation.',
      ].join('\n'),
      metadata: {},
    });

    assert.deepStrictEqual(controller.signals.toolsUsed, []);
    assert.deepStrictEqual(controller.signals.filesTouched, []);
    assert.strictEqual(
      controller.signals.structuredMemories.some((item) => item.text.includes('skill-tool-lifecycle-marker')),
      false,
      'loaded skill instructions should not become structured memory',
    );
  });

  test('tool blocked creates an error tool message when none exists for the current step', async () => {
    const { controller, callbacks } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-read-1',
      type: 'function',
      function: { name: 'read', arguments: JSON.stringify({ filePath: '.env' }) },
    };
    callbacks.onToolBlocked?.(
      tc,
      {
        id: 'read',
        name: 'Read',
        description: 'Read file',
        parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
        execution: { type: 'function', handler: 'test.read' },
      },
      'blocked by policy',
    );

    const toolMsg = controller.messages.find(message => message.toolCall?.approvalId === 'call-read-1');
    assert.ok(toolMsg?.toolCall, 'expected blocked tool message');
    assert.strictEqual(toolMsg?.toolCall?.status, 'error');
    assert.strictEqual(toolMsg?.toolCall?.result, 'blocked by policy');
  });

  test('edit results surface diff-unavailable when pre-image capture was skipped', async () => {
    const { controller, callbacks, posted } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-edit-before-skipped',
      type: 'function',
      function: {
        name: 'edit',
        arguments: JSON.stringify({ filePath: 'packages/vscode-extension/.tmp-before-skipped.txt', oldString: 'a', newString: 'b' }),
      },
    };
    await callbacks.onToolCall?.(tc, editToolDefinition);
    controller.toolDiffBeforeByToolCallId.set(tc.id, {
      absPath: 'packages/vscode-extension/.tmp-before-skipped.txt',
      displayPath: 'packages/vscode-extension/.tmp-before-skipped.txt',
      beforeText: '',
      isExternal: false,
      skippedReason: 'binary',
    });

    callbacks.onToolResult?.(tc, {
      success: true,
      data: 'Done',
      metadata: {},
    });

    const toolMsg = controller.messages.find(message => message.toolCall?.approvalId === tc.id);
    assert.ok(toolMsg?.toolCall, 'expected edit tool message');
    assert.strictEqual(toolMsg?.toolCall?.diffUnavailableReason, 'Diff unavailable (binary file)');
    assert.ok(posted.some(message => (message as any)?.type === 'updateTool'), 'expected tool update');
  });

  test('edit results surface diff-unavailable when post-image capture is too large', async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, 'expected workspace root');

    const absPath = path.join(
      workspaceRoot,
      `.tmp-chat-tool-lifecycle-large-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    );
    const relativePath = path.relative(workspaceRoot, absPath).split(path.sep).join('/');

    try {
      const { controller, callbacks } = createToolLifecycleHarness();
      await callbacks.onIterationStart?.(1);

      const tc: ToolCall = {
        id: 'call-edit-after-skipped',
        type: 'function',
        function: {
          name: 'edit',
          arguments: JSON.stringify({ filePath: relativePath, oldString: 'a', newString: 'b' }),
        },
      };
      await callbacks.onToolCall?.(tc, editToolDefinition);
      fs.writeFileSync(absPath, 'x'.repeat(450_000));

      callbacks.onToolResult?.(tc, {
        success: true,
        data: 'Done',
        metadata: {},
      });

      await waitFor(() => {
        const toolMsg = controller.messages.find(message => message.toolCall?.approvalId === tc.id);
        return toolMsg?.toolCall?.diffUnavailableReason === 'Diff unavailable (file too large)';
      });

      const toolMsg = controller.messages.find(message => message.toolCall?.approvalId === tc.id);
      assert.strictEqual(toolMsg?.toolCall?.diffUnavailableReason, 'Diff unavailable (file too large)');
    } finally {
      fs.rmSync(absPath, { force: true });
    }
  });

  test('tool results surface shared UI hint fields through common parsing', async () => {
    const { controller, callbacks } = createToolLifecycleHarness();
    await callbacks.onIterationStart?.(1);

    const tc: ToolCall = {
      id: 'call-read-ui-hints',
      type: 'function',
      function: { name: 'read', arguments: JSON.stringify({ filePath: '.env' }) },
    };
    await callbacks.onToolCall?.(tc, readToolDefinition);

    const todos = [{ id: 'todo-1', content: 'review tool result' }];
    callbacks.onToolResult?.(tc, {
      success: false,
      error: 'blocked by policy',
      data: {
        diff: '--- before\n+++ after',
        isProtected: true,
        isOutsideWorkspace: true,
      },
      metadata: {
        outputText: 'Blocked by policy',
        errorCode: TOOL_ERROR_CODES.external_paths_disabled,
        blockedSettingKey: 'lingyun.security.allowExternalPaths',
        isOutsideWorkspace: true,
        todos,
      },
    });

    const toolMsg = controller.messages.find(message => message.toolCall?.approvalId === tc.id);
    assert.ok(toolMsg?.toolCall, 'expected tool message');
    assert.strictEqual(toolMsg?.toolCall?.diff, '--- before\n+++ after');
    assert.strictEqual(toolMsg?.toolCall?.isProtected, true);
    assert.strictEqual(toolMsg?.toolCall?.isOutsideWorkspace, true);
    assert.strictEqual(toolMsg?.toolCall?.blockedReason, 'external_paths_disabled');
    assert.strictEqual(toolMsg?.toolCall?.blockedSettingKey, 'lingyun.security.allowExternalPaths');
    assert.deepStrictEqual(toolMsg?.toolCall?.todos, todos);
  });
});
