import * as assert from 'assert';

import type { ChatMessage } from '../../ui/chat/types';
import {
  appendTurnErrorMessage,
  findLatestUserTurnId,
  hasEquivalentTurnError,
} from '../../ui/chat/runner/runCoordinatorMessageState';
import {
  findApprovalToolMessage,
  findLatestToolMessageByApprovalId,
} from '../../ui/chat/toolMessageLookup';

suite('Chat run coordinator message state', () => {
  test('findLatestToolMessageByApprovalId returns the most recent matching tool message', () => {
    const messages: ChatMessage[] = [
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 1,
        turnId: 'turn-1',
        toolCall: {
          id: 'bash',
          name: 'bash',
          args: '{}',
          status: 'running',
          approvalId: 'approval-1',
        },
      },
      {
        id: 'tool-2',
        role: 'tool',
        content: '',
        timestamp: 2,
        turnId: 'turn-2',
        toolCall: {
          id: 'bash',
          name: 'bash',
          args: '{}',
          status: 'success',
          approvalId: 'approval-1',
        },
      },
    ];

    const match = findLatestToolMessageByApprovalId(messages, 'approval-1');
    assert.strictEqual(match?.id, 'tool-2');
  });

  test('findApprovalToolMessage keeps approval lookup scoped to the requested step', () => {
    const messages: ChatMessage[] = [
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 1,
        stepId: 'step-1',
        toolCall: {
          id: 'bash',
          name: 'bash',
          args: '{}',
          status: 'running',
          approvalId: 'approval-1',
        },
      },
      {
        id: 'tool-2',
        role: 'tool',
        content: '',
        timestamp: 2,
        stepId: 'step-2',
        toolCall: {
          id: 'bash',
          name: 'bash',
          args: '{}',
          status: 'success',
          approvalId: 'approval-1',
        },
      },
    ];

    const match = findApprovalToolMessage({
      messages,
      approvalId: 'approval-1',
      stepId: 'step-1',
    });
    assert.strictEqual(match?.id, 'tool-1');
  });

  test('findLatestUserTurnId returns the newest user message id', () => {
    const messages: ChatMessage[] = [
      { id: 'assistant-1', role: 'assistant', content: 'hi', timestamp: 1 },
      { id: 'user-1', role: 'user', content: 'first', timestamp: 2 },
      { id: 'tool-1', role: 'tool', content: '', timestamp: 3 },
      { id: 'user-2', role: 'user', content: 'second', timestamp: 4 },
    ];

    assert.strictEqual(findLatestUserTurnId(messages), 'user-2');
  });

  test('hasEquivalentTurnError compares trimmed content within the same turn', () => {
    const messages: ChatMessage[] = [
      { id: 'error-1', role: 'error', content: 'Something failed', timestamp: 1, turnId: 'turn-1' },
      { id: 'error-2', role: 'error', content: 'Something failed', timestamp: 2, turnId: 'turn-2' },
    ];

    assert.strictEqual(
      hasEquivalentTurnError({ messages, turnId: 'turn-1', content: '  Something failed  ' }),
      true,
    );
    assert.strictEqual(
      hasEquivalentTurnError({ messages, turnId: 'turn-3', content: 'Something failed' }),
      false,
    );
  });

  test('hasEquivalentTurnError scans past newer non-error messages in the same turn', () => {
    const messages: ChatMessage[] = [
      { id: 'error-1', role: 'error', content: 'Repeated failure', timestamp: 1, turnId: 'turn-1' },
      { id: 'assistant-1', role: 'assistant', content: 'follow-up', timestamp: 2, turnId: 'turn-1' },
    ];

    assert.strictEqual(
      hasEquivalentTurnError({ messages, turnId: 'turn-1', content: 'Repeated failure' }),
      true,
    );
  });

  test('appendTurnErrorMessage suppresses duplicate errors for the same turn', () => {
    const messages: ChatMessage[] = [
      { id: 'error-1', role: 'error', content: 'Repeated failure', timestamp: 1, turnId: 'turn-1' },
    ];

    const duplicate = appendTurnErrorMessage({
      messages,
      turnId: 'turn-1',
      content: '  Repeated failure  ',
    });

    assert.strictEqual(duplicate, undefined);
    assert.strictEqual(messages.length, 1);
  });

  test('appendTurnErrorMessage appends distinct turn-scoped errors', () => {
    const messages: ChatMessage[] = [];

    const created = appendTurnErrorMessage({
      messages,
      turnId: 'turn-1',
      content: 'New failure',
    });

    assert.ok(created);
    assert.strictEqual(created?.role, 'error');
    assert.strictEqual(created?.turnId, 'turn-1');
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0]?.id, created?.id);
  });
});
