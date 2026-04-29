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
      assert.deepStrictEqual(posted, [
        {
          type: 'modelChanged',
          model: 'gpt-5.4',
          label: 'GPT-5.4',
          isFavorite: false,
          reasoningEffort: 'medium',
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
