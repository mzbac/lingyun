import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

export type KookaburraConfig = {
  llm: {
    provider: 'openaiCompatible';
    baseURL: string;
    apiKey?: string;
    model: string;
    timeoutMs?: number;
  };
  agent: {
    mode: 'build' | 'plan';
    temperature?: number;
    maxRetries?: number;
    maxOutputTokens?: number;
    autoApprove?: boolean;
    toolTimeoutMs?: number;
  };
  plugins?: {
    modules?: string[];
    autoDiscover?: boolean;
    workspaceDirName?: string;
  };
  security: {
    allowExternalPaths: boolean;
  };
  persistence: {
    sessionsDir: string;
  };
  cron: {
    enabled: boolean;
    pollMs: number;
    maxConcurrent: number;
    jobsFile: string;
  };
  sessionId?: string;
};

export type LoadConfigResult = {
  configPath?: string;
  config: KookaburraConfig;
};

export type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Record<string, any> ? PartialDeep<T[K]> : T[K];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown, options?: { maxItems?: number }): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const maxItems = typeof options?.maxItems === 'number' && options.maxItems > 0 ? Math.floor(options.maxItems) : 50;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const v = item.trim();
    if (!v) continue;
    out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function isPathInsideWorkspace(absPath: string, workspaceRoot: string): boolean {
  try {
    const rel = path.relative(workspaceRoot, absPath);
    if (!rel || rel === '.') return true;
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    return true;
  } catch {
    return false;
  }
}

function resolvePluginSpecToPath(spec: string, workspaceRoot: string): string | undefined {
  const trimmed = String(spec || '').trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('file://')) {
    try {
      return path.resolve(fileURLToPath(trimmed));
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith('.') || path.isAbsolute(trimmed)) {
    return path.resolve(workspaceRoot, trimmed);
  }
  return undefined;
}

export function findDefaultConfigPath(workspaceRoot: string): string | undefined {
  const candidates = [
    path.join(workspaceRoot, '.kookaburra', 'runtime.json'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }

  return undefined;
}

export function loadKookaburraConfig(options: {
  workspaceRoot: string;
  configPath?: string;
  cli?: PartialDeep<KookaburraConfig>;
  env?: NodeJS.ProcessEnv;
}): LoadConfigResult {
  const env = options.env ?? process.env;

  const configPath = (() => {
    if (options.configPath) {
      const explicit = path.isAbsolute(options.configPath)
        ? options.configPath
        : path.join(options.workspaceRoot, options.configPath);
      return explicit;
    }
    return findDefaultConfigPath(options.workspaceRoot);
  })();

  const fromFile: PartialDeep<KookaburraConfig> = (() => {
    if (!configPath) return {};
    const raw = readJsonFile(configPath);
    if (!isRecord(raw)) throw new Error(`Config file must be a JSON object: ${configPath}`);
    return raw as any;
  })();

  const fileLlm = isRecord(fromFile.llm) ? fromFile.llm : {};
  const fileAgent = isRecord(fromFile.agent) ? fromFile.agent : {};
  const filePlugins = isRecord((fromFile as any).plugins) ? ((fromFile as any).plugins as Record<string, unknown>) : {};
  const fileSecurity = isRecord(fromFile.security) ? fromFile.security : {};
  const filePersistence = isRecord(fromFile.persistence) ? fromFile.persistence : {};
  const fileCron = isRecord((fromFile as any).cron) ? ((fromFile as any).cron as Record<string, unknown>) : {};

  const envBaseURL = asString(env.KOOKABURRA_BASE_URL);
  const envApiKey = asString(env.KOOKABURRA_API_KEY);
  const envModel = asString(env.KOOKABURRA_MODEL);

  const cli = options.cli ?? {};
  const cliLlm = isRecord(cli.llm) ? cli.llm : {};
  const cliAgent = isRecord(cli.agent) ? cli.agent : {};
  const cliPlugins = isRecord((cli as any).plugins) ? (((cli as any).plugins as any) as Record<string, unknown>) : {};
  const cliSecurity = isRecord(cli.security) ? cli.security : {};
  const cliPersistence = isRecord(cli.persistence) ? cli.persistence : {};
  const cliCron = isRecord((cli as any).cron) ? (((cli as any).cron as any) as Record<string, unknown>) : {};

  const baseURL =
    asString(cliLlm.baseURL) ??
    envBaseURL ??
    asString(fileLlm.baseURL) ??
    '';

  const model =
    asString(cliLlm.model) ??
    envModel ??
    asString(fileLlm.model) ??
    '';

  const provider =
    (asString(cliLlm.provider) ?? asString(fileLlm.provider) ?? 'openaiCompatible') as KookaburraConfig['llm']['provider'];

  const apiKey =
    asString(cliLlm.apiKey) ??
    envApiKey ??
    asString(fileLlm.apiKey);

  const timeoutMs =
    asNumber(cliLlm.timeoutMs) ??
    asNumber(fileLlm.timeoutMs);

  const mode =
    ((asString(cliAgent.mode) ?? asString(fileAgent.mode) ?? 'build') === 'plan' ? 'plan' : 'build') as KookaburraConfig['agent']['mode'];

  const temperature =
    asNumber(cliAgent.temperature) ??
    asNumber(fileAgent.temperature);

  const maxRetries =
    asNumber(cliAgent.maxRetries) ??
    asNumber(fileAgent.maxRetries);

  const maxOutputTokens =
    asNumber(cliAgent.maxOutputTokens) ??
    asNumber(fileAgent.maxOutputTokens);

  const toolTimeoutMs =
    asNumber(cliAgent.toolTimeoutMs) ??
    asNumber(fileAgent.toolTimeoutMs);

  const autoApprove =
    asBoolean(cliAgent.autoApprove) ??
    asBoolean(fileAgent.autoApprove);

  const allowExternalPaths =
    asBoolean(cliSecurity.allowExternalPaths) ??
    asBoolean(fileSecurity.allowExternalPaths) ??
    false;

  const pluginModules =
    asStringArray((cliPlugins as any).modules, { maxItems: 100 }) ??
    asStringArray((filePlugins as any).modules, { maxItems: 100 }) ??
    [];

  const pluginsAutoDiscover =
    asBoolean((cliPlugins as any).autoDiscover) ??
    asBoolean((filePlugins as any).autoDiscover) ??
    false;

  const pluginsWorkspaceDirNameRaw =
    asString((cliPlugins as any).workspaceDirName) ??
    asString((filePlugins as any).workspaceDirName) ??
    '.kookaburra';
  const pluginsWorkspaceDirName = pluginsWorkspaceDirNameRaw.trim() || '.kookaburra';

  if (pluginsAutoDiscover && !pluginsWorkspaceDirName) {
    throw new Error('plugins.workspaceDirName is required when plugins.autoDiscover=true');
  }

  if (!allowExternalPaths) {
    const resolved = path.resolve(options.workspaceRoot, pluginsWorkspaceDirName);
    if (!isPathInsideWorkspace(resolved, options.workspaceRoot)) {
      throw new Error(
        `plugins.workspaceDirName resolves outside the workspace. Set security.allowExternalPaths=true to allow it. (workspaceDirName=${pluginsWorkspaceDirName})`
      );
    }

    for (const spec of pluginModules) {
      const resolvedSpecPath = resolvePluginSpecToPath(spec, options.workspaceRoot);
      if (!resolvedSpecPath) continue;
      if (!isPathInsideWorkspace(resolvedSpecPath, options.workspaceRoot)) {
        throw new Error(
          `Plugin spec resolves outside the workspace. Set security.allowExternalPaths=true to allow it. (spec=${spec})`
        );
      }
    }
  }

  const sessionsDir =
    asString(cliPersistence.sessionsDir) ??
    asString(filePersistence.sessionsDir) ??
    path.join('.kookaburra', 'sessions');

  const cronEnabled =
    asBoolean((cliCron as any).enabled) ??
    asBoolean((fileCron as any).enabled) ??
    true;

  const cronPollMs =
    asNumber((cliCron as any).pollMs) ??
    asNumber((fileCron as any).pollMs) ??
    15_000;

  const cronMaxConcurrent =
    asNumber((cliCron as any).maxConcurrent) ??
    asNumber((fileCron as any).maxConcurrent) ??
    4;

  const cronJobsFile =
    asString((cliCron as any).jobsFile) ??
    asString((fileCron as any).jobsFile) ??
    path.join('.kookaburra', 'cron', 'jobs.json');

  const sessionId =
    asString(cli.sessionId) ??
    asString(fromFile.sessionId);

  if (!baseURL.trim()) {
    throw new Error('Missing LLM baseURL. Set KOOKABURRA_BASE_URL or llm.baseURL in config.');
  }

  if (!model.trim()) {
    throw new Error('Missing model. Set KOOKABURRA_MODEL or llm.model in config.');
  }

  return {
    configPath,
    config: {
      llm: {
        provider,
        baseURL: baseURL.trim(),
        ...(apiKey && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        model: model.trim(),
        ...(typeof timeoutMs === 'number' && timeoutMs > 0 ? { timeoutMs: Math.floor(timeoutMs) } : {}),
      },
      agent: {
        mode,
        ...(typeof temperature === 'number' ? { temperature } : {}),
        ...(typeof maxRetries === 'number' && maxRetries >= 0 ? { maxRetries: Math.floor(maxRetries) } : {}),
        ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0 ? { maxOutputTokens: Math.floor(maxOutputTokens) } : {}),
        ...(typeof autoApprove === 'boolean' ? { autoApprove } : {}),
        ...(typeof toolTimeoutMs === 'number' && toolTimeoutMs > 0 ? { toolTimeoutMs: Math.floor(toolTimeoutMs) } : {}),
      },
      plugins: {
        ...(pluginModules.length > 0 ? { modules: pluginModules } : {}),
        ...(typeof pluginsAutoDiscover === 'boolean' ? { autoDiscover: pluginsAutoDiscover } : {}),
        ...(pluginsWorkspaceDirName ? { workspaceDirName: pluginsWorkspaceDirName } : {}),
      },
      security: { allowExternalPaths: Boolean(allowExternalPaths) },
      persistence: { sessionsDir },
      cron: {
        enabled: Boolean(cronEnabled),
        pollMs: Math.max(1000, Math.floor(cronPollMs)),
        maxConcurrent: Math.max(1, Math.floor(cronMaxConcurrent)),
        jobsFile: cronJobsFile,
      },
      ...(sessionId && sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    },
  };
}
