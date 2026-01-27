import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { memorySearchHandler } from '../../tools/builtin/memorySearch';
import { memoryGetHandler } from '../../tools/builtin/memoryGet';

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

suite('Memory Tools', () => {
  test('memory_search finds hits and memory_get enforces max lines', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for Memory tool tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevMaxLines = cfg.get('memory.get.maxLines');

    const memoryDir = vscode.Uri.joinPath(root, 'memory');
    const memoryRel = 'memory/test.md';
    const memoryUri = vscode.Uri.joinPath(root, memoryRel);

    await vscode.workspace.fs.createDirectory(memoryDir);

    try {
      await cfg.update('memory.get.maxLines', 2, true);

      const content = ['alpha note', 'beta note', 'gamma alpha'].join('\n');
      await vscode.workspace.fs.writeFile(memoryUri, Buffer.from(content, 'utf8'));

      const context = createToolContext();

      const searchResult = await memorySearchHandler({ query: 'alpha' }, context);
      assert.strictEqual(searchResult.success, true);
      assert.ok(Array.isArray(searchResult.data));
      assert.ok((searchResult.data as any[]).length >= 1);

      const tooLarge = await memoryGetHandler(
        { filePath: memoryRel, startLine: 1, endLine: 3 },
        context,
      );
      assert.strictEqual(tooLarge.success, false);
      assert.strictEqual((tooLarge.metadata as any)?.errorType, 'memory_get_limit_exceeded');

      const ok = await memoryGetHandler({ filePath: memoryRel, startLine: 1, endLine: 2 }, context);
      assert.strictEqual(ok.success, true);
      assert.strictEqual(typeof ok.data, 'string');
      assert.ok((ok.data as string).includes('00001| alpha note'));
    } finally {
      try {
        await cfg.update('memory.get.maxLines', prevMaxLines, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(memoryUri, { recursive: false, useTrash: false });
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(memoryDir, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });
});
