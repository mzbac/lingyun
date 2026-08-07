import * as vscode from 'vscode';

import { EDIT_TOOL_IDS } from '../../../core/agent/constants';
import {
  deriveStructuredMemoriesFromText,
  hasExternalMemoryContext,
  hasSkillInstructionPayload,
  markExternalMemoryContext,
  recordFailedAttempt,
  recordFileTouch,
  recordStructuredMemory,
  recordToolUse,
} from '../../../core/sessionSignals';
import type { ToolCall, ToolDefinition, ToolResult } from '../../../core/types';
import { resolveToolPath } from '../../../tools/builtin/workspace';
import { buildToolDiffView, computeUnifiedDiffStats, createUnifiedDiff, trimUnifiedDiff } from '../toolDiff';
import type { ChatMessage } from '../types';
import { formatWorkspacePathForUI } from '../utils';
import type { RunnerToolLifecycleView } from './callbackContracts';
import type { ChatExecutionState } from './executionState';
import {
  applyCommonToolResultFields,
  cacheToolDiffSnapshot,
  readTextFileForDiff,
  resolveToolCallUiPath,
  upsertTaskChildSession,
} from './callbackUtils';
import { findToolMessageByApprovalId, upsertToolMessage } from '../toolMessageLookup';
import { currentTurnIsMemoryExcluded } from './memoryTurn';

const MAX_TOOL_DIFF_FILE_BYTES = 400_000;
const TOOL_DIFF_CONTEXT_LINES = 3;

function parseToolArgs(tc: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(tc.function.arguments || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function textLooksLikeNetworkAccess(text: unknown): boolean {
  return typeof text === 'string' && /\b(curl|wget|httpie|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|fetch)\b|https?:\/\//i.test(text);
}

function hasExternalMemoryContextTag(tags: unknown): boolean {
  if (!Array.isArray(tags)) return false;
  for (const tag of tags) {
    const normalized = String(tag || '').toLowerCase();
    if (normalized === 'external' || normalized === 'web' || normalized === 'mcp') {
      return true;
    }
  }
  return false;
}

function externalMemoryContextSource(def: ToolDefinition, tc: ToolCall): string | undefined {
  const execution = def.execution as { type?: string; script?: string; handler?: string };
  const id = String(def.id || '').toLowerCase();
  const category = String(def.metadata?.category || '').toLowerCase();

  if (execution.type === 'http') return `${def.id}:http`;
  if (category === 'browser' || category === 'web' || category === 'mcp' || hasExternalMemoryContextTag(def.metadata?.tags)) {
    return `${def.id}:${category || 'external'}`;
  }
  if (/^(browser_|web_|mcp_)/.test(id)) return `${def.id}:external`;

  if (execution.type === 'shell' && textLooksLikeNetworkAccess(execution.script)) {
    return `${def.id}:shell_network`;
  }

  if (def.id === 'bash') {
    const args = parseToolArgs(tc);
    if (textLooksLikeNetworkAccess(args.command)) {
      return `${def.id}:shell_network`;
    }
  }

  return undefined;
}

function isMemoryScaffoldingToolResult(toolId: string, resultText: string): boolean {
  return toolId === 'skill' || hasSkillInstructionPayload(resultText);
}

function collectResultFilePreview(resultText: string, previewCount: number): { files: string[]; additionalCount: number } {
  const files: string[] = [];
  let total = 0;
  let lineStart = 0;

  const addLine = (line: string): void => {
    const file = line.trim();
    if (!file) return;
    total += 1;
    if (files.length < previewCount) {
      files.push(file);
    }
  };

  for (let i = 0; i < resultText.length; i++) {
    if (resultText.charCodeAt(i) !== 10) continue;
    const lineEnd = i > lineStart && resultText.charCodeAt(i - 1) === 13 ? i - 1 : i;
    addLine(resultText.slice(lineStart, lineEnd));
    lineStart = i + 1;
  }
  addLine(resultText.slice(lineStart));

  return {
    files,
    additionalCount: Math.max(0, total - previewCount),
  };
}

/**
 * Owns build-mode tool lifecycle behavior for the chat UI.
 *
 * Hidden knowledge kept here:
 * - when tool messages are created vs updated
 * - which tool results contribute file-touch signals
 * - how edit/write diff capture is staged before and after execution
 * - how task tool results spawn child chat sessions
 */
export function createToolLifecycleCallbacks(params: {
  view: RunnerToolLifecycleView;
  executionState: Pick<
    ChatExecutionState,
    'postStepMsgIfNeeded' | 'reconcileAssistantForToolCall'
  >;
  persistSessions: boolean;
}) {
  const { view, executionState, persistSessions } = params;

  function findToolMessage(
    toolCallId: string,
    options?: { currentStepOnly?: boolean; planningContainerId?: string }
  ): ChatMessage | undefined {
    return findToolMessageByApprovalId({
      messages: view.messages,
      approvalId: toolCallId,
      currentTurnId: view.currentTurnId,
      currentStepId: options?.currentStepOnly ? view.activeStepId : undefined,
      planningContainerId: options?.planningContainerId,
    });
  }

  function persistIfEnabled(): void {
    if (persistSessions) {
      view.persistActiveSession();
    }
  }

  async function onToolCall(tc: ToolCall, def: ToolDefinition): Promise<void> {
    executionState.postStepMsgIfNeeded();
    executionState.reconcileAssistantForToolCall();

    const { path, filePathRaw } = resolveToolCallUiPath(view, tc, def);
    const externalContext = externalMemoryContextSource(def, tc);
    const memoryExcluded = currentTurnIsMemoryExcluded(view.messages, view.currentTurnId);
    if (!externalContext && !memoryExcluded && def.id !== 'skill') {
      recordToolUse(view.signals, def.id);
      if (path) recordFileTouch(view.signals, path);
    }

    upsertToolMessage({
      view,
      tc,
      def,
      status: 'running',
      turnId: view.currentTurnId,
      stepId: view.activeStepId,
      path,
      memoryContextSource: externalContext,
      lookupScope: { currentTurnId: view.currentTurnId },
      preservePendingOrRejected: true,
    });
    persistIfEnabled();

    if (EDIT_TOOL_IDS.has(def.id) && typeof filePathRaw === 'string' && filePathRaw.trim()) {
      try {
        const resolved = resolveToolPath(filePathRaw);
        const before = await readTextFileForDiff(resolved.uri, MAX_TOOL_DIFF_FILE_BYTES);
        const displayPath = formatWorkspacePathForUI(resolved.absPath) ?? resolved.absPath;
        view.toolDiffBeforeByToolCallId.set(tc.id, {
          absPath: resolved.absPath,
          displayPath,
          beforeText: before.text,
          isExternal: resolved.isExternal,
          skippedReason: before.skippedReason,
        });
      } catch {
        // Ignore diff capture failures; tool execution should proceed.
      }
    }
  }

  function onToolBlocked(tc: ToolCall, def: ToolDefinition, reason: string): void {
    executionState.postStepMsgIfNeeded();
    executionState.reconcileAssistantForToolCall();
    view.toolDiffBeforeByToolCallId.delete(tc.id);
    view.toolDiffSnapshotsByToolCallId.delete(tc.id);

    const { path } = resolveToolCallUiPath(view, tc, def, { includeWorkdir: true });
    const externalContext = externalMemoryContextSource(def, tc);
    upsertToolMessage({
      view,
      tc,
      def,
      status: 'error',
      turnId: view.currentTurnId,
      stepId: view.activeStepId,
      path,
      result: reason,
      memoryContextSource: externalContext,
      lookupScope: { currentTurnId: view.currentTurnId, currentStepId: view.activeStepId },
    });
    persistIfEnabled();
  }

  function recordToolResultFileTouches(toolId: string, resultData: unknown, resultStr: string, toolMsg: ChatMessage): void {
    if (resultData && typeof resultData === 'object') {
      const data = resultData as Record<string, unknown>;
      const globFiles = data.files;
      if (toolId === 'glob' && Array.isArray(globFiles)) {
        for (const file of globFiles) {
          if (typeof file !== 'string' || !file.trim()) continue;
          recordFileTouch(view.signals, formatWorkspacePathForUI(file) ?? file.trim());
        }
      }

      const grepMatches = data.matches;
      if (toolId === 'grep' && Array.isArray(grepMatches)) {
        for (const match of grepMatches) {
          if (!match || typeof match !== 'object') continue;
          const record = match as Record<string, unknown>;
          const filePath = record.filePath;
          if (typeof filePath !== 'string' || !filePath.trim()) continue;
          recordFileTouch(view.signals, formatWorkspacePathForUI(filePath) ?? filePath.trim());
        }
      }
    }

    if (toolId === 'glob' || toolId === 'list') {
      const trimmed = resultStr.trim();
      if (trimmed && trimmed !== 'No files found matching the criteria' && trimmed !== 'No files found') {
        const previewCount = 10;
        const toolCall = toolMsg.toolCall;
        if (!toolCall) return;
        const preview = collectResultFilePreview(resultStr, previewCount);
        toolCall.batchFiles = preview.files;
        toolCall.additionalCount = preview.additionalCount;
      }
    }
  }

  function stageToolDiffResult(tc: ToolCall, toolCall: NonNullable<ChatMessage['toolCall']>, toolMsg: ChatMessage): void {
    const before = view.toolDiffBeforeByToolCallId.get(tc.id);
    view.toolDiffBeforeByToolCallId.delete(tc.id);
    view.toolDiffSnapshotsByToolCallId.delete(tc.id);

    if (before?.skippedReason) {
      toolCall.diffUnavailableReason =
        before.skippedReason === 'binary' ? 'Diff unavailable (binary file)' : 'Diff unavailable (file too large)';
      return;
    }
    if (!before) return;

    void (async () => {
      try {
        const after = await readTextFileForDiff(vscode.Uri.file(before.absPath), MAX_TOOL_DIFF_FILE_BYTES);
        if (after.skippedReason) {
          toolCall.diffUnavailableReason =
            after.skippedReason === 'binary' ? 'Diff unavailable (binary file)' : 'Diff unavailable (file too large)';
        } else {
          const rawDiff = createUnifiedDiff({
            filePath: before.displayPath,
            beforeText: before.beforeText,
            afterText: after.text,
            context: TOOL_DIFF_CONTEXT_LINES,
          });

          const stats = computeUnifiedDiffStats(rawDiff);
          if (stats.additions > 0 || stats.deletions > 0) {
            const trimmed = trimUnifiedDiff(rawDiff, { maxChars: 20_000, maxLines: 400 });
            toolCall.diff = trimmed.text;
            toolCall.diffStats = stats;
            toolCall.diffTruncated = trimmed.truncated;
            toolCall.diffView = buildToolDiffView(trimmed.text, {
              filePath: before.displayPath || toolCall.path || 'file',
            });
            cacheToolDiffSnapshot(view, tc.id, {
              absPath: before.absPath,
              displayPath: before.displayPath || toolCall.path || 'file',
              beforeText: before.beforeText,
              afterText: after.text,
              isExternal: before.isExternal,
              truncated: trimmed.truncated,
            });
          }
        }

        view.postMessage({ type: 'updateTool', message: toolMsg });
        persistIfEnabled();
      } catch {
        // Ignore diff capture failures; tool result is still valid.
      }
    })();
  }

  function onToolResult(tc: ToolCall, result: ToolResult): void {
    const toolMsg = findToolMessage(tc.id, { currentStepOnly: true });
    if (!toolMsg?.toolCall) return;

    const toolCall = toolMsg.toolCall;
    const { resultStr, isTaskTool, hasDiff, maybeTodos } = applyCommonToolResultFields(toolCall, result);
    const toolId = toolCall.id;
    const externalContext = toolCall.memoryContextSource;
    const memoryExcluded = currentTurnIsMemoryExcluded(view.messages, view.currentTurnId);
    const memoryScaffolding = isMemoryScaffoldingToolResult(toolId, resultStr);
    if (result.success && externalContext) {
      markExternalMemoryContext(view.signals, externalContext);
    }
    const skipMemoryCapture = memoryExcluded || hasExternalMemoryContext(view.signals) || !!externalContext || memoryScaffolding;

    if (!skipMemoryCapture) {
      recordToolResultFileTouches(toolId, result.data, resultStr, toolMsg);
    }

    if (result.success && EDIT_TOOL_IDS.has(toolId)) {
      stageToolDiffResult(tc, toolCall, toolMsg);
    } else {
      view.toolDiffBeforeByToolCallId.delete(tc.id);
    }

    if (isTaskTool && result.success) {
      const childId = upsertTaskChildSession(view, result);
      if (childId) toolCall.taskSessionId = childId;
    }

    let storeOutput = !result.success || (!!resultStr.trim() && !hasDiff);
    if (hasDiff && result.success && (toolId === 'edit' || toolId === 'write')) {
      // Edit/write output may include diagnostics; keep it alongside the diff.
      storeOutput = !!resultStr.trim();
    }
    if (toolId === 'todowrite' || toolId === 'todoread') {
      // Todo output is already surfaced in the header popover; avoid spamming the chat with raw JSON.
      storeOutput = false;
    }
    toolCall.result = storeOutput ? resultStr.substring(0, 4000) : undefined;

    if (!result.success && resultStr.trim() && !skipMemoryCapture) {
      recordFailedAttempt(view.signals, `${toolId}: ${resultStr.trim()}`);
    }
    if (result.success && resultStr.trim() && !skipMemoryCapture) {
      const turnId = typeof view.currentTurnId === 'string' && view.currentTurnId.trim() ? [view.currentTurnId.trim()] : undefined;
      for (const candidate of deriveStructuredMemoriesFromText(resultStr.trim(), {
        source: 'tool',
        defaultScope: 'workspace',
        confidenceBias: toolId === 'grep' || toolId === 'read' ? -0.05 : 0,
        sourceTurnIds: turnId,
      })) {
        recordStructuredMemory(view.signals, candidate);
      }
    }

    view.postMessage({ type: 'updateTool', message: toolMsg });
    if (Array.isArray(maybeTodos)) {
      view.postMessage({ type: 'todos', todos: maybeTodos });
    }
    persistIfEnabled();
  }

  return {
    onToolCall,
    onToolBlocked,
    onToolResult,
  };
}
