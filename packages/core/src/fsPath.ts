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

export function redactFsPathForPrompt(
  value: string,
  options?: { workspaceRoot?: string; homeDir?: string; tailSegments?: number }
): string {
  const raw = (value || '').trim();
  if (!raw) return '';

  const normalized = raw.replace(/\\/g, '/');
  if (!path.isAbsolute(raw)) return normalized;

  const workspaceRoot = options?.workspaceRoot ? path.resolve(options.workspaceRoot) : undefined;
  if (workspaceRoot && isSubPath(raw, workspaceRoot)) {
    const rel = path.relative(workspaceRoot, raw).replace(/\\/g, '/');
    return rel || '.';
  }

  const homeDir = options?.homeDir ?? os.homedir();
  if (homeDir && isSubPath(raw, homeDir)) {
    const rel = path.relative(homeDir, raw).replace(/\\/g, '/');
    return rel ? `~/${rel}` : '~';
  }

  const tailSegments = Math.max(1, Math.floor(options?.tailSegments ?? 2));
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= tailSegments) return normalized;
  return `.../${parts.slice(-tailSegments).join('/')}`;
}
