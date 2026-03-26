import * as assert from 'assert';
import * as vscode from 'vscode';

import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { createStandaloneChatController } from './chatControllerHarness';

function createModelTrackingAgent(blankState: () => AgentSessionState) {
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
      return [];
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
      const { agent, configUpdates } = createModelTrackingAgent(() => ({
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
      }));
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
});
