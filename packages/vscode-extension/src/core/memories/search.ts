import * as path from 'path';

import {
  DAY_MS,
  type MemoryRecord,
  type MemoryRecordKind,
  type MemorySearchHit,
  type MemorySearchResult,
} from './model';

type MemoryRecordScore = {
  record: MemoryRecord;
  score: number;
  matchedTerms: string[];
};

function normalizeSearchText(input: string | undefined): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[`"'()[\]{}<>]/g, ' ')
    .replace(/[^\w./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateTokenCount(text: string | undefined): number {
  const value = String(text || '');
  if (!value) return 0;
  return Math.ceil(value.length / 4);
}

function splitSearchTerms(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const rawTerms = normalized
    .split(/\s+/)
    .flatMap((term) => term.split(/[/:._-]+/))
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);

  const next: string[] = [];
  const seen = new Set<string>();
  for (const term of rawTerms) {
    if (seen.has(term)) continue;
    seen.add(term);
    next.push(term);
    if (next.length >= 24) break;
  }
  return next;
}

function scoreMemoryRecord(
  record: MemoryRecord,
  queryTerms: string[],
  now: number,
): MemoryRecordScore | undefined {
  if (queryTerms.length === 0) return undefined;

  const haystack = normalizeSearchText(
    [record.title, record.text, ...record.filesTouched, ...record.toolsUsed].filter(Boolean).join(' '),
  );
  if (!haystack) return undefined;

  const fileHaystack = normalizeSearchText(record.filesTouched.map((file) => path.basename(file)).join(' '));
  const toolHaystack = normalizeSearchText(record.toolsUsed.join(' '));

  let score = 0;
  const matchedTerms: string[] = [];

  for (const term of queryTerms) {
    if (!haystack.includes(term)) continue;
    matchedTerms.push(term);
    score += term.length >= 8 ? 4 : term.length >= 5 ? 3 : 2;
    if (fileHaystack.includes(term)) score += 1.5;
    if (toolHaystack.includes(term)) score += 1;
  }

  if (matchedTerms.length === 0) return undefined;

  score += Math.min(1.5, matchedTerms.length * 0.35);
  score += record.kind === 'procedural' ? 0.75 : record.kind === 'semantic' ? 0.4 : 0;

  const ageDays = Math.max(0, (now - record.sourceUpdatedAt) / DAY_MS);
  score += Math.max(0, 1.5 - Math.log2(ageDays + 1));

  return { record, score, matchedTerms };
}

export function searchMemoryRecords(params: {
  records: MemoryRecord[];
  query: string;
  workspaceId: string;
  kind?: MemoryRecordKind;
  limit: number;
  neighborWindow: number;
  maxTokens?: number;
  now?: number;
}): MemorySearchResult {
  const query = String(params.query || '').trim();
  if (!query) {
    return { query: '', workspaceId: params.workspaceId, hits: [], totalTokens: 0, truncated: false };
  }

  const terms = splitSearchTerms(query);
  if (terms.length === 0) {
    return { query, workspaceId: params.workspaceId, hits: [], totalTokens: 0, truncated: false };
  }

  const candidates = params.records.filter((record) => {
    if (record.workspaceId !== params.workspaceId) return false;
    if (params.kind && record.kind !== params.kind) return false;
    return true;
  });

  const now = params.now ?? Date.now();
  const scored = candidates
    .map((record) => scoreMemoryRecord(record, terms, now))
    .filter((score): score is MemoryRecordScore => !!score)
    .sort((a, b) => b.score - a.score || b.record.sourceUpdatedAt - a.record.sourceUpdatedAt);

  const workspaceRecords = new Map(
    params.records
      .filter((record) => record.workspaceId === params.workspaceId)
      .map((record) => [record.id, record]),
  );
  const selected: MemorySearchHit[] = [];
  const visited = new Set<string>();

  const pushHit = (
    record: MemoryRecord | undefined,
    reason: 'match' | 'neighbor',
    score: number,
    matchedTerms: string[],
  ) => {
    if (!record || visited.has(record.id)) return;
    const nextTokens = estimateTokenCount(record.text);
    if (typeof params.maxTokens === 'number' && selected.length > 0) {
      const currentTokens = selected.reduce((sum, item) => sum + estimateTokenCount(item.record.text), 0);
      if (currentTokens + nextTokens > params.maxTokens) {
        return;
      }
    }
    visited.add(record.id);
    selected.push({ record, reason, score, matchedTerms });
  };

  for (const match of scored.slice(0, params.limit)) {
    pushHit(match.record, 'match', match.score, match.matchedTerms);
    if (params.neighborWindow <= 0) continue;

    let prevId = match.record.prevRecordId;
    for (let distance = 1; distance <= params.neighborWindow; distance += 1) {
      const prev = prevId ? workspaceRecords.get(prevId) : undefined;
      if (!prev) break;
      pushHit(prev, 'neighbor', Math.max(0, match.score - distance * 0.2), match.matchedTerms);
      prevId = prev.prevRecordId;
    }

    let nextId = match.record.nextRecordId;
    for (let distance = 1; distance <= params.neighborWindow; distance += 1) {
      const next = nextId ? workspaceRecords.get(nextId) : undefined;
      if (!next) break;
      pushHit(next, 'neighbor', Math.max(0, match.score - distance * 0.2), match.matchedTerms);
      nextId = next.nextRecordId;
    }
  }

  selected.sort((a, b) => b.score - a.score || b.record.sourceUpdatedAt - a.record.sourceUpdatedAt);
  const totalTokens = selected.reduce((sum, item) => sum + estimateTokenCount(item.record.text), 0);
  const truncated =
    selected.length < Math.min(scored.length, params.limit) ||
    (typeof params.maxTokens === 'number' && totalTokens >= params.maxTokens && scored.length > 0);

  return {
    query,
    workspaceId: params.workspaceId,
    hits: selected,
    totalTokens,
    truncated,
  };
}
