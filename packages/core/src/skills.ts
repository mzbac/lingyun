import { redactFsPathForPrompt } from './fsPath';

export type SkillListEntry = {
  name: string;
  description: string;
  filePath?: string;
};

export function extractSkillMentions(text: string): string[] {
  const input = String(text || '');
  if (!input) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  // Codex convention: `$skill-name` tokens in user input.
  // Keep parsing conservative to avoid false positives (must be a plausible identifier).
  // Require an identifier-like token that starts and ends with an alphanumeric/underscore so
  // punctuation like `$skill.` doesn't capture the trailing `.`.
  const re = /\$([A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9_])?)/g;
  for (const match of input.matchAll(re)) {
    const name = match[1];
    if (!name) continue;
    // Avoid false positives for common shell/env vars like `$GITHUB_OUTPUT`.
    // These are typically all-caps with underscores, and should not trigger skill selection warnings.
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }

  return result;
}

export function selectSkillsForText<T>(text: string, index: { byName: Map<string, T> }): { selected: T[]; unknown: string[] } {
  const mentions = extractSkillMentions(text);
  if (mentions.length === 0) return { selected: [], unknown: [] };

  const selected: T[] = [];
  const unknown: string[] = [];
  for (const name of mentions) {
    const skill = index.byName.get(name);
    if (skill) selected.push(skill);
    else unknown.push(name);
  }
  return { selected, unknown };
}

export function renderSkillsSectionForPrompt(options: {
  skills: SkillListEntry[];
  maxSkills?: number;
  workspaceRoot?: string;
}): string | undefined {
  const maxSkills = Math.max(0, Math.floor(options.maxSkills ?? 50));
  const all = Array.isArray(options.skills) ? options.skills : [];
  if (maxSkills === 0) return undefined;

  const shown = all.slice(0, maxSkills);
  const remaining = Math.max(0, all.length - shown.length);

  const lines: string[] = [];
  lines.push('## Skills');
  lines.push(
    'A skill is a reusable set of local instructions stored in a `SKILL.md` file. ' +
      'If the user mentions a skill (e.g. `$my-skill`), follow its instructions for that turn.',
  );
  lines.push('### Available skills');
  if (shown.length === 0) {
    lines.push('- (none)');
  } else {
    for (const skill of shown) {
      const label = skill.filePath
        ? ` (file: ${redactFsPathForPrompt(skill.filePath, { workspaceRoot: options.workspaceRoot })})`
        : '';
      lines.push(`- ${skill.name}: ${skill.description}${label}`);
    }
  }
  if (remaining > 0) {
    lines.push(`- ... and ${remaining} more (truncated)`);
  }

  lines.push('### How to use skills');
  lines.push(
    [
      '- Trigger: If the user includes `$<skill-name>` in their message, you MUST apply that skill for this turn.',
      '- The skill contents will be provided as a `<skill>...</skill>` block in the conversation history.',
      '- If multiple skills are mentioned, you MUST apply ALL of them for this turn (skills are additive; do not ignore one).',
      '- Skills are listed in the order they were mentioned. If instructions conflict, call it out and ask the user how to proceed.',
      '- Do not carry skills across turns unless they are re-mentioned.',
      '- If a skill is missing or can’t be loaded, say so briefly and proceed without it.',
    ].join('\n'),
  );

  return lines.join('\n');
}
