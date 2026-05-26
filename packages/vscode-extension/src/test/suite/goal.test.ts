import * as assert from 'assert';
import * as vscode from 'vscode';

import { LingyunSession } from '@kooka/agent-sdk';

import type { ToolContext } from '../../core/types';
import { createGoalHandler, createGoalTool, getGoalHandler, updateGoalHandler } from '../../tools/builtin/goal';
import {
  createBudgetLimitedPrompt,
  createGoalContinuationPrompt,
  formatGoalSummary,
  parseGoalSlashCommand,
} from '../../ui/chat/goals';

function createToolContext(agentSession: LingyunSession, sessionId?: string): ToolContext {
  return {
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
    activeEditor: vscode.window.activeTextEditor,
    extensionContext: {} as unknown as vscode.ExtensionContext,
    cancellationToken: new vscode.CancellationTokenSource().token,
    progress: { report: () => {} },
    log: () => {},
    ...(sessionId ? { sessionId } : {}),
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

  test('formats stopped goal statuses like Codex', () => {
    const blockedSummary = formatGoalSummary({
      id: 'goal-1',
      objective: 'Wait for input',
      status: 'blocked',
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    assert.match(blockedSummary, /Status: blocked/);
    assert.match(blockedSummary, /Commands: `\/goal edit`, `\/goal resume`, `\/goal clear`/);

    const budgetSummary = formatGoalSummary({
      id: 'goal-2',
      objective: 'Stay within budget',
      status: 'budgetLimited',
      tokenBudget: 1000,
      tokensUsed: 1250,
      timeUsedSeconds: 7200,
      createdAt: 1,
      updatedAt: 1,
    });
    assert.match(budgetSummary, /Status: limited by budget/);
    assert.match(budgetSummary, /Time used: 2h/);
    assert.match(budgetSummary, /Commands: `\/goal edit`, `\/goal clear`/);
  });

  test('creates Codex-aligned continuation and budget prompts', () => {
    const goal = {
      id: 'goal-1',
      objective: 'Ship & verify <goal>',
      status: 'active' as const,
      tokenBudget: 1000,
      tokensUsed: 250,
      timeUsedSeconds: 90,
      createdAt: 1,
      updatedAt: 1,
    };

    const continuation = createGoalContinuationPrompt(goal);
    assert.match(continuation, /<objective>\nShip &amp; verify &lt;goal&gt;\n<\/objective>/);
    assert.match(continuation, /Work from evidence:/);
    assert.match(continuation, /Completion audit:/);
    assert.match(continuation, /Blocked audit:/);
    assert.match(continuation, /update_goal with status "blocked"/);

    const budget = createBudgetLimitedPrompt({ ...goal, status: 'budgetLimited' });
    assert.match(budget, /The active thread goal has reached its token budget\./);
    assert.match(budget, /- Time spent pursuing goal: 90 seconds/);
    assert.match(budget, /The system has marked the goal as budget_limited/);
    assert.match(budget, /Do not call update_goal unless the goal is actually complete\./);
  });
});

suite('Goal Tools', () => {
  test('exposes Codex-aligned create_goal token budget schema', () => {
    assert.strictEqual(createGoalTool.parameters.properties.token_budget.type, 'integer');
  });

  test('get_goal returns explicit null budget fields without a goal', async () => {
    const session = new LingyunSession({ sessionId: 'session-empty' });
    const current = await getGoalHandler({}, createToolContext(session));

    assert.strictEqual(current.success, true);
    assert.deepStrictEqual(current.data, {
      goal: null,
      remainingTokens: null,
      completionBudgetReport: null,
    });
  });

  test('create, read, and complete the active session goal', async () => {
    const session = new LingyunSession({ sessionId: 'session-1' });
    const context = createToolContext(session);

    const created = await createGoalHandler({ objective: 'Ship the goal tool', token_budget: 1000 }, context);
    assert.strictEqual(created.success, true);
    assert.strictEqual(session.threadGoal?.objective, 'Ship the goal tool');
    assert.strictEqual(session.threadGoal?.status, 'active');
    assert.strictEqual(session.threadGoal?.tokenBudget, 1000);
    assert.strictEqual((created.data as any)?.goal?.threadId, 'session-1');
    assert.strictEqual((created.data as any)?.goal?.id, undefined);
    assert.strictEqual((created.data as any)?.goal?.sessionId, undefined);
    assert.strictEqual((created.data as any)?.remainingTokens, 1000);
    assert.strictEqual((created.data as any)?.completionBudgetReport, null);

    session.threadGoal!.tokensUsed = 250;
    const current = await getGoalHandler({}, context);
    assert.strictEqual(current.success, true);
    assert.strictEqual((current.data as any)?.remainingTokens, 750);

    const completed = await updateGoalHandler({ status: 'complete' }, context);
    assert.strictEqual(completed.success, true);
    assert.strictEqual(session.threadGoal?.status, 'complete');
    assert.match(String((completed.data as any)?.completionBudgetReport || ''), /Report final usage from this tool result's structured goal fields/);
  });

  test('uses tool context session id as the response thread id fallback', async () => {
    const session = new LingyunSession();
    const context = createToolContext(session, 'host-session-1');

    const created = await createGoalHandler({ objective: 'Ship the goal tool' }, context);
    assert.strictEqual(created.success, true);
    assert.strictEqual(session.threadGoal?.sessionId, 'host-session-1');
    assert.strictEqual((created.data as any)?.goal?.threadId, 'host-session-1');
    assert.notStrictEqual((created.data as any)?.goal?.threadId, session.threadGoal?.id);

    const current = await getGoalHandler({}, context);
    assert.strictEqual((current.data as any)?.goal?.threadId, 'host-session-1');
  });

  test('can mark an existing goal blocked', async () => {
    const session = new LingyunSession({ sessionId: 'session-blocked' });
    const context = createToolContext(session);

    const created = await createGoalHandler({ objective: 'Wait for external unblock' }, context);
    assert.strictEqual(created.success, true);

    const blocked = await updateGoalHandler({ status: 'blocked' }, context);
    assert.strictEqual(blocked.success, true);
    assert.strictEqual(session.threadGoal?.status, 'blocked');
    assert.strictEqual((blocked.data as any)?.remainingTokens, null);
    assert.strictEqual((blocked.data as any)?.completionBudgetReport, null);
  });

  test('preserves budget-limited status when blocked status is requested', async () => {
    const session = new LingyunSession({
      sessionId: 'session-budget-blocked',
      threadGoal: {
        id: 'goal-budget-blocked',
        objective: 'Stay inside the budget',
        status: 'budgetLimited',
        tokenBudget: 50,
        tokensUsed: 55,
        timeUsedSeconds: 3,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const context = createToolContext(session);

    const blocked = await updateGoalHandler({ status: 'blocked' }, context);
    assert.strictEqual(blocked.success, true);
    assert.strictEqual(session.threadGoal?.status, 'budgetLimited');
    assert.strictEqual((blocked.data as any)?.goal?.status, 'budgetLimited');
    assert.strictEqual((blocked.data as any)?.completionBudgetReport, null);
  });

  test('rejects invalid tool token budgets', async () => {
    const session = new LingyunSession({ sessionId: 'session-invalid-budget' });
    const context = createToolContext(session);

    const zero = await createGoalHandler({ objective: 'Invalid budget', token_budget: 0 }, context);
    assert.strictEqual(zero.success, false);
    assert.match(String(zero.error || ''), /positive integers/);
    assert.strictEqual(session.threadGoal, undefined);

    const fractional = await createGoalHandler({ objective: 'Invalid budget', token_budget: 1.5 }, context);
    assert.strictEqual(fractional.success, false);
    assert.match(String(fractional.error || ''), /positive integers/);
    assert.strictEqual(session.threadGoal, undefined);
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
