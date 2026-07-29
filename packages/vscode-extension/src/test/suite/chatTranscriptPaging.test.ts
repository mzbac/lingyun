import * as assert from 'assert';

import {
  createEarlierTranscriptPage,
  createInitialTranscriptPage,
  TRANSCRIPT_HISTORY_PAGE_GROUP_LIMIT,
  TRANSCRIPT_INITIAL_GROUP_LIMIT,
} from '../../ui/chat/transcriptPaging';
import type { ChatMessage } from '../../ui/chat/types';

function createMessage(
  id: string,
  role: ChatMessage['role'],
  options?: Partial<ChatMessage>
): ChatMessage {
  return {
    id,
    role,
    content: options?.content ?? id,
    timestamp: options?.timestamp ?? 1,
    ...options,
  };
}

function createTranscript(turnCount: number, contentSize = 0): ChatMessage[] {
  const content = contentSize > 0 ? 'x'.repeat(contentSize) : undefined;
  const messages: ChatMessage[] = [];
  for (let index = 0; index < turnCount; index++) {
    const turnId = `user-${index}`;
    messages.push(createMessage(turnId, 'user', { content: content ?? `Question ${index}` }));
    messages.push(createMessage(`assistant-${index}`, 'assistant', {
      turnId,
      content: content ?? `Answer ${index}`,
    }));
  }
  return messages;
}

suite('Chat transcript paging', () => {
  test('initial page contains only the newest complete logical groups', () => {
    const messages = createTranscript(150);
    const page = createInitialTranscriptPage(messages);

    assert.strictEqual(page.messages.length, TRANSCRIPT_INITIAL_GROUP_LIMIT * 2);
    assert.strictEqual(page.messages[0]?.id, 'user-126');
    assert.strictEqual(page.messages.at(-1)?.id, 'assistant-149');
    assert.strictEqual(page.cursor, 'user-126');
    assert.strictEqual(page.hasEarlierMessages, true);
  });

  test('turn and step-linked messages are never split across page boundaries', () => {
    const messages: ChatMessage[] = [];
    for (let index = 0; index < 30; index++) {
      const turnId = `user-${index}`;
      const stepId = `step-${index}`;
      messages.push(createMessage(turnId, 'user'));
      messages.push(createMessage(stepId, 'step', { turnId }));
      messages.push(createMessage(`tool-${index}`, 'tool', { stepId }));
      messages.push(createMessage(`assistant-${index}`, 'assistant', { turnId }));
    }

    const page = createInitialTranscriptPage(messages);
    assert.strictEqual(page.messages.length, TRANSCRIPT_INITIAL_GROUP_LIMIT * 4);
    assert.deepStrictEqual(
      page.messages.slice(0, 4).map((message) => message.id),
      ['user-6', 'step-6', 'tool-6', 'assistant-6']
    );
  });

  test('earlier pages reconstruct the transcript exactly and survive live appends', () => {
    const original = createTranscript(150);
    const messages = [...original];
    const initial = createInitialTranscriptPage(messages);
    const pages: ChatMessage[][] = [initial.messages];
    let cursor = initial.cursor;
    let hasEarlierMessages = initial.hasEarlierMessages;

    messages.push(
      createMessage('user-live', 'user'),
      createMessage('assistant-live', 'assistant', { turnId: 'user-live' })
    );

    while (hasEarlierMessages && cursor) {
      const page = createEarlierTranscriptPage(messages, cursor);
      assert.ok(page);
      assert.ok(page.messages.length <= TRANSCRIPT_HISTORY_PAGE_GROUP_LIMIT * 2);
      pages.unshift(page.messages);
      cursor = page.cursor;
      hasEarlierMessages = page.hasEarlierMessages;
    }

    assert.deepStrictEqual(
      pages.flat().map((message) => message.id),
      original.map((message) => message.id)
    );
  });

  test('rejects a stale or non-boundary cursor', () => {
    const messages = createTranscript(30);

    assert.strictEqual(createEarlierTranscriptPage(messages, 'missing'), undefined);
    assert.strictEqual(createEarlierTranscriptPage(messages, 'assistant-24'), undefined);
    assert.strictEqual(createEarlierTranscriptPage(messages, 'user-0'), undefined);
  });

  test('bounds the serialized initial payload for long sessions', () => {
    const messages = createTranscript(150, 2048);
    const page = createInitialTranscriptPage(messages);
    const fullBytes = Buffer.byteLength(JSON.stringify(messages));
    const initialBytes = Buffer.byteLength(JSON.stringify(page.messages));

    assert.ok(initialBytes < fullBytes * 0.2, `${initialBytes} should be less than 20% of ${fullBytes}`);
  });
});
