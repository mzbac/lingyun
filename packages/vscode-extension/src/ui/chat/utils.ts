import * as path from 'path';
import * as vscode from 'vscode';

import { getPrimaryWorkspaceFolderUri } from '../../core/workspaceContext';
import { redactSensitive, truncateForDebug } from '../../core/agent/debug';

export function getNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function cleanAssistantPreamble(text: string): string {
  return (text || '').replace(/[ \t]+$/g, '');
}

export function formatWorkspacePathForUI(rawPath?: string): string | undefined {
  const value = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!value) return undefined;

  const workspace = getPrimaryWorkspaceFolderUri();
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

export type FormatErrorForUserOptions = {
  llmProviderId?: string;
};

const MAX_SERVER_RESPONSE_SNIPPET_CHARS = 2000;

function asMaybeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringifyLoose(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) {
    try {
      return Buffer.from(value).toString('utf8');
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function extractServerResponseBody(error: unknown): string | undefined {
  const err = error as any;
  const candidates: unknown[] = [
    err?.responseBody,
    err?.responseBodyString,
    err?.responseBodyText,
    err?.responseText,
    err?.data?.responseBody,
    err?.data,
    err?.cause?.responseBody,
    err?.cause?.responseBodyString,
    err?.cause?.responseBodyText,
    err?.cause?.responseText,
    err?.cause?.data?.responseBody,
    err?.cause?.data,
  ];

  for (const candidate of candidates) {
    const raw = stringifyLoose(candidate);
    const text = asMaybeNonEmptyString(raw);
    if (text) return text;
  }

  // Some providers only surface server details in the underlying error message.
  const cause = err?.cause;
  const causeMessage = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined;
  return asMaybeNonEmptyString(causeMessage);
}

export function formatErrorForUser(error: unknown, options?: FormatErrorForUserOptions): string {
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
      const usedResponses = urlPath?.includes('/responses');
      tips.push(
        usedResponses
          ? 'Tip: this usually means the server endpoint is wrong. Ensure your base URL ends with `/v1` and the server supports `POST /v1/responses`.'
          : 'Tip: this usually means the server endpoint is wrong. Ensure your base URL ends with `/v1` and the server supports `POST /v1/chat/completions`.',
      );
    } else if (statusCode === 401 || statusCode === 403) {
      if (options?.llmProviderId === 'copilot') {
        tips.push('Tip: GitHub Copilot auth expired — please sign in again and retry.');
      } else if (options?.llmProviderId === 'openaiCompatible') {
        tips.push(
          'Tip: check authentication. Ensure the env var configured by `lingyun.openaiCompatible.apiKeyEnv` is set (or disable auth on the server).',
        );
      } else {
        tips.push('Tip: check authentication/authorization and retry.');
      }
    } else if (statusCode === 429) {
      tips.push('Tip: the server is rate limiting requests. Try again later or reduce concurrency.');
    } else if (typeof statusCode === 'number' && statusCode >= 500) {
      tips.push('Tip: the server returned an internal error. Check the server logs for details.');
    }

    const hint = tips.length > 0 ? `\n\n${tips.join('\n')}` : '';

    const includeServerResponse =
      options?.llmProviderId === 'openaiCompatible' && (!urlValue || !/githubcopilot\.com/i.test(urlValue));
    const responseBodyRaw = includeServerResponse ? extractServerResponseBody(error) : undefined;
    const responseSnippet = responseBodyRaw
      ? truncateForDebug(redactSensitive(responseBodyRaw), MAX_SERVER_RESPONSE_SNIPPET_CHARS)
      : '';

    const responseBlock = responseSnippet
      ? `\n\nServer response (truncated & redacted):\n${responseSnippet}`
      : '';

    return `Server error: ${summary}${hint}${responseBlock}`.trim();
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
