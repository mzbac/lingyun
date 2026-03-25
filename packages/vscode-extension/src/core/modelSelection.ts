import * as vscode from 'vscode';

import { MODELS } from '../providers/copilot';

export type LingyunProviderId = 'copilot' | 'openaiCompatible' | 'codexSubscription' | string;

type ResolveModelOptions = {
  providerId?: LingyunProviderId;
  configuredModel?: string;
  openaiCompatibleDefaultModelId?: string;
  codexSubscriptionDefaultModelId?: string;
};

function normalizeModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveModelIdForProvider(options: ResolveModelOptions): string {
  const providerId = normalizeModelId(options.providerId) || 'copilot';
  const configuredModel = normalizeModelId(options.configuredModel);
  const openaiCompatibleDefaultModelId = normalizeModelId(options.openaiCompatibleDefaultModelId);
  const codexSubscriptionDefaultModelId =
    normalizeModelId(options.codexSubscriptionDefaultModelId) || 'gpt-5.3-codex';

  if (providerId === 'codexSubscription') {
    if (!configuredModel || configuredModel === MODELS.GPT_4O) {
      return codexSubscriptionDefaultModelId;
    }
    return configuredModel;
  }

  if (providerId === 'openaiCompatible') {
    return configuredModel || openaiCompatibleDefaultModelId || MODELS.GPT_4O;
  }

  return configuredModel || MODELS.GPT_4O;
}

export function resolveModelIdWithWorkspaceDefaults(
  providerId: LingyunProviderId | undefined,
  configuredModel: string | undefined,
): string {
  const config = vscode.workspace.getConfiguration('lingyun');
  return resolveModelIdForProvider({
    providerId: providerId || config.get<string>('llmProvider') || 'copilot',
    configuredModel,
    openaiCompatibleDefaultModelId: config.get<string>('openaiCompatible.defaultModelId'),
    codexSubscriptionDefaultModelId: config.get<string>('codexSubscription.defaultModelId'),
  });
}

export function resolveConfiguredModelId(providerId?: LingyunProviderId): string {
  return resolveModelIdWithWorkspaceDefaults(
    providerId,
    vscode.workspace.getConfiguration('lingyun').get<string>('model'),
  );
}
