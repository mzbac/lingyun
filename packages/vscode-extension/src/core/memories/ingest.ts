import * as path from 'path';

import {
  hasDerivableCodebaseMemoryPayload,
  hasExplicitRememberDerivableMemoryPayload,
  hasGeneratedMemoryArtifactPayload,
  hasRepositoryInstructionPayload,
  hasSkillInstructionPayload,
  isExplicitMemoryCandidate,
  normalizeSessionSignals,
} from '../sessionSignals';

import {
  type MemoryRecord,
  type PersistedChatMessage,
  type PersistedSession,
  type Stage1Output,
  DAY_MS,
  MEMORY_MD_FILENAME,
  MEMORY_SUMMARY_FILENAME,
  MEMORY_TOPICS_DIR_NAME,
  RAW_MEMORIES_FILENAME,
  ROLLOUT_SUMMARIES_DIR_NAME,
  STAGE1_OUTPUTS_FILE,
} from './model';
import { containsMemorySecret, redactMemorySecrets } from './privacy';

function summarizeMessage(content: string | undefined, maxChars = 220): string {
  if (!content) return '';
  const compact = redactMemorySecrets(content).replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trimEnd()}...`;
}

function looksLikeRepositoryInstructionFilePath(value: string | undefined): boolean {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return false;
  return /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/i.test(normalized);
}

function looksLikeSkillInstructionFilePath(value: string | undefined): boolean {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return false;
  return /(?:^|\/)SKILL\.md$/i.test(normalized);
}

function hasMemoryScaffoldingPayload(value: string | undefined): boolean {
  const text = String(value || '');
  return hasRepositoryInstructionPayload(text) || hasSkillInstructionPayload(text);
}

function looksLikeGeneratedMemoryArtifactFilePath(value: string | undefined): boolean {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return false;
  if (new RegExp(`(?:^|/)${MEMORY_MD_FILENAME.replace('.', '\\.')}$`, 'i').test(normalized)) return true;
  if (new RegExp(`(?:^|/)${MEMORY_SUMMARY_FILENAME.replace('.', '\\.')}$`, 'i').test(normalized)) return true;
  if (new RegExp(`(?:^|/)${RAW_MEMORIES_FILENAME.replace('.', '\\.')}$`, 'i').test(normalized)) return true;
  if (new RegExp(`(?:^|/)${STAGE1_OUTPUTS_FILE.replace('.', '\\.')}$`, 'i').test(normalized)) return true;
  if (new RegExp(`(?:^|/)${MEMORY_TOPICS_DIR_NAME}/[^/]+\\.md$`, 'i').test(normalized)) return true;
  if (new RegExp(`(?:^|/)${ROLLOUT_SUMMARIES_DIR_NAME}/[^/]+\\.md$`, 'i').test(normalized)) return true;
  return false;
}

function hasMemorySecretPayload(value: string | undefined): boolean {
  return containsMemorySecret(value);
}

function isMemoryScaffoldingMessage(message: PersistedChatMessage): boolean {
  if (looksLikeRepositoryInstructionFilePath(message.toolCall?.path)) return true;
  if (looksLikeSkillInstructionFilePath(message.toolCall?.path)) return true;
  if (looksLikeGeneratedMemoryArtifactFilePath(message.toolCall?.path)) return true;
  if ((message.toolCall?.batchFiles || []).some((file) => looksLikeGeneratedMemoryArtifactFilePath(file))) return true;
  if (String(message.toolCall?.name || '').trim().toLowerCase() === 'skill') return true;
  if (hasMemoryScaffoldingPayload(message.content)) return true;
  if (hasMemoryScaffoldingPayload(message.toolCall?.result)) return true;
  if (hasGeneratedMemoryArtifactPayload(message.content)) return true;
  if (hasGeneratedMemoryArtifactPayload(message.toolCall?.result)) return true;
  return false;
}

function isSensitiveMemoryMessage(message: PersistedChatMessage): boolean {
  if (hasMemorySecretPayload(message.content)) return true;
  if (hasMemorySecretPayload(message.toolCall?.path)) return true;
  if (hasMemorySecretPayload(message.toolCall?.result)) return true;
  return (message.toolCall?.batchFiles || []).some((file) => hasMemorySecretPayload(file));
}

function filterMemorySignalValues(values: string[], maxItems: number): string[] {
  const next: string[] = [];
  for (const value of values) {
    if (hasMemorySecretPayload(value)) continue;
    if (hasGeneratedMemoryArtifactPayload(value)) continue;
    if (hasDerivableCodebaseMemoryPayload(value)) continue;
    if (hasMemoryScaffoldingPayload(value)) continue;
    if (looksLikeRepositoryInstructionFilePath(value)) continue;
    if (looksLikeSkillInstructionFilePath(value)) continue;
    if (looksLikeGeneratedMemoryArtifactFilePath(value)) continue;
    if (String(value || '').trim().toLowerCase() === 'skill') continue;
    next.push(value);
    if (next.length >= maxItems) break;
  }
  return next;
}

export function uniqueLimited(values: string[], maxItems: number): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (hasMemorySecretPayload(value)) continue;
    if (hasGeneratedMemoryArtifactPayload(value)) continue;
    if (hasDerivableCodebaseMemoryPayload(value)) continue;
    const key = redactMemorySecrets(value).trim();
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
  let value = hash % alphabet.length ** 4;
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out = alphabet[value % alphabet.length] + out;
    value = Math.floor(value / alphabet.length);
  }
  return out;
}

export function deriveWorkspaceMemoryId(workspaceRootPath?: string): string {
  const normalized = String(workspaceRootPath || '')
    .trim()
    .replace(/\\/g, '/');
  if (!normalized) return 'global';
  const base = path.basename(normalized) || 'workspace';
  const slug = slugify(base, 24) || 'workspace';
  return `${slug}-${shortHash(normalized.toLowerCase())}`;
}

export function toIso(ts: number): string {
  return new Date(ts).toISOString();
}

function normalizeChatMessageRole(role: string | undefined): string | undefined {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized || undefined;
}

function formatPersistedMessageForMemory(message: PersistedChatMessage): string {
  if (message.memoryExcluded) return '';
  if (isMemoryScaffoldingMessage(message)) return '';
  if (isSensitiveMemoryMessage(message)) return '';

  const role = normalizeChatMessageRole(message.role);
  if (!role) return '';

  if (role === 'tool') {
    if (typeof message.toolCall?.memoryContextSource === 'string' && message.toolCall.memoryContextSource.trim()) {
      return '';
    }
    const toolName = summarizeMessage(message.toolCall?.name, 80) || 'tool';
    const toolPath = summarizeMessage(message.toolCall?.path, 160);
    const toolResult = summarizeMessage(message.toolCall?.result || message.content, 500);
    if (!toolResult && !toolPath) return '';
    const label = toolPath ? `Tool ${toolName} (${toolPath})` : `Tool ${toolName}`;
    return toolResult ? `${label}: ${toolResult}` : label;
  }

  if (
    role !== 'user' &&
    role !== 'assistant' &&
    role !== 'error' &&
    role !== 'warning' &&
    role !== 'plan'
  ) {
    return '';
  }

  const content = summarizeMessage(message.content, 500);
  if (!content) return '';

  const label =
    role === 'user'
      ? 'User'
      : role === 'assistant'
        ? 'Assistant'
        : role === 'error'
          ? 'Error'
          : role === 'warning'
            ? 'Warning'
            : 'Plan';
  return `${label}: ${content}`;
}

function collectMessageTooling(
  message: PersistedChatMessage,
  filesTouched: Set<string>,
  toolsUsed: Set<string>,
): void {
  if (message.memoryExcluded) return;
  if (isMemoryScaffoldingMessage(message)) return;
  if (isSensitiveMemoryMessage(message)) return;

  if (typeof message.toolCall?.memoryContextSource === 'string' && message.toolCall.memoryContextSource.trim()) {
    return;
  }

  const toolName = redactMemorySecrets(String(message.toolCall?.name || '')).trim();
  if (toolName) {
    toolsUsed.add(toolName);
  }

  const toolPath = redactMemorySecrets(String(message.toolCall?.path || '')).trim();
  if (toolPath) {
    filesTouched.add(toolPath);
  }

  for (const file of Array.isArray(message.toolCall?.batchFiles) ? message.toolCall?.batchFiles || [] : []) {
    const normalized = redactMemorySecrets(String(file || '')).trim();
    if (normalized) {
      filesTouched.add(normalized);
    }
  }
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

function collectSessionSignals(session: PersistedSession, options?: { explicitOnly?: boolean }): {
  userIntents: string[];
  assistantOutcomes: string[];
  filesTouched: string[];
  toolsUsed: string[];
  structuredMemories: Stage1Output['structuredMemories'];
} {
  const normalized = normalizeSessionSignals(session.signals, Date.now());
  const structuredMemories = normalized.structuredMemories
    .filter((item) => !hasMemoryScaffoldingPayload(item.text))
    .filter((item) => !hasGeneratedMemoryArtifactPayload(item.text) && !hasGeneratedMemoryArtifactPayload(item.memoryKey))
    .filter((item) => !hasMemorySecretPayload(item.text) && !hasMemorySecretPayload(item.memoryKey))
    .filter((item) => !hasDerivableCodebaseMemoryPayload(item.text) && !hasDerivableCodebaseMemoryPayload(item.memoryKey))
    .filter((item) => !options?.explicitOnly || isExplicitMemoryCandidate(item))
    .slice(0, 16);

  if (options?.explicitOnly) {
    return {
      userIntents: [],
      assistantOutcomes: [],
      filesTouched: [],
      toolsUsed: [],
      structuredMemories,
    };
  }

  return {
    userIntents: filterMemorySignalValues(normalized.userIntents, 4),
    assistantOutcomes: filterMemorySignalValues(normalized.assistantOutcomes, 4),
    filesTouched: filterMemorySignalValues(normalized.filesTouched, 20),
    toolsUsed: filterMemorySignalValues(normalized.toolsUsed, 8),
    structuredMemories,
  };
}

export function hasSignal(signals: {
  userIntents: string[];
  assistantOutcomes: string[];
  filesTouched: string[];
  toolsUsed: string[];
  structuredMemories?: Stage1Output['structuredMemories'];
}): boolean {
  return (
    signals.userIntents.length > 0 ||
    signals.assistantOutcomes.length > 0 ||
    signals.filesTouched.length > 0 ||
    signals.toolsUsed.length > 0 ||
    (signals.structuredMemories?.length || 0) > 0
  );
}

function classifyStaleness(sourceUpdatedAt: number, now: number): MemoryRecord['staleness'] {
  const ageDays = Math.max(0, (now - sourceUpdatedAt) / DAY_MS);
  if (ageDays >= 60) return 'stale';
  if (ageDays >= 21) return 'aging';
  return 'fresh';
}

function confidenceFromCandidateKind(kind: Stage1Output['structuredMemories'][number]['kind']): number {
  switch (kind) {
    case 'failed_attempt':
      return 0.9;
    case 'decision':
      return 0.88;
    case 'constraint':
      return 0.84;
    case 'preference':
      return 0.9;
    case 'procedure':
      return 0.76;
    default:
      return 0.75;
  }
}

function recordScopeForKind(kind: MemoryRecord['kind']): MemoryRecord['scope'] {
  if (kind === 'episodic') return 'session';
  return 'workspace';
}

function buildMemoryRecordBase(params: {
  sessionId: string;
  workspaceId: string;
  title: string;
  sourceUpdatedAt: number;
  generatedAt: number;
  filesTouched: string[];
  toolsUsed: string[];
  index: number;
  kind: MemoryRecord['kind'];
  text: string;
  id: string;
  scope?: MemoryRecord['scope'];
  confidence?: number;
  evidenceCount?: number;
  signalKind?: MemoryRecord['signalKind'];
  memoryKey?: string;
  turnId?: string;
  sourceTurnIds?: string[];
  prevRecordId?: string;
  nextRecordId?: string;
  supersedesIds?: string[];
  invalidatesIds?: string[];
}): MemoryRecord {
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    kind: params.kind,
    title: redactMemorySecrets(params.title),
    text: redactMemorySecrets(params.text),
    sourceUpdatedAt: params.sourceUpdatedAt,
    generatedAt: params.generatedAt,
    filesTouched: params.filesTouched.map(redactMemorySecrets),
    toolsUsed: params.toolsUsed.map(redactMemorySecrets),
    index: params.index,
    scope: params.scope ?? recordScopeForKind(params.kind),
    confidence: typeof params.confidence === 'number' ? params.confidence : params.kind === 'procedural' ? 0.82 : params.kind === 'semantic' ? 0.8 : 0.72,
    evidenceCount: Math.max(1, params.evidenceCount ?? 1),
    lastConfirmedAt: params.sourceUpdatedAt,
    staleness: classifyStaleness(params.sourceUpdatedAt, params.generatedAt),
    signalKind: params.signalKind,
    memoryKey: params.memoryKey ? redactMemorySecrets(params.memoryKey) : undefined,
    turnId: params.turnId,
    sourceTurnIds: params.sourceTurnIds && params.sourceTurnIds.length > 0 ? [...params.sourceTurnIds] : undefined,
    prevRecordId: params.prevRecordId,
    nextRecordId: params.nextRecordId,
    supersedesIds: params.supersedesIds && params.supersedesIds.length > 0 ? [...params.supersedesIds] : undefined,
    invalidatesIds: params.invalidatesIds && params.invalidatesIds.length > 0 ? [...params.invalidatesIds] : undefined,
  };
}

export function buildStage1Output(params: {
  session: PersistedSession;
  cwd: string;
  generatedAt: number;
  explicitOnly?: boolean;
}): Stage1Output {
  const { session, cwd, generatedAt } = params;
  const signals = collectSessionSignals(session, { explicitOnly: params.explicitOnly });

  const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : generatedAt;
  const title = summarizeMessage(session.title, 140) || 'Untitled session';
  const keyIntent = redactMemorySecrets(signals.userIntents[0] ?? 'No user intent captured.');
  const keyOutcome = redactMemorySecrets(signals.assistantOutcomes[0] ?? 'No assistant outcome captured.');
  const tools = signals.toolsUsed.length > 0 ? signals.toolsUsed.map(redactMemorySecrets).join(', ') : 'none';
  const files = signals.filesTouched.length > 0 ? signals.filesTouched.map(redactMemorySecrets).join(', ') : 'none';
  const structured = signals.structuredMemories.map((item) => ({ ...item, text: redactMemorySecrets(item.text) }));

  const rolloutSlug = slugify(keyIntent || title, 60);
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
    ...(structured.length > 0
      ? ['- Structured memory candidates:', ...structured.map((item) => `  - [${item.kind}] ${item.text}`)]
      : []),
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
    ...(signals.userIntents.length > 0 ? signals.userIntents.map((item) => `- ${item}`) : ['- (none captured)']),
    '',
    '## Outcomes',
    ...(signals.assistantOutcomes.length > 0
      ? signals.assistantOutcomes.map((item) => `- ${item}`)
      : ['- (none captured)']),
    '',
    '## Tooling',
    `- Tools used: ${tools}`,
    `- Files touched: ${files}`,
    '',
    '## Structured Memories',
    ...(structured.length > 0
      ? structured.map(
          (item) =>
            `- [${item.kind}] scope=${item.scope} confidence=${item.confidence.toFixed(2)} source=${item.source}: ${item.text}`,
        )
      : ['- (none captured)']),
  ].join('\n');

  return {
    sessionId: session.id,
    title,
    sourceUpdatedAt: updatedAt,
    generatedAt,
    cwd: redactMemorySecrets(cwd),
    rawMemory: redactMemorySecrets(rawMemory),
    rolloutSummary: redactMemorySecrets(rolloutSummary),
    rolloutSlug: rolloutSlug || undefined,
    ...(params.explicitOnly ? { partial: 'explicit' as const } : {}),
    rolloutFile,
    userIntents: signals.userIntents.map(redactMemorySecrets),
    assistantOutcomes: signals.assistantOutcomes.map(redactMemorySecrets),
    filesTouched: signals.filesTouched.map(redactMemorySecrets),
    toolsUsed: signals.toolsUsed.map(redactMemorySecrets),
    structuredMemories: structured,
  };
}

function buildSemanticMemoryRecord(params: {
  session: PersistedSession;
  stage1: Stage1Output;
  workspaceId: string;
}): MemoryRecord | undefined {
  if (!hasSignal(params.stage1)) return undefined;

  const text = [
    `Session "${params.stage1.title}" updated at ${toIso(params.stage1.sourceUpdatedAt)}.`,
    params.stage1.userIntents.length > 0 ? `User intents: ${params.stage1.userIntents.join(' | ')}` : '',
    params.stage1.assistantOutcomes.length > 0
      ? `Assistant outcomes: ${params.stage1.assistantOutcomes.join(' | ')}`
      : '',
    params.stage1.filesTouched.length > 0 ? `Files touched: ${params.stage1.filesTouched.join(', ')}` : '',
    params.stage1.toolsUsed.length > 0 ? `Tools used: ${params.stage1.toolsUsed.join(', ')}` : '',
    params.stage1.structuredMemories.length > 0
      ? `Structured memory candidates: ${params.stage1.structuredMemories
          .map((item) => `${item.kind}=${item.text}`)
          .join(' | ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return buildMemoryRecordBase({
    id: `${params.session.id}:semantic`,
    workspaceId: params.workspaceId,
    sessionId: params.session.id,
    kind: 'semantic',
    title: params.stage1.title,
    text,
    sourceUpdatedAt: params.stage1.sourceUpdatedAt,
    generatedAt: params.stage1.generatedAt,
    filesTouched: params.stage1.filesTouched,
    toolsUsed: params.stage1.toolsUsed,
    index: 0,
    scope: 'workspace',
    confidence: 0.82,
    evidenceCount: Math.max(1, params.stage1.structuredMemories.length + 1),
    signalKind: 'summary',
    memoryKey: `${params.session.id}:semantic`,
  });
}

function buildProceduralMemoryRecords(params: {
  session: PersistedSession;
  stage1: Stage1Output;
  workspaceId: string;
}): MemoryRecord[] {
  const proceduralCandidates = params.stage1.structuredMemories.filter(
    (candidate) => candidate.kind === 'procedure' || candidate.kind === 'decision' || candidate.kind === 'constraint',
  );
  if (proceduralCandidates.length === 0) return [];

  return proceduralCandidates.map((candidate, index) =>
    buildMemoryRecordBase({
      id: `${params.session.id}:procedural:${String(index).padStart(4, '0')}`,
      workspaceId: params.workspaceId,
      sessionId: params.session.id,
      kind: 'procedural',
      title: `${params.stage1.title} (${candidate.kind})`,
      text: candidate.text,
      sourceUpdatedAt: params.stage1.sourceUpdatedAt,
      generatedAt: params.stage1.generatedAt,
      filesTouched: params.stage1.filesTouched,
      toolsUsed: params.stage1.toolsUsed,
      index: index + 1,
      scope: candidate.scope,
      confidence: candidate.confidence || confidenceFromCandidateKind(candidate.kind),
      evidenceCount: candidate.evidenceCount || 1,
      signalKind: candidate.kind,
      memoryKey: candidate.memoryKey,
      sourceTurnIds: candidate.sourceTurnIds,
    }),
  );
}

function buildTranscriptMemoryRecords(params: {
  session: PersistedSession;
  stage1: Stage1Output;
  workspaceId: string;
}): MemoryRecord[] {
  const messages = Array.isArray(params.session.messages) ? params.session.messages : [];
  if (messages.length === 0) return [];

  const excludedTurnIds = new Set<string>();
  for (const message of messages) {
    if (!message.memoryExcluded && !hasExplicitRememberDerivableMemoryPayload(message.content || '')) continue;
    const id = typeof message.id === 'string' && message.id.trim() ? message.id.trim() : undefined;
    const turnId = typeof message.turnId === 'string' && message.turnId.trim() ? message.turnId.trim() : undefined;
    if (id) excludedTurnIds.add(id);
    if (turnId) excludedTurnIds.add(turnId);
  }

  const turns: Array<{ turnId?: string; lines: string[]; filesTouched: Set<string>; toolsUsed: Set<string> }> = [];
  let current: { turnId?: string; lines: string[]; filesTouched: Set<string>; toolsUsed: Set<string> } | undefined;

  for (const message of messages) {
    const messageId = typeof message.id === 'string' && message.id.trim() ? message.id.trim() : undefined;
    const messageTurnId = typeof message.turnId === 'string' && message.turnId.trim() ? message.turnId.trim() : undefined;
    if (message.memoryExcluded || (messageId && excludedTurnIds.has(messageId)) || (messageTurnId && excludedTurnIds.has(messageTurnId))) {
      continue;
    }

    const line = formatPersistedMessageForMemory(message);
    if (!line) continue;

    const role = normalizeChatMessageRole(message.role);
    const turnId = typeof message.turnId === 'string' && message.turnId.trim() ? message.turnId.trim() : undefined;
    const startsNewTurn =
      !!current &&
      current.lines.length > 0 &&
      (role === 'user' || (!!current.turnId && !!turnId && current.turnId !== turnId));

    if (!current || startsNewTurn) {
      current = {
        turnId,
        lines: [],
        filesTouched: new Set<string>(),
        toolsUsed: new Set<string>(),
      };
      turns.push(current);
    } else if (!current.turnId && turnId) {
      current.turnId = turnId;
    }

    current.lines.push(line);
    collectMessageTooling(message, current.filesTouched, current.toolsUsed);
  }

  const records: MemoryRecord[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const text = turn.lines.join('\n').trim();
    if (!text) continue;

    records.push(
      buildMemoryRecordBase({
        id: `${params.session.id}:turn:${String(index).padStart(4, '0')}`,
        workspaceId: params.workspaceId,
        sessionId: params.session.id,
        kind: 'episodic',
        title: params.stage1.title,
        text,
        sourceUpdatedAt: params.stage1.sourceUpdatedAt,
        generatedAt: params.stage1.generatedAt,
        filesTouched: [...turn.filesTouched],
        toolsUsed: [...turn.toolsUsed],
        index: index + 1,
        signalKind: 'turn',
        turnId: turn.turnId,
        sourceTurnIds: turn.turnId ? [turn.turnId] : undefined,
        confidence: 0.74,
      }),
    );
  }

  for (let i = 0; i < records.length; i += 1) {
    if (i > 0) {
      records[i].prevRecordId = records[i - 1].id;
    }
    if (i < records.length - 1) {
      records[i].nextRecordId = records[i + 1].id;
    }
  }

  return records;
}

export function buildMemoryRecords(params: {
  session: PersistedSession;
  stage1: Stage1Output;
  workspaceId: string;
  includeTranscript?: boolean;
}): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const semantic = buildSemanticMemoryRecord(params);
  if (semantic) {
    records.push(semantic);
  }
  records.push(...buildProceduralMemoryRecords(params));
  if (params.includeTranscript !== false) {
    records.push(...buildTranscriptMemoryRecords(params));
  }
  return records;
}

export function sortOutputs(outputs: Stage1Output[]): Stage1Output[] {
  return [...outputs].sort(
    (a, b) => b.sourceUpdatedAt - a.sourceUpdatedAt || a.sessionId.localeCompare(b.sessionId),
  );
}

export function sortRecords(records: MemoryRecord[]): MemoryRecord[] {
  return [...records].sort(
    (a, b) =>
      b.sourceUpdatedAt - a.sourceUpdatedAt ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.index - b.index,
  );
}

export function renderRawMemories(outputs: Stage1Output[]): string {
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

  return redactMemorySecrets(lines.join('\n'));
}

export function renderMemoryFile(outputs: Stage1Output[]): string {
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
      .flatMap((output) => [
        output.structuredMemories[0]?.text || '',
        output.assistantOutcomes[0] || output.userIntents[0] || '',
      ])
      .filter(Boolean),
    10,
  );

  if (focus.length === 0) {
    lines.push('- No stable context extracted yet.');
  } else {
    for (const item of focus) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('## Structured Memory Candidates');
  const structured = uniqueLimited(
    outputs.flatMap((output) => output.structuredMemories.map((item) => `[${item.kind}] ${item.text}`)),
    16,
  );
  if (structured.length === 0) {
    lines.push('- No structured memories extracted yet.');
  } else {
    for (const item of structured) {
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
    lines.push(`- structured_memory_count: ${output.structuredMemories.length}`);
    lines.push(`- rollout_summary: ${ROLLOUT_SUMMARIES_DIR_NAME}/${output.rolloutFile}`);
    lines.push('');
  }

  return redactMemorySecrets(lines.join('\n'));
}

export function renderMemorySummary(outputs: Stage1Output[]): string {
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
      .flatMap((output) => [
        output.structuredMemories[0]?.text || '',
        output.assistantOutcomes[0] || output.userIntents[0] || '',
      ])
      .filter(Boolean),
    8,
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

  lines.push('## Typed Memory Coverage');
  const structuredCounts = new Map<string, number>();
  for (const output of outputs) {
    for (const item of output.structuredMemories) {
      structuredCounts.set(item.kind, (structuredCounts.get(item.kind) || 0) + 1);
    }
  }
  if (structuredCounts.size === 0) {
    lines.push('- No structured memories captured yet.');
  } else {
    for (const [kind, count] of [...structuredCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      lines.push(`- ${kind}: ${count}`);
    }
  }

  lines.push('');
  lines.push('## Latest Rollouts');
  for (const output of outputs.slice(0, 12)) {
    lines.push(
      `- ${toIso(output.sourceUpdatedAt)} | ${output.title} | ${ROLLOUT_SUMMARIES_DIR_NAME}/${output.rolloutFile}`,
    );
  }

  lines.push('');
  return redactMemorySecrets(lines.join('\n'));
}
