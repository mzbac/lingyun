import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { ToolDefinition, ToolHandler } from '../../types.js';
import {
  DEFAULT_BACKGROUND_KILL_GRACE_MS,
  DEFAULT_BACKGROUND_TTL_MS,
  TOOL_ERROR_CODES,
  buildSafeChildProcessEnv,
  cleanupDeadBackgroundJobs,
  createBackgroundJobKey,
  evaluateShellCommand,
  findExternalPathReferencesInShellCommand,
  getBackgroundJob,
  isPathInsideWorkspace,
  isPidAlive,
  killProcessTree,
  optionalBoolean,
  optionalNumber,
  optionalString,
  refreshBackgroundJob,
  registerBackgroundJob,
  removeBackgroundJob,
  requireString,
} from '@kooka/core';
import { getWorkspaceRoot, resolveToolPath } from './workspace.js';

const MAX_BASH_OUTPUT = 50_000;

function normalizeCommandForHeuristics(command: string): string {
  const collapsed = command.trim().toLowerCase().replace(/\s+/g, ' ');
  return collapsed.replace(/^(?:[a-z_][a-z0-9_]*=\S+\s+)+/gi, '');
}

function looksLikeLongRunningServerCommand(command: string): boolean {
  const normalized = normalizeCommandForHeuristics(command);

  const patterns: readonly RegExp[] = [
    /\bnpx\s+serve\b/,
    /\bnpx\s+http-server\b/,
    /\bhttp-server\b/,
    /\bpython(?:3)?\s+-m\s+http\.server\b/,
    /\bpython(?:3)?\s+-m\s+simplehttpserver\b/,
    /\bflask\s+run\b/,
    /\buvicorn\b/,
    /\bdjango-admin\s+runserver\b/,
    /\bmanage\.py\s+runserver\b/,
    /\bnpm\s+run\s+(dev|start|serve)\b/,
    /\bpnpm\s+(dev|start)\b/,
    /\byarn\s+(dev|start)\b/,
    /\bbun\s+(dev|start)\b/,
    /\bvite\b/,
    /\bnext\s+dev\b/,
    /\breact-scripts\s+start\b/,
  ];

  return patterns.some((re) => re.test(normalized));
}

export const bashTool: ToolDefinition = {
  id: 'bash',
  name: 'Run Command',
  description:
    'Execute a shell command. Use for git/npm/dev tools. For long-running commands (dev servers, watchers), pass { background: true } to detach (auto-stops after a TTL) or { timeout: <ms> } to bound execution. Background commands are deduplicated per (workdir + command) to avoid spawning multiple servers. Avoid using shell for file operations (reading, searching, editing, writing) — prefer the dedicated tools: read/list/glob/grep/write. Use "workdir" instead of "cd". Output is captured and truncated if large.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds' },
      workdir: { type: 'string', description: 'Working directory (absolute or workspace-relative). Prefer this over "cd".' },
      background: {
        type: 'boolean',
        description:
          'Run the command in the background (detached) and return immediately. Use this for long-running dev servers (e.g. `npx serve .`, `python -m http.server`).',
      },
      ttlMs: {
        type: 'number',
        description:
          'Time-to-live in milliseconds for background commands. When set, the process is automatically stopped after this duration.',
      },
      description: { type: 'string', description: 'Short description of what the command does (optional)' },
    },
    required: ['command'],
  },
  execution: { type: 'function', handler: 'builtin.bash' },
  metadata: {
    category: 'shell',
    icon: 'terminal',
    requiresApproval: true,
    permission: 'bash',
    readOnly: false,
    supportsExternalPaths: true,
    permissionPatterns: [
      { arg: 'command', kind: 'command' },
      { arg: 'workdir', kind: 'path' },
    ],
  },
};

export const bashHandler: ToolHandler = async (args, context) => {
  const commandResult = requireString(args, 'command');
  if ('error' in commandResult) return { success: false, error: commandResult.error };
  const command = commandResult.value;

  const cwdInput = optionalString(args, 'workdir');
  const workspaceRoot = getWorkspaceRoot(context);

  let cwd = workspaceRoot;
  if (cwdInput) {
    try {
      cwd = resolveToolPath(cwdInput, { ...context, allowExternalPaths: true }).absPath;
    } catch {
      cwd = workspaceRoot;
    }
  }

  try {
    const stat = await fs.promises.stat(cwd);
    if (!stat.isDirectory()) {
      cwd = path.dirname(cwd);
    }
  } catch {
    cwd = workspaceRoot;
  }

  const safety = evaluateShellCommand(command);
  if (safety.verdict !== 'allow') {
    context.log(`Command safety: ${safety.reason}`);
  }
  if (safety.verdict === 'deny') {
    return { success: false, error: `Blocked command: ${safety.reason}` };
  }

  if (!context.allowExternalPaths) {
    const externalRefs = new Set<string>();
    if (!isPathInsideWorkspace(cwd, workspaceRoot)) {
      externalRefs.add(cwd);
    }
    for (const p of findExternalPathReferencesInShellCommand(command, { cwd, workspaceRoot })) {
      externalRefs.add(p);
    }

    if (externalRefs.size > 0) {
      const blockedPaths = [...externalRefs];
      const blockedPathsMax = 20;
      const blockedPathsTruncated = blockedPaths.length > blockedPathsMax;
      return {
        success: false,
        error:
          'External paths are disabled. This shell command references paths outside the current workspace. ' +
          'Enable allowExternalPaths to allow external path access.',
        metadata: {
          errorCode: TOOL_ERROR_CODES.external_paths_disabled,
          blockedSettingKey: 'lingyun.security.allowExternalPaths',
          isOutsideWorkspace: true,
          blockedPaths: blockedPaths.slice(0, blockedPathsMax),
          blockedPathsTruncated,
        },
      };
    }
  }

  const timeoutRaw = optionalNumber(args, 'timeout');
  const timeout = timeoutRaw && Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 0;

  const backgroundArg = optionalBoolean(args, 'background') ?? false;
  const ttlMsRaw = optionalNumber(args, 'ttlMs');
  const ttlMsArg = ttlMsRaw !== undefined && Number.isFinite(ttlMsRaw) && ttlMsRaw >= 0 ? Math.floor(ttlMsRaw) : undefined;

  const trimmedCommand = command.trimEnd();
  const ampersandBackground = trimmedCommand.endsWith('&') && !trimmedCommand.endsWith('&&');
  const commandToRun = ampersandBackground ? trimmedCommand.replace(/&\s*$/, '').trimEnd() : command;
  const runInBackground = backgroundArg || ampersandBackground;

  if (looksLikeLongRunningServerCommand(commandToRun) && !runInBackground && timeout === 0) {
    return {
      success: false,
      error:
        'This command looks like it will start a long-running server and block the agent. ' +
        'Re-run with { background: true } to detach it, or provide { timeout: <ms> } to capture startup output and exit.',
      metadata: {
        errorCode: TOOL_ERROR_CODES.bash_requires_background_or_timeout,
        suggestedArgs: { background: true },
      },
    };
  }

  const backgroundScope = workspaceRoot;
  const backgroundKey = runInBackground ? createBackgroundJobKey({ cwd, command: commandToRun }) : '';
  const backgroundTtlMs = ttlMsArg ?? DEFAULT_BACKGROUND_TTL_MS;

  const env = buildSafeChildProcessEnv({ baseEnv: process.env });

  if (runInBackground) {
    cleanupDeadBackgroundJobs(backgroundScope);
    const existing = getBackgroundJob(backgroundScope, backgroundKey);
    if (existing && isPidAlive(existing.pid)) {
      const refreshed = refreshBackgroundJob(backgroundScope, backgroundKey, backgroundTtlMs) ?? existing;
      const stopHint =
        process.platform === 'win32' ? `taskkill /pid ${existing.pid} /T /F` : `kill -TERM -${existing.pid}`;

      return {
        success: true,
        data: `Command already running in background (pid ${existing.pid}).${stopHint ? ` To stop: ${stopHint}` : ''}`,
        metadata: {
          background: true,
          reused: true,
          pid: existing.pid,
          jobId: refreshed.id,
          ttlMs: refreshed.ttlMs,
          expiresAt: refreshed.expiresAt,
          stopHint,
        },
      };
    }

    if (existing) {
      removeBackgroundJob(backgroundScope, backgroundKey);
    }
  }

  return await new Promise((resolve) => {
    const proc = cp.spawn(commandToRun, {
      cwd,
      shell: true,
      detached: process.platform !== 'win32',
      env,
      stdio: runInBackground ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe'],
    });

    if (runInBackground) {
      try {
        proc.unref();
      } catch {
        // ignore
      }

      const pid = typeof proc.pid === 'number' ? proc.pid : undefined;
      const stopHint =
        typeof pid === 'number'
          ? process.platform === 'win32'
            ? `taskkill /pid ${pid} /T /F`
            : `kill -TERM -${pid}`
          : undefined;

      const job =
        typeof pid === 'number'
          ? registerBackgroundJob({
              scope: backgroundScope,
              key: backgroundKey,
              command: commandToRun,
              cwd,
              pid,
              ttlMs: backgroundTtlMs,
            })
          : undefined;

      proc.once('exit', () => {
        if (!job) return;
        const current = getBackgroundJob(backgroundScope, backgroundKey);
        if (current && current.id === job.id) {
          removeBackgroundJob(backgroundScope, backgroundKey);
        }
      });

      resolve({
        success: true,
        data:
          typeof pid === 'number'
            ? `Command started in background (pid ${pid}).${stopHint ? ` To stop: ${stopHint}` : ''}`
            : 'Command started in background.',
        metadata: {
          background: true,
          pid,
          stopHint,
          jobId: job?.id,
          ttlMs: job?.ttlMs,
          expiresAt: job?.expiresAt,
        },
      });
      return;
    }

    let output = '';
    let truncated = false;
    let timedOut = false;
    let canceled = false;
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let exitFallback: NodeJS.Timeout | undefined;

    const append = (data: Buffer) => {
      if (truncated) return;
      output += data.toString();
      if (output.length > MAX_BASH_OUTPUT) {
        output = output.slice(0, MAX_BASH_OUTPUT) + '\n...(truncated)';
        truncated = true;
      }
    };

    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    let killFallback: NodeJS.Timeout | undefined;
    const requestKill = () => {
      if (typeof proc.pid === 'number') {
        const pid = proc.pid;
        killProcessTree(pid, 'SIGTERM');
        killFallback = setTimeout(() => {
          killProcessTree(pid, 'SIGKILL');
        }, DEFAULT_BACKGROUND_KILL_GRACE_MS);
        killFallback.unref?.();
        return;
      }

      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    };

    const timeoutId =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            requestKill();
          }, timeout)
        : undefined;

    const onAbort = () => {
      canceled = true;
      requestKill();
    };
    context.signal.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (exitFallback) clearTimeout(exitFallback);
      if (killFallback) clearTimeout(killFallback);
      try {
        context.signal.removeEventListener('abort', onAbort);
      } catch {
        // ignore
      }
      try {
        proc.stdout?.removeListener('data', append);
      } catch {}
      try {
        proc.stderr?.removeListener('data', append);
      } catch {}
    };

    const finalize = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (timedOut) {
        resolve({
          success: false,
          error: `Command timed out after ${timeout} ms`,
          data: output,
          metadata: { truncated },
        });
        return;
      }

      if (canceled) {
        resolve({
          success: false,
          error: 'Command canceled',
          data: output,
          metadata: { truncated },
        });
        return;
      }

      if (code !== 0) {
        const errText = output.trim() || `Command failed with exit code ${code}`;
        resolve({ success: false, error: errText, data: output, metadata: { truncated } });
        return;
      }

      resolve({ success: true, data: output || 'Command completed', metadata: { truncated } });
    };

    proc.on('error', (err) => {
      cleanup();
      resolve({ success: false, error: err.message });
    });

    proc.on('exit', (code, signal) => {
      exitCode = typeof code === 'number' ? code : 0;
      exitSignal = signal ?? null;
      if (settled) return;
      exitFallback = setTimeout(() => {
        if (settled) return;
        try {
          proc.stdout?.destroy();
        } catch {}
        try {
          proc.stderr?.destroy();
        } catch {}
        finalize(exitCode ?? 0);
      }, 150);
    });

    proc.on('close', (code) => {
      if (settled) return;
      const finalCode = typeof code === 'number' ? code : exitCode ?? 0;
      if (!timedOut && exitSignal && finalCode === 0) {
        finalize(1);
        return;
      }
      finalize(finalCode);
    });
  });
};
