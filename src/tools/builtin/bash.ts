import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { requireString, optionalNumber, optionalString, evaluateShellCommand } from '../../core/validation';
import { findExternalPathReferencesInShellCommand, isPathInsideWorkspace } from '../../core/shellPaths';
import { getWorkspaceRootUri, resolveToolPath } from './workspace';

const MAX_BASH_OUTPUT = 50000;

export const bashTool: ToolDefinition = {
  id: 'bash',
  name: 'Run Command',
  description:
    'Execute a shell command. Use for git/npm/dev tools. Avoid using shell for file operations (reading, searching, editing, writing) — prefer the dedicated tools: read/list/glob/grep/edit/write. Use "workdir" instead of "cd". Output is captured and truncated if large.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds' },
      workdir: { type: 'string', description: 'Working directory (absolute or workspace-relative). Prefer this over "cd".' },
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

  return new Promise((resolve) => {
    const trimmedCommand = command.trim();
    const runInBackground = /&\s*$/.test(trimmedCommand);

    // Background commands (ending with "&") can keep stdout/stderr pipes open forever,
    // causing Node's "close" event to never fire. For these, detach stdio so the tool
    // can return promptly and the agent/UI doesn't hang.
    const proc = cp.spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: runInBackground ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe'],
    });

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

    if (!runInBackground) {
      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);
    }

    const kill = () => {
      try {
        // Kill the whole process group where possible so child processes are terminated too.
        if (process.platform !== 'win32' && typeof proc.pid === 'number') {
          process.kill(-proc.pid, 'SIGTERM');
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    };

    const timeoutId =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            kill();
          }, timeout)
        : undefined;

    const cancelListener = context.cancellationToken.onCancellationRequested(() => {
      canceled = true;
      kill();
    });

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (exitFallback) clearTimeout(exitFallback);
      cancelListener.dispose();
      if (!runInBackground) {
        try { proc.stdout?.removeListener('data', append); } catch {}
        try { proc.stderr?.removeListener('data', append); } catch {}
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

      if (runInBackground) {
        resolve({ success: true, data: 'Command started in background', metadata: { background: true } });
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
        try { proc.stdout?.destroy(); } catch {}
        try { proc.stderr?.destroy(); } catch {}
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
