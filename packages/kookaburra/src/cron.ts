import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Cron } from 'croner';

import { redactSensitive, truncateForDisplay } from './redact.js';

export type CronSchedule =
  | { kind: 'cron'; expression: string; timeZone?: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'at'; atIso: string };

export type CronJob = {
  id: string;
  name?: string;
  enabled: boolean;
  schedule: CronSchedule;

  // Agent job payload
  message: string;
  sessionId?: string;
  save?: boolean;

  // State
  createdAtIso: string;
  nextRunIso: string;
  lastRunIso?: string;
  lastStatus?: 'ok' | 'error';
  lastOutput?: string;
};

type CronFileV1 = {
  version: 1;
  jobs: CronJob[];
};

export type CronStore = {
  jobsFile: string;
};

export function resolveCronJobsFile(workspaceRoot: string, jobsFileSetting?: string): string {
  const p = String(jobsFileSetting || '').trim() || path.join('.kookaburra', 'cron', 'jobs.json');
  return path.isAbsolute(p) ? p : path.join(workspaceRoot, p);
}

async function readCronFile(store: CronStore): Promise<CronFileV1> {
  let raw: string;
  try {
    raw = await fs.readFile(store.jobsFile, 'utf8');
  } catch {
    return { version: 1, jobs: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid cron jobs JSON (failed to parse): ${store.jobsFile}`);
  }

  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as any) : null;
  if (!obj || obj.version !== 1 || !Array.isArray(obj.jobs)) {
    throw new Error(`Invalid cron jobs JSON (unexpected shape): ${store.jobsFile}`);
  }

  return { version: 1, jobs: obj.jobs as CronJob[] };
}

async function writeCronFileAtomic(store: CronStore, value: CronFileV1): Promise<void> {
  const dir = path.dirname(store.jobsFile);
  await fs.mkdir(dir, { recursive: true });

  const tmp = `${store.jobsFile}.tmp`;
  const json = JSON.stringify(value, null, 2) + '\n';
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, store.jobsFile);
}

function normalizeTimeZone(raw: string | undefined): string | undefined {
  const tz = String(raw || '').trim();
  return tz ? tz : undefined;
}

function computeNextRun(schedule: CronSchedule, from: Date): Date {
  const fromDate = from instanceof Date ? from : new Date(from);
  const fromMs = fromDate.getTime();
  if (!Number.isFinite(fromMs)) throw new Error('Invalid reference time');

  switch (schedule.kind) {
    case 'cron': {
      const expr = String(schedule.expression || '').trim();
      if (!expr) throw new Error('cron.expression is required');
      const tz = normalizeTimeZone(schedule.timeZone);

      const cron = new Cron(expr, { timezone: tz, mode: '5-part' });
      const next = cron.nextRun(fromDate);
      if (!next) throw new Error(`No future occurrences for cron expression: ${expr}`);
      return next;
    }
    case 'every': {
      const everyMs = Math.floor(Number(schedule.everyMs));
      if (!Number.isFinite(everyMs) || everyMs <= 0) throw new Error('every.everyMs must be > 0');
      return new Date(fromMs + everyMs);
    }
    case 'at': {
      const atIso = String(schedule.atIso || '').trim();
      if (!atIso) throw new Error('at.atIso is required');
      const at = new Date(atIso);
      const atMs = at.getTime();
      if (!Number.isFinite(atMs)) throw new Error('at.atIso must be a valid ISO timestamp');
      if (atMs <= fromMs) throw new Error('at.atIso must be in the future');
      return at;
    }
    default:
      throw new Error('Unknown schedule kind');
  }
}

export async function listCronJobs(store: CronStore): Promise<CronJob[]> {
  const file = await readCronFile(store);
  const jobs = file.jobs.slice();
  jobs.sort((a, b) => Date.parse(a.nextRunIso) - Date.parse(b.nextRunIso));
  return jobs;
}

export async function getCronJob(store: CronStore, id: string): Promise<CronJob | undefined> {
  const file = await readCronFile(store);
  return file.jobs.find((j) => j.id === id);
}

export async function addCronJob(store: CronStore, input: {
  name?: string;
  enabled?: boolean;
  schedule: CronSchedule;
  message: string;
  sessionId?: string;
  save?: boolean;
}): Promise<CronJob> {
  const now = new Date();

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  const message = String(input.message || '').trim();
  if (!message) throw new Error('message is required');

  const next = computeNextRun(input.schedule, now);

  const job: CronJob = {
    id: crypto.randomUUID(),
    name: input.name ? String(input.name).trim() || undefined : undefined,
    enabled,
    schedule: input.schedule,
    message,
    sessionId: input.sessionId ? String(input.sessionId).trim() || undefined : undefined,
    ...(typeof input.save === 'boolean' ? { save: input.save } : {}),
    createdAtIso: now.toISOString(),
    nextRunIso: next.toISOString(),
  };

  const file = await readCronFile(store);
  file.jobs.push(job);
  await writeCronFileAtomic(store, file);
  return job;
}

export async function removeCronJob(store: CronStore, id: string): Promise<void> {
  const file = await readCronFile(store);
  const before = file.jobs.length;
  file.jobs = file.jobs.filter((j) => j.id !== id);
  if (file.jobs.length === before) throw new Error(`Cron job not found: ${id}`);
  await writeCronFileAtomic(store, file);
}

export async function updateCronJob(store: CronStore, id: string, patch: Partial<Pick<CronJob, 'name' | 'enabled' | 'schedule' | 'message' | 'sessionId' | 'save'>>): Promise<CronJob> {
  const file = await readCronFile(store);
  const job = file.jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Cron job not found: ${id}`);

  const now = new Date();
  const prevEnabled = Boolean(job.enabled);

  if (typeof patch.name === 'string') job.name = patch.name.trim() || undefined;
  if (typeof patch.message === 'string') {
    const msg = patch.message.trim();
    if (!msg) throw new Error('message must not be empty');
    job.message = msg;
  }
  if (typeof patch.sessionId === 'string') job.sessionId = patch.sessionId.trim() || undefined;
  if (typeof patch.save === 'boolean') job.save = patch.save;
  if (typeof patch.enabled === 'boolean') job.enabled = patch.enabled;
  if (patch.schedule && typeof patch.schedule === 'object') job.schedule = patch.schedule as any;

  // If the schedule changed, or job became enabled, re-compute next run from now.
  if (patch.schedule || (prevEnabled === false && job.enabled === true)) {
    job.nextRunIso = computeNextRun(job.schedule, now).toISOString();
  }

  await writeCronFileAtomic(store, file);
  return job;
}

export async function markCronJobRunResult(store: CronStore, id: string, result: { ok: boolean; output: string }): Promise<CronJob> {
  const file = await readCronFile(store);
  const job = file.jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Cron job not found: ${id}`);

  const now = new Date();
  job.lastRunIso = now.toISOString();
  job.lastStatus = result.ok ? 'ok' : 'error';
  job.lastOutput = truncateForDisplay(redactSensitive(result.output || ''), 2000);

  if (job.schedule.kind === 'at') {
    // One-shot: disable after the first run.
    job.enabled = false;
  } else if (job.enabled) {
    job.nextRunIso = computeNextRun(job.schedule, now).toISOString();
  }

  await writeCronFileAtomic(store, file);
  return job;
}

export function parseDelayMs(input: string): number {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('delay is required');

  const match = raw.match(/^([0-9]+)\\s*(s|m|h|d)?$/i);
  if (!match) throw new Error(`Invalid delay: ${raw} (use e.g. 30m, 2h, 1d, 45s)`);

  const amount = Number.parseInt(match[1] || '0', 10);
  const unit = (match[2] || 'm').toLowerCase();
  const ms =
    unit === 's'
      ? amount * 1000
      : unit === 'm'
        ? amount * 60_000
        : unit === 'h'
          ? amount * 60 * 60_000
          : unit === 'd'
            ? amount * 24 * 60 * 60_000
            : NaN;

  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid delay: ${raw}`);
  return ms;
}

