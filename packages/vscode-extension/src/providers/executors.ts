import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import type { LookupAddress, LookupOptions } from 'node:dns';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { ToolContext, ToolResult } from '../core/types';
import {
  TOOL_ERROR_CODES,
  buildSafeChildProcessEnv,
  findExternalPathReferencesInShellCommand,
  isUnsandboxableShellCommand,
  isPathInsideWorkspace,
  looksLikeLongRunningServerCommand,
} from '@kooka/core';

export interface ShellExecution {
  type: 'shell';
  script: string;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_WORKSPACE_SHELL_TIMEOUT_MS = 60_000;
const DEFAULT_WORKSPACE_HTTP_TIMEOUT_MS = 30_000;

type PrivateIPv4Block = '0' | '10' | '127' | '169.254' | '172' | '192.168';

function getWorkspaceShellTimeoutMs(execution: ShellExecution): number {
  const cfgValue = vscode.workspace.getConfiguration('lingyun').get<number>(
    'tools.workspaceShell.timeoutMs',
    DEFAULT_WORKSPACE_SHELL_TIMEOUT_MS,
  );
  const cfgTimeout =
    typeof cfgValue === 'number' && Number.isFinite(cfgValue)
      ? Math.max(0, Math.floor(cfgValue))
      : DEFAULT_WORKSPACE_SHELL_TIMEOUT_MS;

  if (typeof execution.timeoutMs !== 'number' || !Number.isFinite(execution.timeoutMs)) {
    return cfgTimeout;
  }
  return Math.max(0, Math.floor(execution.timeoutMs));
}

function getWorkspaceHttpTimeoutMs(): number {
  const cfgValue = vscode.workspace.getConfiguration('lingyun').get<number>(
    'tools.http.timeoutMs',
    DEFAULT_WORKSPACE_HTTP_TIMEOUT_MS,
  );
  if (typeof cfgValue !== 'number' || !Number.isFinite(cfgValue)) {
    return DEFAULT_WORKSPACE_HTTP_TIMEOUT_MS;
  }
  return Math.max(0, Math.floor(cfgValue));
}

function parseIPv4Octet(address: string, start: number, end: number): number | undefined {
  if (start >= end) return undefined;

  let value = 0;
  for (let i = start; i < end; i++) {
    const digit = address.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return undefined;
    value = value * 10 + digit;
    if (value > 255) return undefined;
  }
  return value;
}

function classifyIPv4Address(address: string): PrivateIPv4Block | 'public' | 'invalid' {
  const firstDot = address.indexOf('.');
  if (firstDot <= 0) return 'invalid';
  const secondDot = address.indexOf('.', firstDot + 1);
  if (secondDot <= firstDot + 1) return 'invalid';
  const thirdDot = address.indexOf('.', secondDot + 1);
  if (thirdDot <= secondDot + 1 || thirdDot >= address.length - 1) return 'invalid';
  if (address.indexOf('.', thirdDot + 1) !== -1) return 'invalid';

  const a = parseIPv4Octet(address, 0, firstDot);
  const b = parseIPv4Octet(address, firstDot + 1, secondDot);
  const c = parseIPv4Octet(address, secondDot + 1, thirdDot);
  const d = parseIPv4Octet(address, thirdDot + 1, address.length);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return 'invalid';

  if (a === 10) return '10';
  if (a === 127) return '127';
  if (a === 169 && b === 254) return '169.254';
  if (a === 172 && b >= 16 && b <= 31) return '172';
  if (a === 192 && b === 168) return '192.168';
  if (a === 0) return '0';
  return 'public';
}

function isPrivateIPv4Address(address: string): boolean {
  return classifyIPv4Address(address) !== 'public';
}

function isPrivateIPv6Address(address: string): boolean {
  const lowered = address.toLowerCase();
  if (lowered === '::1' || lowered.startsWith('::ffff:127.') || lowered === '::') return true;
  if (lowered.startsWith('fc') || lowered.startsWith('fd')) return true; // unique local
  if (lowered.startsWith('fe8') || lowered.startsWith('fe9') || lowered.startsWith('fea') || lowered.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  return false;
}

function isPrivateIpAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4Address(address);
  if (family === 6) return isPrivateIPv6Address(address);
  return true;
}

async function validateResolvedHost(hostname: string): Promise<{ valid: false; error: string } | { valid: true; records: LookupAddress[] }> {
  const host = hostname.toLowerCase();
  const ipFamily = net.isIP(host);
  if (ipFamily > 0) {
    if (isPrivateIpAddress(host)) {
      return { valid: false, error: `Requests to private or loopback addresses are not allowed (${hostname})` };
    }
    return { valid: true, records: [{ address: host, family: ipFamily }] };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) {
      return { valid: false, error: `Could not resolve hostname: ${hostname}` };
    }
    for (const record of records) {
      if (isPrivateIpAddress(record.address)) {
        return {
          valid: false,
          error: `Requests to hosts resolving to private or loopback addresses are not allowed (${hostname})`,
        };
      }
    }
    return { valid: true, records };
  } catch {
    return { valid: false, error: `Could not resolve hostname: ${hostname}` };
  }
}

type PinnedLookupOptions = LookupOptions & { all?: boolean };
type PinnedLookupCallback = {
  (error: NodeJS.ErrnoException | null, address: string, family: number): void;
  (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]): void;
};

function createPinnedLookup(records: LookupAddress[]) {
  return (_hostname: string, options: PinnedLookupOptions | PinnedLookupCallback, callback?: PinnedLookupCallback): void => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    if (!cb) return;

    const requestedFamily = opts.family === 'IPv4' ? 4 : opts.family === 'IPv6' ? 6 : opts.family;
    const candidates = requestedFamily ? records.filter(record => record.family === requestedFamily) : records;
    const selected = candidates[0];
    if (!selected) {
      cb(Object.assign(new Error('No validated address available for host'), { code: 'ENOTFOUND' }), '', 0);
      return;
    }

    if (opts.all) {
      cb(null, candidates);
      return;
    }

    cb(null, selected.address, selected.family);
  };
}

export async function executeShell(
  execution: ShellExecution,
  context: ToolContext
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const workspaceRoot = context.workspaceFolder?.fsPath;
    const cwdRaw = execution.cwd || workspaceRoot || process.cwd();
    const cwd = workspaceRoot && !path.isAbsolute(cwdRaw) ? path.resolve(workspaceRoot, cwdRaw) : path.resolve(cwdRaw);

    const allowExternalPaths =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;

    if (!allowExternalPaths && workspaceRoot) {
      const externalRefs = new Set<string>();
      if (!isPathInsideWorkspace(cwd, workspaceRoot)) {
        externalRefs.add(cwd);
      }
      for (const p of findExternalPathReferencesInShellCommand(execution.script, { cwd, workspaceRoot })) {
        externalRefs.add(p);
      }
      if (isUnsandboxableShellCommand(execution.script)) {
        externalRefs.add('<unsandboxable-shell-command>');
      }

      if (externalRefs.size > 0) {
        const blockedPaths = [...externalRefs];
        const blockedPathsMax = 20;
        const blockedPathsTruncated = blockedPaths.length > blockedPathsMax;
        resolve({
          success: false,
          error:
            'External paths are disabled. This shell script references paths outside the current workspace or uses a runtime that cannot be confined to it. ' +
            'Enable lingyun.security.allowExternalPaths to allow external path access.',
          metadata: {
            errorCode: TOOL_ERROR_CODES.external_paths_disabled,
            blockedSettingKey: 'lingyun.security.allowExternalPaths',
            isOutsideWorkspace: true,
            blockedPaths: blockedPaths.slice(0, blockedPathsMax),
            blockedPathsTruncated,
          },
        });
        return;
      }
    }

    const timeoutMs = getWorkspaceShellTimeoutMs(execution);
    if (looksLikeLongRunningServerCommand(execution.script) && timeoutMs === 0) {
      resolve({
        success: false,
        error:
          'This workspace shell script looks long-running and timeout is disabled. ' +
          'Set execution.timeoutMs (or lingyun.tools.workspaceShell.timeoutMs) to run it safely.',
        metadata: { errorCode: TOOL_ERROR_CODES.workspace_shell_requires_timeout },
      });
      return;
    }

    const options: cp.ExecOptions = {
      cwd,
      env: { ...buildSafeChildProcessEnv({ baseEnv: process.env }), ...execution.env },
      maxBuffer: 1024 * 1024,
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    };

    if (execution.shell) {
      options.shell = execution.shell;
    }

    context.log('Executing workspace shell tool');

    const proc = cp.exec(execution.script, options, (error, stdout, stderr) => {
      if (context.cancellationToken.isCancellationRequested) {
        resolve({ success: false, error: 'Cancelled' });
        return;
      }

      const stdoutStr = stdout?.toString() || '';
      const stderrStr = stderr?.toString() || '';

      if (error) {
        if (context.cancellationToken.isCancellationRequested) {
          resolve({ success: false, error: 'Cancelled' });
        } else if (error.killed && timeoutMs > 0) {
          resolve({ success: false, error: `Command timed out after ${timeoutMs} ms` });
        } else {
          resolve({
            success: false,
            error: stderrStr || error.message,
            data: stdoutStr || undefined,
          });
        }
        return;
      }

      let output = stdoutStr;
      let truncated = false;
      if (output.length > 50000) {
        output = output.substring(0, 50000) + '\n...(truncated)';
        truncated = true;
      }

      resolve({
        success: true,
        data: output || 'Command completed successfully',
        metadata: { truncated },
      });
    });

    context.cancellationToken.onCancellationRequested(() => {
      proc.kill('SIGTERM');
    });
  });
}

export interface HttpExecution {
  type: 'http';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function validateHttpUrl(urlString: string): { valid: boolean; error?: string } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, error: `Protocol '${url.protocol}' not allowed. Only HTTP(S) is supported.` };
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]'
  ) {
    return { valid: false, error: 'Requests to localhost are not allowed' };
  }

  if (net.isIP(hostname) === 4) {
    switch (classifyIPv4Address(hostname)) {
      case '10':
        return { valid: false, error: 'Requests to private networks (10.x.x.x) are not allowed' };
      case '172':
        return { valid: false, error: 'Requests to private networks (172.16-31.x.x) are not allowed' };
      case '192.168':
        return { valid: false, error: 'Requests to private networks (192.168.x.x) are not allowed' };
      case '169.254':
        return { valid: false, error: 'Requests to link-local addresses are not allowed' };
      case '127':
        return { valid: false, error: 'Requests to loopback addresses are not allowed' };
    }
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    return { valid: false, error: 'Requests to .local/.localhost domains are not allowed' };
  }

  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.gcp.internal'
  ) {
    return { valid: false, error: 'Requests to cloud metadata endpoints are not allowed' };
  }

  return { valid: true };
}

export async function executeHttp(
  execution: HttpExecution,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const urlValidation = validateHttpUrl(execution.url);
  if (!urlValidation.valid) {
    return {
      success: false,
      error: urlValidation.error,
    };
  }

  const resolvedHostValidation = await validateResolvedHost(new URL(execution.url).hostname);
  if (!resolvedHostValidation.valid) {
    return {
      success: false,
      error: resolvedHostValidation.error,
    };
  }

  let timedOut = false;
  let timeoutId: NodeJS.Timeout | undefined;
  let dispatcher: Agent | undefined;

  try {
    const method = execution.method || 'GET';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...execution.headers,
    };

    context.log(`HTTP ${method} request`);

    const options: NonNullable<Parameters<typeof undiciFetch>[1]> = {
      method,
      headers,
    };

    if (method !== 'GET' && method !== 'HEAD') {
      if (execution.body) {
        let body = execution.body;
        for (const [key, value] of Object.entries(args)) {
          body = body.replaceAll(`\${arg:${key}}`, JSON.stringify(value));
        }
        options.body = body;
      } else {
        options.body = JSON.stringify(args);
      }
    }

    const controller = new AbortController();
    const timeoutMs = getWorkspaceHttpTimeoutMs();

    context.cancellationToken.onCancellationRequested(() => {
      controller.abort();
    });

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      timeoutId.unref?.();
    }

    options.signal = controller.signal;
    options.redirect = 'error';

    dispatcher = new Agent({
      connect: {
        lookup: createPinnedLookup(resolvedHostValidation.records),
      },
    });

    const response = await undiciFetch(execution.url, {
      ...options,
      dispatcher,
    });

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        data,
      };
    }

    return {
      success: true,
      data,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: timedOut ? 'Request timed out' : 'Request cancelled' };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await dispatcher?.close();
  }
}
