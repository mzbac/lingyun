import * as vscode from 'vscode';
import type { CompactionConfig, ModelLimit } from '@kooka/core';

export type { CompactionConfig, ModelLimit } from '@kooka/core';
export {
  COMPACTED_TOOL_PLACEHOLDER,
  COMPACTION_AUTO_CONTINUE_TEXT,
  COMPACTION_MARKER_TEXT,
  COMPACTION_PROMPT_TEXT,
  COMPACTION_SYSTEM_PROMPT,
  createHistoryForCompactionPrompt,
  createHistoryForModel,
  extractUsageTokens,
  getEffectiveHistory,
  markPreviousAssistantToolOutputs,
  getReservedOutputTokens,
  isOverflow,
  markPrunableToolOutputs,
} from '@kooka/core';

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getCompactionConfig(): CompactionConfig {
  const cfg = vscode.workspace.getConfiguration('lingyun');

  const auto = cfg.get<boolean>('compaction.auto') ?? true;
  const prune = cfg.get<boolean>('compaction.prune') ?? true;
  const pruneProtectTokens = Math.max(0, cfg.get<number>('compaction.pruneProtectTokens') ?? 40_000);
  const pruneMinimumTokens = Math.max(0, cfg.get<number>('compaction.pruneMinimumTokens') ?? 20_000);
  const toolOutputModeRaw = cfg.get<unknown>('compaction.toolOutputMode');
  const toolOutputMode = toolOutputModeRaw === 'onCompaction' ? 'onCompaction' : 'afterToolCall';

  return { auto, prune, pruneProtectTokens, pruneMinimumTokens, toolOutputMode };
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
