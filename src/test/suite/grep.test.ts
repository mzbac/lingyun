import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { grepHandler } from '../../tools/builtin/grep';

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

suite('Grep Tool', () => {
  test('returns structured matches with file/line/column', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for grep tests');

    const dir = vscode.Uri.joinPath(root, '.lingyun-test');
    const fileRel = '.lingyun-test/grepSample.ts';
    const fileUri = vscode.Uri.joinPath(root, fileRel);

    await vscode.workspace.fs.createDirectory(dir);

    try {
      const content = ['const a = 1;', 'function helloGrep() {', '  return a;', '}'].join('\n');
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

      const result = await grepHandler({ pattern: 'helloGrep', path: fileRel }, createToolContext());
      assert.strictEqual(result.success, true);

      const data = result.data as any;
      assert.ok(data && typeof data === 'object');
      assert.ok(Array.isArray(data.matches));
      assert.ok(data.matches.length >= 1);

      const first = data.matches[0];
      assert.strictEqual(first.filePath, fileUri.fsPath);
      assert.strictEqual(first.line, 2);
      assert.strictEqual(typeof first.column, 'number');
      assert.ok(first.column >= 1);
      assert.ok(typeof first.text === 'string');
      assert.ok(first.text.includes('helloGrep'));
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

