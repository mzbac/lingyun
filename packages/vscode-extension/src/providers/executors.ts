import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { findExternalPathReferencesInShellCommand, isPathInsideWorkspace } from '@lingyun/core';
import type { ToolContext, ToolResult } from '../core/types';

export interface ShellExecution {
  type: 'shell';
  script: string;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
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

    const options: cp.ExecOptions = {
      cwd,
      env: { ...process.env, ...execution.env },
      maxBuffer: 1024 * 1024,
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
        if (error.killed) {
          resolve({ success: false, error: 'Command timed out' });
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

    context.cancellationToken.onCancellationRequested(() => {
      controller.abort();
    });

    options.signal = controller.signal;

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
      return { success: false, error: 'Request cancelled or timed out' };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeInTerminal(
  command: string,
  name?: string
): Promise<ToolResult> {
  const terminal = vscode.window.createTerminal(name || 'Agent Task');
  terminal.show();
  terminal.sendText(command);

  return {
    success: true,
    data: `Command sent to terminal: ${command}`,
  };
}

export async function executeInline(
  code: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const sandbox = {
    args,
    result: undefined as unknown,
    console: {
      log: (...msgs: unknown[]) => context.log(msgs.map(String).join(' ')),
    },
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
  };

  try {
    const fn = new Function(...Object.keys(sandbox), `
      "use strict";
      return (async () => {
        ${code}
        return result;
      })();
    `);

    const result = await fn(...Object.values(sandbox));

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
