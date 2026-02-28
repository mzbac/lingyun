export type SessionSignalsV1 = {
  version: 1;
  updatedAt: number;
  userIntents: string[];
  assistantOutcomes: string[];
  toolsUsed: string[];
  filesTouched: string[];
};

export type SessionSignals = SessionSignalsV1;

const MAX_INTENTS = 8;
const MAX_OUTCOMES = 8;
const MAX_TOOLS = 30;
const MAX_FILES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function summarizeText(text: string, maxChars: number): string {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return compact.slice(0, maxChars).trimEnd() + '...';
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = typeof item === 'string' ? item.trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function recordUniqueFront(list: string[], value: string, maxItems: number): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  const existingIndex = list.indexOf(trimmed);
  if (existingIndex >= 0) list.splice(existingIndex, 1);
  list.unshift(trimmed);
  if (list.length > maxItems) list.splice(maxItems);
}

export function createBlankSessionSignals(now = Date.now()): SessionSignals {
  return {
    version: 1,
    updatedAt: now,
    userIntents: [],
    assistantOutcomes: [],
    toolsUsed: [],
    filesTouched: [],
  };
}

export function normalizeSessionSignals(raw: unknown, now = Date.now()): SessionSignals {
  if (!isRecord(raw) || raw.version !== 1) return createBlankSessionSignals(now);

  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? Math.floor(raw.updatedAt) : now;
  return {
    version: 1,
    updatedAt,
    userIntents: normalizeStringList(raw.userIntents, MAX_INTENTS),
    assistantOutcomes: normalizeStringList(raw.assistantOutcomes, MAX_OUTCOMES),
    toolsUsed: normalizeStringList(raw.toolsUsed, MAX_TOOLS),
    filesTouched: normalizeStringList(raw.filesTouched, MAX_FILES),
  };
}

export function recordUserIntent(signals: SessionSignals, text: string): void {
  const summary = summarizeText(text, 220);
  if (!summary) return;
  recordUniqueFront(signals.userIntents, summary, MAX_INTENTS);
  signals.updatedAt = Date.now();
}

export function recordAssistantOutcome(signals: SessionSignals, text: string): void {
  const summary = summarizeText(text, 220);
  if (!summary) return;
  recordUniqueFront(signals.assistantOutcomes, summary, MAX_OUTCOMES);
  signals.updatedAt = Date.now();
}

export function recordToolUse(signals: SessionSignals, toolId: string): void {
  const value = typeof toolId === 'string' ? toolId.trim() : '';
  if (!value) return;
  recordUniqueFront(signals.toolsUsed, value, MAX_TOOLS);
  signals.updatedAt = Date.now();
}

export function recordFileTouch(signals: SessionSignals, filePath: string): void {
  const value = typeof filePath === 'string' ? filePath.trim() : '';
  if (!value) return;
  recordUniqueFront(signals.filesTouched, value, MAX_FILES);
  signals.updatedAt = Date.now();
}

