import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import type { ToolContext, ToolResult } from '../core/types';
import { findExternalPathReferencesInShellCommand, isPathInsideWorkspace } from '@kooka/core';

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

function isPrivateIPv4Address(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
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

async function validateResolvedHost(hostname: string): Promise<{ valid: boolean; error?: string }> {
  const host = hostname.toLowerCase();
  const ipFamily = net.isIP(host);
  if (ipFamily > 0) {
    if (isPrivateIpAddress(host)) {
      return { valid: false, error: `Requests to private or loopback addresses are not allowed (${hostname})` };
    }
    return { valid: true };
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
          error: `Requests to hosts resolving to private or loopback addresses are not allowed (${hostname} -> ${record.address})`,
        };
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `Could not resolve hostname: ${hostname}` };
  }
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

      if (externalRefs.size > 0) {
        const blockedPaths = [...externalRefs];
        const blockedPathsMax = 20;
        const blockedPathsTruncated = blockedPaths.length > blockedPathsMax;
        resolve({
          success: false,
          error:
            'External paths are disabled. This shell script references paths outside the current workspace. ' +
            'Enable lingyun.security.allowExternalPaths to allow external path access.',
          metadata: {
            errorType: 'external_paths_disabled',
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
        metadata: { errorType: 'workspace_shell_requires_timeout' },
      });
      return;
    }

    const options: cp.ExecOptions = {
      cwd,
      env: { ...process.env, ...execution.env },
      maxBuffer: 1024 * 1024,
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    };

    if (execution.shell) {
      options.shell = execution.shell;
    }

    context.log(`Executing: ${execution.script}`);

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

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, error: `Protocol '${url.protocol}' not allowed. Only HTTP(S) is supported.` };
  }

  const hostname = url.hostname.toLowerCase();

  const localhostPatterns = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '[::1]',
  ];
  if (localhostPatterns.includes(hostname)) {
    return { valid: false, error: 'Requests to localhost are not allowed' };
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    const [a, b] = octets;

    if (a === 10) {
      return { valid: false, error: 'Requests to private networks (10.x.x.x) are not allowed' };
    }

    if (a === 172 && b >= 16 && b <= 31) {
      return { valid: false, error: 'Requests to private networks (172.16-31.x.x) are not allowed' };
    }

    if (a === 192 && b === 168) {
      return { valid: false, error: 'Requests to private networks (192.168.x.x) are not allowed' };
    }

    if (a === 169 && b === 254) {
      return { valid: false, error: 'Requests to link-local addresses are not allowed' };
    }

    if (a === 127) {
      return { valid: false, error: 'Requests to loopback addresses are not allowed' };
    }
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    return { valid: false, error: 'Requests to .local/.localhost domains are not allowed' };
  }

  const metadataHosts = [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.gcp.internal',
  ];
  if (metadataHosts.includes(hostname)) {
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

  try {
    const method = execution.method || 'GET';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...execution.headers,
    };

    context.log(`HTTP ${method} ${execution.url}`);

    const options: RequestInit = {
      method,
      headers,
    };

    if (method !== 'GET' && method !== 'HEAD') {
      if (execution.body) {
        let body = execution.body;
        for (const [key, value] of Object.entries(args)) {
          body = body.replace(new RegExp(`\\$${key}`, 'g'), JSON.stringify(value));
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

    const response = await fetch(execution.url, options);

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
  }
}
