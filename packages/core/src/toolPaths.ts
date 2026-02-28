import * as path from 'path';
import * as fs from 'fs';

import { normalizeFsPath } from './fsPath';

export type ToolPathErrorCode = 'external_paths_disabled' | 'workspace_boundary_check_failed';

const TOOL_PATH_ERROR_MARKER = Symbol.for('@kooka/core/ToolPathError');

export class ToolPathError extends Error {
  readonly code: ToolPathErrorCode;

  constructor(code: ToolPathErrorCode, message: string) {
    super(message);
    this.name = 'ToolPathError';
    this.code = code;
    try {
      Object.defineProperty(this, TOOL_PATH_ERROR_MARKER, { value: true, enumerable: false });
    } catch {
      // ignore
    }
  }
}

export function isToolPathError(error: unknown): error is ToolPathError {
  if (error instanceof ToolPathError) return true;
  if (!error || typeof error !== 'object') return false;
  const record = error as any;
  if (record[TOOL_PATH_ERROR_MARKER] === true) return true;
  return (
    record.name === 'ToolPathError' &&
    (record.code === 'external_paths_disabled' || record.code === 'workspace_boundary_check_failed')
  );
}

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

export function resolveToolPath(
  inputPath: string,
  options: { workspaceRoot: string; allowExternalPaths?: boolean }
): { absPath: string; relPath: string; isExternal: boolean } {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const allowExternalPaths = !!options.allowExternalPaths;
  const absPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(workspaceRoot, inputPath);

  const normalizedRoot = normalizeFsPath(workspaceRoot);
  const normalizedAbs = normalizeFsPath(absPath);
  const lexicalExternal = normalizedAbs !== normalizedRoot && !normalizedAbs.startsWith(normalizedRoot + path.sep);

  const canonicalRoot = canonicalizePathForContainment(workspaceRoot);
  const canonicalAbs = canonicalizePathForContainment(absPath);
  const canonicalKnown = !!canonicalRoot && !!canonicalAbs;
  const canonicalExternal =
    canonicalKnown &&
    canonicalAbs !== canonicalRoot &&
    !canonicalAbs.startsWith(canonicalRoot + path.sep);

  if (!allowExternalPaths && !canonicalKnown) {
    throw new ToolPathError(
      'workspace_boundary_check_failed',
      'External paths are disabled. Unable to verify workspace boundary because canonical path resolution failed.',
    );
  }

  const isExternal = canonicalKnown ? canonicalExternal : lexicalExternal;
  const relPath = isExternal ? absPath : path.relative(workspaceRoot, absPath) || '.';

  if (isExternal && !allowExternalPaths) {
    throw new ToolPathError(
      'external_paths_disabled',
      'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.',
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
