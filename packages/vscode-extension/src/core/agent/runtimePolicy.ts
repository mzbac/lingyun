import * as path from 'path';
import * as vscode from 'vscode';

import type {
  LingyunAgentPreparedRun,
  LingyunAgentRuntimeContext,
  LingyunAgentRuntimePolicy,
  LingyunAgentRuntimeSnapshot,
  LingyunAgentSyntheticContext,
} from '@kooka/agent-sdk';
import { getUserHistoryInputText, resolveBuiltinSubagent } from '@kooka/core';

import { getCompactionConfig, getModelLimit } from '../compaction';
import { findGitRoot, loadInstructions } from '../instructions';
import { WorkspaceMemories, getMemoriesConfig } from '../memories';
import { getConfiguredReasoningEffort } from '../reasoningEffort';
import { getPrimaryWorkspaceFolderUri } from '../workspaceContext';

import { DEFAULT_SYSTEM_PROMPT } from './prompts';

const EXPLORE_COMPACTION_RESTORE_MAX_CHARS = 6000;
const MEMORY_RECALL_COMPACTION_RESTORE_MAX_CHARS = 4000;

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\/+$/, '') || '/';
  const parent = path.posix.dirname(normalized);
  if (parent === normalized) return uri;
  return uri.with({ path: parent });
}

type PreparedRuntime = {
  systemPrompt: string;
  allowExternalPaths: boolean;
  reasoningEffort: string;
  taskMaxOutputChars: number;
  snapshot: LingyunAgentRuntimeSnapshot;
};

export class VsCodeAgentRuntimePolicy implements LingyunAgentRuntimePolicy {
  private instructionsText?: string;
  private instructionsKey?: string;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async prepareRun(ctx: LingyunAgentRuntimeContext): Promise<LingyunAgentPreparedRun> {
    const runtime = await this.prepareRuntime(ctx);
    const syntheticContexts: LingyunAgentSyntheticContext[] = [];

    if (!ctx.input) {
      return { runtime: runtime.snapshot };
    }

    const exploreContext = await this.maybeRunExplorePrepass(ctx, runtime);
    if (exploreContext) syntheticContexts.push(exploreContext);

    const memoryRecallContext = await this.maybeInjectMemoryRecall(ctx);
    if (memoryRecallContext) syntheticContexts.push(memoryRecallContext);

    return {
      runtime: runtime.snapshot,
      ...(syntheticContexts.length > 0 ? { syntheticContexts } : {}),
    };
  }

  private async prepareRuntime(ctx: LingyunAgentRuntimeContext): Promise<PreparedRuntime> {
    await this.refreshInstructions();

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const allowExternalPaths =
      cfg.get<boolean>('security.allowExternalPaths', false) ?? false;
    const reasoningEffort = getConfiguredReasoningEffort();
    const taskMaxOutputChars = cfg.get<number>('subagents.task.maxOutputChars', 8000) ?? 8000;

    const modelId = String(ctx.config.model || '').trim();
    const modelLimit =
      modelId ? getModelLimit(modelId, ctx.llm.id) ?? (await ctx.warmModelLimit(modelId)) : undefined;
    const systemPrompt = this.composeSystemPromptText(ctx.config.systemPrompt);
    const compaction = getCompactionConfig();

    return {
      systemPrompt,
      allowExternalPaths,
      reasoningEffort,
      taskMaxOutputChars,
      snapshot: {
        systemPrompt,
        allowExternalPaths,
        reasoningEffort,
        taskMaxOutputChars,
        compaction,
        ...(modelId && modelLimit ? { modelLimits: { [modelId]: modelLimit } } : { modelLimits: undefined }),
      },
    };
  }

  private getWorkspaceRootForContext(): vscode.Uri | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const workspaceFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    return workspaceFolder?.uri ?? getPrimaryWorkspaceFolderUri();
  }

  private async refreshInstructions(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRootForContext();
    const activeEditor = vscode.window.activeTextEditor;

    const isActiveEditorInWorkspace =
      !!workspaceRoot &&
      !!activeEditor &&
      workspaceRoot.scheme === 'file' &&
      activeEditor.document.uri.scheme === 'file';

    const startDir =
      isActiveEditorInWorkspace && activeEditor ? dirnameUri(activeEditor.document.uri) : workspaceRoot;
    if (!startDir) return;

    const stopDir = workspaceRoot ? await findGitRoot(startDir, workspaceRoot) : startDir;
    const extraInstructionPatterns =
      vscode.workspace.getConfiguration('lingyun').get<string[]>('instructions') || [];

    const key = [
      startDir.toString(),
      stopDir.toString(),
      workspaceRoot?.toString() || '',
      JSON.stringify(extraInstructionPatterns),
    ].join('|');

    if (this.instructionsKey === key) return;
    this.instructionsKey = key;

    try {
      const loaded = await loadInstructions({
        startDir,
        workspaceRoot,
        stopDir,
        extraInstructionPatterns,
        includeGlobal: true,
      });
      this.instructionsText = loaded.text;
    } catch {
      this.instructionsText = undefined;
    }
  }

  private composeSystemPromptText(basePrompt?: string): string {
    const prompt = typeof basePrompt === 'string' && basePrompt.trim() ? basePrompt : DEFAULT_SYSTEM_PROMPT;
    return [prompt, this.instructionsText].filter(Boolean).join('\n\n');
  }

  private async maybeRunExplorePrepass(
    ctx: LingyunAgentRuntimeContext,
    runtime: PreparedRuntime,
  ): Promise<LingyunAgentSyntheticContext | undefined> {
    if (ctx.signal?.aborted) return undefined;
    if (ctx.session.parentSessionId || ctx.session.subagentType) return undefined;

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const enabled = cfg.get<boolean>('subagents.explorePrepass.enabled', false) ?? false;
    if (!enabled) return undefined;

    const subagent = resolveBuiltinSubagent('explore');
    if (!subagent) return undefined;

    const maxCharsRaw = cfg.get<number>('subagents.explorePrepass.maxChars', 8000) ?? 8000;
    const maxChars =
      Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 8000;

    let exploreModelId = String(ctx.config.model || '').trim();
    const configuredSubagentModel = String(ctx.config.subagentModel || '').trim();
    if (configuredSubagentModel && configuredSubagentModel !== exploreModelId) {
      try {
        await ctx.llm.getModel(configuredSubagentModel);
        exploreModelId = configuredSubagentModel;
      } catch {
        // Ignore and fall back to the parent model.
      }
    }

    if (!exploreModelId || !ctx.input) return undefined;

    const exploreModelLimit =
      getModelLimit(exploreModelId, ctx.llm.id) ?? (await ctx.warmModelLimit(exploreModelId));
    let exploreText = await ctx.runSyntheticPass({
      input: ctx.input,
      modelId: exploreModelId,
      mode: 'plan',
      toolFilter: subagent.toolFilter,
      systemPrompt: `${runtime.systemPrompt}\n\n${subagent.prompt}`,
      sessionId: `${ctx.config.sessionId || 'session'}:auto-explore:${Date.now()}`,
      parentSessionId: ctx.config.sessionId,
      subagentType: 'explore',
      signal: ctx.signal,
      runtime: {
        allowExternalPaths: runtime.allowExternalPaths,
        reasoningEffort: runtime.reasoningEffort,
        taskMaxOutputChars: runtime.taskMaxOutputChars,
        compaction: runtime.snapshot.compaction,
        ...(exploreModelLimit ? { modelLimits: { [exploreModelId]: exploreModelLimit } } : {}),
      },
    });

    let truncated = false;
    exploreText = exploreText.trimEnd();
    if (exploreText.length > maxChars) {
      exploreText = exploreText.slice(0, maxChars).trimEnd();
      truncated = true;
    }

    const injected = [
      '<subagent_explore_context>',
      exploreText,
      truncated ? '\n\n... [TRUNCATED]' : '',
      '</subagent_explore_context>',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      transientContext: 'explore',
      text: injected,
      persistAfterCompaction: true,
      maxCharsAfterCompaction: Math.min(maxChars, EXPLORE_COMPACTION_RESTORE_MAX_CHARS),
    };
  }

  private async maybeInjectMemoryRecall(
    ctx: LingyunAgentRuntimeContext
  ): Promise<LingyunAgentSyntheticContext | undefined> {
    if (ctx.signal?.aborted) return undefined;
    if (ctx.session.parentSessionId || ctx.session.subagentType) return undefined;
    if (!ctx.input) return undefined;

    const memoriesConfig = getMemoriesConfig();
    if (!memoriesConfig.enabled || !memoriesConfig.autoRecall) return undefined;

    const query = getUserHistoryInputText(ctx.input).trim();
    if (!query) return undefined;

    const workspaceFolder = this.getWorkspaceRootForContext();
    const manager = new WorkspaceMemories(this.context);

    const search = await manager.searchMemory({
      query,
      workspaceFolder,
      limit: memoriesConfig.maxAutoRecallResults,
      maxTokens: memoriesConfig.maxAutoRecallTokens,
      neighborWindow: memoriesConfig.searchNeighborWindow,
    });

    if (search.hits.length === 0) {
      void manager.scheduleUpdateFromSessions(workspaceFolder, { delayMs: 250 }).catch(() => {
        // Ignore background refresh failures during pre-run recall.
      });
      return undefined;
    }

    if (search.hits.length === 0) return undefined;

    const lines: string[] = [
      '<memory_recall_context>',
      'Use this recalled context only if it is relevant to the current turn.',
      `query: ${query}`,
      '',
    ];

    for (const [index, hit] of search.hits.entries()) {
      lines.push(
        `## Memory ${index + 1} [${hit.record.kind}] score=${hit.score.toFixed(2)} reason=${hit.reason}`,
      );
      lines.push(`session_id: ${hit.record.sessionId}`);
      if (hit.record.filesTouched.length > 0) {
        lines.push(`files: ${hit.record.filesTouched.join(', ')}`);
      }
      if (hit.record.toolsUsed.length > 0) {
        lines.push(`tools: ${hit.record.toolsUsed.join(', ')}`);
      }
      lines.push(hit.record.text.trim());
      lines.push('');
    }

    lines.push('</memory_recall_context>');
    return {
      transientContext: 'memoryRecall',
      text: lines.join('\n'),
      persistAfterCompaction: true,
      maxCharsAfterCompaction: MEMORY_RECALL_COMPACTION_RESTORE_MAX_CHARS,
    };
  }
}
