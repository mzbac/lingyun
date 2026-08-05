import * as assert from 'assert';
import * as vscode from 'vscode';

import type { AgentLoop, AgentSessionState } from '../../core/agent';
import { createBlankSessionSignals } from '../../core/sessionSignals';
import { createDefaultSessionTitle } from '../../ui/chat/sessionTitle';
import type { ChatMessage, ChatSessionInfo } from '../../ui/chat/types';
import {
  createStandaloneChatController,
  createWritableChatTestExtensionContext,
} from './chatControllerHarness';
import { sanitizeSessionForStorage } from '../../ui/chat/methods.sessions.persistence';

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
  test('sanitizeSessionForStorage redacts persisted tool payloads and omits diffs', () => {
    const controller = createStandaloneChatController();
    const session = createSession(controller, 'session-privacy', {
      signals: {
        ...createBlankSessionSignals(),
        nestedPrivacy: [
          {
            note: 'token=signal-secret',
            headers: { Authorization: 'Bearer signal-header-secret' },
          },
        ],
      } as any,
      messages: [
        {
          id: 'tool-1',
          role: 'tool',
          content: 'failed with token=raw-secret at https://internal-api.example.com/v1',
          timestamp: Date.now(),
          toolCall: {
            id: 'bash',
            name: 'Run Command',
            args: JSON.stringify({
              command: 'curl -H "Authorization: Bearer cmd-secret" https://internal-api.example.com/v1',
              content: 'file-secret',
              headers: { Authorization: 'Bearer header-secret' },
              nested: [
                {
                  token: 'nested-token-secret',
                  headers: { Authorization: 'Bearer nested-header-secret' },
                },
              ],
            }),
            status: 'error',
            result: 'Authorization: Bearer result-secret from https://internal-api.example.com/v1',
            diff: '+ API_KEY=diff-secret',
            diffView: { filePath: 'src/index.ts', hunks: [] } as any,
            path: `${process.env.HOME || ''}/private/project/.env`,
            batchFiles: ['src/visible.ts', 'token=batch-secret'],
          },
        },
      ],
      agentState: {
        ...controller.sessionApi.getBlankAgentState(),
        history: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: `token=history-secret ${process.env.HOME || ''}/private https://internal-api.example.com/v1`,
              },
            ],
          } as any,
        ],
      },
    });

    const sanitized = sanitizeSessionForStorage(session);
    const stored = JSON.stringify(sanitized);

    assert.ok(!stored.includes('cmd-secret'));
    assert.ok(!stored.includes('file-secret'));
    assert.ok(!stored.includes('header-secret'));
    assert.ok(!stored.includes('nested-token-secret'));
    assert.ok(!stored.includes('nested-header-secret'));
    assert.ok(!stored.includes('result-secret'));
    assert.ok(!stored.includes('diff-secret'));
    assert.ok(!stored.includes('batch-secret'));
    assert.ok(!stored.includes('history-secret'));
    assert.ok(!stored.includes('signal-secret'));
    assert.ok(!stored.includes('signal-header-secret'));
    assert.ok(!stored.includes('internal-api.example.com'));
    if (process.env.HOME) {
      assert.ok(!stored.includes(process.env.HOME));
    }
    assert.strictEqual(sanitized.messages[0].toolCall?.diff, undefined);
    assert.strictEqual(sanitized.messages[0].toolCall?.diffView, undefined);
    assert.ok(sanitized.messages[0].toolCall?.diffUnavailableReason?.includes('privacy'));
  });

  test('sanitizeSessionForStorage preserves unchanged exact replay artifacts byte-for-byte', () => {
    const controller = createStandaloneChatController();
    const reasoning = 'native reasoning with trailing space ';
    const text = 'literal </think> and <think>source</think> stays visible\n';
    const rawArguments = '{ "value" : 1.0, "text" : "\\u0061" }';
    const session = createSession(controller, 'session-exact-replay', {
      agentState: {
        ...controller.sessionApi.getBlankAgentState(),
        history: [
          {
            id: 'assistant-exact-replay',
            role: 'assistant',
            metadata: {
              replay: { reasoning, text },
            },
            parts: [
              { type: 'reasoning', text: reasoning, state: 'done' },
              { type: 'text', text, state: 'done' },
              {
                type: 'dynamic-tool',
                toolCallId: 'call-exact-1',
                toolName: 'probe',
                input: { value: 1, text: 'a' },
                state: 'output-available',
                output: { success: true, data: 'ok' },
                callProviderMetadata: {
                  openaiCompatible: {
                    opaqueProviderField: 'keep-me',
                    kookaReplay: {
                      version: 1,
                      toolCallId: 'call-exact-1',
                      toolName: 'probe',
                      rawArguments,
                    },
                  },
                },
              },
            ],
          } as any,
        ],
      },
    });

    const sanitized = sanitizeSessionForStorage(session);
    const assistant = sanitized.agentState.history[0] as any;
    const toolPart = assistant.parts.find((part: any) => part?.type === 'dynamic-tool');

    assert.strictEqual(assistant.metadata?.replay?.reasoning, reasoning);
    assert.strictEqual(assistant.metadata?.replay?.text, text);
    assert.strictEqual(
      toolPart?.callProviderMetadata?.openaiCompatible?.kookaReplay?.rawArguments,
      rawArguments
    );
    assert.strictEqual(
      toolPart?.callProviderMetadata?.openaiCompatible?.opaqueProviderField,
      'keep-me'
    );
  });

  test('sanitizeSessionForStorage atomically omits changed exact replay artifacts', () => {
    const controller = createStandaloneChatController();
    const secretReplay = {
      reasoning: 'safe reasoning remains insufficient on its own',
      text: 'token=replay-secret',
    };
    const secretRawArguments = '{ "token" : "marker-secret", "value" : 1.0 }';
    const longReplay = {
      reasoning: 'long replay',
      text: 'x'.repeat(20_001),
    };
    const longRawArguments = `{ "payload" : "${'y'.repeat(20_001)}" }`;
    const session = createSession(controller, 'session-changed-replay', {
      agentState: {
        ...controller.sessionApi.getBlankAgentState(),
        history: [
          {
            id: 'assistant-redacted-replay',
            role: 'assistant',
            metadata: {
              finishReason: 'stop',
              replay: secretReplay,
            },
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: 'call-secret-1',
                toolName: 'probe',
                input: { value: 1 },
                state: 'output-available',
                output: { success: true, data: 'ok' },
                callProviderMetadata: {
                  openaiCompatible: {
                    opaqueProviderField: 'keep-redacted-sibling',
                    kookaReplay: {
                      version: 1,
                      toolCallId: 'call-secret-1',
                      toolName: 'probe',
                      rawArguments: secretRawArguments,
                    },
                  },
                  anotherProvider: { opaqueProviderField: 'keep-other-provider' },
                },
              },
            ],
          },
          {
            id: 'assistant-truncated-replay',
            role: 'assistant',
            metadata: {
              finishReason: 'tool-calls',
              replay: longReplay,
            },
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: 'call-long-1',
                toolName: 'probe',
                input: { payload: 'normalized' },
                state: 'output-available',
                output: { success: true, data: 'ok' },
                callProviderMetadata: {
                  openaiCompatible: {
                    opaqueProviderField: 'keep-truncated-sibling',
                    kookaReplay: {
                      version: 1,
                      toolCallId: 'call-long-1',
                      toolName: 'probe',
                      rawArguments: longRawArguments,
                    },
                  },
                },
              },
            ],
          },
        ] as any,
      },
    });

    const sanitized = sanitizeSessionForStorage(session);
    const redactedAssistant = sanitized.agentState.history[0] as any;
    const redactedToolPart = redactedAssistant.parts[0];
    const truncatedAssistant = sanitized.agentState.history[1] as any;
    const truncatedToolPart = truncatedAssistant.parts[0];

    assert.strictEqual(redactedAssistant.metadata?.replay, undefined);
    assert.strictEqual(redactedAssistant.metadata?.finishReason, 'stop');
    assert.strictEqual(
      redactedToolPart.callProviderMetadata?.openaiCompatible?.kookaReplay,
      undefined
    );
    assert.strictEqual(
      redactedToolPart.callProviderMetadata?.openaiCompatible?.opaqueProviderField,
      'keep-redacted-sibling'
    );
    assert.deepStrictEqual(
      redactedToolPart.callProviderMetadata?.anotherProvider,
      { opaqueProviderField: 'keep-other-provider' }
    );

    assert.strictEqual(truncatedAssistant.metadata?.replay, undefined);
    assert.strictEqual(truncatedAssistant.metadata?.finishReason, 'tool-calls');
    assert.strictEqual(
      truncatedToolPart.callProviderMetadata?.openaiCompatible?.kookaReplay,
      undefined
    );
    assert.strictEqual(
      truncatedToolPart.callProviderMetadata?.openaiCompatible?.opaqueProviderField,
      'keep-truncated-sibling'
    );

    assert.deepStrictEqual((session.agentState.history[0] as any).metadata.replay, secretReplay);
    assert.strictEqual(
      (session.agentState.history[0] as any)
        .parts[0].callProviderMetadata.openaiCompatible.kookaReplay.rawArguments,
      secretRawArguments
    );
    assert.deepStrictEqual((session.agentState.history[1] as any).metadata.replay, longReplay);
    assert.strictEqual(
      (session.agentState.history[1] as any)
        .parts[0].callProviderMetadata.openaiCompatible.kookaReplay.rawArguments,
      longRawArguments
    );

    const stored = JSON.stringify(sanitized);
    assert.ok(!stored.includes('replay-secret'));
    assert.ok(!stored.includes('marker-secret'));
    assert.ok(!stored.includes('TRUNCATED FOR STORAGE'));
  });

  test('pruneSessionForStorage keeps newest messages within the byte budget', () => {
    const controller = createStandaloneChatController();
    const messages = Array.from({ length: 30 }, (_unused, index) => ({
      id: `msg-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `message ${index} ${'x'.repeat(500)}`,
      timestamp: Date.now() + index,
    }));
    const session = createSession(controller, 'session-prune', { messages });

    const pruned = controller.sessionApi.pruneSessionForStorage(session, 6_000);
    const bytes = Buffer.byteLength(JSON.stringify(pruned), 'utf8');
    const ids = pruned.messages.map(message => message.id);

    assert.ok(bytes <= 6_000, `expected pruned session to fit budget, got ${bytes} bytes`);
    assert.ok(pruned.messages.length > 1, 'expected to keep more than the final message');
    assert.ok(pruned.messages.length < messages.length, 'expected older messages to be pruned');
    assert.strictEqual(ids.at(-1), 'msg-29');
    assert.ok(!ids.includes('msg-0'));
  });

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

  test('session list pins the active group and orders other parent groups by recency', () => {
    const controller = createStandaloneChatController();
    const defaultTitle = createDefaultSessionTitle(new Date(0));
    controller.sessions = new Map([
      [
        'orphan',
        createSession(controller, 'orphan', {
          title: 'Recovered subagent',
          parentSessionId: 'missing-parent',
          createdAt: 5,
          updatedAt: 95,
        }),
      ],
      [
        'active-child',
        createSession(controller, 'active-child', {
          title: 'Explore implementation',
          parentSessionId: 'active-parent',
          createdAt: 2,
          updatedAt: 30,
        }),
      ],
      [
        'recent-child',
        createSession(controller, 'recent-child', {
          title: 'Check recent task',
          parentSessionId: 'recent-parent',
          createdAt: 4,
          updatedAt: 100,
        }),
      ],
      [
        'active-parent',
        createSession(controller, 'active-parent', {
          title: defaultTitle,
          firstUserMessagePreview: 'Parent task',
          createdAt: 1,
          updatedAt: 10,
        }),
      ],
      [
        'recent-parent',
        createSession(controller, 'recent-parent', {
          title: 'Manual follow-up',
          createdAt: 3,
          updatedAt: 90,
        }),
      ],
    ]);
    controller.activeSessionId = 'active-child';

    assert.deepStrictEqual(controller.sessionApi.getSessionsForUI(), [
      { id: 'active-parent', title: 'Parent task' },
      { id: 'active-child', title: '↳ Explore implementation' },
      { id: 'recent-parent', title: 'Manual follow-up' },
      { id: 'recent-child', title: '↳ Check recent task' },
      { id: 'orphan', title: 'Recovered subagent' },
    ]);
  });

  test('renderable messages stop at the active revert boundary', () => {
    const controller = createStandaloneChatController();
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Original request', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'Original answer', timestamp: 2 },
      { id: 'user-2', role: 'user', content: 'Undo from here', timestamp: 3 },
      { id: 'assistant-2', role: 'assistant', content: 'Hidden answer', timestamp: 4 },
    ];
    const session = controller.sessionApi.getActiveSession();
    session.messages = messages;
    session.revert = {
      messageId: 'user-2',
      snapshotHash: 'snapshot-1',
      baselineAgentState: controller.sessionApi.getBlankAgentState(),
      files: [],
      updatedAt: 5,
    };
    controller.messages = messages;

    assert.deepStrictEqual(controller.sessionApi.getRenderableMessages(), messages.slice(0, 2));
  });

  test('renderable messages return the active message array when the revert boundary is stale', () => {
    const controller = createStandaloneChatController();
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Original request', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'Original answer', timestamp: 2 },
    ];
    const session = controller.sessionApi.getActiveSession();
    session.messages = messages;
    session.revert = {
      messageId: 'missing-message',
      snapshotHash: 'snapshot-1',
      baselineAgentState: controller.sessionApi.getBlankAgentState(),
      files: [],
      updatedAt: 3,
    };
    controller.messages = messages;

    assert.strictEqual(controller.sessionApi.getRenderableMessages(), messages);
  });

  test('pruneSessionsInMemory keeps active session plus newest sessions', () => {
    const controller = createStandaloneChatController();
    const released: string[] = [];
    controller.queueManager.releaseSession = (session: ChatSessionInfo | undefined) => {
      if (session) released.push(session.id);
    };
    controller.sessions = new Map([
      ['newest', createSession(controller, 'newest', { updatedAt: 500 })],
      ['oldest', createSession(controller, 'oldest', { updatedAt: 100 })],
      ['active', createSession(controller, 'active', { updatedAt: 50 })],
      ['middle', createSession(controller, 'middle', { updatedAt: 300 })],
      ['second-newest', createSession(controller, 'second-newest', { updatedAt: 400 })],
    ]);
    controller.activeSessionId = 'active';
    for (const id of controller.sessions.keys()) {
      controller.dirtySessionIds.add(id);
    }

    controller.sessionApi.pruneSessionsInMemory(3);

    assert.deepStrictEqual([...controller.sessions.keys()], ['newest', 'active', 'second-newest']);
    assert.deepStrictEqual(released, ['oldest', 'middle']);
    assert.deepStrictEqual([...controller.dirtySessionIds].sort(), ['active', 'newest', 'second-newest']);
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

	  test('loaded sessions keep the newest fifty valid queued inputs', () => {
	    const controller = createStandaloneChatController();
	    const queuedInputs = [
	      'drop me',
	      ...Array.from({ length: 55 }, (_unused, index) => ({
	        id: `q-${index}`,
	        createdAt: index,
	        message: `message ${index}`,
	        displayContent: `preview ${index}`,
	        attachmentCount: index + 0.7,
	      })),
	      null,
	    ];
	    const loaded = controller.sessionApi.normalizeLoadedSession(
	      createSession(controller, 'session-queue', { queuedInputs: queuedInputs as any })
	    );

	    assert.strictEqual(loaded.queuedInputs?.length, 50);
	    assert.strictEqual(loaded.queuedInputs?.[0]?.id, 'q-5');
	    assert.strictEqual(loaded.queuedInputs?.[49]?.id, 'q-54');
	    assert.strictEqual(loaded.queuedInputs?.[0]?.attachmentCount, 5);
	  });

  test('loaded agent state preserves goal synthetic contexts', () => {
    const controller = createStandaloneChatController();
    const state = controller.sessionApi.normalizeLoadedAgentState({
      history: [],
      compactionSyntheticContexts: [
        { transientContext: 'memoryRecall', text: 'remember me' },
        { transientContext: 'goal', text: 'goal continuation context' },
        { transientContext: 'invalid', text: 'drop me' },
      ],
    });

    assert.deepStrictEqual(state.compactionSyntheticContexts, [
      { transientContext: 'memoryRecall', text: 'remember me' },
      { transientContext: 'goal', text: 'goal continuation context' },
    ]);
  });

  test('recoverInterruptedSessions marks the latest running step and tool', () => {
    const controller = createStandaloneChatController();
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    const oldStep: ChatMessage = {
      id: 'step-old',
      role: 'step',
      content: '',
      timestamp: 1,
      step: { index: 1, status: 'running' },
    };
    const oldTool: ChatMessage = {
      id: 'tool-old',
      role: 'tool',
      content: '',
      timestamp: 2,
      toolCall: { id: 'tool-old', name: 'old tool', args: '{}', status: 'running' },
    };
    const latestStep: ChatMessage = {
      id: 'step-new',
      role: 'step',
      content: '',
      timestamp: 3,
      step: { index: 2, status: 'running' },
    };
    const latestTool: ChatMessage = {
      id: 'tool-new',
      role: 'tool',
      content: '',
      timestamp: 4,
      toolCall: { id: 'tool-new', name: 'new tool', args: '{}', status: 'pending' },
    };
    const session = createSession(controller, 'interrupted-session', {
      runtime: { wasRunning: true, updatedAt: 1 },
      activeStepId: 'step-new',
      messages: [oldStep, oldTool, latestStep, latestTool],
    });
    controller.sessions = new Map([[session.id, session]]);
    controller.isProcessing = true;
    controller.abortRequested = true;
    controller.pendingApprovals.set('approval-1', {
      resolve() {},
      toolName: 'bash',
    });

    controller.sessionApi.recoverInterruptedSessions();

    assert.strictEqual(oldStep.step?.status, 'running');
    assert.strictEqual(oldTool.toolCall?.status, 'running');
    assert.strictEqual(latestStep.step?.status, 'canceled');
    assert.strictEqual(latestTool.toolCall?.status, 'error');
    assert.strictEqual(latestTool.toolCall?.result, 'Interrupted (VS Code closed or extension reloaded).');
    assert.strictEqual(session.runtime?.wasRunning, false);
    assert.strictEqual(session.activeStepId, undefined);
    assert.strictEqual(controller.isProcessing, false);
    assert.strictEqual(controller.abortRequested, false);
    assert.strictEqual(controller.pendingApprovals.size, 0);
    assert.ok(controller.dirtySessionIds.has(session.id));
    assert.match(session.messages.at(-1)?.content || '', /Previous run was interrupted/);
  });

  test('manual compaction surfaces the latest summary message', async () => {
    const history = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Original task' }] },
      {
        id: 'summary-old',
        role: 'assistant',
        parts: [{ type: 'text', text: 'old summary' }],
        metadata: { summary: true },
      },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'ordinary assistant output' }] },
      {
        id: 'summary-new',
        role: 'assistant',
        parts: [{ type: 'text', text: 'new summary' }],
        metadata: { summary: true },
      },
    ];
    let compactCalls = 0;
    const blankState: AgentSessionState = {
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
    const controller = createStandaloneChatController({
      agent: {
        syncSession() {},
        exportState() {
          return {
            ...blankState,
            history: history as any,
          };
        },
        getHistory() {
          return history as any;
        },
        async compactSession() {
          compactCalls++;
        },
      } as any,
    });
    const posted: any[] = [];
    controller.view = {} as vscode.WebviewView;
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };

    await controller.sessionApi.compactCurrentSession();

    const update = posted.find(message => message?.type === 'updateMessage');
    assert.strictEqual(compactCalls, 1);
    assert.strictEqual(update?.message?.operation?.status, 'done');
    assert.strictEqual(update?.message?.operation?.summaryText, 'new summary');
    assert.strictEqual(update?.message?.operation?.summaryTruncated, false);
    assert.strictEqual(controller.isProcessing, false);
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

  test('setBackend prevents an older transition from posting after a newer backend wins', async () => {
    let releaseFirstLoad: () => void = () => {};
    const firstLoad = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve;
    });
    let loadCalls = 0;
    const controller = createStandaloneChatController();
    const first = createTrackingAgent(() => controller.sessionApi.getBlankAgentState());
    const replacement = createTrackingAgent(() => controller.sessionApi.getBlankAgentState());
    const firstProvider = { id: 'first-provider' } as any;
    const replacementProvider = { id: 'replacement-provider' } as any;
    const sendInitProviders: unknown[] = [];
    controller.view = {} as vscode.WebviewView;
    controller.webviewApi.postMessage = () => {};
    controller.sessionApi.ensureSessionsLoaded = async () => {
      loadCalls++;
      if (loadCalls === 1) await firstLoad;
    };
    controller.webviewApi.sendInit = async () => {
      sendInitProviders.push(controller.llmProvider);
    };

    const staleTransition = controller.sessionApi.setBackend(first.agent, firstProvider);
    await Promise.resolve();
    await controller.sessionApi.setBackend(replacement.agent, replacementProvider);
    releaseFirstLoad();
    await staleTransition;

    assert.strictEqual(loadCalls, 2);
    assert.strictEqual(controller.agent, replacement.agent);
    assert.strictEqual(controller.llmProvider, replacementProvider);
    assert.strictEqual(first.syncCalls.length, 0);
    assert.strictEqual(replacement.syncCalls.length, 1);
    assert.deepStrictEqual(sendInitProviders, [replacementProvider]);
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

  test('setSessionsPersist skips default true persistence and refresh while resyncing state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previousPersist = config.inspect<boolean>('sessions.persist')?.globalValue;
    await config.update('sessions.persist', undefined, vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];
      let refreshCalls = 0;
      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return Promise.resolve(true);
          },
        },
      } as unknown as vscode.WebviewView;
      controller.sessionApi.onSessionPersistenceConfigChanged = async () => {
        refreshCalls++;
      };

      await controller.webviewApi.setSessionsPersist(true);

      assert.strictEqual(config.inspect<boolean>('sessions.persist')?.globalValue, undefined);
      assert.strictEqual(refreshCalls, 0);
      assert.deepStrictEqual(posted, [
        {
          type: 'sessionsPersistState',
          sessionsPersist: true,
        },
      ]);
    } finally {
      await config.update('sessions.persist', previousPersist, vscode.ConfigurationTarget.Global);
    }
  });

  test('setSessionRetentionLimits skips default persistence and refresh while resyncing state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const keys = ['sessions.maxSessions', 'sessions.maxSessionBytes'] as const;
    const previousValues = new Map<string, unknown>();
    for (const key of keys) {
      previousValues.set(key, config.inspect<unknown>(key)?.globalValue);
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];
      let refreshCalls = 0;
      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return Promise.resolve(true);
          },
        },
      } as unknown as vscode.WebviewView;
      controller.sessionApi.onSessionPersistenceConfigChanged = async () => {
        refreshCalls++;
      };

      await controller.webviewApi.setSessionRetentionLimits({ maxSessions: 20, maxSessionBytes: 2_000_000 });

      for (const key of keys) {
        assert.strictEqual(config.inspect<unknown>(key)?.globalValue, undefined, `${key} should stay unpersisted`);
      }
      assert.strictEqual(refreshCalls, 0);
      assert.deepStrictEqual(posted, [
        {
          type: 'sessionRetentionState',
          sessionsMaxSessions: 20,
          sessionsMaxSessionBytes: 2_000_000,
        },
      ]);
    } finally {
      for (const [key, value] of previousValues) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
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
