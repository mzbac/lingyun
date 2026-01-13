import type { DynamicToolUIPart, ReasoningUIPart, TextUIPart, UIMessage } from 'ai';

export type AgentHistoryMetadata = {
  mode?: 'build' | 'plan';
  finishReason?: string;
  synthetic?: boolean;
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

export function createUserHistoryMessage(
  text: string,
  options?: { synthetic?: boolean; compaction?: { auto: boolean } }
): AgentHistoryMessage {
  const metadata: AgentHistoryMetadata = {};

  if (options?.synthetic) {
    metadata.synthetic = true;
  }

  if (options?.compaction) {
    metadata.compaction = options.compaction;
  }

  return {
    id: crypto.randomUUID(),
    role: 'user',
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    parts: [{ type: 'text', text }],
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
    .map(part => part.text)
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

export function upsertDynamicToolCall(message: AgentHistoryMessage, params: {
  toolName: string;
  toolCallId: string;
  input: unknown;
}): DynamicToolUIPart {
  const existing = message.parts.find(
    (p): p is DynamicToolUIPart => p.type === 'dynamic-tool' && p.toolCallId === params.toolCallId,
  );

  if (existing) {
    // Preserve any existing output, just ensure input is present.
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

export function setDynamicToolOutput(message: AgentHistoryMessage, params: {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}): void {
  const part = upsertDynamicToolCall(message, {
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    input: params.input,
  });

  (part as any).state = 'output-available';
  (part as any).output = params.output;
  delete (part as any).errorText;
}

export function setDynamicToolError(message: AgentHistoryMessage, params: {
  toolName: string;
  toolCallId: string;
  input: unknown;
  errorText: string;
}): void {
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
