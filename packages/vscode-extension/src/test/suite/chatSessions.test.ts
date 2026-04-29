import * as assert from 'assert';
import * as vscode from 'vscode';

import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { createBlankSessionSignals } from '../../core/sessionSignals';
import { createDefaultSessionTitle } from '../../ui/chat/sessionTitle';
import type { ChatSessionInfo } from '../../ui/chat/types';
import {
  createStandaloneChatController,
  createWritableChatTestExtensionContext,
} from './chatControllerHarness';

function createTrackingAgent(blankState: () => AgentSessionState) {
  const syncCalls: any[] = [];
  let exportedState = blankState();

  const agent = {
    syncSession(params?: { state?: AgentSessionState; execution?: unknown; session?: unknown }) {
      syncCalls.push(params);
      exportedState = params?.state ?? blankState();
    },
    exportState() {
      return exportedState;
    },
    getHistory() {
      return exportedState.history;
    },
    clear: async () => {
      exportedState = blankState();
    },
  } as unknown as AgentLoop;

  return { agent, syncCalls };
}

function createSession(
  controller: ReturnType<typeof createStandaloneChatController>,
  sessionId: string,
  overrides?: Partial<ChatSessionInfo>
): ChatSessionInfo {
  const signals = createBlankSessionSignals();
  return {
    id: sessionId,
    title: sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    signals,
    messages: [],
    agentState: controller.sessionApi.getBlankAgentState(),
    currentModel: controller.currentModel,
    mode: controller.mode,
    stepCounter: 0,
    queuedInputs: [],
    runtime: { wasRunning: false, updatedAt: Date.now() },
    ...overrides,
  };
}

suite('Chat sessions facade', () => {
  test('session list falls back to first user message preview while title is still default', () => {
    const controller = createStandaloneChatController();
    const defaultTitle = createDefaultSessionTitle(new Date(0));
    controller.sessions = new Map([
      [
        'session-1',
        createSession(controller, 'session-1', {
          title: defaultTitle,
          firstUserMessagePreview: 'Investigate session title race',
        }),
      ],
    ]);

    assert.deepStrictEqual(controller.sessionApi.getSessionsForUI(), [
      { id: 'session-1', title: 'Investigate session title race' },
    ]);
  });

  test('loaded sessions derive first user message preview when missing', () => {
    const controller = createStandaloneChatController();
    const defaultTitle = createDefaultSessionTitle(new Date(0));
    const loaded = controller.sessionApi.normalizeLoadedSession(
      createSession(controller, 'session-1', {
        title: defaultTitle,
        firstUserMessagePreview: undefined,
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Hello',
            timestamp: Date.now(),
          },
          {
            id: 'user-1',
            role: 'user',
            content: '  Fix the session title fallback\nwhen switching away and back.  ',
            timestamp: Date.now(),
          },
        ],
      })
    );

    assert.strictEqual(
      loaded.firstUserMessagePreview,
      'Fix the session title fallback when switching away and back.'
    );
  });

  test('setBackend resets state and recreates the active session from current config', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousModel = config.get('model');
    const previousMode = config.get('mode');

    await config.update('model', 'config-model', vscode.ConfigurationTarget.Global);
    await config.update('mode', 'plan', vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      const { agent, syncCalls } = createTrackingAgent(() => controller.sessionApi.getBlankAgentState());
      const posted: unknown[] = [];
      const sendInitCalls: boolean[] = [];
      let loopCleared = 0;

      controller.view = {} as vscode.WebviewView;
      controller.sessions = new Map();
      controller.activeSessionId = 'missing-session';
      controller.currentModel = 'stale-model';
      controller.mode = 'build';
      controller.stepCounter = 9;
      controller.activeStepId = 'step-9';
      controller.abortRequested = true;
      controller.isProcessing = true;
      controller.availableModels = [{ id: 'stale-model' } as any];
      controller.pendingApprovals.set('approval-1', {
        resolve() {},
        toolName: 'write',
      });
      controller.initAcked = true;
      controller.sessionsLoadedFromDisk = true;
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };
      controller.webviewApi.sendInit = async (force?: boolean) => {
        sendInitCalls.push(!!force);
      };
      controller.loopManager.clearAllRuntimeData = () => {
        loopCleared++;
      };

      const nextProvider = { id: 'next-provider' } as any;
      await controller.sessionApi.setBackend(agent, nextProvider);

      const activeSession = controller.sessionApi.getActiveSession();
      assert.strictEqual(controller.agent, agent);
      assert.strictEqual(controller.llmProvider, nextProvider);
      assert.strictEqual(controller.isProcessing, false);
      assert.strictEqual(controller.currentModel, 'config-model');
      assert.strictEqual(controller.mode, 'plan');
      assert.strictEqual(controller.stepCounter, 0);
      assert.strictEqual(controller.activeStepId, undefined);
      assert.strictEqual(controller.abortRequested, false);
      assert.strictEqual(controller.pendingApprovals.size, 0);
      assert.strictEqual(controller.initAcked, false);
      assert.strictEqual(loopCleared, 1);
      assert.deepStrictEqual(controller.availableModels, []);
      assert.strictEqual(controller.sessions.size, 1);
      assert.strictEqual(activeSession.currentModel, 'config-model');
      assert.strictEqual(activeSession.mode, 'plan');
      assert.strictEqual(syncCalls.length, 1);
      assert.deepStrictEqual(syncCalls[0]?.execution, {
        model: 'config-model',
        mode: 'plan',
      });
      assert.deepStrictEqual(syncCalls[0]?.session, {
        sessionId: controller.activeSessionId,
        parentSessionId: undefined,
        subagentType: undefined,
      });
      assert.ok(posted.some(message => (message as any)?.type === 'cleared'));
      assert.ok(posted.some(message => (message as any)?.type === 'processing' && (message as any)?.value === false));
      assert.ok(posted.some(message => (message as any)?.type === 'planPending' && (message as any)?.value === false));
      assert.deepStrictEqual(sendInitCalls, [true]);
    } finally {
      await config.update('model', previousModel, vscode.ConfigurationTarget.Global);
      await config.update('mode', previousMode, vscode.ConfigurationTarget.Global);
    }
  });

  test('onSessionPersistenceConfigChanged clears persistence state when disabled', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousPersist = config.get('sessions.persist');
    await config.update('sessions.persist', false, vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      controller.sessionStore = { stale: true } as any;
      controller.sessionsLoadedFromDisk = true;
      controller.sessionsLoadPromise = Promise.resolve();
      controller.dirtySessionIds.add('session-1');
      controller.inputHistoryStore = { stale: true } as any;
      controller.inputHistoryLoadedFromDisk = true;
      controller.sessionSaveTimer = setTimeout(() => {}, 60_000);

      await controller.sessionApi.onSessionPersistenceConfigChanged();

      assert.strictEqual(controller.sessionStore, undefined);
      assert.strictEqual(controller.sessionsLoadedFromDisk, false);
      assert.strictEqual(controller.sessionsLoadPromise, undefined);
      assert.deepStrictEqual([...controller.dirtySessionIds], []);
      assert.strictEqual(controller.inputHistoryStore, undefined);
      assert.strictEqual(controller.inputHistoryLoadedFromDisk, false);
      assert.strictEqual(controller.sessionSaveTimer, undefined);
    } finally {
      if (previousPersist === undefined) {
        await config.update('sessions.persist', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('sessions.persist', previousPersist, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('onSessionPersistenceConfigChanged reopens the store and refreshes the active view when enabled', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for chat session tests');

    const config = vscode.workspace.getConfiguration('lingyun');
    const previousPersist = config.get('sessions.persist');
    await config.update('sessions.persist', true, vscode.ConfigurationTarget.Global);

    const storageRoot = vscode.Uri.joinPath(root!, '.lingyun-test-storage', 'chat-sessions-enable');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      const controller = createStandaloneChatController({
        context: createWritableChatTestExtensionContext(storageRoot),
      });
      const previousStore = { stale: true } as any;
      const sendInitCalls: boolean[] = [];

      controller.view = {} as vscode.WebviewView;
      controller.sessionsLoadedFromDisk = true;
      controller.inputHistoryLoadedFromDisk = true;
      controller.sessionStore = previousStore;
      controller.webviewApi.sendInit = async (force?: boolean) => {
        sendInitCalls.push(!!force);
      };
      controller.sessions.set('session-2', createSession(controller, 'session-2'));

      await controller.sessionApi.onSessionPersistenceConfigChanged();

      assert.notStrictEqual(controller.sessionStore, previousStore);
      assert.ok(controller.sessionStore, 'expected persistence config refresh to recreate the session store');
      assert.deepStrictEqual([...controller.dirtySessionIds].sort(), [...controller.sessions.keys()].sort());
      assert.ok(controller.sessionSaveTimer, 'expected persistence refresh to schedule a save');
      assert.deepStrictEqual(sendInitCalls, [true]);
    } finally {
      if (previousPersist === undefined) {
        await config.update('sessions.persist', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('sessions.persist', previousPersist, vscode.ConfigurationTarget.Global);
      }
      await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
    }
  });

  test('clearSavedSessions resets runtime state and rebuilds a fresh active session', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for chat session tests');

    const config = vscode.workspace.getConfiguration('lingyun');
    const previousPersist = config.get('sessions.persist');
    await config.update('sessions.persist', true, vscode.ConfigurationTarget.Global);

    const storageRoot = vscode.Uri.joinPath(root!, '.lingyun-test-storage', 'chat-sessions-clear');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      const controller = createStandaloneChatController({
        context: createWritableChatTestExtensionContext(storageRoot),
      });
      const posted: unknown[] = [];
      const sendInitCalls: boolean[] = [];
      let loopCleared = 0;
      let queueCleared = 0;
      let storeCleared = 0;

      const previousActiveSessionId = controller.activeSessionId;
      controller.view = {} as vscode.WebviewView;
      controller.sessions.set('session-2', createSession(controller, 'session-2'));
      controller.inputHistoryEntries = ['older input'];
      controller.inputHistoryStore = { stale: true } as any;
      controller.inputHistoryLoadedFromDisk = false;
      controller.sessionsLoadedFromDisk = false;
      controller.sessionsLoadPromise = Promise.resolve();
      controller.dirtySessionIds = new Set(['session-1', 'session-2']);
      controller.sessionStore = {
        clear: async () => {
          storeCleared++;
        },
      } as any;
      controller.webviewApi.postMessage = (message: unknown) => {
        posted.push(message);
      };
      controller.webviewApi.sendInit = async (force?: boolean) => {
        sendInitCalls.push(!!force);
      };
      controller.loopManager.clearAllRuntimeData = () => {
        loopCleared++;
      };
      controller.queueManager.clearAllRuntimeData = () => {
        queueCleared++;
      };

      await controller.sessionApi.clearSavedSessions();

      const activeSession = controller.sessionApi.getActiveSession();
      assert.strictEqual(storeCleared, 1);
      assert.strictEqual(controller.sessionStore, undefined);
      assert.strictEqual(controller.sessionsLoadedFromDisk, true);
      assert.strictEqual(controller.sessionsLoadPromise, undefined);
      assert.deepStrictEqual(controller.inputHistoryEntries, []);
      assert.strictEqual(controller.inputHistoryStore, undefined);
      assert.strictEqual(controller.inputHistoryLoadedFromDisk, true);
      assert.strictEqual(loopCleared, 1);
      assert.strictEqual(queueCleared, 1);
      assert.notStrictEqual(controller.activeSessionId, previousActiveSessionId);
      assert.strictEqual(controller.sessions.size, 1);
      assert.strictEqual(activeSession.id, controller.activeSessionId);
      assert.deepStrictEqual(activeSession.messages, []);
      assert.deepStrictEqual(activeSession.agentState.pendingInputs, []);
      assert.deepStrictEqual([...controller.dirtySessionIds], [controller.activeSessionId]);
      assert.ok(posted.some(message => (message as any)?.type === 'cleared'));
      assert.deepStrictEqual(sendInitCalls, [true]);
    } finally {
      if (previousPersist === undefined) {
        await config.update('sessions.persist', undefined, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('sessions.persist', previousPersist, vscode.ConfigurationTarget.Global);
      }
      await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
    }
  });
});
