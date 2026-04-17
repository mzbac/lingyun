import { getMessageText } from '@kooka/core';

import type { AgentCallbacks } from '../../../core/types';
import type { ChatMessage } from '../types';
import type { RunnerCompactionView } from './callbackContracts';

const MAX_COMPACTION_SUMMARY_CHARS = 20_000;

type CompactionStartEvent = Parameters<NonNullable<AgentCallbacks['onCompactionStart']>>[0];
type CompactionEndEvent = Parameters<NonNullable<AgentCallbacks['onCompactionEnd']>>[0];

/**
 * Owns chat UI state for compaction lifecycle events.
 *
 * Hidden knowledge kept here:
 * - operation message construction/update rules
 * - compaction label/detail transitions
 * - summary extraction + truncation for the UI
 * - when compaction should refresh the context indicator
 */
export function createCompactionCallbacks(params: {
  view: RunnerCompactionView;
  persistSessions: boolean;
}) {
  const { view, persistSessions } = params;

  let compactionMsg: ChatMessage | undefined;

  function persistIfEnabled(): void {
    if (persistSessions) {
      view.persistActiveSession();
    }
  }

  function onCompactionStart({ auto }: CompactionStartEvent): void {
    const startedAt = Date.now();
    const operationId = crypto.randomUUID();

    compactionMsg = {
      id: operationId,
      role: 'operation',
      content: '',
      timestamp: startedAt,
      turnId: view.currentTurnId,
      operation: {
        kind: 'compact',
        status: 'running',
        label: auto ? 'Auto-compacting context…' : 'Compacting context…',
        detail: auto ? 'Summarizing older messages to avoid context overflow.' : undefined,
        startedAt,
        auto,
      },
    };

    view.messages.push(compactionMsg);
    view.postMessage({
      type: 'operationStart',
      operation: {
        id: operationId,
        kind: 'compact',
        status: 'running',
        label: compactionMsg.operation?.label || 'Compacting context…',
        startedAt,
      },
    });
    view.postMessage({ type: 'message', message: compactionMsg });
    persistIfEnabled();
  }

  function onCompactionEnd({ auto, summaryMessageId, status, error }: CompactionEndEvent): void {
    if (!compactionMsg || !compactionMsg.operation) return;

    const endedAt = Date.now();
    const opStatus = status === 'done' ? 'done' : status === 'canceled' ? 'canceled' : 'error';
    const label =
      opStatus === 'done'
        ? auto
          ? 'Context compacted (auto)'
          : 'Context compacted'
        : opStatus === 'canceled'
          ? auto
            ? 'Auto compaction canceled'
            : 'Compaction canceled'
          : auto
            ? 'Auto compaction failed'
            : 'Compaction failed';

    compactionMsg.operation.status = opStatus;
    compactionMsg.operation.label = label;
    compactionMsg.operation.endedAt = endedAt;

    if (opStatus !== 'done') {
      compactionMsg.operation.detail = error ? String(error) : undefined;
    } else {
      compactionMsg.operation.detail = auto
        ? 'Summarized older messages into a compact note to avoid context overflow.'
        : 'Summarized older messages into a compact note.';

      if (summaryMessageId) {
        const history = view.agent.getHistory();
        const summary = history.find(message => message.id === summaryMessageId);
        const summaryText = summary ? getMessageText(summary) : '';
        if (summaryText.trim()) {
          const truncated = summaryText.length > MAX_COMPACTION_SUMMARY_CHARS;
          compactionMsg.operation.summaryText = truncated
            ? summaryText.slice(0, MAX_COMPACTION_SUMMARY_CHARS) + '\n\n[Summary truncated in UI]'
            : summaryText;
          compactionMsg.operation.summaryTruncated = truncated;
        }
      }
    }

    view.postMessage({ type: 'updateMessage', message: compactionMsg });
    view.postMessage({
      type: 'operationEnd',
      operation: {
        id: compactionMsg.id,
        kind: 'compact',
        status: opStatus,
        label,
        startedAt: compactionMsg.operation.startedAt,
        endedAt,
      },
    });

    // Compaction changes the effective prompt boundary; refresh the context indicator now.
    view.postMessage({ type: 'context', context: view.getContextForUI() });
    persistIfEnabled();
    compactionMsg = undefined;
  }

  return {
    onCompactionStart,
    onCompactionEnd,
  };
}
