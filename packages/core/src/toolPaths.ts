import * as path from 'path';

import { evaluateWorkspacePathPolicy } from './pathPolicy';

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
  const evaluation = evaluateWorkspacePathPolicy(inputPath, { workspaceRoot: options.workspaceRoot });
  const allowExternalPaths = !!options.allowExternalPaths;

  if (!allowExternalPaths && !evaluation.canonicalKnown) {
    throw new ToolPathError(
      'workspace_boundary_check_failed',
      'External paths are disabled. Unable to verify workspace boundary because canonical path resolution failed.',
    );
  }

  if (evaluation.isExternal && !allowExternalPaths) {
    throw new ToolPathError(
      'external_paths_disabled',
      'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.',
    );
  }

  return {
    absPath: evaluation.absPath,
    relPath: evaluation.relPath,
    isExternal: evaluation.isExternal,
  };
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
