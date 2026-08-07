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

type SearchCandidate =
  | { type: 'durable'; candidate: DurableEntryScore }
  | { type: 'record'; candidate: MemoryRecordScore };

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

  const next: string[] = [];
  const seen = new Set<string>();

  let termStart = -1;
  for (let i = 0; i <= normalized.length; i++) {
    const char = i < normalized.length ? normalized.charCodeAt(i) : 32;
    const isBoundary =
      char === 32 || char === 47 || char === 58 || char === 46 || char === 95 || char === 45;

    if (!isBoundary) {
      if (termStart < 0) termStart = i;
      continue;
    }
    if (termStart < 0) continue;

    const term = normalized.slice(termStart, i);
    termStart = -1;
    if (term.length < 2) continue;
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

function firstTwoLongQueryTermsPhrase(normalizedQuery: string): string {
  let first = '';
  let second = '';
  let termStart = -1;

  for (let i = 0; i <= normalizedQuery.length; i++) {
    const char = i < normalizedQuery.length ? normalizedQuery.charCodeAt(i) : 32;
    if (char !== 32) {
      if (termStart === -1) termStart = i;
      continue;
    }
    if (termStart === -1) continue;

    if (i - termStart >= 3) {
      if (!first) {
        first = normalizedQuery.slice(termStart, i);
      } else {
        second = normalizedQuery.slice(termStart, i);
        break;
      }
    }
    termStart = -1;
  }

  return first && second ? `${first} ${second}` : '';
}

function phraseBoostText(text: string, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const haystack = normalizeSearchText(text);
  if (!haystack) return 0;
  if (haystack.includes(normalizedQuery)) return 4.5;

  const leadingPhrase = firstTwoLongQueryTermsPhrase(normalizedQuery);
  if (leadingPhrase && haystack.includes(leadingPhrase)) {
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

function collectCurrentStateSpecificPhraseTerms(query: string): string[] {
  const normalized = normalizeSearchText(query);
  const terms: string[] = [];
  let termStart = -1;

  for (let i = 0; i <= normalized.length; i++) {
    const char = i < normalized.length ? normalized.charCodeAt(i) : 32;
    if (char !== 32) {
      if (termStart < 0) termStart = i;
      continue;
    }
    if (termStart < 0) continue;

    if (i - termStart >= 3) {
      terms.push(normalized.slice(termStart, i));
    }
    termStart = -1;
  }

  return terms;
}

function currentStatePhraseFromTerms(terms: string[], startIndex: number, size: number): string {
  let phrase = '';
  for (let index = startIndex; index < startIndex + size; index += 1) {
    const term = terms[index] || '';
    if (!term) continue;
    phrase = phrase ? `${phrase} ${term}` : term;
  }
  return phrase;
}

function extractCurrentStateSpecificPhrases(query: string): string[] {
  const terms = collectCurrentStateSpecificPhraseTerms(query);
  const phrases: string[] = [];
  const seen = new Set<string>();

  for (let size = 4; size >= 3; size -= 1) {
    for (let index = 0; index + size <= terms.length; index += 1) {
      const phrase = currentStatePhraseFromTerms(terms, index, size);
      if (phrase.length < 16 || seen.has(phrase)) continue;
      seen.add(phrase);
      phrases.push(phrase);
    }
  }

  return phrases;
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
  if (haystackContainsAnyTerm(normalizedText, specificSignals)) {
    return true;
  }

  const specificPhrases = extractCurrentStateSpecificPhrases(params.query);
  return haystackContainsAnyTerm(normalizedText, specificPhrases);
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
  for (const term of matchedTerms) {
    if (/\d/.test(term) || term.length >= 8) return true;
  }
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

  let specificMatchedTermCount = 0;
  let hasSpecificDigitOrLongTerm = false;
  for (const term of matchedTerms) {
    if (LOW_SIGNAL_REFERENCE_TERMS.has(term)) continue;
    specificMatchedTermCount++;
    if (/\d/.test(term) || term.length >= 8) {
      hasSpecificDigitOrLongTerm = true;
    }
  }
  if (hasSpecificDigitOrLongTerm) return true;
  if (specificMatchedTermCount >= 2) return true;
  if (specificMatchedTermCount >= 1 && matchedTerms.length >= 2) return true;
  if (phrase > 0 && queryTerms.length >= 2) return true;
  if (phrase > 0 && specificMatchedTermCount > 0) return true;
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
  for (const term of matchedTerms) {
    if (!LOW_SIGNAL_REFERENCE_TERMS.has(term)) return false;
  }
  return true;
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

function haystackContainsAnyTerm(haystack: string, terms: readonly string[]): boolean {
  if (!haystack || terms.length === 0) return false;
  for (const term of terms) {
    if (term && haystack.includes(term)) return true;
  }
  return false;
}

function contradictionPenalty(record: MemoryRecord, queryTerms: string[]): number {
  if (!record.invalidatesIds || record.invalidatesIds.length === 0) return 0;
  if (!haystackContainsAnyTerm(normalizeSearchText(record.text), queryTerms)) return 0;
  return 0.25;
}

function appendDelimitedSearchText(text: string, value: unknown, delimiter: string): string {
  const part = String(value || '');
  if (!part) return text;
  return text ? `${text}${delimiter}${part}` : part;
}

function appendDelimitedSearchValues(
  text: string,
  values: Iterable<unknown> | undefined,
  delimiter: string,
): string {
  let next = text;
  if (!values) return next;
  for (const value of values) {
    next = appendDelimitedSearchText(next, value, delimiter);
  }
  return next;
}

function appendBasenameSearchValues(
  text: string,
  values: Iterable<unknown> | undefined,
  delimiter: string,
): string {
  let next = text;
  if (!values) return next;
  for (const value of values) {
    next = appendDelimitedSearchText(next, path.basename(String(value || '')), delimiter);
  }
  return next;
}

function memoryRecordSearchHaystack(record: MemoryRecord): string {
  let text = '';
  text = appendDelimitedSearchText(text, record.title, ' ');
  text = appendDelimitedSearchText(text, record.text, ' ');
  text = appendDelimitedSearchValues(text, record.filesTouched, ' ');
  text = appendDelimitedSearchValues(text, record.toolsUsed, ' ');
  text = appendDelimitedSearchValues(text, record.sourceTurnIds, ' ');
  return normalizeSearchText(text);
}

function basenameSearchHaystack(values: Iterable<unknown> | undefined): string {
  return normalizeSearchText(appendBasenameSearchValues('', values, ' '));
}

function valueSearchHaystack(values: Iterable<unknown> | undefined): string {
  return normalizeSearchText(appendDelimitedSearchValues('', values, ' '));
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

  const haystack = memoryRecordSearchHaystack(record);
  if (!haystack) return undefined;

  const fileHaystack = basenameSearchHaystack(record.filesTouched);
  const toolHaystack = valueSearchHaystack(record.toolsUsed);
  const lexical = lexicalScore(haystack, queryTerms);
  const phrase = phraseBoostText(record.text, normalizedQuery);
  const file = haystackContainsAnyTerm(fileHaystack, lexical.matchedTerms) ? 1.8 : 0;
  const tool = haystackContainsAnyTerm(toolHaystack, lexical.matchedTerms) ? 1.2 : 0;
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
  let text = '';
  text = appendDelimitedSearchText(text, fields.guidance, '\n');
  if (fields.why) {
    text = appendDelimitedSearchText(text, `Why: ${fields.why}`, '\n');
  }
  if (shouldSurfaceSelectiveHowToApply(entry, fields)) {
    text = appendDelimitedSearchText(text, `How to apply: ${fields.howToApply}`, '\n');
  }
  return text;
}

function durableScoringText(entry: ConsolidatedMemoryEntry): string {
  const fields = renderMemoryFields(entry);
  let text = '';
  text = appendDelimitedSearchText(text, fields.guidance, '\n');
  text = appendDelimitedSearchText(text, fields.why, '\n');
  if (fields.howToApplySource === 'explicit') {
    text = appendDelimitedSearchText(text, fields.howToApply, '\n');
  }
  return text;
}

function durableSearchHaystack(entry: ConsolidatedMemoryEntry): string {
  const fields = renderMemoryFields(entry);
  let text = '';
  text = appendDelimitedSearchText(text, fields.guidance, ' ');
  text = appendDelimitedSearchText(text, fields.why, ' ');
  if (fields.howToApplySource === 'explicit') {
    text = appendDelimitedSearchText(text, fields.howToApply, ' ');
  }
  text = appendDelimitedSearchValues(text, entry.titles, ' ');
  text = appendDelimitedSearchValues(text, entry.filesTouched, ' ');
  text = appendDelimitedSearchValues(text, entry.toolsUsed, ' ');
  return normalizeSearchText(text);
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

  const fileHaystack = basenameSearchHaystack(entry.filesTouched);
  const toolHaystack = valueSearchHaystack(entry.toolsUsed);
  const lexical = lexicalScore(haystack, queryTerms);
  const phrase = durablePhraseBoost(searchableText, normalizedQuery, queryTerms, lexical.matchedTerms);
  const file = haystackContainsAnyTerm(fileHaystack, lexical.matchedTerms) ? 1.6 : 0;
  const tool = haystackContainsAnyTerm(toolHaystack, lexical.matchedTerms) ? 1 : 0;
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

function compareSupportRecords(
  a: MemoryRecord,
  b: MemoryRecord,
  entry: ConsolidatedMemoryEntry,
  usingSameSessionFallback: boolean,
  query: string,
  queryTerms: string[],
  normalizedQuery: string,
  now: number,
): number {
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
}

function selectSupportRecord(
  entry: ConsolidatedMemoryEntry,
  records: MemoryRecord[],
  query: string,
  queryTerms: string[],
  normalizedQuery: string,
  now: number,
): MemoryRecord | undefined {
  let directBest: MemoryRecord | undefined;
  const sameSessionCandidates = new Map<string, MemoryRecord>();

  for (const record of records) {
    if (record.staleness === 'invalidated') continue;
    if (String(record.memoryKey || '').trim() === entry.key) {
      if (!directBest || compareSupportRecords(record, directBest, entry, false, query, queryTerms, normalizedQuery, now) < 0) {
        directBest = record;
      }
      continue;
    }
    if (entry.sessionIds.includes(record.sessionId)) {
      sameSessionCandidates.set(record.id, record);
    }
  }

  if (directBest) return directBest;

  let sameSessionBest: MemoryRecord | undefined;
  for (const record of sameSessionCandidates.values()) {
    if (!sameSessionBest || compareSupportRecords(record, sameSessionBest, entry, true, query, queryTerms, normalizedQuery, now) < 0) {
      sameSessionBest = record;
    }
  }
  return sameSessionBest;
}

function defaultPerKindLimit(limit: number): number {
  return Math.max(1, Math.ceil(limit / 2));
}

function hitText(hit: MemorySearchHit): string {
  return hit.durableEntry ? durableSearchText(hit.durableEntry) : hit.record.text;
}

export function hitTimestamp(hit: MemorySearchHit): number {
  return hit.durableEntry?.lastConfirmedAt ?? hit.record.lastConfirmedAt;
}

export function hitClusterKey(hit: MemorySearchHit): string {
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
  const text = durableSearchText(entry);
  if (entry.category !== 'reference') return text;
  return appendDelimitedSearchValues(text, entry.rolloutFiles, '\n');
}

function referenceEvidenceNoveltyCount(record: MemoryRecord, durableEntry: ConsolidatedMemoryEntry): number {
  if (durableEntry.category !== 'reference') return 0;
  const durableTokens = new Set(extractReferenceEvidenceTokens(durableSupportEvidenceText(durableEntry)));
  const rawTokens = extractReferenceEvidenceTokens(record.text);
  let noveltyCount = 0;
  for (const token of rawTokens) {
    if (!durableTokens.has(token)) noveltyCount++;
  }
  return noveltyCount;
}

function rawRecordAddsDistinctReferenceEvidence(record: MemoryRecord, durableEntry: ConsolidatedMemoryEntry): boolean {
  return referenceEvidenceNoveltyCount(record, durableEntry) > 0;
}

function collectLowercaseTermSet(values: Iterable<unknown> | undefined): Set<string> {
  const terms = new Set<string>();
  if (!values) return terms;
  for (const value of values) {
    terms.add(String(value || '').toLowerCase());
  }
  return terms;
}

function collectNormalizedSupportSet(values: Iterable<unknown> | undefined): Set<string> {
  const support = new Set<string>();
  if (!values) return support;
  for (const value of values) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) support.add(normalized);
  }
  return support;
}

function hasDistinctNormalizedSupport(values: Iterable<unknown>, existing: Set<string>): boolean {
  for (const value of values) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized && !existing.has(normalized)) return true;
  }
  return false;
}

function rawRecordSupportsDurableReference(
  record: MemoryRecord,
  durableHit: MemorySearchHit,
  matchedTerms: string[],
): boolean {
  if (!durableHit.durableEntry || durableHit.durableEntry.category !== 'reference') return false;
  if (!rawRecordAddsDistinctReferenceEvidence(record, durableHit.durableEntry)) return false;

  const durableMatchedTerms = collectLowercaseTermSet(durableHit.matchedTerms);
  for (const term of matchedTerms) {
    const normalized = String(term || '').toLowerCase();
    if (durableMatchedTerms.has(normalized) && !LOW_SIGNAL_REFERENCE_TERMS.has(normalized)) return true;
  }
  return false;
}

function findSelectedDurableReferenceSupport(
  hits: readonly MemorySearchHit[],
  record: MemoryRecord,
  matchedTerms: string[],
): MemorySearchHit | undefined {
  for (const hit of hits) {
    if (rawRecordSupportsDurableReference(record, hit, matchedTerms)) return hit;
  }
  return undefined;
}

function summaryRecordAddsDistinctSupport(
  record: MemoryRecord,
  durableEntry: ConsolidatedMemoryEntry,
): boolean {
  const durableFiles = collectNormalizedSupportSet(durableEntry.filesTouched);
  if (hasDistinctNormalizedSupport(record.filesTouched, durableFiles)) {
    return true;
  }

  const durableTools = collectNormalizedSupportSet(durableEntry.toolsUsed);
  if (hasDistinctNormalizedSupport(record.toolsUsed, durableTools)) {
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
  const otherFiles = collectNormalizedSupportSet(otherRecord.filesTouched);
  if (hasDistinctNormalizedSupport(summaryRecord.filesTouched, otherFiles)) {
    return true;
  }

  const otherTools = collectNormalizedSupportSet(otherRecord.toolsUsed);
  if (hasDistinctNormalizedSupport(summaryRecord.toolsUsed, otherTools)) {
    return true;
  }

  const otherReferenceTokens = new Set(extractReferenceEvidenceTokens(otherRecord.text));
  const summaryReferenceTokens = extractReferenceEvidenceTokens(summaryRecord.text);
  for (const token of summaryReferenceTokens) {
    if (!otherReferenceTokens.has(token)) return true;
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
  const workspaceRecords: MemoryRecord[] = [];
  const workspaceRecordMap = new Map<string, MemoryRecord>();
  const rawMatches: MemoryRecordScore[] = [];
  for (const record of params.records) {
    if (record.workspaceId !== params.workspaceId) continue;
    workspaceRecords.push(record);
    workspaceRecordMap.set(record.id, record);
    if (params.kind && record.kind !== params.kind) continue;
    if (params.scope && record.scope !== params.scope) continue;
    if (record.staleness === 'invalidated') continue;
    const score = scoreMemoryRecord(record, query, terms, normalizedQuery, now);
    if (score) rawMatches.push(score);
  }

  const durableMatches: DurableEntryScore[] = [];
  if (!params.kind) {
    for (const entry of params.durableEntries || []) {
      if (params.scope && entry.scope !== params.scope) continue;
      const score = scoreDurableEntry(entry, query, terms, normalizedQuery, now);
      if (score) durableMatches.push(score);
    }
  }

  const filteredRawMatches: MemoryRecordScore[] = [];
  for (const candidate of rawMatches) {
    if (candidate.record.signalKind !== 'summary') {
      filteredRawMatches.push(candidate);
      continue;
    }
    let isRedundantToDurable = false;
    for (const durableCandidate of durableMatches) {
      if (summaryRecordIsRedundantToDurable(candidate.record, durableCandidate)) {
        isRedundantToDurable = true;
        break;
      }
    }
    if (isRedundantToDurable) {
      continue;
    }
    let isRedundantToRaw = false;
    for (const otherCandidate of rawMatches) {
      if (summaryRecordIsRedundantToRaw(candidate, otherCandidate)) {
        isRedundantToRaw = true;
        break;
      }
    }
    if (isRedundantToRaw) {
      continue;
    }
    filteredRawMatches.push(candidate);
  }

  const isCurrentStateQuery = queryLooksLikeCurrentStateIntent(query);
  const preferDurableFirst = params.preferDurableFirst === true && durableMatches.length > 0;
  let hasDurableReferencePointer = false;
  for (const candidate of durableMatches) {
    if (candidate.entry.category === 'reference') {
      hasDurableReferencePointer = true;
      break;
    }
  }
  const preferCurrentStateDurablePointerFirst = shouldPreferCurrentStateDurablePointerFirst({
    query,
    hasDurableReferencePointer,
  });

  const combined: SearchCandidate[] = [];
  for (const candidate of durableMatches) {
    combined.push({ type: 'durable', candidate });
  }
  for (const candidate of filteredRawMatches) {
    combined.push({ type: 'record', candidate });
  }
  combined.sort((a, b) => {
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
  const selectedDurableByKey = new Map<string, MemorySearchHit>();
  const selectedDurableReferenceHits: MemorySearchHit[] = [];
  const seenSessionTurn = new Set<string>();
  const kindCounts = new Map<MemoryRecordKind, number>();
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
          ? selectedDurableByKey.get(durableKey)
          : findSelectedDurableReferenceSupport(selectedDurableReferenceHits, record, matchedTerms)
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
    visitedRecordIds.add(supportRecord.id);
    matchCount += 1;
    const hit: MemorySearchHit = {
      record: supportRecord,
      source: 'durable',
      durableEntry: candidate.entry,
      reason: 'match',
      score: candidate.score,
      matchedTerms: candidate.matchedTerms,
      scoreBreakdown: candidate.breakdown,
    };
    selectedDurableByKey.set(candidate.entry.key, hit);
    if (candidate.entry.category === 'reference') {
      selectedDurableReferenceHits.push(hit);
    }
    addHit(hit);
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
