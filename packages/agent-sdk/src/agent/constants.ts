export const MAX_TOOL_RESULT_LENGTH = 40_000;

export const EDIT_TOOL_IDS = new Set([
  'edit',
  'write',
]);

const STATUS_MESSAGES: Record<string, string> = {
  read: 'Reading files',
  list: 'Listing directory',
  glob: 'Searching files',
  grep: 'Searching code',
  edit: 'Making edits',
  write: 'Writing files',
  bash: 'Running commands',
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
