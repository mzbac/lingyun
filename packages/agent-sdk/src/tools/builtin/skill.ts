import type { ToolDefinition, ToolHandler } from '../../types.js';
import {
  TOOL_ERROR_CODES,
  formatSkillNotFoundError,
  getSkillIndex,
  loadSkillFile,
  optionalString,
  redactFsPathForPrompt,
  renderSkillCatalogToolOutput,
} from '@kooka/core';

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

    const skillName = name?.trim() ?? '';
    if (!skillName) {
      return {
        success: true,
        data: renderSkillCatalogToolOutput({
          skills: index.skills,
          scannedDirs: index.scannedDirs,
          workspaceRoot,
          truncated: index.truncated,
        }),
      };
    }

    const skill = index.byName.get(skillName);
    if (!skill) {
      return { success: false, error: formatSkillNotFoundError(skillName, index.skills) };
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
