import type { ToolDefinition, ToolHandler } from '../../types.js';
import { TOOL_ERROR_CODES, getSkillIndex, loadSkillFile, optionalString, redactFsPathForPrompt } from '@kooka/core';

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

export function createSkillTool(options: {
  enabled?: boolean;
  searchPaths: string[];
}): { tool: ToolDefinition; handler: ToolHandler } {
  const tool: ToolDefinition = {
    id: 'skill',
    name: 'Skills',
    description:
      'List and load reusable task instructions ("skills"). ' +
      'Call with no args to list available skills. Call with {"name": "..."} to load a skill into the conversation.',
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

  const handler: ToolHandler = async (args, context) => {
    const enabled = options.enabled !== false;
    if (!enabled) {
      return { success: false, error: 'Skills are disabled.' };
    }

    const allowExternalPaths = !!context.allowExternalPaths;
    const name = optionalString(args, 'name');

    const workspaceRoot = context.workspaceRoot;
    const index = await getSkillIndex({
      workspaceRoot,
      searchPaths: options.searchPaths,
      allowExternalPaths,
      signal: context.signal,
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
        lines.push('');
        lines.push(formatAvailableSkills(index.skills));
        lines.push('');
      }

      if (index.truncated) {
        lines.push('Note: Skill list was truncated.');
        lines.push('');
      }

      if (skipped.length > 0) {
        lines.push('Note: Some skill directories were skipped because external paths are disabled.');
        lines.push('');
      }

      const showDirs = [...missing, ...notDir];
      if (showDirs.length > 0) {
        lines.push('Searched directories:');
        for (const d of index.scannedDirs) {
          const label = redactFsPathForPrompt(d.absPath, { workspaceRoot });
          lines.push(`- ${label} (${d.status}${d.reason ? `: ${d.reason}` : ''})`);
        }
      }

      return { success: true, data: lines.join('\n').trimEnd() };
    }

    const skill = index.byName.get(name.trim());
    if (!skill) {
      const available = index.skills
        .map((s) => s.name)
        .slice(0, 50)
        .join(', ');
      const suffix = available ? ` Available skills: ${available}${index.skills.length > 50 ? ', ...' : ''}` : '';
      return { success: false, error: `Skill "${name.trim()}" not found.${suffix}` };
    }

    if (skill.source === 'external' && !allowExternalPaths) {
      return {
        success: false,
        error: 'External paths are disabled. Enable allowExternalPaths to load skills outside the current workspace.',
        metadata: {
          errorCode: TOOL_ERROR_CODES.external_paths_disabled,
          blockedSettingKey: 'lingyun.security.allowExternalPaths',
          isOutsideWorkspace: true,
        },
      };
    }

    const { content } = await loadSkillFile(skill);
    const displayDir = redactFsPathForPrompt(skill.dir, { workspaceRoot });
    const output = [`## Skill: ${skill.name}`, '', `**Base directory**: ${displayDir}`, '', content].join('\n');

    return {
      success: true,
      data: output.trimEnd(),
      metadata: {
        name: skill.name,
        dir: displayDir,
        source: skill.source,
      },
    };
  };

  return { tool, handler };
}
