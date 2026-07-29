import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
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
  test('list ignores default and extra directories through shared file tree policy', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for privacy tests');

    const dirRel = '.lingyun-test/list-ignore';
    const dirUri = vscode.Uri.joinPath(root, dirRel);
    const keepUri = vscode.Uri.joinPath(root, dirRel, 'keep.txt');
    const nodeModulesDir = vscode.Uri.joinPath(root, dirRel, 'node_modules');
    const nodeModulesFile = vscode.Uri.joinPath(root, dirRel, 'node_modules', 'hidden.js');
    const customDir = vscode.Uri.joinPath(root, dirRel, 'custom');
    const customFile = vscode.Uri.joinPath(root, dirRel, 'custom', 'hidden.txt');

    await vscode.workspace.fs.createDirectory(nodeModulesDir);
    await vscode.workspace.fs.createDirectory(customDir);

    try {
      await vscode.workspace.fs.writeFile(keepUri, Buffer.from('keep', 'utf8'));
      await vscode.workspace.fs.writeFile(nodeModulesFile, Buffer.from('hidden', 'utf8'));
      await vscode.workspace.fs.writeFile(customFile, Buffer.from('hidden', 'utf8'));

      const listResult = await listHandler({ path: dirRel, ignore: ['custom', ''] }, createToolContext());
      assert.strictEqual(listResult.success, true);
      assert.strictEqual(listResult.data as string, [dirRel + '/', '  keep.txt'].join('\n'));
    } finally {
      try {
        await vscode.workspace.fs.delete(dirUri, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('list and glob keep workspace paths relative', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for privacy tests');

    const dirRel = '.lingyun-test/privacy-tools';
    const dirUri = vscode.Uri.joinPath(root, dirRel);
    const fileRel = `${dirRel}/sample.txt`;
    const fileUri = vscode.Uri.joinPath(root, fileRel);
    const nestedRel = `${dirRel}/nested/deep.md`;
    const nestedUri = vscode.Uri.joinPath(root, nestedRel);

    await vscode.workspace.fs.createDirectory(dirUri);

    try {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from('privacy', 'utf8'));
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, dirRel, 'nested'));
      await vscode.workspace.fs.writeFile(nestedUri, Buffer.from('nested', 'utf8'));

      const listResult = await listHandler({ path: dirRel }, createToolContext());
      assert.strictEqual(listResult.success, true);
      assert.strictEqual(typeof listResult.data, 'string');
      assert.strictEqual(
        listResult.data as string,
        [dirRel + '/', '  nested/', '    deep.md', '  sample.txt'].join('\n')
      );
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
        await vscode.workspace.fs.delete(nestedUri, { recursive: false, useTrash: false });
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

  test('glob handler assembles result arrays without map chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/glob.ts'), 'utf8');
    const start = source.indexOf('export const globHandler');
    assert.ok(start >= 0, 'expected glob handler');
    const end = source.indexOf('\nasync function statGlobUri', start);
    assert.ok(end > start, 'expected stat helper after glob handler');
    const section = source.slice(start, end);

    assert.match(section, /const statTasks: Array<Promise<\{ uri: vscode\.Uri; mtime: number \}>> = \[\];/);
    assert.match(section, /for \(const uri of uris\)/);
    assert.match(section, /statTasks\.push\(statGlobUri\(uri\)\);/);
    assert.match(section, /const files: string\[\] = \[\];/);
    assert.match(section, /for \(const entry of entries\)/);
    assert.match(section, /files\.push\(formatToolPathForOutput\(entry\.uri\.fsPath, context\)\);/);
    assert.doesNotMatch(section, /uris\.map/);
    assert.doesNotMatch(section, /entries\.map/);
  });
});
