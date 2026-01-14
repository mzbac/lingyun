import * as vscode from 'vscode';
import { getMessageText } from '@lingyun/core';
import { EDIT_TOOL_IDS } from '../../core/agent/constants';
import type { AgentCallbacks, ToolDefinition, ToolCall } from '../../core/types';
import { cleanAssistantPreamble, formatErrorForUser, formatWorkspacePathForUI } from './utils';
import type { ChatMessage } from './types';
import { buildToolDiffView, createUnifiedDiff, computeUnifiedDiffStats, trimUnifiedDiff } from './toolDiff';
import { resolveToolPath } from '../../tools/builtin/workspace';
import { ChatViewProvider } from '../chat';

const MAX_TOOL_DIFF_FILE_BYTES = 400_000;
const TOOL_DIFF_CONTEXT_LINES = 3;
const MAX_TOOL_DIFF_SNAPSHOTS = 20;

function cacheToolDiffSnapshot(
  view: ChatViewProvider,
  toolCallId: string,
  snapshot: {
    absPath: string;
    displayPath: string;
    beforeText: string;
    afterText: string;
    isExternal: boolean;
    truncated: boolean;
  }
): void {
  view.toolDiffSnapshotsByToolCallId.delete(toolCallId);
  view.toolDiffSnapshotsByToolCallId.set(toolCallId, snapshot);
  while (view.toolDiffSnapshotsByToolCallId.size > MAX_TOOL_DIFF_SNAPSHOTS) {
    const oldestKey = view.toolDiffSnapshotsByToolCallId.keys().next().value as string | undefined;
    if (!oldestKey) break;
    view.toolDiffSnapshotsByToolCallId.delete(oldestKey);
  }
}

function containsBinaryData(buffer: Uint8Array): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

async function readTextFileForDiff(
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

Object.assign(ChatViewProvider.prototype, {
  createPlanningCallbacks(this: ChatViewProvider, planMsg: ChatMessage): AgentCallbacks {
    const persistSessions = this.isSessionPersistenceEnabled();
    const planContainerId = planMsg.id;
    const planTurnId = planMsg.turnId ?? this.currentTurnId;

    let buffered = '';
    let flushHandle: NodeJS.Timeout | undefined;

    const flush = () => {
      flushHandle = undefined;
      this.postMessage({ type: 'updateMessage', message: planMsg });
      if (persistSessions) {
        this.persistActiveSession();
      }
    };

    const scheduleFlush = () => {
      if (flushHandle) return;
      flushHandle = setTimeout(flush, 60);
    };

    const upsertToolError = (tc: ToolCall, def: ToolDefinition, reason: string) => {
      const existing = [...this.messages]
        .reverse()
        .find(m => m.toolCall?.approvalId === tc.id && m.stepId === planContainerId);

      if (existing?.toolCall) {
        existing.toolCall.status = 'error';
        existing.toolCall.result = reason;
        this.postMessage({ type: 'updateTool', message: existing });
      } else {
        let path: string | undefined;
        try {
          const args = JSON.parse(tc.function.arguments || '{}');
          path = (args as any).filePath || (args as any).path || (args as any).workdir;
          if (!path && typeof (args as any).fileId === 'string') {
            path = this.agent.resolveFileId(String((args as any).fileId)) || undefined;
          }
        } catch {
          // Ignore parse errors
        }

        const toolMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'tool',
          content: '',
          timestamp: Date.now(),
          stepId: planContainerId,
          toolCall: {
            id: def.id,
            name: def.name,
            args: tc.function.arguments,
            status: 'error',
            approvalId: tc.id,
            path: formatWorkspacePathForUI(path),
            result: reason,
          },
        };
        this.messages.push(toolMsg);
        this.postMessage({ type: 'message', message: toolMsg });
      }

      if (persistSessions) {
        this.persistActiveSession();
      }
    };

    return {
      onIterationEnd: () => {
        // Keep the global context indicator in sync during plan loops (usage updates per turn).
        this.postMessage({ type: 'context', context: this.getContextForUI() });
      },
      onDebug: (message) => {
        const config = vscode.workspace.getConfiguration('lingyun');
        const debugLlm = config.get<boolean>('debug.llm') ?? false;
        const debugTools = config.get<boolean>('debug.tools') ?? false;
        if (!debugLlm && !debugTools) return;

        const isTool = typeof message === 'string' && message.startsWith('[Tool]');
        if (isTool && !debugTools) return;
        if (!isTool && !debugLlm) return;
        if (!message) return;
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel?.appendLine(`[${timestamp}] ${message}`);
      },
      onStatusChange: (status) => {
        if (!planTurnId) return;

        if (status.type === 'retry') {
          this.postMessage({
            type: 'turnStatus',
            turnId: planTurnId,
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
          this.postMessage({
            type: 'turnStatus',
            turnId: planTurnId,
            status: { type: 'running', message: status.message || '' },
          });
          return;
        }

        if (status.type === 'error') {
          this.postMessage({
            type: 'turnStatus',
            turnId: planTurnId,
            status: { type: 'error', message: status.message || 'unknown error' },
          });
          return;
        }

        if (status.type === 'done') {
          this.postMessage({
            type: 'turnStatus',
            turnId: planTurnId,
            status: { type: 'done' },
          });
        }
      },
      onAssistantToken: (token) => {
        buffered += token;
        planMsg.content = cleanAssistantPreamble(buffered);
        scheduleFlush();
      },
      onToolCall: (tc: ToolCall, def: ToolDefinition) => {
        let path: string | undefined;
        try {
          const args = JSON.parse(tc.function.arguments || '{}');
          path = (args as any).filePath || (args as any).path;
          if (!path && typeof (args as any).fileId === 'string') {
            path = this.agent.resolveFileId(String((args as any).fileId)) || undefined;
          }
        } catch {
          // Ignore parse errors
        }
        path = formatWorkspacePathForUI(path);

        const existing = [...this.messages].reverse().find(m => {
          if (m.role !== 'tool') return false;
          if (m.toolCall?.approvalId !== tc.id) return false;
          return m.stepId === planContainerId;
        });

        if (existing?.toolCall) {
          existing.toolCall.id = def.id;
          existing.toolCall.name = def.name;
          existing.toolCall.args = tc.function.arguments;
          if (path) existing.toolCall.path = path;
          if (existing.toolCall.status !== 'pending' && existing.toolCall.status !== 'rejected') {
            existing.toolCall.status = 'running';
          }
          this.postMessage({ type: 'updateTool', message: existing });
          if (persistSessions) {
            this.persistActiveSession();
          }
          return;
        }

        const toolMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'tool',
          content: '',
          timestamp: Date.now(),
          stepId: planContainerId,
          toolCall: {
            id: def.id,
            name: def.name,
            args: tc.function.arguments,
            status: 'running',
            approvalId: tc.id,
            path,
          },
        };
        this.messages.push(toolMsg);
        this.postMessage({ type: 'message', message: toolMsg });
        if (persistSessions) {
          this.persistActiveSession();
        }
      },
      onToolBlocked: (tc: ToolCall, def: ToolDefinition, reason: string) => {
        upsertToolError(tc, def, reason);
      },
      onToolResult: (tc, result) => {
        const toolMsg = [...this.messages]
          .reverse()
          .find(m => m.toolCall?.approvalId === tc.id && m.stepId === planContainerId);
        if (toolMsg?.toolCall) {
          const previousStatus = toolMsg.toolCall.status;
          toolMsg.toolCall.status = result.success
            ? 'success'
            : previousStatus === 'rejected'
              ? 'rejected'
              : 'error';
          let resultStr: string;
          if (result.data === undefined || result.data === null) {
            resultStr = result.error || (result.success ? 'Done' : 'No data');
          } else if (typeof result.data === 'string') {
            resultStr = result.data;
          } else {
            resultStr = JSON.stringify(result.data, null, 2);
          }

          if (result.data && typeof result.data === 'object') {
            const data = result.data as Record<string, unknown>;
            if (data.diff && typeof data.diff === 'string') {
              toolMsg.toolCall.diff = data.diff;
            }
            if (data.isProtected) {
              toolMsg.toolCall.isProtected = true;
            }
            if (data.isOutsideWorkspace) {
              toolMsg.toolCall.isOutsideWorkspace = true;
            }
          }

          const meta = (result.metadata || {}) as Record<string, unknown>;
          if (!result.success) {
            const errorType = typeof meta.errorType === 'string' ? meta.errorType : '';
            if (errorType === 'external_paths_disabled') {
              toolMsg.toolCall.blockedReason = 'external_paths_disabled';
              toolMsg.toolCall.blockedSettingKey =
                typeof meta.blockedSettingKey === 'string'
                  ? meta.blockedSettingKey
                  : 'lingyun.security.allowExternalPaths';
              toolMsg.toolCall.isOutsideWorkspace = true;
            }
            if (meta.isOutsideWorkspace) {
              toolMsg.toolCall.isOutsideWorkspace = true;
            }
          }

          if (toolMsg.toolCall.id === 'lsp' && result.success) {
            try {
              toolMsg.toolCall.lsp = JSON.parse(resultStr);
            } catch {
              // ignore parse errors
            }
          }

          const hasDiff = typeof toolMsg.toolCall.diff === 'string' && toolMsg.toolCall.diff.length > 0;
          let storeOutput = !result.success || (!!resultStr.trim() && !hasDiff);
          if (toolMsg.toolCall.id === 'todowrite' || toolMsg.toolCall.id === 'todoread') {
            // Todo output is already surfaced in the header popover; avoid spamming the chat with raw JSON.
            storeOutput = false;
          }
          toolMsg.toolCall.result = storeOutput ? resultStr.substring(0, 4000) : undefined;

          const maybeTodos = (result.metadata as any)?.todos;
          if (Array.isArray(maybeTodos)) {
            toolMsg.toolCall.todos = maybeTodos;
          }

          this.postMessage({ type: 'updateTool', message: toolMsg });

          if (Array.isArray(maybeTodos)) {
            this.postMessage({ type: 'todos', todos: maybeTodos });
          }
          if (persistSessions) {
            this.persistActiveSession();
          }
        }
      },
      onRequestApproval: async (tc, def) => {
        return this.requestInlineApproval(tc, def, planContainerId);
      },
      onComplete: () => {
        if (planTurnId) {
          this.postMessage({ type: 'turnStatus', turnId: planTurnId, status: { type: 'done' } });
        }
        this.postMessage({ type: 'context', context: this.getContextForUI() });
      },
      onError: (error) => {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'error',
          content: formatErrorForUser(error),
          timestamp: Date.now(),
        };
        this.messages.push(errorMsg);
        this.postMessage({ type: 'message', message: errorMsg });
        this.postMessage({ type: 'context', context: this.getContextForUI() });
        if (persistSessions) {
          this.persistActiveSession();
        }
      },
    };
  },

  createAgentCallbacks(this: ChatViewProvider): AgentCallbacks {
    const showThinking =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('showThinking', false) ?? false;
    const debugLlm = vscode.workspace.getConfiguration('lingyun').get<boolean>('debug.llm') ?? false;
    const persistSessions = this.isSessionPersistenceEnabled();

    let stepMsg: ChatMessage | undefined;
    let stepPosted = false;
    let thoughtMsg: ChatMessage | undefined;
    let thoughtBuffer = '';
    let thoughtTokensSeen = 0;
    let thoughtCharsSeen = 0;
    let loggedFirstThought = false;
    let assistantMsg: ChatMessage | undefined;
    let assistantStarted = false;
    let compactionMsg: ChatMessage | undefined;
    const MAX_COMPACTION_SUMMARY_CHARS = 20000;

    const debug = (message: string) => {
      if (!debugLlm || !message) return;
      const timestamp = new Date().toLocaleTimeString();
      this.outputChannel?.appendLine(`[${timestamp}] [UI] ${message}`);
    };

    debug(
      `[Thinking] callbacks created showThinking=${String(showThinking)} mode=${this.mode} turn=${this.currentTurnId ?? ''}`,
    );

    const ensureStepMsg = (): ChatMessage => {
      if (stepMsg) return stepMsg;

      const index = ++this.stepCounter;
      stepMsg = {
        id: crypto.randomUUID(),
        role: 'step',
        content: '',
        timestamp: Date.now(),
        turnId: this.currentTurnId,
        step: {
          index,
          status: 'running',
          mode: this.mode === 'plan' ? 'Plan' : 'Build',
          model: this.currentModel,
        },
      };
      this.activeStepId = stepMsg.id;
      debug(`[Step] start stepId=${stepMsg.id} index=${String(index)} turn=${this.currentTurnId ?? ''}`);
      return stepMsg;
    };

    const postStepMsgIfNeeded = (): ChatMessage => {
      const msg = ensureStepMsg();
      if (stepPosted) return msg;
      stepPosted = true;
      this.messages.push(msg);
      this.postMessage({ type: 'message', message: msg });
      if (persistSessions) {
        this.persistActiveSession();
      }
      return msg;
    };

    const ensureAssistantMsg = (): ChatMessage => {
      if (assistantMsg) return assistantMsg;
      assistantMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        turnId: this.currentTurnId,
        stepId: this.activeStepId,
      };
      this.messages.push(assistantMsg);
      this.postMessage({ type: 'message', message: assistantMsg });
      return assistantMsg;
    };

    const pushThought = (text: string) => {
      if (!text) return;

      thoughtTokensSeen += 1;
      thoughtCharsSeen += text.length;
      if (!loggedFirstThought) {
        loggedFirstThought = true;
        debug(
          `[Thinking] first token len=${String(text.length)} trimmedLen=${String(text.trim().length)} showThinking=${String(showThinking)} step=${this.activeStepId ?? ''}`,
        );
      }

      if (!showThinking) return;

      // Local servers sometimes emit "<think>\n" as a separate chunk, which creates an
      // empty-looking Thinking block. Buffer whitespace until we see a real character.
      if (!thoughtMsg) {
        thoughtBuffer += text;
        const normalized = thoughtBuffer.replace(/\[REDACTED\]/g, '').trim();
        if (!normalized) return;

        thoughtMsg = {
          id: crypto.randomUUID(),
          role: 'thought',
          content: normalized,
          timestamp: Date.now(),
          turnId: this.currentTurnId,
          stepId: this.activeStepId,
        };
        thoughtBuffer = '';
        debug(
          `[Thinking] created thoughtId=${thoughtMsg.id} initialChars=${String(normalized.length)} step=${this.activeStepId ?? ''}`,
        );
        this.messages.push(thoughtMsg);
        this.postMessage({ type: 'message', message: thoughtMsg });
        return;
      }

      const safe = text.replace(/\[REDACTED\]/g, '');
      if (!safe) return;
      thoughtMsg.content += safe;
      this.postMessage({ type: 'token', messageId: thoughtMsg.id, token: safe });
    };

    const pushAssistant = (text: string) => {
      if (!text) return;
      let chunk = text;
      if (!assistantStarted) {
        chunk = chunk.replace(/^[\s\r\n]+/, '');
        if (!chunk) return;
        assistantStarted = true;
      }
      const msg = ensureAssistantMsg();
      msg.content += chunk;
      this.postMessage({ type: 'token', messageId: msg.id, token: chunk });
    };

    const reconcileAssistantForToolCall = () => {
      if (!assistantMsg || assistantMsg.turnId !== this.currentTurnId) return;
      const original = assistantMsg.content;
      const trimmed = cleanAssistantPreamble(original);
      if (trimmed !== original) {
        assistantMsg.content = trimmed;
        this.postMessage({ type: 'updateMessage', message: assistantMsg });
      }
    };

    const finalizeAssistantForStepEnd = () => {
      if (!assistantMsg || assistantMsg.turnId !== this.currentTurnId) return;
      const original = assistantMsg.content;
      const cleaned = cleanAssistantPreamble(original);
      if (cleaned !== original) {
        assistantMsg.content = cleaned;
        this.postMessage({ type: 'updateMessage', message: assistantMsg });
      }
    };

    const reconcileAssistantFromHistory = () => {
      const history = this.agent.getHistory();
      const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
      if (!lastAssistant) return;

      const finalContent = cleanAssistantPreamble(getMessageText(lastAssistant));
      if (!finalContent.trim()) return;

      if (!assistantMsg) {
        assistantMsg = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: finalContent,
          timestamp: Date.now(),
          turnId: this.currentTurnId,
          stepId: this.activeStepId,
        };
        this.messages.push(assistantMsg);
        this.postMessage({ type: 'message', message: assistantMsg });
        return;
      }

      if (assistantMsg.turnId === this.currentTurnId && assistantMsg.content !== finalContent) {
        assistantMsg.content = finalContent;
        this.postMessage({ type: 'updateMessage', message: assistantMsg });
      }
    };

    const startNewTurn = () => {
      stepMsg = undefined;
      this.activeStepId = undefined;
      stepPosted = false;
      thoughtMsg = undefined;
      thoughtBuffer = '';
      assistantMsg = undefined;
      assistantStarted = false;
    };

    return {
      onCompactionStart: ({ auto }) => {
        const startedAt = Date.now();
        const operationId = crypto.randomUUID();

        compactionMsg = {
          id: operationId,
          role: 'operation',
          content: '',
          timestamp: startedAt,
          turnId: this.currentTurnId,
          operation: {
            kind: 'compact',
            status: 'running',
            label: auto ? 'Auto-compacting context…' : 'Compacting context…',
            detail: auto ? 'Summarizing older messages to avoid context overflow.' : undefined,
            startedAt,
            auto,
          },
        };

        this.messages.push(compactionMsg);
        this.postMessage({
          type: 'operationStart',
          operation: {
            id: operationId,
            kind: 'compact',
            status: 'running',
            label: compactionMsg.operation?.label || 'Compacting context…',
            startedAt,
          },
        });
        this.postMessage({ type: 'message', message: compactionMsg });

        if (persistSessions) {
          this.persistActiveSession();
        }
      },
      onIterationStart: async () => {
        startNewTurn();
        const step = postStepMsgIfNeeded();
        if (this.mode !== 'build' || !step.step) return;

        const snapshot = await this.getWorkspaceSnapshot();
        if (!snapshot) return;

        try {
          const baseHash = await snapshot.track();
          step.step.snapshot = { baseHash };
          if (persistSessions) {
            this.persistActiveSession();
          }
        } catch (error) {
          this.snapshotUnavailableReason = error instanceof Error ? error.message : String(error);
        }
      },
      onAssistantToken: (token) => {
        pushAssistant(token);
      },
      onThoughtToken: (token) => {
        pushThought(token);
      },
      onToolCall: async (tc: ToolCall, def: ToolDefinition) => {
        postStepMsgIfNeeded();
        reconcileAssistantForToolCall();

        let path: string | undefined;
        let filePathRaw: string | undefined;
        try {
          const args = JSON.parse(tc.function.arguments || '{}');
          filePathRaw = (args as any).filePath || (args as any).path;
          if (!filePathRaw && typeof (args as any).fileId === 'string') {
            filePathRaw = this.agent.resolveFileId(String((args as any).fileId)) || undefined;
          }
          path = filePathRaw;
        } catch {
          // Ignore parse errors
        }
        path = formatWorkspacePathForUI(path);

        const existing = [...this.messages].reverse().find(m => {
          if (m.role !== 'tool') return false;
          if (m.toolCall?.approvalId !== tc.id) return false;
          if (m.turnId !== this.currentTurnId) return false;
          return true;
        });

        if (existing?.toolCall) {
          existing.toolCall.id = def.id;
          existing.toolCall.name = def.name;
          existing.toolCall.args = tc.function.arguments;
          if (path) existing.toolCall.path = path;
          if (existing.toolCall.status !== 'pending' && existing.toolCall.status !== 'rejected') {
            existing.toolCall.status = 'running';
          }
          if (!existing.stepId && this.activeStepId) {
            existing.stepId = this.activeStepId;
          }
          this.postMessage({ type: 'updateTool', message: existing });
          if (persistSessions) {
            this.persistActiveSession();
          }
          return;
        }

        const toolMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'tool',
          content: '',
          timestamp: Date.now(),
          turnId: this.currentTurnId,
          stepId: this.activeStepId,
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
        this.messages.push(toolMsg);
        this.postMessage({ type: 'message', message: toolMsg });
        if (persistSessions) {
          this.persistActiveSession();
        }

        if (EDIT_TOOL_IDS.has(def.id) && typeof filePathRaw === 'string' && filePathRaw.trim()) {
          try {
            const resolved = resolveToolPath(filePathRaw);
            const before = await readTextFileForDiff(resolved.uri, MAX_TOOL_DIFF_FILE_BYTES);
            const displayPath = formatWorkspacePathForUI(resolved.absPath) ?? resolved.absPath;
            this.toolDiffBeforeByToolCallId.set(tc.id, {
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
      },
      onToolBlocked: (tc: ToolCall, def: ToolDefinition, reason: string) => {
        postStepMsgIfNeeded();
        reconcileAssistantForToolCall();
        this.toolDiffBeforeByToolCallId.delete(tc.id);
        this.toolDiffSnapshotsByToolCallId.delete(tc.id);

        const currentStepId = this.activeStepId;
        const existing = [...this.messages].reverse().find(m => {
          if (m.toolCall?.approvalId !== tc.id) return false;
          if (currentStepId && m.stepId !== currentStepId) return false;
          return true;
        });

        if (existing?.toolCall) {
          existing.toolCall.status = 'error';
          existing.toolCall.result = reason;
          this.postMessage({ type: 'updateTool', message: existing });
        } else {
          let path: string | undefined;
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            path = (args as any).filePath || (args as any).path || (args as any).workdir;
          } catch {
            // Ignore parse errors
          }

          const toolMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool',
            content: '',
            timestamp: Date.now(),
            turnId: this.currentTurnId,
            stepId: this.activeStepId,
            toolCall: {
              id: def.id,
              name: def.name,
              args: tc.function.arguments,
              status: 'error',
              approvalId: tc.id,
              path: formatWorkspacePathForUI(path),
              result: reason,
            },
          };
          this.messages.push(toolMsg);
          this.postMessage({ type: 'message', message: toolMsg });
        }
        if (persistSessions) {
          this.persistActiveSession();
        }
      },
      onToolResult: (tc, result) => {
        const currentStepId = this.activeStepId;
        const toolMsg = [...this.messages].reverse().find(m => {
          if (m.toolCall?.approvalId !== tc.id) return false;
          if (currentStepId && m.stepId !== currentStepId) return false;
          return true;
        });
        if (toolMsg?.toolCall) {
          const toolCall = toolMsg.toolCall;
          const previousStatus = toolMsg.toolCall.status;
          toolMsg.toolCall.status = result.success
            ? 'success'
            : previousStatus === 'rejected'
              ? 'rejected'
              : 'error';
          let resultStr: string;
          if (result.data === undefined || result.data === null) {
            resultStr = result.error || (result.success ? 'Done' : 'No data');
          } else if (typeof result.data === 'string') {
            resultStr = result.data;
          } else {
            resultStr = JSON.stringify(result.data, null, 2);
          }

          const toolId = toolMsg.toolCall.id;
          if (result.success && (toolId === 'glob' || toolId === 'file.list') && typeof resultStr === 'string') {
            const trimmed = resultStr.trim();
            if (trimmed && trimmed !== 'No files found matching the criteria' && trimmed !== 'No files found') {
              const files = trimmed
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);

              const previewCount = 10;
              toolMsg.toolCall.batchFiles = files.slice(0, previewCount);
              toolMsg.toolCall.additionalCount = Math.max(0, files.length - previewCount);
            }
          }

          if (result.success && EDIT_TOOL_IDS.has(toolId)) {
            const before = this.toolDiffBeforeByToolCallId.get(tc.id);
            this.toolDiffBeforeByToolCallId.delete(tc.id);
            this.toolDiffSnapshotsByToolCallId.delete(tc.id);

            if (before?.skippedReason) {
              toolCall.diffUnavailableReason =
                before.skippedReason === 'binary'
                  ? 'Diff unavailable (binary file)'
                  : 'Diff unavailable (file too large)';
            } else if (before) {
              void (async () => {
                try {
                  const after = await readTextFileForDiff(
                    vscode.Uri.file(before.absPath),
                    MAX_TOOL_DIFF_FILE_BYTES,
                  );
                  if (after.skippedReason) {
                    toolCall.diffUnavailableReason =
                      after.skippedReason === 'binary'
                        ? 'Diff unavailable (binary file)'
                        : 'Diff unavailable (file too large)';
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

                      cacheToolDiffSnapshot(this, tc.id, {
                        absPath: before.absPath,
                        displayPath: before.displayPath || toolCall.path || 'file',
                        beforeText: before.beforeText,
                        afterText: after.text,
                        isExternal: before.isExternal,
                        truncated: trimmed.truncated,
                      });
                    }
                  }

                  this.postMessage({ type: 'updateTool', message: toolMsg });
                  if (persistSessions) {
                    this.persistActiveSession();
                  }
                } catch {
                  // Ignore diff capture failures; tool result is still valid.
                }
              })();
            }
          } else {
            this.toolDiffBeforeByToolCallId.delete(tc.id);
          }

          if (result.data && typeof result.data === 'object') {
            const data = result.data as Record<string, unknown>;
            if (data.diff && typeof data.diff === 'string') {
              toolMsg.toolCall.diff = data.diff;
            }
            if (data.isProtected) {
              toolMsg.toolCall.isProtected = true;
            }
            if (data.isOutsideWorkspace) {
              toolMsg.toolCall.isOutsideWorkspace = true;
            }
          }

          const meta = (result.metadata || {}) as Record<string, unknown>;
          if (!result.success) {
            const errorType = typeof meta.errorType === 'string' ? meta.errorType : '';
            if (errorType === 'external_paths_disabled') {
              toolMsg.toolCall.blockedReason = 'external_paths_disabled';
              toolMsg.toolCall.blockedSettingKey =
                typeof meta.blockedSettingKey === 'string'
                  ? meta.blockedSettingKey
                  : 'lingyun.security.allowExternalPaths';
              toolMsg.toolCall.isOutsideWorkspace = true;
            }
            if (meta.isOutsideWorkspace) {
              toolMsg.toolCall.isOutsideWorkspace = true;
            }
          }

          if (toolMsg.toolCall.id === 'lsp' && result.success) {
            try {
              toolMsg.toolCall.lsp = JSON.parse(resultStr);
            } catch {
              // ignore parse errors
            }
          }

          const hasDiff = typeof toolMsg.toolCall.diff === 'string' && toolMsg.toolCall.diff.length > 0;
          let storeOutput = !result.success || (!!resultStr.trim() && !hasDiff);
          if (hasDiff && result.success && (toolId === 'edit' || toolId === 'write')) {
            // Edit/write output may include diagnostics; keep it alongside the diff.
            storeOutput = !!resultStr.trim();
          }
          if (toolMsg.toolCall.id === 'todowrite' || toolMsg.toolCall.id === 'todoread') {
            // Todo output is already surfaced in the header popover; avoid spamming the chat with raw JSON.
            storeOutput = false;
          }
          toolMsg.toolCall.result = storeOutput ? resultStr.substring(0, 4000) : undefined;

          const maybeTodos = (result.metadata as any)?.todos;
          if (Array.isArray(maybeTodos)) {
            toolMsg.toolCall.todos = maybeTodos;
          }

          this.postMessage({ type: 'updateTool', message: toolMsg });

          if (Array.isArray(maybeTodos)) {
            this.postMessage({ type: 'todos', todos: maybeTodos });
          }
          if (persistSessions) {
            this.persistActiveSession();
          }
        }
      },
      onRequestApproval: async (tc, def) => {
        postStepMsgIfNeeded();
        reconcileAssistantForToolCall();
        return this.requestInlineApproval(tc, def);
      },
      onIterationEnd: async () => {
        if (this.mode === 'build' && stepMsg?.step?.snapshot?.baseHash) {
          const snapshot = await this.getWorkspaceSnapshot();
          if (snapshot) {
            try {
              const baseHash = stepMsg.step.snapshot.baseHash;
              const patch = await snapshot.patch(baseHash);
              if (patch.files.length > 0) {
                stepMsg.step.patch = { baseHash: patch.baseHash, files: patch.files };
              } else {
                delete stepMsg.step.patch;
              }
              if (persistSessions) {
                this.persistActiveSession();
              }
            } catch (error) {
              this.snapshotUnavailableReason = error instanceof Error ? error.message : String(error);
            }
          }
        }

        reconcileAssistantFromHistory();
        finalizeAssistantForStepEnd();
        if (stepPosted && stepMsg?.step) {
          if (stepMsg.step.status !== 'canceled') {
            stepMsg.step.status = 'done';
          }
          this.postMessage({ type: 'updateMessage', message: stepMsg });
        }
        if (persistSessions) {
          this.persistActiveSession();
        }
        this.postMessage({ type: 'context', context: this.getContextForUI() });
        if (debugLlm) {
          debug(
            `[Thinking] end tokens=${String(thoughtTokensSeen)} chars=${String(thoughtCharsSeen)} created=${String(!!thoughtMsg)} bufferChars=${String(thoughtBuffer.length)}`,
          );
        }
      },
      onCompactionEnd: ({ auto, summaryMessageId, status, error }) => {
        if (!compactionMsg || !compactionMsg.operation) return;

        const endedAt = Date.now();
        const opStatus = status === 'done' ? 'done' : status === 'canceled' ? 'canceled' : 'error';
        const label =
          opStatus === 'done'
            ? auto
              ? 'Context compacted (auto)'
              : 'Context compacted'
            : opStatus === 'canceled'
              ? auto
                ? 'Auto compaction canceled'
                : 'Compaction canceled'
              : auto
                ? 'Auto compaction failed'
                : 'Compaction failed';

        compactionMsg.operation.status = opStatus;
        compactionMsg.operation.label = label;
        compactionMsg.operation.endedAt = endedAt;

        if (opStatus !== 'done') {
          compactionMsg.operation.detail = error ? String(error) : undefined;
        } else {
          compactionMsg.operation.detail = auto
            ? 'Summarized older messages into a compact note to avoid context overflow.'
            : 'Summarized older messages into a compact note.';

          if (summaryMessageId) {
            const history = this.agent.getHistory();
            const summary = history.find(m => m.id === summaryMessageId);
            const summaryText = summary ? getMessageText(summary) : '';
            if (summaryText.trim()) {
              const trimmed = summaryText.length > MAX_COMPACTION_SUMMARY_CHARS
                ? summaryText.slice(0, MAX_COMPACTION_SUMMARY_CHARS) + '\n\n[Summary truncated in UI]'
                : summaryText;
              compactionMsg.operation.summaryText = trimmed;
              compactionMsg.operation.summaryTruncated = summaryText.length > MAX_COMPACTION_SUMMARY_CHARS;
            }
          }
        }

        this.postMessage({ type: 'updateMessage', message: compactionMsg });
        this.postMessage({
          type: 'operationEnd',
          operation: {
            id: compactionMsg.id,
            kind: 'compact',
            status: opStatus,
            label,
            startedAt: compactionMsg.operation.startedAt,
            endedAt,
          },
        });

        // Compaction changes the effective prompt boundary; refresh the context indicator now.
        this.postMessage({ type: 'context', context: this.getContextForUI() });

        if (persistSessions) {
          this.persistActiveSession();
        }

        compactionMsg = undefined;
      },
      onStatusChange: (status) => {
        if (!this.currentTurnId) return;

        if (status.type === 'retry') {
          this.postMessage({
            type: 'turnStatus',
            turnId: this.currentTurnId,
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
          this.postMessage({
            type: 'turnStatus',
            turnId: this.currentTurnId,
            status: { type: 'running', message: status.message || '' },
          });
          return;
        }

        if (status.type === 'error') {
          this.postMessage({
            type: 'turnStatus',
            turnId: this.currentTurnId,
            status: { type: 'error', message: status.message || 'unknown error' },
          });
          return;
        }

        if (status.type === 'done') {
          this.postMessage({
            type: 'turnStatus',
            turnId: this.currentTurnId,
            status: { type: 'done' },
          });
        }
      },
      onDebug: (message) => {
        const config = vscode.workspace.getConfiguration('lingyun');
        const debugLlm = config.get<boolean>('debug.llm') ?? false;
        const debugTools = config.get<boolean>('debug.tools') ?? false;
        if (!debugLlm && !debugTools) return;

        const isTool = typeof message === 'string' && message.startsWith('[Tool]');
        if (isTool && !debugTools) return;
        if (!isTool && !debugLlm) return;
        if (!message) return;
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel?.appendLine(`[${timestamp}] ${message}`);
      },
      onComplete: (response) => {
        finalizeAssistantForStepEnd();
        if (!assistantMsg && response) {
          pushAssistant(response);
        }
        if (this.currentTurnId) {
          this.postMessage({ type: 'turnStatus', turnId: this.currentTurnId, status: { type: 'done' } });
        }
        this.abortRequested = false;
        this.activeStepId = undefined;
        stepMsg = undefined;
        stepPosted = false;
        this.postMessage({ type: 'complete' });
        this.postMessage({ type: 'context', context: this.getContextForUI() });
        if (persistSessions) {
          this.persistActiveSession();
        }
      },
      onError: (error) => {
        const debugEnabled =
          vscode.workspace.getConfiguration('lingyun').get<boolean>('debug.llm') ?? false;
        if (debugEnabled) {
          try {
            const err = error instanceof Error ? error : new Error(String(error));
            const anyErr = err as any;
            const lines = [
              `[Agent] Error: ${err.name}: ${err.message}`,
              anyErr?.code ? `code=${String(anyErr.code)}` : '',
              anyErr?.cause
                ? `cause=${
                    typeof anyErr.cause === 'object'
                      ? JSON.stringify(anyErr.cause)
                      : String(anyErr.cause)
                  }`
                : '',
              err.stack ? `stack=${err.stack}` : '',
            ].filter(Boolean);
            this.outputChannel?.appendLine(lines.join('\n'));
          } catch {
            // ignore logging failures
          }
        }

        if (this.currentTurnId) {
          this.postMessage({
            type: 'turnStatus',
            turnId: this.currentTurnId,
            status: { type: 'error', message: formatErrorForUser(error) },
          });
        }

        if (stepMsg?.step) {
          stepMsg.step.status = this.abortRequested ? 'canceled' : 'error';
          if (stepPosted) {
            this.postMessage({ type: 'updateMessage', message: stepMsg });
          }
        }
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'error',
          content: formatErrorForUser(error),
          timestamp: Date.now(),
          turnId: this.currentTurnId,
        };
        this.messages.push(errorMsg);
        this.postMessage({ type: 'message', message: errorMsg });
        this.postMessage({ type: 'context', context: this.getContextForUI() });
        if (persistSessions) {
          this.persistActiveSession();
        }
      },
    };
  },
});
