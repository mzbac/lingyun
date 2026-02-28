import type { ToolDefinition, ToolHandler } from '../../core/types';
import { TOOL_ERROR_CODES, listBuiltinSubagents } from '@kooka/core';

const agentsList = listBuiltinSubagents()
  .map((agent) => `- ${agent.name}: ${agent.description}`)
  .join('\n');

export const taskTool: ToolDefinition = {
  id: 'task',
  name: 'Task',
  description: [
    'Launch a subagent to handle a complex, multistep task autonomously.',
    '',
    'Available subagent types:',
    agentsList || '- (none)',
    '',
    'Usage:',
    '- Use `subagent_type` to select the agent.',
    '- Use `session_id` to continue a previous task session.',
    '',
    'Notes:',
    '- The subagent returns a single final answer back to you.',
    '- The task tool is non-recursive: subagents cannot spawn other subagents via task.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Short (3–5 words) description of the task' },
      prompt: { type: 'string', description: 'Detailed instructions for the subagent' },
      subagent_type: { type: 'string', description: 'Which subagent to use (e.g. "explore", "general")' },
      session_id: { type: 'string', description: 'Existing task session id to continue (optional)' },
    },
    required: ['description', 'prompt', 'subagent_type'],
  },
  execution: { type: 'function', handler: 'builtin.task' },
  metadata: {
    category: 'agent',
    icon: 'sparkle',
    requiresApproval: false,
    permission: 'task',
    readOnly: false,
  },
};

export const taskHandler: ToolHandler = async () => {
  return {
    success: false,
    error: 'Task tool is only available when invoked by the agent runtime.',
    metadata: { errorCode: TOOL_ERROR_CODES.task_runtime_only },
  };
};
