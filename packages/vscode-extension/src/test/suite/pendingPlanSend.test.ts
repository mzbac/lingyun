import * as assert from 'assert';
import type { ChatMessage, ChatSessionInfo } from '../../ui/chat/types';
import { createBlankSessionSignals, isSessionMemoryDisabled, setSessionMemoryMode } from '../../core/sessionSignals';
import { createStandaloneChatController } from './chatControllerHarness';

function createPendingPlanMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'plan-1',
    role: 'plan',
    content: 'Plan draft',
    timestamp: Date.now(),
    turnId: 'turn-1',
    plan: { status: 'draft', task: 'Task' },
    ...overrides,
  };
}

function installPendingPlanSession(
  provider: ReturnType<typeof createStandaloneChatController>,
  planMsg: ChatMessage,
  pendingPlan?: { task: string; planMessageId: string },
): ChatSessionInfo {
  provider.messages = [planMsg];
  provider.activeSessionId = 'session-1';

  const session: ChatSessionInfo = {
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
    pendingPlan: pendingPlan ?? { task: 'Task', planMessageId: planMsg.id },
    runtime: { wasRunning: false, updatedAt: Date.now() },
  };

  provider.sessions = new Map([[provider.activeSessionId, session]]);
  return session;
}

function createPendingPlanController(): ReturnType<typeof createStandaloneChatController> {
  const provider = createStandaloneChatController();
  provider.isProcessing = false;
  provider.view = {} as any;
  provider.mode = 'build';
  provider.signals = createBlankSessionSignals();
  provider.currentModel = 'gpt-4o';
  provider.sessionApi.ensureSessionsLoaded = async () => {};
  provider.revertApi.commitRevertedConversationIfNeeded = () => {};
  provider.approvalsApi.postApprovalState = () => {};
  provider.sessionApi.persistActiveSession = () => {};
  return provider;
}

function installActiveSession(
  provider: ReturnType<typeof createStandaloneChatController>,
  messages: ChatMessage[] = [],
): ChatSessionInfo {
  provider.messages = messages;
  provider.activeSessionId = 'session-1';

  const session: ChatSessionInfo = {
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
    runtime: { wasRunning: false, updatedAt: Date.now() },
  };

  provider.sessions = new Map([[provider.activeSessionId, session]]);
  return session;
}

function assertBlockedPendingPlanDirectAction(params: {
  provider: ReturnType<typeof createStandaloneChatController>;
  session: ChatSessionInfo;
  expectedPendingPlan: { task: string; planMessageId: string };
  expectedError: string;
  posted: any[];
}): void {
  assert.deepStrictEqual(params.session.pendingPlan, params.expectedPendingPlan);

  const errorMessage = params.provider.messages.find(message => message.role === 'error');
  assert.ok(errorMessage);
  assert.strictEqual(errorMessage?.content, params.expectedError);

  const processingEvents = params.posted.filter(message => message?.type === 'processing');
  assert.deepStrictEqual(processingEvents, []);
}

suite('Pending plan send', () => {
  test('handleUserMessage applies pending-plan clarifications through the shared mutation lifecycle', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    const session = installPendingPlanSession(provider, planMsg, { task: 'Task', planMessageId: 'plan-1' });
    const posted: any[] = [];
    const recordedInputs: string[] = [];
    const warnedSkills: Array<{ content: string; turnId?: string }> = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.inputHistoryApi.recordInputHistory = (content: string) => {
      recordedInputs.push(content);
    };
    provider.skillsApi.postUnknownSkillWarnings = async (content: string, turnId?: string) => {
      warnedSkills.push({ content, turnId });
    };
    provider.runnerInputApi.classifyPlanStatus = () => 'needs_input';
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.agent.plan = async (_task, callbacks) => {
      callbacks?.onAssistantToken?.('Need more detail');
      callbacks?.onComplete?.('Need more detail');
      return 'Need more detail';
    };

    await provider.runnerInputApi.handleUserMessage('User clarification');

    assert.deepStrictEqual(recordedInputs, ['User clarification']);
    assert.deepStrictEqual(warnedSkills, [{ content: 'User clarification', turnId: 'turn-1' }]);
    assert.ok(session.pendingPlan);
    assert.strictEqual(session.pendingPlan?.task, 'Task\n\nUser clarifications:\nUser clarification');

    const followUp = provider.messages.find(message => message.role === 'user');
    assert.strictEqual(followUp?.content, 'User clarification');
    assert.strictEqual(followUp?.turnId, 'turn-1');

    const updatePlan = provider.messages.find(
      message => message.role === 'plan' && message.id === session.pendingPlan?.planMessageId,
    );
    assert.strictEqual(updatePlan?.content, 'Need more detail');
    assert.strictEqual(updatePlan?.plan?.status, 'needs_input');

    const processingEvents = posted.filter(message => message?.type === 'processing');
    assert.deepStrictEqual(processingEvents.map(message => message.value), [true, false]);
  });

  test('handleUserMessage clears stale pending-plan state and resumes the ordinary run flow', async () => {
    const provider = createPendingPlanController();
    const session = installPendingPlanSession(provider, createPendingPlanMessage({ id: 'plan-live' }), {
      task: 'Task',
      planMessageId: 'plan-missing',
    });
    const posted: any[] = [];
    let runCalled = false;

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.runnerInputApi.isPlanFirstEnabled = () => false;
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.run = async () => {
      runCalled = true;
      return 'done';
    };

    await provider.runnerInputApi.handleUserMessage('Ship it');

    assert.strictEqual(runCalled, true);
    assert.strictEqual(session.pendingPlan, undefined);
    assert.ok(provider.messages.some(message => message.role === 'user' && message.content === 'Ship it'));

    const planPendingEvents = posted.filter(message => message?.type === 'planPending');
    assert.deepStrictEqual(
      planPendingEvents.map(message => [message.value, message.planMessageId]),
      [[false, '']],
    );
  });

  test('handleUserMessage restores missing plan metadata through the shared clarification lifecycle', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({ plan: undefined });
    const session = installPendingPlanSession(provider, planMsg, { task: 'Task', planMessageId: 'plan-1' });
    const posted: any[] = [];
    const recordedInputs: string[] = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.inputHistoryApi.recordInputHistory = (content: string) => {
      recordedInputs.push(content);
    };
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createPlanningCallbacks = () => ({}) as any;
    provider.agent.plan = async () => 'Need more detail';
    provider.runnerInputApi.classifyPlanStatus = () => 'needs_input';

    await provider.runnerInputApi.handleUserMessage('Clarify deployment');

    assert.deepStrictEqual(recordedInputs, ['Clarify deployment']);
    assert.deepStrictEqual(planMsg.plan, { status: 'draft', task: 'Task' });
    assert.ok(session.pendingPlan);
    assert.strictEqual(session.pendingPlan?.task, 'Task\n\nUser clarifications:\nClarify deployment');

    const repairedUpdate = posted.find(message => message?.type === 'updateMessage' && message?.message?.id === 'plan-1');
    assert.ok(repairedUpdate);
    assert.deepStrictEqual(repairedUpdate?.message?.plan, { status: 'draft', task: 'Task' });
  });

  test('handleUserMessage ignores attachment-only replies while waiting for pending-plan clarification', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    const session = installPendingPlanSession(provider, planMsg);
    const recordedInputs: string[] = [];

    provider.inputHistoryApi.recordInputHistory = (content: string) => {
      recordedInputs.push(content);
    };

    await provider.runnerInputApi.handleUserMessage({
      message: '',
      attachments: [{ mediaType: 'image/png', dataUrl: 'data:image/png;base64,abc', filename: 'diagram.png' }],
    });

    assert.deepStrictEqual(recordedInputs, []);
    assert.deepStrictEqual(session.pendingPlan, { task: 'Task', planMessageId: 'plan-1' });
    assert.strictEqual(provider.messages.length, 1);
    assert.strictEqual(provider.messages[0]?.id, 'plan-1');
  });

  test('revisePendingPlan records history and warns unknown skills through the shared lifecycle', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    const session = installPendingPlanSession(provider, planMsg);
    const posted: unknown[] = [];
    const recordedInputs: string[] = [];
    const warnedSkills: Array<{ content: string; turnId?: string }> = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.inputHistoryApi.recordInputHistory = (content: string) => {
      recordedInputs.push(content);
    };
    provider.skillsApi.postUnknownSkillWarnings = async (content: string, turnId?: string) => {
      warnedSkills.push({ content, turnId });
    };
    provider.runnerInputApi.classifyPlanStatus = () => 'needs_input';
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.agent.plan = async (_task, callbacks) => {
      callbacks?.onAssistantToken?.('Need more detail');
      callbacks?.onComplete?.('Need more detail');
      return 'Need more detail';
    };

    await provider.runnerPlanApi.revisePendingPlan('plan-1', 'Clarify deployment');

    assert.deepStrictEqual(recordedInputs, ['Clarify deployment']);
    assert.deepStrictEqual(warnedSkills, [{ content: 'Clarify deployment', turnId: 'turn-1' }]);

    assert.ok(session.pendingPlan);
    assert.strictEqual(session.pendingPlan?.task, 'Task\n\nUser clarifications:\nClarify deployment');

    const followUp = provider.messages.find(message => message.role === 'user');
    assert.strictEqual(followUp?.content, 'Clarify deployment');
    assert.strictEqual(followUp?.turnId, 'turn-1');

    const updatePlan = provider.messages.find(
      message => message.role === 'plan' && message.id === session.pendingPlan?.planMessageId,
    );
    assert.strictEqual(updatePlan?.content, 'Need more detail');
    assert.strictEqual(updatePlan?.plan?.status, 'needs_input');

    const processingEvents = posted.filter(message => (message as any)?.type === 'processing') as Array<any>;
    assert.deepStrictEqual(processingEvents.map(message => message.value), [true, false]);
  });

  test('revisePendingPlan restores missing plan metadata through the shared mutation path', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({ plan: undefined });
    const session = installPendingPlanSession(provider, planMsg);
    const posted: any[] = [];
    const recordedInputs: string[] = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.inputHistoryApi.recordInputHistory = (content: string) => {
      recordedInputs.push(content);
    };
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.agent.plan = async (_task, callbacks) => {
      callbacks?.onAssistantToken?.('Need more detail');
      callbacks?.onComplete?.('Need more detail');
      return 'Need more detail';
    };
    provider.runnerInputApi.classifyPlanStatus = () => 'needs_input';

    await provider.runnerPlanApi.revisePendingPlan('plan-1', 'Clarify deployment');

    assert.deepStrictEqual(recordedInputs, ['Clarify deployment']);
    assert.ok(session.pendingPlan);
    assert.strictEqual(session.pendingPlan?.task, 'Task\n\nUser clarifications:\nClarify deployment');

    const repairedUpdate = posted.find(message => message?.type === 'updateMessage' && message?.message?.id === 'plan-1');
    assert.ok(repairedUpdate);
    assert.deepStrictEqual(repairedUpdate?.message?.plan, { status: 'draft', task: 'Task' });
  });

  test('revisePendingPlan posts a turn error when the requested pending-plan target is stale', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    const session = installPendingPlanSession(provider, planMsg);
    const posted: any[] = [];
    const recordedInputs: string[] = [];
    let planCalled = false;

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.inputHistoryApi.recordInputHistory = (content: string) => {
      recordedInputs.push(content);
    };
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createPlanningCallbacks = () => ({}) as any;
    provider.agent.plan = async () => {
      planCalled = true;
      return 'done';
    };

    await provider.runnerPlanApi.revisePendingPlan('different-id', 'Clarify deployment');

    assert.strictEqual(planCalled, false);
    assert.deepStrictEqual(recordedInputs, []);
    assertBlockedPendingPlanDirectAction({
      provider,
      session,
      expectedPendingPlan: { task: 'Task', planMessageId: 'plan-1' },
      expectedError: 'No pending plan found to revise. Try generating a new plan.',
      posted,
    });
  });

  test('revisePendingPlan posts a turn error when the active pending-plan target is missing', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({
      id: 'plan-live',
      content: 'Plan draft',
      plan: { status: 'draft', task: 'Task' },
    });
    const session = installPendingPlanSession(provider, planMsg, {
      task: 'Task',
      planMessageId: 'plan-missing',
    });
    const posted: any[] = [];
    const recordedInputs: string[] = [];
    let planCalled = false;

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.inputHistoryApi.recordInputHistory = (content: string) => {
      recordedInputs.push(content);
    };
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createPlanningCallbacks = () => ({}) as any;
    provider.agent.plan = async () => {
      planCalled = true;
      return 'done';
    };

    await provider.runnerPlanApi.revisePendingPlan('plan-missing', 'Clarify deployment');

    assert.strictEqual(planCalled, false);
    assert.deepStrictEqual(recordedInputs, ['Clarify deployment']);
    assertBlockedPendingPlanDirectAction({
      provider,
      session,
      expectedPendingPlan: { task: 'Task', planMessageId: 'plan-missing' },
      expectedError: 'No pending plan found to revise. Try generating a new plan.',
      posted,
    });
  });

  test('revisePendingPlan restores the previous pending plan on error through the shared update path', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    const session = installPendingPlanSession(provider, planMsg);
    const posted: unknown[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.agent.plan = async (_task, callbacks) => {
      callbacks?.onAssistantToken?.('1. Partial plan');
      callbacks?.onError?.(new Error('plan failed'));
      throw new Error('plan failed');
    };

    await provider.runnerPlanApi.revisePendingPlan('plan-1', 'Retry safely');

    assert.deepStrictEqual(session.pendingPlan, { task: 'Task', planMessageId: 'plan-1' });
    assert.deepStrictEqual(scheduledAutosends, [{ sessionId: 'session-1', suppress: false }]);

    const turnStatus = posted.find(message => (message as any)?.type === 'turnStatus') as any;
    assert.ok(turnStatus);
    assert.strictEqual(turnStatus.turnId, 'turn-1');
    assert.strictEqual(turnStatus.status?.type, 'error');

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.match(errorMessage?.content || '', /plan failed/i);

    const failedPlan = provider.messages.find(message => message.role === 'plan' && message.id !== 'plan-1');
    assert.ok(failedPlan);
    assert.strictEqual(failedPlan?.plan?.status, 'draft');
    assert.strictEqual(failedPlan?.content, '1. Partial plan');

    const finalPlanPending = posted.filter(message => (message as any)?.type === 'planPending').at(-1) as any;
    assert.deepStrictEqual(finalPlanPending, {
      type: 'planPending',
      value: true,
      planMessageId: 'plan-1',
    });
  });

  test('revisePendingPlan clears stale abort state before a new update run begins', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    installPendingPlanSession(provider, planMsg);
    provider.abortRequested = true;
    const posted: unknown[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.agent.plan = async (_task, callbacks) => {
      callbacks?.onAssistantToken?.('1. Partial plan');
      callbacks?.onError?.(new Error('plan failed'));
      throw new Error('plan failed');
    };

    await provider.runnerPlanApi.revisePendingPlan('plan-1', 'Retry safely');

    const turnStatus = posted.find(message => (message as any)?.type === 'turnStatus') as any;
    assert.ok(turnStatus);
    assert.strictEqual(turnStatus.turnId, 'turn-1');
    assert.strictEqual(turnStatus.status?.type, 'error');
    assert.deepStrictEqual(scheduledAutosends, [{ sessionId: 'session-1', suppress: false }]);
    assert.strictEqual(provider.abortRequested, false);

    const failedPlan = provider.messages.find(message => message.role === 'plan' && message.id !== 'plan-1');
    assert.ok(failedPlan);
    assert.strictEqual(failedPlan?.plan?.status, 'draft');
    assert.strictEqual(failedPlan?.content, '1. Partial plan');
  });

  test('revisePendingPlan treats explicit user aborts as cancellation and preserves the prior pending plan', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    const session = installPendingPlanSession(provider, planMsg);
    const posted: unknown[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.agent.plan = async (_task, callbacks) => {
      callbacks?.onAssistantToken?.('1. Partial plan');
      provider.abortRequested = true;
      callbacks?.onError?.(new Error('request canceled'));
      throw new Error('request canceled');
    };

    await provider.runnerPlanApi.revisePendingPlan('plan-1', 'Retry safely');

    assert.deepStrictEqual(session.pendingPlan, { task: 'Task', planMessageId: 'plan-1' });
    assert.deepStrictEqual(scheduledAutosends, [{ sessionId: 'session-1', suppress: true }]);
    assert.strictEqual(provider.abortRequested, false);

    const turnStatus = posted.find(message => (message as any)?.type === 'turnStatus');
    assert.strictEqual(turnStatus, undefined);

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.match(errorMessage?.content || '', /request canceled/i);

    const canceledPlan = provider.messages.find(message => message.role === 'plan' && message.id !== 'plan-1');
    assert.ok(canceledPlan);
    assert.strictEqual(canceledPlan?.plan?.status, 'canceled');
    assert.strictEqual(canceledPlan?.content, '1. Partial plan');

    const finalPlanPending = posted.filter(message => (message as any)?.type === 'planPending').at(-1) as any;
    assert.deepStrictEqual(finalPlanPending, {
      type: 'planPending',
      value: true,
      planMessageId: 'plan-1',
    });
  });

  test('revisePendingPlan treats canonical abort text as cancellation and preserves the prior pending plan', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage();
    const session = installPendingPlanSession(provider, planMsg);
    const posted: unknown[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.agent.plan = async (_task, callbacks) => {
      callbacks?.onAssistantToken?.('1. Partial plan');
      callbacks?.onError?.(new Error('Agent aborted'));
      throw new Error('Agent aborted');
    };

    await provider.runnerPlanApi.revisePendingPlan('plan-1', 'Retry safely');

    assert.deepStrictEqual(session.pendingPlan, { task: 'Task', planMessageId: 'plan-1' });
    assert.deepStrictEqual(scheduledAutosends, [{ sessionId: 'session-1', suppress: true }]);
    assert.strictEqual(provider.abortRequested, false);

    const turnStatus = posted.find(message => (message as any)?.type === 'turnStatus');
    assert.strictEqual(turnStatus, undefined);

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.strictEqual((errorMessage?.content || '').trim(), 'Agent aborted');

    const canceledPlan = provider.messages.find(message => message.role === 'plan' && message.id !== 'plan-1');
    assert.ok(canceledPlan);
    assert.strictEqual(canceledPlan?.plan?.status, 'canceled');
    assert.strictEqual(canceledPlan?.content, '1. Partial plan');

    const finalPlanPending = posted.filter(message => (message as any)?.type === 'planPending').at(-1) as any;
    assert.deepStrictEqual(finalPlanPending, {
      type: 'planPending',
      value: true,
      planMessageId: 'plan-1',
    });
  });

  test('executePendingPlan uses the shared run activation state before execution', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({
      content: '1. Ship it',
      plan: { status: 'draft', task: 'Task' },
    });
    const session = installPendingPlanSession(provider, planMsg);
    const posted: any[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];
    let approvalStatePosts = 0;
    let runStartSessionId: string | undefined;

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.approvalsApi.postApprovalState = () => {
      approvalStatePosts += 1;
    };
    provider.loopManager.onRunStart = (sessionId?: string) => {
      runStartSessionId = sessionId;
    };
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.modeApi.setModeAndPersist = async (mode) => {
      provider.mode = mode;
    };
    provider.agent.execute = async (_callbacks, options) => {
      assert.strictEqual(options?.approvedPlan, '1. Ship it');
      return 'done';
    };
    provider.officeSync = {
      onRunStart() {},
      onRunEnd() {},
    } as any;

    await provider.runnerPlanApi.executePendingPlan('plan-1');

    assert.strictEqual(runStartSessionId, 'session-1');
    assert.strictEqual(approvalStatePosts, 2);
    assert.strictEqual(planMsg.plan?.status, 'done');
    assert.strictEqual(session.pendingPlan, undefined);
    assert.deepStrictEqual(scheduledAutosends, [{ sessionId: 'session-1', suppress: false }]);

    const processingEvents = posted.filter(message => message?.type === 'processing');
    assert.deepStrictEqual(processingEvents.map(message => message.value), [true, false]);

    const planPendingEvents = posted.filter(message => message?.type === 'planPending');
    assert.deepStrictEqual(
      planPendingEvents.map(message => [message.value, message.planMessageId]),
      [[false, '']],
    );

    const processingStartIndex = posted.findIndex(message => message?.type === 'processing' && message.value === true);
    const planPendingIndex = posted.findIndex(message => message?.type === 'planPending' && message.value === false);
    const firstUpdateIndex = posted.findIndex(message => message?.type === 'updateMessage');
    assert.ok(processingStartIndex >= 0);
    assert.ok(planPendingIndex > processingStartIndex);
    assert.ok(firstUpdateIndex > planPendingIndex);
  });

  test('executePendingPlan restores missing plan metadata before execution', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({
      content: '1. Ship it',
      plan: undefined,
    });
    const session = installPendingPlanSession(provider, planMsg);
    const posted: any[] = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.modeApi.setModeAndPersist = async (mode) => {
      provider.mode = mode;
    };
    provider.agent.execute = async (_callbacks, options) => {
      assert.deepStrictEqual(planMsg.plan, { status: 'executing', task: 'Task' });
      assert.strictEqual(options?.approvedPlan, '1. Ship it');
      return 'done';
    };
    provider.officeSync = {
      onRunStart() {},
      onRunEnd() {},
    } as any;

    await provider.runnerPlanApi.executePendingPlan('plan-1');

    assert.strictEqual(planMsg.plan?.status, 'done');
    assert.strictEqual(planMsg.plan?.task, 'Task');
    assert.strictEqual(session.pendingPlan, undefined);

    const updateEvents = posted.filter(message => message?.type === 'updateMessage' && message?.message?.id === 'plan-1');
    assert.ok(updateEvents.length >= 2);
    assert.deepStrictEqual(updateEvents[0]?.message?.plan, { status: 'draft', task: 'Task' });
  });

  test('executePendingPlan posts a turn error when the requested pending-plan target is stale', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({
      content: '1. Ship it',
      plan: { status: 'draft', task: 'Task' },
    });
    const session = installPendingPlanSession(provider, planMsg);
    const posted: any[] = [];
    let executeCalled = false;

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.execute = async () => {
      executeCalled = true;
      return 'done';
    };

    await provider.runnerPlanApi.executePendingPlan('different-id');

    assert.strictEqual(executeCalled, false);
    assertBlockedPendingPlanDirectAction({
      provider,
      session,
      expectedPendingPlan: { task: 'Task', planMessageId: 'plan-1' },
      expectedError: 'No pending plan found to execute. Try updating or generating a new plan.',
      posted,
    });
  });

  test('executePendingPlan posts a turn error when the active pending-plan target is missing', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({
      id: 'plan-live',
      content: '1. Ship it',
      plan: { status: 'draft', task: 'Task' },
    });
    const session = installPendingPlanSession(provider, planMsg, {
      task: 'Task',
      planMessageId: 'plan-missing',
    });
    const posted: any[] = [];
    let executeCalled = false;

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.execute = async () => {
      executeCalled = true;
      return 'done';
    };

    await provider.runnerPlanApi.executePendingPlan('plan-missing');

    assert.strictEqual(executeCalled, false);
    assertBlockedPendingPlanDirectAction({
      provider,
      session,
      expectedPendingPlan: { task: 'Task', planMessageId: 'plan-missing' },
      expectedError: 'No pending plan found to execute. Try updating or generating a new plan.',
      posted,
    });
  });

  test('executePendingPlan appends default assumptions when executing a needs_input plan', async () => {
    const provider = createPendingPlanController();
    const planMsg = createPendingPlanMessage({
      content: '1. Ship it',
      plan: { status: 'needs_input', task: 'Task' },
    });
    installPendingPlanSession(provider, planMsg);
    provider.webviewApi.postMessage = () => {};
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.modeApi.setModeAndPersist = async (mode) => {
      provider.mode = mode;
    };
    provider.agent.execute = async (_callbacks, options) => {
      assert.match(options?.approvedPlan || '', /## Assumptions \(auto\)/);
      assert.match(options?.approvedPlan || '', /Proceed without further clarification/);
      return 'done';
    };
    provider.officeSync = {
      onRunStart() {},
      onRunEnd() {},
    } as any;

    await provider.runnerPlanApi.executePendingPlan('plan-1');
  });

  test('executePendingPlan restores plan state and posts turn error on execution failure', async () => {
    const provider = createPendingPlanController();
    provider.mode = 'plan';
    const planMsg = createPendingPlanMessage({
      content: '1. Ship it',
      plan: { status: 'needs_input', task: 'Task' },
    });
    const session = installPendingPlanSession(provider, planMsg);
    const posted: any[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.modeApi.setModeAndPersist = async (mode) => {
      provider.mode = mode;
    };
    provider.agent.execute = async () => {
      throw new Error('execution failed');
    };
    provider.officeSync = {
      onRunStart() {},
      onRunEnd() {},
    } as any;

    await provider.runnerPlanApi.executePendingPlan('plan-1');

    assert.strictEqual(provider.mode, 'plan');
    assert.strictEqual(planMsg.plan?.status, 'needs_input');
    assert.deepStrictEqual(session.pendingPlan, { task: 'Task', planMessageId: 'plan-1' });
    assert.deepStrictEqual(scheduledAutosends, [{ sessionId: 'session-1', suppress: false }]);

    const turnStatus = posted.find(message => message?.type === 'turnStatus');
    assert.ok(turnStatus);
    assert.strictEqual(turnStatus?.turnId, 'turn-1');
    assert.strictEqual(turnStatus?.status?.type, 'error');

    const planPendingEvents = posted.filter(message => message?.type === 'planPending');
    assert.deepStrictEqual(
      planPendingEvents.map(message => [message.value, message.planMessageId]),
      [
        [false, ''],
        [true, 'plan-1'],
      ],
    );

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.match(errorMessage?.content || '', /execution failed/i);
  });

  test('handleUserMessage posts the user message before the processing signal', async () => {
    const provider = createPendingPlanController();
    installActiveSession(provider, []);
    const posted: any[] = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.runnerInputApi.isPlanFirstEnabled = () => false;
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.run = async () => 'done';

    await provider.runnerInputApi.handleUserMessage('Ship it');

    const userMessageIndex = posted.findIndex(message => message?.type === 'message' && message?.message?.role === 'user');
    const processingIndex = posted.findIndex(message => message?.type === 'processing' && message?.value === true);
    assert.ok(userMessageIndex >= 0);
    assert.ok(processingIndex > userMessageIndex);
  });

  test('handleUserMessage marks user turns memory-excluded while session memory is disabled', async () => {
    const provider = createPendingPlanController();
    installActiveSession(provider, []);
    const posted: any[] = [];

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.runnerInputApi.isPlanFirstEnabled = () => false;
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = () => {};
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.run = async () => 'done';
    setSessionMemoryMode(provider.signals, 'disabled', 'test disabled memory mode');

    await provider.runnerInputApi.handleUserMessage('This turn should stay out of transcript memory.');

    const userMessage = posted.find(message => message?.type === 'message' && message?.message?.role === 'user')?.message;
    assert.ok(userMessage);
    assert.strictEqual(userMessage.memoryExcluded, true);
    assert.strictEqual(provider.messages.find(message => message.role === 'user')?.memoryExcluded, true);

    await provider.runnerInputApi.handleUserMessage('Enable memory for this session again.');

    const enableMessage = provider.messages.filter(message => message.role === 'user').at(-1);
    assert.strictEqual(enableMessage?.memoryExcluded, true);
    assert.strictEqual(isSessionMemoryDisabled(provider.signals), false);
  });

  test('handleUserMessage clears stale abort state before ordinary execution failures', async () => {
    const provider = createPendingPlanController();
    const stepMsg: ChatMessage = {
      id: 'step-1',
      role: 'step',
      content: 'Running step',
      timestamp: Date.now(),
      step: {
        index: 1,
        status: 'running',
      },
    };
    installActiveSession(provider, [stepMsg]);
    provider.activeStepId = stepMsg.id;
    provider.abortRequested = true;

    const posted: any[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];
    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.runnerInputApi.isPlanFirstEnabled = () => false;
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.run = async () => {
      throw new Error('run failed');
    };
    provider.agent.continue = async () => {
      throw new Error('run failed');
    };

    await provider.runnerInputApi.handleUserMessage('Ship it');

    const userMsg = provider.messages.find(message => message.role === 'user');
    assert.ok(userMsg?.id);

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.match(errorMessage?.content || '', /run failed/i);
    assert.strictEqual(errorMessage?.turnId, userMsg?.id);
    assert.strictEqual(stepMsg.step?.status, 'error');

    const stepUpdate = posted.find(message => message?.type === 'updateMessage' && message?.message?.id === stepMsg.id);
    assert.ok(stepUpdate);

    const turnStatus = posted.find(message => message?.type === 'turnStatus');
    assert.ok(turnStatus);
    assert.strictEqual(turnStatus?.turnId, userMsg?.id);
    assert.strictEqual(turnStatus?.status?.type, 'error');
    assert.strictEqual(scheduledAutosends.at(-1)?.suppress, false);
    assert.strictEqual(provider.abortRequested, false);
  });

  test('handleUserMessage treats canonical abort text as cancellation without posting turn done', async () => {
    const provider = createPendingPlanController();
    const stepMsg: ChatMessage = {
      id: 'step-1',
      role: 'step',
      content: 'Running step',
      timestamp: Date.now(),
      step: {
        index: 1,
        status: 'running',
      },
    };
    installActiveSession(provider, [stepMsg]);
    provider.activeStepId = stepMsg.id;

    const posted: any[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];
    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.runnerInputApi.isPlanFirstEnabled = () => false;
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.run = async () => {
      throw new Error('Agent aborted');
    };
    provider.agent.continue = async () => {
      throw new Error('Agent aborted');
    };

    await provider.runnerInputApi.handleUserMessage('Ship it');

    const turnStatus = posted.find(message => message?.type === 'turnStatus');
    assert.strictEqual(turnStatus, undefined);
    assert.strictEqual(scheduledAutosends.at(-1)?.suppress, true);
    assert.strictEqual(stepMsg.step?.status, 'canceled');

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.strictEqual((errorMessage?.content || '').trim(), 'Agent aborted');
  });

  test('handleUserMessage treats explicit user aborts as cancellation without posting turn done', async () => {
    const provider = createPendingPlanController();
    const stepMsg: ChatMessage = {
      id: 'step-1',
      role: 'step',
      content: 'Running step',
      timestamp: Date.now(),
      step: {
        index: 1,
        status: 'running',
      },
    };
    installActiveSession(provider, [stepMsg]);
    provider.activeStepId = stepMsg.id;

    const posted: any[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];
    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.runnerInputApi.isPlanFirstEnabled = () => false;
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.run = async () => {
      provider.abortRequested = true;
      throw new Error('request canceled');
    };
    provider.agent.continue = async () => {
      provider.abortRequested = true;
      throw new Error('request canceled');
    };

    await provider.runnerInputApi.handleUserMessage('Ship it');

    const turnStatus = posted.find(message => message?.type === 'turnStatus');
    assert.strictEqual(turnStatus, undefined);
    assert.strictEqual(scheduledAutosends.at(-1)?.suppress, true);
    assert.strictEqual(stepMsg.step?.status, 'canceled');

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.match((errorMessage?.content || '').trim(), /request canceled/i);
  });

  test('retryToolCall uses shared run failure handling for resume errors', async () => {
    const stepMsg: ChatMessage = {
      id: 'step-1',
      role: 'step',
      content: 'Running step',
      timestamp: Date.now(),
      turnId: 'turn-1',
      step: {
        index: 1,
        status: 'running',
      },
    };
    const toolMsg: ChatMessage = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      turnId: 'turn-1',
      toolCall: {
        id: 'bash',
        name: 'bash',
        args: '{}',
        status: 'error',
        approvalId: 'approval-1',
      },
    };
    const provider = createPendingPlanController();
    installActiveSession(provider, [stepMsg, toolMsg]);
    provider.activeStepId = stepMsg.id;

    const posted: any[] = [];
    const scheduledAutosends: Array<{ sessionId: string; suppress?: boolean }> = [];
    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(JSON.parse(JSON.stringify(message)));
    };
    provider.loopManager.onRunStart = () => {};
    provider.loopManager.onRunEnd = () => {};
    provider.queueManager.scheduleAutosendForSession = (sessionId: string, options?: { suppress?: boolean }) => {
      scheduledAutosends.push({ sessionId, suppress: options?.suppress });
    };
    provider.runnerCallbacksApi.createAgentCallbacks = () => ({}) as any;
    provider.agent.resume = async () => {
      throw new Error('resume failed');
    };

    await provider.runnerInputApi.retryToolCall('approval-1');

    const errorMessage = provider.messages.find(message => message.role === 'error');
    assert.ok(errorMessage);
    assert.match(errorMessage?.content || '', /resume failed/i);
    assert.strictEqual(errorMessage?.turnId, 'turn-1');
    assert.strictEqual(stepMsg.step?.status, 'error');

    const stepUpdate = posted.find(message => message?.type === 'updateMessage' && message?.message?.id === stepMsg.id);
    assert.ok(stepUpdate);

    const turnStatus = posted.find(message => message?.type === 'turnStatus');
    assert.ok(turnStatus);
    assert.strictEqual(turnStatus?.turnId, 'turn-1');
    assert.strictEqual(turnStatus?.status?.type, 'error');
    assert.strictEqual(scheduledAutosends.at(-1)?.suppress, false);
  });
});
