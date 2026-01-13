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
    /**
     * Whether this tool can operate on file paths outside the current workspace.
     * If true, external paths should trigger an approval prompt even for read-only tools.
     */
    supportsExternalPaths?: boolean;
    /**
     * Permission category used for allow/ask/deny evaluation.
     * If omitted, defaults to the tool id (with common edit tools mapped to "edit").
     */
    permission?: string;
    /**
     * Whether the tool is read-only (safe to run in Plan mode without prompting).
     * Non-read-only tools are blocked/confirmed in Plan mode.
     */
    readOnly?: boolean;
    /**
     * Extract patterns from tool args for permission evaluation (e.g. file paths or commands).
     */
    permissionPatterns?: Array<{
      arg: string;
      kind?: 'path' | 'command' | 'raw';
    }>;
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
  /**
   * Optional UI session identifier (set by the chat UI layer).
   * Used by stateful tools (e.g. todo) to scope persisted data.
   */
  sessionId?: string;
  cancellationToken: vscode.CancellationToken;
  progress: vscode.Progress<{ message?: string; increment?: number }>;
  log: (message: string) => void;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown> & {
    duration?: number;
    truncated?: boolean;
    errorType?: string;
    stack?: string;
    /**
     * Optional, user-facing tool output text (used for model/tool messages).
     * If absent, LingYun will format `data`/`error` into text automatically.
     */
    outputText?: string;
    /**
     * Optional display title for tool output.
     */
    title?: string;
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
  mode?: 'build' | 'plan';
  temperature?: number;
  /**
   * Provider/API retry count for transient failures.
   * Passed through to the underlying streaming client (ai-sdk `maxRetries`).
   */
  maxRetries?: number;
  toolFilter?: string[];
  autoApprove?: boolean;
  planFirst?: boolean;
  /**
   * Optional session identifier (provided by the UI layer).
   */
  sessionId?: string;
}

export interface AgentCallbacks {
  onIterationStart?: (iteration: number) => void | Promise<void>;
  onIterationEnd?: (iteration: number) => void | Promise<void>;
  onThinking?: () => void;
  onCompactionStart?: (event: { auto: boolean; markerMessageId: string }) => void | Promise<void>;
  onCompactionEnd?: (event: {
    auto: boolean;
    markerMessageId: string;
    summaryMessageId?: string;
    status: 'done' | 'error' | 'canceled';
    error?: string;
  }) => void | Promise<void>;
  /**
   * Debug logging hook (no prompts/URLs). Intended for output-channel diagnostics.
   */
  onDebug?: (message: string) => void;
  /**
   * Raw token stream as emitted by the provider (may include <think> or [TOOL_CALL] markers).
   * Prefer onAssistantToken/onThoughtToken for UI rendering.
   */
  onToken?: (token: string) => void;
  /**
   * Token stream for user-facing assistant text with <think>/<tool_call> sections removed.
   */
  onAssistantToken?: (token: string) => void;
  /**
   * Token stream for model reasoning (<think> sections) with tool-call blocks removed.
   */
  onThoughtToken?: (token: string) => void;
  onToolCall?: (tool: ToolCall, definition: ToolDefinition) => void | Promise<void>;
  onToolBlocked?: (tool: ToolCall, definition: ToolDefinition, reason: string) => void;
  onToolResult?: (tool: ToolCall, result: ToolResult) => void;
  onRequestApproval?: (tool: ToolCall, definition: ToolDefinition) => Promise<boolean>;
  onComplete?: (response: string) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: { type: 'running' | 'retry' | 'done' | 'error'; attempt?: number; nextRetryTime?: number; message?: string }) => void;
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
  getModel(modelId: string): Promise<unknown>;
  /**
   * Optional hook invoked after a provider request fails (non-retryable).
   * Providers can use this to clear cached clients/tokens so the next request can recover.
   */
  onRequestError?(error: unknown, context: { modelId: string; mode: 'plan' | 'build' }): void;
  dispose?(): void;
}
