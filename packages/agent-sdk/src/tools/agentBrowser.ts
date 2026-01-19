import * as crypto from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

import type { ToolContext, ToolDefinition, ToolProvider, ToolResult } from '../types.js';
import type { Disposable, ToolRegistry } from './registry.js';
import { isSubPath, optionalBoolean, optionalNumber, optionalString, redactFsPathForPrompt, requireString } from '@kooka/core';

export type AgentBrowserRunAction =
  | { type: 'open'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'click'; selector: string }
  | { type: 'dblclick'; selector: string }
  | { type: 'focus'; selector: string }
  | { type: 'hover'; selector: string }
  | { type: 'fill'; selector: string; text: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'press'; key: string }
  | { type: 'select'; selector: string; value: string }
  | { type: 'check'; selector: string }
  | { type: 'uncheck'; selector: string }
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; px?: number }
  | { type: 'scrollIntoView'; selector: string }
  | {
      type: 'wait';
      ms?: number;
      selector?: string;
      text?: string;
      url?: string;
      load?: 'load' | 'domcontentloaded' | 'networkidle';
      fn?: string;
    }
  | {
      type: 'get';
      kind: 'text' | 'html' | 'value' | 'attr' | 'title' | 'url';
      selector?: string;
      attr?: string;
      maxChars?: number;
    }
  | { type: 'screenshot'; name?: string; fullPage?: boolean }
  | { type: 'pdf'; name?: string }
  | { type: 'traceStart'; name?: string }
  | { type: 'traceStop'; name?: string };

export type AgentBrowserToolsOptions = {
  enabled?: boolean;
  timeoutMs?: number;
  maxSnapshotChars?: number;
  maxTextChars?: number;
  defaultTtlMs?: number;
  artifactsDir?: string;
  allowHttp?: boolean;
  allowPrivateHosts?: boolean;
  agentBrowserBin?: string;
  runner?: AgentBrowserRunner;
};

type AgentBrowserJson<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};

export type AgentBrowserRunner = (
  args: string[],
  options: { timeoutMs: number; cwd: string; bin: string }
) => Promise<AgentBrowserJson<unknown>>;

type BrowserSessionEntry = {
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
  ttlMs: number;
  expiresAt: number;
  timer?: NodeJS.Timeout;
  closing?: boolean;
};

function clampInt(value: number, min: number, max: number): number {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function normalizeUrlInput(url: string, allowHttp: boolean): string {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `${allowHttp ? 'http' : 'https'}://${trimmed}`;
}

function isPrivateHostname(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  if (host.endsWith('.internal')) return true;
  if (host.endsWith('.home')) return true;
  return false;
}

function validatePublicUrl(
  input: string,
  opts: { allowHttp: boolean; allowPrivateHosts: boolean }
): { ok: true; url: URL } | { ok: false; reason: string } {
  const normalized = normalizeUrlInput(input, opts.allowHttp);
  if (!normalized) return { ok: false, reason: 'url is required' };
  if (normalized.length > 2048) return { ok: false, reason: 'url is too long' };

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, reason: 'invalid url' };
  }

  if (!opts.allowHttp && parsed.protocol !== 'https:') return { ok: false, reason: 'only https:// urls are allowed' };
  if (opts.allowHttp && parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'only http(s):// urls are allowed' };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: 'url must not include credentials' };
  if (!parsed.hostname) return { ok: false, reason: 'url hostname is required' };
  if (!opts.allowPrivateHosts && isPrivateHostname(parsed.hostname)) {
    return { ok: false, reason: 'private/localhost domains are not allowed' };
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname) || parsed.hostname.includes(':')) {
    return { ok: false, reason: 'ip address hosts are not allowed' };
  }
  return { ok: true, url: parsed };
}

function validateSessionId(raw: string): { ok: true; sessionId: string } | { ok: false; reason: string } {
  const sessionId = String(raw || '').trim();
  if (!sessionId) return { ok: false, reason: 'sessionId is required' };
  if (sessionId.length > 64) return { ok: false, reason: 'sessionId is too long' };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(sessionId)) {
    return { ok: false, reason: 'sessionId must match /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/' };
  }
  return { ok: true, sessionId };
}

function safeTruncate(text: string, maxChars: number): string {
  const limit = Math.max(1, Math.floor(maxChars));
  const value = String(text || '');
  return value.length <= limit ? value : value.slice(0, limit);
}

function getCwd(context: ToolContext): string {
  return context.workspaceRoot ? path.resolve(context.workspaceRoot) : process.cwd();
}

function resolveAgentBrowserCommand(context: ToolContext, options: AgentBrowserToolsOptions): string {
  const override = String(options.agentBrowserBin || process.env.AGENT_BROWSER_BIN || '').trim();
  if (override) return override;

  const binName = process.platform === 'win32' ? 'agent-browser.cmd' : 'agent-browser';
  const cwd = getCwd(context);
  const localBin = path.join(cwd, 'node_modules', '.bin', binName);
  if (fsSync.existsSync(localBin)) return localBin;
  return binName;
}

function shouldFallbackToPath(binPath: string): boolean {
  const normalized = String(binPath || '').trim();
  if (!normalized) return true;
  if (normalized === 'agent-browser' || normalized === 'agent-browser.cmd') return true;
  return false;
}

async function runAgentBrowserProcess(args: string[], options: { timeoutMs: number; cwd: string; bin: string }): Promise<AgentBrowserJson<unknown>> {
  const timeoutMs = Math.max(2_000, Math.floor(options.timeoutMs));
  const cmd = shouldFallbackToPath(options.bin) ? (process.platform === 'win32' ? 'agent-browser.cmd' : 'agent-browser') : options.bin;

  return await new Promise((resolve) => {
    const child = spawn(cmd, [...args, '--json'], {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ success: false, data: null, error: `agent-browser timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    timer.unref?.();

    child.on('error', (err) => {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      const hint =
        /ENOENT/i.test(message) || /not found/i.test(message)
          ? 'agent-browser not found. Install it (npm i -g agent-browser; agent-browser install) or set AGENT_BROWSER_BIN.'
          : message;
      resolve({ success: false, data: null, error: hint });
    });

    child.on('close', () => {
      clearTimeout(timer);
      const out = stdout.trim();
      const line = out
        .split(/\r?\n/g)
        .map((l) => l.trim())
        .find((l) => l.startsWith('{') && l.endsWith('}'));

      if (!line) {
        const message = (stderr || stdout || '').trim();
        resolve({ success: false, data: null, error: message || 'agent-browser returned no JSON output' });
        return;
      }

      try {
        resolve(JSON.parse(line) as AgentBrowserJson<unknown>);
      } catch (err) {
        resolve({
          success: false,
          data: null,
          error: `Failed to parse agent-browser JSON output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  });
}

function resolveArtifactsDir(context: ToolContext, dirName: string): string {
  const raw = String(dirName || '').trim() || '.kooka/agent-browser';
  if (context.workspaceRoot) {
    return path.resolve(context.workspaceRoot, raw);
  }
  const safe = raw.replace(/[\\/]/g, '-').replace(/[^\w.-]+/g, '-');
  return path.join(os.tmpdir(), safe || 'kooka-agent-browser');
}

function sanitizeArtifactName(input: string, fallbackExt: string): string {
  const raw = String(input || '').trim();
  const base = raw ? path.basename(raw) : '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  const safe = cleaned === '.' || cleaned === '..' ? '' : cleaned;
  const withExt = safe && path.extname(safe) ? safe : safe ? `${safe}${fallbackExt}` : '';
  if (withExt) return withExt;
  return `artifact-${Date.now().toString(36)}${fallbackExt}`;
}

async function resolveArtifactPath(params: {
  context: ToolContext;
  artifactsDir: string;
  name?: string;
  defaultExt: string;
}): Promise<{ absPath: string; displayPath: string }> {
  const dir = resolveArtifactsDir(params.context, params.artifactsDir);
  await fs.mkdir(dir, { recursive: true });
  const fileName = sanitizeArtifactName(params.name || '', params.defaultExt);
  const abs = path.resolve(dir, fileName);
  if (!isSubPath(abs, dir)) {
    throw new Error('Invalid artifact path (must be inside artifactsDir)');
  }
  const displayPath = redactFsPathForPrompt(abs, { workspaceRoot: params.context.workspaceRoot });
  return { absPath: abs, displayPath };
}

class BrowserSessionManager {
  private sessions = new Map<string, BrowserSessionEntry>();

  constructor(
    private readonly closeFn: (sessionId: string, context: ToolContext) => Promise<boolean>,
    private readonly defaultTtlMs: number
  ) {}

  get(sessionId: string): BrowserSessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  start(sessionId: string, ttlMs: number): BrowserSessionEntry {
    const now = Date.now();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return this.touch(existing, ttlMs, now);
    }

    const entry: BrowserSessionEntry = {
      sessionId,
      createdAt: now,
      lastUsedAt: now,
      ttlMs,
      expiresAt: now + ttlMs,
    };
    this.sessions.set(sessionId, entry);
    this.schedule(entry);
    return entry;
  }

  touch(entry: BrowserSessionEntry, ttlMs: number | undefined, now = Date.now()): BrowserSessionEntry {
    const effectiveTtl = ttlMs === undefined ? entry.ttlMs : ttlMs;
    entry.lastUsedAt = now;
    entry.ttlMs = effectiveTtl;
    entry.expiresAt = effectiveTtl > 0 ? now + effectiveTtl : now;
    this.schedule(entry);
    return entry;
  }

  private schedule(entry: BrowserSessionEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    if (!Number.isFinite(entry.ttlMs) || entry.ttlMs <= 0) {
      entry.timer = undefined;
      return;
    }

    const ttl = Math.max(0, Math.floor(entry.ttlMs));
    entry.timer = setTimeout(() => {
      void this.autoClose(entry.sessionId);
    }, ttl);
    entry.timer.unref?.();
  }

  private async autoClose(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    if (entry.closing) return;

    entry.closing = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    this.sessions.delete(sessionId);

    try {
      await this.closeFn(sessionId, { signal: AbortSignal.timeout?.(5_000) ?? new AbortController().signal, log: () => {} });
    } catch {
      // ignore
    }
  }

  async close(sessionId: string, context: ToolContext): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.closing = true;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      this.sessions.delete(sessionId);
    }
    return await this.closeFn(sessionId, context);
  }

  dispose(): void {
    for (const entry of this.sessions.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.sessions.clear();
  }

  ensure(sessionId: string, ttlMs?: number): BrowserSessionEntry {
    const ttl = ttlMs === undefined ? this.defaultTtlMs : ttlMs;
    const existing = this.sessions.get(sessionId);
    if (existing) return this.touch(existing, ttl);
    return this.start(sessionId, ttl);
  }
}

function redactActionForOutput(action: AgentBrowserRunAction): unknown {
  if (action.type === 'fill' || action.type === 'type') {
    return { ...action, text: `<redacted:${String((action as any).text || '').length} chars>` };
  }
  return action;
}

function toAgentBrowserArgsForAction(params: {
  action: AgentBrowserRunAction;
  allowHttp: boolean;
  allowPrivateHosts: boolean;
  maxTextChars: number;
  context: ToolContext;
  artifactsDir: string;
}): Promise<{ args: string[]; artifact?: { kind: string; path: string } }> {
  const action = params.action;

  switch (action.type) {
    case 'open': {
      const validated = validatePublicUrl(action.url, { allowHttp: params.allowHttp, allowPrivateHosts: params.allowPrivateHosts });
      if (!validated.ok) {
        return Promise.reject(new Error(`browser_run rejected url: ${validated.reason}`));
      }
      return Promise.resolve({ args: ['open', validated.url.toString()] });
    }
    case 'back':
      return Promise.resolve({ args: ['back'] });
    case 'forward':
      return Promise.resolve({ args: ['forward'] });
    case 'reload':
      return Promise.resolve({ args: ['reload'] });
    case 'click':
      return Promise.resolve({ args: ['click', String(action.selector || '').trim()] });
    case 'dblclick':
      return Promise.resolve({ args: ['dblclick', String(action.selector || '').trim()] });
    case 'focus':
      return Promise.resolve({ args: ['focus', String(action.selector || '').trim()] });
    case 'hover':
      return Promise.resolve({ args: ['hover', String(action.selector || '').trim()] });
    case 'fill':
      return Promise.resolve({ args: ['fill', String(action.selector || '').trim(), String(action.text ?? '')] });
    case 'type':
      return Promise.resolve({ args: ['type', String(action.selector || '').trim(), String(action.text ?? '')] });
    case 'press':
      return Promise.resolve({ args: ['press', String(action.key || '').trim()] });
    case 'select':
      return Promise.resolve({ args: ['select', String(action.selector || '').trim(), String(action.value ?? '')] });
    case 'check':
      return Promise.resolve({ args: ['check', String(action.selector || '').trim()] });
    case 'uncheck':
      return Promise.resolve({ args: ['uncheck', String(action.selector || '').trim()] });
    case 'scroll': {
      const dir = String(action.direction || '').trim().toLowerCase();
      if (!['up', 'down', 'left', 'right'].includes(dir)) {
        return Promise.reject(new Error('scroll.direction must be up|down|left|right'));
      }
      const px = action.px === undefined ? undefined : clampInt(action.px, 1, 10_000);
      return Promise.resolve({ args: px ? ['scroll', dir, String(px)] : ['scroll', dir] });
    }
    case 'scrollIntoView':
      return Promise.resolve({ args: ['scrollintoview', String(action.selector || '').trim()] });
    case 'wait': {
      const ms = action.ms === undefined ? undefined : clampInt(action.ms, 1, 300_000);
      const selector = action.selector ? String(action.selector).trim() : '';
      const text = action.text ? String(action.text).trim() : '';
      const url = action.url ? String(action.url).trim() : '';
      const load = action.load ? String(action.load).trim() : '';
      const fn = action.fn ? String(action.fn).trim() : '';

      const configured = [ms !== undefined, !!selector, !!text, !!url, !!load, !!fn].filter(Boolean).length;
      if (configured !== 1) {
        return Promise.reject(new Error('wait action must specify exactly one of: ms, selector, text, url, load, fn'));
      }

      if (ms !== undefined) return Promise.resolve({ args: ['wait', String(ms)] });
      if (selector) return Promise.resolve({ args: ['wait', selector] });
      if (text) return Promise.resolve({ args: ['wait', '--text', text] });
      if (url) return Promise.resolve({ args: ['wait', '--url', url] });
      if (load) return Promise.resolve({ args: ['wait', '--load', load] });
      return Promise.resolve({ args: ['wait', '--fn', fn] });
    }
    case 'get': {
      const kind = String(action.kind || '').trim().toLowerCase();

      if (kind === 'title') return Promise.resolve({ args: ['get', 'title'] });
      if (kind === 'url') return Promise.resolve({ args: ['get', 'url'] });

      const selector = String(action.selector || '').trim();
      if (!selector) return Promise.reject(new Error('get action requires selector for kind text/html/value/attr'));

      if (kind === 'text') return Promise.resolve({ args: ['get', 'text', selector], artifact: undefined });
      if (kind === 'html') return Promise.resolve({ args: ['get', 'html', selector], artifact: undefined });
      if (kind === 'value') return Promise.resolve({ args: ['get', 'value', selector], artifact: undefined });
      if (kind === 'attr') {
        const attr = String(action.attr || '').trim();
        if (!attr) return Promise.reject(new Error('get.kind=attr requires attr'));
        return Promise.resolve({ args: ['get', 'attr', selector, attr], artifact: undefined });
      }

      return Promise.reject(new Error(`Unknown get.kind: ${kind}`));
    }
    case 'screenshot': {
      return resolveArtifactPath({
        context: params.context,
        artifactsDir: params.artifactsDir,
        name: action.name,
        defaultExt: '.png',
      }).then(({ absPath, displayPath }) => ({
        args: action.fullPage ? ['screenshot', absPath, '--full'] : ['screenshot', absPath],
        artifact: { kind: 'screenshot', path: displayPath },
      }));
    }
    case 'pdf': {
      return resolveArtifactPath({
        context: params.context,
        artifactsDir: params.artifactsDir,
        name: action.name,
        defaultExt: '.pdf',
      }).then(({ absPath, displayPath }) => ({
        args: ['pdf', absPath],
        artifact: { kind: 'pdf', path: displayPath },
      }));
    }
    case 'traceStart': {
      return resolveArtifactPath({
        context: params.context,
        artifactsDir: params.artifactsDir,
        name: action.name,
        defaultExt: '.zip',
      }).then(({ absPath, displayPath }) => ({
        args: ['trace', 'start', absPath],
        artifact: { kind: 'trace', path: displayPath },
      }));
    }
    case 'traceStop': {
      return resolveArtifactPath({
        context: params.context,
        artifactsDir: params.artifactsDir,
        name: action.name,
        defaultExt: '.zip',
      }).then(({ absPath, displayPath }) => ({
        args: ['trace', 'stop', absPath],
        artifact: { kind: 'trace', path: displayPath },
      }));
    }
    default:
      return Promise.reject(new Error(`Unsupported action type: ${(action as any).type}`));
  }
}

function parseActions(args: Record<string, unknown>): { ok: true; actions: AgentBrowserRunAction[] } | { ok: false; error: string } {
  const raw = args.actions;
  if (!Array.isArray(raw)) return { ok: false, error: 'actions is required and must be an array' };
  const actions: AgentBrowserRunAction[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'actions items must be objects' };
    const actionType = String((item as any).type || '').trim();
    if (!actionType) return { ok: false, error: 'actions[].type is required' };
    actions.push(item as AgentBrowserRunAction);
  }

  return { ok: true, actions };
}

export class AgentBrowserToolProvider implements ToolProvider {
  readonly id = 'agent-browser';
  readonly name = 'Agent Browser';

  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly maxSnapshotChars: number;
  private readonly maxTextChars: number;
  private readonly artifactsDir: string;
  private readonly allowHttp: boolean;
  private readonly allowPrivateHosts: boolean;

  private readonly runner: AgentBrowserRunner;
  private readonly sessions: BrowserSessionManager;

  private readonly startSessionTool: ToolDefinition;
  private readonly closeSessionTool: ToolDefinition;
  private readonly snapshotTool: ToolDefinition;
  private readonly runTool: ToolDefinition;

  constructor(private readonly options: AgentBrowserToolsOptions = {}) {
    this.enabled = options.enabled !== false;
    this.timeoutMs = clampInt(options.timeoutMs ?? 30_000, 2_000, 180_000);
    this.maxSnapshotChars = clampInt(options.maxSnapshotChars ?? 25_000, 1, 200_000);
    this.maxTextChars = clampInt(options.maxTextChars ?? 20_000, 1, 200_000);
    this.artifactsDir = String(options.artifactsDir || '.kooka/agent-browser').trim() || '.kooka/agent-browser';
    this.allowHttp = !!options.allowHttp;
    this.allowPrivateHosts = !!options.allowPrivateHosts;

    this.runner =
      options.runner ??
      (async (args, execOptions) => {
        return await runAgentBrowserProcess(args, { timeoutMs: execOptions.timeoutMs, cwd: execOptions.cwd, bin: execOptions.bin });
      });

    const defaultTtlMs = clampInt(options.defaultTtlMs ?? 10 * 60_000, 1_000, 24 * 60 * 60_000);
    this.sessions = new BrowserSessionManager(async (sessionId, ctx) => {
      const cwd = getCwd(ctx);
      const bin = resolveAgentBrowserCommand(ctx, options);
      const res = await this.runner(['--session', sessionId, 'close'], { timeoutMs: this.timeoutMs, cwd, bin });
      return !!res.success;
    }, defaultTtlMs);

    this.startSessionTool = {
      id: 'browser_start_session',
      name: 'Browser: Start Session',
      description:
        'Start (or reuse) an isolated browser session for multi-step browser work. ' +
        'Use browser_snapshot to inspect the page and get stable refs (@e1). Sessions auto-close after a TTL.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Optional session id (letters/numbers/._-). Omit to auto-generate.' },
          ttlMs: { type: 'number', description: 'Time-to-live in ms before auto-close (default from host config)' },
        },
      },
      execution: { type: 'function', handler: 'browser.startSession' },
      metadata: { requiresApproval: false, permission: 'read', readOnly: true },
    };

    this.closeSessionTool = {
      id: 'browser_close_session',
      name: 'Browser: Close Session',
      description: 'Close a browser session and release resources.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session id returned by browser_start_session' },
        },
        required: ['sessionId'],
      },
      execution: { type: 'function', handler: 'browser.closeSession' },
      metadata: { requiresApproval: false, permission: 'read', readOnly: true },
    };

    this.snapshotTool = {
      id: 'browser_snapshot',
      name: 'Browser: Snapshot',
      description:
        'Open (optional) and snapshot the current page into an accessibility tree with stable refs (use @eN selectors). ' +
        'Prefer this over raw HTML scraping.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session id (use browser_start_session first)' },
          url: { type: 'string', description: 'Optional URL to open before snapshot (defaults to current page)' },
          interactive: { type: 'boolean', description: 'Only interactive elements (default true)' },
          compact: { type: 'boolean', description: 'Remove empty structural elements (default true)' },
          depth: { type: 'number', description: 'Max snapshot depth (default 6; max 20)' },
          selector: { type: 'string', description: 'Optional CSS selector to scope snapshot (e.g. #main)' },
          maxChars: { type: 'number', description: 'Max characters to return (default from host config)' },
          timeoutMs: { type: 'number', description: 'Command timeout in ms (default from host config)' },
        },
        required: ['sessionId'],
      },
      execution: { type: 'function', handler: 'browser.snapshot' },
      metadata: { requiresApproval: false, permission: 'read', readOnly: true },
    };

    this.runTool = {
      id: 'browser_run',
      name: 'Browser: Run Actions',
      description:
        'Run a sequence of browser actions in a session (click/fill/type/press/wait/get/etc). ' +
        'Use refs from browser_snapshot when possible (e.g. selector "@e2"). ' +
        'This tool can take screenshots / PDFs / traces into a local artifacts directory.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session id (use browser_start_session first)' },
          actions: {
            type: 'array',
            description: 'Action list to execute sequentially',
            items: { type: 'object', description: 'Action object; see tool description for supported types' },
          },
          timeoutMs: { type: 'number', description: 'Per-action timeout in ms (default from host config)' },
          failFast: { type: 'boolean', description: 'Stop at first failure (default true)' },
        },
        required: ['sessionId', 'actions'],
      },
      execution: { type: 'function', handler: 'browser.run' },
      metadata: { requiresApproval: true, permission: 'write', readOnly: false },
    };
  }

  getTools(): ToolDefinition[] {
    return [this.startSessionTool, this.closeSessionTool, this.snapshotTool, this.runTool];
  }

  dispose(): void {
    this.sessions.dispose();
  }

  async executeTool(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (!this.enabled) return { success: false, error: 'Browser tools are disabled.' };

    switch (toolId) {
      case 'browser_start_session':
        return await this.handleStartSession(args);
      case 'browser_close_session':
        return await this.handleCloseSession(args, context);
      case 'browser_snapshot':
        return await this.handleSnapshot(args, context);
      case 'browser_run':
        return await this.handleRun(args, context);
      default:
        return { success: false, error: `Unknown browser tool: ${toolId}` };
    }
  }

  private async handleStartSession(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionInput = optionalString(args, 'sessionId');
    const sessionIdRaw = sessionInput && sessionInput.trim() ? sessionInput.trim() : `browser_${crypto.randomUUID().slice(0, 12)}`;

    const sessionRes = validateSessionId(sessionIdRaw);
    if (!sessionRes.ok) return { success: false, error: sessionRes.reason };

    const ttlMsRaw = optionalNumber(args, 'ttlMs');
    const ttlMs = ttlMsRaw === undefined ? undefined : clampInt(ttlMsRaw, 1_000, 24 * 60 * 60_000);

    const entry = this.sessions.ensure(sessionRes.sessionId, ttlMs);
    return {
      success: true,
      data: {
        sessionId: entry.sessionId,
        ttlMs: entry.ttlMs,
        expiresAt: entry.expiresAt,
      },
    };
  }

  private async handleCloseSession(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const sessionResult = requireString(args, 'sessionId');
    if ('error' in sessionResult) return { success: false, error: sessionResult.error };

    const sessionRes = validateSessionId(sessionResult.value);
    if (!sessionRes.ok) return { success: false, error: sessionRes.reason };

    const closed = await this.sessions.close(sessionRes.sessionId, context);
    return { success: true, data: { sessionId: sessionRes.sessionId, closed } };
  }

  private async handleSnapshot(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const sessionResult = requireString(args, 'sessionId');
    if ('error' in sessionResult) return { success: false, error: sessionResult.error };

    const sessionRes = validateSessionId(sessionResult.value);
    if (!sessionRes.ok) return { success: false, error: sessionRes.reason };

    const ttlMsRaw = optionalNumber(args, 'ttlMs');
    const ttlMs = ttlMsRaw === undefined ? undefined : clampInt(ttlMsRaw, 1_000, 24 * 60 * 60_000);
    this.sessions.ensure(sessionRes.sessionId, ttlMs);

    const timeoutMs = clampInt(optionalNumber(args, 'timeoutMs') ?? this.timeoutMs, 2_000, 180_000);
    const maxChars = clampInt(optionalNumber(args, 'maxChars') ?? this.maxSnapshotChars, 1, this.maxSnapshotChars);

    const urlRaw = optionalString(args, 'url');
    const cwd = getCwd(context);
    const bin = resolveAgentBrowserCommand(context, this.options);

    let openInfo: Record<string, unknown> | undefined;
    if (urlRaw && urlRaw.trim()) {
      const validated = validatePublicUrl(urlRaw, { allowHttp: this.allowHttp, allowPrivateHosts: this.allowPrivateHosts });
      if (!validated.ok) return { success: false, error: `browser_snapshot rejected url: ${validated.reason}` };

      const opened = await this.runner(['--session', sessionRes.sessionId, 'open', validated.url.toString()], { timeoutMs, cwd, bin });
      if (!opened.success) return { success: false, error: opened.error || 'agent-browser open failed' };
      if (opened.data && typeof opened.data === 'object') {
        openInfo = opened.data as Record<string, unknown>;
      }
    }

    const interactive = optionalBoolean(args, 'interactive', true) ?? true;
    const compact = optionalBoolean(args, 'compact', true) ?? true;
    const depth = clampInt(optionalNumber(args, 'depth') ?? 6, 1, 20);
    const selector = optionalString(args, 'selector');

    const snapArgs: string[] = ['--session', sessionRes.sessionId, 'snapshot'];
    if (interactive) snapArgs.push('-i');
    if (compact) snapArgs.push('-c');
    if (depth) snapArgs.push('-d', String(depth));
    if (selector && selector.trim()) snapArgs.push('-s', selector.trim());

    const snap = await this.runner(snapArgs, { timeoutMs, cwd, bin });
    if (!snap.success) return { success: false, error: snap.error || 'agent-browser snapshot failed' };

    const data = snap.data && typeof snap.data === 'object' ? (snap.data as any) : {};
    const snapshot = safeTruncate(typeof data.snapshot === 'string' ? data.snapshot : '', maxChars);
    const refCount = data.refs && typeof data.refs === 'object' ? Object.keys(data.refs).length : 0;

    return {
      success: true,
      data: {
        sessionId: sessionRes.sessionId,
        url: typeof openInfo?.url === 'string' ? openInfo.url : undefined,
        title: typeof openInfo?.title === 'string' ? openInfo.title : undefined,
        snapshot,
        refCount,
      },
    };
  }

  private async handleRun(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const sessionResult = requireString(args, 'sessionId');
    if ('error' in sessionResult) return { success: false, error: sessionResult.error };

    const sessionRes = validateSessionId(sessionResult.value);
    if (!sessionRes.ok) return { success: false, error: sessionRes.reason };

    const ttlMsRaw = optionalNumber(args, 'ttlMs');
    const ttlMs = ttlMsRaw === undefined ? undefined : clampInt(ttlMsRaw, 1_000, 24 * 60 * 60_000);
    this.sessions.ensure(sessionRes.sessionId, ttlMs);

    const actionsRes = parseActions(args);
    if (!actionsRes.ok) return { success: false, error: actionsRes.error };

    const timeoutMs = clampInt(optionalNumber(args, 'timeoutMs') ?? this.timeoutMs, 2_000, 180_000);
    const failFast = optionalBoolean(args, 'failFast', true) ?? true;

    const cwd = getCwd(context);
    const bin = resolveAgentBrowserCommand(context, this.options);
    const artifacts: Array<{ kind: string; path: string }> = [];
    const results: Array<{
      index: number;
      action: unknown;
      success: boolean;
      error?: string;
      data?: unknown;
    }> = [];

    for (let i = 0; i < actionsRes.actions.length; i++) {
      const action = actionsRes.actions[i]!;
      let mapped: { args: string[]; artifact?: { kind: string; path: string } };
      try {
        mapped = await toAgentBrowserArgsForAction({
          action,
          allowHttp: this.allowHttp,
          allowPrivateHosts: this.allowPrivateHosts,
          maxTextChars: this.maxTextChars,
          context,
          artifactsDir: this.artifactsDir,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ index: i, action: redactActionForOutput(action), success: false, error: message });
        if (failFast) break;
        continue;
      }

      if (mapped.artifact) artifacts.push(mapped.artifact);

      const runArgs = ['--session', sessionRes.sessionId, ...mapped.args];
      const res = await this.runner(runArgs, { timeoutMs, cwd, bin });

      const step: { index: number; action: unknown; success: boolean; error?: string; data?: unknown } = {
        index: i,
        action: redactActionForOutput(action),
        success: !!res.success,
      };

      if (!res.success) {
        step.error = res.error || 'agent-browser command failed';
        results.push(step);
        if (failFast) break;
        continue;
      }

      const maxChars = this.maxTextChars;
      if (action.type === 'get' && action.kind === 'text') {
        const text = typeof (res.data as any)?.text === 'string' ? (res.data as any).text : typeof (res.data as any)?.result === 'string' ? (res.data as any).result : '';
        step.data = { ...((res.data as any) || {}), text: safeTruncate(text, clampInt(action.maxChars ?? maxChars, 1, maxChars)) };
      } else if (action.type === 'get' && action.kind === 'html') {
        const html = typeof (res.data as any)?.html === 'string' ? (res.data as any).html : '';
        step.data = { ...((res.data as any) || {}), html: safeTruncate(html, clampInt(action.maxChars ?? maxChars, 1, maxChars)) };
      } else {
        step.data = res.data ?? undefined;
      }

      results.push(step);
    }

    return { success: true, data: { sessionId: sessionRes.sessionId, artifacts, results } };
  }
}

export function createAgentBrowserToolProvider(options: AgentBrowserToolsOptions = {}): AgentBrowserToolProvider {
  return new AgentBrowserToolProvider(options);
}

export function registerAgentBrowserTools(registry: ToolRegistry, options: AgentBrowserToolsOptions = {}): Disposable {
  const provider = createAgentBrowserToolProvider(options);
  return registry.registerProvider(provider);
}
