import { TOOL_ERROR_CODES, optionalNumber, optionalString } from '@kooka/core';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { WorkspaceMemories, isMemoriesEnabled } from '../../core/memories';

type UpdateMemoryMode = 'if_needed' | 'now' | 'schedule';

function parseMode(args: Record<string, unknown>): UpdateMemoryMode {
  const raw = optionalString(args, 'mode', 'if_needed')?.trim().toLowerCase();
  if (raw === 'now' || raw === 'schedule' || raw === 'if_needed') return raw;
  return 'if_needed';
}

export const updateMemoryTool: ToolDefinition = {
  id: 'update_memory',
  name: 'Update Memory',
  description:
    'Refresh memory artifacts from persisted sessions. Defaults to an "if_needed" update (skips when already up to date).',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['if_needed', 'now', 'schedule'],
        description:
          'if_needed (default) updates only when stale/missing, now forces an update, schedule coalesces a background refresh and returns immediately.',
      },
      delayMs: {
        type: 'number',
        description: 'When mode="schedule", delay before refreshing memories (default 250ms).',
      },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.memory.updateMemory' },
  metadata: {
    category: 'memory',
    icon: 'refresh',
    requiresApproval: false,
    permission: 'memory',
    readOnly: false,
  },
};

export const updateMemoryHandler: ToolHandler = async (args, context) => {
  try {
    if (!isMemoriesEnabled()) {
      return {
        success: false,
        error: 'Memories feature is disabled. Enable lingyun.features.memories to update memory artifacts.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_disabled },
      };
    }

    const manager = new WorkspaceMemories(context.extensionContext);
    const mode = parseMode(args);

    const status = await manager.getUpdateStatus();
    if (!status.enabled) {
      return {
        success: false,
        error: 'Memories feature is disabled. Enable lingyun.features.memories to update memory artifacts.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_disabled },
      };
    }

    if (mode === 'schedule') {
      if (!status.needsUpdate) {
        return {
          success: true,
          data: {
            scheduled: false,
            needsUpdate: false,
            reason: status.reason,
            lastSessionScanAt: status.lastSessionScanAt,
            latestSessionUpdatedAt: status.latestSessionUpdatedAt,
            persistedSessionCount: status.persistedSessionCount,
          },
        };
      }

      const delayMsRaw = optionalNumber(args, 'delayMs');
      const delayMs =
        typeof delayMsRaw === 'number' && Number.isFinite(delayMsRaw) ? Math.max(0, Math.floor(delayMsRaw)) : 250;

      void manager.scheduleUpdateFromSessions(context.workspaceFolder, { delayMs }).catch((error) => {
        context.log(`update_memory schedule failed: ${error instanceof Error ? error.message : String(error)}`);
      });

      return {
        success: true,
        data: {
          scheduled: true,
          delayMs,
          reason: status.reason,
          lastSessionScanAt: status.lastSessionScanAt,
          latestSessionUpdatedAt: status.latestSessionUpdatedAt,
          persistedSessionCount: status.persistedSessionCount,
        },
      };
    }

    if (mode === 'if_needed' && !status.needsUpdate) {
      return {
        success: true,
        data: {
          updated: false,
          reason: status.reason,
          lastSessionScanAt: status.lastSessionScanAt,
          latestSessionUpdatedAt: status.latestSessionUpdatedAt,
          persistedSessionCount: status.persistedSessionCount,
        },
      };
    }

    const result = await manager.updateFromSessions(context.workspaceFolder);
    if (!result.enabled) {
      return {
        success: false,
        error: 'Memories feature is disabled. Enable lingyun.features.memories to update memory artifacts.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_disabled },
      };
    }

    const finalStatus = await manager.getUpdateStatus();
    return {
      success: true,
      data: {
        updated: true,
        enabled: true,
        triggerReason: status.reason,
        lastSessionScanAt: finalStatus.lastSessionScanAt,
        latestSessionUpdatedAt: finalStatus.latestSessionUpdatedAt,
        persistedSessionCount: finalStatus.persistedSessionCount,
        scannedSessions: result.scannedSessions,
        processedSessions: result.processedSessions,
        insertedOutputs: result.insertedOutputs,
        updatedOutputs: result.updatedOutputs,
        retainedOutputs: result.retainedOutputs,
        skippedRecentSessions: result.skippedRecentSessions,
        skippedExpiredSessions: result.skippedExpiredSessions ?? 0,
        skippedPlanOrSubagentSessions: result.skippedPlanOrSubagentSessions,
        skippedNoSignalSessions: result.skippedNoSignalSessions,
        skippedExternalContextSessions: result.skippedExternalContextSessions ?? 0,
        skippedMemoryDisabledSessions: result.skippedMemoryDisabledSessions ?? 0,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
