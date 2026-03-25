import * as vscode from 'vscode';

import { getSkillIndex } from '../../core/skills';
import { getPrimaryWorkspaceRootPath } from '../../core/workspaceContext';

import { bindChatControllerService } from './controllerService';

export interface ChatSkillsService {
  getSkillNamesForUI(): Promise<string[]>;
  postUnknownSkillWarnings(content: string, turnId?: string): Promise<void>;
}

export interface ChatSkillsDeps {
  context: vscode.ExtensionContext;
  skillNamesForUiPromise?: Promise<string[]>;
}

export function createChatSkillsService(controller: ChatSkillsDeps): ChatSkillsService {
  return bindChatControllerService(controller, {
    async getSkillNamesForUI(this: ChatSkillsDeps): Promise<string[]> {
      if (this.skillNamesForUiPromise) return this.skillNamesForUiPromise;

      const enabled =
        vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
      if (!enabled) {
        this.skillNamesForUiPromise = Promise.resolve([]);
        return this.skillNamesForUiPromise;
      }

      const workspaceRoot = getPrimaryWorkspaceRootPath();
      if (!workspaceRoot) {
        this.skillNamesForUiPromise = Promise.resolve([]);
        return this.skillNamesForUiPromise;
      }

      const allowExternalPaths =
        vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
      const searchPaths =
        vscode.workspace.getConfiguration('lingyun').get<string[]>('skills.paths', []) ?? [];

      this.skillNamesForUiPromise = getSkillIndex({
        extensionContext: this.context,
        workspaceRoot,
        searchPaths,
        allowExternalPaths,
        watchWorkspace: true,
      })
        .then((index) => index.skills.map((skill) => skill.name))
        .catch(() => []);

      return this.skillNamesForUiPromise;
    },

    async postUnknownSkillWarnings(this: ChatSkillsDeps, content: string, turnId?: string): Promise<void> {
      void this;
      void content;
      void turnId;
    },
  });
}
