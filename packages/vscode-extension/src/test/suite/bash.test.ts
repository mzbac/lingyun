import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { killProcessTree } from '@kooka/core';
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
  test('blocks git push when configured', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get<unknown>('security.blockGitPush');
    await cfg.update('security.blockGitPush', true, true);

    try {
      const context = createToolContext();
      const res = await bashHandler({ command: 'git push origin main' }, context);
      assert.strictEqual(res.success, false);
      assert.strictEqual((res.metadata as any)?.errorType, 'bash_git_push_blocked');
    } finally {
      await cfg.update('security.blockGitPush', prev as any, true);
    }
  });

  test('does not treat "echo git push" as a push attempt', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get<unknown>('security.blockGitPush');
    await cfg.update('security.blockGitPush', true, true);

    try {
      const context = createToolContext();
      const res = await bashHandler({ command: 'echo git push' }, context);
      assert.strictEqual(res.success, true);
    } finally {
      await cfg.update('security.blockGitPush', prev as any, true);
    }
  });

  test('rejects likely long-running server commands without background or timeout', async () => {
    const context = createToolContext();
    const res = await bashHandler({ command: 'python -m http.server' }, context);
    assert.strictEqual(res.success, false);
    assert.strictEqual((res.metadata as any)?.errorType, 'bash_requires_background_or_timeout');
  });

  test('supports background mode without blocking', async () => {
    const context = createToolContext();
    const res = await bashHandler(
      { command: 'node -e "setInterval(() => {}, 1000)"', background: true, captureMs: 0, captureLines: 0 },
      context
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual((res.metadata as any)?.background, true);

    const pid = (res.metadata as any)?.pid;
    assert.strictEqual(typeof pid, 'number');

    killProcessTree(pid, 'SIGTERM');
  });

  test('deduplicates background commands by (workdir + command)', async () => {
    const context = createToolContext();
    const args = { command: 'node -e "setInterval(() => {}, 1001)"', background: true, ttlMs: 60000, captureMs: 0, captureLines: 0 };

    const res1 = await bashHandler(args, context);
    assert.strictEqual(res1.success, true);
    const pid1 = (res1.metadata as any)?.pid;
    assert.strictEqual(typeof pid1, 'number');

    const res2 = await bashHandler(args, context);
    assert.strictEqual(res2.success, true);
    assert.strictEqual((res2.metadata as any)?.reused, true);
    assert.strictEqual((res2.metadata as any)?.pid, pid1);

    killProcessTree(pid1, 'SIGTERM');
  });

  test('auto-stops background commands after ttlMs', async function () {
    this.timeout(10000);
    const context = createToolContext();
    const res = await bashHandler(
      { command: 'node -e "setInterval(() => {}, 1002)"', background: true, ttlMs: 200, captureMs: 0, captureLines: 0 },
      context
    );

    assert.strictEqual(res.success, true);
    const pid = (res.metadata as any)?.pid;
    assert.strictEqual(typeof pid, 'number');

    await new Promise((r) => setTimeout(r, 2500));

    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (err) {
      alive = (err as { code?: string })?.code === 'EPERM';
    }

    assert.strictEqual(alive, false);
  });
});
