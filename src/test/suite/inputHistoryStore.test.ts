import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  InputHistoryStore,
  addInputHistoryEntry,
  DEFAULT_INPUT_HISTORY_MAX_ENTRIES,
} from '../../core/inputHistoryStore';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lingyun-inputhistory-'));
}

suite('InputHistoryStore', () => {
  test('save/load roundtrip', async () => {
    const dir = makeTempDir();
    try {
      const store = new InputHistoryStore(vscode.Uri.file(dir), { maxEntries: 10 });
      await store.save(['one', 'two']);

      const loaded = await store.load();
      assert.ok(loaded);
      assert.strictEqual(loaded?.version, 1);
      assert.deepStrictEqual(loaded?.entries, ['one', 'two']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('handles corrupted json gracefully', async () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = path.join(dir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'input-history.json'), '{ not json');

      const store = new InputHistoryStore(vscode.Uri.file(dir), { maxEntries: 10 });
      const loaded = await store.load();
      assert.strictEqual(loaded, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('addInputHistoryEntry de-dupes adjacent + caps entries', () => {
    const maxEntries = Math.min(5, DEFAULT_INPUT_HISTORY_MAX_ENTRIES);
    const options = { maxEntries };

    let entries: string[] = [];
    entries = addInputHistoryEntry(entries, 'hello', options);
    entries = addInputHistoryEntry(entries, 'hello', options);
    assert.deepStrictEqual(entries, ['hello']);

    for (let i = 0; i < maxEntries + 2; i++) {
      entries = addInputHistoryEntry(entries, `m${i}`, options);
    }
    assert.strictEqual(entries.length, maxEntries);
    assert.strictEqual(entries[0], `m${maxEntries + 1}`);
  });
});

