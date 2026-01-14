export type {
  ToolDefinition,
  ToolParameterSchema,
  ToolExecution,
  ToolProvider,
  ToolHandler,
  ToolContext,
  ToolResult,
  ToolCall,
  AgentConfig,
  AgentCallbacks,
  LingyunEvent,
  LingyunRun,
  LingyunRunResult,
  LLMProvider,
} from './types.js';

export type { AgentHistoryMessage, CompactionConfig, ModelLimit } from '@kooka/core';

export { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from './llm/openaiCompatible.js';
export { ToolRegistry } from './tools/registry.js';
export { PluginManager } from './plugins/pluginManager.js';
export { LingyunAgent, LingyunSession, type LingyunAgentRuntimeOptions } from './agent/agent.js';
export { registerBuiltinTools, getBuiltinTools, DEFAULT_SKILL_PATHS, type BuiltinToolsOptions } from './tools/builtin/index.js';
export type { SkillInfo, SkillIndex } from './skills.js';
export { getSkillIndex, loadSkillFile } from './skills.js';

import type { AgentConfig, LLMProvider } from './types.js';
import type { CompactionConfig, ModelLimit } from '@kooka/core';
import { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from './llm/openaiCompatible.js';
import { ToolRegistry } from './tools/registry.js';
import { registerBuiltinTools, type BuiltinToolsOptions } from './tools/builtin/index.js';
import { PluginManager } from './plugins/pluginManager.js';
import { LingyunAgent, type LingyunAgentRuntimeOptions } from './agent/agent.js';

export type CreateLingyunAgentOptions = {
  llm:
    | ({ provider: 'openaiCompatible' } & OpenAICompatibleProviderOptions & { model: string })
    | { provider: 'custom'; instance: LLMProvider; model: string };
  agent?: Omit<AgentConfig, 'model'>;
  workspaceRoot?: string;
  allowExternalPaths?: boolean;
  toolTimeoutMs?: number;
  tools?: { builtin?: boolean; builtinOptions?: BuiltinToolsOptions };
  plugins?: { modules?: string[]; autoDiscover?: boolean; workspaceDirName?: string };
  modelLimits?: Record<string, ModelLimit>;
  compaction?: Partial<CompactionConfig>;
};

export function createLingyunAgent(options: CreateLingyunAgentOptions): {
  agent: LingyunAgent;
  registry: ToolRegistry;
  plugins: PluginManager;
  llm: LLMProvider;
} {
  const modelId = String(options.llm.model || '').trim();
  if (!modelId) {
    throw new Error('createLingyunAgent: llm.model is required');
  }

  const llm: LLMProvider =
    options.llm.provider === 'custom'
      ? options.llm.instance
      : new OpenAICompatibleProvider({
          baseURL: options.llm.baseURL,
          apiKey: options.llm.apiKey,
          name: options.llm.name,
          defaultModelId: options.llm.defaultModelId ?? modelId,
          timeoutMs: options.llm.timeoutMs,
        });

  const registry = new ToolRegistry({ defaultTimeoutMs: options.toolTimeoutMs });
  if (options.tools?.builtin !== false) {
    registerBuiltinTools(registry, options.tools?.builtinOptions);
  }

  const plugins = new PluginManager({
    plugins: options.plugins?.modules,
    autoDiscover: options.plugins?.autoDiscover,
    workspaceDirName: options.plugins?.workspaceDirName,
    workspaceRoot: options.workspaceRoot,
  });

  const config: AgentConfig = {
    model: modelId,
    ...(options.agent || {}),
  };

  const runtime: LingyunAgentRuntimeOptions = {
    plugins,
    workspaceRoot: options.workspaceRoot,
    allowExternalPaths: options.allowExternalPaths,
    modelLimits: options.modelLimits,
    compaction: options.compaction,
  };

  const agent = new LingyunAgent(llm, config, registry, runtime);
  return { agent, registry, plugins, llm };
}
