import * as assert from 'assert';

import { ChatController } from '../../ui/chat';
import { createBlankSessionSignals } from '../../core/sessionSignals';
import type { ChatSessionInfo } from '../../ui/chat/types';
import { createStandaloneChatController } from './chatControllerHarness';

suite('Chat queue manager', () => {
  function createProvider() {
    const provider = createStandaloneChatController();

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
          agentState: provider.sessionApi.getBlankAgentState(),
          currentModel: provider.currentModel,
          mode: provider.mode,
          stepCounter: 0,
          queuedInputs: [],
          runtime: { wasRunning: false, updatedAt: Date.now() },
        },
      ],
    ]);
    provider.view = {} as any;
    provider.agent = {
      syncSession: () => {},
      exportState: () => provider.sessionApi.getBlankAgentState(),
    } as any;
    provider.runner = {
      handleUserMessage: async () => {},
    } as any;
    provider.toolDiffBeforeByToolCallId = new Map();
    provider.toolDiffSnapshotsByToolCallId = new Map();

    const posted: any[] = [];
    let persisted = 0;
    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.sessionApi.persistActiveSession = () => {
      persisted++;
    };

    return { provider, posted, getPersisted: () => persisted };
  }

  function createSession(provider: ChatController, sessionId: string): ChatSessionInfo {
    const signals = createBlankSessionSignals();
    return {
      id: sessionId,
      title: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      signals,
      messages: [],
      agentState: provider.sessionApi.getBlankAgentState(),
      currentModel: provider.currentModel,
      mode: provider.mode,
      stepCounter: 0,
      queuedInputs: [],
      runtime: { wasRunning: false, updatedAt: Date.now() },
    };
  }

  test('clearCurrentSession clears queued inputs and attachment blobs', async () => {
    const { provider, posted, getPersisted } = createProvider();

    provider.queueManager.enqueueActiveInput({
      message: 'with image',
      displayContent: 'with image',
      attachmentCount: 1,
      attachments: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,abc', filename: 'a.png' }],
    });

    posted.length = 0;
    await provider.sessionApi.clearCurrentSession();

    const session = provider.sessionApi.getActiveSession();
    assert.deepStrictEqual(session.queuedInputs, []);
    assert.strictEqual(provider.queueManager.getRuntimeAttachmentCount(), 0);
    assert.ok(posted.some((message) => message && (message as any).type === 'queueState' && Array.isArray((message as any).queuedInputs) && (message as any).queuedInputs.length === 0));
    assert.ok(posted.some((message) => message && (message as any).type === 'cleared'));
    assert.ok(getPersisted() >= 1);
  });

  test('takeNextRunnableFromActiveSession drops broken image-only items and continues FIFO', () => {
    const { provider, posted } = createProvider();
    const session = provider.sessionApi.getActiveSession();

    session.queuedInputs = [
      {
        id: 'broken',
        createdAt: Date.now(),
        message: '',
        displayContent: '[Image attached]',
        attachmentCount: 1,
      },
      {
        id: 'next',
        createdAt: Date.now() + 1,
        message: 'run me',
        displayContent: 'run me',
        attachmentCount: 0,
      },
    ];

    const next = provider.queueManager.takeNextRunnableFromActiveSession();

    assert.ok(next);
    assert.strictEqual(next?.message, 'run me');
    assert.deepStrictEqual(session.queuedInputs, []);
    assert.ok(provider.messages.some((message) => message.role === 'warning' && message.content.includes('Removed a queued message because its image attachments are no longer available')));
    assert.ok(posted.some((message) => message && (message as any).type === 'queueState'));
  });

  test('session-scoped autosend waits for the originating session to become active again', async () => {
    const { provider } = createProvider();
    const session1 = provider.sessionApi.getActiveSession();
    const session2 = createSession(provider, 'session-2');
    provider.sessions.set(session2.id, session2);

    session1.queuedInputs = [
      { id: 'a1', createdAt: Date.now(), message: 'run A', displayContent: 'run A', attachmentCount: 0 },
    ];
    session2.queuedInputs = [
      { id: 'b1', createdAt: Date.now(), message: 'run B', displayContent: 'run B', attachmentCount: 0 },
    ];

    const handled: Array<{ sessionId: string; input: any }> = [];
    provider.runner = {
      handleUserMessage: async (input: any) => {
        handled.push({ sessionId: provider.activeSessionId, input });
      },
    } as any;

    provider.queueManager.scheduleAutosendForSession(session1.id);
    provider.sessionApi.switchToSessionSync(session2.id);

    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.strictEqual(handled.length, 0);
    assert.strictEqual(session1.queuedInputs?.length, 1);
    assert.strictEqual(session2.queuedInputs?.length, 1);

    provider.sessionApi.switchToSessionSync(session1.id);
    await provider.queueManager.flushAutosendForActiveSession();

    assert.strictEqual(handled.length, 1);
    const handledEntry = handled[0];
    assert.ok(handledEntry);
    assert.strictEqual(handledEntry.sessionId, session1.id);
    assert.strictEqual(handledEntry.input?.message, 'run A');
    assert.deepStrictEqual(session1.queuedInputs, []);
    assert.strictEqual(session2.queuedInputs?.length, 1);
  });

  test('normalizeLoadedAgentState keeps persisted pending steers', () => {
    const { provider } = createProvider();

    const state = provider.sessionApi.normalizeLoadedAgentState({
      history: [],
      pendingInputs: [
        'queued follow-up',
        [{ type: 'text', text: 'with parts' }],
        [{ type: 'bad', text: 'ignored' }],
      ],
    } as any);

    assert.deepStrictEqual(state.pendingInputs, [
      'queued follow-up',
      [{ type: 'text', text: 'with parts' }],
    ]);
  });

  test('normalizeLoadedAgentState uses shared mentioned skill normalization', () => {
    const { provider } = createProvider();

    const state = provider.sessionApi.normalizeLoadedAgentState({
      history: [],
      mentionedSkills: ['memory.skill', 42, null, '', '  follow-up.skill  ', 'memory.skill', '   '],
    } as any);

    assert.deepStrictEqual(state.mentionedSkills, ['memory.skill', 'follow-up.skill']);
  });

  test('normalizeLoadedAgentState uses shared file handle normalization', () => {
    const { provider } = createProvider();

    const state = provider.sessionApi.normalizeLoadedAgentState({
      history: [],
      fileHandles: {
        nextId: 2.9,
        byId: {
          F1: ' src/foo.ts ',
          bad: 'drop-me.ts',
          F2: '   ',
        },
      },
    } as any);

    assert.deepStrictEqual(state.fileHandles, {
      nextId: 2,
      byId: { F1: 'src/foo.ts' },
    });
  });

  test('normalizeLoadedAgentState uses shared semantic handle normalization', () => {
    const { provider } = createProvider();

    const state = provider.sessionApi.normalizeLoadedAgentState({
      history: [],
      semanticHandles: {
        nextMatchId: 2.9,
        nextSymbolId: 3,
        nextLocId: 0,
        matches: {
          M1: {
            fileId: ' F1 ',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 2.8, character: 4.2 },
            },
            preview: 'match preview',
          },
          bad: {
            fileId: 'F2',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 2 },
            },
            preview: 'drop me',
          },
        },
        symbols: {
          S1: {
            name: '  Symbol Name  ',
            kind: 'function',
            fileId: 'F1',
            range: {
              start: { line: 5, character: 0 },
              end: { line: 6, character: 3.6 },
            },
            containerName: '  Parent  ',
          },
          S2: {
            name: '   ',
            kind: 'function',
            fileId: 'F1',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 2 },
            },
          },
        },
        locations: {
          L1: {
            fileId: 'F1',
            range: {
              start: { line: 8, character: 0 },
              end: { line: 8, character: 0 },
            },
            label: '  Location label  ',
          },
          bad: {
            fileId: 'F1',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 2 },
            },
          },
        },
      },
    } as any);

    assert.deepStrictEqual(state.semanticHandles, {
      nextMatchId: 2,
      nextSymbolId: 3,
      nextLocId: 1,
      matches: {
        M1: {
          fileId: 'F1',
          range: {
            start: { line: 1, character: 1 },
            end: { line: 2, character: 4 },
          },
          preview: 'match preview',
        },
      },
      symbols: {
        S1: {
          name: '  Symbol Name  ',
          kind: 'function',
          fileId: 'F1',
          range: {
            start: { line: 5, character: 1 },
            end: { line: 6, character: 3 },
          },
          containerName: 'Parent',
        },
      },
      locations: {
        L1: {
          fileId: 'F1',
          range: {
            start: { line: 8, character: 1 },
            end: { line: 8, character: 1 },
          },
          label: 'Location label',
        },
      },
    });
  });
});
