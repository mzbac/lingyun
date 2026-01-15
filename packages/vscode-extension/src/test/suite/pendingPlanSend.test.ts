import * as assert from 'assert';
import { ChatViewProvider } from '../../ui/chat';
import type { ChatMessage } from '../../ui/chat/types';

suite('Pending plan send', () => {
  test('handleUserMessage routes to revisePendingPlan in build mode', async () => {
    const provider = Object.create(ChatViewProvider.prototype) as ChatViewProvider;

    provider.isProcessing = false;
    provider.view = {} as any;
    provider.mode = 'build';

    const planMsg: ChatMessage = {
      id: 'plan-1',
      role: 'plan',
      content: 'Plan draft',
      timestamp: Date.now(),
      turnId: 'turn-1',
      plan: { status: 'draft', task: 'Task' },
    };

    provider.messages = [planMsg];
    provider.pendingPlan = { task: 'Task', planMessageId: 'plan-1' };

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

