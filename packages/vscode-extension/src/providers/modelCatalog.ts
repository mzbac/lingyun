export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  family: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export type ModelCatalogProvider = {
  getModels?: () => Promise<ModelInfo[]>;
  clearModelCache?: () => void;
};

export function createFallbackModelInfo(
  modelId: string,
  options?: {
    name?: string;
    vendor?: string;
    family?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
  },
): ModelInfo {
  return {
    id: modelId,
    name: options?.name || modelId,
    vendor: options?.vendor || 'local',
    family: options?.family || 'unknown',
    ...(typeof options?.maxInputTokens === 'number' && Number.isFinite(options.maxInputTokens) && options.maxInputTokens > 0
      ? { maxInputTokens: Math.floor(options.maxInputTokens) }
      : {}),
    ...(typeof options?.maxOutputTokens === 'number' && Number.isFinite(options.maxOutputTokens) && options.maxOutputTokens > 0
      ? { maxOutputTokens: Math.floor(options.maxOutputTokens) }
      : {}),
  };
}
