import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3StreamResult, LanguageModelV3Usage } from '@ai-sdk/provider';

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
  /**
   * When true, rewrite all text parts to a single canonical text id per stream.
   * This mirrors Copilot Chat's delta-accumulation behavior and avoids provider
   * text-part id churn causing downstream "text part not found" errors.
   */
  canonicalizeTextPartIds?: boolean;
};

function isLanguageModelV3Like(value: unknown): value is LanguageModelV3Like {
  return !!value && typeof value === 'object' && (value as LanguageModelV3Like).specificationVersion === 'v3' && typeof (value as LanguageModelV3Like).doStream === 'function';
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> {
  return !!value && typeof value === 'object' && typeof (value as { getReader?: unknown }).getReader === 'function';
}

const RECOVERED_FINISH_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
  raw: {},
};

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    const name = typeof error.name === 'string' ? error.name.trim() : '';
    if (message && name) return `${name}: ${message}`;
    return message || name || 'Unknown error';
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function truncateForLog(value: string, max = 240): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function isSummaryPartsUndefinedError(error: unknown): boolean {
  const msg = stringifyError(error).toLowerCase();
  return msg.includes('summaryparts') && msg.includes('undefined');
}

function createRecoveredFinishPart(): LanguageModelV3StreamPart {
  return {
    type: 'finish',
    usage: RECOVERED_FINISH_USAGE,
    finishReason: { unified: 'error', raw: 'recovered-stream-error' },
  } as LanguageModelV3StreamPart;
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
  const canonicalizeTextPartIds = options?.canonicalizeTextPartIds === true;

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
        log(
          `start provider=${provider || '(unknown)'} model=${modelId || '(unknown)'} canonicalizeTextPartIds=${canonicalizeTextPartIds ? 'on' : 'off'}`,
        );
      } else {
        log(`start canonicalizeTextPartIds=${canonicalizeTextPartIds ? 'on' : 'off'}`);
      }

      const result = await originalDoStream(options as any);
      if (!result || !isReadableStream((result as { stream?: unknown }).stream)) {
        log('skip reason=no-readable-stream');
        return result;
      }

      const stream = (result as { stream: ReadableStream<LanguageModelV3StreamPart> }).stream;
      return {
        ...result,
        stream: normalizeTextPartsStream(stream, log, { canonicalizeTextPartIds }),
      };
    },
  };

  return wrapped as unknown as T;
}

function normalizeTextPartsStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  log: (message: string) => void,
  options?: { canonicalizeTextPartIds?: boolean }
): ReadableStream<LanguageModelV3StreamPart> {
  const reader = stream.getReader();
  const openTextPartIds = new Set<string>();
  const canonicalizeTextPartIds = options?.canonicalizeTextPartIds === true;
  let canonicalTextId: string | null = null;
  let canonicalStartEmitted = false;

  let partsIn = 0;
  let partsOut = 0;
  let insertedTextStarts = 0;
  let droppedDuplicateTextStarts = 0;
  let flushedTextEnds = 0;
  let invalidTextStartIds = 0;
  let invalidTextPartIds = 0;
  let droppedAfterFinish = 0;
  let rewrittenTextParts = 0;
  let recoveredSummaryPartsErrors = 0;
  let recoveredPostFinishErrors = 0;
  let finished = false;
  let loggedEnd = false;

  const logEnd = (reason: 'finish' | 'eof') => {
    if (loggedEnd) return;
    loggedEnd = true;
    log(
      `end reason=${reason} in=${String(partsIn)} out=${String(partsOut)} insertedTextStart=${String(
        insertedTextStarts,
      )} droppedTextStart=${String(droppedDuplicateTextStarts)} flushedTextEnd=${String(
        flushedTextEnds,
      )} invalidTextStartId=${String(invalidTextStartIds)} invalidTextPartId=${String(
        invalidTextPartIds,
      )} droppedAfterFinish=${String(droppedAfterFinish)} rewrittenTextParts=${String(
        rewrittenTextParts,
      )} recoveredSummaryPartsErrors=${String(
        recoveredSummaryPartsErrors,
      )} recoveredPostFinishErrors=${String(recoveredPostFinishErrors)}`,
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
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            flushOpenTextParts(controller, 'eof');
            logEnd('eof');
            controller.close();
            return;
          }

          if (!value) continue;
          partsIn += 1;

          if (finished) {
            droppedAfterFinish += 1;
            if (droppedAfterFinish <= 5) {
              log(`drop post-finish part type=${value.type}`);
            } else if (droppedAfterFinish === 6) {
              log('drop post-finish part ... (suppressed)');
            }
            continue;
          }

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
              continue;
            }

            if (canonicalizeTextPartIds) {
              if (!canonicalTextId) {
                canonicalTextId = id;
              }
              if (!canonicalStartEmitted) {
                canonicalStartEmitted = true;
                openTextPartIds.add(canonicalTextId);
                controller.enqueue({ ...value, id: canonicalTextId });
                partsOut += 1;
                return;
              }
              // Ignore provider-specific text-start ids after canonical stream is open.
              continue;
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

            if (canonicalizeTextPartIds) {
              const targetId = canonicalTextId ?? id;
              if (!canonicalTextId) {
                canonicalTextId = targetId;
              }
              if (!canonicalStartEmitted) {
                canonicalStartEmitted = true;
                openTextPartIds.add(targetId);
                controller.enqueue({ type: 'text-start', id: targetId } as LanguageModelV3StreamPart);
                partsOut += 1;
                insertedTextStarts += 1;
                if (insertedTextStarts <= 10) {
                  log(`synthesize canonical text-start id=${targetId} sourceId=${id} before=${value.type}`);
                } else if (insertedTextStarts === 11) {
                  log('synthesize canonical text-start ... (suppressed)');
                }
              }

              if (value.type === 'text-delta') {
                if (id !== targetId) {
                  rewrittenTextParts += 1;
                }
                controller.enqueue({ ...value, id: targetId });
                partsOut += 1;
                return;
              }

              // For canonical mode, tolerate provider text-end id churn and close only canonical id.
              if (openTextPartIds.has(targetId)) {
                if (id !== targetId) {
                  rewrittenTextParts += 1;
                }
                controller.enqueue({ ...value, id: targetId });
                partsOut += 1;
                openTextPartIds.delete(targetId);
                return;
              }
              continue;
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
            finished = true;
            logEnd('finish');
            return;
          }

          controller.enqueue(value);
          partsOut += 1;
          return;
        }
      } catch (error) {
        const errorText = truncateForLog(stringifyError(error));

        if (finished) {
          recoveredPostFinishErrors += 1;
          if (recoveredPostFinishErrors <= 5) {
            log(`recover post-finish stream-error message=${errorText}`);
          } else if (recoveredPostFinishErrors === 6) {
            log('recover post-finish stream-error ... (suppressed)');
          }
          controller.close();
          return;
        }

        if (isSummaryPartsUndefinedError(error)) {
          recoveredSummaryPartsErrors += 1;
          log(`recover stream-error kind=summaryPartsUndefined message=${errorText}`);
          flushOpenTextParts(controller, 'finish');
          controller.enqueue(createRecoveredFinishPart());
          partsOut += 1;
          finished = true;
          logEnd('finish');
          controller.close();
          return;
        }

        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
