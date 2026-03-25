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

type SessionEligibility = 'eligible' | 'recent' | 'plan_or_subagent';

function getSessionEligibility(
  session: PersistedSession,
  now: number,
  config: MemoriesConfig,
): SessionEligibility {
  if (session.parentSessionId || session.subagentType || session.mode === 'plan') {
    return 'plan_or_subagent';
  }

  if (session.runtime?.wasRunning) {
    return 'recent';
  }

  const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
  const idleMs = now - updatedAt;
  if (idleMs < config.minRolloutIdleHours * HOUR_MS) {
    return 'recent';
  }
  if (idleMs > config.maxRolloutAgeDays * DAY_MS) {
    return 'recent';
  }
  return 'eligible';
}

export function planMemoryUpdate(params: {
  sessions: PersistedSession[];
  prev: MemoriesState;
  config: MemoriesConfig;
  workspaceId: string;
  workspaceRootPath: string;
  now: number;
}): PlannedMemoryUpdate {
  const prevBySession = new Map(params.prev.outputs.map((output) => [output.sessionId, output]));
  const prevRecordCountBySession = new Map<string, number>();
  for (const record of params.prev.records) {
    prevRecordCountBySession.set(record.sessionId, (prevRecordCountBySession.get(record.sessionId) || 0) + 1);
  }

  let skippedRecentSessions = 0;
  let skippedPlanOrSubagentSessions = 0;
  let skippedNoSignalSessions = 0;

  const eligible = params.sessions
    .filter((session) => {
      const eligibility = getSessionEligibility(session, params.now, params.config);
      if (eligibility === 'recent') {
        skippedRecentSessions += 1;
        return false;
      }
      if (eligibility === 'plan_or_subagent') {
        skippedPlanOrSubagentSessions += 1;
        return false;
      }
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, params.config.maxRolloutsPerStartup);

  const outputs = [...params.prev.outputs];
  let records = params.prev.records.filter((record) => record.workspaceId !== params.workspaceId);
  let insertedOutputs = 0;
  let updatedOutputs = 0;

  for (const session of eligible) {
    const existing = prevBySession.get(session.id);
    const sessionUpdatedAt = Number.isFinite(session.updatedAt) ? Math.floor(session.updatedAt) : 0;
    const hasExistingRecords = (prevRecordCountBySession.get(session.id) || 0) > 0;
    if (existing && existing.sourceUpdatedAt >= sessionUpdatedAt && hasExistingRecords) {
      continue;
    }

    const stage1 = buildStage1Output({
      session,
      cwd: params.workspaceRootPath,
      generatedAt: params.now,
    });
    const nextRecords = buildMemoryRecords({
      session,
      stage1,
      workspaceId: params.workspaceId,
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
  const sortedRecords = sortRecords(records).slice(0, params.config.maxRecords);
  const retainedOutputs = sortedOutputs.slice(0, params.config.maxRawMemoriesForGlobal);

  return {
    state: {
      version: STATE_VERSION,
      outputs: sortedOutputs,
      records: sortedRecords,
      jobs: {
        lastSessionScanAt: params.now,
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
      skippedPlanOrSubagentSessions,
      skippedNoSignalSessions,
    },
  };
}
