import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { requireString, optionalString } from '@kooka/core';
import { getWorkspaceRootUri, resolveWorkspacePath } from './workspace';

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
    protocol: { output: { glob: true } },
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
    const workspaceRoot = getWorkspaceRootUri(context);

    let base = workspaceRoot;
    if (baseDir) {
      try {
        base = resolveWorkspacePath(baseDir, context).uri;
      } catch {
        notes.push('Provided path was outside the current workspace; searching the workspace root instead.');
        base = workspaceRoot;
      }
    }
    const rp = new vscode.RelativePattern(base, pattern);
    const uris = await vscode.workspace.findFiles(rp, '**/node_modules/**', 100);

    const entries = await Promise.all(
      uris.map(async (uri) => {
        let mtime = 0;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          mtime = stat.mtime ?? 0;
        } catch {
          mtime = 0;
        }
        return { uri, mtime };
      })
    );

    entries.sort((a, b) => b.mtime - a.mtime);
    const files = entries.map(e => e.uri.fsPath);
    const truncated = files.length >= 100;

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
