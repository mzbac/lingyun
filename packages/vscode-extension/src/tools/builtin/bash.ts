import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import {
  computeStopHint,
  DEFAULT_BACKGROUND_TTL_MS,
  looksLikeGitPushCommand,
  looksLikeLongRunningServerCommand,
  TOOL_ERROR_CODES,
  buildSafeChildProcessEnv,
  cleanupDeadBackgroundJobs,
  createBackgroundJobKey,
  evaluateShellCommand,
  findExternalPathReferencesInShellCommand,
  getBackgroundJob,
  isPidAlive,
  isPathInsideWorkspace,
  killProcessTree,
  optionalBoolean,
  optionalNumber,
  optionalString,
  refreshBackgroundJob,
  requireString,
  registerBackgroundJob,
  removeBackgroundJob,
} from '@kooka/core';
import { backgroundTerminalManager } from '../../core/terminal/backgroundTerminal';
import { resolveVscodeShellCommandInvocation } from '../../core/terminal/shellLaunch';
import { getWorkspaceRootUri, resolveToolPath } from './workspace';

const MAX_BASH_OUTPUT = 50000;
const KILL_GRACE_MS = 1500;

function formatBackgroundTtl(ttlMs: number): string {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 'disabled';

  if (ttlMs % (60 * 60 * 1000) === 0) {
    const hours = ttlMs / (60 * 60 * 1000);
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }

  if (ttlMs % (60 * 1000) === 0) {
    const minutes = ttlMs / (60 * 1000);
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }

  if (ttlMs % 1000 === 0) {
    const seconds = ttlMs / 1000;
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }

  return `${ttlMs} ms`;
}

function buildAutoStopMessage(ttlMs: number): string {
  return ttlMs > 0
    ? `Auto-stop: after ${formatBackgroundTtl(ttlMs)} (set ttlMs: 0 to disable).`
    : 'Auto-stop: disabled (ttlMs: 0).';
}

async function runBackgroundSpawn(args: {
  command: string;
  cwd: string;
  ttlMs: number;
  scope: string;
}): Promise<ReturnType<ToolHandler>> {
  cleanupDeadBackgroundJobs(args.scope);
  const key = createBackgroundJobKey({ cwd: args.cwd, command: args.command });

  const existing = getBackgroundJob(args.scope, key);
  if (existing && isPidAlive(existing.pid)) {
    const refreshed = refreshBackgroundJob(args.scope, key, args.ttlMs) ?? existing;
    const stopHint = computeStopHint(existing.pid);

    return {
      success: true,
      data: [
        `Command already running in background (pid ${existing.pid}).`,
        ...(stopHint ? [`To stop: ${stopHint}`] : []),
        buildAutoStopMessage(refreshed.ttlMs),
      ].join('\n'),
      metadata: {
        background: true,
        reused: true,
        pid: existing.pid,
        jobId: refreshed.id,
        ttlMs: refreshed.ttlMs,
        expiresAt: refreshed.expiresAt,
        stopHint,
        runner: 'spawn',
      },
    };
  }

  if (existing) {
    removeBackgroundJob(args.scope, key);
  }

  const env = buildSafeChildProcessEnv({ baseEnv: process.env });
  const invocation = resolveVscodeShellCommandInvocation(args.command);
  const proc = invocation
    ? cp.spawn(invocation.executable, invocation.args, {
        cwd: args.cwd,
        env,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
      })
    : cp.spawn(args.command, {
        cwd: args.cwd,
        shell: true,
        env,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
      });

  const pid = proc.pid;
  if (typeof pid !== 'number') {
    return {
      success: false,
      error: 'Failed to start background command (missing pid)',
      metadata: {
        background: true,
        errorCode: TOOL_ERROR_CODES.bash_background_pid_unavailable,
        runner: 'spawn',
      },
    };
  }
  proc.unref();

  const job = registerBackgroundJob({
    scope: args.scope,
    key,
    command: args.command,
    cwd: args.cwd,
    pid,
    ttlMs: args.ttlMs,
  });

  const stopHint = computeStopHint(pid);
  return {
    success: true,
    data: [
      `Command started in background (pid ${pid}).`,
      ...(stopHint ? [`To stop: ${stopHint}`] : []),
      buildAutoStopMessage(job.ttlMs),
    ].join('\n'),
    metadata: {
      background: true,
      reused: false,
      pid,
      jobId: job.id,
      ttlMs: job.ttlMs,
      expiresAt: job.expiresAt,
      stopHint,
      runner: 'spawn',
    },
  };
}

export const bashTool: ToolDefinition = {
  id: 'bash',
  name: 'Run Command',
  description:
    'Execute a shell command. Use for git/npm/dev tools. Note: if lingyun.security.blockGitPush is enabled, `git push` is blocked; ask the user to push manually or disable the setting. For long-running commands (dev servers, watchers, downloads), pass { background: true } to run in the VS Code integrated terminal (auto-stops after a TTL, output written to a log file). For long downloads or transfers, set { ttlMs: <longer-ms> } or { ttlMs: 0 } so LingYun does not stop the job too early. For non-background commands, you can provide { timeout: <ms> } to bound execution. Background commands are deduplicated per (workdir + command) to avoid spawning multiple servers. Avoid using shell for file operations (reading, searching, editing, writing) — prefer the dedicated tools: read/list/glob/grep/edit/write. Use "workdir" instead of "cd". Output is captured and truncated if large.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds (useful to bound long-running commands and capture startup output)' },
      workdir: { type: 'string', description: 'Working directory (absolute or workspace-relative). Prefer this over "cd".' },
      background: {
        type: 'boolean',
        description:
          'Run the command in the background (integrated terminal) and return after capturing a short startup preview. Use this for long-running dev servers or downloads (e.g. `npx serve .`, `python -m http.server`, `yt-dlp ...`).',
      },
      ttlMs: {
        type: 'number',
        description:
          'Time-to-live in milliseconds for background commands. When set, the process is automatically stopped after this duration. Defaults to lingyun.tools.bash.backgroundTtlMs. Use 0 to disable auto-stop for long downloads or transfers.',
      },
      captureMs: {
        type: 'number',
        description:
          'When background=true, wait up to this many milliseconds to capture startup output for the tool result (0 disables capture and returns immediately). Defaults to lingyun.tools.bash.backgroundCaptureMs.',
      },
      captureLines: {
        type: 'number',
        description:
          'When background=true, maximum number of startup output lines to include in the tool result. Defaults to lingyun.tools.bash.backgroundCaptureLines.',
      },
      description: { type: 'string', description: 'Short description of what the command does (optional)' },
    },
    required: ['command'],
  },
  execution: { type: 'function', handler: 'builtin.bash' },
  metadata: {
    category: 'shell',
    icon: 'terminal',
    requiresApproval: false,
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
  let cwd: string;
  const workspaceRoot = getWorkspaceRootUri(context).fsPath;
  try {
    cwd = cwdInput ? resolveToolPath(cwdInput, context).absPath : workspaceRoot;
  } catch {
    cwd = workspaceRoot;
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
  context.log(`Command safety: ${safety.verdict === 'allow' ? 'safe' : safety.reason}`);
  if (safety.verdict === 'deny') {
    return { success: false, error: `Blocked command: ${safety.reason}` };
  }

  const allowExternalPaths =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;

  if (!allowExternalPaths) {
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
          'Enable lingyun.security.allowExternalPaths to allow external path access.',
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

  const blockGitPush =
    vscode.workspace.getConfiguration('lingyun').get<boolean>('security.blockGitPush', true) ?? true;
  if (blockGitPush && looksLikeGitPushCommand(command)) {
    return {
      success: false,
      error:
        'Blocked `git push` command (lingyun.security.blockGitPush=true). ' +
        'Run `git push` manually in your terminal, or disable the setting to allow it.',
      metadata: {
        errorCode: TOOL_ERROR_CODES.bash_git_push_blocked,
        blockedSettingKey: 'lingyun.security.blockGitPush',
      },
    };
  }

  const timeoutRaw = optionalNumber(args, 'timeout');
  const timeout = timeoutRaw !== undefined && Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 0;

  const backgroundArg = optionalBoolean(args, 'background') ?? false;
  const ttlMsRaw = optionalNumber(args, 'ttlMs');
  const ttlMsArg = ttlMsRaw !== undefined && Number.isFinite(ttlMsRaw) && ttlMsRaw >= 0 ? Math.floor(ttlMsRaw) : undefined;
  const captureMsRaw = optionalNumber(args, 'captureMs');
  const captureMsArg =
    captureMsRaw !== undefined && Number.isFinite(captureMsRaw) && captureMsRaw >= 0 ? Math.floor(captureMsRaw) : undefined;
  const captureLinesRaw = optionalNumber(args, 'captureLines');
  const captureLinesArg =
    captureLinesRaw !== undefined && Number.isFinite(captureLinesRaw) && captureLinesRaw >= 0
      ? Math.floor(captureLinesRaw)
      : undefined;

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

  const backgroundTtlSetting =
    vscode.workspace
      .getConfiguration('lingyun')
      .get<number>('tools.bash.backgroundTtlMs', DEFAULT_BACKGROUND_TTL_MS) ?? DEFAULT_BACKGROUND_TTL_MS;
  const backgroundTtlMs =
    ttlMsArg ??
    (Number.isFinite(backgroundTtlSetting) && backgroundTtlSetting >= 0 ? Math.floor(backgroundTtlSetting) : DEFAULT_BACKGROUND_TTL_MS);

  if (runInBackground) {
    const captureMsSetting =
      vscode.workspace.getConfiguration('lingyun').get<number>('tools.bash.backgroundCaptureMs', 2000) ?? 2000;
    const captureLinesSetting =
      vscode.workspace.getConfiguration('lingyun').get<number>('tools.bash.backgroundCaptureLines', 50) ?? 50;

    const captureMs =
      captureMsArg ?? (Number.isFinite(captureMsSetting) && captureMsSetting >= 0 ? Math.floor(captureMsSetting) : 2000);
    const captureLines =
      captureLinesArg ??
      (Number.isFinite(captureLinesSetting) && captureLinesSetting >= 0 ? Math.floor(captureLinesSetting) : 50);

    const shellIntegrationTimeoutMs =
      captureMs > 0 ? Math.min(4000, captureMs) : 2000;

    if (process.env.LINGYUN_BASH_BACKGROUND_RUNNER === 'spawn') {
      return await runBackgroundSpawn({
        command: commandToRun,
        cwd,
        ttlMs: backgroundTtlMs,
        scope: workspaceRoot,
      });
    }

    return await backgroundTerminalManager.start({
      command: commandToRun,
      cwd,
      ttlMs: backgroundTtlMs,
      captureMs,
      captureLines,
      shellIntegrationTimeoutMs,
      pidTimeoutMs: 10_000,
      context,
    });
  }

  return new Promise((resolve) => {
    const env = buildSafeChildProcessEnv({ baseEnv: process.env });
    const invocation = resolveVscodeShellCommandInvocation(commandToRun);
    const proc = invocation
      ? cp.spawn(invocation.executable, invocation.args, {
          cwd,
          env,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : cp.spawn(commandToRun, {
          cwd,
          shell: true,
          env,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });

    let output = '';
    let truncated = false;
    let timedOut = false;
    let canceled = false;
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let exitFallback: NodeJS.Timeout | undefined;
    let killFallback: NodeJS.Timeout | undefined;

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

    const requestKill = () => {
      if (typeof proc.pid === 'number') {
        const pid = proc.pid;
        killProcessTree(pid, 'SIGTERM');
        killFallback = setTimeout(() => {
          if (settled) return;
          killProcessTree(pid, 'SIGKILL');
        }, KILL_GRACE_MS);
      } else {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    };

    const timeoutId =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            requestKill();
          }, timeout)
        : undefined;

    const cancelListener = context.cancellationToken.onCancellationRequested(() => {
      canceled = true;
      requestKill();
    });

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (exitFallback) clearTimeout(exitFallback);
      if (killFallback) clearTimeout(killFallback);
      cancelListener.dispose();
      if (!runInBackground) {
        proc.stdout?.removeListener('data', append);
        proc.stderr?.removeListener('data', append);
      }
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
          metadata: { truncated, background: false },
        });
        return;
      }

      if (canceled) {
        resolve({
          success: false,
          error: 'Command canceled',
          data: output,
          metadata: { truncated, background: false },
        });
        return;
      }

      if (code !== 0) {
        const errText = output.trim() || `Command failed with exit code ${code}`;
        resolve({ success: false, error: errText, data: output, metadata: { truncated, background: false } });
        return;
      }

      resolve({ success: true, data: output || 'Command completed', metadata: { truncated } });
    };

    proc.on('error', (err) => {
      cleanup();
      resolve({ success: false, error: err.message, metadata: { background: runInBackground } });
    });

    // Prefer "close" for normal commands (ensures streams drained), but fall back to "exit"
    // to avoid hanging forever when child processes keep stdio open (common with "&").
    proc.on('exit', (code, signal) => {
      exitCode = typeof code === 'number' ? code : 0;
      exitSignal = signal ?? null;
      if (settled) return;
      // If "close" doesn't arrive shortly, force-finish.
      exitFallback = setTimeout(() => {
        if (settled) return;
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        finalize(exitCode ?? 0);
      }, 150);
    });

    proc.on('close', (code) => {
      if (settled) return;
      const finalCode = typeof code === 'number' ? code : exitCode ?? 0;
      // If we were killed by signal, treat as failure unless it was a timeout (handled above).
      if (!timedOut && exitSignal && finalCode === 0) {
        finalize(1);
        return;
      }
      finalize(finalCode);
    });
  });
};
