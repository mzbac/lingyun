import * as crypto from 'node:crypto';

import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function decodeBase64UrlToBuffer(data: string): Buffer {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function extractEmailAddress(value: string): string | undefined {
  const s = String(value || '').trim();
  if (!s) return undefined;

  const angle = s.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();

  const match = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim().toLowerCase();
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const wanted = name.toLowerCase();
  for (const h of headers || []) {
    if (String(h.name || '').toLowerCase() === wanted) return String(h.value || '');
  }
  return '';
}

function maybeRepairUtf8Mojibake(value: string): string {
  const original = String(value || '');
  if (!original) return '';
  if (!/[ÃÂ]/.test(original)) return original;

  const score = (s: string) => (s.match(/[ÃÂ]/g)?.length ?? 0) + (s.match(/\uFFFD/g)?.length ?? 0);

  let current = original;
  for (let i = 0; i < 2; i++) {
    const repaired = Buffer.from(current, 'latin1').toString('utf8');
    if (repaired && score(repaired) < score(current)) {
      current = repaired;
      continue;
    }
    break;
  }

  return current;
}

function findTextPart(payload?: gmail_v1.Schema$MessagePart): { mimeType: string; data: string } | undefined {
  if (!payload) return undefined;

  const bodyData = payload.body?.data;
  const mimeType = String(payload.mimeType || '');
  if (bodyData && (mimeType === 'text/plain' || mimeType === 'text/html')) {
    return { mimeType, data: String(bodyData) };
  }

  for (const part of payload.parts || []) {
    const found = findTextPart(part);
    if (found && found.mimeType === 'text/plain') return found;
  }
  for (const part of payload.parts || []) {
    const found = findTextPart(part);
    if (found) return found;
  }
  return undefined;
}

function guessExtensionFromMimeType(mimeType: string): string {
  const mt = String(mimeType || '').trim().toLowerCase();
  if (mt === 'application/pdf') return '.pdf';
  if (mt === 'image/jpeg') return '.jpg';
  if (mt === 'image/png') return '.png';
  if (mt === 'image/webp') return '.webp';
  if (mt === 'image/heic' || mt === 'image/heif') return '.heic';
  if (mt === 'text/plain') return '.txt';
  return '';
}

function guessAttachmentFilename(params: {
  filename: string;
  mimeType: string;
  attachmentId: string;
  partId?: string;
}): string {
  const filename = String(params.filename || '').trim();
  if (filename) return filename;
  const ext = guessExtensionFromMimeType(params.mimeType);
  const tokenRaw = String(params.partId || '').trim() || String(params.attachmentId || '').trim().slice(0, 10);
  const token = tokenRaw.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 12) || 'file';
  return `attachment_${token}${ext}`;
}

export type GmailMessageView = {
  messageId: string;
  internalDateMs: number;
  from: string;
  to: string;
  subject: string;
  rfcMessageId: string;
  inReplyTo: string;
  references: string;
  text: string;
  attachments: GmailAttachmentView[];
};

export type GmailAttachmentView = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  partId?: string;
};

export type GmailThreadView = {
  threadId: string;
  historyId?: string;
  messages: GmailMessageView[];
};

export type GmailThreadListing = { threadId: string; snippet?: string };

export function createGmailClient(auth: OAuth2Client): gmail_v1.Gmail {
  return google.gmail({ version: 'v1', auth });
}

export async function getMyEmailAddress(gmail: gmail_v1.Gmail): Promise<string> {
  const res = await gmail.users.getProfile({ userId: 'me' });
  const email = String(res.data.emailAddress || '').trim();
  if (!email) throw new Error('Unable to determine Gmail profile emailAddress');
  return email;
}

export async function searchThreads(
  gmail: gmail_v1.Gmail,
  params: { query: string; maxResults: number },
): Promise<GmailThreadListing[]> {
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: params.query,
    maxResults: Math.max(1, Math.min(100, Math.floor(params.maxResults))),
  });
  const threads = res.data.threads || [];
  return threads
    .map((t) => ({ threadId: String(t.id || ''), snippet: typeof t.snippet === 'string' ? t.snippet : undefined }))
    .filter((t) => t.threadId);
}

export async function getThread(gmail: gmail_v1.Gmail, params: { threadId: string }): Promise<GmailThreadView> {
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: params.threadId,
    format: 'full',
  });

  const thread = res.data;
  const messages = (thread.messages || []).map((m) => {
    const payload = m.payload;
    const headers = payload?.headers || [];

    const internalDateMs = Number.parseInt(String(m.internalDate || '0'), 10) || 0;
    const from = getHeader(headers, 'From');
    const to = getHeader(headers, 'To');
    const subject = maybeRepairUtf8Mojibake(getHeader(headers, 'Subject'));
    const rfcMessageId = getHeader(headers, 'Message-ID');
    const inReplyTo = getHeader(headers, 'In-Reply-To');
    const references = getHeader(headers, 'References');

    const part = findTextPart(payload);
    const decoded = part?.data ? decodeBase64Url(part.data) : '';
    const text = part?.mimeType === 'text/html' ? stripHtml(decoded) : decoded.trim();

    const attachments: GmailAttachmentView[] = [];
    const stack: gmail_v1.Schema$MessagePart[] = [];
    if (payload) stack.push(payload);
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      const filenameRaw = String(node.filename || '').trim();
      const attachmentId = String(node.body?.attachmentId || '').trim();
      const mimeType = String(node.mimeType || '').trim();
      const size = Number(node.body?.size || 0) || 0;
      const partId = typeof node.partId === 'string' ? node.partId : undefined;

      const mtLower = mimeType.toLowerCase();
      const isInlineBodyText = !filenameRaw && (mtLower === 'text/plain' || mtLower === 'text/html');

      if (attachmentId && !isInlineBodyText) {
        const filename = guessAttachmentFilename({ filename: filenameRaw, mimeType, attachmentId, partId });
        attachments.push({ attachmentId, filename, mimeType, size, partId });
        if (attachments.length >= 25) break;
      }

      const parts = Array.isArray(node.parts) ? node.parts : [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p) stack.push(p);
      }
    }

    return {
      messageId: String(m.id || crypto.randomUUID()),
      internalDateMs,
      from,
      to,
      subject,
      rfcMessageId,
      inReplyTo,
      references,
      text,
      attachments,
    } satisfies GmailMessageView;
  });

  messages.sort((a, b) => a.internalDateMs - b.internalDateMs);

  return {
    threadId: String(thread.id || params.threadId),
    historyId: typeof thread.historyId === 'string' ? thread.historyId : undefined,
    messages,
  };
}

export async function getMessageAttachmentBytes(
  gmail: gmail_v1.Gmail,
  params: { messageId: string; attachmentId: string },
): Promise<Buffer> {
  const messageId = String(params.messageId || '').trim();
  const attachmentId = String(params.attachmentId || '').trim();
  if (!messageId) throw new Error('messageId is required');
  if (!attachmentId) throw new Error('attachmentId is required');

  const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
  const data = String(res.data.data || '').trim();
  if (!data) return Buffer.alloc(0);
  return decodeBase64UrlToBuffer(data);
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function wrapBase64Lines(b64: string): string {
  const text = String(b64 || '').trim();
  if (!text) return '';
  return text.match(/.{1,76}/g)?.join('\r\n') ?? text;
}

function sanitizeHeaderValue(value: string): string {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function needsRfc2047Encoding(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
}

function encodeHeaderValueRfc2047Base64(value: string): string {
  const input = sanitizeHeaderValue(value);
  if (!input) return '';
  if (!needsRfc2047Encoding(input)) return input;

  const b64 = Buffer.from(input, 'utf8').toString('base64');
  const prefix = '=?UTF-8?B?';
  const suffix = '?=';
  const maxEncodedWordLength = 75;
  const maxB64LenRaw = Math.max(1, maxEncodedWordLength - prefix.length - suffix.length);
  const maxB64Len = Math.max(4, Math.floor(maxB64LenRaw / 4) * 4);

  const out: string[] = [];
  for (let i = 0; i < b64.length; i += maxB64Len) {
    out.push(`${prefix}${b64.slice(i, i + maxB64Len)}${suffix}`);
  }
  return out.join(' ');
}

function formatReplySubject(subject: string): string {
  const s = (subject || '').trim();
  if (!s) return 'Re: (no subject)';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function pickReplyTarget(
  thread: GmailThreadView,
  myEmailAddress?: string,
): { to: string; subject: string; inReplyTo?: string; references?: string } {
  const my = extractEmailAddress(myEmailAddress || '');
  const lastExternal =
    [...thread.messages].reverse().find((m) => {
      const fromEmail = extractEmailAddress(m.from);
      if (!fromEmail) return false;
      if (my && fromEmail === my) return false;
      return true;
    }) ?? thread.messages.at(-1);

  const to = (lastExternal?.from || '').trim();
  const subject = formatReplySubject(lastExternal?.subject || thread.messages.at(-1)?.subject || '');
  const msgId = (lastExternal?.rfcMessageId || '').trim();
  return {
    to,
    subject,
    inReplyTo: msgId || undefined,
    references: msgId || undefined,
  };
}

export function buildRfc822Reply(params: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const to = sanitizeHeaderValue(params.to);
  const subject = encodeHeaderValueRfc2047Base64(params.subject);
  const inReplyTo = sanitizeHeaderValue(params.inReplyTo || '');
  const references = sanitizeHeaderValue(params.references || '');

  const headers: string[] = [];
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${subject}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: base64');

  const body = String(params.body || '').replace(/\r?\n/g, '\r\n');
  const bodyB64 = Buffer.from(body, 'utf8').toString('base64');
  const bodyWrapped = wrapBase64Lines(bodyB64);

  return `${headers.join('\r\n')}\r\n\r\n${bodyWrapped}`;
}

export type Rfc822Attachment = {
  filename: string;
  mimeType: string;
  content: Buffer;
};

export function buildRfc822ReplyWithAttachments(params: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments: Rfc822Attachment[];
}): string {
  const to = sanitizeHeaderValue(params.to);
  const subject = encodeHeaderValueRfc2047Base64(params.subject);
  const inReplyTo = sanitizeHeaderValue(params.inReplyTo || '');
  const references = sanitizeHeaderValue(params.references || '');

  const boundary = `kooka_${crypto.randomUUID()}`;

  const headers: string[] = [];
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${subject}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const body = String(params.body || '').replace(/\r?\n/g, '\r\n');
  const bodyB64 = wrapBase64Lines(Buffer.from(body, 'utf8').toString('base64'));

  const parts: string[] = [];

  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/plain; charset="UTF-8"`);
  parts.push(`Content-Transfer-Encoding: base64`);
  parts.push('');
  parts.push(bodyB64);

  const attachments = Array.isArray(params.attachments) ? params.attachments : [];
  for (const a of attachments) {
    if (!a) continue;
    const filename = sanitizeHeaderValue(a.filename || 'attachment');
    const mimeType = sanitizeHeaderValue(a.mimeType || 'application/octet-stream');
    const b64 = wrapBase64Lines(Buffer.from(a.content || Buffer.alloc(0)).toString('base64'));
    if (!b64) continue;

    parts.push('');
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${mimeType}; name="${filename}"`);
    parts.push(`Content-Disposition: attachment; filename="${filename}"`);
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push('');
    parts.push(b64);
  }

  parts.push('');
  parts.push(`--${boundary}--`);

  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

export async function createDraftReply(
  gmail: gmail_v1.Gmail,
  params: { threadId: string; rawRfc822: string },
): Promise<{ draftId: string }> {
  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        threadId: params.threadId,
        raw: base64UrlEncode(params.rawRfc822),
      },
    },
  });
  const id = String(res.data.id || '');
  if (!id) throw new Error('Failed to create draft (missing draft id)');
  return { draftId: id };
}

export async function sendDraft(
  gmail: gmail_v1.Gmail,
  params: { draftId: string },
): Promise<{ messageId?: string; threadId?: string }> {
  const res = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: {
      id: params.draftId,
    },
  });

  const messageId = typeof res.data.id === 'string' ? res.data.id : undefined;
  let threadId = typeof res.data.threadId === 'string' ? res.data.threadId : undefined;

  if (!threadId && messageId) {
    try {
      const message = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata' });
      threadId = typeof message.data.threadId === 'string' ? message.data.threadId : undefined;
    } catch {
      // ignore (best-effort)
    }
  }

  return {
    messageId,
    threadId,
  };
}

export async function markThreadRead(gmail: gmail_v1.Gmail, params: { threadId: string }): Promise<void> {
  await gmail.users.threads.modify({
    userId: 'me',
    id: params.threadId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}

export type GmailLabelView = { id: string; name: string; type?: string };

export async function listLabels(gmail: gmail_v1.Gmail): Promise<GmailLabelView[]> {
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = res.data.labels || [];
  return labels
    .map((l) => ({
      id: String(l.id || ''),
      name: String(l.name || ''),
      type: typeof l.type === 'string' ? l.type : undefined,
    }))
    .filter((l) => l.id && l.name);
}

export async function getOrCreateLabelId(
  gmail: gmail_v1.Gmail,
  params: { name: string; cache?: Map<string, string> },
): Promise<string> {
  const name = String(params.name || '').trim();
  if (!name) throw new Error('Label name is required');

  const cached = params.cache?.get(name);
  if (cached) return cached;

  const labels = await listLabels(gmail);
  const existing = labels.find((l) => l.name === name);
  if (existing?.id) {
    params.cache?.set(name, existing.id);
    return existing.id;
  }

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  const id = String(created.data.id || '').trim();
  if (!id) throw new Error(`Failed to create label (missing id) for name=${name}`);
  params.cache?.set(name, id);
  return id;
}

export async function applyThreadLabelNames(
  gmail: gmail_v1.Gmail,
  params: { threadId: string; add?: string[]; remove?: string[]; labelIdCache?: Map<string, string> },
): Promise<void> {
  const addNames = (params.add || []).map((s) => String(s || '').trim()).filter(Boolean);
  const removeNames = (params.remove || []).map((s) => String(s || '').trim()).filter(Boolean);

  const addLabelIds: string[] = [];
  for (const name of addNames) {
    const id = await getOrCreateLabelId(gmail, { name, cache: params.labelIdCache });
    addLabelIds.push(id);
  }

  const removeLabelIds: string[] = [];
  for (const name of removeNames) {
    const id = await getOrCreateLabelId(gmail, { name, cache: params.labelIdCache });
    removeLabelIds.push(id);
  }

  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return;

  await gmail.users.threads.modify({
    userId: 'me',
    id: params.threadId,
    requestBody: {
      addLabelIds: addLabelIds.length > 0 ? addLabelIds : undefined,
      removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
    },
  });
}

