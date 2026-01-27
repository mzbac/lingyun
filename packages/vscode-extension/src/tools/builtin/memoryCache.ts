import * as vscode from 'vscode';

type MemoryCacheEntry = {
  relPath: string;
  mtimeMs: number;
  size: number;
  lines: string[];
  lastAccessedAt: number;
};

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_SNIPPET_CHARS = 1200;

const cache = new Map<string, MemoryCacheEntry>();

export function getMemoryCacheSettings(): { maxEntries: number; maxSnippetChars: number } {
  const cfg = vscode.workspace.getConfiguration('lingyun');
  const maxEntriesRaw = cfg.get<number>('memory.cache.maxEntries');
  const maxSnippetCharsRaw = cfg.get<number>('memory.cache.maxSnippetChars');
  const maxEntries =
    typeof maxEntriesRaw === 'number' && Number.isFinite(maxEntriesRaw)
      ? Math.max(0, Math.floor(maxEntriesRaw))
      : DEFAULT_MAX_ENTRIES;
  const maxSnippetChars =
    typeof maxSnippetCharsRaw === 'number' && Number.isFinite(maxSnippetCharsRaw)
      ? Math.max(200, Math.floor(maxSnippetCharsRaw))
      : DEFAULT_MAX_SNIPPET_CHARS;
  return { maxEntries, maxSnippetChars };
}

export async function getMemoryFileLines(params: {
  uri: vscode.Uri;
  relPath: string;
  maxBytes: number;
}): Promise<{ lines: string[]; totalLines: number } | undefined> {
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(params.uri);
  } catch {
    cache.delete(params.relPath);
    return undefined;
  }

  if (stat.size > params.maxBytes) {
    cache.delete(params.relPath);
    return undefined;
  }

  const existing = cache.get(params.relPath);
  if (existing && existing.mtimeMs === stat.mtime && existing.size === stat.size) {
    existing.lastAccessedAt = Date.now();
    return { lines: existing.lines, totalLines: existing.lines.length };
  }

  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(params.uri);
  } catch {
    cache.delete(params.relPath);
    return undefined;
  }

  const text = new TextDecoder().decode(bytes);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  cache.set(params.relPath, {
    relPath: params.relPath,
    mtimeMs: stat.mtime,
    size: stat.size,
    lines,
    lastAccessedAt: Date.now(),
  });

  return { lines, totalLines: lines.length };
}

export function pruneMemoryCache(params: { activePaths: Set<string>; maxEntries: number }): void {
  for (const key of cache.keys()) {
    if (!params.activePaths.has(key)) {
      cache.delete(key);
    }
  }

  if (params.maxEntries <= 0 || cache.size <= params.maxEntries) return;

  const entries = Array.from(cache.values()).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  const excess = cache.size - params.maxEntries;
  for (let i = 0; i < excess; i += 1) {
    const entry = entries[i];
    if (entry) {
      cache.delete(entry.relPath);
    }
  }
}
