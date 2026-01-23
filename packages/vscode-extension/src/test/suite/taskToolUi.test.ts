import * as assert from 'assert';
import { ChatViewProvider } from '../../ui/chat';
import type { ToolCall, ToolResult } from '../../core/types';
import type { ChatMessage } from '../../ui/chat/types';

suite('Task tool UI', () => {
  test('renders task tool result text and upserts child session', () => {
    const provider = Object.create(ChatViewProvider.prototype) as ChatViewProvider;

    provider.mode = 'build';
    provider.currentModel = 'mock-model';
    provider.stepCounter = 0;
    provider.currentTurnId = 'turn-1';
    provider.activeStepId = undefined;

    provider.messages = [];
    provider.sessions = new Map();
    provider.toolDiffBeforeByToolCallId = new Map();
    provider.toolDiffSnapshotsByToolCallId = new Map();

    const posted: any[] = [];
    const dirty: string[] = [];
    let flushed = false;

    provider.postMessage = (message: unknown) => {
      posted.push(message);
    };
    provider.postSessions = () => {};
    provider.markSessionDirty = (sessionId: string) => {
      dirty.push(sessionId);
    };
    provider.flushSessionSave = async () => {
      flushed = true;
    };
    provider.isSessionPersistenceEnabled = () => false;
    provider.normalizeLoadedSession = (raw: any) => raw;
    provider.getContextForUI = () => ({}) as any;

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

    const callbacks = provider.createAgentCallbacks();

    const tc: ToolCall = {
      id: 'call_task',
      type: 'function',
      function: { name: 'task', arguments: '{}' },
    };

    const result: ToolResult = {
      success: true,
      data: {
        session_id: 'child-1',
        subagent_type: 'general',
        text: 'subagent answer',
      },
      metadata: {
        task: {
          session_id: 'child-1',
          model_warning: 'Subagent model fallback warning',
        },
        childSession: {
          id: 'child-1',
          title: 'Child session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          agentState: {},
          currentModel: 'mock-model',
          mode: 'build',
          stepCounter: 0,
        },
      },
    };

    callbacks.onToolResult?.(tc, result);

    assert.strictEqual(toolMsg.toolCall?.status, 'success');
    assert.strictEqual(toolMsg.toolCall?.result, 'subagent answer');

    assert.ok(provider.sessions.has('child-1'), 'expected child session to be added to sessions map');
    assert.ok(dirty.includes('child-1'), 'expected child session to be marked dirty');
    assert.strictEqual(flushed, true, 'expected session save flush to be triggered');

    const warning = provider.messages.find((m) => m.role === 'warning');
    assert.ok(warning, 'expected a warning chat message');
    assert.strictEqual(warning!.content, 'Subagent model fallback warning');
    assert.ok(posted.some((m: any) => m?.type === 'updateTool'), 'expected updateTool to be posted');
  });
});

