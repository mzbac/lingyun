import { parseSessionSnapshot, type LingyunSessionSnapshot } from './sessionSnapshot.js';

export type LingyunSessionStoreEntry = {
  sessionId: string;
  updatedAt: string;
};

export interface LingyunSessionStore {
  save(sessionId: string, snapshot: LingyunSessionSnapshot): Promise<void>;
  load(sessionId: string): Promise<LingyunSessionSnapshot | undefined>;
  list(options?: { limit?: number; offset?: number }): Promise<LingyunSessionStoreEntry[]>;
  delete(sessionId: string): Promise<void>;
}

export type SqliteDriver = {
  execute: (sql: string, params?: unknown[]) => void | Promise<void>;
  queryOne: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => T | undefined | Promise<T | undefined>;
  queryAll: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => T[] | Promise<T[]>;
};

export type SqliteSessionStoreOptions = {
  tableName?: string;
};

function sanitizeSqlIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('SqliteSessionStore: tableName must be non-empty');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`SqliteSessionStore: invalid tableName "${trimmed}"`);
  }
  return trimmed;
}

export class SqliteSessionStore implements LingyunSessionStore {
  private readonly tableName: string;
  private readonly initPromise: Promise<void>;

  constructor(
    private readonly driver: SqliteDriver,
    options?: SqliteSessionStoreOptions
  ) {
    this.tableName = sanitizeSqlIdentifier(options?.tableName ?? 'lingyun_sessions');
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    await this.driver.execute(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (` +
        `sessionId TEXT PRIMARY KEY, ` +
        `snapshotJson TEXT NOT NULL, ` +
        `updatedAt TEXT NOT NULL` +
        `)`
    );
  }

  private async ensureInit(): Promise<void> {
    await this.initPromise;
  }

  async save(sessionId: string, snapshot: LingyunSessionSnapshot): Promise<void> {
    const id = sessionId.trim();
    if (!id) throw new Error('SqliteSessionStore.save: sessionId is required');
    await this.ensureInit();

    const updatedAt = snapshot.savedAt || new Date().toISOString();
    const snapshotJson = JSON.stringify(snapshot);

    await this.driver.execute(
      `INSERT INTO ${this.tableName} (sessionId, snapshotJson, updatedAt) VALUES (?, ?, ?) ` +
        `ON CONFLICT(sessionId) DO UPDATE SET snapshotJson=excluded.snapshotJson, updatedAt=excluded.updatedAt`,
      [id, snapshotJson, updatedAt]
    );
  }

  async load(sessionId: string): Promise<LingyunSessionSnapshot | undefined> {
    const id = sessionId.trim();
    if (!id) throw new Error('SqliteSessionStore.load: sessionId is required');
    await this.ensureInit();

    const row = await this.driver.queryOne<{ snapshotJson: string }>(
      `SELECT snapshotJson FROM ${this.tableName} WHERE sessionId = ?`,
      [id]
    );

    if (!row || typeof row.snapshotJson !== 'string' || !row.snapshotJson.trim()) return undefined;

    try {
      return parseSessionSnapshot(row.snapshotJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SqliteSessionStore.load: invalid snapshot for sessionId="${id}": ${message}`);
    }
  }

  async list(options?: { limit?: number; offset?: number }): Promise<LingyunSessionStoreEntry[]> {
    await this.ensureInit();

    const limitRaw = options?.limit;
    const offsetRaw = options?.offset;
    const limit = Number.isFinite(limitRaw as number) ? Math.max(1, Math.floor(limitRaw as number)) : 50;
    const offset = Number.isFinite(offsetRaw as number) ? Math.max(0, Math.floor(offsetRaw as number)) : 0;

    const rows = await this.driver.queryAll<{ sessionId: string; updatedAt: string }>(
      `SELECT sessionId, updatedAt FROM ${this.tableName} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rows
      .filter((row) => typeof row.sessionId === 'string' && typeof row.updatedAt === 'string')
      .map((row) => ({ sessionId: row.sessionId, updatedAt: row.updatedAt }));
  }

  async delete(sessionId: string): Promise<void> {
    const id = sessionId.trim();
    if (!id) throw new Error('SqliteSessionStore.delete: sessionId is required');
    await this.ensureInit();

    await this.driver.execute(`DELETE FROM ${this.tableName} WHERE sessionId = ?`, [id]);
  }
}

