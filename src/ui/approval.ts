import * as vscode from 'vscode';
import type { ToolCall, ToolDefinition } from '../core/types';

export async function requestApproval(
  toolCall: ToolCall,
  definition: ToolDefinition
): Promise<boolean> {
  let argsPreview: string;
  try {
    const args = JSON.parse(toolCall.function.arguments);
    argsPreview = Object.entries(args)
      .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
      .join('\n');
  } catch {
    argsPreview = toolCall.function.arguments;
  }

  const message = `Allow tool "${definition.name}"?\n\n${argsPreview}`;

  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Allow',
    'Allow All',
    'Deny'
  );

  return result === 'Allow' || result === 'Allow All';
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
  const items = toolCalls.map(({ toolCall, definition }) => ({
    label: definition.name,
    description: toolCall.function.name,
    detail: toolCall.function.arguments.substring(0, 100),
    picked: true,
    id: toolCall.id,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select tools to allow',
    title: 'Tool Approval',
  });

  if (!selected) {
    return new Set();
  }

  return new Set(selected.map(s => s.id));
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
