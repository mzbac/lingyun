export const THINK_BLOCK_REGEX = /<think>[\s\S]*?<\/think>\s*|<\/?think>\s*/gi;

export const TOOL_BLOCK_REGEX =
  /(<tool_call>[\s\S]*?<\/tool_call>\s*|<tool_code>[\s\S]*?<\/tool_code>\s*|<invoke>[\s\S]*?<\/invoke>\s*|\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]\s*)/gi;

export function stripThinkBlocks(content: string): string {
  return String(content ?? '').replace(THINK_BLOCK_REGEX, '');
}

export function stripToolBlocks(content: string): string {
  return String(content ?? '').replace(TOOL_BLOCK_REGEX, '');
}

