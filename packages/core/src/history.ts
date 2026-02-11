import type { DynamicToolUIPart, ReasoningUIPart, TextUIPart, UIMessage } from 'ai';

export type AgentHistoryMetadata = {
  mode?: 'build' | 'plan';
  finishReason?: string;
  synthetic?: boolean;
  skill?: boolean;
  summary?: boolean;
  compaction?: { auto: boolean };
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
    raw?: unknown;
  };
};

export type AgentHistoryMessage = UIMessage<AgentHistoryMetadata>;

export type UserHistoryTextPart = {
  type: 'text';
  text: string;
};

export type UserHistoryFilePart = {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
};

export type UserHistoryInputPart = UserHistoryTextPart | UserHistoryFilePart;

export type UserHistoryInput = string | UserHistoryInputPart[];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isUserTextPart(part: unknown): part is UserHistoryTextPart {
  const record = asRecord(part);
  return !!record && record.type === 'text' && typeof record.text === 'string';
}

function isUserFilePart(part: unknown): part is UserHistoryFilePart {
  const record = asRecord(part);
  return (
    !!record &&
    record.type === 'file' &&
    typeof record.mediaType === 'string' &&
    typeof record.url === 'string'
  );
}

export function normalizeUserHistoryInputParts(input: UserHistoryInput): UserHistoryInputPart[] {
  if (typeof input === 'string') {
    return [{ type: 'text', text: input }];
  }

  const normalized: UserHistoryInputPart[] = [];
  for (const part of input) {
    if (isUserTextPart(part)) {
      normalized.push({ type: 'text', text: part.text });
      continue;
    }
    if (isUserFilePart(part)) {
      normalized.push({
        type: 'file',
        mediaType: part.mediaType,
        ...(part.filename ? { filename: part.filename } : {}),
        url: part.url,
      });
    }
  }

  return normalized;
}

export function getUserHistoryInputText(input: UserHistoryInput): string {
  return normalizeUserHistoryInputParts(input)
    .filter((part): part is UserHistoryTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function createUserHistoryMessage(
  input: UserHistoryInput,
  options?: { synthetic?: boolean; skill?: boolean; compaction?: { auto: boolean } }
): AgentHistoryMessage {
  const metadata: AgentHistoryMetadata = {};

  if (options?.synthetic) {
    metadata.synthetic = true;
  }

  if (options?.skill) {
    metadata.skill = true;
  }

  if (options?.compaction) {
    metadata.compaction = options.compaction;
  }

  const normalizedParts = normalizeUserHistoryInputParts(input);
  const parts: AgentHistoryMessage['parts'] =
    normalizedParts.length > 0
      ? (normalizedParts as AgentHistoryMessage['parts'])
      : ([{ type: 'text', text: '' }] as AgentHistoryMessage['parts']);

  return {
    id: crypto.randomUUID(),
    role: 'user',
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    parts,
  };
}

export function createAssistantHistoryMessage(): AgentHistoryMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [],
  };
}

export function getMessageText(message: AgentHistoryMessage): string {
  return message.parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function appendText(message: AgentHistoryMessage, delta: string): void {
  if (!delta) return;

  const last = message.parts.at(-1);
  if (last && last.type === 'text' && last.state !== 'done') {
    (last as TextUIPart).text += delta;
    (last as TextUIPart).state = 'streaming';
    return;
  }

  message.parts.push({ type: 'text', text: delta, state: 'streaming' });
}

export function appendReasoning(message: AgentHistoryMessage, delta: string): void {
  if (!delta) return;

  const last = message.parts.at(-1);
  if (last && last.type === 'reasoning' && last.state !== 'done') {
    (last as ReasoningUIPart).text += delta;
    (last as ReasoningUIPart).state = 'streaming';
    return;
  }

  message.parts.push({ type: 'reasoning', text: delta, state: 'streaming' });
}

export function upsertDynamicToolCall(
  message: AgentHistoryMessage,
  params: { toolName: string; toolCallId: string; input: unknown }
): DynamicToolUIPart {
  const existing = message.parts.find(
    (p): p is DynamicToolUIPart => p.type === 'dynamic-tool' && p.toolCallId === params.toolCallId
  );

  if (existing) {
    if (existing.state === 'input-streaming') {
      (existing as any).state = 'input-available';
    }
    (existing as any).input = params.input;
    (existing as any).toolName = params.toolName;
    return existing;
  }

  const part: DynamicToolUIPart = {
    type: 'dynamic-tool',
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    state: 'input-available',
    input: params.input,
  };
  message.parts.push(part);
  return part;
}

export function setDynamicToolOutput(
  message: AgentHistoryMessage,
  params: { toolName: string; toolCallId: string; input: unknown; output: unknown }
): void {
  const part = upsertDynamicToolCall(message, {
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    input: params.input,
  });

  (part as any).state = 'output-available';
  (part as any).output = params.output;
  delete (part as any).errorText;
}

export function setDynamicToolError(
  message: AgentHistoryMessage,
  params: { toolName: string; toolCallId: string; input: unknown; errorText: string }
): void {
  const part = upsertDynamicToolCall(message, {
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    input: params.input,
  });

  (part as any).state = 'output-available';
  (part as any).output = { success: false, error: params.errorText };
  delete (part as any).errorText;
}

export function finalizeStreamingParts(message: AgentHistoryMessage): void {
  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      if (part.state === 'streaming') {
        (part as TextUIPart | ReasoningUIPart).state = 'done';
      }
    }
  }
}
