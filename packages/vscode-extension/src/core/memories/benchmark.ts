export type MemoryBenchmarkKind = 'episodic' | 'semantic' | 'procedural' | 'mixed';
export type MemoryBenchmarkFacet = 'why' | 'howToApply';

export type MemoryBenchmarkCase = {
  id: string;
  description: string;
  workspaceId: string;
  query: string;
  kind: MemoryBenchmarkKind;
  priorSurfacedChunkIds?: string[];
  priorSurfacedFacetsByChunkId?: Record<string, MemoryBenchmarkFacet[]>;
  requiredNewFacetsByChunkId?: Record<string, MemoryBenchmarkFacet[]>;
  expectedChunkIds?: string[];
  expectedLeadingChunkIds?: string[];
  forbiddenChunkIds?: string[];
  expectedFacts?: string[];
  requireNoRecall?: boolean;
  minimumExpectedChunkMatches?: number;
  minimumFactMatches?: number;
  maxInjectedTokens?: number;
  forbidWorkspaceLeakage?: boolean;
};

export type MemoryBenchmarkCandidate = {
  chunkId: string;
  workspaceId: string;
  text: string;
  surfacedFacets?: MemoryBenchmarkFacet[];
  kind?: Exclude<MemoryBenchmarkKind, 'mixed'>;
  score?: number;
};

export type MemoryBenchmarkCaseResult = {
  caseId: string;
  status: 'pass' | 'fail';
  retrievedCount: number;
  matchedExpectedChunkCount: number;
  matchedFactCount: number;
  expectedChunkCount: number;
  expectedFactCount: number;
  expectedLeadingChunkCount: number;
  matchedLeadingChunkCount: number;
  leadingChunkOrderSatisfied: boolean;
  expectedForbiddenChunkCount: number;
  priorSurfacedChunkCount: number;
  repeatedChunkRecallCount: number;
  expectedRepeatedChunkCount: number;
  repeatedChunkWithNewFacetCount: number;
  unexpectedRepeatedChunkRecallCount: number;
  recallAtK: number;
  supportRate: number;
  injectedTokens: number;
  wrongWorkspaceRecallCount: number;
  forbiddenChunkRecallCount: number;
  unexpectedRecall: boolean;
  tokenBudgetExceeded: boolean;
};

export type MemoryBenchmarkSummary = {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageRecallAtK: number;
  averageSupportRate: number;
  leadingOrderRate: number;
  forbiddenRecallRate: number;
  averageInjectedTokens: number;
  p95InjectedTokens: number;
  wrongWorkspaceRate: number;
  unexpectedRecallRate: number;
  unexpectedRepeatedRecallRate: number;
};

export type MemoryBenchmarkSummaryRow = {
  timestamp: string;
  changeId: string;
  retrievalVariant: string;
  summary: MemoryBenchmarkSummary;
  status: 'keep' | 'discard' | 'crash';
  notes?: string;
};

export const MEMORY_EVAL_RESULTS_HEADER = [
  'timestamp',
  'change_id',
  'retrieval_variant',
  'pass_rate',
  'avg_recall_at_k',
  'avg_support_rate',
  'leading_order_rate',
  'forbidden_recall_rate',
  'avg_injected_tokens',
  'p95_injected_tokens',
  'wrong_workspace_rate',
  'unexpected_recall_rate',
  'unexpected_repeated_recall_rate',
  'status',
  'notes',
].join('\t');

function normalizeText(input: string | undefined): string {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateTokens(text: string | undefined): number {
  const normalized = String(text || '');
  if (!normalized) return 0;
  return Math.ceil(normalized.length / 4);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[idx] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeChunkIds(values: string[] | undefined): string[] {
  return (values || []).map(value => value.trim()).filter(Boolean);
}

function normalizeFacet(value: string): MemoryBenchmarkFacet | undefined {
  return value === 'why' || value === 'howToApply' ? value : undefined;
}

function normalizeFacetMap(value: Record<string, MemoryBenchmarkFacet[]> | undefined): Record<string, MemoryBenchmarkFacet[]> {
  if (!value) return {};
  const normalized: Record<string, MemoryBenchmarkFacet[]> = {};
  for (const [chunkId, facets] of Object.entries(value)) {
    const nextChunkId = String(chunkId || '').trim();
    if (!nextChunkId) continue;
    const nextFacets = Array.isArray(facets)
      ? facets
        .map((facet) => normalizeFacet(String(facet || '').trim()))
        .filter((facet): facet is MemoryBenchmarkFacet => !!facet)
      : [];
    normalized[nextChunkId] = [...new Set(nextFacets)];
  }
  return normalized;
}

function normalizeCandidateFacets(values: MemoryBenchmarkFacet[] | undefined): MemoryBenchmarkFacet[] {
  return Array.isArray(values)
    ? [...new Set(values.map((facet) => normalizeFacet(String(facet || '').trim())).filter((facet): facet is MemoryBenchmarkFacet => !!facet))]
    : [];
}

export function evaluateMemoryBenchmarkCase(params: {
  testCase: MemoryBenchmarkCase;
  candidates: MemoryBenchmarkCandidate[];
}): MemoryBenchmarkCaseResult {
  const testCase = params.testCase;
  const candidates = Array.isArray(params.candidates) ? params.candidates : [];

  const priorSurfacedChunkIds = new Set(normalizeChunkIds(testCase.priorSurfacedChunkIds));
  const priorSurfacedFacetsByChunkId = normalizeFacetMap(testCase.priorSurfacedFacetsByChunkId);
  const requiredNewFacetsByChunkId = normalizeFacetMap(testCase.requiredNewFacetsByChunkId);
  const expectedChunkIds = new Set(normalizeChunkIds(testCase.expectedChunkIds));
  const expectedLeadingChunkIds = normalizeChunkIds(testCase.expectedLeadingChunkIds);
  const forbiddenChunkIds = new Set(normalizeChunkIds(testCase.forbiddenChunkIds));
  const expectedFacts = (testCase.expectedFacts || []).map(normalizeText).filter(Boolean);
  const matchedChunkIds = new Set<string>();
  const matchedFacts = new Set<string>();

  let wrongWorkspaceRecallCount = 0;
  let injectedTokens = 0;
  let forbiddenChunkRecallCount = 0;
  let repeatedChunkRecallCount = 0;
  let repeatedChunkWithNewFacetCount = 0;
  let unexpectedRepeatedChunkRecallCount = 0;

  for (const candidate of candidates) {
    const candidateChunkId = String(candidate.chunkId || '').trim();
    const candidateText = normalizeText(candidate.text);
    const candidateSurfacedFacets = new Set(normalizeCandidateFacets(candidate.surfacedFacets));
    if (priorSurfacedChunkIds.has(candidateChunkId)) {
      repeatedChunkRecallCount += 1;
      const priorFacets = new Set(priorSurfacedFacetsByChunkId[candidateChunkId] || []);
      const requiredNewFacets = requiredNewFacetsByChunkId[candidateChunkId] || [];
      const hasRequiredNewFacet = requiredNewFacets.length > 0
        ? requiredNewFacets.some((facet) => candidateSurfacedFacets.has(facet) && !priorFacets.has(facet))
        : false;
      if (hasRequiredNewFacet) {
        repeatedChunkWithNewFacetCount += 1;
      }
      if (!expectedChunkIds.has(candidateChunkId) || (requiredNewFacets.length > 0 && !hasRequiredNewFacet)) {
        unexpectedRepeatedChunkRecallCount += 1;
      }
    }
    injectedTokens += estimateTokens(candidate.text);
    if (candidate.workspaceId !== testCase.workspaceId) {
      wrongWorkspaceRecallCount += 1;
    }
    if (expectedChunkIds.has(candidate.chunkId)) {
      matchedChunkIds.add(candidate.chunkId);
    }
    if (forbiddenChunkIds.has(candidate.chunkId)) {
      forbiddenChunkRecallCount += 1;
    }

    for (const fact of expectedFacts) {
      if (candidateText.includes(fact)) {
        matchedFacts.add(fact);
      }
    }
  }

  const expectedChunkCount = expectedChunkIds.size;
  const expectedFactCount = expectedFacts.length;
  const expectedLeadingChunkCount = expectedLeadingChunkIds.length;
  const expectedForbiddenChunkCount = forbiddenChunkIds.size;
  const priorSurfacedChunkCount = priorSurfacedChunkIds.size;
  const expectedRepeatedChunkCount = [...expectedChunkIds].filter((chunkId) => priorSurfacedChunkIds.has(chunkId)).length;
  const matchedExpectedChunkCount = matchedChunkIds.size;
  const matchedFactCount = matchedFacts.size;
  let matchedLeadingChunkCount = 0;
  for (let index = 0; index < expectedLeadingChunkCount; index += 1) {
    if (candidates[index]?.chunkId !== expectedLeadingChunkIds[index]) break;
    matchedLeadingChunkCount += 1;
  }
  const leadingChunkOrderSatisfied = matchedLeadingChunkCount === expectedLeadingChunkCount;
  const recallAtK = expectedChunkCount > 0 ? matchedExpectedChunkCount / expectedChunkCount : 0;
  const supportRate = expectedFactCount > 0 ? matchedFactCount / expectedFactCount : 0;
  const unexpectedRecall = !!testCase.requireNoRecall && candidates.length > 0;
  const tokenBudgetExceeded =
    typeof testCase.maxInjectedTokens === 'number' &&
    Number.isFinite(testCase.maxInjectedTokens) &&
    injectedTokens > Math.max(0, Math.floor(testCase.maxInjectedTokens));

  const minimumExpectedChunkMatches =
    testCase.requireNoRecall
      ? 0
      : typeof testCase.minimumExpectedChunkMatches === 'number'
        ? Math.max(0, Math.floor(testCase.minimumExpectedChunkMatches))
        : expectedChunkCount > 0
          ? 1
          : 0;

  const minimumFactMatches =
    testCase.requireNoRecall
      ? 0
      : typeof testCase.minimumFactMatches === 'number'
        ? Math.max(0, Math.floor(testCase.minimumFactMatches))
        : expectedFactCount > 0
          ? expectedFactCount
          : 0;

  const forbidWorkspaceLeakage = testCase.forbidWorkspaceLeakage !== false;
  const passed =
    (!testCase.requireNoRecall || candidates.length === 0) &&
    matchedExpectedChunkCount >= minimumExpectedChunkMatches &&
    matchedFactCount >= minimumFactMatches &&
    leadingChunkOrderSatisfied &&
    (!forbidWorkspaceLeakage || wrongWorkspaceRecallCount === 0) &&
    forbiddenChunkRecallCount === 0 &&
    unexpectedRepeatedChunkRecallCount === 0 &&
    !tokenBudgetExceeded &&
    !unexpectedRecall;

  return {
    caseId: testCase.id,
    status: passed ? 'pass' : 'fail',
    retrievedCount: candidates.length,
    matchedExpectedChunkCount,
    matchedFactCount,
    expectedChunkCount,
    expectedFactCount,
    expectedLeadingChunkCount,
    matchedLeadingChunkCount,
    leadingChunkOrderSatisfied,
    expectedForbiddenChunkCount,
    priorSurfacedChunkCount,
    repeatedChunkRecallCount,
    expectedRepeatedChunkCount,
    repeatedChunkWithNewFacetCount,
    unexpectedRepeatedChunkRecallCount,
    recallAtK,
    supportRate,
    injectedTokens,
    wrongWorkspaceRecallCount,
    forbiddenChunkRecallCount,
    unexpectedRecall,
    tokenBudgetExceeded,
  };
}

function averageRelevantRate<T>(rows: T[], isRelevant: (row: T) => boolean, value: (row: T) => number): number {
  const relevantRows = rows.filter(isRelevant);
  return relevantRows.length > 0 ? average(relevantRows.map(value)) : 0;
}

export function summarizeMemoryBenchmarkResults(results: MemoryBenchmarkCaseResult[]): MemoryBenchmarkSummary {
  const rows = Array.isArray(results) ? results : [];
  const totalCases = rows.length;
  const passedCases = rows.filter(row => row.status === 'pass').length;
  const failedCases = totalCases - passedCases;
  const injectedTokens = rows.map(row => row.injectedTokens);

  return {
    totalCases,
    passedCases,
    failedCases,
    passRate: totalCases > 0 ? passedCases / totalCases : 0,
    averageRecallAtK: average(rows.map(row => row.recallAtK)),
    averageSupportRate: average(rows.map(row => row.supportRate)),
    leadingOrderRate: averageRelevantRate(
      rows,
      row => row.expectedLeadingChunkCount > 0,
      row => (row.leadingChunkOrderSatisfied ? 1 : 0),
    ),
    forbiddenRecallRate: averageRelevantRate(
      rows,
      row => row.expectedForbiddenChunkCount > 0,
      row => (row.forbiddenChunkRecallCount > 0 ? 1 : 0),
    ),
    averageInjectedTokens: average(injectedTokens),
    p95InjectedTokens: percentile(injectedTokens, 0.95),
    wrongWorkspaceRate: average(rows.map(row => (row.wrongWorkspaceRecallCount > 0 ? 1 : 0))),
    unexpectedRecallRate: average(rows.map(row => (row.unexpectedRecall ? 1 : 0))),
    unexpectedRepeatedRecallRate: averageRelevantRate(
      rows,
      row => row.priorSurfacedChunkCount > 0,
      row => (row.unexpectedRepeatedChunkRecallCount > 0 ? 1 : 0),
    ),
  };
}

export function formatMemoryBenchmarkSummaryTsvRow(row: MemoryBenchmarkSummaryRow): string {
  const notes = String(row.notes || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  return [
    row.timestamp,
    row.changeId,
    row.retrievalVariant,
    row.summary.passRate.toFixed(4),
    row.summary.averageRecallAtK.toFixed(4),
    row.summary.averageSupportRate.toFixed(4),
    row.summary.leadingOrderRate.toFixed(4),
    row.summary.forbiddenRecallRate.toFixed(4),
    row.summary.averageInjectedTokens.toFixed(1),
    row.summary.p95InjectedTokens.toFixed(1),
    row.summary.wrongWorkspaceRate.toFixed(4),
    row.summary.unexpectedRecallRate.toFixed(4),
    row.summary.unexpectedRepeatedRecallRate.toFixed(4),
    row.status,
    notes,
  ].join('\t');
}
