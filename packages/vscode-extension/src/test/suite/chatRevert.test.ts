import * as assert from 'assert';

import type { AgentSessionState } from '../../core/agent';
import type { ChatMessage } from '../../ui/chat/types';
import { createStandaloneChatController } from './chatControllerHarness';

function createMessage(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>
): ChatMessage {
  return {
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

suite('Chat revert service', () => {
  test('reports undo redo availability and reverted user count', () => {
    const controller = createStandaloneChatController();
    const files = [{ path: 'src/file.ts', additions: 2, deletions: 1 }];

    controller.messages.push(
      createMessage({ id: 'user-1', role: 'user', content: 'first' }),
      createMessage({ id: 'assistant-1', role: 'assistant' }),
      createMessage({ id: 'user-2', role: 'user', content: 'second' }),
      createMessage({ id: 'step-1', role: 'step' }),
      createMessage({ id: 'user-3', role: 'user', content: 'third' })
    );
    controller.sessionApi.getActiveSession().revert = {
      messageId: 'user-2',
      snapshotHash: 'base-hash',
      baselineAgentState: controller.sessionApi.getBlankAgentState(),
      files,
      updatedAt: 1,
    };

    assert.deepStrictEqual(controller.revertApi.getUndoRedoAvailability(), {
      canUndo: true,
      canRedo: true,
    });
    assert.deepStrictEqual(controller.revertApi.getRevertBarStateForUI(), {
      active: true,
      revertedMessages: 2,
      files,
    });
  });

  test('stale revert boundary disables redo and hides the revert bar', () => {
    const controller = createStandaloneChatController();
    controller.messages.push(
      createMessage({ id: 'user-1', role: 'user', content: 'first' }),
      createMessage({ id: 'assistant-1', role: 'assistant' })
    );
    controller.sessionApi.getActiveSession().revert = {
      messageId: 'missing-user',
      snapshotHash: 'base-hash',
      baselineAgentState: controller.sessionApi.getBlankAgentState(),
      files: [],
      updatedAt: 1,
    };

    assert.deepStrictEqual(controller.revertApi.getUndoRedoAvailability(), {
      canUndo: false,
      canRedo: false,
    });
    assert.strictEqual(controller.revertApi.getRevertBarStateForUI(), null);
  });

  test('collects step patches from the requested message range', () => {
    const controller = createStandaloneChatController();
    controller.messages.push(
      createMessage({ id: 'user-1', role: 'user' }),
      createMessage({
        id: 'step-before',
        role: 'step',
        step: { index: 1, status: 'done', patch: { baseHash: 'before', files: ['before.ts'] } },
      }),
      createMessage({ id: 'assistant-1', role: 'assistant' }),
      createMessage({ id: 'user-2', role: 'user' }),
      createMessage({
        id: 'step-after-1',
        role: 'step',
        step: { index: 2, status: 'done', patch: { baseHash: 'after-1', files: ['after-1.ts'] } },
      }),
      createMessage({
        id: 'step-empty',
        role: 'step',
        step: { index: 3, status: 'done', patch: { baseHash: 'empty', files: [] } },
      }),
      createMessage({
        id: 'step-after-2',
        role: 'step',
        step: { index: 4, status: 'done', patch: { baseHash: 'after-2', files: ['after-2.ts'] } },
      })
    );

    assert.deepStrictEqual(controller.revertApi.collectPatchesFromIndex(3), [
      { baseHash: 'after-1', files: ['after-1.ts'] },
      { baseHash: 'after-2', files: ['after-2.ts'] },
    ]);
  });

  test('derives fallback agent state before the selected user message', () => {
    const controller = createStandaloneChatController();
    controller.messages.push(
      createMessage({ id: 'user-1', role: 'user' }),
      createMessage({ id: 'assistant-1', role: 'assistant' }),
      createMessage({ id: 'user-2', role: 'user' }),
      createMessage({ id: 'assistant-2', role: 'assistant' })
    );
    const baseline: AgentSessionState = {
      ...controller.sessionApi.getBlankAgentState(),
      history: [
        { role: 'system' },
        { role: 'user' },
        { role: 'assistant' },
        { role: 'assistant' },
        { role: 'user' },
        { role: 'assistant' },
      ] as any,
    };

    const truncated = controller.revertApi.deriveAgentStateBeforeUserMessage({
      baseline,
      boundaryIndex: 2,
    });

    assert.deepStrictEqual(truncated.history.map((message: any) => message.role), [
      'system',
      'user',
      'assistant',
      'assistant',
    ]);
    assert.deepStrictEqual(baseline.history.map((message: any) => message.role), [
      'system',
      'user',
      'assistant',
      'assistant',
      'user',
      'assistant',
    ]);
  });
});
