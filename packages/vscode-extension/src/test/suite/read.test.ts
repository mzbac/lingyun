import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { readHandler } from '../../tools/builtin/read';

function createToolContext(): ToolContext {
  return {
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
    activeEditor: vscode.window.activeTextEditor,
    extensionContext: {} as unknown as vscode.ExtensionContext,
    cancellationToken: new vscode.CancellationTokenSource().token,
    progress: { report: () => {} },
    log: () => {},
  };
}

suite('Read Tool', () => {
  test('rejects large files unless offset+limit are provided', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for Read tool tests');

    const dir = vscode.Uri.joinPath(root, '.lingyun-test');
    const fileRel = '.lingyun-test/readLarge.txt';
    const fileUri = vscode.Uri.joinPath(root, fileRel);

    await vscode.workspace.fs.createDirectory(dir);

    try {
      const content = Array.from({ length: 350 }, (_, idx) => `line ${idx + 1}`).join('\n');
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

      const context = createToolContext();

      const rejected = await readHandler({ filePath: fileRel }, context);
      assert.strictEqual(rejected.success, false);
      assert.ok(rejected.error?.includes('requires an explicit {offset, limit} range'));
      assert.strictEqual((rejected.metadata as any)?.errorType, 'read_requires_range');

      const ok = await readHandler({ filePath: fileRel, offset: 0, limit: 50 }, context);
      assert.strictEqual(ok.success, true);
      assert.strictEqual(typeof ok.data, 'string');
      assert.ok((ok.data as string).includes('00001| line 1'));
    } finally {
      try {
        await vscode.workspace.fs.delete(fileUri, { recursive: false, useTrash: false });
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('rejects limit values over the configured max', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for Read tool tests');

    const dir = vscode.Uri.joinPath(root, '.lingyun-test');
    const fileRel = '.lingyun-test/readLargeLimit.txt';
    const fileUri = vscode.Uri.joinPath(root, fileRel);

    await vscode.workspace.fs.createDirectory(dir);

    try {
      const content = Array.from({ length: 350 }, (_, idx) => `line ${idx + 1}`).join('\n');
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

      const context = createToolContext();

      const res = await readHandler({ filePath: fileRel, offset: 0, limit: 9999 }, context);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res.metadata as any)?.errorType, 'read_limit_exceeded');
    } finally {
      try {
        await vscode.workspace.fs.delete(fileUri, { recursive: false, useTrash: false });
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });
});

