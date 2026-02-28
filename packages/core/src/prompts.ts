export type PlanPromptOptions = {
  tools: string;
  includeTodoTools?: boolean;
  filePathGuidance: string;
};

export function createPlanPrompt(options: PlanPromptOptions): string {
  const tools = (options.tools || '').trim();
  const filePathGuidance = (options.filePathGuidance || '').trim();
  const includeTodos = options.includeTodoTools === true;

  return [
    `Plan mode is active. You may inspect the workspace using read-only tools (${tools}).`,
    includeTodos ? 'You may also use todoread/todowrite to manage a todo list for the plan.' : '',
    '',
    'CRITICAL RULES:',
    '- You MUST NOT modify files or the environment. Do NOT use any edit/write/patch tools.',
    '- Do NOT output any tool-call markup, XML, or code tags (including <tool_call>, <tool_code>, <invoke>, [TOOL_CALL], JSON tool calls).',
    `- ${filePathGuidance}`,
    '',
    'FINAL OUTPUT FORMAT:',
    `- Return ONLY a numbered list of 3-8 concrete steps to accomplish the user's goal.`,
    '- Each step must be on its own line and start with "N. " (e.g. "1. ...").',
    '- No preamble, no explanations, no extra sections.',
    '- If you need clarification, ask 1-3 focused questions instead of steps.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const BUILD_SWITCH_PROMPT = `Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and utilize your tools as needed.`;

