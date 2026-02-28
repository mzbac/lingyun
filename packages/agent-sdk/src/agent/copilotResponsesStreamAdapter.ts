import type { TextStreamPart } from 'ai';

import type { StreamAdapter, StreamAdapterContext, StreamErrorContext, StreamReplayUpdate } from './streamAdapters.js';
import { retryable as getRetryableLlmError } from './retry.js';
import { isCopilotResponsesModelId } from '@kooka/core';

function asNonEmptyTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export class CopilotResponsesStreamAdapter implements StreamAdapter {
  static isApplicable(context: StreamAdapterContext): boolean {
    return context.llmId === 'copilot' && isCopilotResponsesModelId(context.modelId);
  }

  private reasoningOpaque: string | undefined;
  private reasoningEncryptedContent: string | undefined;

  constructor(private readonly context: StreamAdapterContext) {}

  onPart(part: TextStreamPart<any>): void {
    const providerMetadata = (part as any)?.providerMetadata;
    if (!providerMetadata || typeof providerMetadata !== 'object') return;
    const copilot = (providerMetadata as any).copilot;
    if (!copilot || typeof copilot !== 'object') return;

    const reasoningOpaque = asNonEmptyTrimmedString((copilot as any).reasoningOpaque);
    const reasoningEncryptedContent = asNonEmptyTrimmedString((copilot as any).reasoningEncryptedContent);

    if (reasoningOpaque) this.reasoningOpaque = reasoningOpaque;
    if (reasoningEncryptedContent) this.reasoningEncryptedContent = reasoningEncryptedContent;
  }

  shouldIgnoreError(error: unknown, stream: StreamErrorContext): boolean {
    const retryable = getRetryableLlmError(error);
    const isResponsesParserError = retryable?.kind === 'responses_stream_parser_error';

    if (!isResponsesParserError) return false;
    if (stream.sawFinishPart) return true;
    if (String(stream.attemptText || '').trim()) return true;
    return false;
  }

  getReplayUpdates(): StreamReplayUpdate[] {
    if (!this.reasoningOpaque && !this.reasoningEncryptedContent) return [];

    return [
      {
        namespace: 'copilot',
        update: {
          ...(this.reasoningOpaque ? { reasoningOpaque: this.reasoningOpaque } : {}),
          ...(this.reasoningEncryptedContent ? { reasoningEncryptedContent: this.reasoningEncryptedContent } : {}),
        },
      },
    ];
  }
}
