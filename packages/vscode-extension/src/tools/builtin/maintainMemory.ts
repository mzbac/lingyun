import { TOOL_ERROR_CODES, optionalString } from '@kooka/core';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { WorkspaceMemories, isMemoriesEnabled } from '../../core/memories';

function parseAction(args: Record<string, unknown>): 'invalidate' | 'supersede' | 'confirm' | undefined {
  const raw = optionalString(args, 'action')?.trim().toLowerCase();
  if (raw === 'invalidate' || raw === 'supersede' || raw === 'confirm') return raw;
  return undefined;
}

export const maintainMemoryTool: ToolDefinition = {
  id: 'maintain_memory',
  name: 'Maintain Memory',
  description:
    'Invalidate, confirm, or supersede an existing memory record so durable memory stays current and conflicts are resolved explicitly.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['invalidate', 'supersede', 'confirm'],
        description: 'invalidate marks a memory wrong/stale, supersede replaces it with new text, confirm refreshes it as still valid.',
      },
      recordId: {
        type: 'string',
        description: 'Optional supporting memory record id to update. Find ids first via get_memory search.',
      },
      durableKey: {
        type: 'string',
        description: 'Preferred durable memory key to maintain. Find it via get_memory search or MEMORY.md.',
      },
      replacementText: {
        type: 'string',
        description: 'Required when action="supersede". The new durable text that should replace the old memory.',
      },
      note: {
        type: 'string',
        description: 'Optional operator note about why the memory was invalidated, confirmed, or superseded.',
      },
    },
    required: ['action'],
  },
  execution: { type: 'function', handler: 'builtin.memory.maintainMemory' },
  metadata: {
    category: 'memory',
    icon: 'refresh',
    requiresApproval: false,
    permission: 'memory',
    readOnly: false,
  },
};

export const maintainMemoryHandler: ToolHandler = async (args, context) => {
  try {
    if (!isMemoriesEnabled()) {
      return {
        success: false,
        error: 'Memories feature is disabled. Enable lingyun.features.memories before maintaining memory records.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_disabled },
      };
    }

    const action = parseAction(args);
    if (!action) {
      return {
        success: false,
        error: 'action must be one of: invalidate, supersede, confirm.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_missing },
      };
    }

    const recordId = optionalString(args, 'recordId')?.trim();
    const durableKey = optionalString(args, 'durableKey')?.trim();
    if (!recordId && !durableKey) {
      return {
        success: false,
        error: 'Provide recordId or durableKey. Find them first with get_memory search.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_missing },
      };
    }

    const replacementText = optionalString(args, 'replacementText')?.trim();
    if (action === 'supersede' && !replacementText) {
      return {
        success: false,
        error: 'replacementText is required when action="supersede".',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_missing },
      };
    }

    const note = optionalString(args, 'note')?.trim();
    const manager = new WorkspaceMemories(context.extensionContext);
    const result = await manager.maintainMemory({
      action,
      ...(recordId ? { recordId } : {}),
      ...(durableKey ? { durableKey } : {}),
      workspaceFolder: context.workspaceFolder,
      ...(replacementText ? { replacementText } : {}),
      ...(note ? { note } : {}),
    });

    if (!result.enabled) {
      return {
        success: false,
        error: 'Memories feature is disabled. Enable lingyun.features.memories before maintaining memory records.',
        metadata: { errorCode: TOOL_ERROR_CODES.memory_disabled },
      };
    }

    return {
      success: true,
      data: {
        ...result,
        hint:
          action === 'invalidate'
            ? 'Re-run get_memory search to confirm the old memory no longer appears as active recall.'
            : action === 'confirm'
              ? 'Re-run get_memory search later to verify this memory still ranks as active durable context.'
              : 'Re-run get_memory search with terms from replacementText to verify the new durable memory is now recalled.',
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found/i.test(message)) {
      return {
        success: false,
        error: message,
        metadata: { errorCode: TOOL_ERROR_CODES.memory_missing },
      };
    }
    return { success: false, error: message };
  }
};
