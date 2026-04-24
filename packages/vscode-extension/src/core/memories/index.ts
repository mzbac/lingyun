import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  normalizeSessionSignals,
  type SessionMemoryCandidate,
  type SessionMemoryCandidateKind,
  type SessionMemoryCandidateScope,
  type SessionMemoryCandidateSource,
} from '../sessionSignals';
import { SessionStore } from '../sessionStore';
import { getPrimaryWorkspaceRootPath } from '../workspaceContext';

import {
  buildMemoryRecords,
  buildStage1Output,
  deriveWorkspaceMemoryId,
  hasSignal,
  sortOutputs,
  sortRecords,
} from './ingest';
import {
  type MemoryDropResult,
  type MemoryMaintenanceAction,
  type MemoryMaintenanceResult,
  type MemoryRecord,
  type MemoryRecordKind,
  type MemoriesConfig,
  type MemorySearchResult,
  type MemoryUpdateResult,
  type PersistedSession,
  STAGE1_OUTPUTS_FILE,
  STORAGE_DIR_NAME,
} from './model';
import { buildConsolidatedMemoryEntries } from './consolidate';
import { planMemoryUpdate } from './planner';
import { searchMemoryRecords } from './search';
import {
  clearMemoryArtifacts,
  getMemoryArtifacts,
  listMarkdownFiles,
  loadPersistedSessions,
  readMemoryArtifactBundle,
  readMemoriesState,
  readRedactedTextIfExists,
  readTextIfExists,
  rebuildMemoryArtifacts,
  writeMemoriesState,
} from './storage';

export type {
  MemoryArtifacts,
  MemoryDropResult,
  MemoryMaintenanceAction,
  MemoryMaintenanceResult,
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
const DEFAULT_MAX_RESULTS_PER_KIND = 3;
const DEFAULT_SEARCH_NEIGHBOR_WINDOW = 1;
const DEFAULT_MAX_AUTO_RECALL_RESULTS = 4;
const DEFAULT_MAX_AUTO_RECALL_TOKENS = 1200;
const DEFAULT_AUTO_RECALL_MIN_SCORE = 7;
const DEFAULT_AUTO_RECALL_MIN_SCORE_GAP = 1.25;
const DEFAULT_AUTO_RECALL_MAX_AGE_DAYS = 45;
const DEFAULT_BACKGROUND_REFRESH_DELAY_MS = 1500;

type ScheduledMemoryUpdate = {
  timer: NodeJS.Timeout;
  promise: Promise<MemoryUpdateResult>;
  resolve: (result: MemoryUpdateResult) => void;
  reject: (error: unknown) => void;
  workspaceFolder?: vscode.Uri;
};

function isStructuredMemoryCandidateKind(value: unknown): value is SessionMemoryCandidateKind {
  return (
    value === 'decision' ||
    value === 'preference' ||
    value === 'constraint' ||
    value === 'failed_attempt' ||
    value === 'procedure'
  );
}

function cloneStructuredMemoryCandidate(candidate: SessionMemoryCandidate): SessionMemoryCandidate {
  return {
    ...candidate,
    ...(candidate.sourceTurnIds ? { sourceTurnIds: [...candidate.sourceTurnIds] } : {}),
  };
}

function buildCandidateTemplate(params: {
  durableKey: string;
  anchorRecord: MemoryRecord;
  existingCandidate?: SessionMemoryCandidate;
}): SessionMemoryCandidate | undefined {
  const existing = params.existingCandidate;
  if (existing) {
    return {
      ...cloneStructuredMemoryCandidate(existing),
      memoryKey: params.durableKey,
    };
  }

  if (!isStructuredMemoryCandidateKind(params.anchorRecord.signalKind)) return undefined;

  const scope: SessionMemoryCandidateScope =
    params.anchorRecord.scope === 'session' ||
    params.anchorRecord.scope === 'workspace' ||
    params.anchorRecord.scope === 'user'
      ? params.anchorRecord.scope
      : 'workspace';

  const source: SessionMemoryCandidateSource =
    params.anchorRecord.signalKind === 'failed_attempt'
      ? 'tool'
      : params.anchorRecord.scope === 'user'
        ? 'user'
        : 'derived';

  return {
    kind: params.anchorRecord.signalKind,
    text: params.anchorRecord.text,
    scope,
    confidence: params.anchorRecord.confidence,
    source,
    evidenceCount: params.anchorRecord.evidenceCount,
    memoryKey: params.durableKey,
    ...(params.anchorRecord.sourceTurnIds ? { sourceTurnIds: [...params.anchorRecord.sourceTurnIds] } : {}),
  };
}

function selectAnchorRecord(records: MemoryRecord[], preferredRecordId?: string): MemoryRecord | undefined {
  if (records.length === 0) return undefined;
  const preferred = preferredRecordId ? records.find((record) => record.id === preferredRecordId) : undefined;
  if (preferred) return preferred;

  return [...records].sort((a, b) => {
    const aInvalidated = a.staleness === 'invalidated' ? 1 : 0;
    const bInvalidated = b.staleness === 'invalidated' ? 1 : 0;
    return (
      aInvalidated - bInvalidated ||
      b.lastConfirmedAt - a.lastConfirmedAt ||
      b.confidence - a.confidence ||
      a.index - b.index
    );
  })[0];
}

function mutateStructuredMemories(params: {
  memories: SessionMemoryCandidate[];
  action: MemoryMaintenanceAction;
  durableKey?: string;
  replacementText?: string;
  template?: SessionMemoryCandidate;
}): { memories: SessionMemoryCandidate[]; matched: boolean; changed: boolean } {
  const durableKey = String(params.durableKey || '').trim();
  if (!durableKey) {
    return { memories: params.memories.map((memory) => cloneStructuredMemoryCandidate(memory)), matched: false, changed: false };
  }

  let matched = false;
  let changed = false;
  let next = params.memories
    .filter((memory) => {
      const isMatch = String(memory.memoryKey || '').trim() === durableKey;
      if (!isMatch) return true;
      matched = true;
      if (params.action === 'invalidate') {
        changed = true;
        return false;
      }
      return true;
    })
    .map((memory) => {
      const isMatch = String(memory.memoryKey || '').trim() === durableKey;
      if (!isMatch) return cloneStructuredMemoryCandidate(memory);
      if (params.action !== 'supersede') return cloneStructuredMemoryCandidate(memory);

      const replacementText = String(params.replacementText || '').trim();
      if (!replacementText || memory.text === replacementText) {
        return cloneStructuredMemoryCandidate(memory);
      }
      changed = true;
      return {
        ...cloneStructuredMemoryCandidate(memory),
        text: replacementText,
        evidenceCount: Math.max(memory.evidenceCount || 1, 2),
        memoryKey: durableKey,
      };
    });

  if (params.action === 'supersede' && !matched && params.template) {
    const replacementText = String(params.replacementText || '').trim();
    if (replacementText) {
      matched = true;
      changed = true;
      next = [
        {
          ...cloneStructuredMemoryCandidate(params.template),
          text: replacementText,
          evidenceCount: Math.max(params.template.evidenceCount || 1, 2),
          memoryKey: durableKey,
        },
        ...next,
      ];
    }
  }

  return { memories: next, matched, changed };
}

function getSessionStoreOptions(): { maxSessions: number; maxSessionBytes: number } {
  const cfg = vscode.workspace.getConfiguration('lingyun');
  return {
    maxSessions: Math.max(1, cfg.get<number>('sessions.maxSessions', 20) ?? 20),
    maxSessionBytes: Math.max(1_000, cfg.get<number>('sessions.maxSessionBytes', 2_000_000) ?? 2_000_000),
  };
}

function getNumberConfig(key: string, fallback: number, min: number, max: number): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>(key);
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;

  if (!Number.isFinite(parsed as number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed as number)));
}

function getFloatConfig(key: string, fallback: number, min: number, max: number): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>(key);
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  if (!Number.isFinite(parsed as number)) return fallback;
  return Math.min(max, Math.max(min, parsed as number));
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
    maxResultsPerKind: getNumberConfig('memories.maxResultsPerKind', DEFAULT_MAX_RESULTS_PER_KIND, 1, 20),
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
    autoRecallMinScore: getFloatConfig('memories.autoRecallMinScore', DEFAULT_AUTO_RECALL_MIN_SCORE, 0, 100),
    autoRecallMinScoreGap: getFloatConfig(
      'memories.autoRecallMinScoreGap',
      DEFAULT_AUTO_RECALL_MIN_SCORE_GAP,
      0,
      50,
    ),
    autoRecallMaxAgeDays: getNumberConfig(
      'memories.autoRecallMaxAgeDays',
      DEFAULT_AUTO_RECALL_MAX_AGE_DAYS,
      1,
      3650,
    ),
  };
}

export { deriveWorkspaceMemoryId };

export class WorkspaceMemories {
  private static readonly updateInFlightByKey = new Map<string, Promise<MemoryUpdateResult>>();
  private static readonly scheduledUpdatesByKey = new Map<string, ScheduledMemoryUpdate>();
  private readonly storageRootUri: vscode.Uri | undefined;
  private readonly memoriesRootUri: vscode.Uri | undefined;
  private readonly stateUri: vscode.Uri | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.storageRootUri = context.storageUri ?? context.globalStorageUri;
    this.memoriesRootUri = resolveMemoriesRootUri(context);
    this.stateUri = this.memoriesRootUri
      ? vscode.Uri.joinPath(this.memoriesRootUri, STAGE1_OUTPUTS_FILE)
      : undefined;
  }

  private getCoordinationKey(): string | undefined {
    return (
      this.stateUri?.toString() ??
      this.memoriesRootUri?.toString() ??
      this.storageRootUri?.toString()
    );
  }

  private static clearScheduledUpdate(key: string): void {
    const scheduled = this.scheduledUpdatesByKey.get(key);
    if (!scheduled) return;
    clearTimeout(scheduled.timer);
    this.scheduledUpdatesByKey.delete(key);
  }

  async updateFromSessions(workspaceFolder?: vscode.Uri): Promise<MemoryUpdateResult> {
    const key = this.getCoordinationKey();
    if (!key) {
      return this.updateFromSessionsInternal(workspaceFolder);
    }

    WorkspaceMemories.clearScheduledUpdate(key);

    const inFlight = WorkspaceMemories.updateInFlightByKey.get(key);
    if (inFlight) return inFlight;

    const run = this.updateFromSessionsInternal(workspaceFolder).finally(() => {
      if (WorkspaceMemories.updateInFlightByKey.get(key) === run) {
        WorkspaceMemories.updateInFlightByKey.delete(key);
      }
    });
    WorkspaceMemories.updateInFlightByKey.set(key, run);
    return run;
  }

  scheduleUpdateFromSessions(
    workspaceFolder?: vscode.Uri,
    options?: { delayMs?: number },
  ): Promise<MemoryUpdateResult> {
    const delayMsRaw = options?.delayMs;
    const delayMs =
      typeof delayMsRaw === 'number' && Number.isFinite(delayMsRaw)
        ? Math.max(0, Math.floor(delayMsRaw))
        : DEFAULT_BACKGROUND_REFRESH_DELAY_MS;

    if (delayMs === 0) {
      return this.updateFromSessions(workspaceFolder);
    }

    const key = this.getCoordinationKey();
    if (!key) {
      return this.updateFromSessions(workspaceFolder);
    }

    const inFlight = WorkspaceMemories.updateInFlightByKey.get(key);
    if (inFlight) return inFlight;

    const scheduled = WorkspaceMemories.scheduledUpdatesByKey.get(key);
    if (scheduled) {
      if (workspaceFolder) scheduled.workspaceFolder = workspaceFolder;
      return scheduled.promise;
    }

    let resolve!: (result: MemoryUpdateResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<MemoryUpdateResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const entry: ScheduledMemoryUpdate = {
      timer: setTimeout(() => {
        WorkspaceMemories.scheduledUpdatesByKey.delete(key);
        void this.updateFromSessions(entry.workspaceFolder).then(resolve, reject);
      }, delayMs),
      promise,
      resolve,
      reject,
      workspaceFolder,
    };

    WorkspaceMemories.scheduledUpdatesByKey.set(key, entry);
    return promise;
  }

  async getUpdateStatus(): Promise<{
    enabled: boolean;
    needsUpdate: boolean;
    reason:
      | 'disabled'
      | 'no_persisted_sessions'
      | 'no_previous_scan'
      | 'sessions_newer_than_memory'
      | 'partial_explicit_memories'
      | 'artifacts_missing'
      | 'up_to_date';
    lastSessionScanAt?: number;
    latestSessionUpdatedAt?: number;
    persistedSessionCount?: number;
  }> {
    const config = getMemoriesConfig();
    if (!config.enabled) {
      return { enabled: false, needsUpdate: false, reason: 'disabled' };
    }

    const state = await readMemoriesState(this.stateUri);
    const lastSessionScanAt =
      typeof state.jobs?.lastSessionScanAt === 'number' && Number.isFinite(state.jobs.lastSessionScanAt)
        ? Math.floor(state.jobs.lastSessionScanAt)
        : undefined;

    const indexUri = this.storageRootUri ? vscode.Uri.joinPath(this.storageRootUri, 'sessions', 'index.json') : undefined;
    let persistedSessionCount = 0;
    let latestSessionUpdatedAt: number | undefined;
    if (indexUri) {
      const raw = await readTextIfExists(indexUri);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as {
            version?: unknown;
            order?: unknown;
            sessionsMeta?: Record<string, { updatedAt?: unknown }> | undefined;
          };
          if (parsed && parsed.version === 3 && Array.isArray(parsed.order) && parsed.sessionsMeta) {
            persistedSessionCount = parsed.order.filter((id) => typeof id === 'string' && id.trim()).length;
            for (const meta of Object.values(parsed.sessionsMeta)) {
              const updatedAt = meta.updatedAt;
              if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) {
                latestSessionUpdatedAt = Math.max(latestSessionUpdatedAt ?? 0, Math.floor(updatedAt));
              }
            }
          }
        } catch {
          // Ignore malformed session index; treat as no persisted sessions.
        }
      }
    }

    const hasOutputs = Array.isArray(state.outputs) && state.outputs.length > 0;
    const hasPartialExplicitOutputs = state.outputs.some((output) => output.partial === 'explicit');
    if (hasOutputs) {
      const artifacts = getMemoryArtifacts(this.memoriesRootUri);
      if (!artifacts) {
        return {
          enabled: true,
          needsUpdate: true,
          reason: 'artifacts_missing',
          lastSessionScanAt,
          latestSessionUpdatedAt,
          persistedSessionCount,
        };
      }

      const exists = async (uri: vscode.Uri): Promise<boolean> => {
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          return stat.type !== vscode.FileType.Unknown;
        } catch {
          return false;
        }
      };

      const [summaryExists, memoryExists, rawExists] = await Promise.all([
        exists(artifacts.memorySummaryFile),
        exists(artifacts.memoryFile),
        exists(artifacts.rawMemoriesFile),
      ]);

      if (!summaryExists || !memoryExists || !rawExists) {
        return {
          enabled: true,
          needsUpdate: true,
          reason: 'artifacts_missing',
          lastSessionScanAt,
          latestSessionUpdatedAt,
          persistedSessionCount,
        };
      }
    }

    if (!persistedSessionCount || latestSessionUpdatedAt === undefined) {
      return {
        enabled: true,
        needsUpdate: false,
        reason: 'no_persisted_sessions',
        lastSessionScanAt,
        latestSessionUpdatedAt,
        persistedSessionCount,
      };
    }

    if (lastSessionScanAt === undefined) {
      return {
        enabled: true,
        needsUpdate: true,
        reason: 'no_previous_scan',
        lastSessionScanAt,
        latestSessionUpdatedAt,
        persistedSessionCount,
      };
    }

    if (hasPartialExplicitOutputs) {
      return {
        enabled: true,
        needsUpdate: true,
        reason: 'partial_explicit_memories',
        lastSessionScanAt,
        latestSessionUpdatedAt,
        persistedSessionCount,
      };
    }

    if (latestSessionUpdatedAt > lastSessionScanAt) {
      return {
        enabled: true,
        needsUpdate: true,
        reason: 'sessions_newer_than_memory',
        lastSessionScanAt,
        latestSessionUpdatedAt,
        persistedSessionCount,
      };
    }

    return {
      enabled: true,
      needsUpdate: false,
      reason: 'up_to_date',
      lastSessionScanAt,
      latestSessionUpdatedAt,
      persistedSessionCount,
    };
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
        await rebuildMemoryArtifacts(
          artifacts,
          planned.retainedOutputs,
          planned.state.records.filter((record) => record.workspaceId === workspaceId),
        );
      }


    return {
      enabled: true,
      workspaceRoot: artifacts.memoryRoot.fsPath,
      ...planned.result,
    };
  }

  async dropMemories(_workspaceFolder?: vscode.Uri): Promise<MemoryDropResult> {
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

  async listRolloutSummaries(_workspaceFolder?: vscode.Uri): Promise<string[]> {
    const artifacts = getMemoryArtifacts(this.memoriesRootUri);
    if (!artifacts) return [];
    const names = await listMarkdownFiles(artifacts.rolloutSummariesDir);
    return names.sort((a, b) => b.localeCompare(a));
  }

  async readMemoryFile(
    kind: 'summary' | 'memory' | 'raw' | 'topic' | 'rollout',
    rolloutFile?: string,
    _workspaceFolder?: vscode.Uri,
  ): Promise<string | undefined> {
    const artifacts = getMemoryArtifacts(this.memoriesRootUri);
    if (!artifacts) return undefined;

    if (kind === 'summary') return readRedactedTextIfExists(artifacts.memorySummaryFile);
    if (kind === 'memory') return readRedactedTextIfExists(artifacts.memoryFile);
    if (kind === 'raw') return readRedactedTextIfExists(artifacts.rawMemoriesFile);

    if (!rolloutFile) return undefined;
    const normalized = path.basename(rolloutFile).replace(/\\/g, '/');
    if (!normalized.toLowerCase().endsWith('.md')) return undefined;
    if (kind === 'topic') {
      return readRedactedTextIfExists(vscode.Uri.joinPath(artifacts.memoryTopicsDir, normalized));
    }
    return readRedactedTextIfExists(vscode.Uri.joinPath(artifacts.rolloutSummariesDir, normalized));
  }

  async listMemoryRecords(workspaceFolder?: vscode.Uri): Promise<MemoryRecord[]> {
    const state = await readMemoriesState(this.stateUri);
    const workspaceRootPath = workspaceFolder?.fsPath ?? getPrimaryWorkspaceRootPath() ?? '';
    const workspaceId = deriveWorkspaceMemoryId(workspaceRootPath);
    return state.records.filter((record) => record.workspaceId === workspaceId);
  }

  async maintainMemory(params: {
    action: MemoryMaintenanceAction;
    recordId?: string;
    durableKey?: string;
    workspaceFolder?: vscode.Uri;
    replacementText?: string;
    note?: string;
  }): Promise<MemoryMaintenanceResult> {
    const config = getMemoriesConfig();
    const artifacts = getMemoryArtifacts(this.memoriesRootUri);
    const workspaceRootPath = params.workspaceFolder?.fsPath ?? getPrimaryWorkspaceRootPath() ?? '';
    const workspaceId = deriveWorkspaceMemoryId(workspaceRootPath);
    const recordId = String(params.recordId || '').trim();
    const action = params.action;
    const note = typeof params.note === 'string' && params.note.trim() ? params.note.trim() : undefined;
    const replacementText = String(params.replacementText || '').trim();

    if (!config.enabled) {
      return {
        enabled: false,
        action,
        workspaceRoot: artifacts?.memoryRoot.fsPath,
        updatedRecordId: recordId,
        affectedRecordIds: [],
        ...(params.durableKey ? { durableKey: params.durableKey.trim() } : {}),
        ...(note ? { note } : {}),
      };
    }

    if (!recordId && !params.durableKey) {
      throw new Error('Provide recordId or durableKey when maintaining memory.');
    }
    if (action === 'supersede' && !replacementText) {
      throw new Error('replacementText is required when action="supersede".');
    }

    const state = await readMemoriesState(this.stateUri);
    let records = [...state.records];
    let outputs = [...state.outputs];
    const workspaceRecords = records.filter((record) => record.workspaceId === workspaceId);
    const workspaceSessionIds = new Set(workspaceRecords.map((record) => record.sessionId));
    const workspaceOutputs = outputs.filter((output) => workspaceSessionIds.has(output.sessionId));
    const target = recordId ? workspaceRecords.find((record) => record.id === recordId) : undefined;
    if (recordId && !target) {
      throw new Error(`Memory record not found in this workspace: ${recordId}`);
    }

    const durableKey = String(params.durableKey || target?.memoryKey || '').trim();
    const clusterRecords = durableKey
      ? workspaceRecords.filter((record) => String(record.memoryKey || '').trim() === durableKey)
      : target
        ? [target]
        : [];
    const durableEntry = durableKey
      ? buildConsolidatedMemoryEntries({ outputs: workspaceOutputs, records: workspaceRecords }).find(
          (entry) => entry.key === durableKey,
        )
      : undefined;
    const supportRecords = durableEntry
      ? workspaceRecords.filter((record) => durableEntry.sessionIds.includes(record.sessionId))
      : [];
    const anchorCandidates = target
      ? [target, ...clusterRecords.filter((record) => record.id !== target.id), ...supportRecords.filter((record) => record.id !== target.id)]
      : clusterRecords.length > 0
        ? [...clusterRecords, ...supportRecords.filter((record) => !clusterRecords.some((candidate) => candidate.id === record.id))]
        : supportRecords;
    const anchor = selectAnchorRecord(anchorCandidates, recordId);
    if (!anchor) {
      throw new Error(`Memory record not found in this workspace: ${recordId || durableKey}`);
    }

    const now = Date.now();
    const affectedRecordIds = new Set<string>(clusterRecords.length > 0 ? clusterRecords.map((record) => record.id) : [anchor.id]);
    let updatedRecordId = anchor.id;
    const rebuiltSessionIds = new Set<string>();
    const outputMatchedSessionIds = new Set<string>();
    const templateAnchor = selectAnchorRecord(clusterRecords) ?? anchor;
    let template = buildCandidateTemplate({ durableKey, anchorRecord: templateAnchor });

    if (durableKey && action === 'invalidate') {
      records = records.map((record) => {
        if (record.workspaceId !== workspaceId) return record;
        if (String(record.memoryKey || '').trim() !== durableKey) return record;
        affectedRecordIds.add(record.id);
        return {
          ...record,
          staleness: 'invalidated',
          lastConfirmedAt: now,
        };
      });
    }

    if (durableKey && action !== 'confirm' && this.storageRootUri) {
      const store = new SessionStore<PersistedSession>(this.storageRootUri, getSessionStoreOptions());
      const loaded = await store.loadAll();
      if (loaded) {
        const dirtySessionIds = new Set<string>();
        const clusterSessionIds = new Set<string>([
          ...clusterRecords.map((record) => record.sessionId),
          ...outputs
            .filter((output) =>
              output.structuredMemories.some((candidate) => String(candidate.memoryKey || '').trim() === durableKey),
            )
            .map((output) => output.sessionId),
        ]);
        clusterSessionIds.add(anchor.sessionId);

        for (const sessionId of clusterSessionIds) {
          const session = loaded.sessionsById.get(sessionId);
          if (!session) continue;

          const normalizedSignals = normalizeSessionSignals(session.signals, now);
          const existingCandidate = normalizedSignals.structuredMemories.find(
            (candidate) => String(candidate.memoryKey || '').trim() === durableKey,
          );
          if (existingCandidate && !template) {
            template = buildCandidateTemplate({
              durableKey,
              anchorRecord: anchor,
              existingCandidate,
            });
          }

          const mutation = mutateStructuredMemories({
            memories: normalizedSignals.structuredMemories,
            action,
            durableKey,
            replacementText,
            template: sessionId === anchor.sessionId ? template : undefined,
          });
          if (!mutation.matched || !mutation.changed) continue;

          loaded.sessionsById.set(sessionId, {
            ...session,
            signals: {
              ...normalizedSignals,
              structuredMemories: mutation.memories,
              updatedAt: now,
            },
          });
          dirtySessionIds.add(sessionId);
          rebuiltSessionIds.add(sessionId);
        }

        if (dirtySessionIds.size > 0) {
          await store.save({
            sessionsById: loaded.sessionsById,
            activeSessionId: loaded.index.activeSessionId,
            order: loaded.index.order,
            dirtySessionIds: [...dirtySessionIds],
          });

          for (const sessionId of dirtySessionIds) {
            const session = loaded.sessionsById.get(sessionId);
            if (!session) continue;

            const nextStage1 = buildStage1Output({
              session,
              cwd: workspaceRootPath,
              generatedAt: now,
            });
            outputs = outputs.filter((output) => output.sessionId !== sessionId);
            if (hasSignal(nextStage1)) {
              outputs.push(nextStage1);
            }

            records = records.filter((record) => !(record.workspaceId === workspaceId && record.sessionId === sessionId));
            const nextRecords = buildMemoryRecords({
              session,
              stage1: nextStage1,
              workspaceId,
            });
            records.push(...nextRecords);
            for (const record of nextRecords) {
              affectedRecordIds.add(record.id);
            }

            const nextAnchor = selectAnchorRecord(
              nextRecords.filter((record) => String(record.memoryKey || '').trim() === durableKey),
              recordId,
            );
            if (nextAnchor) {
              updatedRecordId = nextAnchor.id;
            }
          }
        }
      }
    }

    if (durableKey) {
      outputs = outputs.map((output) => {
        if (rebuiltSessionIds.has(output.sessionId)) return output;

        const mutation = mutateStructuredMemories({
          memories: output.structuredMemories,
          action,
          durableKey,
          replacementText,
          template: output.sessionId === anchor.sessionId ? template : undefined,
        });
        if (!mutation.matched || !mutation.changed) return output;

        outputMatchedSessionIds.add(output.sessionId);
        return {
          ...output,
          structuredMemories: mutation.memories,
        };
      });

      records = records.map((record) => {
        if (record.workspaceId !== workspaceId) return record;
        if (String(record.memoryKey || '').trim() !== durableKey) return record;
        if (rebuiltSessionIds.has(record.sessionId)) return record;

        affectedRecordIds.add(record.id);
        if (action === 'invalidate') {
          return {
            ...record,
            staleness: 'invalidated',
            lastConfirmedAt: now,
          };
        }
        if (action === 'confirm') {
          return {
            ...record,
            staleness: 'fresh',
            lastConfirmedAt: now,
          };
        }
        return {
          ...record,
          text: replacementText,
          sourceUpdatedAt: Math.max(record.sourceUpdatedAt, now),
          generatedAt: now,
          lastConfirmedAt: now,
          staleness: 'fresh',
          evidenceCount: Math.max(record.evidenceCount, 2),
        };
      });
    } else {
      records = records.map((record) => {
        if (record.id !== anchor.id) return record;
        affectedRecordIds.add(record.id);
        if (action === 'invalidate') {
          return {
            ...record,
            staleness: 'invalidated',
            lastConfirmedAt: now,
          };
        }
        if (action === 'confirm') {
          return {
            ...record,
            staleness: 'fresh',
            lastConfirmedAt: now,
          };
        }
        return {
          ...record,
          text: replacementText,
          sourceUpdatedAt: Math.max(record.sourceUpdatedAt, now),
          generatedAt: now,
          lastConfirmedAt: now,
          staleness: 'fresh',
          evidenceCount: Math.max(record.evidenceCount, 2),
        };
      });
    }

    if (durableKey && action === 'invalidate' && clusterRecords.length > 0) {
      for (const record of clusterRecords) {
        const hasSameRecord = records.some(
          (current) => current.id === record.id && String(current.memoryKey || '').trim() === durableKey,
        );
        if (hasSameRecord) continue;

        const nextId = records.some((current) => current.id === record.id) ? `${record.id}:invalidated:${now}` : record.id;
        records.push({
          ...record,
          id: nextId,
          generatedAt: now,
          lastConfirmedAt: now,
          staleness: 'invalidated',
        });
        affectedRecordIds.add(nextId);
      }
    }

    const nextState = {
      ...state,
      outputs: sortOutputs(outputs).slice(0, config.maxStateOutputs),
      records: sortRecords(records).slice(0, config.maxRecords),
      jobs: {
        ...state.jobs,
        lastGlobalRebuildAt: now,
      },
    };

    await writeMemoriesState(this.memoriesRootUri, this.stateUri, nextState);

    if (artifacts) {
      const workspaceNextRecords = nextState.records.filter((record) => record.workspaceId === workspaceId);
      const workspaceSessionIds = new Set(workspaceNextRecords.map((record) => record.sessionId));
      for (const sessionId of outputMatchedSessionIds) {
        workspaceSessionIds.add(sessionId);
      }
      const workspaceOutputs = nextState.outputs.filter((output) => workspaceSessionIds.has(output.sessionId));
      if (workspaceOutputs.length === 0) {
        await clearMemoryArtifacts(artifacts);
      } else {
        await rebuildMemoryArtifacts(artifacts, workspaceOutputs, workspaceNextRecords);
      }
    }

    return {
      enabled: true,
      action,
      workspaceRoot: artifacts?.memoryRoot.fsPath,
      updatedRecordId,
      affectedRecordIds: [...affectedRecordIds],
      ...(durableKey ? { durableKey } : {}),
      ...(note ? { note } : {}),
    };
  }

  async searchMemory(params: {
    query: string;
    workspaceFolder?: vscode.Uri;
    kind?: MemoryRecordKind;
    scope?: SessionMemoryCandidateScope;
    limit?: number;
    neighborWindow?: number;
    maxTokens?: number;
    maxResultsPerKind?: number;
    preferDurableFirst?: boolean;
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
    const maxResultsPerKind =
      typeof params.maxResultsPerKind === 'number' && Number.isFinite(params.maxResultsPerKind) && params.maxResultsPerKind > 0
        ? Math.floor(params.maxResultsPerKind)
        : config.maxResultsPerKind;
    const preferDurableFirst = params.preferDurableFirst === true;

    const workspaceRecords = state.records.filter((record) => record.workspaceId === workspaceId);
    const workspaceSessionIds = new Set(workspaceRecords.map((record) => record.sessionId));
    const workspaceOutputs = state.outputs.filter((output) => workspaceSessionIds.has(output.sessionId));
    const durableEntries = buildConsolidatedMemoryEntries({
      outputs: workspaceOutputs,
      records: workspaceRecords,
    });

    return searchMemoryRecords({
      records: state.records,
      durableEntries,
      query: params.query,
      workspaceId,
      kind: params.kind,
      scope: params.scope,
      limit,
      neighborWindow,
      maxTokens,
      maxResultsPerKind,
      preferDurableFirst,
    });
  }
}

export async function readMemoryArtifacts(extensionContext: vscode.ExtensionContext): Promise<{
  summary?: string;
  memory?: string;
  raw?: string;
  topics: string[];
  rollouts: string[];
}> {
  const rootUri = resolveMemoriesRootUri(extensionContext);
  return readMemoryArtifactBundle(getMemoryArtifacts(rootUri));
}
