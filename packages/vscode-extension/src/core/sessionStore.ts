import * as vscode from 'vscode';

export type SessionMeta = {
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type SessionsIndex = {
  version: 2;
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

export class SessionStore<
  TSession extends { id: string; title: string; createdAt: number; updatedAt: number },
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
    if (!index || index.version !== 2 || !Array.isArray(index.order) || typeof index.activeSessionId !== 'string') {
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
    order: string[];
    dirtySessionIds?: Iterable<string>;
  }): Promise<void> {
    const nextActive = params.sessionsById.has(params.activeSessionId)
      ? params.activeSessionId
      : params.order.find(id => params.sessionsById.has(id));
    if (!nextActive) return;

    const maxSessions = Math.max(1, Number.isFinite(this.options.maxSessions) ? Math.floor(this.options.maxSessions) : 20);
    const maxSessionBytes = Math.max(
      1_000,
      Number.isFinite(this.options.maxSessionBytes) ? Math.floor(this.options.maxSessionBytes) : 2_000_000,
    );

    const order = params.order
      .filter(id => typeof id === 'string')
      .filter(id => params.sessionsById.has(id));

    const prunedOrder = order.length > maxSessions ? order.slice(order.length - maxSessions) : order;
    const prunedSet = new Set(prunedOrder);
    if (!prunedSet.has(nextActive)) {
      if (prunedOrder.length > 0) {
        prunedSet.delete(prunedOrder[0]);
      }
      prunedSet.add(nextActive);
    }

    const finalOrder = prunedOrder.filter(id => prunedSet.has(id));
    if (!finalOrder.includes(nextActive)) {
      finalOrder.push(nextActive);
    }

    const sessionsMeta: Record<string, SessionMeta> = {};
    for (const id of finalOrder) {
      const session = params.sessionsById.get(id);
      if (!session) continue;
      sessionsMeta[id] = {
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    }

    const index: SessionsIndex = {
      version: 2,
      activeSessionId: nextActive,
      order: finalOrder,
      sessionsMeta,
    };

    const dirtyIds = params.dirtySessionIds
      ? [...new Set([...params.dirtySessionIds].filter(id => typeof id === 'string'))]
      : [...finalOrder];

    const dirtyToWrite = dirtyIds.filter(id => prunedSet.has(id));

    await this.enqueueWrite(async () => {
      await this.ensureSessionsDir();

      const previousIndex = await this.tryReadJson<SessionsIndex>(this.indexUri);
      const previousOrder = Array.isArray(previousIndex?.order) ? previousIndex.order : [];
      const previousIds = new Set(previousOrder.filter((id): id is string => typeof id === 'string'));
      const currentIds = new Set(finalOrder);
      const removedIds: string[] = [];

      for (const id of previousIds) {
        if (!currentIds.has(id)) {
          removedIds.push(id);
        }
      }

      for (const id of removedIds) {
        await this.tryDelete(this.getSessionUri(id));
      }

      for (const id of dirtyToWrite) {
        const session = params.sessionsById.get(id);
        if (!session) continue;

        const pruned = this.options.pruneSession ? this.options.pruneSession(session, maxSessionBytes) : session;
        await this.writeJsonAtomic(this.getSessionUri(id), pruned);
      }

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
