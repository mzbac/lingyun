/**
 * Extension-side contract for the subset of browser -> extension webview messages that
 * the crash and init handshake paths depend on.
 *
 * Parsers here are intentionally forgiving: the browser may be half-initialized or
 * mid-crash when it posts a message, so malformed payloads should be normalized at this
 * boundary instead of leaking shape checks into callers.
 */
export const WEBVIEW_MESSAGE_READY = 'ready';
export const WEBVIEW_MESSAGE_INIT_ACK = 'initAck';
export const WEBVIEW_MESSAGE_ERROR = 'webviewError';
export const WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST = 'transcriptHistoryRequest';
export const WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE = 'transcriptHistoryPage';

const MAX_TRANSCRIPT_HISTORY_ID_LENGTH = 512;

export type WebviewCrashPayload = {
  kind?: string;
  source?: string;
  name?: string;
  message?: string;
  stack?: string;
};

export type WebviewReadyMessage = {
  type: typeof WEBVIEW_MESSAGE_READY;
  clientInstanceId?: string;
};

export type WebviewInitAckMessage = {
  type: typeof WEBVIEW_MESSAGE_INIT_ACK;
  clientInstanceId?: string;
};

export type WebviewErrorMessage = {
  type: typeof WEBVIEW_MESSAGE_ERROR;
  error?: unknown;
};

export type WebviewTranscriptHistoryRequest = {
  type: typeof WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST;
  requestId: number;
  sessionId: string;
  cursor: string;
};

export function getWebviewMessageType(data: unknown): string | undefined {
  const record = asRecord(data);
  return record && typeof record.type === 'string' ? record.type : undefined;
}

export function parseWebviewReadyMessage(data: unknown): WebviewReadyMessage | undefined {
  const record = parseTypedWebviewMessage(data, WEBVIEW_MESSAGE_READY);
  if (!record) {
    return undefined;
  }

  const clientInstanceId = parseWebviewClientInstanceId(record.clientInstanceId);
  return {
    type: WEBVIEW_MESSAGE_READY,
    ...(clientInstanceId ? { clientInstanceId } : {}),
  };
}

export function parseWebviewInitAckMessage(data: unknown): WebviewInitAckMessage | undefined {
  const record = parseTypedWebviewMessage(data, WEBVIEW_MESSAGE_INIT_ACK);
  if (!record) {
    return undefined;
  }

  const clientInstanceId = parseWebviewClientInstanceId(record.clientInstanceId);
  return {
    type: WEBVIEW_MESSAGE_INIT_ACK,
    ...(clientInstanceId ? { clientInstanceId } : {}),
  };
}

export function parseWebviewErrorMessage(data: unknown): WebviewErrorMessage | undefined {
  const record = parseTypedWebviewMessage(data, WEBVIEW_MESSAGE_ERROR);
  if (!record) {
    return undefined;
  }

  return {
    type: WEBVIEW_MESSAGE_ERROR,
    ...('error' in record ? { error: record.error } : {}),
  };
}

export function parseWebviewTranscriptHistoryRequest(
  data: unknown
): WebviewTranscriptHistoryRequest | undefined {
  const record = parseTypedWebviewMessage(data, WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST);
  if (!record) {
    return undefined;
  }

  const requestId = record.requestId;
  const sessionId = parseBoundedNonEmptyString(record.sessionId, MAX_TRANSCRIPT_HISTORY_ID_LENGTH);
  const cursor = parseBoundedNonEmptyString(record.cursor, MAX_TRANSCRIPT_HISTORY_ID_LENGTH);
  if (!Number.isSafeInteger(requestId) || (requestId as number) <= 0 || !sessionId || !cursor) {
    return undefined;
  }

  return {
    type: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
    requestId: requestId as number,
    sessionId,
    cursor,
  };
}

function parseTypedWebviewMessage(data: unknown, type: string): Record<string, unknown> | undefined {
  const record = asRecord(data);
  if (!record || record.type !== type) {
    return undefined;
  }
  return record;
}

function parseWebviewClientInstanceId(value: unknown): string | undefined {
  return parseBoundedNonEmptyString(value);
}

function parseBoundedNonEmptyString(value: unknown, maxLength?: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || (maxLength !== undefined && trimmed.length > maxLength)) return undefined;
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}
