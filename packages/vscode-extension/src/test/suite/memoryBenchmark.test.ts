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

    assert.strictEqual(results.length, 10);

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

    const currentStatePointerFirst = results.find(result => result.caseId === 'current-state-pointer-first-selective');
    assert.ok(currentStatePointerFirst);
    assert.strictEqual(currentStatePointerFirst?.status, 'pass');
    assert.strictEqual(currentStatePointerFirst?.matchedExpectedChunkCount, 2);
    assert.strictEqual(currentStatePointerFirst?.matchedLeadingChunkCount, 2);
    assert.strictEqual(currentStatePointerFirst?.leadingChunkOrderSatisfied, true);
    assert.strictEqual(currentStatePointerFirst?.forbiddenChunkRecallCount, 0);

    const followUpFreshBudget = results.find(result => result.caseId === 'follow-up-fresh-budget-selective');
    assert.ok(followUpFreshBudget);
    assert.strictEqual(followUpFreshBudget?.status, 'pass');
    assert.strictEqual(followUpFreshBudget?.matchedExpectedChunkCount, 1);
    assert.strictEqual(followUpFreshBudget?.matchedLeadingChunkCount, 1);
    assert.strictEqual(followUpFreshBudget?.leadingChunkOrderSatisfied, true);
    assert.strictEqual(followUpFreshBudget?.forbiddenChunkRecallCount, 0);

    const angleAwareRepeat = results.find(result => result.caseId === 'angle-aware-repeat-why-selective');
    assert.ok(angleAwareRepeat);
    assert.strictEqual(angleAwareRepeat?.status, 'pass');
    assert.strictEqual(angleAwareRepeat?.matchedExpectedChunkCount, 1);
    assert.strictEqual(angleAwareRepeat?.matchedLeadingChunkCount, 1);
    assert.strictEqual(angleAwareRepeat?.leadingChunkOrderSatisfied, true);
    assert.strictEqual(angleAwareRepeat?.priorSurfacedChunkCount, 1);
    assert.strictEqual(angleAwareRepeat?.repeatedChunkRecallCount, 1);
    assert.strictEqual(angleAwareRepeat?.expectedRepeatedChunkCount, 1);
    assert.strictEqual(angleAwareRepeat?.repeatedChunkWithNewFacetCount, 1);
    assert.strictEqual(angleAwareRepeat?.unexpectedRepeatedChunkRecallCount, 0);

    const angleAwareHowRepeat = results.find(result => result.caseId === 'angle-aware-repeat-how-selective');
    assert.ok(angleAwareHowRepeat);
    assert.strictEqual(angleAwareHowRepeat?.status, 'pass');
    assert.strictEqual(angleAwareHowRepeat?.matchedExpectedChunkCount, 1);
    assert.strictEqual(angleAwareHowRepeat?.matchedLeadingChunkCount, 1);
    assert.strictEqual(angleAwareHowRepeat?.leadingChunkOrderSatisfied, true);
    assert.strictEqual(angleAwareHowRepeat?.priorSurfacedChunkCount, 1);
    assert.strictEqual(angleAwareHowRepeat?.repeatedChunkRecallCount, 1);
    assert.strictEqual(angleAwareHowRepeat?.expectedRepeatedChunkCount, 1);
    assert.strictEqual(angleAwareHowRepeat?.repeatedChunkWithNewFacetCount, 1);
    assert.strictEqual(angleAwareHowRepeat?.unexpectedRepeatedChunkRecallCount, 0);

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
    assert.strictEqual(summary.totalCases, 10);
    assert.strictEqual(summary.passedCases, 9);
    assert.strictEqual(summary.failedCases, 1);
    assert.ok(summary.passRate < 1 && summary.passRate > 0.8);
    assert.ok(summary.averageRecallAtK > 0.7);
    assert.ok(summary.averageSupportRate > 0.7);
    assert.strictEqual(summary.leadingOrderRate, 1);
    assert.strictEqual(summary.forbiddenRecallRate, 0);
    assert.ok(summary.wrongWorkspaceRate > 0);
    assert.strictEqual(summary.unexpectedRecallRate, 0);
    assert.strictEqual(summary.unexpectedRepeatedRecallRate, 0);

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
    assert.strictEqual(cells[12], '0.0000');
    assert.strictEqual(cells[13], 'discard');
    assert.strictEqual(cells[14], 'workspace leakage detected');
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

  test('fails when weaker additive support outranks the current-state pointer or is retrieved despite being forbidden', () => {
    const result = evaluateMemoryBenchmarkCase({
      testCase: {
        id: 'pointer-order-failure',
        description: 'Durable current-state pointer should lead and weaker additive support should stay out.',
        workspaceId: 'workspace-alpha',
        query: 'What is the current rollout status right now?',
        kind: 'mixed',
        expectedChunkIds: ['alpha-ref-current', 'alpha-proj-prior'],
        expectedLeadingChunkIds: ['alpha-ref-current', 'alpha-proj-prior'],
        forbiddenChunkIds: ['alpha-raw-project-support'],
        minimumExpectedChunkMatches: 2,
      },
      candidates: [
        {
          chunkId: 'alpha-raw-project-support',
          workspaceId: 'workspace-alpha',
          text: 'Weaker raw project snapshot support was surfaced before the current-truth pointer.',
        },
        {
          chunkId: 'alpha-ref-current',
          workspaceId: 'workspace-alpha',
          text: 'Current truth pointer: check the release tracker for the latest rollout status.',
        },
        {
          chunkId: 'alpha-proj-prior',
          workspaceId: 'workspace-alpha',
          text: 'Prior context: the earlier project snapshot expected the freeze window to start after QA signoff.',
        },
      ],
    });

    assert.strictEqual(result.status, 'fail');
    assert.strictEqual(result.matchedExpectedChunkCount, 2);
    assert.strictEqual(result.leadingChunkOrderSatisfied, false);
    assert.strictEqual(result.matchedLeadingChunkCount, 0);
    assert.strictEqual(result.forbiddenChunkRecallCount, 1);
  });

  test('fails when a follow-up benchmark repeats a previously surfaced chunk without explicitly expecting it again', () => {
    const result = evaluateMemoryBenchmarkCase({
      testCase: {
        id: 'unexpected-repeat-failure',
        description: 'Follow-up recall should not repeat the prior chunk unless the benchmark explicitly expects that repeat.',
        workspaceId: 'workspace-alpha',
        query: 'What testing policy should I follow for migration-sensitive integration tests?',
        kind: 'procedural',
        priorSurfacedChunkIds: ['alpha-proc-repeat-policy'],
        expectedChunkIds: ['alpha-proc-migration-fresh'],
        expectedLeadingChunkIds: ['alpha-proc-migration-fresh'],
        minimumExpectedChunkMatches: 1,
      },
      candidates: [
        {
          chunkId: 'alpha-proc-repeat-policy',
          workspaceId: 'workspace-alpha',
          text: 'Prefer integration tests against a seeded ephemeral database instance.',
        },
        {
          chunkId: 'alpha-proc-migration-fresh',
          workspaceId: 'workspace-alpha',
          text: 'Run migration-sensitive integration tests serially to avoid cross-test schema drift.',
        },
      ],
    });

    assert.strictEqual(result.status, 'fail');
    assert.strictEqual(result.priorSurfacedChunkCount, 1);
    assert.strictEqual(result.repeatedChunkRecallCount, 1);
    assert.strictEqual(result.unexpectedRepeatedChunkRecallCount, 1);
  });

  test('fails when a repeated follow-up chunk is expected but does not expose the newly required facet', () => {
    const result = evaluateMemoryBenchmarkCase({
      testCase: {
        id: 'unexpected-repeat-missing-facet-failure',
        description: 'Follow-up recall should fail when a repeated chunk is allowed only if it exposes a new why facet but the candidate does not surface it.',
        workspaceId: 'workspace-alpha',
        query: 'Why do we prefer that testing policy for integration tests?',
        kind: 'procedural',
        priorSurfacedChunkIds: ['alpha-proc-angle-aware-policy'],
        priorSurfacedFacetsByChunkId: {
          'alpha-proc-angle-aware-policy': [],
        },
        requiredNewFacetsByChunkId: {
          'alpha-proc-angle-aware-policy': ['why'],
        },
        expectedChunkIds: ['alpha-proc-angle-aware-policy'],
        expectedLeadingChunkIds: ['alpha-proc-angle-aware-policy'],
        minimumExpectedChunkMatches: 1,
      },
      candidates: [
        {
          chunkId: 'alpha-proc-angle-aware-policy',
          workspaceId: 'workspace-alpha',
          surfacedFacets: [],
          text: 'Prefer integration tests against a seeded ephemeral database instance.',
        },
      ],
    });

    assert.strictEqual(result.status, 'fail');
    assert.strictEqual(result.priorSurfacedChunkCount, 1);
    assert.strictEqual(result.repeatedChunkRecallCount, 1);
    assert.strictEqual(result.expectedRepeatedChunkCount, 1);
    assert.strictEqual(result.repeatedChunkWithNewFacetCount, 0);
    assert.strictEqual(result.unexpectedRepeatedChunkRecallCount, 1);
  });

  test('fails when a repeated follow-up chunk is expected but does not expose the newly required how_to_apply facet', () => {
    const result = evaluateMemoryBenchmarkCase({
      testCase: {
        id: 'unexpected-repeat-missing-how-facet-failure',
        description: 'Follow-up recall should fail when a repeated chunk is allowed only if it exposes a new how_to_apply facet but the candidate does not surface it.',
        workspaceId: 'workspace-alpha',
        query: 'How should we apply that testing policy for migration-sensitive integration tests?',
        kind: 'procedural',
        priorSurfacedChunkIds: ['alpha-proc-angle-aware-how-policy'],
        priorSurfacedFacetsByChunkId: {
          'alpha-proc-angle-aware-how-policy': [],
        },
        requiredNewFacetsByChunkId: {
          'alpha-proc-angle-aware-how-policy': ['howToApply'],
        },
        expectedChunkIds: ['alpha-proc-angle-aware-how-policy'],
        expectedLeadingChunkIds: ['alpha-proc-angle-aware-how-policy'],
        minimumExpectedChunkMatches: 1,
      },
      candidates: [
        {
          chunkId: 'alpha-proc-angle-aware-how-policy',
          workspaceId: 'workspace-alpha',
          surfacedFacets: [],
          text: 'Prefer integration tests against a seeded ephemeral database instance.',
        },
      ],
    });

    assert.strictEqual(result.status, 'fail');
    assert.strictEqual(result.priorSurfacedChunkCount, 1);
    assert.strictEqual(result.repeatedChunkRecallCount, 1);
    assert.strictEqual(result.expectedRepeatedChunkCount, 1);
    assert.strictEqual(result.repeatedChunkWithNewFacetCount, 0);
    assert.strictEqual(result.unexpectedRepeatedChunkRecallCount, 1);
  });
});
