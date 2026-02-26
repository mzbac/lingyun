import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { getMemoryHandler } from '../../tools/builtin/getMemory';

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

suite('Memory Tool', () => {
  test('get_memory lists and reads generated memory artifacts', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');

    const memoryDir = vscode.Uri.joinPath(root, 'memory');
    const rolloutDir = vscode.Uri.joinPath(memoryDir, 'rollout_summaries');
    const summaryFile = vscode.Uri.joinPath(memoryDir, 'memory_summary.md');
    const rawFile = vscode.Uri.joinPath(memoryDir, 'raw_memories.md');
    const memoryFile = vscode.Uri.joinPath(root, 'MEMORY.md');
    const rolloutFileName = '2026-01-01T10-00-00-000Z-ab12-session.md';
    const rolloutFile = vscode.Uri.joinPath(rolloutDir, rolloutFileName);

    await vscode.workspace.fs.createDirectory(rolloutDir);

    try {
      await cfg.update('features.memories', true, true);

      await vscode.workspace.fs.writeFile(summaryFile, Buffer.from('# Memory Summary\n\n- Focus item\n', 'utf8'));
      await vscode.workspace.fs.writeFile(memoryFile, Buffer.from('# MEMORY\n\n- Durable context\n', 'utf8'));
      await vscode.workspace.fs.writeFile(rawFile, Buffer.from('# Raw Memories\n\n- Raw item\n', 'utf8'));
      await vscode.workspace.fs.writeFile(
        rolloutFile,
        Buffer.from('# Session Memory\n\n- rollout detail\n', 'utf8'),
      );

      const context = createToolContext();

      const listResult = await getMemoryHandler({ view: 'list' }, context);
      assert.strictEqual(listResult.success, true);
      assert.ok(Array.isArray((listResult.data as any)?.rolloutSummaries));
      assert.ok(((listResult.data as any)?.rolloutSummaries as string[]).includes(rolloutFileName));

      const summaryResult = await getMemoryHandler({}, context);
      assert.strictEqual(summaryResult.success, true);
      assert.strictEqual(typeof summaryResult.data, 'string');
      assert.ok((summaryResult.data as string).includes('Focus item'));

      const rolloutResult = await getMemoryHandler(
        { view: 'rollout', rolloutFile: rolloutFileName },
        context,
      );
      assert.strictEqual(rolloutResult.success, true);
      assert.strictEqual(typeof rolloutResult.data, 'string');
      assert.ok((rolloutResult.data as string).includes('rollout detail'));

      const missingRollout = await getMemoryHandler(
        { view: 'rollout', rolloutFile: 'missing.md' },
        context,
      );
      assert.strictEqual(missingRollout.success, false);
      assert.strictEqual((missingRollout.metadata as any)?.errorType, 'memory_rollout_missing');
    } finally {
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(memoryFile, { recursive: false, useTrash: false });
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(memoryDir, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });
});
