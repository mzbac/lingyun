import { optionalNumber, optionalString } from '@kooka/core';

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
    'Read generated memory artifacts. Default returns memory summary; you can also list rollout summaries or read one rollout file.',
  parameters: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['summary', 'memory', 'raw', 'list', 'rollout'],
        description: 'summary (default), memory (MEMORY.md), raw (raw_memories.md), list, or rollout',
      },
      rolloutFile: {
        type: 'string',
        description: 'When view=rollout, the rollout summary filename under rollout_summaries/*.md',
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
        metadata: { errorType: 'memory_disabled' },
      };
    }

    const manager = new WorkspaceMemories(context.extensionContext);
    const viewRaw = (optionalString(args, 'view', 'summary') ?? 'summary').trim().toLowerCase();
    const view =
      viewRaw === 'summary' ||
      viewRaw === 'memory' ||
      viewRaw === 'raw' ||
      viewRaw === 'list' ||
      viewRaw === 'rollout'
        ? viewRaw
        : undefined;

    if (!view) {
      return {
        success: false,
        error: 'view must be one of: summary, memory, raw, list, rollout.',
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
          metadata: { errorType: 'memory_rollout_missing' },
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
        metadata: { errorType: 'memory_missing' },
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
