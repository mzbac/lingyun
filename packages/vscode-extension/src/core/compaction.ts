import * as vscode from 'vscode';
import type { CompactionConfig, ModelLimit } from '@lingyun/core';

export type { CompactionConfig, ModelLimit } from '@lingyun/core';
export {
  COMPACTED_TOOL_PLACEHOLDER,
  COMPACTION_AUTO_CONTINUE_TEXT,
  COMPACTION_MARKER_TEXT,
  COMPACTION_PROMPT_TEXT,
  COMPACTION_SYSTEM_PROMPT,
  createHistoryForModel,
  extractUsageTokens,
  getEffectiveHistory,
  getReservedOutputTokens,
  isOverflow,
  markPrunableToolOutputs,
} from '@lingyun/core';

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
