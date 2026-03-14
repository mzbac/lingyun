import { TOOL_ERROR_CODES, optionalNumber, optionalString } from '@kooka/core';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { WorkspaceMemories, isMemoriesEnabled, readMemoryArtifacts } from '../../core/memories';

const DEFAULT_MAX_CHARS = 12_000;
const MAX_MAX_CHARS = 50_000;

function getMaxChars(args: Record<string, unknown>): number {
  const raw = optionalNumber(args, 'maxChars');
  if (!Number.isFinite(raw as number)) return DEFAULT_MAX_CHARS;
  return Math.max(500, Math.min(MAX_MAX_CHARS, Math.floor(raw as number)));
}

function trimForOutput(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, maxChars).trimEnd() + '\n\n... [TRUNCATED]',
    truncated: true,
  };
}

export const getMemoryTool: ToolDefinition = {
  id: 'get_memory',
  name: 'Get Memory',
  description:
    'Read generated memory artifacts or search transcript-backed memory records. Default returns memory summary.',
  parameters: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['summary', 'memory', 'raw', 'list', 'rollout', 'search'],
        description: 'summary (default), memory (MEMORY.md), raw (raw_memories.md), list, rollout, or search',
      },
      rolloutFile: {
        type: 'string',
        description: 'When view=rollout, the rollout summary filename under rollout_summaries/*.md',
      },
      query: {
        type: 'string',
        description: 'When provided, runs transcript-backed memory search. Implies view=search.',
      },
      kind: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural'],
        description: 'Optional memory kind filter for search.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memory search matches to return.',
      },
      neighborWindow: {
        type: 'number',
        description: 'How many neighboring transcript chunks to include around each memory match.',
      },
      maxChars: {
        type: 'number',
        description: `Maximum returned characters (default ${DEFAULT_MAX_CHARS}, max ${MAX_MAX_CHARS})`,
      },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.memory.getMemory' },
  metadata: {
    category: 'memory',
    icon: 'book',
    requiresApproval: false,
    permission: 'memory',
    readOnly: true,
  },
};

export const getMemoryHandler: ToolHandler = async (args, context) => {
  try {
    if (!isMemoriesEnabled()) {
      return {
        success: false,
        error:
          'Memories feature is disabled. Enable lingyun.features.memories and run "LingYun: Update Memories".',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_disabled },
      };
    }

    const manager = new WorkspaceMemories(context.extensionContext);
    const query = optionalString(args, 'query')?.trim();
    const viewRaw = (optionalString(args, 'view', query ? 'search' : 'summary') ?? (query ? 'search' : 'summary'))
      .trim()
      .toLowerCase();
    const view =
      viewRaw === 'summary' ||
      viewRaw === 'memory' ||
      viewRaw === 'raw' ||
      viewRaw === 'list' ||
      viewRaw === 'rollout' ||
      viewRaw === 'search'
        ? viewRaw
        : undefined;

    if (!view) {
      return {
        success: false,
        error: 'view must be one of: summary, memory, raw, list, rollout, search.',
      };
    }

    const maxChars = getMaxChars(args);

    if (view === 'list') {
      const artifacts = await readMemoryArtifacts(context.extensionContext);
      return {
        success: true,
        data: {
          hasSummary: typeof artifacts.summary === 'string' && artifacts.summary.trim().length > 0,
          hasMemory: typeof artifacts.memory === 'string' && artifacts.memory.trim().length > 0,
          hasRawMemories: typeof artifacts.raw === 'string' && artifacts.raw.trim().length > 0,
          rolloutSummaries: artifacts.rollouts,
        },
      };
    }

    if (view === 'rollout') {
      const rolloutFile = optionalString(args, 'rolloutFile')?.trim();
      if (!rolloutFile) {
        return {
          success: false,
          error: 'rolloutFile is required when view="rollout". First call get_memory with view="list".',
        };
      }

      const content = await manager.readMemoryFile('rollout', rolloutFile, context.workspaceFolder);
      if (!content || !content.trim()) {
        return {
          success: false,
          error: `Rollout summary not found: ${rolloutFile}`,
          metadata: { errorCode: TOOL_ERROR_CODES.memory_rollout_missing },
        };
      }

      const trimmed = trimForOutput(content, maxChars);
      const normalizedFile = rolloutFile.replace(/\\/g, '/');
      return {
        success: true,
        data: `<memory view="rollout" file="${normalizedFile}">\n${trimmed.text}\n</memory>`,
        metadata: { view, rolloutFile: normalizedFile, truncated: trimmed.truncated },
      };
    }

    if (view === 'search') {
      if (!query) {
        return {
          success: false,
          error: 'query is required when view="search".',
        };
      }

      const kindRaw = optionalString(args, 'kind')?.trim().toLowerCase();
      const kind =
        kindRaw === 'episodic' || kindRaw === 'semantic' || kindRaw === 'procedural' ? kindRaw : undefined;
      const limit = optionalNumber(args, 'limit');
      const neighborWindow = optionalNumber(args, 'neighborWindow');

      let search = await manager.searchMemory({
        query,
        workspaceFolder: context.workspaceFolder,
        ...(kind ? { kind } : {}),
        ...(Number.isFinite(limit as number) ? { limit: Math.max(1, Math.floor(limit as number)) } : {}),
        ...(Number.isFinite(neighborWindow as number)
          ? { neighborWindow: Math.max(0, Math.floor(neighborWindow as number)) }
          : {}),
      });

      if (search.hits.length === 0) {
        await manager.updateFromSessions(context.workspaceFolder);
        search = await manager.searchMemory({
          query,
          workspaceFolder: context.workspaceFolder,
          ...(kind ? { kind } : {}),
          ...(Number.isFinite(limit as number) ? { limit: Math.max(1, Math.floor(limit as number)) } : {}),
          ...(Number.isFinite(neighborWindow as number)
            ? { neighborWindow: Math.max(0, Math.floor(neighborWindow as number)) }
            : {}),
        });
      }

      if (search.hits.length === 0) {
        return {
          success: true,
          data: `<memory view="search" query="${query.replace(/"/g, '&quot;')}">\n(no matching memory)\n</memory>`,
          metadata: { view, query, matchCount: 0 },
        };
      }

      const lines: string[] = [`<memory view="search" query="${query.replace(/"/g, '&quot;')}">`];
      for (const [index, hit] of search.hits.entries()) {
        lines.push(
          `## Match ${index + 1} [${hit.record.kind}] score=${hit.score.toFixed(2)} reason=${hit.reason}`,
        );
        lines.push(`session_id: ${hit.record.sessionId}`);
        lines.push(`chunk_id: ${hit.record.id}`);
        lines.push(`updated_at: ${new Date(hit.record.sourceUpdatedAt).toISOString()}`);
        if (hit.record.filesTouched.length > 0) {
          lines.push(`files: ${hit.record.filesTouched.join(', ')}`);
        }
        if (hit.record.toolsUsed.length > 0) {
          lines.push(`tools: ${hit.record.toolsUsed.join(', ')}`);
        }
        lines.push(hit.record.text.trim());
        lines.push('');
      }
      lines.push('</memory>');

      const trimmed = trimForOutput(lines.join('\n'), maxChars);
      return {
        success: true,
        data: trimmed.text,
        metadata: {
          view,
          query,
          matchCount: search.hits.length,
          truncated: trimmed.truncated,
          totalTokens: search.totalTokens,
          searchTruncated: search.truncated,
        },
      };
    }

    let content: string | undefined;
    if (view === 'summary') {
      content = await manager.readMemoryFile('summary', undefined, context.workspaceFolder);
      if (!content?.trim()) {
        content = await manager.readMemoryFile('memory', undefined, context.workspaceFolder);
      }
      if (!content?.trim()) {
        content = await manager.readMemoryFile('raw', undefined, context.workspaceFolder);
      }
    } else if (view === 'memory') {
      content = await manager.readMemoryFile('memory', undefined, context.workspaceFolder);
    } else {
      content = await manager.readMemoryFile('raw', undefined, context.workspaceFolder);
    }

    if (!content || !content.trim()) {
      return {
        success: false,
        error:
          'No memory artifacts found yet. Run "LingYun: Update Memories" after at least one completed session.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_missing },
      };
    }

    const trimmed = trimForOutput(content, maxChars);
    const rollouts = await manager.listRolloutSummaries(context.workspaceFolder);
    return {
      success: true,
      data: `<memory view="${view}">\n${trimmed.text}\n</memory>`,
      metadata: {
        view,
        truncated: trimmed.truncated,
        rolloutSummaries: rollouts.slice(0, 20),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
