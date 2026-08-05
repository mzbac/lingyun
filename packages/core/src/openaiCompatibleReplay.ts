const TOOL_CALL_REPLAY_MARKER = 'kookaReplay';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseJson(value: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(value) as unknown };
  } catch {
    return { parsed: false };
  }
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]];

  while (pending.length > 0) {
    const [leftValue, rightValue] = pending.pop()!;
    if (leftValue === rightValue) continue;

    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      if (!Array.isArray(leftValue) || !Array.isArray(rightValue) || leftValue.length !== rightValue.length) {
        return false;
      }
      for (let index = 0; index < leftValue.length; index++) {
        pending.push([leftValue[index], rightValue[index]]);
      }
      continue;
    }

    const leftRecord = asRecord(leftValue);
    const rightRecord = asRecord(rightValue);
    if (!leftRecord || !rightRecord) return false;

    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!hasOwn(rightRecord, key)) return false;
      pending.push([leftRecord[key], rightRecord[key]]);
    }
  }

  return true;
}

function isEmptyJsonObject(value: unknown): boolean {
  const record = asRecord(value);
  return !!record && Object.keys(record).length === 0;
}

function replayArguments(toolCall: UnknownRecord, markerValue: unknown): string | undefined {
  const marker = asRecord(markerValue);
  if (!marker || marker.version !== 1) return undefined;
  if (typeof marker.toolCallId !== 'string' || marker.toolCallId !== toolCall.id) return undefined;

  const fn = asRecord(toolCall.function);
  if (!fn) return undefined;
  if (typeof marker.toolName !== 'string' || marker.toolName !== fn.name) return undefined;
  if (typeof marker.rawArguments !== 'string' || typeof fn.arguments !== 'string') return undefined;

  const normalizedArguments = parseJson(fn.arguments);
  if (!normalizedArguments.parsed) return undefined;

  // OpenAI-compatible servers may represent a no-argument tool call as an
  // empty (or whitespace-only) argument stream. AI SDK normalizes that to an
  // empty object, so preserve the original bytes only for that exact semantic
  // case. Non-empty argument text must still be valid, equivalent JSON.
  if (marker.rawArguments.trim() === '') {
    return isEmptyJsonObject(normalizedArguments.value) ? marker.rawArguments : undefined;
  }

  const rawArguments = parseJson(marker.rawArguments);
  if (!rawArguments.parsed) return undefined;

  return jsonValuesEqual(rawArguments.value, normalizedArguments.value)
    ? marker.rawArguments
    : undefined;
}

function transformToolCall(toolCallValue: unknown, restoreArguments: boolean): unknown {
  const toolCallRecord = asRecord(toolCallValue);
  if (!toolCallRecord || !hasOwn(toolCallRecord, TOOL_CALL_REPLAY_MARKER)) return toolCallValue;

  const marker = toolCallRecord[TOOL_CALL_REPLAY_MARKER];
  const toolCall = { ...toolCallRecord };
  delete toolCall[TOOL_CALL_REPLAY_MARKER];

  if (!restoreArguments) return toolCall;
  const rawArguments = replayArguments(toolCall, marker);
  const fn = asRecord(toolCall.function);
  if (rawArguments === undefined || !fn) return toolCall;

  return {
    ...toolCall,
    function: {
      ...fn,
      arguments: rawArguments,
    },
  };
}

/**
 * Restore exact JSON argument text captured from streamed assistant tool calls.
 *
 * AI SDK parses tool arguments for execution and serializes that value again on
 * the next request. Although semantically equivalent, that changes prompt bytes
 * such as whitespace, numeric spelling, and Unicode escapes. The private replay
 * marker is validated against the normalized call, consumed here, and never sent
 * to the OpenAI-compatible backend.
 */
export function transformOpenAICompatibleRequestBody(body: UnknownRecord): UnknownRecord {
  if (!Array.isArray(body.messages)) return body;

  let messagesChanged = false;
  const messages = body.messages.map((messageValue) => {
    const messageRecord = asRecord(messageValue);
    if (!messageRecord) return messageValue;

    let message = messageRecord;
    let messageChanged = false;
    if (hasOwn(message, TOOL_CALL_REPLAY_MARKER)) {
      message = { ...message };
      delete message[TOOL_CALL_REPLAY_MARKER];
      messageChanged = true;
    }

    if (!Array.isArray(message.tool_calls)) {
      if (messageChanged) messagesChanged = true;
      return message;
    }

    let toolCallsChanged = false;
    const restoreArguments = message.role === 'assistant';
    const toolCalls = message.tool_calls.map((toolCall) => {
      const transformed = transformToolCall(toolCall, restoreArguments);
      if (transformed !== toolCall) toolCallsChanged = true;
      return transformed;
    });

    if (!toolCallsChanged) {
      if (messageChanged) messagesChanged = true;
      return message;
    }

    messagesChanged = true;
    return { ...message, tool_calls: toolCalls };
  });

  return messagesChanged ? { ...body, messages } : body;
}
