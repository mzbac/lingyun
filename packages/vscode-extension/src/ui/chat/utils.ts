import * as path from 'path';
import * as vscode from 'vscode';

export function getNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function cleanAssistantPreamble(text: string): string {
  return (text || '').replace(/[ \t]+$/g, '');
}

export function formatWorkspacePathForUI(rawPath?: string): string | undefined {
  const value = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!value) return undefined;

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspace || workspace.scheme !== 'file') {
    return value.replace(/\\/g, '/');
  }

  let fsPath = value;
  if (value.startsWith('file://')) {
    try {
      fsPath = vscode.Uri.parse(value).fsPath;
    } catch {
      fsPath = value;
    }
  }

  try {
    const root = path.resolve(workspace.fsPath);
    const abs = path.isAbsolute(fsPath) ? path.resolve(fsPath) : path.resolve(root, fsPath);
    const rel = path.relative(root, abs);
    const isInside = rel && rel !== '.' && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (isInside) return rel.replace(/\\/g, '/');
  } catch {
    // ignore
  }

  return value.replace(/\\/g, '/');
}

export function formatErrorForUser(error: unknown): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const errRecord = err as Error & { statusCode?: unknown; url?: unknown; code?: unknown; cause?: unknown };
  const causeRecord =
    errRecord.cause && typeof errRecord.cause === 'object'
      ? (errRecord.cause as Record<string, unknown>)
      : undefined;
  const name = err.name && err.name !== 'Error' ? err.name : undefined;
  const statusCode =
    typeof errRecord.statusCode === 'number'
      ? errRecord.statusCode
      : typeof causeRecord?.statusCode === 'number'
        ? causeRecord.statusCode
        : undefined;
  const urlValue =
    typeof errRecord.url === 'string'
      ? errRecord.url
      : typeof causeRecord?.url === 'string'
        ? causeRecord.url
        : undefined;
  let urlPath: string | undefined;
  if (urlValue) {
    try {
      urlPath = new URL(urlValue).pathname;
    } catch {
      // ignore parse errors
    }
  }
  const code =
    typeof errRecord.code === 'string'
      ? errRecord.code
      : typeof causeRecord?.code === 'string'
        ? causeRecord.code
        : undefined;
  const causeMessage =
    typeof causeRecord?.message === 'string'
      ? causeRecord.message
      : typeof errRecord.cause === 'string'
        ? errRecord.cause
        : undefined;

  const meta = [name, code, causeMessage].filter(Boolean).join(' | ');
  const message = err.message || String(error);

  const base = (meta && message ? `${meta}\n${message}` : message || meta || 'Unknown error').trim();

  const isApiCallError = name === 'AI_APICallError' || typeof statusCode === 'number';
  if (isApiCallError) {
    const statusLabel = statusCode ? `HTTP ${String(statusCode)}` : 'API call failed';
    const location = urlPath ? ` (${urlPath})` : '';
    const summary = `${statusLabel}${location}${message ? `: ${message}` : ''}`.trim();

    const tips: string[] = [];
    if (statusCode === 404) {
      tips.push(
        'Tip: this usually means the server endpoint is wrong. Ensure your base URL ends with `/v1` and the server supports `POST /v1/chat/completions`.',
      );
    } else if (statusCode === 401 || statusCode === 403) {
      tips.push(
        'Tip: check authentication. Ensure the env var configured by `lingyun.openaiCompatible.apiKeyEnv` is set (or disable auth on the server).',
      );
    } else if (statusCode === 429) {
      tips.push('Tip: the server is rate limiting requests. Try again later or reduce concurrency.');
    } else if (typeof statusCode === 'number' && statusCode >= 500) {
      tips.push('Tip: the server returned an internal error. Check the server logs for details.');
    }

    const hint = tips.length > 0 ? `\n\n${tips.join('\n')}` : '';
    return `Server error: ${summary}${hint}`.trim();
  }

  const lower = base.toLowerCase();
  const isTimeoutError =
    name === 'TimeoutError' ||
    lower.includes('aborted due to timeout') ||
    lower.includes('operation was aborted due to timeout');

  if (isTimeoutError && !lower.includes('lingyun.llm.timeoutms')) {
    return `${base}\n\nTip: adjust \`lingyun.llm.timeoutMs\` (set to 0 to disable timeouts, or increase it).`;
  }

  return base;
}
