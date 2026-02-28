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

  getSkillsPromptText(options?: { signal?: AbortSignal }): Promise<string | undefined> {
    if (!this.params.getEnabled()) return Promise.resolve(undefined);

    const workspaceRoot = this.params.getWorkspaceRoot();
    const allowExternalPaths = this.params.getAllowExternalPaths();
    const paths = this.params.getPaths();
    const maxPromptSkills = this.params.getMaxPromptSkills();

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
      getBasePrompt: () => string;
      getSessionId: () => string | undefined;
      getMode: () => 'build' | 'plan';
    },
  ) {}

  async composeSystemPrompts(modelId: string, options?: { signal?: AbortSignal }): Promise<string[]> {
    const basePrompt = this.params.getBasePrompt();
    const skillsPromptText = await this.params.skills.getSkillsPromptText({ signal: options?.signal });
    let system = [[basePrompt, skillsPromptText].filter(Boolean).join('\n')].filter(Boolean) as string[];
    const header = system[0] ?? '';

    const out = await this.params.plugins.trigger(
      'experimental.chat.system.transform',
      { sessionId: this.params.getSessionId(), mode: this.params.getMode(), modelId },
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
