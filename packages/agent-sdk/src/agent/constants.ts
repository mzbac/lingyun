export const MAX_TOOL_RESULT_LENGTH = 40_000;

export const THINK_BLOCK_REGEX = /<think>[\s\S]*?<\/think>\s*/gi;

export const TOOL_BLOCK_REGEX =
  /(<tool_call>[\s\S]*?<\/tool_call>\s*|<tool_code>[\s\S]*?<\/tool_code>\s*|<invoke>[\s\S]*?<\/invoke>\s*|\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]\s*)/gi;

export const EDIT_TOOL_IDS = new Set([
  'edit',
  'write',
  'patch',
  'multiedit',
  'file.write',
  'file.edit',
  'file.patch',
  'file.multiedit',
]);

const STATUS_MESSAGES: Record<string, string> = {
  read: 'Reading files',
  list: 'Listing directory',
  glob: 'Searching files',
  grep: 'Searching code',
  edit: 'Making edits',
  write: 'Writing files',
  bash: 'Running commands',
  'shell.run': 'Running commands',
  'shell.terminal': 'Running terminal',
  skill: 'Loading skills',
  think: 'Thinking',
  reasoning: 'Thinking',
};

export function getStatusForTool(toolName: string, action?: string): string {
  if (action === 'executing') {
    return STATUS_MESSAGES[toolName] || 'Running';
  }
  if (action === 'planning') {
    return 'Planning next steps';
  }
  if (action === 'gathering') {
    return 'Gathering context';
  }
  return STATUS_MESSAGES[toolName] || '';
}

