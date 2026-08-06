import * as assert from 'assert';
import * as vscode from 'vscode';

import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { createStandaloneChatController } from './chatControllerHarness';

function createBlankAgentState(): AgentSessionState {
  return {
    history: [],
    fileHandles: { nextId: 1, byId: {} },
    semanticHandles: {
      nextMatchId: 1,
      nextSymbolId: 1,
      nextLocId: 1,
      matches: {},
      symbols: {},
      locations: {},
    },
    pendingInputs: [],
    compactionSyntheticContexts: [],
  };
}

function createModelTrackingAgent(blankState: () => AgentSessionState, history: unknown[] = []) {
  const configUpdates: Array<Record<string, unknown>> = [];

  const agent = {
    updateConfig(update: Record<string, unknown>) {
      configUpdates.push(update);
    },
    syncSession() {},
    exportState() {
      return blankState();
    },
    getHistory() {
      return history;
    },
  } as unknown as AgentLoop;

  return { agent, configUpdates };
}

function getLingyunConfigValue<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration('lingyun').get<T>(key);
}

const generationSettingsConfigKeys = [
  'temperature',
  'topP',
  'topK',
  'maxOutputTokens',
  'maxIterations',
  'llm.maxRetries',
  'llm.retryWithPartialOutput',
  'llm.timeoutMs',
  'llm.textVerbosity',
] as const;

suite('Chat models service', () => {
  test('postModelState includes the configured reasoning effort', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');
    await config.update('copilot.reasoningEffort', 'xhigh', vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];

      controller.currentModel = 'gpt-5.4';
      controller.availableModels = [{ id: 'gpt-5.4', name: 'GPT-5.4' } as any];
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };

      await controller.modelApi.postModelState();

      assert.deepStrictEqual(posted, [
        {
          type: 'modelState',
          model: 'gpt-5.4',
          label: 'GPT-5.4',
          isFavorite: false,
          reasoningEffort: 'xhigh',
        },
      ]);
    } finally {
      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('setReasoningEffort updates setting and posts model state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];

      controller.currentModel = 'gpt-5.4';
      controller.availableModels = [{ id: 'gpt-5.4', name: 'GPT-5.4' } as any];
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };

      await controller.modelApi.setReasoningEffort('low');

      assert.strictEqual(getLingyunConfigValue('copilot.reasoningEffort'), 'low');
      assert.deepStrictEqual(posted, [
        {
          type: 'modelState',
          model: 'gpt-5.4',
          label: 'GPT-5.4',
          isFavorite: false,
          reasoningEffort: 'low',
        },
      ]);
    } finally {
      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('setReasoningEffort accepts max and posts model state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];

      controller.currentModel = 'gpt-5.4';
      controller.availableModels = [{ id: 'gpt-5.4', name: 'GPT-5.4' } as any];
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };

      await controller.modelApi.setReasoningEffort('max');

      assert.strictEqual(getLingyunConfigValue('copilot.reasoningEffort'), 'max');
      assert.deepStrictEqual(posted, [
        {
          type: 'modelState',
          model: 'gpt-5.4',
          label: 'GPT-5.4',
          isFavorite: false,
          reasoningEffort: 'max',
        },
      ]);
    } finally {
      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('setReasoningEffort preserves empty value as disabled', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];

      controller.currentModel = 'gpt-5.4';
      controller.availableModels = [{ id: 'gpt-5.4', name: 'GPT-5.4' } as any];
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };

      await controller.modelApi.setReasoningEffort('');

      assert.strictEqual(getLingyunConfigValue('copilot.reasoningEffort'), '');
      assert.deepStrictEqual(posted, [
        {
          type: 'modelState',
          model: 'gpt-5.4',
          label: 'GPT-5.4',
          isFavorite: false,
          reasoningEffort: '',
        },
      ]);
    } finally {
      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('setReasoningEffort skips default high persistence while resyncing model state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.inspect<string>('copilot.reasoningEffort')?.globalValue;
    await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];

      controller.currentModel = 'model-a';
      controller.availableModels = [{ id: 'model-a', name: 'Alpha' } as any];
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };

      await controller.modelApi.setReasoningEffort(' high ');

      assert.strictEqual(config.inspect<string>('copilot.reasoningEffort')?.globalValue, undefined);
      assert.deepStrictEqual(posted, [
        {
          type: 'modelState',
          model: 'model-a',
          label: 'Alpha',
          isFavorite: false,
          reasoningEffort: 'high',
        },
      ]);
    } finally {
      await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
    }
  });

  test('generation settings service skips unchanged config writes while resyncing state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousValues = new Map<string, unknown>();
    for (const key of generationSettingsConfigKeys) {
      previousValues.set(key, config.inspect<unknown>(key)?.globalValue);
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];
      const defaultSettings = {
        temperature: 0,
        topP: 0,
        topK: 0,
        maxOutputTokens: 32000,
        maxIterations: 50,
        maxRetries: 2,
        retryWithPartialOutput: true,
        timeoutMs: 0,
        textVerbosity: '',
      };

      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return Promise.resolve(true);
          },
        },
      } as unknown as vscode.WebviewView;

      await controller.webviewApi.setGenerationSettings(defaultSettings);

      for (const key of generationSettingsConfigKeys) {
        assert.strictEqual(config.inspect<unknown>(key)?.globalValue, undefined, `${key} should stay unpersisted`);
      }
      assert.deepStrictEqual(posted, [
        {
          type: 'generationSettingsState',
          generationSettings: defaultSettings,
        },
      ]);
    } finally {
      for (const [key, value] of previousValues) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('model limits service skips unchanged config writes while resyncing state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousModelLimits = config.inspect<Record<string, unknown>>('modelLimits')?.globalValue;
    await config.update('modelLimits', undefined, vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];
      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return Promise.resolve(true);
          },
        },
      } as unknown as vscode.WebviewView;

      await controller.webviewApi.setModelLimits({});

      assert.strictEqual(config.inspect<Record<string, unknown>>('modelLimits')?.globalValue, undefined);
      assert.deepStrictEqual(posted, [
        {
          type: 'modelLimitsState',
          modelLimits: {},
        },
      ]);
    } finally {
      await config.update('modelLimits', previousModelLimits, vscode.ConfigurationTarget.Global);
    }
  });

  test('loadModels deduplicates provider models while inserting the configured current model', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousModel = config.inspect<string>('model')?.globalValue;
    const previousEffort = config.inspect<string>('copilot.reasoningEffort')?.globalValue;
    await config.update('model', 'configured-model', vscode.ConfigurationTarget.Global);
    await config.update('copilot.reasoningEffort', 'high', vscode.ConfigurationTarget.Global);

    try {
      const { agent, configUpdates } = createModelTrackingAgent(createBlankAgentState);
      const controller = createStandaloneChatController({
        agent,
        llmProvider: {
          id: 'copilot',
          name: 'Test Provider',
          getModel: async () => ({}),
          getModels: async () => [
            { id: 'model-b', name: 'Beta', vendor: 'provider', family: 'test' },
            { id: 'model-b', name: 'Beta Duplicate', vendor: 'provider', family: 'test' },
            { id: 'model-a', name: 'Alpha', vendor: 'provider', family: 'test' },
          ],
        } as any,
      });
      const posted: unknown[] = [];
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };

      await controller.modelApi.loadModels();

      assert.strictEqual(controller.currentModel, 'configured-model');
      assert.deepStrictEqual(configUpdates, [{ model: 'configured-model' }]);
      assert.deepStrictEqual(controller.availableModels, [
        { id: 'configured-model', name: 'configured-model', vendor: 'custom', family: 'unknown' },
        { id: 'model-b', name: 'Beta', vendor: 'provider', family: 'test' },
        { id: 'model-a', name: 'Alpha', vendor: 'provider', family: 'test' },
      ]);
      assert.deepStrictEqual(posted, [
        {
          type: 'modelState',
          model: 'configured-model',
          label: 'configured-model',
          isFavorite: false,
          reasoningEffort: 'high',
        },
      ]);
    } finally {
      await config.update('model', previousModel, vscode.ConfigurationTarget.Global);
      await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
    }
  });

  test('loadModels shares one in-flight provider request', async () => {
    let resolveModels: (models: any[]) => void = () => {};
    const pendingModels = new Promise<any[]>((resolve) => {
      resolveModels = resolve;
    });
    let providerCalls = 0;
    const controller = createStandaloneChatController({
      llmProvider: {
        id: 'test',
        name: 'Test Provider',
        getModels: () => {
          providerCalls++;
          return pendingModels;
        },
      } as any,
    });
    const posted: unknown[] = [];
    const currentModel = controller.currentModel;
    controller.availableModels = [];
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };

    const firstLoad = controller.modelApi.loadModels();
    const secondLoad = controller.modelApi.loadModels();
    await Promise.resolve();

    assert.strictEqual(providerCalls, 1);
    resolveModels([{ id: currentModel, name: 'Model A', vendor: 'provider', family: 'test' }]);
    await Promise.all([firstLoad, secondLoad]);

    assert.strictEqual(providerCalls, 1);
    assert.deepStrictEqual(controller.availableModels, [
      { id: currentModel, name: 'Model A', vendor: 'provider', family: 'test' },
    ]);
    assert.strictEqual(posted.filter((message: any) => message?.type === 'modelState').length, 1);
  });

  test('loadModels discards a stale result after provider replacement', async () => {
    let resolveFirstModels: (models: any[]) => void = () => {};
    const firstModels = new Promise<any[]>((resolve) => {
      resolveFirstModels = resolve;
    });
    let firstProviderCalls = 0;
    let replacementProviderCalls = 0;
    const controller = createStandaloneChatController({
      llmProvider: {
        id: 'first',
        name: 'First Provider',
        getModels: () => {
          firstProviderCalls++;
          return firstModels;
        },
      } as any,
    });
    const posted: unknown[] = [];
    const currentModel = controller.currentModel;
    controller.availableModels = [];
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };

    const firstLoad = controller.modelApi.loadModels();
    await Promise.resolve();
    controller.llmProvider = {
      id: 'replacement',
      name: 'Replacement Provider',
      getModels: async () => {
        replacementProviderCalls++;
        return [{ id: currentModel, name: 'Replacement Model', vendor: 'provider', family: 'test' }];
      },
    } as any;
    controller.availableModels = [];

    await controller.modelApi.loadModels();
    resolveFirstModels([{ id: currentModel, name: 'Stale Model', vendor: 'provider', family: 'test' }]);
    await firstLoad;

    assert.strictEqual(firstProviderCalls, 1);
    assert.strictEqual(replacementProviderCalls, 1);
    assert.deepStrictEqual(controller.availableModels, [
      { id: currentModel, name: 'Replacement Model', vendor: 'provider', family: 'test' },
    ]);
    assert.strictEqual(posted.filter((message: any) => message?.type === 'modelState').length, 1);
  });

  test('setCurrentModel posts modelChanged with the configured reasoning effort', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');
    const previousModel = config.get('model');
    await config.update('copilot.reasoningEffort', 'medium', vscode.ConfigurationTarget.Global);

    try {
      const { agent, configUpdates } = createModelTrackingAgent(createBlankAgentState);
      const controller = createStandaloneChatController({ agent });
      const posted: unknown[] = [];
      let persisted = 0;

      controller.availableModels = [{ id: 'gpt-5.4', name: 'GPT-5.4' } as any];
      controller.sessionApi.persistActiveSession = () => {
        persisted++;
      };
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };

      await controller.modelApi.setCurrentModel('gpt-5.4');

      assert.strictEqual(controller.currentModel, 'gpt-5.4');
      assert.deepStrictEqual(configUpdates, [{ model: 'gpt-5.4' }]);
      assert.strictEqual(persisted, 1);
      assert.deepStrictEqual(posted[0], {
        type: 'modelChanged',
        model: 'gpt-5.4',
        label: 'GPT-5.4',
        isFavorite: false,
        reasoningEffort: 'medium',
      });
      assert.deepStrictEqual(posted[1], {
        type: 'modelPickerState',
        picker: {
          currentModel: 'gpt-5.4',
          favorites: [],
          recent: [{ id: 'gpt-5.4', name: 'GPT-5.4' }],
          all: [],
        },
        reveal: false,
      });
      assert.strictEqual(posted.length, 2);
    } finally {
      if (previousModel === undefined) {
        await config.update('model', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('model', previousModel, vscode.ConfigurationTarget.Global);
      }

      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('setCurrentModel skips unchanged model persistence while resyncing model state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousEffort = config.get('copilot.reasoningEffort');
    const previousModel = config.get('model');
    await config.update('copilot.reasoningEffort', 'high', vscode.ConfigurationTarget.Global);
    await config.update('model', 'different-model', vscode.ConfigurationTarget.Global);

    try {
      const { agent, configUpdates } = createModelTrackingAgent(createBlankAgentState);
      const controller = createStandaloneChatController({ agent });
      const posted: unknown[] = [];
      const updates: Array<[string, unknown]> = [];
      const globalState = controller.context.globalState as any;
      const originalUpdate = globalState.update.bind(globalState) as (key: string, value: unknown) => Thenable<void>;
      let persisted = 0;

      controller.currentModel = 'model-a';
      controller.availableModels = [{ id: 'model-a', name: 'Alpha' } as any];
      controller.sessionApi.persistActiveSession = () => {
        persisted++;
      };
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };
      globalState.update = (key: string, value: unknown) => {
        updates.push([key, value]);
        return originalUpdate(key, value);
      };

      await controller.modelApi.setCurrentModel(' model-a ');

      assert.strictEqual(controller.currentModel, 'model-a');
      assert.strictEqual(getLingyunConfigValue('model'), 'different-model');
      assert.deepStrictEqual(configUpdates, []);
      assert.strictEqual(persisted, 0);
      assert.deepStrictEqual(updates, []);
      assert.deepStrictEqual(posted, [
        {
          type: 'modelState',
          model: 'model-a',
          label: 'Alpha',
          isFavorite: false,
          reasoningEffort: 'high',
        },
      ]);
    } finally {
      if (previousModel === undefined) {
        await config.update('model', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('model', previousModel, vscode.ConfigurationTarget.Global);
      }

      if (previousEffort === undefined) {
        await config.update('copilot.reasoningEffort', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('copilot.reasoningEffort', previousEffort, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('getModelPickerStateForUI groups favorites recents and sorted remaining models', async () => {
    const controller = createStandaloneChatController();
    controller.currentModel = 'model-a';
    controller.availableModels = [
      { id: 'model-b', name: 'Beta' } as any,
      { id: 'model-e', name: 'echo' } as any,
      { id: 'model-a', name: 'Alpha' } as any,
      { id: 'model-c', name: 'Charlie' } as any,
      { id: 'model-d', name: 'Delta' } as any,
      { id: 'model-z', name: 'Zulu' } as any,
    ];
    await controller.context.globalState.update('modelFavorites:unknown', [
      ' model-c ',
      '',
      'model-c',
      'missing-model',
      42 as any,
    ]);
    await controller.context.globalState.update('modelRecents:unknown', [
      'model-b',
      ' model-c ',
      'missing-model',
      'model-d',
      'model-b',
      '',
    ]);

    const state = await controller.modelApi.getModelPickerStateForUI();

    assert.strictEqual(state.currentModel, 'model-a');
    assert.deepStrictEqual(state.favorites.map((model) => model.id), ['model-c']);
    assert.deepStrictEqual(state.recent.map((model) => model.id), ['model-b', 'model-d']);
    assert.deepStrictEqual(state.all.map((model) => model.id), ['model-a', 'model-e', 'model-z']);
  });

  test('getModelPickerStateForUI deduplicates provider models and appends the configured current model', async () => {
    const controller = createStandaloneChatController();
    controller.currentModel = 'current-only';
    controller.availableModels = [
      { id: 'model-b', name: 'Beta', vendor: 'provider', family: 'test' },
      { id: 'model-b', name: 'Beta Duplicate', vendor: 'provider', family: 'test' },
      { id: 'model-a', name: 'Alpha', vendor: 'provider', family: 'test' },
    ];

    const state = await controller.modelApi.getModelPickerStateForUI();

    assert.deepStrictEqual(state, {
      currentModel: 'current-only',
      favorites: [],
      recent: [],
      all: [
        { id: 'model-a', name: 'Alpha', vendor: 'provider', family: 'test' },
        { id: 'model-b', name: 'Beta', vendor: 'provider', family: 'test' },
        { id: 'current-only', name: 'current-only', vendor: 'configured', family: 'unknown' },
      ],
    });
  });

  test('clearRecentModels skips empty storage writes while still posting picker state', async () => {
    const controller = createStandaloneChatController();
    const posted: unknown[] = [];
    const updates: Array<[string, unknown]> = [];
    const globalState = controller.context.globalState as any;
    const originalUpdate = globalState.update.bind(globalState) as (key: string, value: unknown) => Thenable<void>;

    controller.currentModel = 'model-a';
    controller.availableModels = [{ id: 'model-a', name: 'Alpha' } as any];
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    globalState.update = (key: string, value: unknown) => {
      updates.push([key, value]);
      return originalUpdate(key, value);
    };

    await controller.modelApi.clearRecentModels();

    assert.deepStrictEqual(updates, []);
    assert.deepStrictEqual(posted, [
      {
        type: 'modelPickerState',
        picker: {
          currentModel: 'model-a',
          favorites: [],
          recent: [],
          all: [{ id: 'model-a', name: 'Alpha' }],
        },
        reveal: true,
      },
    ]);

    posted.length = 0;
    await originalUpdate('modelRecents:unknown', ['model-a']);
    await controller.modelApi.clearRecentModels();

    assert.deepStrictEqual(updates, [['modelRecents:unknown', []]]);
    assert.deepStrictEqual(posted, [
      {
        type: 'modelPickerState',
        picker: {
          currentModel: 'model-a',
          favorites: [],
          recent: [],
          all: [{ id: 'model-a', name: 'Alpha' }],
        },
        reveal: true,
      },
    ]);
  });

  test('recordRecentModel skips unchanged writes while preserving reorder writes', async () => {
    const controller = createStandaloneChatController();
    const updates: Array<[string, unknown]> = [];
    const globalState = controller.context.globalState as any;
    const originalUpdate = globalState.update.bind(globalState) as (key: string, value: unknown) => Thenable<void>;

    await originalUpdate('modelRecents:unknown', ['model-a', 'model-b']);
    globalState.update = (key: string, value: unknown) => {
      updates.push([key, value]);
      return originalUpdate(key, value);
    };

    await controller.modelApi.recordRecentModel('model-a');

    assert.deepStrictEqual(updates, []);
    assert.deepStrictEqual(await controller.modelApi.getRecentModelIds(), ['model-a', 'model-b']);

    await controller.modelApi.recordRecentModel('model-b');

    assert.deepStrictEqual(updates, [['modelRecents:unknown', ['model-b', 'model-a']]]);
    assert.deepStrictEqual(await controller.modelApi.getRecentModelIds(), ['model-b', 'model-a']);
  });

  test('getContextForUI uses provider-discovered model token metadata when configured limits are absent', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousModelLimits = config.inspect<Record<string, unknown>>('modelLimits')?.globalValue;
    await config.update('modelLimits', {}, vscode.ConfigurationTarget.Global);

    try {
      const { agent } = createModelTrackingAgent(createBlankAgentState, [
        {
          role: 'assistant',
          metadata: {
            tokens: {
              input: 20000,
              output: 5000,
              cacheRead: 1000,
              cacheWrite: 250,
              total: 25000,
            },
          },
        },
      ]);
      const controller = createStandaloneChatController({
        agent,
        llmProvider: {
          id: 'openaiCompatible',
          name: 'OpenAI Compatible',
          getModel: async () => ({}),
        } as any,
      });

      controller.currentModel = 'provider-metadata-model';
      controller.availableModels = [
        {
          id: 'provider-metadata-model',
          name: 'Provider Metadata Model',
          maxInputTokens: 100000,
          maxOutputTokens: 12000,
        } as any,
      ];

      assert.deepStrictEqual(controller.sessionApi.getContextForUI(), {
        totalTokens: 25000,
        inputTokens: 20000,
        outputTokens: 5000,
        cacheReadTokens: 1000,
        cacheWriteTokens: 250,
        contextLimitTokens: 100000,
        outputLimitTokens: 12000,
        percent: 25,
      });
    } finally {
      await config.update('modelLimits', previousModelLimits, vscode.ConfigurationTarget.Global);
    }
  });

  test('getContextForUI falls back to global maxOutputTokens when provider output metadata is absent', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousModelLimits = config.inspect<Record<string, unknown>>('modelLimits')?.globalValue;
    const previousMaxOutputTokens = config.inspect<number>('maxOutputTokens')?.globalValue;
    await config.update('modelLimits', {}, vscode.ConfigurationTarget.Global);
    await config.update('maxOutputTokens', 45678, vscode.ConfigurationTarget.Global);

    try {
      const { agent } = createModelTrackingAgent(createBlankAgentState, [
        {
          role: 'assistant',
          metadata: {
            tokens: {
              total: 25000,
            },
          },
        },
      ]);
      const controller = createStandaloneChatController({
        agent,
        llmProvider: {
          id: 'copilot',
          name: 'Copilot',
          getModel: async () => ({}),
        } as any,
      });

      controller.currentModel = 'provider-context-only-model';
      controller.availableModels = [
        {
          id: 'provider-context-only-model',
          name: 'Provider Context Only Model',
          maxInputTokens: 100000,
        } as any,
      ];

      assert.deepStrictEqual(controller.sessionApi.getContextForUI(), {
        totalTokens: 25000,
        inputTokens: undefined,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        contextLimitTokens: 100000,
        outputLimitTokens: 45678,
        percent: 25,
      });
    } finally {
      await config.update('modelLimits', previousModelLimits, vscode.ConfigurationTarget.Global);
      await config.update('maxOutputTokens', previousMaxOutputTokens, vscode.ConfigurationTarget.Global);
    }
  });

  test('getContextForUI prefers configured provider-scoped model limits over provider metadata', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousModelLimits = config.inspect<Record<string, unknown>>('modelLimits')?.globalValue;
    await config.update('modelLimits', {
      'openaiCompatible:provider-metadata-model': { context: 80000, output: 7000 },
      'provider-metadata-model': { context: 90000, output: 9000 },
    }, vscode.ConfigurationTarget.Global);

    try {
      const { agent } = createModelTrackingAgent(createBlankAgentState, [
        {
          role: 'assistant',
          metadata: {
            tokens: {
              total: 40000,
            },
          },
        },
      ]);
      const controller = createStandaloneChatController({
        agent,
        llmProvider: {
          id: 'openaiCompatible',
          name: 'OpenAI Compatible',
          getModel: async () => ({}),
        } as any,
      });

      controller.currentModel = 'provider-metadata-model';
      controller.availableModels = [
        {
          id: 'provider-metadata-model',
          name: 'Provider Metadata Model',
          maxInputTokens: 100000,
          maxOutputTokens: 12000,
        } as any,
      ];

      assert.deepStrictEqual(controller.sessionApi.getContextForUI(), {
        totalTokens: 40000,
        inputTokens: undefined,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        contextLimitTokens: 80000,
        outputLimitTokens: 7000,
        percent: 50,
      });
    } finally {
      await config.update('modelLimits', previousModelLimits, vscode.ConfigurationTarget.Global);
    }
  });
});
