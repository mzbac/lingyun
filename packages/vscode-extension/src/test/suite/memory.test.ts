import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { TOOL_ERROR_CODES } from '@kooka/core';
import { WorkspaceMemories } from '../../core/memories';
import { SessionStore } from '../../core/sessionStore';
import { createBlankSessionSignals } from '../../core/sessionSignals';
import { getMemoryHandler } from '../../tools/builtin/getMemory';

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

suite('Memory Tool', () => {
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

      const records = await manager.listMemoryRecords(root);
      assert.ok(records.some(record => record.kind === 'semantic'));
      assert.ok(records.some(record => record.kind === 'episodic'));
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
