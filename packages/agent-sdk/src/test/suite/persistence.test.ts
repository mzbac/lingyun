import * as assert from 'assert';
import * as fs from 'fs/promises';

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
type FakeSqliteDriver = {
  driver: SqliteDriver;
  rows: Map<string, StoredRow>;
  calls: string[];
  rowWrites: { count: number };
};

function createFakeSqliteDriver(): FakeSqliteDriver {
  const rows = new Map<string, StoredRow>();
  const calls: string[] = [];
  const rowWrites = { count: 0 };

  const driver: SqliteDriver = {
    execute: async (sql: string, params?: unknown[]) => {
      calls.push(sql);

      if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) return;

      if (sql.startsWith('INSERT INTO')) {
        const [sessionId, snapshotJson, updatedAt] = (params ?? []) as [string, string, string];
        const id = String(sessionId);
        const nextRow = { snapshotJson: String(snapshotJson), updatedAt: String(updatedAt) };
        const existing = rows.get(id);
        if (
          sql.includes('WHERE') &&
          existing?.snapshotJson === nextRow.snapshotJson &&
          existing?.updatedAt === nextRow.updatedAt
        ) {
          return;
        }
        rows.set(id, nextRow);
        rowWrites.count++;
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

  return { driver, rows, calls, rowWrites };
}

suite('persistence', () => {
  test('snapshotSession + restoreSession roundtrip', () => {
    const session = new LingyunSession({
      sessionId: 's1',
      parentSessionId: 'parent-1',
      subagentType: 'explore',
      modelId: 'mock-model',
      systemPromptSnapshot: ['Base system prompt', 'Plugin context'],
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
      threadGoal: {
        id: 'goal-1',
        sessionId: 's1',
        objective: 'Finish the release',
        status: 'active',
        tokenBudget: 1000,
        tokensUsed: 250,
        timeUsedSeconds: 60,
        createdAt: 100,
        updatedAt: 200,
      },
      fileHandles: { nextId: 2, byId: { F1: 'src/index.ts' } },
    });

    const snapshot = snapshotSession(session, { savedAt: new Date('2020-01-01T00:00:00.000Z') });
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.sessionId, 's1');
    assert.equal(snapshot.parentSessionId, 'parent-1');
    assert.equal(snapshot.subagentType, 'explore');
    assert.equal(snapshot.modelId, 'mock-model');
    assert.deepEqual(snapshot.systemPromptSnapshot, ['Base system prompt', 'Plugin context']);
    assert.equal(snapshot.pendingPlan, 'do the thing');
    assert.equal(snapshot.savedAt, '2020-01-01T00:00:00.000Z');
    assert.deepEqual(snapshot.stats, {
      totalMessages: 2,
      userMessages: 1,
      assistantMessages: 1,
      systemMessages: 0,
      syntheticMessages: 0,
      toolCallCount: 0,
      completedToolCallCount: 0,
      failedToolCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
    });
    assert.deepEqual(snapshot.compactionSyntheticContexts, [
      {
        transientContext: 'memoryRecall',
        text: '<memory_recall_context>\nRemember this\n</memory_recall_context>',
      },
    ]);
    assert.deepEqual(snapshot.threadGoal, {
      id: 'goal-1',
      sessionId: 's1',
      objective: 'Finish the release',
      status: 'active',
      tokenBudget: 1000,
      tokensUsed: 250,
      timeUsedSeconds: 60,
      createdAt: 100,
      updatedAt: 200,
    });
    assert.deepEqual(snapshot.fileHandles, { nextId: 2, byId: { F1: 'src/index.ts' } });
    assert.equal(snapshot.history.length, 2);

    const restored = restoreSession(snapshot);
    assert.equal(restored.sessionId, 's1');
    assert.equal(restored.parentSessionId, 'parent-1');
    assert.equal(restored.subagentType, 'explore');
    assert.equal(restored.modelId, 'mock-model');
    assert.deepEqual(restored.getSystemPromptSnapshot(), ['Base system prompt', 'Plugin context']);
    assert.equal(restored.pendingPlan, 'do the thing');
    assert.deepEqual(restored.compactionSyntheticContexts, [
      {
        transientContext: 'memoryRecall',
        text: '<memory_recall_context>\nRemember this\n</memory_recall_context>',
      },
    ]);
    assert.deepEqual(restored.threadGoal, snapshot.threadGoal);
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

  test('restoreSession normalizes thread goal counters as integers only', () => {
    const restored = restoreSession({
      version: 1,
      sessionId: 's1',
      savedAt: '2020-01-01T00:00:00.000Z',
      history: [],
      stats: {
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
        systemMessages: 0,
        syntheticMessages: 0,
        toolCallCount: 0,
        completedToolCallCount: 0,
        failedToolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalTokens: 0,
      },
      threadGoal: {
        id: 'goal-1',
        sessionId: 's1',
        objective: 'Finish the release',
        status: 'active',
        tokenBudget: 100.5,
        tokensUsed: 9.5,
        timeUsedSeconds: 1.5,
        createdAt: 10.5,
        updatedAt: 20.5,
      } as any,
    });

    assert.equal(restored.threadGoal?.tokenBudget, undefined);
    assert.equal(restored.threadGoal?.tokensUsed, 0);
    assert.equal(restored.threadGoal?.timeUsedSeconds, 0);
    assert.ok(Number.isSafeInteger(restored.threadGoal?.createdAt));
    assert.equal(restored.threadGoal?.updatedAt, restored.threadGoal?.createdAt);
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

  test('serialized snapshots preserve exact OpenAI-compatible replay state', () => {
    const rawArguments = '{ "value" : 1.0, "text" : "\\u0061" }';
    const reasoning = 'native reasoning with trailing space ';
    const text = ' literal </think> and <think>source</think> stays visible\n';
    const session = new LingyunSession({
      sessionId: 'openai-compatible-replay',
      history: [
        {
          id: 'assistant-replay',
          role: 'assistant',
          metadata: {
            replay: { reasoning, text },
          },
          parts: [
            { type: 'reasoning', text: reasoning, state: 'done' },
            { type: 'text', text, state: 'done' },
            {
              type: 'dynamic-tool',
              toolCallId: 'call-probe-1',
              toolName: 'probe',
              input: { value: 1, text: 'a' },
              state: 'output-available',
              output: { success: true, data: 'ok' },
              callProviderMetadata: {
                openaiCompatible: {
                  opaqueProviderField: 'keep-me',
                  kookaReplay: {
                    version: 1,
                    toolCallId: 'call-probe-1',
                    toolName: 'probe',
                    rawArguments,
                  },
                },
              },
            },
          ],
        },
      ] as any,
    });

    const parsed = parseSessionSnapshot(serializeSessionSnapshot(snapshotSession(session)));
    const restored = restoreSession(parsed);
    const assistant = restored.getHistory()[0] as any;
    const toolPart = assistant.parts.find((part: any) => part?.type === 'dynamic-tool');

    assert.strictEqual(assistant.metadata?.replay?.reasoning, reasoning);
    assert.strictEqual(assistant.metadata?.replay?.text, text);
    assert.strictEqual(
      toolPart?.callProviderMetadata?.openaiCompatible?.kookaReplay?.rawArguments,
      rawArguments,
    );
    assert.strictEqual(
      toolPart?.callProviderMetadata?.openaiCompatible?.opaqueProviderField,
      'keep-me',
    );
  });

  test('tryParseSessionSnapshot tolerates partially malformed optional fields', () => {
    const parsed = tryParseSessionSnapshot({
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      sessionId: 'child-1',
      parentSessionId: 'parent-1',
      subagentType: 'general',
      modelId: 'mock-model',
      systemPromptSnapshot: ['  Base system prompt  ', '', 42],
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      stats: { stale: true },
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
    assert.deepEqual(parsed?.systemPromptSnapshot, ['  Base system prompt  ']);
    assert.deepEqual(parsed?.stats, {
      totalMessages: 1,
      userMessages: 1,
      assistantMessages: 0,
      systemMessages: 0,
      syntheticMessages: 0,
      toolCallCount: 0,
      completedToolCallCount: 0,
      failedToolCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
    });
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
      stats: {
        totalMessages: 1,
        userMessages: 1,
        assistantMessages: 0,
        systemMessages: 0,
        syntheticMessages: 0,
        toolCallCount: 0,
        completedToolCallCount: 0,
        failedToolCallCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalTokens: 0,
      },
    });

    const loaded = await store.load('s1');
    assert.equal(loaded?.sessionId, 's1');
    assert.equal(loaded?.parentSessionId, undefined);
    assert.deepEqual(loaded?.mentionedSkills, ['skill-1', 'skill-2']);
    assert.equal(loaded?.stats?.totalMessages, 1);
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

  test('SqliteSessionStore save skips identical row updates at the database layer', async () => {
    const { driver, rows, calls, rowWrites } = createFakeSqliteDriver();
    const store = new SqliteSessionStore(driver);

    const snapshot: LingyunSessionSnapshot = {
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      sessionId: ' s1 ',
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }] as any,
    };

    await store.save(snapshot);
    const firstRow = rows.get('s1');
    assert.ok(firstRow, 'expected first save to persist a row');
    assert.equal(rowWrites.count, 1);

    await store.save(snapshot);
    assert.strictEqual(rows.get('s1'), firstRow);
    assert.equal(rowWrites.count, 1);

    await store.save({ ...snapshot, savedAt: '2020-01-02T00:00:00.000Z' });
    assert.notStrictEqual(rows.get('s1'), firstRow);
    assert.equal(rowWrites.count, 2);

    const insertSql = calls.find(sql => sql.startsWith('INSERT INTO'));
    assert.match(
      insertSql ?? '',
      /WHERE lingyun_sessions\.snapshotJson IS NOT excluded\.snapshotJson OR lingyun_sessions\.updatedAt IS NOT excluded\.updatedAt/
    );
  });

  test('SqliteSessionStore list skips malformed rows without filter-map arrays', async () => {
    const driver: SqliteDriver = {
      execute: async () => undefined,
      queryOne: async () => undefined,
      queryAll: async <T extends Record<string, unknown>>() =>
        ([
          { sessionId: 's1', updatedAt: '2020-01-02T00:00:00.000Z' },
          { sessionId: 42, updatedAt: '2020-01-01T00:00:00.000Z' },
          { sessionId: 's2', updatedAt: undefined },
          { sessionId: 's3', updatedAt: '2020-01-03T00:00:00.000Z' },
        ] as unknown as T[]),
    };
    const store = new SqliteSessionStore(driver);

    assert.deepEqual(await store.list({ limit: 10 }), [
      { sessionId: 's1', updatedAt: '2020-01-02T00:00:00.000Z' },
      { sessionId: 's3', updatedAt: '2020-01-03T00:00:00.000Z' },
    ]);

    const source = await fs.readFile(new URL('../../../src/persistence/sqliteSessionStore.ts', import.meta.url), 'utf8');
    const start = source.indexOf('async list(options?: { limit?: number; offset?: number })');
    assert.ok(start >= 0, 'expected list implementation');
    const end = source.indexOf('\n  async delete', start);
    assert.ok(end > start, 'expected delete after list');
    const section = source.slice(start, end);

    assert.match(section, /const entries: LingyunSessionStoreEntry\[\] = \[\];/);
    assert.match(section, /for \(const row of rows\)/);
    assert.match(section, /entries\.push\(\{ sessionId: row\.sessionId, updatedAt: row\.updatedAt \}\);/);
    assert.doesNotMatch(section, /\.filter\(/);
    assert.doesNotMatch(section, /\.map\(/);
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
