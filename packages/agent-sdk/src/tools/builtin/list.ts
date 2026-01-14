import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';

import type { ToolDefinition, ToolHandler } from '../../types.js';
import { optionalString } from '@kooka/core';
import { getWorkspaceRoot, resolveToolPath, toPosixPath } from './workspace.js';

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

const DEFAULT_IGNORE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'vendor',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.cache',
  'cache',
  'logs',
  '.venv',
  'venv',
  'env',
  '__pycache__',
];

const MAX_LIST_FILES = 100;
const MAX_LIST_DEPTH = 25;

async function walkWorkspaceFiles(
  baseDir: string,
  ignoreDirs: Set<string>
): Promise<{ relFiles: string[]; truncated: boolean }> {
  const relFiles: string[] = [];
  const queue: Array<{ absDir: string; relDir: string; depth: number }> = [{ absDir: baseDir, relDir: '.', depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const next = queue.shift()!;
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
    const ignoreExtra = Array.isArray((args as any).ignore) ? ((args as any).ignore as unknown[]).map(String) : [];
    const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...ignoreExtra].filter(Boolean));

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

    const relFiles = listing.relFiles.filter((p) => p && p !== '.').sort();

    const dirs = new Set<string>();
    const filesByDir = new Map<string, string[]>();

    for (const file of relFiles) {
      const dir = path.posix.dirname(file);
      const parts = dir === '.' ? [] : dir.split('/');
      for (let i = 0; i <= parts.length; i++) {
        const dirPath = i === 0 ? '.' : parts.slice(0, i).join('/');
        dirs.add(dirPath);
      }
      if (!filesByDir.has(dir)) filesByDir.set(dir, []);
      filesByDir.get(dir)!.push(path.posix.basename(file));
    }

    const renderDir = (dirPath: string, depth: number): string => {
      const indent = '  '.repeat(depth);
      let output = '';
      if (depth > 0) {
        output += `${indent}${path.posix.basename(dirPath)}/\n`;
      }
      const childIndent = '  '.repeat(depth + 1);
      const children = Array.from(dirs)
        .filter((d) => path.posix.dirname(d) === dirPath && d !== dirPath)
        .sort();

      for (const child of children) {
        output += renderDir(child, depth + 1);
      }

      const files = (filesByDir.get(dirPath) || []).slice().sort();
      for (const f of files) {
        output += `${childIndent}${f}\n`;
      }

      return output;
    };

    const header: string[] = [];
    if (notes.length > 0) {
      header.push(`Note: ${notes.join(' ')}`, '');
    }
    const output =
      header.join('\n') +
      `${base}/\n` +
      renderDir('.', 0) +
      (truncated ? '\n(Results are truncated.)\n' : '');

    return { success: true, data: output.trimEnd() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
