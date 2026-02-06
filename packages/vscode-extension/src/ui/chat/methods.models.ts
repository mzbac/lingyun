import * as vscode from 'vscode';
import type { ModelInfo } from '../../providers/copilot';
import { ChatViewProvider } from '../chat';

const MAX_RECENT_MODELS = 10;

type ModelPickAction = 'refreshModels' | 'clearRecents';

type ModelPickItem = vscode.QuickPickItem & {
  action?: ModelPickAction;
  modelId?: string;
};

function getProviderKey(chat: ChatViewProvider): string {
  const raw = chat.llmProvider?.id;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'unknown';
}

function favoritesStorageKey(chat: ChatViewProvider): string {
  return `modelFavorites:${getProviderKey(chat)}`;
}

function recentsStorageKey(chat: ChatViewProvider): string {
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

Object.assign(ChatViewProvider.prototype, {
  async loadModels(this: ChatViewProvider): Promise<void> {
    const timeoutMs = 5000;
    try {
      if (this.llmProvider?.getModels) {
        this.availableModels = await Promise.race([
          this.llmProvider.getModels(),
          new Promise<ModelInfo[]>((_, reject) => {
            setTimeout(
              () => reject(new Error(`Timed out loading models after ${timeoutMs}ms`)),
              timeoutMs
            );
          }),
        ]);
      } else {
        const fallback = this.currentModel || 'gpt-4o';
        this.availableModels = [{ id: fallback, name: fallback, vendor: 'local', family: 'unknown' }];
      }
    } catch (error) {
      console.error('Failed to load models:', error);
      const fallback = this.currentModel || 'gpt-4o';
      this.availableModels = [{ id: fallback, name: fallback, vendor: 'local', family: 'unknown' }];
    }

    if (this.availableModels.length === 0) {
      const fallback = this.currentModel || 'gpt-4o';
      this.availableModels = [{ id: fallback, name: fallback, vendor: 'local', family: 'unknown' }];
    }

    const configured = vscode.workspace.getConfiguration('lingyun').get<string>('model') || this.currentModel;
    this.currentModel = configured || this.currentModel;

    if (!this.availableModels.some(m => m.id === this.currentModel)) {
      this.currentModel = this.availableModels[0].id;
      this.agent.updateConfig({ model: this.currentModel });
      try {
        await vscode.workspace.getConfiguration('lingyun').update('model', this.currentModel, true);
      } catch (error) {
        console.error('Failed to persist model setting:', error);
      }
    }

    await this.postModelState();
  },

  async getFavoriteModelIds(this: ChatViewProvider): Promise<string[]> {
    const ids = this.context.globalState.get<string[]>(favoritesStorageKey(this));
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
  },

  async getRecentModelIds(this: ChatViewProvider): Promise<string[]> {
    const ids = this.context.globalState.get<string[]>(recentsStorageKey(this));
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
  },

  async isModelFavorite(this: ChatViewProvider, modelId: string): Promise<boolean> {
    const id = normalizeModelId(modelId);
    if (!id) return false;
    const favorites = await this.getFavoriteModelIds();
    return favorites.includes(id);
  },

  getModelLabel(this: ChatViewProvider, modelId: string): string {
    const id = normalizeModelId(modelId);
    if (!id) return '';
    const match = this.availableModels.find(m => m.id === id);
    return match?.name || id;
  },

  async postModelState(this: ChatViewProvider): Promise<void> {
    const model = this.currentModel || '';
    const isFavorite = await this.isModelFavorite(model);
    this.postMessage({
      type: 'modelState',
      model,
      label: this.getModelLabel(model) || model,
      isFavorite,
    });
  },

  async recordRecentModel(this: ChatViewProvider, modelId: string): Promise<void> {
    const id = normalizeModelId(modelId);
    if (!id) return;

    const existing = await this.getRecentModelIds();
    const next = [id, ...existing.filter(m => m !== id)].slice(0, MAX_RECENT_MODELS);
    await this.context.globalState.update(recentsStorageKey(this), next);
  },

  async toggleFavoriteModel(this: ChatViewProvider, modelId: string): Promise<void> {
    const id = normalizeModelId(modelId);
    if (!id) return;

    const existing = await this.getFavoriteModelIds();
    const isFav = existing.includes(id);
    const next = isFav ? existing.filter(m => m !== id) : [id, ...existing.filter(m => m !== id)];
    await this.context.globalState.update(favoritesStorageKey(this), next);

    if (this.currentModel === id) {
      await this.postModelState();
    }
  },

  async setCurrentModel(this: ChatViewProvider, modelId: string): Promise<void> {
    const id = normalizeModelId(modelId);
    if (!id) return;

    this.currentModel = id;
    this.agent.updateConfig({ model: id });
    try {
      await vscode.workspace.getConfiguration('lingyun').update('model', id, true);
    } catch (error) {
      console.error('Failed to persist model setting:', error);
    }

    await this.recordRecentModel(id);

    const isFavorite = await this.isModelFavorite(id);
    this.postMessage({
      type: 'modelChanged',
      model: id,
      label: this.getModelLabel(id) || id,
      isFavorite,
    });

    this.persistActiveSession();
  },

  async pickModel(this: ChatViewProvider): Promise<void> {
    if (this.isProcessing) {
      void vscode.window.showInformationMessage('LingYun: Stop the current task before switching models.');
      return;
    }

    if (this.availableModels.length === 0) {
      await this.loadModels();
    }

    const fallbackModelId = this.currentModel || 'gpt-4o';
    const models = uniqById([
      ...this.availableModels,
      ...(this.availableModels.some(m => m.id === fallbackModelId)
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

    const qp = vscode.window.createQuickPick<ModelPickItem>();
    qp.title = 'Select Model';
    qp.placeholder = 'Search models by name/id/vendor…';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;

    let activeModels = models;

    const rebuildItems = async (params?: { refreshedModels?: ModelInfo[] }) => {
      const currentId = this.currentModel || fallbackModelId;
      if (params?.refreshedModels) {
        activeModels = uniqById(params.refreshedModels);
      }

      const favIds = await this.getFavoriteModelIds();
      const recentIds = await this.getRecentModelIds();
      const favSet = new Set(favIds);

      const activeById = new Map(activeModels.map(m => [m.id, m] as const));
      const favModels = favIds.map(id => activeById.get(id)).filter((m): m is ModelInfo => !!m);
      const recModels = recentIds
        .filter(id => !favSet.has(id))
        .map(id => activeById.get(id))
        .filter((m): m is ModelInfo => !!m);
      const recSet = new Set(recModels.map(m => m.id));

      const rest = activeModels
        .filter(m => !favSet.has(m.id) && !recSet.has(m.id))
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
        ...favModels.map(model =>
          toModelPickItem({
            model,
            currentModelId: currentId,
            favorite: true,
            favoriteButtonOn,
            favoriteButtonOff,
          })
        ),
        { label: 'Recent', kind: vscode.QuickPickItemKind.Separator },
        ...recModels.map(model =>
          toModelPickItem({
            model,
            currentModelId: currentId,
            favorite: favSet.has(model.id),
            favoriteButtonOn,
            favoriteButtonOff,
          })
        ),
        { label: 'All models', kind: vscode.QuickPickItemKind.Separator },
        ...rest.map(model =>
          toModelPickItem({
            model,
            currentModelId: currentId,
            favorite: favSet.has(model.id),
            favoriteButtonOn,
            favoriteButtonOff,
          })
        ),
      ];

      qp.items = items;
      const active = items.find(i => i.modelId === currentId);
      if (active) {
        qp.activeItems = [active];
      }
    };

    await rebuildItems();

    const disposables: vscode.Disposable[] = [];
    disposables.push(
      qp.onDidAccept(async () => {
        const picked = qp.selectedItems[0];
        if (!picked) return;

        if (picked.action === 'refreshModels') {
          qp.busy = true;
          try {
            this.llmProvider?.clearModelCache?.();
            this.availableModels = [];
            await this.loadModels();
            const refreshed = uniqById(this.availableModels);
            await rebuildItems({ refreshedModels: refreshed });
          } finally {
            qp.busy = false;
          }
          return;
        }

        if (picked.action === 'clearRecents') {
          qp.busy = true;
          try {
            await this.context.globalState.update(recentsStorageKey(this), []);
            await rebuildItems();
          } finally {
            qp.busy = false;
          }
          return;
        }

        const modelId = picked.modelId;
        if (!modelId) return;

        qp.hide();
        await this.setCurrentModel(modelId);
      }),
      qp.onDidTriggerItemButton(async (e) => {
        const modelId = e.item.modelId;
        if (!modelId) return;

        await this.toggleFavoriteModel(modelId);
        await rebuildItems();
      }),
      qp.onDidHide(() => {
        for (const d of disposables) d.dispose();
        qp.dispose();
      })
    );

    qp.show();
  },
});
