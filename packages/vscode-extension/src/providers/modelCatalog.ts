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
  },
): ModelInfo {
  return {
    id: modelId,
    name: options?.name || modelId,
    vendor: options?.vendor || 'local',
    family: options?.family || 'unknown',
  };
}
