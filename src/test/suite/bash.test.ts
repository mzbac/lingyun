import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { bashHandler } from '../../tools/builtin/bash';

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

suite('Bash Tool', () => {
  test('rejects likely long-running server commands without background or timeout', async () => {
    const context = createToolContext();
    const res = await bashHandler({ command: 'python -m http.server' }, context);
    assert.strictEqual(res.success, false);
    assert.strictEqual((res.metadata as any)?.errorType, 'bash_requires_background_or_timeout');
  });

  test('supports background mode without blocking', async () => {
    const context = createToolContext();
    const res = await bashHandler(
      { command: 'node -e "setInterval(() => {}, 1000)"', background: true },
      context
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual((res.metadata as any)?.background, true);

    const pid = (res.metadata as any)?.pid;
    assert.strictEqual(typeof pid, 'number');

    // Clean up the background process group.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // ignore
      }
    }
  });
});

