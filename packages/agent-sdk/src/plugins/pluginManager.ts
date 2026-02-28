import * as fs from 'fs/promises';
import * as path from 'path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'url';

import type { LingyunHookName, LingyunHooks, LingyunPluginFactory, LingyunPluginInput, LingyunPluginToolEntry } from './types.js';

type LoadedHooks = { id: string; hooks: LingyunHooks };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

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
      .filter((ent) => ent.isFile())
      .map((ent) => ent.name)
      .filter((name) => /\.(cjs|mjs|js)$/i.test(name))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

async function resolveWorkspacePluginPaths(params: {
  enabled: boolean;
  workspaceDirName: string;
  workspaceRoot?: string;
}): Promise<string[]> {
  if (!params.enabled) return [];
  if (!params.workspaceRoot) return [];

  const pluginDir = path.join(params.workspaceRoot, params.workspaceDirName, 'plugin');
  if (!(await exists(pluginDir))) return [];
  return uniqueStrings(await listPluginFiles(pluginDir));
}

async function importPluginModule(spec: string, workspaceRoot?: string): Promise<any> {
  const trimmed = String(spec || '').trim();
  if (!trimmed) return null;

  // NOTE: Some hosts compile to CommonJS and TypeScript downlevels `import()` to `require()`,
  // which cannot load `file://...` specifiers. Use a runtime dynamic import so plugins can be
  // loaded from file URLs and ESM/CJS modules reliably.
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

  if (trimmed.startsWith('file://')) {
    return dynamicImport(trimmed);
  }

  // Treat as a file path only when it is explicitly path-like.
  // Note: module specifiers can contain "/" (scoped packages, subpath imports),
  // so we must not use `includes(path.sep)` as a heuristic.
  const looksPath = trimmed.startsWith('.') || path.isAbsolute(trimmed);
  if (looksPath) {
    const resolvedPath = path.resolve(workspaceRoot || process.cwd(), trimmed);
    return dynamicImport(pathToFileURL(resolvedPath).href);
  }

  // treat as module specifier resolvable by Node
  // Important: resolve relative to the workspace root (not the runtime install path)
  // so repos can install their own plugins in their local node_modules.
  if (workspaceRoot) {
    try {
      const req = createRequire(path.join(workspaceRoot, 'package.json'));
      const resolved = req.resolve(trimmed, { paths: [workspaceRoot] });
      return dynamicImport(pathToFileURL(resolved).href);
    } catch {
      // fall through
    }
  }

  return dynamicImport(trimmed);
}

function extractHooksFromModule(moduleExports: any, input: LingyunPluginInput): Array<{ id: string; hooks: LingyunHooks }> {
  if (!moduleExports) return [];
  const out: Array<{ id: string; hooks: LingyunHooks }> = [];
  const seen = new Set<unknown>();

  const entries = Object.entries(moduleExports as Record<string, unknown>);
  for (const [name, value] of entries) {
    if (seen.has(value)) continue;
    if (typeof value === 'function') {
      seen.add(value);
      out.push({ id: name, hooks: (value as LingyunPluginFactory)(input) as any });
      continue;
    }
    if (isRecord(value)) {
      seen.add(value);
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
  private pluginTools: LingyunPluginToolEntry[] = [];

  constructor(
    private options: {
      plugins?: string[];
      autoDiscover?: boolean;
      workspaceDirName?: string;
      workspaceRoot?: string;
      /**
       * Optional plugin factory input. If omitted, PluginManager provides `workspaceRoot`.
       */
      input?: LingyunPluginInput;
      /**
       * Optional host logger for plugin loading and hook errors.
       */
      logger?: (message: string) => void;
    } = {}
  ) {}

  setOptions(next: Partial<PluginManager['options']>): void {
    this.options = { ...(this.options || {}), ...(next || {}) };
  }

  registerHooks(id: string, hooks: LingyunHooks): { dispose: () => void } {
    const entry: LoadedHooks = { id, hooks };
    this.extraHooks.push(entry);
    return {
      dispose: () => {
        const idx = this.extraHooks.indexOf(entry);
        if (idx >= 0) this.extraHooks.splice(idx, 1);
      },
    };
  }

  private async loadPluginsIfNeeded(): Promise<void> {
    const plugins = this.options.plugins ?? [];
    const autoDiscover = this.options.autoDiscover ?? false;
    const workspaceDirName = this.options.workspaceDirName ?? '.lingyun';
    const workspaceRoot = this.options.workspaceRoot;

    const discovered = await resolveWorkspacePluginPaths({ enabled: autoDiscover, workspaceDirName, workspaceRoot });
    const combined = uniqueStrings([...(plugins || []), ...discovered]);

    const input = { ...(this.options.input || {}), ...(workspaceRoot ? { workspaceRoot } : {}) } as LingyunPluginInput;
    const key = JSON.stringify({
      combined,
      workspaceRoot: workspaceRoot || '',
      gitRoot: input.gitRoot || '',
      projectId: input.projectId || '',
      storagePath: input.storagePath || '',
    });
    if (key === this.loadedKey) return;

    this.loadedKey = key;
    this.loadedHooks = [];
    this.pluginTools = [];

    for (const spec of combined) {
      try {
        const module = await importPluginModule(spec, workspaceRoot);
        const extracted = extractHooksFromModule(module, input);

        for (const entry of extracted) {
          const hooks = await Promise.resolve(entry.hooks);
          if (!hooks) continue;
          const pluginId = `${spec}#${entry.id}`;
          this.loadedHooks.push({ id: pluginId, hooks });

          if (hooks.tool && isRecord(hooks.tool)) {
            for (const [toolId, tool] of Object.entries(hooks.tool)) {
              if (!toolId || !tool) continue;
              this.pluginTools.push({ pluginId, toolId, tool: tool as any });
            }
          }
        }
      } catch (error) {
        this.options.logger?.(`agent-sdk: failed to load plugin ${spec}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async getPluginTools(): Promise<LingyunPluginToolEntry[]> {
    await this.loadPluginsIfNeeded();
    const out: LingyunPluginToolEntry[] = [...this.pluginTools];
    for (const entry of this.extraHooks) {
      const toolMap = (entry.hooks as any)?.tool;
      if (!isRecord(toolMap)) continue;
      for (const [toolId, tool] of Object.entries(toolMap)) {
        if (!toolId || !tool) continue;
        out.push({ pluginId: entry.id, toolId, tool: tool as any });
      }
    }
    return out;
  }

  async trigger<Name extends LingyunHookName, Output>(name: Name, input: unknown, output: Output): Promise<Output> {
    await this.loadPluginsIfNeeded();

    const all = [...this.extraHooks, ...this.loadedHooks];
    for (const entry of all) {
      const fn = (entry.hooks as any)?.[name];
      if (typeof fn !== 'function') continue;
      try {
        await fn(input, output);
      } catch (error) {
        this.options.logger?.(`agent-sdk: plugin hook error ${entry.id}.${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return output;
  }
}
