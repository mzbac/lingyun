import type * as vscode from 'vscode';

import { redactSensitive, summarizeErrorForDebug } from './agent/debug';

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
  outputChannel.appendLine(`[${timestamp}]${prefix} ${redactSensitive(text)}`);
}

export function appendErrorLog(
  outputChannel: vscode.OutputChannel | undefined,
  message: string,
  error: unknown,
  options?: { tag?: string }
): void {
  const summary = summarizeErrorForDebug(error);
  appendLog(outputChannel, `${message}: ${summary}`, { level: 'error', tag: options?.tag });
}

