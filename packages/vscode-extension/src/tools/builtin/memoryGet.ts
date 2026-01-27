import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { optionalNumber, optionalString } from '@kooka/core';
import { resolveWorkspacePath, toPosixPath } from './workspace';
import { getMemoryCacheSettings, getMemoryFileLines, pruneMemoryCache } from './memoryCache';

const DEFAULT_MAX_LINES = 80;
const MAX_LINE_LENGTH = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function normalizeRelPath(input: string): string {
  return input.trim().replace(/^[./]+/, '').replace(/\\/g, '/');
}

function isMemoryPath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return false;
  if (normalized === 'MEMORY.md' || normalized === 'memory.md') return true;
  return normalized.startsWith('memory/');
}

function getMaxLines(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<number>('memory.get.maxLines');
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_LINES;
  return Math.max(1, Math.floor(raw));
}

export const memoryGetTool: ToolDefinition = {
  id: 'memory_get',
  name: 'Get Memory',
  description:
    'Read a focused line range from MEMORY.md or memory/*.md. Defaults to a small window if no range is specified.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Memory file path (default: MEMORY.md). Must be MEMORY.md, memory.md, or memory/*.md',
      },
      startLine: { type: 'number', description: '1-based start line (inclusive)' },
      endLine: { type: 'number', description: '1-based end line (inclusive)' },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.memory.get' },
  metadata: {
    category: 'memory',
    icon: 'book',
    requiresApproval: false,
    permission: 'memory',
    readOnly: true,
    permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
  },
};

export const memoryGetHandler: ToolHandler = async (args, context) => {
  try {
    const filePath = optionalString(args, 'filePath', 'MEMORY.md') ?? 'MEMORY.md';
    const { uri, relPath } = resolveWorkspacePath(filePath, context);
    const normalizedRel = toPosixPath(relPath);

    if (!isMemoryPath(normalizedRel)) {
      return {
        success: false,
        error: `Memory reads are restricted to MEMORY.md or memory/*.md. Received: ${normalizedRel}`,
      };
    }

    const startLineRaw = optionalNumber(args, 'startLine');
    const endLineRaw = optionalNumber(args, 'endLine');
    const startLine = Number.isFinite(startLineRaw as number)
      ? Math.max(1, Math.floor(startLineRaw as number))
      : 1;

    const maxLines = getMaxLines();
    const endLine = Number.isFinite(endLineRaw as number)
      ? Math.max(startLine, Math.floor(endLineRaw as number))
      : startLine + maxLines - 1;

    const requestedLines = endLine - startLine + 1;
    if (requestedLines > maxLines) {
      return {
        success: false,
        error: `Requested ${requestedLines} lines exceeds lingyun.memory.get.maxLines (${maxLines}).`,
        metadata: { errorType: 'memory_get_limit_exceeded', requestedLines, maxLines },
      };
    }

    const { maxEntries } = getMemoryCacheSettings();
    const fileLines = await getMemoryFileLines({
      uri,
      relPath: normalizedRel,
      maxBytes: MAX_FILE_BYTES,
    });

    if (!fileLines) {
      return { success: false, error: `Unable to read memory file: ${normalizedRel}` };
    }

    pruneMemoryCache({ activePaths: new Set([normalizedRel]), maxEntries });

    const { lines, totalLines } = fileLines;
    if (totalLines === 0) {
      return { success: true, data: `<memory file="${normalizedRel}"></memory>`, metadata: { totalLines } };
    }

    if (startLine > totalLines) {
      return {
        success: false,
        error: `startLine ${startLine} exceeds total lines (${totalLines}).`,
        metadata: { errorType: 'memory_get_out_of_range', totalLines },
      };
    }

    const clampedEnd = Math.min(totalLines, endLine);
    const outputLines: string[] = [];
    for (let line = startLine; line <= clampedEnd; line += 1) {
      const raw = lines[line - 1] ?? '';
      const trimmed = raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) + '...' : raw;
      outputLines.push(`${String(line).padStart(5, '0')}| ${trimmed}`);
    }

    const output = `<memory file="${normalizedRel}">\n${outputLines.join('\n')}\n</memory>`;
    return {
      success: true,
      data: output,
      metadata: {
        filePath: normalizedRel,
        startLine,
        endLine: clampedEnd,
        totalLines,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
