import type { ModelInfo } from './modelCatalog';

export const CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID = 'gpt-5.3-codex';

export const CODEX_SUBSCRIPTION_FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-5.4', name: 'GPT-5.4', vendor: 'chatgpt', family: 'gpt-5' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.2', name: 'GPT-5.2', vendor: 'chatgpt', family: 'gpt-5' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', vendor: 'chatgpt', family: 'gpt-codex' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', vendor: 'chatgpt', family: 'gpt-codex' },
];

const FALLBACK_MODEL_MAP = new Map(CODEX_SUBSCRIPTION_FALLBACK_MODELS.map((model) => [model.id, model]));

export type CodexModelRecord = {
  slug?: string;
  id?: string;
  display_name?: string;
  name?: string;
  visibility?: string;
  priority?: number;
  context_window?: number;
  max_input_tokens?: number;
  maxInputTokens?: number;
  max_output_tokens?: number;
  maxOutputTokens?: number;
};

export type CodexModelsResponse = {
  models?: CodexModelRecord[];
};

function positiveFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

function inferCodexModelFamily(modelId: string): string {
  const fallback = FALLBACK_MODEL_MAP.get(modelId);
  if (fallback?.family) return fallback.family;
  return modelId.includes('codex') ? 'gpt-codex' : 'gpt-5';
}

function sortCodexModels(models: Array<ModelInfo & { priority?: number }>): ModelInfo[] {
  return [...models]
    .sort((left, right) => {
      const leftPriority = typeof left.priority === 'number' ? left.priority : Number.MAX_SAFE_INTEGER;
      const rightPriority = typeof right.priority === 'number' ? right.priority : Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.name.localeCompare(right.name);
    })
    .map(({ priority: _priority, ...model }) => model);
}

function normalizeCodexModelInfo(record: CodexModelRecord): (ModelInfo & { priority?: number }) | undefined {
  const id = typeof record.slug === 'string' && record.slug.trim()
    ? record.slug.trim()
    : typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : undefined;
  if (!id) return undefined;

  const fallback = FALLBACK_MODEL_MAP.get(id);
  const name =
    (typeof record.display_name === 'string' && record.display_name.trim()) ||
    (typeof record.name === 'string' && record.name.trim()) ||
    fallback?.name ||
    id;

  return {
    id,
    name,
    vendor: fallback?.vendor || 'chatgpt',
    family: fallback?.family || inferCodexModelFamily(id),
    maxInputTokens: positiveFiniteNumber(record.context_window, record.max_input_tokens, record.maxInputTokens),
    maxOutputTokens: positiveFiniteNumber(record.max_output_tokens, record.maxOutputTokens),
    priority: typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : undefined,
  };
}

export function normalizeCodexModelsResponse(payload: CodexModelsResponse): ModelInfo[] {
  const remoteModels = Array.isArray(payload.models)
    ? payload.models
        .filter((record) => !record.visibility || record.visibility === 'list')
        .map(normalizeCodexModelInfo)
        .filter((model): model is ModelInfo & { priority?: number } => Boolean(model))
    : [];

  if (remoteModels.length === 0) {
    return CODEX_SUBSCRIPTION_FALLBACK_MODELS.map((model) => ({ ...model }));
  }

  const merged: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of sortCodexModels(remoteModels)) {
    const fallback = FALLBACK_MODEL_MAP.get(model.id);
    merged.push({
      ...model,
      vendor: model.vendor || fallback?.vendor || 'chatgpt',
      family: model.family || fallback?.family || inferCodexModelFamily(model.id),
    });
    seen.add(model.id);
  }

  for (const fallback of CODEX_SUBSCRIPTION_FALLBACK_MODELS) {
    if (!seen.has(fallback.id)) {
      merged.push({ ...fallback });
    }
  }

  return merged;
}
