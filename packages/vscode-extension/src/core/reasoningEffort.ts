import * as vscode from 'vscode';

function normalizeReasoningEffort(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed;
}

export function getConfiguredReasoningEffort(): string {
  const configured = normalizeReasoningEffort(
    vscode.workspace.getConfiguration('lingyun').get<unknown>('copilot.reasoningEffort'),
  );
  return configured === undefined ? 'high' : configured;
}
