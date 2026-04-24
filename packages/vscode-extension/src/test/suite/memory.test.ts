import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { TOOL_ERROR_CODES } from '@kooka/core';
import { WorkspaceMemories, deriveWorkspaceMemoryId } from '../../core/memories';
import { buildMemoryRecords, buildStage1Output } from '../../core/memories/ingest';
import { planMemoryUpdate } from '../../core/memories/planner';
import { getMemoryArtifacts, rebuildMemoryArtifacts, readMemoriesState, writeMemoriesState } from '../../core/memories/storage';
import { buildConsolidatedMemoryEntries, renderMemoryFields, renderRawRecordEvidence, renderSelectiveMemorySurfaceLines, renderSummaryRecordText, selectiveMemoryFieldPriority, selectiveMemoryPrimaryLabel, shouldSurfaceSelectiveHowToApply } from '../../core/memories/consolidate';
import { STAGE1_OUTPUTS_FILE, STATE_VERSION, type ConsolidatedMemoryEntry } from '../../core/memories/model';
import { searchMemoryRecords } from '../../core/memories/search';
import { SessionStore } from '../../core/sessionStore';
import { createBlankSessionSignals, deriveStructuredMemoriesFromText, extractExplicitForgetPayload, extractExplicitForgetScopeHint, extractExplicitMemoryRecallQuery, extractExplicitMemoryRecallScopeHint, extractExplicitRememberPayload, extractExplicitRememberScopeHint, hasDerivableCodebaseMemoryPayload, hasExplicitForgetMemoryIntent, hasExplicitMemoryRecallIntent, hasExplicitRememberDerivableMemoryPayload, hasExplicitRememberMemoryIntent, hasGeneratedMemoryArtifactPayload, hasMemoryOptOutIntent, hasMemorySecretPayload, hasRepositoryInstructionPayload, hasSessionMemoryDisableIntent, hasSessionMemoryEnableIntent, hasSkillInstructionPayload, isExplicitMemoryCandidate, isSessionMemoryDisabled, markExternalMemoryContext, recordAssistantOutcome, recordConstraint, recordDecision, recordFileTouch, recordPreference, recordProcedure, recordStructuredMemory, recordToolUse, recordUserIntent, shouldExcludeUserTextFromMemoryCapture } from '../../core/sessionSignals';
import { getMemoryHandler } from '../../tools/builtin/getMemory';
import { maintainMemoryHandler } from '../../tools/builtin/maintainMemory';
import { updateMemoryHandler } from '../../tools/builtin/updateMemory';

function createToolContext(params: { storageRoot: vscode.Uri }): ToolContext {
  return {
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
    activeEditor: vscode.window.activeTextEditor,
    extensionContext: {
      storageUri: params.storageRoot,
      globalStorageUri: params.storageRoot,
    } as unknown as vscode.ExtensionContext,
    cancellationToken: new vscode.CancellationTokenSource().token,
    progress: { report: () => {} },
    log: () => {},
  };
}

async function seedPersistedSessions(storageRoot: vscode.Uri, sessions: any[]): Promise<void> {
  const store = new SessionStore<any>(storageRoot, {
    maxSessions: 20,
    maxSessionBytes: 2_000_000,
  });
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  await store.save({
    sessionsById,
    activeSessionId: sessions[0]?.id ?? '',
    order: sessions.map(session => session.id),
  });
}

function buildPersistedSession(now: number): any {
  const signals = createBlankSessionSignals(now);
  signals.userIntents = ['Improve the memory system with transcript-backed recall'];
  signals.assistantOutcomes = ['Chunk memory by turn boundary and auto recall relevant context'];
  signals.toolsUsed = ['read', 'grep'];
  signals.filesTouched = ['packages/vscode-extension/src/core/agent/index.ts'];
  recordDecision(signals, 'Use turn-boundary chunking for episodic memory recall.');
  recordProcedure(signals, 'Inject auto recall in AgentLoop.withRun before the main execution path.');
  recordConstraint(signals, 'Integration tests must hit a real database, not mocks.');
  recordPreference(signals, 'Keep embeddings optional later; start with lexical retrieval first.');

  return {
    id: 'session-memory-1',
    title: 'Memory design discussion',
    createdAt: now - 5_000,
    updatedAt: now - 5_000,
    signals,
    mode: 'build',
    stepCounter: 0,
    currentModel: 'mock-model',
    agentState: { history: [] },
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'What did we decide about memory chunking?',
        timestamp: now - 5_000,
        turnId: 'turn-1',
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'We decided to chunk memory by turn boundary and expand neighboring chunks during recall.',
        timestamp: now - 4_900,
        turnId: 'turn-1',
      },
      {
        id: 'm3',
        role: 'user',
        content: 'Where should auto recall be injected?',
        timestamp: now - 4_800,
        turnId: 'turn-2',
      },
      {
        id: 'm4',
        role: 'assistant',
        content: 'Inject it in AgentLoop.withRun near maybeRunExplorePrepass before the main agent execution.',
        timestamp: now - 4_700,
        turnId: 'turn-2',
      },
    ],
    runtime: { wasRunning: false, updatedAt: now - 4_700 },
  };
}

function buildExplicitRememberPersistedSession(now: number): any {
  const signals = createBlankSessionSignals(now);
  const content = 'Remember that pipeline bugs are tracked in Linear project INGEST.';
  recordUserIntent(signals, content);

  return {
    id: 'session-memory-explicit-remember',
    title: 'Explicit memory request',
    createdAt: now - 1_000,
    updatedAt: now,
    signals,
    mode: 'build',
    stepCounter: 0,
    currentModel: 'mock-model',
    agentState: { history: [] },
    messages: [
      {
        id: 'er1',
        role: 'user',
        content,
        timestamp: now,
        turnId: 'turn-explicit-remember',
      },
    ],
    runtime: { wasRunning: true, updatedAt: now },
  };
}

function buildDurableEntry(text: string, overrides: Partial<ConsolidatedMemoryEntry> = {}): ConsolidatedMemoryEntry {
  return {
    key: 'feedback:test-policy',
    text,
    category: 'feedback',
    scope: 'workspace',
    confidence: 0.92,
    evidenceCount: 3,
    freshness: 'fresh',
    lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
    sessionIds: ['session-memory-1'],
    titles: ['Testing policy'],
    rolloutFiles: [],
    filesTouched: ['packages/vscode-extension/src/test/suite/memory.test.ts'],
    toolsUsed: ['maintain_memory'],
    sources: ['user'],
    ...overrides,
  };
}

suite('Memory Tool', () => {
  test('memory storage redacts secrets before persisting state and artifacts', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-memory-redaction-storage');
    const memoryRoot = vscode.Uri.joinPath(storageRoot, 'memories');
    const stateFile = vscode.Uri.joinPath(memoryRoot, 'stage1_outputs.json');
    const rawSecret = 'sk-proj-1234567890abcdefghijklmnopqrstuv';
    const githubSecret = 'ghp_1234567890abcdefghijklmnopqrstuvABCD';
    const awsSecret = 'AKIAABCDEFGHIJKLMNOP';

    try {
      const output = {
        sessionId: 'session-secret-redaction',
        title: `Investigate leaked token ${rawSecret}`,
        sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
        generatedAt: Date.parse('2026-01-01T10:01:00.000Z'),
        cwd: `/workspace?token=${githubSecret}`,
        rawMemory: `User pasted api_key=${rawSecret} and url https://user:${githubSecret}@example.com/private`,
        rolloutSummary: `# Session Memory\n\nAuthorization: Bearer ${githubSecret}\nAWS ${awsSecret}`,
        rolloutFile: '2026-01-01T10-00-00-000Z-secret-redaction.md',
        userIntents: [`Do not store token ${rawSecret}`],
        assistantOutcomes: [`Redacted ${githubSecret}`],
        filesTouched: [`/tmp/config?access_token=${githubSecret}`],
        toolsUsed: ['read'],
        structuredMemories: [
          {
            kind: 'constraint' as const,
            text: `Never persist password=${rawSecret}`,
            scope: 'workspace' as const,
            confidence: 0.9,
            source: 'user' as const,
            evidenceCount: 1,
            memoryKey: `constraint:${rawSecret}`,
          },
        ],
      };
      const record = {
        id: 'record-secret-redaction',
        workspaceId: 'workspace-secret-redaction',
        sessionId: output.sessionId,
        kind: 'episodic' as const,
        title: `Secret transcript ${rawSecret}`,
        text: `Tool output included client_secret=${githubSecret}`,
        sourceUpdatedAt: output.sourceUpdatedAt,
        generatedAt: output.generatedAt,
        filesTouched: [`/tmp/.env?api_key=${rawSecret}`],
        toolsUsed: ['grep'],
        index: 0,
        scope: 'session' as const,
        confidence: 0.74,
        evidenceCount: 1,
        lastConfirmedAt: output.generatedAt,
        staleness: 'fresh' as const,
        memoryKey: `turn:${rawSecret}`,
      };

      await writeMemoriesState(memoryRoot, stateFile, {
        version: 3,
        outputs: [output],
        records: [record],
      });
      const rawState = new TextDecoder().decode(await vscode.workspace.fs.readFile(stateFile));
      assert.ok(!rawState.includes(rawSecret));
      assert.ok(!rawState.includes(githubSecret));
      assert.ok(!rawState.includes(awsSecret));
      assert.ok(rawState.includes('[REDACTED_SECRET]'));

      const state = await readMemoriesState(stateFile);
      assert.ok(!JSON.stringify(state).includes(rawSecret));
      assert.ok(!JSON.stringify(state).includes(githubSecret));

      const artifacts = getMemoryArtifacts(memoryRoot);
      assert.ok(artifacts);
      await rebuildMemoryArtifacts(artifacts, [output], [record]);
      const artifactTexts = await Promise.all([
        vscode.workspace.fs.readFile(artifacts.rawMemoriesFile),
        vscode.workspace.fs.readFile(artifacts.memoryFile),
        vscode.workspace.fs.readFile(artifacts.memorySummaryFile),
        vscode.workspace.fs.readFile(vscode.Uri.joinPath(artifacts.rolloutSummariesDir, output.rolloutFile)),
      ]);
      const combinedArtifacts = artifactTexts.map((bytes) => new TextDecoder().decode(bytes)).join('\n');
      assert.ok(!combinedArtifacts.includes(rawSecret));
      assert.ok(!combinedArtifacts.includes(githubSecret));
      assert.ok(!combinedArtifacts.includes(awsSecret));
      assert.ok(combinedArtifacts.includes('[REDACTED_SECRET]'));
    } finally {
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('memory capture rejects secret-bearing explicit remember requests before persistence', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const rawSecret = 'sk-proj-1234567890abcdefghijklmnopqrstuv';
    const request = `Remember this: production api_key=${rawSecret}`;

    assert.strictEqual(hasMemorySecretPayload(request), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(request), true);
    assert.deepStrictEqual(
      deriveStructuredMemoriesFromText(request, { source: 'user', defaultScope: 'user' }),
      [],
    );

    recordUserIntent(signals, request);
    recordAssistantOutcome(signals, `Stored the production api_key=${rawSecret}.`);
    recordStructuredMemory(signals, {
      kind: 'constraint',
      text: `Never persist password=${rawSecret}`,
      scope: 'workspace',
      confidence: 0.9,
      source: 'user',
      memoryKey: `constraint:${rawSecret}`,
    });

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.assistantOutcomes, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('memory ingest skips secret-bearing legacy transcript and signal values', () => {
    const now = Date.parse('2026-01-01T10:00:00.000Z');
    const rawSecret = 'ghp_1234567890abcdefghijklmnopqrstuvABCD';
    const signals = createBlankSessionSignals(now);
    signals.userIntents = [
      `Remember api_key=${rawSecret}`,
      'Keep the rollout checklist available for release validation.',
    ];
    signals.assistantOutcomes = [
      `The OAuth token=${rawSecret} was copied.`,
      'Captured durable release validation guidance.',
    ];
    signals.structuredMemories = [
      {
        kind: 'constraint',
        text: `Never store client_secret=${rawSecret}`,
        scope: 'workspace',
        confidence: 0.9,
        source: 'user',
        evidenceCount: 1,
        memoryKey: `constraint:${rawSecret}`,
      },
      {
        kind: 'procedure',
        text: 'Use the rollout checklist when release validation fails.',
        scope: 'workspace',
        confidence: 0.88,
        source: 'user',
        evidenceCount: 1,
        memoryKey: 'procedure:rollout-checklist',
      },
    ];

    const session = {
      id: 'session-sensitive-ingest',
      title: 'Sensitive ingest regression',
      createdAt: now - 1_000,
      updatedAt: now,
      signals,
      mode: 'build' as const,
      messages: [
        {
          id: 'm-secret',
          role: 'user',
          content: `The production token is ${rawSecret}.`,
          timestamp: now - 500,
          turnId: 'turn-secret',
        },
        {
          id: 'm-safe',
          role: 'assistant',
          content: 'Use the rollout checklist when release validation fails.',
          timestamp: now - 400,
          turnId: 'turn-safe',
        },
      ],
    };

    const stage1 = buildStage1Output({
      session,
      cwd: '/workspace/project',
      generatedAt: now + 1_000,
    });
    const records = buildMemoryRecords({
      session,
      stage1,
      workspaceId: 'workspace-sensitive-ingest',
    });
    const combined = JSON.stringify({ stage1, records });

    assert.ok(!combined.includes(rawSecret));
    assert.ok(!combined.includes('[REDACTED_SECRET]'));
    assert.deepStrictEqual(stage1.userIntents, ['Keep the rollout checklist available for release validation.']);
    assert.deepStrictEqual(stage1.assistantOutcomes, ['Captured durable release validation guidance.']);
    assert.deepStrictEqual(stage1.structuredMemories.map((item) => item.memoryKey), ['procedure:rollout-checklist']);
    assert.ok(records.some((record) => record.kind === 'episodic' && record.text.includes('rollout checklist')));
    assert.ok(!records.some((record) => record.text.includes('production token')));
  });

  test('memory capture ignores explicit remember requests for derivable codebase facts', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const request = 'Remember this: model selection is implemented in packages/vscode-extension/src/core/modelSelection.ts.';

    assert.strictEqual(hasExplicitRememberMemoryIntent(request), true);
    assert.strictEqual(hasDerivableCodebaseMemoryPayload('model selection is implemented in packages/vscode-extension/src/core/modelSelection.ts.'), true);
    assert.strictEqual(hasExplicitRememberDerivableMemoryPayload(request), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(request), true);
    assert.deepStrictEqual(
      deriveStructuredMemoriesFromText(request, { source: 'user', defaultScope: 'workspace' }),
      [],
    );

    recordUserIntent(signals, request);
    recordAssistantOutcome(signals, 'The model selection entry point lives in packages/vscode-extension/src/core/modelSelection.ts.');

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.assistantOutcomes, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('memory ingest skips legacy explicit codebase-fact turns and structured candidates', () => {
    const now = Date.parse('2026-01-01T10:00:00.000Z');
    const signals = createBlankSessionSignals(now);
    signals.userIntents = [
      'model selection is implemented in packages/vscode-extension/src/core/modelSelection.ts.',
      'Keep the rollout checklist available for release validation.',
    ];
    signals.structuredMemories = [
      {
        kind: 'decision',
        text: 'Responses stream parsing is implemented in packages/vscode-extension/src/providers/responsesModel.ts.',
        scope: 'workspace',
        confidence: 0.9,
        source: 'user',
        evidenceCount: 1,
        memoryKey: 'decision:responses-stream-parser-path',
      },
      {
        kind: 'procedure',
        text: 'Use the rollout checklist when release validation fails.',
        scope: 'workspace',
        confidence: 0.88,
        source: 'user',
        evidenceCount: 1,
        memoryKey: 'procedure:rollout-checklist',
      },
    ];

    const session = {
      id: 'session-codebase-fact-ingest',
      title: 'Codebase fact ingest regression',
      createdAt: now - 1_000,
      updatedAt: now,
      signals,
      mode: 'build' as const,
      messages: [
        {
          id: 'm-codebase-user',
          role: 'user',
          content: 'Remember this: model selection is implemented in packages/vscode-extension/src/core/modelSelection.ts.',
          timestamp: now - 500,
          turnId: 'turn-codebase-fact',
        },
        {
          id: 'm-codebase-assistant',
          role: 'assistant',
          content: 'Saved that modelSelection.ts is the model-selection entry point.',
          timestamp: now - 450,
          turnId: 'turn-codebase-fact',
        },
        {
          id: 'm-safe',
          role: 'assistant',
          content: 'Use the rollout checklist when release validation fails.',
          timestamp: now - 400,
          turnId: 'turn-safe',
        },
      ],
    };

    const stage1 = buildStage1Output({
      session,
      cwd: '/workspace/project',
      generatedAt: now + 1_000,
    });
    const records = buildMemoryRecords({
      session,
      stage1,
      workspaceId: 'workspace-codebase-fact-ingest',
    });
    const combined = JSON.stringify({ stage1, records });

    assert.ok(!combined.includes('modelSelection.ts'));
    assert.ok(!combined.includes('responsesModel.ts'));
    assert.deepStrictEqual(stage1.userIntents, ['Keep the rollout checklist available for release validation.']);
    assert.deepStrictEqual(stage1.structuredMemories.map((item) => item.memoryKey), ['procedure:rollout-checklist']);
    assert.ok(records.some((record) => record.text.includes('rollout checklist')));
  });

  test('memory capture ignores generated memory artifact payloads', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const payload = [
      '# Memory Summary',
      '',
      'Generated automatically. Read this first, then open MEMORY.md only when needed.',
      '',
      '- Focus item from a previous run',
    ].join('\n');

    assert.strictEqual(hasGeneratedMemoryArtifactPayload(payload), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(payload), true);
    assert.deepStrictEqual(
      deriveStructuredMemoriesFromText(payload, { source: 'user', defaultScope: 'workspace' }),
      [],
    );

    recordUserIntent(signals, payload);
    recordAssistantOutcome(signals, payload);

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.assistantOutcomes, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('memory ingest skips generated memory artifact transcript and signal values', () => {
    const now = Date.parse('2026-01-01T10:00:00.000Z');
    const memoryArtifact = [
      '# MEMORY',
      '',
      'Generated automatically from persisted LingYun sessions.',
      'This file is rewritten by the memory pipeline.',
      '',
      '- stale self-referential focus item',
    ].join('\n');
    const topicArtifact = [
      '# Memory Topic: Feedback and Constraints',
      '',
      '- guidance: stale self-referential topic item',
    ].join('\n');
    const signals = createBlankSessionSignals(now);
    signals.userIntents = [memoryArtifact, 'Keep the rollout checklist available for release validation.'];
    signals.filesTouched = ['memories/MEMORY.md', 'memories/memory_topics/feedback.md', 'src/feature.ts'];
    signals.structuredMemories = [
      {
        kind: 'procedure',
        text: topicArtifact,
        scope: 'workspace',
        confidence: 0.88,
        source: 'user',
        evidenceCount: 1,
        memoryKey: 'procedure:self-referential-topic',
      },
      {
        kind: 'procedure',
        text: 'Use the rollout checklist when release validation fails.',
        scope: 'workspace',
        confidence: 0.88,
        source: 'user',
        evidenceCount: 1,
        memoryKey: 'procedure:rollout-checklist',
      },
    ];

    const session = {
      id: 'session-memory-artifact-ingest',
      title: 'Memory artifact ingest regression',
      createdAt: now - 1_000,
      updatedAt: now,
      signals,
      mode: 'build' as const,
      messages: [
        {
          id: 'm-memory-tool',
          role: 'tool',
          content: memoryArtifact,
          timestamp: now - 500,
          turnId: 'turn-memory-artifact',
          toolCall: {
            name: 'read',
            path: 'memories/MEMORY.md',
            result: memoryArtifact,
            batchFiles: ['memories/memory_summary.md'],
          },
        },
        {
          id: 'm-safe',
          role: 'assistant',
          content: 'Use the rollout checklist when release validation fails.',
          timestamp: now - 400,
          turnId: 'turn-safe',
        },
      ],
    };

    const stage1 = buildStage1Output({
      session,
      cwd: '/workspace/project',
      generatedAt: now + 1_000,
    });
    const records = buildMemoryRecords({
      session,
      stage1,
      workspaceId: 'workspace-memory-artifact-ingest',
    });
    const combined = JSON.stringify({ stage1, records });

    assert.ok(!combined.includes('stale self-referential'));
    assert.ok(!combined.includes('memories/MEMORY.md'));
    assert.ok(!combined.includes('memory_summary.md'));
    assert.deepStrictEqual(stage1.userIntents, ['Keep the rollout checklist available for release validation.']);
    assert.deepStrictEqual(stage1.filesTouched, ['src/feature.ts']);
    assert.deepStrictEqual(stage1.structuredMemories.map((item) => item.memoryKey), ['procedure:rollout-checklist']);
    assert.ok(records.some((record) => record.text.includes('rollout checklist')));
  });

  test('get_memory redacts legacy artifact files on read', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-memory-redaction-legacy');
    const memoryRoot = vscode.Uri.joinPath(storageRoot, 'memories');
    const rolloutDir = vscode.Uri.joinPath(memoryRoot, 'rollout_summaries');
    const rawSecret = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
    const rolloutFileName = '2026-01-01T10-00-00-000Z-legacy.md';

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoryRoot.fsPath;
      await cfg.update('features.memories', true, true);
      await vscode.workspace.fs.createDirectory(rolloutDir);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(memoryRoot, 'memory_summary.md'), Buffer.from(`# Summary\napi_key=${rawSecret}\n`, 'utf8'));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(memoryRoot, 'MEMORY.md'), Buffer.from(`# Memory\nBearer ${rawSecret}\n`, 'utf8'));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(memoryRoot, 'raw_memories.md'), Buffer.from(`# Raw\nhttps://user:${rawSecret}@example.com\n`, 'utf8'));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(rolloutDir, rolloutFileName), Buffer.from(`# Rollout\nclient_secret=${rawSecret}\n`, 'utf8'));

      const context = createToolContext({ storageRoot });
      for (const args of [{ view: 'summary' }, { view: 'memory' }, { view: 'raw' }, { view: 'rollout', rolloutFile: rolloutFileName }]) {
        const result = await getMemoryHandler({ ...args, maxChars: 20_000 }, context);
        assert.strictEqual(result.success, true);
        const text = String(result.data);
        assert.ok(!text.includes(rawSecret));
        assert.ok(text.includes('[REDACTED_SECRET]'));
      }
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('memory artifacts keep MEMORY.md compact and write detailed topic files', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-memory-topics-storage');
    const memoryRoot = vscode.Uri.joinPath(storageRoot, 'memories');

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoryRoot.fsPath;
      await cfg.update('features.memories', true, true);

      const output = {
        sessionId: 'session-topic-artifacts',
        title: 'Testing policy refinement',
        sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
        generatedAt: Date.parse('2026-01-01T10:01:00.000Z'),
        cwd: root.fsPath,
        rawMemory: 'User corrected the testing policy.',
        rolloutSummary: '# Session Memory\n\nTesting policy refinement.',
        rolloutFile: '2026-01-01T10-00-00-000Z-testing-policy.md',
        userIntents: ['Do not mock the database in integration tests.'],
        assistantOutcomes: ['Captured durable testing guidance.'],
        filesTouched: ['packages/vscode-extension/src/test/suite/memory.test.ts'],
        toolsUsed: ['maintain_memory'],
        structuredMemories: [
          {
            kind: 'constraint' as const,
            text: [
              'Integration tests must hit a real database, not mocks.',
              'Why: prior mocked tests hid migration failures until production.',
              'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
            ].join('\n'),
            scope: 'workspace' as const,
            confidence: 0.92,
            source: 'user' as const,
            evidenceCount: 2,
            memoryKey: 'feedback:db-tests',
          },
        ],
      };

      const artifacts = getMemoryArtifacts(memoryRoot);
      assert.ok(artifacts);
      await rebuildMemoryArtifacts(artifacts, [output], []);

      const memoryIndex = new TextDecoder().decode(await vscode.workspace.fs.readFile(artifacts.memoryFile));
      const feedbackTopic = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(artifacts.memoryTopicsDir, 'feedback.md')),
      );

      assert.ok(memoryIndex.includes('Compact index only'));
      assert.ok(memoryIndex.includes('memory_topics/feedback.md'));
      assert.ok(!memoryIndex.includes('prior mocked tests hid migration failures'));
      assert.ok(feedbackTopic.includes('# Memory Topic: Feedback and Constraints'));
      assert.ok(feedbackTopic.includes('- why: prior mocked tests hid migration failures until production.'));
      assert.ok(feedbackTopic.includes('- durable_key: feedback:db-tests'));

      const context = createToolContext({ storageRoot });
      const listResult = await getMemoryHandler({ view: 'list' }, context);
      assert.strictEqual(listResult.success, true);
      assert.deepStrictEqual((listResult.data as any).topicFiles, ['feedback.md']);

      const topicResult = await getMemoryHandler({ view: 'topic', topicFile: 'feedback.md', maxChars: 20_000 }, context);
      assert.strictEqual(topicResult.success, true);
      assert.ok(String(topicResult.data).includes('<memory view="topic" file="feedback.md">'));
      assert.ok(String(topicResult.data).includes('Integration tests must hit a real database, not mocks.'));
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('get_memory search output redacts secrets from persisted legacy state', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-memory-redaction-search');
    const memoryRoot = vscode.Uri.joinPath(storageRoot, 'memories');
    const stateFile = vscode.Uri.joinPath(memoryRoot, 'stage1_outputs.json');
    const rawSecret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoryRoot.fsPath;
      await cfg.update('features.memories', true, true);
      await vscode.workspace.fs.createDirectory(memoryRoot);
      const workspaceId = deriveWorkspaceMemoryId(root.fsPath);
      await vscode.workspace.fs.writeFile(
        stateFile,
        Buffer.from(JSON.stringify({
          version: 3,
          outputs: [],
          records: [
            {
              id: 'record-secret-legacy',
              workspaceId,
              sessionId: 'session-secret-legacy',
              kind: 'episodic',
              title: `Legacy secret ${rawSecret}`,
              text: `Assistant: investigate leaked secret token=${rawSecret}`,
              sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
              generatedAt: Date.parse('2026-01-01T10:01:00.000Z'),
              filesTouched: [],
              toolsUsed: [],
              index: 0,
              scope: 'session',
              confidence: 0.9,
              evidenceCount: 1,
              lastConfirmedAt: Date.parse('2026-01-01T10:01:00.000Z'),
              staleness: 'fresh',
            },
          ],
        }), 'utf8'),
      );

      const context = createToolContext({ storageRoot });
      const result = await getMemoryHandler({ query: 'investigate leaked secret', maxChars: 20_000 }, context);
      assert.strictEqual(result.success, true);
      const text = String(result.data);
      assert.ok(!text.includes(rawSecret));
      assert.ok(text.includes('[REDACTED_SECRET]'));
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('renderMemoryFields preserves explicit Why and How to apply markers', () => {
    const fields = renderMemoryFields(
      buildDurableEntry(
        [
          'Integration tests must hit a real database, not mocks.',
          'Why: prior mocked tests hid migration failures until production.',
          'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
        ].join('\n'),
      ),
    );

    assert.strictEqual(fields.guidance, 'Integration tests must hit a real database, not mocks.');
    assert.strictEqual(fields.why, 'prior mocked tests hid migration failures until production.');
    assert.strictEqual(
      fields.howToApply,
      'use a seeded ephemeral database path for integration and migration-sensitive tests.',
    );
    assert.ok(fields.hook.startsWith('Integration tests must hit a real database, not mocks.'));
    assert.ok(!fields.hook.startsWith('prior mocked tests hid migration failures'));
  });

  test('renderMemoryFields parses LingYun field-style durable text and ignores metadata', () => {
    const fields = renderMemoryFields(
      buildDurableEntry(
        [
          '- guidance: Prefer integration tests against a seeded ephemeral database instance.',
          '- why: prior mocked tests hid migration failures until production.',
          '- how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
          '- confidence: 0.92',
          '- freshness: fresh',
          '- durable_key: feedback:test-policy',
          '- maintenance: maintain_memory action=supersede durableKey=feedback:test-policy',
        ].join('\n'),
      ),
    );

    assert.strictEqual(fields.guidance, 'Prefer integration tests against a seeded ephemeral database instance.');
    assert.strictEqual(fields.why, 'prior mocked tests hid migration failures until production.');
    assert.strictEqual(
      fields.howToApply,
      'use a seeded ephemeral database path for integration and migration-sensitive tests.',
    );
    assert.ok(fields.hook.startsWith('Prefer integration tests against a seeded ephemeral database instance.'));
    assert.ok(!fields.guidance.includes('confidence: 0.92'));
    assert.ok(!fields.howToApply?.includes('durable_key'));
  });

  test('renderMemoryFields treats fact-style recall text as durable guidance', () => {
    const fields = renderMemoryFields(
      buildDurableEntry(
        [
          'fact: Prefer integration tests against a seeded ephemeral database instance.',
          'why: prior mocked tests hid migration failures until production.',
          'how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
          'maintenance_hint: maintain_memory action=<invalidate|confirm|supersede> durableKey=feedback:test-policy',
        ].join('\n'),
      ),
    );

    assert.strictEqual(fields.guidance, 'Prefer integration tests against a seeded ephemeral database instance.');
    assert.strictEqual(fields.why, 'prior mocked tests hid migration failures until production.');
    assert.strictEqual(
      fields.howToApply,
      'use a seeded ephemeral database path for integration and migration-sensitive tests.',
    );
    assert.strictEqual(fields.howToApplySource, 'explicit');
    assert.ok(!fields.guidance.includes('maintenance_hint'));
  });

  test('renderMemoryFields marks synthesized how_to_apply guidance as default', () => {
    const fields = renderMemoryFields(buildDurableEntry('Integration tests must hit a real database, not mocks.'));

    assert.strictEqual(fields.guidance, 'Integration tests must hit a real database, not mocks.');
    assert.strictEqual(
      fields.howToApply,
      'Apply this by default on similar tasks in this workspace unless newer guidance overrides it.',
    );
    assert.strictEqual(fields.howToApplySource, 'default');
  });

  test('renderMemoryFields preserves explicit project how_to_apply guidance parsed from structured text', () => {
    const fields = renderMemoryFields(
      buildDurableEntry(
        [
          "We're ripping out the old auth middleware.",
          "Why: Legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements, so scope decisions should favor compliance over ergonomics.",
          'How to apply: Scope decisions should favor compliance over ergonomics.',
        ].join('\n'),
        { category: 'project' },
      ),
    );

    assert.strictEqual(fields.guidance, "We're ripping out the old auth middleware.");
    assert.strictEqual(
      fields.why,
      "Legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements, so scope decisions should favor compliance over ergonomics.",
    );
    assert.strictEqual(fields.howToApply, 'Scope decisions should favor compliance over ergonomics.');
    assert.strictEqual(fields.howToApplySource, 'explicit');
  });

  test('deriveStructuredMemoriesFromText captures validated positive workflow feedback from user confirmation', () => {
    const candidates = deriveStructuredMemoriesFromText(
      "Yeah the single bundled PR was the right call here, splitting this one would've just been churn.",
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.kind, 'preference');
    assert.strictEqual(candidates[0]?.scope, 'workspace');
    assert.strictEqual(
      candidates[0]?.text,
      "Prefer one bundled PR over splitting tightly related work into many small PRs.\nWhy: Splitting this one would've just been churn.",
    );
  });

  test('deriveStructuredMemoriesFromText ignores vague positive praise that lacks reusable guidance', () => {
    const candidates = deriveStructuredMemoriesFromText('Yeah that approach was the right call here.', {
      source: 'user',
      defaultScope: 'user',
    });

    assert.deepStrictEqual(candidates, []);
  });

  test('deriveStructuredMemoriesFromText normalizes corrective workflow feedback into reusable guidance', () => {
    const candidates = deriveStructuredMemoriesFromText(
      "Don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed.",
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.kind, 'constraint');
    assert.strictEqual(candidates[0]?.scope, 'workspace');
    assert.strictEqual(
      candidates[0]?.text,
      'Integration tests must hit a real database, not mocks.\nWhy: We got burned last quarter when mocked tests passed but the prod migration failed.',
    );
  });

  test('deriveStructuredMemoriesFromText preserves explicit corrective feedback how-to-apply guidance', () => {
    const candidates = deriveStructuredMemoriesFromText(
      "Don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed. For integration and migration-sensitive tests, use a seeded ephemeral database path.",
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.kind, 'constraint');
    assert.strictEqual(
      candidates[0]?.text,
      [
        'Integration tests must hit a real database, not mocks.',
        'Why: We got burned last quarter when mocked tests passed but the prod migration failed.',
        'How to apply: For integration and migration-sensitive tests, use a seeded ephemeral database path.',
      ].join('\n'),
    );
  });

  test('deriveStructuredMemoriesFromText ignores derivable code fix recipes from assistant text', () => {
    const candidates = deriveStructuredMemoriesFromText(
      'Fixed the Responses stream parser by updating packages/vscode-extension/src/providers/responsesModel.ts and running pnpm test.',
      { source: 'assistant', defaultScope: 'workspace' },
    );

    assert.deepStrictEqual(candidates, []);

    const operational = deriveStructuredMemoriesFromText(
      'Step 1: use the rollout checklist when release validation fails.',
      { source: 'assistant', defaultScope: 'workspace' },
    );
    assert.ok(operational.some((candidate) => candidate.kind === 'procedure'));
  });

  test('recordUserIntent normalizes corrective communication feedback into a user preference', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(signals, 'Stop summarizing what you just did at the end of every response, I can read the diff.');

    const candidate = signals.structuredMemories.find((item) => item.kind === 'preference');
    assert.ok(candidate);
    assert.strictEqual(candidate?.scope, 'user');
    assert.strictEqual(
      candidate?.text,
      'Prefer terse responses with no trailing summaries.\nWhy: I can read the diff.',
    );
  });

  test('recordUserIntent ignores memory opt-out requests', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    assert.strictEqual(hasMemoryOptOutIntent('Do not use memories. Answer only from this prompt.'), true);

    recordUserIntent(signals, 'Do not use memories. Answer only from this prompt.');

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('session memory mode disables and re-enables later capture', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const disableRequest = "Don't save this conversation to memory.";
    const enableRequest = 'Enable memory for this session again.';

    assert.strictEqual(hasSessionMemoryDisableIntent(disableRequest), true);
    assert.strictEqual(hasSessionMemoryEnableIntent(enableRequest), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(disableRequest), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(enableRequest), true);

    recordUserIntent(signals, disableRequest);
    assert.strictEqual(isSessionMemoryDisabled(signals), true);
    assert.strictEqual(signals.userIntents.length, 0);

    recordUserIntent(signals, 'Prefer terse responses with no trailing summaries.');
    recordAssistantOutcome(signals, 'Use seeded ephemeral databases for integration tests.');
    recordDecision(signals, 'Pipeline bugs are tracked in Linear project INGEST.');
    recordToolUse(signals, 'read');
    recordFileTouch(signals, 'src/example.ts');

    assert.strictEqual(signals.userIntents.length, 0);
    assert.strictEqual(signals.assistantOutcomes.length, 0);
    assert.strictEqual(signals.structuredMemories.length, 0);
    assert.strictEqual(signals.toolsUsed.length, 0);
    assert.strictEqual(signals.filesTouched.length, 0);

    recordUserIntent(signals, enableRequest);
    assert.strictEqual(isSessionMemoryDisabled(signals), false);

    recordUserIntent(signals, 'Prefer terse responses with no trailing summaries.');
    assert.ok(signals.userIntents.includes('Prefer terse responses with no trailing summaries.'));
    assert.ok(signals.structuredMemories.some((item) => item.kind === 'preference'));
  });

  test('planMemoryUpdate drops prior records for memory-disabled sessions', () => {
    const now = Date.parse('2026-01-01T10:00:00.000Z');
    const oldSignals = createBlankSessionSignals(now - 10_000);
    oldSignals.userIntents = ['Remember the release checklist preference.'];
    recordDecision(oldSignals, 'Use the release checklist before publishing.');
    const sessionBase = {
      id: 'session-memory-disabled',
      title: 'Memory disabled session',
      createdAt: now - 20_000,
      updatedAt: now - 10_000,
      mode: 'build' as const,
      messages: [],
    };
    const oldSession = { ...sessionBase, signals: oldSignals };
    const oldStage1 = buildStage1Output({
      session: oldSession,
      cwd: '/workspace/project',
      generatedAt: now - 5_000,
    });
    const oldRecords = buildMemoryRecords({
      session: oldSession,
      stage1: oldStage1,
      workspaceId: 'workspace-memory-disabled',
    });

    const disabledSignals = createBlankSessionSignals(now);
    disabledSignals.userIntents = ['This should not be retained.'];
    recordUserIntent(disabledSignals, 'Disable memory for this session.');

    const result = planMemoryUpdate({
      sessions: [{ ...sessionBase, updatedAt: now, signals: disabledSignals }],
      prev: {
        version: STATE_VERSION,
        outputs: [oldStage1],
        records: oldRecords,
      },
      config: {
        enabled: true,
        maxRawMemoriesForGlobal: 20,
        maxRolloutAgeDays: 30,
        maxRolloutsPerStartup: 20,
        minRolloutIdleHours: 0,
        maxStateOutputs: 100,
        maxRecords: 200,
        maxSearchResults: 8,
        maxResultsPerKind: 3,
        searchNeighborWindow: 1,
        autoRecall: true,
        maxAutoRecallResults: 4,
        maxAutoRecallTokens: 1200,
        autoRecallMinScore: 7,
        autoRecallMinScoreGap: 1.25,
        autoRecallMaxAgeDays: 45,
      },
      workspaceId: 'workspace-memory-disabled',
      workspaceRootPath: '/workspace/project',
      now,
    });

    assert.strictEqual(result.result.processedSessions, 0);
    assert.strictEqual(result.result.skippedMemoryDisabledSessions, 1);
    assert.deepStrictEqual(result.state.outputs, []);
    assert.deepStrictEqual(result.state.records, []);
  });

  test('memory ingest skips disabled-period transcript after session memory is re-enabled', () => {
    const now = Date.parse('2026-01-01T10:00:00.000Z');
    const signals = createBlankSessionSignals(now);
    recordUserIntent(signals, 'Enable memory for this session again.');
    recordUserIntent(signals, 'Prefer terse responses with no trailing summaries.');
    recordAssistantOutcome(signals, 'Use the rollout checklist when release validation fails.');

    const session = {
      id: 'session-memory-disabled-period',
      title: 'Memory disabled period',
      createdAt: now - 10_000,
      updatedAt: now,
      signals,
      mode: 'build' as const,
      messages: [
        {
          id: 'm-disable',
          role: 'user',
          content: "Don't save this conversation to memory.",
          timestamp: now - 9_000,
          turnId: 'turn-disable',
          memoryExcluded: true,
        },
        {
          id: 'm-disabled-user',
          role: 'user',
          content: 'During the disabled period, prefer verbose executive summaries.',
          timestamp: now - 8_000,
          turnId: 'turn-disabled',
          memoryExcluded: true,
        },
        {
          id: 'm-disabled-assistant',
          role: 'assistant',
          content: 'Disabled period response mentions verbose executive summaries.',
          timestamp: now - 7_900,
          turnId: 'turn-disabled',
        },
        {
          id: 'm-enable',
          role: 'user',
          content: 'Enable memory for this session again.',
          timestamp: now - 7_000,
          turnId: 'turn-enable',
          memoryExcluded: true,
        },
        {
          id: 'm-enabled-user',
          role: 'user',
          content: 'Prefer terse responses with no trailing summaries.',
          timestamp: now - 6_000,
          turnId: 'turn-enabled',
        },
        {
          id: 'm-enabled-assistant',
          role: 'assistant',
          content: 'Use the rollout checklist when release validation fails.',
          timestamp: now - 5_900,
          turnId: 'turn-enabled',
        },
      ],
    };

    const stage1 = buildStage1Output({
      session,
      cwd: '/workspace/project',
      generatedAt: now + 1_000,
    });
    const records = buildMemoryRecords({
      session,
      stage1,
      workspaceId: 'workspace-memory-disabled-period',
    });
    const combined = JSON.stringify({ stage1, records });

    assert.ok(combined.includes('Prefer terse responses with no trailing summaries.'));
    assert.ok(combined.includes('rollout checklist'));
    assert.ok(!combined.includes('verbose executive summaries'));
    assert.ok(!combined.includes("Don't save this conversation"));
    assert.ok(!combined.includes('Enable memory for this session again'));
  });

  test('recordUserIntent ignores explicit forget-memory requests', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const request = 'Forget that pipeline bugs are tracked in Linear project INGEST.';

    assert.strictEqual(hasMemoryOptOutIntent(request), false);
    assert.strictEqual(hasExplicitForgetMemoryIntent(request), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(request), true);
    assert.strictEqual(extractExplicitForgetPayload(request), 'pipeline bugs are tracked in Linear project INGEST.');
    assert.strictEqual(extractExplicitForgetScopeHint(request), undefined);
    assert.strictEqual(
      extractExplicitForgetPayload('Forget project memory about pipeline bugs are tracked in Linear project INGEST.'),
      'pipeline bugs are tracked in Linear project INGEST.',
    );
    assert.strictEqual(
      extractExplicitForgetScopeHint('Forget project memory about pipeline bugs are tracked in Linear project INGEST.'),
      'workspace',
    );
    assert.strictEqual(extractExplicitForgetPayload('Remove local memory about temporary repro id PIPE-421.'), 'temporary repro id PIPE-421.');
    assert.strictEqual(extractExplicitForgetScopeHint('Remove local memory about temporary repro id PIPE-421.'), 'session');
    assert.strictEqual(extractExplicitForgetPayload('Delete personal memory about terse responses.'), 'terse responses.');
    assert.strictEqual(extractExplicitForgetScopeHint('Delete personal memory about terse responses.'), 'user');
    assert.strictEqual(hasExplicitForgetMemoryIntent('Clear local memories.'), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture('Clear local memories.'), true);
    assert.strictEqual(extractExplicitForgetPayload('Clear local memories.'), '');
    assert.strictEqual(extractExplicitForgetScopeHint('Clear local memories.'), 'session');
    assert.deepStrictEqual(
      deriveStructuredMemoriesFromText(request, { source: 'user', defaultScope: 'workspace' }),
      [],
    );

    recordUserIntent(signals, request);

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('forget-memory detection does not treat reminders as deletion requests', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const reminder = "Don't forget to run migration tests before release.";

    assert.strictEqual(hasExplicitForgetMemoryIntent(reminder), false);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(reminder), false);

    recordUserIntent(signals, reminder);

    assert.ok(signals.userIntents.includes(reminder));
  });

  test('recordUserIntent ignores explicit memory recall requests', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const request = 'What do you remember about pipeline bugs in INGEST?';

    assert.strictEqual(hasExplicitMemoryRecallIntent(request), true);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(request), true);
    assert.ok(extractExplicitMemoryRecallQuery(request).includes('pipeline bugs'));
    assert.strictEqual(extractExplicitMemoryRecallScopeHint(request), undefined);
    assert.strictEqual(
      extractExplicitMemoryRecallScopeHint('What do you remember for this project about pipeline bugs in INGEST?'),
      'workspace',
    );
    assert.strictEqual(extractExplicitMemoryRecallScopeHint('Recall what we decided in this session about deploy.'), 'session');
    assert.strictEqual(extractExplicitMemoryRecallScopeHint('What do you remember about me?'), 'user');
    assert.strictEqual(extractExplicitMemoryRecallScopeHint('What do you remember in local memory about the repro id?'), 'session');
    assert.strictEqual(extractExplicitMemoryRecallScopeHint('Check team memory for database testing policy.'), 'workspace');
    assert.strictEqual(extractExplicitMemoryRecallScopeHint('Search personal memory for response style.'), 'user');
    assert.strictEqual(extractExplicitMemoryRecallScopeHint('Remember for this project: prefer pnpm.'), undefined);
    assert.deepStrictEqual(
      deriveStructuredMemoriesFromText(request, { source: 'user', defaultScope: 'workspace' }),
      [],
    );

    recordUserIntent(signals, request);

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('memory recall detection does not treat memory implementation work as recall', () => {
    const request = 'Implement the memory improvement in the retrieval planner.';
    const rememberRequest = 'Remember that pipeline bugs are tracked in Linear project INGEST.';

    assert.strictEqual(hasExplicitMemoryRecallIntent(request), false);
    assert.strictEqual(shouldExcludeUserTextFromMemoryCapture(request), false);
    assert.strictEqual(hasExplicitMemoryRecallIntent(rememberRequest), false);
  });

  test('recordUserIntent ignores repository instruction payloads', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const payload = [
      '# AGENTS.md instructions for /repo',
      '',
      '<INSTRUCTIONS>',
      '## Development Policy',
      'instruction-filter-marker should stay out of memory.',
      'Current architecture and source of truth live in files.',
      '</INSTRUCTIONS>',
    ].join('\n');

    assert.strictEqual(hasRepositoryInstructionPayload(payload), true);
    assert.deepStrictEqual(
      deriveStructuredMemoriesFromText(payload, { source: 'user', defaultScope: 'workspace' }),
      [],
    );

    recordUserIntent(signals, payload);

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('recordUserIntent ignores skill instruction payloads', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    const payload = [
      '## Skill: rollout-checklist',
      '',
      '**Base directory**: .lingyun/skills/rollout-checklist',
      '',
      'Step 1: use skill-scaffolding-marker before release validation.',
    ].join('\n');

    assert.strictEqual(hasSkillInstructionPayload(payload), true);
    assert.deepStrictEqual(
      deriveStructuredMemoriesFromText(payload, { source: 'tool', defaultScope: 'workspace' }),
      [],
    );

    recordUserIntent(signals, payload);

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('deriveStructuredMemoriesFromText captures explicit remember payload without the wrapper', () => {
    const request = 'Remember this: Integration tests must hit a real database, not mocks. Why: Prior mocked tests hid migration failures. How to apply: for migration-sensitive tests, use seeded ephemeral databases.';
    const candidates = deriveStructuredMemoriesFromText(
      request,
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(hasExplicitRememberMemoryIntent(request), true);
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.kind, 'constraint');
    assert.strictEqual(candidates[0]?.scope, 'workspace');
    assert.strictEqual(isExplicitMemoryCandidate(candidates[0]), true);
    assert.ok(candidates[0]?.text.includes('Integration tests must hit a real database, not mocks.'));
    assert.ok(!candidates[0]?.text.includes('Remember this'));
  });

  test('explicit remember parsing strips scope hints and preserves requested scope', () => {
    const projectRequest = 'Remember for this project: prefer one bundled PR over splitting tightly related work.';
    const sessionRequest = 'Remember this: for this session only: the temporary repro id is PIPE-421.';
    const globalRequest = 'Save globally: prefer terse responses with no trailing summaries.';
    const localRequest = 'Remember local memory: the temporary repro id is PIPE-421.';
    const teamRequest = 'Remember team memory: integration tests must hit a real database.';
    const personalRequest = 'Save personal memory: prefer terse responses with no trailing summaries.';

    assert.strictEqual(extractExplicitRememberPayload(projectRequest), 'prefer one bundled PR over splitting tightly related work.');
    assert.strictEqual(extractExplicitRememberScopeHint(projectRequest), 'workspace');
    assert.strictEqual(extractExplicitRememberPayload(sessionRequest), 'the temporary repro id is PIPE-421.');
    assert.strictEqual(extractExplicitRememberScopeHint(sessionRequest), 'session');
    assert.strictEqual(extractExplicitRememberPayload(globalRequest), 'prefer terse responses with no trailing summaries.');
    assert.strictEqual(extractExplicitRememberScopeHint(globalRequest), 'user');
    assert.strictEqual(extractExplicitRememberPayload(localRequest), 'the temporary repro id is PIPE-421.');
    assert.strictEqual(extractExplicitRememberScopeHint(localRequest), 'session');
    assert.strictEqual(extractExplicitRememberPayload(teamRequest), 'integration tests must hit a real database.');
    assert.strictEqual(extractExplicitRememberScopeHint(teamRequest), 'workspace');
    assert.strictEqual(extractExplicitRememberPayload(personalRequest), 'prefer terse responses with no trailing summaries.');
    assert.strictEqual(extractExplicitRememberScopeHint(personalRequest), 'user');
  });

  test('deriveStructuredMemoriesFromText honors explicit remember scope hints', () => {
    const projectCandidates = deriveStructuredMemoriesFromText(
      'Remember for this project: prefer one bundled PR over splitting tightly related work.',
      { source: 'user', defaultScope: 'user' },
    );
    const sessionCandidates = deriveStructuredMemoriesFromText(
      'Remember this: for this session only: the temporary repro id is PIPE-421.',
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(projectCandidates.length, 1);
    assert.strictEqual(projectCandidates[0]?.kind, 'preference');
    assert.strictEqual(projectCandidates[0]?.scope, 'workspace');
    assert.strictEqual(isExplicitMemoryCandidate(projectCandidates[0]), true);
    assert.ok(!projectCandidates[0]?.text.includes('Remember'));

    assert.strictEqual(sessionCandidates.length, 1);
    assert.strictEqual(sessionCandidates[0]?.kind, 'decision');
    assert.strictEqual(sessionCandidates[0]?.scope, 'session');
    assert.strictEqual(sessionCandidates[0]?.text, 'the temporary repro id is PIPE-421.');
    assert.strictEqual(isExplicitMemoryCandidate(sessionCandidates[0]), true);
  });

  test('recordUserIntent saves explicit remember references as durable candidates', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(signals, 'Remember that pipeline bugs are tracked in Linear project INGEST.');

    assert.strictEqual(signals.userIntents[0], 'pipeline bugs are tracked in Linear project INGEST.');
    const candidate = signals.structuredMemories.find((item) => item.kind === 'decision');
    assert.ok(candidate);
    assert.strictEqual(candidate?.scope, 'workspace');
    assert.strictEqual(candidate?.text, 'pipeline bugs are tracked in Linear project INGEST.');
    assert.strictEqual(isExplicitMemoryCandidate(candidate), true);
  });

  test('recordUserIntent keeps explicit remember scope hints out of stored text', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(signals, 'Remember for this project: prefer one bundled PR over splitting tightly related work.');

    assert.strictEqual(signals.userIntents[0], 'prefer one bundled PR over splitting tightly related work.');
    const candidate = signals.structuredMemories.find((item) => item.kind === 'preference');
    assert.ok(candidate);
    assert.strictEqual(candidate?.scope, 'workspace');
    assert.strictEqual(candidate?.text, 'prefer one bundled PR over splitting tightly related work.');
    assert.strictEqual(isExplicitMemoryCandidate(candidate), true);
  });

  test('recordUserIntent ignores explicit save requests for derivable activity summaries', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(
      signals,
      'Save this memory: PR list: #12 updated packages/foo.ts and #13 fixed src/bar.ts after running pnpm test.',
    );

    assert.deepStrictEqual(signals.userIntents, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('recordAssistantOutcome ignores derivable code fix summaries', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordAssistantOutcome(
      signals,
      'Fixed the Responses stream parser by updating packages/vscode-extension/src/providers/responsesModel.ts and running pnpm test.',
    );

    assert.deepStrictEqual(signals.assistantOutcomes, []);
    assert.deepStrictEqual(signals.structuredMemories, []);
  });

  test('deriveStructuredMemoriesFromText ignores transient corrective feedback that is only for the current turn', () => {
    const candidates = deriveStructuredMemoriesFromText('Don\'t do that yet; wait for me to send the logs first.', {
      source: 'user',
      defaultScope: 'user',
    });

    assert.deepStrictEqual(candidates, []);
  });

  test('recordUserIntent captures validated positive communication feedback as a user preference', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(signals, 'Perfect, no trailing summaries was the right call here.');

    const candidate = signals.structuredMemories.find((item) => item.kind === 'preference');
    assert.ok(candidate);
    assert.strictEqual(candidate?.scope, 'user');
    assert.strictEqual(candidate?.text, 'Prefer terse responses with no trailing summaries.');
  });

  test('recordUserIntent preserves explicit validated feedback how-to-apply guidance', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(
      signals,
      "Yeah the single bundled PR was the right call here, splitting this one would've just been churn. For tightly related refactors in this area, keep using one bundled PR.",
    );

    const candidate = signals.structuredMemories.find((item) => item.kind === 'preference');
    assert.ok(candidate);
    assert.strictEqual(candidate?.scope, 'workspace');
    assert.strictEqual(
      candidate?.text,
      [
        'Prefer one bundled PR over splitting tightly related work into many small PRs.',
        "Why: Splitting this one would've just been churn.",
        'How to apply: For tightly related refactors in this area, keep using one bundled PR.',
      ].join('\n'),
    );
  });

  test('recordUserIntent derives structured memories from full user text instead of the shortened intent summary', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(
      signals,
      "Please don't ever mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed. For integration and migration-sensitive tests, use a seeded ephemeral database path.",
    );

    assert.strictEqual(signals.userIntents[0], 'Please don\'t ever mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed. For integration and migration-sensitive tests, use a seeded ephemeral database path.');
    const candidate = signals.structuredMemories.find((item) => item.kind === 'constraint');
    assert.ok(candidate);
    assert.strictEqual(
      candidate?.text,
      [
        'Integration tests must hit a real database, not mocks.',
        'Why: We got burned last quarter when mocked tests passed but the prod migration failed.',
        'How to apply: For integration and migration-sensitive tests, use a seeded ephemeral database path.',
      ].join('\n'),
    );
  });

  test('deriveStructuredMemoriesFromText never emits a partial structured how-to-apply line', () => {
    const candidates = deriveStructuredMemoriesFromText(
      "Don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed. For integration and migration-sensitive tests, use a seeded ephemeral database path and verify migrations, rollback paths, transaction boundaries, and seed data before landing changes.",
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.kind, 'constraint');
    assert.strictEqual(
      candidates[0]?.text,
      [
        'Integration tests must hit a real database, not mocks.',
        'Why: We got burned last quarter when mocked tests passed but the prod migration failed.',
      ].join('\n'),
    );
    assert.ok(!candidates[0]?.text.includes('How to apply: For integration and migration-sensitive tests, use a seeded ephemeral database path and verify migrations...'));
    assert.ok(!candidates[0]?.text.includes('How to apply: For integration and migration-sensitive tests, use a seeded ephemeral database path and verify migrations, rollback paths, transaction boundaries, and seed data before land...'));
  });

  test('recordUserIntent merges repeated validated confirmations by normalized guidance', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(signals, 'Yeah the single bundled PR was the right call here.');
    recordUserIntent(signals, "Yes, the single bundled PR was the right call here, splitting this one would've just been churn.");

    const candidates = signals.structuredMemories.filter((item) => item.kind === 'preference');
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.scope, 'workspace');
    assert.strictEqual(
      candidates[0]?.text,
      "Prefer one bundled PR over splitting tightly related work into many small PRs.\nWhy: Splitting this one would've just been churn.",
    );
    assert.strictEqual(candidates[0]?.evidenceCount, 2);
  });

  test('recordUserIntent normalizes weekday deadlines in project memories to absolute dates', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(signals, "We're freezing all non-critical merges after Thursday — mobile team is cutting a release branch.");

    const decision = signals.structuredMemories.find((item) => item.kind === 'decision');
    assert.ok(decision);
    assert.strictEqual(
      decision?.text,
      "We're freezing all non-critical merges after 2026-01-01.\nWhy: Mobile team is cutting a release branch.",
    );
    assert.strictEqual(decision?.memoryKey, 'decision:we-re-freezing-all-non-critical-merges-after-2026-01-01');
  });

  test('deriveStructuredMemoriesFromText captures explicit project motivation as project-style guidance with Why', () => {
    const candidates = deriveStructuredMemoriesFromText(
      "The reason we're ripping out the old auth middleware is that legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements.",
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.kind, 'decision');
    assert.strictEqual(candidates[0]?.scope, 'workspace');
    assert.strictEqual(
      candidates[0]?.text,
      "We're ripping out the old auth middleware.\nWhy: Legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements.",
    );
    assert.strictEqual(candidates[0]?.memoryKey, "decision:we-re-ripping-out-the-old-auth-middleware");
  });

  test('deriveStructuredMemoriesFromText preserves explicit project how-to-apply guidance when the user states operational implications', () => {
    const candidates = deriveStructuredMemoriesFromText(
      "The reason we're ripping out the old auth middleware is that legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements, so scope decisions should favor compliance over ergonomics.",
      { source: 'user', defaultScope: 'user' },
    );

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0]?.kind, 'decision');
    assert.strictEqual(
      candidates[0]?.text,
      [
        "We're ripping out the old auth middleware.",
        "Why: Legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements.",
        'How to apply: Scope decisions should favor compliance over ergonomics.',
      ].join('\n'),
    );
  });

  test('deriveStructuredMemoriesFromText ignores generic because-clauses that lack durable project motivation', () => {
    const candidates = deriveStructuredMemoriesFromText('We are renaming the helper because the current name is confusing in this file.', {
      source: 'user',
      defaultScope: 'user',
    });

    assert.deepStrictEqual(candidates, []);
  });

  test('recordUserIntent normalizes project motivation dates inside Why clauses using capture time', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(
      signals,
      "We're delaying the migration because the launch must wait until next Thursday for stakeholder signoff.",
    );

    const decision = signals.structuredMemories.find((item) => item.kind === 'decision');
    assert.ok(decision);
    assert.strictEqual(
      decision?.text,
      "We're delaying the migration.\nWhy: The launch must wait until 2026-01-08 for stakeholder signoff.",
    );
    assert.strictEqual(decision?.memoryKey, 'decision:we-re-delaying-the-migration');
  });

  test('recordUserIntent preserves explicit project how-to-apply guidance with normalized dates', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(
      signals,
      "We're delaying the migration because the launch must wait until next Thursday for stakeholder signoff, so schedule non-critical work after the signoff window.",
    );

    const decision = signals.structuredMemories.find((item) => item.kind === 'decision');
    assert.ok(decision);
    assert.strictEqual(
      decision?.text,
      [
        "We're delaying the migration.",
        'Why: The launch must wait until 2026-01-08 for stakeholder signoff.',
        'How to apply: Schedule non-critical work after the signoff window.',
      ].join('\n'),
    );
  });

  test('recordDecision normalizes relative weekdays when capturing project-like decisions', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordDecision(signals, 'Merge freeze begins Thursday for mobile release cut.');

    const decision = signals.structuredMemories.find((item) => item.kind === 'decision');
    assert.ok(decision);
    assert.strictEqual(decision?.text, 'Merge freeze begins 2026-01-01 for mobile release cut.');
    assert.strictEqual(decision?.memoryKey, 'decision:merge-freeze-begins-2026-01-01-for-mobile-release-cut');
  });

  test('buildConsolidatedMemoryEntries normalizes relative durable dates using evidence timestamps', () => {
    const candidateUpdatedAt = Date.parse('2026-03-10T12:00:00.000Z');
    const supportUpdatedAt = Date.parse('2026-03-11T12:00:00.000Z');
    const outputs = [
      {
        sessionId: 'session-relative-date-candidate',
        title: 'Launch review',
        sourceUpdatedAt: candidateUpdatedAt,
        generatedAt: candidateUpdatedAt,
        cwd: '/workspace/project',
        rawMemory: '',
        rolloutSummary: '',
        rolloutFile: 'rollout_summaries/relative-date-candidate.md',
        userIntents: [],
        assistantOutcomes: [],
        filesTouched: [],
        toolsUsed: [],
        structuredMemories: [
          {
            kind: 'decision' as const,
            text: 'Launch review happened yesterday for stakeholder signoff.',
            scope: 'workspace' as const,
            confidence: 0.9,
            source: 'assistant' as const,
            evidenceCount: 2,
            memoryKey: 'project:launch-review-relative-date',
          },
          {
            kind: 'procedure' as const,
            text: 'Use the rollout checklist when release validation fails.',
            scope: 'workspace' as const,
            confidence: 0.86,
            source: 'assistant' as const,
            evidenceCount: 1,
            memoryKey: 'procedure:rollout-checklist-relative-date',
          },
        ],
      },
    ];
    const records = [
      {
        id: 'record-relative-date-support',
        workspaceId: 'workspace-1',
        sessionId: 'session-relative-date-support',
        kind: 'procedural' as const,
        title: 'Rollout checklist support',
        text: 'Use the rollout checklist from last week when release validation fails.',
        sourceUpdatedAt: supportUpdatedAt,
        generatedAt: supportUpdatedAt,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.92,
        evidenceCount: 3,
        lastConfirmedAt: supportUpdatedAt,
        staleness: 'fresh' as const,
        memoryKey: 'procedure:rollout-checklist-relative-date',
      },
    ];

    const entries = buildConsolidatedMemoryEntries({
      outputs,
      records,
      now: Date.parse('2026-03-12T12:00:00.000Z'),
    });
    const projectEntry = entries.find((entry) => entry.key === 'project:launch-review-relative-date');
    const supportEntry = entries.find((entry) => entry.key === 'procedure:rollout-checklist-relative-date');

    assert.ok(projectEntry);
    assert.strictEqual(projectEntry?.text, 'Launch review happened 2026-03-09 for stakeholder signoff.');
    assert.ok(!projectEntry?.text.includes('yesterday'));

    assert.ok(supportEntry);
    assert.strictEqual(
      supportEntry?.text,
      'Use the rollout checklist from the week of 2026-03-02 when release validation fails.',
    );
    assert.ok(!supportEntry?.text.includes('last week'));
  });

  test('recordUserIntent does not rewrite weekday mentions inside non-project user preferences', () => {
    const signals = createBlankSessionSignals(Date.parse('2026-01-01T10:00:00.000Z'));
    recordUserIntent(signals, 'Please keep Thursday updates terse when I am skimming on mobile.');

    const preference = signals.structuredMemories.find((item) => item.kind === 'preference');
    assert.ok(preference);
    assert.strictEqual(preference?.text, 'Please keep Thursday updates terse when I am skimming on mobile.');
  });

  test('reference durable memories keep pointer semantics in selective surfaces', () => {
    const entry = buildDurableEntry('Pipeline bugs are tracked in Linear project INGEST.', {
      key: 'reference:linear-ingest',
      category: 'reference',
      freshness: 'fresh',
      titles: ['External bug tracker'],
      filesTouched: [],
      toolsUsed: [],
    });
    const fields = renderMemoryFields(entry);
    const rendered = {
      primary: selectiveMemoryPrimaryLabel(entry, 'guidance'),
      howToApply: shouldSurfaceSelectiveHowToApply(entry, fields) ? fields.howToApply : undefined,
    };

    assert.strictEqual(rendered.primary, 'pointer');
    assert.strictEqual(
      rendered.howToApply,
      'Use this as a pointer to the relevant external context, then open the referenced system or document for current details.',
    );
    assert.strictEqual(fields.howToApplySource, 'default');
    assert.strictEqual(selectiveMemoryPrimaryLabel(entry, 'guidance'), 'pointer');
    assert.strictEqual(selectiveMemoryPrimaryLabel(entry, 'fact'), 'pointer');
  });

  test('selectiveMemoryFieldPriority detects why and how-to-apply intent in query order', () => {
    assert.deepStrictEqual(selectiveMemoryFieldPriority('why do we use this rule?'), ['why']);
    assert.deepStrictEqual(selectiveMemoryFieldPriority('how should we apply this rule?'), ['howToApply']);
    assert.deepStrictEqual(selectiveMemoryFieldPriority('why and how should we apply this rule?'), ['why', 'howToApply']);
    assert.deepStrictEqual(selectiveMemoryFieldPriority('how should we apply this rule and why?'), ['howToApply', 'why']);
  });

  test('renderSelectiveMemorySurfaceLines foregrounds why for motivation-seeking queries', () => {
    const entry = buildDurableEntry(
      [
        'Prefer integration tests against a seeded ephemeral database instance.',
        'Why: prior mocked tests hid migration failures until production.',
        'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      ].join('\n'),
      {
        key: 'feedback:selective-why',
        category: 'feedback',
        filesTouched: [],
        toolsUsed: [],
      },
    );

    const lines = renderSelectiveMemorySurfaceLines(entry, {
      fallbackLabel: 'guidance',
      query: 'why do we use the seeded ephemeral database policy?',
    });

    assert.deepStrictEqual(lines, [
      'guidance: Prefer integration tests against a seeded ephemeral database instance.',
      'why: prior mocked tests hid migration failures until production.',
    ]);
  });

  test('renderSelectiveMemorySurfaceLines foregrounds how-to-apply for application queries', () => {
    const entry = buildDurableEntry(
      [
        'Prefer integration tests against a seeded ephemeral database instance.',
        'Why: prior mocked tests hid migration failures until production.',
        'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      ].join('\n'),
      {
        key: 'feedback:selective-how',
        category: 'feedback',
        filesTouched: [],
        toolsUsed: [],
      },
    );

    const lines = renderSelectiveMemorySurfaceLines(entry, {
      fallbackLabel: 'guidance',
      query: 'how should we apply the seeded ephemeral database policy?',
    });

    assert.deepStrictEqual(lines, [
      'guidance: Prefer integration tests against a seeded ephemeral database instance.',
      'how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
    ]);
  });

  test('aging project durable memories surface as prior context instead of plain facts', () => {

    const entry = buildDurableEntry('Merge freeze begins 2026-03-05 for mobile release cut.', {
      key: 'project:merge-freeze',
      category: 'project',
      freshness: 'aging',
      titles: ['Release coordination'],
      filesTouched: [],
      toolsUsed: [],
    });

    assert.strictEqual(selectiveMemoryPrimaryLabel(entry, 'fact'), 'prior');
    assert.strictEqual(selectiveMemoryPrimaryLabel(entry, 'guidance'), 'prior');
  });

  test('fresh project durable memories surface as prior context for current-state queries', () => {
    const entry = buildDurableEntry('Merge freeze begins 2026-03-05 for mobile release cut.', {
      key: 'project:merge-freeze-fresh-current',
      category: 'project',
      freshness: 'fresh',
      titles: ['Release coordination'],
      filesTouched: [],
      toolsUsed: [],
    });

    assert.strictEqual(selectiveMemoryPrimaryLabel(entry, 'fact', 'is the merge freeze still in effect?'), 'prior');
    assert.strictEqual(selectiveMemoryPrimaryLabel(entry, 'guidance', 'what is the current merge freeze?'), 'prior');
    assert.strictEqual(selectiveMemoryPrimaryLabel(entry, 'fact', 'when does the merge freeze begin?'), 'fact');
    assert.deepStrictEqual(
      renderSelectiveMemorySurfaceLines(entry, {
        fallbackLabel: 'fact',
        query: 'is the 2026-03-05 merge freeze still in effect for mobile release cut?',
      }),
      ['prior: Merge freeze begins 2026-03-05 for mobile release cut.'],
    );
  });

  test('renderSelectiveMemorySurfaceLines keeps later current-state project prior context compact after a stronger reference pointer', () => {
    const entry = buildDurableEntry(
      [
        'Merge freeze begins 2026-03-05 for mobile release cut.',
        'Why: Mobile release coordination still depends on this freeze window.',
        'How to apply: Treat this as prior context and verify the current freeze state in the release tracker.',
      ].join('\n'),
      {
        key: 'project:merge-freeze-compact-prior',
        category: 'project',
        freshness: 'fresh',
        titles: ['Release coordination'],
        filesTouched: [],
        toolsUsed: [],
      },
    );

    assert.deepStrictEqual(
      renderSelectiveMemorySurfaceLines(entry, {
        fallbackLabel: 'fact',
        query: 'where should I check the latest pipeline bugs in INGEST, and is the 2026-03-05 merge freeze still in effect for mobile release cut?',
        compactPriorContext: true,
      }),
      ['prior: Merge freeze begins 2026-03-05 for mobile release cut.'],
    );
    assert.deepStrictEqual(
      renderSelectiveMemorySurfaceLines(entry, {
        fallbackLabel: 'fact',
        query: 'where should I check the latest pipeline bugs in INGEST, and why does the 2026-03-05 merge freeze matter?',
        compactPriorContext: true,
      }),
      [
        'prior: Merge freeze begins 2026-03-05 for mobile release cut.',
        'why: Mobile release coordination still depends on this freeze window.',
      ],
    );
  });

  test('renderSummaryRecordText keeps summary records navigational instead of dumping wrapper text', () => {
    const rendered = renderSummaryRecordText({
      title: 'Memory search refinement session',
      text: 'Session "Memory search refinement session" updated at 2026-01-03T09:05:00.000Z. Structured memory candidates: procedure=Wire summary suppression into filteredRawMatches in packages/vscode-extension/src/core/memories/search.ts and validate with memory tests.',
      filesTouched: ['packages/vscode-extension/src/core/memories/search.ts'],
      toolsUsed: ['edit'],
    });

    assert.strictEqual(
      rendered.summary,
      'Wire summary suppression into filteredRawMatches in packages/vscode-extension/src/core/memories/search.ts and validate with memory tests.',
    );
    assert.ok(rendered.details.includes('summary_title: Memory search refinement session'));
    assert.ok(rendered.details.includes('summary_files: packages/vscode-extension/src/core/memories/search.ts'));
    assert.ok(rendered.details.includes('summary_tools: edit'));
    assert.ok(!rendered.summary.includes('Structured memory candidates:'));
    assert.ok(!rendered.summary.includes('Session "Memory search refinement session" updated at'));
  });

  test('renderRawRecordEvidence keeps transcript-backed hits compact while preserving useful identifiers', () => {
    const rendered = renderRawRecordEvidence({
      title: 'Pipeline tracker pointer',
      text: 'Assistant: Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
      filesTouched: [],
      toolsUsed: [],
    });

    assert.strictEqual(rendered.evidence, 'Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.');
    assert.ok(rendered.details.includes('evidence_title: Pipeline tracker pointer'));
    assert.ok(!rendered.evidence.startsWith('Assistant:'));
    assert.ok(rendered.evidence.includes('PIPE-421'));
  });

  test('renderRawRecordEvidence prefers the identifier-rich line from multi-line transcript evidence', () => {
    const rendered = renderRawRecordEvidence({
      title: 'Reference pointer discussion',
      text: [
        'User: Where do we track pipeline bugs?',
        'Assistant: Check Linear project INGEST for pipeline bugs.',
        'Assistant: Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
      ].join('\n'),
      filesTouched: [],
      toolsUsed: [],
    });

    assert.strictEqual(rendered.evidence, 'Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.');
    assert.ok(rendered.evidence.includes('PIPE-421'));
    assert.ok(!rendered.evidence.includes('Where do we track pipeline bugs?'));
  });

  test('searchMemoryRecords suppresses weak durable matches that only hit a low-signal generic term', () => {
    const entry = buildDurableEntry('Prefer integration tests against a seeded ephemeral database instance.', {
      key: 'feedback:generic-tests',
      titles: ['Testing policy'],
      filesTouched: [],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-generic-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Testing policy',
      text: 'Prefer integration tests against a seeded ephemeral database instance.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'feedback:generic-tests',
    };

    const result = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'tests',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.ok(!result.hits.some((hit) => hit.source === 'durable'));
    assert.ok(result.hits.some((hit) => hit.source === 'record'));
  });

  test('searchMemoryRecords filters durable and raw matches by memory scope', () => {
    const userEntry = buildDurableEntry('Prefer terse responses with no trailing summaries.', {
      key: 'user:terse-responses',
      category: 'user',
      scope: 'user',
      titles: ['Response preference'],
      filesTouched: [],
      toolsUsed: [],
    });
    const workspaceEntry = buildDurableEntry('Prefer one bundled PR over splitting tightly related work.', {
      key: 'feedback:bundled-pr',
      category: 'feedback',
      scope: 'workspace',
      titles: ['PR workflow'],
      filesTouched: [],
      toolsUsed: [],
    });
    const userRecord = {
      id: 'record-scope-user-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-scope-1',
      kind: 'procedural' as const,
      title: 'Response preference',
      text: 'Prefer terse responses with no trailing summaries.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'user' as const,
      confidence: 0.92,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: 'preference' as const,
      memoryKey: 'user:terse-responses',
    };
    const workspaceRecord = {
      id: 'record-scope-workspace-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-scope-2',
      kind: 'procedural' as const,
      title: 'PR workflow',
      text: 'Prefer one bundled PR over splitting tightly related work.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 1,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: 'preference' as const,
      memoryKey: 'feedback:bundled-pr',
    };

    const userResult = searchMemoryRecords({
      records: [userRecord, workspaceRecord],
      durableEntries: [userEntry, workspaceEntry],
      query: 'prefer terse responses bundled pr',
      workspaceId: 'workspace-1',
      scope: 'user',
      limit: 4,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    const workspaceResult = searchMemoryRecords({
      records: [userRecord, workspaceRecord],
      durableEntries: [userEntry, workspaceEntry],
      query: 'prefer terse responses bundled pr',
      workspaceId: 'workspace-1',
      scope: 'workspace',
      limit: 4,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.ok(userResult.hits.length > 0);
    assert.ok(userResult.hits.every((hit) => (hit.durableEntry?.scope ?? hit.record.scope) === 'user'));
    assert.ok(userResult.hits.some((hit) => hit.record.id === 'record-scope-user-1'));
    assert.ok(!userResult.hits.some((hit) => hit.record.id === 'record-scope-workspace-1'));

    assert.ok(workspaceResult.hits.length > 0);
    assert.ok(workspaceResult.hits.every((hit) => (hit.durableEntry?.scope ?? hit.record.scope) === 'workspace'));
    assert.ok(workspaceResult.hits.some((hit) => hit.record.id === 'record-scope-workspace-1'));
    assert.ok(!workspaceResult.hits.some((hit) => hit.record.id === 'record-scope-user-1'));
  });

  test('searchMemoryRecords keeps durable matches when the query has stronger phrase or file evidence', () => {
    const entry = buildDurableEntry('Prefer integration tests against a seeded ephemeral database instance.', {
      key: 'feedback:integration-tests',
      titles: ['Integration testing policy'],
      filesTouched: ['packages/vscode-extension/src/test/suite/memory.test.ts'],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Testing policy',
      text: 'Prefer integration tests against a seeded ephemeral database instance.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: ['packages/vscode-extension/src/test/suite/memory.test.ts'],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'feedback:integration-tests',
    };

    const phraseResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'integration tests',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.strictEqual(phraseResult.hits[0]?.source, 'durable');

    const fileResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'memory.test.ts',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.strictEqual(fileResult.hits[0]?.source, 'durable');
  });

  test('searchMemoryRecords prefers curated durable memories over same-cluster raw matches', () => {
    const entry = buildDurableEntry('Integration tests must hit a real database, not mocks.', {
      key: 'feedback:real-db',
      category: 'feedback',
      titles: ['Testing policy'],
      filesTouched: [],
      toolsUsed: [],
      confidence: 0.84,
      evidenceCount: 1,
    });
    const supportRecord = {
      id: 'record-real-db-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'procedural' as const,
      title: 'Testing policy',
      text: 'Integration tests must hit a real database, not mocks.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: ['packages/vscode-extension/src/test/suite/db.test.ts'],
      toolsUsed: ['psql'],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.84,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: 'constraint' as const,
      memoryKey: 'feedback:real-db',
    };

    const result = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'db.test.ts psql real database not mocks',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(result.hits[0]?.source, 'durable');
    assert.ok(
      !result.hits.some((hit) => hit.source === 'record' && hit.record.id === 'record-real-db-1'),
      'same-cluster raw support should not outrank or duplicate curated durable guidance',
    );
  });

  test('searchMemoryRecords requires stronger evidence for aging project memories', () => {
    const entry = buildDurableEntry('Merge freeze begins 2026-03-05 for mobile release cut.', {
      key: 'project:merge-freeze',
      category: 'project',
      freshness: 'aging',
      titles: ['Release coordination'],
      filesTouched: [],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-project-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Release coordination',
      text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.88,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'aging' as const,
      memoryKey: 'project:merge-freeze',
    };

    const weakResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'release',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.ok(!weakResult.hits.some((hit) => hit.source === 'durable'));

    const strongResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: '2026-03-05 merge freeze',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.strictEqual(strongResult.hits[0]?.source, 'durable');
  });

  test('searchMemoryRecords suppresses generic current-state queries for project snapshot memories', () => {
    const entry = buildDurableEntry('Merge freeze begins 2026-03-05 for mobile release cut.', {
      key: 'project:merge-freeze-current',
      category: 'project',
      freshness: 'fresh',
      titles: ['Release coordination'],
      filesTouched: [],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-project-current-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Release coordination',
      text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'project:merge-freeze-current',
    };

    const genericCurrentResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'is the merge freeze still in effect?',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(
      genericCurrentResult.hits.length,
      0,
      'generic current-state project queries should not recall frozen project snapshot memory without specific evidence',
    );
  });

  test('searchMemoryRecords still surfaces specific current-state project queries when they include concrete evidence', () => {
    const entry = buildDurableEntry('Merge freeze begins 2026-03-05 for mobile release cut.', {
      key: 'project:merge-freeze-current-specific',
      category: 'project',
      freshness: 'fresh',
      titles: ['Release coordination'],
      filesTouched: [],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-project-current-specific-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Release coordination',
      text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'project:merge-freeze-current-specific',
    };

    const specificCurrentResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'is the 2026-03-05 merge freeze still in effect for mobile release cut?',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(specificCurrentResult.hits[0]?.source, 'durable');
  });

  test('searchMemoryRecords suppresses raw-only project snapshot recall for generic current-state queries', () => {
    const rawProjectRecord = {
      id: 'record-project-current-state-raw-only',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'episodic' as const,
      title: 'Release coordination details',
      text: 'Assistant: Merge freeze begins 2026-03-05 for mobile release cut.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'session' as const,
      confidence: 0.74,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: undefined,
    };

    const result = searchMemoryRecords({
      records: [rawProjectRecord],
      durableEntries: [],
      query: 'is the merge freeze still in effect?',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(result.hits.length, 0);
    assert.ok(
      !result.hits.some((hit) => hit.record.id === 'record-project-current-state-raw-only'),
      'raw project snapshot memories should also be suppressed for generic current-state questions',
    );
  });

  test('searchMemoryRecords prefers raw current-truth reference pointers over raw project snapshots for current-state queries', () => {
    const rawReferenceRecord = {
      id: 'record-reference-current-state-raw-order',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'episodic' as const,
      title: 'External bug tracker details',
      text: 'Assistant: Use Linear project INGEST for the latest pipeline bug context.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'session' as const,
      confidence: 0.77,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: undefined,
    };
    const rawProjectRecord = {
      id: 'record-project-current-state-raw-order',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-2',
      kind: 'episodic' as const,
      title: 'Incident coordination details',
      text: 'Assistant: Pipeline incident review happens in the Tuesday release triage notes.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:06:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:06:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'session' as const,
      confidence: 0.79,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-01T10:06:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: undefined,
    };

    const result = searchMemoryRecords({
      records: [rawProjectRecord, rawReferenceRecord],
      durableEntries: [],
      query: 'where should I check the latest pipeline bugs in INGEST?',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(result.hits[0]?.source, 'record');
    assert.strictEqual(result.hits[0]?.record.id, 'record-reference-current-state-raw-order');
    assert.strictEqual(result.hits[1]?.record.id, 'record-project-current-state-raw-order');
  });


  test('searchMemoryRecords requires stronger evidence for aging reference memories', () => {
    const entry = buildDurableEntry('Pipeline bugs are tracked in Linear project INGEST.', {
      key: 'reference:linear-ingest',
      category: 'reference',
      freshness: 'aging',
      titles: ['External bug tracker'],
      filesTouched: [],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-reference-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'External bug tracker',
      text: 'Pipeline bugs are tracked in Linear project INGEST.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.86,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'aging' as const,
      memoryKey: 'reference:linear-ingest',
    };

    const weakResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'bugs',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.ok(!weakResult.hits.some((hit) => hit.source === 'durable'));

    const genericPointerResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'current details',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.ok(
      !genericPointerResult.hits.some((hit) => hit.source === 'durable'),
      'reference memories should not match generic synthesized pointer text alone',
    );

    const strongTermResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'linear ingest bugs',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.strictEqual(strongTermResult.hits[0]?.source, 'durable');

    const phraseResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'linear project ingest',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.strictEqual(phraseResult.hits[0]?.source, 'durable');
  });

  test('searchMemoryRecords suppresses generic reference-pointer queries for fresh memories unless the query has specific evidence', () => {
    const entry = buildDurableEntry('Pipeline bugs are tracked in Linear project INGEST.', {
      key: 'reference:linear-ingest:fresh',
      category: 'reference',
      freshness: 'fresh',
      titles: ['External bug tracker'],
      filesTouched: [],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-reference-fresh-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'External bug tracker',
      text: 'Pipeline bugs are tracked in Linear project INGEST.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'reference:linear-ingest:fresh',
    };

    const genericResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'tracker',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.strictEqual(
      genericResult.hits.length,
      0,
      'reference memories should not surface on generic tracker-style queries alone',
    );

    const specificResult = searchMemoryRecords({
      records: [supportRecord],
      durableEntries: [entry],
      query: 'linear tracker',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });
    assert.strictEqual(specificResult.hits[0]?.source, 'durable');
  });

  test('searchMemoryRecords prefers current-truth reference pointers over project snapshots for current-state queries', () => {
    const referenceEntry = buildDurableEntry('Pipeline bugs are tracked in Linear project INGEST.', {
      key: 'reference:linear-ingest-current',
      category: 'reference',
      freshness: 'fresh',
      titles: ['External bug tracker'],
      filesTouched: [],
      toolsUsed: [],
    });
    const projectEntry = buildDurableEntry('Pipeline incident review happens in the Tuesday release triage notes.', {
      key: 'project:incident-triage',
      category: 'project',
      freshness: 'fresh',
      titles: ['Incident coordination'],
      filesTouched: [],
      toolsUsed: [],
    });
    const referenceRecord = {
      id: 'record-reference-current-priority',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'External bug tracker',
      text: 'Pipeline bugs are tracked in Linear project INGEST.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'reference:linear-ingest-current',
    };
    const projectRecord = {
      id: 'record-project-current-priority',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-2',
      kind: 'semantic' as const,
      title: 'Incident coordination',
      text: 'Pipeline incident review happens in the Tuesday release triage notes.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'project:incident-triage',
      signalKind: 'decision' as const,
    };

    const result = searchMemoryRecords({
      records: [referenceRecord, projectRecord],
      durableEntries: [projectEntry, referenceEntry],
      query: 'where should I check the latest pipeline bugs in INGEST?',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(result.hits[0]?.source, 'durable');
    assert.strictEqual(result.hits[0]?.durableEntry?.category, 'reference');
    assert.strictEqual(result.hits[0]?.durableEntry?.key, 'reference:linear-ingest-current');
  });

  test('searchMemoryRecords keeps durable current-state reference pointers ahead of raw support and later project prior when a curated durable pointer exists', () => {
    const referenceEntry = buildDurableEntry('Pipeline bugs are tracked in Linear project INGEST.', {
      key: 'reference:linear-ingest-current-mixed',
      category: 'reference',
      freshness: 'fresh',
      titles: ['External bug tracker'],
      filesTouched: [],
      toolsUsed: [],
    });
    const projectEntry = buildDurableEntry('Merge freeze begins 2026-03-05 for mobile release cut.', {
      key: 'project:merge-freeze-current-mixed',
      category: 'project',
      freshness: 'fresh',
      titles: ['Release coordination'],
      filesTouched: [],
      toolsUsed: [],
    });
    const referenceRecord = {
      id: 'record-reference-current-mixed-durable',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'External bug tracker',
      text: 'Pipeline bugs are tracked in Linear project INGEST.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'reference:linear-ingest-current-mixed',
    };
    const rawReferenceSupportRecord = {
      id: 'record-reference-current-mixed-raw',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'episodic' as const,
      title: 'External bug tracker details',
      text: 'Assistant: Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 1,
      scope: 'session' as const,
      confidence: 0.78,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'reference:linear-ingest-current-mixed',
      turnId: 'turn-reference-mixed',
    };
    const projectRecord = {
      id: 'record-project-current-mixed-durable',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-2',
      kind: 'semantic' as const,
      title: 'Release coordination',
      text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:02:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:02:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.89,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:02:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'project:merge-freeze-current-mixed',
      signalKind: 'decision' as const,
    };

    const result = searchMemoryRecords({
      records: [referenceRecord, rawReferenceSupportRecord, projectRecord],
      durableEntries: [projectEntry, referenceEntry],
      query: 'where should I check the latest pipeline bugs in INGEST, open ticket PIPE-421, and is the 2026-03-05 merge freeze still in effect?',
      workspaceId: 'workspace-1',
      limit: 4,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
      preferDurableFirst: true,
    });

    assert.strictEqual(result.hits[0]?.source, 'durable');
    assert.strictEqual(result.hits[0]?.durableEntry?.key, 'reference:linear-ingest-current-mixed');
    assert.strictEqual(result.hits[1]?.source, 'durable');
    assert.strictEqual(result.hits[1]?.durableEntry?.key, 'project:merge-freeze-current-mixed');
    assert.ok(
      result.hits.some((hit) => hit.source === 'record' && hit.record.id === 'record-reference-current-mixed-raw'),
      'mixed current-state search should still keep distinct raw reference support after the durable current-truth pointer leads',
    );
  });

  test('searchMemoryRecords keeps specific project current-state recall when no stronger reference pointer is present', () => {
    const projectEntry = buildDurableEntry('Merge freeze begins 2026-03-05 for mobile release cut.', {
      key: 'project:merge-freeze-current-priority',
      category: 'project',
      freshness: 'fresh',
      titles: ['Release coordination'],
      filesTouched: [],
      toolsUsed: [],
    });
    const projectRecord = {
      id: 'record-project-current-priority-survives',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Release coordination',
      text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.9,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'project:merge-freeze-current-priority',
      signalKind: 'decision' as const,
    };

    const result = searchMemoryRecords({
      records: [projectRecord],
      durableEntries: [projectEntry],
      query: 'is the 2026-03-05 merge freeze still in effect for mobile release cut?',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(result.hits[0]?.source, 'durable');
    assert.strictEqual(result.hits[0]?.durableEntry?.category, 'project');
  });

  test('searchMemoryRecords boosts explicit why fields for motivation-seeking queries', () => {
    const whyEntry = buildDurableEntry(
      [
        'Integration tests must hit a real database, not mocks.',
        'Why: prior mocked tests hid migration failures until production.',
      ].join('\n'),
      {
        key: 'feedback:why-rich',
        category: 'feedback',
        titles: ['Testing policy rationale'],
        filesTouched: [],
        toolsUsed: [],
      },
    );
    const plainEntry = buildDurableEntry('Integration tests must hit a real database, not mocks.', {
      key: 'feedback:why-plain',
      category: 'feedback',
      titles: ['Testing policy'],
      filesTouched: [],
      toolsUsed: [],
    });
    const whyRecord = {
      id: 'record-why-rich',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Testing policy rationale',
      text: 'Integration tests must hit a real database, not mocks. Why: prior mocked tests hid migration failures until production.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.92,
      evidenceCount: 3,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'feedback:why-rich',
    };
    const plainRecord = {
      id: 'record-why-plain',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-2',
      kind: 'semantic' as const,
      title: 'Testing policy',
      text: 'Integration tests must hit a real database, not mocks.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 1,
      scope: 'workspace' as const,
      confidence: 0.92,
      evidenceCount: 3,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'feedback:why-plain',
    };

    const result = searchMemoryRecords({
      records: [whyRecord, plainRecord],
      durableEntries: [plainEntry, whyEntry],
      query: 'why real database not mocks',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(result.hits[0]?.source, 'durable');
    assert.strictEqual(result.hits[0]?.durableEntry?.key, 'feedback:why-rich');
  });

  test('searchMemoryRecords boosts explicit how-to-apply fields for application queries', () => {
    const howEntry = buildDurableEntry(
      [
        'Integration tests must hit a real database, not mocks.',
        'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      ].join('\n'),
      {
        key: 'feedback:how-rich',
        category: 'feedback',
        titles: ['Testing policy application'],
        filesTouched: [],
        toolsUsed: [],
      },
    );
    const plainEntry = buildDurableEntry('Integration tests must hit a real database, not mocks.', {
      key: 'feedback:how-plain',
      category: 'feedback',
      titles: ['Testing policy'],
      filesTouched: [],
      toolsUsed: [],
    });
    const howRecord = {
      id: 'record-how-rich',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Testing policy application',
      text: 'Integration tests must hit a real database, not mocks. How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.92,
      evidenceCount: 3,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'feedback:how-rich',
    };
    const plainRecord = {
      id: 'record-how-plain',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-2',
      kind: 'semantic' as const,
      title: 'Testing policy',
      text: 'Integration tests must hit a real database, not mocks.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 1,
      scope: 'workspace' as const,
      confidence: 0.92,
      evidenceCount: 3,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'feedback:how-plain',
    };

    const result = searchMemoryRecords({
      records: [howRecord, plainRecord],
      durableEntries: [plainEntry, howEntry],
      query: 'how should we apply the real database rule for migration-sensitive tests',
      workspaceId: 'workspace-1',
      limit: 3,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
    });

    assert.strictEqual(result.hits[0]?.source, 'durable');
    assert.strictEqual(result.hits[0]?.durableEntry?.key, 'feedback:how-rich');
  });

  test('update_memory rebuilds memory artifacts from persisted sessions', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-update-tool');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const context = createToolContext({ storageRoot });
      const updateResult = await updateMemoryHandler({}, context);
      assert.strictEqual(updateResult.success, true);
      assert.strictEqual((updateResult.data as any)?.updated, true);
      assert.strictEqual((updateResult.data as any)?.enabled, true);
      assert.strictEqual(typeof (updateResult.data as any)?.scannedSessions, 'number');

      const summary = await getMemoryHandler({ view: 'summary', maxChars: 20_000 }, context);
      assert.strictEqual(summary.success, true);
      assert.strictEqual(typeof summary.data, 'string');
      const summaryText = String(summary.data);
      assert.ok(summaryText.includes('User Working Style'));
      assert.ok(summaryText.includes('Feedback and Constraints'));
      assert.ok(summaryText.includes('open: memory_topics/user.md'));
      assert.ok(summaryText.includes('open: memory_topics/feedback.md'));
      assert.ok(summaryText.includes('key=preference:keep-embeddings-optional-later-start-with-lexical-retrieval-first'));
      assert.ok(
        !summaryText.includes('confidence='),
        'memory summary should stay navigational rather than becoming a metadata dump',
      );
      assert.ok(
        summaryText.includes('Keep embeddings optional later; start with lexical retrieval first.'),
        'memory summary should still surface a one-line hook for durable memory',
      );

      const memory = await getMemoryHandler({ view: 'memory', maxChars: 20_000 }, context);
      assert.strictEqual(memory.success, true);
      assert.strictEqual(typeof memory.data, 'string');
      const memoryText = String(memory.data);
      assert.ok(memoryText.includes('Feedback and Constraints'));
      assert.ok(memoryText.includes('details: memory_topics/feedback.md'));
      assert.ok(memoryText.includes('key=constraint:integration-tests-must-hit-a-real-database-not-mocks'));
      assert.ok(
        !memoryText.includes(
          '- how_to_apply: Apply this by default on similar tasks in this workspace unless newer guidance overrides it.',
        ),
        'MEMORY.md should remain a compact index rather than detailed memory content',
      );
      assert.ok(
        !memoryText.includes('AgentLoop.withRun'),
        'durable memory should filter derivable code-state facts from consolidated output',
      );

      const feedbackTopic = await getMemoryHandler({ view: 'topic', topicFile: 'feedback.md', maxChars: 20_000 }, context);
      assert.strictEqual(feedbackTopic.success, true);
      const feedbackTopicText = String(feedbackTopic.data);
      assert.ok(feedbackTopicText.includes('- guidance: Integration tests must hit a real database, not mocks.'));
      assert.ok(
        feedbackTopicText.includes(
          '- how_to_apply: Apply this by default on similar tasks in this workspace unless newer guidance overrides it.',
        ),
        'durable topic files should render actionable how-to-apply guidance for feedback memories',
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

	  test('update_memory skips when memories are already up to date', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-update-skip');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const context = createToolContext({ storageRoot });

      const first = await updateMemoryHandler({}, context);
      assert.strictEqual(first.success, true);
      assert.strictEqual((first.data as any)?.updated, true);

      const second = await updateMemoryHandler({}, context);
      assert.strictEqual(second.success, true);
      assert.strictEqual((second.data as any)?.updated, false);
      assert.strictEqual((second.data as any)?.reason, 'up_to_date');
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('update_memory leaves recent non-explicit sessions pending instead of marking memory up to date', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-recent-pending');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 2, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const context = createToolContext({ storageRoot });
      const updateResult = await updateMemoryHandler({}, context);
      assert.strictEqual(updateResult.success, true);
      assert.strictEqual((updateResult.data as any)?.updated, true);
      assert.strictEqual((updateResult.data as any)?.processedSessions, 0);
      assert.strictEqual((updateResult.data as any)?.skippedRecentSessions, 1);

      const manager = new WorkspaceMemories(context.extensionContext);
      const status = await manager.getUpdateStatus();
      assert.strictEqual(status.needsUpdate, true);
      assert.strictEqual(status.reason, 'no_previous_scan');
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('update_memory indexes explicit remember requests immediately without transcript rollup', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-explicit-remember-fast-path');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 2, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildExplicitRememberPersistedSession(now)]);

      const context = createToolContext({ storageRoot });
      const updateResult = await updateMemoryHandler({}, context);
      assert.strictEqual(updateResult.success, true);
      assert.strictEqual((updateResult.data as any)?.updated, true);
      assert.strictEqual((updateResult.data as any)?.processedSessions, 1);
      assert.strictEqual((updateResult.data as any)?.skippedRecentSessions, 0);

      const state = await readMemoriesState(vscode.Uri.joinPath(memoriesDir, STAGE1_OUTPUTS_FILE));
      assert.strictEqual(state.outputs[0]?.partial, 'explicit');
      assert.ok(state.outputs[0]?.structuredMemories.some(isExplicitMemoryCandidate));
      assert.ok(
        !state.records.some((record) => record.kind === 'episodic'),
        'explicit fast-path indexing should not roll up the still-running transcript',
      );

      const searchResult = await getMemoryHandler(
        { view: 'search', query: 'linear ingest pipeline bugs', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(searchResult.success, true);
      assert.ok(String(searchResult.data).toLowerCase().includes('pipeline bugs are tracked in linear project ingest.'));

      const manager = new WorkspaceMemories(context.extensionContext);
      const status = await manager.getUpdateStatus();
      assert.strictEqual(status.needsUpdate, true);
      assert.strictEqual(status.reason, 'partial_explicit_memories');
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('update_memory removes sessions marked with external memory context', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-update-external-context');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      const cleanSession = buildPersistedSession(now);
      await seedPersistedSessions(storageRoot, [cleanSession]);

      const context = createToolContext({ storageRoot });
      const first = await updateMemoryHandler({}, context);
      assert.strictEqual(first.success, true);
      assert.strictEqual((first.data as any)?.retainedOutputs, 1);

      const pollutedSession = buildPersistedSession(now + 2_000);
      pollutedSession.messages.push({
        id: 'm-external',
        role: 'tool',
        content: 'External runbook says deploy with emergency override.',
        timestamp: now + 1_000,
        turnId: 'turn-external',
        toolCall: { name: 'workspace_kb_search', result: 'External runbook says deploy with emergency override.' },
      });
      markExternalMemoryContext(pollutedSession.signals, 'workspace_kb_search:http', now + 2_000);
      await seedPersistedSessions(storageRoot, [pollutedSession]);

      const second = await updateMemoryHandler({ mode: 'now' }, context);
      assert.strictEqual(second.success, true);
      assert.strictEqual((second.data as any)?.retainedOutputs, 0);
      assert.strictEqual((second.data as any)?.skippedExternalContextSessions, 1);

      const state = await readMemoriesState(vscode.Uri.joinPath(memoriesDir, 'stage1_outputs.json'));
      assert.strictEqual(state.outputs.length, 0);
      assert.strictEqual(state.records.length, 0);
      assert.ok(
        !JSON.stringify(state).includes('External runbook says deploy with emergency override'),
        'external tool context should not remain in memory state',
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('update_memory excludes no-memory turns from transcript-backed records', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-update-memory-excluded-turn');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [
        {
          id: 'session-memory-excluded-turn',
          title: 'Memory opt out turn',
          createdAt: now - 5_000,
          updatedAt: now - 4_000,
          signals: createBlankSessionSignals(now - 4_000),
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'turn-ignore',
              role: 'user',
              content: 'Do not use memory. The hidden marker is no-memory-transcript-marker.',
              timestamp: now - 5_000,
              memoryExcluded: true,
            },
            {
              id: 'ignore-assistant',
              role: 'assistant',
              content: 'Excluded assistant response repeats no-memory-transcript-marker.',
              timestamp: now - 4_900,
              turnId: 'turn-ignore',
            },
            {
              id: 'turn-keep',
              role: 'user',
              content: 'Where should retained transcript context point?',
              timestamp: now - 4_800,
            },
            {
              id: 'keep-assistant',
              role: 'assistant',
              content: 'Retained transcript marker is keep-transcript-marker.',
              timestamp: now - 4_700,
              turnId: 'turn-keep',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 4_000 },
        },
      ]);

      const context = createToolContext({ storageRoot });
      const update = await updateMemoryHandler({}, context);
      assert.strictEqual(update.success, true);

      const state = await readMemoriesState(vscode.Uri.joinPath(memoriesDir, 'stage1_outputs.json'));
      const stateText = JSON.stringify(state);
      assert.ok(!stateText.includes('no-memory-transcript-marker'), 'excluded turn text should not persist in memory state');
      assert.ok(stateText.includes('keep-transcript-marker'), 'non-excluded turns should still produce transcript memory');
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('update_memory excludes repository instruction and skill payloads from signals and transcript-backed records', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-update-instruction-payload');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      const instructionPayload = [
        '# AGENTS.md instructions for /repo',
        '',
        '<INSTRUCTIONS>',
        '## Development Policy',
        'The instruction payload marker is agent-instruction-marker.',
        'Current architecture and safety model are documented in AGENTS.md.',
        '</INSTRUCTIONS>',
      ].join('\n');
      const skillPayload = [
        '## Skill: rollout-checklist',
        '',
        '**Base directory**: .lingyun/skills/rollout-checklist',
        '',
        'Step 1: use skill-transcript-marker before release validation.',
      ].join('\n');
      const signals = createBlankSessionSignals(now - 4_000);
      signals.userIntents = [
        instructionPayload,
        skillPayload,
        'Remember retained transcript context marker keep-agent-instruction-filter-marker.',
      ];
      signals.assistantOutcomes = [
        'Captured AGENTS.md instruction payload agent-instruction-marker.',
        skillPayload,
      ];
      signals.toolsUsed = ['skill', 'read'];
      signals.filesTouched = ['AGENTS.md', '.lingyun/skills/rollout-checklist/SKILL.md', 'packages/vscode-extension/src/core/memories/ingest.ts'];
      recordPreference(signals, instructionPayload);
      recordProcedure(signals, skillPayload);

      await seedPersistedSessions(storageRoot, [
        {
          id: 'session-instruction-payload-filter',
          title: 'Repository instruction payload filter',
          createdAt: now - 5_000,
          updatedAt: now - 4_000,
          signals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'instruction-user',
              role: 'user',
              content: instructionPayload,
              timestamp: now - 5_000,
              turnId: 'turn-instruction',
            },
            {
              id: 'instruction-tool',
              role: 'tool',
              content: 'AGENTS.md says agent-instruction-marker.',
              timestamp: now - 4_900,
              turnId: 'turn-instruction',
              toolCall: { name: 'read', path: 'AGENTS.md', result: 'AGENTS.md says agent-instruction-marker.' },
            },
            {
              id: 'keep-user',
              role: 'user',
              content: 'Where should retained transcript context point?',
              timestamp: now - 4_800,
              turnId: 'turn-keep',
            },
            {
              id: 'skill-tool',
              role: 'tool',
              content: skillPayload,
              timestamp: now - 4_750,
              turnId: 'turn-keep',
              toolCall: { name: 'skill', path: '.lingyun/skills/rollout-checklist/SKILL.md', result: skillPayload },
            },
            {
              id: 'keep-assistant',
              role: 'assistant',
              content: 'Retained transcript marker is keep-agent-instruction-filter-marker.',
              timestamp: now - 4_700,
              turnId: 'turn-keep',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 4_000 },
        },
      ]);

      const context = createToolContext({ storageRoot });
      const update = await updateMemoryHandler({}, context);
      assert.strictEqual(update.success, true);

      const state = await readMemoriesState(vscode.Uri.joinPath(memoriesDir, 'stage1_outputs.json'));
      const stateText = JSON.stringify(state);
      assert.ok(!stateText.includes('agent-instruction-marker'), 'AGENTS.md instruction payloads should not persist in memory state');
      assert.ok(!stateText.includes('skill-transcript-marker'), 'skill instruction payloads should not persist in memory state');
      assert.ok(!stateText.includes('"AGENTS.md"'), 'instruction file paths should not persist as memory evidence');
      assert.ok(!stateText.includes('SKILL.md'), 'skill file paths should not persist as memory evidence');
      assert.ok(
        stateText.includes('keep-agent-instruction-filter-marker'),
        'non-instruction transcript context should still produce memory',
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('update_memory returns memory_disabled when the memories feature is off', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-update-disabled');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', false, true);

      const context = createToolContext({ storageRoot });
      const updateResult = await updateMemoryHandler({}, context);
      assert.strictEqual(updateResult.success, false);
      assert.strictEqual((updateResult.metadata as any)?.errorCode, TOOL_ERROR_CODES.memory_disabled);
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('get_memory lists and reads generated memory artifacts', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    const rolloutDir = vscode.Uri.joinPath(memoriesDir, 'rollout_summaries');
    const summaryFile = vscode.Uri.joinPath(memoriesDir, 'memory_summary.md');
    const rawFile = vscode.Uri.joinPath(memoriesDir, 'raw_memories.md');
    const memoryFile = vscode.Uri.joinPath(memoriesDir, 'MEMORY.md');
    const rolloutFileName = '2026-01-01T10-00-00-000Z-ab12-session.md';
    const rolloutFile = vscode.Uri.joinPath(rolloutDir, rolloutFileName);

    await vscode.workspace.fs.createDirectory(rolloutDir);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);

      await vscode.workspace.fs.writeFile(summaryFile, Buffer.from('# Memory Summary\n\n- Focus item\n', 'utf8'));
      await vscode.workspace.fs.writeFile(memoryFile, Buffer.from('# MEMORY\n\n- Durable context\n', 'utf8'));
      await vscode.workspace.fs.writeFile(rawFile, Buffer.from('# Raw Memories\n\n- Raw item\n', 'utf8'));
      await vscode.workspace.fs.writeFile(
        rolloutFile,
        Buffer.from('# Session Memory\n\n- rollout detail\n', 'utf8'),
      );

      const context = createToolContext({ storageRoot });

      const listResult = await getMemoryHandler({ view: 'list' }, context);
      assert.strictEqual(listResult.success, true);
      assert.ok(Array.isArray((listResult.data as any)?.rolloutSummaries));
      assert.ok(((listResult.data as any)?.rolloutSummaries as string[]).includes(rolloutFileName));

      const summaryResult = await getMemoryHandler({}, context);
      assert.strictEqual(summaryResult.success, true);
      assert.strictEqual(typeof summaryResult.data, 'string');
      assert.ok((summaryResult.data as string).includes('Focus item'));

      const rolloutResult = await getMemoryHandler(
        { view: 'rollout', rolloutFile: rolloutFileName },
        context,
      );
      assert.strictEqual(rolloutResult.success, true);
      assert.strictEqual(typeof rolloutResult.data, 'string');
      assert.ok((rolloutResult.data as string).includes('rollout detail'));

      const missingRollout = await getMemoryHandler(
        { view: 'rollout', rolloutFile: 'missing.md' },
        context,
      );
      assert.strictEqual(missingRollout.success, false);
      assert.strictEqual(
        (missingRollout.metadata as any)?.errorCode,
        TOOL_ERROR_CODES.memory_rollout_missing,
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('workspace memories build transcript-backed records and search them', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-search');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const manager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      const update = await manager.updateFromSessions(root);
      assert.strictEqual(update.enabled, true);

      const search = await manager.searchMemory({
        query: 'chunk memory by turn boundary',
        workspaceFolder: root,
        limit: 3,
      });
      assert.ok(search.hits.length > 0);
      assert.ok(search.hits.some(hit => hit.record.text.includes('chunk memory by turn boundary')));

      const durableSearch = await manager.searchMemory({
        query: 'real database not mocks',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      assert.ok(durableSearch.hits.length > 0);
      assert.strictEqual(durableSearch.hits[0]?.source, 'durable');
      assert.strictEqual(durableSearch.hits[0]?.durableEntry?.category, 'feedback');
      assert.ok(
        durableSearch.hits.some((hit) =>
          (hit.durableEntry?.text || hit.record.text).includes('Integration tests must hit a real database, not mocks.'),
        ),
      );
      assert.ok(
        !durableSearch.hits.some((hit) => hit.source === 'durable' && hit.matchedTerms.includes('maintenance')),
        'durable recall should ignore handbook/search metadata terms when scoring curated memories',
      );
      assert.ok(
        !durableSearch.hits.some((hit) => hit.source === 'durable' && hit.matchedTerms.includes('user')),
        'durable recall should not match on bookkeeping source labels alone',
      );

      const records = await manager.listMemoryRecords(root);

      assert.ok(records.some(record => record.kind === 'semantic'));
      assert.ok(records.some(record => record.kind === 'episodic'));
      assert.ok(records.some(record => record.kind === 'procedural'));
      assert.ok(records.some(record => record.signalKind === 'decision'));
      assert.ok(records.some(record => record.scope === 'user' || record.scope === 'workspace'));
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('workspace memories remove stale state for sessions that no longer exist', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-stale-session-prune');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const manager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      await manager.updateFromSessions(root);

      const initialSearch = await manager.searchMemory({
        query: 'real database not mocks',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      assert.ok(
        initialSearch.hits.some((hit) => hit.source === 'durable' && hit.durableEntry?.key.includes('real-database-not-mocks')),
        'expected the original persisted session to surface the durable testing-policy memory before replacement',
      );

      const agingProjectUpdatedAt = Date.now() - 25 * 24 * 60 * 60 * 1000;
      const agingProjectFreezeDate = new Date(agingProjectUpdatedAt + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const agingProjectDecision = `Merge freeze begins ${agingProjectFreezeDate} for mobile release cut.`;
      const agingProjectSignals = createBlankSessionSignals(agingProjectUpdatedAt);
      recordDecision(agingProjectSignals, agingProjectDecision);
      await seedPersistedSessions(storageRoot, [
        {
          id: 'session-aging-project-replacement',
          title: 'Release coordination note',
          createdAt: agingProjectUpdatedAt,
          updatedAt: agingProjectUpdatedAt,
          signals: agingProjectSignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'apr1',
              role: 'user',
              content: 'What is the merge freeze date?',
              timestamp: agingProjectUpdatedAt,
              turnId: 'turn-aging-project-replacement',
            },
            {
              id: 'apr2',
              role: 'assistant',
              content: agingProjectDecision,
              timestamp: agingProjectUpdatedAt + 60_000,
              turnId: 'turn-aging-project-replacement',
            },
          ],
          runtime: { wasRunning: false, updatedAt: agingProjectUpdatedAt + 60_000 },
        },
      ]);
      await manager.updateFromSessions(root);

      const staleSearch = await manager.searchMemory({
        query: 'real database not mocks',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      assert.strictEqual(
        staleSearch.hits.some((hit) => (hit.durableEntry?.text || hit.record.text).includes('Integration tests must hit a real database, not mocks.')),
        false,
        'removed sessions should no longer leak stale durable or raw testing-policy recall after the session store is replaced',
      );

      const agingSearch = await manager.searchMemory({
        query: `${agingProjectFreezeDate} merge freeze`,
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      assert.strictEqual(agingSearch.hits[0]?.source, 'durable');
      assert.strictEqual(agingSearch.hits[0]?.durableEntry?.category, 'project');
      assert.strictEqual(agingSearch.hits[0]?.durableEntry?.freshness, 'aging');
      assert.strictEqual(agingSearch.hits[0]?.durableEntry?.text, agingProjectDecision);
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('workspace memories scheduled refresh dedupes across instances', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-scheduled-refresh');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const context = {
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext;
      const managerA = new WorkspaceMemories(context);
      const managerB = new WorkspaceMemories(context);

      const refreshA = managerA.scheduleUpdateFromSessions(root, { delayMs: 10 });
      const refreshB = managerB.scheduleUpdateFromSessions(root, { delayMs: 10 });
      assert.strictEqual(refreshA, refreshB, 'background refresh should coalesce across instances');

      const result = await refreshA;
      assert.strictEqual(result.enabled, true);

      const search = await managerA.searchMemory({
        query: 'maybeRunExplorePrepass',
        workspaceFolder: root,
        limit: 3,
      });
      assert.ok(search.hits.length > 0);
      assert.ok(search.hits.some(hit => hit.record.text.includes('AgentLoop.withRun')));
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('get_memory search returns transcript-backed matches', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-search-tool');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const manager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      await manager.updateFromSessions(root);

      const context = createToolContext({ storageRoot });
      const result = await getMemoryHandler(
        { view: 'search', query: 'maybeRunExplorePrepass', limit: 3, neighborWindow: 0 },
        context,
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(typeof result.data, 'string');
      assert.ok(String(result.data).includes('Match 1'));
      assert.ok(String(result.data).includes('AgentLoop.withRun'));
      assert.ok(String(result.data).includes('confidence='));
      assert.ok(String(result.data).includes('maintenance_hint: maintain_memory'));

      const durableResult = await getMemoryHandler(
        { view: 'search', query: 'real database not mocks', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(durableResult.success, true);
      const durableSearchText = String(durableResult.data);
      assert.ok(durableSearchText.includes('guidance: Integration tests must hit a real database, not mocks.'));
      assert.ok(
        !durableSearchText.includes(
          'how_to_apply: Apply this by default on similar tasks in this workspace unless newer guidance overrides it.',
        ),
        'selective search output should omit synthesized default how_to_apply guidance for non-reference durable memories',
      );
      assert.ok(
        !durableSearchText.includes('maintenance: maintain_memory'),
        'durable search should not match or surface handbook metadata copied into durable text',
      );

      const projectScopeResult = await getMemoryHandler(
        { view: 'search', query: 'real database not mocks', scope: 'project', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(projectScopeResult.success, true);
      assert.strictEqual((projectScopeResult.metadata as any)?.scope, 'workspace');
      assert.ok(String(projectScopeResult.data).includes('<memory view="search" query="real database not mocks" scope="workspace">'));

      const privateScopeMiss = await getMemoryHandler(
        { view: 'search', query: 'real database not mocks', scope: 'private', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(privateScopeMiss.success, true);
      assert.strictEqual((privateScopeMiss.metadata as any)?.scope, 'user');
      assert.ok(String(privateScopeMiss.data).includes('<memory view="search" query="real database not mocks" scope="user">'));

      const invalidScopeResult = await getMemoryHandler(
        { view: 'search', query: 'real database not mocks', scope: 'team-personal', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(invalidScopeResult.success, false);
      assert.ok(String(invalidScopeResult.error).includes('scope must be one of'));
      assert.ok(String(invalidScopeResult.error).includes('private/profile'));
      assert.ok(String(invalidScopeResult.error).includes('thread/conversation'));

      const enrichedSearch = await manager.searchMemory({
        query: 'real database not mocks',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      const enrichedDurableHit = enrichedSearch.hits.find((hit) => hit.source === 'durable' && hit.durableEntry?.key);
      assert.ok(enrichedDurableHit, 'expected durable hit before enriching durable search fixture');
      await manager.maintainMemory({
        action: 'supersede',
        workspaceFolder: root,
        recordId: enrichedDurableHit!.record.id,
        durableKey: enrichedDurableHit!.durableEntry!.key,
        replacementText: [
          'Prefer integration tests against a seeded ephemeral database instance.',
          'Why: prior mocked tests hid migration failures until production.',
          'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
        ].join('\n'),
        note: 'Enrich durable search fixture with explicit rationale and application guidance.',
      });

      const whyPreferredResult = await getMemoryHandler(
        { view: 'search', query: 'why seeded ephemeral database instance', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(whyPreferredResult.success, true);
      const whyPreferredText = String(whyPreferredResult.data);
      const whyIndex = whyPreferredText.indexOf('why: prior mocked tests hid migration failures until production.');
      const howIndex = whyPreferredText.indexOf(
        'how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      );
      assert.ok(whyIndex >= 0, 'expected why line for motivation-seeking durable search');
      assert.ok(howIndex < 0, 'motivation-seeking durable search should foreground why without dumping lower-priority fields');

      const howPreferredResult = await getMemoryHandler(
        { view: 'search', query: 'how should we apply seeded ephemeral database instance', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(howPreferredResult.success, true);
      const howPreferredText = String(howPreferredResult.data);
      const preferredHowIndex = howPreferredText.indexOf(
        'how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      );
      const preferredWhyIndex = howPreferredText.indexOf('why: prior mocked tests hid migration failures until production.');
      assert.ok(preferredHowIndex >= 0, 'expected how_to_apply line for application-seeking durable search');
      assert.ok(preferredWhyIndex < 0, 'application-seeking durable search should foreground how_to_apply without dumping lower-priority fields');

      const referenceContext = createToolContext({ storageRoot });
      const referenceManager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      const referenceNow = Date.now();
      const referenceSignals = createBlankSessionSignals(referenceNow);
      recordDecision(referenceSignals, 'Pipeline bugs are tracked in Linear project INGEST.');
      await seedPersistedSessions(storageRoot, [
        buildPersistedSession(now),
        {
          id: 'session-reference-1',
          title: 'Reference pointer discussion',
          createdAt: referenceNow - 6_000,
          updatedAt: referenceNow - 6_000,
          signals: referenceSignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'r1',
              role: 'user',
              content: 'Where do we track pipeline bugs?',
              timestamp: referenceNow - 6_000,
              turnId: 'turn-reference',
            },
            {
              id: 'r2',
              role: 'assistant',
              content: 'Check Linear project INGEST for pipeline bugs.',
              timestamp: referenceNow - 5_950,
              turnId: 'turn-reference',
            },
            {
              id: 'r3',
              role: 'assistant',
              content: 'Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
              timestamp: referenceNow - 5_900,
              turnId: 'turn-reference',
            },
          ],
          runtime: { wasRunning: false, updatedAt: referenceNow - 5_900 },
        },
      ]);
      await referenceManager.updateFromSessions(root);

      const referenceResult = await getMemoryHandler(
        { view: 'search', query: 'linear ingest pipe-421', limit: 4, neighborWindow: 0 },
        referenceContext,
      );
      assert.strictEqual(referenceResult.success, true);
      const referenceSearchText = String(referenceResult.data);
      assert.ok(referenceSearchText.includes('pointer: Pipeline bugs are tracked in Linear project INGEST.'));
      assert.ok(
        referenceSearchText.includes(
          'how_to_apply: Use this as a pointer to the relevant external context, then open the referenced system or document for current details.',
        ),
        'reference durable search should preserve pointer-to-current-truth semantics even when how_to_apply is synthesized',
      );
      assert.ok(
        referenceSearchText.includes('evidence: Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.'),
        'reference durable search should keep transcript-backed raw support when it adds a distinct external identifier',
      );
      assert.ok(
        referenceSearchText.includes('evidence_title: Reference pointer discussion'),
        'reference durable search should keep a compact title pointer for transcript-backed evidence',
      );
      assert.ok(
        !referenceSearchText.includes('Structured memory candidates:'),
        'reference durable search should suppress redundant semantic session summaries when durable plus richer raw support already cover the query',
      );

      const agingProjectContext = createToolContext({ storageRoot });
      const agingProjectManager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      const agingProjectUpdatedAt = Date.now() - 25 * 24 * 60 * 60 * 1000 - 120_000;
      const agingProjectFreezeDate = new Date(agingProjectUpdatedAt + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const agingProjectDecision = `Merge freeze begins ${agingProjectFreezeDate} for mobile release cut.`;
      const agingProjectSignals = createBlankSessionSignals(agingProjectUpdatedAt);
      recordDecision(agingProjectSignals, agingProjectDecision);
      await seedPersistedSessions(storageRoot, [
        {
          id: 'session-aging-project-1',
          title: 'Release coordination note',
          createdAt: agingProjectUpdatedAt,
          updatedAt: agingProjectUpdatedAt,
          signals: agingProjectSignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'ap1',
              role: 'user',
              content: 'What is the merge freeze date?',
              timestamp: agingProjectUpdatedAt,
              turnId: 'turn-aging-project',
            },
            {
              id: 'ap2',
              role: 'assistant',
              content: agingProjectDecision,
              timestamp: agingProjectUpdatedAt + 60_000,
              turnId: 'turn-aging-project',
            },
          ],
          runtime: { wasRunning: false, updatedAt: agingProjectUpdatedAt + 60_000 },
        },
      ]);
      await agingProjectManager.updateFromSessions(root);

      const agingProjectResult = await getMemoryHandler(
        { view: 'search', query: `${agingProjectFreezeDate} merge freeze`, limit: 3, neighborWindow: 0 },
        agingProjectContext,
      );
      assert.strictEqual(agingProjectResult.success, true);
      const agingProjectSearchText = String(agingProjectResult.data);
      assert.ok(
        agingProjectSearchText.includes(`prior: ${agingProjectDecision}`),
        'aging project durable search should surface prior-context labeling instead of a plain fact label',
      );
      assert.match(
        agingProjectSearchText,
        /last_confirmed: .* age_days=25 age_label="25 days old"/,
        `aging project durable search should include human-readable age metadata\n${agingProjectSearchText}`,
      );
      assert.ok(
        agingProjectSearchText.includes('verification_caveat: memory is 25 days old and marked aging; verify against current workspace/source before relying on it.'),
        `aging project durable search should include a stale-memory verification caveat\n${agingProjectSearchText}`,
      );

      const currentStateMixedContext = createToolContext({ storageRoot });
      const currentStateMixedManager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      const currentStateMixedNow = Date.now();
      const currentStateReferenceSignals = createBlankSessionSignals(currentStateMixedNow);
      recordDecision(currentStateReferenceSignals, 'Pipeline bugs are tracked in Linear project INGEST.');
      const currentStateProjectSignals = createBlankSessionSignals(currentStateMixedNow - 10_000);
      recordDecision(currentStateProjectSignals, 'Merge freeze begins 2026-03-05 for mobile release cut.');
      await seedPersistedSessions(storageRoot, [
        {
          id: 'session-current-state-reference-order',
          title: 'Current-state reference pointer',
          createdAt: currentStateMixedNow - 6_000,
          updatedAt: currentStateMixedNow - 6_000,
          signals: currentStateReferenceSignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'csr1',
              role: 'assistant',
              content: 'Check Linear project INGEST for the latest pipeline bugs.',
              timestamp: currentStateMixedNow - 5_950,
              turnId: 'turn-current-state-reference-order',
            },
          ],
          runtime: { wasRunning: false, updatedAt: currentStateMixedNow - 5_950 },
        },
        {
          id: 'session-current-state-project-order',
          title: 'Current-state project prior',
          createdAt: currentStateMixedNow - 12_000,
          updatedAt: currentStateMixedNow - 12_000,
          signals: currentStateProjectSignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'csp1',
              role: 'assistant',
              content: 'Merge freeze begins 2026-03-05 for mobile release cut.',
              timestamp: currentStateMixedNow - 11_950,
              turnId: 'turn-current-state-project-order',
            },
          ],
          runtime: { wasRunning: false, updatedAt: currentStateMixedNow - 11_950 },
        },
      ]);
      await currentStateMixedManager.updateFromSessions(root);

      const currentStateMixedResult = await getMemoryHandler(
        {
          view: 'search',
          query: 'where should I check the latest pipeline bugs in INGEST, and is the 2026-03-05 merge freeze still in effect for mobile release cut?',
          limit: 4,
          neighborWindow: 0,
        },
        currentStateMixedContext,
      );
      assert.strictEqual(currentStateMixedResult.success, true);
      const currentStateMixedSearchText = String(currentStateMixedResult.data);
      const pointerIndex = currentStateMixedSearchText.indexOf('pointer: Pipeline bugs are tracked in Linear project INGEST.');
      const priorIndex = currentStateMixedSearchText.indexOf('prior: Merge freeze begins 2026-03-05 for mobile release cut.');
      assert.ok(pointerIndex >= 0, 'expected current-truth reference pointer to survive mixed current-state search');
      assert.ok(priorIndex >= 0, 'expected anchored project prior context to survive mixed current-state search');
      assert.ok(
        pointerIndex < priorIndex,
        `mixed current-state search should order the current-truth reference pointer ahead of project prior context\n${currentStateMixedSearchText}`,
      );
      assert.ok(
        !currentStateMixedSearchText.includes('how_to_apply: Apply this by default on similar tasks in this workspace unless newer guidance overrides it.'),
        `mixed current-state search should keep the later project prior compact instead of dumping default how-to-apply guidance\n${currentStateMixedSearchText}`,
      );
      const laterProjectSectionStart = currentStateMixedSearchText.indexOf('## Match 2 [durable:project]');
      const nextSectionStart = currentStateMixedSearchText.indexOf('## Match 3 [', laterProjectSectionStart + 1);
      const laterProjectSection = laterProjectSectionStart >= 0
        ? currentStateMixedSearchText.slice(laterProjectSectionStart, nextSectionStart >= 0 ? nextSectionStart : undefined)
        : currentStateMixedSearchText;
      assert.ok(
        !laterProjectSection.includes('session_id:'),
        `mixed current-state search should suppress low-value metadata on later additive project prior hits after a stronger reference pointer already leads\n${currentStateMixedSearchText}`,
      );
      assert.ok(
        !laterProjectSection.includes('chunk_id:'),
        `mixed current-state search should suppress chunk metadata on later additive project prior hits after a stronger reference pointer already leads\n${currentStateMixedSearchText}`,
      );
      assert.ok(
        !laterProjectSection.includes('score_breakdown:'),
        `mixed current-state search should suppress score breakdown metadata on later additive project prior hits after a stronger reference pointer already leads\n${currentStateMixedSearchText}`,
      );
      const laterRawProjectSectionStart = currentStateMixedSearchText.indexOf('## Match 4 [episodic]');
      const laterRawProjectSection = laterRawProjectSectionStart >= 0
        ? currentStateMixedSearchText.slice(laterRawProjectSectionStart)
        : currentStateMixedSearchText;
      assert.ok(
        !laterRawProjectSection.includes('evidence_title:'),
        `mixed current-state search should keep later raw project support compact after a stronger reference pointer already leads\n${currentStateMixedSearchText}`,
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('searchMemory honors no-memory queries and returns no recall', async () => {
    const result = new WorkspaceMemories({
      storageUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      globalStorageUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    } as unknown as vscode.ExtensionContext);
    const search = await result.searchMemory({
      query: 'Explain this pasted snippet without memory.',
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
      limit: 3,
    });
    assert.strictEqual(search.hits.length, 0);
  });

  test('searchMemoryRecords keeps same-cluster raw support for reference memories when it adds distinct external identifiers', () => {
    const entry = buildDurableEntry('Pipeline bugs are tracked in Linear project INGEST.', {
      key: 'reference:linear-ingest',
      category: 'reference',
      freshness: 'fresh',
      titles: ['External bug tracker'],
      filesTouched: [],
      toolsUsed: [],
    });
    const supportRecord = {
      id: 'record-reference-support-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'External bug tracker',
      text: 'Pipeline bugs are tracked in Linear project INGEST.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'workspace' as const,
      confidence: 0.86,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:00:00.000Z'),
      staleness: 'fresh' as const,
      memoryKey: 'reference:linear-ingest',
    };
    const rawEvidenceRecord = {
      id: 'record-reference-support-2',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'episodic' as const,
      title: 'External bug tracker details',
      text: 'Assistant: Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 1,
      scope: 'session' as const,
      confidence: 0.74,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      staleness: 'fresh' as const,
      turnId: 'turn-reference',
    };
    const summaryRecord = {
      id: 'record-reference-summary-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-1',
      kind: 'semantic' as const,
      title: 'Reference pointer discussion',
      text: 'Session "Reference pointer discussion" updated at 2026-01-01T10:05:00.000Z. Structured memory candidates: decision=Pipeline bugs are tracked in Linear project INGEST.',
      sourceUpdatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      generatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 2,
      scope: 'workspace' as const,
      confidence: 0.82,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-01T10:05:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: 'summary' as const,
      memoryKey: 'session-memory-1:semantic',
    };

    const result = searchMemoryRecords({
      records: [supportRecord, rawEvidenceRecord, summaryRecord],
      durableEntries: [entry],
      query: 'linear ingest pipe-421',
      workspaceId: 'workspace-1',
      limit: 4,
      neighborWindow: 0,
      now: Date.parse('2026-01-02T10:00:00.000Z'),
      preferDurableFirst: true,
    });

    assert.strictEqual(result.hits[0]?.source, 'durable');
    assert.ok(
      result.hits.some((hit) => hit.source === 'record' && hit.record.id === 'record-reference-support-2'),
      'reference durable hits should keep transcript-backed raw support when it contributes a distinct external identifier',
    );
    assert.ok(
      !result.hits.some((hit) => hit.record.id === 'record-reference-summary-1'),
      'reference durable hits should suppress redundant semantic session summaries when durable plus richer raw support already cover the query',
    );
  });

  test('searchMemoryRecords suppresses same-session summary hits when richer raw evidence already covers the query without durable memory', () => {
    const rawEvidenceRecord = {
      id: 'record-session-raw-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-2',
      kind: 'episodic' as const,
      title: 'Memory search refinement',
      text: 'Assistant: Wire summary suppression into filteredRawMatches in packages/vscode-extension/src/core/memories/search.ts and validate with memory tests.',
      sourceUpdatedAt: Date.parse('2026-01-03T09:05:00.000Z'),
      generatedAt: Date.parse('2026-01-03T09:05:00.000Z'),
      filesTouched: ['packages/vscode-extension/src/core/memories/search.ts'],
      toolsUsed: ['edit'],
      index: 0,
      scope: 'session' as const,
      confidence: 0.76,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-03T09:05:00.000Z'),
      staleness: 'fresh' as const,
      turnId: 'turn-session-raw',
    };
    const summaryRecord = {
      id: 'record-session-summary-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-2',
      kind: 'semantic' as const,
      title: 'Memory search refinement session',
      text: 'Session "Memory search refinement session" updated at 2026-01-03T09:05:00.000Z. Structured memory candidates: procedure=Wire summary suppression into filteredRawMatches in packages/vscode-extension/src/core/memories/search.ts and validate with memory tests.',
      sourceUpdatedAt: Date.parse('2026-01-03T09:05:00.000Z'),
      generatedAt: Date.parse('2026-01-03T09:05:00.000Z'),
      filesTouched: ['packages/vscode-extension/src/core/memories/search.ts'],
      toolsUsed: ['edit'],
      index: 1,
      scope: 'workspace' as const,
      confidence: 0.8,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-03T09:05:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: 'summary' as const,
      memoryKey: 'session-memory-2:semantic',
    };

    const result = searchMemoryRecords({
      records: [rawEvidenceRecord, summaryRecord],
      durableEntries: [],
      query: 'filteredrawmatches search.ts summary suppression',
      workspaceId: 'workspace-1',
      limit: 4,
      neighborWindow: 0,
      now: Date.parse('2026-01-04T09:00:00.000Z'),
    });

    assert.ok(
      result.hits.some((hit) => hit.record.id === 'record-session-raw-1'),
      'same-session raw evidence should survive when it directly covers the query',
    );
    assert.ok(
      !result.hits.some((hit) => hit.record.id === 'record-session-summary-1'),
      'same-session summary hits should be suppressed when they add no distinct support beyond richer raw evidence',
    );
  });

  test('searchMemoryRecords keeps same-session summary hits when they add distinct navigation support without durable memory', async () => {
    const rawEvidenceRecord = {
      id: 'record-session-raw-2',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-3',
      kind: 'episodic' as const,
      title: 'Pipeline tracker pointer',
      text: 'Assistant: Check Linear project INGEST for the current pipeline bug context.',
      sourceUpdatedAt: Date.parse('2026-01-03T10:05:00.000Z'),
      generatedAt: Date.parse('2026-01-03T10:05:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 0,
      scope: 'session' as const,
      confidence: 0.75,
      evidenceCount: 1,
      lastConfirmedAt: Date.parse('2026-01-03T10:05:00.000Z'),
      staleness: 'fresh' as const,
      turnId: 'turn-session-reference',
    };
    const summaryRecord = {
      id: 'record-session-summary-2',
      workspaceId: 'workspace-1',
      sessionId: 'session-memory-3',
      kind: 'semantic' as const,
      title: 'Pipeline tracker pointer summary',
      text: 'Session "Pipeline tracker pointer summary" updated at 2026-01-03T10:05:00.000Z. Structured memory candidates: reference=Pipeline bugs are tracked in Linear project INGEST. Also see PIPE-421 for the latest incident context.',
      sourceUpdatedAt: Date.parse('2026-01-03T10:05:00.000Z'),
      generatedAt: Date.parse('2026-01-03T10:05:00.000Z'),
      filesTouched: [],
      toolsUsed: [],
      index: 1,
      scope: 'workspace' as const,
      confidence: 0.83,
      evidenceCount: 2,
      lastConfirmedAt: Date.parse('2026-01-03T10:05:00.000Z'),
      staleness: 'fresh' as const,
      signalKind: 'summary' as const,
      memoryKey: 'session-memory-3:semantic',
    };

    const result = searchMemoryRecords({
      records: [rawEvidenceRecord, summaryRecord],
      durableEntries: [],
      query: 'linear ingest pipe-421',
      workspaceId: 'workspace-1',
      limit: 4,
      neighborWindow: 0,
      now: Date.parse('2026-01-04T10:00:00.000Z'),
    });

    assert.ok(
      result.hits.some((hit) => hit.record.id === 'record-session-raw-2'),
      'same-session raw evidence should still be recallable',
    );
    assert.ok(
      result.hits.some((hit) => hit.record.id === 'record-session-summary-2'),
      'same-session summary hits should survive when they add distinct navigation support such as a new external identifier',
    );

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');
    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');
    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-summary-rendering');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      const referenceSignals = createBlankSessionSignals(now);
      recordDecision(referenceSignals, 'Pipeline bugs are tracked in Linear project INGEST.');
      await seedPersistedSessions(storageRoot, [
        {
          id: 'session-summary-render-1',
          title: 'Pipeline tracker pointer summary',
          createdAt: now - 6_000,
          updatedAt: now - 6_000,
          signals: referenceSignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'sr1',
              role: 'user',
              content: 'Where do we track pipeline bugs?',
              timestamp: now - 6_000,
              turnId: 'turn-summary-render',
            },
            {
              id: 'sr2',
              role: 'assistant',
              content: 'Check Linear project INGEST for the current pipeline bug context.',
              timestamp: now - 5_950,
              turnId: 'turn-summary-render',
            },
            {
              id: 'sr3',
              role: 'assistant',
              content: 'Also see PIPE-421 for the latest incident context.',
              timestamp: now - 5_900,
              turnId: 'turn-summary-render',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 5_900 },
        },
      ]);

      const manager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      await manager.updateFromSessions(root);

      const context = createToolContext({ storageRoot });
      const searchResult = await getMemoryHandler(
        { view: 'search', query: 'linear ingest', kind: 'semantic', limit: 3, neighborWindow: 0 },
        context,
      );
      assert.strictEqual(searchResult.success, true);
      const searchText = String(searchResult.data);
      assert.ok(searchText.includes('summary: Pipeline bugs are tracked in Linear project INGEST.'));
      assert.ok(searchText.includes('summary_title: Pipeline tracker pointer summary'));
      assert.ok(!searchText.includes('Structured memory candidates:'));
      assert.ok(!searchText.includes('Session "Pipeline tracker pointer summary" updated at'));
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('maintain_memory invalidates and supersedes durable records', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');
    const prevIdleHours = cfg.get('memories.minRolloutIdleHours');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-maintain-memory');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);

      const now = Date.now();
      await seedPersistedSessions(storageRoot, [buildPersistedSession(now)]);

      const context = createToolContext({ storageRoot });
      const update = await updateMemoryHandler({}, context);
      assert.strictEqual(update.success, true);

      const manager = new WorkspaceMemories({
        storageUri: storageRoot,
        globalStorageUri: storageRoot,
      } as unknown as vscode.ExtensionContext);
      const initialSearch = await manager.searchMemory({
        query: 'real database not mocks',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      const durableHit = initialSearch.hits.find((hit) => hit.source === 'durable' && hit.durableEntry?.key);
      assert.ok(durableHit, 'expected durable search hit for maintained feedback memory');
      const durableKey = durableHit!.durableEntry!.key;
      const supportRecordId = durableHit!.record.id;

      const invalidate = await maintainMemoryHandler(
        { action: 'invalidate', recordId: supportRecordId, durableKey, note: 'Policy changed during review.' },
        context,
      );
      assert.strictEqual(invalidate.success, true);
      assert.strictEqual((invalidate.data as any)?.action, 'invalidate');

      const invalidatedRecords = await manager.listMemoryRecords(root);
      assert.ok(
        invalidatedRecords.some(
          (record) => String(record.memoryKey || '').trim() === durableKey && record.staleness === 'invalidated',
        ),
        'expected at least one invalidated record in the durable memory cluster',
      );

      const supersedeText = [
        'Prefer integration tests against a seeded ephemeral database instance.',
        'Why: prior mocked tests hid migration failures until production.',
        'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      ].join('\n');
      const supersede = await maintainMemoryHandler(
        {
          action: 'supersede',
          recordId: supportRecordId,
          durableKey,
          replacementText: supersedeText,
          note: 'Team moved to ephemeral seeded DBs.',
        },
        context,
      );
      assert.strictEqual(supersede.success, true);
      assert.strictEqual((supersede.data as any)?.action, 'supersede');
      assert.ok(Array.isArray((supersede.data as any)?.affectedRecordIds));
      assert.ok(((supersede.data as any)?.affectedRecordIds as string[]).length >= 2);
      assert.strictEqual(typeof (supersede.data as any)?.hint, 'string');

      const search = await manager.searchMemory({
        query: 'seeded ephemeral database instance',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      assert.ok(search.hits.length > 0);
      assert.strictEqual(search.hits[0]?.source, 'durable');
      assert.strictEqual(search.hits[0]?.durableEntry?.key, durableKey);
      assert.ok(
        search.hits.some(
          (hit) =>
            hit.record.text.includes('seeded ephemeral database instance') ||
            hit.durableEntry?.text.includes('seeded ephemeral database instance'),
        ),
      );
      assert.ok(
        !search.hits.some(
          (hit) => hit.source === 'record' && String(hit.record.memoryKey || '').trim() === durableKey,
        ),
        'durable-first recall should avoid returning redundant raw matches from the same durable cluster',
      );

      const summary = await getMemoryHandler({ view: 'summary', maxChars: 20_000 }, context);
      assert.strictEqual(summary.success, true);
      assert.ok(String(summary.data).includes('seeded ephemeral database instance'));
      assert.ok(String(summary.data).includes(`key=${durableKey}`));
      assert.ok(!String(summary.data).includes('confidence='));

      const searchResult = await getMemoryHandler(
        { view: 'search', query: 'seeded ephemeral database instance', limit: 3, neighborWindow: 0, maxChars: 20_000 },
        context,
      );
      assert.strictEqual(searchResult.success, true);
      const searchText = String(searchResult.data);
      assert.ok(searchText.includes(`durable_key: ${durableKey}`));
      assert.ok(searchText.includes('guidance: Prefer integration tests against a seeded ephemeral database instance.'));
      assert.ok(searchText.includes('why: prior mocked tests hid migration failures until production.'));
      assert.ok(
        searchText.includes(
          'how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
        ),
      );

      const memory = await getMemoryHandler({ view: 'memory', maxChars: 20_000 }, context);
      assert.strictEqual(memory.success, true);
      const memoryText = String(memory.data);
      assert.ok(memoryText.includes('memory_topics/feedback.md'));
      assert.ok(memoryText.includes(`key=${durableKey}`));
      assert.ok(!memoryText.includes('maintenance: maintain_memory'));

      const feedbackTopic = await getMemoryHandler({ view: 'topic', topicFile: 'feedback.md', maxChars: 20_000 }, context);
      assert.strictEqual(feedbackTopic.success, true);
      const feedbackTopicText = String(feedbackTopic.data);
      assert.ok(feedbackTopicText.includes('durable_key:'));
      assert.ok(feedbackTopicText.includes('maintenance: maintain_memory'));
      assert.ok(feedbackTopicText.includes('- guidance: Prefer integration tests against a seeded ephemeral database instance.'));
      assert.ok(feedbackTopicText.includes('- why: prior mocked tests hid migration failures until production.'));
      assert.ok(
        feedbackTopicText.includes(
          '- how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
        ),
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await cfg.update('memories.minRolloutIdleHours', prevIdleHours, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('get_memory search keeps later raw project support compact after a raw reference pointer already leads current-state routing', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');
    const context = createToolContext({ storageRoot: root });
    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: {
                id: 'raw-reference-current-search',
                workspaceId: 'test-workspace',
                sessionId: 'raw-reference-current-search-session',
                kind: 'episodic' as const,
                title: 'External bug tracker details',
                text: 'Assistant: Use Linear project INGEST for the latest pipeline bug context.',
                sourceUpdatedAt: Date.now() - 10_000,
                generatedAt: Date.now() - 10_000,
                filesTouched: [],
                toolsUsed: [],
                index: 0,
                scope: 'session' as const,
                confidence: 0.78,
                evidenceCount: 1,
                lastConfirmedAt: Date.now() - 10_000,
                staleness: 'fresh' as const,
              },
              source: 'record' as const,
              score: 27.8,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline', 'ingest'],
            },
            {
              record: {
                id: 'raw-project-current-search',
                workspaceId: 'test-workspace',
                sessionId: 'raw-project-current-search-session',
                kind: 'episodic' as const,
                title: 'Release coordination details',
                text: 'Assistant: The 2026-03-05 merge freeze for mobile release cut is tracked in Tuesday release triage notes.',
                sourceUpdatedAt: Date.now() - 9_000,
                generatedAt: Date.now() - 9_000,
                filesTouched: [],
                toolsUsed: [],
                index: 1,
                scope: 'session' as const,
                confidence: 0.79,
                evidenceCount: 1,
                lastConfirmedAt: Date.now() - 9_000,
                staleness: 'fresh' as const,
              },
              source: 'record' as const,
              score: 27.1,
              reason: 'match' as const,
              matchedTerms: ['2026-03-05', 'merge', 'freeze', 'mobile'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      const result = await getMemoryHandler(
        {
          view: 'search',
          query: 'where should I check the latest pipeline bugs in INGEST, and is the 2026-03-05 merge freeze still in effect for mobile release cut?',
          limit: 4,
          neighborWindow: 0,
        },
        context,
      );

      assert.strictEqual(result.success, true);
      const text = String(result.data);
      const rawProjectSectionStart = text.indexOf('## Match 2 [episodic]');
      const rawProjectSection = rawProjectSectionStart >= 0 ? text.slice(rawProjectSectionStart) : text;
      assert.ok(text.includes('Use Linear project INGEST for the latest pipeline bug context.'));
      assert.ok(text.includes('evidence: The 2026-03-05 merge freeze for mobile release cut is tracked in Tuesday release triage notes.'));
      assert.ok(
        !rawProjectSection.includes('evidence_title:'),
        `raw-only mixed current-state search should keep later raw project support compact after a raw reference pointer already leads\n${text}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
    }
  });

  test('get_memory search miss schedules a background refresh and returns immediately', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for memory tests');

    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get('features.memories');

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-test-storage-search-miss');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;
    const originalScheduleUpdateFromSessions = WorkspaceMemories.prototype.scheduleUpdateFromSessions;
    let scheduledRefreshes = 0;

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [],
          totalTokens: 0,
          truncated: false,
        };
      };
      WorkspaceMemories.prototype.scheduleUpdateFromSessions = async function () {
        scheduledRefreshes += 1;
        return {
          enabled: true,
          scannedSessions: 0,
          processedSessions: 0,
          insertedOutputs: 0,
          updatedOutputs: 0,
          retainedOutputs: 0,
          skippedRecentSessions: 0,
          skippedPlanOrSubagentSessions: 0,
          skippedNoSignalSessions: 0,
        };
      };

      const context = createToolContext({ storageRoot });
      const result = await getMemoryHandler(
        { view: 'search', query: 'still indexing', limit: 3, neighborWindow: 0 },
        context,
      );

      assert.strictEqual(result.success, true);
      assert.ok(String(result.data).includes('(no matching memory)'));
      assert.strictEqual(scheduledRefreshes, 1, 'search miss should schedule one background refresh');
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      WorkspaceMemories.prototype.scheduleUpdateFromSessions = originalScheduleUpdateFromSessions;
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      try {
        await cfg.update('features.memories', prevEnabled, true);
      } catch {
        // ignore
      }
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });
});
