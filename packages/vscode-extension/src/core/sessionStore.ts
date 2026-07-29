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

export type SessionStoreOptions<TSession> = {
  maxSessions: number;
  maxSessionBytes: number;
  pruneSession?: (session: TSession, maxSessionBytes: number) => TSession;
  log?: (message: string) => void;
};

function sessionsIndexEquals(a: SessionsIndex | undefined, b: SessionsIndex): boolean {
  if (!a || a.version !== b.version || a.activeSessionId !== b.activeSessionId) return false;
  if (!Array.isArray(a.order) || a.order.length !== b.order.length) return false;
  for (let i = 0; i < b.order.length; i++) {
    if (a.order[i] !== b.order[i]) return false;
  }

  const aMeta = a.sessionsMeta || {};
  const bMeta = b.sessionsMeta || {};
  for (const id of b.order) {
    const left = aMeta[id];
    const right = bMeta[id];
    if (!left || !right) return false;
    if (
      left.title !== right.title ||
      left.firstUserMessagePreview !== right.firstUserMessagePreview ||
      left.createdAt !== right.createdAt ||
      left.updatedAt !== right.updatedAt
    ) {
      return false;
    }
  }
  return true;
}

export class SessionStore<
  TSession extends { id: string; title: string; firstUserMessagePreview?: string; createdAt: number; updatedAt: number },
> {
  private readonly sessionsDir: vscode.Uri;
  private readonly indexUri: vscode.Uri;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder('utf-8');

  constructor(
    private readonly baseUri: vscode.Uri,
    private readonly options: SessionStoreOptions<TSession>,
  ) {
    this.sessionsDir = vscode.Uri.joinPath(baseUri, 'sessions');
    this.indexUri = vscode.Uri.joinPath(this.sessionsDir, 'index.json');
  }

  async loadAll(): Promise<{ index: SessionsIndex; sessionsById: Map<string, TSession> } | undefined> {
    const index = await this.tryReadJson<SessionsIndex>(this.indexUri);
    if (!index || index.version !== 3 || !Array.isArray(index.order) || typeof index.activeSessionId !== 'string') {
      return undefined;
    }

    const sessionsById = new Map<string, TSession>();
    for (const id of index.order) {
      if (typeof id !== 'string' || !id.trim()) continue;
      const session = await this.tryReadJson<TSession>(this.getSessionUri(id));
      if (!session || typeof session.id !== 'string' || session.id !== id) continue;
      sessionsById.set(id, session);
    }

    if (sessionsById.size === 0) {
      return undefined;
    }

    return { index, sessionsById };
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
      version: 3,
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

      const previousIndex = await this.tryReadJson<SessionsIndex>(this.indexUri);
      const previousOrder = Array.isArray(previousIndex?.order) ? previousIndex.order : [];
      const currentIds = new Set(finalOrder);
      const removedIds = new Set<string>();
      for (const id of previousOrder) {
        if (typeof id !== 'string' || currentIds.has(id) || removedIds.has(id)) continue;
        removedIds.add(id);
        await this.tryDelete(this.getSessionUri(id));
      }

      for (const id of dirtyToWrite) {
        const session = params.sessionsById.get(id);
        if (!session) continue;

        const pruned = this.options.pruneSession ? this.options.pruneSession(session, maxSessionBytes) : session;
        await this.writeJsonAtomic(this.getSessionUri(id), pruned);
      }

      if (dirtyToWrite.length === 0 && sessionsIndexEquals(previousIndex, index)) return;
      await this.writeJsonAtomic(this.indexUri, index);
    });
  }

  async clear(): Promise<void> {
    await this.enqueueWrite(async () => {
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
