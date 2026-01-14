import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { resolveExistingFilePath } from '../../ui/chat/fileLinks';

async function rmDir(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

suite('Chat File Links', () => {
  test('resolves relative paths across multi-root workspaces', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevAllow = cfg.get('security.allowExternalPaths');
    await cfg.update('security.allowExternalPaths', false, true);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(workspaceRoot);

    const root2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingyun-filelinks-root2-'));
    const fileRelPosix = 'docs/DISTRIBUTED_SERVER_DIAGRAM.md';
    const fileAbs = path.join(root2, ...fileRelPosix.split('/'));

    try {
      await fs.promises.mkdir(path.dirname(fileAbs), { recursive: true });
      await fs.promises.writeFile(fileAbs, '# test', 'utf8');

      const roots = [workspaceRoot!, vscode.Uri.file(root2)];
      const attempt = await resolveExistingFilePath(fileRelPosix, roots, false);
      assert.ok(attempt.resolved);
      assert.strictEqual(path.normalize(attempt.resolved!.absPath), path.normalize(fileAbs));
    } finally {
      await rmDir(root2);
      await cfg.update('security.allowExternalPaths', prevAllow as any, true);
    }
  });
});
