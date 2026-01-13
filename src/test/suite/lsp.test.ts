import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { formatDiagnosticsBlock } from '../../core/lsp/diagnostics';
import { lspHandler, lspTool } from '../../tools/builtin/lsp';

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

function collectSymbolNames(nodes: any[]): string[] {
  const out: string[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (typeof (node as any).name === 'string') out.push((node as any).name);
    const children = (node as any).children;
    if (Array.isArray(children)) stack.push(...children);
  }
  return out;
}

suite('LSP Tool', () => {
  test('lsp tool operations match expected contract', () => {
    const ops = (lspTool.parameters.properties.operation as any)?.enum as string[];
    assert.ok(Array.isArray(ops));

    assert.deepStrictEqual(ops, [
      'goToDefinition',
      'findReferences',
      'hover',
      'documentSymbol',
      'workspaceSymbol',
      'goToImplementation',
      'prepareCallHierarchy',
      'incomingCalls',
      'outgoingCalls',
    ]);
  });

  test('formatDiagnosticsBlock - prints counts + positions', () => {
    const d1 = new vscode.Diagnostic(
      new vscode.Range(new vscode.Position(0, 4), new vscode.Position(0, 10)),
      'Bad thing',
      vscode.DiagnosticSeverity.Error
    );
    d1.source = 'ts';

    const d2 = new vscode.Diagnostic(
      new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 1)),
      'Warning thing',
      vscode.DiagnosticSeverity.Warning
    );

    const text = formatDiagnosticsBlock([d1, d2], { maxItems: 10 });
    assert.ok(text);
    assert.ok(text.includes('errors: 1'));
    assert.ok(text.includes('warnings: 1'));
    assert.ok(text.includes('ERROR [1:5] Bad thing (ts)'));
    assert.ok(text.includes('WARN [3:1] Warning thing'));
  });

  test('lsp documentSymbol returns success for a workspace TS file', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for LSP tests');

    const dir = vscode.Uri.joinPath(root, '.lingyun-test');
    const fileRel = '.lingyun-test/lspSample.ts';
    const fileUri = vscode.Uri.joinPath(root, fileRel);

    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from('export function foo() { return 1 }\nexport class Bar { method() { return foo() } }\n')
    );

    try {
      const ctx = createToolContext();
      const result = await lspHandler(
        { operation: 'documentSymbol', filePath: fileRel, line: 1, character: 1 },
        ctx
      );

      assert.strictEqual(result.success, true);
      const data = result.data as any;
      assert.strictEqual(data.operation, 'documentSymbol');
      assert.ok(Array.isArray(data.results));

      const names = collectSymbolNames(data.results);
      if (names.length > 0) {
        assert.ok(names.includes('foo'));
      }
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
