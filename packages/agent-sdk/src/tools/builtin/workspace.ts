import * as path from 'path';
import { normalizeFsPath } from '@lingyun/core';
import type { ToolContext } from '../../types.js';

export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.svg',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.pyc',
  '.class',
  '.o',
  '.obj',
  '.sqlite',
  '.db',
]);

export function getWorkspaceRoot(context?: { workspaceRoot?: string }): string {
  const root = context?.workspaceRoot;
  if (!root) throw new Error('No workspaceRoot configured');
  return root;
}

export function resolveToolPath(
  inputPath: string,
  context?: Pick<ToolContext, 'workspaceRoot' | 'allowExternalPaths'>
): { absPath: string; relPath: string; isExternal: boolean } {
  const rootPath = getWorkspaceRoot(context);
  const normalizedRoot = normalizeFsPath(rootPath);

  const absPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(rootPath, inputPath);
  const normalizedAbs = normalizeFsPath(absPath);

  const isExternal = normalizedAbs !== normalizedRoot && !normalizedAbs.startsWith(normalizedRoot + path.sep);
  const relPath = isExternal ? absPath : path.relative(rootPath, absPath) || '.';

  if (isExternal && !context?.allowExternalPaths) {
    throw new Error(
      'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.'
    );
  }

  return { absPath, relPath, isExternal };
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
