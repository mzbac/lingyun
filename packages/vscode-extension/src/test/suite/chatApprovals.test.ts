import * as assert from 'assert';
import * as vscode from 'vscode';

import { loadAutoApprovedTools, persistAutoApprovedTools } from '../../ui/chat/autoApprovedToolsStore';

import { createChatTestExtensionContext, createStandaloneChatController } from './chatControllerHarness';

suite('Chat approvals service', () => {
  test('approveAllPendingApprovals leaves manual approvals pending', () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];

    controller.view = {} as vscode.WebviewView;
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };

    let normalResolved: boolean | undefined;
    let manualResolved: boolean | undefined;

    controller.pendingApprovals.set('normal-1', {
      resolve: (approved: boolean) => {
        normalResolved = approved;
      },
      toolName: 'read',
    });
    controller.pendingApprovals.set('manual-1', {
      resolve: (approved: boolean) => {
        manualResolved = approved;
      },
      toolName: 'read',
      approvalContext: {
        manual: true,
        reason: 'Protected dotenv access requires manual approval.',
        decision: 'require_manual_approval',
      },
    });

    controller.approvalsApi.approveAllPendingApprovals({ includeManual: false });

    assert.strictEqual(normalResolved, true);
    assert.strictEqual(manualResolved, undefined);
    assert.strictEqual(controller.pendingApprovals.size, 1);
    assert.ok(controller.pendingApprovals.has('manual-1'));

    const approvalState = posted.find((message) => (message as any)?.type === 'approvalsChanged') as any;
    assert.ok(approvalState, 'expected approvalsChanged update');
    assert.strictEqual(approvalState.count, 1);
    assert.strictEqual(approvalState.manualCount, 1);
  });

  test('requestInlineApproval marks manual approvals protected and stores approvalReason', async () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];

    controller.view = {} as vscode.WebviewView;
    controller.currentTurnId = 'turn-1';
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };

    const approvalPromise = controller.approvalsApi.requestInlineApproval(
      {
        id: 'call-1',
        type: 'function',
        function: {
          name: 'read',
          arguments: JSON.stringify({ filePath: '.env' }),
        },
      },
      {
        id: 'read',
        name: 'Read File',
        description: 'Reads a file',
        parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
        execution: { type: 'function', handler: 'test.read' },
      },
      undefined,
      {
        manual: true,
        reason: 'Protected dotenv access requires manual approval.',
        decision: 'require_manual_approval',
        metadata: { dotEnvTargets: ['.env'] },
      },
    );

    assert.strictEqual(controller.pendingApprovals.size, 1);
    const toolMessage = controller.messages.find((message) => message.toolCall?.approvalId === 'call-1');
    assert.ok(toolMessage?.toolCall, 'expected pending tool message');
    assert.strictEqual(toolMessage?.toolCall?.isProtected, true);
    assert.strictEqual(toolMessage?.toolCall?.approvalReason, 'Protected dotenv access requires manual approval.');

    controller.approvalsApi.handleApprovalResponse('call-1', true);
    assert.strictEqual(await approvalPromise, true);

    const approvalState = posted.find((message) => (message as any)?.type === 'approvalsChanged') as any;
    assert.ok(approvalState, 'expected approvalsChanged update');
    assert.strictEqual(approvalState.manualCount, 1);
  });

  test('handleAlwaysAllowApproval persists the pending tool name for non-manual approvals only', async () => {
    const controller = createStandaloneChatController();

    let normalResolved: boolean | undefined;
    let manualResolved: boolean | undefined;

    controller.pendingApprovals.set('normal-1', {
      resolve: (approved: boolean) => {
        normalResolved = approved;
      },
      toolName: 'grep',
    });
    controller.pendingApprovals.set('manual-1', {
      resolve: (approved: boolean) => {
        manualResolved = approved;
      },
      toolName: 'read',
      approvalContext: {
        manual: true,
        reason: 'Protected dotenv access requires manual approval.',
        decision: 'require_manual_approval',
      },
    });

    await controller.approvalsApi.handleAlwaysAllowApproval('normal-1');
    await controller.approvalsApi.handleAlwaysAllowApproval('manual-1');

    assert.strictEqual(normalResolved, true);
    assert.strictEqual(manualResolved, true);
    assert.strictEqual(controller.autoApprovedTools.has('grep'), true);
    assert.strictEqual(controller.autoApprovedTools.has('read'), false);
    assert.deepStrictEqual((controller.context.globalState as any).get('autoApprovedTools'), ['grep']);
  });

  test('handleAlwaysAllowApproval still resolves approval when persisting auto-allow fails', async () => {
    const controller = createStandaloneChatController();

    let resolved: boolean | undefined;
    const globalState = controller.context.globalState as any;
    globalState.update = (_key: string, _value: unknown) => Promise.reject(new Error('persist failed'));

    controller.pendingApprovals.set('normal-1', {
      resolve: (approved: boolean) => {
        resolved = approved;
      },
      toolName: 'grep',
    });

    await controller.approvalsApi.handleAlwaysAllowApproval('normal-1');

    assert.strictEqual(resolved, true);
    assert.strictEqual(controller.pendingApprovals.size, 0);
    assert.strictEqual(controller.autoApprovedTools.has('grep'), true);
    assert.strictEqual((controller.context.globalState as any).get('autoApprovedTools'), undefined);
  });

  test('handleAlwaysAllowApproval ignores stale approval ids without persisting', async () => {
    const controller = createStandaloneChatController();

    await controller.approvalsApi.handleAlwaysAllowApproval('missing-approval');

    assert.strictEqual(controller.autoApprovedTools.size, 0);
    assert.strictEqual((controller.context.globalState as any).get('autoApprovedTools'), undefined);
  });

  test('handleAlwaysAllowApproval normalizes remembered tool ids in memory before persisting', async () => {
    const controller = createStandaloneChatController();
    let resolved: boolean | undefined;

    controller.autoApprovedTools = new Set([' grep ']);
    controller.pendingApprovals.set('normal-1', {
      resolve: (approved: boolean) => {
        resolved = approved;
      },
      toolName: 'grep',
    });

    await controller.approvalsApi.handleAlwaysAllowApproval('normal-1');

    assert.strictEqual(resolved, true);
    assert.deepStrictEqual([...controller.autoApprovedTools], ['grep']);
    assert.deepStrictEqual((controller.context.globalState as any).get('autoApprovedTools'), ['grep']);
  });

  test('handleAlwaysAllowApproval retries persistence even when the tool is already remembered', async () => {
    const controller = createStandaloneChatController();
    let resolved: boolean | undefined;

    controller.autoApprovedTools = new Set(['grep']);
    controller.pendingApprovals.set('normal-1', {
      resolve: (approved: boolean) => {
        resolved = approved;
      },
      toolName: 'grep',
    });

    await controller.approvalsApi.handleAlwaysAllowApproval('normal-1');

    assert.strictEqual(resolved, true);
    assert.deepStrictEqual([...controller.autoApprovedTools], ['grep']);
    assert.deepStrictEqual((controller.context.globalState as any).get('autoApprovedTools'), ['grep']);
  });

  test('loadAutoApprovedTools normalizes malformed persisted values', () => {
    const loaded = loadAutoApprovedTools({
      get: () => [' grep ', '', 'read', 'grep', 42, '   '] as unknown as string[],
    });

    assert.deepStrictEqual([...loaded], ['grep', 'read']);
  });

  test('controller loads persisted auto-approved tools through the shared store contract', async () => {
    const context = createChatTestExtensionContext();
    await persistAutoApprovedTools({
      globalState: context.globalState,
      autoApprovedTools: new Set([' grep ', 'read', 'grep']),
    });

    const controller = createStandaloneChatController({ context });

    assert.deepStrictEqual([...controller.autoApprovedTools].sort(), ['grep', 'read']);
  });
});
