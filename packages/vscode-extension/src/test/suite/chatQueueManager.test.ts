import * as assert from 'assert';
import * as vscode from 'vscode';

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

  function createWebviewMessageHarness(provider: ChatController) {
    let receiveMessage: ((message: unknown) => unknown) | undefined;
    const view = {
      visible: true,
      webview: {
        options: {},
        html: '',
        cspSource: 'test-csp',
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: () => Promise.resolve(true),
        onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
          receiveMessage = listener;
          return { dispose() {} };
        },
      },
      onDidChangeVisibility: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    } as unknown as vscode.WebviewView;

    provider.initInFlight = true;
    provider.webviewApi.resolveWebviewView(view);
    if (provider.initInterval) {
      clearInterval(provider.initInterval);
      provider.initInterval = undefined;
    }
    provider.initInFlight = false;

    assert.ok(receiveMessage, 'expected webview message listener to be registered');
    return receiveMessage;
  }

  test('clearCurrentSession clears queued inputs and attachment blobs', async () => {
    const { provider, posted, getPersisted } = createProvider();

    provider.queueManager.enqueueActiveInput({
      message: 'with image',
      displayContent: 'with image',
      attachmentCount: 1,
      attachments: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,abc', filename: 'a.png' }],
    });
    assert.strictEqual(
      provider.queueManager.getRuntimeAttachmentBytes(),
      'image/png'.length + 'data:image/png;base64,abc'.length + 'a.png'.length,
    );

    posted.length = 0;
    await provider.sessionApi.clearCurrentSession();

    const session = provider.sessionApi.getActiveSession();
    assert.deepStrictEqual(session.queuedInputs, []);
    assert.strictEqual(provider.queueManager.getRuntimeAttachmentCount(), 0);
    assert.ok(posted.some((message) => message && (message as any).type === 'queueState' && Array.isArray((message as any).queuedInputs) && (message as any).queuedInputs.length === 0));
    assert.ok(posted.some((message) => message && (message as any).type === 'cleared'));
    assert.ok(getPersisted() >= 1);
  });

  test('clearQueue webview action posts a single queue state update', async () => {
    const { provider, posted } = createProvider();
    provider.queueManager.enqueueActiveInput({
      message: 'queued',
      displayContent: 'queued',
      attachmentCount: 0,
      attachments: [],
    });
    const receiveMessage = createWebviewMessageHarness(provider);

    posted.length = 0;
    await receiveMessage({ type: 'clearQueue' });

    const queueStates = posted.filter((message) => message && (message as any).type === 'queueState');
    assert.strictEqual(queueStates.length, 1);
    assert.deepStrictEqual((queueStates[0] as any).queuedInputs, []);
    assert.deepStrictEqual(provider.sessionApi.getActiveSession().queuedInputs, []);
  });

  test('clearActiveSession skips already-empty queue state writes', () => {
    const { provider, posted, getPersisted } = createProvider();
    const session = provider.sessionApi.getActiveSession();
    session.queuedInputs = [];

    provider.queueManager.clearActiveSession();

    assert.deepStrictEqual(session.queuedInputs, []);
    assert.ok(!posted.some((message) => message && (message as any).type === 'queueState'));
    assert.strictEqual(getPersisted(), 0);
  });

  test('steerQueuedInput webview action posts one queue state update after removal', async () => {
    const { provider, posted } = createProvider();
    provider.queueManager.enqueueActiveInput({
      message: 'first',
      displayContent: 'first',
      attachmentCount: 0,
      attachments: [],
    });
    const target = provider.queueManager.enqueueActiveInput({
      message: 'target',
      displayContent: 'target',
      attachmentCount: 0,
      attachments: [],
    });
    provider.runner = {
      ...provider.runner,
      steerQueuedInput: async (id: string) => {
        return provider.queueManager.takeByIdFromActiveSession(id).queueChanged;
      },
    } as any;
    const receiveMessage = createWebviewMessageHarness(provider);

    posted.length = 0;
    await receiveMessage({ type: 'steerQueuedInput', id: target.id });

    let queueStates = posted.filter((message) => message && (message as any).type === 'queueState');
    assert.strictEqual(queueStates.length, 1);
    assert.deepStrictEqual(
      ((queueStates[0] as any).queuedInputs || []).map((item: any) => item.message),
      ['first'],
    );

    posted.length = 0;
    await receiveMessage({ type: 'steerQueuedInput', id: 'missing-queued-id' });

    queueStates = posted.filter((message) => message && (message as any).type === 'queueState');
    assert.strictEqual(queueStates.length, 1);
    assert.deepStrictEqual(
      ((queueStates[0] as any).queuedInputs || []).map((item: any) => item.message),
      ['first'],
    );
  });

  test('enqueueActiveInput prunes oldest image entries when attachment budget is exceeded', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousLimit = cfg.get('chat.queue.maxAttachmentBytes');

    try {
      await cfg.update('chat.queue.maxAttachmentBytes', 150, true);
      const { provider, getPersisted } = createProvider();

      provider.queueManager.enqueueActiveInput({
        message: 'first',
        displayContent: 'first',
        attachmentCount: 1,
        attachments: [{ mediaType: 'image/png', dataUrl: 'a'.repeat(46), filename: 'a.png' }],
      });
      provider.queueManager.enqueueActiveInput({
        message: 'plain',
        displayContent: 'plain',
        attachmentCount: 0,
        attachments: [],
      });
      provider.queueManager.enqueueActiveInput({
        message: 'second',
        displayContent: 'second',
        attachmentCount: 1,
        attachments: [{ mediaType: 'image/png', dataUrl: 'b'.repeat(46), filename: 'b.png' }],
      });
      provider.queueManager.enqueueActiveInput({
        message: 'third',
        displayContent: 'third',
        attachmentCount: 1,
        attachments: [{ mediaType: 'image/png', dataUrl: 'c'.repeat(86), filename: 'c.png' }],
      });

      const session = provider.sessionApi.getActiveSession();
      assert.deepStrictEqual(
        (session.queuedInputs || []).map(item => item.message),
        ['plain', 'third'],
      );
      assert.strictEqual(provider.queueManager.getRuntimeAttachmentCount(), 1);
      assert.ok(provider.queueManager.getRuntimeAttachmentBytes() <= 150);
      assert.ok(
        provider.messages.some(message =>
          message.role === 'warning' && message.content.includes('Removed 2 older queued image messages')
        ),
      );
      assert.strictEqual(getPersisted(), 4);
    } finally {
      await cfg.update('chat.queue.maxAttachmentBytes', previousLimit as any, true);
    }
  });

  test('enqueueActiveInput prunes oversized restored queue in one bounded prefix', () => {
    const { provider, posted } = createProvider();
    const session = provider.sessionApi.getActiveSession();
    session.queuedInputs = Array.from({ length: 75 }, (_unused, index) => ({
      id: `existing-${index}`,
      createdAt: Date.now() + index,
      message: `existing ${index}`,
      displayContent: `existing ${index}`,
      attachmentCount: 0,
    }));

    posted.length = 0;
    provider.queueManager.enqueueActiveInput({
      message: 'newest',
      displayContent: 'newest',
      attachmentCount: 0,
      attachments: [],
    });

    const queue = session.queuedInputs || [];
    assert.strictEqual(queue.length, 50);
    assert.strictEqual(queue[0]?.message, 'existing 26');
    assert.strictEqual(queue[48]?.message, 'existing 74');
    assert.strictEqual(queue[49]?.message, 'newest');

    const queueStates = posted.filter((message) => message && (message as any).type === 'queueState');
    assert.strictEqual(queueStates.length, 1);
    assert.strictEqual(((queueStates[0] as any).queuedInputs || []).length, 50);
  });

  test('takeByIdFromActiveSession removes a specific queued input with attachments', () => {
    const { provider, posted } = createProvider();
    const image = { mediaType: 'image/png', dataUrl: 'data:image/png;base64,target', filename: 'target.png' };

    provider.queueManager.enqueueActiveInput({
      message: 'first',
      displayContent: 'first',
      attachmentCount: 0,
      attachments: [],
    });
    const target = provider.queueManager.enqueueActiveInput({
      message: 'target',
      displayContent: 'target',
      attachmentCount: 1,
      attachments: [image],
    });

    posted.length = 0;
    const taken = provider.queueManager.takeByIdFromActiveSession(target.id);
    const session = provider.sessionApi.getActiveSession();

    assert.deepStrictEqual(taken, { input: { message: 'target', attachments: [image] }, queueChanged: true });
    assert.deepStrictEqual(
      (session.queuedInputs || []).map(item => item.message),
      ['first'],
    );
    assert.strictEqual(provider.queueManager.getRuntimeAttachmentCount(), 0);
    assert.ok(posted.some((message) => message && (message as any).type === 'queueState'));
  });

  test('takeNextRunnableFromActiveSession drops broken image-only items and continues FIFO', () => {
    const { provider, posted, getPersisted } = createProvider();
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
    assert.strictEqual(getPersisted(), 1);
  });

  test('takeNextRunnableFromActiveSession batches invalid prefix cleanup', () => {
    const { provider, posted, getPersisted } = createProvider();
    const session = provider.sessionApi.getActiveSession();

    session.queuedInputs = [
      {
        id: 'broken-a',
        createdAt: Date.now(),
        message: '',
        displayContent: '[Image attached]',
        attachmentCount: 1,
      },
      undefined as any,
      {
        id: 'broken-b',
        createdAt: Date.now() + 1,
        message: '',
        displayContent: '[Image attached]',
        attachmentCount: 1,
      },
      {
        id: 'next',
        createdAt: Date.now() + 2,
        message: 'run me',
        displayContent: 'run me',
        attachmentCount: 0,
      },
    ];

    const next = provider.queueManager.takeNextRunnableFromActiveSession();

    assert.ok(next);
    assert.strictEqual(next?.message, 'run me');
    assert.deepStrictEqual(session.queuedInputs, []);
    const queueStates = posted.filter((message) => message && (message as any).type === 'queueState');
    assert.strictEqual(queueStates.length, 1);
    assert.ok(provider.messages.some((message) => message.role === 'warning' && message.content.includes('Removed 2 queued messages because their image attachments are no longer available')));
    assert.strictEqual(getPersisted(), 1);
  });

  test('takeByIdFromActiveSession drops broken image-only item with one persist', () => {
    const { provider, posted, getPersisted } = createProvider();
    const session = provider.sessionApi.getActiveSession();
    session.queuedInputs = [
      {
        id: 'broken-target',
        createdAt: Date.now(),
        message: '',
        displayContent: '[Image attached]',
        attachmentCount: 1,
      },
      {
        id: 'next',
        createdAt: Date.now() + 1,
        message: 'next',
        displayContent: 'next',
        attachmentCount: 0,
      },
    ];

    const taken = provider.queueManager.takeByIdFromActiveSession('broken-target');

    assert.deepStrictEqual(taken, { input: undefined, queueChanged: true });
    assert.deepStrictEqual(
      (session.queuedInputs || []).map(item => item.message),
      ['next'],
    );
    assert.ok(provider.messages.some((message) => message.role === 'warning' && message.content.includes('Removed a queued message because its image attachments are no longer available')));
    assert.ok(posted.some((message) => message && (message as any).type === 'queueState'));
    assert.strictEqual(getPersisted(), 1);
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

  test('normalizeLoadedAgentState normalizes prompt snapshot and derives stats', () => {
    const { provider } = createProvider();

    const raw = {
      history: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        {
          id: 'm2',
          role: 'assistant',
          metadata: { tokens: { input: 3, output: 4, cacheRead: 5, total: 12 } },
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'read',
              toolCallId: 'call_read',
              state: 'output-available',
              input: {},
              output: { success: true, data: 'ok' },
            },
          ],
        },
      ],
      systemPromptSnapshot: ['  Base prompt  ', '', 42],
      stats: { stale: true },
    } as any;

    const state = provider.sessionApi.normalizeLoadedAgentState(raw);

    assert.deepStrictEqual(state.systemPromptSnapshot, ['Base prompt']);
    assert.strictEqual(state.stats?.totalMessages, 2);
    assert.strictEqual(state.stats?.toolCallCount, 1);
    assert.strictEqual(state.stats?.completedToolCallCount, 1);
    assert.strictEqual(state.stats?.totalTokens, 12);

    raw.history[0].parts[0] = { type: 'text', text: 'mutated', state: 'done' };
    assert.deepStrictEqual(state.history[0]?.parts, [{ type: 'text', text: 'hello' }]);
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
