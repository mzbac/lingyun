import * as path from 'path';
import * as vscode from 'vscode';
import {
  BINARY_EXTENSIONS,
  containsBinaryData,
  isToolPathError,
  resolveToolPath as resolveCoreToolPath,
  toPosixPath,
} from '@kooka/core';
import { getPrimaryWorkspaceFolderUri } from '../../core/workspaceContext';

export { BINARY_EXTENSIONS, containsBinaryData, toPosixPath };

export function getWorkspaceRootUri(context?: { workspaceFolder?: vscode.Uri }): vscode.Uri {
  const folder = context?.workspaceFolder ?? getPrimaryWorkspaceFolderUri();
  if (!folder) throw new Error('No workspace folder open');
  return folder;
}

export function resolveWorkspacePath(
  inputPath: string,
  context?: { workspaceFolder?: vscode.Uri }
): { uri: vscode.Uri; absPath: string; relPath: string } {
  const resolved = resolveToolPath(inputPath, context);
  if (resolved.isExternal) {
    throw new Error('Path must be within the current workspace');
  }
  return { uri: resolved.uri, absPath: resolved.absPath, relPath: resolved.relPath };
}

export function resolveToolPath(
  inputPath: string,
  context?: { workspaceFolder?: vscode.Uri }
): { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean } {
  const rootUri = getWorkspaceRootUri(context);
  const allowExternalPaths =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;

  let resolved: { absPath: string; relPath: string; isExternal: boolean };
  try {
    resolved = resolveCoreToolPath(inputPath, {
      workspaceRoot: rootUri.fsPath,
      allowExternalPaths,
    });
  } catch (error) {
    if (isToolPathError(error) && error.code === 'external_paths_disabled') {
      throw new Error(
        'External paths are disabled. Enable lingyun.security.allowExternalPaths to allow access outside the current workspace.'
      );
    }
    if (isToolPathError(error) && error.code === 'workspace_boundary_check_failed') {
      throw new Error(
        'External paths are disabled. Unable to verify workspace boundary. Enable lingyun.security.allowExternalPaths to allow access outside the current workspace.'
      );
    }
    throw error;
  }

  const absPath = resolved.absPath;
  const relPath = resolved.isExternal ? absPath : path.relative(rootUri.fsPath, absPath) || '.';

  return { uri: vscode.Uri.file(absPath), absPath, relPath, isExternal: resolved.isExternal };
}
