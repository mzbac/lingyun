import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { optionalNumber, requireString } from '@kooka/core';
import { BINARY_EXTENSIONS, resolveToolPath } from './workspace';

const DEFAULT_MAX_LINES = 200;
const MAX_LINE_LENGTH = 2000;

function getMaxRangeLines(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<number>('tools.read.maxLines');
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_LINES;
  return Math.max(1, Math.floor(raw));
}

export const readRangeTool: ToolDefinition = {
  id: 'read.range',
  name: 'Read Range',
  description:
    "Reads a small line range from a file (cat-style numbered lines). Prefer locId from symbols.peek, or use fileId + {startLine,endLine}. Lines are 1-based. Enforces a strict max line count (<= lingyun.tools.read.maxLines).",
  parameters: {
    type: 'object',
    properties: {
      locId: { type: 'string', description: 'Location handle from symbols.peek output (e.g. "L1")' },
      symbolId: { type: 'string', description: 'Symbol handle from symbols.search output (e.g. "S1")' },
      matchId: { type: 'string', description: 'Match handle from grep output (e.g. "M1")' },
      fileId: { type: 'string', description: 'File handle from glob/grep output (e.g. "F1")' },
      filePath: { type: 'string', description: 'Absolute path or path relative to workspace root' },
      startLine: { type: 'number', description: '1-based start line (inclusive)' },
      endLine: { type: 'number', description: '1-based end line (inclusive)' },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.read.range' },
  metadata: {
    category: 'file',
    icon: 'file',
    requiresApproval: false,
    permission: 'read',
    supportsExternalPaths: true,
    readOnly: true,
    permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
  },
};

export const readRangeHandler: ToolHandler = async (args, context) => {
  try {
    const filePathResult = requireString(args, 'filePath');
    if ('error' in filePathResult) return { success: false, error: filePathResult.error };
    const filePath = filePathResult.value;

    const startLineRaw = optionalNumber(args, 'startLine');
    const endLineRaw = optionalNumber(args, 'endLine');
    if (!Number.isFinite(startLineRaw as number) || !Number.isFinite(endLineRaw as number)) {
      return { success: false, error: 'startLine and endLine are required (1-based)' };
    }

    const startLine = Math.max(1, Math.floor(startLineRaw as number));
    const endLine = Math.max(startLine, Math.floor(endLineRaw as number));

    const maxLines = getMaxRangeLines();
    const requestedLines = endLine - startLine + 1;
    if (requestedLines > maxLines) {
      return {
        success: false,
        error: `Requested ${requestedLines} lines exceeds lingyun.tools.read.maxLines (${maxLines}). Use a smaller range.`,
        metadata: { errorType: 'read_range_limit_exceeded', requestedLines, maxLines },
      };
    }

    const { uri, absPath } = resolveToolPath(filePath, context);

    const ext = path.extname(absPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return { success: false, error: `Cannot read binary file: ${absPath}` };
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const totalLines = doc.lineCount;
    const clampedStart = Math.min(totalLines, startLine);
    const clampedEnd = Math.min(totalLines, endLine);

    const lines: string[] = [];
    for (let line = clampedStart; line <= clampedEnd; line++) {
      const raw = doc.lineAt(line - 1).text;
      const trimmed = raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) + '...' : raw;
      lines.push(`${String(line).padStart(5, '0')}| ${trimmed}`);
    }

    const output = `<file>\n${lines.join('\n')}\n</file>`;
    return {
      success: true,
      data: output,
      metadata: {
        filePath,
        startLine: clampedStart,
        endLine: clampedEnd,
        totalLines,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
