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
  if (target.size === normalized.length) {
    let matches = true;
    for (const toolId of normalized) {
      if (target.has(toolId)) continue;
      matches = false;
      break;
    }
    if (matches) return false;
  }

  target.clear();
  for (const toolId of normalized) {
    target.add(toolId);
  }
  return true;
}

function normalizeAutoApprovedToolsInPlace(autoApprovedTools: Set<string>): boolean {
  return replaceAutoApprovedTools(autoApprovedTools, autoApprovedTools);
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

export function getAutoApprovedToolIds(autoApprovedTools: Set<string>): string[] {
  return normalizeAutoApprovedToolIds(autoApprovedTools);
}

export function rememberAutoApprovedTool(autoApprovedTools: Set<string>, toolId: unknown): boolean {
  const normalizedExisting = normalizeAutoApprovedToolsInPlace(autoApprovedTools);
  const normalizedToolId = normalizeAutoApprovedToolId(toolId);
  if (!normalizedToolId || autoApprovedTools.has(normalizedToolId)) {
    return normalizedExisting;
  }

  autoApprovedTools.add(normalizedToolId);
  return true;
}

export function forgetAutoApprovedTool(autoApprovedTools: Set<string>, toolId: unknown): boolean {
  const normalizedToolId = normalizeAutoApprovedToolId(toolId);
  if (!normalizedToolId || !autoApprovedTools.has(normalizedToolId)) {
    return false;
  }

  autoApprovedTools.delete(normalizedToolId);
  return true;
}

export function clearAutoApprovedTools(autoApprovedTools: Set<string>): boolean {
  if (autoApprovedTools.size === 0) {
    return false;
  }

  autoApprovedTools.clear();
  return true;
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
