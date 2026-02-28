import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';

export type LingyunHookName =
  | 'experimental.chat.system.transform'
  | 'experimental.chat.complete'
  | 'chat.params'
  | 'experimental.chat.messages.transform'
  | 'permission.ask'
  | 'tool.execute.before'
  | 'tool.execute.after'
  | 'experimental.session.compacting'
  | 'experimental.text.complete';

export type LingyunPluginInput = {
  workspaceRoot?: string;
  gitRoot?: string;
  projectId?: string;
  storagePath?: string;
  /**
   * Optional host logger. Prefer this over console.log so hosts can route logs appropriately.
   */
  log?: (message: string) => void;
};

export type LingyunPluginTool = {
  name?: string;
  description: string;
  parameters: ToolDefinition['parameters'];
  metadata?: ToolDefinition['metadata'];
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult | unknown>;
};

export type HookPermissionAskInput = {
  tool: string;
  sessionId?: string;
  callId?: string;
  message?: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
};

export type LingyunHooks = {
  tool?: Record<string, LingyunPluginTool>;

  'experimental.chat.system.transform'?: (
    input: { sessionId?: string; mode?: 'plan' | 'build'; modelId?: string },
    output: { system: string[] }
  ) => void | Promise<void>;

  'experimental.chat.complete'?: (
    input: {
      sessionId?: string;
      mode?: 'plan' | 'build';
      modelId?: string;
      messageId: string;
      assistantText: string;
      returnedText: string;
    },
    output: Record<string, never>
  ) => void | Promise<void>;

  'chat.params'?: (
    input: { sessionId?: string; mode?: 'plan' | 'build'; modelId?: string; message?: string },
    output: { temperature?: number; topP?: number; topK?: number; options?: Record<string, unknown> }
  ) => void | Promise<void>;

  'experimental.chat.messages.transform'?: (
    input: { sessionId?: string; mode?: 'plan' | 'build'; modelId?: string },
    output: { messages: unknown[] }
  ) => void | Promise<void>;

  'permission.ask'?: (input: HookPermissionAskInput, output: { status: 'ask' | 'deny' | 'allow' }) => void | Promise<void>;

  'tool.execute.before'?: (
    input: { tool: string; sessionId?: string; callId: string },
    output: { args: unknown }
  ) => void | Promise<void>;

  'tool.execute.after'?: (
    input: { tool: string; sessionId?: string; callId: string },
    output: { title: string; output: string; metadata: Record<string, unknown> }
  ) => void | Promise<void>;

  'experimental.session.compacting'?: (
    input: { sessionId?: string },
    output: { context: string[]; prompt?: string }
  ) => void | Promise<void>;

  'experimental.text.complete'?: (
    input: { sessionId?: string; messageId: string },
    output: { text: string }
  ) => void | Promise<void>;
};

export type LingyunPluginFactory = (input: LingyunPluginInput) => LingyunHooks | Promise<LingyunHooks>;

export type LingyunPluginToolEntry = {
  pluginId: string;
  toolId: string;
  tool: LingyunPluginTool;
};
