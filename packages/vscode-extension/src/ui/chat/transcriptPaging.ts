import type { ChatMessage } from './types';

export const TRANSCRIPT_INITIAL_GROUP_LIMIT = 24;
export const TRANSCRIPT_HISTORY_PAGE_GROUP_LIMIT = 16;

export type TranscriptPage = {
  messages: ChatMessage[];
  hasEarlierMessages: boolean;
  cursor?: string;
};

type TranscriptMessageGroup = {
  messages: ChatMessage[];
};

function createTranscriptMessageGroups(messages: readonly ChatMessage[]): TranscriptMessageGroup[] {
  const groups: TranscriptMessageGroup[] = [];
  const groupByTurnId = new Map<string, TranscriptMessageGroup>();
  const groupByMessageId = new Map<string, TranscriptMessageGroup>();

  for (const message of messages) {
    if (!message || typeof message.id !== 'string' || !message.id) continue;

    let group: TranscriptMessageGroup | undefined;
    if (message.role === 'user') {
      group = message.turnId ? groupByTurnId.get(message.turnId) : undefined;
    } else {
      group = message.turnId ? groupByTurnId.get(message.turnId) : undefined;
      if (!group && message.stepId) {
        group = groupByMessageId.get(message.stepId);
      }
    }

    if (!group) {
      group = { messages: [] };
      groups.push(group);
    }

    group.messages.push(message);
    groupByMessageId.set(message.id, group);
    if (message.turnId) {
      groupByTurnId.set(message.turnId, group);
    }
    if (message.role === 'user') {
      groupByTurnId.set(message.id, group);
    }
  }

  return groups;
}

function flattenTranscriptGroups(
  groups: readonly TranscriptMessageGroup[],
  start: number,
  end: number
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let groupIndex = start; groupIndex < end; groupIndex++) {
    const group = groups[groupIndex];
    if (!group) continue;
    for (const message of group.messages) {
      messages.push(message);
    }
  }
  return messages;
}

function getPageCursor(messages: readonly ChatMessage[]): string | undefined {
  const firstMessageId = messages[0]?.id;
  return typeof firstMessageId === 'string' && firstMessageId ? firstMessageId : undefined;
}

export function createInitialTranscriptPage(
  messages: readonly ChatMessage[],
  groupLimit = TRANSCRIPT_INITIAL_GROUP_LIMIT
): TranscriptPage {
  const groups = createTranscriptMessageGroups(messages);
  const boundedLimit = Math.max(1, Math.floor(groupLimit));
  const start = Math.max(0, groups.length - boundedLimit);
  const pageMessages = flattenTranscriptGroups(groups, start, groups.length);
  const cursor = getPageCursor(pageMessages);

  return {
    messages: pageMessages,
    hasEarlierMessages: start > 0,
    ...(cursor ? { cursor } : {}),
  };
}

export function createEarlierTranscriptPage(
  messages: readonly ChatMessage[],
  cursor: string,
  groupLimit = TRANSCRIPT_HISTORY_PAGE_GROUP_LIMIT
): TranscriptPage | undefined {
  const normalizedCursor = cursor.trim();
  if (!normalizedCursor) return undefined;

  const groups = createTranscriptMessageGroups(messages);
  const cursorGroupIndex = groups.findIndex((group) => group.messages[0]?.id === normalizedCursor);
  if (cursorGroupIndex <= 0) return undefined;

  const boundedLimit = Math.max(1, Math.floor(groupLimit));
  const start = Math.max(0, cursorGroupIndex - boundedLimit);
  const pageMessages = flattenTranscriptGroups(groups, start, cursorGroupIndex);
  const pageCursor = getPageCursor(pageMessages);

  return {
    messages: pageMessages,
    hasEarlierMessages: start > 0,
    ...(pageCursor ? { cursor: pageCursor } : {}),
  };
}
