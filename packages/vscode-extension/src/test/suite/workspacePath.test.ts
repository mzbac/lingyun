import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { resolveToolPath } from '../../tools/builtin/workspace';

function isSymlinkUnsupportedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS' || code === 'UNKNOWN';
}

suite('Workspace Path Guards', () => {
  test('resolveToolPath blocks symlink escapes when external paths are disabled', async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      assert.ok(true, 'no workspace root available for this test environment');
      return;
    }

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevAllow = cfg.get('security.allowExternalPaths');
    await cfg.update('security.allowExternalPaths', false, true);

    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-ext-outside-'));
    const linkPath = path.join(workspaceRoot, `.lingyun-linked-outside-${Date.now()}`);

    try {
      await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'secret');
      try {
        await fs.symlink(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (isSymlinkUnsupportedError(error)) {
          assert.ok(true, `symlink unsupported in this environment: ${String(error)}`);
          return;
        }
        throw error;
      }

      assert.throws(() => {
        resolveToolPath(path.join(linkPath, 'secret.txt'));
      }, /External paths are disabled/);

      assert.throws(() => {
        resolveToolPath(path.join(linkPath, 'new-file.txt'));
      }, /External paths are disabled/);
    } finally {
      await fs.rm(linkPath, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
      await cfg.update('security.allowExternalPaths', prevAllow as any, true);
    }
  });
});
