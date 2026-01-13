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

  test('handles corrupted json gracefully', async () => {
    const dir = makeTempDir();
    try {
      const sessionsDir = path.join(dir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      fs.writeFileSync(path.join(sessionsDir, 'index.json'), '{ not json');

      const store = new SessionStore<TestSession>(vscode.Uri.file(dir), {
        maxSessions: 20,
        maxSessionBytes: 2_000_000,
      });

      const loaded = await store.loadAll();
      assert.strictEqual(loaded, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

