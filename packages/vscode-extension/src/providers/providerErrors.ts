import { Buffer } from 'node:buffer';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { redactSensitive, truncateForDebug } from '../core/agent/debug';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asStatusCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);

    const record = asRecord(current);
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : record?.cause;
  }

  return chain;
}

function getErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || String(error);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const SENSITIVE_RESPONSE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'openai-api-key',
  // This header is a base64-encoded JSON error payload. Keep decoded safe fields
  // separately and avoid logging the raw payload, which may grow to include details.
  'x-error-json',
]);

function normalizeHeaderName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function safeHeaderValue(name: string, value: string): string {
  return SENSITIVE_RESPONSE_HEADER_NAMES.has(normalizeHeaderName(name)) ? '<redacted>' : value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactKnownProviderValue(text: string, value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return text;
  return text.replace(new RegExp(escapeRegex(trimmed), 'g'), '<model>');
}

function sanitizeProviderDiagnosticText(text: string, modelId?: string): string {
  return redactKnownProviderValue(redactSensitive(text), modelId);
}

function formatProviderResponseBody(responseBody: string, options?: { redact?: boolean; modelId?: string }): string {
  if (options?.redact) return '<redacted>';
  if (!responseBody) return '';
  return sanitizeProviderDiagnosticText(responseBody, options?.modelId);
}

const PROVIDER_DIAGNOSTIC_STRING_KEYS = [
  'message',
  'stack',
  'responseBody',
  'body',
  'detail',
  'details',
  'description',
  'error_description',
  'errorDescription',
];

function sanitizeProviderDiagnosticRecord(
  value: unknown,
  modelId: string | undefined,
  seen = new Set<unknown>(),
): unknown {
  if (typeof value === 'string') return sanitizeProviderDiagnosticText(value, modelId);
  const record = asRecord(value);
  if (!record || seen.has(record)) return value;
  seen.add(record);

  for (const key of PROVIDER_DIAGNOSTIC_STRING_KEYS) {
    const field = record[key];
    if (typeof field !== 'string') continue;
    try {
      record[key] = sanitizeProviderDiagnosticText(field, modelId);
    } catch {
      // Some native errors expose diagnostic fields (for example DOMException.message)
      // as read-only accessors. Cause sanitization is best-effort and must never
      // prevent provider errors from being wrapped with structured metadata.
    }
  }

  for (const key of ['headers', 'responseHeaders']) {
    const headers = asRecord(record[key]);
    if (!headers) continue;
    const sanitizedHeaders: Record<string, string> = {};
    for (const [headerName, headerValue] of Object.entries(headers)) {
      if (typeof headerValue === 'string') sanitizedHeaders[headerName] = safeHeaderValue(headerName, headerValue);
    }
    try {
      record[key] = sanitizedHeaders;
    } catch {
      // Best-effort only; keep the original cause object when the field is read-only.
    }
  }

  for (const nested of [record.cause, record.error, record.data, record.response]) {
    sanitizeProviderDiagnosticRecord(nested, modelId, seen);
  }

  return value;
}

export function sanitizeProviderDiagnosticCause(cause: unknown, modelId?: string): unknown {
  return sanitizeProviderDiagnosticRecord(cause, modelId);
}

export function headersToRecord(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of headers.entries()) out[key] = safeHeaderValue(key, value);
  return out;
}

export type ProviderResponseMetadata = {
  responseHeaders: Record<string, string>;
  headers: Record<string, string>;
  requestId?: string;
  cfRay?: string;
  retryAfterMs?: number;
};

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function looksLikeErrorCode(value: string | undefined): value is string {
  return Boolean(value && /^[a-z][a-z0-9._-]*$/i.test(value));
}

function extractBodyErrorDetails(responseBody: string): {
  message?: string;
  code?: string;
  type?: string;
  param?: string;
} {
  const root = parseJsonObject(responseBody);
  const data = asRecord(root?.data);
  const rootError = root?.error;
  const dataError = data?.error;
  const rootErrorString = typeof rootError === 'string' ? asNonEmptyString(rootError) : undefined;
  const dataErrorString = typeof dataError === 'string' ? asNonEmptyString(dataError) : undefined;
  const nested = asRecord(rootError) ?? asRecord(dataError) ?? data ?? root;
  return {
    message:
      asNonEmptyString(nested?.message) ??
      asNonEmptyString(data?.message) ??
      asNonEmptyString(root?.message) ??
      asNonEmptyString(nested?.error_description) ??
      asNonEmptyString(nested?.errorDescription) ??
      asNonEmptyString(data?.error_description) ??
      asNonEmptyString(data?.errorDescription) ??
      asNonEmptyString(root?.error_description) ??
      asNonEmptyString(root?.errorDescription) ??
      rootErrorString ??
      dataErrorString,
    code:
      asNonEmptyString(nested?.code) ??
      asNonEmptyString(nested?.error_code) ??
      asNonEmptyString(nested?.errorCode) ??
      asNonEmptyString(data?.code) ??
      asNonEmptyString(data?.error_code) ??
      asNonEmptyString(data?.errorCode) ??
      asNonEmptyString(root?.code) ??
      asNonEmptyString(root?.error_code) ??
      asNonEmptyString(root?.errorCode) ??
      (looksLikeErrorCode(rootErrorString) ? rootErrorString : undefined) ??
      (looksLikeErrorCode(dataErrorString) ? dataErrorString : undefined),
    type:
      asNonEmptyString(nested?.type) ??
      asNonEmptyString(nested?.error_type) ??
      asNonEmptyString(nested?.errorType) ??
      asNonEmptyString(data?.type) ??
      asNonEmptyString(data?.error_type) ??
      asNonEmptyString(data?.errorType) ??
      asNonEmptyString(root?.type) ??
      asNonEmptyString(root?.error_type) ??
      asNonEmptyString(root?.errorType),
    param: asNonEmptyString(nested?.param) ?? asNonEmptyString(data?.param) ?? asNonEmptyString(root?.param),
  };
}

export function requestIdFromHeaders(headers: Record<string, string>): string | undefined {
  return (
    headers['x-request-id'] ||
    headers['request-id'] ||
    headers['x-github-request-id'] ||
    headers['x-openai-request-id'] ||
    headers['x-oai-request-id'] ||
    headers['openai-request-id'] ||
    headers['x-ms-request-id'] ||
    headers['apim-request-id'] ||
    headers['cf-ray'] ||
    undefined
  );
}

function cfRayFromHeaders(headers: Record<string, string>): string | undefined {
  return headers['cf-ray'] || undefined;
}

function parseRetryResetMs(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    const now = Date.now();
    // Common provider reset headers use epoch seconds. Accept epoch milliseconds too.
    if (parsed > 1_000_000_000_000) {
      const delta = parsed - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    if (parsed > 1_000_000_000) {
      const delta = parsed * 1000 - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    // Some gateways use the same delta-seconds semantics as Retry-After.
    return Math.ceil(parsed * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.ceil(delta);
  }

  return undefined;
}

function parseRetryAfterMs(headers: Record<string, string>): number | undefined {
  const retryAfterMs = headers['retry-after-ms'];
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }

  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const parsed = parseRetryResetMs(retryAfter);
    if (parsed !== undefined) return parsed;
  }

  return (
    parseRetryResetMs(headers['x-ratelimit-reset']) ??
    parseRetryResetMs(headers['x-rate-limit-reset']) ??
    parseRetryResetMs(headers['ratelimit-reset'])
  );
}

export function createProviderResponseMetadata(headersInput: Headers | undefined): ProviderResponseMetadata {
  const headers = headersToRecord(headersInput);
  const retryAfterMs = parseRetryAfterMs(headers);
  return {
    responseHeaders: headers,
    headers,
    ...(requestIdFromHeaders(headers) ? { requestId: requestIdFromHeaders(headers) } : {}),
    ...(cfRayFromHeaders(headers) ? { cfRay: cfRayFromHeaders(headers) } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function getRecordString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  return asNonEmptyString(record?.[key]);
}

function getFirstRecordString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getRecordString(record, key);
    if (value) return value;
  }
  return undefined;
}

function decodeBase64JsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return asRecord(JSON.parse(Buffer.from(value.trim(), 'base64').toString('utf8')));
  } catch {
    return undefined;
  }
}

function extractIdentityErrorJson(encoded: string | undefined): {
  code?: string;
  type?: string;
  message?: string;
} {
  const root = decodeBase64JsonObject(encoded);
  const error = asRecord(root?.error);
  const data = asRecord(root?.data);
  const dataError = asRecord(data?.error);
  const nested = error ?? dataError ?? data ?? root;
  return {
    code:
      getFirstRecordString(nested, ['code', 'error_code', 'errorCode']) ??
      getFirstRecordString(root, ['code', 'error_code', 'errorCode']),
    type:
      getFirstRecordString(nested, ['type', 'error_type', 'errorType']) ??
      getFirstRecordString(root, ['type', 'error_type', 'errorType']),
    message:
      getFirstRecordString(nested, ['message', 'error_description', 'errorDescription']) ??
      getFirstRecordString(root, ['message', 'error_description', 'errorDescription']),
  };
}

function extractIdentityAuthHeaderDetails(headers: Headers | undefined, modelId?: string): {
  authorizationError?: string;
  identityErrorCode?: string;
  identityErrorType?: string;
  identityErrorMessage?: string;
} {
  const authorizationError = asNonEmptyString(headers?.get('x-openai-authorization-error'));
  const errorJson = extractIdentityErrorJson(headers?.get('x-error-json') ?? undefined);
  return {
    ...(authorizationError ? { authorizationError } : {}),
    ...(errorJson.code ? { identityErrorCode: errorJson.code } : {}),
    ...(errorJson.type ? { identityErrorType: errorJson.type } : {}),
    ...(errorJson.message ? { identityErrorMessage: truncateForDebug(sanitizeProviderDiagnosticText(errorJson.message, modelId), 500) } : {}),
  };
}

const STRUCTURED_AUTH_ERROR_VALUES = new Set([
  'access_denied',
  'auth_error',
  'authentication_error',
  'expired_token',
  'forbidden',
  'invalid_api_key',
  'invalid_authentication',
  'invalid_grant',
  'invalid_refresh_token',
  'invalid_token',
  'refresh_token_expired',
  'refresh_token_invalid',
  'refresh_token_revoked',
  'revoked_token',
  'token_expired',
  'token_revoked',
  'missing_api_key',
  'missing_authorization',
  'missing_authorization_header',
  'permission_denied',
  'unauthenticated',
  'unauthorized',
]);

function normalizeStructuredErrorValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function hasStructuredAuthErrorValue(error: unknown): boolean {
  for (const item of getErrorChain(error)) {
    const record = asRecord(item);
    const data = asRecord(record?.data);
    const nestedError = asRecord(record?.error);
    const dataError = asRecord(data?.error);

    for (const source of [record, data, nestedError, dataError]) {
      for (const key of [
        'code',
        'type',
        'error_code',
        'error_type',
        'errorCode',
        'errorType',
        'authorizationError',
        'identityAuthorizationError',
        'identityErrorCode',
        'identityErrorType',
      ]) {
        const value = getRecordString(source, key);
        if (value && STRUCTURED_AUTH_ERROR_VALUES.has(normalizeStructuredErrorValue(value))) {
          return true;
        }
      }
    }
  }

  return false;
}

export function getProviderStatusCode(error: unknown): number | undefined {
  for (const item of getErrorChain(error)) {
    const record = asRecord(item);
    const response = asRecord(record?.response);
    const status = asStatusCode(record?.status) ?? asStatusCode(record?.statusCode) ?? asStatusCode(response?.status);
    if (status !== undefined) return status;
  }
  return undefined;
}

export function isProviderAuthError(error: unknown): boolean {
  const statusCode = getProviderStatusCode(error);
  if (statusCode === 401 || statusCode === 403) return true;
  if (hasStructuredAuthErrorValue(error)) return true;

  const text = getErrorChain(error)
    .map((item) => {
      const record = asRecord(item);
      const data = asRecord(record?.data);
      const nestedError = asRecord(record?.error);
      const dataError = asRecord(data?.error);
      return [
        getErrorMessage(item),
        getRecordString(record, 'code'),
        getRecordString(record, 'type'),
        getRecordString(record, 'errorCode'),
        getRecordString(record, 'errorType'),
        getRecordString(record, 'authorizationError'),
        getRecordString(record, 'identityAuthorizationError'),
        getRecordString(record, 'identityErrorCode'),
        getRecordString(record, 'identityErrorType'),
        getRecordString(nestedError, 'code'),
        getRecordString(nestedError, 'type'),
        getRecordString(nestedError, 'errorCode'),
        getRecordString(nestedError, 'errorType'),
        getRecordString(nestedError, 'message'),
        typeof record?.error === 'string' ? record.error : '',
        getRecordString(data, 'code'),
        getRecordString(data, 'type'),
        getRecordString(data, 'errorCode'),
        getRecordString(data, 'errorType'),
        getRecordString(dataError, 'code'),
        getRecordString(dataError, 'type'),
        getRecordString(dataError, 'errorCode'),
        getRecordString(dataError, 'errorType'),
        getRecordString(dataError, 'message'),
        typeof data?.error === 'string' ? data.error : '',
        typeof record?.responseBody === 'string' ? record.responseBody : '',
        typeof record?.body === 'string' ? record.body : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return /\b(?:http|status(?:code| code)?)\s*[:=]?\s*40[13]\b|unauthori[sz]ed|forbidden|invalid[_ -]?api[_ -]?key|invalid[_ -]?token|expired[_ -]?token|token expired|invalid_grant/i.test(text);
}

export async function readProviderResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function createProviderHttpError(params: {
  message: string;
  url: string;
  response: Response;
  responseBody: string;
  provider?: string;
  providerId?: string;
  modelId?: string;
  redactResponseBody?: boolean;
}): Error {
  const headers = headersToRecord(params.response.headers);
  const bodyError = extractBodyErrorDetails(params.responseBody);
  const identityAuth = extractIdentityAuthHeaderDetails(params.response.headers, params.modelId);
  const statusText = params.response.statusText || '';
  const statusLabel = `HTTP ${params.response.status}${statusText ? ` ${statusText}` : ''}`;
  const serverMessage = !params.redactResponseBody && bodyError.message ? ` - ${sanitizeProviderDiagnosticText(bodyError.message, params.modelId)}` : '';
  const error = new Error(`${params.message}: ${statusLabel}${serverMessage}`);
  error.name = 'ProviderHttpError';
  Object.assign(error, {
    status: params.response.status,
    statusCode: params.response.status,
    statusText,
    url: params.url,
    responseBody: formatProviderResponseBody(params.responseBody, { redact: params.redactResponseBody, modelId: params.modelId }),
    responseHeaders: headers,
    headers,
    requestId: requestIdFromHeaders(headers),
    cfRay: cfRayFromHeaders(headers),
    retryAfterMs: parseRetryAfterMs(headers),
    ...(identityAuth.authorizationError ? { authorizationError: identityAuth.authorizationError, identityAuthorizationError: identityAuth.authorizationError } : {}),
    ...(identityAuth.identityErrorCode ? { identityErrorCode: identityAuth.identityErrorCode } : {}),
    ...(identityAuth.identityErrorType ? { identityErrorType: identityAuth.identityErrorType } : {}),
    ...(identityAuth.identityErrorMessage ? { identityErrorMessage: identityAuth.identityErrorMessage } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.providerId ? { providerId: params.providerId } : params.provider ? { providerId: params.provider } : {}),
    ...(params.modelId ? { modelId: params.modelId } : {}),
    ...(bodyError.code ? { code: bodyError.code, errorCode: bodyError.code } : {}),
    ...(bodyError.type ? { type: bodyError.type, errorType: bodyError.type } : {}),
    ...(bodyError.param ? { param: bodyError.param } : {}),
  });
  return error;
}

function getErrorNameFromChain(error: unknown): string | undefined {
  for (const item of getErrorChain(error)) {
    const name = item instanceof Error ? item.name : asNonEmptyString(asRecord(item)?.name);
    if (name) return name;
  }
  return undefined;
}

function getErrorCodeFromChain(error: unknown): string | undefined {
  for (const item of getErrorChain(error)) {
    const record = asRecord(item);
    const code = asNonEmptyString(record?.code) ?? asNonEmptyString(record?.errorCode);
    if (code) return code;
  }
  return undefined;
}

function errorChainText(error: unknown): string {
  return getErrorChain(error)
    .map((item) => {
      const record = asRecord(item);
      return [
        item instanceof Error ? item.name : asNonEmptyString(record?.name),
        getErrorMessage(item),
        asNonEmptyString(record?.code),
        asNonEmptyString(record?.errorCode),
        asNonEmptyString(record?.type),
        asNonEmptyString(record?.errorType),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

function isTimeoutLikeError(error: unknown): boolean {
  return /\b(?:TimeoutError|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT|request_timeout|timed? ?out|timeout)\b/i.test(
    errorChainText(error),
  );
}

function isAbortLikeError(error: unknown): boolean {
  return /\b(?:AbortError|AbortSignal|request_aborted|aborted|abort)\b/i.test(errorChainText(error));
}

export function isProviderAbortError(error: unknown): boolean {
  return !isTimeoutLikeError(error) && isAbortLikeError(error);
}

export type ProviderTransportErrorClassification = { code: string; type: string };

export function classifyProviderTransportError(cause: unknown): ProviderTransportErrorClassification {
  const causeCode = getErrorCodeFromChain(cause);
  if (isTimeoutLikeError(cause)) {
    return { code: causeCode || 'request_timeout', type: 'timeout' };
  }
  if (isAbortLikeError(cause)) {
    return { code: causeCode || 'request_aborted', type: 'aborted' };
  }
  return { code: causeCode || 'network_error', type: 'network_error' };
}

function isStructuredProviderError(error: unknown): boolean {
  const name = getErrorNameFromChain(error);
  return (
    name === 'ProviderHttpError' ||
    name === 'ProviderParseError' ||
    name === 'ProviderValidationError' ||
    name === 'ProviderFetchError' ||
    name === 'ResponsesStreamError' ||
    getProviderStatusCode(error) !== undefined
  );
}

export function createProviderFetchError(params: {
  message: string;
  url: string;
  cause: unknown;
  provider?: string;
  providerId?: string;
  modelId?: string;
}): Error {
  const classification = classifyProviderTransportError(params.cause);
  const causeMessage = getErrorMessage(params.cause).trim() || 'request failed';
  const safeCause = sanitizeProviderDiagnosticCause(params.cause, params.modelId);
  const error = new Error(`${params.message}: ${sanitizeProviderDiagnosticText(causeMessage, params.modelId)}`);
  error.name = 'ProviderFetchError';
  Object.assign(error, {
    cause: safeCause,
    url: params.url,
    code: classification.code,
    errorCode: classification.code,
    type: classification.type,
    errorType: classification.type,
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.providerId ? { providerId: params.providerId } : params.provider ? { providerId: params.provider } : {}),
    ...(params.modelId ? { modelId: params.modelId } : {}),
  });
  return error;
}

export async function fetchProviderResponse(
  fetchFn: FetchFunction,
  input: string | URL | Request,
  init: RequestInit | undefined,
  params: {
    message: string;
    url: string;
    provider?: string;
    providerId?: string;
    modelId?: string;
  },
): Promise<Response> {
  try {
    return await fetchFn(input, init);
  } catch (cause) {
    if (isStructuredProviderError(cause)) throw cause;
    throw createProviderFetchError({ ...params, cause });
  }
}

function createProviderParseError(params: {
  message: string;
  url: string;
  response: Response;
  responseBody: string;
  cause?: unknown;
  provider?: string;
  providerId?: string;
  modelId?: string;
}): Error {
  const headers = headersToRecord(params.response.headers);
  const statusText = params.response.statusText || '';
  const statusLabel = `HTTP ${params.response.status}${statusText ? ` ${statusText}` : ''}`;
  const error = new Error(`${params.message}: invalid JSON response (${statusLabel})`);
  error.name = 'ProviderParseError';
  Object.assign(error, {
    status: params.response.status,
    statusCode: params.response.status,
    statusText,
    url: params.url,
    responseBody: formatProviderResponseBody(params.responseBody, { modelId: params.modelId }),
    responseHeaders: headers,
    headers,
    requestId: requestIdFromHeaders(headers),
    cfRay: cfRayFromHeaders(headers),
    retryAfterMs: parseRetryAfterMs(headers),
    code: 'invalid_json',
    errorCode: 'invalid_json',
    type: 'invalid_response',
    errorType: 'invalid_response',
    ...(params.cause !== undefined ? { parseErrorName: params.cause instanceof Error ? params.cause.name : typeof params.cause } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.providerId ? { providerId: params.providerId } : params.provider ? { providerId: params.provider } : {}),
    ...(params.modelId ? { modelId: params.modelId } : {}),
  });
  return error;
}

export function createProviderValidationError(params: {
  message: string;
  url: string;
  response: Response;
  responseBody: string;
  validationMessage: string;
  provider?: string;
  providerId?: string;
  modelId?: string;
  code?: string;
  type?: string;
}): Error {
  const headers = headersToRecord(params.response.headers);
  const statusText = params.response.statusText || '';
  const statusLabel = `HTTP ${params.response.status}${statusText ? ` ${statusText}` : ''}`;
  const code = params.code || 'invalid_response_payload';
  const type = params.type || 'invalid_response';
  const validationMessage = sanitizeProviderDiagnosticText(params.validationMessage, params.modelId);
  const error = new Error(`${params.message}: invalid response payload (${statusLabel}) - ${validationMessage}`);
  error.name = 'ProviderValidationError';
  Object.assign(error, {
    status: params.response.status,
    statusCode: params.response.status,
    statusText,
    url: params.url,
    responseBody: formatProviderResponseBody(params.responseBody, { modelId: params.modelId }),
    responseHeaders: headers,
    headers,
    requestId: requestIdFromHeaders(headers),
    cfRay: cfRayFromHeaders(headers),
    retryAfterMs: parseRetryAfterMs(headers),
    validationMessage,
    code,
    errorCode: code,
    type,
    errorType: type,
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.providerId ? { providerId: params.providerId } : params.provider ? { providerId: params.provider } : {}),
    ...(params.modelId ? { modelId: params.modelId } : {}),
  });
  return error;
}

export async function parseProviderJsonResponse<T>(params: {
  message: string;
  url: string;
  response: Response;
  provider?: string;
  providerId?: string;
  modelId?: string;
  redactResponseBody?: boolean;
  validate?: (value: unknown) => string | undefined;
}): Promise<T> {
  let responseBody = '';
  try {
    responseBody = await params.response.text();
  } catch (cause) {
    throw createProviderParseError({
      ...params,
      responseBody: params.redactResponseBody ? '<redacted>' : responseBody,
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch (cause) {
    throw createProviderParseError({
      ...params,
      responseBody: params.redactResponseBody ? '<redacted>' : responseBody,
      cause,
    });
  }

  let validationMessage: string | undefined;
  try {
    validationMessage = params.validate?.(parsed);
  } catch (cause) {
    validationMessage = getErrorMessage(cause) || 'response payload validation failed';
  }
  if (validationMessage) {
    throw createProviderValidationError({
      ...params,
      responseBody: params.redactResponseBody ? '<redacted>' : responseBody,
      validationMessage,
    });
  }

  return parsed as T;
}
