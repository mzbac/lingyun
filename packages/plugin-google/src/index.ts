import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import process from 'node:process';

import { getGoogleAuth } from './googleAuth.js';
import type { BusyInterval, SuggestedSlot, CreateEventParams } from './calendarClient.js';
import { createCalendarClient, createEvent, getBusyIntervals, suggestSlots } from './calendarClient.js';
import type { GmailThreadListing, GmailThreadView } from './gmailClient.js';
import {
  applyThreadLabelNames,
  buildRfc822Reply,
  buildRfc822ReplyWithAttachments,
  createDraftReply,
  createGmailClient,
  getMessageAttachmentBytes,
  getMyEmailAddress,
  getThread,
  pickReplyTarget,
  searchThreads,
  sendDraft,
  markThreadRead,
} from './gmailClient.js';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const limit = Number.isFinite(maxItems) && maxItems > 0 ? Math.floor(maxItems) : 50;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const v = item.trim();
    if (!v) continue;
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function threadIdFromSessionId(sessionId: string | undefined): string | undefined {
  const s = String(sessionId || '').trim();
  if (!s) return undefined;
  if (s.startsWith('gmail:')) return s.slice('gmail:'.length).trim() || undefined;

  const idx = s.lastIndexOf('gmail:');
  if (idx >= 0) {
    const rest = s.slice(idx + 'gmail:'.length).trim();
    return rest || undefined;
  }

  return undefined;
}

function requireThreadId(args: any, context: any): string | undefined {
  const direct = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
  if (direct) return direct;
  const fromSession = threadIdFromSessionId(context?.sessionId);
  if (fromSession) return fromSession;
  return undefined;
}

export default function googlePlugin(input: any) {
  const workspaceRoot = input?.workspaceRoot ? path.resolve(input.workspaceRoot) : undefined;

  let runtimePromise:
    | Promise<{
        gmail: ReturnType<typeof createGmailClient>;
        calendar: ReturnType<typeof createCalendarClient>;
        myEmailAddress?: string;
        defaultCalendarId: string;
      }>
    | undefined;

  const threadCache = new Map<string, GmailThreadView>();
  const labelIdCache = new Map<string, string>();

  async function ensureRuntime() {
    if (runtimePromise) return runtimePromise;
    if (!workspaceRoot) throw new Error('plugin-google: workspaceRoot is required');

    runtimePromise = (async () => {
      const credentialsPath =
        String(process.env.GOOGLE_OAUTH_CREDENTIALS_PATH || '').trim() || path.join(workspaceRoot, 'credentials.json');
      const tokenPath =
        String(process.env.GOOGLE_OAUTH_TOKEN_PATH || '').trim() ||
        path.join(workspaceRoot, '.kookaburra', 'google_oauth_token.json');

      if (!(await fileExists(credentialsPath))) {
        throw new Error(
          `Google credentials not found. Expected ${path.basename(credentialsPath)} in the workspace root (or set GOOGLE_OAUTH_CREDENTIALS_PATH).`,
        );
      }

      const auth = await getGoogleAuth({
        credentialsPath,
        tokenPath,
        scopes: GOOGLE_SCOPES,
      });

      const gmail = createGmailClient(auth);
      const calendar = createCalendarClient(auth);

      let myEmailAddress: string | undefined;
      try {
        myEmailAddress = await getMyEmailAddress(gmail);
      } catch {
        myEmailAddress = undefined;
      }

      const defaultCalendarId = String(process.env.GOOGLE_CALENDAR_ID || '').trim() || 'primary';

      return { gmail, calendar, myEmailAddress, defaultCalendarId };
    })();

    return runtimePromise;
  }

  async function getThreadCached(runtime: Awaited<ReturnType<typeof ensureRuntime>>, threadId: string): Promise<GmailThreadView> {
    const cached = threadCache.get(threadId);
    if (cached) return cached;
    const thread = await getThread(runtime.gmail, { threadId });
    threadCache.set(threadId, thread);
    return thread;
  }

  return {
    tool: {
      'gmail.searchThreads': {
        description: 'Search Gmail threads using Gmail search syntax.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search query (e.g. "is:unread newer_than:7d")' },
            maxResults: { type: 'number', description: 'Max threads to return (1-100)', default: 10 },
          },
          required: ['query'],
        },
        metadata: {
          permission: 'read',
          readOnly: true,
          requiresApproval: false,
        },
        execute: async (args: any) => {
          const query = String(asString(args?.query) || '').trim();
          if (!query) return { success: false, error: 'query is required' };
          const maxResults = clampInt(asNumber(args?.maxResults) ?? 10, 1, 100, 10);

          const runtime = await ensureRuntime();
          const threads: GmailThreadListing[] = await searchThreads(runtime.gmail, { query, maxResults });
          return { success: true, data: threads };
        },
      },

      'gmail.getThread': {
        description: 'Fetch a Gmail thread and return a simplified view (messages with headers + plain text).',
        parameters: {
          type: 'object',
          properties: {
            threadId: { type: 'string', description: 'Gmail thread id (optional if sessionId is gmail:<threadId>)' },
          },
        },
        metadata: {
          permission: 'read',
          readOnly: true,
          requiresApproval: false,
          permissionPatterns: [{ arg: 'threadId', kind: 'raw' }],
        },
        execute: async (args: any, context: any) => {
          const threadId = requireThreadId(args, context);
          if (!threadId) return { success: false, error: 'threadId is required (or use sessionId=gmail:<threadId>)' };

          const runtime = await ensureRuntime();
          const thread = await getThreadCached(runtime, threadId);
          return { success: true, data: thread };
        },
      },

      'gmail.getAttachment': {
        description: 'Fetch a Gmail message attachment and return its bytes as base64.',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Gmail message id that contains the attachment' },
            attachmentId: { type: 'string', description: 'Gmail attachment id from gmail.getThread output' },
            maxBytes: { type: 'number', description: 'Max bytes allowed (default: 1048576)' },
          },
          required: ['messageId', 'attachmentId'],
        },
        metadata: {
          permission: 'read',
          readOnly: true,
          requiresApproval: false,
          permissionPatterns: [
            { arg: 'messageId', kind: 'raw' },
            { arg: 'attachmentId', kind: 'raw' },
          ],
        },
        execute: async (args: any) => {
          const messageId = String(asString(args?.messageId) || '').trim();
          const attachmentId = String(asString(args?.attachmentId) || '').trim();
          if (!messageId) return { success: false, error: 'messageId is required' };
          if (!attachmentId) return { success: false, error: 'attachmentId is required' };

          const maxBytes = clampInt(asNumber(args?.maxBytes) ?? 1024 * 1024, 1, 25 * 1024 * 1024, 1024 * 1024);

          const runtime = await ensureRuntime();
          const bytes = await getMessageAttachmentBytes(runtime.gmail, { messageId, attachmentId });
          if (bytes.byteLength > maxBytes) {
            return {
              success: false,
              error: `Attachment too large (${bytes.byteLength} bytes). Increase maxBytes to allow it.`,
              metadata: { errorType: 'too_large', sizeBytes: bytes.byteLength, maxBytes },
            };
          }

          return {
            success: true,
            data: {
              sizeBytes: bytes.byteLength,
              contentBase64: Buffer.from(bytes).toString('base64'),
            },
          };
        },
      },

      'gmail.createDraftReply': {
        description: 'Create a Gmail draft reply in the current thread.',
        parameters: {
          type: 'object',
          properties: {
            threadId: { type: 'string', description: 'Gmail thread id (optional if sessionId is gmail:<threadId>)' },
            body: { type: 'string', description: 'Reply body (plain text). Do not include To/Subject.' },
            attachments: {
              type: 'array',
              description: 'Optional attachments (base64). Each item: { filename, mimeType, contentBase64 }.',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: 'Attachment filename' },
                  mimeType: { type: 'string', description: 'Attachment MIME type (e.g. application/pdf)' },
                  contentBase64: { type: 'string', description: 'Attachment bytes as base64' },
                },
                required: ['filename', 'mimeType', 'contentBase64'],
              },
            },
          },
          required: ['body'],
        },
        metadata: {
          permission: 'edit',
          readOnly: false,
          requiresApproval: true,
          permissionPatterns: [{ arg: 'threadId', kind: 'raw' }],
        },
        execute: async (args: any, context: any) => {
          const threadId = requireThreadId(args, context);
          if (!threadId) return { success: false, error: 'threadId is required (or use sessionId=gmail:<threadId>)' };

          const body = String(asString(args?.body) || '').trim();
          if (!body) return { success: false, error: 'body is required' };

          const runtime = await ensureRuntime();
          const thread = await getThreadCached(runtime, threadId);
          const target = pickReplyTarget(thread, runtime.myEmailAddress);
          if (!target?.to) return { success: false, error: 'Unable to determine reply recipient (missing From header).' };

          const attachmentsRaw = Array.isArray(args?.attachments) ? args.attachments : [];
          if (attachmentsRaw.length > 5) {
            return { success: false, error: 'Too many attachments (max 5).' };
          }

          const attachments: Array<{ filename: string; mimeType: string; content: Buffer }> = [];
          let totalBytes = 0;
          for (const item of attachmentsRaw) {
            if (!item || typeof item !== 'object') return { success: false, error: 'attachments items must be objects' };
            const filename = String(asString(item.filename) || '').trim();
            const mimeType = String(asString(item.mimeType) || '').trim();
            const contentBase64 = String(asString(item.contentBase64) || '').trim();
            if (!filename) return { success: false, error: 'attachments[].filename is required' };
            if (!mimeType) return { success: false, error: 'attachments[].mimeType is required' };
            if (!contentBase64) return { success: false, error: 'attachments[].contentBase64 is required' };

            let content: Buffer;
            try {
              content = Buffer.from(contentBase64, 'base64');
            } catch {
              return { success: false, error: `Invalid base64 for attachment ${filename}` };
            }

            if (content.byteLength > 10 * 1024 * 1024) {
              return { success: false, error: `Attachment too large: ${filename} (${content.byteLength} bytes)` };
            }
            totalBytes += content.byteLength;
            attachments.push({ filename, mimeType, content });
          }

          if (totalBytes > 15 * 1024 * 1024) {
            return { success: false, error: `Total attachment size too large (${totalBytes} bytes)` };
          }

          const raw =
            attachments.length > 0
              ? buildRfc822ReplyWithAttachments({
                  to: target.to,
                  subject: target.subject,
                  body,
                  inReplyTo: target.inReplyTo,
                  references: target.references,
                  attachments,
                })
              : buildRfc822Reply({
                  to: target.to,
                  subject: target.subject,
                  body,
                  inReplyTo: target.inReplyTo,
                  references: target.references,
                });

          const created = await createDraftReply(runtime.gmail, { threadId, rawRfc822: raw });
          return { success: true, data: { draftId: created.draftId, to: target.to, subject: target.subject } };
        },
      },

      'gmail.sendDraft': {
        description: 'Send an existing Gmail draft.',
        parameters: {
          type: 'object',
          properties: {
            draftId: { type: 'string', description: 'Gmail draft id returned by gmail.createDraftReply' },
          },
          required: ['draftId'],
        },
        metadata: {
          permission: 'edit',
          readOnly: false,
          requiresApproval: true,
          permissionPatterns: [{ arg: 'draftId', kind: 'raw' }],
        },
        execute: async (args: any) => {
          const draftId = String(asString(args?.draftId) || '').trim();
          if (!draftId) return { success: false, error: 'draftId is required' };

          const runtime = await ensureRuntime();
          const result = await sendDraft(runtime.gmail, { draftId });
          return { success: true, data: result };
        },
      },

      'gmail.labelThread': {
        description: 'Add/remove Gmail labels on a thread (label names are created if missing).',
        parameters: {
          type: 'object',
          properties: {
            threadId: { type: 'string', description: 'Gmail thread id (optional if sessionId is gmail:<threadId>)' },
            add: { type: 'array', items: { type: 'string' }, description: 'Label names to add' },
            remove: { type: 'array', items: { type: 'string' }, description: 'Label names to remove' },
          },
        },
        metadata: {
          permission: 'edit',
          readOnly: false,
          requiresApproval: true,
          permissionPatterns: [{ arg: 'threadId', kind: 'raw' }],
        },
        execute: async (args: any, context: any) => {
          const threadId = requireThreadId(args, context);
          if (!threadId) return { success: false, error: 'threadId is required (or use sessionId=gmail:<threadId>)' };

          const add = asStringArray(args?.add, 50);
          const remove = asStringArray(args?.remove, 50);

          const runtime = await ensureRuntime();
          await applyThreadLabelNames(runtime.gmail, { threadId, add, remove, labelIdCache });
          return { success: true, data: { ok: true } };
        },
      },

      'gmail.markRead': {
        description: 'Mark a Gmail thread as read (remove UNREAD label).',
        parameters: {
          type: 'object',
          properties: {
            threadId: { type: 'string', description: 'Gmail thread id (optional if sessionId is gmail:<threadId>)' },
          },
        },
        metadata: {
          permission: 'edit',
          readOnly: false,
          requiresApproval: true,
          permissionPatterns: [{ arg: 'threadId', kind: 'raw' }],
        },
        execute: async (args: any, context: any) => {
          const threadId = requireThreadId(args, context);
          if (!threadId) return { success: false, error: 'threadId is required (or use sessionId=gmail:<threadId>)' };

          const runtime = await ensureRuntime();
          await markThreadRead(runtime.gmail, { threadId });
          return { success: true, data: { ok: true } };
        },
      },

      'calendar.freeBusy': {
        description: 'Query Google Calendar free/busy for a time window.',
        parameters: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', description: 'Calendar id (default: GOOGLE_CALENDAR_ID or "primary")' },
            timeMin: { type: 'string', description: 'RFC3339 timestamp (inclusive)' },
            timeMax: { type: 'string', description: 'RFC3339 timestamp (exclusive)' },
          },
          required: ['timeMin', 'timeMax'],
        },
        metadata: {
          permission: 'read',
          readOnly: true,
          requiresApproval: false,
        },
        execute: async (args: any) => {
          const timeMin = String(asString(args?.timeMin) || '').trim();
          const timeMax = String(asString(args?.timeMax) || '').trim();
          if (!timeMin) return { success: false, error: 'timeMin is required' };
          if (!timeMax) return { success: false, error: 'timeMax is required' };
          const calendarId = String(asString(args?.calendarId) || '').trim();

          const runtime = await ensureRuntime();
          const busy: BusyInterval[] = await getBusyIntervals({
            calendar: runtime.calendar,
            calendarId: calendarId || runtime.defaultCalendarId,
            timeMin,
            timeMax,
          });
          return { success: true, data: busy };
        },
      },

      'calendar.suggestSlots': {
        description: 'Suggest meeting slots based on calendar availability.',
        parameters: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', description: 'Calendar id (default: GOOGLE_CALENDAR_ID or "primary")' },
            timeZone: { type: 'string', description: 'IANA TZ (default: system TZ)' },
            daysAhead: { type: 'number', description: 'How many days ahead to search', default: 7 },
            workStartHour: { type: 'number', description: 'Work day start hour (0-23)', default: 9 },
            workEndHour: { type: 'number', description: 'Work day end hour (1-24)', default: 17 },
            durationMin: { type: 'number', description: 'Meeting duration minutes', default: 30 },
            intervalMin: { type: 'number', description: 'Slot granularity minutes', default: 30 },
            maxSlots: { type: 'number', description: 'Max suggestions', default: 3 },
          },
        },
        metadata: {
          permission: 'read',
          readOnly: true,
          requiresApproval: false,
        },
        execute: async (args: any) => {
          const timeZone =
            String(asString(args?.timeZone) || '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          const daysAhead = clampInt(asNumber(args?.daysAhead) ?? 7, 1, 30, 7);
          const workStartHour = clampInt(asNumber(args?.workStartHour) ?? 9, 0, 23, 9);
          const workEndHour = clampInt(asNumber(args?.workEndHour) ?? 17, 1, 24, 17);
          const durationMin = clampInt(asNumber(args?.durationMin) ?? 30, 10, 240, 30);
          const intervalMin = clampInt(asNumber(args?.intervalMin) ?? 30, 5, 120, 30);
          const maxSlots = clampInt(asNumber(args?.maxSlots) ?? 3, 1, 12, 3);
          const calendarId = String(asString(args?.calendarId) || '').trim();

          const runtime = await ensureRuntime();
          const now = new Date();
          const timeMin = now.toISOString();
          const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60_000).toISOString();

          const busy = await getBusyIntervals({
            calendar: runtime.calendar,
            calendarId: calendarId || runtime.defaultCalendarId,
            timeMin,
            timeMax,
          });

          const slots: SuggestedSlot[] = suggestSlots({
            busy,
            timeZone,
            now,
            daysAhead,
            workStartHour,
            workEndHour,
            durationMin,
            intervalMin,
            maxSlots,
          });

          return { success: true, data: slots };
        },
      },

      'calendar.createEvent': {
        description: 'Create a calendar event (optionally with Google Meet) and invite attendees.',
        parameters: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', description: 'Calendar id (default: GOOGLE_CALENDAR_ID or "primary")' },
            summary: { type: 'string', description: 'Event title' },
            description: { type: 'string', description: 'Event description' },
            location: { type: 'string', description: 'Event location' },
            startIso: { type: 'string', description: 'Event start timestamp (ISO/RFC3339)' },
            endIso: { type: 'string', description: 'Event end timestamp (ISO/RFC3339)' },
            timeZone: { type: 'string', description: 'IANA time zone for start/end' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
            conferenceType: {
              type: 'string',
              description: '"google_meet" or "none"',
              enum: ['google_meet', 'none'],
              default: 'google_meet',
            },
          },
          required: ['summary', 'startIso', 'endIso'],
        },
        metadata: {
          permission: 'edit',
          readOnly: false,
          requiresApproval: true,
          permissionPatterns: [{ arg: 'summary', kind: 'raw' }],
        },
        execute: async (args: any) => {
          const summary = String(asString(args?.summary) || '').trim();
          const startIso = String(asString(args?.startIso) || '').trim();
          const endIso = String(asString(args?.endIso) || '').trim();
          if (!summary) return { success: false, error: 'summary is required' };
          if (!startIso) return { success: false, error: 'startIso is required' };
          if (!endIso) return { success: false, error: 'endIso is required' };

          const calendarId = String(asString(args?.calendarId) || '').trim();
          const description = String(asString(args?.description) || '').trim() || undefined;
          const location = String(asString(args?.location) || '').trim() || undefined;
          const timeZone = String(asString(args?.timeZone) || '').trim() || undefined;
          const attendees = asStringArray(args?.attendees, 20);
          const conferenceType = String(asString(args?.conferenceType) || '').trim() === 'none' ? 'none' : 'google_meet';

          const runtime = await ensureRuntime();
          const result = await createEvent({
            calendar: runtime.calendar,
            input: {
              calendarId: calendarId || runtime.defaultCalendarId,
              summary,
              description,
              location,
              startIso,
              endIso,
              timeZone,
              attendees,
              conferenceType,
            } satisfies CreateEventParams,
          });

          return { success: true, data: result };
        },
      },
    },
  };
}

