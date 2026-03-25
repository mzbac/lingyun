import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { globHandler } from '../../tools/builtin/glob';
import { listHandler } from '../../tools/builtin/list';

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

suite('Tool Privacy', () => {
  test('list and glob keep workspace paths relative', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for privacy tests');

    const dirRel = '.lingyun-test/privacy-tools';
    const dirUri = vscode.Uri.joinPath(root, dirRel);
    const fileRel = `${dirRel}/sample.txt`;
    const fileUri = vscode.Uri.joinPath(root, fileRel);

    await vscode.workspace.fs.createDirectory(dirUri);

    try {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from('privacy', 'utf8'));

      const listResult = await listHandler({ path: dirRel }, createToolContext());
      assert.strictEqual(listResult.success, true);
      assert.strictEqual(typeof listResult.data, 'string');
      assert.ok((listResult.data as string).includes(`${dirRel}/`));
      assert.ok(!(listResult.data as string).includes(root.fsPath));

      const globResult = await globHandler({ pattern: '**/*.txt', path: dirRel }, createToolContext());
      assert.strictEqual(globResult.success, true);
      assert.deepStrictEqual((globResult.data as any).files, [fileRel]);
      assert.ok(!JSON.stringify(globResult.data).includes(root.fsPath));
    } finally {
      try {
        await vscode.workspace.fs.delete(fileUri, { recursive: false, useTrash: false });
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(dirUri, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });
});
