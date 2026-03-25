import * as vscode from 'vscode';

import { appendErrorLog } from '../../core/logger';
import type { AgentLoop } from '../../core/agent';
import { resolveConfiguredModelId } from '../../core/modelSelection';
import type { ModelInfo } from '../../providers/copilot';

import { bindChatControllerService } from './controllerService';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';

const MAX_RECENT_MODELS = 10;

type ModelPickAction = 'refreshModels' | 'clearRecents';

type ModelPickItem = vscode.QuickPickItem & {
  action?: ModelPickAction;
  modelId?: string;
};

type GlobalStateLike = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
};

export interface ChatModelsService {
  loadModels(): Promise<void>;
  getFavoriteModelIds(): Promise<string[]>;
  getRecentModelIds(): Promise<string[]>;
  isModelFavorite(modelId: string): Promise<boolean>;
  getModelLabel(modelId: string): string;
  postModelState(): Promise<void>;
  recordRecentModel(modelId: string): Promise<void>;
  toggleFavoriteModel(modelId: string): Promise<void>;
  setCurrentModel(modelId: string): Promise<void>;
  pickModel(): Promise<void>;
}

export interface ChatModelsDeps {
  context: { globalState: GlobalStateLike };
  llmProvider?: {
    id?: string;
    getModels?: () => Promise<ModelInfo[]>;
    clearModelCache?: () => void;
  };
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

function formatModelDetail(model: ModelInfo, currentModelId: string): string | undefined {
  const parts: string[] = [];
  if (model.id === currentModelId) parts.push('Current');
  if (model.vendor) parts.push(model.vendor);
  if (model.family && model.family !== model.vendor) parts.push(model.family);
  if (Number.isFinite(model.maxInputTokens as number) && (model.maxInputTokens as number) > 0) {
    parts.push(`maxIn=${Math.floor(model.maxInputTokens as number)}`);
  }
  const detail = parts.filter(Boolean).join(' • ');
  return detail || undefined;
}

function toModelPickItem(params: {
  model: ModelInfo;
  currentModelId: string;
  favorite: boolean;
  favoriteButtonOn: vscode.QuickInputButton;
  favoriteButtonOff: vscode.QuickInputButton;
}): ModelPickItem {
  const { model, currentModelId, favorite, favoriteButtonOn, favoriteButtonOff } = params;
  const label = model.name || model.id;
  const description = model.name && model.name !== model.id ? model.id : undefined;
  return {
    label,
    description,
    detail: formatModelDetail(model, currentModelId),
    modelId: model.id,
    buttons: [favorite ? favoriteButtonOn : favoriteButtonOff],
  };
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
          this.availableModels = [{ id: fallback, name: fallback, vendor: 'local', family: 'unknown' }];
        }
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to load models', error, { tag: 'Models' });
        const fallback = this.currentModel || 'gpt-4o';
        this.availableModels = [{ id: fallback, name: fallback, vendor: 'local', family: 'unknown' }];
      }

      if (this.availableModels.length === 0) {
        const fallback = this.currentModel || 'gpt-4o';
        this.availableModels = [{ id: fallback, name: fallback, vendor: 'local', family: 'unknown' }];
      }

      this.currentModel = resolveConfiguredModelId(this.llmProvider?.id) || this.currentModel;

      if (!this.availableModels.some((model) => model.id === this.currentModel)) {
        this.currentModel = this.availableModels[0].id;
        this.agent.updateConfig({ model: this.currentModel });
        try {
          await vscode.workspace.getConfiguration('lingyun').update('model', this.currentModel, true);
        } catch (error) {
          appendErrorLog(this.outputChannel, 'Failed to persist model setting', error, { tag: 'Models' });
        }
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
      const id = normalizeModelId(modelId);
      if (!id) return;

      const existing = await service.getFavoriteModelIds();
      const isFavorite = existing.includes(id);
      const next = isFavorite ? existing.filter((model) => model !== id) : [id, ...existing.filter((model) => model !== id)];
      await this.context.globalState.update(favoritesStorageKey(this), next);

      if (this.currentModel === id) {
        await service.postModelState();
      }
    },

    async setCurrentModel(this: ChatModelsDeps, modelId: string): Promise<void> {
      const id = normalizeModelId(modelId);
      if (!id) return;

      this.currentModel = id;
      this.agent.updateConfig({ model: id });
      try {
        await vscode.workspace.getConfiguration('lingyun').update('model', id, true);
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to persist model setting', error, { tag: 'Models' });
      }

      await service.recordRecentModel(id);

      const isFavorite = await service.isModelFavorite(id);
      this.webviewApi.postMessage({
        type: 'modelChanged',
        model: id,
        label: service.getModelLabel(id) || id,
        isFavorite,
      });

      this.sessionApi.persistActiveSession();
    },

    async pickModel(this: ChatModelsDeps): Promise<void> {
      if (this.isProcessing) {
        void vscode.window.showInformationMessage('LingYun: Stop the current task before switching models.');
        return;
      }

      if (this.availableModels.length === 0) {
        await service.loadModels();
      }

      const fallbackModelId = this.currentModel || 'gpt-4o';
      const models = uniqById([
        ...this.availableModels,
        ...(this.availableModels.some((model) => model.id === fallbackModelId)
          ? []
          : [{ id: fallbackModelId, name: fallbackModelId, vendor: 'configured', family: 'unknown' }]),
      ]);

      const favoriteButtonOn: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('star-full'),
        tooltip: 'Remove from favorites',
      };
      const favoriteButtonOff: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('star-empty'),
        tooltip: 'Add to favorites',
      };

      const quickPick = vscode.window.createQuickPick<ModelPickItem>();
      quickPick.title = 'Select Model';
      quickPick.placeholder = 'Search models by name/id/vendor…';
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      let activeModels = models;

      const rebuildItems = async (params?: { refreshedModels?: ModelInfo[] }) => {
        const currentId = this.currentModel || fallbackModelId;
        if (params?.refreshedModels) {
          activeModels = uniqById(params.refreshedModels);
        }

        const favoriteIds = await service.getFavoriteModelIds();
        const recentIds = await service.getRecentModelIds();
        const favoriteSet = new Set(favoriteIds);

        const activeById = new Map(activeModels.map((model) => [model.id, model] as const));
        const favoriteModels = favoriteIds.map((id) => activeById.get(id)).filter((model): model is ModelInfo => !!model);
        const recentModels = recentIds
          .filter((id) => !favoriteSet.has(id))
          .map((id) => activeById.get(id))
          .filter((model): model is ModelInfo => !!model);
        const recentSet = new Set(recentModels.map((model) => model.id));

        const rest = activeModels
          .filter((model) => !favoriteSet.has(model.id) && !recentSet.has(model.id))
          .slice()
          .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }));

        const items: ModelPickItem[] = [
          {
            label: '$(refresh) Refresh model list',
            detail: 'Re-fetch models from the provider',
            alwaysShow: true,
            action: 'refreshModels',
          },
          {
            label: '$(trash) Clear recent models',
            detail: 'Remove recent model history for this provider',
            alwaysShow: true,
            action: 'clearRecents',
          },
          { label: 'Favorites', kind: vscode.QuickPickItemKind.Separator },
          ...favoriteModels.map((model) =>
            toModelPickItem({
              model,
              currentModelId: currentId,
              favorite: true,
              favoriteButtonOn,
              favoriteButtonOff,
            })
          ),
          { label: 'Recent', kind: vscode.QuickPickItemKind.Separator },
          ...recentModels.map((model) =>
            toModelPickItem({
              model,
              currentModelId: currentId,
              favorite: favoriteSet.has(model.id),
              favoriteButtonOn,
              favoriteButtonOff,
            })
          ),
          { label: 'All models', kind: vscode.QuickPickItemKind.Separator },
          ...rest.map((model) =>
            toModelPickItem({
              model,
              currentModelId: currentId,
              favorite: favoriteSet.has(model.id),
              favoriteButtonOn,
              favoriteButtonOff,
            })
          ),
        ];

        quickPick.items = items;
        const active = items.find((item) => item.modelId === currentId);
        if (active) {
          quickPick.activeItems = [active];
        }
      };

      await rebuildItems();

      const disposables: vscode.Disposable[] = [];
      disposables.push(
        quickPick.onDidAccept(async () => {
          const picked = quickPick.selectedItems[0];
          if (!picked) return;

          if (picked.action === 'refreshModels') {
            quickPick.busy = true;
            try {
              this.llmProvider?.clearModelCache?.();
              this.availableModels = [];
              await service.loadModels();
              await rebuildItems({ refreshedModels: uniqById(this.availableModels) });
            } finally {
              quickPick.busy = false;
            }
            return;
          }

          if (picked.action === 'clearRecents') {
            quickPick.busy = true;
            try {
              await this.context.globalState.update(recentsStorageKey(this), []);
              await rebuildItems();
            } finally {
              quickPick.busy = false;
            }
            return;
          }

          const modelId = picked.modelId;
          if (!modelId) return;

          quickPick.hide();
          await service.setCurrentModel(modelId);
        }),
        quickPick.onDidTriggerItemButton(async (event) => {
          const modelId = event.item.modelId;
          if (!modelId) return;

          await service.toggleFavoriteModel(modelId);
          await rebuildItems();
        }),
        quickPick.onDidHide(() => {
          for (const disposable of disposables) disposable.dispose();
          quickPick.dispose();
        })
      );

      quickPick.show();
    },
  });

  return service;
}
