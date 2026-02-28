import * as vscode from 'vscode';

export function getPrimaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  if (activeUri && activeUri.scheme === 'file') {
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder) return folder;
  }

  return vscode.workspace.workspaceFolders?.[0];
}

export function getPrimaryWorkspaceFolderUri(): vscode.Uri | undefined {
  return getPrimaryWorkspaceFolder()?.uri;
}

export function getPrimaryWorkspaceRootPath(): string | undefined {
  const uri = getPrimaryWorkspaceFolderUri();
  return uri?.scheme === 'file' ? uri.fsPath : undefined;
}
