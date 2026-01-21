import * as assert from 'assert';

import {
  LingyunSession,
  SqliteSessionStore,
  parseSessionSnapshot,
  restoreSession,
  serializeSessionSnapshot,
  snapshotSession,
  type LingyunSessionSnapshot,
  type SqliteDriver,
} from '@kooka/agent-sdk';

type StoredRow = { snapshotJson: string; updatedAt: string };

function createFakeSqliteDriver(): { driver: SqliteDriver; rows: Map<string, StoredRow>; calls: string[] } {
  const rows = new Map<string, StoredRow>();
  const calls: string[] = [];

  const driver: SqliteDriver = {
    execute: async (sql: string, params?: unknown[]) => {
      calls.push(sql);

      if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) return;

      if (sql.startsWith('INSERT INTO')) {
        const [sessionId, snapshotJson, updatedAt] = (params ?? []) as [string, string, string];
        rows.set(String(sessionId), { snapshotJson: String(snapshotJson), updatedAt: String(updatedAt) });
        return;
      }

      if (sql.startsWith('DELETE FROM')) {
        const [sessionId] = (params ?? []) as [string];
        rows.delete(String(sessionId));
        return;
      }

      throw new Error(`unexpected execute sql: ${sql}`);
    },
    queryOne: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      calls.push(sql);

      if (sql.startsWith('SELECT snapshotJson FROM')) {
        const [sessionId] = (params ?? []) as [string];
        const row = rows.get(String(sessionId));
        return row ? ({ snapshotJson: row.snapshotJson } as unknown as T) : undefined;
      }

      throw new Error(`unexpected queryOne sql: ${sql}`);
    },
    queryAll: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      calls.push(sql);

      if (sql.startsWith('SELECT sessionId, updatedAt FROM')) {
        const [limitRaw, offsetRaw] = (params ?? []) as [number, number];
        const limit = Number(limitRaw);
        const offset = Number(offsetRaw);
        const list = [...rows.entries()]
          .map(([sessionId, row]) => ({ sessionId, updatedAt: row.updatedAt }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

        return list.slice(offset, offset + limit) as unknown as T[];
      }

      throw new Error(`unexpected queryAll sql: ${sql}`);
    },
  };

  return { driver, rows, calls };
}

suite('persistence', () => {
  test('snapshotSession + restoreSession roundtrip', () => {
    const session = new LingyunSession({
      sessionId: 's1',
      parentSessionId: 'parent-1',
      subagentType: 'explore',
      modelId: 'mock-model',
      pendingPlan: 'do the thing',
      history: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as any,
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] } as any,
      ],
      fileHandles: { nextId: 2, byId: { F1: 'src/index.ts' } },
    });

    const snapshot = snapshotSession(session, { savedAt: new Date('2020-01-01T00:00:00.000Z') });
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.sessionId, 's1');
    assert.equal(snapshot.parentSessionId, 'parent-1');
    assert.equal(snapshot.subagentType, 'explore');
    assert.equal(snapshot.modelId, 'mock-model');
    assert.equal(snapshot.pendingPlan, 'do the thing');
    assert.equal(snapshot.savedAt, '2020-01-01T00:00:00.000Z');
    assert.deepEqual(snapshot.fileHandles, { nextId: 2, byId: { F1: 'src/index.ts' } });
    assert.equal(snapshot.history.length, 2);

    const restored = restoreSession(snapshot);
    assert.equal(restored.sessionId, 's1');
    assert.equal(restored.parentSessionId, 'parent-1');
    assert.equal(restored.subagentType, 'explore');
    assert.equal(restored.modelId, 'mock-model');
    assert.equal(restored.pendingPlan, 'do the thing');
    assert.deepEqual(restored.fileHandles, { nextId: 2, byId: { F1: 'src/index.ts' } });
    assert.equal(restored.getHistory().length, 2);
  });

  test('snapshotSession can omit fileHandles', () => {
    const session = new LingyunSession({
      sessionId: 's1',
      history: [],
      fileHandles: { nextId: 2, byId: { F1: 'src/index.ts' } },
    });

    const snapshot = snapshotSession(session, { includeFileHandles: false });
    assert.equal(snapshot.sessionId, 's1');
    assert.equal(snapshot.fileHandles, undefined);
  });

  test('serializeSessionSnapshot + parseSessionSnapshot roundtrip', () => {
    const snapshot: LingyunSessionSnapshot = {
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      sessionId: 's1',
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }] as any,
    };

    const text = serializeSessionSnapshot(snapshot);
    const parsed = parseSessionSnapshot(text);

    assert.equal(parsed.version, 1);
    assert.equal(parsed.savedAt, '2020-01-01T00:00:00.000Z');
    assert.equal(parsed.sessionId, 's1');
    assert.equal(parsed.history.length, 1);
  });

  test('SqliteSessionStore stores snapshots via driver', async () => {
    const { driver, rows } = createFakeSqliteDriver();
    const store = new SqliteSessionStore(driver);

    const snapshot: LingyunSessionSnapshot = {
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      sessionId: 's1',
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }] as any,
    };

    await store.save('s1', snapshot);
    assert.equal(rows.has('s1'), true);

    const loaded = await store.load('s1');
    assert.equal(loaded?.sessionId, 's1');
    assert.equal(loaded?.savedAt, '2020-01-01T00:00:00.000Z');

    const list = await store.list({ limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.sessionId, 's1');

    await store.delete('s1');
    assert.equal(rows.has('s1'), false);
  });
});
