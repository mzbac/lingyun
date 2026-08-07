import * as vscode from 'vscode';

import type { AgentApprovalContext, ToolCall, ToolDefinition } from '../../core/types';

import {
  clearAutoApprovedTools,
  forgetAutoApprovedTool,
  getAutoApprovedToolIds,
  persistAutoApprovedTools,
  rememberAutoApprovedTool,
} from './autoApprovedToolsStore';
import {
  buildApprovalStateForUI,
  isManualApprovalContext,
  partitionPendingApprovals,
} from './approvalState';
import type { PendingApprovalEntry } from './controllerPorts';
import { bindChatControllerService } from './controllerService';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';
import { findApprovalToolMessage, findChatMessageById, upsertToolMessage } from './toolMessageLookup';
import { getAutoApproveEnabled } from './webviewSettings';
import type { ChatMode, ChatMessage } from './types';
import { formatWorkspacePathForUI } from './utils';

export interface ChatApprovalsService {
  onAutoApproveEnabled(): void;
  postApprovalState(): void;
  getAutoApprovedToolsForUI(): string[];
  revokeAutoApprovedTool(toolId: string): Promise<void>;
  clearAutoApprovedToolsForUI(): Promise<void>;
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

function postAutoApprovedToolsState(controller: Pick<ChatApprovalsDeps, 'autoApprovedTools' | 'webviewApi'>): void {
  controller.webviewApi.postMessage({
    type: 'autoApprovedToolsState',
    autoApprovedTools: getAutoApprovedToolIds(controller.autoApprovedTools),
  });
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

    getAutoApprovedToolsForUI(this: ChatApprovalsDeps): string[] {
      return getAutoApprovedToolIds(this.autoApprovedTools);
    },

    async revokeAutoApprovedTool(this: ChatApprovalsDeps, toolId: string): Promise<void> {
      if (!forgetAutoApprovedTool(this.autoApprovedTools, toolId)) {
        service.postApprovalState();
        postAutoApprovedToolsState(this);
        return;
      }

      await persistAutoApprovedTools({
        globalState: this.context.globalState,
        autoApprovedTools: this.autoApprovedTools,
        outputChannel: this.outputChannel,
      });
      service.postApprovalState();
      postAutoApprovedToolsState(this);
    },

    async clearAutoApprovedToolsForUI(this: ChatApprovalsDeps): Promise<void> {
      if (!clearAutoApprovedTools(this.autoApprovedTools)) {
        service.postApprovalState();
        postAutoApprovedToolsState(this);
        return;
      }

      await persistAutoApprovedTools({
        globalState: this.context.globalState,
        autoApprovedTools: this.autoApprovedTools,
        outputChannel: this.outputChannel,
      });
      service.postApprovalState();
      postAutoApprovedToolsState(this);
    },

    handleApprovalResponse(this: ChatApprovalsDeps, approvalId: string, approved: boolean): void {
      const pending = this.pendingApprovals.get(approvalId);
      if (!pending) {
        service.postApprovalState();
        return;
      }

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
        service.postApprovalState();
        postAutoApprovedToolsState(this);
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
        postAutoApprovedToolsState(this);
      }
    },


    approveAllPendingApprovals(this: ChatApprovalsDeps, options?: { includeManual?: boolean }): void {
      if (this.pendingApprovals.size === 0) {
        service.postApprovalState();
        return;
      }

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
      const globalAutoApprove = this.mode === 'build' ? getAutoApproveEnabled() : false;
      if (!manualApproval && globalAutoApprove) return Promise.resolve(true);
      if (!manualApproval && this.mode === 'build' && this.autoApprovedTools.has(def.id)) return Promise.resolve(true);
      if (!manualApproval && this.autoApproveThisRun) return Promise.resolve(true);

      const approvalId = tc.id;
      const stepId = parentMessageId ?? this.activeStepId;

      let uiPath: string | undefined;
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        uiPath = (args as any).filePath || (args as any).path || (args as any).workdir;
      } catch {
        // Ignore parse errors.
      }
      uiPath = formatWorkspacePathForUI(uiPath);

      upsertToolMessage({
        view: { messages: this.messages, postMessage: (message) => this.webviewApi.postMessage(message) },
        tc,
        def,
        status: 'pending',
        turnId: this.currentTurnId,
        stepId,
        path: uiPath,
        isProtected: manualApproval,
        approvalReason: approvalContext?.reason,
        lookupScope: { currentTurnId: this.currentTurnId, currentStepId: stepId },
      });

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
      const stepMsg = findChatMessageById(this.messages, this.activeStepId);
      if (!stepMsg?.step) return;
      stepMsg.step.status = status;
      this.webviewApi.postMessage({ type: 'updateMessage', message: stepMsg });
    },
  });

  return service;
}
