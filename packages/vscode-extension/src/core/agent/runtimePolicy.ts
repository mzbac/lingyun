import * as path from 'path';
import * as vscode from 'vscode';

import type {
  LingyunAgentPreparedRun,
  LingyunAgentRuntimeContext,
  LingyunAgentRuntimePolicy,
  LingyunAgentRuntimeSnapshot,
  LingyunAgentSyntheticContext,
} from '@kooka/agent-sdk';
import { getUserHistoryInputText, resolveBuiltinSubagent } from '@kooka/core';

import { getCompactionConfig, getModelLimit } from '../compaction';
import { findGitRoot, loadInstructions } from '../instructions';
import { WorkspaceMemories, getMemoriesConfig } from '../memories';
import {
  formatMemoryLastConfirmedMetadata,
  formatMemoryVerificationCaveat,
  renderMemoryFields,
  renderRawRecordEvidence,
  renderSelectiveMemorySurfaceLines,
  renderSummaryRecordText,
  selectiveMemoryFieldPriority,
  selectiveMemoryPrimaryLabel,
  shouldSurfaceSelectiveHowToApply,
} from '../memories/consolidate';
import {
  compareCurrentStateSupportOrder,
  memoryRecordLooksLikeProjectStateSnapshot,
  memoryRecordLooksLikeReferencePointer,
  queryLooksLikeCurrentStateIntent,
  shouldCompactLaterCurrentStateProjectSupport,
  shouldCompactLaterProjectPriorContext,
  shouldPreferCurrentStateDurablePointerFirst,
} from '../memories/currentState';

import type { ConsolidatedMemoryEntry } from '../memories/model';
import { getConfiguredReasoningEffort } from '../reasoningEffort';
import {
  extractExplicitForgetScopeHint,
  extractExplicitMemoryRecallScopeHint,
  hasExplicitForgetMemoryIntent,
  hasExplicitMemoryRecallIntent,
  hasMemoryOptOutIntent,
} from '../sessionSignals';
import { getPrimaryWorkspaceFolderUri } from '../workspaceContext';

import { DEFAULT_SYSTEM_PROMPT } from './prompts';

const EXPLORE_COMPACTION_RESTORE_MAX_CHARS = 6000;
const MEMORY_RECALL_COMPACTION_RESTORE_MAX_CHARS = 4000;

type MemoryRecallSurfaceFacet = 'why' | 'howToApply';

type RecentMemoryRecallState = {
  signature: string;
  hitSignatures: string[];
  completedUserTurns: number;
  angleSignature: string;
  surfacedFacetsByHitSignature: Record<string, MemoryRecallSurfaceFacet[]>;
};

const recentMemoryRecallBySession = new WeakMap<
  LingyunAgentRuntimeContext['session'],
  RecentMemoryRecallState
>();

function countCompletedUserTurns(session: LingyunAgentRuntimeContext['session']): number {
  return session.history.filter((message) => message.role === 'user' && !message.metadata?.synthetic).length;
}

function memoryRecallHitSignature(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
): string {
  const durableKey = String(hit.durableEntry?.key || '').trim();
  if (durableKey) return `durable:${durableKey}`;
  return `record:${hit.record.id}`;
}

function memoryRecallSelectionSignature(
  hits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
): string {
  return hits.map((hit) => memoryRecallHitSignature(hit)).filter(Boolean).join('|');
}

function memoryRecallAngleSignature(query: string): string {
  const priority = selectiveMemoryFieldPriority(query);
  return priority.length > 0 ? priority.join('|') : 'default';
}

function memoryRecallRequestedFacets(query: string): MemoryRecallSurfaceFacet[] {
  return selectiveMemoryFieldPriority(query).filter(
    (field): field is MemoryRecallSurfaceFacet => field === 'why' || field === 'howToApply',
  );
}

function memoryRecallSurfacedFacetsForHit(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  query: string,
): MemoryRecallSurfaceFacet[] {
  if (hit.source !== 'durable' || !hit.durableEntry) return [];
  const fields = renderMemoryFields(hit.durableEntry);
  const requested = memoryRecallRequestedFacets(query);
  if (requested.length === 0) return [];

  const surfaced: MemoryRecallSurfaceFacet[] = [];
  for (const field of requested) {
    if (field === 'why' && fields.why) surfaced.push('why');
    if (field === 'howToApply' && shouldSurfaceSelectiveHowToApply(hit.durableEntry, fields) && fields.howToApply) {
      surfaced.push('howToApply');
    }
  }
  return surfaced;
}

function getRecentMemoryRecallForCurrentTurn(
  session: LingyunAgentRuntimeContext['session'],
): RecentMemoryRecallState | undefined {
  const prior = recentMemoryRecallBySession.get(session);
  if (!prior) return undefined;
  return prior.completedUserTurns === countCompletedUserTurns(session) ? prior : undefined;
}

function getRecentlySurfacedMemoryHitSignatures(params: {
  session: LingyunAgentRuntimeContext['session'];
  currentStateQuery: boolean;
  eligibleHits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'];
  query: string;
}): Set<string> {
  if (params.currentStateQuery) return new Set();
  const prior = getRecentMemoryRecallForCurrentTurn(params.session);
  if (!prior || prior.hitSignatures.length === 0) return new Set();

  const queryAngleSignature = memoryRecallAngleSignature(params.query);
  if (prior.angleSignature === queryAngleSignature) {
    return new Set(prior.hitSignatures);
  }

  const queryRequestedFacets = memoryRecallRequestedFacets(params.query);
  if (queryRequestedFacets.length === 0) {
    return new Set(prior.hitSignatures);
  }

  const repeatedHitSignatures = new Set(prior.hitSignatures);
  const suppressible = new Set<string>();
  for (const hit of params.eligibleHits) {
    const hitSignature = memoryRecallHitSignature(hit);
    if (!repeatedHitSignatures.has(hitSignature)) continue;

    const priorSurfacedFacets = new Set(prior.surfacedFacetsByHitSignature[hitSignature] || []);
    const newlySurfacedFacets = memoryRecallSurfacedFacetsForHit(hit, params.query);
    const revealsNewFacet = newlySurfacedFacets.some((facet) => !priorSurfacedFacets.has(facet));
    if (!revealsNewFacet) {
      suppressible.add(hitSignature);
    }
  }
  return suppressible;
}

function hasEquivalentRecentMemoryRecall(params: {
  session: LingyunAgentRuntimeContext['session'];
  selectedHits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'];
  currentStateQuery: boolean;
  query: string;
}): boolean {
  if (params.currentStateQuery) return false;

  const signature = memoryRecallSelectionSignature(params.selectedHits);
  if (!signature) return false;

  const prior = getRecentMemoryRecallForCurrentTurn(params.session);
  if (!prior) return false;

  if (prior.signature !== signature) return false;
  if (prior.angleSignature === memoryRecallAngleSignature(params.query)) return true;

  const queryRequestedFacets = memoryRecallRequestedFacets(params.query);
  if (queryRequestedFacets.length === 0) return true;

  for (const hit of params.selectedHits) {
    const hitSignature = memoryRecallHitSignature(hit);
    const priorSurfacedFacets = new Set(prior.surfacedFacetsByHitSignature[hitSignature] || []);
    const newlySurfacedFacets = memoryRecallSurfacedFacetsForHit(hit, params.query);
    if (newlySurfacedFacets.some((facet) => !priorSurfacedFacets.has(facet))) {
      return false;
    }
  }

  return true;
}

function shouldSkipAutoRecallForQuery(query: string): boolean {
  return hasMemoryOptOutIntent(query);
}

function stripMemoryRecallContextForCurrentRun(ctx: LingyunAgentRuntimeContext, query: string): void {
  if (!shouldSkipAutoRecallForQuery(query)) return;

  ctx.session.history = ctx.session.history.filter((message) => {
    const metadata = message.metadata;
    if (!metadata?.synthetic) return true;
    if (metadata.transientContext === 'memoryRecall') return false;
    if (metadata.compactionRestore?.source === 'memoryRecall') return false;
    return true;
  });
  ctx.session.compactionSyntheticContexts = ctx.session.compactionSyntheticContexts.filter(
    (context) => context.transientContext !== 'memoryRecall',
  );
  recentMemoryRecallBySession.delete(ctx.session);
}

function hasMemoryContradictionConflicts(hits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits']): boolean {
  const invalidated = new Set<string>();
  for (const hit of hits) {
    for (const id of hit.record.invalidatesIds || []) {
      invalidated.add(id);
    }
  }
  return hits.some((hit) => invalidated.has(hit.record.id));
}

function memoryHitLastConfirmedAt(hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number]): number {
  return hit.durableEntry?.lastConfirmedAt ?? hit.record.lastConfirmedAt;
}

function memoryHitClusterKey(hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number]): string {
  return String(hit.durableEntry?.key || hit.record.memoryKey || '').trim();
}

function durableCategoryPriority(category: string | undefined): number {
  switch (category) {
    case 'user':
      return 0;
    case 'feedback':
      return 1;
    case 'project':
      return 2;
    case 'reference':
      return 3;
    case 'procedure':
      return 4;
    case 'failure_shield':
      return 5;
    default:
      return 6;
  }
}

function normalizeMemoryToolName(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function recentToolNamesFromSession(session: LingyunAgentRuntimeContext['session'], maxMessages = 8): Set<string> {
  const recentMessages = session.history.slice(Math.max(0, session.history.length - maxMessages));
  const tools = new Set<string>();
  for (const message of recentMessages) {
    for (const part of message.parts || []) {
      if (part?.type !== 'dynamic-tool') continue;
      const rawToolName = 'toolName' in part ? part.toolName : undefined;
      const toolName = normalizeMemoryToolName(typeof rawToolName === 'string' ? rawToolName : undefined);
      if (toolName) tools.add(toolName);
    }
  }
  return tools;
}

function memoryHitTools(hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number]): string[] {
  const values = hit.durableEntry?.toolsUsed ?? hit.record.toolsUsed;
  return values.map((value) => normalizeMemoryToolName(value)).filter(Boolean);
}

function queryMentionsActiveToolMemory(query: string): boolean {
  return /\b(?:how\s+(?:do|to|should|can)\s+(?:i\s+)?use|usage|reference|docs?|documentation|api|parameters?|arguments?|schema|example(?:s)?|syntax)\b/i.test(
    query,
  );
}

function memoryHitIsToolWarning(hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number]): boolean {
  if (hit.durableEntry?.category === 'failure_shield') return true;
  const text = `${hit.durableEntry?.text || ''}\n${hit.record.title || ''}\n${hit.record.text || ''}`;
  return /\b(?:warning|warn|gotcha|failure|failed|error|bug|pitfall|landmine|avoid|do not|don't|never|blocked|fix|workaround|symptom|cause)\b/i.test(text);
}

function shouldSuppressActiveToolUsageMemory(params: {
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number];
  query: string;
  recentTools: ReadonlySet<string>;
}): boolean {
  if (params.recentTools.size === 0) return false;
  if (!queryMentionsActiveToolMemory(params.query)) return false;
  const hitTools = memoryHitTools(params.hit);
  if (!hitTools.some((tool) => params.recentTools.has(tool))) return false;
  return !memoryHitIsToolWarning(params.hit);
}

function currentStateReferenceVsProjectOrder(
  aCategory: string | undefined,
  bCategory: string | undefined,
  query: string,
): number {
  return compareCurrentStateSupportOrder(
    {
      query,
      isReferencePointer: aCategory === 'reference',
      isProjectStateLike: aCategory === 'project',
    },
    {
      query,
      isReferencePointer: bCategory === 'reference',
      isProjectStateLike: bCategory === 'project',
    },
  );
}

const LOW_SIGNAL_REFERENCE_TERMS = new Set([
  'board',
  'boards',
  'bug',
  'bugs',
  'channel',
  'channels',
  'dashboard',
  'dashboards',
  'doc',
  'docs',
  'documentation',
  'issue',
  'issues',
  'link',
  'links',
  'page',
  'pages',
  'ticket',
  'tickets',
]);

function recordLooksLikeReferencePointer(hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number]): boolean {
  return memoryRecordLooksLikeReferencePointer(hit.record);
}

function recordLooksLikeProjectStateSnapshot(hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number]): boolean {
  return memoryRecordLooksLikeProjectStateSnapshot(hit.record);
}

function hitProvidesReferencePointer(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
): boolean {
  return (hit.source === 'durable' && hit.durableEntry?.category === 'reference') || recordLooksLikeReferencePointer(hit);
}

function selectedHasReferencePointer(
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
): boolean {
  return selected.some((item) => hitProvidesReferencePointer(item));
}

function currentStateHitSupportOrder(
  a: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  b: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  query?: string,
): number {
  return compareCurrentStateSupportOrder(
    {
      query,
      isReferencePointer: hitProvidesReferencePointer(a),
      isProjectStateLike: a.source === 'durable'
        ? a.durableEntry?.category === 'project'
        : recordLooksLikeProjectStateSnapshot(a),
    },
    {
      query,
      isReferencePointer: hitProvidesReferencePointer(b),
      isProjectStateLike: b.source === 'durable'
        ? b.durableEntry?.category === 'project'
        : recordLooksLikeProjectStateSnapshot(b),
    },
  );
}

function currentStateRawReferenceVsProjectOrder(
  a: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  b: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  query?: string,
): number {
  return compareCurrentStateSupportOrder(
    {
      query,
      isReferencePointer: recordLooksLikeReferencePointer(a),
      isProjectStateLike: recordLooksLikeProjectStateSnapshot(a),
    },
    {
      query,
      isReferencePointer: recordLooksLikeReferencePointer(b),
      isProjectStateLike: recordLooksLikeProjectStateSnapshot(b),
    },
  );
}

function rawSupportPriority(hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number]): number {
  if (hit.record.signalKind === 'summary') return 3;
  if (hit.record.kind === 'semantic') return 2;
  if (hit.record.kind === 'episodic') return 1;
  return 0;
}

function extractSpecificityTokens(text: string): string[] {
  const value = String(text || '');
  if (!value.trim()) return [];
  const matches = value.match(
    /https?:\/\/[^\s)]+|\b[A-Za-z][A-Za-z0-9_-]*-[0-9]{2,}\b|\b[A-Z][A-Z0-9]{2,}\b|\b[A-Za-z0-9_/-]*[./][A-Za-z0-9_./:-]+\b|\b[A-Z][A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9_]+\b/g,
  ) || [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const token = match.trim().toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }
  return normalized;
}

function queryLooksLikeWhyIntent(query: string): boolean {
  return /\b(?:why|reason|reasons|because|rationale|motivat(?:ion|e|ed|ing)|context)\b/i.test(query);
}

function queryLooksLikeHowIntent(query: string): boolean {
  return /\b(?:how should|how do|how can|how to|apply|apply this|when should|when to|where should|use this|default|follow|handle)\b/i.test(query);
}

function isDistinctMatchedQueryAspect(term: string): boolean {
  const normalized = String(term || '').trim().toLowerCase();
  if (!normalized || LOW_SIGNAL_REFERENCE_TERMS.has(normalized)) return false;
  return normalized.length >= 8 || /\d/.test(normalized) || /[./:-]/.test(normalized);
}

function isConcreteCurrentStateAnchor(term: string): boolean {
  const normalized = String(term || '').trim().toLowerCase();
  if (!normalized || LOW_SIGNAL_REFERENCE_TERMS.has(normalized)) return false;
  return /\d/.test(normalized) || /[./:-]/.test(normalized) || normalized.length >= 12;
}

function normalizeDurableComparisonText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/["'`]/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\b(?:a|an|the|this|that|these|those|our|your|their|similar|future|tasks?|work|workspace|project|default|guidance|policy|rule|rules|context)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function durableCoreGuidanceTokens(entry: ConsolidatedMemoryEntry): string[] {
  const fields = renderMemoryFields(entry);
  const normalized = normalizeDurableComparisonText(fields.guidance);
  if (!normalized) return [];
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 24);
  return [...new Set(tokens)];
}

function durableOverlapProfile(
  entry: ConsolidatedMemoryEntry,
  selectedEntry: ConsolidatedMemoryEntry,
): { heavyGuidanceOverlap: boolean; distinctWhy: boolean; distinctHow: boolean; distinctSpecificity: boolean } {
  const fields = renderMemoryFields(entry);
  const selectedFields = renderMemoryFields(selectedEntry);
  const hitTokens = new Set(durableCoreGuidanceTokens(entry));
  const selectedTokens = new Set(durableCoreGuidanceTokens(selectedEntry));
  const overlap = [...hitTokens].filter((token) => selectedTokens.has(token));
  const minTokenCount = Math.min(hitTokens.size, selectedTokens.size);
  const heavyGuidanceOverlap = overlap.length >= 3 || (minTokenCount >= 3 && overlap.length >= minTokenCount - 1);
  if (!heavyGuidanceOverlap) {
    return { heavyGuidanceOverlap: false, distinctWhy: false, distinctHow: false, distinctSpecificity: false };
  }

  const hitWhy = String(fields.why || '').trim().toLowerCase();
  const selectedWhy = String(selectedFields.why || '').trim().toLowerCase();
  const hitHow = String(shouldSurfaceSelectiveHowToApply(entry, fields) ? fields.howToApply || '' : '').trim().toLowerCase();
  const selectedHow = String(
    shouldSurfaceSelectiveHowToApply(selectedEntry, selectedFields) ? selectedFields.howToApply || '' : '',
  )
    .trim()
    .toLowerCase();
  const hitSpecificity = new Set(extractSpecificityTokens(durableSupportEvidenceText(entry)));
  const selectedSpecificity = new Set(extractSpecificityTokens(durableSupportEvidenceText(selectedEntry)));

  return {
    heavyGuidanceOverlap,
    distinctWhy: !!hitWhy && hitWhy !== selectedWhy,
    distinctHow: !!hitHow && hitHow !== selectedHow,
    distinctSpecificity: [...hitSpecificity].some((token) => !selectedSpecificity.has(token)),
  };
}

function durableAddsDistinctSupport(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
  query?: string,
): boolean {
  if (hit.source !== 'durable' || !hit.durableEntry) return true;
  const matchedTerms = new Set((hit.matchedTerms || []).map((term) => String(term || '').trim().toLowerCase()).filter(Boolean));
  const queryNeedsWhy = queryLooksLikeWhyIntent(query || '');
  const queryNeedsHow = queryLooksLikeHowIntent(query || '');
  const queryNeedsCurrentState = queryLooksLikeCurrentStateIntent(query || '');

  if (queryNeedsCurrentState && hit.durableEntry.category === 'project') {
    const hasSelectedReferencePointer = selectedHasReferencePointer(selected);
    if (hasSelectedReferencePointer) {
      const matchedSpecificity = [...matchedTerms].some((term) => isConcreteCurrentStateAnchor(term));
      if (!matchedSpecificity) return false;
    }
  }

  for (const selectedHit of selected) {
    if (selectedHit.source !== 'durable' || !selectedHit.durableEntry) continue;
    const profile = durableOverlapProfile(hit.durableEntry, selectedHit.durableEntry);
    if (!profile.heavyGuidanceOverlap) continue;

    if (queryNeedsWhy && profile.distinctWhy) return true;
    if (queryNeedsHow && profile.distinctHow) return true;
    if (profile.distinctSpecificity) {
      const matchedSpecificity = [...matchedTerms].some((term) => isDistinctMatchedQueryAspect(term));
      if (matchedSpecificity) return true;
    }

    return false;
  }

  return true;
}

function durableCanonicalPriority(entry: ConsolidatedMemoryEntry): number {
  const fields = renderMemoryFields(entry);
  let priority = entry.confidence + Math.min(2, Math.log2(Math.max(1, entry.evidenceCount) + 1));
  if (fields.why) priority += 1.5;
  if (shouldSurfaceSelectiveHowToApply(entry, fields) && fields.howToApply) priority += 1;
  if (/\b(?:must|must not|never|do not|don't|required|cannot|can't)\b/i.test(fields.guidance)) {
    priority += 1.5;
  }
  return priority;
}

function duplicateDurableCanonicalOrder(
  a: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  b: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
): number {
  if (a.source !== 'durable' || !a.durableEntry || b.source !== 'durable' || !b.durableEntry) return 0;
  const profile = durableOverlapProfile(a.durableEntry, b.durableEntry);
  if (!profile.heavyGuidanceOverlap || profile.distinctWhy || profile.distinctHow || profile.distinctSpecificity) {
    return 0;
  }

  const priorityDiff = durableCanonicalPriority(b.durableEntry) - durableCanonicalPriority(a.durableEntry);
  if (Math.abs(priorityDiff) < 0.25) return 0;
  return priorityDiff;
}

function renderAdditiveDurableSurfaceLines(
  entry: ConsolidatedMemoryEntry,
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
  query?: string,
): string[] | undefined {
  const queryNeedsWhy = queryLooksLikeWhyIntent(query || '');
  const queryNeedsHow = queryLooksLikeHowIntent(query || '');
  const hasSelectedReferencePointer = selectedHasReferencePointer(selected);
  const primaryLabel = selectiveMemoryPrimaryLabel(entry, 'fact', query);
  const compactPriorContext = shouldCompactLaterProjectPriorContext({
    hasLeadingReferencePointer: hasSelectedReferencePointer,
    isProjectCategory: entry.category === 'project',
    primaryLabel,
  });

  if (!queryNeedsWhy && !queryNeedsHow) {
    return compactPriorContext
      ? renderSelectiveMemorySurfaceLines(entry, { fallbackLabel: 'fact', query, compactPriorContext: true })
      : undefined;
  }

  const fields = renderMemoryFields(entry);
  for (const selectedHit of selected) {
    if (selectedHit.source !== 'durable' || !selectedHit.durableEntry) continue;
    const profile = durableOverlapProfile(entry, selectedHit.durableEntry);
    if (!profile.heavyGuidanceOverlap) continue;

    const lines: string[] = [];
    if (compactPriorContext) {
      lines.push(...renderSelectiveMemorySurfaceLines(entry, { fallbackLabel: 'fact', query, compactPriorContext: true }));
    }
    if (queryNeedsWhy && profile.distinctWhy && fields.why) {
      lines.push(`why: ${fields.why}`);
    }
    if (queryNeedsHow && profile.distinctHow && shouldSurfaceSelectiveHowToApply(entry, fields) && fields.howToApply) {
      lines.push(`how_to_apply: ${fields.howToApply}`);
    }
    return lines.length > 0 ? lines : undefined;
  }

  return compactPriorContext
    ? renderSelectiveMemorySurfaceLines(entry, { fallbackLabel: 'fact', query, compactPriorContext: true })
    : undefined;
}

function durableSupportText(entry: ConsolidatedMemoryEntry): string {
  const fields = renderMemoryFields(entry);
  return [
    fields.guidance,
    fields.why,
    shouldSurfaceSelectiveHowToApply(entry, fields) ? fields.howToApply : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function durableSupportEvidenceText(entry: ConsolidatedMemoryEntry): string {
  return entry.category === 'reference'
    ? [durableSupportText(entry), ...entry.rolloutFiles].filter(Boolean).join('\n')
    : durableSupportText(entry);
}

function extractReferenceEvidenceTokens(text: string): string[] {
  const value = String(text || '');
  if (!value.trim()) return [];
  const matches = value.match(
    /https?:\/\/[^\s)]+|\b[a-z0-9.-]+\/[A-Za-z0-9_./:-]+\b|\b[A-Z][A-Z0-9]{2,}\b|\b[A-Za-z][A-Za-z0-9_-]*-[0-9]{2,}\b/g,
  ) || [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const token = match.trim().toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }
  return normalized;
}

function hitReferenceEvidenceTokens(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
): Set<string> {
  if (hit.source === 'durable' && hit.durableEntry) {
    return new Set(extractReferenceEvidenceTokens(durableSupportEvidenceText(hit.durableEntry)));
  }
  return new Set(extractReferenceEvidenceTokens(hit.record.text));
}

function rawSummaryAddsDistinctSupport(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
): boolean {
  const selectedFiles = new Set(
    selected
      .flatMap((item) => (item.durableEntry?.filesTouched ?? item.record.filesTouched) || [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (hit.record.filesTouched.some((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized && !selectedFiles.has(normalized);
  })) {
    return true;
  }

  const selectedTools = new Set(
    selected
      .flatMap((item) => (item.durableEntry?.toolsUsed ?? item.record.toolsUsed) || [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (hit.record.toolsUsed.some((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized && !selectedTools.has(normalized);
  })) {
    return true;
  }

  for (const selectedHit of selected) {
    if (!hitProvidesReferencePointer(selectedHit)) continue;
    const selectedReferenceTokens = hitReferenceEvidenceTokens(selectedHit);
    const hitReferenceTokens = extractReferenceEvidenceTokens(hit.record.text);
    if (hitReferenceTokens.some((token) => !selectedReferenceTokens.has(token))) return true;
  }

  return false;
}

function rawAddsDistinctReferenceSupport(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
): boolean {
  const referencePointerHits = selected.filter((item) => hitProvidesReferencePointer(item));
  for (const selectedHit of referencePointerHits) {
    const selectedReferenceTokens = hitReferenceEvidenceTokens(selectedHit);
    const hitReferenceTokens = extractReferenceEvidenceTokens(hit.record.text);
    const hasDistinctReferenceEvidence = hitReferenceTokens.some((token) => !selectedReferenceTokens.has(token));
    if (!hasDistinctReferenceEvidence) continue;

    const selectedMatchedTerms = new Set((selectedHit.matchedTerms || []).map((term) => String(term || '').toLowerCase()));
    const hitMatchedTerms = (hit.matchedTerms || []).map((term) => String(term || '').toLowerCase());
    const specificOverlap = hitMatchedTerms.some(
      (term) => selectedMatchedTerms.has(term) && !LOW_SIGNAL_REFERENCE_TERMS.has(term),
    );
    if (specificOverlap) return true;
  }

  return false;
}

function rawAddsDistinctCurrentStateSupport(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
  query?: string,
): boolean {
  if (!queryLooksLikeCurrentStateIntent(query || '')) return false;
  if (!selectedHasReferencePointer(selected)) return false;

  if (rawAddsDistinctReferenceSupport(hit, selected)) return true;
  return (hit.matchedTerms || []).some((term) => isConcreteCurrentStateAnchor(term));
}

function rawAddsDistinctSupport(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
  query?: string,
): boolean {
  const currentStateNeedsStricterSupport =
    queryLooksLikeCurrentStateIntent(query || '')
    && selectedHasReferencePointer(selected);
  const currentStateSpecificSupport = rawAddsDistinctCurrentStateSupport(hit, selected, query);

  if (hit.record.kind === 'procedural') {
    return currentStateNeedsStricterSupport ? currentStateSpecificSupport : true;
  }
  if (hit.record.signalKind === 'summary') {
    const distinctSummarySupport = rawSummaryAddsDistinctSupport(hit, selected);
    if (!distinctSummarySupport) return false;
    return currentStateNeedsStricterSupport ? currentStateSpecificSupport : true;
  }

  if (currentStateSpecificSupport) return true;
  if (currentStateNeedsStricterSupport) return false;

  if (rawAddsDistinctReferenceSupport(hit, selected)) return true;

  const selectedText = selected
    .map((item) => (item.durableEntry ? durableSupportText(item.durableEntry) : item.record.text))
    .join('\n');
  const selectedTokens = new Set(extractSpecificityTokens(selectedText));
  const hitTokens = extractSpecificityTokens(hit.record.text);
  return hitTokens.some((token) => !selectedTokens.has(token));
}

function selectAutoRecallHits(
  hits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
  maxResults: number,
  query?: string,
): Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'] {
  const matchHits = hits.filter((hit) => hit.reason === 'match');
  if (matchHits.length === 0) return [];

  const durableMatches = matchHits.filter((hit) => hit.source === 'durable' && hit.durableEntry);
  const usingDurablePool = durableMatches.length > 0;
  const selected: typeof matchHits = [];
  const coveredDurableKeys = new Set<string>();
  const seenRecordIds = new Set<string>();

  const sortedSeedPool = [...matchHits].sort((a, b) => {
    const currentStateOrder = currentStateHitSupportOrder(a, b, query);
    if (currentStateOrder !== 0) return currentStateOrder;
    const duplicateDurableOrder = duplicateDurableCanonicalOrder(a, b);
    if (duplicateDurableOrder !== 0) return duplicateDurableOrder;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    if (a.source !== b.source) return a.source === 'durable' ? -1 : 1;
    return memoryHitLastConfirmedAt(b) - memoryHitLastConfirmedAt(a);
  });

  const sortedDurableMatches = [...durableMatches].sort((a, b) => {
    const currentStateCategoryOrder = currentStateReferenceVsProjectOrder(
      a.durableEntry?.category,
      b.durableEntry?.category,
      query || '',
    );
    if (currentStateCategoryOrder !== 0) return currentStateCategoryOrder;
    const duplicateDurableOrder = duplicateDurableCanonicalOrder(a, b);
    if (duplicateDurableOrder !== 0) return duplicateDurableOrder;
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.35) return scoreDiff;
    const categoryOrder = durableCategoryPriority(a.durableEntry?.category) - durableCategoryPriority(b.durableEntry?.category);
    if (categoryOrder !== 0) return categoryOrder;
    return memoryHitLastConfirmedAt(b) - memoryHitLastConfirmedAt(a);
  });

  const supplementalPool = usingDurablePool
    ? matchHits.filter((hit) => hit.source !== 'durable')
    : matchHits;
  const sortedSupplementalPool = [...supplementalPool].sort((a, b) => {
    const currentStateRecordOrder = currentStateRawReferenceVsProjectOrder(a, b, query);
    if (currentStateRecordOrder !== 0) return currentStateRecordOrder;
    const supportOrder = rawSupportPriority(a) - rawSupportPriority(b);
    if (supportOrder !== 0) return supportOrder;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return memoryHitLastConfirmedAt(b) - memoryHitLastConfirmedAt(a);
  });

  const maybeSelect = (hit: (typeof matchHits)[number]): boolean => {
    if (seenRecordIds.has(hit.record.id)) return false;
    const clusterKey = memoryHitClusterKey(hit);
    const sameClusterCovered = clusterKey && coveredDurableKeys.has(clusterKey);
    if (sameClusterCovered) {
      if (hit.source === 'durable') {
        if (!durableAddsDistinctSupport(hit, selected, query)) return false;
      } else {
        const allowSameClusterRawSupport = rawAddsDistinctSupport(hit, selected, query);
        if (!allowSameClusterRawSupport) return false;
      }
    }
    if (hit.source === 'durable' && !durableAddsDistinctSupport(hit, selected, query)) {
      return false;
    }

    selected.push(hit);
    seenRecordIds.add(hit.record.id);
    if (hit.source === 'durable' && clusterKey) {
      coveredDurableKeys.add(clusterKey);
    }
    return selected.length >= maxResults;
  };

  const durableCursor = 0;
  if (usingDurablePool) {
    const preferCurrentStateDurablePointerFirst = shouldPreferCurrentStateDurablePointerFirst({
      query,
      hasDurableReferencePointer: durableMatches.some((hit) => hit.durableEntry?.category === 'reference'),
    });
    const shouldSeedFromAnyCurrentTruthHit = queryLooksLikeCurrentStateIntent(query || '') && !preferCurrentStateDurablePointerFirst;
    const seedPool = shouldSeedFromAnyCurrentTruthHit ? sortedSeedPool : sortedDurableMatches;
    let seedCursor = 0;
    while (seedCursor < seedPool.length) {
      const hit = seedPool[seedCursor];
      seedCursor += 1;
      if (!hit) continue;
      if (maybeSelect(hit)) return selected;
      if (selected.length > 0) break;
    }

    if (selected.length > 0 && selected.length < maxResults && selected[0]?.source === 'durable') {
      for (const hit of sortedSupplementalPool) {
        if (!rawAddsDistinctSupport(hit, selected, query)) continue;
        if (maybeSelect(hit)) return selected;
        break;
      }
    }
  }

  for (const hit of sortedDurableMatches.slice(durableCursor)) {
    if (maybeSelect(hit)) return selected;
  }

  for (const hit of sortedSupplementalPool) {
    if ((usingDurablePool || selectedHasReferencePointer(selected)) && !rawAddsDistinctSupport(hit, selected, query)) continue;
    if (maybeSelect(hit)) return selected;
  }

  return selected;
}

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\/+$/, '') || '/';
  const parent = path.posix.dirname(normalized);
  if (parent === normalized) return uri;
  return uri.with({ path: parent });
}

type PreparedRuntime = {
  systemPrompt: string;
  allowExternalPaths: boolean;
  reasoningEffort: string;
  taskMaxOutputChars: number;
  snapshot: LingyunAgentRuntimeSnapshot;
};

export class VsCodeAgentRuntimePolicy implements LingyunAgentRuntimePolicy {
  private instructionsText?: string;
  private instructionsKey?: string;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async prepareRun(ctx: LingyunAgentRuntimeContext): Promise<LingyunAgentPreparedRun> {
    const runtime = await this.prepareRuntime(ctx);
    const syntheticContexts: LingyunAgentSyntheticContext[] = [];

    if (!ctx.input) {
      return { runtime: runtime.snapshot };
    }

    const query = getUserHistoryInputText(ctx.input).trim();
    if (query) {
      stripMemoryRecallContextForCurrentRun(ctx, query);
    }

    const exploreContext = await this.maybeRunExplorePrepass(ctx, runtime);
    if (exploreContext) syntheticContexts.push(exploreContext);

    const memoryRecallContext = await this.maybeInjectMemoryRecall(ctx);
    if (memoryRecallContext) syntheticContexts.push(memoryRecallContext);

    return {
      runtime: runtime.snapshot,
      ...(syntheticContexts.length > 0 ? { syntheticContexts } : {}),
    };
  }

  private async prepareRuntime(ctx: LingyunAgentRuntimeContext): Promise<PreparedRuntime> {
    await this.refreshInstructions();

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const allowExternalPaths =
      cfg.get<boolean>('security.allowExternalPaths', false) ?? false;
    const reasoningEffort = getConfiguredReasoningEffort();
    const taskMaxOutputChars = cfg.get<number>('subagents.task.maxOutputChars', 8000) ?? 8000;

    const modelId = String(ctx.config.model || '').trim();
    const modelLimit =
      modelId ? getModelLimit(modelId, ctx.llm.id) ?? (await ctx.warmModelLimit(modelId)) : undefined;
    const systemPrompt = this.composeSystemPromptText(ctx.config.systemPrompt);
    const compaction = getCompactionConfig();

    return {
      systemPrompt,
      allowExternalPaths,
      reasoningEffort,
      taskMaxOutputChars,
      snapshot: {
        systemPrompt,
        allowExternalPaths,
        reasoningEffort,
        taskMaxOutputChars,
        compaction,
        ...(modelId && modelLimit ? { modelLimits: { [modelId]: modelLimit } } : { modelLimits: undefined }),
      },
    };
  }

  private getWorkspaceRootForContext(): vscode.Uri | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const workspaceFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    return workspaceFolder?.uri ?? getPrimaryWorkspaceFolderUri();
  }

  private async refreshInstructions(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRootForContext();
    const activeEditor = vscode.window.activeTextEditor;

    const isActiveEditorInWorkspace =
      !!workspaceRoot &&
      !!activeEditor &&
      workspaceRoot.scheme === 'file' &&
      activeEditor.document.uri.scheme === 'file';

    const startDir =
      isActiveEditorInWorkspace && activeEditor ? dirnameUri(activeEditor.document.uri) : workspaceRoot;
    if (!startDir) return;

    const stopDir = workspaceRoot ? await findGitRoot(startDir, workspaceRoot) : startDir;
    const extraInstructionPatterns =
      vscode.workspace.getConfiguration('lingyun').get<string[]>('instructions') || [];

    const key = [
      startDir.toString(),
      stopDir.toString(),
      workspaceRoot?.toString() || '',
      JSON.stringify(extraInstructionPatterns),
    ].join('|');

    if (this.instructionsKey === key) return;
    this.instructionsKey = key;

    try {
      const loaded = await loadInstructions({
        startDir,
        workspaceRoot,
        stopDir,
        extraInstructionPatterns,
        includeGlobal: true,
      });
      this.instructionsText = loaded.text;
    } catch {
      this.instructionsText = undefined;
    }
  }

  private composeSystemPromptText(basePrompt?: string): string {
    const prompt = typeof basePrompt === 'string' && basePrompt.trim() ? basePrompt : DEFAULT_SYSTEM_PROMPT;
    return [prompt, this.instructionsText].filter(Boolean).join('\n\n');
  }

  private async maybeRunExplorePrepass(
    ctx: LingyunAgentRuntimeContext,
    runtime: PreparedRuntime,
  ): Promise<LingyunAgentSyntheticContext | undefined> {
    if (ctx.signal?.aborted) return undefined;
    if (ctx.session.parentSessionId || ctx.session.subagentType) return undefined;

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const enabled = cfg.get<boolean>('subagents.explorePrepass.enabled', false) ?? false;
    if (!enabled) return undefined;

    const subagent = resolveBuiltinSubagent('explore');
    if (!subagent) return undefined;

    const maxCharsRaw = cfg.get<number>('subagents.explorePrepass.maxChars', 8000) ?? 8000;
    const maxChars =
      Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 8000;

    let exploreModelId = String(ctx.config.model || '').trim();
    const configuredSubagentModel = String(ctx.config.subagentModel || '').trim();
    if (configuredSubagentModel && configuredSubagentModel !== exploreModelId) {
      try {
        await ctx.llm.getModel(configuredSubagentModel);
        exploreModelId = configuredSubagentModel;
      } catch {
        // Ignore and fall back to the parent model.
      }
    }

    if (!exploreModelId || !ctx.input) return undefined;

    const exploreModelLimit =
      getModelLimit(exploreModelId, ctx.llm.id) ?? (await ctx.warmModelLimit(exploreModelId));
    let exploreText = await ctx.runSyntheticPass({
      input: ctx.input,
      modelId: exploreModelId,
      mode: 'plan',
      toolFilter: subagent.toolFilter,
      systemPrompt: `${runtime.systemPrompt}\n\n${subagent.prompt}`,
      sessionId: `${ctx.config.sessionId || 'session'}:auto-explore:${Date.now()}`,
      parentSessionId: ctx.config.sessionId,
      subagentType: 'explore',
      signal: ctx.signal,
      runtime: {
        allowExternalPaths: runtime.allowExternalPaths,
        reasoningEffort: runtime.reasoningEffort,
        taskMaxOutputChars: runtime.taskMaxOutputChars,
        compaction: runtime.snapshot.compaction,
        ...(exploreModelLimit ? { modelLimits: { [exploreModelId]: exploreModelLimit } } : {}),
      },
    });

    let truncated = false;
    exploreText = exploreText.trimEnd();
    if (exploreText.length > maxChars) {
      exploreText = exploreText.slice(0, maxChars).trimEnd();
      truncated = true;
    }

    const injected = [
      '<subagent_explore_context>',
      exploreText,
      truncated ? '\n\n... [TRUNCATED]' : '',
      '</subagent_explore_context>',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      transientContext: 'explore',
      text: injected,
      persistAfterCompaction: true,
      maxCharsAfterCompaction: Math.min(maxChars, EXPLORE_COMPACTION_RESTORE_MAX_CHARS),
    };
  }

  private async maybeInjectMemoryRecall(
    ctx: LingyunAgentRuntimeContext
  ): Promise<LingyunAgentSyntheticContext | undefined> {
    if (ctx.signal?.aborted) return undefined;
    if (ctx.session.parentSessionId || ctx.session.subagentType) return undefined;
    if (!ctx.input) return undefined;

    const memoriesConfig = getMemoriesConfig();
    if (!memoriesConfig.enabled || !memoriesConfig.autoRecall) return undefined;

    const query = getUserHistoryInputText(ctx.input).trim();
    if (!query) return undefined;
    if (shouldSkipAutoRecallForQuery(query)) return undefined;

    const workspaceFolder = this.getWorkspaceRootForContext();
    const manager = new WorkspaceMemories(this.context);
    const explicitMemoryScope = extractExplicitMemoryRecallScopeHint(query) ?? extractExplicitForgetScopeHint(query);

    const searchLimit = Math.min(12, Math.max(memoriesConfig.maxAutoRecallResults + 4, memoriesConfig.maxAutoRecallResults * 3));
    const search = await manager.searchMemory({
      query,
      workspaceFolder,
      scope: explicitMemoryScope,
      limit: searchLimit,
      maxTokens: memoriesConfig.maxAutoRecallTokens,
      neighborWindow: memoriesConfig.searchNeighborWindow,
      maxResultsPerKind: 2,
      preferDurableFirst: true,
    });

    if (search.hits.length === 0) {
      void manager.scheduleUpdateFromSessions(workspaceFolder, { delayMs: 250 }).catch(() => {
        // Ignore background refresh failures during pre-run recall.
      });
      return undefined;
    }

    const matchHits = search.hits.filter((hit) => hit.reason === 'match');
    if (matchHits.length === 0) return undefined;

    const now = Date.now();
    const ageCutoffMs = now - memoriesConfig.autoRecallMaxAgeDays * 24 * 60 * 60 * 1000;
    const eligibleMatchHits = matchHits.filter((hit) => {
      const lastConfirmedAt = memoryHitLastConfirmedAt(hit);
      const freshness = hit.durableEntry?.freshness ?? hit.record.staleness;
      return lastConfirmedAt >= ageCutoffMs && freshness !== 'invalidated' && hit.score >= memoriesConfig.autoRecallMinScore;
    });
    const currentStateQuery = queryLooksLikeCurrentStateIntent(query || '');
    const recentTools = recentToolNamesFromSession(ctx.session);
    const toolAwareEligibleMatchHits = eligibleMatchHits.filter(
      (hit) => !shouldSuppressActiveToolUsageMemory({ hit, query, recentTools }),
    );
    const recentlySurfacedHitSignatures = getRecentlySurfacedMemoryHitSignatures({
      session: ctx.session,
      currentStateQuery,
      eligibleHits: toolAwareEligibleMatchHits,
      query,
    });
    const freshEligibleMatchHits = recentlySurfacedHitSignatures.size > 0
      ? toolAwareEligibleMatchHits.filter((hit) => !recentlySurfacedHitSignatures.has(memoryRecallHitSignature(hit)))
      : toolAwareEligibleMatchHits;
    const selectionPool = freshEligibleMatchHits.length > 0 ? freshEligibleMatchHits : toolAwareEligibleMatchHits;
    const selectedHits = selectAutoRecallHits(selectionPool, memoriesConfig.maxAutoRecallResults, query);

    if (selectedHits.length === 0) return undefined;

    const scoreRankedHits = [...selectedHits].sort((a, b) => b.score - a.score);
    const topScore = scoreRankedHits[0]?.score ?? 0;
    const secondScore = scoreRankedHits[1]?.score ?? 0;
    const hasDurableGuidance = selectedHits.some((hit) => hit.source === 'durable' && hit.durableEntry);
    if (topScore < memoriesConfig.autoRecallMinScore) return undefined;
    if (!hasDurableGuidance && scoreRankedHits.length > 1 && topScore - secondScore < memoriesConfig.autoRecallMinScoreGap) {
      return undefined;
    }
    if (hasMemoryContradictionConflicts(selectedHits)) return undefined;

    const lines: string[] = [
      '<memory_recall_context>',
      'Use this recalled context only if it is relevant to the current turn.',
      'Prefer curated durable guidance when present; treat raw memory as supporting evidence, not the primary instruction surface.',
      'Treat recalled memory as prior context, not guaranteed-current truth. Verify drift-prone facts before acting on them.',
      ...(hasExplicitForgetMemoryIntent(query)
        ? [
            'The user is asking to forget memory. Use matching recalled entries only to identify recordId/durableKey for maintain_memory action=invalidate; do not rely on the forgotten content as guidance.',
          ]
        : []),
      ...(hasExplicitMemoryRecallIntent(query)
        ? [
            'The user explicitly asked to recall/check memory. Use this recalled context as a starting point; call get_memory search if it is insufficient or missing expected details.',
          ]
        : []),
      ...(explicitMemoryScope ? [`scope_filter: ${explicitMemoryScope}`] : []),
      '## Before recommending from recalled memory',
      '- If a recalled memory names a file path, check that the file still exists before recommending or editing it.',
      '- If it names a function, symbol, setting, flag, endpoint, or command, grep/read the current workspace before relying on it.',
      '- For recent or current-state questions, prefer current files, git history, or the referenced source over frozen memory snapshots.',
      '- If current evidence contradicts recalled memory, trust the current evidence and use maintain_memory to confirm, invalidate, or supersede the stale memory.',
      `query: ${query}`,
      '',
    ];

    let emitted = 0;
    for (const hit of selectedHits) {
      if (emitted >= memoriesConfig.maxAutoRecallResults) break;
      const label = hit.source === 'durable' ? `durable:${hit.durableEntry?.category || 'memory'}` : hit.record.kind;
      const confidence = hit.durableEntry?.confidence ?? hit.record.confidence;
      const freshness = hit.durableEntry?.freshness ?? hit.record.staleness;
      const scope = hit.durableEntry?.scope ?? hit.record.scope;
      const lastConfirmedAt = memoryHitLastConfirmedAt(hit);
      const files = hit.durableEntry?.filesTouched ?? hit.record.filesTouched;
      const tools = hit.durableEntry?.toolsUsed ?? hit.record.toolsUsed;
      const precedingHits = selectedHits.slice(0, emitted);
      const hasLeadingReferencePointer = selectedHasReferencePointer(precedingHits);
      const primaryLabel = hit.source === 'durable' && hit.durableEntry
        ? selectiveMemoryPrimaryLabel(hit.durableEntry, 'fact', query)
        : undefined;
      const compactMetadata =
        hit.source === 'durable'
        && !!hit.durableEntry
        && shouldCompactLaterProjectPriorContext({
          hasLeadingReferencePointer,
          isProjectCategory: hit.durableEntry.category === 'project',
          primaryLabel,
        });
      lines.push(
        `## Memory ${emitted + 1} [${label}] scope=${scope} score=${hit.score.toFixed(2)} reason=${hit.reason} confidence=${confidence.toFixed(2)} staleness=${freshness}`,
      );
      lines.push(formatMemoryLastConfirmedMetadata(lastConfirmedAt, now));
      const verificationCaveat = formatMemoryVerificationCaveat(freshness, lastConfirmedAt, now);
      if (verificationCaveat) {
        lines.push(verificationCaveat);
      }
      if (!compactMetadata) {
        lines.push(`source: ${hit.source || 'record'}`);
        lines.push(`session_id: ${hit.record.sessionId}`);
        if (files.length > 0) {
          lines.push(`files: ${files.join(', ')}`);
        }
        if (tools.length > 0) {
          lines.push(`tools: ${tools.join(', ')}`);
        }
      }
      if (hit.source === 'durable' && hit.durableEntry) {
        const additiveLines = renderAdditiveDurableSurfaceLines(hit.durableEntry, selectedHits.slice(0, emitted), query);
        if (additiveLines && additiveLines.length > 0) {
          lines.push(...additiveLines);
        } else {
          lines.push(...renderSelectiveMemorySurfaceLines(hit.durableEntry, { fallbackLabel: 'fact', query }));
        }
      } else if (hit.record.signalKind === 'summary') {
        const summary = renderSummaryRecordText(hit.record);
        lines.push(`summary: ${summary.summary}`);
        for (const detail of summary.details) {
          lines.push(detail);
        }
      } else {
        const compactRawSupport = shouldCompactLaterCurrentStateProjectSupport({
          query,
          hasLeadingReferencePointer,
          isProjectStateLike: recordLooksLikeProjectStateSnapshot(hit),
        });
        const evidence = renderRawRecordEvidence(hit.record, compactRawSupport ? { compact: true } : undefined);

        lines.push(`evidence: ${evidence.evidence}`);
        for (const detail of evidence.details) {
          lines.push(detail);
        }
      }
      lines.push('');
      emitted += 1;
    }

    if (emitted === 0) return undefined;

    lines.push('</memory_recall_context>');
    const recallText = lines.join('\n');
    if (hasEquivalentRecentMemoryRecall({
      session: ctx.session,
      selectedHits,
      currentStateQuery,
      query,
    })) {
      return undefined;
    }

    recentMemoryRecallBySession.set(ctx.session, {
      signature: memoryRecallSelectionSignature(selectedHits),
      hitSignatures: selectedHits.map((hit) => memoryRecallHitSignature(hit)).filter(Boolean),
      completedUserTurns: countCompletedUserTurns(ctx.session) + 1,
      angleSignature: memoryRecallAngleSignature(query),
      surfacedFacetsByHitSignature: Object.fromEntries(
        selectedHits.map((hit) => [memoryRecallHitSignature(hit), memoryRecallSurfacedFacetsForHit(hit, query)]),
      ),
    });

    return {
      transientContext: 'memoryRecall',
      text: recallText,
      persistAfterCompaction: true,
      maxCharsAfterCompaction: MEMORY_RECALL_COMPACTION_RESTORE_MAX_CHARS,
    };
  }
}
