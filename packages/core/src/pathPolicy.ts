import * as fs from 'fs';
import * as path from 'path';

import { expandHome, isSubPath, normalizeFsPath } from './fsPath';

export type WorkspacePathPolicyEvaluation = {
  workspaceRoot: string;
  absPath: string;
  relPath: string;
  isExternal: boolean;
  lexicalExternal: boolean;
  canonicalKnown: boolean;
  canonicalRoot?: string;
  canonicalTarget?: string;
  canonicalExternal?: boolean;
};

export type ShellPathAccessEvaluation = {
  cwd: string;
  workspaceRoot: string;
  blockedPaths: string[];
  isCwdExternal: boolean;
};

export type DotEnvSensitivity = 'protected' | 'sample' | 'none';

const DOTENV_ALLOWLIST_SUFFIXES = ['.env.sample', '.env.example', '.example', '.env.template'];
const DOTENV_TOKEN_REGEX = /(^|[^A-Za-z0-9_])(\.env(?:\.[A-Za-z0-9_.-]+)?)(?=$|[^A-Za-z0-9_.-])/g;

const POSIX_ENV_VAR_REGEX = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const WINDOWS_ENV_VAR_REGEX = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
const POSIX_BARE_ENV_REF_REGEX = /^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/;
const WINDOWS_BARE_ENV_REF_REGEX = /^%[A-Za-z_][A-Za-z0-9_]*%$/;
const SAFE_PATH_ENV_VARS = new Set(['PWD', 'OLDPWD', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TMPDIR', 'TMP', 'TEMP']);
const PATH_HINT_ENV_VARS = new Set([...SAFE_PATH_ENV_VARS, 'WORKSPACE_ROOT', 'WORKDIR']);

export function evaluateWorkspacePathPolicy(
  inputPath: string,
  options: { workspaceRoot: string }
): WorkspacePathPolicyEvaluation {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const absPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(workspaceRoot, inputPath);

  const normalizedRoot = normalizeFsPath(workspaceRoot);
  const normalizedAbs = normalizeFsPath(absPath);
  const lexicalExternal = normalizedAbs !== normalizedRoot && !normalizedAbs.startsWith(normalizedRoot + path.sep);

  const canonicalRoot = canonicalizePathForContainment(workspaceRoot);
  const canonicalTarget = canonicalizePathForContainment(absPath);
  const canonicalKnown = !!canonicalRoot && !!canonicalTarget;
  const canonicalExternal =
    canonicalKnown &&
    canonicalTarget !== canonicalRoot &&
    !canonicalTarget.startsWith(canonicalRoot + path.sep);

  const isExternal = canonicalKnown ? !!canonicalExternal : lexicalExternal;
  const relPath = isExternal ? absPath : path.relative(workspaceRoot, absPath) || '.';

  return {
    workspaceRoot,
    absPath,
    relPath,
    isExternal,
    lexicalExternal,
    canonicalKnown,
    ...(canonicalRoot ? { canonicalRoot } : {}),
    ...(canonicalTarget ? { canonicalTarget } : {}),
    ...(canonicalKnown ? { canonicalExternal: !!canonicalExternal } : {}),
  };
}

export function findNearestExistingAncestor(targetPath: string): string | undefined {
  let current = path.resolve(targetPath);
  while (true) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function canonicalizePathForContainment(targetPath: string): string | undefined {
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

function stripPunctuation(token: string): string {
  let out = token.trim();
  if (!out) return out;

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
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
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

function hasCommandSubstitution(token: string): boolean {
  return token.includes('$(') || token.includes('`');
}

function extractEnvVarNames(token: string): string[] {
  const names = new Set<string>();
  POSIX_ENV_VAR_REGEX.lastIndex = 0;
  for (const match of token.matchAll(POSIX_ENV_VAR_REGEX)) {
    const name = match[1] || match[2];
    if (name) names.add(name);
  }
  WINDOWS_ENV_VAR_REGEX.lastIndex = 0;
  for (const match of token.matchAll(WINDOWS_ENV_VAR_REGEX)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

function isDynamicPathToken(token: string): boolean {
  if (!token || isUrlLike(token)) return false;
  if (hasCommandSubstitution(token)) return true;
  const vars = extractEnvVarNames(token);
  if (vars.length === 0) return false;
  if (token.includes('/') || token.includes('\\')) return true;
  if (POSIX_BARE_ENV_REF_REGEX.test(token) || WINDOWS_BARE_ENV_REF_REGEX.test(token)) return true;
  return vars.some(name => PATH_HINT_ENV_VARS.has(name.toUpperCase()));
}

function resolveSafeEnvValue(name: string, cwd: string): string | undefined {
  const upper = name.toUpperCase();
  if (!SAFE_PATH_ENV_VARS.has(upper)) return undefined;
  if (upper === 'PWD') return cwd;

  if (upper === 'HOMEPATH') {
    const homePath = process.env.HOMEPATH;
    if (!homePath) return undefined;
    const homeDrive = process.env.HOMEDRIVE;
    if (homeDrive && homePath.startsWith('\\')) {
      return `${homeDrive}${homePath}`;
    }
    return homePath;
  }

  const value = process.env[upper] ?? process.env[name];
  if (!value || !String(value).trim()) return undefined;
  return value;
}

function resolveDynamicPathCandidate(
  candidate: string,
  cwd: string
): { candidate: string; unresolvedDynamic: boolean } {
  if (hasCommandSubstitution(candidate)) {
    return { candidate, unresolvedDynamic: true };
  }

  let unresolvedDynamic = false;
  POSIX_ENV_VAR_REGEX.lastIndex = 0;
  let expanded = candidate.replace(POSIX_ENV_VAR_REGEX, (match, braced: string, plain: string) => {
    const varName = braced || plain;
    const resolved = resolveSafeEnvValue(varName, cwd);
    if (!resolved) {
      unresolvedDynamic = true;
      return match;
    }
    return resolved;
  });

  WINDOWS_ENV_VAR_REGEX.lastIndex = 0;
  expanded = expanded.replace(WINDOWS_ENV_VAR_REGEX, (match, name: string) => {
    const resolved = resolveSafeEnvValue(name, cwd);
    if (!resolved) {
      unresolvedDynamic = true;
      return match;
    }
    return resolved;
  });

  return { candidate: expanded, unresolvedDynamic };
}

export function evaluateShellPathAccess(
  command: string,
  options: { cwd: string; workspaceRoot: string }
): ShellPathAccessEvaluation {
  const cwd = path.resolve(options.cwd);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const tokens = tokenizeShellCommand(command).map(stripPunctuation).filter(Boolean);

  const candidates: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

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

    if (isPathLikeToken(token) || isDynamicPathToken(token)) {
      candidates.push(token);
    }
  }

  const blocked = new Set<string>();
  const isCwdExternal = !isSubPath(cwd, workspaceRoot);
  if (isCwdExternal) {
    blocked.add(cwd);
  }

  for (const candidate of candidates) {
    try {
      const dynamic = resolveDynamicPathCandidate(candidate, cwd);
      if (dynamic.unresolvedDynamic) {
        blocked.add(candidate);
        continue;
      }
      const abs = resolveCandidatePath(dynamic.candidate, cwd);
      if (!isSubPath(abs, workspaceRoot)) {
        blocked.add(abs);
      }
    } catch {
      // Ignore invalid paths.
    }
  }

  return {
    cwd,
    workspaceRoot,
    blockedPaths: [...blocked],
    isCwdExternal,
  };
}

export function findExternalPathReferencesInShellCommand(
  command: string,
  options: { cwd: string; workspaceRoot: string }
): string[] {
  return evaluateShellPathAccess(command, options).blockedPaths;
}

export function isPathInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  try {
    return isSubPath(path.resolve(targetPath), path.resolve(workspaceRoot));
  } catch {
    return false;
  }
}

export function classifyDotEnvPath(value: string): DotEnvSensitivity {
  const basename = path.basename(String(value || '')).toLowerCase();
  if (!/^\.env(\.|$)/.test(basename)) return 'none';
  if (DOTENV_ALLOWLIST_SUFFIXES.some(allowed => basename.endsWith(allowed))) return 'sample';
  return 'protected';
}

export function isProtectedDotEnvPath(value: string): boolean {
  return classifyDotEnvPath(value) === 'protected';
}

export function collectProtectedDotEnvMentions(text: string): string[] {
  const out = new Set<string>();
  for (const match of String(text || '').matchAll(DOTENV_TOKEN_REGEX)) {
    const candidate = match[2];
    if (candidate && isProtectedDotEnvPath(candidate)) {
      out.add(candidate);
    }
  }
  return [...out];
}
