import type { ToolDefinition, ToolHandler } from '../../core/types';
import { readTodos } from '../../core/todo';

export const todoreadTool: ToolDefinition = {
  id: 'todoread',
  name: 'Todo (Read)',
  description: 'Read the current todo list for this LingYun session.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execution: { type: 'function', handler: 'builtin.todoread' },
  metadata: {
    category: 'planning',
    icon: 'checklist',
    requiresApproval: false,
    permission: 'todoread',
    readOnly: true,
  },
};

export const todoreadHandler: ToolHandler = async (_args, context) => {
  const sessionId = context.sessionId?.trim();
  if (!sessionId) {
    return { success: true, data: '[]', metadata: { todos: [] } };
  }

  const todos = await readTodos(context.extensionContext, sessionId);
  return { success: true, data: JSON.stringify(todos, null, 2), metadata: { todos } };
};

