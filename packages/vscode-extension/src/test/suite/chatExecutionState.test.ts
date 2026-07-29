import * as assert from 'assert';

import { createChatExecutionState } from '../../ui/chat/runner/executionState';
import type { ChatMessage } from '../../ui/chat/types';

suite('Chat execution state', () => {
  function createView() {
    const messages: ChatMessage[] = [];
    const posted: any[] = [];
    const view = {
      agent: { getHistory: () => [], resolveFileId: () => undefined },
      messages,
      currentModel: 'mock-model',
      currentTurnId: 'turn-1',
      activeStepId: undefined as string | undefined,
      stepCounter: 0,
      mode: 'build' as const,
      postMessage: (message: unknown) => {
        posted.push(message);
      },
      persistActiveSession: () => {},
    };
    return { view, messages, posted };
  }

  test('batches assistant token chunks before posting to the webview', () => {
    const { view, posted } = createView();
    const state = createChatExecutionState({
      view,
      showThinking: true,
      debugLlm: false,
      persistSessions: false,
      debug: () => {},
    });

    for (let i = 0; i < 25; i++) {
      state.pushAssistant('x');
    }

    assert.strictEqual(posted.filter(message => message?.type === 'token').length, 0);
    state.markStepDoneIfPosted();

    const tokens = posted.filter(message => message?.type === 'token');
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0]?.token, 'x'.repeat(25));
  });

  test('flushes all pending thought and assistant token buffers before completion', async () => {
    const { view, posted } = createView();
    const state = createChatExecutionState({
      view,
      showThinking: true,
      debugLlm: false,
      persistSessions: false,
      debug: () => {},
    });

    state.pushThought('thinking');
    state.pushThought(' more');
    state.pushAssistant('answer');
    state.markStepDoneIfPosted();

    let tokens = posted.filter(message => message?.type === 'token');
    assert.strictEqual(tokens.length, 2);
    assert.deepStrictEqual(
      tokens.map(message => message?.token),
      [' more', 'answer'],
    );

    await new Promise(resolve => setTimeout(resolve, 40));
    tokens = posted.filter(message => message?.type === 'token');
    assert.strictEqual(tokens.length, 2);
  });

  test('discards buffered assistant tokens when a retry resets content', async () => {
    const { view, posted } = createView();
    const state = createChatExecutionState({
      view,
      showThinking: true,
      debugLlm: false,
      persistSessions: false,
      debug: () => {},
    });

    state.pushAssistant('stale');
    state.resetStreamedContentForRetry({ type: 'retry' } as any);

    await new Promise(resolve => setTimeout(resolve, 40));
    assert.strictEqual(posted.filter(message => message?.type === 'token').length, 0);
    assert.ok(posted.some(message => message?.type === 'updateMessage' && message.message?.content === ''));
  });
});
