import * as assert from 'assert';

import { evaluateShellCommand, TOOL_ERROR_CODES } from '@kooka/core';
import { getBuiltinTools, type ToolContext } from '@kooka/agent-sdk';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killBackgroundProcess(pid: number): void {
  if (process.platform === 'win32') {
    process.kill(pid, 'SIGTERM');
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
}

function createToolContext(): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    allowExternalPaths: true,
    signal: new AbortController().signal,
    log: () => {},
  };
}

suite('Bash Tool', () => {
  const bashHandler = getBuiltinTools().find((t) => t.tool.id === 'bash')!.handler;

  test('evaluateShellCommand ignores operators inside quotes', () => {
    assert.strictEqual(evaluateShellCommand('echo "a|b"').verdict, 'allow');
    assert.strictEqual(evaluateShellCommand("echo 'a;b'").verdict, 'allow');
  });

  test('evaluateShellCommand requires approval for redirection', () => {
    assert.strictEqual(evaluateShellCommand('echo hi > out.txt').verdict, 'needs_approval');
    assert.strictEqual(evaluateShellCommand('echo hi < in.txt').verdict, 'needs_approval');
  });

  test('evaluateShellCommand requires approval for background chaining and substitution', () => {
    assert.strictEqual(evaluateShellCommand('echo hi &').verdict, 'needs_approval');
    assert.strictEqual(evaluateShellCommand('echo "$(pwd)"').verdict, 'needs_approval');
  });

  test('evaluateShellCommand denies dangerous patterns', () => {
    assert.strictEqual(evaluateShellCommand('rm -rf /').verdict, 'deny');
  });

  test('evaluateShellCommand allows git pretty=format argument', () => {
    assert.strictEqual(
      evaluateShellCommand("git log -n 30 --date=short --pretty=format:'%h %ad %s'").verdict,
      'allow'
    );
    assert.strictEqual(
      evaluateShellCommand("FOO=1 git log -n 1 --pretty=format:'%h %s'").verdict,
      'allow'
    );
  });

  test('evaluateShellCommand still denies format executable', () => {
    assert.strictEqual(evaluateShellCommand('format C:').verdict, 'deny');
  });

  test('rejects likely long-running server commands without background or timeout', async () => {
    const context = createToolContext();
    const res = await bashHandler({ command: 'python -m http.server' }, context);
    assert.strictEqual(res.success, false);
    assert.strictEqual(
      (res.metadata as any)?.errorCode,
      TOOL_ERROR_CODES.bash_requires_background_or_timeout
    );
  });

  test('deduplicates background commands by (workdir + command)', async () => {
    const context = createToolContext();
    const args = { command: 'node -e "setInterval(() => {}, 1001)"', background: true, ttlMs: 60000 };

    const res1 = await bashHandler(args, context);
    assert.strictEqual(res1.success, true);
    const pid1 = (res1.metadata as any)?.pid;
    assert.strictEqual(typeof pid1, 'number');

    const res2 = await bashHandler(args, context);
    assert.strictEqual(res2.success, true);
    assert.strictEqual((res2.metadata as any)?.reused, true);
    assert.strictEqual((res2.metadata as any)?.pid, pid1);

    killBackgroundProcess(pid1);
  });

  test('auto-stops background commands after ttlMs', async function () {
    this.timeout(5000);
    const context = createToolContext();
    const res = await bashHandler({ command: 'node -e "setInterval(() => {}, 1002)"', background: true, ttlMs: 200 }, context);
    assert.strictEqual(res.success, true);

    const pid = (res.metadata as any)?.pid;
    assert.strictEqual(typeof pid, 'number');

    await new Promise((r) => setTimeout(r, 2500));
    assert.strictEqual(isPidAlive(pid), false);
  });
});
