import { redactFsPathForPrompt } from './fsPath';

export type SkillCatalogEntry = {
  name: string;
  description: string;
};

export type SkillCatalogScannedDir = {
  absPath: string;
  status: 'ok' | 'missing' | 'skipped_external' | 'error';
  reason?: string;
};

export type RenderSkillCatalogToolOutputOptions = {
  skills: readonly SkillCatalogEntry[];
  scannedDirs: readonly SkillCatalogScannedDir[];
  workspaceRoot?: string;
  truncated?: boolean;
  mentionHint?: string;
  skippedExternalNote?: string;
};

export function formatAvailableSkills(skills: readonly SkillCatalogEntry[]): string {
  if (skills.length === 0) return '<available_skills></available_skills>';

  const lines = ['<available_skills>'];
  for (const skill of skills) {
    lines.push(
      '  <skill>',
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
      '  </skill>'
    );
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

export function formatAvailableSkillNames(skills: readonly SkillCatalogEntry[], maxSkills = 50): string {
  const limit = Math.max(0, Math.floor(maxSkills));
  let text = '';
  let count = 0;

  for (const skill of skills) {
    count++;
    if (count > limit) continue;
    text += text ? `, ${skill.name}` : skill.name;
  }

  return count > limit && text ? `${text}, ...` : text;
}

export function formatSkillNotFoundError(skillName: string, skills: readonly SkillCatalogEntry[]): string {
  const available = formatAvailableSkillNames(skills);
  const suffix = available ? ` Available skills: ${available}` : '';
  return `Skill "${skillName}" not found.${suffix}`;
}

export function renderSkillCatalogToolOutput(options: RenderSkillCatalogToolOutputOptions): string {
  let hasSkippedExternal = false;
  let hasSearchedDirIssue = false;
  for (const dir of options.scannedDirs) {
    if (dir.status === 'skipped_external') hasSkippedExternal = true;
    if (dir.status === 'missing' || dir.status === 'error') hasSearchedDirIssue = true;
  }

  const lines: string[] = [];
  if (options.skills.length === 0) {
    lines.push('No skills are currently available.', '');
  } else {
    lines.push(
      'Load a skill to get detailed instructions for a specific task.',
      'Call: skill { "name": "..." }'
    );
    if (options.mentionHint) lines.push(options.mentionHint);
    lines.push('', formatAvailableSkills(options.skills), '');
  }

  if (options.truncated) {
    lines.push('Note: Skill list was truncated.', '');
  }

  if (hasSkippedExternal) {
    lines.push(options.skippedExternalNote || 'Note: Some skill directories were skipped because external paths are disabled.', '');
  }

  if (hasSearchedDirIssue) {
    lines.push('Searched directories:');
    for (const dir of options.scannedDirs) {
      const label = redactFsPathForPrompt(dir.absPath, { workspaceRoot: options.workspaceRoot });
      lines.push(`- ${label} (${dir.status}${dir.reason ? `: ${dir.reason}` : ''})`);
    }
  }

  return lines.join('\n').trimEnd();
}
