import * as vscode from 'vscode';
import type { ChatMessage } from './types';
import { ChatViewProvider } from '../chat';
import { extractSkillMentions } from '@kooka/core';
import { getSkillIndex } from '../../core/skills';

Object.assign(ChatViewProvider.prototype, {
  async getSkillNamesForUI(this: ChatViewProvider): Promise<string[]> {
    if (this.skillNamesForUiPromise) return this.skillNamesForUiPromise;

    const enabled =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
    if (!enabled) {
      this.skillNamesForUiPromise = Promise.resolve([]);
      return this.skillNamesForUiPromise;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    const enabled =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
    if (!enabled) return;

    const mentions = extractSkillMentions(content);
    if (mentions.length === 0) return;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const allowExternalPaths =
      vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
    const searchPaths =
      vscode.workspace.getConfiguration('lingyun').get<string[]>('skills.paths', []) ?? [];

    let index: Awaited<ReturnType<typeof getSkillIndex>>;
    try {
      index = await getSkillIndex({
        extensionContext: this.context,
        workspaceRoot,
        searchPaths,
        allowExternalPaths,
        watchWorkspace: true,
      });
    } catch {
      return;
    }

    const unknown = mentions.filter((name) => !index.byName.get(name));
    if (unknown.length === 0) return;

    const availableSample = index.skills
      .map((s) => s.name)
      .slice(0, 20);

    const unknownLabel = unknown.length === 1 ? 'Unknown skill' : 'Unknown skills';
    const availableLabel =
      availableSample.length > 0
        ? ` Available: ${availableSample.map((n) => `$${n}`).join(', ')}${index.skills.length > availableSample.length ? ', ...' : ''}`
        : '';

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'warning',
      content: `${unknownLabel}: ${unknown.map((n) => `$${n}`).join(', ')}.${availableLabel}`,
      timestamp: Date.now(),
      turnId,
    };

    this.messages.push(msg);
    this.postMessage({ type: 'message', message: msg });
  },
});
