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
const REASONING_EFFORT_VALUES = new Set(['', 'low', 'medium', 'high', 'xhigh']);

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

function createCustomModelInfo(modelId: string): ModelInfo {
  return createFallbackModelInfo(modelId, { vendor: 'custom' });
}

function normalizeReasoningEffortForConfig(reasoningEffort: string): string | undefined {
  const normalized = String(reasoningEffort || '').trim();
  if (!REASONING_EFFORT_VALUES.has(normalized)) return undefined;
  return normalized;
}

function uniqById(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const model of models) {
    if (!model?.id) continue;
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

function sortModelsForPicker(models: ModelInfo[]): ModelInfo[] {
  return models
    .slice()
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }));
}

export function createChatModelsService(controller: ChatModelsDeps): ChatModelsService {
  const service = bindChatControllerService(controller, {
    async loadModels(this: ChatModelsDeps): Promise<void> {
      const timeoutMs = 5000;
      try {
        if (this.llmProvider?.getModels) {
          this.availableModels = await Promise.race([
            this.llmProvider.getModels(),
            new Promise<ModelInfo[]>((_, reject) => {
              setTimeout(() => reject(new Error(`Timed out loading models after ${timeoutMs}ms`)), timeoutMs);
            }),
          ]);
        } else {
          const fallback = this.currentModel || 'gpt-4o';
          this.availableModels = [createFallbackModelInfo(fallback)];
        }
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to load models', error, { tag: 'Models' });
        const fallback = this.currentModel || 'gpt-4o';
        this.availableModels = [createFallbackModelInfo(fallback)];
      }

      if (this.availableModels.length === 0) {
        const fallback = this.currentModel || 'gpt-4o';
        this.availableModels = [createFallbackModelInfo(fallback)];
      }

      this.currentModel = resolveConfiguredModelId(this.llmProvider?.id) || this.currentModel;

      if (!this.availableModels.some((model) => model.id === this.currentModel)) {
        this.availableModels = uniqById([
          createCustomModelInfo(this.currentModel),
          ...this.availableModels,
        ]);
        this.agent.updateConfig({ model: this.currentModel });
      }

      await service.postModelState();
    },

    async getFavoriteModelIds(this: ChatModelsDeps): Promise<string[]> {
      const ids = this.context.globalState.get<string[]>(favoritesStorageKey(this));
      return Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];
    },

    async getRecentModelIds(this: ChatModelsDeps): Promise<string[]> {
      const ids = this.context.globalState.get<string[]>(recentsStorageKey(this));
      return Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];
    },

    async getModelPickerStateForUI(this: ChatModelsDeps): Promise<ModelPickerState> {
      if (this.availableModels.length === 0) {
        await service.loadModels();
      }

      const currentId = this.currentModel || resolveConfiguredModelId(this.llmProvider?.id) || 'gpt-4o';
      const models = uniqById([
        ...this.availableModels,
        ...(this.availableModels.some((model) => model.id === currentId)
          ? []
          : [createFallbackModelInfo(currentId, { vendor: 'configured' })]),
      ]);
      const favoriteIds = await service.getFavoriteModelIds();
      const recentIds = await service.getRecentModelIds();
      const favoriteSet = new Set(favoriteIds);
      const byId = new Map(models.map((model) => [model.id, model] as const));
      const favorites = favoriteIds.map((id) => byId.get(id)).filter((model): model is ModelInfo => !!model);
      const recent = recentIds
        .filter((id) => !favoriteSet.has(id))
        .map((id) => byId.get(id))
        .filter((model): model is ModelInfo => !!model);
      const recentSet = new Set(recent.map((model) => model.id));
      const all = sortModelsForPicker(models.filter((model) => !favoriteSet.has(model.id) && !recentSet.has(model.id)));
      return { currentModel: currentId, favorites, recent, all };
    },

    async clearRecentModels(this: ChatModelsDeps): Promise<void> {
      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before clearing recent models.');
        await service.postModelPickerState(true);
        return;
      }

      try {
        await this.context.globalState.update(recentsStorageKey(this), []);
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
      return favorites.includes(id);
    },

    getModelLabel(this: ChatModelsDeps, modelId: string): string {
      const id = normalizeModelId(modelId);
      if (!id) return '';
      const match = this.availableModels.find((model) => model.id === id);
      return match?.name || id;
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
      const next = [id, ...existing.filter((model) => model !== id)].slice(0, MAX_RECENT_MODELS);
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
        const isFavorite = existing.includes(id);
        const next = isFavorite ? existing.filter((model) => model !== id) : [id, ...existing.filter((model) => model !== id)];
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
        postInputNotice(this, 'Unsupported reasoning effort. Choose off, low, medium, high, or xhigh.');
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
