import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { evaluateShellPathAccess, redactFsPathForPrompt } from '@kooka/core';
import type { ToolContext } from '../../index.js';
import { globHandler } from '../../tools/builtin/glob.js';
import { listHandler } from '../../tools/builtin/list.js';
import { readHandler } from '../../tools/builtin/read.js';

function createToolContext(workspaceRoot: string): ToolContext {
  return {
    workspaceRoot,
    allowExternalPaths: true,
    signal: new AbortController().signal,
    log: () => {},
  };
}

suite('SDK Tool Privacy', () => {
  test('redacts external absolute paths to bounded tail segments', () => {
    assert.strictEqual(
      redactFsPathForPrompt('/var/lib/lingyun/cache/skill/SKILL.md', {
        workspaceRoot: '/workspace/project',
        homeDir: '/home/user',
        tailSegments: 3,
      }),
      '.../cache/skill/SKILL.md'
    );
    assert.strictEqual(
      redactFsPathForPrompt('/var/log', {
        workspaceRoot: '/workspace/project',
        homeDir: '/home/user',
        tailSegments: 3,
      }),
      '/var/log'
    );
  });

  test('shell path policy inspects option assignment path values', () => {
    const workspaceRoot = path.resolve(os.tmpdir(), 'lingyun-sdk-workspace');
    const externalPath = path.resolve(os.tmpdir(), 'lingyun-sdk-outside.txt');

    const blocked = evaluateShellPathAccess(`tool --output="${externalPath}"`, {
      cwd: workspaceRoot,
      workspaceRoot,
    });
    assert.deepStrictEqual(blocked.blockedPaths, [externalPath]);

    const allowed = evaluateShellPathAccess('tool --config=src/settings.json', {
      cwd: workspaceRoot,
      workspaceRoot,
    });
    assert.deepStrictEqual(allowed.blockedPaths, []);
  });

  test('list renders nested directories with stable ordering', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-list-tree-'));
    const files = [
      path.join(workspaceRoot, 'src', 'z.txt'),
      path.join(workspaceRoot, 'src', 'a.txt'),
      path.join(workspaceRoot, 'src', 'nested', 'b.md'),
      path.join(workspaceRoot, 'src', 'nested', 'deeper', 'c.md'),
    ];

    try {
      for (const file of files) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'tree', 'utf8');
      }

      const result = await listHandler({ path: 'src' }, createToolContext(workspaceRoot));
      assert.strictEqual(result.success, true);
      assert.strictEqual(
        result.data,
        ['src/', '  nested/', '    deeper/', '      c.md', '    b.md', '  a.txt', '  z.txt'].join('\n')
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('list ignores default and extra directories through shared file tree policy', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-list-ignore-'));

    try {
      await fs.mkdir(path.join(workspaceRoot, 'src', 'node_modules'), { recursive: true });
      await fs.mkdir(path.join(workspaceRoot, 'src', 'custom'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, 'src', 'keep.txt'), 'keep', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, 'src', 'node_modules', 'hidden.js'), 'hidden', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, 'src', 'custom', 'hidden.txt'), 'hidden', 'utf8');

      const result = await listHandler({ path: 'src', ignore: ['custom', ''] }, createToolContext(workspaceRoot));
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, ['src/', '  keep.txt'].join('\n'));
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('list, glob, and read errors avoid absolute workspace paths', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-tool-privacy-'));
    const dirPath = path.join(workspaceRoot, 'src');
    const filePath = path.join(dirPath, 'sample.txt');

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, 'privacy', 'utf8');

    try {
      const context = createToolContext(workspaceRoot);

      const listResult = await listHandler({ path: 'src' }, context);
      assert.strictEqual(listResult.success, true);
      assert.strictEqual(typeof listResult.data, 'string');
      assert.ok((listResult.data as string).includes('src/'));
      assert.ok(!(listResult.data as string).includes(workspaceRoot));

      const globResult = await globHandler({ pattern: '**/*.txt', path: 'src' }, context);
      assert.strictEqual(globResult.success, true);
      assert.deepStrictEqual((globResult.data as any).files, ['src/sample.txt']);
      assert.ok(!JSON.stringify(globResult.data).includes(workspaceRoot));

      const readResult = await readHandler({ filePath: 'src/missing.txt' }, context);
      assert.strictEqual(readResult.success, false);
      assert.ok(readResult.error?.includes('src/missing.txt'));
      assert.ok(!readResult.error?.includes(workspaceRoot));
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('glob caps formatted files and avoids slice-map arrays', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-glob-cap-'));
    const dirPath = path.join(workspaceRoot, 'src');

    try {
      await fs.mkdir(dirPath, { recursive: true });
      for (let i = 0; i < 120; i++) {
        await fs.writeFile(path.join(dirPath, `file-${String(i).padStart(3, '0')}.txt`), 'match', 'utf8');
      }

      const result = await globHandler({ pattern: '**/*.txt', path: 'src' }, createToolContext(workspaceRoot));

      assert.strictEqual(result.success, true);
      assert.strictEqual((result.data as any).files.length, 100);
      assert.strictEqual((result.data as any).truncated, true);
      assert.ok(!JSON.stringify(result.data).includes(workspaceRoot));

      const source = await fs.readFile(new URL('../../../src/tools/builtin/glob.ts', import.meta.url), 'utf8');
      const start = source.indexOf('export const globHandler');
      assert.ok(start >= 0, 'expected glob handler');
      const end = source.indexOf('\nasync function statGlobEntry', start);
      assert.ok(end > start, 'expected stat helper after glob handler');
      const section = source.slice(start, end);

      assert.match(section, /const statTasks: Array<Promise<\{ abs: string; mtime: number \}>> = \[\];/);
      assert.match(section, /const statLimit = Math\.min\(relMatches\.length, 200\);/);
      assert.match(section, /for \(let i = 0; i < statLimit; i\+\+\)/);
      assert.match(section, /statTasks\.push\(statGlobEntry\(path\.resolve\(base, rel\)\)\);/);
      assert.match(section, /const files: string\[\] = \[\];/);
      assert.match(section, /for \(const entry of entries\)/);
      assert.match(section, /if \(files\.length >= 100\) break;/);
      assert.doesNotMatch(section, /relMatches\.slice/);
      assert.doesNotMatch(section, /entries\.map/);
      assert.doesNotMatch(section, /\.slice\(0, 100\)/);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
