import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { getPrimaryWorkspaceRootPath } from '../workspaceContext';

import { deriveWorkspaceMemoryId } from './ingest';
import {
  type MemoryArtifacts,
  type MemoryDropResult,
  type MemoryRecord,
  type MemoryRecordKind,
  type MemoriesConfig,
  type MemorySearchResult,
  type MemoryUpdateResult,
  STAGE1_OUTPUTS_FILE,
  STORAGE_DIR_NAME,
} from './model';
import { planMemoryUpdate } from './planner';
import { searchMemoryRecords } from './search';
import {
  clearMemoryArtifacts,
  getMemoryArtifacts,
  listMarkdownFiles,
  loadPersistedSessions,
  readMemoryArtifactBundle,
  readMemoriesState,
  readTextIfExists,
  rebuildMemoryArtifacts,
  writeMemoriesState,
} from './storage';

export type {
  MemoryArtifacts,
  MemoryDropResult,
  MemoryRecord,
  MemoryRecordKind,
  MemoriesConfig,
  MemorySearchHit,
  MemorySearchResult,
  MemoryUpdateResult,
  PersistedSession,
  Stage1Output,
} from './model';

const DEFAULT_MAX_RAW_MEMORIES = 120;
const DEFAULT_MAX_ROLLOUT_AGE_DAYS = 30;
const DEFAULT_MAX_ROLLOUTS_PER_STARTUP = 24;
const DEFAULT_MIN_ROLLOUT_IDLE_HOURS = 2;
const DEFAULT_MAX_STATE_OUTPUTS = 500;
const DEFAULT_MAX_MEMORY_RECORDS = 5000;
const DEFAULT_MAX_SEARCH_RESULTS = 8;
const DEFAULT_SEARCH_NEIGHBOR_WINDOW = 1;
const DEFAULT_MAX_AUTO_RECALL_RESULTS = 4;
const DEFAULT_MAX_AUTO_RECALL_TOKENS = 1200;

function getNumberConfig(key: string, fallback: number, min: number, max: number): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>(key);
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;

  if (!Number.isFinite(parsed as number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed as number)));
}

function expandTilde(input: string): string {
  const value = input.trim();
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveMemoriesRootUri(context: vscode.ExtensionContext): vscode.Uri | undefined {
  const overrideRaw = process.env.LINGYUN_MEMORIES_DIR;
  const override = typeof overrideRaw === 'string' ? overrideRaw.trim() : '';
  if (override) {
    const resolved = expandTilde(override);
    if (resolved && path.isAbsolute(resolved)) {
      return vscode.Uri.file(resolved);
    }
  }

  const home = os.homedir();
  if (home && path.isAbsolute(home)) {
    return vscode.Uri.file(path.join(home, '.lingyun', STORAGE_DIR_NAME));
  }

  const fallback = context.storageUri ?? context.globalStorageUri;
  return fallback ? vscode.Uri.joinPath(fallback, STORAGE_DIR_NAME) : undefined;
}

export function isMemoriesEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('features.memories', true) ?? true;
}

export function getMemoriesConfig(): MemoriesConfig {
  return {
    enabled: isMemoriesEnabled(),
    maxRawMemoriesForGlobal: getNumberConfig(
      'memories.maxRawMemoriesForGlobal',
      DEFAULT_MAX_RAW_MEMORIES,
      1,
      2000,
    ),
    maxRolloutAgeDays: getNumberConfig('memories.maxRolloutAgeDays', DEFAULT_MAX_ROLLOUT_AGE_DAYS, 1, 3650),
    maxRolloutsPerStartup: getNumberConfig(
      'memories.maxRolloutsPerStartup',
      DEFAULT_MAX_ROLLOUTS_PER_STARTUP,
      1,
      2000,
    ),
    minRolloutIdleHours: getNumberConfig(
      'memories.minRolloutIdleHours',
      DEFAULT_MIN_ROLLOUT_IDLE_HOURS,
      0,
      24 * 30,
    ),
    maxStateOutputs: getNumberConfig('memories.maxStateOutputs', DEFAULT_MAX_STATE_OUTPUTS, 10, 5000),
    maxRecords: getNumberConfig('memories.maxRecords', DEFAULT_MAX_MEMORY_RECORDS, 100, 50_000),
    maxSearchResults: getNumberConfig('memories.maxSearchResults', DEFAULT_MAX_SEARCH_RESULTS, 1, 100),
    searchNeighborWindow: getNumberConfig(
      'memories.searchNeighborWindow',
      DEFAULT_SEARCH_NEIGHBOR_WINDOW,
      0,
      5,
    ),
    autoRecall: vscode.workspace.getConfiguration('lingyun').get<boolean>('memories.autoRecall', true) ?? true,
    maxAutoRecallResults: getNumberConfig(
      'memories.maxAutoRecallResults',
      DEFAULT_MAX_AUTO_RECALL_RESULTS,
      1,
      20,
    ),
    maxAutoRecallTokens: getNumberConfig(
      'memories.maxAutoRecallTokens',
      DEFAULT_MAX_AUTO_RECALL_TOKENS,
      100,
      20_000,
    ),
  };
}

export { deriveWorkspaceMemoryId };

export class WorkspaceMemories {
  private readonly storageRootUri: vscode.Uri | undefined;
  private readonly memoriesRootUri: vscode.Uri | undefined;
  private readonly stateUri: vscode.Uri | undefined;
  private updateInFlight?: Promise<MemoryUpdateResult>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.storageRootUri = context.storageUri ?? context.globalStorageUri;
    this.memoriesRootUri = resolveMemoriesRootUri(context);
    this.stateUri = this.memoriesRootUri
      ? vscode.Uri.joinPath(this.memoriesRootUri, STAGE1_OUTPUTS_FILE)
      : undefined;
  }

  async updateFromSessions(workspaceFolder?: vscode.Uri): Promise<MemoryUpdateResult> {
    if (this.updateInFlight) return this.updateInFlight;

    const run = this.updateFromSessionsInternal(workspaceFolder).finally(() => {
      this.updateInFlight = undefined;
    });
    this.updateInFlight = run;
    return run;
  }

  private async updateFromSessionsInternal(workspaceFolder?: vscode.Uri): Promise<MemoryUpdateResult> {
    const config = getMemoriesConfig();
    const artifacts = getMemoryArtifacts(this.memoriesRootUri);

    if (!config.enabled) {
      return {
        enabled: false,
        workspaceRoot: artifacts?.memoryRoot.fsPath,
        scannedSessions: 0,
        processedSessions: 0,
        insertedOutputs: 0,
        updatedOutputs: 0,
        retainedOutputs: 0,
        skippedRecentSessions: 0,
        skippedPlanOrSubagentSessions: 0,
        skippedNoSignalSessions: 0,
      };
    }

    if (!artifacts) {
      return {
        enabled: true,
        scannedSessions: 0,
        processedSessions: 0,
        insertedOutputs: 0,
        updatedOutputs: 0,
        retainedOutputs: 0,
        skippedRecentSessions: 0,
        skippedPlanOrSubagentSessions: 0,
        skippedNoSignalSessions: 0,
      };
    }

    const now = Date.now();
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const sessions = await loadPersistedSessions(this.storageRootUri, {
      maxSessions: Math.max(1, cfg.get<number>('sessions.maxSessions', 20) ?? 20),
      maxSessionBytes: Math.max(1_000, cfg.get<number>('sessions.maxSessionBytes', 2_000_000) ?? 2_000_000),
    });
    const prev = await readMemoriesState(this.stateUri);

    const workspaceRootPath = workspaceFolder?.fsPath ?? getPrimaryWorkspaceRootPath() ?? '';
    const workspaceId = deriveWorkspaceMemoryId(workspaceRootPath);
    const planned = planMemoryUpdate({
      sessions,
      prev,
      config,
      workspaceId,
      workspaceRootPath,
      now,
    });

    await writeMemoriesState(this.memoriesRootUri, this.stateUri, planned.state);

    if (planned.retainedOutputs.length === 0) {
      await clearMemoryArtifacts(artifacts);
    } else {
      await rebuildMemoryArtifacts(artifacts, planned.retainedOutputs);
    }

    return {
      enabled: true,
      workspaceRoot: artifacts.memoryRoot.fsPath,
      ...planned.result,
    };
  }

  async dropMemories(workspaceFolder?: vscode.Uri): Promise<MemoryDropResult> {
    const state = await readMemoriesState(this.stateUri);
    let removedArtifacts = false;
    if (this.memoriesRootUri) {
      try {
        await vscode.workspace.fs.delete(this.memoriesRootUri, { recursive: true, useTrash: false });
        removedArtifacts = true;
      } catch {
        // Ignore missing memories directory.
      }
    }

    return {
      removedStateOutputs: state.outputs.length,
      removedArtifacts,
    };
  }

  async listRolloutSummaries(workspaceFolder?: vscode.Uri): Promise<string[]> {
    const artifacts = getMemoryArtifacts(this.memoriesRootUri);
    if (!artifacts) return [];
    const names = await listMarkdownFiles(artifacts.rolloutSummariesDir);
    return names.sort((a, b) => b.localeCompare(a));
  }

  async readMemoryFile(
    kind: 'summary' | 'memory' | 'raw' | 'rollout',
    rolloutFile?: string,
    workspaceFolder?: vscode.Uri,
  ): Promise<string | undefined> {
    const artifacts = getMemoryArtifacts(this.memoriesRootUri);
    if (!artifacts) return undefined;

    if (kind === 'summary') return readTextIfExists(artifacts.memorySummaryFile);
    if (kind === 'memory') return readTextIfExists(artifacts.memoryFile);
    if (kind === 'raw') return readTextIfExists(artifacts.rawMemoriesFile);

    if (!rolloutFile) return undefined;
    const normalized = path.basename(rolloutFile).replace(/\\/g, '/');
    if (!normalized.toLowerCase().endsWith('.md')) return undefined;
    return readTextIfExists(vscode.Uri.joinPath(artifacts.rolloutSummariesDir, normalized));
  }

  async listMemoryRecords(workspaceFolder?: vscode.Uri): Promise<MemoryRecord[]> {
    const state = await readMemoriesState(this.stateUri);
    const workspaceRootPath = workspaceFolder?.fsPath ?? getPrimaryWorkspaceRootPath() ?? '';
    const workspaceId = deriveWorkspaceMemoryId(workspaceRootPath);
    return state.records.filter((record) => record.workspaceId === workspaceId);
  }

  async searchMemory(params: {
    query: string;
    workspaceFolder?: vscode.Uri;
    kind?: MemoryRecordKind;
    limit?: number;
    neighborWindow?: number;
    maxTokens?: number;
  }): Promise<MemorySearchResult> {
    const config = getMemoriesConfig();
    const workspaceRootPath = params.workspaceFolder?.fsPath ?? getPrimaryWorkspaceRootPath() ?? '';
    const workspaceId = deriveWorkspaceMemoryId(workspaceRootPath);
    const state = await readMemoriesState(this.stateUri);

    const limit = Math.max(
      1,
      Math.min(
        100,
        Math.floor(
          typeof params.limit === 'number' && Number.isFinite(params.limit)
            ? params.limit
            : config.maxSearchResults,
        ),
      ),
    );
    const neighborWindow = Math.max(
      0,
      Math.min(
        5,
        Math.floor(
          typeof params.neighborWindow === 'number' && Number.isFinite(params.neighborWindow)
            ? params.neighborWindow
            : config.searchNeighborWindow,
        ),
      ),
    );
    const maxTokens =
      typeof params.maxTokens === 'number' && Number.isFinite(params.maxTokens) && params.maxTokens > 0
        ? Math.floor(params.maxTokens)
        : undefined;

    return searchMemoryRecords({
      records: state.records,
      query: params.query,
      workspaceId,
      kind: params.kind,
      limit,
      neighborWindow,
      maxTokens,
    });
  }
}

export async function readMemoryArtifacts(extensionContext: vscode.ExtensionContext): Promise<{
  summary?: string;
  memory?: string;
  raw?: string;
  rollouts: string[];
}> {
  const rootUri = resolveMemoriesRootUri(extensionContext);
  return readMemoryArtifactBundle(getMemoryArtifacts(rootUri));
}
