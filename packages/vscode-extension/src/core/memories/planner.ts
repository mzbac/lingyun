import {
  hasExternalMemoryContext,
  isExplicitMemoryCandidate,
  isSessionMemoryDisabled,
  normalizeSessionSignals,
} from '../sessionSignals';

import {
  buildMemoryRecords,
  buildStage1Output,
  hasSignal,
  sortOutputs,
  sortRecords,
} from './ingest';
import {
  type MemoriesConfig,
  type MemoriesState,
  type MemoryUpdateResult,
  type PersistedSession,
  type Stage1Output,
  DAY_MS,
  HOUR_MS,
  STATE_VERSION,
} from './model';

export type PlannedMemoryUpdate = {
  state: MemoriesState;
  retainedOutputs: Stage1Output[];
  result: Omit<MemoryUpdateResult, 'enabled' | 'workspaceRoot'>;
};

type SessionEligibility = 'eligible' | 'recent' | 'explicit_recent' | 'expired' | 'plan_or_subagent' | 'memory_disabled';

function getSessionEligibility(
  session: PersistedSession,
  now: number,
  config: MemoriesConfig,
): SessionEligibility {
  if (isSessionMemoryDisabled(normalizeSessionSignals(session.signals, now))) {
    return 'memory_disabled';
  }

  if (session.parentSessionId || session.subagentType || session.mode === 'plan') {
    return 'plan_or_subagent';
  }

  const hasExplicitMemory = normalizeSessionSignals(session.signals, now).structuredMemories.some(isExplicitMemoryCandidate);
  if (session.runtime?.wasRunning) {
    return hasExplicitMemory ? 'explicit_recent' : 'recent';
  }

  const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
  const idleMs = now - updatedAt;
  if (idleMs > config.maxRolloutAgeDays * DAY_MS) {
    return 'expired';
  }
  if (idleMs < config.minRolloutIdleHours * HOUR_MS) {
    return hasExplicitMemory ? 'explicit_recent' : 'recent';
  }
  return 'eligible';
}

function recordKey(record: MemoriesState['records'][number]): string {
  return `${record.workspaceId}|${record.kind}|${record.scope}|${record.memoryKey || record.id}`;
}

function mergeRecords(records: MemoriesState['records']): MemoriesState['records'] {
  const invalidated = new Set<string>();
  for (const record of records) {
    for (const id of record.invalidatesIds || []) {
      invalidated.add(id);
    }
  }

  const mergedByKey = new Map<string, MemoriesState['records'][number]>();
  for (const record of records) {
    const key = recordKey(record);
    const existing = mergedByKey.get(key);
    const normalized = invalidated.has(record.id) ? { ...record, staleness: 'invalidated' as const } : record;
    if (!existing) {
      mergedByKey.set(key, normalized);
      continue;
    }

    const merged: MemoriesState['records'][number] = {
      ...existing,
      text: normalized.text.length >= existing.text.length ? normalized.text : existing.text,
      confidence: Math.max(existing.confidence, normalized.confidence),
      evidenceCount: Math.max(existing.evidenceCount, normalized.evidenceCount),
      lastConfirmedAt: Math.max(existing.lastConfirmedAt, normalized.lastConfirmedAt),
      sourceUpdatedAt: Math.max(existing.sourceUpdatedAt, normalized.sourceUpdatedAt),
      generatedAt: Math.max(existing.generatedAt, normalized.generatedAt),
      filesTouched: [...new Set([...existing.filesTouched, ...normalized.filesTouched])],
      toolsUsed: [...new Set([...existing.toolsUsed, ...normalized.toolsUsed])],
      sourceTurnIds:
        existing.sourceTurnIds || normalized.sourceTurnIds
          ? [...new Set([...(existing.sourceTurnIds || []), ...(normalized.sourceTurnIds || [])])]
          : undefined,
      supersedesIds:
        existing.supersedesIds || normalized.supersedesIds
          ? [...new Set([...(existing.supersedesIds || []), ...(normalized.supersedesIds || [])])]
          : undefined,
      invalidatesIds:
        existing.invalidatesIds || normalized.invalidatesIds
          ? [...new Set([...(existing.invalidatesIds || []), ...(normalized.invalidatesIds || [])])]
          : undefined,
      staleness:
        existing.staleness === 'invalidated' || normalized.staleness === 'invalidated'
          ? 'invalidated'
          : existing.staleness === 'stale' || normalized.staleness === 'stale'
            ? 'stale'
            : existing.staleness === 'aging' || normalized.staleness === 'aging'
              ? 'aging'
              : 'fresh',
    };
    mergedByKey.set(key, merged);
  }

  return [...mergedByKey.values()];
}

export function planMemoryUpdate(params: {
  sessions: PersistedSession[];
  prev: MemoriesState;
  config: MemoriesConfig;
  workspaceId: string;
  workspaceRootPath: string;
  now: number;
}): PlannedMemoryUpdate {
  const knownSessionIds = new Set(params.sessions.map((session) => session.id));
  const externalContextSessionIds = new Set(
    params.sessions
      .filter((session) => hasExternalMemoryContext(normalizeSessionSignals(session.signals, params.now)))
      .map((session) => session.id),
  );
  const memoryDisabledSessionIds = new Set(
    params.sessions
      .filter((session) => isSessionMemoryDisabled(normalizeSessionSignals(session.signals, params.now)))
      .map((session) => session.id),
  );
  const prevOutputs = params.prev.outputs.filter(
    (output) =>
      knownSessionIds.has(output.sessionId) &&
      !externalContextSessionIds.has(output.sessionId) &&
      !memoryDisabledSessionIds.has(output.sessionId),
  );
  const prevRecords = params.prev.records.filter(
    (record) =>
      knownSessionIds.has(record.sessionId) &&
      !externalContextSessionIds.has(record.sessionId) &&
      !memoryDisabledSessionIds.has(record.sessionId),
  );
  const prevBySession = new Map(prevOutputs.map((output) => [output.sessionId, output]));
  const prevRecordCountBySession = new Map<string, number>();
  for (const record of prevRecords) {
    prevRecordCountBySession.set(record.sessionId, (prevRecordCountBySession.get(record.sessionId) || 0) + 1);
  }

  let skippedRecentSessions = 0;
  let skippedExpiredSessions = 0;
  let skippedPlanOrSubagentSessions = 0;
  let skippedNoSignalSessions = 0;
  const skippedExternalContextSessions = externalContextSessionIds.size;
  let skippedMemoryDisabledSessions = 0;

  const eligible = params.sessions
    .flatMap((session): Array<{ session: PersistedSession; explicitOnly: boolean }> => {
      if (externalContextSessionIds.has(session.id)) {
        return [];
      }
      const eligibility = getSessionEligibility(session, params.now, params.config);
      if (eligibility === 'memory_disabled') {
        skippedMemoryDisabledSessions += 1;
        return [];
      }
      if (eligibility === 'recent') {
        skippedRecentSessions += 1;
        return [];
      }
      if (eligibility === 'expired') {
        skippedExpiredSessions += 1;
        return [];
      }
      if (eligibility === 'plan_or_subagent') {
        skippedPlanOrSubagentSessions += 1;
        return [];
      }
      return [{ session, explicitOnly: eligibility === 'explicit_recent' }];
    })
    .sort((a, b) => b.session.updatedAt - a.session.updatedAt)
    .slice(0, params.config.maxRolloutsPerStartup);

  const outputs = [...prevOutputs];
  let records = [...prevRecords];
  let insertedOutputs = 0;
  let updatedOutputs = 0;

  for (const item of eligible) {
    const { session, explicitOnly } = item;
    const existing = prevBySession.get(session.id);
    const sessionUpdatedAt = Number.isFinite(session.updatedAt) ? Math.floor(session.updatedAt) : 0;
    const hasExistingRecords = (prevRecordCountBySession.get(session.id) || 0) > 0;
    const existingSatisfiesCurrentMode = explicitOnly || existing?.partial !== 'explicit';
    if (existing && existingSatisfiesCurrentMode && existing.sourceUpdatedAt >= sessionUpdatedAt && hasExistingRecords) {
      continue;
    }

    const stage1 = buildStage1Output({
      session,
      cwd: params.workspaceRootPath,
      generatedAt: params.now,
      explicitOnly,
    });
    const nextRecords = buildMemoryRecords({
      session,
      stage1,
      workspaceId: params.workspaceId,
      includeTranscript: !explicitOnly,
    });

    if (!hasSignal(stage1) && nextRecords.length === 0) {
      skippedNoSignalSessions += 1;
      continue;
    }

    records = records.filter((record) => record.sessionId !== session.id);
    records.push(...nextRecords);

    if (hasSignal(stage1)) {
      const index = outputs.findIndex((item) => item.sessionId === session.id);
      if (index >= 0) {
        outputs[index] = stage1;
        updatedOutputs += 1;
      } else {
        outputs.push(stage1);
        insertedOutputs += 1;
      }
    }
  }

  const sortedOutputs = sortOutputs(outputs).slice(0, params.config.maxStateOutputs);
  const mergedRecords = mergeRecords(records);
  const sortedRecords = sortRecords(mergedRecords).slice(0, params.config.maxRecords);
  const retainedOutputs = sortedOutputs.slice(0, params.config.maxRawMemoriesForGlobal);
  const previousLastSessionScanAt =
    typeof params.prev.jobs?.lastSessionScanAt === 'number' && Number.isFinite(params.prev.jobs.lastSessionScanAt)
      ? Math.floor(params.prev.jobs.lastSessionScanAt)
      : undefined;
  const nextLastSessionScanAt = skippedRecentSessions > 0 ? previousLastSessionScanAt : params.now;

  return {
    state: {
      version: STATE_VERSION,
      outputs: sortedOutputs,
      records: sortedRecords,
      jobs: {
        ...(nextLastSessionScanAt !== undefined ? { lastSessionScanAt: nextLastSessionScanAt } : {}),
        lastGlobalRebuildAt: params.now,
      },
    },
    retainedOutputs,
    result: {
      scannedSessions: params.sessions.length,
      processedSessions: eligible.length,
      insertedOutputs,
      updatedOutputs,
      retainedOutputs: retainedOutputs.length,
      skippedRecentSessions,
      skippedExpiredSessions,
      skippedPlanOrSubagentSessions,
      skippedNoSignalSessions,
      skippedExternalContextSessions,
      skippedMemoryDisabledSessions,
    },
  };
}
