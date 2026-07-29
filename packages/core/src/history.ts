import type { DynamicToolUIPart, ReasoningUIPart, TextUIPart, UIMessage } from 'ai';

export type AgentHistoryMetadata = {
  mode?: 'build' | 'plan';
  modeReminder?: {
    mode: 'build' | 'plan';
    kind: 'plan' | 'build-switch';
  };
  finishReason?: string;
  synthetic?: boolean;
  skill?: boolean;
  summary?: boolean;
  transientContext?: 'explore' | 'memoryRecall' | 'goal';
  compaction?: { auto: boolean };
  compactionRestore?: {
    source: 'sessionState' | 'explore' | 'memoryRecall' | 'goal';
  };
  replay?: {
    text?: string;
    reasoning?: string;
    copilot?: {
      reasoningOpaque?: string;
      reasoningEncryptedContent?: string;
    };
  };
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

export type AgentHistoryStats = {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  systemMessages: number;
  syntheticMessages: number;
  toolCallCount: number;
  completedToolCallCount: number;
  failedToolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
};

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

function nonNegativeFinite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isDynamicToolPart(part: unknown): part is Record<string, unknown> {
  const record = asRecord(part);
  return !!record && record.type === 'dynamic-tool';
}

function isFailedToolOutput(output: unknown): boolean {
  const record = asRecord(output);
  if (!record) return false;
  if (record.success === false) return true;
  return typeof record.error === 'string' || typeof record.errorText === 'string';
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

export function cloneUserHistoryInput(input: UserHistoryInput): UserHistoryInput {
  if (typeof input === 'string') {
    return input;
  }
  return normalizeUserHistoryInputParts(input);
}

export function cloneAgentHistoryMessage(message: AgentHistoryMessage): AgentHistoryMessage {
  return structuredClone(message);
}

export function cloneAgentHistoryMessages(history: readonly AgentHistoryMessage[]): AgentHistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  const cloned: AgentHistoryMessage[] = [];
  for (const message of history) {
    cloned.push(cloneAgentHistoryMessage(message));
  }
  return cloned;
}

export function parseUserHistoryInput(input: unknown): UserHistoryInput | undefined {
  if (typeof input === 'string') {
    return input;
  }
  if (!Array.isArray(input)) {
    return undefined;
  }
  const normalized = normalizeUserHistoryInputParts(input as UserHistoryInput);
  return normalized.length > 0 ? normalized : undefined;
}

export function getUserHistoryInputText(input: UserHistoryInput): string {
  if (typeof input === 'string') return input;
  let text = '';
  for (const part of input) {
    if (isUserTextPart(part)) text += part.text;
  }
  return text;
}

export function getAgentHistoryStats(history: readonly AgentHistoryMessage[]): AgentHistoryStats {
  const stats: AgentHistoryStats = {
    totalMessages: 0,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    syntheticMessages: 0,
    toolCallCount: 0,
    completedToolCallCount: 0,
    failedToolCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalTokens: 0,
  };

  if (!Array.isArray(history)) return stats;

  for (const message of history) {
    if (!message || typeof message !== 'object') continue;
    stats.totalMessages += 1;

    if (message.role === 'user') stats.userMessages += 1;
    if (message.role === 'assistant') stats.assistantMessages += 1;
    if (message.role === 'system') stats.systemMessages += 1;
    if (message.metadata?.synthetic) stats.syntheticMessages += 1;

    const tokens = message.metadata?.tokens;
    stats.totalInputTokens += nonNegativeFinite(tokens?.input);
    stats.totalOutputTokens += nonNegativeFinite(tokens?.output);
    stats.totalCacheReadTokens += nonNegativeFinite(tokens?.cacheRead);
    stats.totalCacheWriteTokens += nonNegativeFinite(tokens?.cacheWrite);
    stats.totalTokens += nonNegativeFinite(tokens?.total);

    if (message.role !== 'assistant' || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!isDynamicToolPart(part)) continue;
      stats.toolCallCount += 1;
      if (part.state === 'output-available') {
        if (isFailedToolOutput(part.output)) {
          stats.failedToolCallCount += 1;
        } else {
          stats.completedToolCallCount += 1;
        }
      }
    }
  }

  return stats;
}

export function createUserHistoryMessage(
  input: UserHistoryInput,
  options?: { synthetic?: boolean; skill?: boolean; compaction?: { auto: boolean } }
): AgentHistoryMessage {
  const metadata: AgentHistoryMetadata = {};
  let hasMetadata = false;

  if (options?.synthetic) {
    metadata.synthetic = true;
    hasMetadata = true;
  }

  if (options?.skill) {
    metadata.skill = true;
    hasMetadata = true;
  }

  if (options?.compaction) {
    metadata.compaction = options.compaction;
    hasMetadata = true;
  }

  const normalizedParts = normalizeUserHistoryInputParts(input);
  const parts: AgentHistoryMessage['parts'] =
    normalizedParts.length > 0
      ? (normalizedParts as AgentHistoryMessage['parts'])
      : ([{ type: 'text', text: '' }] as AgentHistoryMessage['parts']);

  return {
    id: crypto.randomUUID(),
    role: 'user',
    ...(hasMetadata ? { metadata } : {}),
    parts,
  };
}

export function createSystemHistoryMessage(
  text: string,
  options?: {
    synthetic?: boolean;
    modeReminder?: NonNullable<AgentHistoryMetadata['modeReminder']>;
  },
): AgentHistoryMessage {
  const metadata: AgentHistoryMetadata = {};
  let hasMetadata = false;

  if (options?.synthetic) {
    metadata.synthetic = true;
    hasMetadata = true;
  }

  if (options?.modeReminder) {
    metadata.modeReminder = {
      mode: options.modeReminder.mode,
      kind: options.modeReminder.kind,
    };
    hasMetadata = true;
  }

  return {
    id: crypto.randomUUID(),
    role: 'system',
    ...(hasMetadata ? { metadata } : {}),
    parts: [{ type: 'text', text: String(text || '') }] as AgentHistoryMessage['parts'],
  };
}

export function isSkillInjectedMessage(message: AgentHistoryMessage): boolean {
  return message.role === 'user' && !!message.metadata?.skill;
}

export function stripSkillInjectedMessages(history: readonly AgentHistoryMessage[]): AgentHistoryMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  const stripped: AgentHistoryMessage[] = [];
  for (const message of history) {
    if (!isSkillInjectedMessage(message)) stripped.push(message);
  }
  return stripped;
}

export function createAssistantHistoryMessage(): AgentHistoryMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [],
  };
}

export function getMessageText(message: AgentHistoryMessage): string {
  let text = '';
  for (const part of message.parts) {
    if (part.type === 'text') text += part.text;
  }
  return text;
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
