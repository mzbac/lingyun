import * as vscode from 'vscode';

import type { AgentApprovalContext, ToolCall, ToolDefinition } from '../../core/types';

import { persistAutoApprovedTools, rememberAutoApprovedTool } from './autoApprovedToolsStore';
import {
  buildApprovalStateForUI,
  isManualApprovalContext,
  partitionPendingApprovals,
} from './approvalState';
import type { PendingApprovalEntry } from './controllerPorts';
import { bindChatControllerService } from './controllerService';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';
import { findApprovalToolMessage } from './toolMessageLookup';
import type { ChatMode, ChatMessage } from './types';
import { formatWorkspacePathForUI } from './utils';

export interface ChatApprovalsService {
  onAutoApproveEnabled(): void;
  postApprovalState(): void;
  handleApprovalResponse(approvalId: string, approved: boolean): void;
  handleAlwaysAllowApproval(approvalId: string): Promise<void>;
  approveAllPendingApprovals(options?: { includeManual?: boolean }): void;
  rejectAllPendingApprovals(reason: string): void;
  requestInlineApproval(
    tc: ToolCall,
    def: ToolDefinition,
    parentMessageId?: string,
    approvalContext?: AgentApprovalContext
  ): Promise<boolean>;
  markActiveStepStatus(status: 'running' | 'done' | 'error' | 'canceled'): void;
}

type GlobalStateLike = {
  update(key: string, value: unknown): Thenable<void>;
};

export interface ChatApprovalsDeps {
  view?: vscode.WebviewView;
  outputChannel?: vscode.OutputChannel;
  context: { globalState: GlobalStateLike };
  pendingApprovals: Map<string, PendingApprovalEntry>;
  autoApproveThisRun: boolean;
  messages: ChatMessage[];
  mode: ChatMode;
  autoApprovedTools: Set<string>;
  activeStepId?: string;
  currentTurnId?: string;
  sessionApi: Pick<ChatSessionsService, 'persistActiveSession'>;
  webviewApi: Pick<ChatWebviewService, 'postMessage'>;
}

type ChatApprovalToolCall = NonNullable<ChatMessage['toolCall']>;

function postUpdatedApprovalToolMessage(
  controller: Pick<ChatApprovalsDeps, 'messages' | 'webviewApi'>,
  params: {
    approvalId: string;
    stepId?: string;
    update(toolCall: ChatApprovalToolCall): void;
  }
): void {

  const toolMsg = findApprovalToolMessage({
    messages: controller.messages,
    approvalId: params.approvalId,
    stepId: params.stepId,
  });
  if (!toolMsg?.toolCall) {
    return;
  }

  params.update(toolMsg.toolCall);
  controller.webviewApi.postMessage({ type: 'updateTool', message: toolMsg });
}

export function createChatApprovalsService(controller: ChatApprovalsDeps): ChatApprovalsService {
  const service = bindChatControllerService(controller, {
    onAutoApproveEnabled(this: ChatApprovalsDeps): void {
      if (this.pendingApprovals.size === 0) return;
      service.approveAllPendingApprovals({ includeManual: false });
    },

    postApprovalState(this: ChatApprovalsDeps): void {
      if (!this.view) return;
      const approvalState = buildApprovalStateForUI({
        pendingApprovals: this.pendingApprovals,
        autoApproveThisRun: this.autoApproveThisRun,
      });
      this.webviewApi.postMessage({
        type: 'approvalsChanged',
        ...approvalState,
      });
    },

    handleApprovalResponse(this: ChatApprovalsDeps, approvalId: string, approved: boolean): void {
      const pending = this.pendingApprovals.get(approvalId);
      if (!pending) return;

      pending.resolve(approved);
      this.pendingApprovals.delete(approvalId);
      service.postApprovalState();

      postUpdatedApprovalToolMessage(this, {
        approvalId,
        stepId: pending.stepId,
        update: toolCall => {
          toolCall.status = approved ? 'running' : 'rejected';
        },
      });

      this.sessionApi.persistActiveSession();
    },

    async handleAlwaysAllowApproval(this: ChatApprovalsDeps, approvalId: string): Promise<void> {
      const pending = this.pendingApprovals.get(approvalId);
      if (!pending) {
        return;
      }

      const shouldPersistAutoApproval = !isManualApprovalContext(pending.approvalContext);
      if (shouldPersistAutoApproval) {
        rememberAutoApprovedTool(this.autoApprovedTools, pending.toolName);
      }

      service.handleApprovalResponse(approvalId, true);

      if (shouldPersistAutoApproval) {
        await persistAutoApprovedTools({
          globalState: this.context.globalState,
          autoApprovedTools: this.autoApprovedTools,
          outputChannel: this.outputChannel,
        });
      }
    },


    approveAllPendingApprovals(this: ChatApprovalsDeps, options?: { includeManual?: boolean }): void {
      if (this.pendingApprovals.size === 0) return;

      const { manualEntries, approvableEntries } = partitionPendingApprovals(this.pendingApprovals, options);
      if (approvableEntries.length === 0) {
        service.postApprovalState();
        return;
      }

      this.autoApproveThisRun = true;
      this.pendingApprovals.clear();
      for (const [approvalId, pending] of manualEntries) {
        this.pendingApprovals.set(approvalId, pending);
      }

      for (const [approvalId, pending] of approvableEntries) {
        pending.resolve(true);
        postUpdatedApprovalToolMessage(this, {
          approvalId,
          stepId: pending.stepId,
          update: toolCall => {
            toolCall.status = 'running';
          },
        });
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
        postUpdatedApprovalToolMessage(this, {
          approvalId,
          stepId: pending.stepId,
          update: toolCall => {
            toolCall.status = 'rejected';
            toolCall.result = toolCall.result || reason;
          },
        });
      }

      service.postApprovalState();
      this.sessionApi.persistActiveSession();
    },

    requestInlineApproval(
      this: ChatApprovalsDeps,
      tc: ToolCall,
      def: ToolDefinition,
      parentMessageId?: string,
      approvalContext?: AgentApprovalContext
    ): Promise<boolean> {
      const manualApproval = isManualApprovalContext(approvalContext);
      const globalAutoApprove =
        this.mode === 'build'
          ? (vscode.workspace.getConfiguration('lingyun').get<boolean>('autoApprove', false) ?? false)
          : false;
      if (!manualApproval && globalAutoApprove) return Promise.resolve(true);
      if (!manualApproval && this.mode === 'build' && this.autoApprovedTools.has(def.id)) return Promise.resolve(true);
      if (!manualApproval && this.autoApproveThisRun) return Promise.resolve(true);

      const approvalId = tc.id;
      const stepId = parentMessageId ?? this.activeStepId;
      const existing = findApprovalToolMessage({
        messages: this.messages,
        approvalId,
        stepId,
      });
      if (existing?.toolCall) {
        existing.toolCall.status = 'pending';
        existing.toolCall.isProtected = manualApproval || existing.toolCall.isProtected;
        existing.toolCall.approvalReason = approvalContext?.reason || existing.toolCall.approvalReason;
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
            isProtected: manualApproval || undefined,
            approvalReason: approvalContext?.reason,
          },
        };
        this.messages.push(toolMsg);
        this.webviewApi.postMessage({ type: 'message', message: toolMsg });
      }

      return new Promise((resolve) => {
        this.pendingApprovals.set(approvalId, {
          resolve,
          toolName: def.id,
          stepId,
          ...(approvalContext ? { approvalContext } : {}),
        });
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
