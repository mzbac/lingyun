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

  test('planning callbacks flush final debounced plan content on complete', () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];
    const planMsg: ChatMessage = {
      id: 'plan-1',
      role: 'plan',
      content: 'Planning...',
      timestamp: Date.now(),
      turnId: 'turn-1',
      plan: { status: 'generating', task: 'Task' },
    };

    controller.view = {} as vscode.WebviewView;
    controller.currentTurnId = 'turn-1';
    controller.mode = 'plan';
    controller.currentModel = 'mock-model';
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    controller.sessionApi.getContextForUI = () => ({}) as any;
    controller.messages.push(planMsg);

    const callbacks = controller.runnerCallbacksApi.createPlanningCallbacks(planMsg);
    callbacks.onAssistantToken?.('1. Ship it');
    callbacks.onComplete?.('1. Ship it');

    const planUpdate = posted.find(
      (message) => (message as any)?.type === 'updateMessage' && (message as any)?.message?.id === 'plan-1'
    ) as { message: ChatMessage } | undefined;
    assert.ok(planUpdate, 'expected a final plan update before completion');
    assert.strictEqual(planMsg.content, '1. Ship it');
    assert.strictEqual(planUpdate?.message.content, '1. Ship it');
  });

  test('planning callbacks keep failed plans out of the generating state without posting duplicate error UI', () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];
    const planMsg: ChatMessage = {
      id: 'plan-1',
      role: 'plan',
      content: 'Planning...',
      timestamp: Date.now(),
      turnId: 'turn-1',
      plan: { status: 'generating', task: 'Task' },
    };

    controller.view = {} as vscode.WebviewView;
    controller.currentTurnId = 'turn-1';
    controller.mode = 'plan';
    controller.currentModel = 'mock-model';
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    controller.sessionApi.getContextForUI = () => ({}) as any;
    controller.messages.push(planMsg);

    const callbacks = controller.runnerCallbacksApi.createPlanningCallbacks(planMsg);
    callbacks.onError?.(new Error('plan failed'));

    assert.strictEqual(planMsg.plan?.status, 'draft');
    assert.strictEqual(planMsg.content, '(Plan generation failed)');
    assert.strictEqual(controller.messages.filter((message) => message.role === 'error').length, 0);
    assert.ok(
      posted.some(
        (message) => (message as any)?.type === 'updateMessage' && (message as any)?.message?.id === 'plan-1'
      ),
      'expected failed plan card update'
    );
    assert.ok(
      !posted.some((message) => (message as any)?.type === 'message' && (message as any)?.message?.role === 'error'),
      'planning callback should not own terminal error message posting'
    );
  });

  test('planning callbacks treat canonical abort text as cancellation for the plan card', () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];
    const planMsg: ChatMessage = {
      id: 'plan-1',
      role: 'plan',
      content: 'Planning...',
      timestamp: Date.now(),
      turnId: 'turn-1',
      plan: { status: 'generating', task: 'Task' },
    };

    controller.view = {} as vscode.WebviewView;
    controller.currentTurnId = 'turn-1';
    controller.mode = 'plan';
    controller.currentModel = 'mock-model';
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    controller.sessionApi.getContextForUI = () => ({}) as any;
    controller.messages.push(planMsg);

    const callbacks = controller.runnerCallbacksApi.createPlanningCallbacks(planMsg);
    callbacks.onError?.(new Error('Agent aborted'));

    assert.strictEqual(planMsg.plan?.status, 'canceled');
    assert.strictEqual(planMsg.content, '(Plan generation canceled)');
    assert.strictEqual(controller.messages.filter((message) => message.role === 'error').length, 0);
    assert.ok(
      posted.some(
        (message) => (message as any)?.type === 'updateMessage' && (message as any)?.message?.id === 'plan-1'
      ),
      'expected canceled plan card update'
    );
  });
});
