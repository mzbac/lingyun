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

/**
 * Apply Codex-style image boundaries for Copilot image inputs:
 * - wraps each image file part with `<image>` and `</image>` text parts
 * - keeps data URLs as URL objects so openai-compatible serialization preserves them
 */
export function applyCopilotImageInputPattern(messages: ModelMessage[]): ModelMessage[] {
  let anyChanged = false;

  const next = messages.map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return message;
    }

    const content = message.content as unknown[];
    const transformed: unknown[] = [];
    let changed = false;

    for (let index = 0; index < content.length; index++) {
      const part = content[index];
      if (!isImageFilePart(part)) {
        transformed.push(part);
        continue;
      }

      const previousOriginal = index > 0 ? content[index - 1] : undefined;
      const nextOriginal = index + 1 < content.length ? content[index + 1] : undefined;
      const hasOpenBoundary = isTextPart(previousOriginal, IMAGE_OPEN_TAG_TEXT);
      const hasCloseBoundary = isTextPart(nextOriginal, IMAGE_CLOSE_TAG_TEXT);

      if (!hasOpenBoundary) {
        transformed.push({ type: 'text', text: IMAGE_OPEN_TAG_TEXT });
        changed = true;
      }

      const normalizedData = normalizeImageDataForOpenAICompatible(part.data);
      if (normalizedData !== part.data) {
        transformed.push({ ...part, data: normalizedData });
        changed = true;
      } else {
        transformed.push(part);
      }

      if (!hasCloseBoundary) {
        transformed.push({ type: 'text', text: IMAGE_CLOSE_TAG_TEXT });
        changed = true;
      }
    }

    if (!changed) return message;

    anyChanged = true;
    return {
      ...message,
      content: transformed as typeof message.content,
    };
  });

  return anyChanged ? next : messages;
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

function findProviderMetadata(parts: unknown[], type: 'text' | 'reasoning'): UnknownRecord | undefined {
  for (const part of parts) {
    const record = asRecord(part);
    if (!record || record.type !== type) continue;
    const meta = getProviderMetadata(part);
    if (meta) return meta;
  }
  return undefined;
}

function isReasoningPart(part: unknown): part is { type: 'reasoning'; text: string } {
  const record = asRecord(part);
  return !!record && record.type === 'reasoning' && typeof record.text === 'string';
}

function isTextHistoryPart(part: unknown): part is { type: 'text'; text: string } {
  const record = asRecord(part);
  return !!record && record.type === 'text' && typeof record.text === 'string';
}

/**
 * For prompt-cache friendliness we want to replay *exact* assistant output tokens on subsequent requests.
 *
 * The UI stores a cleaned assistant text for display, but we also persist the raw streamed output under
 * `message.metadata.replay`. This helper swaps assistant `text`/`reasoning` parts for the replay payload
 * (leaving tool parts untouched) without mutating the original history.
 */
export function applyAssistantReplayForPrompt(history: AgentHistoryMessage[]): AgentHistoryMessage[] {
  let anyChanged = false;

  const next = history.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.parts)) return message;

    const replayText = getReplayField(message, 'text');
    const replayReasoning = getReplayField(message, 'reasoning');
    if (replayText === undefined && replayReasoning === undefined) return message;

    const existingReasoningProviderMetadata = findProviderMetadata(message.parts as unknown[], 'reasoning');
    const existingTextProviderMetadata = findProviderMetadata(message.parts as unknown[], 'text');

    const copilotReasoningOpaque = getReplayCopilotField(message, 'reasoningOpaque');
    const copilotReasoningEncryptedContent = getReplayCopilotField(message, 'reasoningEncryptedContent');
    const reasoningProviderMetadata: UnknownRecord | undefined = (() => {
      if (!existingReasoningProviderMetadata && !copilotReasoningOpaque && !copilotReasoningEncryptedContent) return undefined;
      const merged = { ...(existingReasoningProviderMetadata ?? {}) };
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
    const textProviderMetadata = existingTextProviderMetadata ? { ...existingTextProviderMetadata } : undefined;

    const otherParts = message.parts.filter((part) => {
      const record = asRecord(part);
      if (!record) return true;
      return record.type !== 'text' && record.type !== 'reasoning';
    });

    const rebuilt: unknown[] = [];
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
      const originalReasoning = message.parts.filter(isReasoningPart);
      rebuilt.push(...originalReasoning.map((part) => ({ ...(part as any) })));
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
      const originalText = message.parts.filter(isTextHistoryPart);
      rebuilt.push(...originalText.map((part) => ({ ...(part as any) })));
    }

    const nextParts = [...rebuilt, ...otherParts] as unknown as AgentHistoryMessage['parts'];

    anyChanged = true;
    return {
      ...message,
      metadata: message.metadata ? { ...message.metadata } : undefined,
      parts: nextParts,
    };
  });

  return anyChanged ? next : history;
}

type ReasoningField = 'reasoning_content' | 'reasoning_details';

function getModelMessageProviderOptions(message: ModelMessage): UnknownRecord | undefined {
  const record = asRecord((message as any).providerOptions);
  return record;
}

/**
 * OpenAI-compatible request encoding ignores `reasoning` parts. To replay reasoning we lift reasoning parts
 * onto the assistant message as `providerOptions.openaiCompatible.reasoning_content` (OpenCode pattern),
 * while keeping tool calls and assistant text unchanged.
 */
export function applyOpenAICompatibleReasoningField(
  messages: ModelMessage[],
  params?: { field?: ReasoningField },
): ModelMessage[] {
  const field: ReasoningField = params?.field ?? 'reasoning_content';
  let anyChanged = false;

  const next = messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return message;

    const contentParts = message.content as unknown[];
    const reasoningText = contentParts
      .filter((part) => {
        const record = asRecord(part);
        return !!record && record.type === 'reasoning' && typeof record.text === 'string';
      })
      .map((part) => (part as any).text as string)
      .join('');

    if (!reasoningText) return message;

    const filteredContent = contentParts.filter((part) => {
      const record = asRecord(part);
      return !(record && record.type === 'reasoning');
    });

    const existingProviderOptions = getModelMessageProviderOptions(message);
    const openaiCompatibleOptions = asRecord(existingProviderOptions?.openaiCompatible) ?? {};

    anyChanged = true;
    return {
      ...message,
      content: filteredContent as any,
      providerOptions: {
        ...(existingProviderOptions ?? {}),
        openaiCompatible: { ...openaiCompatibleOptions, [field]: reasoningText },
      } as any,
    };
  });

  return anyChanged ? next : messages;
}

/**
 * Copilot's chat-completions backend supports `reasoning_text` / `reasoning_opaque` fields on assistant
 * messages, but the AI SDK openai-compatible encoder ignores `reasoning` parts. To replay reasoning for
 * prompt-cache friendliness we lift reasoning parts onto `providerOptions.openaiCompatible.reasoning_text`.
 */
export function applyCopilotReasoningFields(messages: ModelMessage[]): ModelMessage[] {
  let anyChanged = false;

  const next = messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return message;

    const contentParts = message.content as unknown[];
    const reasoningText = contentParts
      .filter((part) => {
        const record = asRecord(part);
        return !!record && record.type === 'reasoning' && typeof record.text === 'string';
      })
      .map((part) => (part as any).text as string)
      .join('');

    if (!reasoningText) return message;

    const filteredContent = contentParts.filter((part) => {
      const record = asRecord(part);
      return !(record && record.type === 'reasoning');
    });

    const existingProviderOptions = getModelMessageProviderOptions(message);
    const openaiCompatibleOptions = asRecord(existingProviderOptions?.openaiCompatible) ?? {};

    anyChanged = true;
    return {
      ...message,
      content: filteredContent as any,
      providerOptions: {
        ...(existingProviderOptions ?? {}),
        openaiCompatible: { ...openaiCompatibleOptions, reasoning_text: reasoningText },
      } as any,
    };
  });

  return anyChanged ? next : messages;
}
