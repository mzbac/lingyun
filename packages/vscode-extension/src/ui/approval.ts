import * as vscode from 'vscode';
import type { AgentApprovalContext, ToolCall, ToolDefinition } from '../core/types';

type BatchApprovalItem = vscode.QuickPickItem & { id: string };

function formatApprovalArgumentsPreview(rawArguments: string): string {
  try {
    const args = JSON.parse(rawArguments);
    if (args === null || args === undefined) return rawArguments;
    const record = Object(args) as Record<string, unknown>;
    let preview = '';

    for (const key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const line = `  ${key}: ${JSON.stringify(record[key])}`;
      preview = preview ? `${preview}\n${line}` : line;
    }

    return preview;
  } catch {
    return rawArguments;
  }
}

export async function requestApproval(
  toolCall: ToolCall,
  definition: ToolDefinition,
  approvalContext?: AgentApprovalContext
): Promise<boolean> {
  const argsPreview = formatApprovalArgumentsPreview(toolCall.function.arguments);

  const protectedReason =
    approvalContext?.manual && typeof approvalContext.reason === 'string' && approvalContext.reason.trim()
      ? approvalContext.reason.trim()
      : '';
  const message =
    `Allow tool "${definition.name}"?\n\n${argsPreview}` +
    (protectedReason ? `\n\nReason: ${protectedReason}` : '');

  const choices = approvalContext?.manual ? ['Allow', 'Deny'] : ['Allow', 'Allow All', 'Deny'];
  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    ...choices
  );

  return result === 'Allow' || (!approvalContext?.manual && result === 'Allow All');
}

export async function requestFileApproval(
  _toolCall: ToolCall,
  definition: ToolDefinition,
  _originalContent: string,
  _newContent: string
): Promise<boolean> {
  const originalUri = vscode.Uri.parse('untitled:original');
  const modifiedUri = vscode.Uri.parse('untitled:modified');

  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    modifiedUri,
    `${definition.name} - Preview Changes`
  );

  const result = await vscode.window.showWarningMessage(
    `Apply these changes using "${definition.name}"?`,
    { modal: true },
    'Apply',
    'Cancel'
  );

  return result === 'Apply';
}

export async function requestBatchApproval(
  toolCalls: Array<{ toolCall: ToolCall; definition: ToolDefinition }>
): Promise<Set<string>> {
  const items = new Array<BatchApprovalItem>(toolCalls.length);
  for (let i = 0; i < toolCalls.length; i++) {
    const { toolCall, definition } = toolCalls[i];
    items[i] = {
      label: definition.name,
      description: toolCall.function.name,
      detail: toolCall.function.arguments.substring(0, 100),
      picked: true,
      id: toolCall.id,
    };
  }

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select tools to allow',
    title: 'Tool Approval',
  });

  if (!selected) {
    return new Set();
  }

  const selectedIds = new Set<string>();
  for (const item of selected) {
    selectedIds.add(item.id);
  }
  return selectedIds;
}

export function showToolResult(
  toolName: string,
  success: boolean,
  message?: string
): void {
  if (success) {
    vscode.window.showInformationMessage(`✅ ${toolName}: ${message || 'Completed'}`);
  } else {
    vscode.window.showErrorMessage(`❌ ${toolName}: ${message || 'Failed'}`);
  }
}
