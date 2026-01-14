import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  DEFAULT_BACKGROUND_TTL_MS,
  cleanupDeadBackgroundJobs,
  createBackgroundJobKey,
  getBackgroundJob,
  isPidAlive,
  refreshBackgroundJob,
  registerBackgroundJob,
  removeBackgroundJob,
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
  pidAcquisition?: Promise<void>;
  pidFilePath: string;
  logFilePath: string;
  logStream: fs.WriteStream;
  ttlMs: number;
  expiresAt?: number;
  ttlTimer?: NodeJS.Timeout;
};

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
          this.disposeRecord(id, record);
        }
      }
    });
  }

  private async acquirePidLater(args: {
    recordId: string;
    record: BackgroundTerminalRecord;
    scope: string;
    key: string;
    command: string;
    cwd: string;
    jobState: { jobId?: string; ttlMs?: number; expiresAt?: number };
    timeoutMs: number;
    context: ToolContext;
  }): Promise<void> {
    try {
      const pid =
        process.platform === 'win32'
          ? await waitForTerminalPid(args.record.terminal, args.timeoutMs)
          : await waitForPidFile(args.record.pidFilePath, args.timeoutMs);

      if (typeof pid !== 'number') return;

      const current = this.records.get(args.recordId);
      if (current !== args.record) return;
      if (args.record.terminal.exitStatus) return;
      if (typeof args.record.pid === 'number') return;

      args.record.pid = pid;

      const job = registerBackgroundJob({
        scope: args.scope,
        key: args.key,
        command: args.command,
        cwd: args.cwd,
        pid,
        ttlMs: args.record.ttlMs,
      });
      args.jobState.jobId = job.id;
      args.jobState.ttlMs = job.ttlMs;
      args.jobState.expiresAt = job.expiresAt;

      args.context.log(`[Bash bg] PID acquired pid=${pid} terminal="${args.record.terminalName}"`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      args.context.log(`[Bash bg] PID acquisition failed: ${msg}`);
    } finally {
      const current = this.records.get(args.recordId);
      if (current === args.record) {
        args.record.pidAcquisition = undefined;
      }
    }
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

  private cleanupStaleRecords(scope: string): void {
    cleanupDeadBackgroundJobs(scope);
    for (const [id, record] of this.records) {
      if (record.scope !== scope) continue;
      if (record.terminal.exitStatus) {
        this.disposeRecord(id, record);
        continue;
      }

      if (typeof record.pid === 'number' && !isPidAlive(record.pid)) {
        this.disposeRecord(id, record);
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

    this.cleanupStaleRecords(scope);

    const existingJob = getBackgroundJob(scope, key);
    const existingRecord = this.records.get(recordId);

    if (existingRecord && !existingRecord.terminal.exitStatus) {
      this.refreshRecordTtl(existingRecord, ttlMs);
      const pid = existingRecord.pid;
      const job = pid ? getBackgroundJob(scope, key) : undefined;
      const refreshed = job ? refreshBackgroundJob(scope, key, ttlMs) ?? job : undefined;
      const stopHint = computeStopHint(pid) ?? `Close the terminal "${existingRecord.terminalName}"`;

      return {
        success: true,
        data: pid
          ? `Command already running in background (pid ${pid}). To stop: ${stopHint}`
          : `Command already running in background (terminal "${existingRecord.terminalName}"). To stop: ${stopHint}`,
        metadata: {
          background: true,
          reused: true,
          pid,
          terminalName: existingRecord.terminalName,
          logFilePath: existingRecord.logFilePath,
          jobId: refreshed?.id,
          ttlMs: ttlMs,
          expiresAt: existingRecord.expiresAt,
          stopHint,
          shellIntegration: Boolean(existingRecord.terminal.shellIntegration),
          pidPending: typeof pid !== 'number',
        },
      };
    }

    if (existingJob && isPidAlive(existingJob.pid)) {
      const refreshed =
        refreshBackgroundJob(scope, key, ttlMs) ?? existingJob;
      const stopHint = computeStopHint(existingJob.pid);

      return {
        success: true,
        data: `Command already running in background (pid ${existingJob.pid}).${stopHint ? ` To stop: ${stopHint}` : ''}`,
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
      try {
        existingRecord.terminal.dispose();
      } catch {
        // ignore
      }
      this.disposeRecord(recordId, existingRecord);
    }

    const terminalName = makeTerminalName(args.cwd, key);
    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: args.cwd,
      isTransient: true,
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

    const jobState: { jobId?: string; ttlMs?: number; expiresAt?: number } = {};

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

    this.refreshRecordTtl(record, ttlMs);

    const wrappedCommand =
      process.platform === 'win32'
        ? args.command
        : buildPosixPidWrappedCommand({ command: args.command, pidFilePath });

    if (shellIntegration) {
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
          write(`\n[lingyun] failed to execute command: ${msg}\n`);
          settlePreview();
          if (previewTimer) clearTimeout(previewTimer);
          return;
        }

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
        if (current && current.id === jobState.jobId && !isPidAlive(current.pid)) {
          removeBackgroundJob(scope, key);
        }
      };

      void startOutputLoop();
    } else {
      terminal.sendText(wrappedCommand, true);
      settlePreview();
      if (previewTimer) clearTimeout(previewTimer);
      try {
        record.logStream.write('[lingyun] shell integration unavailable; output not captured\n');
        record.logStream.end();
      } catch {
        // ignore
      }
    }

    const pid =
      process.platform === 'win32'
        ? await waitForTerminalPid(terminal, args.pidTimeoutMs)
        : await waitForPidFile(pidFilePath, args.pidTimeoutMs);
    if (typeof pid === 'number') {
      record.pid = pid;

      const job = registerBackgroundJob({
        scope,
        key,
        command: args.command,
        cwd: args.cwd,
        pid,
        ttlMs,
      });
      jobState.jobId = job.id;
      jobState.ttlMs = job.ttlMs;
      jobState.expiresAt = job.expiresAt;
    } else if (!record.pidAcquisition) {
      const pidRetryTimeoutMs = Math.max(10_000, args.pidTimeoutMs);
      record.pidAcquisition = this.acquirePidLater({
        recordId,
        record,
        scope,
        key,
        command: args.command,
        cwd: args.cwd,
        jobState,
        timeoutMs: pidRetryTimeoutMs,
        context: args.context,
      });
    }

    const stopHint = computeStopHint(pid) ?? `Close the terminal "${terminalName}"`;

    const previewText = await previewReady;

    const outputParts: string[] = [];
    outputParts.push(
      `Command started in VS Code terminal (background).${typeof pid === 'number' ? ` pid ${pid}.` : ''}`
    );
    outputParts.push(`Terminal: ${terminalName}`);
    outputParts.push(
      shellIntegration
        ? `Log: ${logFilePath}`
        : `Log: ${logFilePath} (shell integration unavailable; output not captured)`
    );
    if (stopHint) outputParts.push(`To stop: ${stopHint}`);
    if (typeof pid !== 'number') {
      outputParts.push('');
      outputParts.push(
        ttlMs > 0
          ? `Note: PID not available; auto-stop will close the terminal after ${ttlMs} ms.`
          : 'Note: PID not available; auto-stop is disabled for this background command.'
      );
    }
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
        jobId: jobState.jobId,
        ttlMs: ttlMs,
        expiresAt: record.expiresAt,
        stopHint,
        previewTruncated,
        shellIntegration: Boolean(shellIntegration),
        pidPending: typeof pid !== 'number',
      },
    };
  }
}

export const backgroundTerminalManager = new BackgroundTerminalManager();
