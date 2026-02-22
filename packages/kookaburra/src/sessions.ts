import * as fs from 'fs/promises';
import * as path from 'path';

import type { SessionSnapshot } from '@kooka/agent-sdk';
import { parseSessionSnapshot, restoreSession, serializeSessionSnapshot, snapshotSession } from '@kooka/agent-sdk';
import type { AgentSession } from '@kooka/agent-sdk';

import { redactSensitive } from './redact.js';

const SESSION_ID_RE = /^[a-zA-Z0-9_:@.-]+$/;

function normalizeSessionId(raw: string | undefined, options?: { maxLength?: number }): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return undefined;

  const maxLength = typeof options?.maxLength === 'number' && options.maxLength > 0 ? Math.floor(options.maxLength) : 200;
  if (trimmed.length > maxLength) return undefined;
  if (!SESSION_ID_RE.test(trimmed)) return undefined;

  return trimmed;
}

function base64UrlEncodeUtf8(input: string): string {
  const b64 = Buffer.from(input, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeUtf8(input: string): string | undefined {
  const s = String(input || '').trim();
  if (!s) return undefined;

  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  try {
    return Buffer.from(normalized + padding, 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

function sessionFilename(sessionId: string): string {
  return `sid_${base64UrlEncodeUtf8(sessionId)}.json`;
}

export type SessionStore = {
  sessionsDir: string;
};

export function resolveSessionsDir(workspaceRoot: string, sessionsDirSetting: string): string {
  const dir = sessionsDirSetting.trim() || path.join('.kookaburra', 'sessions');
  return path.isAbsolute(dir) ? dir : path.join(workspaceRoot, dir);
}

function sessionPath(store: SessionStore, sessionId: string): string {
  return path.join(store.sessionsDir, sessionFilename(sessionId));
}

export async function loadSession(store: SessionStore, rawSessionId: string): Promise<AgentSession | undefined> {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId) return undefined;

  let raw: string | undefined;
  try {
    raw = await fs.readFile(sessionPath(store, sessionId), 'utf8');
  } catch {
    return undefined;
  }

  const snapshot = parseSessionSnapshot(raw);
  return restoreSession(snapshot);
}

export async function saveSession(store: SessionStore, session: AgentSession, options?: { sessionId?: string }): Promise<void> {
  const sessionId = normalizeSessionId(options?.sessionId ?? session.sessionId) ?? 'default';
  const snapshot: SessionSnapshot = snapshotSession(session, { sessionId });
  const json = serializeSessionSnapshot(snapshot, { pretty: true });

  // Never persist secrets in plain text. This is best-effort redaction; tools
  // should also avoid reading secrets by default.
  const redacted = redactSensitive(json);

  await fs.mkdir(store.sessionsDir, { recursive: true });
  const filePath = sessionPath(store, sessionId);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, redacted, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function listSessions(store: SessionStore): Promise<Array<{ sessionId: string; updatedAtMs: number }>> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(store.sessionsDir);
  } catch {
    return [];
  }

  const out: Array<{ sessionId: string; updatedAtMs: number }> = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    if (!name.startsWith('sid_')) continue;
    const stem = name.replace(/\.json$/i, '');

    const decoded = base64UrlDecodeUtf8(stem.slice('sid_'.length));
    const sessionId = decoded ? decoded : '';

    if (!normalizeSessionId(sessionId)) continue;
    try {
      const stat = await fs.stat(path.join(store.sessionsDir, name));
      out.push({ sessionId, updatedAtMs: stat.mtimeMs });
    } catch {
      // ignore
    }
  }

  out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return out;
}

export async function clearSessions(store: SessionStore): Promise<void> {
  await fs.rm(store.sessionsDir, { recursive: true, force: true });
}
