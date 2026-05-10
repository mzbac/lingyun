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

export function getConfiguredOpenAICompatibleThinking(): string {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('openaiCompatible.thinking');
  if (typeof raw !== 'string') return 'auto';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'disabled' || normalized === 'enabled') return normalized;
  return 'auto';
}
