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
    const fileRel = 'src/sample.ts';
    const result = await grepHandler({ pattern: 'helloGrep', path: fileRel }, createToolContext());
    assert.strictEqual(result.success, true);

    const data = result.data as any;
    assert.ok(data && typeof data === 'object');
    assert.ok(Array.isArray(data.matches));
    assert.ok(data.matches.length >= 1);

    const first = data.matches[0];
    assert.strictEqual(first.filePath, fileRel);
    assert.strictEqual(first.line, 7);
    assert.strictEqual(typeof first.column, 'number');
    assert.ok(first.column >= 1);
    assert.ok(typeof first.text === 'string');
    assert.ok(first.text.includes('helloGrep'));
  });
});
