import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { optionalString } from '../../core/validation';
import { getSkillIndex, loadSkillFile } from '../../core/skills';

export const skillTool: ToolDefinition = {
  id: 'skill',
  name: 'Skills',
  description:
    'List and load reusable task instructions ("skills"). ' +
    'Call with no args to list available skills. Call with {"name": "..."} to load a skill into the conversation. ' +
    'You can also mention `$skill-name` in a user message to auto-apply a skill for that turn.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill identifier from the available skills list (omit to list skills)',
      },
    },
  },
  execution: { type: 'function', handler: 'builtin.skill' },
  metadata: {
    category: 'help',
    icon: 'book',
    requiresApproval: false,
    permission: 'read',
    readOnly: true,
  },
};

function formatAvailableSkills(skills: Array<{ name: string; description: string }>): string {
  if (skills.length === 0) return '<available_skills></available_skills>';
  return [
    '<available_skills>',
    ...skills.flatMap((s) => [
      '  <skill>',
      `    <name>${s.name}</name>`,
      `    <description>${s.description}</description>`,
      '  </skill>',
    ]),
    '</available_skills>',
  ].join('\n');
}

export const skillHandler: ToolHandler = async (args, context) => {
  const enabled =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
  if (!enabled) {
    return { success: false, error: 'Skills are disabled. Enable lingyun.skills.enabled to use skills.' };
  }

  const allowExternalPaths =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;

  const searchPaths =
    vscode.workspace.getConfiguration('lingyun').get<string[]>('skills.paths', []) ?? [];

  const name = optionalString(args, 'name');

  const workspaceRoot = context.workspaceFolder?.fsPath;
  const index = await getSkillIndex({
    extensionContext: context.extensionContext,
    workspaceRoot,
    searchPaths,
    allowExternalPaths,
    cancellationToken: context.cancellationToken,
  });

  if (!name || !name.trim()) {
    const skipped = index.scannedDirs.filter((d) => d.status === 'skipped_external');
    const missing = index.scannedDirs.filter((d) => d.status === 'missing');
    const notDir = index.scannedDirs.filter((d) => d.status === 'error');

    const lines: string[] = [];
    if (index.skills.length === 0) {
      lines.push('No skills are currently available.');
      lines.push('');
    } else {
      lines.push('Load a skill to get detailed instructions for a specific task.');
      lines.push('Call: skill { "name": "..." }');
      lines.push('Or: mention `$skill-name` in your message to auto-apply a skill for that turn.');
      lines.push('');
      lines.push(formatAvailableSkills(index.skills));
      lines.push('');
    }

    if (index.truncated) {
      lines.push('Note: Skill list was truncated.');
      lines.push('');
    }

    if (skipped.length > 0) {
      lines.push(
        'Note: Some skill directories were skipped because external paths are disabled. ' +
          'Enable lingyun.security.allowExternalPaths to include them.',
      );
      lines.push('');
    }

    const showDirs = [...missing, ...notDir];
    if (showDirs.length > 0) {
      lines.push('Searched directories:');
      for (const d of index.scannedDirs) {
        const label = workspaceRoot && d.absPath.startsWith(workspaceRoot + path.sep)
          ? path.relative(workspaceRoot, d.absPath) || '.'
          : d.absPath;
        lines.push(`- ${label} (${d.status}${d.reason ? `: ${d.reason}` : ''})`);
      }
    }

    return { success: true, data: lines.join('\n').trimEnd() };
  }

  const skill = index.byName.get(name.trim());
  if (!skill) {
    const available = index.skills.map((s) => s.name).slice(0, 50).join(', ');
    const suffix = available ? ` Available skills: ${available}${index.skills.length > 50 ? ', ...' : ''}` : '';
    return { success: false, error: `Skill "${name.trim()}" not found.${suffix}` };
  }

  // Even though the index already respects allowExternalPaths for external directories, keep a
  // belt-and-suspenders check so loading is never a bypass.
  if (skill.source === 'external' && !allowExternalPaths) {
    return {
      success: false,
      error:
        'External paths are disabled. Enable lingyun.security.allowExternalPaths to load skills outside the current workspace.',
      metadata: {
        errorType: 'external_paths_disabled',
        blockedSettingKey: 'lingyun.security.allowExternalPaths',
        isOutsideWorkspace: true,
      },
    };
  }

  const { content } = await loadSkillFile(skill);
  const output = [
    `## Skill: ${skill.name}`,
    '',
    `**Base directory**: ${skill.dir}`,
    '',
    content,
  ].join('\n');

  return {
    success: true,
    data: output.trimEnd(),
    metadata: {
      name: skill.name,
      dir: skill.dir,
      source: skill.source,
    },
  };
};
