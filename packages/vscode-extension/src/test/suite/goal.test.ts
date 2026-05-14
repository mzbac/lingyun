import * as assert from 'assert';
import * as vscode from 'vscode';

import { LingyunSession } from '@kooka/agent-sdk';

import type { ToolContext } from '../../core/types';
import { createGoalHandler, getGoalHandler, updateGoalHandler } from '../../tools/builtin/goal';
import { formatGoalSummary, parseGoalSlashCommand } from '../../ui/chat/goals';

function createToolContext(agentSession: LingyunSession): ToolContext {
  return {
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
    activeEditor: vscode.window.activeTextEditor,
    extensionContext: {} as unknown as vscode.ExtensionContext,
    cancellationToken: new vscode.CancellationTokenSource().token,
    progress: { report: () => {} },
    log: () => {},
    agentSession,
  };
}

suite('Goal Command', () => {
  test('parses summary, status, and token-budget objective commands', () => {
    assert.deepStrictEqual(parseGoalSlashCommand('/goal'), { kind: 'summary' });
    assert.deepStrictEqual(parseGoalSlashCommand('/goal pause'), { kind: 'setStatus', status: 'paused' });
    assert.deepStrictEqual(parseGoalSlashCommand('/goal resume'), { kind: 'setStatus', status: 'active' });
    assert.deepStrictEqual(parseGoalSlashCommand('/goal --tokens 98.5K ship the feature'), {
      kind: 'setObjective',
      objective: 'ship the feature',
      tokenBudget: 98500,
    });
    assert.deepStrictEqual(parseGoalSlashCommand('/goal ship --token-budget=2M feature'), {
      kind: 'setObjective',
      objective: 'ship feature',
      tokenBudget: 2_000_000,
    });
  });

  test('rejects invalid token budgets', () => {
    assert.throws(
      () => parseGoalSlashCommand('/goal --tokens zero ship it'),
      /Goal token budget must be a positive number/,
    );
  });

  test('formats goal summaries with compact usage', () => {
    const summary = formatGoalSummary({
      id: 'goal-1',
      objective: 'Finish the release',
      status: 'active',
      tokenBudget: 100_000,
      tokensUsed: 1_500,
      timeUsedSeconds: 90,
      createdAt: 1,
      updatedAt: 1,
    });

    assert.match(summary, /Status: active/);
    assert.match(summary, /Objective: Finish the release/);
    assert.match(summary, /Tokens used: 1.5K/);
    assert.match(summary, /Token budget: 100K/);
  });
});

suite('Goal Tools', () => {
  test('create, read, and complete the active session goal', async () => {
    const session = new LingyunSession({ sessionId: 'session-1' });
    const context = createToolContext(session);

    const created = await createGoalHandler({ objective: 'Ship the goal tool', token_budget: 1000 }, context);
    assert.strictEqual(created.success, true);
    assert.strictEqual(session.threadGoal?.objective, 'Ship the goal tool');
    assert.strictEqual(session.threadGoal?.status, 'active');
    assert.strictEqual(session.threadGoal?.tokenBudget, 1000);

    session.threadGoal!.tokensUsed = 250;
    const current = await getGoalHandler({}, context);
    assert.strictEqual(current.success, true);
    assert.strictEqual((current.data as any)?.remainingTokens, 750);

    const completed = await updateGoalHandler({ status: 'complete' }, context);
    assert.strictEqual(completed.success, true);
    assert.strictEqual(session.threadGoal?.status, 'complete');
    assert.match(String((completed.data as any)?.completionBudgetReport || ''), /tokens used: 250 of 1000/);
  });

  test('does not create a second goal over an existing one', async () => {
    const session = new LingyunSession({ sessionId: 'session-2' });
    const context = createToolContext(session);

    const first = await createGoalHandler({ objective: 'First goal' }, context);
    assert.strictEqual(first.success, true);

    const second = await createGoalHandler({ objective: 'Second goal' }, context);
    assert.strictEqual(second.success, false);
    assert.match(String(second.error || ''), /already has a goal/);
    assert.strictEqual(session.threadGoal?.objective, 'First goal');
  });
});
