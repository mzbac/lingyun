import * as path from 'path';
import * as fs from 'fs';
import { normalizeFsPath } from '@kooka/core';
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
  const allowExternalPaths = !!context?.allowExternalPaths;
  const absPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(rootPath, inputPath);

  const normalizedRoot = normalizeFsPath(rootPath);
  const normalizedAbs = normalizeFsPath(absPath);
  const lexicalExternal = normalizedAbs !== normalizedRoot && !normalizedAbs.startsWith(normalizedRoot + path.sep);

  const canonicalRoot = canonicalizePathForContainment(rootPath);
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
  const relPath = isExternal ? absPath : path.relative(rootPath, absPath) || '.';

  if (isExternal && !allowExternalPaths) {
    throw new Error(
      'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.'
    );
  }

  return { absPath, relPath, isExternal };
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
