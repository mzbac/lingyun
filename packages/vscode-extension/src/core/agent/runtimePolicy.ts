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
import { getConfiguredOpenAICompatibleThinking, getConfiguredReasoningEffort } from '../reasoningEffort';
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
  let count = 0;
  for (const message of session.history) {
    if (message.role === 'user' && !message.metadata?.synthetic) count++;
  }
  return count;
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
  let signature = '';
  for (const hit of hits) {
    const hitSignature = memoryRecallHitSignature(hit);
    if (!hitSignature) continue;
    signature = signature ? signature + '|' + hitSignature : hitSignature;
  }
  return signature;
}

function collectMemoryRecallHitSignatures(
  hits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
): string[] {
  const signatures: string[] = [];
  for (const hit of hits) {
    const hitSignature = memoryRecallHitSignature(hit);
    if (hitSignature) signatures.push(hitSignature);
  }
  return signatures;
}

function memoryRecallAngleSignature(query: string): string {
  const priority = selectiveMemoryFieldPriority(query);
  if (priority.length === 0) return 'default';

  let signature = '';
  for (const field of priority) {
    signature = signature ? signature + '|' + field : field;
  }
  return signature;
}

function memoryRecallRequestedFacets(query: string): MemoryRecallSurfaceFacet[] {
  const requested: MemoryRecallSurfaceFacet[] = [];
  for (const field of selectiveMemoryFieldPriority(query)) {
    if (field === 'why' || field === 'howToApply') requested.push(field);
  }
  return requested;
}

function facetsRevealNewSurface(
  facets: readonly MemoryRecallSurfaceFacet[],
  prior: ReadonlySet<MemoryRecallSurfaceFacet>,
): boolean {
  for (const facet of facets) {
    if (!prior.has(facet)) return true;
  }
  return false;
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
    const revealsNewFacet = facetsRevealNewSurface(newlySurfacedFacets, priorSurfacedFacets);
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
    if (facetsRevealNewSurface(newlySurfacedFacets, priorSurfacedFacets)) {
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

  const retainedHistory: typeof ctx.session.history = [];
  for (const message of ctx.session.history) {
    const metadata = message.metadata;
    if (metadata?.synthetic && metadata.transientContext === 'memoryRecall') continue;
    if (metadata?.synthetic && metadata.compactionRestore?.source === 'memoryRecall') continue;
    retainedHistory.push(message);
  }
  ctx.session.history = retainedHistory;

  const retainedContexts: typeof ctx.session.compactionSyntheticContexts = [];
  for (const context of ctx.session.compactionSyntheticContexts) {
    if (context.transientContext === 'memoryRecall') continue;
    retainedContexts.push(context);
  }
  ctx.session.compactionSyntheticContexts = retainedContexts;
  recentMemoryRecallBySession.delete(ctx.session);
}

function hasMemoryContradictionConflicts(hits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits']): boolean {
  const invalidated = new Set<string>();
  for (const hit of hits) {
    for (const id of hit.record.invalidatesIds || []) {
      invalidated.add(id);
    }
  }
  for (const hit of hits) {
    if (invalidated.has(hit.record.id)) return true;
  }
  return false;
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
  const tools = new Set<string>();
  const start = Math.max(0, session.history.length - maxMessages);
  for (let i = start; i < session.history.length; i++) {
    const message = session.history[i];
    if (!message) continue;
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
  if (!Array.isArray(values) || values.length === 0) return [];

  const tools: string[] = [];
  for (const value of values) {
    const toolName = normalizeMemoryToolName(value);
    if (toolName) tools.push(toolName);
  }
  return tools;
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
  let hasRecentTool = false;
  for (const tool of hitTools) {
    if (!params.recentTools.has(tool)) continue;
    hasRecentTool = true;
    break;
  }
  if (!hasRecentTool) return false;
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
  for (const item of selected) {
    if (hitProvidesReferencePointer(item)) return true;
  }
  return false;
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

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    if (token.length < 4 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= 24) break;
  }
  return tokens;
}

function durableOverlapProfile(
  entry: ConsolidatedMemoryEntry,
  selectedEntry: ConsolidatedMemoryEntry,
): { heavyGuidanceOverlap: boolean; distinctWhy: boolean; distinctHow: boolean; distinctSpecificity: boolean } {
  const fields = renderMemoryFields(entry);
  const selectedFields = renderMemoryFields(selectedEntry);
  const hitTokens = new Set(durableCoreGuidanceTokens(entry));
  const selectedTokens = new Set(durableCoreGuidanceTokens(selectedEntry));
  let overlapCount = 0;
  for (const token of hitTokens) {
    if (selectedTokens.has(token)) overlapCount++;
  }
  const minTokenCount = Math.min(hitTokens.size, selectedTokens.size);
  const heavyGuidanceOverlap = overlapCount >= 3 || (minTokenCount >= 3 && overlapCount >= minTokenCount - 1);
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
  let distinctSpecificity = false;
  for (const token of hitSpecificity) {
    if (selectedSpecificity.has(token)) continue;
    distinctSpecificity = true;
    break;
  }

  return {
    heavyGuidanceOverlap,
    distinctWhy: !!hitWhy && hitWhy !== selectedWhy,
    distinctHow: !!hitHow && hitHow !== selectedHow,
    distinctSpecificity,
  };
}

function durableAddsDistinctSupport(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
  query?: string,
): boolean {
  if (hit.source !== 'durable' || !hit.durableEntry) return true;
  const matchedTerms = new Set<string>();
  for (const term of hit.matchedTerms || []) {
    const normalizedTerm = String(term || '').trim().toLowerCase();
    if (normalizedTerm) matchedTerms.add(normalizedTerm);
  }
  const queryNeedsWhy = queryLooksLikeWhyIntent(query || '');
  const queryNeedsHow = queryLooksLikeHowIntent(query || '');
  const queryNeedsCurrentState = queryLooksLikeCurrentStateIntent(query || '');

  if (queryNeedsCurrentState && hit.durableEntry.category === 'project') {
    const hasSelectedReferencePointer = selectedHasReferencePointer(selected);
    if (hasSelectedReferencePointer) {
      let matchedSpecificity = false;
      for (const term of matchedTerms) {
        if (!isConcreteCurrentStateAnchor(term)) continue;
        matchedSpecificity = true;
        break;
      }
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
      let matchedSpecificity = false;
      for (const term of matchedTerms) {
        if (!isDistinctMatchedQueryAspect(term)) continue;
        matchedSpecificity = true;
        break;
      }
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
      const compactLines = renderSelectiveMemorySurfaceLines(entry, { fallbackLabel: 'fact', query, compactPriorContext: true });
      for (const line of compactLines) {
        lines.push(line);
      }
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
  const lines: string[] = [];
  if (fields.guidance) lines.push(fields.guidance);
  if (fields.why) lines.push(fields.why);
  if (shouldSurfaceSelectiveHowToApply(entry, fields) && fields.howToApply) lines.push(fields.howToApply);
  return lines.join('\n');
}

function durableSupportEvidenceText(entry: ConsolidatedMemoryEntry): string {
  const supportText = durableSupportText(entry);
  if (entry.category !== 'reference') return supportText;

  let text = supportText;
  for (const rolloutFile of entry.rolloutFiles) {
    if (!rolloutFile) continue;
    text = text ? `${text}\n${rolloutFile}` : rolloutFile;
  }
  return text;
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
  const selectedFiles = new Set<string>();
  for (const item of selected) {
    const files = (item.durableEntry?.filesTouched ?? item.record.filesTouched) || [];
    for (const value of files) {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) selectedFiles.add(normalized);
    }
  }
  for (const value of hit.record.filesTouched) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized && !selectedFiles.has(normalized)) return true;
  }

  const selectedTools = new Set<string>();
  for (const item of selected) {
    const tools = (item.durableEntry?.toolsUsed ?? item.record.toolsUsed) || [];
    for (const value of tools) {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) selectedTools.add(normalized);
    }
  }
  for (const value of hit.record.toolsUsed) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized && !selectedTools.has(normalized)) return true;
  }

  for (const selectedHit of selected) {
    if (!hitProvidesReferencePointer(selectedHit)) continue;
    const selectedReferenceTokens = hitReferenceEvidenceTokens(selectedHit);
    const hitReferenceTokens = extractReferenceEvidenceTokens(hit.record.text);
    for (const token of hitReferenceTokens) {
      if (!selectedReferenceTokens.has(token)) return true;
    }
  }

  return false;
}

function rawAddsDistinctReferenceSupport(
  hit: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'][number],
  selected: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
): boolean {
  for (const selectedHit of selected) {
    if (!hitProvidesReferencePointer(selectedHit)) continue;
    const selectedReferenceTokens = hitReferenceEvidenceTokens(selectedHit);
    const hitReferenceTokens = extractReferenceEvidenceTokens(hit.record.text);
    let hasDistinctReferenceEvidence = false;
    for (const token of hitReferenceTokens) {
      if (selectedReferenceTokens.has(token)) continue;
      hasDistinctReferenceEvidence = true;
      break;
    }
    if (!hasDistinctReferenceEvidence) continue;

    const selectedMatchedTerms = new Set<string>();
    for (const term of selectedHit.matchedTerms || []) {
      selectedMatchedTerms.add(String(term || '').toLowerCase());
    }

    let specificOverlap = false;
    for (const rawTerm of hit.matchedTerms || []) {
      const term = String(rawTerm || '').toLowerCase();
      if (!selectedMatchedTerms.has(term) || LOW_SIGNAL_REFERENCE_TERMS.has(term)) continue;
      specificOverlap = true;
      break;
    }
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
  for (const term of hit.matchedTerms || []) {
    if (isConcreteCurrentStateAnchor(term)) return true;
  }
  return false;
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

  let selectedText = '';
  for (const item of selected) {
    const text = item.durableEntry ? durableSupportText(item.durableEntry) : item.record.text;
    if (!text) continue;
    selectedText = selectedText ? `${selectedText}\n${text}` : text;
  }
  const selectedTokens = new Set(extractSpecificityTokens(selectedText));
  const hitTokens = extractSpecificityTokens(hit.record.text);
  for (const token of hitTokens) {
    if (!selectedTokens.has(token)) return true;
  }
  return false;
}

function selectAutoRecallHits(
  hits: Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'],
  maxResults: number,
  query?: string,
): Awaited<ReturnType<WorkspaceMemories['searchMemory']>>['hits'] {
  const matchHits: typeof hits = [];
  const durableMatches: typeof hits = [];
  const rawMatches: typeof hits = [];
  let hasDurableReferencePointer = false;
  for (const hit of hits) {
    if (hit.reason !== 'match') continue;
    matchHits.push(hit);
    if (hit.source === 'durable' && hit.durableEntry) {
      durableMatches.push(hit);
      if (hit.durableEntry.category === 'reference') hasDurableReferencePointer = true;
    } else if (hit.source !== 'durable') {
      rawMatches.push(hit);
    }
  }
  if (matchHits.length === 0) return [];

  const usingDurablePool = durableMatches.length > 0;
  const selected: typeof matchHits = [];
  const coveredDurableKeys = new Set<string>();
  const seenRecordIds = new Set<string>();

  const sortedSeedPool = matchHits;
  sortedSeedPool.sort((a, b) => {
    const currentStateOrder = currentStateHitSupportOrder(a, b, query);
    if (currentStateOrder !== 0) return currentStateOrder;
    const duplicateDurableOrder = duplicateDurableCanonicalOrder(a, b);
    if (duplicateDurableOrder !== 0) return duplicateDurableOrder;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    if (a.source !== b.source) return a.source === 'durable' ? -1 : 1;
    return memoryHitLastConfirmedAt(b) - memoryHitLastConfirmedAt(a);
  });

  const sortedDurableMatches = durableMatches;
  sortedDurableMatches.sort((a, b) => {
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

  const sortedSupplementalPool = usingDurablePool ? rawMatches : matchHits;
  sortedSupplementalPool.sort((a, b) => {
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

  if (usingDurablePool) {
    const preferCurrentStateDurablePointerFirst = shouldPreferCurrentStateDurablePointerFirst({
      query,
      hasDurableReferencePointer,
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

  for (const hit of sortedDurableMatches) {
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
  openaiCompatibleThinking: string;
  textVerbosity: string;
  taskMaxOutputChars: number;
  snapshot: LingyunAgentRuntimeSnapshot;
};

const TEXT_VERBOSITY_VALUES = new Set(['', 'low', 'medium', 'high']);

type InstructionFileLoadingSettings = {
  includeGlobal: boolean;
  maxCharsPerFile: number;
  maxTotalChars: number;
};

function getConfiguredTextVerbosity(cfg: vscode.WorkspaceConfiguration): string {
  const raw = cfg.get<unknown>('llm.textVerbosity', '');
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return TEXT_VERBOSITY_VALUES.has(normalized) ? normalized : '';
}

function getNumberSetting(cfg: vscode.WorkspaceConfiguration, path: string, fallback: number, minimum: number): number {
  const raw = cfg.get<unknown>(path);
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= minimum ? Math.floor(parsed as number) : fallback;
}

function getConfiguredInstructionFileSettings(cfg: vscode.WorkspaceConfiguration): InstructionFileLoadingSettings {
  return {
    includeGlobal: cfg.get<boolean>('instructionFiles.includeGlobal', true) ?? true,
    maxCharsPerFile: getNumberSetting(cfg, 'instructionFiles.maxCharsPerFile', 60000, 1000),
    maxTotalChars: getNumberSetting(cfg, 'instructionFiles.maxTotalChars', 180000, 1000),
  };
}

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

    const preparedRun: LingyunAgentPreparedRun = { runtime: runtime.snapshot };
    if (syntheticContexts.length > 0) preparedRun.syntheticContexts = syntheticContexts;
    return preparedRun;
  }

  private async prepareRuntime(ctx: LingyunAgentRuntimeContext): Promise<PreparedRuntime> {
    // A new session must observe instruction files created after an earlier
    // session cached the same lookup path. Established sessions replay their
    // persisted system prompt snapshot in the SDK, so refreshing discovery
    // cannot rewrite an already-sent provider prefix.
    await this.refreshInstructions(!ctx.session.getSystemPromptSnapshot()?.length);

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const allowExternalPaths =
      cfg.get<boolean>('security.allowExternalPaths', false) ?? false;
    const reasoningEffort = getConfiguredReasoningEffort();
    const openaiCompatibleThinking = getConfiguredOpenAICompatibleThinking();
    const textVerbosity = getConfiguredTextVerbosity(cfg);
    const taskMaxOutputChars = cfg.get<number>('subagents.task.maxOutputChars', 8000) ?? 8000;
    const skills = {
      enabled: cfg.get<boolean>('skills.enabled', true) ?? true,
      paths: cfg.get<string[]>('skills.paths') || [],
      maxPromptSkills: getNumberSetting(cfg, 'skills.maxPromptSkills', 50, 0),
      maxInjectSkills: getNumberSetting(cfg, 'skills.maxInjectSkills', 5, 1),
      maxInjectChars: getNumberSetting(cfg, 'skills.maxInjectChars', 20000, 1),
    };

    const modelId = String(ctx.config.model || '').trim();
    const modelLimit =
      modelId ? getModelLimit(modelId, ctx.llm.id) ?? (await ctx.warmModelLimit(modelId)) : undefined;
    const systemPrompt = this.composeSystemPromptText(ctx.config.systemPrompt);
    const compaction = getCompactionConfig();

    const snapshot: LingyunAgentRuntimeSnapshot = {
      systemPrompt,
      allowExternalPaths,
      reasoningEffort,
      openaiCompatibleThinking,
      textVerbosity,
      taskMaxOutputChars,
      skills,
      compaction,
      modelLimits: undefined,
    };
    if (modelId && modelLimit) snapshot.modelLimits = { [modelId]: modelLimit };

    return {
      systemPrompt,
      allowExternalPaths,
      reasoningEffort,
      openaiCompatibleThinking,
      textVerbosity,
      taskMaxOutputChars,
      snapshot,
    };
  }

  private getWorkspaceRootForContext(): vscode.Uri | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const workspaceFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    return workspaceFolder?.uri ?? getPrimaryWorkspaceFolderUri();
  }

  private async refreshInstructions(force = false): Promise<void> {
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
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const extraInstructionPatterns = cfg.get<string[]>('instructions') || [];
    const instructionFileSettings = getConfiguredInstructionFileSettings(cfg);

    const key = [
      startDir.toString(),
      stopDir.toString(),
      workspaceRoot?.toString() || '',
      JSON.stringify(extraInstructionPatterns),
      JSON.stringify(instructionFileSettings),
    ].join('|');

    if (!force && this.instructionsKey === key) return;
    this.instructionsKey = key;

    try {
      const loaded = await loadInstructions({
        startDir,
        workspaceRoot,
        stopDir,
        extraInstructionPatterns,
        includeGlobal: instructionFileSettings.includeGlobal,
        maxCharsPerFile: instructionFileSettings.maxCharsPerFile,
        maxTotalChars: instructionFileSettings.maxTotalChars,
      });
      this.instructionsText = loaded.text;
    } catch {
      this.instructionsText = undefined;
    }
  }

  private composeSystemPromptText(basePrompt?: string): string {
    const prompt = typeof basePrompt === 'string' && basePrompt.trim() ? basePrompt : DEFAULT_SYSTEM_PROMPT;
    return this.instructionsText ? `${prompt}\n\n${this.instructionsText}` : prompt;
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
    const exploreRuntime: LingyunAgentRuntimeSnapshot = {
      allowExternalPaths: runtime.allowExternalPaths,
      reasoningEffort: runtime.reasoningEffort,
      openaiCompatibleThinking: runtime.openaiCompatibleThinking,
      textVerbosity: runtime.textVerbosity,
      taskMaxOutputChars: runtime.taskMaxOutputChars,
      skills: runtime.snapshot.skills,
      compaction: runtime.snapshot.compaction,
    };
    if (exploreModelLimit) exploreRuntime.modelLimits = { [exploreModelId]: exploreModelLimit };

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
      runtime: exploreRuntime,
    });

    let truncated = false;
    exploreText = exploreText.trimEnd();
    if (exploreText.length > maxChars) {
      exploreText = exploreText.slice(0, maxChars).trimEnd();
      truncated = true;
    }

    let injected = `<subagent_explore_context>\n${exploreText}`;
    if (truncated) injected += '\n\n\n... [TRUNCATED]';
    injected += '\n</subagent_explore_context>';

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

    const now = Date.now();
    const ageCutoffMs = now - memoriesConfig.autoRecallMaxAgeDays * 24 * 60 * 60 * 1000;
    const eligibleMatchHits: typeof search.hits = [];
    let hasMatchHit = false;
    for (const hit of search.hits) {
      if (hit.reason !== 'match') continue;
      hasMatchHit = true;
      const lastConfirmedAt = memoryHitLastConfirmedAt(hit);
      const freshness = hit.durableEntry?.freshness ?? hit.record.staleness;
      if (lastConfirmedAt < ageCutoffMs || freshness === 'invalidated' || hit.score < memoriesConfig.autoRecallMinScore) continue;
      eligibleMatchHits.push(hit);
    }
    if (!hasMatchHit || eligibleMatchHits.length === 0) return undefined;

    const currentStateQuery = queryLooksLikeCurrentStateIntent(query || '');
    const recentTools = recentToolNamesFromSession(ctx.session);
    const toolAwareEligibleMatchHits: typeof eligibleMatchHits = [];
    for (const hit of eligibleMatchHits) {
      if (shouldSuppressActiveToolUsageMemory({ hit, query, recentTools })) continue;
      toolAwareEligibleMatchHits.push(hit);
    }
    if (toolAwareEligibleMatchHits.length === 0) return undefined;

    const recentlySurfacedHitSignatures = getRecentlySurfacedMemoryHitSignatures({
      session: ctx.session,
      currentStateQuery,
      eligibleHits: toolAwareEligibleMatchHits,
      query,
    });
    let selectionPool: typeof toolAwareEligibleMatchHits = toolAwareEligibleMatchHits;
    if (recentlySurfacedHitSignatures.size > 0) {
      const freshEligibleMatchHits: typeof toolAwareEligibleMatchHits = [];
      for (const hit of toolAwareEligibleMatchHits) {
        if (recentlySurfacedHitSignatures.has(memoryRecallHitSignature(hit))) continue;
        freshEligibleMatchHits.push(hit);
      }
      if (freshEligibleMatchHits.length > 0) selectionPool = freshEligibleMatchHits;
    }
    const selectedHits = selectAutoRecallHits(selectionPool, memoriesConfig.maxAutoRecallResults, query);

    if (selectedHits.length === 0) return undefined;

    let topScore = Number.NEGATIVE_INFINITY;
    let secondScore = Number.NEGATIVE_INFINITY;
    let hasDurableGuidance = false;
    for (const hit of selectedHits) {
      if (hit.source === 'durable' && hit.durableEntry) hasDurableGuidance = true;
      const score = hit.score;
      if (score > topScore) {
        secondScore = topScore;
        topScore = score;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
    if (topScore === Number.NEGATIVE_INFINITY) topScore = 0;
    if (secondScore === Number.NEGATIVE_INFINITY) secondScore = 0;
    if (topScore < memoriesConfig.autoRecallMinScore) return undefined;
    if (!hasDurableGuidance && selectedHits.length > 1 && topScore - secondScore < memoriesConfig.autoRecallMinScoreGap) {
      return undefined;
    }
    if (hasMemoryContradictionConflicts(selectedHits)) return undefined;

    const lines: string[] = [
      '<memory_recall_context>',
      'Use this recalled context only if it is relevant to the current turn.',
      'Prefer curated durable guidance when present; treat raw memory as supporting evidence, not the primary instruction surface.',
      'Treat recalled memory as prior context, not guaranteed-current truth. Verify drift-prone facts before acting on them.',
    ];
    if (hasExplicitForgetMemoryIntent(query)) {
      lines.push(
        'The user is asking to forget memory. Use matching recalled entries only to identify recordId/durableKey for maintain_memory action=invalidate; do not rely on the forgotten content as guidance.',
      );
    }
    if (hasExplicitMemoryRecallIntent(query)) {
      lines.push(
        'The user explicitly asked to recall/check memory. Use this recalled context as a starting point; call get_memory search if it is insufficient or missing expected details.',
      );
    }
    if (explicitMemoryScope) lines.push(`scope_filter: ${explicitMemoryScope}`);
    lines.push(
      '## Before recommending from recalled memory',
      '- If a recalled memory names a file path, check that the file still exists before recommending or editing it.',
      '- If it names a function, symbol, setting, flag, endpoint, or command, grep/read the current workspace before relying on it.',
      '- For recent or current-state questions, prefer current files, git history, or the referenced source over frozen memory snapshots.',
      '- If current evidence contradicts recalled memory, trust the current evidence and use maintain_memory to confirm, invalidate, or supersede the stale memory.',
      `query: ${query}`,
      '',
    );

    let emitted = 0;
    const precedingHits: typeof selectedHits = [];
    for (const hit of selectedHits) {
      if (emitted >= memoriesConfig.maxAutoRecallResults) break;
      const label = hit.source === 'durable' ? `durable:${hit.durableEntry?.category || 'memory'}` : hit.record.kind;
      const confidence = hit.durableEntry?.confidence ?? hit.record.confidence;
      const freshness = hit.durableEntry?.freshness ?? hit.record.staleness;
      const scope = hit.durableEntry?.scope ?? hit.record.scope;
      const lastConfirmedAt = memoryHitLastConfirmedAt(hit);
      const files = hit.durableEntry?.filesTouched ?? hit.record.filesTouched;
      const tools = hit.durableEntry?.toolsUsed ?? hit.record.toolsUsed;
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
        const additiveLines = renderAdditiveDurableSurfaceLines(hit.durableEntry, precedingHits, query);
        if (additiveLines && additiveLines.length > 0) {
          for (const line of additiveLines) {
            lines.push(line);
          }
        } else {
          const surfaceLines = renderSelectiveMemorySurfaceLines(hit.durableEntry, { fallbackLabel: 'fact', query });
          for (const line of surfaceLines) {
            lines.push(line);
          }
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
      precedingHits.push(hit);
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

    const surfacedFacetsByHitSignature: RecentMemoryRecallState['surfacedFacetsByHitSignature'] = {};
    for (const hit of selectedHits) {
      const hitSignature = memoryRecallHitSignature(hit);
      if (!hitSignature) continue;
      surfacedFacetsByHitSignature[hitSignature] = memoryRecallSurfacedFacetsForHit(hit, query);
    }

    recentMemoryRecallBySession.set(ctx.session, {
      signature: memoryRecallSelectionSignature(selectedHits),
      hitSignatures: collectMemoryRecallHitSignatures(selectedHits),
      completedUserTurns: countCompletedUserTurns(ctx.session) + 1,
      angleSignature: memoryRecallAngleSignature(query),
      surfacedFacetsByHitSignature,
    });

    return {
      transientContext: 'memoryRecall',
      text: recallText,
      persistAfterCompaction: true,
      maxCharsAfterCompaction: MEMORY_RECALL_COMPACTION_RESTORE_MAX_CHARS,
    };
  }
}
