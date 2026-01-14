import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { access } from 'fs/promises';

export type InstructionSource = {
  uri: vscode.Uri;
  label: string;
};

export type LoadedInstructions = {
  sources: InstructionSource[];
  text?: string;
};

const LOCAL_RULE_FILES = ['AGENTS.md', 'CONTEXT.md'];

function normalizeUriPath(p: string): string {
  if (!p) return '/';
  return p.replace(/\/+$/, '') || '/';
}

function isSameUriDir(a: vscode.Uri, b: vscode.Uri): boolean {
  return (
    a.scheme === b.scheme &&
    a.authority === b.authority &&
    normalizeUriPath(a.path) === normalizeUriPath(b.path)
  );
}

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = normalizeUriPath(uri.path);
  const parent = path.posix.dirname(normalized);
  if (parent === normalized) return uri;
  return uri.with({ path: parent });
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findGitRoot(startDir: vscode.Uri, workspaceRoot: vscode.Uri): Promise<vscode.Uri> {
  let current = startDir;
  while (true) {
    const candidate = vscode.Uri.joinPath(current, '.git');
    if (await uriExists(candidate)) return current;

    if (isSameUriDir(current, workspaceRoot)) return workspaceRoot;
    const parent = dirnameUri(current);
    if (isSameUriDir(parent, current)) return workspaceRoot;
    current = parent;
  }
}

async function findUp(fileName: string, startDir: vscode.Uri, stopDir: vscode.Uri): Promise<vscode.Uri[]> {
  const matches: vscode.Uri[] = [];
  let current = startDir;

  while (true) {
    const candidate = vscode.Uri.joinPath(current, fileName);
    if (await uriExists(candidate)) {
      matches.push(candidate);
    }

    if (isSameUriDir(current, stopDir)) break;

    const parent = dirnameUri(current);
    if (isSameUriDir(parent, current)) break;
    current = parent;
  }

  return matches;
}

function formatLabel(uri: vscode.Uri, workspaceRoot?: vscode.Uri): string {
  if (uri.scheme === 'file') {
    const fp = uri.fsPath;

    const home = os.homedir();
    if (fp.startsWith(home + path.sep)) {
      return `~${fp.slice(home.length)}`;
    }

    if (workspaceRoot?.scheme === 'file') {
      try {
        const rel = path.relative(workspaceRoot.fsPath, fp);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          return rel;
        }
      } catch {
        // Ignore
      }
    }

    return fp;
  }

  return uri.toString();
}

function isGlobPattern(value: string): boolean {
  return /[*?[\]]/.test(value);
}

function globToRegExp(pattern: string): RegExp | null {
  if (!pattern) return null;

  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      re += '.*';
      continue;
    }
    if (ch === '?') {
      re += '.';
      continue;
    }
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        re += '\\[';
        continue;
      }

      const inner = pattern.slice(i + 1, end);
      // Avoid creating invalid regex for edge cases.
      if (!inner) {
        re += '\\[\\]';
        i = end;
        continue;
      }

      re += `[${inner}]`;
      i = end;
      continue;
    }

    if (/[$()*+.?[\\\]^{|}]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';

  try {
    return new RegExp(re);
  } catch {
    return null;
  }
}

async function globUp(pattern: string, startDir: vscode.Uri, stopDir: vscode.Uri): Promise<vscode.Uri[]> {
  const results: vscode.Uri[] = [];
  let current = startDir;

  while (true) {
    try {
      const base = current.scheme === 'file' ? current.fsPath : current.path;
      const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(base, pattern));
      results.push(...matches);
    } catch {
      // Ignore invalid glob patterns
    }

    if (isSameUriDir(current, stopDir)) break;

    const parent = dirnameUri(current);
    if (isSameUriDir(parent, current)) break;
    current = parent;
  }

  return results;
}

async function resolveExtraInstructionUris(options: {
  pattern: string;
  startDir: vscode.Uri;
  stopDir: vscode.Uri;
  workspaceRoot?: vscode.Uri;
}): Promise<vscode.Uri[]> {
  const trimmed = (options.pattern || '').trim();
  if (!trimmed) return [];

  let resolved = trimmed;
  if (resolved.startsWith('~/')) {
    resolved = path.join(os.homedir(), resolved.slice(2));
  }

  if (path.isAbsolute(resolved)) {
    if (!isGlobPattern(resolved)) {
      if (await fileExists(resolved)) return [vscode.Uri.file(resolved)];
      return [];
    }

    const baseDir = path.dirname(resolved);
    const basename = path.basename(resolved);
    const matcher = globToRegExp(basename);
    if (!matcher) return [];

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(baseDir));
      return entries
        .filter(([name, type]) => type === vscode.FileType.File && matcher.test(name))
        .map(([name]) => vscode.Uri.file(path.join(baseDir, name)));
    } catch {
      return [];
    }
  }

  // "globUp": try the pattern relative to startDir and each parent directory up to stopDir.
  if (options.workspaceRoot) {
    return globUp(resolved, options.startDir, options.stopDir);
  }

  // No workspace: treat as relative file path from cwd.
  const fallback = path.resolve(process.cwd(), resolved);
  if (await fileExists(fallback)) return [vscode.Uri.file(fallback)];
  return [];
}

async function readTextFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function loadInstructions(options: {
  startDir: vscode.Uri;
  workspaceRoot?: vscode.Uri;
  stopDir?: vscode.Uri;
  extraInstructionPatterns?: string[];
  includeGlobal?: boolean;
  maxCharsPerFile?: number;
  maxTotalChars?: number;
}): Promise<LoadedInstructions> {
  const workspaceRoot = options.workspaceRoot;
  const stopDir = options.stopDir || (workspaceRoot ?? options.startDir);
  const extra = options.extraInstructionPatterns || [];
  const includeGlobal = options.includeGlobal !== false;
  const maxCharsPerFile = options.maxCharsPerFile ?? 60_000;
  const maxTotalChars = options.maxTotalChars ?? 180_000;

  const uris: vscode.Uri[] = [];

  // 1) Local rule discovery: AGENTS.md → CONTEXT.md. Prefer the first match type; include all matches along the directory chain.
  for (const ruleName of LOCAL_RULE_FILES) {
    const matches = await findUp(ruleName, options.startDir, stopDir);
    if (matches.length > 0) {
      uris.push(...matches);
      break;
    }
  }

  // 2) Global rule discovery: prefer ~/.config/lingyun/AGENTS.md (first match wins).
  if (includeGlobal) {
    const configHome =
      process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()
        ? process.env.XDG_CONFIG_HOME.trim()
        : path.join(os.homedir(), '.config');

    const globalCandidates = [path.join(configHome, 'lingyun', 'AGENTS.md')];

    for (const candidate of globalCandidates) {
      if (await fileExists(candidate)) {
        uris.push(vscode.Uri.file(candidate));
        break;
      }
    }
  }

  // 3) Additional instruction patterns from config "instructions").
  for (const pattern of extra) {
    const matches = await resolveExtraInstructionUris({
      pattern,
      startDir: options.startDir,
      stopDir,
      workspaceRoot,
    });
    uris.push(...matches);
  }

  const seen = new Set<string>();
  const sources: InstructionSource[] = [];

  for (const uri of uris) {
    const key = uri.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ uri, label: formatLabel(uri, workspaceRoot) });
  }

  if (sources.length === 0) {
    return { sources, text: undefined };
  }

  let total = 0;
  const chunks: string[] = [];
  chunks.push(
    [
      '## Instruction Files',
      'These files provide project-specific rules for this workspace.',
      '- Scope: instructions apply to the directory tree rooted at the folder that contains the file.',
      '- Precedence: if multiple files apply, more deeply nested files take precedence over less specific ones.',
    ].join('\n')
  );

  for (const src of sources) {
    if (total >= maxTotalChars) break;

    try {
      let content = await readTextFile(src.uri);
      if (content.length > maxCharsPerFile) {
        content = content.slice(0, maxCharsPerFile) + '\n\n... [TRUNCATED]';
      }

      const remaining = Math.max(0, maxTotalChars - total);
      if (content.length > remaining) {
        content = content.slice(0, remaining) + '\n\n... [TRUNCATED]';
      }

      total += content.length;
      chunks.push(`\nInstructions from: ${src.label}\n${content}`);
    } catch {
      // Ignore unreadable instruction files
    }
  }

  const text = chunks.join('\n');
  return { sources, text };
}
