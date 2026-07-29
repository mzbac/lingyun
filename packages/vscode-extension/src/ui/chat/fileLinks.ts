import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeFsPath } from '@kooka/core';
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
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return [];
  if (workspaceFolders.length === 1) return [workspaceFolders[0].uri];

  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  if (!activeFolder) {
    const folders: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      folders.push(folder.uri);
    }
    return folders;
  }

  const activeRoot = normalizeFsPath(activeFolder.uri.fsPath);
  const folders: vscode.Uri[] = [activeFolder.uri];
  for (const folder of workspaceFolders) {
    const uri = folder.uri;
    if (normalizeFsPath(uri.fsPath) !== activeRoot) folders.push(uri);
  }
  return folders;
}

function findDeepestContainingWorkspaceFolder(absPath: string, workspaceFolderUris: vscode.Uri[]): vscode.Uri | undefined {
  const child = normalizeFsPath(absPath);
  let best: vscode.Uri | undefined;
  let bestRootLength = -1;

  for (const workspaceFolder of workspaceFolderUris) {
    const root = normalizeFsPath(workspaceFolder.fsPath);
    if (child !== root && !child.startsWith(root + path.sep)) continue;
    if (root.length <= bestRootLength) continue;
    best = workspaceFolder;
    bestRootLength = root.length;
  }

  return best;
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

    const containingWorkspaceFolder = findDeepestContainingWorkspaceFolder(absPath, workspaceFolderUris);

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
