import * as fs from 'fs/promises';
import * as path from 'path';

import type { ToolDefinition, ToolHandler } from '../../types.js';
import { optionalNumber, requireString } from '@kooka/core';
import { BINARY_EXTENSIONS, containsBinaryData, resolveToolPath } from './workspace.js';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

export const readTool: ToolDefinition = {
  id: 'read',
  name: 'Read File',
  description:
    'Reads a file from the workspace. Prefer fileId from glob, or use filePath (absolute or workspace-relative). Supports offset (0-based) and limit (default 2000). Returns cat-style numbered lines.',
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'File handle from glob output (e.g. "F1"). Prefer this over spelling file paths.' },
      filePath: { type: 'string', description: 'Absolute path or path relative to workspace root' },
      offset: { type: 'number', description: 'Line offset to start reading from (0-based)' },
      limit: { type: 'number', description: 'Number of lines to read (default 2000)' },
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
    protocol: { input: { fileId: true } },
    permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
  },
};

export const readHandler: ToolHandler = async (args, context) => {
  const filePathResult = requireString(args, 'filePath');
  if ('error' in filePathResult) return { success: false, error: filePathResult.error };

  const filePath = filePathResult.value;

  let absPath: string;
  try {
    absPath = resolveToolPath(filePath, context).absPath;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const ext = path.extname(absPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { success: false, error: `Cannot read binary file: ${absPath}` };
  }

  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(absPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `File not found: ${absPath}\n\n${message}` };
  }

  if (containsBinaryData(bytes)) {
    return { success: false, error: `Cannot read binary file: ${absPath}` };
  }

  const text = new TextDecoder().decode(bytes);
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  const offsetRaw = optionalNumber(args, 'offset');
  const limitRaw = optionalNumber(args, 'limit');
  const offset = Math.max(0, Math.floor(offsetRaw ?? 0));
  const limit = Math.max(1, Math.floor(limitRaw ?? DEFAULT_READ_LIMIT));

  const slice = lines.slice(offset, offset + limit);
  const numbered = slice.map((line, index) => {
    const trimmed = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line;
    return `${String(index + offset + 1).padStart(5, '0')}| ${trimmed}`;
  });

  const totalLines = lines.length;
  const lastReadLine = offset + slice.length;
  const hasMoreLines = totalLines > lastReadLine;

  let output = '<file>\n' + numbered.join('\n');
  if (hasMoreLines) {
    output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
  } else {
    output += `\n\n(End of file - total ${totalLines} lines)`;
  }
  output += '\n</file>';

  return { success: true, data: output };
};
