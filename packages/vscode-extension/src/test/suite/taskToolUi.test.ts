import * as assert from 'assert';
import type { ToolCall, ToolResult } from '../../core/types';
import type { ChatMessage } from '../../ui/chat/types';
import { createBlankSessionSignals } from '../../core/sessionSignals';
import { createStandaloneChatController } from './chatControllerHarness';

suite('Task tool UI', () => {
  function createTaskToolHarness() {
    const provider = createStandaloneChatController();

    provider.mode = 'build';
    provider.currentModel = 'mock-model';
    provider.stepCounter = 0;
    provider.activeSessionId = 'parent-1';
    provider.currentTurnId = 'turn-1';
    provider.activeStepId = undefined;
    provider.signals = createBlankSessionSignals();

    provider.messages = [];
    provider.sessions = new Map();
    provider.toolDiffBeforeByToolCallId = new Map();
    provider.toolDiffSnapshotsByToolCallId = new Map();

    const posted: any[] = [];
    const dirty: string[] = [];
    let flushed = false;

    provider.webviewApi.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.sessionApi.postSessions = () => {};
    provider.sessionApi.markSessionDirty = (sessionId: string) => {
      dirty.push(sessionId);
    };
    provider.sessionApi.flushSessionSave = async () => {
      flushed = true;
    };
    provider.sessionApi.isSessionPersistenceEnabled = () => false;
    provider.sessionApi.getContextForUI = () => ({}) as any;

    const toolMsg: ChatMessage = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      turnId: provider.currentTurnId,
      toolCall: {
        id: 'task',
        name: 'Task',
        args: '{}',
        status: 'running',
        approvalId: 'call_task',
        result: '',
      },
    };
    provider.messages.push(toolMsg);

    const callbacks = provider.runnerCallbacksApi.createAgentCallbacks();
    const tc: ToolCall = {
      id: 'call_task',
      type: 'function',
      function: { name: 'task', arguments: '{}' },
    };

    return {
      provider,
      posted,
      dirty,
      get flushed() {
        return flushed;
      },
      toolMsg,
      callbacks,
      tc,
    };
  }

  test('upserts child session from agent-sdk snapshot metadata', () => {
    const harness = createTaskToolHarness();
    const { provider, posted, dirty, toolMsg, callbacks, tc } = harness;

    const result: ToolResult = {
      success: true,
      data: {
        session_id: 'child-1',
        subagent_type: 'general',
        text: 'subagent answer',
      },
      metadata: {
        title: 'Child task',
        outputText:
          'subagent answer\n\n<task_metadata>\n' +
          'session_id: child-1\n' +
          '</task_metadata>',
        task: {
          description: 'Child task',
          session_id: 'child-1',
          model_warning: 'Subagent model fallback warning',
        },
        childSession: {
          version: 1,
          savedAt: new Date().toISOString(),
          sessionId: 'child-1',
          parentSessionId: 'parent-1',
          subagentType: 'general',
          modelId: 'mock-model',
          history: [
            { id: 'u1', role: 'user', parts: [] },
            { id: 'a1', role: 'assistant', parts: [] },
          ],
          pendingPlan: undefined,
          fileHandles: { nextId: 1, byId: {} },
          semanticHandles: { nextMatchId: 1, nextSymbolId: 1, nextLocId: 1, matches: {}, symbols: {}, locations: {} },
        },
      },
    };

    callbacks.onToolResult?.(tc, result);

    assert.strictEqual(toolMsg.toolCall?.status, 'success');
    assert.strictEqual(toolMsg.toolCall?.taskSessionId, 'child-1');
    assert.ok(provider.sessions.has('child-1'), 'expected child session to be added to sessions map');

    const child = provider.sessions.get('child-1')!;
    assert.strictEqual(child.parentSessionId, 'parent-1');
    assert.strictEqual(child.subagentType, 'general');
    assert.ok(Array.isArray(child.agentState?.history));
    assert.strictEqual(child.agentState.history.length, 2);

    assert.ok(dirty.includes('child-1'), 'expected child session to be marked dirty');
    assert.strictEqual(harness.flushed, true, 'expected session save flush to be triggered');

    const warning = provider.messages.find((m) => m.role === 'warning');
    assert.ok(warning, 'expected a warning chat message');
    assert.strictEqual(warning!.content, 'Subagent model fallback warning');
    assert.ok(posted.some((m: any) => m?.type === 'updateTool'), 'expected updateTool to be posted');
  });

  test('upserts child session when optional snapshot fields are malformed', () => {
    const { provider, toolMsg, callbacks, tc } = createTaskToolHarness();

    const result: ToolResult = {
      success: true,
      data: {
        session_id: 'child-2',
        subagent_type: 'general',
        text: 'subagent answer',
      },
      metadata: {
        task: {
          description: 'Child task',
        },
        childSession: {
          version: 1,
          savedAt: new Date().toISOString(),
          sessionId: 'child-2',
          parentSessionId: 'parent-1',
          subagentType: 'general',
          modelId: 'mock-model',
          history: [
            { id: 'u1', role: 'user', parts: [] },
          ],
          mentionedSkills: ['skill-1', 42, '', '  skill-2  ', 'skill-1', '   '],
          compactionSyntheticContexts: [
            { transientContext: 'memoryRecall', text: 'remember me' },
            { transientContext: 'invalid', text: 'drop me' },
          ],
          fileHandles: { nextId: 'bad', byId: { F1: 'src/index.ts' } },
          semanticHandles: { nextMatchId: 1, nextSymbolId: 1, nextLocId: 1, matches: {}, symbols: {}, locations: {} },
        },
      },
    };

    callbacks.onToolResult?.(tc, result);

    assert.strictEqual(toolMsg.toolCall?.taskSessionId, 'child-2');
    const child = provider.sessions.get('child-2');
    assert.ok(child, 'expected child session to be added to sessions map');
    assert.deepStrictEqual(child?.agentState.mentionedSkills, ['skill-1', 'skill-2']);
    assert.deepStrictEqual(child?.agentState.compactionSyntheticContexts, [
      { transientContext: 'memoryRecall', text: 'remember me' },
    ]);
    assert.strictEqual(child?.agentState.fileHandles, undefined);
    assert.deepStrictEqual(child?.agentState.semanticHandles, {
      nextMatchId: 1,
      nextSymbolId: 1,
      nextLocId: 1,
      matches: {},
      symbols: {},
      locations: {},
    });
  });
});
