import * as path from 'path';

import {
  DAY_MS,
  type ConsolidatedMemoryEntry,
  type DurableMemoryCategory,
  type MemoryRecord,
  type MemoryRecordKind,
  type MemoryRecordStaleness,
  type MemorySearchHit,
  type MemorySearchResult,
} from './model';
import { renderMemoryFields, shouldSurfaceSelectiveHowToApply } from './consolidate';
import {
  compareCurrentStateSupportOrder,
  memoryRecordLooksLikeProjectStateSnapshot,
  memoryRecordLooksLikeReferencePointer,
  queryLooksLikeCurrentStateIntent,
  shouldPreferCurrentStateDurablePointerFirst,
} from './currentState';
import { hasMemoryOptOutIntent, type SessionMemoryCandidateScope } from '../sessionSignals';

type MemoryRecordScore = {
  record: MemoryRecord;
  score: number;
  matchedTerms: string[];
  breakdown: NonNullable<MemorySearchHit['scoreBreakdown']>;
};

type DurableEntryScore = {
  entry: ConsolidatedMemoryEntry;
  score: number;
  matchedTerms: string[];
  breakdown: NonNullable<MemorySearchHit['scoreBreakdown']>;
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
    .filter((term) => term.length >= 2);

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

function hasNegativeRecallIntent(query: string): boolean {
  return hasMemoryOptOutIntent(query);
}

function phraseBoostText(text: string, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const haystack = normalizeSearchText(text);
  if (!haystack) return 0;
  if (haystack.includes(normalizedQuery)) return 4.5;

  const queryParts = normalizedQuery.split(/\s+/).filter((part) => part.length >= 3);
  if (queryParts.length >= 2 && haystack.includes(queryParts.slice(0, 2).join(' '))) {
    return 2.5;
  }
  return 0;
}

function queryLooksLikeWhyIntent(query: string): boolean {
  return /\b(?:why|reason|reasons|because|rationale|motivat(?:ion|e|ed|ing)|context)\b/i.test(query);
}

function queryLooksLikeHowToApplyIntent(query: string): boolean {
  return /\b(?:how|apply|when should|when to|where should|use this|default|guidance|policy|rule|follow|handle)\b/i.test(query);
}


function extractCurrentStateSpecificSignals(query: string): string[] {
  const matches = query.match(
    /\b\d{4}-\d{2}-\d{2}\b|\b[A-Za-z][A-Za-z0-9_-]*-\d{2,}\b|https?:\/\/[^\s)]+|\b[a-z0-9.-]+\/[A-Za-z0-9_./:-]+\b/g,
  ) || [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const normalized = normalizeSearchText(match);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function extractCurrentStateSpecificPhrases(query: string): string[] {
  const parts = normalizeSearchText(query)
    .split(/\s+/)
    .filter((part) => part.length >= 3);
  const next: string[] = [];
  const seen = new Set<string>();

  for (let size = 4; size >= 3; size -= 1) {
    for (let index = 0; index + size <= parts.length; index += 1) {
      const phrase = parts.slice(index, index + size).join(' ');
      if (phrase.length < 16 || seen.has(phrase)) continue;
      seen.add(phrase);
      next.push(phrase);
    }
  }

  return next;
}

function hasStrongCurrentStateProjectEvidence(params: {
  text: string;
  query: string;
  file: number;
  tool: number;
}): boolean {
  if (params.file > 0 || params.tool > 0) return true;

  const normalizedText = normalizeSearchText(params.text);
  const specificSignals = extractCurrentStateSpecificSignals(params.query);
  if (specificSignals.some((signal) => normalizedText.includes(signal))) {
    return true;
  }

  const specificPhrases = extractCurrentStateSpecificPhrases(params.query);
  return specificPhrases.some((phrase) => normalizedText.includes(phrase));
}

function shouldSuppressWeakCurrentStateProjectDurableMatch(
  entry: ConsolidatedMemoryEntry,
  query: string,
  queryTerms: string[],
  matchedTerms: string[],
  file: number,
  tool: number,
): boolean {
  if (!queryLooksLikeCurrentStateIntent(query) || entry.category !== 'project') return false;
  return !hasStrongCurrentStateProjectEvidence({
    text: durableScoringText(entry),
    query,
    file,
    tool,
  });
}

function recordLooksLikeProjectStateSnapshot(record: MemoryRecord): boolean {
  const hintText = `${record.title}\n${record.text}\n${record.memoryKey || ''}`;
  if (!memoryRecordLooksLikeProjectStateSnapshot(record)) return false;
  if (record.signalKind === 'summary') return true;
  if (record.signalKind === 'decision' || record.signalKind === 'constraint') return true;
  return /\b\d{4}-\d{2}-\d{2}\b/.test(hintText);
}

function shouldSuppressWeakCurrentStateProjectRecordMatch(
  record: MemoryRecord,
  query: string,
  queryTerms: string[],
  matchedTerms: string[],
  file: number,
  tool: number,
): boolean {
  if (!queryLooksLikeCurrentStateIntent(query) || !recordLooksLikeProjectStateSnapshot(record)) return false;
  return !hasStrongCurrentStateProjectEvidence({
    text: record.text,
    query,
    file,
    tool,
  });
}

function currentStateRawReferenceVsProjectOrder(
  aRecord: MemoryRecord,
  bRecord: MemoryRecord,
  query: string,
): number {
  return compareCurrentStateSupportOrder(
    {
      query,
      isReferencePointer: recordLooksLikeReferencePointer(aRecord),
      isProjectStateLike: recordLooksLikeProjectStateSnapshot(aRecord),
    },
    {
      query,
      isReferencePointer: recordLooksLikeReferencePointer(bRecord),
      isProjectStateLike: recordLooksLikeProjectStateSnapshot(bRecord),
    },
  );
}

function lexicalScore(haystack: string, queryTerms: string[]): { score: number; matchedTerms: string[] } {
  let score = 0;
  const matchedTerms: string[] = [];
  for (const term of queryTerms) {
    if (!haystack.includes(term)) continue;
    matchedTerms.push(term);
    score += term.length >= 8 ? 4.5 : term.length >= 5 ? 3.2 : 1.8;
  }
  if (matchedTerms.length > 0) {
    score += Math.min(1.8, matchedTerms.length * 0.35);
  }
  return { score, matchedTerms };
}

const LOW_SIGNAL_DURABLE_TERMS = new Set([
  'user',
  'users',
  'project',
  'projects',
  'task',
  'tasks',
  'work',
  'working',
  'memory',
  'memories',
  'test',
  'tests',
  'code',
  'file',
  'files',
  'tool',
  'tools',
]);

function hasOnlyLowSignalSingleDurableTerm(queryTerms: string[], matchedTerms: string[]): boolean {
  if (queryTerms.length !== 1 || matchedTerms.length !== 1) return false;
  return LOW_SIGNAL_DURABLE_TERMS.has(matchedTerms[0] || '');
}

function durablePhraseBoost(
  text: string,
  normalizedQuery: string,
  queryTerms: string[],
  matchedTerms: string[],
): number {
  if (hasOnlyLowSignalSingleDurableTerm(queryTerms, matchedTerms)) return 0;
  return phraseBoostText(text, normalizedQuery);
}

type AgingDurableEvidenceMode = 'project' | 'reference';

const LOW_SIGNAL_REFERENCE_TERMS = new Set([
  'board',
  'boards',
  'bug',
  'bugs',
  'channel',
  'channels',
  'context',
  'dashboard',
  'dashboards',
  'detail',
  'details',
  'doc',
  'docs',
  'documentation',
  'external',
  'issue',
  'issues',
  'link',
  'links',
  'page',
  'pages',
  'ticket',
  'tickets',
  'tracker',
  'trackers',
]);

function agingDurableEvidenceMode(entry: ConsolidatedMemoryEntry): AgingDurableEvidenceMode | undefined {
  if (entry.freshness !== 'aging' && entry.freshness !== 'stale') return undefined;
  if (entry.category === 'project') return 'project';
  if (entry.category === 'reference') return 'reference';
  return undefined;
}

function hasStrongAgingProjectEvidence(
  queryTerms: string[],
  matchedTerms: string[],
  phrase: number,
  file: number,
  tool: number,
): boolean {
  if (file > 0 || tool > 0) return true;
  if (matchedTerms.some((term) => /\d/.test(term) || term.length >= 8)) return true;
  if (phrase > 0 && queryTerms.length >= 2) return true;
  if (matchedTerms.length >= 3) return true;
  return false;
}

function hasStrongAgingReferenceEvidence(
  queryTerms: string[],
  matchedTerms: string[],
  phrase: number,
  file: number,
  tool: number,
): boolean {
  if (file > 0 || tool > 0) return true;

  const specificMatchedTerms = matchedTerms.filter((term) => !LOW_SIGNAL_REFERENCE_TERMS.has(term));
  if (specificMatchedTerms.some((term) => /\d/.test(term) || term.length >= 8)) return true;
  if (specificMatchedTerms.length >= 2) return true;
  if (specificMatchedTerms.length >= 1 && matchedTerms.length >= 2) return true;
  if (phrase > 0 && queryTerms.length >= 2) return true;
  if (phrase > 0 && specificMatchedTerms.length > 0) return true;
  return false;
}

function shouldSuppressWeakReferenceMatch(
  _queryTerms: string[],
  matchedTerms: string[],
  _phrase: number,
  file: number,
  tool: number,
): boolean {
  if (file > 0 || tool > 0) return false;
  if (matchedTerms.length === 0) return false;
  return matchedTerms.every((term) => LOW_SIGNAL_REFERENCE_TERMS.has(term));
}

function recordLooksLikeReferencePointer(record: MemoryRecord): boolean {
  return memoryRecordLooksLikeReferencePointer(record);
}

function shouldSuppressWeakAgingDurableMatch(
  entry: ConsolidatedMemoryEntry,
  queryTerms: string[],
  matchedTerms: string[],
  phrase: number,
  file: number,
  tool: number,
): boolean {
  const mode = agingDurableEvidenceMode(entry);
  if (!mode) return false;
  if (mode === 'project') {
    return !hasStrongAgingProjectEvidence(queryTerms, matchedTerms, phrase, file, tool);
  }
  return !hasStrongAgingReferenceEvidence(queryTerms, matchedTerms, phrase, file, tool);
}

function recencyScore(timestamp: number, now: number): number {
  const ageDays = Math.max(0, (now - timestamp) / DAY_MS);
  return Math.max(0, 2.2 - Math.log2(ageDays + 1));
}

function confidenceScore(confidence: number): number {
  return Math.max(0, Math.min(1, confidence)) * 2.4;
}

function evidenceScore(evidenceCount: number): number {
  return Math.min(1.2, Math.log2((evidenceCount || 1) + 1) * 0.65);
}

function kindScore(record: MemoryRecord): number {
  return record.kind === 'procedural' ? 1.6 : record.kind === 'semantic' ? 0.8 : 0.4;
}

function durableCategoryScore(entry: ConsolidatedMemoryEntry): number {
  const weights: Record<DurableMemoryCategory, number> = {
    user: 2.6,
    feedback: 2.4,
    project: 2,
    procedure: 1.9,
    failure_shield: 1.8,
    reference: 1.4,
  };
  return weights[entry.category] + (entry.sources.includes('user') ? 0.25 : 0);
}

function currentStateReferencePointerBoost(
  entry: ConsolidatedMemoryEntry,
  query: string,
  queryTerms: string[],
  matchedTerms: string[],
  phrase: number,
  file: number,
  tool: number,
): number {
  if (entry.category !== 'reference') return 0;
  if (!queryLooksLikeCurrentStateIntent(query)) return 0;
  if (shouldSuppressWeakReferenceMatch(queryTerms, matchedTerms, phrase, file, tool)) return 0;

  let boost = 1.4;
  if (phrase > 0) boost += 0.7;
  if (matchedTerms.length >= 2) boost += 0.45;
  if (file > 0 || tool > 0) boost += 0.35;
  return boost;
}

function currentStateReferenceVsProjectOrder(
  aCategory: DurableMemoryCategory | undefined,
  bCategory: DurableMemoryCategory | undefined,
  query: string,
): number {
  return compareCurrentStateSupportOrder(
    {
      query,
      isReferencePointer: aCategory === 'reference',
      isProjectStateLike: aCategory === 'project',
    },
    {
      query,
      isReferencePointer: bCategory === 'reference',
      isProjectStateLike: bCategory === 'project',
    },
  );
}

function currentStateCandidateOrder(
  a: { type: 'durable'; candidate: DurableEntryScore } | { type: 'record'; candidate: MemoryRecordScore },
  b: { type: 'durable'; candidate: DurableEntryScore } | { type: 'record'; candidate: MemoryRecordScore },
  query: string,
): number {
  return compareCurrentStateSupportOrder(
    {
      query,
      isReferencePointer: a.type === 'durable'
        ? a.candidate.entry.category === 'reference'
        : recordLooksLikeReferencePointer(a.candidate.record),
      isProjectStateLike: a.type === 'durable'
        ? a.candidate.entry.category === 'project'
        : recordLooksLikeProjectStateSnapshot(a.candidate.record),
    },
    {
      query,
      isReferencePointer: b.type === 'durable'
        ? b.candidate.entry.category === 'reference'
        : recordLooksLikeReferencePointer(b.candidate.record),
      isProjectStateLike: b.type === 'durable'
        ? b.candidate.entry.category === 'project'
        : recordLooksLikeProjectStateSnapshot(b.candidate.record),
    },
  );
}

function currentStateHitOrder(
  a: MemorySearchHit,
  b: MemorySearchHit,
  query: string,
): number {
  return compareCurrentStateSupportOrder(
    {
      query,
      isReferencePointer: a.source === 'durable'
        ? a.durableEntry?.category === 'reference'
        : recordLooksLikeReferencePointer(a.record),
      isProjectStateLike: a.source === 'durable'
        ? a.durableEntry?.category === 'project'
        : recordLooksLikeProjectStateSnapshot(a.record),
    },
    {
      query,
      isReferencePointer: b.source === 'durable'
        ? b.durableEntry?.category === 'reference'
        : recordLooksLikeReferencePointer(b.record),
      isProjectStateLike: b.source === 'durable'
        ? b.durableEntry?.category === 'project'
        : recordLooksLikeProjectStateSnapshot(b.record),
    },
  );
}

function freshnessPenalty(staleness: MemoryRecordStaleness): number {
  if (staleness === 'invalidated') return 100;
  if (staleness === 'stale') return 2.2;
  if (staleness === 'aging') return 0.8;
  return 0;
}

function contradictionPenalty(record: MemoryRecord, queryTerms: string[]): number {
  if (!record.invalidatesIds || record.invalidatesIds.length === 0) return 0;
  if (!queryTerms.some((term) => normalizeSearchText(record.text).includes(term))) return 0;
  return 0.25;
}

function scoreMemoryRecord(
  record: MemoryRecord,
  query: string,
  queryTerms: string[],
  normalizedQuery: string,
  now: number,
): MemoryRecordScore | undefined {
  if (queryTerms.length === 0) return undefined;
  if (record.staleness === 'invalidated') return undefined;

  const haystack = normalizeSearchText(
    [record.title, record.text, ...record.filesTouched, ...record.toolsUsed, ...(record.sourceTurnIds || [])]
      .filter(Boolean)
      .join(' '),
  );
  if (!haystack) return undefined;

  const fileHaystack = normalizeSearchText(record.filesTouched.map((file) => path.basename(file)).join(' '));
  const toolHaystack = normalizeSearchText(record.toolsUsed.join(' '));
  const lexical = lexicalScore(haystack, queryTerms);
  const phrase = phraseBoostText(record.text, normalizedQuery);
  const file = lexical.matchedTerms.some((term) => fileHaystack.includes(term)) ? 1.8 : 0;
  const tool = lexical.matchedTerms.some((term) => toolHaystack.includes(term)) ? 1.2 : 0;
  const recency = recencyScore(record.lastConfirmedAt, now);
  const confidence = confidenceScore(record.confidence);
  const evidence = evidenceScore(record.evidenceCount || 1);
  const kind = kindScore(record);
  const freshnessPenaltyValue = freshnessPenalty(record.staleness) + contradictionPenalty(record, queryTerms);

  const score = lexical.score + phrase + file + tool + recency + confidence + evidence + kind - freshnessPenaltyValue;
  if (lexical.matchedTerms.length === 0 && phrase <= 0) return undefined;
  if (recordLooksLikeReferencePointer(record) && shouldSuppressWeakReferenceMatch(queryTerms, lexical.matchedTerms, phrase, file, tool)) {
    return undefined;
  }
  if (shouldSuppressWeakCurrentStateProjectRecordMatch(record, query, queryTerms, lexical.matchedTerms, file, tool)) {
    return undefined;
  }
  if (score <= 0) return undefined;

  return {
    record,
    score,
    matchedTerms: lexical.matchedTerms,
    breakdown: {
      lexical: lexical.score,
      phrase,
      file,
      tool,
      recency,
      confidence,
      evidence,
      kind,
      freshnessPenalty: freshnessPenaltyValue,
    },
  };
}

function durableSearchText(entry: ConsolidatedMemoryEntry): string {
  const fields = renderMemoryFields(entry);
  return [
    fields.guidance,
    fields.why ? `Why: ${fields.why}` : '',
    shouldSurfaceSelectiveHowToApply(entry, fields) ? `How to apply: ${fields.howToApply}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function durableScoringText(entry: ConsolidatedMemoryEntry): string {
  const fields = renderMemoryFields(entry);
  return [fields.guidance, fields.why, fields.howToApplySource === 'explicit' ? fields.howToApply : '']
    .filter(Boolean)
    .join('\n');
}

function durableSearchHaystack(entry: ConsolidatedMemoryEntry): string {
  const fields = renderMemoryFields(entry);
  return normalizeSearchText(
    [
      fields.guidance,
      fields.why,
      fields.howToApplySource === 'explicit' ? fields.howToApply : '',
      ...entry.titles,
      ...entry.filesTouched,
      ...entry.toolsUsed,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function durableIntentFieldBoost(entry: ConsolidatedMemoryEntry, query: string, queryTerms: string[]): number {
  const fields = renderMemoryFields(entry);
  let boost = 0;

  if (queryLooksLikeWhyIntent(query) && fields.why) {
    const whyHaystack = normalizeSearchText(fields.why);
    const whyMatches = lexicalScore(whyHaystack, queryTerms).matchedTerms.length;
    boost += whyMatches > 0 ? 2.2 + Math.min(1.2, whyMatches * 0.35) : 0.8;
  }

  if (queryLooksLikeHowToApplyIntent(query) && shouldSurfaceSelectiveHowToApply(entry, fields) && fields.howToApply) {
    const howHaystack = normalizeSearchText(fields.howToApply);
    const howMatches = lexicalScore(howHaystack, queryTerms).matchedTerms.length;
    boost += howMatches > 0 ? 2.4 + Math.min(1.4, howMatches * 0.4) : 1.1;
  }

  return boost;
}

function scoreDurableEntry(
  entry: ConsolidatedMemoryEntry,
  query: string,
  queryTerms: string[],
  normalizedQuery: string,
  now: number,
): DurableEntryScore | undefined {
  if (queryTerms.length === 0) return undefined;
  if (entry.freshness === 'invalidated') return undefined;

  const searchableText = durableScoringText(entry);
  const haystack = durableSearchHaystack(entry);
  if (!haystack) return undefined;

  const fileHaystack = normalizeSearchText(entry.filesTouched.map((file) => path.basename(file)).join(' '));
  const toolHaystack = normalizeSearchText(entry.toolsUsed.join(' '));
  const lexical = lexicalScore(haystack, queryTerms);
  const phrase = durablePhraseBoost(searchableText, normalizedQuery, queryTerms, lexical.matchedTerms);
  const file = lexical.matchedTerms.some((term) => fileHaystack.includes(term)) ? 1.6 : 0;
  const tool = lexical.matchedTerms.some((term) => toolHaystack.includes(term)) ? 1 : 0;
  const intentField = durableIntentFieldBoost(entry, query, queryTerms);
  const currentStatePointer = currentStateReferencePointerBoost(
    entry,
    query,
    queryTerms,
    lexical.matchedTerms,
    phrase,
    file,
    tool,
  );
  const recency = recencyScore(entry.lastConfirmedAt, now);
  const confidence = confidenceScore(entry.confidence);
  const evidence = evidenceScore(entry.evidenceCount || 1);
  const kind = durableCategoryScore(entry);
  const freshnessPenaltyValue = freshnessPenalty(entry.freshness);

  const score = lexical.score + phrase + file + tool + intentField + currentStatePointer + recency + confidence + evidence + kind - freshnessPenaltyValue;
  const onlyLowSignalSingleTerm = hasOnlyLowSignalSingleDurableTerm(queryTerms, lexical.matchedTerms);
  if (lexical.matchedTerms.length === 0 && phrase <= 0) return undefined;
  if (onlyLowSignalSingleTerm && phrase <= 0 && file <= 0 && tool <= 0) return undefined;
  if (entry.category === 'reference' && shouldSuppressWeakReferenceMatch(queryTerms, lexical.matchedTerms, phrase, file, tool)) {
    return undefined;
  }
  if (shouldSuppressWeakAgingDurableMatch(entry, queryTerms, lexical.matchedTerms, phrase, file, tool)) return undefined;
  if (shouldSuppressWeakCurrentStateProjectDurableMatch(entry, query, queryTerms, lexical.matchedTerms, file, tool)) {
    return undefined;
  }
  if (score <= 0) return undefined;

  return {
    entry,
    score,
    matchedTerms: lexical.matchedTerms,
      breakdown: {
        lexical: lexical.score + intentField + currentStatePointer,
        phrase,
        file,
        tool,
        recency,
        confidence,
        evidence,
        kind,
        freshnessPenalty: freshnessPenaltyValue,
      },

  };
}

function supportRecordFallbackScore(record: MemoryRecord, now: number): number {
  const typeWeight = record.kind === 'semantic' ? 2.2 : record.kind === 'procedural' ? 1.6 : 0.6;
  return typeWeight + recencyScore(record.lastConfirmedAt, now) + confidenceScore(record.confidence) + evidenceScore(record.evidenceCount || 1);
}

function selectSupportRecord(
  entry: ConsolidatedMemoryEntry,
  records: MemoryRecord[],
  query: string,
  queryTerms: string[],
  normalizedQuery: string,
  now: number,
): MemoryRecord | undefined {
  const direct = records.filter(
    (record) => String(record.memoryKey || '').trim() === entry.key && record.staleness !== 'invalidated',
  );
  const sameSession = records.filter(
    (record) => entry.sessionIds.includes(record.sessionId) && record.staleness !== 'invalidated',
  );
  const usingSameSessionFallback = direct.length === 0;
  const candidates = usingSameSessionFallback ? [...new Map(sameSession.map((record) => [record.id, record])).values()] : direct;
  if (candidates.length === 0) return undefined;

  return [...candidates].sort((a, b) => {
    const aSummaryPenalty = usingSameSessionFallback && a.signalKind === 'summary' ? 1 : 0;
    const bSummaryPenalty = usingSameSessionFallback && b.signalKind === 'summary' ? 1 : 0;
    const aReferenceNovelty = referenceEvidenceNoveltyCount(a, entry);
    const bReferenceNovelty = referenceEvidenceNoveltyCount(b, entry);
    const aScore = scoreMemoryRecord(a, query, queryTerms, normalizedQuery, now)?.score ?? supportRecordFallbackScore(a, now);
    const bScore = scoreMemoryRecord(b, query, queryTerms, normalizedQuery, now)?.score ?? supportRecordFallbackScore(b, now);
    return (
      aSummaryPenalty - bSummaryPenalty ||
      aReferenceNovelty - bReferenceNovelty ||
      bScore - aScore ||
      b.lastConfirmedAt - a.lastConfirmedAt ||
      a.index - b.index
    );
  })[0];
}

function defaultPerKindLimit(limit: number): number {
  return Math.max(1, Math.ceil(limit / 2));
}

function hitText(hit: MemorySearchHit): string {
  return hit.durableEntry ? durableSearchText(hit.durableEntry) : hit.record.text;
}

function hitTimestamp(hit: MemorySearchHit): number {
  return hit.durableEntry?.lastConfirmedAt ?? hit.record.lastConfirmedAt;
}

function hitClusterKey(hit: MemorySearchHit): string {
  return String(hit.durableEntry?.key || hit.record.memoryKey || '').trim();
}

function extractReferenceEvidenceTokens(text: string): string[] {
  const value = String(text || '');
  if (!value.trim()) return [];
  const matches = value.match(
    /https?:\/\/[^\s)]+|\b[a-z0-9.-]+\/[A-Za-z0-9_./:-]+\b|\b[A-Z][A-Z0-9]{2,}\b|\b[A-Za-z][A-Za-z0-9_-]*-[0-9]{2,}\b/g,
  ) || [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const normalized = match.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function durableSupportEvidenceText(entry: ConsolidatedMemoryEntry): string {
  return entry.category === 'reference' ? `${durableSearchText(entry)}\n${entry.rolloutFiles.join('\n')}` : durableSearchText(entry);
}

function referenceEvidenceNoveltyCount(record: MemoryRecord, durableEntry: ConsolidatedMemoryEntry): number {
  if (durableEntry.category !== 'reference') return 0;
  const durableTokens = new Set(extractReferenceEvidenceTokens(durableSupportEvidenceText(durableEntry)));
  const rawTokens = extractReferenceEvidenceTokens(record.text);
  return rawTokens.filter((token) => !durableTokens.has(token)).length;
}

function rawRecordAddsDistinctReferenceEvidence(record: MemoryRecord, durableEntry: ConsolidatedMemoryEntry): boolean {
  return referenceEvidenceNoveltyCount(record, durableEntry) > 0;
}

function rawRecordSupportsDurableReference(
  record: MemoryRecord,
  durableHit: MemorySearchHit,
  matchedTerms: string[],
): boolean {
  if (!durableHit.durableEntry || durableHit.durableEntry.category !== 'reference') return false;
  if (!rawRecordAddsDistinctReferenceEvidence(record, durableHit.durableEntry)) return false;

  const durableMatchedTerms = new Set((durableHit.matchedTerms || []).map((term) => String(term || '').toLowerCase()));
  return matchedTerms.some((term) => {
    const normalized = String(term || '').toLowerCase();
    return durableMatchedTerms.has(normalized) && !LOW_SIGNAL_REFERENCE_TERMS.has(normalized);
  });
}

function summaryRecordAddsDistinctSupport(
  record: MemoryRecord,
  durableEntry: ConsolidatedMemoryEntry,
): boolean {
  const durableFiles = new Set((durableEntry.filesTouched || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  if (
    record.filesTouched.some((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized && !durableFiles.has(normalized);
    })
  ) {
    return true;
  }

  const durableTools = new Set((durableEntry.toolsUsed || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  if (
    record.toolsUsed.some((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized && !durableTools.has(normalized);
    })
  ) {
    return true;
  }

  if (durableEntry.category === 'reference' && rawRecordAddsDistinctReferenceEvidence(record, durableEntry)) {
    return true;
  }

  return false;
}

function summaryRecordIsRedundantToDurable(
  record: MemoryRecord,
  candidate: DurableEntryScore,
): boolean {
  if (record.signalKind !== 'summary') return false;
  const recordMemoryKey = String(record.memoryKey || '').trim();
  const sameDurableCluster = recordMemoryKey && recordMemoryKey === candidate.entry.key;
  const sameContributingSession = candidate.entry.sessionIds.includes(record.sessionId);
  if (!sameDurableCluster && !sameContributingSession) return false;
  return !summaryRecordAddsDistinctSupport(record, candidate.entry);
}

function summaryRecordAddsDistinctRawSupport(summaryRecord: MemoryRecord, otherRecord: MemoryRecord): boolean {
  const otherFiles = new Set((otherRecord.filesTouched || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  if (
    summaryRecord.filesTouched.some((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized && !otherFiles.has(normalized);
    })
  ) {
    return true;
  }

  const otherTools = new Set((otherRecord.toolsUsed || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  if (
    summaryRecord.toolsUsed.some((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized && !otherTools.has(normalized);
    })
  ) {
    return true;
  }

  const otherReferenceTokens = new Set(extractReferenceEvidenceTokens(otherRecord.text));
  if (extractReferenceEvidenceTokens(summaryRecord.text).some((token) => !otherReferenceTokens.has(token))) {
    return true;
  }

  return false;
}

function summaryRecordIsRedundantToRaw(summaryCandidate: MemoryRecordScore, otherCandidate: MemoryRecordScore): boolean {
  if (summaryCandidate.record.signalKind !== 'summary') return false;
  if (summaryCandidate.record.id === otherCandidate.record.id) return false;
  if (summaryCandidate.record.sessionId !== otherCandidate.record.sessionId) return false;
  if (otherCandidate.record.signalKind === 'summary') return false;
  return !summaryRecordAddsDistinctRawSupport(summaryCandidate.record, otherCandidate.record);
}

export function searchMemoryRecords(params: {
  records: MemoryRecord[];
  durableEntries?: ConsolidatedMemoryEntry[];
  query: string;
  workspaceId: string;
  kind?: MemoryRecordKind;
  scope?: SessionMemoryCandidateScope;
  limit: number;
  neighborWindow: number;
  maxTokens?: number;
  maxResultsPerKind?: number;
  now?: number;
  preferDurableFirst?: boolean;
}): MemorySearchResult {
  const query = String(params.query || '').trim();
  if (!query || hasNegativeRecallIntent(query)) {
    return { query, workspaceId: params.workspaceId, hits: [], totalTokens: 0, truncated: false };
  }

  const normalizedQuery = normalizeSearchText(query);
  const terms = splitSearchTerms(query);
  if (terms.length === 0) {
    return { query, workspaceId: params.workspaceId, hits: [], totalTokens: 0, truncated: false };
  }

  const now = params.now ?? Date.now();
  const workspaceRecords = params.records.filter((record) => record.workspaceId === params.workspaceId);
  const rawCandidates = workspaceRecords.filter((record) => {
    if (params.kind && record.kind !== params.kind) return false;
    if (params.scope && record.scope !== params.scope) return false;
    if (record.staleness === 'invalidated') return false;
    return true;
  });

  const rawMatches = rawCandidates
    .map((record) => scoreMemoryRecord(record, query, terms, normalizedQuery, now))
    .filter((score): score is MemoryRecordScore => !!score);

  const durableMatches = params.kind
    ? []
    : (params.durableEntries || [])
        .filter((entry) => !params.scope || entry.scope === params.scope)
        .map((entry) => scoreDurableEntry(entry, query, terms, normalizedQuery, now))
        .filter((score): score is DurableEntryScore => !!score);

  const filteredRawMatches = rawMatches.filter((candidate) => {
    if (candidate.record.signalKind !== 'summary') return true;
    if (durableMatches.some((durableCandidate) => summaryRecordIsRedundantToDurable(candidate.record, durableCandidate))) {
      return false;
    }
    return !rawMatches.some((otherCandidate) => summaryRecordIsRedundantToRaw(candidate, otherCandidate));
  });

  const isCurrentStateQuery = queryLooksLikeCurrentStateIntent(query);
  const preferDurableFirst = params.preferDurableFirst === true && durableMatches.length > 0;
  const preferCurrentStateDurablePointerFirst = shouldPreferCurrentStateDurablePointerFirst({
    query,
    hasDurableReferencePointer: durableMatches.some((candidate) => candidate.entry.category === 'reference'),
  });


  const combined = [
    ...durableMatches.map((candidate) => ({ type: 'durable' as const, candidate })),
    ...filteredRawMatches.map((candidate) => ({ type: 'record' as const, candidate })),
  ].sort((a, b) => {
    if (a.type !== b.type) {
      const durableCandidate = a.type === 'durable' ? a.candidate : b.type === 'durable' ? b.candidate : undefined;
      const rawCandidate = a.type === 'record' ? a.candidate : b.type === 'record' ? b.candidate : undefined;
      const rawKey = String(rawCandidate?.record.memoryKey || '').trim();
      if (durableCandidate && rawKey && rawKey === durableCandidate.entry.key) {
        return a.type === 'durable' ? -1 : 1;
      }
    }
    const allowCrossTypeCurrentStatePointerOrder = isCurrentStateQuery && !preferCurrentStateDurablePointerFirst;
    if (allowCrossTypeCurrentStatePointerOrder) {
      const currentStateOrder = currentStateCandidateOrder(a, b, query);
      if (currentStateOrder !== 0) return currentStateOrder;
    }
    if ((preferCurrentStateDurablePointerFirst || preferDurableFirst) && a.type !== b.type) {
      return a.type === 'durable' ? -1 : 1;
    }
    if (a.type === 'durable' && b.type === 'durable') {
      const currentStateCategoryOrder = currentStateReferenceVsProjectOrder(
        a.candidate.entry.category,
        b.candidate.entry.category,
        query,
      );
      if (currentStateCategoryOrder !== 0) return currentStateCategoryOrder;
    }
    if (a.type === 'record' && b.type === 'record') {
      const currentStateRecordOrder = currentStateRawReferenceVsProjectOrder(
        a.candidate.record,
        b.candidate.record,
        query,
      );
      if (currentStateRecordOrder !== 0) return currentStateRecordOrder;
    }
    const scoreDiff = b.candidate.score - a.candidate.score;
    if (scoreDiff !== 0) return scoreDiff;
    if (a.type !== b.type) return a.type === 'durable' ? -1 : 1;
    const aTime = a.type === 'durable' ? a.candidate.entry.lastConfirmedAt : a.candidate.record.sourceUpdatedAt;
    const bTime = b.type === 'durable' ? b.candidate.entry.lastConfirmedAt : b.candidate.record.sourceUpdatedAt;
    return bTime - aTime;
  });

  const selected: MemorySearchHit[] = [];
  const visitedRecordIds = new Set<string>();
  const visitedDurableKeys = new Set<string>();
  const coveredDurableKeys = new Set<string>();
  const seenSessionTurn = new Set<string>();
  const kindCounts = new Map<MemoryRecordKind, number>();
  const workspaceRecordMap = new Map(workspaceRecords.map((record) => [record.id, record]));
  const maxResultsPerKind = Math.max(1, params.maxResultsPerKind ?? defaultPerKindLimit(params.limit));
  let totalTokens = 0;
  let matchCount = 0;

  const canAddText = (text: string): boolean => {
    const nextTokens = estimateTokenCount(text);
    if (typeof params.maxTokens !== 'number' || selected.length === 0) return true;
    return totalTokens + nextTokens <= params.maxTokens;
  };

  const addHit = (hit: MemorySearchHit) => {
    selected.push(hit);
    totalTokens += estimateTokenCount(hitText(hit));
  };

  const pushRawHit = (
    record: MemoryRecord | undefined,
    reason: 'match' | 'neighbor',
    score: number,
    matchedTerms: string[],
    scoreBreakdown?: MemoryRecordScore['breakdown'],
  ) => {
    if (!record || visitedRecordIds.has(record.id)) return;
    const durableKey = String(record.memoryKey || '').trim();
    const coveredDurableHit =
      reason === 'match'
        ? durableKey
          ? selected.find((hit) => hit.source === 'durable' && hit.durableEntry?.key === durableKey)
          : selected.find((hit) => hit.source === 'durable' && rawRecordSupportsDurableReference(record, hit, matchedTerms))
        : undefined;
    if (
      coveredDurableHit &&
      (!coveredDurableHit.durableEntry || !rawRecordSupportsDurableReference(record, coveredDurableHit, matchedTerms))
    ) {
      return;
    }
    const turnDedupeKey = `${record.sessionId}:${record.turnId || record.index}`;
    if (reason === 'match') {
      const countForKind = kindCounts.get(record.kind) || 0;
      if (countForKind >= maxResultsPerKind) return;
      if (seenSessionTurn.has(turnDedupeKey) && record.kind === 'episodic') return;
    }
    if (!canAddText(record.text)) return;

    visitedRecordIds.add(record.id);
    if (reason === 'match') {
      seenSessionTurn.add(turnDedupeKey);
      kindCounts.set(record.kind, (kindCounts.get(record.kind) || 0) + 1);
      matchCount += 1;
    }
    addHit({ record, source: 'record', reason, score, matchedTerms, ...(scoreBreakdown ? { scoreBreakdown } : {}) });
  };

  const pushDurableHit = (candidate: DurableEntryScore) => {
    const supportRecord = selectSupportRecord(candidate.entry, workspaceRecords, query, terms, normalizedQuery, now);
    if (!supportRecord) return;
    if (visitedDurableKeys.has(candidate.entry.key) || visitedRecordIds.has(supportRecord.id)) return;
    const durableText = durableSearchText(candidate.entry);
    if (!canAddText(durableText)) return;

    visitedDurableKeys.add(candidate.entry.key);
    coveredDurableKeys.add(candidate.entry.key);
    visitedRecordIds.add(supportRecord.id);
    matchCount += 1;
    addHit({
      record: supportRecord,
      source: 'durable',
      durableEntry: candidate.entry,
      reason: 'match',
      score: candidate.score,
      matchedTerms: candidate.matchedTerms,
      scoreBreakdown: candidate.breakdown,
    });
  };

  for (const item of combined) {
    if (matchCount >= params.limit) break;
    if (item.type === 'durable') {
      pushDurableHit(item.candidate);
      continue;
    }

    pushRawHit(item.candidate.record, 'match', item.candidate.score, item.candidate.matchedTerms, item.candidate.breakdown);
    if (params.neighborWindow <= 0) continue;

    let prevId = item.candidate.record.prevRecordId;
    for (let distance = 1; distance <= params.neighborWindow; distance += 1) {
      const prev = prevId ? workspaceRecordMap.get(prevId) : undefined;
      if (!prev) break;
      pushRawHit(prev, 'neighbor', Math.max(0, item.candidate.score - distance * 0.3), item.candidate.matchedTerms, item.candidate.breakdown);
      prevId = prev.prevRecordId;
    }

    let nextId = item.candidate.record.nextRecordId;
    for (let distance = 1; distance <= params.neighborWindow; distance += 1) {
      const next = nextId ? workspaceRecordMap.get(nextId) : undefined;
      if (!next) break;
      pushRawHit(next, 'neighbor', Math.max(0, item.candidate.score - distance * 0.3), item.candidate.matchedTerms, item.candidate.breakdown);
      nextId = next.nextRecordId;
    }
  }

  selected.sort((a, b) => {
    const allowCrossTypeCurrentStatePointerOrder = isCurrentStateQuery && !preferCurrentStateDurablePointerFirst;
    if (allowCrossTypeCurrentStatePointerOrder) {
      const currentStateOrder = currentStateHitOrder(a, b, query);
      if (currentStateOrder !== 0) return currentStateOrder;
    }
    if ((preferCurrentStateDurablePointerFirst || preferDurableFirst) && a.source !== b.source) {
      return a.source === 'durable' ? -1 : 1;
    }
    if (a.source === 'durable' && b.source === 'durable') {
      const currentStateCategoryOrder = currentStateReferenceVsProjectOrder(
        a.durableEntry?.category,
        b.durableEntry?.category,
        query,
      );
      if (currentStateCategoryOrder !== 0) return currentStateCategoryOrder;
    }
    if (a.source !== 'durable' && b.source !== 'durable') {
      const currentStateRecordOrder = currentStateRawReferenceVsProjectOrder(
        a.record,
        b.record,
        query,
      );
      if (currentStateRecordOrder !== 0) return currentStateRecordOrder;
    }
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) {
      const sameCluster = hitClusterKey(a) && hitClusterKey(a) === hitClusterKey(b);
      if (sameCluster && a.source !== b.source) {
        return a.source === 'durable' ? -1 : 1;
      }
      return scoreDiff;
    }
    if (a.source !== b.source) return a.source === 'durable' ? -1 : 1;
    return hitTimestamp(b) - hitTimestamp(a);
  });
  const truncated =
    matchCount < Math.min(combined.length, params.limit) ||
    (typeof params.maxTokens === 'number' && totalTokens >= params.maxTokens && combined.length > 0);

  return {
    query,
    workspaceId: params.workspaceId,
    hits: selected,
    totalTokens,
    truncated,
  };
}
