import { containsMemorySecret } from './memories/privacy';

export type SessionMemoryCandidateKind =
  | 'decision'
  | 'preference'
  | 'constraint'
  | 'failed_attempt'
  | 'procedure';

export type SessionMemoryCandidateScope = 'session' | 'workspace' | 'user';

export type SessionMemoryCandidateSource = 'user' | 'assistant' | 'tool' | 'derived';
export type SessionMemoryMode = 'enabled' | 'disabled';

export type SessionMemoryCandidate = {
  kind: SessionMemoryCandidateKind;
  text: string;
  scope: SessionMemoryCandidateScope;
  confidence: number;
  source: SessionMemoryCandidateSource;
  explicit?: boolean;
  evidenceCount?: number;
  memoryKey?: string;
  sourceTurnIds?: string[];
};

export type SessionSignalsV1 = {
  version: 1;
  updatedAt: number;
  userIntents: string[];
  assistantOutcomes: string[];
  toolsUsed: string[];
  filesTouched: string[];
};

export type SessionSignalsV2 = {
  version: 2;
  updatedAt: number;
  userIntents: string[];
  assistantOutcomes: string[];
  toolsUsed: string[];
  filesTouched: string[];
  structuredMemories: SessionMemoryCandidate[];
  memoryContext?: {
    external: boolean;
    sources: string[];
    updatedAt: number;
  };
  memoryMode?: {
    mode: SessionMemoryMode;
    reason?: string;
    updatedAt: number;
  };
};

export type SessionSignals = SessionSignalsV2;

const MAX_INTENTS = 8;
const MAX_OUTCOMES = 8;
const MAX_TOOLS = 30;
const MAX_FILES = 50;
const MAX_STRUCTURED_MEMORIES = 40;
const MAX_SOURCE_TURN_IDS = 6;
const MAX_EXTERNAL_CONTEXT_SOURCES = 12;
const MAX_MEMORY_TEXT_CHARS = 240;
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export function hasMemoryOptOutIntent(text: string): boolean {
  return /\b(?:(?:ignore|don't use|do not use|without|no)\s+memor(?:y|ies)|just this snippet|just this code block|i just pasted|summarize the code block i just pasted|explain this pasted snippet)\b/i.test(
    text,
  );
}

export function hasSessionMemoryDisableIntent(text: string): boolean {
  const value = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!value) return false;
  if (
    /\b(?:do\s+not|don't|dont|never|stop|disable|turn\s+off|switch\s+off|opt\s+out\s+of)\b[\s\S]{0,80}\b(?:remember|save|store|persist|record|capture|index|learn)\b[\s\S]{0,80}\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /\b(?:do\s+not|don't|dont|never|stop|disable|turn\s+off|switch\s+off|opt\s+out\s+of)\b[\s\S]{0,80}\b(?:session|conversation|chat|thread)\b[\s\S]{0,80}\bmemor(?:y|ies)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /\b(?:disable|turn\s+off|switch\s+off|opt\s+out\s+of|stop)\b[\s\S]{0,40}\bmemor(?:y|ies)\b[\s\S]{0,80}\b(?:for|from|in|during)\b[\s\S]{0,40}\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /\b(?:no|without)\b[\s\S]{0,40}\bmemor(?:y|ies)\b[\s\S]{0,80}\b(?:for|from|in|during)\b[\s\S]{0,40}\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\b[\s\S]{0,80}\b(?:should|must|can)\s+not\b[\s\S]{0,80}\b(?:be\s+)?(?:remembered|saved|stored|persisted|recorded|indexed)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  return false;
}

export function hasSessionMemoryEnableIntent(text: string): boolean {
  const value = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!value) return false;
  if (
    /\b(?:enable|turn\s+on|switch\s+on|resume|allow|start)\b[\s\S]{0,80}\bmemor(?:y|ies)\b[\s\S]{0,80}\b(?:for|from|in|during)\b[\s\S]{0,40}\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /\b(?:you\s+can|please)\b[\s\S]{0,60}\b(?:remember|save|store|persist|record|capture|index|learn)\b[\s\S]{0,80}\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\b[\s\S]{0,80}\b(?:can|should|may)\s+(?:be\s+)?(?:remembered|saved|stored|persisted|recorded|indexed)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  return false;
}

export function hasRepositoryInstructionPayload(text: string): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^\s*#\s+(?:AGENTS|CLAUDE)\.md\s+instructions\s+for\b/i.test(value)) return true;
  if (/^\s*<INSTRUCTIONS>\s*[\s\S]*<\/INSTRUCTIONS>\s*$/i.test(value)) return true;
  if (
    /\b(?:AGENTS|CLAUDE)\.md\b/i.test(value) &&
    /\b(?:instruction|instructions|payload|documented|according to|source of truth)\b/i.test(value)
  ) {
    return true;
  }
  if (
    value.length >= 240 &&
    /\b(?:AGENTS|CLAUDE)\.md\b/i.test(value) &&
    /\b(?:instructions|development policy|source of truth|current architecture|modes|safety model|debugging|sessions|persistence)\b/i.test(value)
  ) {
    return true;
  }
  return false;
}

export function hasSkillInstructionPayload(text: string): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^\s*<skill>\s*[\s\S]*<name>[\s\S]*<\/name>[\s\S]*<\/skill>\s*$/i.test(value)) return true;
  if (/^\s*<available_skills>[\s\S]*<\/available_skills>\s*$/i.test(value)) return true;
  if (/<available_skills>[\s\S]*<\/available_skills>/i.test(value) && /\bLoad a skill\b/i.test(value)) return true;
  if (/^\s*##\s+Skill:\s+\S[\s\S]*\*\*Base directory\*\*:\s*/i.test(value)) return true;
  return false;
}

function hasMemoryScaffoldingPayload(text: string): boolean {
  return hasRepositoryInstructionPayload(text) || hasSkillInstructionPayload(text);
}

export function hasGeneratedMemoryArtifactPayload(text: string | undefined): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^#\s+MEMORY\b[\s\S]*\bGenerated automatically from persisted LingYun sessions\./i.test(value)) return true;
  if (/^#\s+Memory Summary\b[\s\S]*\bGenerated automatically\./i.test(value)) return true;
  if (/^#\s+Raw Memories\b[\s\S]*\b(?:Merged stage-1 raw memories|No raw memories yet\.)/i.test(value)) return true;
  if (/^#\s+Memory Topic:\s+\S/i.test(value)) return true;
  if (/^#\s+Session Memory(?::|\b)[\s\S]*\bsession_id:\s*\S+[\s\S]*\bgenerated_at:\s*\d{4}-\d{2}-\d{2}T/i.test(value)) return true;
  if (/<memory\s+view="(?:summary|memory|raw|topic|rollout|search|list)"[\s\S]*<\/memory>/i.test(value)) return true;
  return false;
}

export function hasMemorySecretPayload(text: string | undefined): boolean {
  return containsMemorySecret(text);
}

function scopeHintFromText(text: string): SessionMemoryCandidateScope | undefined {
  const value = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!value) return undefined;
  if (
    /\b(?:for|in|during|to)\s+(?:this|current|the)?\s*(?:session|conversation|chat|thread|local(?:\s+(?:scope|memor(?:y|ies)))?)\b/i.test(value) ||
    /\b(?:session|conversation|chat|thread|local)\s+(?:only|memor(?:y|ies)|scope)\b/i.test(value) ||
    /\blocal-scope\b/i.test(value)
  ) {
    return 'session';
  }
  if (
    /\b(?:for|in|to)\s+(?:this|current|the)?\s*(?:project|workspace|repo|repository|codebase|team(?:\s+(?:scope|memor(?:y|ies)))?)\b/i.test(value) ||
    /\b(?:project|workspace|repo|repository|codebase|team)\s+(?:memor(?:y|ies)|scope)\b/i.test(value)
  ) {
    return 'workspace';
  }
  if (
    /\b(?:globally|global|everywhere|for\s+all\s+projects|across\s+projects|all\s+workspaces|for\s+me|my\s+profile|user\s+(?:memor(?:y|ies)|scope)|personal\s+(?:memor(?:y|ies)|scope)|private\s+(?:memor(?:y|ies)|scope))\b/i.test(
      value,
    )
  ) {
    return 'user';
  }
  return undefined;
}

function recallScopeHintFromText(text: string): SessionMemoryCandidateScope | undefined {
  const value = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!value) return undefined;

  const scopedMemory = scopeHintFromText(value);
  if (scopedMemory) return scopedMemory;

  if (
    /\b(?:this|current|the)?\s*(?:session|conversation|chat|thread)\s+(?:memory|memories|context)\b/i.test(value)
  ) {
    return 'session';
  }
  if (
    /\b(?:this|current|the)?\s*(?:project|workspace|repo|repository|codebase)\s+(?:memory|memories|context)\b/i.test(
      value,
    )
  ) {
    return 'workspace';
  }
  if (
    /\b(?:about\s+me|my\s+(?:profile|preferences|preferred|style|personal|global)\b|user\s+memor(?:y|ies)|personal\s+memor(?:y|ies))\b/i.test(
      value,
    )
  ) {
    return 'user';
  }
  return undefined;
}

function stripExplicitRememberScopeHint(payload: string): { payload: string; scope?: SessionMemoryCandidateScope } {
  const trimmed = String(payload || '').trim();
  if (!trimmed) return { payload: '' };

  const prefixPatterns: Array<{ scope: SessionMemoryCandidateScope; pattern: RegExp }> = [
    {
      scope: 'session',
      pattern:
        /^(?:for|in|during|to)\s+(?:this|current|the)?\s*(?:session|conversation|chat|thread|local(?:\s+(?:scope|memory))?)(?:\s+only)?\s*[:-]\s*(?<payload>.+)$/is,
    },
    {
      scope: 'workspace',
      pattern:
        /^(?:for|in|to)\s+(?:this|current|the)?\s*(?:project|workspace|repo|repository|codebase|team(?:\s+(?:scope|memory))?)\s*[:-]\s*(?<payload>.+)$/is,
    },
    {
      scope: 'user',
      pattern:
        /^(?:globally|global|everywhere|for\s+all\s+projects|across\s+projects|all\s+workspaces|for\s+me|my\s+profile|user\s+(?:memory|scope)|personal\s+(?:memory|scope)|private\s+(?:memory|scope))\s*[:-]\s*(?<payload>.+)$/is,
    },
  ];

  for (const { scope, pattern } of prefixPatterns) {
    const match = pattern.exec(trimmed);
    const scopedPayload = match?.groups?.payload?.trim();
    if (scopedPayload) return { payload: scopedPayload, scope };
  }

  const suffixPatterns: Array<{ scope: SessionMemoryCandidateScope; pattern: RegExp }> = [
    {
      scope: 'session',
      pattern:
        /^(?<payload>.+?)\s+(?:for|in|during)\s+(?:this|current|the)?\s*(?:session|conversation|chat|thread|local(?:\s+(?:scope|memory))?)(?:\s+only)?\s*$/is,
    },
    {
      scope: 'workspace',
      pattern:
        /^(?<payload>.+?)\s+(?:for|in)\s+(?:this|current|the)?\s*(?:project|workspace|repo|repository|codebase|team(?:\s+(?:scope|memory))?)\s*$/is,
    },
    {
      scope: 'user',
      pattern:
        /^(?<payload>.+?)\s+(?:globally|everywhere|for\s+all\s+projects|across\s+projects|all\s+workspaces|for\s+me|in\s+my\s+profile|as\s+user\s+memory|as\s+personal\s+memory|as\s+private\s+memory)\s*$/is,
    },
  ];

  for (const { scope, pattern } of suffixPatterns) {
    const match = pattern.exec(trimmed);
    const scopedPayload = match?.groups?.payload?.trim();
    if (scopedPayload) return { payload: scopedPayload, scope };
  }

  return { payload: trimmed, scope: scopeHintFromText(trimmed) };
}

function cleanExplicitRememberPayload(payload: string): string {
  return payload
    .replace(/^(?:that|to)\s+/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function extractExplicitRememberParts(text: string): { payload: string; scope?: SessionMemoryCandidateScope } {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return { payload: '' };

  const patterns: RegExp[] = [
    /^\s*(?:please\s+)?(?:remember|memorize|save|store)\s+(?:this\s+)?(?:for|in|during|to)\s+(?:this|current|the)?\s*(?:session|conversation|chat|thread|local|project|workspace|repo|repository|codebase|team)\s*[:-]\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:remember|memorize|save|store)\s+(?:globally|global|everywhere|for\s+all\s+projects|across\s+projects|all\s+workspaces|for\s+me|my\s+profile|user\s+memory|personal\s+memory|private\s+memory)\s*[:-]\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:remember|memorize|save|store)\s+(?:local|project|workspace|repo|repository|codebase|team|user|personal|private|global)\s+(?:memory|note|preference|context|rule|fact)\s*[:-]\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:remember|memorize)\s+this(?:\s+(?:memory|note|preference|context|rule|fact))?\s*[:-]\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:save|store)\s+this(?:\s+(?:memory|note|preference|context|rule|fact))?\s*[:-]\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:save|store)\s+(?:this\s+)?(?:memory|note|preference|context|rule|fact)\s*[:-]\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:save|store|keep)\s+(?:this\s+)?(?:in|to)\s+memor(?:y|ies)\s*[:-]?\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?keep\s+in\s+mind\s+(?:that\s+)?(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:remember|memorize)\s+(?:that\s+)?(?<payload>.+)$/is,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(compact);
    const payload = match?.groups?.payload?.trim();
    if (!payload) continue;
    const scoped = stripExplicitRememberScopeHint(cleanExplicitRememberPayload(payload));
    const cleaned = cleanExplicitRememberPayload(scoped.payload);
    if (cleaned.length >= 4) {
      return {
        payload: cleaned,
        scope: scoped.scope ?? scopeHintFromText(compact),
      };
    }
  }

  return { payload: '' };
}

export function extractExplicitRememberPayload(text: string): string {
  return extractExplicitRememberParts(text).payload;
}

export function extractExplicitRememberScopeHint(text: string): SessionMemoryCandidateScope | undefined {
  return extractExplicitRememberParts(text).scope;
}

export function hasExplicitRememberMemoryIntent(text: string): boolean {
  return !!extractExplicitRememberPayload(text);
}

function stripExplicitForgetScopeHint(payload: string): { payload: string; scope?: SessionMemoryCandidateScope } {
  const trimmed = String(payload || '').trim();
  if (!trimmed) return { payload: '' };

  const prefixPatterns: Array<{ scope: SessionMemoryCandidateScope; pattern: RegExp }> = [
    {
      scope: 'session',
      pattern:
        /^(?:from\s+)?(?:this|current|the)?\s*(?:session|conversation|chat|thread|local(?:\s+(?:scope|memory))?)\s+(?:memory|memories|context|note|notes)?\s*(?:about|on|regarding|for|:|-)?\s*(?<payload>.+)$/is,
    },
    {
      scope: 'workspace',
      pattern:
        /^(?:from\s+)?(?:this|current|the)?\s*(?:project|workspace|repo|repository|codebase|team(?:\s+(?:scope|memory))?)\s+(?:memory|memories|context|note|notes)?\s*(?:about|on|regarding|for|:|-)?\s*(?<payload>.+)$/is,
    },
    {
      scope: 'user',
      pattern:
        /^(?:from\s+)?(?:global|personal|private|user(?:\s+(?:scope|memory))?)\s+(?:memory|memories|context|note|notes)?\s*(?:about|on|regarding|for|:|-)?\s*(?<payload>.+)$/is,
    },
  ];

  for (const { scope, pattern } of prefixPatterns) {
    const match = pattern.exec(trimmed);
    const scopedPayload = match?.groups?.payload?.trim();
    if (scopedPayload) return { payload: scopedPayload, scope };
  }

  const suffixPatterns: Array<{ scope: SessionMemoryCandidateScope; pattern: RegExp }> = [
    {
      scope: 'session',
      pattern:
        /^(?<payload>.+?)\s+from\s+(?:this|current|the)?\s*(?:session|conversation|chat|thread|local(?:\s+(?:scope|memory))?)\s+(?:memory|memories|context)?\s*$/is,
    },
    {
      scope: 'workspace',
      pattern:
        /^(?<payload>.+?)\s+from\s+(?:this|current|the)?\s*(?:project|workspace|repo|repository|codebase|team(?:\s+(?:scope|memory))?)\s+(?:memory|memories|context)?\s*$/is,
    },
    {
      scope: 'user',
      pattern:
        /^(?<payload>.+?)\s+from\s+(?:global|personal|private|user(?:\s+(?:scope|memory))?)\s+(?:memory|memories|context)?\s*$/is,
    },
  ];

  for (const { scope, pattern } of suffixPatterns) {
    const match = pattern.exec(trimmed);
    const scopedPayload = match?.groups?.payload?.trim();
    if (scopedPayload) return { payload: scopedPayload, scope };
  }

  return { payload: trimmed, scope: scopeHintFromText(trimmed) };
}

function extractExplicitForgetParts(text: string): { payload: string; scope?: SessionMemoryCandidateScope } {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return { payload: '' };
  if (/^\s*(?:do\s+not|don't)\s+forget\b/i.test(compact)) return { payload: '' };

  const patterns: RegExp[] = [
    /^\s*(?:please\s+)?forget\s+(?:about\s+)?(?:that\s+)?(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:remove|delete|clear)\s+(?:this\s+)?(?:local|session|chat|thread|conversation|project|workspace|repo|repository|codebase|team|global|personal|private|user)\s+memor(?:y|ies)\s*(?:about|on|regarding|for|:|-)?\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:remove|delete)\s+(?:this\s+)?(?:memory|note|preference|context|fact|rule)\s*(?:about|that|:|-)?\s*(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:remove|delete)\s+(?<payload>.+?)\s+from\s+memor(?:y|ies)\b/is,
    /^\s*(?:please\s+)?(?:stop|do\s+not|don't)\s+remembering\s+(?<payload>.+)$/is,
    /^\s*(?:please\s+)?(?:do\s+not|don't)\s+remember\s+(?<payload>.+?)\s+(?:anymore|again)\b/is,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(compact);
    const payload = match?.groups?.payload?.trim();
    if (!payload) continue;
    const cleaned = payload
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+(?:from\s+memor(?:y|ies)|anymore|again)\s*$/i, '')
      .trim();
    if (cleaned.length >= 3) {
      const scoped = stripExplicitForgetScopeHint(cleaned);
      if (scoped.payload.length >= 3) {
        return {
          payload: scoped.payload,
          scope: scoped.scope ?? scopeHintFromText(compact),
        };
      }
    }
  }

  return { payload: '' };
}

export function extractExplicitForgetPayload(text: string): string {
  return extractExplicitForgetParts(text).payload;
}

export function extractExplicitForgetScopeHint(text: string): SessionMemoryCandidateScope | undefined {
  const parts = extractExplicitForgetParts(text);
  if (parts.payload) return parts.scope;
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact || !hasExplicitForgetMemoryIntent(compact)) return undefined;
  return recallScopeHintFromText(compact);
}

export function hasExplicitForgetMemoryIntent(text: string): boolean {
  if (extractExplicitForgetPayload(text)) return true;
  if (
    /^\s*(?:please\s+)?(?:forget|remove|delete|clear)\s+(?:all\s+)?(?:local|session|chat|thread|conversation|project|workspace|repo|repository|codebase|team|global|personal|private|user)\s+memor(?:y|ies)\b/i.test(
      summarizeText(text, 240),
    )
  ) {
    return true;
  }
  return /^\s*(?:please\s+)?(?:forget|remove|delete|clear)\s+(?:this|that|the|all)?\s*(?:memory|memories|remembered\s+context)\b/i.test(
    summarizeText(text, 240),
  );
}

export function extractExplicitMemoryRecallQuery(text: string): string {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return '';
  if (hasMemoryOptOutIntent(compact) || extractExplicitRememberPayload(compact) || hasExplicitForgetMemoryIntent(compact)) {
    return '';
  }

  const patterns: RegExp[] = [
    /^\s*(?:please\s+)?(?:check|search|look\s+up|inspect|access)\s+(?:(?:my|the|user|personal|private|global|project|workspace|repo|repository|codebase|team|local|session|chat|thread|conversation)\s+)?memor(?:y|ies)\s*(?:for|about|on|regarding|:)?\s*(?<payload>.*)$/is,
    /^\s*(?:what|which|where|when|why|how)\b(?<payload>.*)\b(?:remember|recall|memor(?:y|ies))\b.*$/is,
    /^\s*(?:do|can|could)\s+you\s+(?:remember|recall)\b(?<payload>.*)$/is,
    /^\s*(?:please\s+)?(?:recall|remember)\s+(?:what\s+)?(?:i|we)\s+(?:said|told\s+you|asked|decided)\s*(?:about|on|regarding|:)?\s*(?<payload>.*)$/is,
    /^\s*(?:what|which|where|when|why|how)\b(?<payload>.*)\b(?:did|have)\s+(?:i|we)\s+(?:tell|say|ask|decide)\b.*$/is,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(compact);
    if (!match) continue;
    const payload = (match.groups?.payload || compact)
      .replace(/\b(?:about|on|regarding|for|from|in)\s+(?:my\s+|the\s+)?memor(?:y|ies)\b/gi, '')
      .replace(/\b(?:what|which|where|when|why|how|do|can|could|you|remember|recall|memory|memories)\b/gi, ' ')
      .replace(/[?.!]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return payload || compact;
  }

  return '';
}

export function extractExplicitMemoryRecallScopeHint(text: string): SessionMemoryCandidateScope | undefined {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact || !extractExplicitMemoryRecallQuery(compact)) return undefined;

  return recallScopeHintFromText(compact) ?? recallScopeHintFromText(extractExplicitMemoryRecallQuery(compact));
}

export function hasExplicitMemoryRecallIntent(text: string): boolean {
  return !!extractExplicitMemoryRecallQuery(text);
}

export function shouldExcludeUserTextFromMemoryCapture(text: string): boolean {
  return (
    hasMemorySecretPayload(text) ||
    hasGeneratedMemoryArtifactPayload(text) ||
    hasExplicitRememberDerivableMemoryPayload(text) ||
    hasSessionMemoryDisableIntent(text) ||
    hasSessionMemoryEnableIntent(text) ||
    hasMemoryOptOutIntent(text) ||
    hasExplicitForgetMemoryIntent(text) ||
    hasExplicitMemoryRecallIntent(text)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function summarizeText(text: string, maxChars: number): string {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return compact.slice(0, maxChars).trimEnd() + '...';
}

function summarizeStructuredMemoryText(text: string, maxChars: number): string {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length === 0) return '';

  const compact = lines.join('\n').trim();
  if (!compact) return '';
  if (lines.length === 1) {
    if (compact.length <= maxChars) return compact;
    return compact.slice(0, maxChars).trimEnd() + '...';
  }

  // For structured multi-line memories, treat line breaks as formatting rather
  // than budget. Preserve complete field lines in order and never clip a
  // trailing `Why:` or `How to apply:` line mid-sentence.
  const contentLength = lines.reduce((total, line) => total + line.length, 0);
  if (contentLength <= maxChars) return compact;

  const kept: string[] = [];
  let remaining = maxChars;
  for (const line of lines) {
    if (line.length > remaining) break;
    kept.push(line);
    remaining -= line.length;
  }
  if (kept.length > 0) return kept.join('\n');

  const firstLine = lines[0] || '';
  return firstLine.slice(0, maxChars).trimEnd() + '...';
}

function trimTrailingSentencePunctuation(text: string): string {
  return String(text || '')
    .replace(/[\s,;:.!?–—-]+$/g, '')
    .trim();
}

function sentenceCaseStart(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function asStructuredSentence(text: string): string {
  const trimmed = trimTrailingSentencePunctuation(text);
  return trimmed ? `${sentenceCaseStart(trimmed)}.` : '';
}

function buildStructuredMemoryText(guidance: string, fields?: { why?: string; howToApply?: string }): string {
  const lines = [guidance].filter(Boolean);
  if (fields?.why) lines.push(`Why: ${fields.why}`);
  if (fields?.howToApply) lines.push(`How to apply: ${fields.howToApply}`);
  return lines.join('\n');
}

function stripLeadingAffirmation(text: string): string {
  return String(text || '')
    .replace(/^(?:yeah|yes|yep|yup|exactly|right|correct|perfect|totally|absolutely|agreed|sounds good)\b[\s,;:.-]*/i, '')
    .trim();
}

function looksLikeWorkflowFeedback(text: string): boolean {
  return /\b(pr|pull request|refactor|split|commit|branch|patch|diff|workflow|approach|tests?|database|mock|mocks|migration|release|build|deploy|plan)\b/i.test(
    text,
  );
}

function looksLikeCommunicationPreference(text: string): boolean {
  return /\b(summary|summaries|response|responses|tone|format|formatted|message|messages|terse|verbose|explanation|writeup)\b/i.test(
    text,
  );
}

function looksLikeProjectTimelineDecision(text: string): boolean {
  return /\b(?:freeze|deadline|launch|cutover|rollout|release branch|release cut|ship|ships?|migration window)\b/i.test(text);
}

function looksLikeProjectWorkSubject(text: string): boolean {
  return /\b(?:we'?re|we are|team is|team's|rewrite|rewriting|rip(?:ping)? out|replace|replacing|migrate|migrating|migration|freeze|freezing|delay|delaying|launch|launching|cutover|rollout|rolling out|release branch|release cut|ship|shipping|deprecat(?:e|ing)|sunset(?:ting)?|retir(?:e|ing)|audit(?:ing)?|switch(?:ing)?|move|moving|remove|removing|pause|pausing|block|blocking)\b/i.test(
    text,
  );
}

function looksLikeProjectMotivationReason(text: string): boolean {
  return /\b(?:legal|compliance|security|privacy|stakeholder|customer|incident|outage|oncall|deadline|release|release branch|release cut|launch|migration|migration window|audit|approval|signoff|roadmap|partner|finance|sales|ops|risk|regression|production|prod|requirement|requirements)\b/i.test(
    text,
  );
}

function looksLikeDerivableCodeState(text: string): boolean {
  return /\b(?:packages|src|lib|app|tests?)\/[A-Za-z0-9_./-]+\b|\b[A-Z][A-Za-z0-9_]+\.[A-Za-z0-9_]+\b|\b(file|function|class|module|symbol|import)\b|\b\w+\.(?:ts|tsx|js|jsx|json|md|py|go|rs|java|kt|yaml|yml|toml)\b/i.test(
    text,
  );
}

function looksLikeDerivableFixOrActivity(text: string): boolean {
  if (/\b(?:pr list|pull request list|activity summary|recent changes|git log|git blame|who changed what)\b/i.test(text)) {
    return true;
  }
  if (!looksLikeDerivableCodeState(text)) return false;
  return /\b(?:fix(?:ed|es|ing)?|debug(?:ged|ging)?|resolv(?:e|ed|es|ing)?|implement(?:ed|s|ing)?|updat(?:e|ed|es|ing)?|chang(?:e|ed|es|ing)?|patch(?:ed|es|ing)?|refactor(?:ed|s|ing)?|wir(?:e|ed|es|ing)?|add(?:ed|s|ing)?|remov(?:e|ed|es|ing)?|renam(?:e|ed|es|ing)?|mov(?:e|ed|es|ing)?|run|ran|test(?:ed|s|ing)?|compil(?:e|ed|es|ing)?|build(?:s|ing)?|built|pnpm|npm|yarn|pytest|cargo|tsc)\b/i.test(
    text,
  );
}

export function hasDerivableCodebaseMemoryPayload(text: string | undefined): boolean {
  const compact = summarizeText(String(text || ''), MAX_MEMORY_TEXT_CHARS);
  if (!compact) return false;
  if (looksLikeDerivableFixOrActivity(compact)) return true;
  if (/\b(?:git history|git log|git blame|commit history|recent changes|who changed what|who-changed-what)\b/i.test(compact)) {
    return true;
  }
  if (/\b(?:debugging solution|debug solution|fix recipe|the fix was|the root cause was)\b/i.test(compact) && looksLikeDerivableCodeState(compact)) {
    return true;
  }
  if (/\b(?:code patterns?|coding conventions?|project structure|repo structure|repository structure|directory structure|folder structure|file paths?|module layout|package layout|source tree)\b/i.test(compact)) {
    return true;
  }
  if (
    /\b(?:architecture|architectural)\b/i.test(compact) &&
    /\b(?:code|codebase|repo|repository|project|service|provider|extension|pipeline|system|module|component|frontend|backend|api|tool)\b/i.test(compact) &&
    !looksLikeProjectMotivationReason(compact)
  ) {
    return true;
  }
  if (
    looksLikeDerivableCodeState(compact) &&
    /\b(?:lives?|located|defined|declared|implemented|registered|wired|entry\s*point|source of truth|belongs in|goes in|file path|imported from|exported from)\b/i.test(
      compact,
    )
  ) {
    return true;
  }
  return false;
}

export function hasExplicitRememberDerivableMemoryPayload(text: string): boolean {
  const payload = extractExplicitRememberPayload(text);
  return !!payload && hasDerivableCodebaseMemoryPayload(payload);
}

type ProjectMotivationCandidate = {
  kind: 'decision' | 'constraint';
  text: string;
  scope: SessionMemoryCandidateScope;
  guidance: string;
};

function looksLikeHowToApplyAction(text: string): boolean {
  return /\b(?:(?:scope decisions?|merge decisions?|review decisions?|scheduling|planning|non-critical work|follow-up work)\s+(?:should|must|can)|(?:flag|favor|avoid|prefer|treat|route|escalate|block|schedule|check|open|verify|defer|hold|prioriti[sz]e))\b/i.test(
    text,
  );
}

function extractExplicitHowToApplyClause(text: string): string {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return '';

  const markerMatch = compact.match(/\b(?:how to apply|apply this by|apply this when|this means)\s+(?<how>.+?)[.!?]?$/i);
  const implicationMatch = compact.match(/\b(?:so|which means)\s+(?<how>.+?)[.!?]?$/i);
  const directAction = looksLikeHowToApplyAction(compact) ? compact : '';
  const howRaw = trimTrailingSentencePunctuation(markerMatch?.groups?.how || implicationMatch?.groups?.how || directAction || '');
  if (!howRaw) return '';
  if (/\b(?:i|we)\s+(?:think|guess|wonder|hope|prefer to explain|want to discuss)\b/i.test(howRaw)) return '';
  if (looksLikeDerivableCodeState(howRaw)) return '';
  if (!looksLikeHowToApplyAction(howRaw)) return '';
  return asStructuredSentence(howRaw);
}

function splitProjectWhyAndHowToApply(text: string): { why: string; howToApply?: string } {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return { why: '' };

  const implicationMatch = compact.match(/^(?<why>.+?)(?:,\s*|\s+)(?:so|which means)\s+(?<how>.+?)\s*[.!?]?$/i);
  const explicitMarkerMatch = compact.match(/^(?<why>.+?)\.\s*(?:how to apply|apply this by|apply this when|this means)\s+(?<how>.+?)\s*[.!?]?$/i);
  const splitMatch = implicationMatch || explicitMarkerMatch;
  if (splitMatch) {
    const whyRaw = trimTrailingSentencePunctuation(splitMatch.groups?.why || '');
    const howRaw = trimTrailingSentencePunctuation(splitMatch.groups?.how || '');
    const howToApply = extractExplicitHowToApplyClause(howRaw);
    if (whyRaw && howToApply) {
      return { why: whyRaw, howToApply };
    }
  }

  return { why: trimTrailingSentencePunctuation(compact) };
}

function extractProjectMotivation(text: string): ProjectMotivationCandidate | undefined {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return undefined;
  if (/\b(?:not yet|do that yet|for now|right now|this turn|this run only|for this run only|wait for me|before i|before we|until i|until we|hold off)\b/i.test(compact)) {
    return undefined;
  }

  const reasonIsPattern = compact.match(/^\s*(?:the\s+reason|reason)\s+(?<subject>.+?)\s+is\s+(?:that\s+)?(?<why>.+?)\s*[.!?]?$/i);
  const becausePattern = compact.match(/^\s*(?<subject>.+?)\s+(?:because|since|due to)\s+(?<why>.+?)\s*[.!?]?$/i);
  const dashPattern = compact.match(/^\s*(?<subject>.+?)\s+[—–-]\s+(?<why>.+?)\s*[.!?]?$/);
  const match = reasonIsPattern || becausePattern || dashPattern;
  if (!match) return undefined;

  const subject = trimTrailingSentencePunctuation(match.groups?.subject || '');
  const whyRaw = trimTrailingSentencePunctuation(match.groups?.why || '');
  if (!subject || !whyRaw) return undefined;
  if (!looksLikeProjectWorkSubject(subject) && !looksLikeProjectTimelineDecision(subject)) return undefined;
  if (!looksLikeProjectMotivationReason(whyRaw) && !looksLikeProjectTimelineDecision(whyRaw)) return undefined;
  if (looksLikeDerivableCodeState(subject)) return undefined;

  const guidanceSentence = asStructuredSentence(subject);
  if (!guidanceSentence) return undefined;
  const split = splitProjectWhyAndHowToApply(whyRaw);
  const why = asStructuredSentence(split.why);
  const howToApply = split.howToApply;
  const kind = /\b(?:must|must not|required|cannot|can't|without|only|at least|at most)\b/i.test(subject)
    ? 'constraint'
    : 'decision';
  return {
    kind,
    scope: 'workspace',
    guidance: guidanceSentence,
    text: buildStructuredMemoryText(guidanceSentence, {
      ...(why ? { why } : {}),
      ...(howToApply ? { howToApply } : {}),
    }),
  };
}

function looksLikeExplicitCorrection(text: string): boolean {
  return /^(?:please\s+)?(?:do\s+not|don't|stop|avoid)\b/i.test(String(text || '').trim()) || /^no\s+[a-z]/i.test(String(text || '').trim());
}

function looksLikeTransientUserPreference(text: string): boolean {
  return /\b(?:not yet|do that yet|for now|right now|this turn|this run only|for this run only|until i|until we|before i|before we|wait for me|wait until|hold off)\b/i.test(
    text,
  );
}

function looksLikeTransientCorrection(text: string): boolean {
  return /\b(?:not yet|do that yet|for now|right now|this turn|this run only|for this run only|until i|until we|before i|before we|hold off|wait for|wait until|wait for me)\b/i.test(
    text,
  );
}

function looksLikeFeedbackHowToApplyAction(text: string): boolean {
  return /\b(?:(?:(?:for|when|in|at)\b[^.?!]*,\s*)?(?:use|keep|omit|avoid|skip|limit|bundle|split|hit)\b|(?:responses?|tests?|refactors?|changes|work|summaries?)\s+(?:should|must|can)\b)\b/i.test(
    text,
  );
}

function extractExplicitFeedbackHowToApplyClause(text: string): string {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return '';

  const markerMatch = compact.match(/\b(?:how to apply|apply this when|apply this by|that means|this means|which means)\s+(?<how>.+?)[.!?]?$/i);
  const implicationMatch = compact.match(/\b(?:so|which means)\s+(?<how>.+?)[.!?]?$/i);
  const scopedActionMatch = compact.match(
    /(?:^|[.!?]\s+)(?<how>(?:(?:for|when|in|at)\b[^.?!]*,\s*)?(?:use|keep|omit|avoid|skip|limit|bundle|split|hit)\b[^.?!]*|(?:responses?|tests?|refactors?|changes|work|summaries?)\s+(?:should|must|can)\b[^.?!]*)(?:[.!?]|$)/i,
  );
  const directAction = looksLikeFeedbackHowToApplyAction(compact) ? compact : '';
  const howRaw = trimTrailingSentencePunctuation(
    markerMatch?.groups?.how || implicationMatch?.groups?.how || scopedActionMatch?.groups?.how || directAction || '',
  );
  if (!howRaw) return '';
  if (/\b(?:i|we)\s+(?:think|guess|wonder|hope|prefer to explain|want to discuss)\b/i.test(howRaw)) return '';
  if (looksLikeDerivableCodeState(howRaw)) return '';
  if (!looksLikeFeedbackHowToApplyAction(howRaw)) return '';
  return asStructuredSentence(howRaw);
}

function splitFeedbackWhyAndHowToApplyText(text: string): { why?: string; howToApply?: string } {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return {};

  const sentencePattern = /(?<sentence>[^.?!]+[.?!]?)/g;
  const sentences = [...compact.matchAll(sentencePattern)]
    .map((match) => trimTrailingSentencePunctuation(match.groups?.sentence || match[0] || ''))
    .filter(Boolean);

  if (sentences.length >= 2) {
    const last = sentences[sentences.length - 1] || '';
    const howToApply = extractExplicitFeedbackHowToApplyClause(last);
    if (howToApply) {
      const whyText = trimTrailingSentencePunctuation(sentences.slice(0, -1).join('. '));
      if (whyText) {
        return { why: asStructuredSentence(whyText), howToApply };
      }
    }
  }

  const implicationMatch = compact.match(
    /^(?<why>.+?)(?:,\s*|\s+)(?:so|which means)\s+(?<how>(?:(?:for|when|in|at)\b[^.?!]*,\s*)?(?:use|keep|omit|avoid|skip|limit|bundle|split|hit)\b[^.?!]*|(?:responses?|tests?|refactors?|changes|work|summaries?)\s+(?:should|must|can)\b[^.?!]*)\s*[.!?]?$/i,
  );
  const sentenceMatch = compact.match(
    /^(?<why>.+?)\.\s*(?<how>(?:(?:for|when|in|at)\b[^.?!]*,\s*)?(?:use|keep|omit|avoid|skip|limit|bundle|split|hit)\b[^.?!]*|(?:responses?|tests?|refactors?|changes|work|summaries?)\s+(?:should|must|can)\b[^.?!]*)\s*[.!?]?$/i,
  );
  const splitMatch = implicationMatch || sentenceMatch;
  if (splitMatch) {
    const whyRaw = trimTrailingSentencePunctuation(splitMatch.groups?.why || '');
    const howRaw = trimTrailingSentencePunctuation(splitMatch.groups?.how || '');
    const howToApply = extractExplicitFeedbackHowToApplyClause(howRaw);
    if (whyRaw && howToApply) {
      return { why: asStructuredSentence(whyRaw), howToApply };
    }
  }

  return { why: asStructuredSentence(compact) };
}

function extractFeedbackWhyAndHowToApply(text: string): { why?: string; howToApply?: string } {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return {};

  const becauseMatch = compact.match(/\b(?:because|since)\s+(?<why>.+?)[.!?]?$/i);
  const dashMatch = compact.match(/\s[—–-]\s*(?<why>.+?)[.!?]?$/);
  const commaMatch = compact.match(/,\s*(?<why>(?:i|we|it|this|that)\b.+?)[.!?]?$/i);
  const whyRaw = trimTrailingSentencePunctuation(
    becauseMatch?.groups?.why || dashMatch?.groups?.why || commaMatch?.groups?.why || '',
  );
  const split = whyRaw ? splitFeedbackWhyAndHowToApplyText(whyRaw) : {};
  const howToApply = split.howToApply || extractExplicitFeedbackHowToApplyClause(compact);
  return {
    ...(split.why ? { why: split.why } : {}),
    ...(howToApply ? { howToApply } : {}),
  };
}

type CorrectiveFeedbackCandidate = {
  kind: 'preference' | 'constraint';
  text: string;
  scope: SessionMemoryCandidateScope;
  guidance: string;
};

function extractCorrectiveFeedback(text: string): CorrectiveFeedbackCandidate | undefined {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return undefined;
  if (!looksLikeExplicitCorrection(compact)) return undefined;
  if (looksLikeTransientCorrection(compact)) return undefined;

  const normalized = compact.toLowerCase();
  let normalizedFeedback:
    | { kind: CorrectiveFeedbackCandidate['kind']; guidance: string; scope: SessionMemoryCandidateScope }
    | undefined;

  if (
    /\bmock(?:s|ed|ing)?\b.*\b(?:database|db|test|tests)\b|\b(?:database|db|test|tests)\b.*\bmock(?:s|ed|ing)?\b/i.test(
      normalized,
    )
  ) {
    normalizedFeedback = {
      kind: 'constraint',
      guidance: 'Integration tests must hit a real database, not mocks.',
      scope: 'workspace',
    };
  } else if (/\bsummar(?:ize|izing|y)\b|\btrailing summaries?\b|\bend of every response\b/i.test(normalized)) {
    normalizedFeedback = {
      kind: 'preference',
      guidance: 'Prefer terse responses with no trailing summaries.',
      scope: 'user',
    };
  } else if (
    /\bsplit(?:ting)?\b.*\b(?:pr|pull request)s?\b|\b(?:pr|pull request)s?\b.*\bsplit(?:ting)?\b|\bmultiple\s+(?:pr|pull request)s?\b|\bmany small pr\b/i.test(
      normalized,
    )
  ) {
    normalizedFeedback = {
      kind: 'preference',
      guidance: 'Prefer one bundled PR over splitting tightly related work into many small PRs.',
      scope: 'workspace',
    };
  }

  if (!normalizedFeedback) return undefined;
  const fields = extractFeedbackWhyAndHowToApply(compact);
  return {
    kind: normalizedFeedback.kind,
    scope: normalizedFeedback.scope,
    guidance: normalizedFeedback.guidance,
    text: buildStructuredMemoryText(normalizedFeedback.guidance, fields),
  };
}

function isLowSignalValidatedFeedbackSubject(subject: string): boolean {
  const normalized = String(subject || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  if (/^(?:this|that|it|thing|things|stuff|the thing|the things|the stuff)$/.test(normalized)) return true;

  const informativeTokens = normalized
    .split(/\s+/)
    .filter((token) => !['a', 'an', 'the', 'this', 'that', 'it', 'these', 'those', 'my', 'our', 'your'].includes(token));
  if (informativeTokens.length === 0) return true;

  return informativeTokens.every((token) =>
    ['approach', 'workflow', 'plan', 'call', 'choice', 'direction', 'way', 'method', 'strategy', 'response'].includes(token),
  );
}

function normalizeValidatedFeedbackGuidance(subject: string): string {
  const normalized = stripLeadingAffirmation(subject).toLowerCase();
  if (/\b(single|one) bundled pr\b|\bbundled pr\b/.test(normalized)) {
    return 'Prefer one bundled PR over splitting tightly related work into many small PRs.';
  }
  if (/\bno trailing summaries?\b|\bterse responses?\b|\bterse summary\b/.test(normalized)) {
    return 'Prefer terse responses with no trailing summaries.';
  }
  if (/\breal database\b|\b(?:no|not) mocks?\b/.test(normalized)) {
    return 'Prefer integration tests against a real database, not mocks.';
  }

  const cleanedSubject = sentenceCaseStart(trimTrailingSentencePunctuation(stripLeadingAffirmation(subject)));
  if (!cleanedSubject) return '';
  if (!looksLikeWorkflowFeedback(cleanedSubject) && !looksLikeCommunicationPreference(cleanedSubject)) {
    return '';
  }
  return `Keep using this validated approach on similar tasks: ${cleanedSubject}.`;
}

function extractValidatedPositiveFeedback(text: string, defaultScope: SessionMemoryCandidateScope): {
  text: string;
  scope: SessionMemoryCandidateScope;
  guidance: string;
} | undefined {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return undefined;

  const normalized = stripLeadingAffirmation(compact);
  const match = normalized.match(
    /^(?<subject>.+?)\s+\b(?:was|is)\s+(?:the\s+)?(?:right|best|good)\s+call(?:\s+here)?(?:[,:;]\s*(?<why>.+))?[.!?]?$/i,
  );
  const subject = trimTrailingSentencePunctuation(match?.groups?.subject || '');
  if (!subject || subject.split(/\s+/).length < 2) return undefined;
  if (isLowSignalValidatedFeedbackSubject(subject)) return undefined;

  const guidance = normalizeValidatedFeedbackGuidance(subject);
  if (!guidance) return undefined;

  const whyRaw = trimTrailingSentencePunctuation(match?.groups?.why || '');
  const split = whyRaw ? splitFeedbackWhyAndHowToApplyText(whyRaw) : {};
  const fields = {
    ...(split.why ? { why: split.why } : whyRaw ? { why: asStructuredSentence(whyRaw) } : {}),
    ...(split.howToApply ? { howToApply: split.howToApply } : {}),
  };
  const structuredText = buildStructuredMemoryText(guidance, fields);
  const scope = looksLikeCommunicationPreference(guidance)
    ? 'user'
    : looksLikeWorkflowFeedback(guidance)
      ? 'workspace'
      : defaultScope === 'session'
        ? 'workspace'
        : defaultScope;
  return { text: structuredText, scope, guidance };
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

function normalizeConfidence(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(0.05, Math.min(1, numeric));
}

function normalizeScope(value: unknown, fallback: SessionMemoryCandidateScope): SessionMemoryCandidateScope {
  return value === 'session' || value === 'workspace' || value === 'user' ? value : fallback;
}

function normalizeSource(value: unknown, fallback: SessionMemoryCandidateSource): SessionMemoryCandidateSource {
  return value === 'user' || value === 'assistant' || value === 'tool' || value === 'derived'
    ? value
    : fallback;
}

function normalizeSourceTurnIds(value: unknown): string[] | undefined {
  const normalized = normalizeStringList(value, MAX_SOURCE_TURN_IDS);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMemoryContext(value: unknown, now: number): SessionSignals['memoryContext'] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.external !== true) return undefined;
  const sources = normalizeStringList(value.sources, MAX_EXTERNAL_CONTEXT_SOURCES);
  const updatedAt =
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? Math.floor(value.updatedAt)
      : now;
  return {
    external: true,
    sources,
    updatedAt,
  };
}

function normalizeSessionMemoryMode(value: unknown, now: number): SessionSignals['memoryMode'] | undefined {
  if (!isRecord(value)) return undefined;
  const mode = value.mode === 'enabled' || value.mode === 'disabled' ? value.mode : undefined;
  if (!mode) return undefined;
  const updatedAt =
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? Math.floor(value.updatedAt)
      : now;
  const reason = typeof value.reason === 'string' ? summarizeText(value.reason, 160) : '';
  return {
    mode,
    ...(reason ? { reason } : {}),
    updatedAt,
  };
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseWeekdayToken(token: string): number | undefined {
  const normalized = String(token || '').trim().toLowerCase();
  const exactIndex = WEEKDAY_NAMES.indexOf(normalized as (typeof WEEKDAY_NAMES)[number]);
  if (exactIndex >= 0) return exactIndex;
  const prefixIndex = WEEKDAY_NAMES.findIndex((weekday) => weekday.startsWith(normalized));
  return prefixIndex >= 0 ? prefixIndex : undefined;
}

function nextWeekdayOnOrAfter(baseTimestamp: number, weekday: number): number {
  const base = startOfUtcDay(baseTimestamp);
  const baseDay = new Date(base).getUTCDay();
  const delta = (weekday - baseDay + 7) % 7;
  return base + delta * 24 * 60 * 60 * 1000;
}

function normalizeRelativeProjectDates(text: string, now: number): string {
  let next = String(text || '').trim();
  if (!next) return '';

  next = next.replace(/\b(?:this|coming)\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gi, (_match, weekday) => {
    const parsed = parseWeekdayToken(weekday);
    return typeof parsed === 'number' ? formatUtcDate(nextWeekdayOnOrAfter(now, parsed)) : weekday;
  });

  next = next.replace(/\bnext\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gi, (_match, weekday) => {
    const parsed = parseWeekdayToken(weekday);
    if (typeof parsed !== 'number') return weekday;
    return formatUtcDate(nextWeekdayOnOrAfter(now + 7 * 24 * 60 * 60 * 1000, parsed));
  });

  next = next.replace(/\b(?<!\d{4}-\d{2}-\d{2}\s)(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gi, (match, weekday, offset, fullText) => {
    const parsed = parseWeekdayToken(weekday);
    if (typeof parsed !== 'number') return match;
    const before = fullText.slice(Math.max(0, offset - 12), offset).toLowerCase();
    if (/\b(last|previous)\s+$/.test(before)) return match;
    return formatUtcDate(nextWeekdayOnOrAfter(now, parsed));
  });

  return next;
}

function canonicalizeMemoryText(text: string): string {
  return summarizeText(text, MAX_MEMORY_TEXT_CHARS)
    .toLowerCase()
    .replace(
      /\b(?:please|we decided to|we decided|decided to|remember this|remember that|remember to|remember|memorize|save this memory|save this note|save to memory|store to memory|keep in memory|keep in mind|should)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMemoryCandidateKey(kind: SessionMemoryCandidateKind, text: string): string {
  const normalized = canonicalizeMemoryText(text);
  if (!normalized) return `${kind}:memory`;
  const tokens = normalized.split(/\s+/).filter(Boolean).slice(0, 12);
  return `${kind}:${tokens.join('-') || 'memory'}`;
}

function candidateDedupeKey(candidate: SessionMemoryCandidate): string {
  return `${candidate.kind}|${candidate.scope}|${candidate.memoryKey || buildMemoryCandidateKey(candidate.kind, candidate.text)}`;
}

function normalizeMemoryCandidate(value: unknown, now = Date.now()): SessionMemoryCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind;
  if (
    kind !== 'decision' &&
    kind !== 'preference' &&
    kind !== 'constraint' &&
    kind !== 'failed_attempt' &&
    kind !== 'procedure'
  ) {
    return undefined;
  }

  const rawText = typeof value.text === 'string' ? value.text : '';
  const memoryKeyRaw = typeof value.memoryKey === 'string' ? value.memoryKey.trim() : '';
  if (hasMemorySecretPayload(rawText) || hasMemorySecretPayload(memoryKeyRaw)) return undefined;

  const normalizedDateText =
    kind === 'decision' || kind === 'constraint'
      ? normalizeRelativeProjectDates(rawText, now)
      : rawText;
  const text = summarizeStructuredMemoryText(normalizedDateText, MAX_MEMORY_TEXT_CHARS);
  if (!text) return undefined;

  const scope = normalizeScope(value.scope, kind === 'preference' ? 'user' : kind === 'failed_attempt' ? 'session' : 'workspace');
  const source = normalizeSource(value.source, 'derived');
  const confidence = normalizeConfidence(value.confidence, kind === 'failed_attempt' ? 0.85 : 0.75);
  const evidenceCountRaw = value.evidenceCount;
  const evidenceCount =
    typeof evidenceCountRaw === 'number' && Number.isFinite(evidenceCountRaw)
      ? Math.max(1, Math.floor(evidenceCountRaw))
      : 1;

  return {
    kind,
    text,
    scope,
    confidence,
    source,
    ...(value.explicit === true ? { explicit: true } : {}),
    evidenceCount,
    memoryKey: memoryKeyRaw || buildMemoryCandidateKey(kind, text),
    sourceTurnIds: normalizeSourceTurnIds(value.sourceTurnIds),
  };
}

function mergeMemoryCandidate(
  signals: SessionSignals,
  candidate: SessionMemoryCandidate,
  now = signals.updatedAt || Date.now(),
): void {
  const next = normalizeMemoryCandidate(candidate, now);
  if (!next) return;

  const dedupeKey = candidateDedupeKey(next);
  const existingIndex = signals.structuredMemories.findIndex((item) => candidateDedupeKey(item) === dedupeKey);
  if (existingIndex >= 0) {
    const existing = signals.structuredMemories[existingIndex];
    const merged: SessionMemoryCandidate = {
      ...existing,
      text: next.text.length >= existing.text.length ? next.text : existing.text,
      confidence: Math.max(existing.confidence, next.confidence),
      explicit: existing.explicit === true || next.explicit === true ? true : undefined,
      evidenceCount: Math.max(1, (existing.evidenceCount || 1) + (next.evidenceCount || 1)),
      sourceTurnIds: normalizeSourceTurnIds([...(existing.sourceTurnIds || []), ...(next.sourceTurnIds || [])]),
    };
    signals.structuredMemories.splice(existingIndex, 1);
    signals.structuredMemories.unshift(merged);
  } else {
    signals.structuredMemories.unshift(next);
  }

  if (signals.structuredMemories.length > MAX_STRUCTURED_MEMORIES) {
    signals.structuredMemories.splice(MAX_STRUCTURED_MEMORIES);
  }
  signals.updatedAt = now;
}

function pushDerivedCandidate(
  candidates: SessionMemoryCandidate[],
  candidate: SessionMemoryCandidate,
  limit = 3,
  now = Date.now(),
): void {
  const normalized = normalizeMemoryCandidate(candidate, now);
  if (!normalized) return;
  if (candidates.some((item) => candidateDedupeKey(item) === candidateDedupeKey(normalized))) return;
  candidates.push(normalized);
  if (candidates.length > limit) {
    candidates.splice(limit);
  }
}

export function deriveStructuredMemoriesFromText(
  text: string,
  options?: {
    source?: SessionMemoryCandidateSource;
    defaultScope?: SessionMemoryCandidateScope;
    confidenceBias?: number;
    sourceTurnIds?: string[];
    now?: number;
  },
): SessionMemoryCandidate[] {
  const compact = summarizeText(text, MAX_MEMORY_TEXT_CHARS);
  if (!compact) return [];
  if (hasMemorySecretPayload(text) || hasMemorySecretPayload(compact)) return [];
  if (hasGeneratedMemoryArtifactPayload(text) || hasGeneratedMemoryArtifactPayload(compact)) return [];
  if (hasMemoryScaffoldingPayload(text) || hasMemoryScaffoldingPayload(compact)) return [];
  if (hasSessionMemoryDisableIntent(compact) || hasSessionMemoryEnableIntent(compact)) return [];

  const source = options?.source ?? 'derived';
  if (source === 'user' && (hasExplicitForgetMemoryIntent(compact) || hasExplicitMemoryRecallIntent(compact))) return [];
  const explicitRememberPayload = source === 'user' ? extractExplicitRememberPayload(compact) : '';
  const analysisText = explicitRememberPayload || compact;
  const hasExplicitRememberIntent = !!explicitRememberPayload;
  const explicitRememberScope = hasExplicitRememberIntent ? extractExplicitRememberScopeHint(compact) : undefined;
  if (hasMemorySecretPayload(analysisText)) return [];
  if (hasDerivableCodebaseMemoryPayload(analysisText)) return [];
  if (hasMemoryOptOutIntent(compact) || hasMemoryOptOutIntent(analysisText)) return [];
  if (
    hasExplicitRememberIntent &&
    (hasMemoryScaffoldingPayload(analysisText) || hasDerivableCodebaseMemoryPayload(analysisText))
  ) {
    return [];
  }

  const defaultScope = explicitRememberScope ?? options?.defaultScope ?? (source === 'user' ? 'user' : 'workspace');
  const confidenceBias = typeof options?.confidenceBias === 'number' ? options.confidenceBias : 0;
  const sourceTurnIds = normalizeSourceTurnIds(options?.sourceTurnIds);
  const now = typeof options?.now === 'number' && Number.isFinite(options.now) ? Math.floor(options.now) : Date.now();
  const candidates: SessionMemoryCandidate[] = [];

  const makeCandidate = (
    kind: SessionMemoryCandidateKind,
    confidence: number,
    scope?: SessionMemoryCandidateScope,
    textOverride?: string,
    memoryKeyTextOverride?: string,
  ): SessionMemoryCandidate => {
    const candidateText = summarizeStructuredMemoryText(textOverride || analysisText, MAX_MEMORY_TEXT_CHARS);
    const rawKeyText = memoryKeyTextOverride || candidateText;
    const keyText =
      kind === 'decision' || kind === 'constraint' ? normalizeRelativeProjectDates(rawKeyText, now) : rawKeyText;
    return {
      kind,
      text: candidateText,
      scope:
        scope ||
        (kind === 'preference'
          ? explicitRememberScope ?? 'user'
          : kind === 'failed_attempt'
            ? 'session'
            : defaultScope),
      confidence: normalizeConfidence(confidence + confidenceBias, confidence + confidenceBias),
      source,
      ...(hasExplicitRememberIntent ? { explicit: true } : {}),
      evidenceCount: 1,
      memoryKey: buildMemoryCandidateKey(kind, keyText),
      ...(sourceTurnIds ? { sourceTurnIds } : {}),
    };
  };

  if (
    source === 'tool' ||
    (source !== 'user' &&
      /\b(failed|failure|didn't work|did not work|error|blocked|timeout|timed out|not found|permission denied|rejected)\b/i.test(
        analysisText,
      ))
  ) {
    pushDerivedCandidate(candidates, makeCandidate('failed_attempt', source === 'tool' ? 0.9 : 0.72, 'session'), 3, now);
  }

  const correctiveFeedback = source === 'user' ? extractCorrectiveFeedback(analysisText) : undefined;
  const validatedFeedback = source === 'user' ? extractValidatedPositiveFeedback(analysisText, defaultScope) : undefined;
  const projectMotivation = source === 'user' ? extractProjectMotivation(analysisText) : undefined;

  if (
    !projectMotivation &&
    (/\b(we decided|decided to|chose to|went with|the decision is|decision:|keep embeddings optional)\b/i.test(analysisText) ||
      looksLikeProjectTimelineDecision(analysisText))
  ) {
    pushDerivedCandidate(candidates, makeCandidate('decision', 0.88, 'workspace'), 3, now);
  }

  if (
    source === 'user' &&
    !validatedFeedback &&
    !correctiveFeedback &&
    !projectMotivation &&
    !looksLikeTransientUserPreference(analysisText) &&
    /\b(prefer|please|avoid|stop|don't|do not|always|never|terse|verbose|no trailing summaries?)\b/i.test(analysisText)
  ) {
    pushDerivedCandidate(candidates, makeCandidate('preference', 0.9, explicitRememberScope ?? 'user'), 3, now);
  }

  if (projectMotivation) {
    pushDerivedCandidate(
      candidates,
      makeCandidate(
        projectMotivation.kind,
        0.9,
        explicitRememberScope ?? projectMotivation.scope,
        projectMotivation.text,
        projectMotivation.guidance,
      ),
      3,
      now,
    );
  }

  if (correctiveFeedback) {
    pushDerivedCandidate(
      candidates,
      makeCandidate(
        correctiveFeedback.kind,
        0.92,
        explicitRememberScope ?? correctiveFeedback.scope,
        correctiveFeedback.text,
        correctiveFeedback.guidance,
      ),
      3,
      now,
    );
  }

  if (validatedFeedback) {
    pushDerivedCandidate(
      candidates,
      makeCandidate('preference', 0.86, explicitRememberScope ?? validatedFeedback.scope, validatedFeedback.text, validatedFeedback.guidance),
      3,
      now,
    );
  }

  if (
    !(source === 'user' && (validatedFeedback || correctiveFeedback || projectMotivation)) &&
    /\b(must|must not|required|cannot|can't|without|only|at least|at most|no mocks?|real database)\b/i.test(analysisText)
  ) {
    const constraintScope =
      explicitRememberScope ??
      (source === 'user' && looksLikeWorkflowFeedback(analysisText)
        ? 'workspace'
        : defaultScope === 'session'
          ? 'workspace'
          : defaultScope);
    pushDerivedCandidate(candidates, makeCandidate('constraint', 0.84, constraintScope), 3, now);
  }

  if (
    source !== 'user' &&
    !looksLikeDerivableFixOrActivity(analysisText) &&
    (/\bstep\s+\d+\b/i.test(analysisText) ||
      /(^|\b)(run|use|set|inject|open|read|search|update|rebuild|refresh|check|grep|call)\b/i.test(analysisText))
  ) {
    pushDerivedCandidate(candidates, makeCandidate('procedure', 0.74, 'workspace'), 3, now);
  }

  if (
    source === 'user' &&
    hasExplicitRememberIntent &&
    candidates.length === 0 &&
    !looksLikeTransientUserPreference(analysisText)
  ) {
    const userScoped = looksLikeCommunicationPreference(analysisText) || /\b(?:i am|i'm|my role|my job|my background|my preference|i prefer)\b/i.test(analysisText);
    const explicitKind: SessionMemoryCandidateKind = /\b(must|must not|required|cannot|can't|without|only|at least|at most|no mocks?|real database)\b/i.test(analysisText)
      ? 'constraint'
      : /(^|\b)(step\s+\d+|run|use|set|inject|open|read|search|update|rebuild|refresh|check|grep|call)\b/i.test(analysisText)
        ? 'procedure'
        : userScoped
          ? 'preference'
          : 'decision';
    pushDerivedCandidate(
      candidates,
      makeCandidate(explicitKind, 0.93, explicitRememberScope ?? (userScoped ? 'user' : 'workspace'), analysisText, analysisText),
      3,
      now,
    );
  }

  return candidates;
}

export function createBlankSessionSignals(now = Date.now()): SessionSignals {
  return {
    version: 2,
    updatedAt: now,
    userIntents: [],
    assistantOutcomes: [],
    toolsUsed: [],
    filesTouched: [],
    structuredMemories: [],
  };
}

export function normalizeSessionSignals(raw: unknown, now = Date.now()): SessionSignals {
  if (!isRecord(raw)) return createBlankSessionSignals(now);

  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? Math.floor(raw.updatedAt) : now;
  const memoryContext = normalizeMemoryContext(raw.memoryContext, now);
  const memoryMode = normalizeSessionMemoryMode(raw.memoryMode, now);
  const base: SessionSignals = {
    version: 2,
    updatedAt,
    userIntents: normalizeStringList(raw.userIntents, MAX_INTENTS),
    assistantOutcomes: normalizeStringList(raw.assistantOutcomes, MAX_OUTCOMES),
    toolsUsed: normalizeStringList(raw.toolsUsed, MAX_TOOLS),
    filesTouched: normalizeStringList(raw.filesTouched, MAX_FILES),
    structuredMemories: [],
    ...(memoryContext ? { memoryContext } : {}),
    ...(memoryMode ? { memoryMode } : {}),
  };

  if (raw.version === 1) {
    return base;
  }
  if (raw.version !== 2) {
    return createBlankSessionSignals(now);
  }

  const structuredMemoriesRaw = Array.isArray(raw.structuredMemories) ? raw.structuredMemories : [];
  for (const item of structuredMemoriesRaw) {
    const normalized = normalizeMemoryCandidate(item);
    if (!normalized) continue;
    mergeMemoryCandidate(base, normalized);
  }

  return base;
}

export function recordStructuredMemory(signals: SessionSignals, candidate: SessionMemoryCandidate): void {
  if (isSessionMemoryDisabled(signals)) return;
  mergeMemoryCandidate(signals, candidate, signals.updatedAt || Date.now());
}

export function isExplicitMemoryCandidate(candidate: SessionMemoryCandidate | undefined): boolean {
  return candidate?.explicit === true;
}

export function markExternalMemoryContext(signals: SessionSignals, source: string, now = Date.now()): void {
  const label = summarizeText(source, 80);
  if (!label) return;
  const existing = signals.memoryContext?.external ? signals.memoryContext : undefined;
  const sources = existing ? [...existing.sources] : [];
  recordUniqueFront(sources, label, MAX_EXTERNAL_CONTEXT_SOURCES);
  signals.memoryContext = {
    external: true,
    sources,
    updatedAt: now,
  };
  signals.updatedAt = now;
}

export function hasExternalMemoryContext(signals: SessionSignals | undefined): boolean {
  return signals?.memoryContext?.external === true;
}

export function setSessionMemoryMode(
  signals: SessionSignals,
  mode: SessionMemoryMode,
  reason?: string,
  now = Date.now(),
): void {
  const summary = summarizeText(reason || '', 160);
  signals.memoryMode = {
    mode,
    ...(summary ? { reason: summary } : {}),
    updatedAt: now,
  };
  signals.updatedAt = now;
}

export function isSessionMemoryDisabled(signals: SessionSignals | undefined): boolean {
  return signals?.memoryMode?.mode === 'disabled';
}

export function recordDecision(signals: SessionSignals, text: string, confidence = 0.85): void {
  if (isSessionMemoryDisabled(signals)) return;
  mergeMemoryCandidate(signals, {
    kind: 'decision',
    text,
    scope: 'workspace',
    confidence,
    source: 'derived',
  });
}

export function recordPreference(signals: SessionSignals, text: string, confidence = 0.9): void {
  if (isSessionMemoryDisabled(signals)) return;
  mergeMemoryCandidate(signals, {
    kind: 'preference',
    text,
    scope: 'user',
    confidence,
    source: 'derived',
  });
}

export function recordConstraint(signals: SessionSignals, text: string, confidence = 0.84): void {
  if (isSessionMemoryDisabled(signals)) return;
  mergeMemoryCandidate(signals, {
    kind: 'constraint',
    text,
    scope: 'workspace',
    confidence,
    source: 'derived',
  });
}

export function recordFailedAttempt(signals: SessionSignals, text: string, confidence = 0.9): void {
  if (isSessionMemoryDisabled(signals)) return;
  mergeMemoryCandidate(signals, {
    kind: 'failed_attempt',
    text,
    scope: 'session',
    confidence,
    source: 'tool',
  });
}

export function recordProcedure(signals: SessionSignals, text: string, confidence = 0.74): void {
  if (isSessionMemoryDisabled(signals)) return;
  mergeMemoryCandidate(signals, {
    kind: 'procedure',
    text,
    scope: 'workspace',
    confidence,
    source: 'derived',
  });
}

export function recordUserIntent(signals: SessionSignals, text: string): void {
  if (hasSessionMemoryDisableIntent(text)) {
    setSessionMemoryMode(signals, 'disabled', text);
    return;
  }
  if (hasSessionMemoryEnableIntent(text)) {
    setSessionMemoryMode(signals, 'enabled', text);
    return;
  }
  if (isSessionMemoryDisabled(signals)) return;
  if (shouldExcludeUserTextFromMemoryCapture(text)) return;
  const explicitRememberPayload = extractExplicitRememberPayload(text);
  const captureText = explicitRememberPayload || text;
  const summary = summarizeText(captureText, 220);
  if (!summary) return;
  if (hasMemorySecretPayload(captureText) || hasMemorySecretPayload(summary)) return;
  if (hasGeneratedMemoryArtifactPayload(text) || hasGeneratedMemoryArtifactPayload(captureText) || hasGeneratedMemoryArtifactPayload(summary)) return;
  if (hasMemoryScaffoldingPayload(text) || hasMemoryScaffoldingPayload(captureText) || hasMemoryScaffoldingPayload(summary)) return;
  if (hasMemoryOptOutIntent(summary)) return;
  if (hasDerivableCodebaseMemoryPayload(captureText) || hasDerivableCodebaseMemoryPayload(summary)) return;
  const now = signals.updatedAt || Date.now();
  recordUniqueFront(signals.userIntents, summary, MAX_INTENTS);
  for (const candidate of deriveStructuredMemoriesFromText(text, { source: 'user', defaultScope: 'user', now })) {
    mergeMemoryCandidate(signals, candidate, now);
  }
  signals.updatedAt = now;
}

export function recordAssistantOutcome(signals: SessionSignals, text: string): void {
  if (isSessionMemoryDisabled(signals)) return;
  const summary = summarizeText(text, 220);
  if (!summary) return;
  if (hasMemorySecretPayload(text) || hasMemorySecretPayload(summary)) return;
  if (hasGeneratedMemoryArtifactPayload(text) || hasGeneratedMemoryArtifactPayload(summary)) return;
  if (hasMemoryScaffoldingPayload(text) || hasMemoryScaffoldingPayload(summary)) return;
  if (hasMemoryOptOutIntent(text)) return;
  if (hasDerivableCodebaseMemoryPayload(summary)) return;
  const now = signals.updatedAt || Date.now();
  recordUniqueFront(signals.assistantOutcomes, summary, MAX_OUTCOMES);
  for (const candidate of deriveStructuredMemoriesFromText(text, { source: 'assistant', defaultScope: 'workspace', now })) {
    mergeMemoryCandidate(signals, candidate, now);
  }
  signals.updatedAt = now;
}

export function recordToolUse(signals: SessionSignals, toolId: string): void {
  if (isSessionMemoryDisabled(signals)) return;
  const value = typeof toolId === 'string' ? toolId.trim() : '';
  if (!value) return;
  recordUniqueFront(signals.toolsUsed, value, MAX_TOOLS);
  signals.updatedAt = Date.now();
}

export function recordFileTouch(signals: SessionSignals, filePath: string): void {
  if (isSessionMemoryDisabled(signals)) return;
  const value = typeof filePath === 'string' ? filePath.trim() : '';
  if (!value) return;
  recordUniqueFront(signals.filesTouched, value, MAX_FILES);
  signals.updatedAt = Date.now();
}
