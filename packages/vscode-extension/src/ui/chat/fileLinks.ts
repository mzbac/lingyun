import * as path from 'path';
import * as vscode from 'vscode';
import { isSubPath, normalizeFsPath } from '@lingyun/core';
import { resolveToolPath } from '../../tools/builtin/workspace';

async function canOpenAsFile(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

export function getWorkspaceFolderUrisByPriority(): vscode.Uri[] {
  const folders = vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];
  if (folders.length <= 1) return folders;

  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  if (!activeFolder) return folders;

  const activeRoot = normalizeFsPath(activeFolder.uri.fsPath);
  return [activeFolder.uri, ...folders.filter((uri) => normalizeFsPath(uri.fsPath) !== activeRoot)];
}

export async function resolveExistingFilePath(
  candidatePath: string,
  workspaceFolderUris: vscode.Uri[],
  allowExternalPaths: boolean
): Promise<{ resolved?: { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }; blockedMessage?: string }> {
  const value = (candidatePath || '').trim();
  if (!value) return {};

  let blockedMessage: string | undefined;

  const isAbs = path.isAbsolute(value);
  if (isAbs) {
    const absPath = path.resolve(value);
    const uri = vscode.Uri.file(absPath);

    const containingWorkspaceFolder = workspaceFolderUris
      .map((workspaceFolder) => ({ workspaceFolder, root: normalizeFsPath(workspaceFolder.fsPath) }))
      .filter(({ workspaceFolder }) => isSubPath(absPath, workspaceFolder.fsPath))
      .sort((a, b) => b.root.length - a.root.length)[0]?.workspaceFolder;

    if (containingWorkspaceFolder) {
      try {
        const resolved = resolveToolPath(absPath, { workspaceFolder: containingWorkspaceFolder });
        if (await canOpenAsFile(resolved.uri)) return { resolved };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('External paths are disabled')) blockedMessage = message;
      }
    } else if (!allowExternalPaths) {
      blockedMessage =
        'External paths are disabled. Enable lingyun.security.allowExternalPaths to allow access outside the current workspace.';
    }

    if (workspaceFolderUris.length === 0) {
      if (!allowExternalPaths) return { blockedMessage };
      if (await canOpenAsFile(uri)) {
        return { resolved: { uri, absPath, relPath: absPath, isExternal: true } };
      }
      return { blockedMessage };
    }

    for (const workspaceFolder of workspaceFolderUris) {
      try {
        const resolved = resolveToolPath(absPath, { workspaceFolder });
        if (await canOpenAsFile(resolved.uri)) return { resolved };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('External paths are disabled')) blockedMessage = message;
      }
    }

    return { blockedMessage };
  }

  if (workspaceFolderUris.length === 0) return {};

  for (const workspaceFolder of workspaceFolderUris) {
    try {
      const resolved = resolveToolPath(value, { workspaceFolder });
      if (await canOpenAsFile(resolved.uri)) return { resolved };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('External paths are disabled')) blockedMessage = message;
    }
  }

  return { blockedMessage };
}
