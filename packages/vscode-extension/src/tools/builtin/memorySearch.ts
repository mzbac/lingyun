import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { requireString, optionalNumber } from '@kooka/core';
import { getWorkspaceRootUri, toPosixPath } from './workspace';
import { getMemoryCacheSettings, getMemoryFileLines, pruneMemoryCache } from './memoryCache';

const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_CONTEXT_LINES = 2;
const MAX_FILE_BYTES = 512 * 1024;

type MemoryHit = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

function normalizeRelPath(input: string): string {
  return input.trim().replace(/^[./]+/, '').replace(/\\/g, '/');
}

function isMemoryPath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return false;
  if (normalized === 'MEMORY.md' || normalized === 'memory.md') return true;
  return normalized.startsWith('memory/');
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function walkMemoryDir(dir: vscode.Uri, files: vscode.Uri[]): Promise<void> {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  for (const [name, type] of entries) {
    const full = vscode.Uri.joinPath(dir, name);
    if (type === vscode.FileType.Directory) {
      await walkMemoryDir(full, files);
      continue;
    }
    if (type !== vscode.FileType.File) continue;
    if (!name.toLowerCase().endsWith('.md')) continue;
    files.push(full);
  }
}

async function listMemoryFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
  const result: vscode.Uri[] = [];
  const primary = vscode.Uri.joinPath(root, 'MEMORY.md');
  const alt = vscode.Uri.joinPath(root, 'memory.md');
  if (await exists(primary)) result.push(primary);
  if (await exists(alt)) result.push(alt);
  const memoryDir = vscode.Uri.joinPath(root, 'memory');
  if (await exists(memoryDir)) {
    await walkMemoryDir(memoryDir, result);
  }
  const deduped = new Map<string, vscode.Uri>();
  for (const entry of result) {
    deduped.set(entry.fsPath, entry);
  }
  return [...deduped.values()];
}

function buildSnippet(
  lines: string[],
  lineIndex: number,
  context: number,
  maxSnippetChars: number,
): { startLine: number; endLine: number; snippet: string } {
  const start = Math.max(0, lineIndex - context);
  const end = Math.min(lines.length - 1, lineIndex + context);
  const slice = lines.slice(start, end + 1);
  let snippet = slice.join('\n');
  if (snippet.length > maxSnippetChars) {
    snippet = snippet.slice(0, maxSnippetChars) + '…';
  }
  return { startLine: start + 1, endLine: end + 1, snippet };
}

function scoreLine(line: string, terms: string[]): number {
  const lowered = line.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    let idx = lowered.indexOf(term);
    while (idx !== -1) {
      score += 1;
      idx = lowered.indexOf(term, idx + term.length);
    }
  }
  return score;
}

export const memorySearchTool: ToolDefinition = {
  id: 'memory_search',
  name: 'Search Memory',
  description:
    'Search MEMORY.md and memory/*.md for relevant notes. Use this to recall durable project/user context before re-reading files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for memory notes' },
      limit: { type: 'number', description: 'Max results (default 6)' },
      contextLines: { type: 'number', description: 'Lines of context around each match (default 2)' },
    },
    required: ['query'],
  },
  execution: { type: 'function', handler: 'builtin.memory.search' },
  metadata: {
    category: 'memory',
    icon: 'book',
    requiresApproval: false,
    permission: 'memory',
    readOnly: true,
  },
};

export const memorySearchHandler: ToolHandler = async (args, context) => {
  try {
    const queryResult = requireString(args, 'query');
    if ('error' in queryResult) return { success: false, error: queryResult.error };
    const query = queryResult.value.trim();
    if (!query) return { success: false, error: 'Query must be a non-empty string.' };

    const limitRaw = optionalNumber(args, 'limit');
    const contextRaw = optionalNumber(args, 'contextLines');
    const limit = Math.max(1, Math.min(50, Math.floor(limitRaw ?? DEFAULT_MAX_RESULTS)));
    const contextLines = Math.max(0, Math.min(8, Math.floor(contextRaw ?? DEFAULT_CONTEXT_LINES)));
    const { maxEntries, maxSnippetChars } = getMemoryCacheSettings();

    const root = getWorkspaceRootUri({ workspaceFolder: context.workspaceFolder });
    const memoryFiles = await listMemoryFiles(root);
    if (memoryFiles.length === 0) {
      return {
        success: false,
        error:
          'No memory files found. Create MEMORY.md or memory/*.md in the workspace to store durable notes.',
        metadata: { errorType: 'memory_missing' },
      };
    }

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map(term => term.trim())
      .filter(Boolean);

    const hits: MemoryHit[] = [];
    const activePaths = new Set<string>();

    for (const file of memoryFiles) {
      const rel = toPosixPath(path.relative(root.fsPath, file.fsPath));
      if (!isMemoryPath(rel)) continue;
      activePaths.add(rel);

      const fileLines = await getMemoryFileLines({ uri: file, relPath: rel, maxBytes: MAX_FILE_BYTES });
      if (!fileLines) continue;
      const lines = fileLines.lines;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        const score = scoreLine(line, terms);
        if (score <= 0) continue;

        const snippet = buildSnippet(lines, i, contextLines, maxSnippetChars);
        hits.push({
          path: rel,
          startLine: snippet.startLine,
          endLine: snippet.endLine,
          score,
          snippet: snippet.snippet,
        });
      }
    }

    pruneMemoryCache({ activePaths, maxEntries });

    if (hits.length === 0) {
      return { success: true, data: [], metadata: { total: 0 } };
    }

    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const results = hits.slice(0, limit);

    return {
      success: true,
      data: results,
      metadata: { total: hits.length },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
