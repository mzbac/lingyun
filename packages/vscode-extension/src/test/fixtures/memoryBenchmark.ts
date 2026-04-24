import type { MemoryBenchmarkCandidate, MemoryBenchmarkCase } from '../../core/memories/benchmark';

export type MemoryBenchmarkFixture = {
  testCase: MemoryBenchmarkCase;
  candidates: MemoryBenchmarkCandidate[];
};

export const memoryBenchmarkFixtures: MemoryBenchmarkFixture[] = [
  {
    testCase: {
      id: 'episodic-design-decision',
      description: 'Recalls a prior architecture decision after context compaction.',
      workspaceId: 'workspace-alpha',
      query: 'What did we decide about memory chunking?',
      kind: 'episodic',
      expectedChunkIds: ['alpha-chunk-2'],
      expectedFacts: ['chunk memory by turn boundary', 'neighbor expansion for surrounding context'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 2,
      maxInjectedTokens: 120,
      forbidWorkspaceLeakage: true,
    },
    candidates: [
      {
        chunkId: 'alpha-chunk-2',
        workspaceId: 'workspace-alpha',
        kind: 'episodic',
        score: 0.97,
        text: 'We decided to chunk memory by turn boundary and use neighbor expansion for surrounding context.',
      },
    ],
  },
  {
    testCase: {
      id: 'workspace-isolation',
      description: 'Rejects a topically similar memory from another workspace.',
      workspaceId: 'workspace-alpha',
      query: 'How do we refresh memories on startup?',
      kind: 'episodic',
      expectedChunkIds: ['alpha-chunk-3'],
      expectedFacts: ['refresh memories on startup'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 1,
      forbidWorkspaceLeakage: true,
    },
    candidates: [
      {
        chunkId: 'beta-chunk-1',
        workspaceId: 'workspace-beta',
        kind: 'episodic',
        score: 0.98,
        text: 'Workspace beta refresh memories on startup through a cron runner.',
      },
      {
        chunkId: 'alpha-chunk-3',
        workspaceId: 'workspace-alpha',
        kind: 'episodic',
        score: 0.94,
        text: 'Workspace alpha refresh memories on startup from the extension activation path.',
      },
    ],
  },
  {
    testCase: {
      id: 'procedural-preference',
      description: 'Recalls a durable user preference from procedural memory.',
      workspaceId: 'workspace-alpha',
      query: 'What kind of memory backend should the first version use?',
      kind: 'procedural',
      expectedChunkIds: ['alpha-proc-1'],
      expectedFacts: ['start with lexical retrieval', 'embeddings optional later'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 2,
      maxInjectedTokens: 80,
    },
    candidates: [
      {
        chunkId: 'alpha-proc-1',
        workspaceId: 'workspace-alpha',
        kind: 'procedural',
        score: 0.91,
        text: 'Start with lexical retrieval for the first version and keep embeddings optional later.',
      },
    ],
  },
  {
    testCase: {
      id: 'file-path-recall',
      description: 'Recalls a memory tied to a specific file path.',
      workspaceId: 'workspace-alpha',
      query: 'Where should auto recall be injected in the agent loop?',
      kind: 'semantic',
      expectedChunkIds: ['alpha-sem-1'],
      expectedFacts: ['agentloop.withrun', 'mayberunexploreprepass'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 2,
    },
    candidates: [
      {
        chunkId: 'alpha-sem-1',
        workspaceId: 'workspace-alpha',
        kind: 'semantic',
        score: 0.89,
        text: 'Inject auto recall in AgentLoop.withRun near maybeRunExplorePrepass so it happens before agent execution.',
      },
    ],
  },
  {
    testCase: {
      id: 'stale-memory-demotion',
      description: 'Stale recall should lose to fresher corroborated memory.',
      workspaceId: 'workspace-alpha',
      query: 'Where should auto recall be injected in the agent loop?',
      kind: 'semantic',
      expectedChunkIds: ['alpha-sem-1-fresh'],
      expectedFacts: ['agentloop.withrun', 'mayberunexploreprepass'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 2,
      forbidWorkspaceLeakage: true,
    },
    candidates: [
      {
        chunkId: 'alpha-sem-1-fresh',
        workspaceId: 'workspace-alpha',
        kind: 'semantic',
        score: 0.93,
        text: 'Fresh memory: inject auto recall in AgentLoop.withRun near maybeRunExplorePrepass before execution.',
      },
    ],
  },
  {
    testCase: {
      id: 'current-state-pointer-first-selective',
      description: 'Current-state recall keeps the durable pointer first, retains compact prior context, and suppresses weaker additive support.',
      workspaceId: 'workspace-alpha',
      query: 'What is the current rollout status right now?',
      kind: 'mixed',
      expectedChunkIds: ['alpha-ref-current', 'alpha-proj-prior'],
      expectedLeadingChunkIds: ['alpha-ref-current', 'alpha-proj-prior'],
      forbiddenChunkIds: ['alpha-raw-project-support'],
      expectedFacts: ['current truth pointer', 'prior context'],
      minimumExpectedChunkMatches: 2,
      minimumFactMatches: 2,
      maxInjectedTokens: 60,
      forbidWorkspaceLeakage: true,
    },
    candidates: [
      {
        chunkId: 'alpha-ref-current',
        workspaceId: 'workspace-alpha',
        kind: 'semantic',
        score: 0.99,
        text: 'Current truth pointer: check the release tracker for the latest rollout status and freeze window.',
      },
      {
        chunkId: 'alpha-proj-prior',
        workspaceId: 'workspace-alpha',
        kind: 'episodic',
        score: 0.91,
        text: 'Prior context: the earlier project snapshot expected the freeze window to start after QA signoff.',
      },
    ],
  },
  {
    testCase: {
      id: 'follow-up-fresh-budget-selective',
      description: 'Non-current-state follow-up recall spends limited budget on fresh context instead of repeating the prior durable hit.',
      workspaceId: 'workspace-alpha',
      query: 'What testing policy should I follow for migration-sensitive integration tests?',
      kind: 'procedural',
      expectedChunkIds: ['alpha-proc-migration-fresh'],
      expectedLeadingChunkIds: ['alpha-proc-migration-fresh'],
      forbiddenChunkIds: ['alpha-proc-repeat-policy'],
      expectedFacts: ['migration-sensitive integration tests serially', 'cross-test schema drift'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 2,
      maxInjectedTokens: 40,
      forbidWorkspaceLeakage: true,
    },
    candidates: [
      {
        chunkId: 'alpha-proc-migration-fresh',
        workspaceId: 'workspace-alpha',
        kind: 'procedural',
        score: 0.92,
        text: 'Run migration-sensitive integration tests serially to avoid cross-test schema drift.',
      },
    ],
  },
  {
    testCase: {
      id: 'angle-aware-repeat-why-selective',
      description: 'A follow-up can re-surface the same chunk when it is explicitly expected to answer a new why-oriented angle.',
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
      expectedFacts: ['seeded ephemeral database instance', 'mocked tests hid migration failures until production'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 2,
      maxInjectedTokens: 60,
      forbidWorkspaceLeakage: true,
    },
    candidates: [
      {
        chunkId: 'alpha-proc-angle-aware-policy',
        workspaceId: 'workspace-alpha',
        surfacedFacets: ['why'],
        kind: 'procedural',
        score: 0.93,
        text: 'Prefer integration tests against a seeded ephemeral database instance. Why: prior mocked tests hid migration failures until production.',
      },
    ],
  },
  {
    testCase: {
      id: 'angle-aware-repeat-how-selective',
      description: 'A follow-up can re-surface the same chunk when it is explicitly expected to answer a new how-to-apply angle.',
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
      expectedFacts: ['seeded ephemeral database instance', 'seeded ephemeral database path for integration and migration-sensitive tests'],
      minimumExpectedChunkMatches: 1,
      minimumFactMatches: 2,
      maxInjectedTokens: 70,
      forbidWorkspaceLeakage: true,
    },
    candidates: [
      {
        chunkId: 'alpha-proc-angle-aware-how-policy',
        workspaceId: 'workspace-alpha',
        surfacedFacets: ['howToApply'],
        kind: 'procedural',
        score: 0.92,
        text: 'Prefer integration tests against a seeded ephemeral database instance. How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      },
    ],
  },
  {
    testCase: {
      id: 'no-recall-needed',
      description: 'Does not inject memory when the query is fully local to the current turn.',
      workspaceId: 'workspace-alpha',
      query: 'Summarize the code block I just pasted.',
      kind: 'mixed',
      requireNoRecall: true,
      maxInjectedTokens: 0,
    },
    candidates: [],
  },
];
