import * as vscode from 'vscode';

import type { ChatUserInput } from './types';
import type { ChatController } from './controller';

export function installRunnerInputMethods(controller: ChatController): void {
  Object.assign(controller, {
    sendMessage(this: ChatController, content: string): void {
      if (!this.view) return;
      void this.runner.handleUserMessage(content);
    },

    async handleUserMessage(this: ChatController, content: string | ChatUserInput): Promise<void> {
      await this.runner.handleUserMessage(content);
    },

    async retryToolCall(this: ChatController, approvalId: string): Promise<void> {
      await this.runner.retryToolCall(approvalId);
    },

    isPlanFirstEnabled(this: ChatController): boolean {
      return vscode.workspace.getConfiguration('lingyun').get<boolean>('planFirst', true) ?? true;
    },

    classifyPlanStatus(this: ChatController, plan: string): 'draft' | 'needs_input' {
      const text = (plan || '').trim();
      if (!text) return 'needs_input';

      const steps = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => /^\d+\.\s+/.test(l) || /^[-*•]\s+/.test(l))
        .map(l => l.replace(/^\d+\.\s+/, '').replace(/^[-*•]\s+/, '').trim())
        .filter(Boolean);

      if (steps.length === 0) return 'needs_input';

      const questionSteps = steps.filter(s => /\?\s*$/.test(s));
      if (questionSteps.length >= Math.ceil(steps.length / 2)) return 'needs_input';

      return 'draft';
    },
  });
}

