import type { ToolDefinition, ToolHandler } from '../../types.js';
import { ToolRegistry } from '../registry.js';

import { bashHandler, bashTool } from './bash.js';
import { globHandler, globTool } from './glob.js';
import { grepHandler, grepTool } from './grep.js';
import { listHandler, listTool } from './list.js';
import { readHandler, readTool } from './read.js';
import { createSkillTool } from './skill.js';
import { taskHandler, taskTool } from './task.js';
import { writeHandler, writeTool } from './write.js';

export type BuiltinToolsOptions = {
  skills?: {
    enabled?: boolean;
    paths?: string[];
    maxPromptSkills?: number;
    maxInjectSkills?: number;
    maxInjectChars?: number;
  };
};

export const DEFAULT_SKILL_PATHS = [
  '.lingyun/skills',
  '.claude/skills',
  '.opencode/skill',
  '.opencode/skills',
  '~/.config/lingyun/skills',
  '~/.codex/skills',
  '~/.claude/skills',
];

export function getBuiltinTools(options: BuiltinToolsOptions = {}): Array<{ tool: ToolDefinition; handler: ToolHandler }> {
  const skill = createSkillTool({
    enabled: options.skills?.enabled,
    searchPaths: options.skills?.paths?.length ? options.skills.paths : DEFAULT_SKILL_PATHS,
  });

  return [
    { tool: readTool, handler: readHandler },
    { tool: writeTool, handler: writeHandler },
    { tool: listTool, handler: listHandler },
    { tool: globTool, handler: globHandler },
    { tool: grepTool, handler: grepHandler },
    { tool: bashTool, handler: bashHandler },
    { tool: skill.tool, handler: skill.handler },
    { tool: taskTool, handler: taskHandler },
  ];
}

export function registerBuiltinTools(registry: ToolRegistry, options: BuiltinToolsOptions = {}): void {
  for (const { tool, handler } of getBuiltinTools(options)) {
    registry.registerTool(tool, handler);
  }
}
