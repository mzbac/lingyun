import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { normalizeFsPath } from '@kooka/core';

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
  const allowExternalPaths =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;

  const absPath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(rootUri.fsPath, inputPath);
  const normalizedAbs = normalizeFsPath(absPath);

  const lexicalExternal = normalizedAbs !== rootPath && !normalizedAbs.startsWith(rootPath + path.sep);
  const canonicalRoot = canonicalizePathForContainment(rootUri.fsPath);
  const canonicalAbs = canonicalizePathForContainment(absPath);
  const canonicalKnown = !!canonicalRoot && !!canonicalAbs;
  const canonicalExternal =
    canonicalKnown &&
    canonicalAbs !== canonicalRoot &&
    !canonicalAbs.startsWith(canonicalRoot + path.sep);

  if (!allowExternalPaths && !canonicalKnown) {
    throw new Error(
      'External paths are disabled. Unable to verify workspace boundary because canonical path resolution failed.'
    );
  }

  const isExternal = canonicalKnown ? canonicalExternal : lexicalExternal;
  const relPath = isExternal ? absPath : path.relative(rootUri.fsPath, absPath) || '.';

  if (isExternal) {
    if (!allowExternalPaths) {
      throw new Error(
        'External paths are disabled. Enable lingyun.security.allowExternalPaths to allow access outside the current workspace.'
      );
    }
  }
  return { uri: vscode.Uri.file(absPath), absPath, relPath, isExternal };
}

function canonicalizePathForContainment(targetPath: string): string | undefined {
  const resolved = path.resolve(targetPath);
  const nearestExisting = findNearestExistingAncestor(resolved);
  if (!nearestExisting) return undefined;

  let canonicalAncestor: string;
  try {
    canonicalAncestor = fs.realpathSync(nearestExisting);
  } catch {
    return undefined;
  }

  const suffix = path.relative(nearestExisting, resolved);
  const joined = suffix ? path.resolve(canonicalAncestor, suffix) : canonicalAncestor;
  return normalizeFsPath(joined);
}

function findNearestExistingAncestor(targetPath: string): string | undefined {
  let current = path.resolve(targetPath);
  while (true) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
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
