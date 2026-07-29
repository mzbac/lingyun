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

  test('resolves absolute paths against the deepest containing workspace root', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevAllow = cfg.get('security.allowExternalPaths');
    await cfg.update('security.allowExternalPaths', false, true);

    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingyun-filelinks-root-'));
    const nestedRoot = path.join(root, 'nested');
    const fileAbs = path.join(nestedRoot, 'target.md');

    try {
      await fs.promises.mkdir(nestedRoot, { recursive: true });
      await fs.promises.writeFile(fileAbs, '# nested', 'utf8');

      const attempt = await resolveExistingFilePath(fileAbs, [
        vscode.Uri.file(root),
        vscode.Uri.file(nestedRoot),
      ], false);

      assert.ok(attempt.resolved);
      assert.strictEqual(path.normalize(attempt.resolved!.absPath), path.normalize(fileAbs));
      assert.strictEqual(attempt.resolved!.relPath, 'target.md');
    } finally {
      await rmDir(root);
      await cfg.update('security.allowExternalPaths', prevAllow as any, true);
    }
  });

  test('workspace root selection avoids map filter sort chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/fileLinks.ts'), 'utf8');
    const section = (startPattern: string, endPattern: string) => {
      const start = source.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = source.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return source.slice(start, end);
    };

    const prioritySection = section('export function getWorkspaceFolderUrisByPriority', 'function findDeepestContainingWorkspaceFolder');
    const deepestRootSection = section('function findDeepestContainingWorkspaceFolder', 'export async function resolveExistingFilePath');
    const absolutePathSection = section('if (isAbs) {', 'if (workspaceFolderUris.length === 0)');

    assert.match(prioritySection, /for \(const folder of workspaceFolders\)/);
    assert.match(deepestRootSection, /for \(const workspaceFolder of workspaceFolderUris\)/);
    assert.match(absolutePathSection, /findDeepestContainingWorkspaceFolder\(absPath, workspaceFolderUris\)/);
    assert.doesNotMatch(prioritySection + deepestRootSection + absolutePathSection, /\.(?:map|filter|sort)\(/);
  });
});
