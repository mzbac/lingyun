import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { SessionStore } from '../../core/sessionStore';

type TestSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{ content: string }>;
};

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lingyun-sessionstore-'));
}

suite('SessionStore', () => {
  test('save/load roundtrip', async () => {
    const dir = makeTempDir();
    try {
      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000_000,
      });

      const now = Date.now();
      const s1: TestSession = {
        id: 's1',
        title: 'Session 1',
        createdAt: now,
        updatedAt: now,
        messages: [{ content: 'hello' }],
      };

      const sessionsById = new Map<string, TestSession>([[s1.id, s1]]);
      await store.save({
        sessionsById,
        activeSessionId: s1.id,
        order: [s1.id],
        dirtySessionIds: [s1.id],
      });

      const loaded = await store.loadAll();
      assert.ok(loaded);
      assert.strictEqual(loaded?.index.activeSessionId, 's1');
      assert.strictEqual(loaded?.sessionsById.get('s1')?.title, 'Session 1');
      assert.strictEqual(loaded?.sessionsById.get('s1')?.messages[0].content, 'hello');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('save accepts iterable order and falls back to the first existing session', async () => {
    const dir = makeTempDir();
    try {
      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000_000,
      });

      const now = Date.now();
      const sessionsById = new Map<string, TestSession>();
      for (const id of ['s1', 's2']) {
        sessionsById.set(id, {
          id,
          title: id,
          createdAt: now,
          updatedAt: now,
          messages: [{ content: id }],
        });
      }

      function* orderedIds(): Generator<string> {
        yield 'missing';
        yield 's1';
        yield 's2';
      }

      await store.save({
        sessionsById,
        activeSessionId: 'missing-active',
        order: orderedIds(),
      });

      const loaded = await store.loadAll();
      assert.ok(loaded);
      assert.strictEqual(loaded?.index.activeSessionId, 's1');
      assert.deepStrictEqual(loaded?.index.order, ['s1', 's2']);
      assert.strictEqual(loaded?.sessionsById.has('s1'), true);
      assert.strictEqual(loaded?.sessionsById.has('s2'), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('save skips unchanged index rewrite when no sessions are dirty', async () => {
    const dir = makeTempDir();
    try {
      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000_000,
      });

      const now = Date.now();
      const session: TestSession = {
        id: 's1',
        title: 'Session 1',
        createdAt: now,
        updatedAt: now,
        messages: [{ content: 'hello' }],
      };
      const sessionsById = new Map<string, TestSession>([[session.id, session]]);

      await store.save({
        sessionsById,
        activeSessionId: session.id,
        order: [session.id],
        dirtySessionIds: [session.id],
      });

      const indexPath = path.join(dir, 'sessions', 'index.json');
      const beforeStat = fs.statSync(indexPath);
      const beforeContent = fs.readFileSync(indexPath, 'utf8');

      await store.save({
        sessionsById,
        activeSessionId: session.id,
        order: [session.id],
        dirtySessionIds: [],
      });

      const afterStat = fs.statSync(indexPath);
      assert.strictEqual(fs.readFileSync(indexPath, 'utf8'), beforeContent);
      assert.strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prunes sessions beyond maxSessions', async () => {
    const dir = makeTempDir();
    try {
      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 2,
        maxSessionBytes: 2_000_000,
      });

      const now = Date.now();
      const sessionsById = new Map<string, TestSession>();
      for (const id of ['s1', 's2', 's3']) {
        sessionsById.set(id, {
          id,
          title: id,
          createdAt: now,
          updatedAt: now,
          messages: [{ content: id }],
        });
      }

      await store.save({
        sessionsById,
        activeSessionId: 's3',
        order: ['s1', 's2', 's3'],
        dirtySessionIds: ['s1', 's2', 's3'],
      });

      const loaded = await store.loadAll();
      assert.ok(loaded);
      assert.deepStrictEqual(loaded?.index.order, ['s2', 's3']);
      assert.strictEqual(loaded?.sessionsById.has('s1'), false);
      assert.strictEqual(loaded?.sessionsById.has('s2'), true);
      assert.strictEqual(loaded?.sessionsById.has('s3'), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('pruneSession callback can enforce maxSessionBytes', async () => {
    const dir = makeTempDir();
    try {
      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000,
        pruneSession: (session, limit) => {
          const copy: TestSession = { ...session, messages: [...session.messages] };
          const measure = () => Buffer.byteLength(JSON.stringify(copy), 'utf8');

          while (measure() > limit && copy.messages.length > 1) {
            copy.messages.shift();
          }
          return copy;
        },
      });

      const now = Date.now();
      const bigMessages = Array.from({ length: 20 }, (_, i) => ({
        content: `${i}:${'x'.repeat(300)}`,
      }));

      const session: TestSession = {
        id: 's1',
        title: 'big',
        createdAt: now,
        updatedAt: now,
        messages: bigMessages,
      };

      const sessionsById = new Map<string, TestSession>([[session.id, session]]);
      await store.save({
        sessionsById,
        activeSessionId: 's1',
        order: ['s1'],
        dirtySessionIds: ['s1'],
      });

      const loaded = await store.loadAll();
      assert.ok(loaded);
      const loadedSession = loaded?.sessionsById.get('s1');
      assert.ok(loadedSession);
      assert.ok((loadedSession?.messages.length || 0) < bigMessages.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports an unreadable index and never deletes files for it', async () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = path.join(dir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Simulate a previous version's storage: a session file on disk but an
      // index the current code cannot parse (corrupt or schema mismatch).
      fs.writeFileSync(path.join(sessionsDir, 'index.json'), '{ not json');
      fs.writeFileSync(
        path.join(sessionsDir, 'old-session.json'),
        JSON.stringify({ id: 'old-session', title: 'Old', createdAt: 1, updatedAt: 1, messages: [{ content: 'hi' }] })
      );

      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000_000,
      });

      const loaded = await store.loadAll();
      assert.ok(loaded, 'expected an informative load result for an existing but unreadable index');
      assert.strictEqual(loaded?.indexValid, false);
      assert.strictEqual(loaded?.sessionsById.size, 0);

      // A save after the failed load (e.g. the new version starting a fresh
      // session) must NOT delete the old session files.
      const fresh: TestSession = { id: 'fresh', title: 'Fresh', createdAt: 2, updatedAt: 2, messages: [] };
      await store.save({
        sessionsById: new Map([['fresh', fresh]]),
        activeSessionId: 'fresh',
        order: ['fresh'],
        dirtySessionIds: ['fresh'],
      });

      assert.strictEqual(fs.existsSync(path.join(sessionsDir, 'old-session.json')), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loads and migrates a version 2 index', async () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = path.join(dir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      fs.writeFileSync(
        path.join(sessionsDir, 'index.json'),
        JSON.stringify({
          version: 2,
          activeSessionId: 's1',
          order: ['s1', 's2'],
          sessionsMeta: {
            s1: { title: 'Session 1', createdAt: 1, updatedAt: 2 },
            s2: { title: 'Session 2', createdAt: 3, updatedAt: 4 },
          },
        })
      );
      fs.writeFileSync(
        path.join(sessionsDir, 's1.json'),
        JSON.stringify({ id: 's1', title: 'Session 1', createdAt: 1, updatedAt: 2, messages: [{ content: 'a' }] })
      );
      fs.writeFileSync(
        path.join(sessionsDir, 's2.json'),
        JSON.stringify({ id: 's2', title: 'Session 2', createdAt: 3, updatedAt: 4, messages: [{ content: 'b' }] })
      );

      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000_000,
      });

      const loaded = await store.loadAll();
      assert.ok(loaded);
      assert.strictEqual(loaded?.indexValid, true);
      assert.strictEqual(loaded?.migratedFromVersion, 2);
      assert.strictEqual(loaded?.index.version, 3);
      assert.strictEqual(loaded?.sessionsById.size, 2);
      assert.strictEqual(loaded?.sessionsById.get('s1')?.messages[0].content, 'a');

      // The next save rewrites the index at the current schema version.
      await store.save({
        sessionsById: loaded.sessionsById,
        activeSessionId: loaded.index.activeSessionId,
        order: loaded.index.order,
      });
      const rewritten = JSON.parse(fs.readFileSync(path.join(sessionsDir, 'index.json'), 'utf8'));
      assert.strictEqual(rewritten.version, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prunes files only after a successful load', async () => {
    const dir = makeTempDir();
    try {
      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000_000,
      });

      const now = Date.now();
      const sessionsById = new Map<string, TestSession>();
      for (const id of ['s1', 's2', 's3']) {
        sessionsById.set(id, {
          id,
          title: id,
          createdAt: now,
          updatedAt: now,
          messages: [{ content: id }],
        });
      }

      // First save without any prior load: the index is written, but the store
      // is not authoritative yet, so nothing is deleted from disk.
      await store.save({
        sessionsById,
        activeSessionId: 's1',
        order: ['s1', 's2', 's3'],
        dirtySessionIds: ['s1', 's2', 's3'],
      });
      assert.strictEqual(fs.existsSync(path.join(dir, 'sessions', 's1.json')), true);

      const loaded = await store.loadAll();
      assert.ok(loaded);
      assert.deepStrictEqual(loaded?.index.order, ['s1', 's2', 's3']);

      // After a successful load, saving a smaller set prunes the removed files.
      const smaller = new Map<string, TestSession>([['s3', sessionsById.get('s3')!]]);
      await store.save({
        sessionsById: smaller,
        activeSessionId: 's3',
        order: ['s3'],
        dirtySessionIds: ['s3'],
      });
      assert.strictEqual(fs.existsSync(path.join(dir, 'sessions', 's1.json')), false);
      assert.strictEqual(fs.existsSync(path.join(dir, 'sessions', 's2.json')), false);
      assert.strictEqual(fs.existsSync(path.join(dir, 'sessions', 's3.json')), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
