import type {
  JSONValue,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { Buffer } from 'buffer';
import { normalizeTemperatureForModel } from '@kooka/core';
import { normalizeBaseURL } from './openaiFetch';
import { classifyProviderTransportError, createProviderHttpError, createProviderResponseMetadata, fetchProviderResponse, readProviderResponseBody, sanitizeProviderDiagnosticCause, type ProviderResponseMetadata } from './providerErrors';
import { redactSensitive } from '../core/agent/debug';

type PendingToolCall = {
  toolCallId: string;
  toolName: string;
  input: string;
};

type ResponsesModelBehavior = {
  providerOptionKeys: string[];
  systemPromptMode: 'input' | 'instructions';
  includeSamplingOptions: boolean;
  reasoningReplayProviderKey?: string;
  finishProviderMetadataKey?: string;
};

export type ResponsesModelOptions = {
  baseURL: string;
  apiKey?: string;
  modelId: string;
  headers: Record<string, string>;
  provider: string;
  errorLabel: string;
  fetch?: FetchFunction;
  behavior: ResponsesModelBehavior;
};

const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  raw: {},
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asHttpStatus(value: unknown): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined) return undefined;
  const status = Math.floor(parsed);
  return status >= 100 && status <= 599 ? status : undefined;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

function omitUndefinedFields(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function usageFromResponses(rawUsage: unknown): LanguageModelV3Usage {
  const usage = asRecord(rawUsage);
  const inputTotal = asNumber(usage?.['input_tokens']);
  const cachedTokens = asNumber(asRecord(usage?.['input_tokens_details'])?.['cached_tokens']) ?? 0;
  const noCache = inputTotal === undefined ? undefined : Math.max(0, inputTotal - cachedTokens);

  const outputTotal = asNumber(usage?.['output_tokens']);
  const reasoningTokens = asNumber(asRecord(usage?.['output_tokens_details'])?.['reasoning_tokens']) ?? 0;
  const textTokens = outputTotal === undefined ? undefined : Math.max(0, outputTotal - reasoningTokens);

  return {
    inputTokens: {
      total: inputTotal,
      noCache,
      cacheRead: inputTotal === undefined ? undefined : cachedTokens,
      cacheWrite: 0,
    },
    outputTokens: {
      total: outputTotal,
      text: textTokens,
      reasoning: outputTotal === undefined ? undefined : reasoningTokens,
    },
    raw: usage as Record<string, JSONValue>,
  };
}

function mapFinishReason(rawReason: unknown, hasToolCall: boolean): LanguageModelV3FinishReason {
  const raw = asString(rawReason);
  if (hasToolCall) return { unified: 'tool-calls', raw };
  if (!raw || raw === 'stop' || raw === 'completed') return { unified: 'stop', raw };
  if (raw === 'max_output_tokens' || raw === 'length') return { unified: 'length', raw };
  if (raw === 'content_filter' || raw === 'content-filter') return { unified: 'content-filter', raw };
  if (raw === 'error') return { unified: 'error', raw };
  return { unified: 'other', raw };
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function normalizeFileData(data: unknown, mediaType: string): string | undefined {
  if (data instanceof URL) return data.toString();
  if (typeof data === 'string') {
    if (data.startsWith('http://') || data.startsWith('https://') || data.startsWith('data:')) {
      return data;
    }
    return `data:${mediaType};base64,${data}`;
  }
  if (data instanceof Uint8Array) {
    return `data:${mediaType};base64,${toBase64(data)}`;
  }
  return undefined;
}

function serializeToolOutput(output: unknown): string {
  const toolOutput = asRecord(output);
  const kind = asString(toolOutput?.['type']);
  if (!kind) return safeJsonStringify(output);

  if (kind === 'text') return asString(toolOutput?.['value']) ?? '';
  if (kind === 'error-text') return asString(toolOutput?.['value']) ?? '';
  if (kind === 'json' || kind === 'error-json') return safeJsonStringify(toolOutput?.['value']);
  if (kind === 'execution-denied') return asString(toolOutput?.['reason']) ?? 'Execution denied';
  if (kind === 'content') {
    const value = toolOutput?.['value'];
    if (!Array.isArray(value)) return '';
    const text = value
      .map((entry) => {
        const part = asRecord(entry);
        return asString(part?.['type']) === 'text' ? asString(part?.['text']) ?? '' : '';
      })
      .filter(Boolean)
      .join('\n');
    return text || safeJsonStringify(output);
  }

  return safeJsonStringify(output);
}

function normalizeSystemInstructionContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        const record = asRecord(entry);
        if (asString(record?.['type']) === 'text') {
          return asString(record?.['text']) ?? '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    const trimmed = text.trim();
    return trimmed || undefined;
  }

  return undefined;
}

function getReasoningReplay(
  providerOptions: unknown,
  providerKey?: string,
): { id?: string; encryptedContent?: string } | undefined {
  if (!providerKey) return undefined;
  const root = asRecord(providerOptions);
  const provider = asRecord(root?.[providerKey]);
  if (!provider) return undefined;
  const id = asString(provider['reasoningOpaque']);
  const encryptedContent = asString(provider['reasoningEncryptedContent']);
  if (!id && !encryptedContent) return undefined;
  return { id, encryptedContent };
}

function promptToResponsesRequest(
  prompt: LanguageModelV3Prompt,
  behavior: ResponsesModelBehavior,
): { input: unknown[]; instructions?: string } {
  const input: unknown[] = [];
  const instructions: string[] = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      if (behavior.systemPromptMode === 'instructions') {
        const instruction = normalizeSystemInstructionContent(message.content);
        if (instruction) instructions.push(instruction);
      } else {
        input.push({ role: 'system', content: message.content });
      }
      continue;
    }

    if (message.role === 'user') {
      const content: unknown[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push({ type: 'input_text', text: part.text });
        } else if (part.type === 'file') {
          const mediaType = asString(part.mediaType) ?? 'application/octet-stream';
          const normalizedData = normalizeFileData(part.data, mediaType);
          if (!normalizedData) continue;

          if (mediaType.startsWith('image/')) {
            content.push({
              type: 'input_image',
              image_url: normalizedData,
              detail: 'auto',
            });
          } else {
            content.push({
              type: 'input_file',
              file_data: normalizedData,
              filename: part.filename,
            });
          }
        }
      }
      input.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'assistant') {
      const assistantContent: unknown[] = [];

      for (const part of message.content) {
        if (part.type === 'reasoning') {
          const replay = getReasoningReplay(part.providerOptions, behavior.reasoningReplayProviderKey);
          if (replay?.id && replay.encryptedContent) {
            input.push({
              type: 'reasoning',
              id: replay.id,
              summary: [],
              encrypted_content: replay.encryptedContent,
            });
          }
          continue;
        }

        if (part.type === 'text') {
          assistantContent.push({ type: 'output_text', text: part.text, annotations: [] });
          continue;
        }

        if (part.type === 'tool-call') {
          const argumentsString =
            typeof part.input === 'string' ? part.input : safeJsonStringify(part.input);
          input.push({
            type: 'function_call',
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: argumentsString,
          });
          continue;
        }

        if (part.type === 'tool-result') {
          input.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: serializeToolOutput(part.output),
          });
        }
      }

      if (assistantContent.length > 0) {
        input.push({ role: 'assistant', content: assistantContent });
      }

      continue;
    }

    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue;
        input.push({
          type: 'function_call_output',
          call_id: part.toolCallId,
          output: serializeToolOutput(part.output),
        });
      }
    }
  }

  return {
    input,
    instructions: instructions.length > 0 ? instructions.join('\n\n') : undefined,
  };
}

function toolChoiceToResponses(toolChoice: LanguageModelV3CallOptions['toolChoice']): unknown {
  if (!toolChoice) return undefined;
  if (toolChoice.type === 'tool') {
    return { type: 'function', name: toolChoice.toolName };
  }
  return toolChoice.type;
}

function toolsToResponses(tools: LanguageModelV3CallOptions['tools']): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const functionTools = tools.filter(tool => tool.type === 'function');
  if (functionTools.length === 0) return undefined;

  return functionTools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: tool.strict ?? false,
  }));
}

function extractProviderOptionString(
  providerOptions: LanguageModelV3CallOptions['providerOptions'],
  providerKeys: string[],
  optionKey: string,
): string | undefined {
  const root = asRecord(providerOptions);
  for (const providerKey of providerKeys) {
    const provider = asRecord(root?.[providerKey]);
    const value = asString(provider?.[optionKey]);
    if (value) return value;
  }
  return undefined;
}

function createResponsesBody(
  modelId: string,
  options: LanguageModelV3CallOptions,
  behavior: ResponsesModelBehavior,
): Record<string, unknown> {
  const effort = extractProviderOptionString(options.providerOptions, behavior.providerOptionKeys, 'reasoningEffort');
  const verbosity = extractProviderOptionString(options.providerOptions, behavior.providerOptionKeys, 'textVerbosity');
  const instructionsOverride = extractProviderOptionString(
    options.providerOptions,
    behavior.providerOptionKeys,
    'instructions',
  );
  const effectiveBehavior =
    instructionsOverride !== undefined
      ? { ...behavior, systemPromptMode: 'instructions' as const }
      : behavior;
  const promptParts = promptToResponsesRequest(options.prompt, effectiveBehavior);
  const reasoning = effort ? { effort } : undefined;

  return omitUndefinedFields({
    model: modelId,
    input: promptParts.input,
    ...(effectiveBehavior.systemPromptMode === 'instructions'
      ? { instructions: instructionsOverride ?? promptParts.instructions }
      : {}),
    stream: true,
    store: false,
    ...(reasoning ? { include: ['reasoning.encrypted_content'] } : {}),
    tools: toolsToResponses(options.tools),
    tool_choice: toolChoiceToResponses(options.toolChoice),
    ...(behavior.includeSamplingOptions
      ? {
          temperature: normalizeTemperatureForModel(modelId, options.temperature),
          top_p: options.topP,
          max_output_tokens: options.maxOutputTokens,
        }
      : {}),
    text: verbosity ? { verbosity } : undefined,
    reasoning,
  });
}

function isSummaryPartsParserStateError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    (lower.includes('summaryparts') && lower.includes('undefined')) ||
    (lower.includes('text part') && lower.includes('not found'))
  );
}

function parseSseEvent(rawEvent: string): { data?: string; eventType?: string } | undefined {
  const lines = rawEvent.split(/\r?\n/);
  const dataLines: string[] = [];
  let eventType: string | undefined;

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    } else if (line.startsWith('event:')) {
      eventType = line.slice(6).trim() || undefined;
    }
  }

  if (dataLines.length === 0) return undefined;
  return { data: dataLines.join('\n'), eventType };
}

function nextEventBoundary(buffer: string): { index: number; length: number } | undefined {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');

  if (lf < 0 && crlf < 0) return undefined;
  if (lf < 0) return { index: crlf, length: 4 };
  if (crlf < 0) return { index: lf, length: 2 };
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function nonEmptyString(value: unknown): string | undefined {
  const text = asString(value)?.trim();
  return text || undefined;
}

function looksLikeErrorCode(value: string | undefined): value is string {
  return Boolean(value && /^[a-z][a-z0-9._-]*$/i.test(value));
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function retryAfterSecondsOrEpochMs(value: unknown): number | undefined {
  const parsed = parsePositiveNumber(value);
  if (parsed !== undefined) {
    const now = Date.now();
    if (parsed > 1_000_000_000_000) {
      const delta = parsed - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    if (parsed > 1_000_000_000) {
      const delta = parsed * 1000 - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    return Math.ceil(parsed * 1000);
  }

  if (typeof value === 'string') {
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return Math.ceil(delta);
    }
  }

  return undefined;
}

function retryAfterMsFromRecord(record: Record<string, unknown> | undefined): number | undefined {
  if (!record) return undefined;

  const milliseconds = parsePositiveNumber(record['retry_after_ms']) ?? parsePositiveNumber(record['retryAfterMs']);
  if (milliseconds !== undefined) return Math.ceil(milliseconds);

  return retryAfterSecondsOrEpochMs(record['retry_after']) ?? retryAfterSecondsOrEpochMs(record['retryAfter']);
}

function retryAfterMsFromMessage(message: string | undefined): number | undefined {
  if (!message) return undefined;

  const match = message.match(/(?:retry|try again|available again)[^.\n\r]*?\b(?:in|after)\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|msec|millisecond(?:s)?|s|sec|second(?:s)?)\b/i);
  if (!match) return undefined;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const unit = match[2].toLowerCase();
  return Math.ceil(unit.startsWith('m') ? value : value * 1000);
}

function redactKnownResponsesValue(text: string, value: string | undefined, replacement: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return text;
  return text.split(trimmed).join(replacement);
}

function sanitizeResponsesDiagnosticText(text: string, context?: { modelId?: string }): string {
  return redactKnownResponsesValue(redactSensitive(text), context?.modelId, '<model>');
}

function formatResponsesErrorMessage(
  fallback: string,
  details: {
    message?: string;
    code?: string;
    type?: string;
    param?: string;
    reason?: string;
    eventType?: string;
    lastEventType?: string;
    responseId?: string;
    responseStatus?: string;
    status?: number;
  },
  context?: { modelId?: string },
): string {
  const safeDetail = (value: string | undefined) => (value ? sanitizeResponsesDiagnosticText(value, context) : undefined);
  const base = safeDetail(details.message) || sanitizeResponsesDiagnosticText(fallback, context);
  const suffix = [
    safeDetail(details.code) ? `code=${safeDetail(details.code)}` : undefined,
    safeDetail(details.type) ? `type=${safeDetail(details.type)}` : undefined,
    safeDetail(details.param) ? `param=${safeDetail(details.param)}` : undefined,
    safeDetail(details.reason) ? `reason=${safeDetail(details.reason)}` : undefined,
    safeDetail(details.eventType) ? `event=${safeDetail(details.eventType)}` : undefined,
    safeDetail(details.lastEventType) ? `lastEvent=${safeDetail(details.lastEventType)}` : undefined,
    safeDetail(details.responseId) ? `response=${safeDetail(details.responseId)}` : undefined,
    safeDetail(details.responseStatus) ? `status=${safeDetail(details.responseStatus)}` : undefined,
    details.status !== undefined ? `httpStatus=${details.status}` : undefined,
  ].filter(Boolean);
  return suffix.length > 0 ? `${base} (${suffix.join(', ')})` : base;
}

function extractNestedResponsesError(
  event: Record<string, unknown>,
): {
  message?: string;
  code?: string;
  type?: string;
  param?: string;
  reason?: string;
  eventType?: string;
  lastEventType?: string;
  responseId?: string;
  responseStatus?: string;
  status?: number;
  retryAfterMs?: number;
} {
  const eventType = nonEmptyString(event['type']);
  const response = asRecord(event['response']);
  const data = asRecord(event['data']);
  const eventError = event['error'];
  const dataError = data?.['error'];
  const eventErrorString = typeof eventError === 'string' ? nonEmptyString(eventError) : undefined;
  const dataErrorString = typeof dataError === 'string' ? nonEmptyString(dataError) : undefined;
  const nested = asRecord(response?.['error']) ?? asRecord(eventError) ?? asRecord(dataError) ?? data;
  const incompleteDetails = asRecord(response?.['incomplete_details']) ?? asRecord(event['incomplete_details']) ?? asRecord(data?.['incomplete_details']);
  const reason = nonEmptyString(incompleteDetails?.['reason']) ?? nonEmptyString(event['reason']) ?? nonEmptyString(data?.['reason']);
  const status = asHttpStatus(nested?.['status']) ?? asHttpStatus(nested?.['status_code']) ?? asHttpStatus(nested?.['statusCode']) ?? asHttpStatus(response?.['status_code']) ?? asHttpStatus(response?.['statusCode']) ?? asHttpStatus(data?.['status']) ?? asHttpStatus(data?.['status_code']) ?? asHttpStatus(data?.['statusCode']) ?? asHttpStatus(event['status']) ?? asHttpStatus(event['status_code']) ?? asHttpStatus(event['statusCode']);

  const message =
    nonEmptyString(nested?.['message']) ??
    nonEmptyString(data?.['message']) ??
    nonEmptyString(event['message']) ??
    nonEmptyString(nested?.['error_description']) ??
    nonEmptyString(nested?.['errorDescription']) ??
    nonEmptyString(data?.['error_description']) ??
    nonEmptyString(data?.['errorDescription']) ??
    nonEmptyString(event['error_description']) ??
    nonEmptyString(event['errorDescription']) ??
    eventErrorString ??
    dataErrorString ??
    (eventType === 'response.incomplete'
      ? `Incomplete response returned, reason: ${reason ?? 'unknown'}`
      : undefined);

  return {
    message,
    code:
      nonEmptyString(nested?.['code']) ??
      nonEmptyString(nested?.['error_code']) ??
      nonEmptyString(nested?.['errorCode']) ??
      nonEmptyString(data?.['code']) ??
      nonEmptyString(data?.['error_code']) ??
      nonEmptyString(data?.['errorCode']) ??
      nonEmptyString(event['code']) ??
      nonEmptyString(event['error_code']) ??
      nonEmptyString(event['errorCode']) ??
      (looksLikeErrorCode(eventErrorString) ? eventErrorString : undefined) ??
      (looksLikeErrorCode(dataErrorString) ? dataErrorString : undefined) ??
      (eventType === 'response.incomplete' ? 'response_incomplete' : undefined),
    type:
      nonEmptyString(nested?.['type']) ??
      nonEmptyString(nested?.['error_type']) ??
      nonEmptyString(nested?.['errorType']) ??
      nonEmptyString(data?.['type']) ??
      nonEmptyString(data?.['error_type']) ??
      nonEmptyString(data?.['errorType']) ??
      nonEmptyString(event['error_type']) ??
      nonEmptyString(event['errorType']) ??
      (eventType === 'response.incomplete' ? 'incomplete_response' : undefined),
    param: nonEmptyString(nested?.['param']) ?? nonEmptyString(data?.['param']) ?? nonEmptyString(event['param']),
    reason,
    eventType,
    lastEventType: nonEmptyString(event['last_event_type']) ?? nonEmptyString(event['lastEventType']) ?? nonEmptyString(data?.['last_event_type']) ?? nonEmptyString(data?.['lastEventType']),
    responseId: nonEmptyString(response?.['id']) ?? nonEmptyString(event['response_id']) ?? nonEmptyString(data?.['response_id']),
    responseStatus: nonEmptyString(response?.['status']) ?? nonEmptyString(event['status']) ?? nonEmptyString(data?.['status']),
    ...(status !== undefined ? { status } : {}),
    retryAfterMs: retryAfterMsFromRecord(nested) ?? retryAfterMsFromRecord(response) ?? retryAfterMsFromRecord(data) ?? retryAfterMsFromRecord(event) ?? retryAfterMsFromMessage(message),
  };
}

type ResponsesStreamErrorContext = {
  provider: string;
  modelId: string;
  url: string;
  responseMetadata?: ProviderResponseMetadata;
};

function streamErrorBaseMetadata(context: ResponsesStreamErrorContext): Record<string, unknown> {
  return {
    provider: context.provider,
    providerId: context.provider,
    modelId: context.modelId,
    url: context.url,
    ...(context.responseMetadata ?? {}),
  };
}

function responsesStreamError(
  event: Record<string, unknown>,
  fallback: string,
  context: ResponsesStreamErrorContext,
): Error {
  const details = extractNestedResponsesError(event);
  const error = new Error(formatResponsesErrorMessage(fallback, details, context));
  error.name = 'ResponsesStreamError';
  Object.assign(error, {
    ...streamErrorBaseMetadata(context),
    ...(details.retryAfterMs ? { retryAfterMs: details.retryAfterMs } : {}),
    ...(details.code ? { code: details.code, errorCode: details.code } : {}),
    ...(details.type ? { type: details.type, errorType: details.type } : {}),
    ...(details.param ? { param: details.param } : {}),
    ...(details.reason ? { reason: details.reason } : {}),
    ...(details.eventType ? { eventType: details.eventType } : {}),
    ...(details.lastEventType ? { lastEventType: details.lastEventType } : {}),
    ...(details.responseId ? { responseId: details.responseId } : {}),
    ...(details.responseStatus ? { responseStatus: details.responseStatus } : {}),
    ...(details.status !== undefined ? { status: details.status, statusCode: details.status } : {}),
  });
  return error;
}

function responsesStreamTerminatedError(context: ResponsesStreamErrorContext & {
  lastEventType?: string;
  openTextCount: number;
  openReasoningCount: number;
  pendingToolCallCount: number;
}): Error {
  const details = {
    message: 'Responses stream terminated before response.completed',
    code: 'stream_terminated',
    type: 'incomplete_response',
    eventType: 'stream.terminated',
    lastEventType: context.lastEventType,
  };
  const state = [
    context.openTextCount > 0 ? `openText=${context.openTextCount}` : undefined,
    context.openReasoningCount > 0 ? `openReasoning=${context.openReasoningCount}` : undefined,
    context.pendingToolCallCount > 0 ? `pendingToolCalls=${context.pendingToolCallCount}` : undefined,
  ].filter(Boolean);
  const error = new Error(`${formatResponsesErrorMessage(details.message, details, context)}${state.length > 0 ? ` (${state.join(', ')})` : ''}`);
  error.name = 'ResponsesStreamError';
  Object.assign(error, {
    ...streamErrorBaseMetadata(context),
    code: details.code,
    errorCode: details.code,
    type: details.type,
    errorType: details.type,
    eventType: details.eventType,
    ...(context.lastEventType ? { lastEventType: context.lastEventType } : {}),
    openTextCount: context.openTextCount,
    openReasoningCount: context.openReasoningCount,
    pendingToolCallCount: context.pendingToolCallCount,
  });
  return error;
}

function responsesStreamParseError(context: ResponsesStreamErrorContext & {
  parseError: unknown;
  dataLength: number;
  lastEventType?: string;
}): Error {
  const details = {
    message: 'Responses stream contained invalid JSON event data',
    code: 'invalid_sse_json',
    type: 'invalid_response',
    eventType: 'stream.parse_error',
    lastEventType: context.lastEventType,
  };
  const parseErrorName = context.parseError instanceof Error ? context.parseError.name : typeof context.parseError;
  const error = new Error(`${formatResponsesErrorMessage(details.message, details, context)} (parseError=${parseErrorName}, dataLength=${context.dataLength})`);
  error.name = 'ResponsesStreamError';
  Object.assign(error, {
    ...streamErrorBaseMetadata(context),
    code: details.code,
    errorCode: details.code,
    type: details.type,
    errorType: details.type,
    eventType: details.eventType,
    ...(context.lastEventType ? { lastEventType: context.lastEventType } : {}),
    parseErrorName,
    dataLength: context.dataLength,
  });
  return error;
}

function responsesStreamReadError(context: ResponsesStreamErrorContext & {
  cause: unknown;
  lastEventType?: string;
}): Error {
  const classification = classifyProviderTransportError(context.cause);
  const code = classification.type === 'network_error' ? 'stream_read_error' : classification.code;
  const details = {
    message: 'Responses stream read failed',
    code,
    type: classification.type,
    eventType: 'stream.read_error',
    lastEventType: context.lastEventType,
  };
  const causeName = context.cause instanceof Error ? context.cause.name : typeof context.cause;
  const causeMessage = sanitizeResponsesDiagnosticText(
    context.cause instanceof Error ? context.cause.message : String(context.cause ?? ''),
    context,
  );
  const safeCause = sanitizeProviderDiagnosticCause(context.cause, context.modelId);
  const suffix = causeMessage ? ` (cause=${causeName}: ${causeMessage})` : ` (cause=${causeName})`;
  const error = new Error(`${formatResponsesErrorMessage(details.message, details, context)}${suffix}`);
  error.name = 'ResponsesStreamError';
  Object.assign(error, {
    cause: safeCause,
    ...streamErrorBaseMetadata(context),
    code: details.code,
    errorCode: details.code,
    type: details.type,
    errorType: details.type,
    eventType: details.eventType,
    ...(classification.code !== details.code ? { causeCode: classification.code } : {}),
    ...(context.lastEventType ? { lastEventType: context.lastEventType } : {}),
    causeName,
  });
  return error;
}

function responsesStreamUnexpectedError(context: ResponsesStreamErrorContext & {
  cause: unknown;
  lastEventType?: string;
}): Error {
  if (context.cause instanceof Error && context.cause.name === 'ResponsesStreamError') {
    return context.cause;
  }

  const details = {
    message: 'Responses stream adapter failed',
    code: 'stream_adapter_error',
    type: 'invalid_response',
    eventType: 'stream.adapter_error',
    lastEventType: context.lastEventType,
  };
  const causeName = context.cause instanceof Error ? context.cause.name : typeof context.cause;
  const causeMessage = sanitizeResponsesDiagnosticText(
    context.cause instanceof Error ? context.cause.message : String(context.cause ?? ''),
    context,
  );
  const safeCause = sanitizeProviderDiagnosticCause(context.cause, context.modelId);
  const suffix = causeMessage ? ` (cause=${causeName}: ${causeMessage})` : ` (cause=${causeName})`;
  const error = new Error(`${formatResponsesErrorMessage(details.message, details, context)}${suffix}`);
  error.name = 'ResponsesStreamError';
  Object.assign(error, {
    cause: safeCause,
    ...streamErrorBaseMetadata(context),
    code: details.code,
    errorCode: details.code,
    type: details.type,
    errorType: details.type,
    eventType: details.eventType,
    ...(context.lastEventType ? { lastEventType: context.lastEventType } : {}),
    causeName,
  });
  return error;
}

function buildFinishProviderMetadata(
  behavior: ResponsesModelBehavior,
  replay: { id: string; encryptedContent?: string } | undefined,
): Record<string, Record<string, string>> | undefined {
  if (!replay || !behavior.finishProviderMetadataKey) return undefined;

  return {
    [behavior.finishProviderMetadataKey]: {
      reasoningOpaque: replay.id,
      ...(replay.encryptedContent
        ? { reasoningEncryptedContent: replay.encryptedContent }
        : {}),
    },
  };
}

function createResponsesStream(
  responseBody: ReadableStream<Uint8Array>,
  options: { includeRawChunks: boolean; provider: string; modelId: string; url: string; behavior: ResponsesModelBehavior; responseMetadata: ProviderResponseMetadata },
): ReadableStream<LanguageModelV3StreamPart> {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      void (async () => {
        let buffer = '';
        let finished = false;
        let terminalError = false;
        let hasFunctionCall = false;
        let usage: LanguageModelV3Usage = EMPTY_USAGE;
        let finishReason: LanguageModelV3FinishReason = { unified: 'stop', raw: 'stop' };
        let lastEventType: string | undefined;
        let emittedResponseMetadata = false;
        const openTextIds = new Set<string>();
        const openReasoningIds = new Set<string>();
        const pendingToolCalls = new Map<number, PendingToolCall>();
        const emittedToolCallIds = new Set<string>();
        let lastReasoningReplay: { id: string; encryptedContent?: string } | undefined;
        const textIdByOutputIndex = new Map<number, string>();
        const canonicalTextIdByItemId = new Map<string, string>();
        const textIdsWithDelta = new Set<string>();
        const finalizedTextIds = new Set<string>();
        const reasoningIdsWithDelta = new Set<string>();
        const finalizedReasoningIds = new Set<string>();

        const closeOpenParts = () => {
          for (const id of Array.from(openTextIds)) {
            controller.enqueue({ type: 'text-end', id });
            openTextIds.delete(id);
          }
          for (const id of Array.from(openReasoningIds)) {
            controller.enqueue({ type: 'reasoning-end', id });
            openReasoningIds.delete(id);
          }
        };

        const emitResponseMetadata = (response: Record<string, unknown> | undefined) => {
          if (emittedResponseMetadata) return;
          const createdAtSeconds = asNumber(response?.['created_at']);
          controller.enqueue({
            type: 'response-metadata',
            id: asString(response?.['id']),
            modelId: asString(response?.['model']) ?? options.modelId,
            timestamp: createdAtSeconds === undefined ? undefined : new Date(createdAtSeconds * 1000),
          });
          emittedResponseMetadata = true;
        };

        const refusalText = (text: string) => (text ? `[Refusal] ${text}` : '');

        const contentPartText = (part: Record<string, unknown> | undefined): string => {
          const partType = asString(part?.['type']);
          if (partType === 'output_text' || partType === 'text') {
            return asString(part?.['text']) ?? '';
          }
          if (partType === 'refusal' || partType === 'output_refusal') {
            return refusalText(asString(part?.['refusal']) ?? asString(part?.['text']) ?? '');
          }
          return '';
        };

        const emitTextDelta = (textId: string, delta: string) => {
          if (!textId || finalizedTextIds.has(textId)) return;
          textIdsWithDelta.add(textId);
          if (!openTextIds.has(textId)) {
            openTextIds.add(textId);
            controller.enqueue({ type: 'text-start', id: textId });
          }
          if (delta) {
            controller.enqueue({ type: 'text-delta', id: textId, delta });
          }
        };

        const emitFinalText = (textId: string, text: string) => {
          if (!textId || finalizedTextIds.has(textId)) return;

          const sawDelta = textIdsWithDelta.has(textId);
          const normalizedText = text || '';

          if (!sawDelta && normalizedText) {
            if (!openTextIds.has(textId)) {
              openTextIds.add(textId);
              controller.enqueue({ type: 'text-start', id: textId });
            }
            controller.enqueue({ type: 'text-delta', id: textId, delta: normalizedText });
          }

          if (openTextIds.has(textId)) {
            controller.enqueue({ type: 'text-end', id: textId });
            openTextIds.delete(textId);
          }

          finalizedTextIds.add(textId);
        };

        const resolveTextId = (outputIndex: number | undefined, itemId: string | undefined) => {
          const mappedTextId = outputIndex === undefined ? undefined : textIdByOutputIndex.get(outputIndex);
          const aliasedTextId = itemId ? canonicalTextIdByItemId.get(itemId) : undefined;
          const textId = mappedTextId ?? aliasedTextId ?? itemId ?? 'text_0';

          if (outputIndex !== undefined) {
            textIdByOutputIndex.set(outputIndex, textId);
          }
          canonicalTextIdByItemId.set(textId, textId);
          if (itemId) {
            canonicalTextIdByItemId.set(itemId, textId);
          }

          return textId;
        };

        const emitReasoningDelta = (reasoningId: string, delta: string) => {
          if (!reasoningId || finalizedReasoningIds.has(reasoningId)) return;
          reasoningIdsWithDelta.add(reasoningId);
          if (!openReasoningIds.has(reasoningId)) {
            openReasoningIds.add(reasoningId);
            controller.enqueue({ type: 'reasoning-start', id: reasoningId });
          }
          if (delta) {
            controller.enqueue({ type: 'reasoning-delta', id: reasoningId, delta });
          }
        };

        const emitFinalReasoning = (reasoningId: string, text: string) => {
          if (!reasoningId || finalizedReasoningIds.has(reasoningId)) return;

          const sawDelta = reasoningIdsWithDelta.has(reasoningId);
          const normalizedText = text || '';

          if (!sawDelta && normalizedText) {
            emitReasoningDelta(reasoningId, normalizedText);
          }

          if (openReasoningIds.has(reasoningId)) {
            controller.enqueue({ type: 'reasoning-end', id: reasoningId });
            openReasoningIds.delete(reasoningId);
          }

          finalizedReasoningIds.add(reasoningId);
        };

        const emitFinalToolCall = (toolCallId: string, toolName: string, input: string) => {
          if (!toolCallId || !toolName || emittedToolCallIds.has(toolCallId)) return;
          hasFunctionCall = true;
          controller.enqueue({ type: 'tool-input-end', id: toolCallId });
          controller.enqueue({
            type: 'tool-call',
            toolCallId,
            toolName,
            input,
          });
          emittedToolCallIds.add(toolCallId);
        };

        const emitTerminalError = (error: unknown) => {
          closeOpenParts();
          controller.enqueue({ type: 'error', error });
          terminalError = true;
          finished = true;
        };

        try {
          while (true) {
            let readResult: Awaited<ReturnType<typeof reader.read>>;
            try {
              readResult = await reader.read();
            } catch (readError) {
              emitTerminalError(responsesStreamReadError({
                provider: options.provider,
                modelId: options.modelId,
                url: options.url,
                responseMetadata: options.responseMetadata,
                cause: readError,
                lastEventType,
              }));
              break;
            }

            const { value, done } = readResult;
            if (done) {
              const trailing = buffer.trimEnd();
              if (!trailing.trim()) break;
              buffer = `${trailing}\n\n`;
            } else {
              if (!value) continue;
              buffer += decoder.decode(value, { stream: true });
            }

            while (true) {
              const boundary = nextEventBoundary(buffer);
              if (!boundary) break;
              const rawEvent = buffer.slice(0, boundary.index);
              buffer = buffer.slice(boundary.index + boundary.length);
              const sseEvent = parseSseEvent(rawEvent);
              const sseData = sseEvent?.data;
              if (!sseData || sseData === '[DONE]') continue;

              let event: Record<string, unknown>;
              try {
                const parsed = JSON.parse(sseData);
                event = asRecord(parsed) ?? {};
              } catch (parseError) {
                emitTerminalError(responsesStreamParseError({
                  provider: options.provider,
                  modelId: options.modelId,
                  url: options.url,
                  responseMetadata: options.responseMetadata,
                  parseError,
                  dataLength: sseData.length,
                  lastEventType,
                }));
                break;
              }

              const eventType = asString(event['type']) ?? sseEvent.eventType;
              if (eventType && !asString(event['type'])) {
                event['type'] = eventType;
              }

              if (options.includeRawChunks) {
                controller.enqueue({ type: 'raw', rawValue: event });
              }

              if (!eventType) continue;
              lastEventType = eventType;

              if (eventType === 'response.failed') {
                emitTerminalError(responsesStreamError(event, 'Responses stream failed', {
                  provider: options.provider,
                  modelId: options.modelId,
                  url: options.url,
                  responseMetadata: options.responseMetadata,
                }));
                break;
              }

              if (eventType === 'response.incomplete') {
                emitTerminalError(responsesStreamError(event, 'Responses stream incomplete', {
                  provider: options.provider,
                  modelId: options.modelId,
                  url: options.url,
                  responseMetadata: options.responseMetadata,
                }));
                break;
              }

              if (eventType === 'response.created') {
                emitResponseMetadata(asRecord(event['response']));
                continue;
              }

              if (eventType === 'response.output_text.delta' || eventType === 'response.text.delta') {
                const itemId = resolveTextId(asNumber(event['output_index']), asString(event['item_id']));
                emitTextDelta(itemId, asString(event['delta']) ?? '');
                continue;
              }

              if (eventType === 'response.output_text.done') {
                const itemId = resolveTextId(asNumber(event['output_index']), asString(event['item_id']));
                emitFinalText(itemId, asString(event['text']) ?? '');
                continue;
              }

              if (eventType === 'response.refusal.delta' || eventType === 'response.output_refusal.delta') {
                const itemId = resolveTextId(asNumber(event['output_index']), asString(event['item_id']));
                emitTextDelta(itemId, refusalText(asString(event['delta']) ?? ''));
                continue;
              }

              if (eventType === 'response.refusal.done' || eventType === 'response.output_refusal.done') {
                const itemId = resolveTextId(asNumber(event['output_index']), asString(event['item_id']));
                emitFinalText(itemId, refusalText(asString(event['refusal']) ?? asString(event['text']) ?? ''));
                continue;
              }

              if (eventType === 'response.output_item.added') {
                const item = asRecord(event['item']);
                const outputIndex = asNumber(event['output_index']);
                const itemType = asString(item?.['type']);

                if (itemType === 'function_call' && outputIndex !== undefined) {
                  const toolCallId = asString(item?.['call_id']) ?? '';
                  const toolName = asString(item?.['name']) ?? '';
                  if (toolCallId && toolName) {
                    pendingToolCalls.set(outputIndex, {
                      toolCallId,
                      toolName,
                      input: asString(item?.['arguments']) ?? '',
                    });
                    controller.enqueue({
                      type: 'tool-input-start',
                      id: toolCallId,
                      toolName,
                    });
                  }
                } else if (itemType === 'reasoning') {
                  const reasoningIdBase = asString(item?.['id']);
                  if (reasoningIdBase) {
                    const reasoningId = `${reasoningIdBase}:0`;
                    if (!openReasoningIds.has(reasoningId)) {
                      openReasoningIds.add(reasoningId);
                      controller.enqueue({ type: 'reasoning-start', id: reasoningId });
                    }
                  }
                }

                continue;
              }

              if (eventType === 'response.function_call_arguments.delta' || eventType === 'response.tool_call_arguments.delta') {
                const outputIndex = asNumber(event['output_index']);
                const delta = asString(event['delta']) ?? '';
                if (outputIndex !== undefined) {
                  const pending = pendingToolCalls.get(outputIndex);
                  if (pending && delta) {
                    pending.input += delta;
                    controller.enqueue({
                      type: 'tool-input-delta',
                      id: pending.toolCallId,
                      delta,
                    });
                  }
                }
                continue;
              }

              if (eventType === 'response.function_call_arguments.done' || eventType === 'response.tool_call_arguments.done') {
                const outputIndex = asNumber(event['output_index']);
                const pending = outputIndex === undefined ? undefined : pendingToolCalls.get(outputIndex);
                const toolCallId = asString(event['call_id']) ?? pending?.toolCallId ?? '';
                const toolName = asString(event['name']) ?? asString(event['function_name']) ?? pending?.toolName ?? '';
                const input = asString(event['arguments']) ?? pending?.input ?? '{}';
                if (outputIndex !== undefined) {
                  pendingToolCalls.delete(outputIndex);
                }
                emitFinalToolCall(toolCallId, toolName, input);
                continue;
              }

              if (eventType === 'response.output_item.done') {
                const item = asRecord(event['item']);
                const itemType = asString(item?.['type']);
                const outputIndex = asNumber(event['output_index']);

                if (itemType === 'message') {
                  const messageId = asString(item?.['id']);
                  const textIdToClose = resolveTextId(outputIndex, messageId);
                  if (textIdToClose && (openTextIds.has(textIdToClose) || finalizedTextIds.has(textIdToClose))) {
                    emitFinalText(textIdToClose, '');
                  } else if (messageId) {
                    const content = Array.isArray(item?.['content']) ? item?.['content'] : [];
                    const textValue = content
                      .map((entry) => contentPartText(asRecord(entry)))
                      .join('');
                    emitFinalText(messageId, textValue);
                  }
                } else if (itemType === 'function_call') {
                  const pending = outputIndex === undefined ? undefined : pendingToolCalls.get(outputIndex);
                  const toolCallId = asString(item?.['call_id']) ?? pending?.toolCallId ?? '';
                  const toolName = asString(item?.['name']) ?? pending?.toolName ?? '';
                  const input = asString(item?.['arguments']) ?? pending?.input ?? '{}';
                  emitFinalToolCall(toolCallId, toolName, input);
                  if (outputIndex !== undefined) {
                    pendingToolCalls.delete(outputIndex);
                  }
                } else if (itemType === 'reasoning') {
                  const reasoningIdBase = asString(item?.['id']);
                  const encryptedContent = asString(item?.['encrypted_content']);
                  if (reasoningIdBase) {
                    lastReasoningReplay = {
                      id: reasoningIdBase,
                      ...(encryptedContent ? { encryptedContent } : {}),
                    };
                  }
                  if (reasoningIdBase) {
                    const summary = Array.isArray(item?.['summary']) ? item?.['summary'] : [];
                    if (summary.length > 0) {
                      for (let i = 0; i < summary.length; i += 1) {
                        const summaryPart = asRecord(summary[i]);
                        const text = asString(summaryPart?.['text']) ?? '';
                        const reasoningId = `${reasoningIdBase}:${String(i)}`;
                        emitFinalReasoning(reasoningId, text);
                      }
                    }

                    for (const openId of Array.from(openReasoningIds)) {
                      if (!openId.startsWith(`${reasoningIdBase}:`)) continue;
                      controller.enqueue({ type: 'reasoning-end', id: openId });
                      openReasoningIds.delete(openId);
                    }
                  }
                }

                continue;
              }

              if (eventType === 'response.content_part.done') {
                const itemId = resolveTextId(asNumber(event['output_index']), asString(event['item_id']));
                emitFinalText(itemId, contentPartText(asRecord(event['part'])));
                continue;
              }

              if (eventType === 'response.reasoning_text.delta' || eventType === 'response.reasoning.delta') {
                const itemId = asString(event['item_id']) ?? asString(event['id']) ?? 'reasoning_0';
                const contentIndex = asNumber(event['content_index']) ?? 0;
                emitReasoningDelta(`${itemId}:${String(contentIndex)}`, asString(event['delta']) ?? '');
                continue;
              }

              if (eventType === 'response.reasoning_summary_text.delta' || eventType === 'response.reasoning_summary.delta') {
                const itemId = asString(event['item_id']) ?? 'reasoning_0';
                const summaryIndex = asNumber(event['summary_index']) ?? 0;
                emitReasoningDelta(`${itemId}:${String(summaryIndex)}`, asString(event['delta']) ?? '');
                continue;
              }

              if (eventType === 'response.reasoning_summary_part.done') {
                const itemId = asString(event['item_id']) ?? 'reasoning_0';
                const summaryIndex = asNumber(event['summary_index']) ?? 0;
                const reasoningId = `${itemId}:${String(summaryIndex)}`;
                if (reasoningIdsWithDelta.has(reasoningId)) {
                  emitFinalReasoning(reasoningId, '');
                } else if (openReasoningIds.has(reasoningId)) {
                  controller.enqueue({ type: 'reasoning-end', id: reasoningId });
                  openReasoningIds.delete(reasoningId);
                }
                continue;
              }

              if (eventType === 'response.completed') {
                const response = asRecord(event['response']);
                emitResponseMetadata(response);
                usage = usageFromResponses(response?.['usage']);
                finishReason = mapFinishReason(
                  asRecord(response?.['incomplete_details'])?.['reason'],
                  hasFunctionCall,
                );
                closeOpenParts();
                controller.enqueue({
                  type: 'finish',
                  usage,
                  finishReason,
                  providerMetadata: buildFinishProviderMetadata(options.behavior, lastReasoningReplay),
                });
                finished = true;
                continue;
              }

              if (eventType === 'error') {
                const error = responsesStreamError(event, 'Responses stream error', {
                  provider: options.provider,
                  modelId: options.modelId,
                  url: options.url,
                  responseMetadata: options.responseMetadata,
                });
                const message = error.message;
                if (finished && isSummaryPartsParserStateError(message)) {
                  continue;
                }
                emitTerminalError(error);
                break;
              }
            }
            if (terminalError) break;
          }

          if (!finished && !terminalError) {
            const error = responsesStreamTerminatedError({
              provider: options.provider,
              modelId: options.modelId,
              url: options.url,
              responseMetadata: options.responseMetadata,
              lastEventType,
              openTextCount: openTextIds.size,
              openReasoningCount: openReasoningIds.size,
              pendingToolCallCount: pendingToolCalls.size,
            });
            closeOpenParts();
            controller.enqueue({ type: 'error', error });
          }
          controller.close();
        } catch (error) {
          const streamError = responsesStreamUnexpectedError({
            provider: options.provider,
            modelId: options.modelId,
            url: options.url,
            responseMetadata: options.responseMetadata,
            cause: error,
            lastEventType,
          });
          closeOpenParts();
          controller.enqueue({ type: 'error', error: streamError });
          controller.close();
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // noop
          }
        }
      })();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function buildHeaders(options: ResponsesModelOptions): Record<string, string> {
  return omitUndefinedFields({
    Authorization: options.apiKey ? `Bearer ${options.apiKey}` : undefined,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'Accept-Encoding': 'identity',
    ...options.headers,
  }) as Record<string, string>;
}

function responsesHttpError(
  options: Pick<ResponsesModelOptions, 'errorLabel' | 'provider' | 'modelId'>,
  endpoint: string,
  response: Response,
  responseBody: string,
): Error {
  return createProviderHttpError({
    message: `${options.errorLabel} request failed`,
    url: endpoint,
    response,
    responseBody,
    provider: options.provider,
    modelId: options.modelId,
  });
}

export function createResponsesModel(options: ResponsesModelOptions): LanguageModelV3 {
  const endpoint = `${normalizeBaseURL(options.baseURL)}/responses`;
  const fetchFn = options.fetch ?? globalThis.fetch;

  const doStreamInternal = async (callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
    const requestBody = createResponsesBody(options.modelId, callOptions, options.behavior);
    const response = await fetchProviderResponse(fetchFn, endpoint, {
      method: 'POST',
      headers: buildHeaders(options),
      body: JSON.stringify(requestBody),
      signal: callOptions.abortSignal,
    }, {
      message: `${options.errorLabel} request failed`,
      url: endpoint,
      provider: options.provider,
      modelId: options.modelId,
    });

    if (!response.ok || !response.body) {
      const text = await readProviderResponseBody(response);
      throw responsesHttpError(options, endpoint, response, text);
    }

    const responseMetadata = createProviderResponseMetadata(response.headers);

    return {
      stream: createResponsesStream(response.body as ReadableStream<Uint8Array>, {
        includeRawChunks: callOptions.includeRawChunks === true,
        provider: options.provider,
        modelId: options.modelId,
        url: endpoint,
        behavior: options.behavior,
        responseMetadata,
      }),
      request: { body: requestBody },
      response: { headers: responseMetadata.headers },
    };
  };

  return {
    specificationVersion: 'v3',
    provider: options.provider,
    modelId: options.modelId,
    supportedUrls: {},
    async doGenerate(callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      const streamResult = await doStreamInternal(callOptions);
      const reader = streamResult.stream.getReader();

      const content: LanguageModelV3Content[] = [];
      let text = '';
      let reasoning = '';
      let finishReason: LanguageModelV3FinishReason = { unified: 'stop', raw: 'stop' };
      let usage: LanguageModelV3Usage = EMPTY_USAGE;
      let responseId: string | undefined;
      let responseModelId: string | undefined;
      let responseTimestamp: Date | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        if (value.type === 'text-delta') {
          text += value.delta;
        } else if (value.type === 'reasoning-delta') {
          reasoning += value.delta;
        } else if (value.type === 'tool-call') {
          content.push({
            type: 'tool-call',
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            input: value.input,
          });
        } else if (value.type === 'response-metadata') {
          responseId = value.id;
          responseModelId = value.modelId;
          responseTimestamp = value.timestamp;
        } else if (value.type === 'finish') {
          finishReason = value.finishReason;
          usage = value.usage;
        } else if (value.type === 'error') {
          throw value.error instanceof Error ? value.error : new Error(String(value.error));
        }
      }

      if (reasoning) {
        content.unshift({ type: 'reasoning', text: reasoning });
      }
      if (text) {
        content.unshift({ type: 'text', text });
      }

      return {
        content,
        finishReason,
        usage,
        warnings: [],
        response: {
          id: responseId,
          modelId: responseModelId ?? options.modelId,
          timestamp: responseTimestamp,
        },
      };
    },
    async doStream(callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
      return doStreamInternal(callOptions);
    },
  };
}
