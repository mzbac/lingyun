import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

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
});
