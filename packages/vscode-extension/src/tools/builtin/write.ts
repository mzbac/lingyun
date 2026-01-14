import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { getLspAdapter } from '../../core/lsp';
import { formatDiagnosticsBlock } from '../../core/lsp/diagnostics';
import { requireString } from '@lingyun/core';
import { resolveToolPath, toPosixPath } from './workspace';
import { assertFileWasRead, recordFileRead, withFileLock } from './fileTime';

export const writeTool: ToolDefinition = {
  id: 'write',
  name: 'Write File',
  description:
    `Write content to a file in the workspace.

Usage:
- Use this tool primarily for creating NEW files.
- For modifying existing files, prefer the Edit tool (it anchors changes via oldString/newString).
- If the file already exists, you MUST use the Read tool first.
- By default, this tool refuses to overwrite an existing file. Set overwrite=true only if you intentionally want to replace the entire file.`,
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
  try {
    const filePathResult = requireString(args, 'filePath');
    if ('error' in filePathResult) return { success: false, error: filePathResult.error };
    const contentResult = requireString(args, 'content');
    if ('error' in contentResult) return { success: false, error: contentResult.error };

    const { uri, absPath, relPath, isExternal } = resolveToolPath(filePathResult.value, context);
    const overwrite = Boolean((args as any).overwrite);

    return await withFileLock(absPath, async () => {
      let exists = true;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        exists = stat.type !== vscode.FileType.Unknown;
      } catch {
        exists = false;
      }

      if (exists) {
        if (!overwrite) {
          return {
            success: false,
            error:
              `Refusing to overwrite an existing file with Write: ${absPath}\n\n` +
              `Use the Edit tool to apply targeted changes (oldString/newString). ` +
              `If you intentionally want to replace the entire file, set overwrite=true (and ensure you have read the file first).`,
            metadata: {
              errorType: 'write_overwrite_blocked',
              fileExists: true,
            },
          };
        }
        await assertFileWasRead(context.sessionId, uri, absPath);
      }

      const parentDir = vscode.Uri.joinPath(uri, '..');
      await vscode.workspace.fs.createDirectory(parentDir);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(contentResult.value));
      recordFileRead(context.sessionId, absPath);

      let output = `Wrote ${contentResult.value.length} bytes to ${absPath}`;

      if (!isExternal) {
        try {
          const diagnostics = await getLspAdapter().touchFile(uri, {
            waitForDiagnostics: true,
            cancellationToken: context.cancellationToken,
          });
          const block = formatDiagnosticsBlock(diagnostics);
          if (block) {
            output += `\n\n${toPosixPath(relPath)}\n${block}`;
          }
        } catch {
          // Best-effort diagnostics; ignore failures.
        }
      }

      return { success: true, data: output };
    });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
