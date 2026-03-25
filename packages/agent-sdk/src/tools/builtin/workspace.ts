import type { ToolContext } from '../../types.js';
import * as path from 'path';

import {
  BINARY_EXTENSIONS,
  containsBinaryData,
  isSubPath,
  redactFsPathForPrompt,
  resolveToolPath as resolveCoreToolPath,
  toPosixPath,
} from '@kooka/core';

export { BINARY_EXTENSIONS, containsBinaryData, toPosixPath };

export function getWorkspaceRoot(context?: { workspaceRoot?: string }): string {
  const root = context?.workspaceRoot;
  if (!root) throw new Error('No workspaceRoot configured');
  return root;
}

export function resolveToolPath(
  inputPath: string,
  context?: Pick<ToolContext, 'workspaceRoot' | 'allowExternalPaths'>
): { absPath: string; relPath: string; isExternal: boolean } {
  const workspaceRoot = getWorkspaceRoot(context);
  return resolveCoreToolPath(inputPath, {
    workspaceRoot,
    allowExternalPaths: !!context?.allowExternalPaths,
  });
}

export function formatToolPathForOutput(
  absPath: string,
  context?: Pick<ToolContext, 'workspaceRoot'>
): string {
  const workspaceRoot = getWorkspaceRoot(context);
  const resolved = path.resolve(absPath);
  if (isSubPath(resolved, workspaceRoot)) {
    return toPosixPath(path.relative(workspaceRoot, resolved) || '.');
  }
  return redactFsPathForPrompt(resolved, { workspaceRoot });
}
