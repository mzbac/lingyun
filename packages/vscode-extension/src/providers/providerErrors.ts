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

export function headersToRecord(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of headers.entries()) out[key] = value;
  return out;
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

  const text = getErrorChain(error)
    .map((item) => {
      const record = asRecord(item);
      return [
        getErrorMessage(item),
        typeof record?.responseBody === 'string' ? record.responseBody : '',
        typeof record?.body === 'string' ? record.body : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return /\b(?:401|403)\b|unauthori[sz]ed|forbidden|invalid token|expired token|token expired/i.test(text);
}

export function createProviderHttpError(params: {
  message: string;
  url: string;
  response: Response;
  responseBody: string;
}): Error {
  const headers = headersToRecord(params.response.headers);
  const error = new Error(params.message);
  Object.assign(error, {
    status: params.response.status,
    statusCode: params.response.status,
    statusText: params.response.statusText,
    url: params.url,
    responseBody: params.responseBody,
    responseHeaders: headers,
    headers,
  });
  return error;
}
