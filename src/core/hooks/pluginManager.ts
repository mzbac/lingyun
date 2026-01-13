import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { findGitRoot } from '../instructions';
import { getSnapshotProjectId } from '../snapshot';
import type {
  LingyunHookName,
  LingyunHooks,
  LingyunPluginFactory,
  LingyunPluginInput,
  LingyunPluginTool,
} from './types';
import { isRecord } from '../utils/guards';

type LoadedHooks = { id: string; hooks: LingyunHooks };

export type LingyunPluginToolEntry = {
  pluginId: string;
  toolId: string;
  tool: LingyunPluginTool;
};

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

async function resolveWorkspacePluginPaths(params: {
  enabled: boolean;
  workspaceDirName: string;
}): Promise<string[]> {
  if (!params.enabled) return [];

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceFolder || workspaceFolder.scheme !== 'file') return [];

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeWorkspaceFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri)?.uri : undefined;
  const activeInWorkspace =
    !!activeUri &&
    activeUri.scheme === 'file' &&
    activeWorkspaceFolder?.scheme === 'file' &&
    activeWorkspaceFolder.fsPath === workspaceFolder.fsPath;

  const startDir = activeInWorkspace ? path.dirname(activeUri.fsPath) : workspaceFolder.fsPath;

  let stopDir = workspaceFolder;
  try {
    stopDir = await findGitRoot(activeInWorkspace ? (activeUri ?? workspaceFolder) : workspaceFolder, workspaceFolder);
  } catch {
    // Ignore; fall back to workspace root.
  }

  const stopPath = stopDir.scheme === 'file' ? stopDir.fsPath : workspaceFolder.fsPath;

  const discovered: string[] = [];
  let current = path.resolve(startDir);
  const stopResolved = path.resolve(stopPath);

  while (true) {
    const lingyunDir = path.join(current, params.workspaceDirName);
    const pluginDir = path.join(lingyunDir, 'plugin');
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

  const looksPath = trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.includes(path.sep);
  if (!looksPath) return trimmed;

  const resolved = path.resolve(workspaceRoot, trimmed);
  if (isPathInside(resolved, workspaceRoot)) {
    return path.relative(workspaceRoot, resolved);
  }
  return trimmed;
}

async function importPluginModule(spec: string, workspaceRoot?: string): Promise<any> {
  const trimmed = String(spec || '').trim();
  if (!trimmed) return null;

  // NOTE: This file is compiled to CommonJS. TypeScript downlevels dynamic `import()`
  // to `require()`, which cannot load `file://...` specifiers. Use a runtime dynamic
  // import for ESM-only plugins, but prefer `require()` for CJS plugins.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

  const isFileUrl = trimmed.startsWith('file://');
  const looksPath = isFileUrl || trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.includes(path.sep);
  if (looksPath) {
    const resolvedPath = isFileUrl ? fileURLToPath(trimmed) : path.resolve(workspaceRoot || process.cwd(), trimmed);
    const fileUrl = pathToFileURL(resolvedPath).href;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(resolvedPath);
    } catch {
      return dynamicImport(fileUrl);
    }
  }

  // Fallback: treat as a module specifier resolvable by Node.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(trimmed);
  } catch {
    return dynamicImport(trimmed);
  }
}

function extractHooksFromModule(
  moduleExports: any,
  input: LingyunPluginInput
): Array<{ id: string; hooks: LingyunHooks }> {
  if (!moduleExports) return [];
  const out: Array<{ id: string; hooks: LingyunHooks }> = [];

  const entries = Object.entries(moduleExports as Record<string, unknown>);
  for (const [name, value] of entries) {
    if (typeof value === 'function') {
      out.push({
        id: name,
        hooks: value(input) as any,
      });
      continue;
    }
    if (isRecord(value)) {
      out.push({ id: name, hooks: value as LingyunHooks });
    }
  }

  if (entries.length === 0 && typeof moduleExports === 'function') {
    out.push({ id: 'default', hooks: (moduleExports as LingyunPluginFactory)(input) as any });
  }

  return out;
}

export class PluginManager {
  private loadedKey = '';
  private loadedHooks: LoadedHooks[] = [];
  private extraHooks: LoadedHooks[] = [];

  private readonly log: PluginLogFn;

  constructor(private readonly context: vscode.ExtensionContext, params?: { log?: PluginLogFn }) {
    this.log = params?.log ?? (() => {});
  }

  registerHooks(id: string, hooks: LingyunHooks): vscode.Disposable {
    const entry: LoadedHooks = { id, hooks };
    this.extraHooks.push(entry);
    return new vscode.Disposable(() => {
      const idx = this.extraHooks.indexOf(entry);
      if (idx >= 0) this.extraHooks.splice(idx, 1);
    });
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

  private async getWorkspaceRoots(): Promise<{ workspaceRoot?: string; gitRoot?: string; projectId?: string }> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceFolder || workspaceFolder.scheme !== 'file') return {};

    const workspaceRoot = workspaceFolder.fsPath;
    let gitRootPath = workspaceRoot;
    try {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      const activeWorkspaceFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri)?.uri : undefined;
      const activeInWorkspace =
        !!activeUri &&
        activeUri.scheme === 'file' &&
        activeWorkspaceFolder?.scheme === 'file' &&
        activeWorkspaceFolder.fsPath === workspaceFolder.fsPath;

      const seed = activeInWorkspace ? (activeUri ?? workspaceFolder) : workspaceFolder;
      const gitRoot = await findGitRoot(seed, workspaceFolder);
      if (gitRoot.scheme === 'file') {
        gitRootPath = gitRoot.fsPath;
      }
    } catch {
      // Ignore; keep workspace root.
    }

    const projectId = await getSnapshotProjectId(gitRootPath);
    return { workspaceRoot, gitRoot: gitRootPath, projectId };
  }

  private async loadPluginsIfNeeded(): Promise<void> {
    const { plugins, autoDiscover, workspaceDirName } = this.getConfigSnapshot();
    const roots = await this.getWorkspaceRoots();

    const discovered = await resolveWorkspacePluginPaths({ enabled: autoDiscover, workspaceDirName });
    const combined = uniqueStrings([...(plugins || []), ...discovered]);

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const debugPluginsEnabled = cfg.get<boolean>('debug.plugins') ?? false;

    const key = JSON.stringify({
      combined,
      workspaceRoot: roots.workspaceRoot || '',
      gitRoot: roots.gitRoot || '',
      projectId: roots.projectId || '',
    });

    if (key === this.loadedKey) return;

    this.loadedKey = key;
    this.loadedHooks = [];

    if (debugPluginsEnabled) {
      const discoveredDebug = discovered.map(spec => toDebugPluginSpec(spec, roots.workspaceRoot));
      const configuredDebug = (plugins || []).map(spec => toDebugPluginSpec(spec, roots.workspaceRoot));
      this.log(
        `[Plugins] reload autoDiscover=${String(autoDiscover)} configured=${JSON.stringify(configuredDebug)} discovered=${JSON.stringify(discoveredDebug)}`
      );
    }

    const input: LingyunPluginInput = {
      workspaceRoot: roots.workspaceRoot,
      gitRoot: roots.gitRoot,
      projectId: roots.projectId,
      storagePath: (this.context.storageUri ?? this.context.globalStorageUri)?.fsPath,
      log: this.log,
    };

    for (const spec of combined) {
      try {
        if (debugPluginsEnabled) {
          this.log(`[Plugins] loading ${toDebugPluginSpec(spec, roots.workspaceRoot)}`);
        }
        const module = await importPluginModule(spec, roots.workspaceRoot);
        const extracted = extractHooksFromModule(module, input);

        for (const entry of extracted) {
          const hooks = await Promise.resolve(entry.hooks);
          if (!hooks) continue;
          this.loadedHooks.push({ id: `${spec}#${entry.id}`, hooks });
        }

        if (debugPluginsEnabled) {
          const hookNames = extracted
            .map(e => Object.keys(e.hooks ?? {}))
            .flat()
            .filter(Boolean)
            .sort();
          const uniqueHookNames = [...new Set(hookNames)];
          this.log(
            `[Plugins] loaded ${toDebugPluginSpec(spec, roots.workspaceRoot)} hooks=${JSON.stringify(uniqueHookNames)}`
          );
        }
      } catch (error) {
        // Keep running even if a plugin fails to load.
        this.log(
          `[Plugins] failed to load ${toDebugPluginSpec(spec, roots.workspaceRoot)}: ${error instanceof Error ? error.message : String(error)}`
        );
        console.error(`LingYun: Failed to load plugin ${spec}:`, error);
      }
    }
  }

  async trigger<Name extends LingyunHookName, Output>(
    name: Name,
    input: unknown,
    output: Output
  ): Promise<Output> {
    await this.loadPluginsIfNeeded();

    const all = [...this.extraHooks, ...this.loadedHooks];
    for (const entry of all) {
      const fn = (entry.hooks as any)?.[name];
      if (typeof fn !== 'function') continue;
      try {
        await fn(input, output);
      } catch (error) {
        const cfg = vscode.workspace.getConfiguration('lingyun');
        const debugPluginsEnabled = cfg.get<boolean>('debug.plugins') ?? false;
        this.log(
          `[Plugins] hook error ${entry.id} -> ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
        if (debugPluginsEnabled && error instanceof Error && error.stack) {
          this.log(error.stack);
        }
        console.error(`LingYun: Plugin hook error (${entry.id} -> ${name}):`, error);
      }
    }

    return output;
  }

  async listPluginTools(): Promise<LingyunPluginToolEntry[]> {
    await this.loadPluginsIfNeeded();

    const out: LingyunPluginToolEntry[] = [];
    const all = [...this.extraHooks, ...this.loadedHooks];

    for (const entry of all) {
      const toolMap = (entry.hooks as any)?.tool;
      if (!isRecord(toolMap)) continue;

      for (const [toolId, tool] of Object.entries(toolMap)) {
        if (!toolId || typeof toolId !== 'string') continue;
        if (!tool || typeof tool !== 'object') continue;
        out.push({ pluginId: entry.id, toolId, tool: tool as any });
      }
    }

    return out;
  }
}
