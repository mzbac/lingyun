import * as path from 'path';
import { expandHome, isSubPath } from './fsPath';

function stripPunctuation(token: string): string {
  let out = token.trim();
  if (!out) return out;

  // Remove common shell punctuation that often gets glued to args.
  // Example: "foo;"  ">bar"  "bar)".
  out = out.replace(/^[;|&(){}<>]+/, '');
  out = out.replace(/[;|&(){}<>]+$/, '');
  return out.trim();
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  const s = String(command ?? '');
  let i = 0;

  const isWs = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

  while (i < s.length) {
    while (i < s.length && isWs(s[i])) i++;
    if (i >= s.length) break;

    let token = '';
    const start = s[i];

    if (start === "'") {
      i++;
      while (i < s.length && s[i] !== "'") {
        token += s[i++];
      }
      if (i < s.length && s[i] === "'") i++;
      tokens.push(token);
      continue;
    }

    if (start === '"') {
      i++;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '"') {
          i++;
          break;
        }
        if (ch === '\\' && i + 1 < s.length) {
          token += s[i + 1];
          i += 2;
          continue;
        }
        token += ch;
        i++;
      }
      tokens.push(token);
      continue;
    }

    while (i < s.length && !isWs(s[i])) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length) {
        token += s[i + 1];
        i += 2;
        continue;
      }
      token += ch;
      i++;
    }
    if (token) tokens.push(token);
  }

  return tokens;
}

function resolveCandidatePath(candidate: string, cwd: string): string {
  const expanded = expandHome(candidate);
  const abs = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
  return abs;
}

function isUrlLike(token: string): boolean {
  return token.includes('://');
}

function isPathLikeToken(token: string): boolean {
  if (!token) return false;
  if (token === '-') return false;
  if (isUrlLike(token)) return false;

  if (token === '~' || token.startsWith('~/') || token.startsWith('~\\')) return true;
  if (token.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(token)) return true;
  if (token === '.' || token === '..') return true;
  if (token.startsWith('./') || token.startsWith('.\\') || token.startsWith('../') || token.startsWith('..\\')) return true;
  if (token.includes('/../') || token.includes('\\..\\') || token.includes('/..\\') || token.includes('\\../')) return true;
  if (token.includes('/') || token.includes('\\')) return true;

  return false;
}

/**
 * Best-effort detection of file-system path references in a shell command.
 * Used to enforce "no external paths" without blocking all shell usage.
 *
 * This is not a sandbox; it only aims to catch explicit path references like:
 * - absolute paths: /etc/passwd, C:\Windows\system.ini
 * - parent traversal that resolves outside workspace: ../outside.txt
 * - home paths: ~/.ssh/id_rsa
 */
export function findExternalPathReferencesInShellCommand(
  command: string,
  options: { cwd: string; workspaceRoot: string }
): string[] {
  const cwd = path.resolve(options.cwd);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const tokens = tokenizeShellCommand(command).map(stripPunctuation).filter(Boolean);

  const candidates: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    // Redirection: ">" ">>" "<" "<<", or glued forms like ">/tmp/out".
    if (token === '>' || token === '>>' || token === '<' || token === '<<') {
      const next = tokens[i + 1];
      if (next) candidates.push(next);
      i++;
      continue;
    }
    if (token.startsWith('>') || token.startsWith('<')) {
      const maybe = token.replace(/^[><]+/, '');
      if (maybe) candidates.push(maybe);
      continue;
    }

    if (isPathLikeToken(token)) {
      candidates.push(token);
    }
  }

  const out = new Set<string>();
  for (const candidate of candidates) {
    try {
      const abs = resolveCandidatePath(candidate, cwd);
      if (!isSubPath(abs, workspaceRoot)) {
        out.add(abs);
      }
    } catch {
      // Ignore invalid paths.
    }
  }

  return [...out];
}

export function isPathInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  try {
    return isSubPath(path.resolve(targetPath), path.resolve(workspaceRoot));
  } catch {
    return false;
  }
}
