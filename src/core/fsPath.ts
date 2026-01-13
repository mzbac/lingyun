import * as os from 'os';
import * as path from 'path';

export function normalizeFsPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isSubPath(childPath: string, parentPath: string): boolean {
  const parent = normalizeFsPath(parentPath);
  const child = normalizeFsPath(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

export function expandHome(p: string): string {
  const trimmed = (p || '').trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

