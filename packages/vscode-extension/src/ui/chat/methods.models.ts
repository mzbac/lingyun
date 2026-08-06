import * as vscode from 'vscode';

import { appendErrorLog } from '../../core/logger';
import type { AgentLoop } from '../../core/agent';
import { resolveConfiguredModelId } from '../../core/modelSelection';
import { getConfiguredReasoningEffort } from '../../core/reasoningEffort';
import { createFallbackModelInfo, type ModelInfo } from '../../providers/modelCatalog';
import type { LLMProviderWithUi } from '../../providers/providerUi';

import { bindChatControllerService } from './controllerService';
import { postWebviewInputNotice as postInputNotice } from './inputNotice';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';

const MAX_RECENT_MODELS = 10;
const REASONING_EFFORT_VALUES = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_PICKER_NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

type ModelLoadTask = {
  provider: LLMProviderWithUi | undefined;
  promise: Promise<void>;
};

const modelLoadsInFlight = new WeakMap<ChatModelsDeps, ModelLoadTask>();

type ModelPickerState = {
  currentModel: string;
  favorites: ModelInfo[];
  recent: ModelInfo[];
  all: ModelInfo[];
};

type GlobalStateLike = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
};

type UniqueModelsResult = {
  models: ModelInfo[];
  hasCurrentModel: boolean;
};

export interface ChatModelsService {
  loadModels(): Promise<void>;
  getFavoriteModelIds(): Promise<string[]>;
  getRecentModelIds(): Promise<string[]>;
  getModelPickerStateForUI(): Promise<ModelPickerState>;
  clearRecentModels(): Promise<void>;
  refreshModelsForUI(): Promise<void>;
  isModelFavorite(modelId: string): Promise<boolean>;
  getModelLabel(modelId: string): string;
  postModelState(): Promise<void>;
  postModelPickerState(reveal?: boolean): Promise<void>;
  recordRecentModel(modelId: string): Promise<void>;
  toggleFavoriteModel(modelId: string): Promise<void>;
  setCurrentModel(modelId: string): Promise<void>;
  setReasoningEffort(reasoningEffort: string): Promise<void>;
  openAdvancedModelSettings(): Promise<void>;
}

export interface ChatModelsDeps {
  context: { globalState: GlobalStateLike };
  llmProvider?: LLMProviderWithUi;
  availableModels: ModelInfo[];
  currentModel: string;
  agent: Pick<AgentLoop, 'updateConfig'>;
  outputChannel?: vscode.OutputChannel;
  isProcessing: boolean;
  sessionApi: Pick<ChatSessionsService, 'persistActiveSession'>;
  webviewApi: Pick<ChatWebviewService, 'postMessage'>;
}

function getProviderKey(chat: ChatModelsDeps): string {
  const raw = chat.llmProvider?.id;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'unknown';
}

function favoritesStorageKey(chat: ChatModelsDeps): string {
  return `modelFavorites:${getProviderKey(chat)}`;
}

function recentsStorageKey(chat: ChatModelsDeps): string {
  return `modelRecents:${getProviderKey(chat)}`;
}

function normalizeModelId(modelId: string): string {
  return modelId.trim();
}

function normalizeStoredModelIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const normalizedIds: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const normalized = normalizeModelId(id);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedIds.push(normalized);
  }
  return normalizedIds;
}

function createCustomModelInfo(modelId: string): ModelInfo {
  return createFallbackModelInfo(modelId, { vendor: 'custom' });
}

function normalizeReasoningEffortForConfig(reasoningEffort: string): string | undefined {
  const normalized = String(reasoningEffort || '').trim();
  if (!REASONING_EFFORT_VALUES.has(normalized)) return undefined;
  return normalized;
}

function collectUniqueModels(availableModels: ModelInfo[], currentId: string): UniqueModelsResult {
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  let hasCurrentModel = false;
  for (const model of availableModels) {
    if (!model?.id) continue;
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    if (model.id === currentId) hasCurrentModel = true;
    models.push(model);
  }
  return { models, hasCurrentModel };
}

function sortModelsForPickerInPlace(models: ModelInfo[]): ModelInfo[] {
  models.sort((a, b) => MODEL_PICKER_NAME_COLLATOR.compare(a.name || a.id, b.name || b.id));
  return models;
}

function getUniqueModelPickerModels(availableModels: ModelInfo[], currentId: string): ModelInfo[] {
  const uniqueModels = collectUniqueModels(availableModels, currentId);
  if (!uniqueModels.hasCurrentModel) {
    const { models } = uniqueModels;
    models.push(createFallbackModelInfo(currentId, { vendor: 'configured' }));
  }
  return uniqueModels.models;
}

function buildModelLookup(models: ModelInfo[]): Map<string, ModelInfo> {
  const byId = new Map<string, ModelInfo>();
  for (const model of models) {
    byId.set(model.id, model);
  }
  return byId;
}

function collectFavoriteModels(ids: string[], byId: Map<string, ModelInfo>, favoriteSet: Set<string>): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const id of ids) {
    if (favoriteSet.has(id)) continue;
    favoriteSet.add(id);
    const model = byId.get(id);
    if (model) models.push(model);
  }
  return models;
}

function collectRecentModels(
  ids: string[],
  byId: Map<string, ModelInfo>,
  favoriteSet: Set<string>,
  recentSet: Set<string>
): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const id of ids) {
    if (favoriteSet.has(id)) continue;
    if (recentSet.has(id)) continue;
    const model = byId.get(id);
    if (!model) continue;
    models.push(model);
    recentSet.add(model.id);
  }
  return models;
}

function collectRemainingModels(models: ModelInfo[], favoriteSet: Set<string>, recentSet: Set<string>): ModelInfo[] {
  const remaining: ModelInfo[] = [];
  for (const model of models) {
    if (favoriteSet.has(model.id) || recentSet.has(model.id)) continue;
    remaining.push(model);
  }
  return sortModelsForPickerInPlace(remaining);
}

function prependStoredModelId(id: string, existing: string[], limit?: number): string[] {
  const next = [id];
  for (const model of existing) {
    if (model === id) continue;
    next.push(model);
    if (typeof limit === 'number' && next.length >= limit) break;
  }
  return next;
}

function removeStoredModelId(id: string, existing: string[]): string[] {
  const next: string[] = [];
  for (const model of existing) {
    if (model !== id) next.push(model);
  }
  return next;
}

function storedModelIdsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function storedModelIdsContain(ids: string[], id: string): boolean {
  for (const modelId of ids) {
    if (modelId === id) return true;
  }
  return false;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createChatModelsService(controller: ChatModelsDeps): ChatModelsService {
  const service = bindChatControllerService(controller, {
    async loadModels(this: ChatModelsDeps): Promise<void> {
      const provider = this.llmProvider;
      const existing = modelLoadsInFlight.get(this);
      if (existing && existing.provider === provider) {
        await existing.promise;
        return;
      }

      const load = (async () => {
        const timeoutMs = 5000;
        let availableModels: ModelInfo[];
        try {
          if (provider?.getModels) {
            availableModels = await withTimeout(
              provider.getModels(),
              timeoutMs,
              `Timed out loading models after ${timeoutMs}ms`
            );
          } else {
            const fallback = this.currentModel || 'gpt-4o';
            availableModels = [createFallbackModelInfo(fallback)];
          }
        } catch (error) {
          if (this.llmProvider !== provider) return;
          appendErrorLog(this.outputChannel, 'Failed to load models', error, { tag: 'Models' });
          const fallback = this.currentModel || 'gpt-4o';
          availableModels = [createFallbackModelInfo(fallback)];
        }

        if (this.llmProvider !== provider) return;
        if (availableModels.length === 0) {
          const fallback = this.currentModel || 'gpt-4o';
          availableModels = [createFallbackModelInfo(fallback)];
        }
        this.availableModels = availableModels;

        this.currentModel = resolveConfiguredModelId(provider?.id) || this.currentModel;

        const uniqueModels = collectUniqueModels(this.availableModels, this.currentModel);
        if (uniqueModels.hasCurrentModel) {
          this.availableModels = uniqueModels.models;
        } else {
          const models = new Array<ModelInfo>(uniqueModels.models.length + 1);
          models[0] = createCustomModelInfo(this.currentModel);
          for (let index = 0; index < uniqueModels.models.length; index++) {
            models[index + 1] = uniqueModels.models[index];
          }
          this.availableModels = models;
          this.agent.updateConfig({ model: this.currentModel });
        }

        await service.postModelState();
      })();
      const task = { provider, promise: load };
      modelLoadsInFlight.set(this, task);
      try {
        await load;
      } finally {
        if (modelLoadsInFlight.get(this) === task) {
          modelLoadsInFlight.delete(this);
        }
      }
    },

    async getFavoriteModelIds(this: ChatModelsDeps): Promise<string[]> {
      return normalizeStoredModelIds(this.context.globalState.get<string[]>(favoritesStorageKey(this)));
    },

    async getRecentModelIds(this: ChatModelsDeps): Promise<string[]> {
      return normalizeStoredModelIds(this.context.globalState.get<string[]>(recentsStorageKey(this)));
    },

    async getModelPickerStateForUI(this: ChatModelsDeps): Promise<ModelPickerState> {
      if (this.availableModels.length === 0) {
        await service.loadModels();
      }

      const currentId = this.currentModel || resolveConfiguredModelId(this.llmProvider?.id) || 'gpt-4o';
      const models = getUniqueModelPickerModels(this.availableModels, currentId);
      const favoriteIds = await service.getFavoriteModelIds();
      const recentIds = await service.getRecentModelIds();
      const favoriteSet = new Set<string>();
      const recentSet = new Set<string>();
      const byId = buildModelLookup(models);
      const favorites = collectFavoriteModels(favoriteIds, byId, favoriteSet);
      const recent = collectRecentModels(recentIds, byId, favoriteSet, recentSet);
      const all = collectRemainingModels(models, favoriteSet, recentSet);
      return { currentModel: currentId, favorites, recent, all };
    },

    async clearRecentModels(this: ChatModelsDeps): Promise<void> {
      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before clearing recent models.');
        await service.postModelPickerState(true);
        return;
      }

      try {
        const existing = await service.getRecentModelIds();
        if (existing.length > 0) {
          await this.context.globalState.update(recentsStorageKey(this), []);
        }
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to clear recent models', error, { tag: 'Models' });
        postInputNotice(this, 'Failed to clear recent models. See logs for details.');
      }
      await service.postModelPickerState(true);
    },

    async refreshModelsForUI(this: ChatModelsDeps): Promise<void> {
      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before refreshing models.');
        await service.postModelPickerState(true);
        return;
      }

      try {
        this.llmProvider?.clearModelCache?.();
        this.availableModels = [];
        await service.loadModels();
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to refresh models', error, { tag: 'Models' });
        postInputNotice(this, 'Failed to refresh models. See logs for details.');
      }
      await service.postModelPickerState(true);
    },

    async isModelFavorite(this: ChatModelsDeps, modelId: string): Promise<boolean> {
      const id = normalizeModelId(modelId);
      if (!id) return false;
      const favorites = await service.getFavoriteModelIds();
      return storedModelIdsContain(favorites, id);
    },

    getModelLabel(this: ChatModelsDeps, modelId: string): string {
      const id = normalizeModelId(modelId);
      if (!id) return '';
      for (const model of this.availableModels) {
        if (model?.id === id) return model.name || id;
      }
      return id;
    },

    async postModelState(this: ChatModelsDeps): Promise<void> {
      const model = this.currentModel || '';
      const isFavorite = await service.isModelFavorite(model);
      this.webviewApi.postMessage({
        type: 'modelState',
        model,
        label: service.getModelLabel(model) || model,
        isFavorite,
        reasoningEffort: getConfiguredReasoningEffort(),
      });
    },

    async postModelPickerState(this: ChatModelsDeps, reveal?: boolean): Promise<void> {
      this.webviewApi.postMessage({
        type: 'modelPickerState',
        picker: await service.getModelPickerStateForUI(),
        reveal: reveal === true,
      });
    },

    async recordRecentModel(this: ChatModelsDeps, modelId: string): Promise<void> {
      const id = normalizeModelId(modelId);
      if (!id) return;

      const existing = await service.getRecentModelIds();
      const next = prependStoredModelId(id, existing, MAX_RECENT_MODELS);
      if (storedModelIdsEqual(existing, next)) return;
      await this.context.globalState.update(recentsStorageKey(this), next);
    },

    async toggleFavoriteModel(this: ChatModelsDeps, modelId: string): Promise<void> {
      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before changing favorite models.');
        await service.postModelState();
        await service.postModelPickerState(false);
        return;
      }

      const id = normalizeModelId(modelId);
      if (!id) {
        await service.postModelState();
        await service.postModelPickerState(false);
        return;
      }

      try {
        const existing = await service.getFavoriteModelIds();
        const isFavorite = storedModelIdsContain(existing, id);
        const next = isFavorite ? removeStoredModelId(id, existing) : prependStoredModelId(id, existing);
        await this.context.globalState.update(favoritesStorageKey(this), next);
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to update favorite models', error, { tag: 'Models' });
        postInputNotice(this, 'Failed to update favorite models. See logs for details.');
      }

      if (this.currentModel === id) {
        await service.postModelState();
      }
      await service.postModelPickerState(false);
    },

    async setCurrentModel(this: ChatModelsDeps, modelId: string): Promise<void> {
      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before switching models.');
        await service.postModelState();
        return;
      }

      const id = normalizeModelId(modelId);
      if (!id) {
        postInputNotice(this, 'Model ID is required.');
        await service.postModelState();
        return;
      }
      if (id === this.currentModel) {
        await service.postModelState();
        return;
      }

      try {
        await vscode.workspace.getConfiguration('lingyun').update('model', id, true);
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to persist model setting', error, { tag: 'Models' });
        postInputNotice(this, 'Failed to switch models. See logs for details.');
        await service.postModelState();
        await service.postModelPickerState(false);
        return;
      }

      this.currentModel = id;
      this.agent.updateConfig({ model: id });

      await service.recordRecentModel(id);

      const isFavorite = await service.isModelFavorite(id);
      this.webviewApi.postMessage({
        type: 'modelChanged',
        model: id,
        label: service.getModelLabel(id) || id,
        isFavorite,
        reasoningEffort: getConfiguredReasoningEffort(),
      });
      await service.postModelPickerState(false);

      this.sessionApi.persistActiveSession();
    },

    async setReasoningEffort(this: ChatModelsDeps, reasoningEffort: string): Promise<void> {
      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before changing reasoning effort.');
        await service.postModelState();
        return;
      }

      const normalized = normalizeReasoningEffortForConfig(reasoningEffort);
      if (normalized === undefined) {
        postInputNotice(this, 'Unsupported reasoning effort. Choose off, low, medium, high, xhigh, or max.');
        await service.postModelState();
        return;
      }
      if (normalized === getConfiguredReasoningEffort()) {
        await service.postModelState();
        return;
      }

      try {
        await vscode.workspace.getConfiguration('lingyun').update('copilot.reasoningEffort', normalized, true);
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to persist reasoning effort setting', error, { tag: 'Models' });
        postInputNotice(this, 'Failed to update reasoning effort. See logs for details.');
        await service.postModelState();
        return;
      }

      await service.postModelState();
    },

    async openAdvancedModelSettings(this: ChatModelsDeps): Promise<void> {
      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before opening advanced model settings.');
        await service.postModelState();
        return;
      }

      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:mzbac.lingyun model');
    },

  });

  return service;
}
