import { TOOL_ERROR_CODES, optionalNumber, optionalString } from '@kooka/core';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { WorkspaceMemories, isMemoriesEnabled, readMemoryArtifacts } from '../../core/memories';
import { redactMemorySecrets } from '../../core/memories/privacy';
import {
  formatMemoryLastConfirmedMetadata,
  formatMemoryVerificationCaveat,
  renderRawRecordEvidence,
  renderSelectiveMemorySurfaceLines,
  renderSummaryRecordText,
  selectiveMemoryPrimaryLabel,
} from '../../core/memories/consolidate';
import {
  memoryRecordLooksLikeProjectStateSnapshot,
  memoryRecordLooksLikeReferencePointer,
  shouldCompactLaterCurrentStateProjectSupport,
  shouldCompactLaterProjectPriorContext,
} from '../../core/memories/currentState';

function recordLooksLikeReferencePointer(hit: { record: { title?: string; text?: string; memoryKey?: string } }): boolean {
  return memoryRecordLooksLikeReferencePointer(hit.record);
}

function recordLooksLikeProjectStateSnapshot(hit: { record: { title?: string; text?: string; memoryKey?: string } }): boolean {
  return memoryRecordLooksLikeProjectStateSnapshot(hit.record);
}

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

function normalizeMemoryScopeArg(scope: string | undefined): 'user' | 'workspace' | 'session' | undefined {
  switch ((scope || '').trim().toLowerCase()) {
    case 'user':
    case 'global':
    case 'personal':
    case 'private':
    case 'profile':
      return 'user';
    case 'workspace':
    case 'project':
    case 'repo':
    case 'repository':
    case 'codebase':
    case 'team':
      return 'workspace';
    case 'session':
    case 'local':
    case 'chat':
    case 'thread':
    case 'conversation':
      return 'session';
    default:
      return undefined;
  }
}

export const getMemoryTool: ToolDefinition = {
  id: 'get_memory',
  name: 'Get Memory',
  description:
    'Read generated memory artifacts, topic files, or search transcript-backed memory records. Default returns memory summary.',
  parameters: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['summary', 'memory', 'raw', 'list', 'topic', 'rollout', 'search'],
        description: 'summary (default), memory (MEMORY.md index), raw (raw_memories.md), list, topic, rollout, or search',
      },
      topicFile: {
        type: 'string',
        description: 'When view=topic, the topic filename under memory_topics/*.md',
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
      scope: {
        type: 'string',
        enum: [
          'user',
          'global',
          'personal',
          'private',
          'profile',
          'workspace',
          'project',
          'repo',
          'repository',
          'codebase',
          'team',
          'session',
          'local',
          'chat',
          'thread',
          'conversation',
        ],
        description:
          'Optional memory scope filter for search. Aliases: project/repo/repository/codebase/team -> workspace, local/chat/thread/conversation -> session, global/personal/private/profile -> user.',
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
      viewRaw === 'topic' ||
      viewRaw === 'rollout' ||
      viewRaw === 'search'
        ? viewRaw
        : undefined;

    if (!view) {
      return {
        success: false,
        error: 'view must be one of: summary, memory, raw, list, topic, rollout, search.',
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
          topicFiles: artifacts.topics,
          rolloutSummaries: artifacts.rollouts,
        },
      };
    }

    if (view === 'topic') {
      const topicFile = optionalString(args, 'topicFile')?.trim();
      if (!topicFile) {
        return {
          success: false,
          error: 'topicFile is required when view="topic". First call get_memory with view="list".',
        };
      }

      const content = await manager.readMemoryFile('topic', topicFile, context.workspaceFolder);
      if (!content || !content.trim()) {
        return {
          success: false,
          error: `Memory topic not found: ${topicFile}`,
          metadata: { errorCode: TOOL_ERROR_CODES.memory_missing },
        };
      }

      const trimmed = trimForOutput(content, maxChars);
      const normalizedFile = topicFile.replace(/\\/g, '/');
      return {
        success: true,
        data: `<memory view="topic" file="${normalizedFile}">\n${trimmed.text}\n</memory>`,
        metadata: { view, topicFile: normalizedFile, truncated: trimmed.truncated },
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
      const scopeRaw = optionalString(args, 'scope')?.trim().toLowerCase();
      const scope = normalizeMemoryScopeArg(scopeRaw);
      if (scopeRaw && !scope) {
        return {
          success: false,
          error:
            'scope must be one of: user/global/personal/private/profile, workspace/project/repo/repository/codebase/team, or session/local/chat/thread/conversation.',
        };
      }
      const limit = optionalNumber(args, 'limit');
      const neighborWindow = optionalNumber(args, 'neighborWindow');

      const search = await manager.searchMemory({
        query,
        workspaceFolder: context.workspaceFolder,
        preferDurableFirst: true,
        ...(kind ? { kind } : {}),
        ...(scope ? { scope } : {}),
        ...(Number.isFinite(limit as number) ? { limit: Math.max(1, Math.floor(limit as number)) } : {}),
        ...(Number.isFinite(neighborWindow as number)
          ? { neighborWindow: Math.max(0, Math.floor(neighborWindow as number)) }
          : {}),
      });

      if (search.hits.length === 0) {
        void manager.scheduleUpdateFromSessions(context.workspaceFolder, { delayMs: 250 }).catch(() => {
          // Ignore background refresh failures for search misses.
        });
      }

      if (search.hits.length === 0) {
        return {
          success: true,
          data: `<memory view="search" query="${query.replace(/"/g, '&quot;')}"${scope ? ` scope="${scope}"` : ''}>\n(no matching memory)\n</memory>`,
          metadata: { view, query, ...(scope ? { scope } : {}), matchCount: 0 },
        };
      }

      const lines: string[] = [`<memory view="search" query="${query.replace(/"/g, '&quot;')}"${scope ? ` scope="${scope}"` : ''}>`];
      const now = Date.now();
      let sawCurrentStateReferencePointer = false;
      for (const [index, hit] of search.hits.entries()) {
        const updatedAt = hit.durableEntry?.lastConfirmedAt ?? hit.record.lastConfirmedAt ?? hit.record.sourceUpdatedAt;
        const freshness = hit.durableEntry?.freshness ?? hit.record.staleness;
        const confidence = hit.durableEntry?.confidence ?? hit.record.confidence;
        const evidence = hit.durableEntry?.evidenceCount ?? hit.record.evidenceCount;
        const files = hit.durableEntry?.filesTouched ?? hit.record.filesTouched;
        const tools = hit.durableEntry?.toolsUsed ?? hit.record.toolsUsed;
        const maintenanceHint =
          hit.source === 'durable'
            ? `maintain_memory action=<invalidate|confirm|supersede> recordId=${hit.record.id}${hit.durableEntry?.key ? ` durableKey=${hit.durableEntry.key}` : ''}`
            : `maintain_memory action=<invalidate|confirm|supersede> recordId=${hit.record.id}`;
        const primaryLabel = hit.durableEntry
          ? selectiveMemoryPrimaryLabel(hit.durableEntry, 'guidance', query)
          : undefined;
        const compactPriorContext = !!hit.durableEntry && shouldCompactLaterProjectPriorContext({
          hasLeadingReferencePointer: sawCurrentStateReferencePointer,
          isProjectCategory: hit.durableEntry.category === 'project',
          primaryLabel,
        });
        const compactMetadata = compactPriorContext;
        lines.push(
          `## Match ${index + 1} [${hit.source === 'durable' ? `durable:${hit.durableEntry?.category || 'memory'}` : hit.record.kind}] score=${hit.score.toFixed(2)} reason=${hit.reason}`,
        );
        if (!compactMetadata) {
          lines.push(`source: ${hit.source || 'record'}`);
          lines.push(`scope: ${hit.durableEntry?.scope ?? hit.record.scope}`);
          lines.push(`session_id: ${hit.record.sessionId}`);
          lines.push(`chunk_id: ${hit.record.id}`);
          lines.push(`updated_at: ${new Date(updatedAt).toISOString()}`);
          lines.push(formatMemoryLastConfirmedMetadata(updatedAt, now));
          const verificationCaveat = formatMemoryVerificationCaveat(freshness, updatedAt, now);
          if (verificationCaveat) {
            lines.push(verificationCaveat);
          }
          lines.push(`confidence=${confidence.toFixed(2)} staleness=${freshness} evidence=${evidence}`);
          if (files.length > 0) {
            lines.push(`files: ${files.join(', ')}`);
          }
          if (tools.length > 0) {
            lines.push(`tools: ${tools.join(', ')}`);
          }
          if (hit.durableEntry) {
            lines.push(`durable_key: ${hit.durableEntry.key}`);
          }
          lines.push(`maintenance_hint: ${maintenanceHint}`);
          if (hit.scoreBreakdown) {
            const parts = Object.entries(hit.scoreBreakdown)
              .map(([key, value]) => `${key}=${Number(value).toFixed(2)}`)
              .join(' ');
            lines.push(`score_breakdown: ${parts}`);
          }
        }
        if (hit.durableEntry) {
          lines.push(...renderSelectiveMemorySurfaceLines(hit.durableEntry, {
            fallbackLabel: 'guidance',
            query,
            compactPriorContext,
          }));
          if (hit.durableEntry.category === 'reference') {
            sawCurrentStateReferencePointer = true;
          }
        } else if (hit.record.signalKind === 'summary') {
          const summary = renderSummaryRecordText(hit.record);
          lines.push(`summary: ${summary.summary}`);
          for (const detail of summary.details) {
            lines.push(detail);
          }
        } else {
          const compactRawSupport = shouldCompactLaterCurrentStateProjectSupport({
            query,
            hasLeadingReferencePointer: sawCurrentStateReferencePointer,
            isProjectStateLike: recordLooksLikeProjectStateSnapshot(hit),
          });
          const evidence = renderRawRecordEvidence(hit.record, compactRawSupport ? { compact: true } : undefined);

          lines.push(`evidence: ${evidence.evidence}`);
          for (const detail of evidence.details) {
            lines.push(detail);
          }
          if (recordLooksLikeReferencePointer(hit)) {
            sawCurrentStateReferencePointer = true;
          }
        }
        lines.push('');
      }
      lines.push('</memory>');

      const trimmed = trimForOutput(redactMemorySecrets(lines.join('\n')), maxChars);
      return {
        success: true,
        data: trimmed.text,
        metadata: {
          view,
          query,
          ...(scope ? { scope } : {}),
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
