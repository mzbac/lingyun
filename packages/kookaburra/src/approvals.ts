import type { AgentApprovalContext, ToolCall, ToolDefinition } from '@kooka/agent-sdk';

import { redactSensitive, summarizeArgsForDisplay, truncateForDisplay } from './redact.js';

export type ApprovalPrompt = (message: string) => Promise<string>;

export class ApprovalManager {
  private alwaysAllow = new Set<string>();

  constructor(
    private readonly prompt: ApprovalPrompt,
    private readonly options?: {
      nonInteractiveDefault?: 'deny' | 'allow';
    }
  ) {}

  async requestApproval(tool: ToolCall, def: ToolDefinition, approvalContext?: AgentApprovalContext): Promise<boolean> {
    if (!approvalContext?.manual && this.alwaysAllow.has(def.id)) return true;

    if (!process.stdin.isTTY) {
      return !approvalContext?.manual && this.options?.nonInteractiveDefault === 'allow';
    }

    const argsText = tool.function.arguments || '{}';
    let args: unknown = undefined;
    try {
      args = JSON.parse(argsText);
    } catch {
      args = argsText;
    }

    const summary = summarizeArgsForDisplay(args, 500);

    const promptText =
      '\n' +
      `Tool approval required: ${def.id}\n` +
      `Args: ${truncateForDisplay(redactSensitive(summary), 800)}\n` +
      (approvalContext?.manual && approvalContext.reason
        ? `Reason: ${truncateForDisplay(redactSensitive(approvalContext.reason), 400)}\n`
        : '') +
      (approvalContext?.manual
        ? `[y]es / [n]o for ${def.id}: `
        : `[y]es / [n]o / [a]lways for ${def.id}: `);

    const answer = (await this.prompt(promptText)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (!approvalContext?.manual && (answer === 'a' || answer === 'always')) {
      this.alwaysAllow.add(def.id);
      return true;
    }

    return false;
  }
}

