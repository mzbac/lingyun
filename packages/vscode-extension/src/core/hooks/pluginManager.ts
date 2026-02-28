import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  PluginManager as SdkPluginManager,
  type LingyunHookName,
  type LingyunHooks,
  type LingyunPluginToolEntry as SdkLingyunPluginToolEntry,
} from '@kooka/agent-sdk';

import { findGitRoot } from '../instructions';
import { getSnapshotProjectId } from '../snapshot';
import { getPrimaryWorkspaceFolder } from '../workspaceContext';

type PluginLogFn = (message: string) => void;

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const v = String(item || '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listPluginFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(ent => ent.isFile())
      .map(ent => ent.name)
      .filter(name => /\.(cjs|mjs|js)$/i.test(name))
      .map(name => path.join(dir, name));
  } catch {
    return [];
  }
}

async function discoverWorkspacePluginsUp(params: {
  enabled: boolean;
  workspaceDirName: string;
  startDir: string;
  stopDir: string;
}): Promise<string[]> {
  if (!params.enabled) return [];

  const discovered: string[] = [];
  let current = path.resolve(params.startDir);
  const stopResolved = path.resolve(params.stopDir);

  while (true) {
    const pluginDir = path.join(current, params.workspaceDirName, 'plugin');
    if (await exists(pluginDir)) {
      discovered.push(...(await listPluginFiles(pluginDir)));
    }

    if (current === stopResolved) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return uniqueStrings(discovered);
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function toDebugPluginSpec(spec: string, workspaceRoot?: string): string {
  const trimmed = String(spec || '').trim();
  if (!trimmed || !workspaceRoot) return trimmed;

  if (trimmed.startsWith('file://')) {
    return trimmed;
  }

  const looksPath = trimmed.startsWith('.') || path.isAbsolute(trimmed);
  if (!looksPath) return trimmed;

  const resolved = path.resolve(workspaceRoot, trimmed);
  if (isPathInside(resolved, workspaceRoot)) {
    return path.relative(workspaceRoot, resolved);
  }
  return trimmed;
}

export type LingyunPluginToolEntry = SdkLingyunPluginToolEntry;

export class PluginManager {
  private readonly sdk = new SdkPluginManager();
  private readonly log: PluginLogFn;
  private loadedKey = '';

  constructor(private readonly context: vscode.ExtensionContext, params?: { log?: PluginLogFn }) {
    this.log = params?.log ?? (() => {});
  }

  registerHooks(id: string, hooks: LingyunHooks): vscode.Disposable {
    const disposable = this.sdk.registerHooks(id, hooks);
    return new vscode.Disposable(() => disposable.dispose());
  }

  async trigger<Name extends LingyunHookName, Output>(name: Name, input: unknown, output: Output): Promise<Output> {
    await this.refreshOptionsIfNeeded();
    return this.sdk.trigger(name, input, output);
  }

  async listPluginTools(): Promise<LingyunPluginToolEntry[]> {
    await this.refreshOptionsIfNeeded();
    return this.sdk.getPluginTools();
  }

  private getConfigSnapshot(): {
    plugins: string[];
    autoDiscover: boolean;
    workspaceDirName: string;
  } {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const plugins = cfg.get<string[]>('plugins') ?? [];
    const autoDiscover = cfg.get<boolean>('plugins.autoDiscover') ?? true;
    const workspaceDirName = cfg.get<string>('plugins.workspaceDir') ?? '.lingyun';
    return { plugins, autoDiscover, workspaceDirName };
  }

  private async getWorkspaceRoots(): Promise<{
    trusted: boolean;
    workspaceRoot?: string;
    gitRoot?: string;
    projectId?: string;
    startDir?: string;
    stopDir?: string;
    storagePath?: string;
  }> {
    const trusted = vscode.workspace.isTrusted;

    const primaryFolder = getPrimaryWorkspaceFolder();
    if (!primaryFolder || primaryFolder.uri.scheme !== 'file') {
      return { trusted };
    }

    const workspaceRoot = primaryFolder.uri.fsPath;
    const storagePath = (this.context.storageUri ?? this.context.globalStorageUri)?.fsPath;

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeInPrimary =
      !!activeUri &&
      activeUri.scheme === 'file' &&
      vscode.workspace.getWorkspaceFolder(activeUri)?.uri.fsPath === primaryFolder.uri.fsPath;

    const startDir = activeInPrimary && activeUri ? path.dirname(activeUri.fsPath) : workspaceRoot;

    let gitRootPath = workspaceRoot;
    try {
      const seed = activeInPrimary ? (activeUri ?? primaryFolder.uri) : primaryFolder.uri;
      const gitRoot = await findGitRoot(seed, primaryFolder.uri);
      if (gitRoot.scheme === 'file') {
        gitRootPath = gitRoot.fsPath;
      }
    } catch {
      // Ignore; keep workspace root.
    }

    const projectId = await getSnapshotProjectId(gitRootPath);

    return {
      trusted,
      workspaceRoot,
      gitRoot: gitRootPath,
      projectId,
      startDir,
      stopDir: gitRootPath,
      storagePath,
    };
  }

  private async refreshOptionsIfNeeded(): Promise<void> {
    const { plugins, autoDiscover, workspaceDirName } = this.getConfigSnapshot();
    const roots = await this.getWorkspaceRoots();

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const debugPluginsEnabled = cfg.get<boolean>('debug.plugins') ?? false;

    if (!roots.workspaceRoot) {
      const key = JSON.stringify({ trusted: roots.trusted, combined: [], workspaceRoot: '', gitRoot: '', projectId: '', storagePath: '' });
      if (key !== this.loadedKey) {
        this.loadedKey = key;
        this.sdk.setOptions({ plugins: [], autoDiscover: false, input: { log: this.log }, logger: this.log });
      }
      return;
    }

    const discovered = roots.trusted
      ? await discoverWorkspacePluginsUp({
          enabled: autoDiscover,
          workspaceDirName,
          startDir: roots.startDir || roots.workspaceRoot,
          stopDir: roots.stopDir || roots.workspaceRoot,
        })
      : [];

    const combined = roots.trusted ? uniqueStrings([...(plugins || []), ...discovered]) : [];

    const key = JSON.stringify({
      trusted: roots.trusted,
      combined,
      workspaceRoot: roots.workspaceRoot || '',
      gitRoot: roots.gitRoot || '',
      projectId: roots.projectId || '',
      storagePath: roots.storagePath || '',
    });

    if (key === this.loadedKey) return;
    this.loadedKey = key;

    if (!roots.trusted) {
      if (debugPluginsEnabled) {
        this.log('[Plugins] skipped loading: workspace is untrusted');
      }
      this.sdk.setOptions({ plugins: [], autoDiscover: false, workspaceRoot: roots.workspaceRoot, input: { workspaceRoot: roots.workspaceRoot, log: this.log }, logger: this.log });
      return;
    }

    if (debugPluginsEnabled) {
      const discoveredDebug = discovered.map(spec => toDebugPluginSpec(spec, roots.workspaceRoot));
      const configuredDebug = (plugins || []).map(spec => toDebugPluginSpec(spec, roots.workspaceRoot));
      this.log(
        `[Plugins] reload autoDiscover=${String(autoDiscover)} configured=${JSON.stringify(configuredDebug)} discovered=${JSON.stringify(discoveredDebug)}`,
      );
    }

    this.sdk.setOptions({
      plugins: combined,
      autoDiscover: false,
      workspaceDirName,
      workspaceRoot: roots.workspaceRoot,
      input: {
        workspaceRoot: roots.workspaceRoot,
        gitRoot: roots.gitRoot,
        projectId: roots.projectId,
        storagePath: roots.storagePath,
        log: this.log,
      },
      logger: this.log,
    });
  }
}
