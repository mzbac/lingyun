import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { suggestSiblingPaths } from '../../tools/builtin/pathSuggestions';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lingyun-pathsuggest-'));
}

suite('pathSuggestions', () => {
  test('suggests sibling file when whitespace differs', async () => {
    const dir = makeTempDir();
    try {
      const actual = path.join(dir, 'main.js');
      fs.writeFileSync(actual, 'console.log("hi")\n');

      const suggestions = await suggestSiblingPaths(path.join(dir, 'main. js'));
      assert.ok(suggestions.includes(actual));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

