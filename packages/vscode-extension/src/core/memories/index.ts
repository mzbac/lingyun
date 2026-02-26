import * as path from 'path';
import * as vscode from 'vscode';

import { SessionStore } from '../sessionStore';

const STATE_VERSION = 1;
const STORAGE_DIR_NAME = 'memories';
const STAGE1_OUTPUTS_FILE = 'stage1_outputs.json';
const ROLLOUT_SUMMARIES_DIR_NAME = 'rollout_summaries';
const RAW_MEMORIES_FILENAME = 'raw_memories.md';
const MEMORY_SUMMARY_FILENAME = 'memory_summary.md';
const MEMORY_MD_FILENAME = 'MEMORY.md';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_MAX_RAW_MEMORIES = 120;
const DEFAULT_MAX_ROLLOUT_AGE_DAYS = 30;
const DEFAULT_MAX_ROLLOUTS_PER_STARTUP = 24;
const DEFAULT_MIN_ROLLOUT_IDLE_HOURS = 2;
const DEFAULT_MAX_STATE_OUTPUTS = 500;
const DEFAULT_PHASE1_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_PHASE2_MODEL = 'gpt-5.3-codex';

export type PersistedSessionMessage = {
  role?: string;
  content?: string;
  timestamp?: number;
  toolCall?: {
    name?: string;
    status?: string;
    path?: string;
    batchFiles?: string[];
    result?: string;
  };
};

export type PersistedSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages?: PersistedSessionMessage[];
  mode?: 'build' | 'plan';
  parentSessionId?: string;
  subagentType?: string;
  runtime?: { wasRunning?: boolean; updatedAt?: number };
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

type MemoriesState = {
  version: number;
  outputs: Stage1Output[];
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
  phase1Model: string;
  phase2Model: string;
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

function getNumberConfig(key: string, fallback: number, min: number, max: number): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>(key);
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : undefined;

  if (!Number.isFinite(parsed as number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed as number)));
}

function getStringConfig(key: string, fallback: string): string {
  const raw = vscode.workspace.getConfiguration('lingyun').get<string>(key);
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  return trimmed || fallback;
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
    phase1Model: getStringConfig('memories.phase1Model', DEFAULT_PHASE1_MODEL),
    phase2Model: getStringConfig('memories.phase2Model', DEFAULT_PHASE2_MODEL),
  };
}

function getMemoryArtifacts(storageRootUri?: vscode.Uri): MemoryArtifacts | undefined {
  if (!storageRootUri) return undefined;

  const memoryRoot = vscode.Uri.joinPath(storageRootUri, STORAGE_DIR_NAME);
  return {
    memoryRoot,
    rolloutSummariesDir: vscode.Uri.joinPath(memoryRoot, ROLLOUT_SUMMARIES_DIR_NAME),
    rawMemoriesFile: vscode.Uri.joinPath(memoryRoot, RAW_MEMORIES_FILENAME),
    memorySummaryFile: vscode.Uri.joinPath(memoryRoot, MEMORY_SUMMARY_FILENAME),
    memoryFile: vscode.Uri.joinPath(memoryRoot, MEMORY_MD_FILENAME),
  };
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
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

function summarizeMessage(content: string | undefined, maxChars = 220): string {
  if (!content) return '';
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return compact.slice(0, maxChars).trimEnd() + '...';
}

function uniqueLimited(values: string[], maxItems: number): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(key);
    if (next.length >= maxItems) break;
  }
  return next;
}

function slugify(input: string | undefined, maxLen: number): string {
  if (!input) return '';
  const lower = input.trim().toLowerCase();
  if (!lower) return '';
  const normalized = lower
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return normalized.slice(0, maxLen).replace(/-+$/, '');
}

function shortHash(input: string): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let hash = 0;
  for (const ch of input) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  let value = hash % (alphabet.length ** 4);
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out = alphabet[value % alphabet.length] + out;
    value = Math.floor(value / alphabet.length);
  }
  return out;
}

function toIso(ts: number): string {
  return new Date(ts).toISOString();
}

function buildRolloutFileName(params: {
  sessionId: string;
  sourceUpdatedAt: number;
  rolloutSlug?: string;
}): string {
  const timestamp = toIso(params.sourceUpdatedAt).replace(/[:.]/g, '-');
  const hash = shortHash(params.sessionId);
  const suffix = slugify(params.rolloutSlug, 60);
  return suffix ? `${timestamp}-${hash}-${suffix}.md` : `${timestamp}-${hash}.md`;
}

function collectSessionSignals(session: PersistedSession): {
  userIntents: string[];
  assistantOutcomes: string[];
  filesTouched: string[];
  toolsUsed: string[];
} {
  const messages = Array.isArray(session.messages) ? session.messages : [];

  const userIntents = uniqueLimited(
    messages
      .filter(msg => msg.role === 'user')
      .map(msg => summarizeMessage(msg.content))
      .filter(Boolean),
    4,
  );

  const assistantOutcomes = uniqueLimited(
    messages
      .filter(msg => msg.role === 'assistant')
      .map(msg => summarizeMessage(msg.content))
      .filter(Boolean),
    4,
  );

  const toolsUsed = uniqueLimited(
    messages
      .filter(msg => msg.role === 'tool')
      .map(msg => msg.toolCall?.name?.trim() || '')
      .filter(Boolean),
    8,
  );

  const fileCandidates: string[] = [];
  for (const msg of messages) {
    const tc = msg.toolCall;
    if (!tc) continue;
    if (typeof tc.path === 'string' && tc.path.trim()) fileCandidates.push(tc.path.trim());
    if (Array.isArray(tc.batchFiles)) {
      for (const item of tc.batchFiles) {
        if (typeof item === 'string' && item.trim()) {
          fileCandidates.push(item.trim());
        }
      }
    }
  }

  return {
    userIntents,
    assistantOutcomes,
    filesTouched: uniqueLimited(fileCandidates, 20),
    toolsUsed,
  };
}

function hasSignal(signals: {
  userIntents: string[];
  assistantOutcomes: string[];
  filesTouched: string[];
  toolsUsed: string[];
}): boolean {
  return (
    signals.userIntents.length > 0 ||
    signals.assistantOutcomes.length > 0 ||
    signals.filesTouched.length > 0 ||
    signals.toolsUsed.length > 0
  );
}

function buildStage1Output(params: {
  session: PersistedSession;
  cwd: string;
  generatedAt: number;
}): Stage1Output {
  const { session, cwd, generatedAt } = params;
  const signals = collectSessionSignals(session);

  const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : generatedAt;
  const title = summarizeMessage(session.title, 140) || 'Untitled session';
  const keyIntent = signals.userIntents[0] ?? 'No user intent captured.';
  const keyOutcome = signals.assistantOutcomes[0] ?? 'No assistant outcome captured.';
  const tools = signals.toolsUsed.length > 0 ? signals.toolsUsed.join(', ') : 'none';
  const files = signals.filesTouched.length > 0 ? signals.filesTouched.join(', ') : 'none';

  const rolloutSlug = slugify(signals.userIntents[0] || title, 60);
  const rolloutFile = buildRolloutFileName({
    sessionId: session.id,
    sourceUpdatedAt: updatedAt,
    rolloutSlug,
  });

  const rawMemory = [
    `- Session "${title}" updated at ${toIso(updatedAt)}.`,
    `- Key user intent: ${keyIntent}`,
    `- Key outcome: ${keyOutcome}`,
    `- Tools used: ${tools}`,
    `- Files touched: ${files}`,
  ].join('\n');

  const rolloutSummary = [
    `# Session Memory: ${title}`,
    '',
    `session_id: ${session.id}`,
    `updated_at: ${toIso(updatedAt)}`,
    `generated_at: ${toIso(generatedAt)}`,
    `mode: ${session.mode === 'plan' ? 'plan' : 'build'}`,
    `cwd: ${cwd}`,
    '',
    '## User Intents',
    ...(signals.userIntents.length > 0
      ? signals.userIntents.map(item => `- ${item}`)
      : ['- (none captured)']),
    '',
    '## Outcomes',
    ...(signals.assistantOutcomes.length > 0
      ? signals.assistantOutcomes.map(item => `- ${item}`)
      : ['- (none captured)']),
    '',
    '## Tooling',
    `- Tools used: ${tools}`,
    `- Files touched: ${files}`,
  ].join('\n');

  return {
    sessionId: session.id,
    title,
    sourceUpdatedAt: updatedAt,
    generatedAt,
    cwd,
    rawMemory,
    rolloutSummary,
    rolloutSlug: rolloutSlug || undefined,
    rolloutFile,
    userIntents: signals.userIntents,
    assistantOutcomes: signals.assistantOutcomes,
    filesTouched: signals.filesTouched,
    toolsUsed: signals.toolsUsed,
  };
}

function renderRawMemories(outputs: Stage1Output[]): string {
  const lines: string[] = ['# Raw Memories', ''];
  if (outputs.length === 0) {
    lines.push('No raw memories yet.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('Merged stage-1 raw memories (latest first):');
  lines.push('');

  for (const output of outputs) {
    lines.push(`## Session \`${output.sessionId}\``);
    lines.push(`updated_at: ${toIso(output.sourceUpdatedAt)}`);
    lines.push(`cwd: ${output.cwd}`);
    lines.push(`rollout_summary_file: ${output.rolloutFile}`);
    lines.push('');
    lines.push(output.rawMemory.trim());
    lines.push('');
  }

  return lines.join('\n');
}

function renderMemoryFile(outputs: Stage1Output[]): string {
  const lines: string[] = [
    '# MEMORY',
    '',
    'Generated automatically from persisted LingYun sessions.',
    'This file is rewritten by the memory pipeline.',
    '',
    '## Stable Context',
  ];

  if (outputs.length === 0) {
    lines.push('- No durable memories yet. Run `LingYun: Update Memories` after a few sessions.');
    lines.push('');
    return lines.join('\n');
  }

  const focus = uniqueLimited(
    outputs
      .map(output => output.assistantOutcomes[0] || output.userIntents[0] || '')
      .filter(Boolean),
    8,
  );

  if (focus.length === 0) {
    lines.push('- No stable context extracted yet.');
  } else {
    for (const item of focus) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('## Recent Sessions');
  for (const output of outputs.slice(0, 20)) {
    lines.push(`### ${output.title}`);
    lines.push(`- updated_at: ${toIso(output.sourceUpdatedAt)}`);
    lines.push(`- session_id: ${output.sessionId}`);
    lines.push(`- key_intent: ${output.userIntents[0] ?? '(none captured)'}`);
    lines.push(`- key_outcome: ${output.assistantOutcomes[0] ?? '(none captured)'}`);
    lines.push(`- rollout_summary: ${ROLLOUT_SUMMARIES_DIR_NAME}/${output.rolloutFile}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderMemorySummary(outputs: Stage1Output[]): string {
  const lines: string[] = [
    '# Memory Summary',
    '',
    'Generated automatically. Read this first, then open MEMORY.md or specific rollout summaries as needed.',
    '',
    '## Current Focus',
  ];

  if (outputs.length === 0) {
    lines.push('- No memory summary yet.');
    lines.push('');
    return lines.join('\n');
  }

  const focus = uniqueLimited(
    outputs
      .map(output => output.assistantOutcomes[0] || output.userIntents[0] || '')
      .filter(Boolean),
    6,
  );

  if (focus.length === 0) {
    lines.push('- No stable focus extracted yet.');
  } else {
    for (const item of focus) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('## Progressive Read Path');
  lines.push('- Step 1: Read this file (`memory_summary.md`).');
  lines.push('- Step 2: Read `MEMORY.md` for consolidated durable context.');
  lines.push(`- Step 3: Open 1-2 relevant rollout summaries from \`${ROLLOUT_SUMMARIES_DIR_NAME}/*.md\` only when needed.`);
  lines.push('');

  lines.push('## Latest Rollouts');
  for (const output of outputs.slice(0, 12)) {
    lines.push(`- ${toIso(output.sourceUpdatedAt)} | ${output.title} | ${ROLLOUT_SUMMARIES_DIR_NAME}/${output.rolloutFile}`);
  }

  lines.push('');
  return lines.join('\n');
}

async function listMarkdownFiles(dir: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .filter(name => name.toLowerCase().endsWith('.md'));
  } catch {
    return [];
  }
}

function sortOutputs(outputs: Stage1Output[]): Stage1Output[] {
  return [...outputs].sort((a, b) => b.sourceUpdatedAt - a.sourceUpdatedAt || a.sessionId.localeCompare(b.sessionId));
}

export class WorkspaceMemories {
  private readonly storageRootUri: vscode.Uri | undefined;
  private readonly memoriesRootUri: vscode.Uri | undefined;
  private readonly stateUri: vscode.Uri | undefined;
  private updateInFlight?: Promise<MemoryUpdateResult>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.storageRootUri = context.storageUri ?? context.globalStorageUri;
    this.memoriesRootUri = this.storageRootUri
      ? vscode.Uri.joinPath(this.storageRootUri, STORAGE_DIR_NAME)
      : undefined;
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
    const artifacts = getMemoryArtifacts(this.storageRootUri);

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
    const sessions = await this.loadPersistedSessions();
    const prev = await this.readState();
    const prevBySession = new Map(prev.outputs.map(output => [output.sessionId, output]));
    const workspaceRootPath =
      workspaceFolder?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

    let skippedRecentSessions = 0;
    let skippedPlanOrSubagentSessions = 0;
    let skippedNoSignalSessions = 0;

    const eligible = sessions
      .filter(session => {
        if (session.parentSessionId || session.subagentType || session.mode === 'plan') {
          skippedPlanOrSubagentSessions += 1;
          return false;
        }

        if (session.runtime?.wasRunning) {
          skippedRecentSessions += 1;
          return false;
        }

        const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
        const idleMs = now - updatedAt;
        if (idleMs < config.minRolloutIdleHours * HOUR_MS) {
          skippedRecentSessions += 1;
          return false;
        }

        if (idleMs > config.maxRolloutAgeDays * DAY_MS) {
          skippedRecentSessions += 1;
          return false;
        }

        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, config.maxRolloutsPerStartup);

    const outputs = [...prev.outputs];
    let insertedOutputs = 0;
    let updatedOutputs = 0;

    for (const session of eligible) {
      const existing = prevBySession.get(session.id);
      const sessionUpdatedAt = Number.isFinite(session.updatedAt) ? Math.floor(session.updatedAt) : 0;
      if (existing && existing.sourceUpdatedAt >= sessionUpdatedAt) {
        continue;
      }

      const stage1 = buildStage1Output({
        session,
        cwd: workspaceRootPath,
        generatedAt: now,
      });
      if (!hasSignal(stage1)) {
        skippedNoSignalSessions += 1;
        continue;
      }

      const idx = outputs.findIndex(item => item.sessionId === session.id);
      if (idx >= 0) {
        outputs[idx] = stage1;
        updatedOutputs += 1;
      } else {
        outputs.push(stage1);
        insertedOutputs += 1;
      }
    }

    const sorted = sortOutputs(outputs).slice(0, config.maxStateOutputs);

    await this.writeState({
      version: STATE_VERSION,
      outputs: sorted,
      jobs: {
        lastSessionScanAt: now,
        lastGlobalRebuildAt: now,
      },
    });

    const retained = sorted.slice(0, config.maxRawMemoriesForGlobal);
    if (retained.length === 0) {
      await this.clearArtifacts(artifacts);
    } else {
      await this.rebuildArtifacts(artifacts, retained);
    }

    return {
      enabled: true,
      workspaceRoot: artifacts.memoryRoot.fsPath,
      scannedSessions: sessions.length,
      processedSessions: eligible.length,
      insertedOutputs,
      updatedOutputs,
      retainedOutputs: retained.length,
      skippedRecentSessions,
      skippedPlanOrSubagentSessions,
      skippedNoSignalSessions,
    };
  }

  async dropMemories(workspaceFolder?: vscode.Uri): Promise<MemoryDropResult> {
    const state = await this.readState();
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
    const artifacts = getMemoryArtifacts(this.storageRootUri);
    if (!artifacts) return [];
    const names = await listMarkdownFiles(artifacts.rolloutSummariesDir);
    return names.sort((a, b) => b.localeCompare(a));
  }

  async readMemoryFile(kind: 'summary' | 'memory' | 'raw' | 'rollout', rolloutFile?: string, workspaceFolder?: vscode.Uri): Promise<string | undefined> {
    const artifacts = getMemoryArtifacts(this.storageRootUri);
    if (!artifacts) return undefined;

    if (kind === 'summary') return readTextIfExists(artifacts.memorySummaryFile);
    if (kind === 'memory') return readTextIfExists(artifacts.memoryFile);
    if (kind === 'raw') return readTextIfExists(artifacts.rawMemoriesFile);

    if (!rolloutFile) return undefined;
    const normalized = path.basename(rolloutFile).replace(/\\/g, '/');
    if (!normalized.toLowerCase().endsWith('.md')) return undefined;
    return readTextIfExists(vscode.Uri.joinPath(artifacts.rolloutSummariesDir, normalized));
  }

  private async loadPersistedSessions(): Promise<PersistedSession[]> {
    if (!this.storageRootUri) return [];

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const maxSessions = Math.max(1, cfg.get<number>('sessions.maxSessions', 20) ?? 20);
    const maxSessionBytes = Math.max(1_000, cfg.get<number>('sessions.maxSessionBytes', 2_000_000) ?? 2_000_000);
    const store = new SessionStore<PersistedSession>(this.storageRootUri, {
      maxSessions,
      maxSessionBytes,
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

  private async readState(): Promise<MemoriesState> {
    if (!this.stateUri) {
      return { version: STATE_VERSION, outputs: [] };
    }

    const raw = await readTextIfExists(this.stateUri);
    if (!raw) return { version: STATE_VERSION, outputs: [] };

    try {
      const parsed = JSON.parse(raw) as Partial<MemoriesState>;
      const outputsRaw = Array.isArray(parsed.outputs) ? parsed.outputs : [];
      const outputs: Stage1Output[] = outputsRaw
        .map(item => this.normalizeOutput(item))
        .filter((item): item is Stage1Output => !!item);

      return {
        version: typeof parsed.version === 'number' ? parsed.version : STATE_VERSION,
        outputs: sortOutputs(outputs),
        jobs: parsed.jobs,
      };
    } catch {
      return { version: STATE_VERSION, outputs: [] };
    }
  }

  private normalizeOutput(value: unknown): Stage1Output | undefined {
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
        ? (row.userIntents.filter(item => typeof item === 'string') as string[])
        : [],
      assistantOutcomes: Array.isArray(row.assistantOutcomes)
        ? (row.assistantOutcomes.filter(item => typeof item === 'string') as string[])
        : [],
      filesTouched: Array.isArray(row.filesTouched)
        ? (row.filesTouched.filter(item => typeof item === 'string') as string[])
        : [],
      toolsUsed: Array.isArray(row.toolsUsed)
        ? (row.toolsUsed.filter(item => typeof item === 'string') as string[])
        : [],
    };
  }

  private async writeState(state: MemoriesState): Promise<void> {
    if (!this.stateUri || !this.memoriesRootUri) return;

    await vscode.workspace.fs.createDirectory(this.memoriesRootUri);

    const tmp = vscode.Uri.joinPath(this.memoriesRootUri, `${STAGE1_OUTPUTS_FILE}.tmp-${crypto.randomUUID()}`);
    const bytes = new TextEncoder().encode(JSON.stringify(state, null, 2));
    await vscode.workspace.fs.writeFile(tmp, bytes);
    await vscode.workspace.fs.rename(tmp, this.stateUri, { overwrite: true });
  }

  private async rebuildArtifacts(artifacts: MemoryArtifacts, outputs: Stage1Output[]): Promise<void> {
    await vscode.workspace.fs.createDirectory(artifacts.memoryRoot);
    await vscode.workspace.fs.createDirectory(artifacts.rolloutSummariesDir);

    const keepFiles = new Set(outputs.map(output => path.basename(output.rolloutFile)));
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

  private async clearArtifacts(artifacts: MemoryArtifacts): Promise<void> {
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
}

export async function readMemoryArtifacts(extensionContext: vscode.ExtensionContext): Promise<{
  summary?: string;
  memory?: string;
  raw?: string;
  rollouts: string[];
}> {
  const storageRootUri = extensionContext.storageUri ?? extensionContext.globalStorageUri;
  const artifacts = getMemoryArtifacts(storageRootUri);
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
