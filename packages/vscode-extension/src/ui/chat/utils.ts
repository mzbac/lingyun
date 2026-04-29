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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function extractServerResponseBody(error: unknown): string | undefined {
  const err = asRecord(error);
  const cause = asRecord(err?.cause);
  const data = asRecord(err?.data);
  const causeData = asRecord(cause?.data);
  const candidates: unknown[] = [
    err?.responseBody,
    err?.responseBodyString,
    err?.responseBodyText,
    err?.responseText,
    data?.responseBody,
    err?.data,
    cause?.responseBody,
    cause?.responseBodyString,
    cause?.responseBodyText,
    cause?.responseText,
    causeData?.responseBody,
    cause?.data,
  ];

  for (const candidate of candidates) {
    const raw = stringifyLoose(candidate);
    const text = asMaybeNonEmptyString(raw);
    if (text) return text;
  }

  // Some providers only surface server details in the underlying error message.
  const rawCause = err?.cause;
  const causeMessage = rawCause instanceof Error ? rawCause.message : typeof rawCause === 'string' ? rawCause : undefined;
  return asMaybeNonEmptyString(causeMessage);
}

function getStringField(records: Array<Record<string, unknown> | undefined>, keys: string[]): string | undefined {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function getNumberField(records: Array<Record<string, unknown> | undefined>, keys: string[]): number | undefined {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactKnownSensitiveValues(text: string, records: Array<Record<string, unknown> | undefined>): string {
  let out = text;
  const values = new Set<string>();
  for (const record of records) {
    const modelId = typeof record?.modelId === 'string' ? record.modelId.trim() : '';
    if (modelId) values.add(modelId);
  }

  for (const value of values) {
    out = out.replace(new RegExp(escapeRegex(value), 'g'), '<model>');
  }
  return out;
}

function redactForUser(text: string, records: Array<Record<string, unknown> | undefined>): string {
  return redactSensitive(redactKnownSensitiveValues(text, records));
}

function formatSafeDiagnostic(key: string, value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value === 'number' ? String(Math.ceil(value)) : value;
  const safe = truncateForDebug(redactSensitive(raw), 160);
  return safe ? `${key}=${safe}` : undefined;
}

function getProviderDiagnosticsForUser(records: Array<Record<string, unknown> | undefined>): string {
  const retryAfterMs = getNumberField(records, ['retryAfterMs']);
  const parts = [
    formatSafeDiagnostic('provider', getStringField(records, ['providerId', 'provider'])),
    formatSafeDiagnostic('requestId', getStringField(records, ['requestId'])),
    formatSafeDiagnostic('cfRay', getStringField(records, ['cfRay'])),
    retryAfterMs && retryAfterMs > 0 ? formatSafeDiagnostic('retryAfterMs', retryAfterMs) : undefined,
    formatSafeDiagnostic('code', getStringField(records, ['code', 'errorCode'])),
    formatSafeDiagnostic('type', getStringField(records, ['type', 'errorType'])),
    formatSafeDiagnostic('param', getStringField(records, ['param'])),
  ].filter(Boolean);
  return parts.length ? `\n\nDiagnostics: ${parts.join(' ')}` : '';
}

export function formatErrorForUser(error: unknown, options?: FormatErrorForUserOptions): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const errRecord = asRecord(err);
  const causeRecord = asRecord(errRecord?.cause);
  const records = [errRecord, causeRecord, asRecord(errRecord?.response), asRecord(causeRecord?.response)];
  const name = err.name && err.name !== 'Error' ? err.name : undefined;
  const statusCode = getNumberField(records, ['statusCode', 'status']);
  const urlValue = getStringField(records, ['url']);
  let urlPath: string | undefined;
  if (urlValue) {
    try {
      urlPath = new URL(urlValue).pathname;
    } catch {
      // ignore parse errors
    }
  }
  const code = getStringField(records, ['code', 'errorCode']);
  const causeMessage =
    typeof causeRecord?.message === 'string'
      ? causeRecord.message
      : typeof errRecord?.cause === 'string'
        ? errRecord.cause
        : undefined;

  const meta = [name, code, causeMessage].filter(Boolean).join(' | ');
  const message = err.message || String(error);
  const safeMessage = truncateForDebug(redactForUser(message, records), 2000);
  const safeMeta = truncateForDebug(redactForUser(meta, records), 2000);

  const base = (safeMeta && safeMessage ? `${safeMeta}\n${safeMessage}` : safeMessage || safeMeta || 'Unknown error').trim();
  const diagnostics = getProviderDiagnosticsForUser(records);

  const isApiCallError = name === 'AI_APICallError' || typeof statusCode === 'number';
  if (isApiCallError) {
    const statusLabel = statusCode ? `HTTP ${String(statusCode)}` : 'API call failed';
    const location = urlPath ? ` (${urlPath})` : '';
    const summary = `${statusLabel}${location}${safeMessage ? `: ${safeMessage}` : ''}`.trim();

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
      } else if (options?.llmProviderId === 'codexSubscription') {
        tips.push('Tip: ChatGPT Codex auth expired — click Sign in again in the LingYun chat header and retry.');
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
      ? truncateForDebug(redactForUser(responseBodyRaw, records), MAX_SERVER_RESPONSE_SNIPPET_CHARS)
      : '';

    const responseBlock = responseSnippet
      ? `\n\nServer response (truncated & redacted):\n${responseSnippet}`
      : '';

    return `Server error: ${summary}${diagnostics}${hint}${responseBlock}`.trim();
  }

  const lower = base.toLowerCase();
  const isTimeoutError =
    name === 'TimeoutError' ||
    lower.includes('aborted due to timeout') ||
    lower.includes('operation was aborted due to timeout');

  if (isTimeoutError && !lower.includes('lingyun.llm.timeoutms')) {
    return `${base}${diagnostics}\n\nTip: adjust \`lingyun.llm.timeoutMs\` (set to 0 to disable timeouts, or increase it).`;
  }

  return `${base}${diagnostics}`.trim();
}

export function isCancellationMessage(message: string | undefined): boolean {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed) return false;
  return /agent aborted/i.test(trimmed) || /aborterror/i.test(trimmed);
}

export function isCancellationError(
  error: unknown,
  options?: FormatErrorForUserOptions & { abortRequested?: boolean },
): boolean {
  if (options?.abortRequested) return true;
  return isCancellationMessage(formatErrorForUser(error, options));
}
