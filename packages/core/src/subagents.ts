export type SubagentName = 'general' | 'explore';

export type SubagentDefinition = {
  name: SubagentName;
  /**
   * Short user-facing description of what this subagent is good at.
   * Shown in the Task tool description.
   */
  description: string;
  /**
   * Extra system prompt text appended to the base system prompt.
   */
  prompt: string;
  /**
   * Tool allowlist for this subagent (tool ids / glob-style patterns).
   * This is applied as an AgentConfig.toolFilter so the model only sees these tools.
   */
  toolFilter?: string[];
};

export const BUILTIN_SUBAGENTS: Record<SubagentName, SubagentDefinition> = {
  general: {
    name: 'general',
    description:
      'General-purpose agent for complex, multi-step tasks. Use when you want the agent to execute a longer workflow.',
    prompt:
      [
        'You are a subagent (general).',
        '',
        '- Focus on completing the given subtask end-to-end.',
        '- Be explicit about assumptions and what you are returning to the parent.',
        '- You may use tools as needed, but keep output concise.',
        '',
        'Return a single final answer back to the parent agent.',
      ].join('\n'),
  },
  explore: {
    name: 'explore',
    description:
      'Fast, read-only agent specialized for exploring a workspace: list files, grep, read small snippets, and summarize findings.',
    prompt:
      [
        'You are a subagent (explore).',
        '',
        '- Read-only exploration: do not write/edit files.',
        '- Prefer list/glob/grep/read/read_range and summarize findings.',
        '- If you need to change code, report back to the parent instead of editing.',
        '',
        'Return a single final answer back to the parent agent.',
      ].join('\n'),
    toolFilter: [
      'list',
      'glob',
      'grep',
      'read',
      'read_range',
      'lsp',
      'symbols_search',
      'symbols_peek',
      'skill',
      'workspace',
    ],
  },
};

export function listBuiltinSubagents(): SubagentDefinition[] {
  return Object.values(BUILTIN_SUBAGENTS);
}

export function resolveBuiltinSubagent(name: string): SubagentDefinition | undefined {
  const key = String(name || '').trim().toLowerCase() as SubagentName;
  return BUILTIN_SUBAGENTS[key];
}

