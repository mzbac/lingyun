import * as vscode from 'vscode';
import type { ToolCall, ToolDefinition } from '../../core/types';
import type { ChatMessage } from './types';
import { formatWorkspacePathForUI } from './utils';
import { ChatViewProvider } from '../chat';

Object.assign(ChatViewProvider.prototype, {
  onAutoApproveEnabled(this: ChatViewProvider): void {
    if (this.pendingApprovals.size === 0) return;
    // If the user enables global auto-approve while we're blocked waiting for approvals,
    // unblock immediately so the run can continue.
    this.approveAllPendingApprovals();
  },

  postApprovalState(this: ChatViewProvider): void {
    if (!this.view) return;
    this.postMessage({
      type: 'approvalsChanged',
      count: this.pendingApprovals.size,
      autoApproveThisRun: this.autoApproveThisRun,
    });
  },

  handleApprovalResponse(this: ChatViewProvider, approvalId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      pending.resolve(approved);
      this.pendingApprovals.delete(approvalId);
      this.postApprovalState();

      const toolMsg = [...this.messages].reverse().find(m => {
        if (m.toolCall?.approvalId !== approvalId) return false;
        if (pending.stepId && m.stepId !== pending.stepId) return false;
        return true;
      });
      if (toolMsg?.toolCall) {
        toolMsg.toolCall.status = approved ? 'running' : 'rejected';
        this.postMessage({ type: 'updateTool', message: toolMsg });
      }

      this.persistActiveSession();
    }
  },

  approveAllPendingApprovals(this: ChatViewProvider): void {
    if (this.pendingApprovals.size === 0) return;
    this.autoApproveThisRun = true;

    const entries = [...this.pendingApprovals.entries()];
    this.pendingApprovals.clear();

    for (const [approvalId, pending] of entries) {
      pending.resolve(true);
      const toolMsg = [...this.messages].reverse().find(m => {
        if (m.toolCall?.approvalId !== approvalId) return false;
        if (pending.stepId && m.stepId !== pending.stepId) return false;
        return true;
      });
      if (toolMsg?.toolCall) {
        toolMsg.toolCall.status = 'running';
        this.postMessage({ type: 'updateTool', message: toolMsg });
      }
    }

    this.postApprovalState();
    this.persistActiveSession();
  },

  rejectAllPendingApprovals(this: ChatViewProvider, reason: string): void {
    if (this.pendingApprovals.size === 0) return;

    const entries = [...this.pendingApprovals.entries()];
    this.pendingApprovals.clear();

    for (const [approvalId, pending] of entries) {
      pending.resolve(false);
      const toolMsg = [...this.messages].reverse().find(m => {
        if (m.toolCall?.approvalId !== approvalId) return false;
        if (pending.stepId && m.stepId !== pending.stepId) return false;
        return true;
      });
      if (toolMsg?.toolCall) {
        toolMsg.toolCall.status = 'rejected';
        toolMsg.toolCall.result = toolMsg.toolCall.result || reason;
        this.postMessage({ type: 'updateTool', message: toolMsg });
      }
    }

    this.postApprovalState();
    this.persistActiveSession();
  },

  requestInlineApproval(
    this: ChatViewProvider,
    tc: ToolCall,
    def: ToolDefinition,
    parentMessageId?: string
  ): Promise<boolean> {
    const globalAutoApprove =
      this.mode === 'build'
        ? (vscode.workspace.getConfiguration('lingyun').get<boolean>('autoApprove', false) ?? false)
        : false;
    if (globalAutoApprove) {
      return Promise.resolve(true);
    }

    if (this.mode === 'build' && this.autoApprovedTools.has(def.id)) {
      return Promise.resolve(true);
    }

    if (this.autoApproveThisRun) {
      return Promise.resolve(true);
    }

    const approvalId = tc.id;
    const stepId = parentMessageId ?? this.activeStepId;

    const existing = [...this.messages].reverse().find(m => {
      if (m.toolCall?.approvalId !== approvalId) return false;
      if (stepId && m.stepId !== stepId) return false;
      return true;
    });
    if (existing?.toolCall) {
      existing.toolCall.status = 'pending';
      this.postMessage({ type: 'updateTool', message: existing });
    } else {
      let path: string | undefined;
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        path = (args as any).filePath || (args as any).path || (args as any).workdir;
      } catch {
        // Ignore parse errors
      }
      path = formatWorkspacePathForUI(path);

      const toolMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        content: '',
        timestamp: Date.now(),
        turnId: this.currentTurnId,
        stepId,
        toolCall: {
          id: def.id,
          name: def.name,
          args: tc.function.arguments,
          status: 'pending',
          approvalId,
          path,
        },
      };
      this.messages.push(toolMsg);
      this.postMessage({ type: 'message', message: toolMsg });
    }

    return new Promise((resolve) => {
      this.pendingApprovals.set(approvalId, { resolve, toolName: def.id, stepId });
      this.postApprovalState();
    });
  },

  markActiveStepStatus(this: ChatViewProvider, status: 'running' | 'done' | 'error' | 'canceled'): void {
    if (!this.activeStepId) return;
    const stepMsg = this.messages.find(m => m.id === this.activeStepId);
    if (!stepMsg?.step) return;
    stepMsg.step.status = status;
    this.postMessage({ type: 'updateMessage', message: stepMsg });
  },
});
