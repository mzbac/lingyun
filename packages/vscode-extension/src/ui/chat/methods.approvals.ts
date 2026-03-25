import * as vscode from 'vscode';

import type { ToolCall, ToolDefinition } from '../../core/types';

import type { ChatMode, ChatMessage } from './types';
import { formatWorkspacePathForUI } from './utils';
import { bindChatControllerService } from './controllerService';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';

export interface ChatApprovalsService {
  onAutoApproveEnabled(): void;
  postApprovalState(): void;
  handleApprovalResponse(approvalId: string, approved: boolean): void;
  approveAllPendingApprovals(): void;
  rejectAllPendingApprovals(reason: string): void;
  requestInlineApproval(tc: ToolCall, def: ToolDefinition, parentMessageId?: string): Promise<boolean>;
  markActiveStepStatus(status: 'running' | 'done' | 'error' | 'canceled'): void;
}

export interface ChatApprovalsDeps {
  view?: vscode.WebviewView;
  pendingApprovals: Map<string, { resolve: (approved: boolean) => void; toolName: string; stepId?: string }>;
  autoApproveThisRun: boolean;
  messages: ChatMessage[];
  mode: ChatMode;
  autoApprovedTools: Set<string>;
  activeStepId?: string;
  currentTurnId?: string;
  sessionApi: Pick<ChatSessionsService, 'persistActiveSession'>;
  webviewApi: Pick<ChatWebviewService, 'postMessage'>;
}

export function createChatApprovalsService(controller: ChatApprovalsDeps): ChatApprovalsService {
  const service = bindChatControllerService(controller, {
    onAutoApproveEnabled(this: ChatApprovalsDeps): void {
      if (this.pendingApprovals.size === 0) return;
      service.approveAllPendingApprovals();
    },

    postApprovalState(this: ChatApprovalsDeps): void {
      if (!this.view) return;
      this.webviewApi.postMessage({
        type: 'approvalsChanged',
        count: this.pendingApprovals.size,
        autoApproveThisRun: this.autoApproveThisRun,
      });
    },

    handleApprovalResponse(this: ChatApprovalsDeps, approvalId: string, approved: boolean): void {
      const pending = this.pendingApprovals.get(approvalId);
      if (!pending) return;

      pending.resolve(approved);
      this.pendingApprovals.delete(approvalId);
      service.postApprovalState();

      const toolMsg = [...this.messages].reverse().find((message) => {
        if (message.toolCall?.approvalId !== approvalId) return false;
        if (pending.stepId && message.stepId !== pending.stepId) return false;
        return true;
      });
      if (toolMsg?.toolCall) {
        toolMsg.toolCall.status = approved ? 'running' : 'rejected';
        this.webviewApi.postMessage({ type: 'updateTool', message: toolMsg });
      }

      this.sessionApi.persistActiveSession();
    },

    approveAllPendingApprovals(this: ChatApprovalsDeps): void {
      if (this.pendingApprovals.size === 0) return;
      this.autoApproveThisRun = true;

      const entries = [...this.pendingApprovals.entries()];
      this.pendingApprovals.clear();

      for (const [approvalId, pending] of entries) {
        pending.resolve(true);
        const toolMsg = [...this.messages].reverse().find((message) => {
          if (message.toolCall?.approvalId !== approvalId) return false;
          if (pending.stepId && message.stepId !== pending.stepId) return false;
          return true;
        });
        if (toolMsg?.toolCall) {
          toolMsg.toolCall.status = 'running';
          this.webviewApi.postMessage({ type: 'updateTool', message: toolMsg });
        }
      }

      service.postApprovalState();
      this.sessionApi.persistActiveSession();
    },

    rejectAllPendingApprovals(this: ChatApprovalsDeps, reason: string): void {
      if (this.pendingApprovals.size === 0) return;

      const entries = [...this.pendingApprovals.entries()];
      this.pendingApprovals.clear();

      for (const [approvalId, pending] of entries) {
        pending.resolve(false);
        const toolMsg = [...this.messages].reverse().find((message) => {
          if (message.toolCall?.approvalId !== approvalId) return false;
          if (pending.stepId && message.stepId !== pending.stepId) return false;
          return true;
        });
        if (toolMsg?.toolCall) {
          toolMsg.toolCall.status = 'rejected';
          toolMsg.toolCall.result = toolMsg.toolCall.result || reason;
          this.webviewApi.postMessage({ type: 'updateTool', message: toolMsg });
        }
      }

      service.postApprovalState();
      this.sessionApi.persistActiveSession();
    },

    requestInlineApproval(
      this: ChatApprovalsDeps,
      tc: ToolCall,
      def: ToolDefinition,
      parentMessageId?: string
    ): Promise<boolean> {
      const globalAutoApprove =
        this.mode === 'build'
          ? (vscode.workspace.getConfiguration('lingyun').get<boolean>('autoApprove', false) ?? false)
          : false;
      if (globalAutoApprove) return Promise.resolve(true);
      if (this.mode === 'build' && this.autoApprovedTools.has(def.id)) return Promise.resolve(true);
      if (this.autoApproveThisRun) return Promise.resolve(true);

      const approvalId = tc.id;
      const stepId = parentMessageId ?? this.activeStepId;

      const existing = [...this.messages].reverse().find((message) => {
        if (message.toolCall?.approvalId !== approvalId) return false;
        if (stepId && message.stepId !== stepId) return false;
        return true;
      });
      if (existing?.toolCall) {
        existing.toolCall.status = 'pending';
        this.webviewApi.postMessage({ type: 'updateTool', message: existing });
      } else {
        let uiPath: string | undefined;
        try {
          const args = JSON.parse(tc.function.arguments || '{}');
          uiPath = (args as any).filePath || (args as any).path || (args as any).workdir;
        } catch {
          // Ignore parse errors.
        }
        uiPath = formatWorkspacePathForUI(uiPath);

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
            path: uiPath,
          },
        };
        this.messages.push(toolMsg);
        this.webviewApi.postMessage({ type: 'message', message: toolMsg });
      }

      return new Promise((resolve) => {
        this.pendingApprovals.set(approvalId, { resolve, toolName: def.id, stepId });
        service.postApprovalState();
      });
    },

    markActiveStepStatus(this: ChatApprovalsDeps, status: 'running' | 'done' | 'error' | 'canceled'): void {
      if (!this.activeStepId) return;
      const stepMsg = this.messages.find((message) => message.id === this.activeStepId);
      if (!stepMsg?.step) return;
      stepMsg.step.status = status;
      this.webviewApi.postMessage({ type: 'updateMessage', message: stepMsg });
    },
  });

  return service;
}
