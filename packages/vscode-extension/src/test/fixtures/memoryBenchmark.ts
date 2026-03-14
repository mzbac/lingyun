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
