import * as vscode from 'vscode';

type SessionKey = string;
type FileKey = string;

const DEFAULT_SESSION = 'default';

const reads = new Map<SessionKey, Map<FileKey, number>>();
const locks = new Map<FileKey, Promise<void>>();

function sessionKey(sessionId?: string): string {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : '';
  return trimmed ? trimmed : DEFAULT_SESSION;
}

function fileKey(absPath: string): string {
  return absPath;
}

export function recordFileRead(sessionId: string | undefined, absPath: string): void {
  const sKey = sessionKey(sessionId);
  const fKey = fileKey(absPath);
  const sessionReads = reads.get(sKey) ?? new Map<FileKey, number>();
  sessionReads.set(fKey, Date.now());
  reads.set(sKey, sessionReads);
}

export function getLastReadTime(sessionId: string | undefined, absPath: string): number | undefined {
  const sKey = sessionKey(sessionId);
  return reads.get(sKey)?.get(fileKey(absPath));
}

export async function assertFileWasRead(
  sessionId: string | undefined,
  uri: vscode.Uri,
  absPath: string
): Promise<void> {
  const lastRead = getLastReadTime(sessionId, absPath);
  if (!lastRead) {
    throw new Error(`You must read the file ${absPath} before modifying it. Use the Read tool first.`);
  }

  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.mtime > lastRead) {
    const mtime = new Date(stat.mtime).toISOString();
    const rtime = new Date(lastRead).toISOString();
    throw new Error(
      `File ${absPath} has been modified since it was last read.\nLast modification: ${mtime}\nLast read: ${rtime}\n\nPlease read the file again before modifying it.`
    );
  }
}

export async function withFileLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
  const key = fileKey(absPath);
  const currentLock = locks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const nextLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  const chained = currentLock.then(() => nextLock);
  locks.set(key, chained);

  await currentLock;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) {
      locks.delete(key);
    }
  }
}

