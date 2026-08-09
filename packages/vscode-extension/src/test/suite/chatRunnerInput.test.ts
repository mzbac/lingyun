import * as assert from 'assert';

import type { AgentLoop } from '../../core/agent';
import { createStandaloneChatController } from './chatControllerHarness';

function createBlankAgentState(history: any[] = []) {
  return {
    history,
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

suite('Chat runner input', () => {
  test('classifyPlanStatus keeps question-heavy plans in needs_input', () => {
    const controller = createStandaloneChatController();

    assert.strictEqual(controller.runnerInputApi.classifyPlanStatus(''), 'needs_input');
    assert.strictEqual(controller.runnerInputApi.classifyPlanStatus('Implementation notes only'), 'needs_input');
    assert.strictEqual(
      controller.runnerInputApi.classifyPlanStatus('1. Which provider?\r\n2. Which region?'),
      'needs_input'
    );
    assert.strictEqual(
      controller.runnerInputApi.classifyPlanStatus('- Implement the fix\n- Should it run in CI?'),
      'needs_input'
    );
  });

  test('classifyPlanStatus treats actionable plans as draft', () => {
    const controller = createStandaloneChatController();

    assert.strictEqual(
      controller.runnerInputApi.classifyPlanStatus([
        '1. Inspect the current state',
        '- Implement the smallest fix',
        '* Add focused tests',
        '• Run verification?',
      ].join('\n')),
      'draft'
    );
  });

  test('handleUserMessage sends trimmed text before valid image attachments', async () => {
    let capturedInput: unknown;
    const blankState = createBlankAgentState();
    const agent = {
      syncSession() {},
      exportState() {
        return blankState;
      },
      getHistory() {
        return [];
      },
      async run(input: unknown) {
        capturedInput = input;
        return 'done';
      },
    } as unknown as AgentLoop;
    const controller = createStandaloneChatController({ agent });
    controller.view = {} as any;
    controller.mode = 'build';
    controller.runnerInputApi.isPlanFirstEnabled = () => false;
    controller.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    controller.sessionApi.ensureSessionsLoaded = async () => {};
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    controller.sessionApi.persistActiveSession = () => {};
    controller.sessionApi.postSessions = () => {};
    controller.revertApi.commitRevertedConversationIfNeeded = () => {};
    controller.approvalsApi.postApprovalState = () => {};
    controller.skillsApi.postUnknownSkillWarnings = async () => {};
    controller.webviewApi.postMessage = () => {};

    await controller.runnerInputApi.handleUserMessage({
      message: '  Describe this  ',
      attachments: [
        { mediaType: 'text/plain', dataUrl: 'data:text/plain;base64,skip' },
        { mediaType: ' image/png ', dataUrl: 'data:image/png;base64,AAAA', filename: ' clip.png ' },
        { mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,BBBB' },
      ],
    });

    assert.deepStrictEqual(capturedInput, [
      { type: 'text', text: 'Describe this' },
      { type: 'file', mediaType: 'image/png', filename: 'clip.png', url: 'data:image/png;base64,AAAA' },
      { type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,BBBB' },
    ]);
  });

  test('handleUserMessage acknowledges an ordinary input after recording its user turn', async () => {
    const runResult = createDeferred<string>();
    const events: string[] = [];
    const agent = {
      syncSession() {},
      exportState() {
        return createBlankAgentState();
      },
      getHistory() {
        return [];
      },
      async run() {
        events.push('run');
        return runResult.promise;
      },
    } as unknown as AgentLoop;
    const controller = createStandaloneChatController({ agent });
    controller.view = {} as any;
    controller.mode = 'build';
    controller.runnerInputApi.isPlanFirstEnabled = () => false;
    controller.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    controller.sessionApi.ensureSessionsLoaded = async () => {};
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    controller.sessionApi.persistActiveSession = () => {};
    controller.sessionApi.postSessions = () => {};
    controller.revertApi.commitRevertedConversationIfNeeded = () => {};
    controller.approvalsApi.postApprovalState = () => {};
    controller.skillsApi.postUnknownSkillWarnings = async () => {};
    controller.webviewApi.postMessage = () => {};

    const handled = controller.runnerInputApi.handleUserMessage('Committed input', {
      onAccepted: () => {
        events.push('accepted');
        assert.ok(controller.messages.some(message =>
          message.role === 'user' && message.content === 'Committed input'
        ));
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(events, ['accepted', 'run']);
    runResult.resolve('done');
    await handled;
  });

  test('handleUserMessage acknowledges a queued input after it enters the active session queue', async () => {
    const controller = createStandaloneChatController();
    controller.view = {} as any;
    controller.isProcessing = true;
    controller.sessionApi.ensureSessionsLoaded = async () => {};
    controller.sessionApi.persistActiveSession = () => {};
    controller.webviewApi.postMessage = () => {};
    let accepted = 0;

    await controller.runnerInputApi.handleUserMessage('Queued input', {
      onAccepted: () => {
        accepted++;
        assert.ok(controller.queueManager.getQueuedInputs().some(item => item.message === 'Queued input'));
      },
    });

    assert.strictEqual(accepted, 1);
    assert.ok(controller.queueManager.getQueuedInputs().some(item => item.message === 'Queued input'));
  });

  test('failed turn Retry resumes the unanswered user turn without appending another user message', async () => {
    const timeoutError = new Error('Request timed out after 100ms');
    timeoutError.name = 'TimeoutError';
    let agentHistory: any[] = [];
    let resumeCalls = 0;
    const agent = {
      syncSession() {},
      exportState() {
        return createBlankAgentState(agentHistory);
      },
      getHistory() {
        return agentHistory;
      },
      async run() {
        agentHistory = [{
          id: 'agent-user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Timeout request' }],
        }];
        throw timeoutError;
      },
      async resume() {
        resumeCalls++;
        agentHistory = [
          ...agentHistory,
          {
            id: 'agent-assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Recovered response' }],
          },
        ];
        return 'Recovered response';
      },
    } as unknown as AgentLoop;
    const controller = createStandaloneChatController({ agent });
    const posted: any[] = [];
    controller.view = {} as any;
    controller.mode = 'build';
    controller.runnerInputApi.isPlanFirstEnabled = () => false;
    controller.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    controller.sessionApi.ensureSessionsLoaded = async () => {};
    controller.sessionApi.isSessionPersistenceEnabled = () => false;
    controller.sessionApi.persistActiveSession = () => {};
    controller.sessionApi.postSessions = () => {};
    controller.revertApi.commitRevertedConversationIfNeeded = () => {};
    controller.approvalsApi.postApprovalState = () => {};
    controller.skillsApi.postUnknownSkillWarnings = async () => {};
    controller.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };

    await controller.runnerInputApi.handleUserMessage('Timeout request');

    const userMessage = controller.messages.find(message => message.role === 'user');
    const errorMessage = controller.messages.find(message => message.role === 'error');
    assert.ok(userMessage);
    assert.deepStrictEqual(errorMessage?.retry, { kind: 'resume' });
    assert.strictEqual(controller.messages.filter(message => message.role === 'user').length, 1);
    assert.deepStrictEqual(agentHistory.map(message => message.role), ['user']);

    await controller.runnerInputApi.retryFailedTurn(userMessage!.id);

    assert.strictEqual(resumeCalls, 1);
    assert.strictEqual(controller.messages.filter(message => message.role === 'user').length, 1);
    assert.deepStrictEqual(agentHistory.map(message => message.role), ['user', 'assistant']);
    assert.strictEqual(errorMessage?.retry, undefined);
    assert.ok(posted.some(message =>
      message?.type === 'updateMessage' &&
      message?.message?.id === errorMessage?.id &&
      message?.message?.retry === undefined
    ));
  });
});
