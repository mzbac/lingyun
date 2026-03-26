import * as vscode from 'vscode';

function normalizeReasoningEffort(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function getConfiguredReasoningEffort(): string {
  return normalizeReasoningEffort(
    vscode.workspace.getConfiguration('lingyun').get<string>('copilot.reasoningEffort', 'high'),
  ) || 'high';
}
