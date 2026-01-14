import * as assert from 'assert';

export type LingyunE2EConfig = {
  baseURL: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxOutputTokens: number;
  largeMinChars: number;
  enableToolCalls: boolean;
};

function parseEnvBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}

function parseEnvInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function normalizeBaseURL(input: string): string {
  return String(input || '').trim().replace(/\/+$/, '');
}

function authHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 0;
  const timeoutFn = (AbortSignal as any)?.timeout;
  const timeoutSignal = timeoutMs > 0 && typeof timeoutFn === 'function' ? timeoutFn(timeoutMs) : undefined;
  const signal = timeoutSignal ?? init.signal;
  return fetch(url, { ...init, ...(signal ? { signal } : {}) });
}

async function resolveOpenAICompatibleBaseURL(baseURL: string, apiKey?: string, timeoutMs?: number): Promise<string> {
  const trimmed = normalizeBaseURL(baseURL);
  if (!trimmed) {
    throw new Error('LINGYUN_E2E_BASE_URL is required');
  }

  const candidates = trimmed.endsWith('/v1') ? [trimmed] : [trimmed, `${trimmed}/v1`];

  for (const candidate of candidates) {
    try {
      const res = await fetchWithTimeout(`${candidate}/models`, {
        method: 'GET',
        headers: { accept: 'application/json', ...authHeaders(apiKey) },
        timeoutMs,
      });
      // Treat 401/403 as "endpoint exists but requires auth"; 404 likely means wrong base URL prefix.
      if (res.ok || res.status === 401 || res.status === 403) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error('Unable to reach OpenAI-compatible /models endpoint for the configured base URL.');
}

async function fetchModelIds(params: { baseURL: string; apiKey?: string; timeoutMs?: number }): Promise<string[]> {
  const res = await fetchWithTimeout(`${params.baseURL}/models`, {
    method: 'GET',
    headers: { accept: 'application/json', ...authHeaders(params.apiKey) },
    timeoutMs: params.timeoutMs,
  });

  if (!res.ok) {
    throw new Error(`Model listing failed (status ${res.status}).`);
  }

  const json = await res.json().catch(() => null);
  const data = json && typeof json === 'object' ? (json as any).data : null;
  if (!Array.isArray(data)) return [];
  return data.map((m) => String(m?.id || '')).filter(Boolean);
}

export async function loadLingyunE2EConfig(): Promise<LingyunE2EConfig | null> {
  const baseURLRaw = process.env.LINGYUN_E2E_BASE_URL;
  if (!baseURLRaw || !String(baseURLRaw).trim()) {
    return null;
  }

  const timeoutMs = Math.max(0, parseEnvInt('LINGYUN_E2E_TIMEOUT_MS', 300_000));
  const apiKey = process.env.LINGYUN_E2E_API_KEY?.trim() || undefined;
  const baseURL = await resolveOpenAICompatibleBaseURL(String(baseURLRaw), apiKey, timeoutMs);

  const explicitModel = process.env.LINGYUN_E2E_MODEL?.trim();
  let model = explicitModel || '';
  if (!model) {
    const ids = await fetchModelIds({ baseURL, apiKey, timeoutMs });
    model = ids[0] || '';
  }

  assert.ok(model, 'No model id available. Set LINGYUN_E2E_MODEL (or ensure GET /models works).');

  const maxOutputTokens = Math.max(256, parseEnvInt('LINGYUN_E2E_MAX_OUTPUT_TOKENS', 4096));
  const largeMinChars = Math.max(1000, parseEnvInt('LINGYUN_E2E_LARGE_MIN_CHARS', 8000));
  const enableToolCalls = parseEnvBool('LINGYUN_E2E_ENABLE_TOOLCALLS', true);

  return {
    baseURL,
    model,
    apiKey,
    timeoutMs,
    maxOutputTokens,
    largeMinChars,
    enableToolCalls,
  };
}
