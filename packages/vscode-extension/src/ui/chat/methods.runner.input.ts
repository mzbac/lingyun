import * as vscode from 'vscode';

import { bindChatControllerService } from './controllerService';
import type { RunCoordinator } from './runner/runCoordinator';
import type { ChatUserInput, ChatUserMessageOptions } from './types';

export interface ChatRunnerInputService {
  sendMessage(content: string): void;
  handleUserMessage(content: string | ChatUserInput, options?: ChatUserMessageOptions): Promise<void>;
  retryFailedTurn(turnId: string): Promise<void>;
  retryToolCall(approvalId: string): Promise<void>;
  executePendingPlan(planMessageId?: string): Promise<void>;
  cancelPendingPlan(planMessageId: string): Promise<void>;
  revisePendingPlan(planMessageId: string, instructions: string): Promise<void>;
  isPlanFirstEnabled(): boolean;
  classifyPlanStatus(plan: string): 'draft' | 'needs_input';
}

export interface ChatRunnerInputDeps {
  view?: vscode.WebviewView;
  runner: Pick<
    RunCoordinator,
    | 'handleUserMessage'
    | 'retryFailedTurn'
    | 'retryToolCall'
    | 'executePendingPlan'
    | 'cancelPendingPlan'
    | 'revisePendingPlan'
  >;
}

function hasWhitespacePrefixSeparator(value: string, index: number): boolean {
  const char = value[index];
  return typeof char === 'string' && /\s/.test(char);
}

function extractPlanStepText(rawLine: string): string {
  const line = rawLine.trim();
  if (!line) return '';

  const first = line[0];
  if ((first === '-' || first === '*' || first === '•') && hasWhitespacePrefixSeparator(line, 1)) {
    return line.slice(2).trim();
  }

  let digitIndex = 0;
  while (digitIndex < line.length) {
    const charCode = line.charCodeAt(digitIndex);
    if (charCode < 48 || charCode > 57) break;
    digitIndex++;
  }
  if (digitIndex > 0 && line[digitIndex] === '.' && hasWhitespacePrefixSeparator(line, digitIndex + 1)) {
    return line.slice(digitIndex + 2).trim();
  }

  return '';
}

export function createChatRunnerInputService(controller: ChatRunnerInputDeps): ChatRunnerInputService {
  return bindChatControllerService(controller, {
    sendMessage(this: ChatRunnerInputDeps, content: string): void {
      if (!this.view) return;
      void this.runner.handleUserMessage(content);
    },

    async handleUserMessage(
      this: ChatRunnerInputDeps,
      content: string | ChatUserInput,
      options?: ChatUserMessageOptions
    ): Promise<void> {
      await this.runner.handleUserMessage(content, options);
    },

    async retryFailedTurn(this: ChatRunnerInputDeps, turnId: string): Promise<void> {
      await this.runner.retryFailedTurn(turnId);
    },

    async retryToolCall(this: ChatRunnerInputDeps, approvalId: string): Promise<void> {
      await this.runner.retryToolCall(approvalId);
    },

    async executePendingPlan(this: ChatRunnerInputDeps, planMessageId?: string): Promise<void> {
      await this.runner.executePendingPlan(planMessageId);
    },

    async cancelPendingPlan(this: ChatRunnerInputDeps, planMessageId: string): Promise<void> {
      await this.runner.cancelPendingPlan(planMessageId);
    },

    async revisePendingPlan(this: ChatRunnerInputDeps, planMessageId: string, instructions: string): Promise<void> {
      await this.runner.revisePendingPlan(planMessageId, instructions);
    },

    isPlanFirstEnabled(this: ChatRunnerInputDeps): boolean {
      return vscode.workspace.getConfiguration('lingyun').get<boolean>('planFirst', true) ?? true;
    },

    classifyPlanStatus(this: ChatRunnerInputDeps, plan: string): 'draft' | 'needs_input' {
      const text = (plan || '').trim();
      if (!text) return 'needs_input';

      let steps = 0;
      let questionSteps = 0;
      let lineStart = 0;
      for (let i = 0; i <= text.length; i++) {
        if (i < text.length && text.charCodeAt(i) !== 10) continue;
        const step = extractPlanStepText(text.slice(lineStart, i));
        if (step) {
          steps++;
          if (step.endsWith('?')) questionSteps++;
        }
        lineStart = i + 1;
      }

      if (steps === 0) return 'needs_input';
      if (questionSteps >= Math.ceil(steps / 2)) return 'needs_input';

      return 'draft';
    },
  });
}
