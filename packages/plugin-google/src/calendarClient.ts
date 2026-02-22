import * as crypto from 'node:crypto';

import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export function createCalendarClient(auth: OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: 'v3', auth });
}

export type BusyInterval = { start: string; end: string };

export async function getBusyIntervals(params: {
  calendar: calendar_v3.Calendar;
  calendarId: string;
  timeMin: string;
  timeMax: string;
}): Promise<BusyInterval[]> {
  const res = await params.calendar.freebusy.query({
    requestBody: {
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      items: [{ id: params.calendarId }],
    },
  });

  const calendars = res.data.calendars || {};
  const entry = calendars[params.calendarId];
  const busy = entry?.busy || [];

  return busy
    .map((b) => ({ start: String(b.start || '').trim(), end: String(b.end || '').trim() }))
    .filter((b) => b.start && b.end);
}

function clampInt(value: number, min: number, max: number): number {
  const v = Math.floor(Number(value));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function roundUpToIntervalMs(ms: number, intervalMin: number): number {
  const step = Math.max(1, Math.floor(intervalMin)) * 60_000;
  return Math.ceil(ms / step) * step;
}

function getZonedParts(date: Date, timeZone: string): { y: number; m: number; d: number; hh: number; mm: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return {
    y: Number.parseInt(get('year'), 10) || 0,
    m: Number.parseInt(get('month'), 10) || 0,
    d: Number.parseInt(get('day'), 10) || 0,
    hh: Number.parseInt(get('hour'), 10) || 0,
    mm: Number.parseInt(get('minute'), 10) || 0,
  };
}

function sameZonedDate(a: Date, b: Date, timeZone: string): boolean {
  const pa = getZonedParts(a, timeZone);
  const pb = getZonedParts(b, timeZone);
  return pa.y === pb.y && pa.m === pb.m && pa.d === pb.d;
}

function formatSlotDisplay(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return dtf.format(date);
}

function formatDatePrefix(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  });
  return dtf.format(date);
}

function getTimeParts(date: Date, timeZone: string): { hour: string; minute: string; dayPeriod: string } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return { hour: get('hour'), minute: get('minute'), dayPeriod: get('dayPeriod') };
}

function getTimeZoneName(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  });
  const parts = dtf.formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value || '';
}

function formatWindowDisplay(params: { timeZone: string; start: Date; end: Date }): string {
  const tz = String(params.timeZone || '').trim() || 'UTC';
  const datePrefix = formatDatePrefix(params.start, tz);
  const tzName = getTimeZoneName(params.start, tz);

  const start = getTimeParts(params.start, tz);
  const end = getTimeParts(params.end, tz);

  const startHHMM = start.hour && start.minute ? `${start.hour}:${start.minute}` : '';
  const endHHMM = end.hour && end.minute ? `${end.hour}:${end.minute}` : '';

  const samePeriod = start.dayPeriod && end.dayPeriod && start.dayPeriod === end.dayPeriod;
  const range = samePeriod
    ? `${startHHMM}–${endHHMM} ${end.dayPeriod}`
    : `${startHHMM} ${start.dayPeriod}–${endHHMM} ${end.dayPeriod}`;

  return `${datePrefix}, ${range}${tzName ? ` ${tzName}` : ''}`.trim();
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type SuggestedSlot = {
  startIso: string;
  endIso: string;
  display: string;
};

export function suggestSlots(params: {
  busy: BusyInterval[];
  timeZone: string;
  now?: Date;
  daysAhead: number;
  workStartHour: number;
  workEndHour: number;
  durationMin: number;
  intervalMin: number;
  maxSlots: number;
}): SuggestedSlot[] {
  const now = params.now ?? new Date();
  const timeZone = String(params.timeZone || '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const daysAhead = clampInt(params.daysAhead, 1, 30);
  const workStartHour = clampInt(params.workStartHour, 0, 23);
  const workEndHour = clampInt(params.workEndHour, 1, 24);
  const durationMin = clampInt(params.durationMin, 10, 240);
  const intervalMin = clampInt(params.intervalMin, 5, 120);
  const maxSlots = clampInt(params.maxSlots, 1, 12);

  const busyRanges = params.busy
    .map((b) => ({ startMs: Date.parse(b.start), endMs: Date.parse(b.end) }))
    .filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && b.endMs > b.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const nowMs = now.getTime();
  const timeMinMs = roundUpToIntervalMs(nowMs + 60_000, intervalMin);
  const timeMaxMs = nowMs + daysAhead * 24 * 60 * 60_000;

  const durationMs = durationMin * 60_000;
  const intervalMs = intervalMin * 60_000;

  const byDay = new Map<string, Array<{ startMs: number; endMs: number; startIso: string; endIso: string }>>();
  for (let startMs = timeMinMs; startMs + durationMs <= timeMaxMs; startMs += intervalMin * 60_000) {
    const start = new Date(startMs);
    const end = new Date(startMs + durationMs);

    if (!sameZonedDate(start, end, timeZone)) continue;

    const parts = getZonedParts(start, timeZone);
    const startHour = parts.hh;
    const dayKey = `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;

    // Work window: [startHour, endHour)
    if (startHour < workStartHour) continue;
    if (startHour >= workEndHour) continue;

    const endParts = getZonedParts(end, timeZone);
    if (endParts.hh > workEndHour || (endParts.hh === workEndHour && endParts.mm > 0)) continue;

    let isBusy = false;
    for (const b of busyRanges) {
      if (b.startMs > end.getTime()) break;
      if (overlaps(start.getTime(), end.getTime(), b.startMs, b.endMs)) {
        isBusy = true;
        break;
      }
    }
    if (isBusy) continue;

    const entry = byDay.get(dayKey) ?? [];
    entry.push({
      startMs: startMs,
      endMs: end.getTime(),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    });
    if (!byDay.has(dayKey)) byDay.set(dayKey, entry);
  }

  const weekdayDtf = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
  const dayEntries = Array.from(byDay.entries())
    .map(([dayKey, slots]) => {
      const firstStartMs = slots?.[0]?.startMs ?? 0;
      const weekday = firstStartMs ? weekdayDtf.format(new Date(firstStartMs)) : '';
      const isWeekend = weekday === 'Sat' || weekday === 'Sun';
      return { dayKey, slots, firstStartMs, isWeekend };
    })
    .filter((e) => Array.isArray(e.slots) && e.slots.length > 0 && Number.isFinite(e.firstStartMs))
    .sort((a, b) => a.firstStartMs - b.firstStartMs);

  // Prefer weekdays; only include weekend slots if we don't have enough weekday options.
  const orderedDays = dayEntries.filter((d) => !d.isWeekend).concat(dayEntries.filter((d) => d.isWeekend));

  const out: SuggestedSlot[] = [];
  for (const { slots } of orderedDays) {
    if (out.length >= maxSlots) break;
    if (!Array.isArray(slots) || slots.length === 0) continue;

    const first = slots[0];

    // Always display the concrete slot duration (start-end) to avoid ambiguity (e.g. showing a multi-hour window
    // while the underlying slot is only 30 minutes).
    const display = formatWindowDisplay({ timeZone, start: new Date(first.startMs), end: new Date(first.endMs) });

    out.push({
      startIso: first.startIso,
      endIso: first.endIso,
      display: display || formatSlotDisplay(new Date(first.startMs), timeZone),
    });
  }

  return out;
}

export type CreateEventParams = {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  timeZone?: string;
  attendees?: string[];
  conferenceType?: 'google_meet' | 'none';
};

export async function createEvent(params: {
  calendar: calendar_v3.Calendar;
  input: CreateEventParams;
}): Promise<{ eventId: string; htmlLink?: string; hangoutLink?: string }> {
  const calendarId = String(params.input.calendarId || '').trim() || 'primary';
  const summary = String(params.input.summary || '').trim();
  if (!summary) throw new Error('summary is required');

  const startIso = String(params.input.startIso || '').trim();
  const endIso = String(params.input.endIso || '').trim();
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('Invalid startIso/endIso');
  }

  // Prevent double-booking (best-effort). This is not race-free, but it blocks obvious conflicts.
  const busy = await getBusyIntervals({
    calendar: params.calendar,
    calendarId,
    timeMin: new Date(startMs).toISOString(),
    timeMax: new Date(endMs).toISOString(),
  });
  for (const b of busy) {
    const bStartMs = Date.parse(b.start);
    const bEndMs = Date.parse(b.end);
    if (!Number.isFinite(bStartMs) || !Number.isFinite(bEndMs) || bEndMs <= bStartMs) continue;
    const overlaps = startMs < bEndMs && bStartMs < endMs;
    if (overlaps) {
      const err = new Error('Requested time conflicts with an existing busy interval in the calendar.');
      (err as any).code = 'calendar_conflict';
      throw err;
    }
  }

  const timeZone = String(params.input.timeZone || '').trim() || undefined;

  const attendees = (params.input.attendees || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((email) => ({ email }));

  const requestBody: calendar_v3.Schema$Event = {
    summary,
    description: params.input.description ? String(params.input.description) : undefined,
    location: params.input.location ? String(params.input.location) : undefined,
    start: { dateTime: startIso, timeZone },
    end: { dateTime: endIso, timeZone },
    attendees: attendees.length > 0 ? attendees : undefined,
  };

  const conferenceType = params.input.conferenceType === 'google_meet' ? 'google_meet' : 'none';
  const wantsMeet = conferenceType === 'google_meet';

  if (wantsMeet) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const res = await params.calendar.events.insert({
    calendarId,
    requestBody,
    conferenceDataVersion: wantsMeet ? 1 : undefined,
    sendUpdates: attendees.length > 0 ? 'all' : undefined,
  });

  const eventId = String(res.data.id || '').trim();
  if (!eventId) throw new Error('Event creation failed (missing event id)');

  return {
    eventId,
    htmlLink: typeof res.data.htmlLink === 'string' ? res.data.htmlLink : undefined,
    hangoutLink: typeof res.data.hangoutLink === 'string' ? res.data.hangoutLink : undefined,
  };
}

