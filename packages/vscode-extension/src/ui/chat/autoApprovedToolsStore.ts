import * as vscode from 'vscode';

import { appendErrorLog } from '../../core/logger';

const AUTO_APPROVED_TOOLS_STORAGE_KEY = 'autoApprovedTools';

type AutoApprovedToolsReader = Pick<vscode.Memento, 'get'>;
type AutoApprovedToolsWriter = Pick<vscode.Memento, 'update'>;

function normalizeAutoApprovedToolId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const toolId = value.trim();
  return toolId || undefined;
}

function normalizeAutoApprovedToolIds(values: Iterable<unknown>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of values) {
    const toolId = normalizeAutoApprovedToolId(entry);
    if (!toolId || seen.has(toolId)) {
      continue;
    }

    seen.add(toolId);
    normalized.push(toolId);
  }

  return normalized;
}

function replaceAutoApprovedTools(target: Set<string>, values: Iterable<unknown>): boolean {
  const normalized = normalizeAutoApprovedToolIds(values);
  if (target.size === normalized.length && normalized.every(toolId => target.has(toolId))) {
    return false;
  }

  target.clear();
  for (const toolId of normalized) {
    target.add(toolId);
  }
  return true;
}

/**
 * Owns the persisted storage contract for user-scoped "always allow" tool approvals.
 * Hidden knowledge stays here: the storage key, normalized serialized shape,
 * in-memory mutation rules, and persistence logging.
 */
export function loadAutoApprovedTools(globalState: AutoApprovedToolsReader): Set<string> {
  const stored = globalState.get(AUTO_APPROVED_TOOLS_STORAGE_KEY);
  return new Set(normalizeAutoApprovedToolIds(Array.isArray(stored) ? stored : []));
}

export function rememberAutoApprovedTool(autoApprovedTools: Set<string>, toolId: unknown): boolean {
  return replaceAutoApprovedTools(autoApprovedTools, [...autoApprovedTools, toolId]);
}

export async function persistAutoApprovedTools(params: {
  globalState: AutoApprovedToolsWriter;
  autoApprovedTools: Set<string>;
  outputChannel?: vscode.OutputChannel;
}): Promise<void> {
  try {
    const normalizedToolIds = normalizeAutoApprovedToolIds(params.autoApprovedTools);
    replaceAutoApprovedTools(params.autoApprovedTools, normalizedToolIds);
    await params.globalState.update(AUTO_APPROVED_TOOLS_STORAGE_KEY, normalizedToolIds);
  } catch (error) {
    appendErrorLog(params.outputChannel, 'Failed to persist auto-approved tools', error, { tag: 'Approvals' });
  }
}
