/**
 * Webview settings readers/normalizers extracted from methods.webview.ts.
 *
 * Owns how VS Code `lingyun.*` configuration is read, normalized, validated,
 * and compared for the chat webview, so the giant webview service object does
 * not need to know settings shapes.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { appendErrorLog } from '../../core/logger';
import { createToolFilterMatcher, normalizeToolFilterSetting } from '../../core/toolFilter';
import { toolRegistry } from '../../core/registry';
import type { MemoryDropResult, MemoryUpdateResult } from '../../core/memories';
import { formatErrorForUser } from './utils';
import { postInputNotice } from './inputNotice';
import type { ChatImageAttachment } from './types';

export function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizeCandidatePath(raw: string): string {
  let value = stripWrappingQuotes(raw || '');
  if (!value) return '';
  if (value.startsWith('file://')) {
    try {
      return vscode.Uri.parse(value).fsPath;
    } catch {
      // ignore
    }
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    try {
      value = path.join(os.homedir(), value.slice(2));
    } catch {
      // ignore
    }
  }
  return value;
}

export const MAX_WEBVIEW_IMAGE_ATTACHMENTS = 8;
export const MAX_WEBVIEW_IMAGE_DATA_URL_LENGTH = 12_000_000;
export const MAX_WEBVIEW_IMAGE_FILENAME_LENGTH = 512;
/**
 * Canonical webview image-attachment protocol: `data:image/…` URLs only,
 * bounded by the three MAX_WEBVIEW_IMAGE_* limits above. This is the single
 * owner of the rule; callers that re-validate attachments (e.g. the runner's
 * user-input normalization) must go through here instead of re-implementing it.
 */
export function normalizeImageAttachments(raw: unknown): ChatImageAttachment[] {
  if (!Array.isArray(raw)) return [];

  const normalized: ChatImageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const record = item as Record<string, unknown>;
    const mediaType = typeof record.mediaType === 'string' ? record.mediaType.trim() : '';
    const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl.trim() : '';
    const filenameRaw = typeof record.filename === 'string'
      ? record.filename.trim().slice(0, MAX_WEBVIEW_IMAGE_FILENAME_LENGTH)
      : '';

    if (!mediaType.toLowerCase().startsWith('image/')) continue;
    if (!dataUrl.startsWith('data:image/')) continue;
    if (dataUrl.length > MAX_WEBVIEW_IMAGE_DATA_URL_LENGTH) continue;

    normalized.push({
      mediaType,
      dataUrl,
      ...(filenameRaw ? { filename: filenameRaw } : {}),
    });

    if (normalized.length >= MAX_WEBVIEW_IMAGE_ATTACHMENTS) break;
  }

  return normalized;
}
export const MAX_WEBVIEW_COMPOSER_SUBMISSION_ID_LENGTH = 160;
export const LLM_PROVIDER_IDS = new Set(['copilot', 'codexSubscription', 'openaiCompatible']);
export const TOOL_CATALOG_ID_COLLATOR = new Intl.Collator();
export const CHAT_WEBVIEW_SCRIPT_PARTS = [
  ['chat', 'bootstrap.js'],
  ['chat', 'render-utils.js'],
  ['chat', 'render-messages.js'],
  ['chat', 'context.js'],
  ['chat', 'main.js'],
] as const;

export type LlmProviderId = 'copilot' | 'codexSubscription' | 'openaiCompatible';

export function hasOwnEnumerableKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function countOwnEnumerableKeys(value: object, limit?: number): number {
  let count = 0;
  for (const key in value) {
    if (!hasOwnEnumerableKey(value, key)) continue;
    count++;
    if (typeof limit === 'number' && count >= limit) return count;
  }
  return count;
}

export function normalizeLlmProviderId(providerId: string): LlmProviderId | undefined {
  const normalized = String(providerId || '').trim();
  if (!LLM_PROVIDER_IDS.has(normalized)) return undefined;
  return normalized as LlmProviderId;
}

export function getConfiguredLlmProviderId(): LlmProviderId {
  const configured = vscode.workspace.getConfiguration('lingyun').get<string>('llmProvider', 'copilot') ?? 'copilot';
  return normalizeLlmProviderId(configured) ?? 'copilot';
}

export function getPlanFirstEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('planFirst', true) ?? true;
}

export function getAutoApproveEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('autoApprove', false) ?? false;
}

export function getShowThinkingEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('showThinking', true) ?? true;
}

export function getMemoriesFeatureEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('features.memories', true) ?? true;
}

export function getAllowExternalPathsEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
}

export function getBlockGitPushEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('security.blockGitPush', true) ?? true;
}

export function getSkillsEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
}

export type SkillsBudget = {
  maxPromptSkills: number;
  maxInjectSkills: number;
  maxInjectChars: number;
};

export type SkillSearchPaths = string[];

export function appendNormalizedStringListItem(value: unknown, seen: Set<string>, normalized: string[], maxItems: number): boolean {
  if (typeof value !== 'string') return true;
  const normalizedValue = value.trim();
  if (!normalizedValue || seen.has(normalizedValue)) return true;
  seen.add(normalizedValue);
  normalized.push(normalizedValue);
  return normalized.length < maxItems;
}

export function normalizeSeparatedStringList(input: unknown, maxItems = 100): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      if (!appendNormalizedStringListItem(input[i], seen, normalized, maxItems)) break;
    }
    return normalized;
  }

  if (typeof input !== 'string') return normalized;
  let itemStart = 0;
  for (let i = 0; i <= input.length; i++) {
    if (i < input.length) {
      const charCode = input.charCodeAt(i);
      if (charCode !== 10 && charCode !== 44) continue;
    }
    if (!appendNormalizedStringListItem(input.slice(itemStart, i), seen, normalized, maxItems)) break;
    itemStart = i + 1;
  }
  return normalized;
}

export function normalizeSkillSearchPaths(input: unknown): SkillSearchPaths {
  return normalizeSeparatedStringList(input);
}

export function getSkillSearchPaths(): SkillSearchPaths {
  return normalizeSkillSearchPaths(vscode.workspace.getConfiguration('lingyun').get<unknown>('skills.paths', []));
}

export function getSkillsBudget(): SkillsBudget {
  return {
    maxPromptSkills: getNumberSetting('skills.maxPromptSkills', 50, 0),
    maxInjectSkills: getNumberSetting('skills.maxInjectSkills', 5, 1),
    maxInjectChars: getNumberSetting('skills.maxInjectChars', 20000, 1),
  };
}

export function skillsBudgetEqual(left: SkillsBudget, right: SkillsBudget): boolean {
  return left.maxPromptSkills === right.maxPromptSkills &&
    left.maxInjectSkills === right.maxInjectSkills &&
    left.maxInjectChars === right.maxInjectChars;
}

export function getSubagentModelOverride(): string {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('subagents.model');
  return typeof raw === 'string' ? raw.trim() : '';
}

export function normalizeSubagentModelOverride(model: string): string {
  return model.trim().slice(0, 200);
}

export function getSessionsPersistEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('sessions.persist', true) ?? true;
}

export function getSessionsMaxSessions(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('sessions.maxSessions');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1 ? Math.floor(parsed as number) : 20;
}

export function getSessionsMaxSessionBytes(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('sessions.maxSessionBytes');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1000 ? Math.floor(parsed as number) : 2_000_000;
}

export type SessionRetentionLimits = {
  maxSessions: number;
  maxSessionBytes: number;
};

export function getSessionRetentionLimits(): SessionRetentionLimits {
  return {
    maxSessions: getSessionsMaxSessions(),
    maxSessionBytes: getSessionsMaxSessionBytes(),
  };
}

export type ToolRuntimeLimits = {
  toolTimeoutMs: number;
  readMaxLines: number;
  bashBackgroundTtlMs: number;
  bashBackgroundCaptureMs: number;
  bashBackgroundCaptureLines: number;
  workspaceShellTimeoutMs: number;
  httpTimeoutMs: number;
};

export type ToolFilter = string[];
export type ToolCatalogItem = {
  id: string;
  name: string;
  description: string;
  readOnly: boolean;
  requiresApproval: boolean;
  category: string;
  parameters: unknown;
  required: string[];
};
export const MAX_MANUAL_TOOL_RESULT_CHARS = 12_000;
export type InstructionPatterns = string[];
export type InstructionFileSettings = {
  includeGlobal: boolean;
  maxCharsPerFile: number;
  maxTotalChars: number;
};
export type WorkspaceEnv = Record<string, string>;

export type DebugSettingsUi = {
  details: boolean;
  llm: boolean;
  tools: boolean;
  plugins: boolean;
  effectiveLlm: boolean;
  effectiveTools: boolean;
  effectivePlugins: boolean;
};

export type PluginSettings = {
  plugins: string[];
  autoDiscover: boolean;
  workspaceDir: string;
};

export type OpenAICompatibleSettings = {
  baseURL: string;
  defaultModelId: string;
  apiKeyEnv: string;
  allowInsecureTLS: boolean;
  modelDisplayNames: Record<string, string>;
};

export type CodexSubscriptionSettings = {
  defaultModelId: string;
};

export type ModelLimitEntry = {
  context: number;
  output?: number;
};

export type ModelLimits = Record<string, ModelLimitEntry>;

export function normalizeToolFilter(input: unknown): ToolFilter {
  return normalizeToolFilterSetting(input);
}

export function getToolFilter(): ToolFilter {
  return normalizeToolFilter(vscode.workspace.getConfiguration('lingyun').get<unknown>('toolFilter', []));
}

export function stringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function hasListItemLongerThan(values: readonly string[], maxLength: number): boolean {
  for (let i = 0; i < values.length; i++) {
    if (values[i].length > maxLength) return true;
  }
  return false;
}

export function collectRequiredParameterNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const required: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (typeof value === 'string') required.push(value);
  }
  return required;
}

export function collectManualToolConfirmationReasons(tool: { metadata?: { readOnly?: boolean; requiresApproval?: boolean } }): string[] {
  const reasons: string[] = [];
  if (tool.metadata?.readOnly !== true) {
    reasons.push('it may change workspace/editor state');
  }
  if (tool.metadata?.requiresApproval === true) {
    reasons.push('it normally requires approval during agent runs');
  }
  return reasons;
}

export function compareToolCatalogItemsById(left: ToolCatalogItem, right: ToolCatalogItem): number {
  return TOOL_CATALOG_ID_COLLATOR.compare(left.id, right.id);
}

export type ToolCatalogState = {
  total: number;
  shown: number;
  filter: ToolFilter;
  tools: ToolCatalogItem[];
};

export async function buildToolCatalogForUI(): Promise<ToolCatalogState> {
  const filter = getToolFilter();
  const allowTool = createToolFilterMatcher(filter);
  const allTools = await toolRegistry.getTools();
  const tools: ToolCatalogItem[] = [];
  for (const tool of allTools) {
    if (!allowTool(tool.id)) continue;
    const parameters = tool.parameters || { type: 'object', properties: {} };
    tools.push({
      id: tool.id,
      name: tool.name || tool.id,
      description: tool.description || '',
      readOnly: tool.metadata?.readOnly === true,
      requiresApproval: tool.metadata?.requiresApproval === true,
      category: tool.metadata?.category || tool.metadata?.permission || 'tool',
      parameters,
      required: collectRequiredParameterNames(parameters.required),
    });
  }
  if (tools.length > 1) tools.sort(compareToolCatalogItemsById);
  return { total: allTools.length, shown: tools.length, filter, tools };
}

export function formatManualToolResultData(data: unknown): { text: string; truncated: boolean } {
  let raw: string;
  if (data === undefined) {
    raw = '';
  } else if (typeof data === 'string') {
    raw = data;
  } else {
    try {
      raw = JSON.stringify(data, null, 2) ?? String(data);
    } catch {
      raw = String(data);
    }
  }
  if (raw.length <= MAX_MANUAL_TOOL_RESULT_CHARS) return { text: raw, truncated: false };
  return {
    text: `${raw.slice(0, MAX_MANUAL_TOOL_RESULT_CHARS)}\n…truncated ${raw.length - MAX_MANUAL_TOOL_RESULT_CHARS} chars. Full output is in the LingYun logs.`,
    truncated: true,
  };
}

export function formatMemoryUpdateMessage(result: MemoryUpdateResult): string {
  return result.enabled
    ? `Memories updated: scanned ${result.scannedSessions}, processed ${result.processedSessions}, retained ${result.retainedOutputs}.`
    : 'Memories feature is disabled.';
}

export function formatMemoryDropMessage(result: MemoryDropResult): string {
  return `Dropped memories: removed ${result.removedStateOutputs} stored outputs.`;
}

export function normalizeInstructionPatterns(input: unknown): InstructionPatterns {
  return normalizeSeparatedStringList(input);
}

export function getInstructionPatterns(): InstructionPatterns {
  return normalizeInstructionPatterns(vscode.workspace.getConfiguration('lingyun').get<unknown>('instructions', []));
}

export function getInstructionFileSettings(): InstructionFileSettings {
  return {
    includeGlobal: vscode.workspace.getConfiguration('lingyun').get<boolean>('instructionFiles.includeGlobal', true) ?? true,
    maxCharsPerFile: getNumberSetting('instructionFiles.maxCharsPerFile', 60000, 1000),
    maxTotalChars: getNumberSetting('instructionFiles.maxTotalChars', 180000, 1000),
  };
}

export function instructionFileSettingsEqual(left: InstructionFileSettings, right: InstructionFileSettings): boolean {
  return left.includeGlobal === right.includeGlobal &&
    left.maxCharsPerFile === right.maxCharsPerFile &&
    left.maxTotalChars === right.maxTotalChars;
}

export function normalizeWorkspaceEnv(input: unknown): WorkspaceEnv {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const normalized: WorkspaceEnv = {};
  let count = 0;
  for (const rawKey in source) {
    if (!hasOwnEnumerableKey(source, rawKey)) continue;
    const rawValue = source[rawKey];
    const key = rawKey.trim().slice(0, 120);
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (typeof rawValue !== 'string') continue;
    if (!hasOwnEnumerableKey(normalized, key)) count++;
    normalized[key] = rawValue.slice(0, 10000);
    if (count >= 100) break;
  }
  return normalized;
}

export function getWorkspaceEnvValidationError(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Workspace environment must be an object.';
  }
  const source = input as Record<string, unknown>;
  if (countOwnEnumerableKeys(source, 101) > 100) return 'At most 100 workspace environment variables can be configured.';
  for (const rawKey in source) {
    if (!hasOwnEnumerableKey(source, rawKey)) continue;
    const rawValue = source[rawKey];
    const key = rawKey.trim();
    if (!key) return 'Workspace environment variable names cannot be empty.';
    if (key.length > 120) return 'Workspace environment variable names must be 120 characters or shorter.';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return `Workspace environment variable "${key}" must use a valid environment variable name.`;
    }
    if (typeof rawValue !== 'string') return `Workspace environment variable "${key}" must have a string value.`;
    if (rawValue.length > 10000) return `Workspace environment variable "${key}" value must be 10000 characters or shorter.`;
  }
  return undefined;
}

export function getWorkspaceEnv(): WorkspaceEnv {
  return normalizeWorkspaceEnv(vscode.workspace.getConfiguration('lingyun').get<unknown>('env', {}));
}

export function workspaceEnvEqual(left: WorkspaceEnv, right: WorkspaceEnv): boolean {
  if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
  for (const key in left) {
    if (!hasOwnEnumerableKey(left, key)) continue;
    if (!hasOwnEnumerableKey(right, key) || left[key] !== right[key]) return false;
  }
  return true;
}

export function getDebugSettingsForUi(): DebugSettingsUi {
  const config = vscode.workspace.getConfiguration('lingyun');
  const details = config.get<boolean>('debug.details', false) ?? false;
  const llm = config.get<boolean>('debug.llm', false) ?? false;
  const tools = config.get<boolean>('debug.tools', false) ?? false;
  const plugins = config.get<boolean>('debug.plugins', false) ?? false;
  return {
    details,
    llm,
    tools,
    plugins,
    effectiveLlm: details || llm,
    effectiveTools: details || tools,
    effectivePlugins: details || plugins,
  };
}

export function normalizeDebugSettings(input: Partial<DebugSettingsUi>, current = getDebugSettingsForUi()): DebugSettingsUi {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const details = typeof source.details === 'boolean' ? source.details : current.details;
  const llm = typeof source.llm === 'boolean' ? source.llm : current.llm;
  const tools = typeof source.tools === 'boolean' ? source.tools : current.tools;
  const plugins = typeof source.plugins === 'boolean' ? source.plugins : current.plugins;
  return {
    details,
    llm,
    tools,
    plugins,
    effectiveLlm: details || llm,
    effectiveTools: details || tools,
    effectivePlugins: details || plugins,
  };
}

export function debugSettingsEqual(left: DebugSettingsUi, right: DebugSettingsUi): boolean {
  return left.details === right.details &&
    left.llm === right.llm &&
    left.tools === right.tools &&
    left.plugins === right.plugins;
}

export function normalizePluginSpecs(input: unknown): string[] {
  return normalizeSeparatedStringList(input);
}

export function normalizePluginWorkspaceDir(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  return raw || '.lingyun';
}

export function getPluginSettings(): PluginSettings {
  const config = vscode.workspace.getConfiguration('lingyun');
  return {
    plugins: normalizePluginSpecs(config.get<unknown>('plugins', [])),
    autoDiscover: config.get<boolean>('plugins.autoDiscover', false) ?? false,
    workspaceDir: normalizePluginWorkspaceDir(config.get<unknown>('plugins.workspaceDir', '.lingyun')),
  };
}

export function pluginSettingsEqual(left: PluginSettings, right: PluginSettings): boolean {
  return left.autoDiscover === right.autoDiscover &&
    left.workspaceDir === right.workspaceDir &&
    stringListsEqual(left.plugins, right.plugins);
}

export function normalizeOpenAICompatibleText(input: unknown, maxLength: number): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  return raw.slice(0, maxLength);
}

export function normalizeOpenAICompatibleModelDisplayNames(input: unknown): Record<string, string> {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const normalized: Record<string, string> = {};
  let count = 0;
  for (const rawKey in source) {
    if (!hasOwnEnumerableKey(source, rawKey)) continue;
    const rawValue = source[rawKey];
    const key = rawKey.trim().slice(0, 200);
    const value = typeof rawValue === 'string' ? rawValue.trim().slice(0, 200) : '';
    if (!key || !value) continue;
    if (!hasOwnEnumerableKey(normalized, key)) count++;
    normalized[key] = value;
    if (count >= 100) break;
  }
  return normalized;
}

export function getOpenAICompatibleModelDisplayNamesValidationError(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'OpenAI-compatible model display names must be an object.';
  }
  const source = input as Record<string, unknown>;
  if (countOwnEnumerableKeys(source, 101) > 100) {
    return 'OpenAI-compatible model display names must include 100 aliases or fewer.';
  }
  for (const rawKey in source) {
    if (!hasOwnEnumerableKey(source, rawKey)) continue;
    const rawValue = source[rawKey];
    const key = rawKey.trim();
    if (!key) return 'OpenAI-compatible model display name aliases must include a model ID.';
    if (key.length > 200) return 'OpenAI-compatible model IDs must be 200 characters or fewer.';
    if (typeof rawValue !== 'string') return 'OpenAI-compatible model display names must be strings.';
    const value = rawValue.trim();
    if (!value) return 'OpenAI-compatible model display names cannot be empty.';
    if (value.length > 200) return 'OpenAI-compatible model display names must be 200 characters or fewer.';
  }
  return undefined;
}

export function getOpenAICompatibleSettings(): OpenAICompatibleSettings {
  const config = vscode.workspace.getConfiguration('lingyun');
  return {
    baseURL: normalizeOpenAICompatibleText(config.get<unknown>('openaiCompatible.baseURL', ''), 500),
    defaultModelId: normalizeOpenAICompatibleText(config.get<unknown>('openaiCompatible.defaultModelId', ''), 200),
    apiKeyEnv: normalizeOpenAICompatibleText(config.get<unknown>('openaiCompatible.apiKeyEnv', 'OPENAI_API_KEY'), 120) || 'OPENAI_API_KEY',
    allowInsecureTLS: config.get<unknown>('openaiCompatible.allowInsecureTLS') === true,
    modelDisplayNames: normalizeOpenAICompatibleModelDisplayNames(config.get<unknown>('openaiCompatible.modelDisplayNames', {})),
  };
}

export function stringRecordEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
  for (const key in left) {
    if (!hasOwnEnumerableKey(left, key)) continue;
    if (!hasOwnEnumerableKey(right, key) || left[key] !== right[key]) return false;
  }
  return true;
}

export function openAICompatibleSettingsEqual(left: OpenAICompatibleSettings, right: OpenAICompatibleSettings): boolean {
  return left.baseURL === right.baseURL &&
    left.defaultModelId === right.defaultModelId &&
    left.apiKeyEnv === right.apiKeyEnv &&
    left.allowInsecureTLS === right.allowInsecureTLS &&
    stringRecordEqual(left.modelDisplayNames, right.modelDisplayNames);
}

export function getCodexSubscriptionSettings(): CodexSubscriptionSettings {
  return {
    defaultModelId: normalizeOpenAICompatibleText(
      vscode.workspace.getConfiguration('lingyun').get<unknown>('codexSubscription.defaultModelId', 'gpt-5.3-codex'),
      200
    ) || 'gpt-5.3-codex',
  };
}

export function parsePositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : undefined;
}

export function normalizeModelLimits(input: unknown): ModelLimits {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const normalized: ModelLimits = {};
  let count = 0;
  for (const rawKey in source) {
    if (!hasOwnEnumerableKey(source, rawKey)) continue;
    const rawValue = source[rawKey];
    const key = rawKey.trim().slice(0, 240);
    if (!key || !rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const entry = rawValue as Record<string, unknown>;
    const context = parsePositiveInteger(entry.context);
    if (!context) continue;
    const output = parsePositiveInteger(entry.output);
    if (!hasOwnEnumerableKey(normalized, key)) count++;
    const normalizedEntry: ModelLimitEntry = { context };
    if (output) normalizedEntry.output = output;
    normalized[key] = normalizedEntry;
    if (count >= 100) break;
  }
  return normalized;
}

export function getModelLimitsValidationError(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Model limits must be an object.';
  }
  const source = input as Record<string, unknown>;
  if (countOwnEnumerableKeys(source, 101) > 100) return 'At most 100 model limit entries can be configured.';
  for (const rawKey in source) {
    if (!hasOwnEnumerableKey(source, rawKey)) continue;
    const rawValue = source[rawKey];
    const key = rawKey.trim();
    if (!key) return 'Model limit keys cannot be empty.';
    if (key.length > 240) return 'Model limit keys must be 240 characters or shorter.';
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      return `Model limit "${key}" must be an object.`;
    }
    const entry = rawValue as Record<string, unknown>;
    const context = parsePositiveInteger(entry.context);
    if (!context) return `Model limit "${key}" needs a positive context token count.`;
    if (Object.prototype.hasOwnProperty.call(entry, 'output') && entry.output !== undefined && entry.output !== null && entry.output !== '') {
      const output = parsePositiveInteger(entry.output);
      if (!output) return `Model limit "${key}" output token count must be positive when provided.`;
    }
  }
  return undefined;
}

export function getModelLimits(): ModelLimits {
  return normalizeModelLimits(vscode.workspace.getConfiguration('lingyun').get<unknown>('modelLimits', {}));
}

export function modelLimitsEqual(left: ModelLimits, right: ModelLimits): boolean {
  if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
  for (const key in left) {
    if (!hasOwnEnumerableKey(left, key) || !hasOwnEnumerableKey(right, key)) return false;
    const leftEntry = left[key];
    const rightEntry = right[key];
    if (leftEntry.context !== rightEntry.context || leftEntry.output !== rightEntry.output) return false;
  }
  return true;
}

export function getNumberSetting(path: string, fallback: number, minimum: number): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>(path);
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= minimum ? Math.floor(parsed as number) : fallback;
}

export function getToolRuntimeLimits(): ToolRuntimeLimits {
  return {
    toolTimeoutMs: getNumberSetting('toolTimeoutMs', 0, 0),
    readMaxLines: getNumberSetting('tools.read.maxLines', 300, 1),
    bashBackgroundTtlMs: getNumberSetting('tools.bash.backgroundTtlMs', 600000, 0),
    bashBackgroundCaptureMs: getNumberSetting('tools.bash.backgroundCaptureMs', 2000, 0),
    bashBackgroundCaptureLines: getNumberSetting('tools.bash.backgroundCaptureLines', 50, 0),
    workspaceShellTimeoutMs: getNumberSetting('tools.workspaceShell.timeoutMs', 60000, 0),
    httpTimeoutMs: getNumberSetting('tools.http.timeoutMs', 30000, 0),
  };
}

export function toolRuntimeLimitsEqual(left: ToolRuntimeLimits, right: ToolRuntimeLimits): boolean {
  return left.toolTimeoutMs === right.toolTimeoutMs
    && left.readMaxLines === right.readMaxLines
    && left.bashBackgroundTtlMs === right.bashBackgroundTtlMs
    && left.bashBackgroundCaptureMs === right.bashBackgroundCaptureMs
    && left.bashBackgroundCaptureLines === right.bashBackgroundCaptureLines
    && left.workspaceShellTimeoutMs === right.workspaceShellTimeoutMs
    && left.httpTimeoutMs === right.httpTimeoutMs;
}

export type CompactionToolOutputMode = 'afterToolCall' | 'onCompaction';

export type GenerationSettings = {
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
  maxIterations: number;
  maxRetries: number;
  retryWithPartialOutput: boolean;
  timeoutMs: number;
  textVerbosity: string;
};

export const TEXT_VERBOSITY_VALUES = new Set(['', 'low', 'medium', 'high']);

export function normalizeTextVerbosity(input: unknown, fallback = ''): string {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : fallback;
  return TEXT_VERBOSITY_VALUES.has(raw) ? raw : fallback;
}

export function getConfiguredTemperature(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('temperature');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(2, parsed as number)) : 0;
}

export function getConfiguredTopP(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('topP');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed as number)) : 0;
}

export function getConfiguredTopK(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('topK');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : 0;
}

export function getConfiguredMaxOutputTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('maxOutputTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : 32000;
}

export function getConfiguredMaxIterations(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('maxIterations');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  if (parsed === -1) return -1;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : 50;
}

export function getConfiguredMaxRetries(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.maxRetries');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 2;
}

export function getConfiguredRetryWithPartialOutput(): boolean {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.retryWithPartialOutput');
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.toLowerCase() === 'true';
  return true;
}

export function getConfiguredLlmTimeoutMs(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.timeoutMs');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 0;
}

export function getConfiguredTextVerbosity(): string {
  return normalizeTextVerbosity(
    vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.textVerbosity', ''),
    ''
  );
}

export function getGenerationSettings(): GenerationSettings {
  return {
    temperature: getConfiguredTemperature(),
    topP: getConfiguredTopP(),
    topK: getConfiguredTopK(),
    maxOutputTokens: getConfiguredMaxOutputTokens(),
    maxIterations: getConfiguredMaxIterations(),
    maxRetries: getConfiguredMaxRetries(),
    retryWithPartialOutput: getConfiguredRetryWithPartialOutput(),
    timeoutMs: getConfiguredLlmTimeoutMs(),
    textVerbosity: getConfiguredTextVerbosity(),
  };
}

export function generationSettingsEqual(left: GenerationSettings, right: GenerationSettings): boolean {
  return left.temperature === right.temperature
    && left.topP === right.topP
    && left.topK === right.topK
    && left.maxOutputTokens === right.maxOutputTokens
    && left.maxIterations === right.maxIterations
    && left.maxRetries === right.maxRetries
    && left.retryWithPartialOutput === right.retryWithPartialOutput
    && left.timeoutMs === right.timeoutMs
    && left.textVerbosity === right.textVerbosity;
}

export function getMemoryAutoRecallEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('memories.autoRecall', true) ?? true;
}

export function getMemoryAutoRecallMaxResults(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.maxAutoRecallResults');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1 ? Math.floor(parsed as number) : 4;
}

export function getMemoryAutoRecallMaxTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.maxAutoRecallTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 100 ? Math.floor(parsed as number) : 1200;
}

export function getMemoryAutoRecallMinScore(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.autoRecallMinScore');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.min(100, parsed as number) : 7;
}

export function getMemoryAutoRecallMinScoreGap(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.autoRecallMinScoreGap');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.min(50, parsed as number) : 1.25;
}

export function getMemoryAutoRecallMaxAgeDays(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.autoRecallMaxAgeDays');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1 ? Math.min(3650, Math.floor(parsed as number)) : 45;
}

export type MemoryAutoRecallBudget = {
  maxResults: number;
  maxTokens: number;
};

export function getMemoryAutoRecallBudget(): MemoryAutoRecallBudget {
  return {
    maxResults: getMemoryAutoRecallMaxResults(),
    maxTokens: getMemoryAutoRecallMaxTokens(),
  };
}

export type MemoryAutoRecallFilters = {
  minScore: number;
  minScoreGap: number;
  maxAgeDays: number;
};

export function getMemoryAutoRecallFilters(): MemoryAutoRecallFilters {
  return {
    minScore: getMemoryAutoRecallMinScore(),
    minScoreGap: getMemoryAutoRecallMinScoreGap(),
    maxAgeDays: getMemoryAutoRecallMaxAgeDays(),
  };
}

export type MemoryAdvancedLimits = {
  maxRawMemoriesForGlobal: number;
  maxRolloutAgeDays: number;
  maxRolloutsPerStartup: number;
  minRolloutIdleHours: number;
  maxStateOutputs: number;
  maxRecords: number;
  maxSearchResults: number;
  maxResultsPerKind: number;
  searchNeighborWindow: number;
};

export function getMemoryAdvancedLimits(): MemoryAdvancedLimits {
  return {
    maxRawMemoriesForGlobal: Math.min(2000, getNumberSetting('memories.maxRawMemoriesForGlobal', 120, 1)),
    maxRolloutAgeDays: Math.min(3650, getNumberSetting('memories.maxRolloutAgeDays', 30, 1)),
    maxRolloutsPerStartup: Math.min(2000, getNumberSetting('memories.maxRolloutsPerStartup', 24, 1)),
    minRolloutIdleHours: Math.min(24 * 30, getNumberSetting('memories.minRolloutIdleHours', 2, 0)),
    maxStateOutputs: Math.min(5000, getNumberSetting('memories.maxStateOutputs', 500, 10)),
    maxRecords: Math.min(50000, getNumberSetting('memories.maxRecords', 5000, 100)),
    maxSearchResults: Math.min(100, getNumberSetting('memories.maxSearchResults', 8, 1)),
    maxResultsPerKind: Math.min(20, getNumberSetting('memories.maxResultsPerKind', 3, 1)),
    searchNeighborWindow: Math.min(5, getNumberSetting('memories.searchNeighborWindow', 1, 0)),
  };
}

export function memoryAdvancedLimitsEqual(left: MemoryAdvancedLimits, right: MemoryAdvancedLimits): boolean {
  return left.maxRawMemoriesForGlobal === right.maxRawMemoriesForGlobal
    && left.maxRolloutAgeDays === right.maxRolloutAgeDays
    && left.maxRolloutsPerStartup === right.maxRolloutsPerStartup
    && left.minRolloutIdleHours === right.minRolloutIdleHours
    && left.maxStateOutputs === right.maxStateOutputs
    && left.maxRecords === right.maxRecords
    && left.maxSearchResults === right.maxSearchResults
    && left.maxResultsPerKind === right.maxResultsPerKind
    && left.searchNeighborWindow === right.searchNeighborWindow;
}

export function getExplorePrepassEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('subagents.explorePrepass.enabled', false) ?? false;
}

export function getExplorePrepassMaxChars(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('subagents.explorePrepass.maxChars');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 500 ? Math.floor(parsed as number) : 8000;
}

export function getSubagentTaskMaxOutputChars(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('subagents.task.maxOutputChars');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 500 ? Math.floor(parsed as number) : 8000;
}

export function getAutoCompactionEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('compaction.auto', true) ?? true;
}

export function getCompactionPruneEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('compaction.prune', true) ?? true;
}

export function getCompactionPruneProtectTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('compaction.pruneProtectTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 40000;
}

export function getCompactionPruneMinimumTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('compaction.pruneMinimumTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 20000;
}

export type CompactionPruneSettings = {
  prune: boolean;
  pruneProtectTokens: number;
  pruneMinimumTokens: number;
};

export function getCompactionPruneSettings(): CompactionPruneSettings {
  return {
    prune: getCompactionPruneEnabled(),
    pruneProtectTokens: getCompactionPruneProtectTokens(),
    pruneMinimumTokens: getCompactionPruneMinimumTokens(),
  };
}

export function compactionPruneSettingsEqual(left: CompactionPruneSettings, right: CompactionPruneSettings): boolean {
  return left.prune === right.prune &&
    left.pruneProtectTokens === right.pruneProtectTokens &&
    left.pruneMinimumTokens === right.pruneMinimumTokens;
}

export function getCompactionToolOutputMode(): CompactionToolOutputMode {
  const configured = vscode.workspace.getConfiguration('lingyun').get<unknown>('compaction.toolOutputMode');
  return configured === 'afterToolCall' ? 'afterToolCall' : 'onCompaction';
}

export function normalizeCompactionToolOutputMode(mode: string): CompactionToolOutputMode | undefined {
  return mode === 'onCompaction' || mode === 'afterToolCall' ? mode : undefined;
}

export type WebviewSettingsRuntime = {
  isProcessing: boolean;
  outputChannel?: vscode.OutputChannel;
  postMessage(message: unknown): void;
};

/**
 * Shared "persist a boolean webview setting" flow used by all simple boolean
 * setters (plan-first, auto-approve, external paths, skills, thinking, ...).
 *
 * Owns the hidden protocol once:
 * - block the write while a run is processing (and repost current state)
 * - skip the config write when the value is unchanged (avoids webview state
 *   storms from redundant configuration-change events)
 * - post the new state after a successful write, or log + repost current
 *   state on failure
 *
 * `onChanged` runs after the write attempt (success or failure) so callers
 * can refresh caches before reposting state.
 */
export async function updateBooleanWebviewSetting(params: {
  runtime: WebviewSettingsRuntime;
  configKey: string;
  stateType: string;
  stateField: string;
  getCurrent(): boolean;
  enabled: boolean;
  blockNotice: string;
  failureNotice: string;
  logLabel: string;
  extraState?(): Promise<Record<string, unknown>> | Record<string, unknown>;
  onChanged?(): void | Promise<void>;
}): Promise<void> {
  const { runtime } = params;
  const postState = async (value: boolean): Promise<void> => {
    const extra = params.extraState ? await params.extraState() : undefined;
    runtime.postMessage({ type: params.stateType, [params.stateField]: value, ...(extra || {}) });
  };

  if (runtime.isProcessing) {
    postInputNotice(runtime, params.blockNotice);
    await postState(params.getCurrent());
    return;
  }

  const next = !!params.enabled;
  const current = params.getCurrent();
  if (next === current) {
    await postState(current);
    return;
  }

  try {
    await vscode.workspace.getConfiguration('lingyun').update(params.configKey, next, true);
    await params.onChanged?.();
    await postState(next);
  } catch (error) {
    appendErrorLog(runtime.outputChannel, params.logLabel, error, { tag: 'Webview' });
    postInputNotice(runtime, params.failureNotice);
    await params.onChanged?.();
    await postState(params.getCurrent());
  }
}

export function parseWebviewImageAttachments(raw: unknown): ChatImageAttachment[] {
  return normalizeImageAttachments(raw);
}

export function parseComposerSubmissionId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const id = raw.trim();
  return id && id.length <= MAX_WEBVIEW_COMPOSER_SUBMISSION_ID_LENGTH ? id : '';
}

export function getToastErrorMessage(error: unknown, llmProviderId?: string): string {
  const formatted = formatErrorForUser(error, { llmProviderId });
  const firstLine = getFirstNonEmptyTrimmedLine(formatted);
  return firstLine || 'Unknown error';
}

function getFirstNonEmptyTrimmedLine(value: string): string | undefined {
  let lineStart = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i < value.length && value.charCodeAt(i) !== 10) continue;
    const line = value.slice(lineStart, i).trim();
    if (line) return line;
    lineStart = i + 1;
  }
  return undefined;
}
