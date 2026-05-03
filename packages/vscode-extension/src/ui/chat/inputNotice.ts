export interface ChatInputNoticePostTarget {
  postMessage(message: unknown): void;
}

export interface ChatInputNoticeWebviewApiTarget {
  webviewApi: ChatInputNoticePostTarget;
}

export function postInputNotice(target: ChatInputNoticePostTarget, message: string): void {
  const normalized = typeof message === 'string' ? message.trim() : '';
  if (!normalized) return;
  target.postMessage({ type: 'inputNotice', message: normalized });
}

export function postWebviewInputNotice(target: ChatInputNoticeWebviewApiTarget, message: string): void {
  postInputNotice(target.webviewApi, message);
}
