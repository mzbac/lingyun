import type { ToolDefinition, ToolHandler } from '../../core/types';
import { writeTodos, type TodoItem } from '../../core/todo';

type TodoInput = {
  todos: Array<Partial<TodoItem> & { content?: unknown }>;
};

function normalizeTodos(value: unknown): TodoItem[] | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'Invalid args: expected an object' };
  const input = value as TodoInput;
  if (!Array.isArray(input.todos)) return { error: 'Invalid args: todos must be an array' };

  const out: TodoItem[] = [];
  for (const raw of input.todos) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : crypto.randomUUID();
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!content) continue;

    const statusRaw = typeof item.status === 'string' ? item.status.trim() : 'pending';
    const status: TodoItem['status'] =
      statusRaw === 'in_progress' || statusRaw === 'completed' || statusRaw === 'cancelled'
        ? statusRaw
        : 'pending';

    const priorityRaw = typeof item.priority === 'string' ? item.priority.trim() : 'medium';
    const priority: TodoItem['priority'] =
      priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'medium';

    out.push({ id, content, status, priority });
  }

  return out;
}

export const todowriteTool: ToolDefinition = {
  id: 'todowrite',
  name: 'Todo (Write)',
  description:
    'Replace the current todo list for this LingYun session. Use this to track the plan and progress (pending/in_progress/completed/cancelled).',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Full todo list (overwrites existing).',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique identifier for the todo item' },
            content: { type: 'string', description: 'Brief description of the task' },
            status: {
              type: 'string',
              description: 'pending | in_progress | completed | cancelled',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
            },
            priority: {
              type: 'string',
              description: 'high | medium | low',
              enum: ['high', 'medium', 'low'],
            },
          },
          required: ['content', 'status', 'priority', 'id'],
        },
      },
    },
    required: ['todos'],
  },
  execution: { type: 'function', handler: 'builtin.todowrite' },
  metadata: {
    category: 'planning',
    icon: 'checklist',
    requiresApproval: false,
    permission: 'todowrite',
    readOnly: false,
  },
};

export const todowriteHandler: ToolHandler = async (args, context) => {
  const sessionId = context.sessionId?.trim();
  if (!sessionId) {
    return { success: false, error: 'Missing sessionId; cannot persist todos.' };
  }

  const normalized = normalizeTodos(args);
  if ('error' in normalized) {
    return { success: false, error: normalized.error };
  }

  await writeTodos(context.extensionContext, sessionId, normalized);
  return { success: true, data: JSON.stringify(normalized, null, 2), metadata: { todos: normalized } };
};

