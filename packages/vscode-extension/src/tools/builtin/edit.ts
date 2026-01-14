import * as vscode from 'vscode';
import * as crypto from 'crypto';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { getLspAdapter } from '../../core/lsp';
import { formatDiagnosticsBlock } from '../../core/lsp/diagnostics';
import { requireString } from '@lingyun/core';
import { resolveToolPath, toPosixPath } from './workspace';
import { assertFileWasRead, recordFileRead, withFileLock } from './fileTime';
import { replaceInContent } from './editReplace';
import { suggestSiblingPaths } from './pathSuggestions';

export const editTool: ToolDefinition = {
  id: 'edit',
  name: 'Edit File',
  description:
    `Replace text in a file.

Usage:
- Always read the file first using the Read tool before editing.
- When copying content from the Read tool output, never include any part of the line-number prefix (e.g. "00001| "). Use only the actual file text after the prefix.
- The edit will fail if oldString is not found.
- If oldString matches multiple places and replaceAll is false, the edit will fail; provide a larger oldString or set replaceAll.`,
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'File handle from glob output (e.g. "F1"). Prefer this over spelling file paths.' },
      filePath: { type: 'string', description: 'Absolute path or path relative to workspace root' },
      oldString: { type: 'string', description: 'The text to replace' },
      newString: { type: 'string', description: 'Replacement text (must be different)' },
      replaceAll: { type: 'boolean', description: 'Replace all occurrences (default false)' },
      overwrite: {
        type: 'boolean',
        description:
          'Allow overwriting an existing file when oldString is empty (default false). Prefer anchored edits instead.',
      },
    },
    required: ['oldString', 'newString'],
  },
  execution: { type: 'function', handler: 'builtin.edit' },
  metadata: {
    category: 'file',
    icon: 'edit',
    requiresApproval: true,
    permission: 'edit',
    supportsExternalPaths: true,
    readOnly: false,
    permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
  },
};

export const editHandler: ToolHandler = async (args, context) => {
  try {
    const filePathResult = requireString(args, 'filePath');
    if ('error' in filePathResult) return { success: false, error: filePathResult.error };
    const oldStringResult = requireString(args, 'oldString');
    if ('error' in oldStringResult) return { success: false, error: oldStringResult.error };
    const newStringResult = requireString(args, 'newString');
    if ('error' in newStringResult) return { success: false, error: newStringResult.error };

    const oldString = oldStringResult.value;
    const newString = newStringResult.value;
    if (oldString === newString) {
      return { success: false, error: 'oldString and newString must be different' };
    }

    const { uri, absPath, relPath, isExternal } = resolveToolPath(filePathResult.value, context);

    const replaceAll = Boolean(args.replaceAll);
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
        await assertFileWasRead(context.sessionId, uri, absPath);
      }

      if (!exists) {
        const suggestions = await suggestSiblingPaths(absPath);
        if (suggestions.length > 0) {
          return {
            success: false,
            error: `File not found: ${absPath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`,
          };
        }
        if (oldString !== '') {
          return { success: false, error: `File not found: ${absPath}` };
        }
      }

      if (oldString === '') {
        if (exists && !overwrite) {
          return {
            success: false,
            error:
              `Refusing to overwrite an existing file with edit(oldString=""): ${absPath}\n\n` +
              `Use an anchored edit with a non-empty oldString copied exactly from Read output. ` +
              `If you intentionally want to replace the entire file, set overwrite=true.`,
            metadata: {
              errorType: 'edit_overwrite_blocked',
              fileExists: true,
            },
          };
        }
        const parentDir = vscode.Uri.joinPath(uri, '..');
        await vscode.workspace.fs.createDirectory(parentDir);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(newString));
        recordFileRead(context.sessionId, absPath);

        let output = `Edited ${absPath}`;
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
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes);

      let updated: string;
      try {
        updated = replaceInContent(text, oldString, newString, replaceAll);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const sha = crypto.createHash('sha256').update(oldString, 'utf8').digest('hex');
        const hasLinePrefix = /^\s*\d+\|\s?/m.test(oldString) || /^\s*\d+\t/m.test(oldString);
        const hasFileTags = /<file>/i.test(oldString) || /<\/file>/i.test(oldString);
        const hints: string[] = [];
        if (hasLinePrefix) {
          hints.push('Hint: oldString appears to include line-number prefixes from Read output (e.g. "00001| "). Remove those prefixes.');
        }
        if (hasFileTags) {
          hints.push('Hint: oldString appears to include <file> tags. Remove the wrapper and provide only the raw file content.');
        }

        return {
          success: false,
          error: [message, ...hints].filter(Boolean).join('\n'),
          metadata: {
            errorType:
              message === 'oldString not found in content'
                ? 'edit_oldstring_not_found'
                : message.startsWith('oldString found multiple times')
                  ? 'edit_oldstring_multiple_matches'
                  : 'edit_failed',
            oldStringLength: oldString.length,
            oldStringSha256: sha,
            hasLinePrefix,
            hasFileTags,
          },
        };
      }

      await vscode.workspace.fs.writeFile(uri, Buffer.from(updated));
      recordFileRead(context.sessionId, absPath);

      let output = `Edited ${absPath}`;
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
