import type { ModelMessage } from 'ai';
import type { AgentHistoryMessage } from './history';

const IMAGE_OPEN_TAG_TEXT = '<image>';
const IMAGE_CLOSE_TAG_TEXT = '</image>';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function isTextPart(part: unknown, expectedText?: string): boolean {
  const record = asRecord(part);
  if (!record || record.type !== 'text') return false;
  if (expectedText === undefined) return true;
  return record.text === expectedText;
}

function isImageFilePart(part: unknown): part is UnknownRecord & {
  type: 'file';
  mediaType: string;
  data: unknown;
} {
  const record = asRecord(part);
  if (!record || record.type !== 'file') return false;
  if (typeof record.mediaType !== 'string') return false;
  return record.mediaType.toLowerCase().startsWith('image/');
}

function normalizeImageDataForOpenAICompatible(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  const trimmed = data.trim();
  if (!trimmed) return data;
  if (!/^data:image\//i.test(trimmed)) return data;
  try {
    return new URL(trimmed);
  } catch {
    return data;
  }
}

function appendChangedItem<T>(source: T[], changed: T[] | undefined, index: number, item: T): T[] {
  if (!changed) changed = source.slice(0, index);
  changed.push(item);
  return changed;
}

/**
 * Apply Codex-style image boundaries for Copilot image inputs:
 * - wraps each image file part with `<image>` and `</image>` text parts
 * - keeps data URLs as URL objects so openai-compatible serialization preserves them
 */
export function applyCopilotImageInputPattern(messages: ModelMessage[]): ModelMessage[] {
  let nextMessages: ModelMessage[] | undefined;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      if (nextMessages) nextMessages.push(message);
      continue;
    }

    const content = message.content as unknown[];
    let transformed: unknown[] | undefined;

    for (let index = 0; index < content.length; index++) {
      const part = content[index];
      if (!isImageFilePart(part)) {
        if (transformed) transformed.push(part);
        continue;
      }

      const previousOriginal = index > 0 ? content[index - 1] : undefined;
      const nextOriginal = index + 1 < content.length ? content[index + 1] : undefined;
      const hasOpenBoundary = isTextPart(previousOriginal, IMAGE_OPEN_TAG_TEXT);
      const hasCloseBoundary = isTextPart(nextOriginal, IMAGE_CLOSE_TAG_TEXT);
      const normalizedData = normalizeImageDataForOpenAICompatible(part.data);
      const partChanged = normalizedData !== part.data;

      if (hasOpenBoundary && hasCloseBoundary && !partChanged) {
        if (transformed) transformed.push(part);
        continue;
      }

      if (!transformed) transformed = content.slice(0, index);

      if (!hasOpenBoundary) {
        transformed.push({ type: 'text', text: IMAGE_OPEN_TAG_TEXT });
      }

      if (partChanged) {
        transformed.push({ ...part, data: normalizedData });
      } else {
        transformed.push(part);
      }

      if (!hasCloseBoundary) {
        transformed.push({ type: 'text', text: IMAGE_CLOSE_TAG_TEXT });
      }
    }

    if (!transformed) {
      if (nextMessages) nextMessages.push(message);
      continue;
    }

    nextMessages = appendChangedItem(messages, nextMessages, messageIndex, {
      ...message,
      content: transformed as typeof message.content,
    });
  }

  return nextMessages ?? messages;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function getReplayField(message: AgentHistoryMessage, field: 'text' | 'reasoning'): string | undefined {
  const replay = message.metadata?.replay;
  if (!replay) return undefined;
  const value = replay[field];
  return isString(value) ? value : undefined;
}

function getReplayCopilotField(
  message: AgentHistoryMessage,
  field: 'reasoningOpaque' | 'reasoningEncryptedContent',
): string | undefined {
  const replay = message.metadata?.replay;
  const copilot = replay ? asRecord((replay as any).copilot) : undefined;
  const value = copilot?.[field];
  return isString(value) ? value : undefined;
}

function getProviderMetadata(part: unknown): UnknownRecord | undefined {
  const record = asRecord(part);
  if (!record) return undefined;
  return asRecord(record.providerMetadata);
}

type AssistantReplayParts = {
  hasReasoningTextParts: boolean;
  existingReasoningProviderMetadata?: UnknownRecord;
  existingTextProviderMetadata?: UnknownRecord;
  originalReasoning: unknown[];
  originalText: unknown[];
  otherParts: unknown[];
};

function collectAssistantReplayParts(
  parts: unknown[],
  options: {
    includeReasoning: boolean;
    collectOriginalReasoning: boolean;
    collectOriginalText: boolean;
  },
): AssistantReplayParts {
  const collected: AssistantReplayParts = {
    hasReasoningTextParts: false,
    originalReasoning: [],
    originalText: [],
    otherParts: [],
  };

  for (const part of parts) {
    const record = asRecord(part);
    if (record?.type === 'reasoning') {
      if (typeof record.text === 'string') {
        collected.hasReasoningTextParts = true;
        if (options.collectOriginalReasoning) {
          collected.originalReasoning.push({ ...(part as any) });
        }
      }
      if (options.includeReasoning && !collected.existingReasoningProviderMetadata) {
        collected.existingReasoningProviderMetadata = getProviderMetadata(part);
      }
      continue;
    }

    if (record?.type === 'text') {
      if (options.collectOriginalText && typeof record.text === 'string') {
        collected.originalText.push({ ...(part as any) });
      }
      if (!collected.existingTextProviderMetadata) {
        collected.existingTextProviderMetadata = getProviderMetadata(part);
      }
      continue;
    }

    collected.otherParts.push(part);
  }

  return collected;
}

function collectReasoningContentParts(contentParts: unknown[]): {
  filteredContent: unknown[] | undefined;
  reasoningText: string;
} {
  let filteredContent: unknown[] | undefined;
  let reasoningText = '';

  for (let i = 0; i < contentParts.length; i++) {
    const part = contentParts[i];
    const record = asRecord(part);
    if (record?.type === 'reasoning') {
      if (!filteredContent) filteredContent = contentParts.slice(0, i);
      if (typeof record.text === 'string') reasoningText += record.text;
      continue;
    }

    if (filteredContent) filteredContent.push(part);
  }

  return { filteredContent, reasoningText };
}

/**
 * For prompt-cache friendliness we want to replay *exact* assistant output tokens on subsequent requests.
 *
 * The UI stores a cleaned assistant text for display, but we also persist the raw streamed output under
 * `message.metadata.replay`. This helper swaps assistant `text`/`reasoning` parts for the replay payload
 * (leaving tool parts untouched) without mutating the original history.
 */
export function applyAssistantReplayForPrompt(
  history: AgentHistoryMessage[],
  options?: { includeReasoning?: boolean },
): AgentHistoryMessage[] {
  const includeReasoning = options?.includeReasoning !== false;
  let nextHistory: AgentHistoryMessage[] | undefined;

  for (let messageIndex = 0; messageIndex < history.length; messageIndex++) {
    const message = history[messageIndex]!;
    if (message.role !== 'assistant' || !Array.isArray(message.parts)) {
      if (nextHistory) nextHistory.push(message);
      continue;
    }

    const replayText = getReplayField(message, 'text');
    const replayReasoning = includeReasoning ? getReplayField(message, 'reasoning') : undefined;
    if (replayText === undefined && replayReasoning === undefined && includeReasoning) {
      if (nextHistory) nextHistory.push(message);
      continue;
    }

    const collected = collectAssistantReplayParts(message.parts as unknown[], {
      includeReasoning,
      collectOriginalReasoning: includeReasoning && replayReasoning === undefined,
      collectOriginalText: replayText === undefined,
    });
    if (replayText === undefined && replayReasoning === undefined && !collected.hasReasoningTextParts) {
      if (nextHistory) nextHistory.push(message);
      continue;
    }

    const copilotReasoningOpaque = includeReasoning ? getReplayCopilotField(message, 'reasoningOpaque') : undefined;
    const copilotReasoningEncryptedContent = includeReasoning
      ? getReplayCopilotField(message, 'reasoningEncryptedContent')
      : undefined;
    const reasoningProviderMetadata: UnknownRecord | undefined = (() => {
      if (!collected.existingReasoningProviderMetadata && !copilotReasoningOpaque && !copilotReasoningEncryptedContent) return undefined;
      const merged = { ...(collected.existingReasoningProviderMetadata ?? {}) };
      if (copilotReasoningOpaque || copilotReasoningEncryptedContent) {
        const existingCopilot = asRecord(merged.copilot) ?? {};
        merged.copilot = {
          ...existingCopilot,
          ...(copilotReasoningOpaque ? { reasoningOpaque: copilotReasoningOpaque } : {}),
          ...(copilotReasoningEncryptedContent ? { reasoningEncryptedContent: copilotReasoningEncryptedContent } : {}),
        };
      }
      return merged;
    })();
    const textProviderMetadata = collected.existingTextProviderMetadata ? { ...collected.existingTextProviderMetadata } : undefined;

    const rebuilt: unknown[] = [];
    if (includeReasoning) {
      if (replayReasoning !== undefined) {
        if (replayReasoning.length > 0 || reasoningProviderMetadata) {
          rebuilt.push({
            type: 'reasoning',
            text: replayReasoning,
            state: 'done',
            ...(reasoningProviderMetadata ? { providerMetadata: { ...reasoningProviderMetadata } } : {}),
          });
        }
      } else {
        rebuilt.push(...collected.originalReasoning);
      }
    }

    if (replayText !== undefined) {
      if (replayText.length > 0 || textProviderMetadata) {
        rebuilt.push({
          type: 'text',
          text: replayText,
          state: 'done',
          ...(textProviderMetadata ? { providerMetadata: { ...textProviderMetadata } } : {}),
        });
      }
    } else {
      rebuilt.push(...collected.originalText);
    }

    const nextParts = [...rebuilt, ...collected.otherParts] as unknown as AgentHistoryMessage['parts'];

    nextHistory = appendChangedItem(history, nextHistory, messageIndex, {
      ...message,
      metadata: message.metadata ? { ...message.metadata } : undefined,
      parts: nextParts,
    });
  }

  return nextHistory ?? history;
}

type ReasoningField = 'reasoning_content' | 'reasoning_details';

function getModelMessageProviderOptions(message: ModelMessage): UnknownRecord | undefined {
  const record = asRecord((message as any).providerOptions);
  return record;
}

/**
 * OpenAI-compatible request encoding ignores `reasoning` parts. To replay reasoning we lift reasoning parts
 * onto the assistant message as `providerOptions.openaiCompatible.reasoning_content`,
 * while keeping tool calls and assistant text unchanged.
 */
export function applyOpenAICompatibleReasoningField(
  messages: ModelMessage[],
  params?: { field?: ReasoningField; includeReasoning?: boolean },
): ModelMessage[] {
  const field: ReasoningField = params?.field ?? 'reasoning_content';
  const includeReasoning = params?.includeReasoning !== false;
  let nextMessages: ModelMessage[] | undefined;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      if (nextMessages) nextMessages.push(message);
      continue;
    }

    const { filteredContent, reasoningText } = collectReasoningContentParts(message.content as unknown[]);
    if (!filteredContent) {
      if (nextMessages) nextMessages.push(message);
      continue;
    }

    if (!includeReasoning || !reasoningText) {
      nextMessages = appendChangedItem(messages, nextMessages, messageIndex, {
        ...message,
        content: filteredContent as any,
      });
      continue;
    }

    const existingProviderOptions = getModelMessageProviderOptions(message);
    const openaiCompatibleOptions = asRecord(existingProviderOptions?.openaiCompatible) ?? {};

    nextMessages = appendChangedItem(messages, nextMessages, messageIndex, {
      ...message,
      content: filteredContent as any,
      providerOptions: {
        ...(existingProviderOptions ?? {}),
        openaiCompatible: { ...openaiCompatibleOptions, [field]: reasoningText },
      } as any,
    });
  }

  return nextMessages ?? messages;
}

/**
 * Copilot's chat-completions backend supports `reasoning_text` / `reasoning_opaque` fields on assistant
 * messages, but the AI SDK openai-compatible encoder ignores `reasoning` parts. To replay reasoning for
 * prompt-cache friendliness we lift reasoning parts onto `providerOptions.openaiCompatible.reasoning_text`.
 */
export function applyCopilotReasoningFields(messages: ModelMessage[]): ModelMessage[] {
  let nextMessages: ModelMessage[] | undefined;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      if (nextMessages) nextMessages.push(message);
      continue;
    }

    const { filteredContent, reasoningText } = collectReasoningContentParts(message.content as unknown[]);

    if (!reasoningText) {
      if (nextMessages) nextMessages.push(message);
      continue;
    }

    const existingProviderOptions = getModelMessageProviderOptions(message);
    const openaiCompatibleOptions = asRecord(existingProviderOptions?.openaiCompatible) ?? {};

    nextMessages = appendChangedItem(messages, nextMessages, messageIndex, {
      ...message,
      content: filteredContent as any,
      providerOptions: {
        ...(existingProviderOptions ?? {}),
        openaiCompatible: { ...openaiCompatibleOptions, reasoning_text: reasoningText },
      } as any,
    });
  }

  return nextMessages ?? messages;
}
