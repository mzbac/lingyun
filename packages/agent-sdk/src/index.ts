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
export {
  createAgentBrowserToolProvider,
  registerAgentBrowserTools,
  type AgentBrowserRunAction,
  type AgentBrowserRunner,
  type AgentBrowserToolsOptions,
} from './tools/agentBrowser.js';
export { PluginManager } from './plugins/pluginManager.js';
export { LingyunAgent, LingyunSession, type LingyunAgentRuntimeOptions } from './agent/agent.js';
export { registerBuiltinTools, getBuiltinTools, DEFAULT_SKILL_PATHS, type BuiltinToolsOptions } from './tools/builtin/index.js';
export type { SkillInfo, SkillIndex } from './skills.js';
export { getSkillIndex, loadSkillFile } from './skills.js';
export * from './persistence/index.js';

// Neutral API aliases for hosts that don't want product-specific naming.
export { LingyunAgent as Agent, LingyunSession as AgentSession, type LingyunAgentRuntimeOptions as AgentRuntimeOptions } from './agent/agent.js';
export type {
  LingyunEvent as AgentEvent,
  LingyunNotice as AgentNotice,
  LingyunRun as AgentRun,
  LingyunRunResult as AgentRunResult,
} from './types.js';
export type { LingyunSessionSnapshot as SessionSnapshot, LingyunSessionSnapshotV1 as SessionSnapshotV1 } from './persistence/sessionSnapshot.js';

import type { AgentConfig, LLMProvider } from './types.js';
import type { CompactionConfig, ModelLimit } from '@kooka/core';
import { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from './llm/openaiCompatible.js';
import { ToolRegistry } from './tools/registry.js';
import { DEFAULT_SKILL_PATHS, registerBuiltinTools, type BuiltinToolsOptions } from './tools/builtin/index.js';
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
  plugins?: { modules?: string[]; autoDiscover?: boolean; workspaceDirName?: string; logger?: (message: string) => void };
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
    logger: options.plugins?.logger,
  });

  const config: AgentConfig = {
    model: modelId,
    ...(options.agent || {}),
  };

  const runtime: LingyunAgentRuntimeOptions = {
    plugins,
    workspaceRoot: options.workspaceRoot,
    allowExternalPaths: options.allowExternalPaths,
    skills: (() => {
      const skills = options.tools?.builtinOptions?.skills;
      const paths = skills?.paths?.length ? skills.paths : DEFAULT_SKILL_PATHS;
      return {
        enabled: skills?.enabled,
        paths,
        maxPromptSkills: skills?.maxPromptSkills,
        maxInjectSkills: skills?.maxInjectSkills,
        maxInjectChars: skills?.maxInjectChars,
      };
    })(),
    modelLimits: options.modelLimits,
    compaction: options.compaction,
  };

  const agent = new LingyunAgent(llm, config, registry, runtime);
  return { agent, registry, plugins, llm };
}

export type CreateAgentOptions = CreateLingyunAgentOptions;
export function createAgent(options: CreateAgentOptions): ReturnType<typeof createLingyunAgent> {
  return createLingyunAgent(options);
}
