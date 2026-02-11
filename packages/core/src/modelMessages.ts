import type { ModelMessage } from 'ai';

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
