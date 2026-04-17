import * as vscode from 'vscode';

import { EDIT_TOOL_IDS } from '../../../core/agent/constants';
import { recordFileTouch, recordToolUse } from '../../../core/sessionSignals';
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
import { findToolMessageByApprovalId } from '../toolMessageLookup';

const MAX_TOOL_DIFF_FILE_BYTES = 400_000;
const TOOL_DIFF_CONTEXT_LINES = 3;

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
    recordToolUse(view.signals, def.id);
    if (path) recordFileTouch(view.signals, path);

    const existing = findToolMessage(tc.id);
    if (existing?.toolCall) {
      existing.toolCall.id = def.id;
      existing.toolCall.name = def.name;
      existing.toolCall.args = tc.function.arguments;
      if (path) existing.toolCall.path = path;
      if (existing.toolCall.status !== 'pending' && existing.toolCall.status !== 'rejected') {
        existing.toolCall.status = 'running';
      }
      if (!existing.stepId && view.activeStepId) {
        existing.stepId = view.activeStepId;
      }
      view.postMessage({ type: 'updateTool', message: existing });
      persistIfEnabled();
      return;
    }

    const toolMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      turnId: view.currentTurnId,
      stepId: view.activeStepId,
      toolCall: {
        id: def.id,
        name: def.name,
        args: tc.function.arguments,
        // IMPORTANT: Only mark a tool as "pending approval" when the agent core actually
        // requests approval (onRequestApproval). Avoid UI heuristics that can disagree with
        // the core permission system / autoApprove settings.
        status: 'running',
        approvalId: tc.id,
        path,
      },
    };
    view.messages.push(toolMsg);
    view.postMessage({ type: 'message', message: toolMsg });
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

    const existing = findToolMessage(tc.id, { currentStepOnly: true });
    if (existing?.toolCall) {
      existing.toolCall.status = 'error';
      existing.toolCall.result = reason;
      view.postMessage({ type: 'updateTool', message: existing });
      persistIfEnabled();
      return;
    }

    const { path } = resolveToolCallUiPath(view, tc, def, { includeWorkdir: true });
    const toolMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      turnId: view.currentTurnId,
      stepId: view.activeStepId,
      toolCall: {
        id: def.id,
        name: def.name,
        args: tc.function.arguments,
        status: 'error',
        approvalId: tc.id,
        path,
        result: reason,
      },
    };
    view.messages.push(toolMsg);
    view.postMessage({ type: 'message', message: toolMsg });
    persistIfEnabled();
  }

  function recordToolResultFileTouches(toolId: string, resultData: unknown, resultStr: string, toolMsg: ChatMessage): void {
    if (resultData && typeof resultData === 'object') {
      const data = resultData as Record<string, unknown>;
      if (toolId === 'glob' && Array.isArray((data as any).files)) {
        const files = (data as any).files as unknown[];
        for (const file of files) {
          if (typeof file !== 'string' || !file.trim()) continue;
          recordFileTouch(view.signals, formatWorkspacePathForUI(file) ?? file.trim());
        }
      }
      if (toolId === 'grep' && Array.isArray((data as any).matches)) {
        const matches = (data as any).matches as unknown[];
        for (const match of matches) {
          if (!match || typeof match !== 'object') continue;
          const filePath = (match as any).filePath;
          if (typeof filePath !== 'string' || !filePath.trim()) continue;
          recordFileTouch(view.signals, formatWorkspacePathForUI(filePath) ?? filePath.trim());
        }
      }
    }

    if (toolId === 'glob' || toolId === 'list') {
      const trimmed = resultStr.trim();
      if (trimmed && trimmed !== 'No files found matching the criteria' && trimmed !== 'No files found') {
        const files = trimmed
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);

        const previewCount = 10;
        toolMsg.toolCall!.batchFiles = files.slice(0, previewCount);
        toolMsg.toolCall!.additionalCount = Math.max(0, files.length - previewCount);
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

    recordToolResultFileTouches(toolId, result.data, resultStr, toolMsg);

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
