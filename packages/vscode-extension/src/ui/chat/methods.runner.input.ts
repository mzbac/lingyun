import * as vscode from 'vscode';

import { bindChatControllerService } from './controllerService';
import type { RunCoordinator } from './runner/runCoordinator';
import type { ChatUserInput } from './types';

export interface ChatRunnerInputService {
  sendMessage(content: string): void;
  handleUserMessage(content: string | ChatUserInput): Promise<void>;
  retryToolCall(approvalId: string): Promise<void>;
  isPlanFirstEnabled(): boolean;
  classifyPlanStatus(plan: string): 'draft' | 'needs_input';
}

export interface ChatRunnerInputDeps {
  view?: vscode.WebviewView;
  runner: Pick<RunCoordinator, 'handleUserMessage' | 'retryToolCall'>;
}

export function createChatRunnerInputService(controller: ChatRunnerInputDeps): ChatRunnerInputService {
  return bindChatControllerService(controller, {
    sendMessage(this: ChatRunnerInputDeps, content: string): void {
      if (!this.view) return;
      void this.runner.handleUserMessage(content);
    },

    async handleUserMessage(this: ChatRunnerInputDeps, content: string | ChatUserInput): Promise<void> {
      await this.runner.handleUserMessage(content);
    },

    async retryToolCall(this: ChatRunnerInputDeps, approvalId: string): Promise<void> {
      await this.runner.retryToolCall(approvalId);
    },

    isPlanFirstEnabled(this: ChatRunnerInputDeps): boolean {
      return vscode.workspace.getConfiguration('lingyun').get<boolean>('planFirst', true) ?? true;
    },

    classifyPlanStatus(this: ChatRunnerInputDeps, plan: string): 'draft' | 'needs_input' {
      const text = (plan || '').trim();
      if (!text) return 'needs_input';

      const steps = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /^\d+\.\s+/.test(line) || /^[-*•]\s+/.test(line))
        .map((line) => line.replace(/^\d+\.\s+/, '').replace(/^[-*•]\s+/, '').trim())
        .filter(Boolean);

      if (steps.length === 0) return 'needs_input';

      const questionSteps = steps.filter((step) => /\?\s*$/.test(step));
      if (questionSteps.length >= Math.ceil(steps.length / 2)) return 'needs_input';

      return 'draft';
    },
  });
}
