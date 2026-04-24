import * as path from 'path';
import * as vscode from 'vscode';

import { SessionStore } from '../sessionStore';

import {
  type MemoriesState,
  type MemoryArtifacts,
  type MemoryRecord,
  type PersistedSession,
  type Stage1Output,
  MEMORY_TOPICS_DIR_NAME,
  MEMORY_MD_FILENAME,
  MEMORY_SUMMARY_FILENAME,
  RAW_MEMORIES_FILENAME,
  ROLLOUT_SUMMARIES_DIR_NAME,
  STAGE1_OUTPUTS_FILE,
  STATE_VERSION,
} from './model';
import { renderRawMemories, sortOutputs, sortRecords } from './ingest';
import { buildConsolidatedMemoryArtifacts } from './consolidate';
import { redactMemorySecrets } from './privacy';

export function getMemoryArtifacts(memoriesRootUri?: vscode.Uri): MemoryArtifacts | undefined {
  if (!memoriesRootUri) return undefined;

  const memoryRoot = memoriesRootUri;
  return {
    memoryRoot,
    rolloutSummariesDir: vscode.Uri.joinPath(memoryRoot, ROLLOUT_SUMMARIES_DIR_NAME),
    memoryTopicsDir: vscode.Uri.joinPath(memoryRoot, MEMORY_TOPICS_DIR_NAME),
    rawMemoriesFile: vscode.Uri.joinPath(memoryRoot, RAW_MEMORIES_FILENAME),
    memorySummaryFile: vscode.Uri.joinPath(memoryRoot, MEMORY_SUMMARY_FILENAME),
    memoryFile: vscode.Uri.joinPath(memoryRoot, MEMORY_MD_FILENAME),
  };
}

export async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export async function readRedactedTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  const text = await readTextIfExists(uri);
  return typeof text === 'string' ? redactMemorySecrets(text) : undefined;
}

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(redactMemorySecrets(text)));
}

function redactMemoryValue<T>(value: T): T {
  if (typeof value === 'string') return redactMemorySecrets(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactMemoryValue(item)) as T;
  if (!value || typeof value !== 'object') return value;

  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    next[key] = redactMemoryValue(item);
  }
  return next as T;
}

function sanitizeStringArray(values: string[] | undefined): string[] {
  return (Array.isArray(values) ? values : [])
    .map((value) => redactMemorySecrets(String(value || '')).trim())
    .filter(Boolean);
}

function sanitizeMemoryOutput(output: Stage1Output): Stage1Output {
  const redacted = redactMemoryValue(output);
  return {
    ...redacted,
    title: redactMemorySecrets(output.title),
    cwd: redactMemorySecrets(output.cwd),
    rawMemory: redactMemorySecrets(output.rawMemory),
    rolloutSummary: redactMemorySecrets(output.rolloutSummary),
    rolloutSlug: output.rolloutSlug ? redactMemorySecrets(output.rolloutSlug) : undefined,
    rolloutFile: redactMemorySecrets(output.rolloutFile),
    userIntents: sanitizeStringArray(output.userIntents),
    assistantOutcomes: sanitizeStringArray(output.assistantOutcomes),
    filesTouched: sanitizeStringArray(output.filesTouched),
    toolsUsed: sanitizeStringArray(output.toolsUsed),
    structuredMemories: (Array.isArray(output.structuredMemories) ? output.structuredMemories : []).map((candidate) => {
      const redactedCandidate = redactMemoryValue(candidate);
      return {
        ...redactedCandidate,
        text: redactMemorySecrets(candidate.text),
        memoryKey: candidate.memoryKey ? redactMemorySecrets(candidate.memoryKey) : undefined,
        sourceTurnIds: candidate.sourceTurnIds ? sanitizeStringArray(candidate.sourceTurnIds) : undefined,
      };
    }),
  };
}

function sanitizeMemoryRecord(record: MemoryRecord): MemoryRecord {
  const redacted = redactMemoryValue(record);
  return {
    ...redacted,
    title: redactMemorySecrets(record.title),
    text: redactMemorySecrets(record.text),
    filesTouched: sanitizeStringArray(record.filesTouched),
    toolsUsed: sanitizeStringArray(record.toolsUsed),
    memoryKey: record.memoryKey ? redactMemorySecrets(record.memoryKey) : undefined,
    turnId: record.turnId ? redactMemorySecrets(record.turnId) : undefined,
    sourceTurnIds: record.sourceTurnIds ? sanitizeStringArray(record.sourceTurnIds) : undefined,
    prevRecordId: record.prevRecordId ? redactMemorySecrets(record.prevRecordId) : undefined,
    nextRecordId: record.nextRecordId ? redactMemorySecrets(record.nextRecordId) : undefined,
    supersedesIds: record.supersedesIds ? sanitizeStringArray(record.supersedesIds) : undefined,
    invalidatesIds: record.invalidatesIds ? sanitizeStringArray(record.invalidatesIds) : undefined,
  };
}

export function sanitizeMemoriesState(state: MemoriesState): MemoriesState {
  const redacted = redactMemoryValue(state);
  return {
    ...redacted,
    outputs: sortOutputs((Array.isArray(state.outputs) ? state.outputs : []).map(sanitizeMemoryOutput)),
    records: sortRecords((Array.isArray(state.records) ? state.records : []).map(sanitizeMemoryRecord)),
  };
}

export async function listMarkdownFiles(dir: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .filter((name) => name.toLowerCase().endsWith('.md'));
  } catch {
    return [];
  }
}

function normalizeOutput(value: unknown): Stage1Output | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;

  const sessionId = typeof row.sessionId === 'string' ? row.sessionId : undefined;
  const title = typeof row.title === 'string' ? row.title : undefined;
  const rawMemory = typeof row.rawMemory === 'string' ? row.rawMemory : undefined;
  const rolloutSummary = typeof row.rolloutSummary === 'string' ? row.rolloutSummary : undefined;
  const rolloutFile = typeof row.rolloutFile === 'string' ? row.rolloutFile : undefined;
  const sourceUpdatedAt = typeof row.sourceUpdatedAt === 'number' ? row.sourceUpdatedAt : undefined;
  const generatedAt = typeof row.generatedAt === 'number' ? row.generatedAt : undefined;
  const cwd = typeof row.cwd === 'string' ? row.cwd : '';

  if (!sessionId || !title || !rawMemory || !rolloutSummary || !rolloutFile) return undefined;
  if (!Number.isFinite(sourceUpdatedAt as number) || !Number.isFinite(generatedAt as number)) return undefined;

  const structuredMemories = Array.isArray(row.structuredMemories)
    ? row.structuredMemories.filter((item) => !!item && typeof item === 'object')
    : [];

  return {
    sessionId,
    title,
    rawMemory,
    rolloutSummary,
    rolloutFile,
    partial: row.partial === 'explicit' ? 'explicit' : undefined,
    sourceUpdatedAt: Math.floor(sourceUpdatedAt as number),
    generatedAt: Math.floor(generatedAt as number),
    cwd,
    rolloutSlug: typeof row.rolloutSlug === 'string' ? row.rolloutSlug : undefined,
    userIntents: Array.isArray(row.userIntents)
      ? (row.userIntents.filter((item) => typeof item === 'string') as string[])
      : [],
    assistantOutcomes: Array.isArray(row.assistantOutcomes)
      ? (row.assistantOutcomes.filter((item) => typeof item === 'string') as string[])
      : [],
    filesTouched: Array.isArray(row.filesTouched)
      ? (row.filesTouched.filter((item) => typeof item === 'string') as string[])
      : [],
    toolsUsed: Array.isArray(row.toolsUsed)
      ? (row.toolsUsed.filter((item) => typeof item === 'string') as string[])
      : [],
    structuredMemories: structuredMemories as Stage1Output['structuredMemories'],
  };
}

function normalizeRecord(value: unknown): MemoryRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;

  const id = typeof row.id === 'string' ? row.id : undefined;
  const workspaceId = typeof row.workspaceId === 'string' ? row.workspaceId : undefined;
  const sessionId = typeof row.sessionId === 'string' ? row.sessionId : undefined;
  const kind =
    row.kind === 'episodic' || row.kind === 'semantic' || row.kind === 'procedural'
      ? row.kind
      : undefined;
  const title = typeof row.title === 'string' ? row.title : undefined;
  const text = typeof row.text === 'string' ? row.text : undefined;
  const sourceUpdatedAt = typeof row.sourceUpdatedAt === 'number' ? row.sourceUpdatedAt : undefined;
  const generatedAt = typeof row.generatedAt === 'number' ? row.generatedAt : undefined;
  const index = typeof row.index === 'number' ? row.index : undefined;
  const scope = row.scope === 'session' || row.scope === 'workspace' || row.scope === 'user' ? row.scope : undefined;
  const staleness =
    row.staleness === 'fresh' || row.staleness === 'aging' || row.staleness === 'stale' || row.staleness === 'invalidated'
      ? row.staleness
      : undefined;
  const confidence = typeof row.confidence === 'number' ? row.confidence : undefined;
  const evidenceCount = typeof row.evidenceCount === 'number' ? row.evidenceCount : undefined;
  const lastConfirmedAt = typeof row.lastConfirmedAt === 'number' ? row.lastConfirmedAt : undefined;

  if (!id || !workspaceId || !sessionId || !kind || !title || !text || !scope || !staleness) return undefined;
  if (!Number.isFinite(sourceUpdatedAt as number) || !Number.isFinite(generatedAt as number)) return undefined;
  if (!Number.isFinite(index as number)) return undefined;
  if (!Number.isFinite(confidence as number) || !Number.isFinite(evidenceCount as number) || !Number.isFinite(lastConfirmedAt as number)) {
    return undefined;
  }

  return {
    id,
    workspaceId,
    sessionId,
    kind,
    title,
    text,
    sourceUpdatedAt: Math.floor(sourceUpdatedAt as number),
    generatedAt: Math.floor(generatedAt as number),
    index: Math.max(0, Math.floor(index as number)),
    scope,
    confidence: Math.max(0.05, Math.min(1, confidence as number)),
    evidenceCount: Math.max(1, Math.floor(evidenceCount as number)),
    lastConfirmedAt: Math.floor(lastConfirmedAt as number),
    staleness,
    signalKind: typeof row.signalKind === 'string' ? (row.signalKind as MemoryRecord['signalKind']) : undefined,
    memoryKey: typeof row.memoryKey === 'string' ? row.memoryKey : undefined,
    turnId: typeof row.turnId === 'string' ? row.turnId : undefined,
    sourceTurnIds: Array.isArray(row.sourceTurnIds)
      ? (row.sourceTurnIds.filter((item) => typeof item === 'string') as string[])
      : undefined,
    prevRecordId: typeof row.prevRecordId === 'string' ? row.prevRecordId : undefined,
    nextRecordId: typeof row.nextRecordId === 'string' ? row.nextRecordId : undefined,
    supersedesIds: Array.isArray(row.supersedesIds)
      ? (row.supersedesIds.filter((item) => typeof item === 'string') as string[])
      : undefined,
    invalidatesIds: Array.isArray(row.invalidatesIds)
      ? (row.invalidatesIds.filter((item) => typeof item === 'string') as string[])
      : undefined,
    filesTouched: Array.isArray(row.filesTouched)
      ? (row.filesTouched.filter((item) => typeof item === 'string') as string[])
      : [],
    toolsUsed: Array.isArray(row.toolsUsed)
      ? (row.toolsUsed.filter((item) => typeof item === 'string') as string[])
      : [],
  };
}

export async function readMemoriesState(stateUri?: vscode.Uri): Promise<MemoriesState> {
  if (!stateUri) {
    return { version: STATE_VERSION, outputs: [], records: [] };
  }

  const raw = await readTextIfExists(stateUri);
  if (!raw) return { version: STATE_VERSION, outputs: [], records: [] };

  try {
    const parsed = JSON.parse(raw) as Partial<MemoriesState>;
    const outputsRaw = Array.isArray(parsed.outputs) ? parsed.outputs : [];
    const outputs = outputsRaw
      .map((item) => normalizeOutput(item))
      .filter((item): item is Stage1Output => !!item);
    const recordsRaw = Array.isArray(parsed.records) ? parsed.records : [];
    const records = recordsRaw
      .map((item) => normalizeRecord(item))
      .filter((item): item is MemoryRecord => !!item);

    return sanitizeMemoriesState({
      version: typeof parsed.version === 'number' ? parsed.version : STATE_VERSION,
      outputs,
      records,
      jobs: redactMemoryValue(parsed.jobs),
    });
  } catch {
    return { version: STATE_VERSION, outputs: [], records: [] };
  }
}

export async function writeMemoriesState(
  memoriesRootUri: vscode.Uri | undefined,
  stateUri: vscode.Uri | undefined,
  state: MemoriesState,
): Promise<void> {
  if (!stateUri || !memoriesRootUri) return;

  await vscode.workspace.fs.createDirectory(memoriesRootUri);

  const sanitized = sanitizeMemoriesState(state);
  const tmp = vscode.Uri.joinPath(memoriesRootUri, `${STAGE1_OUTPUTS_FILE}.tmp-${crypto.randomUUID()}`);
  const bytes = new TextEncoder().encode(JSON.stringify(sanitized, null, 2));
  await vscode.workspace.fs.writeFile(tmp, bytes);
  await vscode.workspace.fs.rename(tmp, stateUri, { overwrite: true });
}

export async function loadPersistedSessions(
  storageRootUri: vscode.Uri | undefined,
  options?: { maxSessions?: number; maxSessionBytes?: number },
): Promise<PersistedSession[]> {
  if (!storageRootUri) return [];

  const store = new SessionStore<PersistedSession>(storageRootUri, {
    maxSessions: Math.max(1, options?.maxSessions ?? 20),
    maxSessionBytes: Math.max(1_000, options?.maxSessionBytes ?? 2_000_000),
  });

  const loaded = await store.loadAll();
  if (!loaded) return [];

  const sessions: PersistedSession[] = [];
  for (const id of loaded.index.order) {
    const session = loaded.sessionsById.get(id);
    if (!session) continue;
    sessions.push(session);
  }
  return sessions;
}

export async function rebuildMemoryArtifacts(
  artifacts: MemoryArtifacts,
  outputs: Stage1Output[],
  records: MemoryRecord[],
): Promise<void> {
  await vscode.workspace.fs.createDirectory(artifacts.memoryRoot);
  await vscode.workspace.fs.createDirectory(artifacts.rolloutSummariesDir);

  const sanitizedState = sanitizeMemoriesState({ version: STATE_VERSION, outputs, records });
  const sanitizedOutputs = sanitizedState.outputs;
  const sanitizedRecords = sanitizedState.records;

  const keepFiles = new Set(sanitizedOutputs.map((output) => path.basename(output.rolloutFile)));
  const existingFiles = await listMarkdownFiles(artifacts.rolloutSummariesDir);
  for (const fileName of existingFiles) {
    if (keepFiles.has(fileName)) continue;
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(artifacts.rolloutSummariesDir, fileName), {
        recursive: false,
        useTrash: false,
      });
    } catch {
      // Ignore stale file deletion errors.
    }
  }

  for (const output of sanitizedOutputs) {
    const fileName = path.basename(output.rolloutFile);
    const target = vscode.Uri.joinPath(artifacts.rolloutSummariesDir, fileName);
    await writeText(target, `${output.rolloutSummary.trimEnd()}\n`);
  }

  await writeText(artifacts.rawMemoriesFile, renderRawMemories(sanitizedOutputs));

  if (sanitizedOutputs.length === 0) {
    try {
      await vscode.workspace.fs.delete(artifacts.memoryFile, { recursive: false, useTrash: false });
    } catch {
      // Ignore missing file.
    }
    try {
      await vscode.workspace.fs.delete(artifacts.memorySummaryFile, { recursive: false, useTrash: false });
    } catch {
      // Ignore missing file.
    }
    try {
      await vscode.workspace.fs.delete(artifacts.memoryTopicsDir, { recursive: true, useTrash: false });
    } catch {
      // Ignore missing topic directory.
    }
    return;
  }

  const consolidated = buildConsolidatedMemoryArtifacts({ outputs: sanitizedOutputs, records: sanitizedRecords });
  await writeText(artifacts.memoryFile, consolidated.memoryFile);
  await writeText(artifacts.memorySummaryFile, consolidated.memorySummary);

  const topicFiles = Object.entries(consolidated.topicFiles);
  if (topicFiles.length === 0) {
    try {
      await vscode.workspace.fs.delete(artifacts.memoryTopicsDir, { recursive: true, useTrash: false });
    } catch {
      // Ignore missing topic directory.
    }
    return;
  }

  await vscode.workspace.fs.createDirectory(artifacts.memoryTopicsDir);
  const keepTopicFiles = new Set(topicFiles.map(([fileName]) => path.basename(fileName)));
  const existingTopicFiles = await listMarkdownFiles(artifacts.memoryTopicsDir);
  for (const fileName of existingTopicFiles) {
    if (keepTopicFiles.has(fileName)) continue;
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(artifacts.memoryTopicsDir, fileName), {
        recursive: false,
        useTrash: false,
      });
    } catch {
      // Ignore stale topic deletion errors.
    }
  }

  for (const [fileName, content] of topicFiles) {
    const target = vscode.Uri.joinPath(artifacts.memoryTopicsDir, path.basename(fileName));
    await writeText(target, `${content.trimEnd()}\n`);
  }
}

export async function clearMemoryArtifacts(artifacts: MemoryArtifacts): Promise<void> {
  try {
    await vscode.workspace.fs.delete(artifacts.rolloutSummariesDir, { recursive: true, useTrash: false });
  } catch {
    // Ignore missing rollout summaries directory.
  }
  try {
    await vscode.workspace.fs.delete(artifacts.memoryFile, { recursive: false, useTrash: false });
  } catch {
    // Ignore missing MEMORY.md.
  }
  try {
    await vscode.workspace.fs.delete(artifacts.memorySummaryFile, { recursive: false, useTrash: false });
  } catch {
    // Ignore missing memory_summary.md.
  }
  try {
    await vscode.workspace.fs.delete(artifacts.memoryTopicsDir, { recursive: true, useTrash: false });
  } catch {
    // Ignore missing memory_topics directory.
  }
  try {
    await vscode.workspace.fs.delete(artifacts.rawMemoriesFile, { recursive: false, useTrash: false });
  } catch {
    // Ignore missing raw_memories.md.
  }
}

export async function readMemoryArtifactBundle(artifacts?: MemoryArtifacts): Promise<{
  summary?: string;
  memory?: string;
  raw?: string;
  topics: string[];
  rollouts: string[];
}> {
  if (!artifacts) return { topics: [], rollouts: [] };

  const [summary, memory, raw, topics, rollouts] = await Promise.all([
    readRedactedTextIfExists(artifacts.memorySummaryFile),
    readRedactedTextIfExists(artifacts.memoryFile),
    readRedactedTextIfExists(artifacts.rawMemoriesFile),
    listMarkdownFiles(artifacts.memoryTopicsDir),
    listMarkdownFiles(artifacts.rolloutSummariesDir),
  ]);

  return {
    summary,
    memory,
    raw,
    topics: topics.sort((a, b) => a.localeCompare(b)),
    rollouts: rollouts.sort((a, b) => b.localeCompare(a)),
  };
}
