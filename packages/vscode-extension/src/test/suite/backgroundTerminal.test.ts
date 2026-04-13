import * as assert from 'assert';
import * as vscode from 'vscode';

import { TOOL_ERROR_CODES, getBackgroundJob, registerBackgroundJob } from '@kooka/core';
import { backgroundTerminalManager } from '../../core/terminal/backgroundTerminal';
import type { ToolContext } from '../../core/types';

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

suite('Background Terminal', () => {
  test('sweep disposes dead tracked terminals and removes their background jobs', () => {
    const scope = `test-scope-${Date.now()}`;
    const key = `test-key-${Date.now()}`;
    const recordId = `${scope}\n${key}`;

    let disposed = false;
    let logEnded = false;
    const fakeTerminal: any = {
      exitStatus: undefined as vscode.TerminalExitStatus | undefined,
      dispose: () => {
        disposed = true;
        fakeTerminal.exitStatus = { code: 0 } as vscode.TerminalExitStatus;
      },
    };

    registerBackgroundJob({
      scope,
      key,
      command: 'echo hi',
      cwd: process.cwd(),
      pid: 999_999_999,
      ttlMs: 60_000,
    });

    (backgroundTerminalManager as any).records.set(recordId, {
      scope,
      key,
      command: 'echo hi',
      cwd: process.cwd(),
      terminal: fakeTerminal as vscode.Terminal,
      terminalName: 'LingYun: bg test deadbeef',
      pid: 999_999_999,
      pidFilePath: '/tmp/fake.pid',
      logFilePath: '/tmp/fake.log',
      logStream: { end: () => { logEnded = true; } },
      ttlMs: 60_000,
    });

    backgroundTerminalManager.sweep(scope);

    assert.strictEqual(disposed, true);
    assert.strictEqual(logEnded, true);
    assert.strictEqual((backgroundTerminalManager as any).records.has(recordId), false);
    assert.strictEqual(getBackgroundJob(scope, key), undefined);
  });

  test('fails when the integrated terminal command never yields a PID', async () => {
    const fakeTerminal: any = {
      shellIntegration: undefined,
      exitStatus: undefined as vscode.TerminalExitStatus | undefined,
      processId: Promise.resolve(undefined),
      show: () => {},
      sendText: () => {},
      dispose: () => {
        fakeTerminal.exitStatus = { code: 0 } as vscode.TerminalExitStatus;
      },
    };

    const windowPatched = vscode.window as unknown as {
      createTerminal: typeof vscode.window.createTerminal;
    };
    const originalCreateTerminal = windowPatched.createTerminal;
    windowPatched.createTerminal = () => fakeTerminal as vscode.Terminal;

    try {
      const res = await backgroundTerminalManager.start({
        command: 'echo hi',
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        ttlMs: 60_000,
        captureMs: 0,
        captureLines: 0,
        shellIntegrationTimeoutMs: 0,
        pidTimeoutMs: 1,
        context: createToolContext(),
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual((res.metadata as any)?.errorCode, TOOL_ERROR_CODES.bash_background_pid_unavailable);
      assert.match(String(res.error || ''), /Failed to confirm background command started/);
      assert.ok(fakeTerminal.exitStatus, 'failed starts should dispose the transient terminal');
    } finally {
      windowPatched.createTerminal = originalCreateTerminal;
    }
  });
});
