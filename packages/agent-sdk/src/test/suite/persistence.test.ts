import * as assert from 'assert';

import {
  LingyunSession,
  SqliteSessionStore,
  parseSessionSnapshot,
  restoreSession,
  serializeSessionSnapshot,
  snapshotSession,
  tryParseSessionSnapshot,
  type LingyunSessionSnapshot,
  type SqliteDriver,
} from '../../index.js';

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
      compactionSyntheticContexts: [
        {
          transientContext: 'memoryRecall',
          text: '<memory_recall_context>\nRemember this\n</memory_recall_context>',
        },
      ],
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
    assert.deepEqual(snapshot.compactionSyntheticContexts, [
      {
        transientContext: 'memoryRecall',
        text: '<memory_recall_context>\nRemember this\n</memory_recall_context>',
      },
    ]);
    assert.deepEqual(snapshot.fileHandles, { nextId: 2, byId: { F1: 'src/index.ts' } });
    assert.equal(snapshot.history.length, 2);

    const restored = restoreSession(snapshot);
    assert.equal(restored.sessionId, 's1');
    assert.equal(restored.parentSessionId, 'parent-1');
    assert.equal(restored.subagentType, 'explore');
    assert.equal(restored.modelId, 'mock-model');
    assert.equal(restored.pendingPlan, 'do the thing');
    assert.deepEqual(restored.compactionSyntheticContexts, [
      {
        transientContext: 'memoryRecall',
        text: '<memory_recall_context>\nRemember this\n</memory_recall_context>',
      },
    ]);
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

  test('tryParseSessionSnapshot tolerates partially malformed optional fields', () => {
    const parsed = tryParseSessionSnapshot({
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      sessionId: 'child-1',
      parentSessionId: 'parent-1',
      subagentType: 'general',
      modelId: 'mock-model',
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      mentionedSkills: ['skill-1', 42, '', '  skill-2  ', 'skill-1', '   ', null],
      compactionSyntheticContexts: [
        { transientContext: 'memoryRecall', text: 'remember me' },
        { transientContext: 'invalid', text: 'drop me' },
      ],
      fileHandles: {
        nextId: 2.9,
        byId: {
          F1: ' src/index.ts ',
          bad: 'drop-me.ts',
          F2: '   ',
        },
      },
      semanticHandles: {
        nextMatchId: 2.9,
        nextSymbolId: 3,
        nextLocId: 0,
        matches: {
          M1: {
            fileId: ' F1 ',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 2.8, character: 4.2 },
            },
            preview: 'match preview',
          },
          bad: {
            fileId: 'F2',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 2 },
            },
            preview: 'drop me',
          },
        },
        symbols: {
          S1: {
            name: '  Symbol Name  ',
            kind: 'function',
            fileId: 'F1',
            range: {
              start: { line: 5, character: 0 },
              end: { line: 6, character: 3.6 },
            },
            containerName: '  Parent  ',
          },
          S2: {
            name: '   ',
            kind: 'function',
            fileId: 'F1',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 2 },
            },
          },
        },
        locations: {
          L1: {
            fileId: 'F1',
            range: {
              start: { line: 8, character: 0 },
              end: { line: 8, character: 0 },
            },
            label: '  Location label  ',
          },
          bad: {
            fileId: 'F1',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 2 },
            },
          },
        },
      },
    });

    assert.ok(parsed);
    assert.equal(parsed?.sessionId, 'child-1');
    assert.deepEqual(parsed?.mentionedSkills, ['skill-1', 'skill-2']);
    assert.deepEqual(parsed?.compactionSyntheticContexts, [
      { transientContext: 'memoryRecall', text: 'remember me' },
    ]);
    assert.deepEqual(parsed?.fileHandles, {
      nextId: 2,
      byId: { F1: 'src/index.ts' },
    });
    assert.deepEqual(parsed?.semanticHandles, {
      nextMatchId: 2,
      nextSymbolId: 3,
      nextLocId: 1,
      matches: {
        M1: {
          fileId: 'F1',
          range: {
            start: { line: 1, character: 1 },
            end: { line: 2, character: 4 },
          },
          preview: 'match preview',
        },
      },
      symbols: {
        S1: {
          name: '  Symbol Name  ',
          kind: 'function',
          fileId: 'F1',
          range: {
            start: { line: 5, character: 1 },
            end: { line: 6, character: 3 },
          },
          containerName: 'Parent',
        },
      },
      locations: {
        L1: {
          fileId: 'F1',
          range: {
            start: { line: 8, character: 1 },
            end: { line: 8, character: 1 },
          },
          label: 'Location label',
        },
      },
    });
  });

  test('tryParseSessionSnapshot rejects snapshots without required identity fields', () => {
    assert.equal(
      tryParseSessionSnapshot({
        version: 1,
        savedAt: '2020-01-01T00:00:00.000Z',
        history: [],
      }),
      undefined,
    );
  });

  test('SqliteSessionStore stores canonical snapshots via driver', async () => {
    const { driver, rows } = createFakeSqliteDriver();
    const store = new SqliteSessionStore(driver);

    const snapshot: LingyunSessionSnapshot = {
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      sessionId: ' s1 ',
      parentSessionId: '   ',
      mentionedSkills: [' skill-1 ', '', '   ', 'skill-2', 'skill-1'],
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }] as any,
    };

    await store.save(snapshot);
    assert.equal(rows.has('s1'), true);

    const storedJson = rows.get('s1')?.snapshotJson;
    assert.ok(storedJson, 'expected canonical snapshot json to be stored');
    assert.deepEqual(JSON.parse(storedJson!), {
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      sessionId: 's1',
      mentionedSkills: ['skill-1', 'skill-2'],
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    });

    const loaded = await store.load('s1');
    assert.equal(loaded?.sessionId, 's1');
    assert.equal(loaded?.parentSessionId, undefined);
    assert.deepEqual(loaded?.mentionedSkills, ['skill-1', 'skill-2']);
    assert.equal(loaded?.savedAt, '2020-01-01T00:00:00.000Z');

    const list = await store.list({ limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.sessionId, 's1');

    await store.delete('s1');
    assert.equal(rows.has('s1'), false);
  });

  test('SqliteSessionStore rejects invalid snapshots before persisting', async () => {
    const { driver, rows } = createFakeSqliteDriver();
    const store = new SqliteSessionStore(driver);

    await assert.rejects(
      () =>
        store.save({
          version: 1,
          savedAt: '2020-01-01T00:00:00.000Z',
          sessionId: 's1',
          history: [],
          mentionedSkills: ['skill-1', 42] as any,
        } as LingyunSessionSnapshot),
      /SqliteSessionStore\.save: invalid snapshot:/
    );

    assert.equal(rows.has('s1'), false);
  });

  test('SqliteSessionStore requires snapshot session identity when saving', async () => {
    const { driver } = createFakeSqliteDriver();
    const store = new SqliteSessionStore(driver);

    await assert.rejects(
      () =>
        store.save({
          version: 1,
          savedAt: '2020-01-01T00:00:00.000Z',
          sessionId: '   ',
          history: [],
        } as LingyunSessionSnapshot),
      /SqliteSessionStore\.save: sessionId is required/
    );
  });
});
