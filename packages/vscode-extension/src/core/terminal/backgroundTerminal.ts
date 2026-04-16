import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  DEFAULT_BACKGROUND_TTL_MS,
  buildAutoStopMessage,
  buildSafeChildProcessEnv,
  cleanupDeadBackgroundJobs,
  createBackgroundJobKey,
  getBackgroundJob,
  isPidAlive,
  refreshBackgroundJob,
  registerBackgroundJob,
  removeBackgroundJob,
  TOOL_ERROR_CODES,
} from '@kooka/core';

import type { ToolContext, ToolResult } from '../types';

type BackgroundTerminalRecord = {
  scope: string;
  key: string;
  command: string;
  cwd: string;
  terminal: vscode.Terminal;
  terminalName: string;
  pid?: number;
  pidFilePath: string;
  logFilePath: string;
  logStream: fs.WriteStream;
  ttlMs: number;
  expiresAt?: number;
  ttlTimer?: NodeJS.Timeout;
};

const BACKGROUND_TERMINAL_SWEEP_MS = 5_000;
const BACKGROUND_STARTUP_EXIT_GRACE_MS = 250;

function buildSandboxedTerminalEnv(): Record<string, string | null> {
  // Best-effort "env_clear" behavior for VS Code terminals: unset everything
  // except a small allowlist so we don't leak host secrets (API keys, tokens).
  const allow = buildSafeChildProcessEnv({ baseEnv: process.env });
  const out: Record<string, string | null> = {};

  for (const key of Object.keys(process.env)) {
    out[key] = null;
  }

  for (const [key, value] of Object.entries(allow)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }

  return out;
}

function hashForLabel(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 8);
}

function stripAnsiAndVscodeSequences(input: string): string {
  // Strip VS Code shell integration OSC 633 sequences.
  // https://code.visualstudio.com/docs/terminal/shell-integration#_vs-code-custom-sequences-osc-633-st
  // eslint-disable-next-line no-control-regex
  const withoutVscode = input.replace(/\u001b\]633;[^\u0007]*\u0007/g, '');
  // Strip common ANSI escape sequences (colors, cursor movement, etc).
  return withoutVscode.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

function quotePosixShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildPosixPidWrappedCommand(args: { command: string; pidFilePath: string }): string {
  const commandArg = quotePosixShellArg(args.command);
  const pidFileArg = quotePosixShellArg(args.pidFilePath);
  return `sh -c 'echo $$ > "$2"; exec sh -c "$1"' sh ${commandArg} ${pidFileArg}`;
}

async function waitForPidFile(pidFilePath: string, timeoutMs: number): Promise<number | undefined> {
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;

  while (true) {
    try {
      const raw = await fs.promises.readFile(pidFilePath, 'utf8');
      const pid = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    } catch {
      // ignore
    }

    if (timeoutMs <= 0) return undefined;
    if (Date.now() >= deadline) return undefined;

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 50);
      t.unref?.();
    });
  }
}

async function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) return terminal.shellIntegration;
  if (timeoutMs <= 0) return undefined;

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      disposable.dispose();
      resolve(undefined);
    }, timeoutMs);

    const disposable = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal !== terminal) return;
      clearTimeout(timer);
      disposable.dispose();
      resolve(event.shellIntegration);
    });
  });
}

async function waitForTerminalPid(
  terminal: vscode.Terminal,
  timeoutMs: number
): Promise<number | undefined> {
  if (timeoutMs <= 0) {
    try {
      return await terminal.processId;
    } catch {
      return undefined;
    }
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (pid?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(pid);
    };

    const timer = setTimeout(() => finish(undefined), timeoutMs);

    terminal.processId
      .then(
        (pid) => finish(typeof pid === 'number' ? pid : undefined),
        () => finish(undefined)
      );
  });
}

function computeStopHint(pid?: number): string | undefined {
  if (typeof pid !== 'number') return undefined;
  return process.platform === 'win32'
    ? `taskkill /pid ${pid} /T /F`
    : `kill -TERM -${pid}`;
}

function getLogDirectory(context: ToolContext): string {
  const base =
    context.extensionContext?.storageUri?.fsPath ??
    context.extensionContext?.globalStorageUri?.fsPath ??
    path.join(os.tmpdir(), 'lingyun');
  return path.join(base, 'terminal-logs');
}

function makeTerminalName(cwd: string, key: string): string {
  const folder = path.basename(cwd) || 'workspace';
  const hash = hashForLabel(key);
  return `LingYun: bg ${folder} ${hash}`;
}

function makeRecordId(scope: string, key: string): string {
  return `${scope}\n${key}`;
}

class BackgroundTerminalManager {
  private records = new Map<string, BackgroundTerminalRecord>();

  constructor() {
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [id, record] of this.records) {
        if (record.terminal === terminal) {
          this.closeRecord(id, record, { removeJob: true });
        }
      }
    });

    const sweepTimer = setInterval(() => this.sweep(), BACKGROUND_TERMINAL_SWEEP_MS);
    sweepTimer.unref?.();
  }

  private disposeRecord(id: string, record: BackgroundTerminalRecord): void {
    this.records.delete(id);
    if (record.ttlTimer) {
      clearTimeout(record.ttlTimer);
    }
    try {
      record.logStream.end();
    } catch {
      // ignore
    }
  }

  private closeRecord(
    id: string,
    record: BackgroundTerminalRecord,
    options?: { disposeTerminal?: boolean; removeJob?: boolean }
  ): void {
    const disposeTerminal = options?.disposeTerminal ?? false;
    const removeJob = options?.removeJob ?? false;

    this.disposeRecord(id, record);

    if (removeJob) {
      removeBackgroundJob(record.scope, record.key);
    }

    if (!disposeTerminal) return;

    try {
      record.terminal.dispose();
    } catch {
      // ignore
    }
  }

  private refreshRecordTtl(record: BackgroundTerminalRecord, ttlMs: number): void {
    if (record.ttlTimer) {
      clearTimeout(record.ttlTimer);
      record.ttlTimer = undefined;
    }

    record.ttlMs = ttlMs;
    record.expiresAt = ttlMs > 0 ? Date.now() + ttlMs : undefined;

    if (ttlMs <= 0) return;

    record.ttlTimer = setTimeout(() => {
      try {
        record.terminal.dispose();
      } catch {
        // ignore
      }
    }, ttlMs);
    record.ttlTimer.unref?.();
  }

  sweep(scope?: string): void {
    cleanupDeadBackgroundJobs(scope);
    for (const [id, record] of this.records) {
      if (scope && record.scope !== scope) continue;
      if (record.terminal.exitStatus) {
        this.closeRecord(id, record, { removeJob: true });
        continue;
      }

      if (typeof record.pid === 'number' && !isPidAlive(record.pid)) {
        this.closeRecord(id, record, { disposeTerminal: true, removeJob: true });
      }
    }
  }

  async start(args: {
    command: string;
    cwd: string;
    ttlMs: number;
    captureMs: number;
    captureLines: number;
    shellIntegrationTimeoutMs: number;
    pidTimeoutMs: number;
    context: ToolContext;
  }): Promise<ToolResult> {
    const workspaceRoot = args.context.workspaceFolder?.fsPath ?? args.cwd;
    const scope = workspaceRoot;
    const key = createBackgroundJobKey({ cwd: args.cwd, command: args.command });
    const recordId = makeRecordId(scope, key);

    const ttlMs =
      Number.isFinite(args.ttlMs) && args.ttlMs >= 0
        ? Math.floor(args.ttlMs)
        : DEFAULT_BACKGROUND_TTL_MS;

    this.sweep(scope);

    const existingJob = getBackgroundJob(scope, key);
    const existingRecord = this.records.get(recordId);

    if (existingRecord && !existingRecord.terminal.exitStatus) {
      this.refreshRecordTtl(existingRecord, ttlMs);
      const pid = existingRecord.pid;
      if (typeof pid === 'number' && isPidAlive(pid)) {
        const job = getBackgroundJob(scope, key);
        const refreshed = job ? refreshBackgroundJob(scope, key, ttlMs) ?? job : undefined;
        const stopHint = computeStopHint(pid) ?? `Close the terminal "${existingRecord.terminalName}"`;

        return {
          success: true,
          data: [
            `Command already running in background (pid ${pid}).`,
            `Terminal: ${existingRecord.terminalName}`,
            `Log: ${existingRecord.logFilePath}`,
            `To stop: ${stopHint}`,
            buildAutoStopMessage(ttlMs),
          ].join('\n'),
          metadata: {
            background: true,
            reused: true,
            pid,
            terminalName: existingRecord.terminalName,
            logFilePath: existingRecord.logFilePath,
            jobId: refreshed?.id,
            ttlMs,
            expiresAt: existingRecord.expiresAt,
            stopHint,
            shellIntegration: Boolean(existingRecord.terminal.shellIntegration),
          },
        };
      }

      return {
        success: false,
        error: `Background command is still starting in terminal "${existingRecord.terminalName}". Retry in a moment.`,
        metadata: {
          background: true,
          reused: true,
          errorCode: TOOL_ERROR_CODES.bash_background_pid_unavailable,
          terminalName: existingRecord.terminalName,
          logFilePath: existingRecord.logFilePath,
          ttlMs,
          expiresAt: existingRecord.expiresAt,
          shellIntegration: Boolean(existingRecord.terminal.shellIntegration),
        },
      };
    }

    if (existingJob && isPidAlive(existingJob.pid)) {
      const refreshed =
        refreshBackgroundJob(scope, key, ttlMs) ?? existingJob;
      const stopHint = computeStopHint(existingJob.pid);

      return {
        success: true,
        data: [
          `Command already running in background (pid ${existingJob.pid}).`,
          ...(stopHint ? [`To stop: ${stopHint}`] : []),
          buildAutoStopMessage(refreshed.ttlMs),
        ].join('\n'),
        metadata: {
          background: true,
          reused: true,
          pid: existingJob.pid,
          terminalName: existingRecord?.terminalName,
          logFilePath: existingRecord?.logFilePath,
          jobId: refreshed.id,
          ttlMs: refreshed.ttlMs,
          expiresAt: refreshed.expiresAt,
          stopHint,
          shellIntegration: Boolean(existingRecord?.terminal.shellIntegration),
        },
      };
    }

    if (existingJob) {
      removeBackgroundJob(scope, key);
    }

    if (existingRecord) {
      this.closeRecord(recordId, existingRecord, { disposeTerminal: true, removeJob: true });
    }

    const terminalName = makeTerminalName(args.cwd, key);
    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: args.cwd,
      isTransient: true,
      env: buildSandboxedTerminalEnv(),
    });
    terminal.show(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const logDir = getLogDirectory(args.context);
    await fs.promises.mkdir(logDir, { recursive: true });
    const pidFilePath = path.join(logDir, `bash-${hashForLabel(key)}-${Date.now()}.pid`);
    const logFilePath = path.join(
      logDir,
      `bash-${hashForLabel(key)}-${Date.now()}.log`
    );
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

    try {
      await fs.promises.unlink(pidFilePath);
    } catch {
      // ignore
    }

    const record: BackgroundTerminalRecord = {
      scope,
      key,
      command: args.command,
      cwd: args.cwd,
      terminal,
      terminalName,
      pidFilePath,
      logFilePath,
      logStream,
      ttlMs,
    };
    this.records.set(recordId, record);

    const captureLines =
      Number.isFinite(args.captureLines) && args.captureLines > 0
        ? Math.floor(args.captureLines)
        : 0;
    const captureMs =
      Number.isFinite(args.captureMs) && args.captureMs > 0
        ? Math.floor(args.captureMs)
        : 0;
    const captureDeadline = captureMs > 0 ? Date.now() + captureMs : 0;
    const maxPreviewChars = 8000;

    const previewLines: string[] = [];
    let previewChars = 0;
    let previewTruncated = false;
    const jobState: { id?: string } = {};
    let executionStartError: string | undefined;
    let executionExitCode: number | undefined;
    let executionExitObserved = false;

    let previewSettled = false;
    let resolvePreview: ((value?: string) => void) | undefined;
    const capturePreview = captureLines > 0 && captureMs > 0;
    const previewReady = capturePreview
      ? new Promise<string | undefined>((resolve) => {
          resolvePreview = resolve;
        })
      : Promise.resolve(undefined);

    const settlePreview = () => {
      if (previewSettled) return;
      previewSettled = true;
      if (resolvePreview) {
        const text = previewLines.join('\n').trimEnd();
        resolvePreview(text || undefined);
      }
    };

    const previewTimer = capturePreview
      ? setTimeout(() => settlePreview(), captureMs)
      : undefined;
    previewTimer?.unref?.();

    const shellIntegration = await waitForShellIntegration(
      terminal,
      args.shellIntegrationTimeoutMs
    );

    if (!shellIntegration) {
      this.closeRecord(recordId, record, { disposeTerminal: true, removeJob: true });
      const errorText =
        'Failed to start background command because VS Code shell integration was unavailable. ' +
        'LingYun cannot capture startup output or confirm whether the command stayed running.';
      return {
        success: false,
        error: errorText,
        metadata: {
          background: true,
          errorCode: TOOL_ERROR_CODES.bash_background_pid_unavailable,
          terminalName,
          logFilePath,
          ttlMs,
          expiresAt: record.expiresAt,
          shellIntegration: false,
          outputText: [
            errorText,
            `Terminal: ${terminalName}`,
            `Log: ${logFilePath}`,
            buildAutoStopMessage(ttlMs),
          ].join('\n'),
        },
      };
    }

    this.refreshRecordTtl(record, ttlMs);

    const wrappedCommand =
      process.platform === 'win32'
        ? args.command
        : buildPosixPidWrappedCommand({ command: args.command, pidFilePath });

    const startOutputLoop = async () => {
      const write = (text: string) => {
        try {
          record.logStream.write(text);
        } catch {
          // ignore
        }
      };

      let execution: vscode.TerminalShellExecution | undefined;
      try {
        execution = shellIntegration.executeCommand(wrappedCommand);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        executionStartError = msg;
        write(`\n[lingyun] failed to execute command: ${msg}\n`);
        settlePreview();
        if (previewTimer) clearTimeout(previewTimer);
        return;
      }

      const executionWithExitCode = execution as vscode.TerminalShellExecution & {
        exitCode?: Promise<number | undefined>;
      };
      void executionWithExitCode.exitCode?.then(
        (code: number | undefined) => {
          executionExitObserved = true;
          executionExitCode = typeof code === 'number' ? code : undefined;
        },
        (error: unknown) => {
          executionExitObserved = true;
          const msg = error instanceof Error ? error.message : String(error);
          executionStartError ??= msg;
          write(`\n[lingyun] terminal exit-code error: ${msg}\n`);
        }
      );

      const stream = execution.read();

      let buffer = '';
      let captureError: unknown;
      try {
        for await (const rawChunk of stream) {
          const chunk = stripAnsiAndVscodeSequences(rawChunk);
          write(chunk);

          if (!capturePreview) {
            continue;
          }

          const now = Date.now();
          if (captureDeadline > 0 && now > captureDeadline) {
            settlePreview();
            continue;
          }

          buffer += chunk;
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).trimEnd();
            buffer = buffer.slice(newlineIdx + 1);

            if (previewLines.length >= captureLines) {
              settlePreview();
              continue;
            }

            if (previewChars + line.length + 1 > maxPreviewChars) {
              previewTruncated = true;
              settlePreview();
              continue;
            }

            previewLines.push(line);
            previewChars += line.length + 1;

            if (previewLines.length >= captureLines) {
              settlePreview();
            }
          }
        }
      } catch (error) {
        captureError = error;
      } finally {
        settlePreview();
        if (previewTimer) clearTimeout(previewTimer);
      }

      if (captureError) {
        const msg = captureError instanceof Error ? captureError.message : String(captureError);
        write(`\n[lingyun] terminal output capture error: ${msg}\n`);
      }

      try {
        record.logStream.end();
      } catch {
        // ignore
      }

      const current = getBackgroundJob(scope, key);
      if (current && current.id === jobState.id && !isPidAlive(current.pid)) {
        removeBackgroundJob(scope, key);
        this.closeRecord(recordId, record, { disposeTerminal: true });
      }
    };

    void startOutputLoop();

    const pid =
      process.platform === 'win32'
        ? await waitForTerminalPid(terminal, args.pidTimeoutMs)
        : await waitForPidFile(pidFilePath, args.pidTimeoutMs);
    const previewText = await previewReady;

    if (!executionExitObserved && typeof pid === 'number') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, BACKGROUND_STARTUP_EXIT_GRACE_MS);
        timer.unref?.();
      });
    }

    const buildFailureDetails = (message: string): string => {
      const parts: string[] = [message, `Terminal: ${terminalName}`];
      parts.push(`Log: ${logFilePath}`);
      parts.push(buildAutoStopMessage(ttlMs));
      if (previewText) {
        parts.push('');
        parts.push('Startup output:');
        parts.push(previewText);
        if (previewTruncated) parts.push('\n...(preview truncated; see log for full output)');
      }
      return parts.join('\n');
    };

    if (typeof pid !== 'number') {
      args.context.log(`[Bash bg] Failed to acquire PID terminal="${terminalName}"`);
      this.closeRecord(recordId, record, { disposeTerminal: true, removeJob: true });
      const errorText = buildFailureDetails(
        executionStartError
          ? `Failed to start background command: ${executionStartError}`
          : 'Failed to confirm background command started in the VS Code terminal.'
      );

      return {
        success: false,
        error: errorText,
        metadata: {
          background: true,
          errorCode: TOOL_ERROR_CODES.bash_background_pid_unavailable,
          terminalName,
          logFilePath,
          ttlMs,
          expiresAt: record.expiresAt,
          shellIntegration: true,
          outputText: errorText,
        },
      };
    }

    record.pid = pid;

    const job = registerBackgroundJob({
      scope,
      key,
      command: args.command,
      cwd: args.cwd,
      pid,
      ttlMs,
    });
    jobState.id = job.id;

    if (!isPidAlive(pid)) {
      args.context.log(`[Bash bg] Background command exited before confirmation pid=${pid}`);
      this.closeRecord(recordId, record, { disposeTerminal: true, removeJob: true });
      const errorText = buildFailureDetails(
        executionExitObserved
          ? `Background command exited during startup${typeof executionExitCode === 'number' ? ` with exit code ${executionExitCode}` : ''}.`
          : 'Background command exited before LingYun could confirm it was still running.'
      );

      return {
        success: false,
        error: errorText,
        metadata: {
          background: true,
          errorCode: TOOL_ERROR_CODES.bash_background_pid_unavailable,
          pid,
          terminalName,
          logFilePath,
          ttlMs,
          expiresAt: record.expiresAt,
          shellIntegration: true,
          outputText: errorText,
        },
      };
    }

    if (executionExitObserved) {
      args.context.log(
        `[Bash bg] Background command finished during startup pid=${pid} exit=${String(executionExitCode ?? '')}`
      );
      this.closeRecord(recordId, record, { disposeTerminal: true, removeJob: true });
      const errorText = buildFailureDetails(
        `Background command finished during startup${typeof executionExitCode === 'number' ? ` with exit code ${executionExitCode}` : ''}.`
      );

      return {
        success: false,
        error: errorText,
        metadata: {
          background: true,
          errorCode: TOOL_ERROR_CODES.bash_background_pid_unavailable,
          pid,
          terminalName,
          logFilePath,
          ttlMs,
          expiresAt: record.expiresAt,
          shellIntegration: true,
          outputText: errorText,
        },
      };
    }

    const stopHint = computeStopHint(pid) ?? `Close the terminal "${terminalName}"`;

    const outputParts: string[] = [];
    outputParts.push(
      `Command started in VS Code terminal (background). pid ${pid}.`
    );
    outputParts.push(`Terminal: ${terminalName}`);
    outputParts.push(`Log: ${logFilePath}`);
    if (stopHint) outputParts.push(`To stop: ${stopHint}`);
    outputParts.push(buildAutoStopMessage(ttlMs));
    if (previewText) {
      outputParts.push('');
      outputParts.push('Startup output:');
      outputParts.push(previewText);
      if (previewTruncated) outputParts.push('\n...(preview truncated; see log for full output)');
    }

    return {
      success: true,
      data: outputParts.join('\n'),
      metadata: {
        background: true,
        pid,
        terminalName,
        logFilePath,
        jobId: job.id,
        ttlMs,
        expiresAt: record.expiresAt,
        stopHint,
        previewTruncated,
        shellIntegration: true,
        outputText: outputParts.join('\n'),
      },
    };
  }
}

export const backgroundTerminalManager = new BackgroundTerminalManager();
