import * as vscode from 'vscode';

import { appendErrorLog } from '../../core/logger';
import type { WebviewCrashPayload } from './webviewProtocol';

const UNKNOWN_WEBVIEW_CLIENT_ID = '<unknown>';

/**
 * Browser-side fatal crash reports can arrive while the webview is partially initialized or
 * already failing. This module owns two invariants for that boundary:
 * - payloads are normalized before they reach logs so callers do not duplicate protocol logic;
 * - the user-facing crash toast is deduped per webview client instance, not per controller.
 */

export type WebviewCrashState = {
  outputChannel?: vscode.OutputChannel;
  webviewClientInstanceId?: string;
  webviewCrashToastClientId?: string;
};

export function getWebviewCrashToastMessage(): string {
  return 'LingYun chat UI crashed. Open “Developer: Open Webview Developer Tools” to see details.';
}

export function normalizeWebviewCrashPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : undefined;
  const stack = typeof record.stack === 'string' ? record.stack : undefined;
  const name = typeof record.name === 'string' ? record.name : undefined;
  const source = typeof record.source === 'string' ? record.source : undefined;
  const kind = typeof record.kind === 'string' ? record.kind : undefined;

  return {
    ...(kind ? { kind } : {}),
    ...(source ? { source } : {}),
    ...(name ? { name } : {}),
    ...(message ? { message } : {}),
    ...(stack ? { stack } : {}),
  } satisfies WebviewCrashPayload;
}

export function resetWebviewCrashToastState(state: { webviewCrashToastClientId?: string }): void {
  state.webviewCrashToastClientId = undefined;
}

export function handleWebviewCrashMessage(state: WebviewCrashState, payload: unknown): void {
  appendErrorLog(state.outputChannel, 'Webview error', normalizeWebviewCrashPayload(payload), { tag: 'Webview' });
  if (!shouldShowWebviewCrashToast(state)) {
    return;
  }

  state.webviewCrashToastClientId = getCurrentWebviewClientId(state);
  void vscode.window.showErrorMessage(getWebviewCrashToastMessage());
}

function shouldShowWebviewCrashToast(state: WebviewCrashState): boolean {
  return state.webviewCrashToastClientId !== getCurrentWebviewClientId(state);
}

function getCurrentWebviewClientId(state: Pick<WebviewCrashState, 'webviewClientInstanceId'>): string {
  const clientId =
    typeof state.webviewClientInstanceId === 'string' && state.webviewClientInstanceId.trim()
      ? state.webviewClientInstanceId.trim()
      : '';
  return clientId || UNKNOWN_WEBVIEW_CLIENT_ID;
}
