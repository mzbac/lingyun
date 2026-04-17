import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { createBlankSessionSignals } from '../../core/sessionSignals';
import {
  WEBVIEW_MESSAGE_ERROR,
  WEBVIEW_MESSAGE_READY,
} from '../../ui/chat/webviewProtocol';
import { createStandaloneChatController } from './chatControllerHarness';

suite('Chat webview loop integration', () => {
  test('sendInit includes the configured reasoning effort in the header payload', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');
    await config.update('copilot.reasoningEffort', 'low', vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];

      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return true;
          },
        },
      } as unknown as vscode.WebviewView;
      controller.currentModel = 'gpt-5.4';
      controller.availableModels = [{ id: 'gpt-5.4', name: 'GPT-5.4' } as any];
      controller.sessionApi.ensureSessionsLoaded = async () => {};
      controller.skillsApi.getSkillNamesForUI = async () => [];

      await controller.webviewApi.sendInit(true);

      const initMessage = posted.find(message => (message as any)?.type === 'init') as any;
      assert.ok(initMessage, 'expected sendInit to post an init message');
      assert.strictEqual(initMessage.currentModel, 'gpt-5.4');
      assert.strictEqual(initMessage.currentModelLabel, 'GPT-5.4');
      assert.strictEqual(initMessage.currentReasoningEffort, 'low');
      assert.strictEqual(initMessage.pendingApprovals, 0);
      assert.strictEqual(initMessage.manualApprovals, 0);
    } finally {
      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('configureLoop webview message routes to the active-session loop configurator', async () => {
    const controller = createStandaloneChatController();

    controller.viewDisposables = [];
    controller.activeSessionId = 'session-1';
    controller.currentModel = 'mock-model';
    controller.mode = 'build';
    controller.context = {
      extensionUri: vscode.Uri.file('/Users/anchenli/dev/lingyun.public/packages/vscode-extension'),
    } as vscode.ExtensionContext;
    controller.signals = createBlankSessionSignals();
    controller.messages = [];
    controller.sessions = new Map([
      [
        controller.activeSessionId,
        {
          id: controller.activeSessionId,
          title: 'Test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          signals: controller.signals,
          messages: controller.messages,
          agentState: controller.sessionApi.getBlankAgentState(),
          currentModel: controller.currentModel,
          mode: controller.mode,
          stepCounter: 0,
          queuedInputs: [],
          loop: {
            enabled: false,
            intervalMinutes: 5,
            prompt: 'review your recent activity - has it been in alignment with our principles? ./AGENTS.md',
          },
          runtime: { wasRunning: false, updatedAt: Date.now() },
        },
      ],
    ]);

    let configureCalls = 0;
    controller.loopApi.configureLoopForActiveSession = async () => {
      configureCalls++;
    };
    controller.webviewApi.getHtml = () => '';
    controller.webviewApi.startInitPusher = () => {};

    let onMessage: ((data: unknown) => void | Promise<void>) | undefined;
    const disposable = { dispose() {} };
    const webview = {
      options: {},
      html: '',
      cspSource: 'test-csp',
      postMessage: () => true,
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: (listener: (data: unknown) => void | Promise<void>) => {
        onMessage = listener;
        return disposable;
      },
    } as unknown as vscode.Webview;
    const view = {
      webview,
      visible: true,
      onDidChangeVisibility: () => disposable,
      onDidDispose: () => disposable,
    } as unknown as vscode.WebviewView;

    controller.webviewApi.resolveWebviewView(view);
    assert.ok(onMessage, 'expected resolveWebviewView to register a webview message handler');

    await onMessage?.({ type: 'configureLoop' });

    assert.strictEqual(configureCalls, 1);
  });

  test('getHtml injects the shared chat protocol bootstrap before browser scripts', () => {
    const controller = createStandaloneChatController();
    const webview = {
      cspSource: 'test-csp',
      asWebviewUri: (uri: unknown) => uri,
    } as unknown as vscode.Webview;

    const html = controller.webviewApi.getHtml(webview);
    const protocolIndex = html.indexOf('window.LINGYUN_CHAT_PROTOCOL = Object.freeze(');
    const bootstrapIndex = html.indexOf('bootstrap.js');
    const mainIndex = html.indexOf('main.js');

    assert.ok(protocolIndex >= 0, 'expected injected chat protocol bootstrap script');
    assert.ok(bootstrapIndex > protocolIndex, 'expected protocol bootstrap to precede bootstrap.js');
    assert.ok(mainIndex > bootstrapIndex, 'expected main.js to remain after bootstrap.js');
  });

  test('approveAll webview message keeps manual approvals pending through the controller adapter', async () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];

    controller.viewDisposables = [];
    controller.webviewApi.getHtml = () => '';
    controller.webviewApi.startInitPusher = () => {};

    let normalResolved: boolean | undefined;
    let manualResolved: boolean | undefined;
    let onMessage: ((data: unknown) => void | Promise<void>) | undefined;
    const disposable = { dispose() {} };
    const webview = {
      options: {},
      html: '',
      cspSource: 'test-csp',
      postMessage(message: unknown) {
        posted.push(message);
        return true;
      },
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: (listener: (data: unknown) => void | Promise<void>) => {
        onMessage = listener;
        return disposable;
      },
    } as unknown as vscode.Webview;
    const view = {
      webview,
      visible: true,
      onDidChangeVisibility: () => disposable,
      onDidDispose: () => disposable,
    } as unknown as vscode.WebviewView;

    controller.webviewApi.resolveWebviewView(view);
    assert.ok(onMessage, 'expected resolveWebviewView to register a webview message handler');

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

    await onMessage?.({ type: 'approveAll' });

    assert.strictEqual(normalResolved, true);
    assert.strictEqual(manualResolved, undefined);
    assert.strictEqual(controller.pendingApprovals.size, 1);
    assert.ok(controller.pendingApprovals.has('manual-1'));

    const approvalState = posted.find((message) => (message as any)?.type === 'approvalsChanged') as any;
    assert.ok(approvalState, 'expected approvalsChanged update');
    assert.strictEqual(approvalState.count, 1);
    assert.strictEqual(approvalState.manualCount, 1);
  });

  test('alwaysAllowTool webview message does not persist auto-allow for manual approvals', async () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];

    controller.viewDisposables = [];
    controller.webviewApi.getHtml = () => '';
    controller.webviewApi.startInitPusher = () => {};

    let manualResolved: boolean | undefined;
    let onMessage: ((data: unknown) => void | Promise<void>) | undefined;
    const disposable = { dispose() {} };
    const webview = {
      options: {},
      html: '',
      cspSource: 'test-csp',
      postMessage(message: unknown) {
        posted.push(message);
        return true;
      },
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: (listener: (data: unknown) => void | Promise<void>) => {
        onMessage = listener;
        return disposable;
      },
    } as unknown as vscode.Webview;
    const view = {
      webview,
      visible: true,
      onDidChangeVisibility: () => disposable,
      onDidDispose: () => disposable,
    } as unknown as vscode.WebviewView;

    controller.webviewApi.resolveWebviewView(view);
    assert.ok(onMessage, 'expected resolveWebviewView to register a webview message handler');

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

    await onMessage?.({ type: 'alwaysAllowTool', approvalId: 'manual-1' });

    assert.strictEqual(manualResolved, true);
    assert.strictEqual(controller.pendingApprovals.size, 0);
    assert.strictEqual(controller.autoApprovedTools.has('read'), false);
    assert.strictEqual((controller.context.globalState as any).get('autoApprovedTools'), undefined);

    const approvalState = posted.find((message) => (message as any)?.type === 'approvalsChanged') as any;
    assert.ok(approvalState, 'expected approvalsChanged update');
    assert.strictEqual(approvalState.count, 0);
    assert.strictEqual(approvalState.manualCount, 0);
  });

  test('resolveWebviewView writes lifecycle state through the controller adapter', async () => {
    const controller = createStandaloneChatController();
    let previousDisposed = 0;
    controller.viewDisposables = [{ dispose: () => previousDisposed++ } as vscode.Disposable];
    controller.initAcked = true;
    controller.webviewClientInstanceId = 'stale-client';
    controller.webviewCrashToastClientId = 'stale-client';

    let onMessage: ((data: unknown) => void | Promise<void>) | undefined;
    let onVisibility: (() => void) | undefined;
    let onDispose: (() => void) | undefined;
    const disposable = { dispose() {} };
    const webview = {
      options: {},
      html: '',
      cspSource: 'test-csp',
      postMessage: () => true,
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: (listener: (data: unknown) => void | Promise<void>) => {
        onMessage = listener;
        return disposable;
      },
    } as unknown as vscode.Webview;
    const view = {
      webview,
      visible: true,
      onDidChangeVisibility: (listener: () => void) => {
        onVisibility = listener;
        return disposable;
      },
      onDidDispose: (listener: () => void) => {
        onDispose = listener;
        return disposable;
      },
    } as unknown as vscode.WebviewView;

    try {
      controller.webviewApi.resolveWebviewView(view);

      assert.strictEqual(previousDisposed, 1);
      assert.strictEqual(controller.view, view);
      assert.strictEqual(controller.initAcked, false);
      assert.strictEqual(controller.webviewClientInstanceId, undefined);
      assert.strictEqual(controller.webviewCrashToastClientId, undefined);
      assert.ok(typeof onMessage === 'function');
      assert.ok(typeof onVisibility === 'function');
      assert.ok(typeof onDispose === 'function');
      assert.ok(controller.viewDisposables.length >= 3);
      assert.ok(controller.initInterval, 'expected resolveWebviewView to start the init pusher');

      const firstInterval = controller.initInterval;
      (view as any).visible = false;
      onVisibility?.();
      assert.strictEqual(controller.initInterval, undefined);

      controller.initAcked = false;
      (view as any).visible = true;
      onVisibility?.();
      assert.ok(controller.initInterval, 'expected visible webview to restart init pusher');
      assert.notStrictEqual(controller.initInterval, firstInterval);

      controller.webviewClientInstanceId = 'client-1';
      controller.webviewCrashToastClientId = 'client-1';
      controller.initAcked = true;
      onDispose?.();

      assert.strictEqual(controller.view, undefined);
      assert.strictEqual(controller.initAcked, false);
      assert.strictEqual(controller.webviewClientInstanceId, undefined);
      assert.strictEqual(controller.webviewCrashToastClientId, undefined);
      assert.strictEqual(controller.initInterval, undefined);
    } finally {
      if (controller.initInterval) {
        clearInterval(controller.initInterval);
        controller.initInterval = undefined;
      }
    }
  });

  test('provider auth state is capability-based instead of provider-id-based', async () => {
    const controller = createStandaloneChatController({
      llmProvider: {
        id: 'customAuthProvider',
        name: 'Custom Provider',
        async getAuthStatus() {
          return {
            supported: true,
            authenticated: true,
            status: 'signed_in',
            label: 'Connected',
            accountLabel: 'user@example.com',
            secondaryActionLabel: 'Disconnect',
          };
        },
      } as any,
    });

    const providerAuth = await controller.webviewApi.getProviderAuthStateForUI();

    assert.deepStrictEqual(providerAuth, {
      providerId: 'customAuthProvider',
      providerName: 'Custom Provider',
      supported: true,
      authenticated: true,
      status: 'signed_in',
      label: 'Connected',
      accountLabel: 'user@example.com',
      secondaryActionLabel: 'Disconnect',
    });
  });

  test('webviewError messages are routed through appendErrorLog and the live webview script avoids duplicate fatal-error posts', async () => {
    const logged: string[] = [];
    const controller = createStandaloneChatController({
      outputChannel: {
        appendLine(line: string) {
          logged.push(line);
        },
      } as unknown as vscode.OutputChannel,
    });

    const originalShowErrorMessage = vscode.window.showErrorMessage;
    const shown: string[] = [];
    (vscode.window as any).showErrorMessage = (message: string) => {
      shown.push(message);
      return Promise.resolve(undefined);
    };

    let onMessage: ((data: unknown) => void | Promise<void>) | undefined;
    const disposable = { dispose() {} };
    const webview = {
      options: {},
      html: '',
      cspSource: 'test-csp',
      postMessage: () => true,
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: (listener: (data: unknown) => void | Promise<void>) => {
        onMessage = listener;
        return disposable;
      },
    } as unknown as vscode.Webview;
    const view = {
      webview,
      visible: true,
      onDidChangeVisibility: () => disposable,
      onDidDispose: () => disposable,
    } as unknown as vscode.WebviewView;

    try {
      controller.webviewApi.resolveWebviewView(view);
      assert.ok(onMessage, 'expected resolveWebviewView to register a webview message handler');

      await onMessage?.({
        type: WEBVIEW_MESSAGE_READY,
        clientInstanceId: 'client-1',
      });

      await onMessage?.({
        type: WEBVIEW_MESSAGE_ERROR,
        error: {
          kind: 'fatal',
          source: 'window.error',
          name: 'ReferenceError',
          message: 'token=secret-value',
          stack: 'ReferenceError: token=secret-value\n    at https://example.com/app.js:1:1',
        },
      });

      await onMessage?.({
        type: WEBVIEW_MESSAGE_ERROR,
        error: {
          kind: 'fatal',
          source: 'window.error',
          name: 'ReferenceError',
          message: 'token=secret-value',
          stack: 'ReferenceError: token=secret-value\n    at https://example.com/app.js:1:1',
        },
      });

      assert.strictEqual(shown.length, 1, 'expected one user-facing crash toast per webview client');
      assert.ok(logged.some(line => line.includes('[ERROR] [Webview] Webview error:')));
      assert.ok(logged.some(line => line.includes('"kind":"fatal"')));
      assert.ok(logged.some(line => line.includes('"source":"window.error"')));
      assert.ok(!logged.some(line => line.includes('secret-value')));
      assert.ok(logged.some(line => line.includes('<redacted>')));
      assert.ok(logged.some(line => line.includes('<url>')));
      assert.strictEqual(controller.webviewCrashToastClientId, 'client-1');

      await onMessage?.({ type: WEBVIEW_MESSAGE_READY, clientInstanceId: 'client-2' });
      await onMessage?.({
        type: WEBVIEW_MESSAGE_ERROR,
        error: {
          kind: 'fatal',
          source: 'window.unhandledrejection',
          name: 'TypeError',
          message: 'token=second-secret',
          stack: 'TypeError: token=second-secret\n    at https://example.com/app.js:2:1',
        },
      });
      assert.strictEqual(shown.length, 2, 'expected a fresh client to receive its own crash toast');
      assert.strictEqual(controller.webviewCrashToastClientId, 'client-2');
      assert.ok(logged.some(line => line.includes('"source":"window.unhandledrejection"')));

      const bootstrapJsPath = path.resolve(__dirname, '../../../media/chat/bootstrap.js');
      const bootstrapSource = fs.readFileSync(bootstrapJsPath, 'utf8');
      assert.ok(bootstrapSource.includes('function postWebviewCrash(details, source)'));
      assert.ok(bootstrapSource.includes("type: chatProtocol.webviewError"));
      assert.ok(bootstrapSource.includes('const chatProtocol = window.LINGYUN_CHAT_PROTOCOL;'));
      assert.ok(bootstrapSource.includes("source || 'webview'"));

      const mainJsPath = path.resolve(__dirname, '../../../media/chat/main.js');
      const mainSource = fs.readFileSync(mainJsPath, 'utf8');
      assert.ok(mainSource.includes("type: mainChatProtocol.ready"));
      assert.ok(mainSource.includes("type: mainChatProtocol.initAck"));
      assert.ok(!mainSource.includes('const chatProtocol = window.LINGYUN_CHAT_PROTOCOL;'));
      assert.ok(mainSource.includes("showFatalError(err, 'message.dispatch');"));
      assert.ok(
        !mainSource.includes("vscode.postMessage({ type: 'webviewError', error: String(err && (err.stack || err.message) || err) });"),
        'main.js should not duplicate fatal webviewError posts after showFatalError already reports them'
      );
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
      if (controller.initInterval) {
        clearInterval(controller.initInterval);
        controller.initInterval = undefined;
      }
    }
  });
});
