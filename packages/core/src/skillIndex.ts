import * as fs from 'fs';
import * as path from 'path';

import { expandHome, isSubPath } from './fsPath';

export type SkillInfo = {
  name: string;
  description: string;
  filePath: string;
  dir: string;
  source: 'workspace' | 'external';
};

export type SkillIndex = {
  skills: SkillInfo[];
  byName: Map<string, SkillInfo>;
  scannedDirs: Array<{
    input: string;
    absPath: string;
    status: 'ok' | 'missing' | 'skipped_external' | 'error';
    reason?: string;
  }>;
  truncated?: boolean;
};

type CacheState = {
  key: string;
  builtAt: number;
  promise: Promise<SkillIndex>;
  invalidated: boolean;
};

const DEFAULT_CACHE_MAX_AGE_MS = 3000;
const DEFAULT_MAX_SKILLS = 200;
const DEFAULT_SCAN_MAX_FILES = 1000;
const DEFAULT_SCAN_MAX_DIRS = 4000;
const DEFAULT_SCAN_IGNORE_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  '.turbo',
  '.next',
]);

let cache: CacheState | undefined;

export function invalidateSkillIndexCache(): void {
  if (cache) cache.invalidated = true;
}

function resolveSkillDir(input: string, workspaceRoot?: string): { absPath: string; inWorkspace: boolean } {
  const expanded = expandHome(input);
  const absPath =
    workspaceRoot && expanded && !path.isAbsolute(expanded)
      ? path.resolve(workspaceRoot, expanded)
      : path.resolve(expanded);
  return {
    absPath,
    inWorkspace: workspaceRoot ? isSubPath(absPath, workspaceRoot) : false,
  };
}

function parseFrontmatterBlock(text: string): { frontmatter: string; body: string } | null {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return null;
  const frontmatter = match[1] ?? '';
  const body = text.slice(match[0].length);
  return { frontmatter, body };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function foldYamlLines(lines: string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      if (current.length > 0) {
        paragraphs.push(current.join(' ').trim());
        current = [];
      }
      continue;
    }
    current.push(line.trim());
  }

  if (current.length > 0) {
    paragraphs.push(current.join(' ').trim());
  }

  return paragraphs.join('\n\n').trim();
}

function parseFrontmatterValue(frontmatter: string, key: string): string {
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const keyMatch = rawLine.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;
    const indent = keyMatch[1]?.length ?? 0;
    const foundKey = keyMatch[2] ?? '';
    if (foundKey !== key) continue;

    const rawValue = (keyMatch[3] ?? '').trimEnd();
    const scalarMatch = rawValue.trim().match(/^([>|])([+-])?(\d+)?\s*$/);

    if (!scalarMatch) {
      return unquote(rawValue);
    }

    const style = scalarMatch[1] === '|' ? 'literal' : 'folded';
    const content: string[] = [];

    const contentLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? '';
      if (!next.trim()) {
        contentLines.push('');
        continue;
      }

      const nextIndent = (next.match(/^(\s*)/)?.[1]?.length ?? 0);
      const looksLikeKey = /^[A-Za-z0-9_.-]+\s*:\s*\S/.test(next.trimStart());
      if (nextIndent <= indent && looksLikeKey) break;
      contentLines.push(next);
    }

    let blockIndent: number | undefined;
    for (const line of contentLines) {
      if (!line.trim()) continue;
      const leading = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (leading > indent) {
        blockIndent = leading;
        break;
      }
    }

    for (const line of contentLines) {
      if (!line) {
        content.push('');
        continue;
      }
      if (typeof blockIndent === 'number' && blockIndent > 0 && line.length >= blockIndent) {
        content.push(line.slice(blockIndent));
      } else {
        content.push(line.trimStart());
      }
    }

    if (style === 'literal') {
      return content.join('\n').trim();
    }
    return foldYamlLines(content);
  }

  return '';
}

export function parseSkillMarkdown(text: string): { name: string; description: string; body: string } | undefined {
  const fm = parseFrontmatterBlock(text);
  if (!fm) return undefined;
  const name = parseFrontmatterValue(fm.frontmatter, 'name').trim();
  const description = parseFrontmatterValue(fm.frontmatter, 'description').trim();
  if (!name || !description) return undefined;
  return { name, description, body: fm.body.trim() };
}

async function scanForSkillFiles(
  rootDir: string,
  options: { signal?: AbortSignal; maxFiles?: number; maxDirs?: number; ignoreDirNames?: Set<string> }
): Promise<{ files: string[]; truncated: boolean }> {
  const results: string[] = [];
  const maxFiles = options.maxFiles ?? DEFAULT_SCAN_MAX_FILES;
  const maxDirs = options.maxDirs ?? DEFAULT_SCAN_MAX_DIRS;
  const ignoreDirNames = options.ignoreDirNames ?? DEFAULT_SCAN_IGNORE_DIR_NAMES;

  let truncated = false;
  let visitedDirs = 0;

  const walk = async (dir: string): Promise<void> => {
    if (options.signal?.aborted) return;
    if (results.length >= maxFiles) {
      truncated = true;
      return;
    }
    if (visitedDirs >= maxDirs) {
      truncated = true;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    visitedDirs += 1;

    for (const entry of entries) {
      if (options.signal?.aborted) return;
      if (results.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (visitedDirs >= maxDirs) {
        truncated = true;
        return;
      }

      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (ignoreDirNames.has(entry.name)) continue;
        await walk(full);
        continue;
      }

      if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(full);
      }
    }
  };

  await walk(rootDir);
  return { files: results, truncated };
}

export async function getSkillIndex(options: {
  workspaceRoot?: string;
  searchPaths: string[];
  allowExternalPaths: boolean;
  signal?: AbortSignal;
  cacheMaxAgeMs?: number;
  maxSkills?: number;
}): Promise<SkillIndex> {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : undefined;
  const searchPaths = (Array.isArray(options.searchPaths) ? options.searchPaths : [])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const allowExternalPaths = !!options.allowExternalPaths;

  const cacheMaxAgeMs =
    typeof options.cacheMaxAgeMs === 'number' && Number.isFinite(options.cacheMaxAgeMs) && options.cacheMaxAgeMs >= 0
      ? Math.floor(options.cacheMaxAgeMs)
      : DEFAULT_CACHE_MAX_AGE_MS;

  const maxSkills =
    typeof options.maxSkills === 'number' && Number.isFinite(options.maxSkills) && options.maxSkills > 0
      ? Math.floor(options.maxSkills)
      : DEFAULT_MAX_SKILLS;

  const key = JSON.stringify({
    workspaceRoot: workspaceRoot ?? '',
    allowExternalPaths,
    searchPaths,
    maxSkills,
  });

  if (
    cache &&
    cache.key === key &&
    !cache.invalidated &&
    (cacheMaxAgeMs === 0 || Date.now() - cache.builtAt < cacheMaxAgeMs)
  ) {
    return cache.promise;
  }

  const build = async (): Promise<SkillIndex> => {
    const scannedDirs: SkillIndex['scannedDirs'] = [];
    const byName = new Map<string, SkillInfo>();

    let truncated = false;

    for (const input of searchPaths) {
      if (options.signal?.aborted) break;

      const resolved = resolveSkillDir(input, workspaceRoot);
      const absPath = resolved.absPath;

      const isExternalDir = workspaceRoot ? !isSubPath(absPath, workspaceRoot) : path.isAbsolute(absPath);
      if (isExternalDir && !allowExternalPaths) {
        scannedDirs.push({
          input,
          absPath,
          status: 'skipped_external',
          reason: 'External paths disabled',
        });
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(absPath);
      } catch {
        scannedDirs.push({ input, absPath, status: 'missing' });
        continue;
      }

      if (!stat.isDirectory()) {
        scannedDirs.push({ input, absPath, status: 'error', reason: 'Not a directory' });
        continue;
      }

      scannedDirs.push({ input, absPath, status: 'ok' });

      const scan = await scanForSkillFiles(absPath, {
        signal: options.signal,
        maxFiles: DEFAULT_SCAN_MAX_FILES,
        maxDirs: DEFAULT_SCAN_MAX_DIRS,
        ignoreDirNames: DEFAULT_SCAN_IGNORE_DIR_NAMES,
      });
      const files = scan.files;
      if (scan.truncated) truncated = true;
      files.sort((a, b) => a.localeCompare(b));

      for (const filePath of files) {
        if (options.signal?.aborted) break;
        if (byName.size >= maxSkills) {
          truncated = true;
          break;
        }

        let text: string;
        try {
          text = await fs.promises.readFile(filePath, 'utf8');
        } catch {
          continue;
        }

        const parsed = parseSkillMarkdown(text);
        if (!parsed) continue;

        const source: SkillInfo['source'] =
          workspaceRoot && isSubPath(filePath, workspaceRoot) ? 'workspace' : 'external';
        const dir = path.dirname(filePath);

        byName.set(parsed.name, {
          name: parsed.name,
          description: parsed.description,
          filePath,
          dir,
          source,
        });
      }
    }

    const skills = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));

    return {
      skills,
      byName,
      scannedDirs,
      ...(truncated ? { truncated: true } : {}),
    };
  };

  cache = {
    key,
    builtAt: Date.now(),
    promise: build(),
    invalidated: false,
  };

  return cache.promise;
}

export async function loadSkillFile(skill: SkillInfo): Promise<{ content: string }> {
  const text = await fs.promises.readFile(skill.filePath, 'utf8');
  const parsed = parseSkillMarkdown(text);
  if (!parsed) {
    throw new Error('Invalid SKILL.md: missing frontmatter (name/description)');
  }
  return { content: parsed.body.trim() };
}
