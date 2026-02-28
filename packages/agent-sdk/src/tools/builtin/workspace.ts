import type { ToolContext } from '../../types.js';
import { BINARY_EXTENSIONS, containsBinaryData, resolveToolPath as resolveCoreToolPath, toPosixPath } from '@kooka/core';

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

