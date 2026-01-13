import * as vscode from 'vscode';

import type { AgentHistoryMessage, AgentHistoryMetadata } from './history';

export type ModelLimit = { context: number; output?: number };

export type CompactionConfig = {
  auto: boolean;
  prune: boolean;
  pruneProtectTokens: number;
  pruneMinimumTokens: number;
};

export const COMPACTION_MARKER_TEXT = 'What did we do so far?';

export const COMPACTION_PROMPT_TEXT =
  'Provide a detailed prompt for continuing our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we are doing, which files we are working on, and what we should do next. Assume a new session will not have access to the previous conversation.';

export const COMPACTION_AUTO_CONTINUE_TEXT = 'Continue if you have next steps.';

export const COMPACTED_TOOL_PLACEHOLDER = '[Old tool result content cleared]';

export const COMPACTION_SYSTEM_PROMPT =
  'You are a helpful AI assistant tasked with summarizing conversations.\n\n' +
  'When asked to summarize, provide a detailed but concise summary of the conversation.\n' +
  'Focus on information that would be helpful for continuing the conversation, including:\n' +
  '- What was done\n' +
  '- What is currently being worked on\n' +
  '- Which files are being modified\n' +
  '- What needs to be done next\n' +
  '- Key user requests, constraints, or preferences that should persist\n' +
  '- Important technical decisions and why they were made\n\n' +
  'Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.';

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getCompactionConfig(): CompactionConfig {
  const cfg = vscode.workspace.getConfiguration('lingyun');

  const auto = cfg.get<boolean>('compaction.auto') ?? true;
  const prune = cfg.get<boolean>('compaction.prune') ?? true;
  const pruneProtectTokens = Math.max(0, cfg.get<number>('compaction.pruneProtectTokens') ?? 40_000);
  const pruneMinimumTokens = Math.max(0, cfg.get<number>('compaction.pruneMinimumTokens') ?? 20_000);

  return { auto, prune, pruneProtectTokens, pruneMinimumTokens };
}

export function getModelLimit(modelId: string): ModelLimit | undefined {
  const cfg = vscode.workspace.getConfiguration('lingyun');
  const raw = cfg.get<unknown>('modelLimits');
  if (!raw || typeof raw !== 'object') return undefined;

  const entry = (raw as Record<string, unknown>)[modelId];
  if (!entry || typeof entry !== 'object') return undefined;

  const context = asFiniteNumber((entry as any).context);
  const output = asFiniteNumber((entry as any).output);

  if (!context || context <= 0) return undefined;
  return { context, ...(output && output > 0 ? { output } : {}) };
}

export function getReservedOutputTokens(params: { modelLimit?: ModelLimit; maxOutputTokens: number }): number {
  const maxOutputTokens = Math.max(0, Math.floor(params.maxOutputTokens));
  const modelOutput = params.modelLimit?.output;
  if (typeof modelOutput === 'number' && Number.isFinite(modelOutput) && modelOutput > 0) {
    return Math.min(Math.floor(modelOutput), maxOutputTokens);
  }
  return maxOutputTokens;
}

export function extractUsageTokens(usage: unknown): AgentHistoryMetadata['tokens'] | undefined {
  if (!usage || typeof usage !== 'object') return undefined;

  const inputTokens = (usage as any).inputTokens;
  const outputTokens = (usage as any).outputTokens;

  // AI SDK normalized usage (LanguageModelUsage)
  if (typeof inputTokens === 'number' || inputTokens === undefined) {
    const inputTotal = asFiniteNumber(inputTokens);
    const details = (usage as any).inputTokenDetails;
    const inputNoCache = asFiniteNumber(details?.noCacheTokens);
    const cacheRead = asFiniteNumber(details?.cacheReadTokens);
    const cacheWrite = asFiniteNumber(details?.cacheWriteTokens);
    const outputTotal = asFiniteNumber(outputTokens);

    const input = inputNoCache ?? inputTotal;
    const computedTotal =
      (inputNoCache !== undefined
        ? (inputNoCache || 0) + (cacheRead || 0)
        : (inputTotal || 0)) + (outputTotal || 0);

    const total = asFiniteNumber((usage as any).totalTokens) ?? computedTotal;

    return {
      input,
      output: outputTotal,
      cacheRead,
      cacheWrite,
      total,
      raw: (usage as any).raw,
    };
  }

  const inputTotal = asFiniteNumber(inputTokens?.total);
  const inputNoCache = asFiniteNumber(inputTokens?.noCache);
  const cacheRead = asFiniteNumber(inputTokens?.cacheRead);
  const cacheWrite = asFiniteNumber(inputTokens?.cacheWrite);
  const outputTotal = asFiniteNumber(outputTokens?.total);

  const input = inputNoCache ?? inputTotal;
  const output = outputTotal;

  // count: noCache + cacheRead + output. If noCache is unavailable, total already includes cacheRead.
  const total =
    (inputNoCache !== undefined
      ? (inputNoCache || 0) + (cacheRead || 0)
      : (inputTotal || 0)) + (outputTotal || 0);

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    raw: (usage as any).raw,
  };
}

export function getEffectiveHistory(history: AgentHistoryMessage[]): AgentHistoryMessage[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'assistant' && msg.metadata?.summary) {
      const maybeMarker = i > 0 ? history[i - 1] : undefined;
      if (maybeMarker?.role === 'user' && maybeMarker.metadata?.compaction) {
        return history.slice(i - 1);
      }
      return history.slice(i);
    }
  }

  return history;
}

function estimateTokensFromString(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateTokensFromUnknown(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string') return estimateTokensFromString(value);

  try {
    return estimateTokensFromString(JSON.stringify(value));
  } catch {
    return estimateTokensFromString(String(value));
  }
}

type DynamicToolPart = {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  output?: unknown;
  state?: string;
};

function isCompletedToolPart(part: unknown): part is DynamicToolPart {
  if (!part || typeof part !== 'object') return false;
  if ((part as any).type !== 'dynamic-tool') return false;
  const state = String((part as any).state || '');
  return state === 'output-available';
}

function getToolOutputTokens(part: DynamicToolPart): number {
  return estimateTokensFromUnknown(part.output);
}

export function markPrunableToolOutputs(history: AgentHistoryMessage[], config: CompactionConfig): {
  totalToolOutputTokens: number;
  prunedTokens: number;
  markedParts: number;
} {
  if (!config.prune) {
    return { totalToolOutputTokens: 0, prunedTokens: 0, markedParts: 0 };
  }

  let total = 0;
  let pruned = 0;
  let turns = 0;
  const toMark: Array<{ msgIndex: number; partIndex: number; tokens: number }> = [];

  for (let msgIndex = history.length - 1; msgIndex >= 0; msgIndex--) {
    const msg = history[msgIndex];
    if (msg.role === 'user') turns++;
    if (turns < 2) continue;

    if (msg.role === 'assistant' && msg.metadata?.summary) break;

    for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = msg.parts[partIndex] as any;
      if (!isCompletedToolPart(part)) continue;

      if ((part as any).compactedAt) {
        msgIndex = -1;
        break;
      }

      const estimate = getToolOutputTokens(part);
      total += estimate;
      if (total > config.pruneProtectTokens) {
        pruned += estimate;
        toMark.push({ msgIndex, partIndex, tokens: estimate });
      }
    }
  }

  if (pruned <= config.pruneMinimumTokens) {
    return { totalToolOutputTokens: total, prunedTokens: 0, markedParts: 0 };
  }

  const now = Date.now();
  for (const item of toMark) {
    const msg = history[item.msgIndex];
    const part = msg.parts[item.partIndex] as any;
    if (!part || !isCompletedToolPart(part)) continue;
    (part as any).compactedAt = now;
  }

  return { totalToolOutputTokens: total, prunedTokens: pruned, markedParts: toMark.length };
}

export function createHistoryForModel(history: AgentHistoryMessage[]): AgentHistoryMessage[] {
  return history.map(msg => {
    const copied: AgentHistoryMessage = {
      ...msg,
      metadata: msg.metadata ? { ...msg.metadata } : undefined,
      parts: msg.parts.map(part => {
        if ((part as any).type !== 'dynamic-tool') return part;

        const anyPart = part as any;
        if (!anyPart.compactedAt) return part;

        if (anyPart.output === undefined) return part;

        const output = anyPart.output;
        const replacement =
          output && typeof output === 'object' && typeof (output as any).success === 'boolean'
            ? { ...(output as any), data: COMPACTED_TOOL_PLACEHOLDER, metadata: { ...((output as any).metadata || {}), compacted: true } }
            : COMPACTED_TOOL_PLACEHOLDER;

        return { ...anyPart, output: replacement };
      }),
    };

    return copied;
  });
}

export function isOverflow(params: {
  lastTokens: AgentHistoryMetadata['tokens'] | undefined;
  modelLimit: ModelLimit | undefined;
  reservedOutputTokens: number;
  config: CompactionConfig;
}): boolean {
  if (!params.config.auto) return false;
  const context = params.modelLimit?.context;
  if (!context || context <= 0) return false;

  const usable = context - Math.max(0, params.reservedOutputTokens);
  if (usable <= 0) return false;

  const used = params.lastTokens?.total;
  if (!used || used <= 0) return false;

  return used > usable;
}
