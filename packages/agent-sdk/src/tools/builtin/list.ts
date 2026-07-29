import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';

import type { ToolDefinition, ToolHandler } from '../../types.js';
import { createFileTreeIgnoreDirs, optionalString, renderFileTreeOutput } from '@kooka/core';
import { formatToolPathForOutput, getWorkspaceRoot, resolveToolPath, toPosixPath } from './workspace.js';

export const listTool: ToolDefinition = {
  id: 'list',
  name: 'List Directory',
  description: 'List a directory tree (workspace-scoped). Returns up to 100 files. Use ignore to exclude additional glob patterns.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory to list (absolute or workspace-relative). Omit for workspace root.' },
      ignore: { type: 'array', description: 'Additional ignore patterns (glob fragments)', items: { type: 'string' } },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.list' },
  metadata: {
    category: 'file',
    icon: 'folder',
    requiresApproval: false,
    permission: 'list',
    readOnly: true,
    permissionPatterns: [{ arg: 'path', kind: 'path' }],
  },
};

const MAX_LIST_FILES = 100;
const MAX_LIST_DEPTH = 25;

async function walkWorkspaceFiles(
  baseDir: string,
  ignoreDirs: Set<string>
): Promise<{ relFiles: string[]; truncated: boolean }> {
  const relFiles: string[] = [];
  const queue: Array<{ absDir: string; relDir: string; depth: number }> = [{ absDir: baseDir, relDir: '.', depth: 0 }];
  let queueIndex = 0;
  let truncated = false;

  while (queueIndex < queue.length) {
    const next = queue[queueIndex++]!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(next.absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (relFiles.length >= MAX_LIST_FILES) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;

      const name = entry.name;
      const childRel = next.relDir === '.' ? name : `${next.relDir}/${name}`;
      const childAbs = path.join(next.absDir, name);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(name)) continue;
        if (next.depth >= MAX_LIST_DEPTH) continue;
        queue.push({ absDir: childAbs, relDir: childRel, depth: next.depth + 1 });
        continue;
      }

      relFiles.push(toPosixPath(childRel));
    }

    if (truncated) break;
  }

  return { relFiles, truncated };
}

export const listHandler: ToolHandler = async (args, context) => {
  try {
    const baseDir = optionalString(args, 'path');
    const ignoreExtra = Array.isArray((args as any).ignore) ? ((args as any).ignore as unknown[]) : undefined;
    const ignoreDirs = createFileTreeIgnoreDirs(ignoreExtra);

    const notes: string[] = [];

    const workspaceRoot = getWorkspaceRoot(context);
    let base = workspaceRoot;

    if (baseDir) {
      const resolved = resolveToolPath(baseDir, { ...context, allowExternalPaths: true });
      if (resolved.isExternal) {
        notes.push('Provided path was outside the current workspace; listing the workspace root instead.');
        base = workspaceRoot;
      } else {
        base = resolved.absPath;
      }
    }

    try {
      const stat = await fs.stat(base);
      if (!stat.isDirectory()) {
        base = path.dirname(base);
      }
    } catch {
      base = workspaceRoot;
    }

    const listing = await walkWorkspaceFiles(base, ignoreDirs);
    const truncated = listing.truncated;

    const output = renderFileTreeOutput({
      rootLabel: formatToolPathForOutput(base, context),
      relFiles: listing.relFiles,
      notes,
      truncated,
    });

    return { success: true, data: output };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
