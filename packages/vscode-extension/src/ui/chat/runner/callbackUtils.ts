import * as vscode from 'vscode';

import { tryParseSessionSnapshot } from '@kooka/agent-sdk';
import { TOOL_ERROR_CODES, containsBinaryData } from '@kooka/core';
import type { AgentCallbacks, ToolCall, ToolDefinition, ToolResult } from '../../../core/types';
import type { AgentSessionState } from '../../../core/agent';
import { getDebugSettings } from '../../../core/debugSettings';
import { appendErrorLog, appendLog } from '../../../core/logger';
import type { ChatMessage, ChatSessionInfo } from '../types';
import { formatWorkspacePathForUI } from '../utils';
import { createBlankSessionSignals } from '../../../core/sessionSignals';

export type ToolDiffSnapshot = {
  absPath: string;
  displayPath: string;
  beforeText: string;
  afterText: string;
  isExternal: boolean;
  truncated: boolean;
};

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export type TaskChildSessionView = {
  currentTurnId?: string;
  activeSessionId: string;
  messages: ChatMessage[];
  sessions: Map<string, ChatSessionInfo>;
  toolDiffSnapshotsByToolCallId: Map<string, ToolDiffSnapshot>;
  agent: { resolveFileId(fileId: string): string | undefined };
  outputChannel?: vscode.OutputChannel;

  normalizeLoadedSession(raw: ChatSessionInfo): ChatSessionInfo;
  postMessage(message: unknown): void;
  postSessions(): void;
  markSessionDirty(sessionId: string): void;
  flushSessionSave(): Promise<void>;
};

function getTaskToolModelWarning(meta: RecordLike): string | undefined {
  const task = meta.task;
  if (!isRecord(task)) return undefined;
  const warning = typeof task.model_warning === 'string' ? task.model_warning.trim() : '';
  return warning || undefined;
}

function emitWarningMessage(view: Pick<TaskChildSessionView, 'currentTurnId' | 'messages' | 'postMessage'>, warning: string): void {
  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'warning',
    content: warning,
    timestamp: Date.now(),
    turnId: view.currentTurnId,
  };
  view.messages.push(msg);
  view.postMessage({ type: 'message', message: msg });
}

function toAgentSessionStateFromSnapshot(snapshot: ReturnType<typeof tryParseSessionSnapshot>): AgentSessionState {
  if (!snapshot) {
    return { history: [] };
  }

  return {
    history: Array.isArray(snapshot.history) ? (snapshot.history as AgentSessionState['history']) : [],
    ...(snapshot.fileHandles ? { fileHandles: snapshot.fileHandles } : {}),
    ...(snapshot.semanticHandles ? { semanticHandles: snapshot.semanticHandles as AgentSessionState['semanticHandles'] } : {}),
    ...(snapshot.mentionedSkills && snapshot.mentionedSkills.length > 0 ? { mentionedSkills: snapshot.mentionedSkills } : {}),
    ...(snapshot.compactionSyntheticContexts && snapshot.compactionSyntheticContexts.length > 0
      ? { compactionSyntheticContexts: snapshot.compactionSyntheticContexts }
      : {}),
  };
}

type ParsedChildSessionSnapshot = NonNullable<ReturnType<typeof tryParseSessionSnapshot>> & { sessionId: string };

function hasSessionId(snapshot: ReturnType<typeof tryParseSessionSnapshot>): snapshot is ParsedChildSessionSnapshot {
  return typeof snapshot?.sessionId === 'string' && snapshot.sessionId.trim().length > 0;
}

function toChatSessionInfoFromSnapshot(params: {
  snapshot: ParsedChildSessionSnapshot;
  parentSessionIdFallback: string;
  title: string;
}): ChatSessionInfo {
  const now = Date.now();
  return {
    id: params.snapshot.sessionId,
    title: params.title,
    createdAt: now,
    updatedAt: now,
    signals: createBlankSessionSignals(now),
    messages: [],
    agentState: toAgentSessionStateFromSnapshot(params.snapshot),
    currentModel: params.snapshot.modelId || '',
    mode: 'build',
    stepCounter: 0,
    parentSessionId: params.snapshot.parentSessionId || params.parentSessionIdFallback,
    subagentType: params.snapshot.subagentType,
  };
}

function extractTitleFromTaskResult(meta: RecordLike): string | undefined {
  const direct = typeof meta.title === 'string' ? meta.title.trim() : '';
  if (direct) return direct;
  const task = meta.task;
  if (!isRecord(task)) return undefined;
  const desc = typeof task.description === 'string' ? task.description.trim() : '';
  return desc || undefined;
}

export function upsertTaskChildSession(view: TaskChildSessionView, result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const meta = isRecord(result.metadata) ? result.metadata : undefined;
  if (!meta) return undefined;

  const warning = getTaskToolModelWarning(meta);
  if (warning) {
    emitWarningMessage(view, warning);
  }

  const childRaw = meta.childSession;
  const title = extractTitleFromTaskResult(meta) ?? '';

  const snapshot = tryParseSessionSnapshot(childRaw);
  if (!hasSessionId(snapshot)) return undefined;
  const rawSession = toChatSessionInfoFromSnapshot({
    snapshot,
    parentSessionIdFallback: view.activeSessionId,
    title: title || `Task: ${snapshot.subagentType || 'subagent'}`,
  });

  const normalized = view.normalizeLoadedSession(rawSession);
  if (!normalized.parentSessionId) {
    normalized.parentSessionId = view.activeSessionId;
  }
  if (!normalized.subagentType && typeof snapshot.subagentType === 'string' && snapshot.subagentType.trim()) {
    normalized.subagentType = snapshot.subagentType;
  }

  view.sessions.set(normalized.id, normalized);
  view.postSessions();

  view.markSessionDirty(normalized.id);
  void view.flushSessionSave().catch(error => {
    appendErrorLog(view.outputChannel, 'Failed to persist subagent session', error, { tag: 'Sessions' });
  });

  return normalized.id;
}

export function cacheToolDiffSnapshot(
  view: Pick<TaskChildSessionView, 'toolDiffSnapshotsByToolCallId'>,
  toolCallId: string,
  snapshot: ToolDiffSnapshot
): void {
  view.toolDiffSnapshotsByToolCallId.delete(toolCallId);
  view.toolDiffSnapshotsByToolCallId.set(toolCallId, snapshot);
  const maxSnapshots = 20;
  while (view.toolDiffSnapshotsByToolCallId.size > maxSnapshots) {
    const oldestKey = view.toolDiffSnapshotsByToolCallId.keys().next().value as string | undefined;
    if (!oldestKey) break;
    view.toolDiffSnapshotsByToolCallId.delete(oldestKey);
  }
}

export async function readTextFileForDiff(
  uri: vscode.Uri,
  maxBytes: number,
): Promise<{ text: string; skippedReason?: 'too_large' | 'binary' }> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > maxBytes) {
      return { text: '', skippedReason: 'too_large' };
    }
  } catch {
    // missing file -> treat as empty file (created by write/edit)
    return { text: '' };
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (containsBinaryData(bytes)) {
      return { text: '', skippedReason: 'binary' };
    }
    return { text: new TextDecoder().decode(bytes) };
  } catch {
    return { text: '' };
  }
}

type AgentStatusEvent = Parameters<NonNullable<AgentCallbacks['onStatusChange']>>[0];

export function appendDebugLog(view: { outputChannel?: vscode.OutputChannel }, message: string): void {
  const { llm: debugLlm, tools: debugTools } = getDebugSettings();
  if (!debugLlm && !debugTools) return;

  const isTool = typeof message === 'string' && message.startsWith('[Tool]');
  if (isTool && !debugTools) return;
  if (!isTool && !debugLlm) return;
  if (!message) return;

  appendLog(view.outputChannel, message, { level: 'debug' });
}

export function postTurnStatus(view: { postMessage(message: unknown): void }, turnId: string | undefined, status: AgentStatusEvent): void {
  if (!turnId) return;

  if (status.type === 'retry') {
    view.postMessage({
      type: 'turnStatus',
      turnId,
      status: {
        type: 'retry',
        attempt: status.attempt,
        nextRetryTime: status.nextRetryTime,
        message: status.message,
      },
    });
    return;
  }

  if (status.type === 'running') {
    view.postMessage({
      type: 'turnStatus',
      turnId,
      status: { type: 'running', message: status.message || '' },
    });
    return;
  }

  if (status.type === 'error') {
    view.postMessage({
      type: 'turnStatus',
      turnId,
      status: { type: 'error', message: status.message || 'unknown error' },
    });
    return;
  }

  if (status.type === 'done') {
    view.postMessage({
      type: 'turnStatus',
      turnId,
      status: { type: 'done' },
    });
  }
}

export function resolveToolCallUiPath(
  view: { agent: { resolveFileId(fileId: string): string | undefined } },
  tc: ToolCall,
  def?: ToolDefinition,
  options?: { includeWorkdir?: boolean },
): { path: string | undefined; filePathRaw: string | undefined } {
  let filePathRaw: string | undefined;
  let argsRecord: Record<string, unknown> | undefined;
  try {
    const args = JSON.parse(tc.function.arguments || '{}');
    if (args && typeof args === 'object') {
      argsRecord = args as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors
  }

  if (argsRecord && def?.metadata?.permissionPatterns) {
    for (const item of def.metadata.permissionPatterns) {
      if (!item || item.kind !== 'path' || typeof item.arg !== 'string') continue;
      const raw = argsRecord[item.arg];
      if (typeof raw === 'string' && raw.trim()) {
        filePathRaw = raw;
        break;
      }
    }
  }

  if (!filePathRaw && argsRecord) {
    const candidate = (argsRecord as any).filePath ?? (argsRecord as any).path;
    filePathRaw = typeof candidate === 'string' ? candidate : undefined;
  }

  if (!filePathRaw && options?.includeWorkdir && argsRecord) {
    const candidate = (argsRecord as any).workdir;
    filePathRaw = typeof candidate === 'string' ? candidate : undefined;
  }

  if (!filePathRaw && argsRecord && typeof (argsRecord as any).fileId === 'string') {
    filePathRaw = view.agent.resolveFileId(String((argsRecord as any).fileId)) || undefined;
  }

  return {
    path: formatWorkspacePathForUI(filePathRaw),
    filePathRaw,
  };
}

type ToolResultUiHints = {
  outputText?: string;
  diff?: string;
  isProtected: boolean;
  isOutsideWorkspace: boolean;
  blockedSettingKey?: string;
  todos?: unknown[];
};

function extractToolResultUiHints(result: ToolResult): ToolResultUiHints {
  const data = isRecord(result.data) ? result.data : undefined;
  const meta = isRecord(result.metadata) ? result.metadata : undefined;
  return {
    ...(typeof meta?.outputText === 'string' ? { outputText: meta.outputText } : {}),
    ...(typeof data?.diff === 'string' ? { diff: data.diff } : {}),
    isProtected: data?.isProtected === true,
    isOutsideWorkspace: data?.isOutsideWorkspace === true || meta?.isOutsideWorkspace === true,
    ...(typeof meta?.blockedSettingKey === 'string' ? { blockedSettingKey: meta.blockedSettingKey } : {}),
    ...(Array.isArray(meta?.todos) ? { todos: meta.todos } : {}),
  };
}

function formatToolResultText(result: ToolResult, hints: ToolResultUiHints): string {
  const outputText = hints.outputText ?? '';
  if (outputText.trim()) return outputText;

  if (result.data === undefined || result.data === null) {
    return result.error || (result.success ? 'Done' : 'No data');
  }
  if (typeof result.data === 'string') {
    return result.data;
  }
  return JSON.stringify(result.data, null, 2);
}

type ToolCallView = NonNullable<ChatMessage['toolCall']>;

export function applyCommonToolResultFields(
  toolCall: ToolCallView,
  result: ToolResult,
): {
  resultStr: string;
  isTaskTool: boolean;
  hasDiff: boolean;
  maybeTodos: unknown[] | undefined;
} {
  const previousStatus = toolCall.status;
  toolCall.status = result.success
    ? 'success'
    : previousStatus === 'rejected'
      ? 'rejected'
      : 'error';

  const hints = extractToolResultUiHints(result);
  const resultStr = formatToolResultText(result, hints);

  if (hints.diff) {
    toolCall.diff = hints.diff;
  }
  if (hints.isProtected) {
    toolCall.isProtected = true;
  }
  if (hints.isOutsideWorkspace) {
    toolCall.isOutsideWorkspace = true;
  }

  const meta = isRecord(result.metadata) ? result.metadata : undefined;
  if (!result.success) {
    const errorCode = typeof meta?.errorCode === 'string' ? meta.errorCode : '';
    if (errorCode === TOOL_ERROR_CODES.external_paths_disabled) {
      toolCall.blockedReason = 'external_paths_disabled';
      toolCall.blockedSettingKey = hints.blockedSettingKey || 'lingyun.security.allowExternalPaths';
      toolCall.isOutsideWorkspace = true;
    }
  }

  if (toolCall.id === 'lsp' && result.success) {
    try {
      toolCall.lsp = JSON.parse(resultStr);
    } catch {
      // ignore parse errors
    }
  }

  if (hints.todos) {
    toolCall.todos = hints.todos;
  }

  const hasDiff = typeof toolCall.diff === 'string' && toolCall.diff.length > 0;
  const isTaskTool = toolCall.id === 'task';
  return {
    resultStr,
    isTaskTool,
    hasDiff,
    maybeTodos: hints.todos,
  };
}
