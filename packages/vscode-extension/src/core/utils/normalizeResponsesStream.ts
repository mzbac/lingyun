import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3StreamResult } from '@ai-sdk/provider';

type LanguageModelV3Like = Pick<LanguageModelV3, 'specificationVersion' | 'doStream'> & Record<string, unknown>;

export type NormalizeResponsesStreamOptions = {
  /**
   * Whether to emit debug logs via `onDebug`.
   * Keep false by default to avoid noisy logs.
   */
  debugEnabled?: boolean;
  /**
   * Debug logger (wired to the VS Code "LingYun" output channel by the UI layer).
   * Must not receive prompts, token text, URLs, or secrets.
   */
  onDebug?: (message: string) => void;
  /**
   * Log prefix (e.g. "[CopilotResponses]").
   */
  prefix?: string;
};

function isLanguageModelV3Like(value: unknown): value is LanguageModelV3Like {
  return !!value && typeof value === 'object' && (value as LanguageModelV3Like).specificationVersion === 'v3' && typeof (value as LanguageModelV3Like).doStream === 'function';
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> {
  return !!value && typeof value === 'object' && typeof (value as { getReader?: unknown }).getReader === 'function';
}

/**
 * Copilot's `/responses` streaming can emit `text-delta` (and occasionally `text-end`)
 * before the corresponding `text-start`. The AI SDK `streamText()` state machine
 * treats that as a protocol violation and yields `text part <id> not found`.
 *
 * This wrapper normalizes v3 model streams by synthesizing missing `text-start`
 * boundaries (and closing dangling text parts on `finish`/EOF).
 */
export function normalizeResponsesStreamModel<T>(model: T, options?: NormalizeResponsesStreamOptions): T {
  if (!isLanguageModelV3Like(model)) return model;

  const original = model as unknown as LanguageModelV3Like;
  const originalDoStream = original.doStream.bind(original) as LanguageModelV3['doStream'];
  const debugEnabled = options?.debugEnabled === true;
  const onDebug = options?.onDebug;
  const prefix = options?.prefix?.trim() ? options.prefix.trim() : '[ResponsesStream]';

  const wrapped: LanguageModelV3Like = {
    ...original,
    doStream: async (options: unknown): Promise<LanguageModelV3StreamResult> => {
      const streamId = Math.random().toString(36).slice(2, 10);
      const log = (message: string) => {
        if (!debugEnabled || !onDebug) return;
        const safe = String(message || '').trim();
        if (!safe) return;
        onDebug(`${prefix} stream=${streamId} ${safe}`.trim());
      };

      const provider =
        typeof (original as { provider?: unknown }).provider === 'string'
          ? ((original as { provider?: unknown }).provider as string)
          : '';
      const modelId =
        typeof (original as { modelId?: unknown }).modelId === 'string'
          ? ((original as { modelId?: unknown }).modelId as string)
          : '';
      if (provider || modelId) {
        log(`start provider=${provider || '(unknown)'} model=${modelId || '(unknown)'}`);
      } else {
        log('start');
      }

      const result = await originalDoStream(options as any);
      if (!result || !isReadableStream((result as { stream?: unknown }).stream)) {
        log('skip reason=no-readable-stream');
        return result;
      }

      const stream = (result as { stream: ReadableStream<LanguageModelV3StreamPart> }).stream;
      return {
        ...result,
        stream: normalizeTextPartsStream(stream, log),
      };
    },
  };

  return wrapped as unknown as T;
}

function normalizeTextPartsStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  log: (message: string) => void
): ReadableStream<LanguageModelV3StreamPart> {
  const reader = stream.getReader();
  const openTextPartIds = new Set<string>();

  let partsIn = 0;
  let partsOut = 0;
  let insertedTextStarts = 0;
  let droppedDuplicateTextStarts = 0;
  let flushedTextEnds = 0;
  let invalidTextStartIds = 0;
  let invalidTextPartIds = 0;
  let loggedEnd = false;

  const logEnd = (reason: 'finish' | 'eof') => {
    if (loggedEnd) return;
    loggedEnd = true;
    log(
      `end reason=${reason} in=${String(partsIn)} out=${String(partsOut)} insertedTextStart=${String(
        insertedTextStarts,
      )} droppedTextStart=${String(droppedDuplicateTextStarts)} flushedTextEnd=${String(
        flushedTextEnds,
      )} invalidTextStartId=${String(invalidTextStartIds)} invalidTextPartId=${String(invalidTextPartIds)}`,
    );
  };

  const flushOpenTextParts = (
    controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
    reason: 'finish' | 'eof',
  ) => {
    if (openTextPartIds.size > 0) {
      const ids = Array.from(openTextPartIds);
      const sample = ids.slice(0, 5).join(',');
      const suffix = ids.length > 5 ? ',…' : '';
      log(`flush openTextParts=${String(ids.length)} reason=${reason} ids=${sample}${suffix}`);
    }
    for (const id of Array.from(openTextPartIds)) {
      controller.enqueue({ type: 'text-end', id } as LanguageModelV3StreamPart);
      partsOut += 1;
      flushedTextEnds += 1;
      openTextPartIds.delete(id);
    }
  };

  return new ReadableStream<LanguageModelV3StreamPart>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();

        if (done) {
          flushOpenTextParts(controller, 'eof');
          logEnd('eof');
          controller.close();
          return;
        }

        if (!value) return;
        partsIn += 1;

        if (value.type === 'text-start') {
          const id = (value as { id?: unknown }).id;
          if (typeof id !== 'string') {
            invalidTextStartIds += 1;
            if (invalidTextStartIds <= 5) {
              log(`pass-through text-start with non-string id type=${typeof id}`);
            } else if (invalidTextStartIds === 6) {
              log('pass-through text-start ... (suppressed)');
            }
            controller.enqueue(value);
            partsOut += 1;
            return;
          }

          // Drop duplicate starts (common when deltas arrive before starts).
          if (openTextPartIds.has(id)) {
            droppedDuplicateTextStarts += 1;
            if (droppedDuplicateTextStarts <= 5) {
              log(`drop duplicate text-start id=${id}`);
            }
            return;
          }

          openTextPartIds.add(id);
          controller.enqueue(value);
          partsOut += 1;
          return;
        }

        if (value.type === 'text-delta' || value.type === 'text-end') {
          const id = (value as { id?: unknown }).id;
          if (typeof id !== 'string') {
            invalidTextPartIds += 1;
            if (invalidTextPartIds <= 5) {
              log(`pass-through ${value.type} with non-string id type=${typeof id}`);
            } else if (invalidTextPartIds === 6) {
              log(`pass-through ${value.type} ... (suppressed)`);
            }
            controller.enqueue(value);
            partsOut += 1;
            return;
          }

          if (!openTextPartIds.has(id)) {
            openTextPartIds.add(id);
            controller.enqueue({ type: 'text-start', id } as LanguageModelV3StreamPart);
            partsOut += 1;
            insertedTextStarts += 1;
            if (insertedTextStarts <= 10) {
              log(`synthesize text-start id=${id} before=${value.type}`);
            } else if (insertedTextStarts === 11) {
              log('synthesize text-start ... (suppressed)');
            }
          }

          controller.enqueue(value);
          partsOut += 1;

          if (value.type === 'text-end') {
            openTextPartIds.delete(id);
          }
          return;
        }

        if (value.type === 'finish') {
          flushOpenTextParts(controller, 'finish');
          controller.enqueue(value);
          partsOut += 1;
          logEnd('finish');
          return;
        }

        controller.enqueue(value);
        partsOut += 1;
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
