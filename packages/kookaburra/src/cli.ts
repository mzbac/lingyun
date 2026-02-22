import * as fs from 'fs';
import * as http from 'node:http';
import * as path from 'path';
import { createInterface } from 'readline/promises';

import { createAgent, AgentSession } from '@kooka/agent-sdk';
import type { AgentCallbacks, Agent, LLMProvider, ToolCall, ToolDefinition } from '@kooka/agent-sdk';

import { ApprovalManager } from './approvals.js';
import { findDefaultConfigPath, loadKookaburraConfig, type PartialDeep, type KookaburraConfig } from './config.js';
import {
  addCronJob,
  listCronJobs,
  markCronJobRunResult,
  parseDelayMs,
  removeCronJob,
  resolveCronJobsFile,
  updateCronJob,
  type CronSchedule,
  type CronStore,
} from './cron.js';
import { renderWorkspaceIdentitySystemParts } from './identity.js';
import { clearSessions, listSessions, loadSession, resolveSessionsDir, saveSession, type SessionStore } from './sessions.js';
import { redactSensitive, truncateForDisplay } from './redact.js';

type ParsedArgs = {
  help?: boolean;
  command?: string;
  subcommand?: string;
  positionals?: string[];
  workspace?: string;
  config?: string;
  force?: boolean;
  session?: string;
  message?: string;
  host?: string;
  port?: number;
  baseURL?: string;
  model?: string;
  plugin?: string[];
  pluginsAutoDiscover?: boolean;
  pluginsDir?: string;
  autonomy?: 'read_only' | 'supervised' | 'full';
  mode?: 'build' | 'plan';
  allowExternalPaths?: boolean;
  autoApprove?: boolean;
  toolTimeoutMs?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  temperature?: number;
  save?: boolean;

  // Cron flags
  tz?: string;
  name?: string;
  disabled?: boolean;
};

function printHelp(): void {
  const text = `
kookaburra

Kookaburra is the agent orchestration layer for agentic workflows — infrastructure that abstracts models, tools, memory, and execution so agents can be built once and run anywhere.

Usage:
  kookaburra onboard
  kookaburra agent [--message "<text>"] [--session <id>]
  kookaburra daemon [--host <host>] [--port <port>]
  kookaburra cron <cmd> [args]
  kookaburra sessions list
  kookaburra sessions clear

Workspace identity files (optional):
  If present in the workspace root, these are appended to the system prompt:
  IDENTITY.md, SOUL.md, USER.md, AGENTS.md

Global flags:
  --workspace <path>   Workspace root (default: INIT_CWD or cwd)
  --config <path>      Config path (default: .kookaburra/runtime.json)

Onboard flags:
  --force              Overwrite existing files (config + identity files)

Agent / daemon flags:
  --autonomy <level>   read_only|supervised|full (default: supervised)
  --model <id>         Override model id (or set KOOKABURRA_MODEL)
  --base-url <url>     Override OpenAI-compatible baseURL (or set KOOKABURRA_BASE_URL)
  --plugin <spec>      Load a plugin module or file path (repeatable)
  --plugins-auto-discover
  --plugins-dir <name> Workspace runtime dir name for auto-discovery (default: .kookaburra)
  --allow-external-paths
  --workspace-only
  --temperature <n>
  --no-save

Cron commands:
  kookaburra cron list
  kookaburra cron show <id>
  kookaburra cron add "<5-part expr>" "<message>" [--tz <tz>] [--name <name>] [--session <id>] [--disabled] [--no-save]
  kookaburra cron every <delay> "<message>" [--name <name>] [--session <id>] [--disabled] [--no-save]
  kookaburra cron at "<iso>" "<message>" [--name <name>] [--session <id>] [--disabled] [--no-save]
  kookaburra cron once <delay> "<message>" [--name <name>] [--session <id>] [--disabled] [--no-save]
  kookaburra cron pause <id>
  kookaburra cron resume <id>
  kookaburra cron remove <id>

Cron notes:
  - Cron schedules are 5-part (min hour dom mon dow). Example: "*/5 * * * *"
  - Time zone is optional (IANA name). Example: "America/Los_Angeles"
  - The daemon runs cron jobs automatically when config.cron.enabled=true.
`;

  process.stderr.write(text.trim() + '\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { save: true };
  const args = [...argv];
  while (args[0] === '--') args.shift();

  const positionals: string[] = [];

  const takeValue = (i: number): { value?: string; nextIndex: number } => {
    const token = args[i];
    if (!token) return { nextIndex: i };
    if (token.includes('=')) {
      const [, v] = token.split(/=(.*)/s);
      return { value: v, nextIndex: i };
    }
    const v = args[i + 1];
    return { value: v, nextIndex: i + 1 };
  };

  for (let i = 0; i < args.length; i++) {
    const token = args[i] || '';
    if (token === '-h' || token === '--help') {
      out.help = true;
      continue;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.replace(/^--/, '');

    if (key === 'no-save') {
      out.save = false;
      continue;
    }

    if (key === 'allow-external-paths') {
      out.allowExternalPaths = true;
      continue;
    }

    if (key === 'force') {
      out.force = true;
      continue;
    }

    if (key === 'workspace-only') {
      out.allowExternalPaths = false;
      continue;
    }

    if (key === 'auto-approve') {
      out.autoApprove = true;
      continue;
    }

    if (key === 'plugins-auto-discover') {
      out.pluginsAutoDiscover = true;
      continue;
    }

    if (key === 'disabled') {
      out.disabled = true;
      continue;
    }

    const { value, nextIndex } = takeValue(i);
    i = nextIndex;

    switch (key.split('=')[0]) {
      case 'workspace':
        out.workspace = value;
        break;
      case 'config':
        out.config = value;
        break;
      case 'session':
        out.session = value;
        break;
      case 'message':
        out.message = value;
        break;
      case 'host':
        out.host = value;
        break;
      case 'port': {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) out.port = Math.floor(n);
        break;
      }
      case 'model':
        out.model = value;
        break;
      case 'plugin': {
        const spec = String(value || '').trim();
        if (spec) {
          out.plugin = out.plugin ?? [];
          out.plugin.push(spec);
        }
        break;
      }
      case 'plugins-dir':
        out.pluginsDir = value;
        break;
      case 'base-url':
        out.baseURL = value;
        break;
      case 'autonomy': {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'read_only' || raw === 'read-only' || raw === 'readonly') {
          out.autonomy = 'read_only';
          out.mode = 'plan';
          out.autoApprove = false;
        } else if (raw === 'supervised' || raw === 'supervise') {
          out.autonomy = 'supervised';
          out.mode = 'build';
          out.autoApprove = false;
        } else if (raw === 'full') {
          out.autonomy = 'full';
          out.mode = 'build';
          out.autoApprove = true;
        } else {
          out.help = true;
        }
        break;
      }
      case 'mode':
        out.mode = value === 'plan' ? 'plan' : 'build';
        break;
      case 'tool-timeout-ms': {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) out.toolTimeoutMs = Math.floor(n);
        break;
      }
      case 'max-output-tokens': {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) out.maxOutputTokens = Math.floor(n);
        break;
      }
      case 'max-retries': {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) out.maxRetries = Math.floor(n);
        break;
      }
      case 'temperature': {
        const n = Number(value);
        if (Number.isFinite(n)) out.temperature = n;
        break;
      }
      case 'tz':
        out.tz = value;
        break;
      case 'name':
        out.name = value;
        break;
      default:
        break;
    }
  }

  out.positionals = positionals;

  if (!out.command && positionals.length > 0) {
    out.command = positionals[0];
  }
  if (out.command === 'sessions' && !out.subcommand && positionals.length > 1) {
    out.subcommand = positionals[1];
  }
  if (out.command === 'cron' && !out.subcommand && positionals.length > 1) {
    out.subcommand = positionals[1];
  }

  return out;
}

function buildCliConfigFromArgs(args: ParsedArgs): PartialDeep<KookaburraConfig> {
  return {
    llm: {
      ...(args.baseURL ? { baseURL: args.baseURL } : {}),
      ...(args.model ? { model: args.model } : {}),
    },
    agent: {
      ...(args.mode ? { mode: args.mode } : {}),
      ...(typeof args.temperature === 'number' ? { temperature: args.temperature } : {}),
      ...(typeof args.maxRetries === 'number' ? { maxRetries: args.maxRetries } : {}),
      ...(typeof args.maxOutputTokens === 'number' ? { maxOutputTokens: args.maxOutputTokens } : {}),
      ...(typeof args.autoApprove === 'boolean' ? { autoApprove: args.autoApprove } : {}),
      ...(typeof args.toolTimeoutMs === 'number' ? { toolTimeoutMs: args.toolTimeoutMs } : {}),
    },
    plugins: {
      ...(Array.isArray(args.plugin) && args.plugin.length > 0 ? { modules: args.plugin } : {}),
      ...(typeof args.pluginsAutoDiscover === 'boolean' ? { autoDiscover: args.pluginsAutoDiscover } : {}),
      ...(args.pluginsDir ? { workspaceDirName: args.pluginsDir } : {}),
    },
    security: {
      ...(typeof args.allowExternalPaths === 'boolean' ? { allowExternalPaths: args.allowExternalPaths } : {}),
    },
    ...(args.session ? { sessionId: args.session } : {}),
  };
}

function getSessionsDirSetting(options: { workspaceRoot: string; configPath?: string }): string {
  const fallback = path.join('.kookaburra', 'sessions');

  const configPath = (() => {
    if (options.configPath) {
      return path.isAbsolute(options.configPath)
        ? options.configPath
        : path.join(options.workspaceRoot, options.configPath);
    }
    return findDefaultConfigPath(options.workspaceRoot);
  })();

  if (!configPath) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err: any) {
    throw new Error(`Failed to read config JSON from ${configPath}: ${err?.message || String(err)}`);
  }

  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : {};
  const persistence = obj.persistence && typeof obj.persistence === 'object' && !Array.isArray(obj.persistence) ? obj.persistence : {};
  const sessionsDir = typeof persistence.sessionsDir === 'string' ? persistence.sessionsDir.trim() : '';
  return sessionsDir || fallback;
}

function getCronJobsFileSetting(options: { workspaceRoot: string; configPath?: string }): string {
  const fallback = path.join('.kookaburra', 'cron', 'jobs.json');

  const configPath = (() => {
    if (options.configPath) {
      return path.isAbsolute(options.configPath)
        ? options.configPath
        : path.join(options.workspaceRoot, options.configPath);
    }
    return findDefaultConfigPath(options.workspaceRoot);
  })();

  if (!configPath) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err: any) {
    throw new Error(`Failed to read config JSON from ${configPath}: ${err?.message || String(err)}`);
  }

  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : {};
  const cron = obj.cron && typeof obj.cron === 'object' && !Array.isArray(obj.cron) ? obj.cron : {};
  const jobsFile = typeof cron.jobsFile === 'string' ? cron.jobsFile.trim() : '';
  return jobsFile || fallback;
}

function createRuntimeAgent(options: {
  config: KookaburraConfig;
  workspaceRoot: string;
}): { agent: Agent; llm: LLMProvider } {
  const { agent, llm, plugins } = createAgent({
    llm: {
      provider: 'openaiCompatible',
      baseURL: options.config.llm.baseURL,
      apiKey: options.config.llm.apiKey,
      model: options.config.llm.model,
      timeoutMs: options.config.llm.timeoutMs,
    },
    agent: {
      mode: options.config.agent.mode,
      temperature: options.config.agent.temperature,
      maxRetries: options.config.agent.maxRetries,
      maxOutputTokens: options.config.agent.maxOutputTokens,
      autoApprove: options.config.agent.autoApprove,
    },
    workspaceRoot: options.workspaceRoot,
    allowExternalPaths: options.config.security.allowExternalPaths,
    toolTimeoutMs: options.config.agent.toolTimeoutMs,
    plugins: {
      ...(options.config.plugins ?? {}),
      logger: (message) => {
        process.stderr.write(`[plugin] ${truncateForDisplay(redactSensitive(message), 1000)}\n`);
      },
    },
  });

  const identityParts = renderWorkspaceIdentitySystemParts(options.workspaceRoot, { maxBytesPerFile: 128 * 1024 });
  if (identityParts.length > 0) {
    plugins.registerHooks('kookaburra.identity', {
      'experimental.chat.system.transform': async (_input, output) => {
        const insertAt = Math.min(1, Array.isArray(output.system) ? output.system.length : 0);
        output.system.splice(insertAt, 0, ...identityParts);
      },
    });
  }

  return { agent, llm };
}

function createAgentCallbacks(approvals: ApprovalManager): AgentCallbacks {
  return {
    onRequestApproval: async (tc: ToolCall, def: ToolDefinition) => {
      return await approvals.requestApproval(tc, def);
    },
    onToolCall: (_tc, def) => {
      process.stderr.write(`[tool] ${def.id} (approval may be required)\n`);
    },
    onToolResult: (tc, result) => {
      const status = result.success ? 'ok' : 'error';
      const message = result.success ? '' : ` ${truncateForDisplay(redactSensitive(result.error || ''), 200)}`;
      process.stderr.write(`[tool] ${tc.function.name} ${status}${message}\n`);
    },
    onToolBlocked: (_tc, def, reason) => {
      process.stderr.write(`[tool] ${def.id} blocked: ${truncateForDisplay(redactSensitive(reason), 200)}\n`);
    },
    onNotice: (notice) => {
      process.stderr.write(`[notice] ${notice.level}: ${truncateForDisplay(redactSensitive(notice.message), 500)}\n`);
    },
  };
}

async function runTurn(options: {
  agent: Agent;
  session: AgentSession;
  input: string;
  callbacks: AgentCallbacks;
  signal?: AbortSignal;
}): Promise<void> {
  const run = options.agent.run({
    session: options.session,
    input: options.input,
    callbacks: options.callbacks,
    signal: options.signal,
  });

  const drain = (async () => {
    for await (const ev of run.events) {
      if (ev.type === 'assistant_token') {
        process.stdout.write(ev.token);
      }
    }
  })();

  await run.done;
  await drain;
  process.stdout.write('\n');
}

async function runTurnToString(options: {
  agent: Agent;
  session: AgentSession;
  input: string;
  callbacks: AgentCallbacks;
  signal?: AbortSignal;
}): Promise<string> {
  const run = options.agent.run({
    session: options.session,
    input: options.input,
    callbacks: options.callbacks,
    signal: options.signal,
  });

  let text = '';
  const drain = (async () => {
    for await (const ev of run.events) {
      if (ev.type === 'assistant_token') {
        text += ev.token;
      }
    }
  })();

  await run.done;
  await drain;
  return text.trimEnd();
}

async function runInteractiveAgent(options: {
  config: KookaburraConfig;
  agent: Agent;
  store: SessionStore;
  initialSessionId: string;
  rl: ReturnType<typeof createInterface>;
  approvals: ApprovalManager;
  save: boolean;
}): Promise<void> {
  let sessionId = options.initialSessionId;
  let session = (await loadSession(options.store, sessionId)) ?? new AgentSession({ sessionId });

  process.stderr.write(`Session: ${sessionId}\n`);
  process.stderr.write(`Mode: ${options.config.agent.mode}\n`);
  process.stderr.write('Type /help for commands.\n\n');

  while (true) {
    const line = (await options.rl.question('> ')).trim();
    if (!line) continue;

    if (line === '/exit' || line === '/quit') return;
    if (line === '/help') {
      process.stderr.write(
        [
          '',
          'Commands:',
          '  /help               Show this help',
          '  /exit               Quit',
          '  /clear              Clear history for current session',
          '  /session <id>        Switch sessions (loads from disk if present)',
          '',
        ].join('\n') + '\n'
      );
      continue;
    }

    if (line === '/clear') {
      session.history = [];
      session.pendingPlan = undefined;
      session.mentionedSkills = [];
      if (options.save) {
        await saveSession(options.store, session, { sessionId });
      }
      process.stderr.write('Cleared.\n');
      continue;
    }

    if (line.startsWith('/session ')) {
      const next = line.replace(/^\/session\s+/, '').trim();
      if (!next) {
        process.stderr.write('Usage: /session <id>\n');
        continue;
      }

      if (options.save) {
        await saveSession(options.store, session, { sessionId });
      }

      sessionId = next;
      session = (await loadSession(options.store, sessionId)) ?? new AgentSession({ sessionId });
      process.stderr.write(`Session: ${sessionId}\n`);
      continue;
    }

    const abortController = new AbortController();
    const onSigint = () => abortController.abort();
    process.once('SIGINT', onSigint);
    try {
      const callbacks = createAgentCallbacks(options.approvals);
      await runTurn({
        agent: options.agent,
        session,
        input: line,
        callbacks,
        signal: abortController.signal,
      });
      if (options.save) {
        await saveSession(options.store, session, { sessionId });
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
    }
  }
}

class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const wait = prev.catch(() => undefined);

    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = wait.then(() => current);
    this.tails.set(key, tail);

    await wait;
    try {
      return await fn();
    } finally {
      release?.();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}

async function readJsonBody(req: http.IncomingMessage, options?: { maxBytes?: number }): Promise<any> {
  const maxBytes = typeof options?.maxBytes === 'number' && options.maxBytes > 0 ? Math.floor(options.maxBytes) : 1024 * 1024;

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Request body too large (limit ${maxBytes} bytes)`);
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body ?? {});
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(json);
}

async function runDaemon(options: {
  host: string;
  port: number;
  defaultSave: boolean;
  config: KookaburraConfig;
  workspaceRoot: string;
  store: SessionStore;
  approvals: ApprovalManager;
}): Promise<void> {
  const { agent, llm } = createRuntimeAgent({ config: options.config, workspaceRoot: options.workspaceRoot });
  const callbacks = createAgentCallbacks(options.approvals);
  const locks = new KeyedMutex();

  const cron = (() => {
    if (!options.config.cron.enabled) return undefined;

    const pollMs = Math.max(1000, Math.floor(options.config.cron.pollMs));
    const maxConcurrent = Math.max(1, Math.floor(options.config.cron.maxConcurrent));
    const store: CronStore = { jobsFile: resolveCronJobsFile(options.workspaceRoot, options.config.cron.jobsFile) };

    const inFlight = new Set<string>();
    const running = new Set<Promise<void>>();
    const fileLock = new KeyedMutex();

    let stopping = false;
    let tickInProgress: Promise<void> | undefined;

    const tick = async (): Promise<void> => {
      if (stopping) return;

      let jobs;
      try {
        jobs = await listCronJobs(store);
      } catch (err: any) {
        process.stderr.write(
          `[cron] failed to load jobs: ${truncateForDisplay(redactSensitive(err?.message || String(err)), 300)}\n`
        );
        return;
      }

      const nowMs = Date.now();
      const due = jobs.filter((j) => j.enabled && Number.isFinite(Date.parse(j.nextRunIso)) && Date.parse(j.nextRunIso) <= nowMs);
      if (due.length === 0) return;

      const available = Math.max(0, maxConcurrent - inFlight.size);
      if (available <= 0) return;

      for (const job of due.slice(0, available)) {
        if (stopping) break;
        if (inFlight.has(job.id)) continue;
        inFlight.add(job.id);

        const p = (async () => {
          const label = job.name ? `${job.id} (${job.name})` : job.id;
          const startedAt = Date.now();
          try {
            const sessionId = (job.sessionId?.trim() || `cron:${job.id}`).trim() || `cron:${job.id}`;
            const save = typeof job.save === 'boolean' ? job.save : options.defaultSave;

            const output = await locks.runExclusive(sessionId, async () => {
              const session = (await loadSession(options.store, sessionId)) ?? new AgentSession({ sessionId });
              const text = await runTurnToString({ agent, session, input: job.message, callbacks });
              if (save) {
                await saveSession(options.store, session, { sessionId });
              }
              return text;
            });

            await fileLock.runExclusive('jobs', async () => {
              try {
                await markCronJobRunResult(store, job.id, { ok: true, output });
              } catch (err: any) {
                process.stderr.write(
                  `[cron] failed to persist result for ${label}: ${truncateForDisplay(redactSensitive(err?.message || String(err)), 300)}\n`
                );
              }
            });

            process.stderr.write(`[cron] ok ${label} (${Date.now() - startedAt}ms)\n`);
          } catch (err: any) {
            const message = truncateForDisplay(redactSensitive(err?.message || String(err)), 2000);
            await fileLock.runExclusive('jobs', async () => {
              try {
                await markCronJobRunResult(store, job.id, { ok: false, output: message });
              } catch (persistErr: any) {
                process.stderr.write(
                  `[cron] failed to persist error for ${label}: ${truncateForDisplay(redactSensitive(persistErr?.message || String(persistErr)), 300)}\n`
                );
              }
            });
            process.stderr.write(`[cron] error ${label}: ${truncateForDisplay(message, 300)}\n`);
          } finally {
            inFlight.delete(job.id);
          }
        })();

        running.add(p);
        p.finally(() => running.delete(p));
      }
    };

    const scheduleTick = () => {
      if (stopping) return;
      if (tickInProgress) return;
      tickInProgress = tick()
        .catch((err: any) => {
          process.stderr.write(
            `[cron] tick failed: ${truncateForDisplay(redactSensitive(err?.message || String(err)), 300)}\n`
          );
        })
        .finally(() => {
          tickInProgress = undefined;
        });
    };

    const timer = setInterval(scheduleTick, pollMs);
    scheduleTick();

    process.stderr.write(`[cron] enabled pollMs=${pollMs} maxConcurrent=${maxConcurrent} jobsFile=${store.jobsFile}\n`);

    return {
      stop: async () => {
        stopping = true;
        clearInterval(timer);
        await tickInProgress;
        await Promise.allSettled(Array.from(running));
      },
    };
  })();

  const server = http.createServer(async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const url = new URL(String(req.url || '/'), `http://${req.headers.host || 'localhost'}`);

      if (method === 'GET' && url.pathname === '/health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('ok\n');
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/run') {
        const body = await readJsonBody(req, { maxBytes: 1024 * 1024 });
        const message = typeof body?.message === 'string' ? body.message : '';
        const sessionIdRaw = typeof body?.sessionId === 'string' ? body.sessionId : '';
        const save = typeof body?.save === 'boolean' ? body.save : options.defaultSave;

        if (!message.trim()) {
          writeJson(res, 400, { ok: false, error: 'Missing message' });
          return;
        }

        const sessionId = (sessionIdRaw.trim() || options.config.sessionId || 'default').trim() || 'default';

        const output = await locks.runExclusive(sessionId, async () => {
          const session = (await loadSession(options.store, sessionId)) ?? new AgentSession({ sessionId });
          const text = await runTurnToString({ agent, session, input: message, callbacks });
          if (save) {
            await saveSession(options.store, session, { sessionId });
          }
          return text;
        });

        writeJson(res, 200, { ok: true, sessionId, output });
        return;
      }

      writeJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, 500, { ok: false, error: truncateForDisplay(redactSensitive(message), 500) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });

  process.stderr.write(`[daemon] listening on http://${options.host}:${options.port}\n`);
  process.stderr.write(`[daemon] POST /v1/run {\"message\":\"...\",\"sessionId\":\"default\"}\n`);

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = (signal?: string) => {
      if (shuttingDown) return;
      shuttingDown = true;

      process.stderr.write(`[daemon] shutting down${signal ? ` (${signal})` : ''}...\n`);
      void (async () => {
        try {
          await cron?.stop();
        } catch (err: any) {
          process.stderr.write(
            `[daemon] cron stop error: ${truncateForDisplay(redactSensitive(err?.message || String(err)), 300)}\n`
          );
        }
        server.close(() => resolve());
      })();
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  });

  llm.dispose?.();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command || args.command === 'help' || args.command === '--help' || args.command === '-h') {
    printHelp();
    const explicitHelp = !!args.help || args.command === 'help' || args.command === '--help' || args.command === '-h';
    process.exitCode = explicitHelp ? 0 : 1;
    return;
  }

  const workspaceRoot = path.resolve(
    args.workspace ||
      process.env.KOOKABURRA_WORKSPACE ||
      process.env.INIT_CWD ||
      process.cwd()
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: Boolean(process.stdin.isTTY) });

  try {
    if (args.command === 'sessions') {
      const sessionsDirSetting = getSessionsDirSetting({ workspaceRoot, configPath: args.config });
      const sessionsDir = resolveSessionsDir(workspaceRoot, sessionsDirSetting);
      const store: SessionStore = { sessionsDir };

      const sub = args.subcommand;
      if (sub === 'list') {
        const sessions = await listSessions(store);
        for (const s of sessions) {
          process.stdout.write(`${s.sessionId}\t${new Date(s.updatedAtMs).toISOString()}\n`);
        }
        return;
      }

      if (sub === 'clear') {
        await clearSessions(store);
        process.stdout.write('Cleared sessions.\n');
        return;
      }

      process.stderr.write('Unknown sessions subcommand. Use: sessions list | sessions clear\n');
      process.exitCode = 1;
      return;
    }

    if (args.command === 'cron') {
      const cronJobsFileSetting = getCronJobsFileSetting({ workspaceRoot, configPath: args.config });
      const jobsFile = resolveCronJobsFile(workspaceRoot, cronJobsFileSetting);
      const store: CronStore = { jobsFile };

      const positionals = args.positionals ?? [];
      const sub = String(args.subcommand || '').trim();

      if (!sub || sub === 'help') {
        process.stderr.write('Usage: cron list | show <id> | add | every | at | once | pause <id> | resume <id> | remove <id>\n');
        process.exitCode = 1;
        return;
      }

      if (sub === 'list') {
        const jobs = await listCronJobs(store);
        for (const j of jobs) {
          const name = j.name ? `\t${j.name}` : '';
          process.stdout.write(
            `${j.id}\t${j.enabled ? 'enabled' : 'disabled'}\t${j.schedule.kind}\t${j.nextRunIso}${name}\n`
          );
        }
        return;
      }

      if (sub === 'show') {
        const id = String(positionals[2] || '').trim();
        if (!id) {
          process.stderr.write('Usage: cron show <id>\n');
          process.exitCode = 1;
          return;
        }
        const jobs = await listCronJobs(store);
        const job = jobs.find((j) => j.id === id);
        if (!job) {
          process.stderr.write(`Cron job not found: ${id}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(JSON.stringify(job, null, 2) + '\n');
        return;
      }

      const common = {
        name: typeof args.name === 'string' ? args.name : undefined,
        enabled: args.disabled ? false : true,
        message: String(positionals[3] || ''),
        sessionId: typeof args.session === 'string' ? args.session : undefined,
        ...(typeof args.save === 'boolean' ? { save: args.save } : {}),
      };

      if (sub === 'add') {
        const expr = String(positionals[2] || '').trim();
        const message = String(positionals[3] || '').trim();
        if (!expr || !message) {
          process.stderr.write('Usage: cron add "<5-part expr>" "<message>" [--tz <tz>] [--name <name>] [--session <id>] [--disabled] [--no-save]\n');
          process.exitCode = 1;
          return;
        }

        const schedule: CronSchedule = { kind: 'cron', expression: expr, ...(args.tz ? { timeZone: args.tz } : {}) };
        const job = await addCronJob(store, { ...common, schedule, message });
        process.stdout.write(`${job.id}\t${job.nextRunIso}\n`);
        return;
      }

      if (sub === 'every') {
        const delay = String(positionals[2] || '').trim();
        const message = String(positionals[3] || '').trim();
        if (!delay || !message) {
          process.stderr.write('Usage: cron every <delay> "<message>" [--name <name>] [--session <id>] [--disabled] [--no-save]\n');
          process.exitCode = 1;
          return;
        }

        const everyMs = parseDelayMs(delay);
        const schedule: CronSchedule = { kind: 'every', everyMs };
        const job = await addCronJob(store, { ...common, schedule, message });
        process.stdout.write(`${job.id}\t${job.nextRunIso}\n`);
        return;
      }

      if (sub === 'at') {
        const atIso = String(positionals[2] || '').trim();
        const message = String(positionals[3] || '').trim();
        if (!atIso || !message) {
          process.stderr.write('Usage: cron at "<iso>" "<message>" [--name <name>] [--session <id>] [--disabled] [--no-save]\n');
          process.exitCode = 1;
          return;
        }

        const schedule: CronSchedule = { kind: 'at', atIso };
        const job = await addCronJob(store, { ...common, schedule, message });
        process.stdout.write(`${job.id}\t${job.nextRunIso}\n`);
        return;
      }

      if (sub === 'once') {
        const delay = String(positionals[2] || '').trim();
        const message = String(positionals[3] || '').trim();
        if (!delay || !message) {
          process.stderr.write('Usage: cron once <delay> "<message>" [--name <name>] [--session <id>] [--disabled] [--no-save]\n');
          process.exitCode = 1;
          return;
        }

        const ms = parseDelayMs(delay);
        const atIso = new Date(Date.now() + ms).toISOString();
        const schedule: CronSchedule = { kind: 'at', atIso };
        const job = await addCronJob(store, { ...common, schedule, message });
        process.stdout.write(`${job.id}\t${job.nextRunIso}\n`);
        return;
      }

      if (sub === 'pause' || sub === 'resume') {
        const id = String(positionals[2] || '').trim();
        if (!id) {
          process.stderr.write(`Usage: cron ${sub} <id>\n`);
          process.exitCode = 1;
          return;
        }
        const job = await updateCronJob(store, id, { enabled: sub === 'resume' });
        process.stdout.write(`${job.id}\t${job.enabled ? 'enabled' : 'disabled'}\t${job.nextRunIso}\n`);
        return;
      }

      if (sub === 'remove') {
        const id = String(positionals[2] || '').trim();
        if (!id) {
          process.stderr.write('Usage: cron remove <id>\n');
          process.exitCode = 1;
          return;
        }
        await removeCronJob(store, id);
        process.stdout.write('Removed.\n');
        return;
      }

      process.stderr.write('Unknown cron subcommand. Use: cron list | show | add | every | at | once | pause | resume | remove\n');
      process.exitCode = 1;
      return;
    }

    if (args.command === 'onboard') {
      const defaultPath = path.join(workspaceRoot, '.kookaburra', 'runtime.json');
      const force = !!args.force;
      const configPath = args.config
        ? (path.isAbsolute(args.config) ? args.config : path.join(workspaceRoot, args.config))
        : defaultPath;

      const template = {
        llm: {
          provider: 'openaiCompatible',
          baseURL: String(args.baseURL || process.env.KOOKABURRA_BASE_URL || 'http://localhost:8080/v1'),
          model: String(args.model || process.env.KOOKABURRA_MODEL || 'your-model-id'),
        },
        agent: { mode: 'build' },
        security: { allowExternalPaths: false },
        persistence: { sessionsDir: '.kookaburra/sessions' },
        cron: { enabled: true, pollMs: 15000, maxConcurrent: 4, jobsFile: '.kookaburra/cron/jobs.json' },
      };

      const writeTextFile = (filePath: string, content: string, options?: { force?: boolean }): 'created' | 'overwritten' | 'skipped' => {
        const shouldForce = !!options?.force;
        const fileExists = (() => {
          try {
            return fs.existsSync(filePath);
          } catch {
            return false;
          }
        })();

        if (fileExists && !shouldForce) return 'skipped';

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return fileExists ? 'overwritten' : 'created';
      };

      const configResult = writeTextFile(configPath, JSON.stringify(template, null, 2) + '\n', { force });
      if (configResult === 'created') process.stdout.write(`Created ${configPath}\n`);
      else if (configResult === 'overwritten') process.stdout.write(`Overwrote ${configPath}\n`);
      else process.stdout.write(`Kept ${configPath}\n`);

      const identityFiles: Array<{ name: 'IDENTITY.md' | 'SOUL.md' | 'USER.md' | 'AGENTS.md'; content: string }> = [
        {
          name: 'IDENTITY.md',
          content: [
            '# IDENTITY',
            '',
            'Who the agent is in this workspace.',
            '',
            '- Role: an AI agent operating in this repository',
            '- Objective: complete tasks requested by the user using available tools',
            '',
          ].join('\n'),
        },
        {
          name: 'SOUL.md',
          content: [
            '# SOUL',
            '',
            'Core personality and values.',
            '',
            '- Be direct, specific, and honest about uncertainty',
            '- Prefer simple, maintainable solutions over cleverness',
            '- Be safe by default; ask before destructive actions',
            '- Avoid exposing or persisting secrets',
            '',
          ].join('\n'),
        },
        {
          name: 'USER.md',
          content: [
            '# USER',
            '',
            'Who the agent is helping.',
            '',
            '- The user is the operator/maintainer of this workspace',
            '- They value correctness, speed of iteration, and clear explanations',
            '',
          ].join('\n'),
        },
        {
          name: 'AGENTS.md',
          content: [
            '# AGENTS',
            '',
            'Behavior guidelines for the agent in this workspace.',
            '',
            '- Prefer minimal diffs; avoid duplication',
            '- Run relevant checks/tests when feasible',
            '- Don’t read secret files (e.g. .env) unless explicitly requested',
            '- Don’t log sensitive values (API keys, internal URLs/IPs)',
            '- Ask for confirmation before destructive operations',
            '',
          ].join('\n'),
        },
      ];

      for (const f of identityFiles) {
        const absPath = path.join(workspaceRoot, f.name);
        const result = writeTextFile(absPath, f.content, { force });
        if (result === 'created') process.stdout.write(`Created ${absPath}\n`);
        else if (result === 'overwritten') process.stdout.write(`Overwrote ${absPath}\n`);
      }

      process.stderr.write('Note: set KOOKABURRA_API_KEY in env if your endpoint requires it.\n');
      return;
    }

    const prompt = async (message: string) => await rl.question(message);
    const approvals = new ApprovalManager(prompt, { nonInteractiveDefault: 'deny' });

    const cliConfig = buildCliConfigFromArgs(args);
    const loaded = loadKookaburraConfig({
      workspaceRoot,
      configPath: args.config,
      cli: cliConfig,
      env: process.env,
    });

    const sessionsDir = resolveSessionsDir(workspaceRoot, loaded.config.persistence.sessionsDir);
    const store: SessionStore = { sessionsDir };

    if (args.command === 'daemon') {
      const host = String(args.host || '127.0.0.1').trim() || '127.0.0.1';
      const port = typeof args.port === 'number' ? args.port : 8787;
      await runDaemon({ host, port, defaultSave: args.save !== false, config: loaded.config, workspaceRoot, store, approvals });
      return;
    }

    if (args.command === 'agent') {
      const sessionId = (args.session || loaded.config.sessionId || 'default').trim() || 'default';

      if (typeof args.message === 'string' && args.message.trim()) {
        const { agent, llm } = createRuntimeAgent({ config: loaded.config, workspaceRoot });
        try {
          const session =
            (await loadSession(store, sessionId)) ??
            new AgentSession({ sessionId });
          const callbacks = createAgentCallbacks(approvals);
          const abortController = new AbortController();
          const onSigint = () => abortController.abort();
          process.once('SIGINT', onSigint);
          try {
            await runTurn({
              agent,
              session,
              input: args.message,
              callbacks,
              signal: abortController.signal,
            });
          } finally {
            process.removeListener('SIGINT', onSigint);
          }

          if (args.save !== false) {
            await saveSession(store, session, { sessionId });
          }
        } finally {
          llm.dispose?.();
        }
        return;
      }

      const { agent, llm } = createRuntimeAgent({ config: loaded.config, workspaceRoot });
      try {
        await runInteractiveAgent({
          config: loaded.config,
          agent,
          store,
          initialSessionId: sessionId,
          rl,
          approvals,
          save: args.save !== false,
        });
      } finally {
        llm.dispose?.();
      }
      return;
    }

    process.stderr.write(`Unknown command: ${args.command}\n`);
    printHelp();
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[error] ${truncateForDisplay(redactSensitive(message), 1000)}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

await main();
