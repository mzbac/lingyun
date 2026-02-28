import * as vscode from 'vscode';

import type {
  AgentCallbacks as SdkAgentCallbacks,
  AgentConfig as SdkAgentConfig,
  LLMProvider as SdkLLMProvider,
  ToolCall as SdkToolCall,
  ToolDefinition as SdkToolDefinition,
  ToolExecution as SdkToolExecution,
  ToolParameterSchema as SdkToolParameterSchema,
  ToolResult as SdkToolResult,
} from '@kooka/agent-sdk';

export type ToolParameterSchema = SdkToolParameterSchema;
export type ToolExecution = SdkToolExecution;
export type ToolDefinition = SdkToolDefinition;
export type ToolResult = SdkToolResult;
export type ToolCall = SdkToolCall;

export interface ToolContext {
  workspaceFolder?: vscode.Uri;
  activeEditor?: vscode.TextEditor;
  extensionContext: vscode.ExtensionContext;
  /**
   * Optional UI session identifier (set by the chat UI layer).
   * Used by stateful tools (e.g. todo) to scope persisted data.
   */
  sessionId?: string;
  cancellationToken: vscode.CancellationToken;
  progress: vscode.Progress<{ message?: string; increment?: number }>;
  log: (message: string) => void;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

export interface ToolProvider {
  readonly id: string;
  readonly name: string;
  getTools(): ToolDefinition[] | Promise<ToolDefinition[]>;
  executeTool(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
  onDidRegister?(): void;
  onDidUnregister?(): void;
  dispose?(): void;
}

export interface AgentConfig extends SdkAgentConfig {
  planFirst?: boolean;
  parentSessionId?: string;
  subagentType?: string;
}

export type AgentCallbacks = SdkAgentCallbacks;

export interface LingyunAPI {
  readonly version: string;
  registerToolProvider(provider: ToolProvider): vscode.Disposable;
  registerTool(definition: ToolDefinition, handler: ToolHandler): vscode.Disposable;
  getTools(): Promise<ToolDefinition[]>;
  executeTool(toolId: string, args: Record<string, unknown>): Promise<ToolResult>;
  runAgent(task: string, config?: AgentConfig): Promise<string>;
  onDidRegisterTool: vscode.Event<ToolDefinition>;
  onDidUnregisterTool: vscode.Event<string>;
}

export interface WorkspaceToolsConfig {
  version: '1.0';
  tools: WorkspaceToolDefinition[];
  variables?: Record<string, string>;
}

export interface WorkspaceToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
  execution:
    | { type: 'shell'; script: string; cwd?: string }
    | { type: 'http'; url: string; method?: string; headers?: Record<string, string>; body?: string }
    | { type: 'command'; command: string; args?: unknown[] };
  requiresApproval?: boolean;
  category?: string;
}

export type LLMProvider = SdkLLMProvider;
