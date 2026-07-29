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

function compactPathTail(normalized: string, tailSegments: number): string {
  const tail: string[] = [];
  let segmentEnd = normalized.length;
  let totalSegments = 0;

  for (let i = normalized.length - 1; i >= -1; i -= 1) {
    if (i >= 0 && normalized[i] !== '/') continue;
    if (segmentEnd > i + 1) {
      totalSegments += 1;
      if (tail.length < tailSegments) {
        tail.push(normalized.slice(i + 1, segmentEnd));
      }
    }
    segmentEnd = i;
  }

  if (totalSegments <= tailSegments) return normalized;
  let compact = '...';
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    compact += '/' + tail[i];
  }
  return compact;
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
  return compactPathTail(normalized, tailSegments);
}
