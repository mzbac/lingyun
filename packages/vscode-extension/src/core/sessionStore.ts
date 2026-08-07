import * as vscode from 'vscode';

export type SessionMeta = {
  title: string;
  firstUserMessagePreview?: string;
  createdAt: number;
  updatedAt: number;
};

export type SessionsIndex = {
  version: 3;
  activeSessionId: string;
  order: string[];
  sessionsMeta: Record<string, SessionMeta>;
};

/**
 * Result of `SessionStore.loadAll()` when an index file exists on disk.
 *
 * `indexValid` is `false` when the index could not be parsed or belongs to an
 * unsupported schema version. In that case `sessionsById` is empty and callers
 * must NOT treat the store as authoritative (a later save will keep the old
 * files on disk instead of pruning them).
 */
export type SessionStoreLoad<TSession> = {
  index: SessionsIndex;
  sessionsById: Map<string, TSession>;
  indexValid: boolean;
  /** Set when the on-disk index used an older schema that was accepted (e.g. version 2). */
  migratedFromVersion?: number;
};

export type SessionStoreOptions<TSession> = {
  maxSessions: number;
  maxSessionBytes: number;
  pruneSession?: (session: TSession, maxSessionBytes: number) => TSession;
  log?: (message: string) => void;
};

function sessionsIndexEquals(a: SessionsIndex | undefined, b: SessionsIndex): boolean {
  if (!a || a.version !== b.version || a.activeSessionId !== b.activeSessionId) return false;
  return sameSessionOrder(a.order, b.order);
}

function sameSessionOrder(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!Array.isArray(a) || a.length !== (b?.length ?? 0)) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b?.[i]) return false;
  }
  return true;
}

const CURRENT_INDEX_VERSION = 3 as const;
/** Schema versions we accept when reading; older ones are migrated in memory and rewritten on the next save. */
const READABLE_INDEX_VERSIONS = new Set<number>([2, CURRENT_INDEX_VERSION]);

function normalizeSessionsIndex(raw: unknown): SessionsIndex | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Record<string, unknown>;
  if (!READABLE_INDEX_VERSIONS.has(candidate.version as number)) return undefined;
  if (!Array.isArray(candidate.order) || typeof candidate.activeSessionId !== 'string') return undefined;

  const order: string[] = [];
  for (const id of candidate.order) {
    if (typeof id === 'string' && id.trim()) order.push(id);
  }

  const sessionsMeta: Record<string, SessionMeta> = {};
  const rawMeta = candidate.sessionsMeta;
  if (rawMeta && typeof rawMeta === 'object') {
    for (const id of order) {
      const meta = (rawMeta as Record<string, unknown>)[id];
      if (!meta || typeof meta !== 'object') continue;
      const m = meta as Record<string, unknown>;
      sessionsMeta[id] = {
        title: typeof m.title === 'string' ? m.title : '',
        firstUserMessagePreview: typeof m.firstUserMessagePreview === 'string' ? m.firstUserMessagePreview : undefined,
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : 0,
        updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : 0,
      };
    }
  }

  return {
    version: CURRENT_INDEX_VERSION,
    activeSessionId: candidate.activeSessionId,
    order,
    sessionsMeta,
  };
}

export class SessionStore<
  TSession extends { id: string; title: string; firstUserMessagePreview?: string; createdAt: number; updatedAt: number },
> {
  private readonly sessionsDir: vscode.Uri;
  private readonly indexUri: vscode.Uri;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder('utf-8');

  /**
   * The order of the index that was last read successfully by this store.
   * Session files are only pruned (deleted) when the on-disk index still
   * matches this snapshot; otherwise the store is not authoritative about what
   * previously existed and must not delete anything.
   */
  private lastLoadedIndexOrder: string[] | undefined;

  constructor(
    private readonly baseUri: vscode.Uri,
    private readonly options: SessionStoreOptions<TSession>,
  ) {
    this.sessionsDir = vscode.Uri.joinPath(baseUri, 'sessions');
    this.indexUri = vscode.Uri.joinPath(this.sessionsDir, 'index.json');
  }

  async loadAll(): Promise<SessionStoreLoad<TSession> | undefined> {
    if (!(await this.pathExists(this.indexUri))) {
      // Fresh store: nothing persisted yet (not an error).
      return undefined;
    }

    const raw = await this.tryReadJson<unknown>(this.indexUri);
    const index = normalizeSessionsIndex(raw);
    if (!index) {
      // Index exists but is unreadable or from an unsupported schema version.
      // Do not treat the store as authoritative: a later save must keep the
      // existing files on disk instead of pruning them.
      this.lastLoadedIndexOrder = undefined;
      return {
        index: { version: CURRENT_INDEX_VERSION, activeSessionId: '', order: [], sessionsMeta: {} },
        sessionsById: new Map<string, TSession>(),
        indexValid: false,
      };
    }

    const sessionsById = new Map<string, TSession>();
    for (const id of index.order) {
      const session = await this.tryReadJson<TSession>(this.getSessionUri(id));
      if (!session || typeof session.id !== 'string' || session.id !== id) continue;
      sessionsById.set(id, session);
    }

    // Only claim authority when we actually recovered sessions. An index that
    // lists sessions whose files are all missing/unreadable must not trigger
    // pruning of those files on the next save.
    this.lastLoadedIndexOrder = sessionsById.size > 0 ? [...index.order] : undefined;

    return {
      index,
      sessionsById,
      indexValid: true,
      migratedFromVersion: raw && typeof raw === 'object' && (raw as Record<string, unknown>).version === 2 ? 2 : undefined,
    };
  }

  async save(params: {
    sessionsById: Map<string, TSession>;
    activeSessionId: string;
    order: Iterable<string>;
    dirtySessionIds?: Iterable<string>;
  }): Promise<void> {
    const order: string[] = [];
    for (const id of params.order) {
      if (typeof id === 'string' && params.sessionsById.has(id)) {
        order.push(id);
      }
    }

    const nextActive = params.sessionsById.has(params.activeSessionId)
      ? params.activeSessionId
      : order[0];
    if (!nextActive) return;

    const maxSessions = Math.max(1, Number.isFinite(this.options.maxSessions) ? Math.floor(this.options.maxSessions) : 20);
    const maxSessionBytes = Math.max(
      1_000,
      Number.isFinite(this.options.maxSessionBytes) ? Math.floor(this.options.maxSessionBytes) : 2_000_000,
    );

    const prunedOrder: string[] = [];
    const firstPrunedIndex = Math.max(0, order.length - maxSessions);
    for (let i = firstPrunedIndex; i < order.length; i++) {
      const id = order[i];
      if (id !== undefined) prunedOrder.push(id);
    }
    const prunedSet = new Set(prunedOrder);
    if (!prunedSet.has(nextActive)) {
      if (prunedOrder.length > 0) {
        prunedSet.delete(prunedOrder[0]);
      }
      prunedSet.add(nextActive);
    }

    const finalOrder: string[] = [];
    let hasNextActive = false;
    for (const id of prunedOrder) {
      if (!prunedSet.has(id)) continue;
      finalOrder.push(id);
      if (id === nextActive) hasNextActive = true;
    }
    if (!hasNextActive) {
      finalOrder.push(nextActive);
    }

    const sessionsMeta: Record<string, SessionMeta> = {};
    for (const id of finalOrder) {
      const session = params.sessionsById.get(id);
      if (!session) continue;
      sessionsMeta[id] = {
        title: session.title,
        firstUserMessagePreview: session.firstUserMessagePreview,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    }

    const index: SessionsIndex = {
      version: CURRENT_INDEX_VERSION,
      activeSessionId: nextActive,
      order: finalOrder,
      sessionsMeta,
    };

    const dirtyToWrite: string[] = [];
    if (params.dirtySessionIds) {
      const seenDirtyIds = new Set<string>();
      for (const id of params.dirtySessionIds) {
        if (typeof id !== 'string' || seenDirtyIds.has(id) || !prunedSet.has(id)) continue;
        seenDirtyIds.add(id);
        dirtyToWrite.push(id);
      }
    } else {
      for (const id of finalOrder) {
        if (prunedSet.has(id)) dirtyToWrite.push(id);
      }
    }

    await this.enqueueWrite(async () => {
      await this.ensureSessionsDir();

      const previousIndex = normalizeSessionsIndex(await this.tryReadJson<unknown>(this.indexUri));
      const previousOrder = previousIndex ? previousIndex.order : [];
      const currentIds = new Set(finalOrder);

      // Only prune files when this store successfully loaded the previous index
      // and the on-disk index still matches what we loaded. Otherwise the save
      // is not authoritative about earlier sessions (e.g. a schema mismatch or
      // a corrupt index after an extension update) and deleting files would
      // permanently destroy history.
      const canPrune =
        this.lastLoadedIndexOrder !== undefined && sameSessionOrder(this.lastLoadedIndexOrder, previousOrder);
      const removedIds = new Set<string>();
      if (canPrune) {
        for (const id of previousOrder) {
          if (typeof id !== 'string' || currentIds.has(id) || removedIds.has(id)) continue;
          removedIds.add(id);
          await this.tryDelete(this.getSessionUri(id));
        }
      }

      for (const id of dirtyToWrite) {
        const session = params.sessionsById.get(id);
        if (!session) continue;

        const pruned = this.options.pruneSession ? this.options.pruneSession(session, maxSessionBytes) : session;
        await this.writeJsonAtomic(this.getSessionUri(id), pruned);
      }

      if (dirtyToWrite.length === 0 && sessionsIndexEquals(previousIndex, index)) {
        this.lastLoadedIndexOrder = [...finalOrder];
        return;
      }
      await this.writeJsonAtomic(this.indexUri, index);
      this.lastLoadedIndexOrder = [...finalOrder];
    });
  }

  async clear(): Promise<void> {
    await this.enqueueWrite(async () => {
      this.lastLoadedIndexOrder = undefined;
      try {
        await vscode.workspace.fs.delete(this.sessionsDir, { recursive: true, useTrash: false });
      } catch {
        // Ignore missing directory or delete failures; next save will recreate.
      }
    });
  }

  private getSessionUri(sessionId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.sessionsDir, `${sessionId}.json`);
  }

  private async pathExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureSessionsDir(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.sessionsDir);
  }

  private async enqueueWrite(fn: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(fn);
    this.writeChain = run.catch(err => {
      this.options.log?.(
        `SessionStore write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return run;
  }

  private async tryReadJson<T>(uri: vscode.Uri): Promise<T | undefined> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = this.decoder.decode(raw);
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  private async writeJsonAtomic(uri: vscode.Uri, value: unknown): Promise<void> {
    const json = JSON.stringify(value, null, 2);
    const bytes = this.encoder.encode(json);

    const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1) || 'data.json';
    const tmpUri = vscode.Uri.joinPath(
      this.sessionsDir,
      `${fileName}.tmp-${crypto.randomUUID()}`,
    );

    await vscode.workspace.fs.writeFile(tmpUri, bytes);
    await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
  }

  private async tryDelete(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
    } catch {
      // Ignore missing files.
    }
  }
}
