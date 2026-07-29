import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import {
  TOOL_ERROR_CODES,
  formatSkillNotFoundError,
  optionalString,
  redactFsPathForPrompt,
  renderSkillCatalogToolOutput,
} from '@kooka/core';
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

  const skillName = name?.trim() ?? '';
  if (!skillName) {
    return {
      success: true,
      data: renderSkillCatalogToolOutput({
        skills: index.skills,
        scannedDirs: index.scannedDirs,
        workspaceRoot,
        truncated: index.truncated,
        mentionHint: 'Or: mention `$skill-name` in your message to auto-apply a skill for that turn.',
        skippedExternalNote:
          'Note: Some skill directories were skipped because external paths are disabled. ' +
          'Enable lingyun.security.allowExternalPaths to include them.',
      }),
    };
  }

  const skill = index.byName.get(skillName);
  if (!skill) {
    return { success: false, error: formatSkillNotFoundError(skillName, index.skills) };
  }

  // Even though the index already respects allowExternalPaths for external directories, keep a
  // belt-and-suspenders check so loading is never a bypass.
  if (skill.source === 'external' && !allowExternalPaths) {
    return {
      success: false,
      error:
        'External paths are disabled. Enable lingyun.security.allowExternalPaths to load skills outside the current workspace.',
      metadata: {
        errorCode: TOOL_ERROR_CODES.external_paths_disabled,
        blockedSettingKey: 'lingyun.security.allowExternalPaths',
        isOutsideWorkspace: true,
      },
    };
  }

  const { content } = await loadSkillFile(skill);
  const displayDir = redactFsPathForPrompt(skill.dir, { workspaceRoot });
  const output = [
    `## Skill: ${skill.name}`,
    '',
    `**Base directory**: ${displayDir}`,
    '',
    content,
  ].join('\n');

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
