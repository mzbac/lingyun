import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { createFileTreeIgnoreDirs, optionalString, renderFileTreeOutput } from '@kooka/core';
import { formatToolPathForOutput, getWorkspaceRootUri, resolveWorkspacePath, toPosixPath } from './workspace';

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

export const listHandler: ToolHandler = async (args, context) => {
  try {
    const baseDir = optionalString(args, 'path');
    const ignoreExtra = Array.isArray(args.ignore) ? (args.ignore as unknown[]) : undefined;
    const ignoreDirs = createFileTreeIgnoreDirs(ignoreExtra);

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

    const output = renderFileTreeOutput({
      rootLabel: formatToolPathForOutput(base.fsPath, context),
      relFiles: uris.map(uri => toPosixPath(path.relative(base.fsPath, uri.fsPath))),
      notes,
      truncated,
    });
    return { success: true, data: output };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
