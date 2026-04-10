import * as vscode from 'vscode';

import { formatDetailedErrorForDebug, redactSensitive, summarizeErrorForDebug } from './agent/debug';
import { getDebugRedactionLevel, getDebugSettings } from './debugSettings';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function appendLog(
  outputChannel: vscode.OutputChannel | undefined,
  message: string,
  options?: { level?: LogLevel; tag?: string }
): void {
  if (!outputChannel) return;
  const text = typeof message === 'string' ? message.trimEnd() : String(message ?? '');
  if (!text) return;

  const timestamp = new Date().toLocaleTimeString();
  const tag = options?.tag ? String(options.tag).trim() : '';
  const level = options?.level ? String(options.level).trim().toUpperCase() : '';

  const prefixParts = [level ? `[${level}]` : '', tag ? `[${tag}]` : ''].filter(Boolean);
  const prefix = prefixParts.length ? ` ${prefixParts.join(' ')}` : '';
  const redactionLevel = getDebugRedactionLevel();
  const lines = redactSensitive(text, { redactionLevel }).split(/\r?\n/);
  for (const line of lines) {
    outputChannel.appendLine(`[${timestamp}]${prefix} ${line}`);
  }
}

export function appendErrorLog(
  outputChannel: vscode.OutputChannel | undefined,
  message: string,
  error: unknown,
  options?: { tag?: string }
): void {
  const redactionLevel = getDebugRedactionLevel();
  const summary = summarizeErrorForDebug(error, { redactionLevel });
  appendLog(outputChannel, `${message}: ${summary}`, { level: 'error', tag: options?.tag });

  if (!getDebugSettings().details) return;

  const details = formatDetailedErrorForDebug(error, { redactionLevel });
  if (!details) return;

  appendLog(outputChannel, `Details:\n${details}`, { level: 'debug', tag: options?.tag });
}
