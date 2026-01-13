import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { optionalString } from '../../core/validation';
import { getWorkspaceRootUri, resolveWorkspacePath, toPosixPath } from './workspace';

export const listTool: ToolDefinition = {
  id: 'list',
  name: 'List Directory',
  description:
    'List a directory tree (workspace-scoped). Returns up to 100 files. Use ignore to exclude additional glob patterns.',
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

export const listHandler: ToolHandler = async (args, context) => {
  try {
    const baseDir = optionalString(args, 'path');
    const ignoreExtra = Array.isArray(args.ignore) ? (args.ignore as unknown[]).map(String) : [];
    const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...ignoreExtra].filter(Boolean));

    const notes: string[] = [];
    const workspaceRoot = getWorkspaceRootUri(context);

    let base = workspaceRoot;
    if (baseDir) {
      try {
        base = resolveWorkspacePath(baseDir, context).uri;
      } catch {
        notes.push('Provided path was outside the current workspace; listing the workspace root instead.');
        base = workspaceRoot;
      }
    }
    const rp = new vscode.RelativePattern(base, '**/*');

    const exclude = `**/{${Array.from(ignoreDirs).join(',')}}/**`;
    const uris = await vscode.workspace.findFiles(rp, exclude, 100);
    const truncated = uris.length >= 100;

    const relFiles = uris
      .map(uri => {
        const rel = path.relative(base.fsPath, uri.fsPath);
        return toPosixPath(rel);
      })
      .filter(p => p && p !== '.')
      .sort();

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
        .filter(d => path.posix.dirname(d) === dirPath && d !== dirPath)
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
      header.join('\n') + `${base.fsPath}/\n` + renderDir('.', 0) + (truncated ? '\n(Results are truncated.)\n' : '');
    return { success: true, data: output.trimEnd() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
