import * as assert from 'assert';
import * as vscode from 'vscode';

import { ChatController, installChatControllerMethods } from '../../ui/chat';
import { createBlankSessionSignals } from '../../core/sessionSignals';

suite('Chat webview loop integration', () => {
  test('configureLoop webview message routes to the active-session loop configurator', async () => {
    const controller = Object.create(ChatController.prototype) as ChatController;
    installChatControllerMethods(controller);

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
          agentState: controller.getBlankAgentState(),
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
    controller.configureLoopForActiveSession = async () => {
      configureCalls++;
    };
    controller.getHtml = () => '';
    controller.startInitPusher = () => {};

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

    controller.resolveWebviewView(view);
    assert.ok(onMessage, 'expected resolveWebviewView to register a webview message handler');

    await onMessage?.({ type: 'configureLoop' });

    assert.strictEqual(configureCalls, 1);
  });
});
