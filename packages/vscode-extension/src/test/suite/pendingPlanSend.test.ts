import * as assert from 'assert';
import { ChatController, installChatControllerMethods } from '../../ui/chat';
import type { ChatMessage } from '../../ui/chat/types';
import { createBlankSessionSignals } from '../../core/sessionSignals';

suite('Pending plan send', () => {
  test('handleUserMessage routes to revisePendingPlan in build mode', async () => {
    const provider = Object.create(ChatController.prototype) as ChatController;
    installChatControllerMethods(provider);

    provider.isProcessing = false;
    provider.view = {} as any;
    provider.mode = 'build';
    provider.signals = createBlankSessionSignals();
    provider.currentModel = 'gpt-4o';

    const planMsg: ChatMessage = {
      id: 'plan-1',
      role: 'plan',
      content: 'Plan draft',
      timestamp: Date.now(),
      turnId: 'turn-1',
      plan: { status: 'draft', task: 'Task' },
    };

    provider.messages = [planMsg];
    provider.activeSessionId = 'session-1';
    provider.sessions = new Map([
      [
        provider.activeSessionId,
        {
          id: provider.activeSessionId,
          title: 'Test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          signals: provider.signals,
          messages: provider.messages,
          agentState: provider.getBlankAgentState(),
          currentModel: provider.currentModel,
          mode: provider.mode,
          stepCounter: 0,
          pendingPlan: { task: 'Task', planMessageId: 'plan-1' },
          runtime: { wasRunning: false, updatedAt: Date.now() },
        },
      ],
    ]);

    let called = false;
    let receivedPlanId = '';
    let receivedInstructions = '';

    provider.revisePendingPlan = async (planMessageId: string, instructions: string): Promise<void> => {
      called = true;
      receivedPlanId = planMessageId;
      receivedInstructions = instructions;
    };

    await provider.handleUserMessage('User clarification');

    assert.ok(called);
    assert.strictEqual(receivedPlanId, 'plan-1');
    assert.strictEqual(receivedInstructions, 'User clarification');
  });
});
