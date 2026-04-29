function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeAssign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && !value.trim()) return;
  if (target[key] !== undefined) return;
  assignDiagnosticField(target, key, value);
}

const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._-]+/gi;
const BASIC_AUTH_REGEX = /Basic\s+[A-Za-z0-9+/=]+/gi;
const OPENAI_API_KEY_REGEX = /\bsk-[A-Za-z0-9_-]{6,}\b/g;
const JSON_SECRET_KV_REGEX =
  /("(?:authorization|proxy-authorization|proxyauthorization|apikey|api_key|x-api-key|token|access_token|accesstoken|refresh_token|refreshtoken|secret|client_secret|clientsecret|password|passwd|cookie|set-cookie|private_key|privatekey)"\s*:\s*)"[^"]*"/gi;
const INLINE_SECRET_KV_REGEX =
  /\b(authorization|proxy-authorization|proxyauthorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|cookie|set-cookie|private[-_]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const BRACKETED_IPV6_REGEX = /\[(?:[0-9a-f]{0,4}:){1,7}[0-9a-f]{0,4}\](?::\d{1,5})?/gi;
const LOCALHOST_REGEX = /\blocalhost\b(?::\d{1,5})?/gi;
const LOCAL_DOMAIN_REGEX = /\b(?:[a-z0-9-]+\.)+(?:local|localhost)\b(?::\d{1,5})?/gi;
const PRIVATE_DOMAIN_REGEX = /\b(?:[a-z0-9-]+\.)+(?:internal|lan|corp|home)\b(?::\d{1,5})?/gi;

const SENSITIVE_RESPONSE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'openai-api-key',
  'x-error-json',
]);

function normalizeHeaderName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function safeHeaderValue(name: string, value: string): string {
  return SENSITIVE_RESPONSE_HEADER_NAMES.has(normalizeHeaderName(name)) ? '<redacted>' : value;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeResponseBody(value: string, knownSensitiveValues: string[] = []): string {
  let out = String(value ?? '');
  out = out.replace(BEARER_REGEX, 'Bearer <redacted>');
  out = out.replace(BASIC_AUTH_REGEX, 'Basic <redacted>');
  out = out.replace(OPENAI_API_KEY_REGEX, 'sk-<redacted>');
  out = out.replace(JSON_SECRET_KV_REGEX, '$1"<redacted>"');
  out = out.replace(INLINE_SECRET_KV_REGEX, '$1$2<redacted>');
  for (const rawValue of knownSensitiveValues) {
    const sensitiveValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!sensitiveValue) continue;
    out = out.replace(new RegExp(escapeRegex(sensitiveValue), 'g'), '<model>');
  }
  out = out.replace(LOCAL_DOMAIN_REGEX, '<local-host>');
  out = out.replace(PRIVATE_DOMAIN_REGEX, '<private-host>');
  out = out.replace(LOCALHOST_REGEX, '<local-host>');
  out = out.replace(BRACKETED_IPV6_REGEX, '<ip>');
  out = out.replace(IPV4_REGEX, (match) => (isPrivateIpv4(match) ? '<private-ip>' : match));
  return out;
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

function assignDiagnosticField(target: Record<string, unknown>, key: string, value: unknown): void {
  try {
    target[key] = value;
    if (target[key] === value) return;
  } catch {
    // Some native errors expose diagnostic fields as read-only accessors.
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(target, key, {
        value,
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        writable: true,
      });
    }
  } catch {
    // Best-effort only; annotating provider errors must never fail while sanitizing diagnostics.
  }
}

function sanitizedHeaderRecord(headers: unknown): Record<string, string> | undefined {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headersToRecord(headers);
  if (!isRecord(headers)) return undefined;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    const name = String(key || '').trim();
    if (!name) continue;
    const text = Array.isArray(value) ? value.map((item) => String(item)).join(', ') : String(value);
    out[name] = safeHeaderValue(name, text);
  }
  return out;
}

function sanitizeProviderDiagnosticFields(
  error: unknown,
  knownSensitiveValues: string[],
  seen = new Set<unknown>(),
): void {
  if (!isRecord(error) || seen.has(error)) return;
  seen.add(error);

  for (const key of PROVIDER_DIAGNOSTIC_STRING_KEYS) {
    const value = error[key];
    if (typeof value === 'string') {
      assignDiagnosticField(error, key, sanitizeResponseBody(value, knownSensitiveValues));
    }
  }

  for (const key of ['headers', 'responseHeaders']) {
    const headers = sanitizedHeaderRecord(error[key]);
    if (headers) assignDiagnosticField(error, key, headers);
  }

  for (const nested of [
    error.cause,
    error.error,
    error.data,
    error.response,
  ]) {
    sanitizeProviderDiagnosticFields(nested, knownSensitiveValues, seen);
  }
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    const record = isRecord(current) ? current : undefined;
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : record?.cause;
  }

  return chain;
}

function getFirstString(error: unknown, keys: string[]): string | undefined {
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  for (const item of errorChain(error)) {
    const record = isRecord(item) ? item : undefined;
    const data = isRecord(record?.data) ? record.data : undefined;
    const nestedError = isRecord(record?.error) ? record.error : undefined;
    const dataError = isRecord(data?.error) ? data.error : undefined;

    for (const source of [record, data, nestedError, dataError]) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) {
        if (!normalized.has(key.toLowerCase())) continue;
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
  }
  return undefined;
}

function getFirstNumber(error: unknown, keys: string[]): number | undefined {
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  for (const item of errorChain(error)) {
    const record = isRecord(item) ? item : undefined;
    const response = isRecord(record?.response) ? record.response : undefined;
    const data = isRecord(record?.data) ? record.data : undefined;

    for (const source of [record, response, data]) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) {
        if (!normalized.has(key.toLowerCase())) continue;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim()) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }
      }
    }
  }
  return undefined;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [headerKey, headerValue] of headers.entries()) out[headerKey] = safeHeaderValue(headerKey, headerValue);
  return out;
}

function normalizeHeaderRecord(headers: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    const name = String(key || '').trim();
    if (!name) continue;
    const text = Array.isArray(value) ? value.map((item) => String(item)).join(', ') : String(value);
    out[name] = safeHeaderValue(name, text);
  }
  return out;
}

function getHeaderValue(headers: Record<string, unknown> | undefined, names: string[]): string | undefined {
  if (!headers) return undefined;
  const normalized = new Set(names.map(normalizeHeaderName));
  for (const [key, value] of Object.entries(headers)) {
    if (!normalized.has(normalizeHeaderName(key))) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim());
      if (typeof first === 'string') return first.trim();
    }
  }
  return undefined;
}

function requestIdFromHeaders(headers: Record<string, unknown> | undefined): string | undefined {
  return getHeaderValue(headers, [
    'x-request-id',
    'request-id',
    'x-github-request-id',
    'x-openai-request-id',
    'x-oai-request-id',
    'openai-request-id',
    'x-ms-request-id',
    'apim-request-id',
    'cf-ray',
  ]);
}

function cfRayFromHeaders(headers: Record<string, unknown> | undefined): string | undefined {
  return getHeaderValue(headers, ['cf-ray']);
}

function parseRetryResetMs(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    const now = Date.now();
    if (parsed > 1_000_000_000_000) {
      const delta = parsed - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    if (parsed > 1_000_000_000) {
      const delta = parsed * 1000 - now;
      return delta > 0 ? Math.ceil(delta) : undefined;
    }
    return Math.ceil(parsed * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.ceil(delta);
  }

  return undefined;
}

function parseRetryAfterMs(headers: Record<string, unknown> | undefined): number | undefined {
  const retryAfterMs = getHeaderValue(headers, ['retry-after-ms']);
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }

  const retryAfter = getHeaderValue(headers, ['retry-after']);
  if (retryAfter) {
    const parsed = parseRetryResetMs(retryAfter);
    if (parsed !== undefined) return parsed;
  }

  return (
    parseRetryResetMs(getHeaderValue(headers, ['x-ratelimit-reset'])) ??
    parseRetryResetMs(getHeaderValue(headers, ['x-rate-limit-reset'])) ??
    parseRetryResetMs(getHeaderValue(headers, ['ratelimit-reset']))
  );
}

function getRecordFromSources(
  sources: Array<Record<string, unknown> | undefined>,
  keys: string[],
): Record<string, unknown> | undefined {
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (!normalized.has(key.toLowerCase())) continue;
      if (typeof Headers !== 'undefined' && value instanceof Headers) return headersToRecord(value);
      if (isRecord(value)) return value;
    }
  }
  return undefined;
}

function getRootRecord(error: unknown, keys: string[]): Record<string, unknown> | undefined {
  const record = isRecord(error) ? error : undefined;
  const response = isRecord(record?.response) ? record.response : undefined;
  const data = isRecord(record?.data) ? record.data : undefined;
  return getRecordFromSources([record, response, data], keys);
}

function getFirstRecord(error: unknown, keys: string[]): Record<string, unknown> | undefined {
  for (const item of errorChain(error)) {
    const record = isRecord(item) ? item : undefined;
    const response = isRecord(record?.response) ? record.response : undefined;
    const data = isRecord(record?.data) ? record.data : undefined;
    const found = getRecordFromSources([record, response, data], keys);
    if (found) return found;
  }
  return undefined;
}

function errorMetadata(error: unknown, params: ChatModelErrorContext): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const status = getFirstNumber(error, ['status', 'statusCode']);
  const statusCode = getFirstNumber(error, ['statusCode', 'status']);
  const responseHeadersRaw = getRootRecord(error, ['responseHeaders']) ?? getRootRecord(error, ['headers']) ?? getFirstRecord(error, ['responseHeaders']) ?? getFirstRecord(error, ['headers']);
  const headersRaw = getRootRecord(error, ['headers']) ?? getRootRecord(error, ['responseHeaders']) ?? getFirstRecord(error, ['headers']) ?? getFirstRecord(error, ['responseHeaders']);
  const responseHeaders = normalizeHeaderRecord(responseHeadersRaw);
  const headers = normalizeHeaderRecord(headersRaw);
  const diagnosticHeaders = responseHeadersRaw ?? headersRaw;
  const responseBody = getFirstString(error, ['responseBody', 'body']);
  const knownSensitiveValues = [params.modelId];

  safeAssign(metadata, 'url', getFirstString(error, ['url']));
  safeAssign(metadata, 'status', status);
  safeAssign(metadata, 'statusCode', statusCode);
  safeAssign(metadata, 'statusText', getFirstString(error, ['statusText']));
  safeAssign(metadata, 'responseBody', responseBody ? sanitizeResponseBody(responseBody, knownSensitiveValues) : undefined);
  safeAssign(metadata, 'responseHeaders', responseHeaders);
  safeAssign(metadata, 'headers', headers);
  safeAssign(metadata, 'requestId', getFirstString(error, ['requestId']) ?? requestIdFromHeaders(diagnosticHeaders));
  safeAssign(metadata, 'cfRay', getFirstString(error, ['cfRay']) ?? cfRayFromHeaders(diagnosticHeaders));
  safeAssign(metadata, 'retryAfterMs', getFirstNumber(error, ['retryAfterMs']) ?? parseRetryAfterMs(diagnosticHeaders));
  safeAssign(metadata, 'code', getFirstString(error, ['code', 'errorCode']));
  safeAssign(metadata, 'errorCode', getFirstString(error, ['errorCode', 'code']));
  safeAssign(metadata, 'type', getFirstString(error, ['type', 'errorType']));
  safeAssign(metadata, 'errorType', getFirstString(error, ['errorType', 'type']));
  safeAssign(metadata, 'param', getFirstString(error, ['param']));

  return metadata;
}

export type ChatModelErrorContext = {
  provider: string;
  providerId?: string;
  modelId: string;
};

export function attachChatModelErrorMetadata(error: unknown, params: ChatModelErrorContext): unknown {
  if (!isRecord(error)) return error;

  const knownSensitiveValues = [params.modelId];
  sanitizeProviderDiagnosticFields(error, knownSensitiveValues);

  // Always stamp LingYun's provider/model context. Upstream SDK errors may use
  // their own provider/model fields, but downstream retry/auth/UI handling needs
  // the LingYun provider id and resolved model selected by this client layer.
  assignDiagnosticField(error, 'provider', params.provider);
  assignDiagnosticField(error, 'providerId', params.providerId ?? params.provider);
  assignDiagnosticField(error, 'modelId', params.modelId);

  const metadata = errorMetadata(error, params);
  for (const [key, value] of Object.entries(metadata)) {
    // Header fields may come from upstream SDK errors and can include secrets.
    // Replace them with normalized/redacted copies before downstream UI/debug code sees them.
    if ((key === 'responseHeaders' || key === 'headers') && isRecord(value)) {
      assignDiagnosticField(error, key, value);
      continue;
    }
    if (key === 'responseBody' && typeof value === 'string') {
      // Upstream AI SDK errors may already carry a raw responseBody/body. Replace it
      // with a scrubbed copy so retry/debug/UI code never sees tokens or private hosts.
      assignDiagnosticField(error, 'responseBody', value);
      if (typeof error.body === 'string') {
        assignDiagnosticField(error, 'body', sanitizeResponseBody(error.body, [params.modelId]));
      }
      continue;
    }
    safeAssign(error, key, value);
  }
  return error;
}

type ChatModelStreamResult = {
  stream?: ReadableStream<ChatModelStreamPart>;
  [key: string]: unknown;
};

type ChatModelStreamPart = {
  type?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

type ChatModelLike = {
  specificationVersion?: unknown;
  provider?: unknown;
  modelId?: unknown;
  doGenerate?: (options: unknown) => PromiseLike<unknown>;
  doStream?: (options: unknown) => PromiseLike<ChatModelStreamResult>;
  [key: string]: unknown;
};

function attachStreamErrorMetadata(stream: ReadableStream<ChatModelStreamPart>, params: ChatModelErrorContext): ReadableStream<ChatModelStreamPart> {
  const reader = stream.getReader();
  let released = false;

  const releaseReader = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  };

  return new ReadableStream<ChatModelStreamPart>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          releaseReader();
          controller.close();
          return;
        }

        if (value?.type === 'error') {
          attachChatModelErrorMetadata(value.error, params);
        }
        controller.enqueue(value);
      } catch (error) {
        releaseReader();
        controller.error(attachChatModelErrorMetadata(error, params));
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // ignore
      } finally {
        releaseReader();
      }
    },
  });
}

export function wrapChatModelErrors<T>(model: T, params: ChatModelErrorContext): T {
  if (!isRecord(model)) return model;
  if (model.specificationVersion !== 'v3' || typeof model.doStream !== 'function') return model;

  const original = model as ChatModelLike;
  const originalDoGenerate = typeof original.doGenerate === 'function' ? original.doGenerate.bind(original) : undefined;
  const originalDoStream = (original.doStream as NonNullable<ChatModelLike['doStream']>).bind(original);

  const wrapped: ChatModelLike = {
    ...original,
    provider: typeof original.provider === 'string' && original.provider.trim() ? original.provider : params.provider,
    modelId: typeof original.modelId === 'string' && original.modelId.trim() ? original.modelId : params.modelId,
    async doGenerate(options: unknown) {
      if (!originalDoGenerate) throw new Error('Language model does not support doGenerate');
      try {
        return await originalDoGenerate(options);
      } catch (error) {
        throw attachChatModelErrorMetadata(error, params);
      }
    },
    async doStream(options: unknown): Promise<ChatModelStreamResult> {
      try {
        const result = await originalDoStream(options);
        if (!result?.stream || typeof result.stream.getReader !== 'function') return result;
        return {
          ...result,
          stream: attachStreamErrorMetadata(result.stream, params),
        };
      } catch (error) {
        throw attachChatModelErrorMetadata(error, params);
      }
    },
  };

  return wrapped as T;
}
