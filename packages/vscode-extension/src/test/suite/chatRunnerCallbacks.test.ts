import * as assert from 'assert';
import * as vscode from 'vscode';

import { createStandaloneChatController } from './chatControllerHarness';
import type { ChatMessage } from '../../ui/chat/types';

suite('Chat runner callbacks', () => {
  test('status retry clears streamed assistant/thought content for the current turn', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousShowThinking = config.get('showThinking');
    await config.update('showThinking', true, vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController({
        agent: {
          syncSession() {},
          exportState() {
            return {
              history: [],
              fileHandles: { nextId: 1, byId: {} },
              semanticHandles: { nextMatchId: 1, nextSymbolId: 1, nextLocId: 1, matches: {}, symbols: {}, locations: {} },
              pendingInputs: [],
            } as any;
          },
          getHistory() {
            return [];
          },
        } as any,
      });
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

      const callbacks = controller.runnerCallbacksApi.createAgentCallbacks();

      await callbacks.onIterationStart?.(1);
      callbacks.onThoughtToken?.('  ');
      callbacks.onThoughtToken?.('reasoning');
      callbacks.onAssistantToken?.('assistant text');
      callbacks.onStatusChange?.({ type: 'retry', attempt: 2, nextRetryTime: Date.now() + 1000 });

      const thoughtMsg = controller.messages.find((message) => message.role === 'thought');
      const assistantMsg = controller.messages.find((message) => message.role === 'assistant');
      assert.ok(thoughtMsg, 'expected thought message');
      assert.ok(assistantMsg, 'expected assistant message');
      assert.strictEqual(thoughtMsg?.content, '');
      assert.strictEqual(assistantMsg?.content, '');

      const updates = posted.filter((message) => (message as any)?.type === 'updateMessage') as Array<{
        message: ChatMessage;
      }>;
      assert.ok(updates.some((entry) => entry.message.id === thoughtMsg?.id), 'expected thought update on retry');
      assert.ok(updates.some((entry) => entry.message.id === assistantMsg?.id), 'expected assistant update on retry');
    } finally {
      await config.update('showThinking', previousShowThinking, vscode.ConfigurationTarget.Global);
    }
  });

  test('complete uses response fallback when no assistant tokens were streamed', () => {
    const controller = createStandaloneChatController({
      agent: {
        syncSession() {},
        exportState() {
          return {
            history: [],
            fileHandles: { nextId: 1, byId: {} },
            semanticHandles: { nextMatchId: 1, nextSymbolId: 1, nextLocId: 1, matches: {}, symbols: {}, locations: {} },
            pendingInputs: [],
          } as any;
        },
        getHistory() {
          return [];
        },
      } as any,
    });
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

    const callbacks = controller.runnerCallbacksApi.createAgentCallbacks();
    callbacks.onComplete?.('Final response');

    const assistantMsg = controller.messages.find((message) => message.role === 'assistant');
    assert.ok(assistantMsg, 'expected assistant message to be created from complete response');
    assert.strictEqual(assistantMsg?.content, 'Final response');
    assert.ok(posted.some((message) => (message as any)?.type === 'complete'), 'expected completion event');
  });
});
