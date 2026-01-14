import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

import type { ToolDefinition, ToolHandler } from '../../types.js';
import { optionalString, requireString } from '@lingyun/core';
import { getWorkspaceRoot, resolveToolPath } from './workspace.js';

export const globTool: ToolDefinition = {
  id: 'glob',
  name: 'Glob Files',
  description:
    'Find files matching a glob pattern under the workspace (or under an optional directory). Returns up to 100 file paths sorted by modified time.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.{ts,tsx})' },
      path: { type: 'string', description: 'Directory to search in (absolute or workspace-relative). Omit for workspace root.' },
    },
    required: ['pattern'],
  },
  execution: { type: 'function', handler: 'builtin.glob' },
  metadata: {
    category: 'file',
    icon: 'search',
    requiresApproval: false,
    permission: 'glob',
    readOnly: true,
    permissionPatterns: [
      { arg: 'pattern', kind: 'raw' },
      { arg: 'path', kind: 'path' },
    ],
  },
};

export const globHandler: ToolHandler = async (args, context) => {
  try {
    const patternResult = requireString(args, 'pattern');
    if ('error' in patternResult) return { success: false, error: patternResult.error };
    const pattern = patternResult.value;

    const baseDir = optionalString(args, 'path');
    const notes: string[] = [];
    const workspaceRoot = getWorkspaceRoot(context);

    let base = workspaceRoot;
    if (baseDir) {
      const resolved = resolveToolPath(baseDir, { ...context, allowExternalPaths: true });
      if (resolved.isExternal) {
        notes.push('Provided path was outside the current workspace; searching the workspace root instead.');
        base = workspaceRoot;
      } else {
        base = resolved.absPath;
      }
    }

    const relMatches = await glob(pattern, {
      cwd: base,
      ignore: ['**/node_modules/**'],
      nodir: true,
      dot: true,
      follow: false,
      windowsPathsNoEscape: true,
    });

    const entries = await Promise.all(
      relMatches.slice(0, 200).map(async (rel) => {
        const abs = path.resolve(base, rel);
        let mtime = 0;
        try {
          const stat = await fs.stat(abs);
          mtime = stat.mtimeMs ?? 0;
        } catch {
          mtime = 0;
        }
        return { abs, mtime };
      })
    );

    entries.sort((a, b) => b.mtime - a.mtime);
    const files = entries.map((e) => e.abs).slice(0, 100);
    const truncated = files.length >= 100 || relMatches.length > files.length;

    return {
      success: true,
      data: {
        files,
        truncated,
        ...(notes.length > 0 ? { notes } : {}),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
