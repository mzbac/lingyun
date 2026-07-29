import * as assert from 'assert';

import type { AgentLoop } from '../../core/agent';
import { createStandaloneChatController } from './chatControllerHarness';

function createBlankAgentState() {
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
});
