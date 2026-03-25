import * as path from 'path';

import { normalizeSessionSignals } from '../sessionSignals';

import {
  type MemoryRecord,
  type PersistedChatMessage,
  type PersistedSession,
  type Stage1Output,
  ROLLOUT_SUMMARIES_DIR_NAME,
} from './model';

function summarizeMessage(content: string | undefined, maxChars = 220): string {
  if (!content) return '';
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trimEnd()}...`;
}

export function uniqueLimited(values: string[], maxItems: number): string[] {
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
  const role = normalizeChatMessageRole(message.role);
  if (!role) return '';

  if (role === 'tool') {
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
  const toolName = String(message.toolCall?.name || '').trim();
  if (toolName) {
    toolsUsed.add(toolName);
  }

  const toolPath = String(message.toolCall?.path || '').trim();
  if (toolPath) {
    filesTouched.add(toolPath);
  }

  for (const file of Array.isArray(message.toolCall?.batchFiles) ? message.toolCall?.batchFiles || [] : []) {
    const normalized = String(file || '').trim();
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

function collectSessionSignals(session: PersistedSession): {
  userIntents: string[];
  assistantOutcomes: string[];
  filesTouched: string[];
  toolsUsed: string[];
} {
  const normalized = normalizeSessionSignals(session.signals, Date.now());
  return {
    userIntents: normalized.userIntents.slice(0, 4),
    assistantOutcomes: normalized.assistantOutcomes.slice(0, 4),
    filesTouched: normalized.filesTouched.slice(0, 20),
    toolsUsed: normalized.toolsUsed.slice(0, 8),
  };
}

export function hasSignal(signals: {
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

export function buildStage1Output(params: {
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
      ? signals.userIntents.map((item) => `- ${item}`)
      : ['- (none captured)']),
    '',
    '## Outcomes',
    ...(signals.assistantOutcomes.length > 0
      ? signals.assistantOutcomes.map((item) => `- ${item}`)
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

function buildSemanticMemoryRecord(params: {
  session: PersistedSession;
  stage1: Stage1Output;
  workspaceId: string;
}): MemoryRecord | undefined {
  if (!hasSignal(params.stage1)) return undefined;

  const text = [
    `Session "${params.stage1.title}" updated at ${toIso(params.stage1.sourceUpdatedAt)}.`,
    params.stage1.userIntents.length > 0
      ? `User intents: ${params.stage1.userIntents.join(' | ')}`
      : '',
    params.stage1.assistantOutcomes.length > 0
      ? `Assistant outcomes: ${params.stage1.assistantOutcomes.join(' | ')}`
      : '',
    params.stage1.filesTouched.length > 0
      ? `Files touched: ${params.stage1.filesTouched.join(', ')}`
      : '',
    params.stage1.toolsUsed.length > 0
      ? `Tools used: ${params.stage1.toolsUsed.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    id: `${params.session.id}:semantic`,
    workspaceId: params.workspaceId,
    sessionId: params.session.id,
    kind: 'semantic',
    title: params.stage1.title,
    text,
    sourceUpdatedAt: params.stage1.sourceUpdatedAt,
    generatedAt: params.stage1.generatedAt,
    filesTouched: [...params.stage1.filesTouched],
    toolsUsed: [...params.stage1.toolsUsed],
    index: 0,
  };
}

function buildTranscriptMemoryRecords(params: {
  session: PersistedSession;
  stage1: Stage1Output;
  workspaceId: string;
}): MemoryRecord[] {
  const messages = Array.isArray(params.session.messages) ? params.session.messages : [];
  if (messages.length === 0) return [];

  const turns: Array<{ turnId?: string; lines: string[]; filesTouched: Set<string>; toolsUsed: Set<string> }> = [];
  let current: { turnId?: string; lines: string[]; filesTouched: Set<string>; toolsUsed: Set<string> } | undefined;

  for (const message of messages) {
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

    records.push({
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
      ...(turn.turnId ? { turnId: turn.turnId } : {}),
    });
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
}): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const semantic = buildSemanticMemoryRecord(params);
  if (semantic) {
    records.push(semantic);
  }
  records.push(...buildTranscriptMemoryRecords(params));
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

  return lines.join('\n');
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
      .map((output) => output.assistantOutcomes[0] || output.userIntents[0] || '')
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
      .map((output) => output.assistantOutcomes[0] || output.userIntents[0] || '')
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
  lines.push(
    `- Step 3: Open 1-2 relevant rollout summaries from \`${ROLLOUT_SUMMARIES_DIR_NAME}/*.md\` only when needed.`,
  );
  lines.push('');

  lines.push('## Latest Rollouts');
  for (const output of outputs.slice(0, 12)) {
    lines.push(
      `- ${toIso(output.sourceUpdatedAt)} | ${output.title} | ${ROLLOUT_SUMMARIES_DIR_NAME}/${output.rolloutFile}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}
