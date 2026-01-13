import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeFsPath } from '../../core/fsPath';

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
  '.ttf', '.otf', '.woff', '.woff2',
  '.pyc', '.class', '.o', '.obj',
  '.sqlite', '.db',
]);

export function getWorkspaceRootUri(context?: { workspaceFolder?: vscode.Uri }): vscode.Uri {
  const folder = context?.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
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
  const rootPath = normalizeFsPath(rootUri.fsPath);

  const absPath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(rootUri.fsPath, inputPath);
  const normalizedAbs = normalizeFsPath(absPath);

  const isExternal = normalizedAbs !== rootPath && !normalizedAbs.startsWith(rootPath + path.sep);
  const relPath = isExternal ? absPath : path.relative(rootUri.fsPath, absPath) || '.';

  if (isExternal) {
    const allowExternalPaths =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
    if (!allowExternalPaths) {
      throw new Error(
        'External paths are disabled. Enable lingyun.security.allowExternalPaths to allow access outside the current workspace.'
      );
    }
  }
  return { uri: vscode.Uri.file(absPath), absPath, relPath, isExternal };
}

export function containsBinaryData(buffer: Uint8Array): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}
