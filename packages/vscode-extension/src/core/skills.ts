import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { expandHome, isSubPath } from '@lingyun/core';

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

export function extractSkillMentions(text: string): string[] {
  const input = String(text || '');
  if (!input) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  // Codex convention: `$skill-name` tokens in user input.
  // Keep parsing conservative to avoid false positives (must be a plausible identifier).
  // Require an identifier-like token that starts and ends with an alphanumeric/underscore so
  // punctuation like `$skill.` doesn't capture the trailing `.`.
  const re = /\$([A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9_])?)/g;
  for (const match of input.matchAll(re)) {
    const name = match[1];
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }

  return result;
}

export function selectSkillsForText(text: string, index: SkillIndex): SkillInfo[] {
  const mentions = extractSkillMentions(text);
  if (mentions.length === 0) return [];

  const selected: SkillInfo[] = [];
  for (const name of mentions) {
    const skill = index.byName.get(name);
    if (skill) selected.push(skill);
  }
  return selected;
}

export function renderSkillsSectionForPrompt(options: {
  skills: SkillInfo[];
  maxSkills?: number;
}): string | undefined {
  const maxSkills = Math.max(0, Math.floor(options.maxSkills ?? 50));
  if (maxSkills === 0) return undefined;

  const all = Array.isArray(options.skills) ? options.skills : [];
  const shown = all.slice(0, maxSkills);
  const remaining = Math.max(0, all.length - shown.length);

  const lines: string[] = [];
  lines.push('## Skills');
  lines.push(
    'A skill is a reusable set of local instructions stored in a `SKILL.md` file. ' +
      'If the user mentions a skill (e.g. `$my-skill`), follow its instructions for that turn.',
  );
  lines.push('### Available skills');
  if (shown.length === 0) {
    lines.push('- (none)');
  } else {
    for (const skill of shown) {
      lines.push(`- ${skill.name}: ${skill.description} (file: ${skill.filePath})`);
    }
  }
  if (remaining > 0) {
    lines.push(`- ... and ${remaining} more (truncated)`);
  }

  lines.push('### How to use skills');
  lines.push(
    [
      '- Trigger: If the user includes `$<skill-name>` in their message, you MUST apply that skill for this turn.',
      '- The skill contents will be provided as a `<skill>...</skill>` block in the conversation history.',
      '- If multiple skills are mentioned, apply them all (use the minimal set that covers the request).',
      '- Do not carry skills across turns unless they are re-mentioned.',
      '- If a skill is missing or can’t be loaded, say so briefly and proceed without it.',
    ].join('\n'),
  );

  return lines.join('\n');
}

type CacheState = {
  key: string;
  builtAt: number;
  promise: Promise<SkillIndex>;
  invalidated: boolean;
};

let cache: CacheState | undefined;
let watcherState:
  | {
      workspaceRoot: string;
      patterns: Map<string, vscode.FileSystemWatcher>;
      extensionContext: vscode.ExtensionContext;
    }
  | undefined;

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

function parseSimpleYaml(frontmatter: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = (m[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseSkillMarkdown(text: string): { name: string; description: string; body: string } | undefined {
  const fm = parseFrontmatterBlock(text);
  if (!fm) return undefined;
  const data = parseSimpleYaml(fm.frontmatter);
  const name = (data.name || '').trim();
  const description = (data.description || '').trim();
  if (!name || !description) return undefined;
  return { name, description, body: fm.body.trim() };
}

async function scanForSkillFiles(
  rootDir: string,
  options: { cancellationToken?: vscode.CancellationToken; maxFiles?: number }
): Promise<string[]> {
  const results: string[] = [];
  const maxFiles = options.maxFiles ?? 200;

  const walk = async (dir: string): Promise<void> => {
    if (options.cancellationToken?.isCancellationRequested) return;
    if (results.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (options.cancellationToken?.isCancellationRequested) return;
      if (results.length >= maxFiles) return;

      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(full);
      }
    }
  };

  await walk(rootDir);
  return results;
}

function ensureWorkspaceWatchers(extensionContext: vscode.ExtensionContext, workspaceRoot: string, patterns: string[]) {
  const normalizedPatterns = patterns
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => p.trim().length > 0);

  if (
    watcherState &&
    watcherState.workspaceRoot === workspaceRoot &&
    watcherState.extensionContext === extensionContext &&
    Array.from(watcherState.patterns.keys()).sort().join('|') === normalizedPatterns.sort().join('|')
  ) {
    return;
  }

  if (watcherState) {
    for (const w of watcherState.patterns.values()) {
      w.dispose();
    }
  }

  const created = new Map<string, vscode.FileSystemWatcher>();
  for (const pattern of normalizedPatterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, pattern),
    );
    const invalidate = () => {
      if (cache) cache.invalidated = true;
    };
    watcher.onDidCreate(invalidate);
    watcher.onDidChange(invalidate);
    watcher.onDidDelete(invalidate);
    extensionContext.subscriptions.push(watcher);
    created.set(pattern, watcher);
  }

  watcherState = { workspaceRoot, patterns: created, extensionContext };

  // Tie invalidation to this watcher set so a stale cache doesn't survive directory changes.
  if (cache && cache.key.includes(workspaceRoot)) {
    cache.invalidated = true;
  }
}

export async function getSkillIndex(options: {
  extensionContext?: vscode.ExtensionContext;
  workspaceRoot?: string;
  searchPaths: string[];
  allowExternalPaths: boolean;
  cancellationToken?: vscode.CancellationToken;
  watchWorkspace?: boolean;
}): Promise<SkillIndex> {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : undefined;
  const searchPaths = (Array.isArray(options.searchPaths) ? options.searchPaths : [])
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const allowExternalPaths = !!options.allowExternalPaths;
  const watchWorkspace = !!options.extensionContext && options.watchWorkspace !== false;

  const key = JSON.stringify({
    workspaceRoot: workspaceRoot ?? '',
    allowExternalPaths,
    searchPaths,
    watchWorkspace,
  });

  if (cache && cache.key === key && !cache.invalidated && Date.now() - cache.builtAt < 3000) {
    return cache.promise;
  }

  const build = async (): Promise<SkillIndex> => {
    const scannedDirs: SkillIndex['scannedDirs'] = [];
    const byName = new Map<string, SkillInfo>();

    const workspacePatterns: string[] = [];

    const maxSkills = 200;
    let truncated = false;

    for (const input of searchPaths) {
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

      if (resolved.inWorkspace && workspaceRoot) {
        const rel = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
        const pattern = `${rel || '.'}/**/SKILL.md`.replace(/^\.\//, '');
        workspacePatterns.push(pattern);
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

      const files = await scanForSkillFiles(absPath, { cancellationToken: options.cancellationToken, maxFiles: 1000 });
      files.sort((a, b) => a.localeCompare(b));

      for (const filePath of files) {
        if (options.cancellationToken?.isCancellationRequested) break;
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

    if (workspaceRoot && options.extensionContext && options.watchWorkspace !== false) {
      ensureWorkspaceWatchers(options.extensionContext, workspaceRoot, workspacePatterns);
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
