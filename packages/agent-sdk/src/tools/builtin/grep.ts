import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import * as readline from 'readline';

import type { ToolDefinition, ToolHandler } from '../../types.js';
import { optionalString, requireString } from '@kooka/core';
import { getWorkspaceRoot, resolveToolPath, toPosixPath } from './workspace.js';

const MAX_LINE_LENGTH = 2000;
const MAX_MATCHES = 100;
const MAX_FILE_BYTES = 2_000_000;

export const grepTool: ToolDefinition = {
  id: 'grep',
  name: 'Search in Files',
  description:
    'Search for a regex pattern in files. Supports optional path (file or directory, workspace-scoped) and include glob. Returns up to 100 matches grouped by file.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: {
        type: 'string',
        description:
          'File or directory to search in (absolute or workspace-relative). Must be within the current workspace. Omit for workspace root.',
      },
      include: { type: 'string', description: 'File glob to include (e.g., **/*.{ts,tsx})' },
    },
    required: ['pattern'],
  },
  execution: { type: 'function', handler: 'builtin.grep' },
  metadata: {
    category: 'file',
    icon: 'search',
    requiresApproval: false,
    permission: 'grep',
    readOnly: true,
    protocol: { output: { grep: true } },
    permissionPatterns: [
      { arg: 'pattern', kind: 'raw' },
      { arg: 'path', kind: 'path' },
      { arg: 'include', kind: 'raw' },
    ],
  },
};

type Match = { filePath: string; line: number; text: string };

function looksBinary(text: string): boolean {
  // basic guard: if file contains NUL, treat as binary
  return text.includes('\u0000');
}

export const grepHandler: ToolHandler = async (args, context) => {
  try {
    const patternResult = requireString(args, 'pattern');
    if ('error' in patternResult) return { success: false, error: patternResult.error };
    const rawPattern = patternResult.value;

    let re: RegExp;
    try {
      re = new RegExp(rawPattern, 'i');
    } catch (error) {
      return { success: false, error: `Invalid regex pattern: ${rawPattern}\n${error instanceof Error ? error.message : String(error)}` };
    }

    const baseDir = optionalString(args, 'path');
    const include = optionalString(args, 'include');

    const notes: string[] = [];
    const workspaceRoot = getWorkspaceRoot(context);

    let targetAbsPath = workspaceRoot;
    if (baseDir) {
      const resolved = resolveToolPath(baseDir, { ...context, allowExternalPaths: true });
      if (resolved.isExternal) {
        notes.push('Provided path was outside the current workspace; searching the workspace root instead.');
        targetAbsPath = workspaceRoot;
      } else {
        targetAbsPath = resolved.absPath;
      }
    }

    let stat: any;
    try {
      stat = await fs.stat(targetAbsPath);
    } catch {
      stat = null;
    }

    const isFile = !!stat?.isFile?.();
    const isDir = !!stat?.isDirectory?.();

    const matchesByFile = new Map<string, Match[]>();
    let totalMatches = 0;

    const addMatch = (m: Match) => {
      if (totalMatches >= MAX_MATCHES) return;
      const list = matchesByFile.get(m.filePath) ?? [];
      list.push(m);
      matchesByFile.set(m.filePath, list);
      totalMatches++;
    };

    const searchFile = async (filePath: string) => {
      if (totalMatches >= MAX_MATCHES) return;
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) return;
        if (stat.size > MAX_FILE_BYTES) return;
      } catch {
        return;
      }

      const stream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lineNumber = 0;
      try {
        for await (const line of rl) {
          if (totalMatches >= MAX_MATCHES) break;
          lineNumber += 1;

          const lineText = String(line ?? '');
          if (looksBinary(lineText)) {
            break;
          }
          if (!re.test(lineText)) continue;

          const trimmed = lineText.length > MAX_LINE_LENGTH ? lineText.slice(0, MAX_LINE_LENGTH) + '...' : lineText;
          addMatch({ filePath, line: lineNumber, text: trimmed });
        }
      } catch {
        // ignore read/parse errors
      } finally {
        try {
          rl.close();
        } catch {}
        try {
          stream.destroy();
        } catch {}
      }
    };

    if (isFile) {
      await searchFile(targetAbsPath);
    } else if (isDir) {
      const pattern = include && include.trim() ? include.trim() : '**/*';
      const relMatches = await glob(pattern, {
        cwd: targetAbsPath,
        ignore: ['**/node_modules/**', '**/.git/**'],
        nodir: true,
        dot: true,
        follow: false,
        windowsPathsNoEscape: true,
      });

      for (const rel of relMatches) {
        if (totalMatches >= MAX_MATCHES) break;
        await searchFile(path.resolve(targetAbsPath, rel));
      }
    } else {
      return { success: true, data: 'No files found' };
    }

    const files = Array.from(matchesByFile.keys()).sort((a, b) => a.localeCompare(b));
    if (files.length === 0) {
      const outputLines: string[] = [];
      if (notes.length > 0) {
        outputLines.push(`Note: ${notes.join(' ')}`, '');
      }
      outputLines.push('No matches found');
      return { success: true, data: outputLines.join('\n') };
    }

    const lines: string[] = [];
    if (notes.length > 0) {
      lines.push(`Note: ${notes.join(' ')}`, '');
    }

    for (const filePath of files) {
      const rel = context.workspaceRoot ? path.relative(context.workspaceRoot, filePath) : filePath;
      lines.push(`${toPosixPath(rel)}:`);
      const matches = matchesByFile.get(filePath) ?? [];
      for (const m of matches) {
        lines.push(`  ${String(m.line).padStart(5, ' ')}| ${m.text}`);
      }
      lines.push('');
    }

    if (totalMatches >= MAX_MATCHES) {
      lines.push('(Results are truncated.)');
    }

    return { success: true, data: lines.join('\n').trimEnd() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
