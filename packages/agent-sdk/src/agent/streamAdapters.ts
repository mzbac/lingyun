import type { TextStreamPart } from 'ai';

import type { AgentHistoryMetadata } from '@kooka/core';

import { CopilotResponsesStreamAdapter } from './copilotResponsesStreamAdapter.js';

type ReplayMetadata = NonNullable<AgentHistoryMetadata['replay']>;

export type StreamAdapterContext = {
  llmId: string;
  modelId: string;
};

export type StreamErrorContext = {
  sawFinishPart: boolean;
  attemptText: string;
};

export type StreamReplayNamespace = Exclude<keyof ReplayMetadata, 'text' | 'reasoning'>;

/**
 * Stream adapters may attach provider-specific replay metadata (e.g. Copilot /responses reasoning fields)
 * that should be persisted alongside the raw streamed assistant output.
 *
 * Contract:
 * - Each adapter may emit updates for at most one `namespace`.
 * - Composed adapters must not claim the same namespace; collisions throw to avoid silent corruption.
 * - Updates are stored per-namespace; the runtime never merges multiple updates for the same namespace.
 */
export type StreamReplayUpdate = {
  namespace: StreamReplayNamespace;
  update: Record<string, unknown>;
};

export type StreamAdapter = {
  onPart(part: TextStreamPart<any>): void;
  shouldIgnoreError(error: unknown, stream: StreamErrorContext): boolean;
  getReplayUpdates(): StreamReplayUpdate[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function buildStreamReplay(params: {
  text: string;
  reasoning: string;
  updates?: StreamReplayUpdate[];
}): ReplayMetadata {
  const replay: ReplayMetadata = {
    text: params.text,
    reasoning: params.reasoning,
  };

  const updates = params.updates;
  if (Array.isArray(updates) && updates.length > 0) {
    const claimedNamespaces = new Set<string>();
    for (const entry of updates) {
      if (!entry) continue;
      const namespace = String((entry as any).namespace || '').trim();
      if (!namespace) {
        throw new Error('[StreamReplay] Replay update must include a non-empty namespace.');
      }

      if (namespace === 'text' || namespace === 'reasoning') {
        throw new Error(`[StreamReplay] Namespace "${namespace}" is reserved and cannot be updated.`);
      }

      if (claimedNamespaces.has(namespace)) {
        throw new Error(
          `[StreamReplay] Multiple replay updates provided for namespace "${namespace}".`,
        );
      }
      claimedNamespaces.add(namespace);

      const update = (entry as any).update;
      if (!isRecord(update) || Object.keys(update).length === 0) {
        throw new Error(
          `[StreamReplay] Replay update for namespace "${namespace}" must be a non-empty object.`,
        );
      }

      (replay as any)[namespace] = { ...update };
    }
  }

  return replay;
}

function composeStreamAdapters(adapters: StreamAdapter[]): StreamAdapter {
  if (adapters.length === 0) return NOOP_STREAM_ADAPTER;

  return {
    onPart(part) {
      for (const adapter of adapters) adapter.onPart(part);
    },
    shouldIgnoreError(error, stream) {
      for (const adapter of adapters) {
        if (adapter.shouldIgnoreError(error, stream)) return true;
      }
      return false;
    },
    getReplayUpdates() {
      const merged: StreamReplayUpdate[] = [];
      const claimedNamespaces = new Set<string>();

      for (const adapter of adapters) {
        const updates = adapter.getReplayUpdates();
        if (!Array.isArray(updates) || updates.length === 0) continue;
        if (updates.length !== 1) {
          throw new Error(
            `[StreamAdapters] Adapter ${adapter.constructor?.name || '(anonymous)'} returned ${updates.length} replay updates. ` +
              `Adapters must own exactly one namespace to avoid silent replay metadata collisions.`,
          );
        }

        const update = updates[0];
        const namespace = String((update as any)?.namespace || '').trim();
        if (!namespace) {
          throw new Error(
            `[StreamAdapters] Adapter ${adapter.constructor?.name || '(anonymous)'} returned a replay update with an empty namespace.`,
          );
        }

        if (namespace === 'text' || namespace === 'reasoning') {
          throw new Error(`[StreamAdapters] Namespace "${namespace}" is reserved and cannot be updated.`);
        }

        if (claimedNamespaces.has(namespace)) {
          throw new Error(
            `[StreamAdapters] Multiple stream adapters returned replay updates for namespace "${namespace}". ` +
              `Merge these updates into a single adapter to avoid silent replay metadata collisions.`,
          );
        }
        claimedNamespaces.add(namespace);

        const value = (update as any).update;
        if (!isRecord(value) || Object.keys(value).length === 0) {
          throw new Error(
            `[StreamAdapters] Adapter ${adapter.constructor?.name || '(anonymous)'} returned an empty replay update for namespace "${namespace}". ` +
              `Return [] instead of claiming a namespace with no data.`,
          );
        }

        merged.push({ namespace: namespace as StreamReplayNamespace, update: { ...value } });
      }

      return merged;
    },
  };
}

const NOOP_STREAM_ADAPTER: StreamAdapter = {
  onPart() {},
  shouldIgnoreError() {
    return false;
  },
  getReplayUpdates() {
    return [];
  },
};

export function createStreamAdapter(context: StreamAdapterContext): StreamAdapter {
  const adapters: StreamAdapter[] = [];
  if (CopilotResponsesStreamAdapter.isApplicable(context)) adapters.push(new CopilotResponsesStreamAdapter(context));
  return composeStreamAdapters(adapters);
}
