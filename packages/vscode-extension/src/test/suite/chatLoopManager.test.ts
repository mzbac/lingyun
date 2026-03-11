import * as assert from 'assert';

import { ChatController, installChatControllerMethods } from '../../ui/chat';
import { createBlankSessionSignals } from '../../core/sessionSignals';
import type { ChatSessionInfo } from '../../ui/chat/types';
import { RunCoordinator } from '../../ui/chat/runner/runCoordinator';

suite('Chat loop manager', () => {
  function createProvider() {
    const provider = Object.create(ChatController.prototype) as ChatController;
    installChatControllerMethods(provider);
    let exportedState = provider.getBlankAgentState();
    let agentRunning = false;

    provider.mode = 'build';
    provider.currentModel = 'mock-model';
    provider.signals = createBlankSessionSignals();
    provider.activeSessionId = 'session-1';
    provider.isProcessing = false;
    provider.messages = [];
    provider.sessions = new Map([
      [
        provider.activeSessionId,
        {
          id: provider.activeSessionId,
          title: 'Test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          signals: provider.signals,
          messages: provider.messages,
          agentState: exportedState,
          currentModel: provider.currentModel,
          mode: provider.mode,
          stepCounter: 0,
          queuedInputs: [],
          loop: {
            enabled: false,
            intervalMinutes: 5,
            prompt: 'review your recent activity - has it been in alignment with our principles? ./AGENTS.md',
          },
          runtime: { wasRunning: false, updatedAt: Date.now() },
        },
      ],
    ]);
    provider.view = {} as any;
    provider.agent = {
      syncSession: ({ state }: { state?: ReturnType<ChatController['getBlankAgentState']> } = {}) => {
        exportedState = state ?? provider.getBlankAgentState();
      },
      exportState: () => exportedState,
      getHistory: () => exportedState.history,
      get running() {
        return agentRunning;
      },
      clear: async () => {
        exportedState = provider.getBlankAgentState();
      },
    } as any;
    provider.runner = {
      handleUserMessage: async () => {},
      triggerLoopPrompt: async () => true,
      canAcceptLoopSteer: () => provider.isProcessing && agentRunning && !!provider.currentTurnId,
    } as any;
    provider.toolDiffBeforeByToolCallId = new Map();
    provider.toolDiffSnapshotsByToolCallId = new Map();
    provider.dirtySessionIds = new Set();
    provider.pendingApprovals = new Map();
    provider.autoApprovedTools = new Set();
    provider.sessionsLoadedFromDisk = true;
    provider.inputHistoryLoadedFromDisk = true;
    provider.scheduleSessionSave = () => {};
    provider.sendInit = async () => {};

    const posted: any[] = [];
    let persisted = 0;
    provider.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.persistActiveSession = () => {
      persisted++;
    };

    const setHistoryLength = (length: number) => {
      exportedState = provider.getBlankAgentState();
      exportedState.history = Array.from({ length }, (_, index) => ({
        role: 'assistant',
        content: `message-${index}`,
      })) as any;
      const session = provider.getActiveSession();
      session.agentState = exportedState;
    };

    return {
      provider,
      posted,
      getPersisted: () => persisted,
      setHistoryLength,
      setAgentRunning: (running: boolean) => {
        agentRunning = running;
      },
    };
  }

  function createSession(
    provider: ChatController,
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
      agentState: provider.getBlankAgentState(),
      currentModel: provider.currentModel,
      mode: provider.mode,
      stepCounter: 0,
      queuedInputs: [],
      loop: {
        enabled: false,
        intervalMinutes: 5,
        prompt: 'review your recent activity - has it been in alignment with our principles? ./AGENTS.md',
      },
      runtime: { wasRunning: false, updatedAt: Date.now() },
      ...overrides,
    };
  }

  test('getLoopStateForUI marks subagent sessions unavailable', () => {
    const { provider } = createProvider();
    const subagentSession = createSession(provider, 'session-2', {
      parentSessionId: provider.activeSessionId,
      subagentType: 'general',
    });

    const state = provider.getLoopStateForUI(subagentSession);

    assert.strictEqual(state.available, false);
    assert.strictEqual(state.enabled, false);
    assert.strictEqual(state.canRunNow, false);
    assert.strictEqual(state.reason, 'unavailable');
  });

  test('loop manager fires prompt into active build run', async () => {
    const { provider, posted, getPersisted, setAgentRunning } = createProvider();
    const session = provider.getActiveSession();
    session.loop = {
      enabled: true,
      intervalMinutes: 1,
      prompt: 'review activity now',
      nextFireAt: Date.now(),
    };
    provider.isProcessing = true;
    provider.currentTurnId = 'turn-1';
    setAgentRunning(true);

    let injectedPrompt = '';
    provider.injectLoopPrompt = async (prompt?: string) => {
      injectedPrompt = String(prompt || '');
      return true;
    };

    try {
      await (provider.loopManager as any).fireSessionLoop(session.id);
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }

    assert.strictEqual(injectedPrompt, 'review activity now');
    assert.ok(typeof session.loop?.lastFiredAt === 'number');
    assert.ok(typeof session.loop?.nextFireAt === 'number' && session.loop.nextFireAt > Date.now());
    assert.ok(posted.some(message => message && (message as any).type === 'loopState'));
    assert.ok(getPersisted() >= 1);
  });

  test('loop manager fires prompt while session is idle', async () => {
    const { provider, posted, setHistoryLength } = createProvider();
    const session = provider.getActiveSession();
    session.loop = {
      enabled: true,
      intervalMinutes: 1,
      prompt: 'review activity now',
      nextFireAt: Date.now(),
    };
    provider.isProcessing = false;
    setHistoryLength(1);

    let injected = false;
    provider.injectLoopPrompt = async () => {
      injected = true;
      return true;
    };

    try {
      await (provider.loopManager as any).fireSessionLoop(session.id);
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }

    assert.strictEqual(injected, true);
    assert.ok(typeof session.loop?.lastFiredAt === 'number');
    assert.ok(typeof session.loop?.nextFireAt === 'number' && session.loop.nextFireAt > Date.now());
    assert.ok(posted.some(message => message && (message as any).type === 'loopState'));
  });

  test('enabling loop while idle arms the active session schedule', () => {
    const { provider, setHistoryLength } = createProvider();
    const session = provider.getActiveSession();
    setHistoryLength(1);

    try {
      const next = provider.loopManager.updateSessionState(session.id, current => ({
        ...current,
        enabled: true,
        intervalMinutes: 1,
      }));

      assert.strictEqual(next?.enabled, true);
      assert.ok(typeof session.loop?.nextFireAt === 'number' && session.loop.nextFireAt > Date.now());
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }
  });

  test('stale rendered messages do not keep the loop armed after agent history is cleared', () => {
    const { provider, setHistoryLength } = createProvider();
    const session = provider.getActiveSession();
    session.messages.push({
      id: 'user-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    });
    setHistoryLength(1);

    try {
      provider.loopManager.updateSessionState(session.id, current => ({
        ...current,
        enabled: true,
        intervalMinutes: 1,
      }));
      assert.ok(typeof session.loop?.nextFireAt === 'number');

      setHistoryLength(0);
      provider.loopManager.syncActiveSession();

      assert.strictEqual(session.loop?.nextFireAt, undefined);
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }
  });

  test('disabling session persistence does not clear an armed loop timer', async () => {
    const { provider, setHistoryLength } = createProvider();
    const session = provider.getActiveSession();
    setHistoryLength(1);
    provider.sessionSaveTimer = setTimeout(() => {}, 60_000);
    provider.isSessionPersistenceEnabled = () => false;

    try {
      provider.loopManager.updateSessionState(session.id, current => ({
        ...current,
        enabled: true,
        intervalMinutes: 1,
      }));

      assert.ok(typeof session.loop?.nextFireAt === 'number');
      assert.strictEqual((provider.loopManager as any).timers.size, 1);

      await provider.onSessionPersistenceConfigChanged();

      assert.ok(typeof session.loop?.nextFireAt === 'number');
      assert.strictEqual((provider.loopManager as any).timers.size, 1);
    } finally {
      provider.loopManager.clearAllRuntimeData();
      if (provider.sessionSaveTimer) {
        clearTimeout(provider.sessionSaveTimer);
        provider.sessionSaveTimer = undefined;
      }
    }
  });

  test('loop status pauses in plan mode instead of arming a timer', () => {
    const { provider, setHistoryLength } = createProvider();
    const session = provider.getActiveSession();
    provider.mode = 'plan';
    setHistoryLength(1);

    try {
      provider.loopManager.updateSessionState(session.id, current => ({
        ...current,
        enabled: true,
        intervalMinutes: 1,
      }));

      const state = provider.getLoopStateForUI(session);
      assert.strictEqual(state.enabled, true);
      assert.strictEqual(state.canRunNow, false);
      assert.strictEqual(state.reason, 'plan_mode');
      assert.strictEqual(session.loop?.nextFireAt, undefined);
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }
  });

  test('loop status pauses while a pending plan exists', () => {
    const { provider, setHistoryLength } = createProvider();
    const session = provider.getActiveSession();
    setHistoryLength(1);
    session.pendingPlan = { task: 'Test task', planMessageId: 'plan-1' };

    try {
      provider.loopManager.updateSessionState(session.id, current => ({
        ...current,
        enabled: true,
        intervalMinutes: 1,
      }));

      const state = provider.getLoopStateForUI(session);
      assert.strictEqual(state.enabled, true);
      assert.strictEqual(state.canRunNow, false);
      assert.strictEqual(state.reason, 'pending_plan');
      assert.strictEqual(session.loop?.nextFireAt, undefined);
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }
  });

  test('loop state reads do not replace the stored session loop object', () => {
    const { provider } = createProvider();
    const session = provider.getActiveSession();
    const original = session.loop;

    provider.loopManager.getSessionStatus(session);
    provider.getLoopStateForUI(session);

    assert.strictEqual(session.loop, original);
  });

  test('loop status pauses during non-steerable processing without dropping the schedule', () => {
    const { provider, setHistoryLength, setAgentRunning } = createProvider();
    const session = provider.getActiveSession();
    setHistoryLength(1);
    provider.isProcessing = true;
    provider.currentTurnId = 'stale-turn';
    setAgentRunning(false);

    try {
      provider.loopManager.updateSessionState(session.id, current => ({
        ...current,
        enabled: true,
        intervalMinutes: 1,
      }));

      const state = provider.getLoopStateForUI(session);
      assert.strictEqual(state.enabled, true);
      assert.strictEqual(state.canRunNow, false);
      assert.strictEqual(state.reason, 'busy');
      assert.ok(typeof session.loop?.nextFireAt === 'number');
      assert.strictEqual((provider.loopManager as any).timers.size, 0);
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }
  });

  test('stored loop state drops runtime nextFireAt on save and load', () => {
    const { provider } = createProvider();
    const session = provider.getActiveSession();
    session.loop = {
      enabled: true,
      intervalMinutes: 5,
      prompt: 'review activity now',
      lastFiredAt: Date.now() - 1_000,
      nextFireAt: Date.now() + 60_000,
    };

    const stored = provider.pruneSessionForStorage(session, 200_000);
    assert.strictEqual(stored.loop?.nextFireAt, undefined);
    assert.ok(typeof stored.loop?.lastFiredAt === 'number');

    const loaded = provider.normalizeLoadedSession({
      ...session,
      loop: {
        ...session.loop,
        nextFireAt: Date.now() + 120_000,
      },
    });
    assert.strictEqual(loaded.loop?.nextFireAt, undefined);
  });

  test('loop prompt dispatch refuses non-steerable processing runs', async () => {
    const { provider, setHistoryLength, setAgentRunning } = createProvider();
    setHistoryLength(1);
    provider.isProcessing = true;
    provider.currentTurnId = 'stale-turn';
    setAgentRunning(false);
    provider.runner = new RunCoordinator(provider);

    const triggered = await provider.runner.triggerLoopPrompt('review activity now');

    assert.strictEqual(triggered, false);
    assert.strictEqual(provider.messages.length, 0);
  });

  test('loop steer into an active run keeps the original prompt text', async () => {
    const { provider, setAgentRunning } = createProvider();
    provider.runner = new RunCoordinator(provider);
    provider.isProcessing = true;
    provider.currentTurnId = 'turn-1';
    (provider.runner as any).loopSteerableDuringProcessing = true;
    setAgentRunning(true);

    let steeredInput: unknown;
    (provider.agent as any).steer = (input: unknown) => {
      steeredInput = input;
    };

    const triggered = await provider.runner.triggerLoopPrompt('review activity now');

    assert.strictEqual(triggered, true);
    assert.ok(Array.isArray(steeredInput));
    const lastUserMessage = [...provider.messages].reverse().find(message => message.role === 'user');
    assert.strictEqual(lastUserMessage?.content, 'review activity now');
  });

  test('idle loop turns keep the original prompt text', async () => {
    const { provider, setHistoryLength } = createProvider();
    setHistoryLength(1);
    provider.runner = new RunCoordinator(provider);
    (provider.agent as any).continue = async () => {};

    const triggered = await provider.runner.triggerLoopPrompt('review activity now');

    assert.strictEqual(triggered, true);
    const lastUserMessage = [...provider.messages].reverse().find(message => message.role === 'user');
    assert.strictEqual(lastUserMessage?.content, 'review activity now');
  });

  test('busy loop ticks preserve the pending schedule until the session becomes runnable again', async () => {
    const { provider, setHistoryLength, setAgentRunning } = createProvider();
    const session = provider.getActiveSession();
    setHistoryLength(1);
    session.loop = {
      enabled: true,
      intervalMinutes: 1,
      prompt: 'review activity now',
      nextFireAt: Date.now(),
    };
    provider.isProcessing = true;
    provider.currentTurnId = 'stale-turn';
    setAgentRunning(false);

    try {
      await (provider.loopManager as any).fireSessionLoop(session.id);

      assert.ok(typeof session.loop?.nextFireAt === 'number');
      assert.strictEqual((provider.loopManager as any).timers.size, 0);

      provider.isProcessing = false;
      provider.loopManager.syncActiveSession();

      assert.strictEqual((provider.loopManager as any).timers.size, 1);
      assert.ok(typeof session.loop?.nextFireAt === 'number');
    } finally {
      provider.loopManager.clearAllRuntimeData();
    }
  });

  test('compaction pauses and rearms the active loop schedule', async () => {
    const { provider, setHistoryLength } = createProvider();
    const session = provider.getActiveSession();
    setHistoryLength(1);
    provider.loopManager.updateSessionState(session.id, current => ({
      ...current,
      enabled: true,
      intervalMinutes: 1,
    }));

    const scheduledBefore = session.loop?.nextFireAt;
    assert.ok(typeof scheduledBefore === 'number');
    assert.strictEqual((provider.loopManager as any).timers.size, 1);

    let resolveCompaction: (() => void) | undefined;
    (provider.agent as any).compactSession = () =>
      new Promise<void>(resolve => {
        resolveCompaction = resolve;
      });

    let compactionPromise: Promise<void> | undefined;
    try {
      compactionPromise = provider.compactCurrentSession();
      await new Promise(resolve => setTimeout(resolve, 0));

      assert.strictEqual(provider.isProcessing, true);
      assert.strictEqual((provider.loopManager as any).timers.size, 0);
      assert.strictEqual(session.loop?.nextFireAt, scheduledBefore);

      resolveCompaction?.();
      await compactionPromise;

      assert.strictEqual(provider.isProcessing, false);
      assert.strictEqual((provider.loopManager as any).timers.size, 1);
      assert.ok(typeof session.loop?.nextFireAt === 'number');
    } finally {
      resolveCompaction?.();
      await compactionPromise;
      provider.loopManager.clearAllRuntimeData();
    }
  });
});
