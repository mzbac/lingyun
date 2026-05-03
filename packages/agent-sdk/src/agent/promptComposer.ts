import { getSkillIndex, renderSkillsSectionForPrompt, type SkillInfo } from '@kooka/core';

import type { LingyunHookName } from '../plugins/types.js';
import type { ProviderBehavior } from './providerBehavior.js';

export type PluginManagerLike = {
  trigger: <Name extends LingyunHookName, Output>(name: Name, input: unknown, output: Output) => Promise<Output>;
};

export class SkillsPromptProvider {
  constructor(
    private readonly params: {
      getWorkspaceRoot: () => string | undefined;
      getAllowExternalPaths: () => boolean;
      getEnabled: () => boolean;
      getPaths: () => string[];
      getMaxPromptSkills: () => number;
    },
  ) {}

  getSkillsPromptText(options?: {
    signal?: AbortSignal;
    allowExternalPaths?: boolean;
    enabled?: boolean;
    paths?: string[];
    maxPromptSkills?: number;
  }): Promise<string | undefined> {
    const enabled = typeof options?.enabled === 'boolean' ? options.enabled : this.params.getEnabled();
    if (!enabled) return Promise.resolve(undefined);

    const workspaceRoot = this.params.getWorkspaceRoot();
    const allowExternalPaths =
      typeof options?.allowExternalPaths === 'boolean'
        ? options.allowExternalPaths
        : this.params.getAllowExternalPaths();
    const paths = Array.isArray(options?.paths) && options.paths.length > 0 ? options.paths : this.params.getPaths();
    const maxPromptSkills =
      typeof options?.maxPromptSkills === 'number' && Number.isFinite(options.maxPromptSkills) && options.maxPromptSkills >= 0
        ? Math.floor(options.maxPromptSkills)
        : this.params.getMaxPromptSkills();

    return getSkillIndex({
      workspaceRoot,
      searchPaths: paths,
      allowExternalPaths,
      signal: options?.signal,
    })
      .then((index) =>
        renderSkillsSectionForPrompt({
          skills: index.skills as SkillInfo[],
          maxSkills: maxPromptSkills,
          workspaceRoot,
        }),
      )
      .catch(() => undefined);
  }
}

export class PromptComposer {
  constructor(
    private readonly params: {
      plugins: PluginManagerLike;
      providerBehavior: ProviderBehavior;
      skills: SkillsPromptProvider;
    },
  ) {}

  async composeSystemPrompts(modelId: string, options?: {
    signal?: AbortSignal;
    basePrompt?: string;
    sessionId?: string;
    mode?: 'build' | 'plan';
    allowExternalPaths?: boolean;
    skills?: {
      enabled?: boolean;
      paths?: string[];
      maxPromptSkills?: number;
    };
  }): Promise<string[]> {
    const basePrompt = typeof options?.basePrompt === 'string' ? options.basePrompt : '';
    const skillsPromptText = await this.params.skills.getSkillsPromptText({
      signal: options?.signal,
      allowExternalPaths: options?.allowExternalPaths,
      enabled: options?.skills?.enabled,
      paths: options?.skills?.paths,
      maxPromptSkills: options?.skills?.maxPromptSkills,
    });
    let system = [
      [basePrompt, skillsPromptText].filter(Boolean).join('\n'),
    ].filter(Boolean) as string[];
    const header = system[0] ?? '';

    const out = await this.params.plugins.trigger(
      'experimental.chat.system.transform',
      {
        sessionId: options?.sessionId,
        mode: options?.mode === 'plan' ? 'plan' : 'build',
        modelId,
      },
      { system },
    );

    system = Array.isArray((out as any).system) ? (out as any).system.filter(Boolean) : system;
    if (system.length === 0) {
      system = [header];
    }
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1);
      system = [header, rest.join('\n')];
    }
    return this.params.providerBehavior.normalizeSystemPrompts(system);
  }
}
