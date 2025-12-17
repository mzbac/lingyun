import * as vscode from 'vscode';

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
  execution: ToolExecution;
  when?: string;
  metadata?: {
    category?: string;
    icon?: string;
    requiresApproval?: boolean;
    timeout?: number;
    tags?: string[];
  };
}

export type ToolExecution =
  | { type: 'function'; handler: string }
  | { type: 'command'; command: string }
  | { type: 'shell'; script: string; shell?: string }
  | { type: 'http'; url: string; method?: string; headers?: Record<string, string> }
  | { type: 'inline'; code: string };

export interface ToolContext {
  workspaceFolder?: vscode.Uri;
  activeEditor?: vscode.TextEditor;
  extensionContext: vscode.ExtensionContext;
  cancellationToken: vscode.CancellationToken;
  progress: vscode.Progress<{ message?: string; increment?: number }>;
  log: (message: string) => void;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: {
    duration?: number;
    truncated?: boolean;
    errorType?: string;
    stack?: string;
  };
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

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentConfig {
  model?: string;
  systemPrompt?: string;
  maxIterations?: number;
  temperature?: number;
  toolFilter?: string[];
  autoApprove?: boolean;
}

export interface AgentCallbacks {
  onThinking?: () => void;
  onToken?: (token: string) => void;
  onToolCall?: (tool: ToolCall, definition: ToolDefinition) => void;
  onToolResult?: (tool: ToolCall, result: ToolResult) => void;
  onRequestApproval?: (tool: ToolCall, definition: ToolDefinition) => Promise<boolean>;
  onComplete?: (response: string) => void;
  onError?: (error: Error) => void;
}

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

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  chat(
    messages: Message[],
    options: {
      model?: string;
      temperature?: number;
      tools?: ToolDefinition[];
      onToken?: (token: string) => void;
    }
  ): Promise<Message>;
  dispose?(): void;
}
