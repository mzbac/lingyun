import * as path from 'path';
import * as vscode from 'vscode';

import { SessionStore } from '../sessionStore';

import {
  type MemoriesState,
  type MemoryArtifacts,
  type MemoryRecord,
  type PersistedSession,
  type Stage1Output,
  MEMORY_MD_FILENAME,
  MEMORY_SUMMARY_FILENAME,
  RAW_MEMORIES_FILENAME,
  ROLLOUT_SUMMARIES_DIR_NAME,
  STAGE1_OUTPUTS_FILE,
  STATE_VERSION,
} from './model';
import {
  renderMemoryFile,
  renderMemorySummary,
  renderRawMemories,
  sortOutputs,
  sortRecords,
} from './ingest';

export function getMemoryArtifacts(memoriesRootUri?: vscode.Uri): MemoryArtifacts | undefined {
  if (!memoriesRootUri) return undefined;

  const memoryRoot = memoriesRootUri;
  return {
    memoryRoot,
    rolloutSummariesDir: vscode.Uri.joinPath(memoryRoot, ROLLOUT_SUMMARIES_DIR_NAME),
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

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
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

  return {
    sessionId,
    title,
    rawMemory,
    rolloutSummary,
    rolloutFile,
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

  if (!id || !workspaceId || !sessionId || !kind || !title || !text) return undefined;
  if (!Number.isFinite(sourceUpdatedAt as number) || !Number.isFinite(generatedAt as number)) return undefined;
  if (!Number.isFinite(index as number)) return undefined;

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
    turnId: typeof row.turnId === 'string' ? row.turnId : undefined,
    prevRecordId: typeof row.prevRecordId === 'string' ? row.prevRecordId : undefined,
    nextRecordId: typeof row.nextRecordId === 'string' ? row.nextRecordId : undefined,
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

    return {
      version: typeof parsed.version === 'number' ? parsed.version : STATE_VERSION,
      outputs: sortOutputs(outputs),
      records: sortRecords(records),
      jobs: parsed.jobs,
    };
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

  const tmp = vscode.Uri.joinPath(memoriesRootUri, `${STAGE1_OUTPUTS_FILE}.tmp-${crypto.randomUUID()}`);
  const bytes = new TextEncoder().encode(JSON.stringify(state, null, 2));
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
): Promise<void> {
  await vscode.workspace.fs.createDirectory(artifacts.memoryRoot);
  await vscode.workspace.fs.createDirectory(artifacts.rolloutSummariesDir);

  const keepFiles = new Set(outputs.map((output) => path.basename(output.rolloutFile)));
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

  for (const output of outputs) {
    const fileName = path.basename(output.rolloutFile);
    const target = vscode.Uri.joinPath(artifacts.rolloutSummariesDir, fileName);
    await writeText(target, `${output.rolloutSummary.trimEnd()}\n`);
  }

  await writeText(artifacts.rawMemoriesFile, renderRawMemories(outputs));

  if (outputs.length === 0) {
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
    return;
  }

  await writeText(artifacts.memoryFile, renderMemoryFile(outputs));
  await writeText(artifacts.memorySummaryFile, renderMemorySummary(outputs));
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
    await vscode.workspace.fs.delete(artifacts.rawMemoriesFile, { recursive: false, useTrash: false });
  } catch {
    // Ignore missing raw_memories.md.
  }
}

export async function readMemoryArtifactBundle(artifacts?: MemoryArtifacts): Promise<{
  summary?: string;
  memory?: string;
  raw?: string;
  rollouts: string[];
}> {
  if (!artifacts) return { rollouts: [] };

  const [summary, memory, raw, rollouts] = await Promise.all([
    readTextIfExists(artifacts.memorySummaryFile),
    readTextIfExists(artifacts.memoryFile),
    readTextIfExists(artifacts.rawMemoriesFile),
    listMarkdownFiles(artifacts.rolloutSummariesDir),
  ]);

  return {
    summary,
    memory,
    raw,
    rollouts: rollouts.sort((a, b) => b.localeCompare(a)),
  };
}
