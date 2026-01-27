import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { optionalString, requireString } from '@kooka/core';
import { resolveWorkspacePath, toPosixPath } from './workspace';

const MAX_CONTENT_CHARS = 50_000;
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

async function readIfExists(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
}

export const memoryWriteTool: ToolDefinition = {
  id: 'memory_write',
  name: 'Write Memory',
  description:
    'Persist durable notes into MEMORY.md or memory/*.md. Use this to store long-lived context that should survive compaction.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Content to write into the memory file' },
      filePath: {
        type: 'string',
        description: 'Target memory file (default: MEMORY.md). Must be MEMORY.md, memory.md, or memory/*.md',
      },
      mode: {
        type: 'string',
        enum: ['append', 'overwrite'],
        description: 'append (default) or overwrite the file',
      },
    },
    required: ['content'],
  },
  execution: { type: 'function', handler: 'builtin.memory.write' },
  metadata: {
    category: 'memory',
    icon: 'book',
    requiresApproval: false,
    permission: 'edit',
    readOnly: false,
    permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
  },
};

export const memoryWriteHandler: ToolHandler = async (args, context) => {
  try {
    const contentResult = requireString(args, 'content');
    if ('error' in contentResult) return { success: false, error: contentResult.error };
    const content = contentResult.value.trimEnd();
    if (!content) return { success: false, error: 'content must be a non-empty string.' };
    if (content.length > MAX_CONTENT_CHARS) {
      return {
        success: false,
        error: `content exceeds ${MAX_CONTENT_CHARS} characters; trim and try again.`,
      };
    }

    const rawPath = optionalString(args, 'filePath', 'MEMORY.md') ?? 'MEMORY.md';
    const mode = optionalString(args, 'mode', 'append') ?? 'append';
    if (mode !== 'append' && mode !== 'overwrite') {
      return { success: false, error: `mode must be "append" or "overwrite".` };
    }

    const { uri, absPath, relPath } = resolveWorkspacePath(rawPath, context);
    const normalizedRel = toPosixPath(relPath);
    if (!isMemoryPath(normalizedRel)) {
      return {
        success: false,
        error: `Memory writes are restricted to MEMORY.md or memory/*.md. Received: ${normalizedRel}`,
      };
    }

    const parentDir = path.dirname(absPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));

    const existing = await readIfExists(uri);
    if (existing && existing.length > MAX_FILE_BYTES) {
      return {
        success: false,
        error: `Memory file is larger than ${MAX_FILE_BYTES} bytes; split it before writing more.`,
      };
    }

    let nextContent = content;
    if (mode === 'append' && existing && existing.length > 0) {
      const existingText = new TextDecoder().decode(existing);
      const separator = existingText.endsWith('\n') ? '\n' : '\n\n';
      nextContent = existingText + separator + content;
    }

    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(nextContent));

    return {
      success: true,
      data: `Wrote memory to ${normalizedRel} (${mode}).`,
      metadata: { filePath: absPath, mode },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
