const CURRENT_STATE_INTENT = /\b(?:current|currently|latest|now|still|recent|recently|up[- ]to[- ]date|right now|today|as of)\b/i;
const REFERENCE_POINTER_HINTS = /https?:\/\/|\b(linear|jira|slack|grafana|notion|dashboard|runbook|wiki|playbook|oncall|doc|docs|ticket|tickets|tracker|trackers|reference:)\b/i;
const PROJECT_STATE_SNAPSHOT_TERMS = /\b(?:merge freeze|freeze|deadline|roadmap|incident|migration(?: window)?|compliance|legal|stakeholder|launch|cutover|rollout|release branch|release cut|ship(?:ping)?(?: date)?|ship by)\b/i;

export function queryLooksLikeCurrentStateIntent(query: string): boolean {
  return CURRENT_STATE_INTENT.test(query);
}

type RecordLikeText = { title?: string; text?: string; memoryKey?: string };

export function memoryRecordHintText(record: RecordLikeText): string {
  return `${record.title || ''}\n${record.text || ''}\n${record.memoryKey || ''}`;
}

export function textLooksLikeReferencePointer(text: string): boolean {
  return REFERENCE_POINTER_HINTS.test(text);
}

export function textLooksLikeProjectStateSnapshot(text: string): boolean {
  return PROJECT_STATE_SNAPSHOT_TERMS.test(text);
}

export function memoryRecordLooksLikeReferencePointer(record: RecordLikeText): boolean {
  return textLooksLikeReferencePointer(memoryRecordHintText(record));
}

export function memoryRecordLooksLikeProjectStateSnapshot(record: RecordLikeText): boolean {
  const hintText = memoryRecordHintText(record);
  if (textLooksLikeReferencePointer(hintText)) return false;
  return textLooksLikeProjectStateSnapshot(hintText);
}

export function compareCurrentStateSupportOrder(
  a: { query?: string; isReferencePointer: boolean; isProjectStateLike: boolean },
  b: { query?: string; isReferencePointer: boolean; isProjectStateLike: boolean },
): number {
  const query = a.query ?? b.query ?? '';
  if (!queryLooksLikeCurrentStateIntent(query)) return 0;
  if (a.isReferencePointer && b.isProjectStateLike && !b.isReferencePointer) return -1;
  if (b.isReferencePointer && a.isProjectStateLike && !a.isReferencePointer) return 1;
  return 0;
}

export function shouldPreferCurrentStateDurablePointerFirst(params: {
  query?: string;
  hasDurableReferencePointer: boolean;
}): boolean {
  return !!params.hasDurableReferencePointer
    && queryLooksLikeCurrentStateIntent(params.query || '');
}

export function shouldCompactLaterProjectPriorContext(params: {
  hasLeadingReferencePointer: boolean;
  isProjectCategory: boolean;
  primaryLabel?: string;
}): boolean {
  return !!params.hasLeadingReferencePointer
    && !!params.isProjectCategory
    && params.primaryLabel === 'prior';
}

export function shouldCompactLaterCurrentStateProjectSupport(params: {
  query?: string;
  hasLeadingReferencePointer: boolean;
  isProjectStateLike: boolean;
}): boolean {
  return !!params.hasLeadingReferencePointer
    && !!params.isProjectStateLike
    && queryLooksLikeCurrentStateIntent(params.query || '');
}
