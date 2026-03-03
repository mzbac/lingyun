import type { AgentCallbacks, SubagentEvent, ToolCall, ToolDefinition, ToolResult } from '../../core/types';
import { OfficeBridge } from './bridge';

export type OfficeSyncState = {
  sessions: Iterable<{ id: string; parentSessionId?: string }>;
  activeSessionId: string;
  isProcessing: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tryParseArgs(raw: string): Record<string, unknown> {
  const json = typeof raw === 'string' ? raw : '';
  if (!json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class OfficeSync {
  constructor(
    private readonly bridge: OfficeBridge,
    private readonly getState: () => OfficeSyncState,
  ) {}

  sync(): void {
    const { sessions, activeSessionId, isProcessing } = this.getState();
    const visibleSessionId = this.bridge.syncSessions(sessions, activeSessionId);
    if (!visibleSessionId) return;
    this.bridge.postAgentStatus(visibleSessionId, isProcessing ? 'active' : 'idle');
  }

  /**
   * Called when the Office webview first connects. It may have missed prior
   * state transitions while not loaded.
   */
  onWebviewReady(): void {
    this.sync();
  }

  onRunStart(options?: { clearTools?: boolean }): void {
    const { activeSessionId } = this.getState();
    if (!activeSessionId) return;
    this.sync();
    if (options?.clearTools !== false) {
      this.bridge.postAgentToolsClear(activeSessionId);
    }
    this.bridge.postAgentPermissionClear(activeSessionId);
    this.bridge.postAgentStatus(activeSessionId, 'active');
  }

  onRunEnd(): void {
    const { activeSessionId } = this.getState();
    if (!activeSessionId) return;
    this.bridge.postAgentPermissionClear(activeSessionId);
    this.bridge.postAgentStatus(activeSessionId, 'waiting');
  }

  onToolCall(toolCall: ToolCall, definition: ToolDefinition): void {
    const { activeSessionId } = this.getState();
    if (!activeSessionId) return;
    const args = tryParseArgs(toolCall.function.arguments);
    this.bridge.postAgentToolStart({
      sessionId: activeSessionId,
      toolCallId: toolCall.id,
      toolName: definition.id || toolCall.function.name,
      args,
    });
  }

  onToolDone(toolCallId: string): void {
    const { activeSessionId } = this.getState();
    if (!activeSessionId) return;
    this.bridge.postAgentToolDone(activeSessionId, toolCallId);
  }

  onApprovalStart(): void {
    const { activeSessionId } = this.getState();
    if (!activeSessionId) return;
    this.bridge.postAgentPermission(activeSessionId);
  }

  onApprovalEnd(): void {
    const { activeSessionId } = this.getState();
    if (!activeSessionId) return;
    this.bridge.postAgentPermissionClear(activeSessionId);
  }

  onSubagentEvent(event: SubagentEvent): void {
    const parentSessionId = event.parentSessionId || this.getState().activeSessionId;
    if (!parentSessionId) return;

    switch (event.type) {
      case 'subagent_start':
        this.bridge.postSubagentCreated({
          parentSessionId,
          parentToolCallId: event.parentToolCallId,
          label: event.description,
          subagentType: event.subagentType,
        });
        return;
      case 'subagent_tool_call':
        this.bridge.handleSubagentToolCall({
          parentSessionId,
          parentToolCallId: event.parentToolCallId,
          tool: event.tool,
          definition: event.definition,
        });
        return;
      case 'subagent_tool_result':
        this.bridge.handleSubagentToolResult({
          parentSessionId,
          parentToolCallId: event.parentToolCallId,
          tool: event.tool,
          result: event.result,
        });
        return;
      case 'subagent_request_approval':
        this.bridge.handleSubagentRequestApproval({
          parentSessionId,
          parentToolCallId: event.parentToolCallId,
          tool: event.tool,
          definition: event.definition,
        });
        return;
      case 'subagent_approval_resolved':
        this.bridge.handleSubagentApprovalResolved({
          parentSessionId,
          parentToolCallId: event.parentToolCallId,
        });
        return;
      case 'subagent_complete':
        this.bridge.postSubagentClear({
          parentSessionId,
          parentToolCallId: event.parentToolCallId,
        });
        return;
    }
  }
}

/**
 * Decorate a host `AgentCallbacks` object so OfficeSync can track tool activity
 * without leaking Office-specific logic across the Chat UI internals.
 */
export function decorateAgentCallbacksWithOfficeSync(
  callbacks: AgentCallbacks,
  officeSync: OfficeSync,
): AgentCallbacks {
  // Subagent tool approvals show up in two places:
  // 1) as `subagent_request_approval` (so the Office UI can show a bubble on the subagent)
  // 2) as the host `onRequestApproval` (because the subagent reuses the host approval handler)
  //
  // Track subagent toolCallIds here so we don't also show the *parent* agent approval bubble.
  const subagentToolCallIdsAwaitingApproval = new Set<string>();

  return {
    ...callbacks,
    onToolCall: async (tc, def) => {
      officeSync.onToolCall(tc, def);
      await callbacks.onToolCall?.(tc, def);
    },
    onToolBlocked: (tc, def, reason) => {
      officeSync.onToolDone(tc.id);
      callbacks.onToolBlocked?.(tc, def, reason);
    },
    onToolResult: (tc: ToolCall, result: ToolResult) => {
      officeSync.onToolDone(tc.id);
      callbacks.onToolResult?.(tc, result);
    },
    onRequestApproval: callbacks.onRequestApproval
      ? async (tc, def) => {
          const skipParentBubble = subagentToolCallIdsAwaitingApproval.has(tc.id);
          if (!skipParentBubble) {
            officeSync.onApprovalStart();
          }
          try {
            return (await callbacks.onRequestApproval?.(tc, def)) ?? false;
          } finally {
            if (!skipParentBubble) {
              officeSync.onApprovalEnd();
            }
          }
        }
      : undefined,
    onSubagentEvent: (event) => {
      if (event.type === 'subagent_request_approval') {
        subagentToolCallIdsAwaitingApproval.add(event.tool.id);
      } else if (event.type === 'subagent_approval_resolved') {
        subagentToolCallIdsAwaitingApproval.delete(event.tool.id);
      }
      officeSync.onSubagentEvent(event);
      return callbacks.onSubagentEvent?.(event);
    },
  };
}
