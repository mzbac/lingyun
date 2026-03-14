import * as assert from 'assert';

import {
  MEMORY_EVAL_RESULTS_HEADER,
  evaluateMemoryBenchmarkCase,
  formatMemoryBenchmarkSummaryTsvRow,
  summarizeMemoryBenchmarkResults,
} from '../../core/memories/benchmark';
import { memoryBenchmarkFixtures } from '../fixtures/memoryBenchmark';

suite('Memory Benchmark Harness', () => {
  test('evaluates pinned fixtures and exposes failures cleanly', () => {
    const results = memoryBenchmarkFixtures.map(fixture =>
      evaluateMemoryBenchmarkCase({
        testCase: fixture.testCase,
        candidates: fixture.candidates,
      }),
    );

    assert.strictEqual(results.length, 5);

    const designDecision = results.find(result => result.caseId === 'episodic-design-decision');
    assert.ok(designDecision);
    assert.strictEqual(designDecision?.status, 'pass');
    assert.strictEqual(designDecision?.matchedExpectedChunkCount, 1);
    assert.strictEqual(designDecision?.matchedFactCount, 2);

    const workspaceIsolation = results.find(result => result.caseId === 'workspace-isolation');
    assert.ok(workspaceIsolation);
    assert.strictEqual(workspaceIsolation?.status, 'fail');
    assert.strictEqual(workspaceIsolation?.wrongWorkspaceRecallCount, 1);
    assert.strictEqual(workspaceIsolation?.matchedExpectedChunkCount, 1);

    const noRecall = results.find(result => result.caseId === 'no-recall-needed');
    assert.ok(noRecall);
    assert.strictEqual(noRecall?.status, 'pass');
    assert.strictEqual(noRecall?.retrievedCount, 0);
    assert.strictEqual(noRecall?.unexpectedRecall, false);
  });

  test('summarizes benchmark metrics for a scorecard row', () => {
    const results = memoryBenchmarkFixtures.map(fixture =>
      evaluateMemoryBenchmarkCase({
        testCase: fixture.testCase,
        candidates: fixture.candidates,
      }),
    );

    const summary = summarizeMemoryBenchmarkResults(results);
    assert.strictEqual(summary.totalCases, 5);
    assert.strictEqual(summary.passedCases, 4);
    assert.strictEqual(summary.failedCases, 1);
    assert.ok(summary.passRate < 1 && summary.passRate > 0.7);
    assert.ok(summary.averageRecallAtK > 0.7);
    assert.ok(summary.averageSupportRate > 0.7);
    assert.ok(summary.wrongWorkspaceRate > 0);
    assert.strictEqual(summary.unexpectedRecallRate, 0);

    const row = formatMemoryBenchmarkSummaryTsvRow({
      timestamp: '2026-03-14T12:00:00Z',
      changeId: 'baseline',
      retrievalVariant: 'manual-summary-only',
      summary,
      status: 'discard',
      notes: 'workspace leakage detected',
    });

    const cells = row.split('\t');
    assert.strictEqual(cells.length, MEMORY_EVAL_RESULTS_HEADER.split('\t').length);
    assert.strictEqual(cells[0], '2026-03-14T12:00:00Z');
    assert.strictEqual(cells[1], 'baseline');
    assert.strictEqual(cells[2], 'manual-summary-only');
    assert.strictEqual(cells[10], 'discard');
    assert.strictEqual(cells[11], 'workspace leakage detected');
  });

  test('flags token budget overruns and unexpected recall', () => {
    const overBudget = evaluateMemoryBenchmarkCase({
      testCase: {
        id: 'budget',
        description: 'Caps injected memory size.',
        workspaceId: 'workspace-alpha',
        query: 'Tell me the plan.',
        kind: 'semantic',
        expectedChunkIds: ['alpha-sem-2'],
        minimumExpectedChunkMatches: 1,
        maxInjectedTokens: 3,
      },
      candidates: [
        {
          chunkId: 'alpha-sem-2',
          workspaceId: 'workspace-alpha',
          text: 'This candidate is intentionally long enough to exceed the tiny token budget.',
        },
      ],
    });
    assert.strictEqual(overBudget.status, 'fail');
    assert.strictEqual(overBudget.tokenBudgetExceeded, true);

    const unexpectedRecall = evaluateMemoryBenchmarkCase({
      testCase: {
        id: 'unexpected',
        description: 'No memory should be recalled.',
        workspaceId: 'workspace-alpha',
        query: 'Explain this pasted snippet.',
        kind: 'mixed',
        requireNoRecall: true,
      },
      candidates: [
        {
          chunkId: 'alpha-sem-3',
          workspaceId: 'workspace-alpha',
          text: 'A stale memory was incorrectly recalled.',
        },
      ],
    });
    assert.strictEqual(unexpectedRecall.status, 'fail');
    assert.strictEqual(unexpectedRecall.unexpectedRecall, true);
  });
});
