import {
  DAY_MS,
  type ConsolidatedMemoryEntry,
  type DurableMemoryCategory,
  type MemoryRecord,
  type MemoryRecordStaleness,
  type Stage1Output,
} from './model';
import { redactMemorySecrets } from './privacy';

type ConsolidatedMemoryArtifacts = {
  memoryFile: string;
  memorySummary: string;
  topicFiles: Record<string, string>;
  entries: ConsolidatedMemoryEntry[];
};

type RecordSupport = {
  lastConfirmedAt: number;
  freshness: MemoryRecordStaleness;
  filesTouched: string[];
  toolsUsed: string[];
  bestText?: string;
  bestTextConfidence?: number;
  bestTextEvidenceCount?: number;
  bestTextUpdatedAt?: number;
  bestTextFreshness?: MemoryRecordStaleness;
};

type TextCandidate = {
  text: string;
  updatedAt: number;
  confidence: number;
  evidenceCount: number;
  freshness: MemoryRecordStaleness;
  source: 'candidate' | 'support';
};

type ConsolidatedEntryAccumulator = ConsolidatedMemoryEntry & {
  textUpdatedAt: number;
  textConfidence: number;
  textEvidenceCount: number;
  textFreshness: MemoryRecordStaleness;
};

const SUMMARY_SECTION_LIMITS: Record<DurableMemoryCategory, number> = {
  user: 3,
  feedback: 4,
  project: 3,
  reference: 3,
  procedure: 3,
  failure_shield: 2,
};

const MEMORY_SECTION_LIMITS: Record<DurableMemoryCategory, number> = {
  user: 6,
  feedback: 8,
  project: 8,
  reference: 6,
  procedure: 6,
  failure_shield: 6,
};

const CATEGORY_TITLES: Record<DurableMemoryCategory, string> = {
  user: 'User Working Style',
  feedback: 'Feedback and Constraints',
  project: 'Project Context',
  reference: 'Reference Pointers',
  procedure: 'Reusable Procedures',
  failure_shield: 'Failure Shields',
};

const CATEGORY_ORDER: DurableMemoryCategory[] = ['user', 'feedback', 'project', 'procedure', 'failure_shield', 'reference'];

const TOPIC_FILE_BY_CATEGORY: Record<DurableMemoryCategory, string> = {
  user: 'user.md',
  feedback: 'feedback.md',
  project: 'project.md',
  reference: 'reference.md',
  procedure: 'procedure.md',
  failure_shield: 'failure_shields.md',
};

function memoryTopicPath(category: DurableMemoryCategory): string {
  return `memory_topics/${TOPIC_FILE_BY_CATEGORY[category]}`;
}

function uniqueLimited(values: string[], maxItems: number): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = redactMemorySecrets(String(value || '')).trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
    if (next.length >= maxItems) break;
  }
  return next;
}

const MAX_DURABLE_TEXT_CHARS = 420;

function calculateMemoryAgeDays(lastConfirmedAt: number, now: number): number | undefined {
  if (!Number.isFinite(lastConfirmedAt) || lastConfirmedAt <= 0) return undefined;
  return Math.max(0, Math.floor((now - lastConfirmedAt) / DAY_MS));
}

export function formatMemoryAgeLabel(ageDays: number | undefined): string {
  if (!Number.isFinite(ageDays as number)) return 'unknown';
  const value = Math.max(0, Math.floor(ageDays as number));
  if (value === 0) return 'today';
  if (value === 1) return '1 day old';
  return `${value} days old`;
}

export function formatMemoryLastConfirmedMetadata(lastConfirmedAt: number, now: number): string {
  const ageDays = calculateMemoryAgeDays(lastConfirmedAt, now);
  if (ageDays === undefined) return 'last_confirmed: unknown age_days=unknown age_label="unknown"';
  return `last_confirmed: ${new Date(lastConfirmedAt).toISOString()} age_days=${ageDays} age_label="${formatMemoryAgeLabel(ageDays)}"`;
}

export function formatMemoryVerificationCaveat(
  freshness: MemoryRecordStaleness,
  lastConfirmedAt: number,
  now: number,
): string | undefined {
  if (freshness === 'fresh') return undefined;

  const ageLabel = formatMemoryAgeLabel(calculateMemoryAgeDays(lastConfirmedAt, now));
  const ageText = ageLabel === 'unknown' ? 'memory age is unknown' : `memory is ${ageLabel}`;
  if (freshness === 'invalidated') {
    return `verification_caveat: ${ageText} and marked invalidated; do not rely on it unless re-confirmed.`;
  }
  return `verification_caveat: ${ageText} and marked ${freshness}; verify against current workspace/source before relying on it.`;
}

function summarizeText(text: string, maxChars: number): string {
  const compact = redactMemorySecrets(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trimEnd()}...`;
}

function compactMemoryText(text: string, maxChars: number): string {
  const rawLines = redactMemorySecrets(String(text || ''))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim());
  const compactLines: string[] = [];
  let lastWasBlank = true;
  for (const line of rawLines) {
    if (!line) {
      if (lastWasBlank || compactLines.length === 0) continue;
      compactLines.push('');
      lastWasBlank = true;
      continue;
    }
    compactLines.push(line);
    lastWasBlank = false;
  }
  while (compactLines.length > 0 && compactLines[compactLines.length - 1] === '') {
    compactLines.pop();
  }

  const compact = compactLines.join('\n').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trimEnd()}...`;
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function startOfUtcIsoWeek(timestamp: number): number {
  const dayStart = startOfUtcDay(timestamp);
  const utcDay = new Date(dayStart).getUTCDay();
  const daysSinceMonday = (utcDay + 6) % 7;
  return dayStart - daysSinceMonday * DAY_MS;
}

function normalizeRelativeDurableDates(text: string, anchorTimestamp: number): string {
  const anchor = Number.isFinite(anchorTimestamp) && anchorTimestamp > 0 ? anchorTimestamp : Date.now();
  const dayStart = startOfUtcDay(anchor);
  const previousIsoWeekStart = startOfUtcIsoWeek(anchor) - 7 * DAY_MS;
  const nextIsoWeekStart = startOfUtcIsoWeek(anchor) + 7 * DAY_MS;
  return String(text || '')
    .replace(/\blast\s+week\b/gi, `the week of ${formatUtcDate(previousIsoWeekStart)}`)
    .replace(/\bnext\s+week\b/gi, `the week of ${formatUtcDate(nextIsoWeekStart)}`)
    .replace(/\byesterday\b/gi, formatUtcDate(dayStart - DAY_MS))
    .replace(/\btomorrow\b/gi, formatUtcDate(dayStart + DAY_MS));
}

function summarizeHeading(text: string): string {
  const compact = summarizeText(text, 88);
  if (!compact) return 'Untitled memory';
  return compact;
}

type RenderedMemoryFields = {
  guidance: string;
  hook: string;
  why?: string;
  howToApply?: string;
  howToApplySource?: 'explicit' | 'default';
};

function strippedRecordDetailLine(text: string): string {
  return String(text || '')
    .replace(/^(User intents|Assistant outcomes|Files touched|Tools used):\s*/i, '')
    .replace(/^(User|Assistant|Error|Warning|Plan):\s*/i, '')
    .trim();
}

function scoreRecordEvidenceLine(text: string): number {
  const line = String(text || '').trim();
  if (!line) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (/https?:\/\//i.test(line)) score += 10;
  if (/\b[A-Za-z][A-Za-z0-9_-]*-[0-9]{2,}\b/.test(line)) score += 9;
  if (/(?:^|\s)(?:~\/|\.\.?\/|\/)[^\s]+/.test(line) || /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\b/.test(line)) score += 7;
  if (/\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+\b/.test(line)) score += 6;
  if (/\b(use|open|check|see|visit|follow|ticket|path|url|file|files|symbol|project|tracker|docs?)\b/i.test(line)) score += 1;
  if (/\?$/.test(line)) score -= 2;
  score += Math.min(line.length, 160) / 160;

  return score;
}

export function renderSummaryRecordText(record: Pick<MemoryRecord, 'title' | 'text' | 'filesTouched' | 'toolsUsed'>): {
  summary: string;
  details: string[];
} {
  const title = summarizeText(String(record.title || '').trim(), 96);
  const text = compactMemoryText(String(record.text || ''), MAX_DURABLE_TEXT_CHARS);
  const candidateMatch = text.match(/Structured memory candidates:\s*([\s\S]*)$/i);
  const candidateText = candidateMatch?.[1]?.trim() || '';
  const firstCandidate = candidateText
    .split(/\s*\|\s*/)
    .map((part) => part.replace(/^[a-z_]+\s*=\s*/i, '').trim())
    .find(Boolean);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const firstNonSessionLine = lines.find((line) => !/^Session\s+".*"\s+updated\s+at\s+/i.test(line));
  const isWrapperOnlyLine = /^(User intents|Assistant outcomes|Files touched|Tools used):\s*/i.test(
    String(firstNonSessionLine || ''),
  );
  const cleanedNonSessionLine = strippedRecordDetailLine(firstNonSessionLine || '');
  const summary = firstCandidate || (!isWrapperOnlyLine ? cleanedNonSessionLine : '') || title || summarizeText(text, 118) || 'Session summary';

  const details: string[] = [];
  if (title && title.toLowerCase() !== summary.toLowerCase()) {
    details.push(`summary_title: ${title}`);
  }
  if (record.filesTouched.length > 0) {
    details.push(`summary_files: ${record.filesTouched.join(', ')}`);
  }
  if (record.toolsUsed.length > 0) {
    details.push(`summary_tools: ${record.toolsUsed.join(', ')}`);
  }

  return { summary, details };
}

export function renderRawRecordEvidence(
  record: Pick<MemoryRecord, 'title' | 'text' | 'filesTouched' | 'toolsUsed'>,
  options?: { compact?: boolean },
): {
  evidence: string;
  details: string[];
} {
  const title = summarizeText(String(record.title || '').trim(), 96);
  const text = compactMemoryText(String(record.text || ''), MAX_DURABLE_TEXT_CHARS);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => strippedRecordDetailLine(line))
    .filter(Boolean);

  const evidence = [...lines]
    .sort((a, b) => scoreRecordEvidenceLine(b) - scoreRecordEvidenceLine(a))
    .find(Boolean) || title || summarizeText(text, 118) || 'Transcript-backed evidence';

  const details: string[] = [];
  if (!options?.compact) {
    if (title && title.toLowerCase() !== evidence.toLowerCase()) {
      details.push(`evidence_title: ${title}`);
    }
    if (record.filesTouched.length > 0) {
      details.push(`evidence_files: ${record.filesTouched.join(', ')}`);
    }
    if (record.toolsUsed.length > 0) {
      details.push(`evidence_tools: ${record.toolsUsed.join(', ')}`);
    }
  }

  return { evidence, details };
}

export function shouldSurfaceSelectiveHowToApply(
  entry: ConsolidatedMemoryEntry,
  fields: { howToApply?: string; howToApplySource?: 'explicit' | 'default' },
): boolean {
  if (!fields.howToApply) return false;
  return fields.howToApplySource === 'explicit' || entry.category === 'reference';
}

function queryLooksLikeCurrentStateIntent(query: string): boolean {
  return /\b(?:current|currently|latest|now|still|recent|recently|up[- ]to[- ]date|right now|today|as of)\b/i.test(query);
}

export function selectiveMemoryPrimaryLabel(
  entry: ConsolidatedMemoryEntry,
  fallback: 'fact' | 'guidance',
  query?: string,
): 'fact' | 'guidance' | 'pointer' | 'prior' {
  if (entry.category === 'reference') return 'pointer';
  if (
    (entry.category === 'project' || entry.category === 'procedure') &&
    (entry.freshness === 'aging' || entry.freshness === 'stale' || (entry.category === 'project' && queryLooksLikeCurrentStateIntent(query || '')))
  ) {
    return 'prior';
  }
  return fallback;
}

export function selectiveMemoryFieldPriority(query: string): Array<'why' | 'howToApply'> {
  const normalized = String(query || '').trim();
  if (!normalized) return [];

  const whyMatch = normalized.match(/\b(?:why|reason|reasons|because|rationale|motivat(?:ion|e|ed|ing)|context)\b/i);
  const howMatch = normalized.match(
    /\b(?:how should|how do|how can|how to|apply|apply this|when should|when to|where should|default|follow|handle)\b/i,
  );
  const whyIndex = whyMatch?.index;
  const howIndex = howMatch?.index;

  if (typeof whyIndex === 'number' && typeof howIndex === 'number') {
    return whyIndex <= howIndex ? ['why', 'howToApply'] : ['howToApply', 'why'];
  }
  if (typeof whyIndex === 'number') return ['why'];
  if (typeof howIndex === 'number') return ['howToApply'];
  return [];
}

function compactPriorContextAllowsHowToApply(query: string): boolean {
  return /\b(?:how should|how do|how can|how to|apply|apply this|when should|when to|default|follow|handle)\b/i.test(
    query,
  );
}

export function renderSelectiveMemorySurfaceLines(
  entry: ConsolidatedMemoryEntry,
  options?: {
    fallbackLabel?: 'fact' | 'guidance';
    query?: string;
    compactPriorContext?: boolean;
  },
): string[] {
  const fields = renderMemoryFields(entry);
  const query = options?.query || '';
  const primaryLabel = selectiveMemoryPrimaryLabel(entry, options?.fallbackLabel ?? 'guidance', query);
  const primaryLine = `${primaryLabel}: ${fields.guidance || compactMemoryText(entry.text, MAX_DURABLE_TEXT_CHARS)}`;
  const whyLine = fields.why ? `why: ${fields.why}` : undefined;
  const howToApplyLine = shouldSurfaceSelectiveHowToApply(entry, fields) ? `how_to_apply: ${fields.howToApply}` : undefined;
  const compactPriorContext = !!options?.compactPriorContext && primaryLabel === 'prior';
  const priority = selectiveMemoryFieldPriority(query).filter((field) => {
    if (field !== 'howToApply' || !compactPriorContext) return true;
    return compactPriorContextAllowsHowToApply(query);
  });

  if (priority.length === 0) {
    if (compactPriorContext) return [primaryLine];
    return [primaryLine, whyLine, howToApplyLine].filter((line): line is string => !!line);
  }

  const prioritized: string[] = [];
  for (const field of priority) {
    if (field === 'why' && whyLine) prioritized.push(whyLine);
    if (field === 'howToApply' && howToApplyLine) prioritized.push(howToApplyLine);
  }

  if (prioritized.length === 0) {
    if (compactPriorContext) return [primaryLine];
    return [primaryLine, whyLine, howToApplyLine].filter((line): line is string => !!line);
  }

  return [primaryLine, ...prioritized];
}

function trimTrailingClausePunctuation(text: string): string {
  return String(text || '')
    .replace(/[\s,;:–—-]+$/g, '')
    .trim();
}

function cleanStructuredFieldValue(text: string): string {
  return String(text || '')
    .replace(/^[\s:;,.–—-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStructuredFieldLabel(label: string): string {
  return String(label || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function explicitFieldSlot(label: string): 'guidance' | 'why' | 'howToApply' | undefined {
  const normalized = normalizeStructuredFieldLabel(label);
  if (!normalized) return undefined;
  if (normalized === 'guidance' || normalized === 'fact' || normalized === 'rule') {
    return 'guidance';
  }
  if (normalized === 'why' || normalized === 'reason') {
    return 'why';
  }
  if (
    normalized === 'how to apply' ||
    normalized === 'how to use' ||
    normalized === 'when to use' ||
    normalized === 'apply when'
  ) {
    return 'howToApply';
  }
  return undefined;
}

function shouldIgnoreStructuredFieldLabel(label: string): boolean {
  const normalized = normalizeStructuredFieldLabel(label);
  return [
    'confidence',
    'evidence',
    'freshness',
    'last confirmed',
    'durable key',
    'maintenance',
    'rollout summaries',
    'files',
    'tools',
    'sessions',
    'source',
    'session id',
    'chunk id',
    'updated at',
    'score breakdown',
    'maintenance hint',
    'staleness',
  ].includes(normalized);
}

function parseExplicitMemoryFields(text: string): {
  guidance: string;
  why?: string;
  howToApply?: string;
} | undefined {
  const normalized = compactMemoryText(
    String(text || '').replace(
      /\*\*\s*(guidance|fact|rule|why|reason|how(?:[_ -]+to(?:[_ -]+apply|[_ -]+use))|when(?:[_ -]+to(?:[_ -]+use))|apply(?:[_ -]+when))\s*:\s*\*\*/gi,
      '$1:',
    ),
    MAX_DURABLE_TEXT_CHARS,
  );
  if (!normalized) return undefined;

  const leading: string[] = [];
  const buckets: Record<'guidance' | 'why' | 'howToApply', string[]> = {
    guidance: [],
    why: [],
    howToApply: [],
  };
  let currentField: keyof typeof buckets | undefined;
  let sawStructuredField = false;

  for (const rawLine of normalized.split('\n')) {
    const line = String(rawLine || '').trim();
    if (!line) continue;

    const normalizedLine = line.replace(/^[-*]\s+/, '').trim();
    const fieldMatch = normalizedLine.match(/^([A-Za-z][A-Za-z0-9_ -]{0,48})\s*:\s*(.*)$/);
    if (fieldMatch) {
      const fieldLabel = String(fieldMatch[1] || '');
      const slot = explicitFieldSlot(fieldLabel);
      if (slot) {
        sawStructuredField = true;
        currentField = slot;
        const value = cleanStructuredFieldValue(fieldMatch[2] || '');
        if (value) {
          buckets[slot].push(value);
        }
        continue;
      }
      if (shouldIgnoreStructuredFieldLabel(fieldLabel)) {
        currentField = undefined;
        continue;
      }
    }

    if (currentField) {
      buckets[currentField].push(line);
      continue;
    }
    if (!sawStructuredField) {
      leading.push(line);
    }
  }

  if (sawStructuredField) {
    const guidance = cleanStructuredFieldValue([...leading, ...buckets.guidance].join(' '));
    const why = cleanStructuredFieldValue(buckets.why.join(' '));
    const howToApply = cleanStructuredFieldValue(buckets.howToApply.join(' '));
    if (!guidance && !why && !howToApply) return undefined;
    return {
      guidance: guidance || normalized,
      ...(why ? { why } : {}),
      ...(howToApply ? { howToApply } : {}),
    };
  }

  const markerRegex = /\b(why|reason|how to apply|how to use|when to use|apply when)\s*:/gi;
  const markers = [...normalized.matchAll(markerRegex)].map((match) => ({
    label: String(match[1] || '').toLowerCase(),
    index: match.index ?? 0,
    raw: match[0],
  }));
  if (markers.length === 0) return undefined;

  const firstMarker = markers[0];
  if (!firstMarker) return undefined;

  const guidance = cleanStructuredFieldValue(normalized.slice(0, firstMarker.index));
  let why: string | undefined;
  let howToApply: string | undefined;

  for (const [index, marker] of markers.entries()) {
    const nextMarker = markers[index + 1];
    const value = cleanStructuredFieldValue(
      normalized.slice(marker.index + marker.raw.length, nextMarker?.index ?? normalized.length),
    );
    if (!value) continue;
    if ((marker.label === 'why' || marker.label === 'reason') && !why) {
      why = value;
      continue;
    }
    if (!howToApply) {
      howToApply = value;
    }
  }

  if (!guidance && !why && !howToApply) return undefined;
  return {
    guidance: guidance || normalized,
    ...(why ? { why } : {}),
    ...(howToApply ? { howToApply } : {}),
  };
}

function defaultHowToApply(entry: ConsolidatedMemoryEntry): string | undefined {
  switch (entry.category) {
    case 'user':
      return 'Tailor explanations, defaults, and level of detail to this user signal in future similar work.';
    case 'feedback':
      return 'Apply this by default on similar tasks in this workspace unless newer guidance overrides it.';
    case 'project':
      return 'Use this as planning context for related work, and verify time-sensitive details before acting on it.';
    case 'reference':
      return 'Use this as a pointer to the relevant external context, then open the referenced system or document for current details.';
    case 'procedure':
      return 'Reuse this workflow when the task shape matches and the surrounding repo context looks similar.';
    case 'failure_shield':
      return 'Use this as a warning/checklist when similar symptoms or failure patterns appear again.';
    default:
      return undefined;
  }
}

export function renderMemoryFields(entry: ConsolidatedMemoryEntry): RenderedMemoryFields {
  const text = compactMemoryText(entry.text, MAX_DURABLE_TEXT_CHARS);
  if (!text) {
    return {
      guidance: '',
      hook: '',
    };
  }

  const explicit = parseExplicitMemoryFields(text);
  if (explicit) {
    const guidance = explicit.guidance || text;
    const hasExplicitHowToApply = !!explicit.howToApply;
    const howToApply = explicit.howToApply || defaultHowToApply(entry);
    return {
      guidance,
      hook: summarizeText(guidance, 118),
      ...(explicit.why ? { why: explicit.why } : {}),
      ...(howToApply ? { howToApply } : {}),
      ...(howToApply ? { howToApplySource: hasExplicitHowToApply ? 'explicit' as const : 'default' as const } : {}),
    };
  }

  let guidance = text;
  let why: string | undefined;

  const causalMarkers = [' because ', ' due to ', ' since ', ' driven by ', ' to avoid ', ' to prevent '];
  const lower = text.toLowerCase();
  let splitIndex = -1;
  for (const marker of causalMarkers) {
    const idx = lower.indexOf(marker);
    if (idx > 0 && (splitIndex < 0 || idx < splitIndex)) {
      splitIndex = idx;
    }
  }

  if (splitIndex > 0) {
    guidance = trimTrailingClausePunctuation(text.slice(0, splitIndex));
    why = text.slice(splitIndex).trim();
  }

  const normalizedGuidance = guidance || text;
  const howToApply = defaultHowToApply(entry);
  return {
    guidance: normalizedGuidance,
    hook: summarizeText(normalizedGuidance, 118),
    ...(why ? { why } : {}),
    ...(howToApply ? { howToApply } : {}),
    ...(howToApply ? { howToApplySource: 'default' as const } : {}),
  };
}

function stalenessPriority(value: MemoryRecordStaleness): number {
  switch (value) {
    case 'invalidated':
      return 4;
    case 'stale':
      return 3;
    case 'aging':
      return 2;
    case 'fresh':
    default:
      return 1;
  }
}

function mergeStaleness(a: MemoryRecordStaleness, b: MemoryRecordStaleness): MemoryRecordStaleness {
  return stalenessPriority(a) >= stalenessPriority(b) ? a : b;
}

function deriveFreshness(timestamp: number, now: number): MemoryRecordStaleness {
  const ageDays = Math.max(0, (now - timestamp) / DAY_MS);
  if (ageDays >= 60) return 'stale';
  if (ageDays >= 21) return 'aging';
  return 'fresh';
}

function normalizeSearchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[`"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeReference(text: string): boolean {
  return /(https?:\/\/|\b(linear|jira|slack|grafana|notion|dashboard|runbook|wiki|playbook|oncall|doc|docs)\b)/i.test(
    text,
  );
}

function looksLikeProjectContext(text: string): boolean {
  return /\b(release|deadline|freeze|roadmap|incident|migration|compliance|legal|stakeholder|launch|cutover|rollout)\b/i.test(
    text,
  );
}

function looksLikeWorkflowFeedback(text: string): boolean {
  return /\b(?:tests?|mock(?:s|ed|ing)?|database|db|pull request|pr|refactor|workflow|approach|summar(?:y|ies|ize|izing)|response|responses|diff)\b/i.test(
    text,
  );
}

function looksLikeDerivableCodeFact(text: string): boolean {
  return /\b(?:packages|src|lib|app|tests?)\/[A-Za-z0-9_./-]+\b|\b[A-Z][A-Za-z0-9_]+\.[A-Za-z0-9_]+\b|\b(file|function|class|module|symbol|path)\b|\b\w+\.(?:ts|tsx|js|jsx|json|md|py|go|rs|java|kt|yaml|yml|toml)\b/i.test(
    text,
  );
}

function looksTransient(text: string): boolean {
  return /\b(this snippet|just pasted|current turn|current session|today only|right now|for this run only)\b/i.test(
    text,
  );
}

function deriveCategory(candidate: Stage1Output['structuredMemories'][number]): DurableMemoryCategory {
  if (candidate.kind === 'preference') {
    return candidate.scope === 'user' ? 'user' : 'feedback';
  }
  if (candidate.kind === 'failed_attempt') {
    return 'failure_shield';
  }
  if (candidate.kind === 'procedure') {
    return looksLikeReference(candidate.text) ? 'reference' : 'procedure';
  }
  if (candidate.kind === 'constraint') {
    if (looksLikeReference(candidate.text)) return 'reference';
    if (looksLikeWorkflowFeedback(candidate.text)) return 'feedback';
    return looksLikeProjectContext(candidate.text) ? 'project' : 'feedback';
  }
  if (candidate.kind === 'decision') {
    if (looksLikeReference(candidate.text)) return 'reference';
    return 'project';
  }
  return 'project';
}

function promotionScore(entry: ConsolidatedMemoryEntry): number {
  const categoryWeight: Record<DurableMemoryCategory, number> = {
    user: 2.4,
    feedback: 2.2,
    project: 1.8,
    reference: 1.4,
    procedure: 1.6,
    failure_shield: 1.7,
  };
  const freshnessWeight =
    entry.freshness === 'fresh' ? 1.2 : entry.freshness === 'aging' ? 0.4 : entry.freshness === 'stale' ? -1.6 : -5;
  return categoryWeight[entry.category] + entry.confidence * 4 + Math.min(2.5, Math.log2(entry.evidenceCount + 1)) + freshnessWeight;
}

function shouldPromote(entry: ConsolidatedMemoryEntry): boolean {
  if (!entry.text.trim()) return false;
  if (entry.freshness === 'invalidated') return false;
  if (looksTransient(entry.text)) return false;
  if (entry.text.trim().length < 18) return false;

  if (entry.category === 'procedure' && looksLikeDerivableCodeFact(entry.text)) {
    return false;
  }

  if (
    (entry.category === 'project' || entry.category === 'feedback') &&
    looksLikeDerivableCodeFact(entry.text) &&
    entry.evidenceCount < 2 &&
    !entry.sources.includes('user')
  ) {
    return false;
  }

  if (entry.category === 'failure_shield' && entry.evidenceCount < 2 && entry.confidence < 0.9) {
    return false;
  }

  if (entry.freshness === 'stale' && entry.category !== 'user' && entry.category !== 'feedback') {
    return false;
  }

  return true;
}

function chooseBetterTextCandidate(current: TextCandidate | undefined, next: TextCandidate): TextCandidate {
  if (!current) return next;
  if (next.updatedAt !== current.updatedAt) return next.updatedAt > current.updatedAt ? next : current;
  if (next.freshness !== current.freshness) {
    return stalenessPriority(next.freshness) <= stalenessPriority(current.freshness) ? next : current;
  }
  if (next.confidence !== current.confidence) return next.confidence > current.confidence ? next : current;
  if (next.evidenceCount !== current.evidenceCount) return next.evidenceCount > current.evidenceCount ? next : current;
  if (next.source !== current.source) return next.source === 'support' ? next : current;
  if (next.text.length !== current.text.length) return next.text.length > current.text.length ? next : current;
  return current;
}

function chooseEntryText(params: {
  current?: TextCandidate;
  candidate: TextCandidate;
  support?: TextCandidate;
}): TextCandidate {
  let best = chooseBetterTextCandidate(params.current, params.candidate);
  if (!params.support?.text) return best;

  const supportIsMaintained = params.support.updatedAt > params.candidate.updatedAt;
  const supportIsMoreAuthoritative =
    params.support.confidence >= params.candidate.confidence && params.support.evidenceCount >= params.candidate.evidenceCount;
  const supportLooksStable = params.support.freshness !== 'invalidated' && params.support.text.length >= Math.max(18, params.candidate.text.length - 24);

  if (supportLooksStable && (supportIsMaintained || supportIsMoreAuthoritative)) {
    best = chooseBetterTextCandidate(best, params.support);
  }

  return best;
}

function buildRecordSupportByKey(records: MemoryRecord[]): Map<string, RecordSupport> {
  const byKey = new Map<string, RecordSupport>();
  for (const record of records) {
    const key = String(record.memoryKey || '').trim();
    if (!key) continue;
    const existing = byKey.get(key);
    const recordTextAnchor = Math.max(record.lastConfirmedAt, record.sourceUpdatedAt);
    const text = compactMemoryText(normalizeRelativeDurableDates(record.text, recordTextAnchor), MAX_DURABLE_TEXT_CHARS);
    const nextTextCandidate =
      text && record.staleness !== 'invalidated'
        ? chooseBetterTextCandidate(
            existing?.bestText
              ? {
                  text: existing.bestText,
                  updatedAt: existing.bestTextUpdatedAt ?? existing.lastConfirmedAt,
                  confidence: existing.bestTextConfidence ?? 0,
                  evidenceCount: existing.bestTextEvidenceCount ?? 1,
                  freshness: existing.bestTextFreshness ?? existing.freshness,
                  source: 'support',
                }
              : undefined,
            {
              text,
              updatedAt: Math.max(record.lastConfirmedAt, record.sourceUpdatedAt),
              confidence: record.confidence,
              evidenceCount: Math.max(1, record.evidenceCount || 1),
              freshness: record.staleness,
              source: 'support',
            },
          )
        : existing?.bestText
          ? {
              text: existing.bestText,
              updatedAt: existing.bestTextUpdatedAt ?? existing.lastConfirmedAt,
              confidence: existing.bestTextConfidence ?? 0,
              evidenceCount: existing.bestTextEvidenceCount ?? 1,
              freshness: existing.bestTextFreshness ?? existing.freshness,
              source: 'support',
            }
          : undefined;

    const next: RecordSupport = existing
      ? {
          lastConfirmedAt: Math.max(existing.lastConfirmedAt, record.lastConfirmedAt),
          freshness:
            record.lastConfirmedAt >= existing.lastConfirmedAt
              ? record.staleness
              : mergeStaleness(existing.freshness, record.staleness),
          filesTouched: uniqueLimited([...existing.filesTouched, ...record.filesTouched], 12),
          toolsUsed: uniqueLimited([...existing.toolsUsed, ...record.toolsUsed], 12),
          ...(nextTextCandidate
            ? {
                bestText: nextTextCandidate.text,
                bestTextConfidence: nextTextCandidate.confidence,
                bestTextEvidenceCount: nextTextCandidate.evidenceCount,
                bestTextUpdatedAt: nextTextCandidate.updatedAt,
                bestTextFreshness: nextTextCandidate.freshness,
              }
            : {}),
        }
      : {
          lastConfirmedAt: record.lastConfirmedAt,
          freshness: record.staleness,
          filesTouched: uniqueLimited(record.filesTouched, 12),
          toolsUsed: uniqueLimited(record.toolsUsed, 12),
          ...(nextTextCandidate
            ? {
                bestText: nextTextCandidate.text,
                bestTextConfidence: nextTextCandidate.confidence,
                bestTextEvidenceCount: nextTextCandidate.evidenceCount,
                bestTextUpdatedAt: nextTextCandidate.updatedAt,
                bestTextFreshness: nextTextCandidate.freshness,
              }
            : {}),
        };
    byKey.set(key, next);
  }
  return byKey;
}

export function buildConsolidatedMemoryEntries(params: {
  outputs: Stage1Output[];
  records: MemoryRecord[];
  now?: number;
}): ConsolidatedMemoryEntry[] {
  const now = params.now ?? Date.now();
  const recordSupportByKey = buildRecordSupportByKey(params.records);
  const entriesByKey = new Map<string, ConsolidatedEntryAccumulator>();

  for (const output of params.outputs) {
    for (const candidate of output.structuredMemories) {
      const text = compactMemoryText(
        normalizeRelativeDurableDates(candidate.text, output.sourceUpdatedAt),
        MAX_DURABLE_TEXT_CHARS,
      );

      if (!text) continue;
      const key = redactMemorySecrets(String(candidate.memoryKey || `${candidate.kind}:${normalizeSearchText(text)}`)).trim();
      if (!key) continue;
      const category = deriveCategory(candidate);
      const support = recordSupportByKey.get(candidate.memoryKey || key);
      const candidateFreshness = deriveFreshness(output.sourceUpdatedAt, now);
      const freshness = support ? mergeStaleness(candidateFreshness, support.freshness) : candidateFreshness;
      const lastConfirmedAt = Math.max(output.sourceUpdatedAt, support?.lastConfirmedAt ?? 0);
      const existing = entriesByKey.get(key);
      const candidateText: TextCandidate = {
        text,
        updatedAt: output.sourceUpdatedAt,
        confidence: candidate.confidence,
        evidenceCount: Math.max(1, candidate.evidenceCount || 1),
        freshness: candidateFreshness,
        source: 'candidate',
      };
      const supportText = support?.bestText
        ? {
            text: support.bestText,
            updatedAt: support.bestTextUpdatedAt ?? support.lastConfirmedAt,
            confidence: support.bestTextConfidence ?? candidate.confidence,
            evidenceCount: Math.max(1, support.bestTextEvidenceCount ?? candidate.evidenceCount ?? 1),
            freshness: support.bestTextFreshness ?? support.freshness,
            source: 'support' as const,
          }
        : undefined;
      const chosenText = chooseEntryText({
        current: existing
          ? {
              text: existing.text,
              updatedAt: existing.textUpdatedAt,
              confidence: existing.textConfidence,
              evidenceCount: existing.textEvidenceCount,
              freshness: existing.textFreshness,
              source: 'support',
            }
          : undefined,
        candidate: candidateText,
        support: supportText,
      });
      const baseEvidence = Math.max(1, candidate.evidenceCount || 1);
      const aggregatedEvidence = baseEvidence + Math.max(0, support?.bestTextEvidenceCount ?? 0);

      const next: ConsolidatedEntryAccumulator = existing
        ? {
            ...existing,
            text: chosenText.text,
            confidence: Math.max(existing.confidence, candidate.confidence, support?.bestTextConfidence ?? 0),
            evidenceCount: Math.max(existing.evidenceCount + baseEvidence, aggregatedEvidence),
            freshness: mergeStaleness(existing.freshness, freshness),
            lastConfirmedAt: Math.max(existing.lastConfirmedAt, lastConfirmedAt),
            sessionIds: uniqueLimited([...existing.sessionIds, output.sessionId], 12),
            titles: uniqueLimited([...existing.titles, output.title], 8),
            rolloutFiles: uniqueLimited([...existing.rolloutFiles, output.rolloutFile], 8),
            filesTouched: uniqueLimited(
              [...existing.filesTouched, ...output.filesTouched, ...(support?.filesTouched || [])],
              12,
            ),
            toolsUsed: uniqueLimited([...existing.toolsUsed, ...output.toolsUsed, ...(support?.toolsUsed || [])], 12),
            sources: uniqueLimited([...existing.sources, candidate.source], 4),
            textUpdatedAt: chosenText.updatedAt,
            textConfidence: chosenText.confidence,
            textEvidenceCount: chosenText.evidenceCount,
            textFreshness: chosenText.freshness,
          }
        : {
            key,
            text: chosenText.text,
            category,
            scope: candidate.scope,
            confidence: Math.max(candidate.confidence, support?.bestTextConfidence ?? 0),
            evidenceCount: Math.max(baseEvidence, aggregatedEvidence),
            freshness,
            lastConfirmedAt,
            sessionIds: [output.sessionId],
            titles: [output.title],
            rolloutFiles: [output.rolloutFile],
            filesTouched: uniqueLimited([...output.filesTouched, ...(support?.filesTouched || [])], 12),
            toolsUsed: uniqueLimited([...output.toolsUsed, ...(support?.toolsUsed || [])], 12),
            sources: [candidate.source],
            textUpdatedAt: chosenText.updatedAt,
            textConfidence: chosenText.confidence,
            textEvidenceCount: chosenText.evidenceCount,
            textFreshness: chosenText.freshness,
          };

      entriesByKey.set(key, next);
    }
  }

  return [...entriesByKey.values()]
    .filter((entry) => shouldPromote(entry))
    .sort((a, b) => promotionScore(b) - promotionScore(a) || b.lastConfirmedAt - a.lastConfirmedAt || a.text.localeCompare(b.text))
    .map(({ textUpdatedAt: _textUpdatedAt, textConfidence: _textConfidence, textEvidenceCount: _textEvidenceCount, textFreshness: _textFreshness, ...entry }) => entry);
}

function entriesForCategory(entries: ConsolidatedMemoryEntry[], category: DurableMemoryCategory, limit: number): ConsolidatedMemoryEntry[] {
  return entries.filter((entry) => entry.category === category).slice(0, limit);
}

function appendSummarySection(
  lines: string[],
  title: string,
  entries: ConsolidatedMemoryEntry[],
  topicPath: string,
): void {
  if (entries.length === 0) return;
  lines.push(`## ${title}`);
  lines.push(`- open: ${topicPath}`);
  for (const entry of entries) {
    const maintenanceTag = entry.key ? `key=${entry.key}` : 'key=(none)';
    const fields = renderMemoryFields(entry);
    lines.push(`- ${maintenanceTag} — ${fields.hook}`);
  }
  lines.push('');
}

function appendMemoryIndexSection(
  lines: string[],
  title: string,
  entries: ConsolidatedMemoryEntry[],
  topicPath: string,
): void {
  if (entries.length === 0) return;
  lines.push(`## ${title}`);
  lines.push(`- details: ${topicPath}`);
  for (const entry of entries) {
    const fields = renderMemoryFields(entry);
    const maintenanceTag = entry.key ? `key=${summarizeText(entry.key, 72)}` : 'key=(none)';
    lines.push(`- ${maintenanceTag} | ${summarizeText(fields.hook, 150)}`);
  }
  lines.push('');
}

function appendMemorySection(lines: string[], title: string, entries: ConsolidatedMemoryEntry[]): void {
  if (entries.length === 0) return;
  lines.push(`## ${title}`);
  lines.push('');
  for (const [index, entry] of entries.entries()) {
    const fields = renderMemoryFields(entry);
    lines.push(`### ${index + 1}. ${summarizeHeading(fields.guidance || entry.text)}`);
    lines.push(`- guidance: ${fields.guidance}`);
    if (fields.why) {
      lines.push(`- why: ${fields.why}`);
    }
    if (fields.howToApply) {
      lines.push(`- how_to_apply: ${fields.howToApply}`);
    }
    lines.push(`- confidence: ${entry.confidence.toFixed(2)}`);
    lines.push(`- evidence: ${entry.evidenceCount}`);
    lines.push(`- freshness: ${entry.freshness}`);
    lines.push(`- last_confirmed: ${new Date(entry.lastConfirmedAt).toISOString()}`);
    if (entry.sessionIds.length > 0) {
      lines.push(`- sessions: ${entry.sessionIds.join(', ')}`);
    }
    if (entry.key) {
      lines.push(`- durable_key: ${entry.key}`);
      lines.push(`- maintenance: maintain_memory action=<invalidate|confirm|supersede> recordId=<supporting-record-id-from-get_memory-search> durableKey=${entry.key}`);
    }
    if (entry.rolloutFiles.length > 0) {
      lines.push('- rollout_summaries:');
      for (const file of entry.rolloutFiles) {
        lines.push(`  - rollout_summaries/${file}`);
      }
    }
    if (entry.filesTouched.length > 0) {
      lines.push(`- files: ${entry.filesTouched.join(', ')}`);
    }
    if (entry.toolsUsed.length > 0) {
      lines.push(`- tools: ${entry.toolsUsed.join(', ')}`);
    }
    lines.push('');
  }
}

function buildMemoryTopicFile(category: DurableMemoryCategory, entries: ConsolidatedMemoryEntry[]): string {
  const title = CATEGORY_TITLES[category];
  const lines = [
    `# Memory Topic: ${title}`,
    '',
    'Generated automatically from persisted LingYun sessions.',
    'This file contains detailed durable entries; use MEMORY.md as the compact index.',
    '',
  ];
  appendMemorySection(lines, title, entries);
  return lines.join('\n');
}

export function buildConsolidatedMemoryArtifacts(params: {
  outputs: Stage1Output[];
  records: MemoryRecord[];
  now?: number;
}): ConsolidatedMemoryArtifacts {
  const now = params.now ?? Date.now();
  const entries = buildConsolidatedMemoryEntries({ outputs: params.outputs, records: params.records, now });

  const memoryLines: string[] = [
    '# MEMORY',
    '',
    'Generated automatically from persisted LingYun sessions.',
    'This file is rewritten by the memory pipeline.',
    'Compact index only: detailed durable entries live in `memory_topics/*.md`.',
    '',
  ];

  const summaryLines: string[] = [
    '# Memory Summary',
    '',
    'Generated automatically. Read this first, then open MEMORY.md or specific rollout summaries only when needed.',
    '',
  ];

  if (entries.length === 0) {
    memoryLines.push('- No durable memories yet. Run `LingYun: Update Memories` after a few sessions.');
    memoryLines.push('');
    summaryLines.push('- No memory summary yet.');
    summaryLines.push('');
    return {
      memoryFile: memoryLines.join('\n'),
      memorySummary: summaryLines.join('\n'),
      topicFiles: {},
      entries,
    };
  }

  for (const category of CATEGORY_ORDER) {
    appendSummarySection(
      summaryLines,
      CATEGORY_TITLES[category],
      entriesForCategory(entries, category, SUMMARY_SECTION_LIMITS[category]),
      memoryTopicPath(category),
    );
  }

  summaryLines.push('## Progressive Read Path');
  summaryLines.push('- Step 1: Read this file (`memory_summary.md`).');
  summaryLines.push('- Step 2: Read `MEMORY.md` for the compact durable-memory index.');
  summaryLines.push('- Step 3: Open the relevant `memory_topics/*.md` file only when the index hook is relevant.');
  summaryLines.push('- Step 4: Open a rollout summary only when you need session-level evidence.');
  summaryLines.push('');
  summaryLines.push('## Recent Rollout Pointers');
  for (const output of params.outputs.slice(0, 8)) {
    summaryLines.push(`- ${new Date(output.sourceUpdatedAt).toISOString()} | ${output.title} | rollout_summaries/${output.rolloutFile}`);
  }
  summaryLines.push('');

  const topicFiles: Record<string, string> = {};
  for (const category of CATEGORY_ORDER) {
    const categoryEntries = entriesForCategory(entries, category, MEMORY_SECTION_LIMITS[category]);
    appendMemoryIndexSection(
      memoryLines,
      CATEGORY_TITLES[category],
      categoryEntries,
      memoryTopicPath(category),
    );
    if (categoryEntries.length > 0) {
      topicFiles[TOPIC_FILE_BY_CATEGORY[category]] = buildMemoryTopicFile(category, categoryEntries);
    }
  }

  memoryLines.push('## Recent Sessions');
  memoryLines.push('Use rollout summaries for detailed session-level evidence when a durable memory entry is not enough.');
  memoryLines.push('');
  for (const output of params.outputs.slice(0, 12)) {
    memoryLines.push(`- ${new Date(output.sourceUpdatedAt).toISOString()} | ${output.title} | rollout_summaries/${output.rolloutFile}`);
  }
  memoryLines.push('');

  return {
    memoryFile: memoryLines.join('\n'),
    memorySummary: summaryLines.join('\n'),
    topicFiles,
    entries,
  };
}
