import * as fs from 'fs/promises';
import * as path from 'path';

import type { ToolDefinition, ToolHandler } from '../../types.js';
import { TOOL_ERROR_CODES, optionalBoolean, requireString } from '@kooka/core';
import { resolveToolPath } from './workspace.js';

export const writeTool: ToolDefinition = {
  id: 'write',
  name: 'Write File',
  description:
    `Write content to a file in the workspace.

Usage:
- Use this tool primarily for creating NEW files.
- If the file already exists, this tool refuses to overwrite by default.
- Set overwrite=true only if you intentionally want to replace the entire file.`,
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'File handle from glob output (e.g. "F1"). Prefer this over spelling file paths.' },
      filePath: { type: 'string', description: 'Absolute path or path relative to workspace root' },
      content: { type: 'string', description: 'Content to write' },
      overwrite: { type: 'boolean', description: 'Allow overwriting an existing file (default false)' },
    },
    required: ['content'],
  },
  execution: { type: 'function', handler: 'builtin.write' },
  metadata: {
    category: 'file',
    icon: 'file-add',
    requiresApproval: true,
    permission: 'edit',
    supportsExternalPaths: true,
    readOnly: false,
    permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
  },
};

export const writeHandler: ToolHandler = async (args, context) => {
  const filePathResult = requireString(args, 'filePath');
  if ('error' in filePathResult) return { success: false, error: filePathResult.error };

  const contentResult = requireString(args, 'content');
  if ('error' in contentResult) return { success: false, error: contentResult.error };

  let absPath: string;
  try {
    absPath = resolveToolPath(filePathResult.value, context).absPath;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const overwrite = !!optionalBoolean(args, 'overwrite', false);

  let exists = true;
  try {
    const stat = await fs.stat(absPath);
    exists = stat.isFile() || stat.isFIFO() || stat.isSocket() || stat.isCharacterDevice() || stat.isBlockDevice();
  } catch {
    exists = false;
  }

  if (exists && !overwrite) {
    return {
      success: false,
      error:
        `Refusing to overwrite an existing file with Write: ${absPath}\n\n` +
        `If you intentionally want to replace the entire file, set overwrite=true.`,
      metadata: {
        errorCode: TOOL_ERROR_CODES.write_overwrite_blocked,
        fileExists: true,
      },
    };
  }

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(contentResult.value));

  return { success: true, data: `Wrote ${contentResult.value.length} bytes to ${absPath}` };
};
