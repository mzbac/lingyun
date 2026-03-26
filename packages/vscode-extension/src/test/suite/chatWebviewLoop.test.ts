import * as assert from 'assert';
import * as vscode from 'vscode';

import { ChatController } from '../../ui/chat';
import { createBlankSessionSignals } from '../../core/sessionSignals';
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

  test('resolveWebviewView writes lifecycle state through the controller adapter', async () => {
    const controller = createStandaloneChatController();
    let previousDisposed = 0;
    controller.viewDisposables = [{ dispose: () => previousDisposed++ } as vscode.Disposable];
    controller.initAcked = true;
    controller.webviewClientInstanceId = 'stale-client';

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
      controller.initAcked = true;
      onDispose?.();

      assert.strictEqual(controller.view, undefined);
      assert.strictEqual(controller.initAcked, false);
      assert.strictEqual(controller.webviewClientInstanceId, undefined);
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
});
