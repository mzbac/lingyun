import type { LingyunSession, LingyunThreadGoal } from '@kooka/agent-sdk';

import type { ToolContext, ToolDefinition, ToolResult } from '../../core/types';

const MAX_GOAL_OBJECTIVE_CHARS = 4000;

type GoalResponse = {
  goal: LingyunThreadGoal | null;
  remainingTokens?: number;
  completionBudgetReport?: string;
};

function requireSession(context: ToolContext): LingyunSession {
  if (!context.agentSession) {
    throw new Error('Goal tools require an active agent session.');
  }
  return context.agentSession;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function goalResponse(goal: LingyunThreadGoal | undefined, options?: { includeCompletionReport?: boolean }): GoalResponse {
  const response: GoalResponse = { goal: goal ? { ...goal } : null };
  if (goal?.tokenBudget) {
    response.remainingTokens = Math.max(0, goal.tokenBudget - goal.tokensUsed);
  }
  if (options?.includeCompletionReport && goal?.status === 'complete') {
    const parts: string[] = [];
    if (goal.tokenBudget) {
      parts.push(`tokens used: ${goal.tokensUsed} of ${goal.tokenBudget}`);
    }
    if (goal.timeUsedSeconds > 0) {
      parts.push(`time used: ${goal.timeUsedSeconds} seconds`);
    }
    if (parts.length > 0) {
      response.completionBudgetReport = `Goal achieved. Report final budget usage to the user: ${parts.join('; ')}.`;
    }
  }
  return response;
}

function success(data: GoalResponse): ToolResult {
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
  description: 'Get the current goal for this session, including status, budgets, token and elapsed-time usage, and remaining token budget.',
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
    'Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks. Fails if a goal already exists; use update_goal only for completion.',
  parameters: {
    type: 'object',
    properties: {
      objective: {
        type: 'string',
        description: 'Required. The concrete objective to start pursuing.',
      },
      token_budget: {
        type: 'number',
        description: 'Optional positive token budget for the new active goal.',
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
    'Update the existing goal. Use this tool only to mark the goal achieved. Set status to complete only when the objective has actually been achieved and no required work remains.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['complete'],
        description: 'Required. Set to complete only when the objective is achieved and no required work remains.',
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
  return success(goalResponse(session.threadGoal));
}

export async function createGoalHandler(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const session = requireSession(context);
  if (session.threadGoal) {
    return {
      success: false,
      error: 'cannot create a new goal because this session already has a goal; use update_goal only when the existing goal is complete',
    };
  }

  const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
  if (!objective) {
    return { success: false, error: 'objective is required' };
  }
  if ([...objective].length > MAX_GOAL_OBJECTIVE_CHARS) {
    return { success: false, error: `objective must be at most ${MAX_GOAL_OBJECTIVE_CHARS} characters` };
  }

  const tokenBudget = positiveInteger(args.token_budget);
  const now = Date.now();
  const goal: LingyunThreadGoal = {
    id: crypto.randomUUID(),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    objective,
    status: 'active',
    ...(tokenBudget ? { tokenBudget } : {}),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
  };
  session.threadGoal = goal;
  return success(goalResponse(goal));
}

export async function updateGoalHandler(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const session = requireSession(context);
  if (args.status !== 'complete') {
    return {
      success: false,
      error: 'update_goal can only mark the existing goal complete; pause, resume, and budget-limited status changes are controlled by the user',
    };
  }

  const goal = session.threadGoal;
  if (!goal) {
    return { success: false, error: 'cannot update goal because this session has no goal' };
  }

  goal.status = 'complete';
  goal.updatedAt = Date.now();
  return success(goalResponse(goal, { includeCompletionReport: true }));
}
