import * as vscode from 'vscode';
import { getSkillIndex } from '../../core/skills';
import { getPrimaryWorkspaceRootPath } from '../../core/workspaceContext';
import type { ChatViewProvider } from '../chat';

export function installSkillsMethods(view: ChatViewProvider): void {
  Object.assign(view, {
    async getSkillNamesForUI(this: ChatViewProvider): Promise<string[]> {
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
        .then((index) => index.skills.map((s) => s.name))
        .catch(() => []);

      return this.skillNamesForUiPromise;
    },

    async postUnknownSkillWarnings(this: ChatViewProvider, content: string, turnId?: string): Promise<void> {
      // Unknown `$...` tokens are ignored: only discovered skills are applied.
      // This avoids false positives when users paste shell env vars like `$PATH` or `$GITHUB_OUTPUT`.
      void content;
      void turnId;
    },
  });
}
