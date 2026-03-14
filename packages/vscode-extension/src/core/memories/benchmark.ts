export type MemoryBenchmarkKind = 'episodic' | 'semantic' | 'procedural' | 'mixed';

export type MemoryBenchmarkCase = {
  id: string;
  description: string;
  workspaceId: string;
  query: string;
  kind: MemoryBenchmarkKind;
  expectedChunkIds?: string[];
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
  recallAtK: number;
  supportRate: number;
  injectedTokens: number;
  wrongWorkspaceRecallCount: number;
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
  averageInjectedTokens: number;
  p95InjectedTokens: number;
  wrongWorkspaceRate: number;
  unexpectedRecallRate: number;
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
  'avg_injected_tokens',
  'p95_injected_tokens',
  'wrong_workspace_rate',
  'unexpected_recall_rate',
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

export function evaluateMemoryBenchmarkCase(params: {
  testCase: MemoryBenchmarkCase;
  candidates: MemoryBenchmarkCandidate[];
}): MemoryBenchmarkCaseResult {
  const testCase = params.testCase;
  const candidates = Array.isArray(params.candidates) ? params.candidates : [];

  const expectedChunkIds = new Set((testCase.expectedChunkIds || []).map(value => value.trim()).filter(Boolean));
  const expectedFacts = (testCase.expectedFacts || []).map(normalizeText).filter(Boolean);
  const matchedChunkIds = new Set<string>();
  const matchedFacts = new Set<string>();

  let wrongWorkspaceRecallCount = 0;
  let injectedTokens = 0;

  for (const candidate of candidates) {
    injectedTokens += estimateTokens(candidate.text);
    if (candidate.workspaceId !== testCase.workspaceId) {
      wrongWorkspaceRecallCount += 1;
    }
    if (expectedChunkIds.has(candidate.chunkId)) {
      matchedChunkIds.add(candidate.chunkId);
    }

    const candidateText = normalizeText(candidate.text);
    for (const fact of expectedFacts) {
      if (candidateText.includes(fact)) {
        matchedFacts.add(fact);
      }
    }
  }

  const expectedChunkCount = expectedChunkIds.size;
  const expectedFactCount = expectedFacts.length;
  const matchedExpectedChunkCount = matchedChunkIds.size;
  const matchedFactCount = matchedFacts.size;
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
    (!forbidWorkspaceLeakage || wrongWorkspaceRecallCount === 0) &&
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
    recallAtK,
    supportRate,
    injectedTokens,
    wrongWorkspaceRecallCount,
    unexpectedRecall,
    tokenBudgetExceeded,
  };
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
    averageInjectedTokens: average(injectedTokens),
    p95InjectedTokens: percentile(injectedTokens, 0.95),
    wrongWorkspaceRate: average(rows.map(row => (row.wrongWorkspaceRecallCount > 0 ? 1 : 0))),
    unexpectedRecallRate: average(rows.map(row => (row.unexpectedRecall ? 1 : 0))),
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
    row.summary.averageInjectedTokens.toFixed(1),
    row.summary.p95InjectedTokens.toFixed(1),
    row.summary.wrongWorkspaceRate.toFixed(4),
    row.summary.unexpectedRecallRate.toFixed(4),
    row.status,
    notes,
  ].join('\t');
}
