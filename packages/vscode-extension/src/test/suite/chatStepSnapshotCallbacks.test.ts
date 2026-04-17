import * as assert from 'assert';
import * as vscode from 'vscode';

import { createStandaloneChatController } from './chatControllerHarness';

suite('Chat step snapshot callbacks', () => {
  test('build iteration records snapshot baseHash and patch files on step message', async () => {
    const controller = createStandaloneChatController({
      agent: {
        syncSession() {},
        exportState() {
          return {
            history: [],
            fileHandles: { nextId: 1, byId: {} },
            semanticHandles: { nextMatchId: 1, nextSymbolId: 1, nextLocId: 1, matches: {}, symbols: {}, locations: {} },
            pendingInputs: [],
          } as any;
        },
        getHistory() {
          return [];
        },
      } as any,
    });

    controller.view = {} as vscode.WebviewView;
    controller.currentTurnId = 'turn-1';
    controller.mode = 'build';
    controller.currentModel = 'mock-model';
    controller.stepCounter = 0;
    controller.webviewApi.postMessage = () => {};
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    controller.sessionApi.getContextForUI = () => ({}) as any;
    controller.revertApi.getWorkspaceSnapshot = async () => ({
      async track() {
        return 'base-hash-1';
      },
      async patch(baseHash: string) {
        assert.strictEqual(baseHash, 'base-hash-1');
        return { baseHash, files: ['src/file.ts'] };
      },
    } as any);

    const callbacks = controller.runnerCallbacksApi.createAgentCallbacks();
    await callbacks.onIterationStart?.(1);
    await callbacks.onIterationEnd?.(1);

    const stepMsg = controller.messages.find(message => message.role === 'step');
    assert.ok(stepMsg?.step, 'expected step message');
    assert.strictEqual(stepMsg?.step?.snapshot?.baseHash, 'base-hash-1');
    assert.deepStrictEqual(stepMsg?.step?.patch?.files, ['src/file.ts']);
  });
});
