import * as vscode from 'vscode';

import type {
  SessionMemoryCandidate,
  SessionMemoryCandidateKind,
  SessionMemoryCandidateScope,
  SessionSignals,
} from '../sessionSignals';

export const STATE_VERSION = 3;
export const STORAGE_DIR_NAME = 'memories';
export const STAGE1_OUTPUTS_FILE = 'stage1_outputs.json';
export const ROLLOUT_SUMMARIES_DIR_NAME = 'rollout_summaries';
export const MEMORY_TOPICS_DIR_NAME = 'memory_topics';
export const RAW_MEMORIES_FILENAME = 'raw_memories.md';
export const MEMORY_SUMMARY_FILENAME = 'memory_summary.md';
export const MEMORY_MD_FILENAME = 'MEMORY.md';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export type PersistedChatToolCall = {
  name?: string;
  status?: string;
  result?: string;
  path?: string;
  memoryContextSource?: string;
  batchFiles?: string[];
};

export type PersistedChatMessage = {
  id?: string;
  role?: string;
  content?: string;
  timestamp?: number;
  turnId?: string;
  memoryExcluded?: boolean;
  toolCall?: PersistedChatToolCall;
};

export type PersistedSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  signals?: SessionSignals;
  mode?: 'build' | 'plan';
  parentSessionId?: string;
  subagentType?: string;
  runtime?: { wasRunning?: boolean; updatedAt?: number };
  messages?: PersistedChatMessage[];
};

export type Stage1Output = {
  sessionId: string;
  title: string;
  sourceUpdatedAt: number;
  generatedAt: number;
  cwd: string;
  rawMemory: string;
  rolloutSummary: string;
  rolloutSlug?: string;
  partial?: 'explicit';
  rolloutFile: string;
  userIntents: string[];
  assistantOutcomes: string[];
  filesTouched: string[];
  toolsUsed: string[];
  structuredMemories: SessionMemoryCandidate[];
};

export type DurableMemoryCategory = 'user' | 'feedback' | 'project' | 'reference' | 'procedure' | 'failure_shield';

export type ConsolidatedMemoryEntry = {
  key: string;
  text: string;
  category: DurableMemoryCategory;
  scope: SessionMemoryCandidateScope;
  confidence: number;
  evidenceCount: number;
  freshness: MemoryRecordStaleness;
  lastConfirmedAt: number;
  sessionIds: string[];
  titles: string[];
  rolloutFiles: string[];
  filesTouched: string[];
  toolsUsed: string[];
  sources: string[];
};

export type MemoryRecordKind = 'episodic' | 'semantic' | 'procedural';
export type MemoryRecordStaleness = 'fresh' | 'aging' | 'stale' | 'invalidated';
export type MemoryRecordSourceKind = SessionMemoryCandidateKind | 'summary' | 'turn';

export type MemoryRecord = {
  id: string;
  workspaceId: string;
  sessionId: string;
  kind: MemoryRecordKind;
  title: string;
  text: string;
  sourceUpdatedAt: number;
  generatedAt: number;
  filesTouched: string[];
  toolsUsed: string[];
  index: number;
  scope: SessionMemoryCandidateScope;
  confidence: number;
  evidenceCount: number;
  lastConfirmedAt: number;
  staleness: MemoryRecordStaleness;
  signalKind?: MemoryRecordSourceKind;
  memoryKey?: string;
  turnId?: string;
  sourceTurnIds?: string[];
  prevRecordId?: string;
  nextRecordId?: string;
  supersedesIds?: string[];
  invalidatesIds?: string[];
};

export type MemorySearchScoreBreakdown = {
  lexical: number;
  phrase: number;
  file: number;
  tool: number;
  recency: number;
  confidence: number;
  evidence: number;
  kind: number;
  freshnessPenalty: number;
};

export type MemorySearchHit = {
  record: MemoryRecord;
  source?: 'record' | 'durable';
  durableEntry?: ConsolidatedMemoryEntry;
  score: number;
  reason: 'match' | 'neighbor';
  matchedTerms: string[];
  scoreBreakdown?: MemorySearchScoreBreakdown;
};

export type MemorySearchResult = {
  query: string;
  workspaceId: string;
  hits: MemorySearchHit[];
  totalTokens: number;
  truncated: boolean;
};

export type MemoriesState = {
  version: number;
  outputs: Stage1Output[];
  records: MemoryRecord[];
  jobs?: {
    lastSessionScanAt?: number;
    lastGlobalRebuildAt?: number;
  };
};

export type MemoriesConfig = {
  enabled: boolean;
  maxRawMemoriesForGlobal: number;
  maxRolloutAgeDays: number;
  maxRolloutsPerStartup: number;
  minRolloutIdleHours: number;
  maxStateOutputs: number;
  maxRecords: number;
  maxSearchResults: number;
  maxResultsPerKind: number;
  searchNeighborWindow: number;
  autoRecall: boolean;
  maxAutoRecallResults: number;
  maxAutoRecallTokens: number;
  autoRecallMinScore: number;
  autoRecallMinScoreGap: number;
  autoRecallMaxAgeDays: number;
};

export type MemoryUpdateResult = {
  enabled: boolean;
  workspaceRoot?: string;
  scannedSessions: number;
  processedSessions: number;
  insertedOutputs: number;
  updatedOutputs: number;
  retainedOutputs: number;
  skippedRecentSessions: number;
  skippedExpiredSessions?: number;
  skippedPlanOrSubagentSessions: number;
  skippedNoSignalSessions: number;
  skippedExternalContextSessions?: number;
  skippedMemoryDisabledSessions?: number;
};

export type MemoryMaintenanceAction = 'invalidate' | 'supersede' | 'confirm';

export type MemoryMaintenanceResult = {
  enabled: boolean;
  action: MemoryMaintenanceAction;
  workspaceRoot?: string;
  updatedRecordId: string;
  affectedRecordIds: string[];
  durableKey?: string;
  note?: string;
};

export type MemoryDropResult = {
  removedStateOutputs: number;
  removedArtifacts: boolean;
};

export type MemoryArtifacts = {
  memoryRoot: vscode.Uri;
  rolloutSummariesDir: vscode.Uri;
  memoryTopicsDir: vscode.Uri;
  rawMemoriesFile: vscode.Uri;
  memorySummaryFile: vscode.Uri;
  memoryFile: vscode.Uri;
};
