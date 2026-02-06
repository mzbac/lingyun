import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { getLspAdapter } from '../../core/lsp';
import { requireString, optionalNumber } from '@kooka/core';
import { BINARY_EXTENSIONS, containsBinaryData, resolveToolPath } from './workspace';
import { recordFileRead } from './fileTime';
import { suggestSiblingPaths } from './pathSuggestions';

const DEFAULT_MAX_LINES = 300;
const MAX_LINE_LENGTH = 2000;

function getMaxReadLines(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<number>('tools.read.maxLines');
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_LINES;
  return Math.max(1, Math.floor(raw));
}

export const readTool: ToolDefinition = {
  id: 'read',
  name: 'Read File',
  description:
    "Reads a file from the workspace. Prefer fileId from glob, or use filePath (absolute or workspace-relative). Supports offset (0-based) and limit. For files longer than lingyun.tools.read.maxLines (default 300), you MUST provide both offset and limit (limit <= max). Returns cat-style numbered lines.",
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'File handle from glob output (e.g. "F1"). Prefer this over spelling file paths.' },
      filePath: { type: 'string', description: 'Absolute path or path relative to workspace root' },
      offset: { type: 'number', description: 'Line offset to start reading from (0-based)' },
      limit: { type: 'number', description: 'Number of lines to read (required for large files; max is lingyun.tools.read.maxLines, default 300)' },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.read' },
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

export const readHandler: ToolHandler = async (args, context) => {
  try {
    const argsRecord = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined;
    const filePathResult = requireString(args, 'filePath');
    if ('error' in filePathResult) return { success: false, error: filePathResult.error };
    const filePath = filePathResult.value;

    const { uri, absPath, isExternal } = resolveToolPath(filePath, context);

    const basename = path.basename(absPath);
    const whitelist = ['.env.sample', '.env.example', '.example', '.env.template'];
    const shouldBlockEnv =
      /^\.env(\.|$)/.test(basename) && !whitelist.some(suffix => basename.endsWith(suffix));
    if (shouldBlockEnv) {
      return {
        success: false,
        error: `The user has blocked you from reading ${absPath}, DO NOT make further attempts to read it`,
      };
    }

    const ext = path.extname(absPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return { success: false, error: `Cannot read binary file: ${absPath}` };
    }

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>).code
          : undefined;
      const isNotFound =
        code === 'ENOENT' ||
        code === 'FileNotFound' ||
        /\bENOENT\b/i.test(message) ||
        /\bFileNotFound\b/i.test(message) ||
        /no such file or directory/i.test(message);

      if (isNotFound) {
        const suggestions = await suggestSiblingPaths(absPath);
        if (suggestions.length > 0) {
          return {
            success: false,
            error: `File not found: ${absPath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`,
          };
        }
        return { success: false, error: `File not found: ${absPath}` };
      }

      throw error;
    }
    if (containsBinaryData(bytes)) {
      return { success: false, error: `Cannot read binary file: ${absPath}` };
    }

    const text = new TextDecoder().decode(bytes);
    const lines = text.replace(/\r\n/g, '\n').split('\n');

    const maxLines = getMaxReadLines();
    const offsetRaw = optionalNumber(args, 'offset');
    const limitRaw = optionalNumber(args, 'limit');
    const offsetProvided = argsRecord?.offset !== undefined && argsRecord?.offset !== null;
    const limitProvided = argsRecord?.limit !== undefined && argsRecord?.limit !== null;

    const totalLines = lines.length;
    if (totalLines > maxLines && !(offsetProvided && limitProvided)) {
      return {
        success: false,
        error:
          `File has ${totalLines} lines (> ${maxLines}). To protect the context window, ` +
          `the Read tool requires an explicit {offset, limit} range for large files.\n\n` +
          `Next steps:\n` +
          `- Use lsp (documentSymbol / workspaceSymbol / hover) to navigate semantically.\n` +
          `- Or re-run read with offset (0-based) + limit (<= ${maxLines}), e.g. { offset: 0, limit: 120 }.`,
        metadata: { errorType: 'read_requires_range', totalLines, maxLines },
      };
    }

    const offset = Math.max(0, Math.floor(offsetRaw ?? 0));
    const limit = Math.max(1, Math.floor(limitRaw ?? maxLines));

    if (limit > maxLines) {
      return {
        success: false,
        error: `Read limit ${limit} exceeds lingyun.tools.read.maxLines (${maxLines}). Use a smaller limit (and iterate with offset).`,
        metadata: { errorType: 'read_limit_exceeded', limit, maxLines },
      };
    }

    const slice = lines.slice(offset, offset + limit);
    const numbered = slice.map((line, index) => {
      const trimmed = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line;
      return `${String(index + offset + 1).padStart(5, '0')}| ${trimmed}`;
    });

    const lastReadLine = offset + slice.length;
    const hasMoreLines = totalLines > lastReadLine;

    let output = '<file>\n' + numbered.join('\n');
    if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
    } else {
      output += `\n\n(End of file - total ${totalLines} lines)`;
    }
    output += '\n</file>';

    recordFileRead(context.sessionId, absPath);

    if (!isExternal) {
      try {
        await getLspAdapter().touchFile(uri, { waitForDiagnostics: false, cancellationToken: context.cancellationToken });
      } catch {
        // Best-effort warm-up; ignore failures.
      }
    }

    return { success: true, data: output };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
