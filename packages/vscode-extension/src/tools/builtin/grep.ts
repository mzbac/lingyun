import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { requireString, optionalString } from '@kooka/core';
import { getWorkspaceRootUri, resolveWorkspacePath } from './workspace';

const MAX_MATCHES = 100;
const MAX_RAW_MATCHES = 2000;
const MAX_STDOUT_BYTES = 2_000_000;
const MAX_STDERR_BYTES = 20_000;

function getRipgrepBinaryPath(): string {
  const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const envOverride = process.env.VSCODE_RIPGREP_PATH || process.env.RG_PATH;
  if (envOverride && fs.existsSync(envOverride)) return envOverride;
  const appRoot = vscode.env.appRoot;
  const candidates = [
    path.join(appRoot, 'node_modules.asar.unpacked', 'vscode-ripgrep', 'bin', exe),
    path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exe),
    path.join(appRoot, 'node_modules', 'vscode-ripgrep', 'bin', exe),
    path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exe),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback to PATH.
  return exe;
}

export const grepTool: ToolDefinition = {
  id: 'grep',
  name: 'Search in Files',
  description:
    'Search for a regex pattern in files (plain text search). Supports optional path (file or directory, workspace-scoped) and include glob. For symbol/code-intelligence (definitions/references/types), prefer symbols_search/symbols_peek or lsp. Returns up to 100 matches grouped by file, including line+column (1-based) and matchId for follow-up symbols_peek/lsp/read.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory to search in (absolute or workspace-relative). Must be within the current workspace. Omit for workspace root.' },
      include: { type: 'string', description: 'File glob to include (e.g., **/*.md or **/*.json)' },
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
    permissionPatterns: [
      { arg: 'pattern', kind: 'raw' },
      { arg: 'path', kind: 'path' },
      { arg: 'include', kind: 'raw' },
    ],
  },
};

export const grepHandler: ToolHandler = async (args, context) => {
  try {
    const patternResult = requireString(args, 'pattern');
    if ('error' in patternResult) return { success: false, error: patternResult.error };
    const rawPattern = patternResult.value;

    const baseDir = optionalString(args, 'path');
    const include = optionalString(args, 'include');

    const notes: string[] = [];

    const rootUri = getWorkspaceRootUri(context);

    let targetAbsPath = rootUri.fsPath;
    if (baseDir) {
      try {
        const resolved = resolveWorkspacePath(baseDir, context);
        targetAbsPath = resolved.absPath;
      } catch {
        // The agent sometimes echoes absolute paths from other sessions. Keep the tool safe by
        // clamping to the current workspace root instead of failing the run.
        notes.push('Provided path was outside the current workspace; searching the workspace root instead.');
        targetAbsPath = rootUri.fsPath;
      }
    }

    let truncated = false;

    const rgPath = getRipgrepBinaryPath();
    const rgArgs = ['-nH', '--column', '--field-match-separator=|', '--regexp', rawPattern];
    // Avoid scanning dependency folders by default.
    rgArgs.push('--glob', '!**/node_modules/**');
    if (include && include.trim()) {
      rgArgs.push('--glob', include.trim());
    }
    rgArgs.push(targetAbsPath);

    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;

    const procResult = await new Promise<
      | {
          ok: true;
          exitCode: number | null;
          matches: Array<{ path: string; lineNum: number; colNum?: number; lineText: string }>;
          truncated: boolean;
        }
      | { ok: false; error: string }
    >((resolve) => {
      const proc = cp.spawn(rgPath, rgArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      const matches: Array<{ path: string; lineNum: number; colNum?: number; lineText: string }> = [];
      let stdoutBuffer = '';
      let stdoutBytes = 0;
      let truncatedByLimits = false;

      const kill = () => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      };

      const cancelListener = context.cancellationToken.onCancellationRequested(() => {
        kill();
      });

      const flushLines = (final: boolean) => {
        const parts = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = parts.pop() ?? '';

        for (const line of parts) {
          if (!line) continue;
          const fields = line.split('|');
          if (fields.length < 3) continue;

          const filePath = fields[0];
          const lineNumStr = fields[1];
          const colNumStr = fields.length >= 4 ? fields[2] : undefined;
          const lineTextParts = fields.slice(fields.length >= 4 ? 3 : 2);

          if (!filePath || !lineNumStr || lineTextParts.length === 0) continue;
          const lineNum = Number.parseInt(lineNumStr, 10);
          if (!Number.isFinite(lineNum)) continue;

          const colNum =
            colNumStr !== undefined && colNumStr !== ''
              ? Number.parseInt(colNumStr, 10)
              : undefined;
          const safeColNum = Number.isFinite(colNum as number) ? (colNum as number) : undefined;

          matches.push({
            path: filePath,
            lineNum,
            ...(safeColNum ? { colNum: safeColNum } : {}),
            lineText: lineTextParts.join('|'),
          });

          if (matches.length >= MAX_RAW_MATCHES) {
            truncatedByLimits = true;
            kill();
            break;
          }
        }

        if (final && stdoutBuffer && matches.length < MAX_RAW_MATCHES) {
          const line = stdoutBuffer;
          stdoutBuffer = '';
          const fields = line.split('|');
          if (fields.length < 3) return;

          const filePath = fields[0];
          const lineNumStr = fields[1];
          const colNumStr = fields.length >= 4 ? fields[2] : undefined;
          const lineTextParts = fields.slice(fields.length >= 4 ? 3 : 2);

          if (!filePath || !lineNumStr || lineTextParts.length === 0) return;
          const lineNum = Number.parseInt(lineNumStr, 10);
          if (!Number.isFinite(lineNum)) return;

          const colNum =
            colNumStr !== undefined && colNumStr !== ''
              ? Number.parseInt(colNumStr, 10)
              : undefined;
          const safeColNum = Number.isFinite(colNum as number) ? (colNum as number) : undefined;

          matches.push({
            path: filePath,
            lineNum,
            ...(safeColNum ? { colNum: safeColNum } : {}),
            lineText: lineTextParts.join('|'),
          });
        }
      };

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (truncatedByLimits) return;

        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          truncatedByLimits = true;
          const overflow = stdoutBytes - MAX_STDOUT_BYTES;
          const allowed = overflow > 0 ? chunk.subarray(0, Math.max(0, chunk.length - overflow)) : chunk;
          if (allowed.length > 0) {
            stdoutBuffer += allowed.toString('utf8');
            flushLines(false);
          }
          kill();
          return;
        }

        stdoutBuffer += chunk.toString('utf8');
        flushLines(false);
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBytes >= MAX_STDERR_BYTES) return;
        const remaining = MAX_STDERR_BYTES - stderrBytes;
        const toStore = remaining > 0 ? chunk.subarray(0, remaining) : Buffer.alloc(0);
        if (toStore.length === 0) return;
        stderrBytes += toStore.length;
        stderrChunks.push(toStore);
      });

      proc.on('error', (err) => {
        cancelListener.dispose();
        resolve({ ok: false, error: err.message });
      });

      proc.on('close', (code) => {
        cancelListener.dispose();
        flushLines(true);
        resolve({ ok: true, exitCode: code, matches, truncated: truncatedByLimits });
      });
    });

    if (!procResult.ok) {
      return { success: false, error: procResult.error };
    }

    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
    const exitCode = typeof procResult.exitCode === 'number' ? procResult.exitCode : 0;

    // ripgrep exit codes: 0 = matches, 1 = no matches, 2 = error
    if (exitCode === 1) {
      return {
        success: true,
        data: {
          matches: [],
          totalMatches: 0,
          truncated: false,
          ...(notes.length > 0 ? { notes } : {}),
        },
      };
    }

    if (exitCode !== 0) {
      if (procResult.truncated && procResult.matches.length > 0) {
        // We likely terminated early due to output limits. Surface partial results.
        truncated = true;
      } else {
        return { success: false, error: stderrText || `ripgrep failed with exit code ${exitCode}` };
      }
    }

    if (procResult.truncated) {
      truncated = true;
    }

    const uniquePaths: string[] = [];
    const seenPaths = new Set<string>();
    for (const m of procResult.matches) {
      if (seenPaths.has(m.path)) continue;
      seenPaths.add(m.path);
      uniquePaths.push(m.path);
    }

    const mtimes = new Map<string, number>();
    {
      let index = 0;
      const concurrency = 25;
      const workers = new Array(Math.min(concurrency, uniquePaths.length)).fill(0).map(async () => {
        while (true) {
          const i = index++;
          if (i >= uniquePaths.length) break;
          const filePath = uniquePaths[i];
          try {
            const stat = await fs.promises.stat(filePath);
            mtimes.set(filePath, stat.mtime?.getTime?.() ?? 0);
          } catch {
            mtimes.set(filePath, 0);
          }
        }
      });
      await Promise.all(workers);
    }

    const parsed = procResult.matches.map(m => ({
      path: m.path,
      modTime: mtimes.get(m.path) ?? 0,
      lineNum: m.lineNum,
      colNum: m.colNum,
      lineText: m.lineText,
    }));

    parsed.sort((a, b) => b.modTime - a.modTime);
    const finalMatches = parsed.slice(0, MAX_MATCHES);
    truncated = truncated || parsed.length > MAX_MATCHES;

    if (finalMatches.length === 0) {
      return {
        success: true,
        data: {
          matches: [],
          totalMatches: 0,
          truncated: false,
          ...(notes.length > 0 ? { notes } : {}),
        },
      };
    }

    const matches = finalMatches.map(match => ({
      filePath: match.path,
      line: match.lineNum,
      ...(Number.isFinite(match.colNum as number) ? { column: match.colNum } : {}),
      text: match.lineText.trim(),
    }));

    return {
      success: true,
      data: {
        matches,
        totalMatches: matches.length,
        truncated,
        ...(notes.length > 0 ? { notes } : {}),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
