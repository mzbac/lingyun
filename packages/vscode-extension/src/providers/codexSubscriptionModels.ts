import type { ModelInfo } from './modelCatalog';

export const CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID = 'gpt-5.3-codex';

const CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
const CODEX_DEFAULT_MAX_OUTPUT_TOKENS = 128000;
const CODEX_GPT_5_LARGE_CONTEXT_WINDOW = 1000000;
const CODEX_GPT_5_CONTEXT_WINDOW = 400000;

function defaultMaxInputTokens(contextWindow: number): number {
  return Math.floor((contextWindow * CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT) / 100);
}

export const CODEX_SUBSCRIPTION_FALLBACK_MODELS: ModelInfo[] = [
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    vendor: 'chatgpt',
    family: 'gpt-5',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_LARGE_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    vendor: 'chatgpt',
    family: 'gpt-5',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_LARGE_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    vendor: 'chatgpt',
    family: 'gpt-codex',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    vendor: 'chatgpt',
    family: 'gpt-5',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2 Codex',
    vendor: 'chatgpt',
    family: 'gpt-codex',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT-5.1 Codex',
    vendor: 'chatgpt',
    family: 'gpt-codex',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT-5.1 Codex Max',
    vendor: 'chatgpt',
    family: 'gpt-codex',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1 Codex Mini',
    vendor: 'chatgpt',
    family: 'gpt-codex',
    maxInputTokens: defaultMaxInputTokens(CODEX_GPT_5_CONTEXT_WINDOW),
    maxOutputTokens: CODEX_DEFAULT_MAX_OUTPUT_TOKENS,
  },
];

const FALLBACK_MODEL_MAP = new Map(CODEX_SUBSCRIPTION_FALLBACK_MODELS.map((model) => [model.id, model]));

export type CodexModelRecord = {
  slug?: unknown;
  id?: unknown;
  display_name?: unknown;
  name?: unknown;
  visibility?: unknown;
  priority?: unknown;
  context_window?: unknown;
  max_context_window?: unknown;
  maxContextWindow?: unknown;
  effective_context_window_percent?: unknown;
  effectiveContextWindowPercent?: unknown;
  max_input_tokens?: unknown;
  maxInputTokens?: unknown;
  max_output_tokens?: unknown;
  maxOutputTokens?: unknown;
};

export type CodexModelsResponse = {
  models?: CodexModelRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function inferCodexModelFamily(modelId: string): string {
  const fallback = FALLBACK_MODEL_MAP.get(modelId);
  if (fallback?.family) return fallback.family;
  return modelId.includes('codex') ? 'gpt-codex' : 'gpt-5';
}

function effectiveContextWindow(value: number, percent: number | undefined): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) {
    return Math.floor(value);
  }
  return Math.floor((value * percent) / 100);
}

function resolveMaxInputTokens(record: CodexModelRecord, fallback?: ModelInfo): number | undefined {
  const explicitMaxInput = positiveFiniteNumber(record.max_input_tokens, record.maxInputTokens);
  if (explicitMaxInput !== undefined) return Math.floor(explicitMaxInput);

  const contextWindow = positiveFiniteNumber(record.context_window, record.max_context_window, record.maxContextWindow);
  if (contextWindow !== undefined) {
    const percent = positiveFiniteNumber(record.effective_context_window_percent, record.effectiveContextWindowPercent);
    return effectiveContextWindow(contextWindow, percent ?? CODEX_DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT);
  }

  return fallback?.maxInputTokens;
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

function createCodexDefaultModelInfo(modelId: string): ModelInfo {
  const fallback = FALLBACK_MODEL_MAP.get(modelId);
  if (fallback) return { ...fallback };

  return {
    id: modelId,
    name: modelId,
    vendor: 'chatgpt',
    family: inferCodexModelFamily(modelId),
  };
}

function appendDefaultCodexModel(models: ModelInfo[], defaultModelId: string | undefined): ModelInfo[] {
  const normalizedDefault = typeof defaultModelId === 'string' ? defaultModelId.trim() : '';
  if (!normalizedDefault || models.some((model) => model.id === normalizedDefault)) return models;
  return [...models, createCodexDefaultModelInfo(normalizedDefault)];
}

export function createCodexFallbackModels(options?: { defaultModelId?: string }): ModelInfo[] {
  return appendDefaultCodexModel(
    CODEX_SUBSCRIPTION_FALLBACK_MODELS.map((model) => ({ ...model })),
    options?.defaultModelId,
  );
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
    maxInputTokens: resolveMaxInputTokens(record, fallback),
    maxOutputTokens:
      positiveFiniteNumber(record.max_output_tokens, record.maxOutputTokens) ?? fallback?.maxOutputTokens,
    priority: finiteNumber(record.priority),
  };
}

export function normalizeCodexModelsResponse(
  payload: unknown,
  options?: { defaultModelId?: string },
): ModelInfo[] {
  const record = isRecord(payload) ? payload : undefined;
  const rawModels = Array.isArray(record?.models) ? record.models : [];
  const remoteModels = rawModels
    .filter(isRecord)
    .filter((modelRecord) => !modelRecord.visibility || modelRecord.visibility === 'list')
    .map((modelRecord) => normalizeCodexModelInfo(modelRecord as CodexModelRecord))
    .filter((model): model is ModelInfo & { priority?: number } => Boolean(model));

  if (remoteModels.length === 0) {
    return createCodexFallbackModels({ defaultModelId: options?.defaultModelId });
  }

  const normalized = sortCodexModels(remoteModels).map((model) => {
    const fallback = FALLBACK_MODEL_MAP.get(model.id);
    return {
      ...model,
      vendor: model.vendor || fallback?.vendor || 'chatgpt',
      family: model.family || fallback?.family || inferCodexModelFamily(model.id),
      maxInputTokens: model.maxInputTokens ?? fallback?.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens ?? fallback?.maxOutputTokens,
    };
  });

  return appendDefaultCodexModel(normalized, options?.defaultModelId);
}
