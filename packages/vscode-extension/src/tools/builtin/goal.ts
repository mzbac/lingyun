import {
  createThreadGoalToolResponse,
  resolveThreadGoalStatusAfterBudgetLimit,
  type LingyunSession,
  type LingyunThreadGoal,
} from '@kooka/agent-sdk';

import type { ToolContext, ToolDefinition, ToolResult } from '../../core/types';

const MAX_GOAL_OBJECTIVE_CHARS = 4000;

function requireSession(context: ToolContext): LingyunSession {
  if (!context.agentSession) {
    throw new Error('Goal tools require an active agent session.');
  }
  return context.agentSession;
}

function toolThreadId(context: ToolContext, session: LingyunSession): string | undefined {
  return session.sessionId ?? context.sessionId;
}

function readPositiveIntegerArg(value: unknown): { ok: true; value?: number } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, error: 'goal budgets must be positive integers when provided' };
  }
  return { ok: true, value };
}

function success(data: ReturnType<typeof createThreadGoalToolResponse>): ToolResult {
  return {
    success: true,
    data,
    metadata: {
      outputText: JSON.stringify(data, null, 2),
    },
  };
}

export const getGoalTool: ToolDefinition = {
  id: 'get_goal',
  name: 'Get Goal',
  description: 'Get the current goal for this thread, including status, budgets, token and elapsed-time usage, and remaining token budget.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execution: { type: 'function', handler: 'builtin.goal.get' },
  metadata: {
    permission: 'goal',
    readOnly: true,
  },
};

export const createGoalTool: ToolDefinition = {
  id: 'create_goal',
  name: 'Create Goal',
  description:
    'Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks.\nSet token_budget only when an explicit token budget is requested. Fails if a goal exists; use update_goal only for status.',
  parameters: {
    type: 'object',
    properties: {
      objective: {
        type: 'string',
        description:
          'Required. The concrete objective to start pursuing. This starts a new active goal only when no goal is currently defined; if a goal already exists, this tool fails.',
      },
      token_budget: {
        type: 'integer',
        description: 'Optional positive integer token budget for the new active goal.',
      },
    },
    required: ['objective'],
  },
  execution: { type: 'function', handler: 'builtin.goal.create' },
  metadata: {
    permission: 'goal',
    readOnly: false,
  },
};

export const updateGoalTool: ToolDefinition = {
  id: 'update_goal',
  name: 'Update Goal',
  description:
    'Update the existing goal.\nUse this tool only to mark the goal achieved or genuinely blocked.\nSet status to `complete` only when the objective has actually been achieved and no required work remains.\nSet status to `blocked` only when the same blocking condition has repeated for at least three consecutive goal turns, counting the original/user-triggered turn and any automatic continuations, and the agent cannot make meaningful progress without user input or an external-state change.\nIf the user resumes a goal that was previously marked `blocked`, treat the resumed run as a fresh blocked audit. If the same blocking condition then repeats for at least three consecutive resumed goal turns, set status to `blocked` again.\nOnce the blocked threshold is satisfied, do not keep reporting that you are still blocked while leaving the goal active; set status to `blocked`.\nDo not use `blocked` merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification.\nDo not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work.\nYou cannot use this tool to pause, resume, budget-limit, or usage-limit a goal; those status changes are controlled by the user or system.\nWhen marking a budgeted goal achieved with status `complete`, report the final token usage from the tool result to the user.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['complete', 'blocked'],
        description:
          'Required. Set to `complete` only when the objective is achieved and no required work remains. Set to `blocked` only after the same blocking condition has recurred for at least three consecutive goal turns and the agent is at an impasse. After a previously blocked goal is resumed, the resumed run starts a fresh blocked audit.',
      },
    },
    required: ['status'],
  },
  execution: { type: 'function', handler: 'builtin.goal.update' },
  metadata: {
    permission: 'goal',
    readOnly: false,
  },
};

export async function getGoalHandler(_args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const session = requireSession(context);
  return success(createThreadGoalToolResponse(session.threadGoal, { threadId: toolThreadId(context, session) }));
}

export async function createGoalHandler(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const session = requireSession(context);
  if (session.threadGoal) {
    return {
      success: false,
      error: 'cannot create a new goal because this thread already has a goal; use update_goal only when the existing goal is complete',
    };
  }

  const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
  if (!objective) {
    return { success: false, error: 'objective is required' };
  }
  if ([...objective].length > MAX_GOAL_OBJECTIVE_CHARS) {
    return { success: false, error: `objective must be at most ${MAX_GOAL_OBJECTIVE_CHARS} characters` };
  }

  const tokenBudgetArg = readPositiveIntegerArg(args.token_budget);
  if (!tokenBudgetArg.ok) {
    return { success: false, error: tokenBudgetArg.error };
  }
  const now = Date.now();
  const threadId = toolThreadId(context, session);
  const goal: LingyunThreadGoal = {
    id: crypto.randomUUID(),
    ...(threadId ? { sessionId: threadId } : {}),
    objective,
    status: 'active',
    ...(tokenBudgetArg.value ? { tokenBudget: tokenBudgetArg.value } : {}),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
  };
  session.threadGoal = goal;
  return success(createThreadGoalToolResponse(goal, { threadId }));
}

export async function updateGoalHandler(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const session = requireSession(context);
  if (args.status !== 'complete' && args.status !== 'blocked') {
    return {
      success: false,
      error:
        'update_goal can only mark the existing goal complete or blocked; pause, resume, budget-limited, and usage-limited status changes are controlled by the user or system',
    };
  }

  const goal = session.threadGoal;
  if (!goal) {
    return { success: false, error: 'cannot update goal because this thread has no goal' };
  }

  goal.status = resolveThreadGoalStatusAfterBudgetLimit({
    currentStatus: goal.status,
    requestedStatus: args.status,
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
  });
  goal.updatedAt = Date.now();
  return success(
    createThreadGoalToolResponse(goal, {
      includeCompletionReport: goal.status === 'complete',
      threadId: toolThreadId(context, session),
    }),
  );
}
