import * as vscode from 'vscode';

import type { SessionSignals } from '../sessionSignals';

export const STATE_VERSION = 2;
export const STORAGE_DIR_NAME = 'memories';
export const STAGE1_OUTPUTS_FILE = 'stage1_outputs.json';
export const ROLLOUT_SUMMARIES_DIR_NAME = 'rollout_summaries';
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
  batchFiles?: string[];
};

export type PersistedChatMessage = {
  id?: string;
  role?: string;
  content?: string;
  timestamp?: number;
  turnId?: string;
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
  rolloutFile: string;
  userIntents: string[];
  assistantOutcomes: string[];
  filesTouched: string[];
  toolsUsed: string[];
};

export type MemoryRecordKind = 'episodic' | 'semantic' | 'procedural';

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
  turnId?: string;
  prevRecordId?: string;
  nextRecordId?: string;
};

export type MemorySearchHit = {
  record: MemoryRecord;
  score: number;
  reason: 'match' | 'neighbor';
  matchedTerms: string[];
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
  searchNeighborWindow: number;
  autoRecall: boolean;
  maxAutoRecallResults: number;
  maxAutoRecallTokens: number;
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
  skippedPlanOrSubagentSessions: number;
  skippedNoSignalSessions: number;
};

export type MemoryDropResult = {
  removedStateOutputs: number;
  removedArtifacts: boolean;
};

export type MemoryArtifacts = {
  memoryRoot: vscode.Uri;
  rolloutSummariesDir: vscode.Uri;
  rawMemoriesFile: vscode.Uri;
  memorySummaryFile: vscode.Uri;
  memoryFile: vscode.Uri;
};
