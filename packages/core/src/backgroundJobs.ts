import * as cp from 'node:child_process';

export const DEFAULT_BACKGROUND_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_BACKGROUND_KILL_GRACE_MS = 1500;

export type BackgroundJob = {
  id: string;
  scope: string;
  key: string;
  command: string;
  cwd: string;
  pid: number;
  createdAt: number;
  ttlMs: number;
  expiresAt: number;
};

type BackgroundJobEntry = BackgroundJob & {
  ttlTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
};

type JobMap = Map<string, BackgroundJobEntry>;

const jobsByScope = new Map<string, JobMap>();
let exitCleanupRegistered = false;
let sequence = 0;

export function createBackgroundJobKey(args: { cwd: string; command: string }): string {
  const normalizedCwd = args.cwd.trim();
  const normalizedCommand = args.command.trim().replace(/\s+/g, ' ');
  return `${normalizedCwd}\n${normalizedCommand}`;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === 'EPERM';
  }
}

export function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isFinite(pid) || pid <= 0) return;

  if (process.platform === 'win32') {
    try {
      cp.execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } catch {
      // ignore
    }
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // ignore
    }
  }
}

function ensureExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;

  process.once('exit', () => {
    for (const scopeJobs of jobsByScope.values()) {
      for (const job of scopeJobs.values()) {
        killProcessTree(job.pid, 'SIGTERM');
      }
    }
  });
}

function ensureScope(scope: string): JobMap {
  let scopeJobs = jobsByScope.get(scope);
  if (!scopeJobs) {
    scopeJobs = new Map();
    jobsByScope.set(scope, scopeJobs);
  }
  return scopeJobs;
}

function clearTimers(entry: BackgroundJobEntry): void {
  if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
  if (entry.killTimer) clearTimeout(entry.killTimer);
}

function snapshot(entry: BackgroundJobEntry): BackgroundJob {
  const { ttlTimer: _ttlTimer, killTimer: _killTimer, ...rest } = entry;
  return rest;
}

export function getBackgroundJob(scope: string, key: string): BackgroundJob | undefined {
  const entry = jobsByScope.get(scope)?.get(key);
  if (!entry) return undefined;
  return snapshot(entry);
}

export function listBackgroundJobs(scope?: string): BackgroundJob[] {
  if (scope) {
    const scopeJobs = jobsByScope.get(scope);
    if (!scopeJobs) return [];
    return [...scopeJobs.values()].map(snapshot);
  }

  const jobs: BackgroundJob[] = [];
  for (const scopeJobs of jobsByScope.values()) {
    jobs.push(...[...scopeJobs.values()].map(snapshot));
  }
  return jobs;
}

export function removeBackgroundJob(scope: string, key: string): void {
  const scopeJobs = jobsByScope.get(scope);
  if (!scopeJobs) return;
  const entry = scopeJobs.get(key);
  if (!entry) return;
  clearTimers(entry);
  scopeJobs.delete(key);
  if (scopeJobs.size === 0) {
    jobsByScope.delete(scope);
  }
}

function expireBackgroundJob(scope: string, key: string, jobId: string): void {
  const scopeJobs = jobsByScope.get(scope);
  const entry = scopeJobs?.get(key);
  if (!entry || entry.id !== jobId) return;

  if (!isPidAlive(entry.pid)) {
    removeBackgroundJob(scope, key);
    return;
  }

  killProcessTree(entry.pid, 'SIGTERM');
  entry.killTimer = setTimeout(() => {
    try {
      if (isPidAlive(entry.pid)) {
        killProcessTree(entry.pid, 'SIGKILL');
      }
    } finally {
      removeBackgroundJob(scope, key);
    }
  }, DEFAULT_BACKGROUND_KILL_GRACE_MS);
  entry.killTimer.unref?.();
}

export function refreshBackgroundJob(scope: string, key: string, ttlMs?: number): BackgroundJob | undefined {
  const entry = jobsByScope.get(scope)?.get(key);
  if (!entry) return undefined;

  const newTtlMs = ttlMs ?? entry.ttlMs;
  entry.ttlMs = newTtlMs;
  entry.expiresAt = Date.now() + newTtlMs;

  if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
  if (newTtlMs > 0) {
    entry.ttlTimer = setTimeout(() => {
      expireBackgroundJob(scope, key, entry.id);
    }, newTtlMs);
    entry.ttlTimer.unref?.();
  } else {
    entry.ttlTimer = undefined;
  }

  return snapshot(entry);
}

export function registerBackgroundJob(args: {
  scope: string;
  key: string;
  command: string;
  cwd: string;
  pid: number;
  ttlMs: number;
}): BackgroundJob {
  ensureExitCleanup();

  const scopeJobs = ensureScope(args.scope);
  const existing = scopeJobs.get(args.key);
  if (existing) {
    clearTimers(existing);
  }

  const ttlMs =
    Number.isFinite(args.ttlMs) && args.ttlMs >= 0 ? Math.floor(args.ttlMs) : DEFAULT_BACKGROUND_TTL_MS;

  const createdAt = Date.now();
  const id = `${createdAt.toString(36)}-${(++sequence).toString(36)}`;

  const entry: BackgroundJobEntry = {
    id,
    scope: args.scope,
    key: args.key,
    command: args.command,
    cwd: args.cwd,
    pid: args.pid,
    createdAt,
    ttlMs,
    expiresAt: createdAt + ttlMs,
  };

  scopeJobs.set(args.key, entry);

  if (ttlMs > 0) {
    entry.ttlTimer = setTimeout(() => {
      expireBackgroundJob(args.scope, args.key, entry.id);
    }, ttlMs);
    entry.ttlTimer.unref?.();
  }

  return snapshot(entry);
}

export function cleanupDeadBackgroundJobs(scope?: string): void {
  const scopes = scope ? [scope] : [...jobsByScope.keys()];
  for (const s of scopes) {
    const scopeJobs = jobsByScope.get(s);
    if (!scopeJobs) continue;
    for (const [key, entry] of scopeJobs.entries()) {
      if (!isPidAlive(entry.pid)) {
        removeBackgroundJob(s, key);
      }
    }
  }
}
