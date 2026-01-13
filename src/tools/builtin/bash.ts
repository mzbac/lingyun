import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { requireString, optionalBoolean, optionalNumber, optionalString, evaluateShellCommand } from '../../core/validation';
import { findExternalPathReferencesInShellCommand, isPathInsideWorkspace } from '../../core/shellPaths';
import { getWorkspaceRootUri, resolveToolPath } from './workspace';

const MAX_BASH_OUTPUT = 50000;
const KILL_GRACE_MS = 1500;

function normalizeCommandForHeuristics(command: string): string {
  const collapsed = command.trim().toLowerCase().replace(/\s+/g, ' ');
  // Drop leading env assignments: `FOO=bar BAR=baz <cmd>`
  return collapsed.replace(/^(?:[a-z_][a-z0-9_]*=\S+\s+)+/gi, '');
}

function looksLikeLongRunningServerCommand(command: string): boolean {
  const normalized = normalizeCommandForHeuristics(command);

  // Keep this conservative: only match common long-running dev servers.
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

function killProcessTree(pid: number, signal: NodeJS.Signals): void {
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
    // Prefer killing the whole process group so child processes are terminated too.
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // ignore
    }
  }
}

export const bashTool: ToolDefinition = {
  id: 'bash',
  name: 'Run Command',
  description:
    'Execute a shell command. Use for git/npm/dev tools. For long-running commands (dev servers, watchers), pass { background: true } to detach or { timeout: <ms> } to bound execution. Avoid using shell for file operations (reading, searching, editing, writing) — prefer the dedicated tools: read/list/glob/grep/edit/write. Use "workdir" instead of "cd". Output is captured and truncated if large.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds (useful to bound long-running commands and capture startup output)' },
      workdir: { type: 'string', description: 'Working directory (absolute or workspace-relative). Prefer this over "cd".' },
      background: {
        type: 'boolean',
        description:
          'Run the command in the background (detached) and return immediately. Use this for long-running dev servers (e.g. `npx serve .`, `python -m http.server`).',
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
          errorType: 'external_paths_disabled',
          blockedSettingKey: 'lingyun.security.allowExternalPaths',
          isOutsideWorkspace: true,
          blockedPaths: blockedPaths.slice(0, blockedPathsMax),
          blockedPathsTruncated,
        },
      };
    }
  }

  const timeoutRaw = optionalNumber(args, 'timeout');
  const timeout = timeoutRaw !== undefined && Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 0;

  const backgroundArg = optionalBoolean(args, 'background') ?? false;

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
        errorType: 'bash_requires_background_or_timeout',
        suggestedArgs: { background: true, timeout: 5000 },
      },
    };
  }

  return new Promise((resolve) => {
    // Background commands can keep stdout/stderr pipes open forever, causing Node's "close" event
    // to never fire. For these, detach stdio and return immediately so the agent/UI doesn't hang.
    const proc = cp.spawn(commandToRun, {
      cwd,
      shell: true,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: runInBackground ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe'],
    });

    if (runInBackground) {
      // Let the extension host continue without keeping the child process handle alive.
      try {
        proc.unref();
      } catch {
        // ignore
      }

      let settled = false;
      const finish = (result: { success: boolean; data?: string; error?: string; metadata?: Record<string, unknown> }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      proc.once('error', (err) => {
        finish({ success: false, error: err.message, metadata: { background: true } });
      });

      proc.once('spawn', () => {
        const pid = typeof proc.pid === 'number' ? proc.pid : undefined;
        const stopHint =
          typeof pid === 'number'
            ? process.platform === 'win32'
              ? `taskkill /pid ${pid} /T /F`
              : `kill -TERM -${pid}`
            : undefined;

        finish({
          success: true,
          data:
            typeof pid === 'number'
              ? `Command started in background (pid ${pid}).${stopHint ? ` To stop: ${stopHint}` : ''}`
              : 'Command started in background.',
          metadata: { background: true, pid, stopHint },
        });
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
    let killFallback: NodeJS.Timeout | undefined;

    const append = (data: Buffer) => {
      if (truncated) return;
      output += data.toString();
      if (output.length > MAX_BASH_OUTPUT) {
        output = output.slice(0, MAX_BASH_OUTPUT) + '\n...(truncated)';
        truncated = true;
      }
    };

    if (!runInBackground) {
      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);
    }

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
          metadata: { truncated, background: runInBackground },
        });
        return;
      }

      if (canceled) {
        resolve({
          success: false,
          error: 'Command canceled',
          data: output,
          metadata: { truncated, background: runInBackground },
        });
        return;
      }

      if (code !== 0) {
        const errText = output.trim() || `Command failed with exit code ${code}`;
        resolve({ success: false, error: errText, data: output, metadata: { truncated, background: runInBackground } });
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
