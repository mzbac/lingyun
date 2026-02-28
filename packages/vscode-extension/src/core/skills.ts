import * as path from 'path';
import * as vscode from 'vscode';

import {
  expandHome,
  getSkillIndex as getSkillIndexCore,
  invalidateSkillIndexCache,
  isSubPath,
  loadSkillFile as loadSkillFileCore,
  type SkillIndex,
  type SkillInfo,
} from '@kooka/core';

import { createAbortSignalFromCancellationToken } from './cancellation';

export type { SkillIndex, SkillInfo };

let watcherState:
  | {
      workspaceRoot: string;
      patterns: Map<string, vscode.FileSystemWatcher>;
      extensionContext: vscode.ExtensionContext;
    }
  | undefined;

function resolveSkillDir(input: string, workspaceRoot?: string): { absPath: string; inWorkspace: boolean } {
  const expanded = expandHome(input);
  const absPath =
    workspaceRoot && expanded && !path.isAbsolute(expanded)
      ? path.resolve(workspaceRoot, expanded)
      : path.resolve(expanded);
  return {
    absPath,
    inWorkspace: workspaceRoot ? isSubPath(absPath, workspaceRoot) : false,
  };
}

function ensureWorkspaceWatchers(
  extensionContext: vscode.ExtensionContext,
  workspaceRoot: string,
  patterns: string[],
): void {
  const normalizedPatterns = patterns
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').trim())
    .filter(Boolean);

  if (
    watcherState &&
    watcherState.workspaceRoot === workspaceRoot &&
    watcherState.extensionContext === extensionContext &&
    Array.from(watcherState.patterns.keys()).sort().join('|') === normalizedPatterns.sort().join('|')
  ) {
    return;
  }

  if (watcherState) {
    for (const w of watcherState.patterns.values()) {
      w.dispose();
    }
  }

  const created = new Map<string, vscode.FileSystemWatcher>();
  for (const pattern of normalizedPatterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, pattern),
    );

    const invalidate = () => invalidateSkillIndexCache();
    watcher.onDidCreate(invalidate);
    watcher.onDidChange(invalidate);
    watcher.onDidDelete(invalidate);

    extensionContext.subscriptions.push(watcher);
    created.set(pattern, watcher);
  }

  watcherState = { workspaceRoot, patterns: created, extensionContext };
  invalidateSkillIndexCache();
}

export async function getSkillIndex(options: {
  extensionContext?: vscode.ExtensionContext;
  workspaceRoot?: string;
  searchPaths: string[];
  allowExternalPaths: boolean;
  cancellationToken?: vscode.CancellationToken;
  watchWorkspace?: boolean;
}): Promise<SkillIndex> {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : undefined;
  const searchPaths = (Array.isArray(options.searchPaths) ? options.searchPaths : [])
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);

  const watchWorkspace = !!options.extensionContext && options.watchWorkspace !== false && !!workspaceRoot;

  if (watchWorkspace && options.extensionContext && workspaceRoot) {
    const workspacePatterns: string[] = [];
    for (const input of searchPaths) {
      const resolved = resolveSkillDir(input, workspaceRoot);
      if (!resolved.inWorkspace) continue;
      const rel = path.relative(workspaceRoot, resolved.absPath).replace(/\\/g, '/');
      const pattern = `${rel || '.'}/**/SKILL.md`.replace(/^\.\//, '');
      workspacePatterns.push(pattern);
    }
    ensureWorkspaceWatchers(options.extensionContext, workspaceRoot, workspacePatterns);
  }

  const { signal, dispose } = createAbortSignalFromCancellationToken(options.cancellationToken);
  try {
    return await getSkillIndexCore({
      workspaceRoot,
      searchPaths,
      allowExternalPaths: !!options.allowExternalPaths,
      signal,
    });
  } finally {
    dispose();
  }
}

export async function loadSkillFile(skill: SkillInfo): Promise<{ content: string }> {
  return loadSkillFileCore(skill);
}
