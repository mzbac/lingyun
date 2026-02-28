import type { AgentHistoryMessage, ToolErrorCode } from '@kooka/core';

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  default?: unknown;
}

export type ToolExecution =
  | { type: 'function'; handler: string }
  | { type: 'command'; command: string }
  | { type: 'shell'; script: string; shell?: string; cwd?: string }
  | { type: 'http'; url: string; method?: string; headers?: Record<string, string> }
  | { type: 'inline'; code: string };

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
     * If true, external paths should be blocked when allowExternalPaths=false.
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

export interface ToolContext {
  /**
   * Workspace root for path resolution / boundary enforcement.
   * If absent, tools must treat all paths as external.
   */
  workspaceRoot?: string;
  /**
   * Whether tools are allowed to access paths outside the workspaceRoot.
   * Even when true, tools may still require approval via permissions.
   */
  allowExternalPaths?: boolean;
  /**
   * Optional session identifier used by stateful tools.
   */
  sessionId?: string;
  /**
   * Abort signal for cancellation/timeouts.
   */
  signal: AbortSignal;
  /**
   * Optional host logger for tool-level diagnostics (must be redacted by the host if needed).
   */
  log: (message: string) => void;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown> & {
    duration?: number;
    truncated?: boolean;
    /**
     * Stable, machine-readable error code used by UIs and hosts.
     */
    errorCode?: ToolErrorCode;
    /**
     * Optional free-form error type for debugging (e.g. exception class name).
     */
    errorType?: string;
    stack?: string;
    /**
     * Optional user-facing tool output text; if absent, the agent formats `data`/`error`.
     */
    outputText?: string;
    /**
     * Optional display title for tool output.
     */
    title?: string;
  };
}

export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;

export interface ToolProvider {
  readonly id: string;
  readonly name: string;
  getTools(): ToolDefinition[] | Promise<ToolDefinition[]>;
  executeTool(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
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

export interface AgentConfig {
  model?: string;
  /**
   * Optional model override for subagents spawned via the `task` tool.
   * If unset/empty, subagents use the parent agent's model.
   */
  subagentModel?: string;
  systemPrompt?: string;
  mode?: 'build' | 'plan';
  temperature?: number;
  /**
   * Retry count for transient provider failures.
   * Note: retries are only attempted when no tool call has started and no output was streamed.
   */
  maxRetries?: number;
  /**
   * Maximum tokens for generated output (provider-dependent).
   */
  maxOutputTokens?: number;
  toolFilter?: string[];
  autoApprove?: boolean;
  /**
   * Optional session identifier (provided by the host).
   */
  sessionId?: string;
}

/**
 * Optional host callbacks for UI/telemetry.
 *
 * Callback semantics:
 * - All callbacks are treated as best-effort hooks.
 * - The runtime catches and ignores synchronous throws.
 * - If a callback returns a Promise, the runtime catches and ignores rejections.
 * - Callback failures may be reported via `onDebug`, without including the original error message.
 *
 * Notes:
 * - `onRequestApproval` is awaited and controls whether an action proceeds; errors are treated as denial.
 * - Other callbacks may be awaited internally (e.g. iteration/compaction hooks) to allow async hosts,
 *   but failures never crash the agent loop.
 */
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
   * Debug logging hook (no prompts/URLs). Intended for host diagnostics.
   */
  onDebug?: (message: string) => void;
  /**
   * Raw token stream as emitted by the provider (may include <think> or tool-call markers).
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
  /**
   * User-facing notices emitted by the runtime (not sent to the model).
   * Intended for hosts to render warnings/info in their UI.
   */
  onNotice?: (notice: LingyunNotice) => void | Promise<void>;
  onStatusChange?: (status: {
    type: 'running' | 'retry' | 'done' | 'error';
    attempt?: number;
    nextRetryTime?: number;
    message?: string;
  }) => void;
}

export type LingyunNotice = {
  level: 'warning' | 'info';
  message: string;
};

export type LingyunEvent =
  | { type: 'debug'; message: string }
  | { type: 'notice'; notice: LingyunNotice }
  | { type: 'status'; status: NonNullable<AgentCallbacks['onStatusChange']> extends (s: infer S) => any ? S : never }
  | { type: 'assistant_token'; token: string }
  | { type: 'thought_token'; token: string }
  | { type: 'tool_call'; tool: ToolCall; definition: ToolDefinition }
  | { type: 'tool_blocked'; tool: ToolCall; definition: ToolDefinition; reason: string }
  | { type: 'tool_result'; tool: ToolCall; result: ToolResult }
  | { type: 'compaction_start'; auto: boolean; markerMessageId: string }
  | {
      type: 'compaction_end';
      auto: boolean;
      markerMessageId: string;
      summaryMessageId?: string;
      status: 'done' | 'error' | 'canceled';
      error?: string;
    };

export interface LingyunRunResult {
  text: string;
  session: {
    history: AgentHistoryMessage[];
    pendingPlan?: string;
    sessionId?: string;
  };
}

export interface LingyunRun {
  events: AsyncIterable<LingyunEvent>;
  done: Promise<LingyunRunResult>;
}
