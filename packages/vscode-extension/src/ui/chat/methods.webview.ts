import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readTodos } from '../../core/todo';
import { toolRegistry } from '../../core/registry';
import { summarizeToolArgsForDebug } from '../../core/agent/debug';
import { getDebugRedactionLevel } from '../../core/debugSettings';
import { appendErrorLog, appendLog } from '../../core/logger';
import { getConfiguredReasoningEffort } from '../../core/reasoningEffort';
import { resolveConfiguredModelId } from '../../core/modelSelection';
import { createToolFilterMatcher, isToolAllowedByFilter, normalizeToolFilterSetting } from '../../core/toolFilter';
import { WorkspaceMemories } from '../../core/memories';
import { createSampleToolsConfig } from '../../providers/workspace';
import type { ModelInfo } from '../../providers/modelCatalog';
import type { MemoryDropResult, MemoryUpdateResult } from '../../core/memories';
import type { LLMProviderWithUi, ProviderAuthUiState } from '../../providers/providerUi';
import { formatErrorForUser, getNonce } from './utils';
import { getWorkspaceFolderUrisByPriority, resolveExistingFilePath } from './fileLinks';
import { buildApprovalStateForUI } from './approvalState';
import type { PendingApprovalEntry } from './controllerPorts';
import type {
  ChatComposerSubmissionState,
  ChatImageAttachment,
  ChatUserInput,
  ChatUserMessageOptions,
} from './types';
import { bindChatControllerService } from './controllerService';
import { createLingyunDiffUri } from './diffContentProvider';
import type { ChatRevertService } from './methods.revert';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatSkillsService } from './methods.skills';
import type { ChatQueueManager } from './queueManager';
import type { RunCoordinator } from './runner/runCoordinator';
import type { ChatController } from './controller';
import {
  getWebviewMessageType,
  parseWebviewErrorMessage,
  parseWebviewInitAckMessage,
  parseWebviewReadyMessage,
  parseWebviewTranscriptHistoryRequest,
  type WebviewTranscriptHistoryRequest,
  WEBVIEW_MESSAGE_ERROR,
  WEBVIEW_MESSAGE_INIT_ACK,
  WEBVIEW_MESSAGE_READY,
  WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE,
  WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
} from './webviewProtocol';
import { handleWebviewInitAckMessage, handleWebviewReadyMessage } from './webviewHandshake';
import { handleWebviewCrashMessage, resetWebviewCrashToastState } from './webviewCrash';
import { postInputNotice } from './inputNotice';
import {
  createEarlierTranscriptPage,
  createInitialTranscriptPage,
} from './transcriptPaging';

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeCandidatePath(raw: string): string {
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

const MAX_WEBVIEW_IMAGE_ATTACHMENTS = 8;
const MAX_WEBVIEW_IMAGE_DATA_URL_LENGTH = 12_000_000;
const MAX_WEBVIEW_IMAGE_FILENAME_LENGTH = 512;
const MAX_WEBVIEW_COMPOSER_SUBMISSION_ID_LENGTH = 160;
const LLM_PROVIDER_IDS = new Set(['copilot', 'codexSubscription', 'openaiCompatible']);
const TOOL_CATALOG_ID_COLLATOR = new Intl.Collator();
const CHAT_WEBVIEW_SCRIPT_PARTS = [
  ['chat', 'bootstrap.js'],
  ['chat', 'render-utils.js'],
  ['chat', 'render-messages.js'],
  ['chat', 'context.js'],
  ['chat', 'main.js'],
] as const;

type LlmProviderId = 'copilot' | 'codexSubscription' | 'openaiCompatible';

function hasOwnEnumerableKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function countOwnEnumerableKeys(value: object, limit?: number): number {
  let count = 0;
  for (const key in value) {
    if (!hasOwnEnumerableKey(value, key)) continue;
    count++;
    if (typeof limit === 'number' && count >= limit) return count;
  }
  return count;
}

function normalizeLlmProviderId(providerId: string): LlmProviderId | undefined {
  const normalized = String(providerId || '').trim();
  if (!LLM_PROVIDER_IDS.has(normalized)) return undefined;
  return normalized as LlmProviderId;
}

function getConfiguredLlmProviderId(): LlmProviderId {
  const configured = vscode.workspace.getConfiguration('lingyun').get<string>('llmProvider', 'copilot') ?? 'copilot';
  return normalizeLlmProviderId(configured) ?? 'copilot';
}

function getPlanFirstEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('planFirst', true) ?? true;
}

function getAutoApproveEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('autoApprove', false) ?? false;
}

function getShowThinkingEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('showThinking', true) ?? true;
}

function getMemoriesFeatureEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('features.memories', true) ?? true;
}

function getAllowExternalPathsEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;
}

function getBlockGitPushEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('security.blockGitPush', true) ?? true;
}

function getSkillsEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('skills.enabled', true) ?? true;
}

type SkillsBudget = {
  maxPromptSkills: number;
  maxInjectSkills: number;
  maxInjectChars: number;
};

type SkillSearchPaths = string[];

function appendNormalizedStringListItem(value: unknown, seen: Set<string>, normalized: string[], maxItems: number): boolean {
  if (typeof value !== 'string') return true;
  const normalizedValue = value.trim();
  if (!normalizedValue || seen.has(normalizedValue)) return true;
  seen.add(normalizedValue);
  normalized.push(normalizedValue);
  return normalized.length < maxItems;
}

function normalizeSeparatedStringList(input: unknown, maxItems = 100): string[] {
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

function normalizeSkillSearchPaths(input: unknown): SkillSearchPaths {
  return normalizeSeparatedStringList(input);
}

function getSkillSearchPaths(): SkillSearchPaths {
  return normalizeSkillSearchPaths(vscode.workspace.getConfiguration('lingyun').get<unknown>('skills.paths', []));
}

function getSkillsBudget(): SkillsBudget {
  return {
    maxPromptSkills: getNumberSetting('skills.maxPromptSkills', 50, 0),
    maxInjectSkills: getNumberSetting('skills.maxInjectSkills', 5, 1),
    maxInjectChars: getNumberSetting('skills.maxInjectChars', 20000, 1),
  };
}

function skillsBudgetEqual(left: SkillsBudget, right: SkillsBudget): boolean {
  return left.maxPromptSkills === right.maxPromptSkills &&
    left.maxInjectSkills === right.maxInjectSkills &&
    left.maxInjectChars === right.maxInjectChars;
}

function getSubagentModelOverride(): string {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('subagents.model');
  return typeof raw === 'string' ? raw.trim() : '';
}

function normalizeSubagentModelOverride(model: string): string {
  return model.trim().slice(0, 200);
}

function getSessionsPersistEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('sessions.persist', true) ?? true;
}

function getSessionsMaxSessions(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('sessions.maxSessions');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1 ? Math.floor(parsed as number) : 20;
}

function getSessionsMaxSessionBytes(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('sessions.maxSessionBytes');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1000 ? Math.floor(parsed as number) : 2_000_000;
}

type SessionRetentionLimits = {
  maxSessions: number;
  maxSessionBytes: number;
};

function getSessionRetentionLimits(): SessionRetentionLimits {
  return {
    maxSessions: getSessionsMaxSessions(),
    maxSessionBytes: getSessionsMaxSessionBytes(),
  };
}

type ToolRuntimeLimits = {
  toolTimeoutMs: number;
  readMaxLines: number;
  bashBackgroundTtlMs: number;
  bashBackgroundCaptureMs: number;
  bashBackgroundCaptureLines: number;
  workspaceShellTimeoutMs: number;
  httpTimeoutMs: number;
};

type ToolFilter = string[];
type ToolCatalogItem = {
  id: string;
  name: string;
  description: string;
  readOnly: boolean;
  requiresApproval: boolean;
  category: string;
  parameters: unknown;
  required: string[];
};
const MAX_MANUAL_TOOL_RESULT_CHARS = 12_000;
type InstructionPatterns = string[];
type InstructionFileSettings = {
  includeGlobal: boolean;
  maxCharsPerFile: number;
  maxTotalChars: number;
};
type WorkspaceEnv = Record<string, string>;

type DebugSettingsUi = {
  details: boolean;
  llm: boolean;
  tools: boolean;
  plugins: boolean;
  effectiveLlm: boolean;
  effectiveTools: boolean;
  effectivePlugins: boolean;
};

type PluginSettings = {
  plugins: string[];
  autoDiscover: boolean;
  workspaceDir: string;
};

type OpenAICompatibleSettings = {
  baseURL: string;
  defaultModelId: string;
  apiKeyEnv: string;
  allowInsecureTLS: boolean;
  modelDisplayNames: Record<string, string>;
};

type CodexSubscriptionSettings = {
  defaultModelId: string;
};

type ModelLimitEntry = {
  context: number;
  output?: number;
};

type ModelLimits = Record<string, ModelLimitEntry>;

function normalizeToolFilter(input: unknown): ToolFilter {
  return normalizeToolFilterSetting(input);
}

function getToolFilter(): ToolFilter {
  return normalizeToolFilter(vscode.workspace.getConfiguration('lingyun').get<unknown>('toolFilter', []));
}

function stringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function hasListItemLongerThan(values: readonly string[], maxLength: number): boolean {
  for (let i = 0; i < values.length; i++) {
    if (values[i].length > maxLength) return true;
  }
  return false;
}

function collectRequiredParameterNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const required: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (typeof value === 'string') required.push(value);
  }
  return required;
}

function collectManualToolConfirmationReasons(tool: { metadata?: { readOnly?: boolean; requiresApproval?: boolean } }): string[] {
  const reasons: string[] = [];
  if (tool.metadata?.readOnly !== true) {
    reasons.push('it may change workspace/editor state');
  }
  if (tool.metadata?.requiresApproval === true) {
    reasons.push('it normally requires approval during agent runs');
  }
  return reasons;
}

function compareToolCatalogItemsById(left: ToolCatalogItem, right: ToolCatalogItem): number {
  return TOOL_CATALOG_ID_COLLATOR.compare(left.id, right.id);
}

type ToolCatalogState = {
  total: number;
  shown: number;
  filter: ToolFilter;
  tools: ToolCatalogItem[];
};

async function buildToolCatalogForUI(): Promise<ToolCatalogState> {
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

function formatManualToolResultData(data: unknown): { text: string; truncated: boolean } {
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

function formatMemoryUpdateMessage(result: MemoryUpdateResult): string {
  return result.enabled
    ? `Memories updated: scanned ${result.scannedSessions}, processed ${result.processedSessions}, retained ${result.retainedOutputs}.`
    : 'Memories feature is disabled.';
}

function formatMemoryDropMessage(result: MemoryDropResult): string {
  return `Dropped memories: removed ${result.removedStateOutputs} stored outputs.`;
}

function normalizeInstructionPatterns(input: unknown): InstructionPatterns {
  return normalizeSeparatedStringList(input);
}

function getInstructionPatterns(): InstructionPatterns {
  return normalizeInstructionPatterns(vscode.workspace.getConfiguration('lingyun').get<unknown>('instructions', []));
}

function getInstructionFileSettings(): InstructionFileSettings {
  return {
    includeGlobal: vscode.workspace.getConfiguration('lingyun').get<boolean>('instructionFiles.includeGlobal', true) ?? true,
    maxCharsPerFile: getNumberSetting('instructionFiles.maxCharsPerFile', 60000, 1000),
    maxTotalChars: getNumberSetting('instructionFiles.maxTotalChars', 180000, 1000),
  };
}

function instructionFileSettingsEqual(left: InstructionFileSettings, right: InstructionFileSettings): boolean {
  return left.includeGlobal === right.includeGlobal &&
    left.maxCharsPerFile === right.maxCharsPerFile &&
    left.maxTotalChars === right.maxTotalChars;
}

function normalizeWorkspaceEnv(input: unknown): WorkspaceEnv {
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

function getWorkspaceEnvValidationError(input: unknown): string | undefined {
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

function getWorkspaceEnv(): WorkspaceEnv {
  return normalizeWorkspaceEnv(vscode.workspace.getConfiguration('lingyun').get<unknown>('env', {}));
}

function workspaceEnvEqual(left: WorkspaceEnv, right: WorkspaceEnv): boolean {
  if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
  for (const key in left) {
    if (!hasOwnEnumerableKey(left, key)) continue;
    if (!hasOwnEnumerableKey(right, key) || left[key] !== right[key]) return false;
  }
  return true;
}

function getDebugSettingsForUi(): DebugSettingsUi {
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

function normalizeDebugSettings(input: Partial<DebugSettingsUi>, current = getDebugSettingsForUi()): DebugSettingsUi {
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

function debugSettingsEqual(left: DebugSettingsUi, right: DebugSettingsUi): boolean {
  return left.details === right.details &&
    left.llm === right.llm &&
    left.tools === right.tools &&
    left.plugins === right.plugins;
}

function normalizePluginSpecs(input: unknown): string[] {
  return normalizeSeparatedStringList(input);
}

function normalizePluginWorkspaceDir(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  return raw || '.lingyun';
}

function getPluginSettings(): PluginSettings {
  const config = vscode.workspace.getConfiguration('lingyun');
  return {
    plugins: normalizePluginSpecs(config.get<unknown>('plugins', [])),
    autoDiscover: config.get<boolean>('plugins.autoDiscover', false) ?? false,
    workspaceDir: normalizePluginWorkspaceDir(config.get<unknown>('plugins.workspaceDir', '.lingyun')),
  };
}

function pluginSettingsEqual(left: PluginSettings, right: PluginSettings): boolean {
  return left.autoDiscover === right.autoDiscover &&
    left.workspaceDir === right.workspaceDir &&
    stringListsEqual(left.plugins, right.plugins);
}

function normalizeOpenAICompatibleText(input: unknown, maxLength: number): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  return raw.slice(0, maxLength);
}

function normalizeOpenAICompatibleModelDisplayNames(input: unknown): Record<string, string> {
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

function getOpenAICompatibleModelDisplayNamesValidationError(input: unknown): string | undefined {
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

function getOpenAICompatibleSettings(): OpenAICompatibleSettings {
  const config = vscode.workspace.getConfiguration('lingyun');
  return {
    baseURL: normalizeOpenAICompatibleText(config.get<unknown>('openaiCompatible.baseURL', ''), 500),
    defaultModelId: normalizeOpenAICompatibleText(config.get<unknown>('openaiCompatible.defaultModelId', ''), 200),
    apiKeyEnv: normalizeOpenAICompatibleText(config.get<unknown>('openaiCompatible.apiKeyEnv', 'OPENAI_API_KEY'), 120) || 'OPENAI_API_KEY',
    allowInsecureTLS: config.get<unknown>('openaiCompatible.allowInsecureTLS') === true,
    modelDisplayNames: normalizeOpenAICompatibleModelDisplayNames(config.get<unknown>('openaiCompatible.modelDisplayNames', {})),
  };
}

function stringRecordEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
  for (const key in left) {
    if (!hasOwnEnumerableKey(left, key)) continue;
    if (!hasOwnEnumerableKey(right, key) || left[key] !== right[key]) return false;
  }
  return true;
}

function openAICompatibleSettingsEqual(left: OpenAICompatibleSettings, right: OpenAICompatibleSettings): boolean {
  return left.baseURL === right.baseURL &&
    left.defaultModelId === right.defaultModelId &&
    left.apiKeyEnv === right.apiKeyEnv &&
    left.allowInsecureTLS === right.allowInsecureTLS &&
    stringRecordEqual(left.modelDisplayNames, right.modelDisplayNames);
}

function getCodexSubscriptionSettings(): CodexSubscriptionSettings {
  return {
    defaultModelId: normalizeOpenAICompatibleText(
      vscode.workspace.getConfiguration('lingyun').get<unknown>('codexSubscription.defaultModelId', 'gpt-5.3-codex'),
      200
    ) || 'gpt-5.3-codex',
  };
}

function parsePositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : undefined;
}

function normalizeModelLimits(input: unknown): ModelLimits {
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

function getModelLimitsValidationError(input: unknown): string | undefined {
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

function getModelLimits(): ModelLimits {
  return normalizeModelLimits(vscode.workspace.getConfiguration('lingyun').get<unknown>('modelLimits', {}));
}

function modelLimitsEqual(left: ModelLimits, right: ModelLimits): boolean {
  if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
  for (const key in left) {
    if (!hasOwnEnumerableKey(left, key) || !hasOwnEnumerableKey(right, key)) return false;
    const leftEntry = left[key];
    const rightEntry = right[key];
    if (leftEntry.context !== rightEntry.context || leftEntry.output !== rightEntry.output) return false;
  }
  return true;
}

function getNumberSetting(path: string, fallback: number, minimum: number): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>(path);
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= minimum ? Math.floor(parsed as number) : fallback;
}

function getToolRuntimeLimits(): ToolRuntimeLimits {
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

function toolRuntimeLimitsEqual(left: ToolRuntimeLimits, right: ToolRuntimeLimits): boolean {
  return left.toolTimeoutMs === right.toolTimeoutMs
    && left.readMaxLines === right.readMaxLines
    && left.bashBackgroundTtlMs === right.bashBackgroundTtlMs
    && left.bashBackgroundCaptureMs === right.bashBackgroundCaptureMs
    && left.bashBackgroundCaptureLines === right.bashBackgroundCaptureLines
    && left.workspaceShellTimeoutMs === right.workspaceShellTimeoutMs
    && left.httpTimeoutMs === right.httpTimeoutMs;
}

type CompactionToolOutputMode = 'afterToolCall' | 'onCompaction';

type GenerationSettings = {
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

const TEXT_VERBOSITY_VALUES = new Set(['', 'low', 'medium', 'high']);

function normalizeTextVerbosity(input: unknown, fallback = ''): string {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : fallback;
  return TEXT_VERBOSITY_VALUES.has(raw) ? raw : fallback;
}

function getConfiguredTemperature(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('temperature');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(2, parsed as number)) : 0;
}

function getConfiguredTopP(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('topP');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed as number)) : 0;
}

function getConfiguredTopK(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('topK');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : 0;
}

function getConfiguredMaxOutputTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('maxOutputTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : 32000;
}

function getConfiguredMaxIterations(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('maxIterations');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  if (parsed === -1) return -1;
  return Number.isFinite(parsed) && (parsed as number) > 0 ? Math.floor(parsed as number) : 50;
}

function getConfiguredMaxRetries(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.maxRetries');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 2;
}

function getConfiguredRetryWithPartialOutput(): boolean {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.retryWithPartialOutput');
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.toLowerCase() === 'true';
  return true;
}

function getConfiguredLlmTimeoutMs(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.timeoutMs');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 0;
}

function getConfiguredTextVerbosity(): string {
  return normalizeTextVerbosity(
    vscode.workspace.getConfiguration('lingyun').get<unknown>('llm.textVerbosity', ''),
    ''
  );
}

function getGenerationSettings(): GenerationSettings {
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

function generationSettingsEqual(left: GenerationSettings, right: GenerationSettings): boolean {
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

function getMemoryAutoRecallEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('memories.autoRecall', true) ?? true;
}

function getMemoryAutoRecallMaxResults(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.maxAutoRecallResults');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1 ? Math.floor(parsed as number) : 4;
}

function getMemoryAutoRecallMaxTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.maxAutoRecallTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 100 ? Math.floor(parsed as number) : 1200;
}

function getMemoryAutoRecallMinScore(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.autoRecallMinScore');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.min(100, parsed as number) : 7;
}

function getMemoryAutoRecallMinScoreGap(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.autoRecallMinScoreGap');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.min(50, parsed as number) : 1.25;
}

function getMemoryAutoRecallMaxAgeDays(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('memories.autoRecallMaxAgeDays');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 1 ? Math.min(3650, Math.floor(parsed as number)) : 45;
}

type MemoryAutoRecallBudget = {
  maxResults: number;
  maxTokens: number;
};

function getMemoryAutoRecallBudget(): MemoryAutoRecallBudget {
  return {
    maxResults: getMemoryAutoRecallMaxResults(),
    maxTokens: getMemoryAutoRecallMaxTokens(),
  };
}

type MemoryAutoRecallFilters = {
  minScore: number;
  minScoreGap: number;
  maxAgeDays: number;
};

function getMemoryAutoRecallFilters(): MemoryAutoRecallFilters {
  return {
    minScore: getMemoryAutoRecallMinScore(),
    minScoreGap: getMemoryAutoRecallMinScoreGap(),
    maxAgeDays: getMemoryAutoRecallMaxAgeDays(),
  };
}

type MemoryAdvancedLimits = {
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

function getMemoryAdvancedLimits(): MemoryAdvancedLimits {
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

function memoryAdvancedLimitsEqual(left: MemoryAdvancedLimits, right: MemoryAdvancedLimits): boolean {
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

function getExplorePrepassEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('subagents.explorePrepass.enabled', false) ?? false;
}

function getExplorePrepassMaxChars(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('subagents.explorePrepass.maxChars');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 500 ? Math.floor(parsed as number) : 8000;
}

function getSubagentTaskMaxOutputChars(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('subagents.task.maxOutputChars');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 500 ? Math.floor(parsed as number) : 8000;
}

function getAutoCompactionEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('compaction.auto', true) ?? true;
}

function getCompactionPruneEnabled(): boolean {
  return vscode.workspace.getConfiguration('lingyun').get<boolean>('compaction.prune', true) ?? true;
}

function getCompactionPruneProtectTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('compaction.pruneProtectTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 40000;
}

function getCompactionPruneMinimumTokens(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<unknown>('compaction.pruneMinimumTokens');
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;
  return Number.isFinite(parsed) && (parsed as number) >= 0 ? Math.floor(parsed as number) : 20000;
}

type CompactionPruneSettings = {
  prune: boolean;
  pruneProtectTokens: number;
  pruneMinimumTokens: number;
};

function getCompactionPruneSettings(): CompactionPruneSettings {
  return {
    prune: getCompactionPruneEnabled(),
    pruneProtectTokens: getCompactionPruneProtectTokens(),
    pruneMinimumTokens: getCompactionPruneMinimumTokens(),
  };
}

function compactionPruneSettingsEqual(left: CompactionPruneSettings, right: CompactionPruneSettings): boolean {
  return left.prune === right.prune &&
    left.pruneProtectTokens === right.pruneProtectTokens &&
    left.pruneMinimumTokens === right.pruneMinimumTokens;
}

function getCompactionToolOutputMode(): CompactionToolOutputMode {
  const configured = vscode.workspace.getConfiguration('lingyun').get<unknown>('compaction.toolOutputMode');
  return configured === 'afterToolCall' ? 'afterToolCall' : 'onCompaction';
}

function normalizeCompactionToolOutputMode(mode: string): CompactionToolOutputMode | undefined {
  return mode === 'onCompaction' || mode === 'afterToolCall' ? mode : undefined;
}

function parseWebviewImageAttachments(raw: unknown): ChatImageAttachment[] {
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

function parseComposerSubmissionId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const id = raw.trim();
  return id && id.length <= MAX_WEBVIEW_COMPOSER_SUBMISSION_ID_LENGTH ? id : '';
}

function getToastErrorMessage(error: unknown, llmProviderId?: string): string {
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

export interface ChatWebviewService {
  resolveWebviewView(webviewView: vscode.WebviewView): void;
  startInitPusher(): void;
  sendInit(force?: boolean): Promise<void>;
  loadEarlierTranscriptMessages(request: WebviewTranscriptHistoryRequest): void;
  refreshSettingsState(): Promise<void>;
  getProviderAuthStateForUI(): Promise<ProviderAuthUiState>;
  postProviderState(): Promise<void>;
  switchProvider(providerId: string): Promise<void>;
  setOpenAICompatibleSettings(settings: Partial<OpenAICompatibleSettings>): Promise<void>;
  setCodexSubscriptionSettings(settings: Partial<CodexSubscriptionSettings>): Promise<void>;
  setPlanFirst(enabled: boolean): Promise<void>;
  setAutoApprove(enabled: boolean): Promise<void>;
  setAllowExternalPaths(enabled: boolean): Promise<void>;
  setBlockGitPush(enabled: boolean): Promise<void>;
  setDebugSettings(settings: Partial<DebugSettingsUi>): Promise<void>;
  setPluginSettings(settings: Partial<PluginSettings>): Promise<void>;
  setToolRuntimeLimits(limits: Partial<ToolRuntimeLimits>): Promise<void>;
  setToolFilter(patterns: ToolFilter): Promise<void>;
  revokeAlwaysAllowedTool(toolId: string): Promise<void>;
  clearAlwaysAllowedTools(confirmed?: boolean): Promise<void>;
  setWorkspaceEnv(env: WorkspaceEnv): Promise<void>;
  setInstructionPatterns(patterns: InstructionPatterns): Promise<void>;
  setInstructionFileSettings(settings: Partial<InstructionFileSettings>): Promise<void>;
  setSkillsEnabled(enabled: boolean): Promise<void>;
  setSkillSearchPaths(paths: SkillSearchPaths): Promise<void>;
  setSkillsBudget(budget: Partial<SkillsBudget>): Promise<void>;
  setSessionsPersist(enabled: boolean): Promise<void>;
  setSessionRetentionLimits(limits: Partial<SessionRetentionLimits>): Promise<void>;
  setShowThinking(enabled: boolean): Promise<void>;
  setMemoriesFeatureEnabled(enabled: boolean): Promise<void>;
  setMemoryAutoRecall(enabled: boolean): Promise<void>;
  setMemoryAutoRecallBudget(budget: Partial<MemoryAutoRecallBudget>): Promise<void>;
  setMemoryAutoRecallFilters(filters: Partial<MemoryAutoRecallFilters>): Promise<void>;
  setMemoryAdvancedLimits(limits: Partial<MemoryAdvancedLimits>): Promise<void>;
  updateMemoriesNow(): Promise<void>;
  dropMemoriesNow(confirmed?: boolean): Promise<void>;
  showLogs(): void;
  postToolCatalog(): Promise<void>;
  listTools(): Promise<void>;
  runTool(toolId?: string, args?: Record<string, unknown>, confirmed?: boolean): Promise<void>;
  createToolsConfig(): Promise<void>;
  setExplorePrepass(enabled: boolean): Promise<void>;
  setExplorePrepassMaxChars(maxChars: number): Promise<void>;
  setSubagentModelOverride(model: string): Promise<void>;
  setSubagentTaskMaxOutputChars(maxChars: number): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  setCompactionPruneSettings(settings: Partial<CompactionPruneSettings>): Promise<void>;
  setCompactionToolOutputMode(mode: string): Promise<void>;
  setModelLimits(limits: ModelLimits): Promise<void>;
  setGenerationSettings(settings: Partial<GenerationSettings>): Promise<void>;
  authenticateProvider(): Promise<void>;
  disconnectProvider(): Promise<void>;
  postMessage(message: unknown): void;
  getHtml(webview: vscode.Webview): string;
}

export interface ChatWebviewDeps {
  context: vscode.ExtensionContext;
  outputChannel?: vscode.OutputChannel;
  view?: vscode.WebviewView;
  viewDisposables: vscode.Disposable[];
  availableModels: ModelInfo[];
  currentModel: string;
  activeSessionId: string;
  inputHistoryEntries: string[];
  skillNamesForUiPromise?: Promise<string[]>;
  mode: 'build' | 'plan';
  isProcessing: boolean;
  autoApproveThisRun: boolean;
  pendingApprovals: Map<string, PendingApprovalEntry>;
  initAcked: boolean;
  initInterval?: NodeJS.Timeout;
  initInFlight: boolean;
  webviewClientInstanceId?: string;
  webviewCrashToastClientId?: string;
  pendingComposerAttachments: ChatImageAttachment[];
  composerSubmissionState?: ChatComposerSubmissionState;
  llmProvider?: Pick<
    LLMProviderWithUi,
    'id' | 'name' | 'getAuthStatus' | 'authenticate' | 'disconnect' | 'clearModelCache'
  >;
  toolDiffBeforeByToolCallId: Map<
    string,
    {
      absPath: string;
      displayPath: string;
      beforeText: string;
      isExternal: boolean;
      skippedReason?: 'too_large' | 'binary';
    }
  >;
  toolDiffSnapshotsByToolCallId: Map<
    string,
    {
      absPath: string;
      displayPath: string;
      beforeText: string;
      afterText: string;
      isExternal: boolean;
      truncated: boolean;
    }
  >;
  abortCurrentRun(reason?: string): void;
  queueManager: Pick<ChatQueueManager, 'clearActiveSession' | 'flushAutosendForActiveSession' | 'getQueuedInputs' | 'postState'>;
  runner: Pick<RunCoordinator, 'steerQueuedInput'>;
  createNewSession(): Promise<void>;
  compactCurrentSession(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  redoAll(): Promise<void>;
  discardUndone(confirmed?: boolean): Promise<void>;
  viewRevertDiff(): Promise<void>;
  switchToSession(sessionId: string): Promise<void>;
  postSessions(): void;
  handleUserMessage(content: string | ChatUserInput, options?: ChatUserMessageOptions): Promise<void>;
  approveAllPendingApprovals(options?: { includeManual?: boolean }): void;
  postApprovalState(): void;
  handleAlwaysAllowApproval(approvalId: string): Promise<void>;
  getAutoApprovedToolsForUI(): string[];
  revokeAutoApprovedTool(toolId: string): Promise<void>;
  clearAutoApprovedToolsForUI(): Promise<void>;
  clearCurrentSession(): Promise<void>;
  clearSavedSessions(): Promise<void>;
  executePendingPlan(planMessageId?: string): Promise<void>;
  loadModels(): Promise<void>;
  postModelState(): Promise<void>;
  postModelPickerState(reveal?: boolean): Promise<void>;
  refreshModelsForUI(): Promise<void>;
  clearRecentModels(): Promise<void>;
  setCurrentModel(modelId: string): Promise<void>;
  setReasoningEffort(reasoningEffort: string): Promise<void>;
  openAdvancedModelSettings(): Promise<void>;
  toggleFavoriteModel(modelId: string): Promise<void>;
  getActiveSession(): ReturnType<ChatSessionsService['getActiveSession']>;
  setModeAndPersist(
    mode: 'build' | 'plan',
    options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
  ): Promise<void>;
  cancelPendingPlan(planMessageId: string): Promise<void>;
  revisePendingPlan(planMessageId: string, instructions: string): Promise<void>;
  handleApprovalResponse(approvalId: string, approved: boolean): void;
  retryToolCall(approvalId: string): Promise<void>;
  ensureSessionsLoaded(): Promise<void>;
  onSessionPersistenceConfigChanged(): Promise<void>;
  getModelLabel(modelId: string): string;
  getRenderableMessages(): ReturnType<ChatSessionsService['getRenderableMessages']>;
  getRevertBarStateForUI(): ReturnType<ChatRevertService['getRevertBarStateForUI']>;
  getContextForUI(): ReturnType<ChatSessionsService['getContextForUI']>;
  getSessionsForUI(): ReturnType<ChatSessionsService['getSessionsForUI']>;
  getSkillNamesForUI(): Promise<Awaited<ReturnType<ChatSkillsService['getSkillNamesForUI']>>>;
  getUndoRedoAvailability(): ReturnType<ChatRevertService['getUndoRedoAvailability']>;
  isModelFavorite(modelId: string): Promise<boolean>;
  postMessage(message: unknown): void;
}

type ChatWebviewRuntime = ChatWebviewDeps & ChatWebviewService;

type BrowserChatProtocol = {
  ready: typeof WEBVIEW_MESSAGE_READY;
  initAck: typeof WEBVIEW_MESSAGE_INIT_ACK;
  webviewError: typeof WEBVIEW_MESSAGE_ERROR;
  transcriptHistoryRequest: typeof WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST;
  transcriptHistoryPage: typeof WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE;
};

type MemoryActionStatus = {
  state: 'idle' | 'running' | 'success' | 'error';
  message: string;
};

const idleMemoryActionStatus: MemoryActionStatus = { state: 'idle', message: '' };

function postMemoryActionStatus(controller: Pick<ChatWebviewRuntime, 'postMessage'>, status: MemoryActionStatus): void {
  controller.postMessage({ type: 'memoryActionStatusState', memoryActionStatus: status });
}

type ChatWebviewSettingsStateMessage = {
  type: 'settingsState' | 'init';
  currentModel: string;
  currentModelLabel: string;
  currentModelIsFavorite: boolean;
  currentReasoningEffort: ReturnType<typeof getConfiguredReasoningEffort>;
  currentProviderId: LlmProviderId;
  providerAuth: ProviderAuthUiState;
  openAICompatibleSettings: OpenAICompatibleSettings;
  codexSubscriptionSettings: CodexSubscriptionSettings;
  planFirst: boolean;
  autoApprove: boolean;
  allowExternalPaths: boolean;
  blockGitPush: boolean;
  debugSettings: DebugSettingsUi;
  toolRuntimeLimits: ToolRuntimeLimits;
  toolFilter: ToolFilter;
  autoApprovedTools: string[];
  toolsCatalog?: ToolCatalogState;
  workspaceEnv: WorkspaceEnv;
  pluginSettings: PluginSettings;
  instructionPatterns: InstructionPatterns;
  instructionFileSettings: InstructionFileSettings;
  showThinking: boolean;
  memoriesFeatureEnabled: boolean;
  memoryAutoRecall: boolean;
  memoryAutoRecallMaxResults: number;
  memoryAutoRecallMaxTokens: number;
  memoryAutoRecallMinScore: number;
  memoryAutoRecallMinScoreGap: number;
  memoryAutoRecallMaxAgeDays: number;
  memoryAdvancedLimits: MemoryAdvancedLimits;
  memoryActionStatus: MemoryActionStatus;
  explorePrepass: boolean;
  explorePrepassMaxChars: number;
  subagentModelOverride: string;
  subagentTaskMaxOutputChars: number;
  autoCompaction: boolean;
  compactionPrune: boolean;
  compactionPruneProtectTokens: number;
  compactionPruneMinimumTokens: number;
  compactionToolOutputMode: CompactionToolOutputMode;
  modelLimits: ModelLimits;
  generationSettings: GenerationSettings;
  mode: 'build' | 'plan';
  skillsEnabled: boolean;
  skillSearchPaths: SkillSearchPaths;
  skillsBudget: SkillsBudget;
  sessionsPersist: boolean;
  sessionsMaxSessions: number;
  sessionsMaxSessionBytes: number;
  skills: Awaited<ReturnType<ChatSkillsService['getSkillNamesForUI']>>;
};

type ChatWebviewInitMessage = ChatWebviewSettingsStateMessage & {
  type: 'init';
  sessions: ReturnType<ChatSessionsService['getSessionsForUI']>;
  activeSessionId: string;
  messages: ReturnType<ChatSessionsService['getRenderableMessages']>;
  transcriptHistory: {
    mode: 'paged';
    hasEarlierMessages: boolean;
    cursor: string;
  };
  inputHistory: string[];
  revertState: ReturnType<ChatRevertService['getRevertBarStateForUI']>;
  context: ReturnType<ChatSessionsService['getContextForUI']>;
  todos: Awaited<ReturnType<typeof readTodos>>;
  planPending: boolean;
  activePlanMessageId: string;
  processing: boolean;
  queuedInputs: ReturnType<ChatQueueManager['getQueuedInputs']>;
  composerAttachments: ChatImageAttachment[];
  composerSubmissionState?: ChatComposerSubmissionState;
  pendingApprovals: number;
  manualApprovals: number;
  autoApproveThisRun: boolean;
} & ReturnType<ChatRevertService['getUndoRedoAvailability']>;

function createBrowserChatProtocol(): BrowserChatProtocol {
  return {
    ready: WEBVIEW_MESSAGE_READY,
    initAck: WEBVIEW_MESSAGE_INIT_ACK,
    webviewError: WEBVIEW_MESSAGE_ERROR,
    transcriptHistoryRequest: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
    transcriptHistoryPage: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE,
  };
}

function renderBrowserChatProtocolBootstrapScript(nonce: string): string {
  const protocolJson = JSON.stringify(createBrowserChatProtocol());
  return `<script nonce="${nonce}">window.LINGYUN_CHAT_PROTOCOL = Object.freeze(${protocolJson});</script>`;
}

async function buildWebviewSettingsStateMessage(
  runtime: ChatWebviewRuntime,
  params?: {
    type?: 'settingsState' | 'init';
    modelLabel?: string;
    currentModelIsFavorite?: boolean;
    deferOptional?: boolean;
  }
): Promise<ChatWebviewSettingsStateMessage> {
  const nextModel = resolveConfiguredModelId(runtime.llmProvider?.id) || runtime.currentModel;
  runtime.currentModel = nextModel;
  const deferOptional = params?.deferOptional === true;
  const currentModelIsFavoritePromise = typeof params?.currentModelIsFavorite === 'boolean'
    ? Promise.resolve(params.currentModelIsFavorite)
    : runtime.isModelFavorite(runtime.currentModel);
  let skills: string[];
  let providerAuth: ProviderAuthUiState;
  let currentModelIsFavorite: boolean;
  if (deferOptional) {
    skills = [];
    providerAuth = {
      providerId: typeof runtime.llmProvider?.id === 'string' ? runtime.llmProvider.id : '',
      providerName: typeof runtime.llmProvider?.name === 'string' ? runtime.llmProvider.name : '',
      supported: false,
      authenticated: false,
      status: 'hidden',
      label: '',
    };
    currentModelIsFavorite = await currentModelIsFavoritePromise;
  } else {
    [skills, providerAuth, currentModelIsFavorite] = await Promise.all([
      runtime.getSkillNamesForUI(),
      runtime.getProviderAuthStateForUI(),
      currentModelIsFavoritePromise,
    ]);
  }
  const modelLabel = params?.modelLabel || runtime.getModelLabel(runtime.currentModel) || runtime.currentModel;

  return {
    type: params?.type ?? 'settingsState',
    currentModel: runtime.currentModel,
    currentModelLabel: modelLabel,
    currentModelIsFavorite,
    currentReasoningEffort: getConfiguredReasoningEffort(),
    currentProviderId: getConfiguredLlmProviderId(),
    providerAuth,
    openAICompatibleSettings: getOpenAICompatibleSettings(),
    codexSubscriptionSettings: getCodexSubscriptionSettings(),
    planFirst: getPlanFirstEnabled(),
    autoApprove: getAutoApproveEnabled(),
    allowExternalPaths: getAllowExternalPathsEnabled(),
    blockGitPush: getBlockGitPushEnabled(),
    debugSettings: getDebugSettingsForUi(),
    toolRuntimeLimits: getToolRuntimeLimits(),
    toolFilter: getToolFilter(),
    autoApprovedTools: runtime.getAutoApprovedToolsForUI(),
    workspaceEnv: getWorkspaceEnv(),
    pluginSettings: getPluginSettings(),
    instructionPatterns: getInstructionPatterns(),
    instructionFileSettings: getInstructionFileSettings(),
    showThinking: getShowThinkingEnabled(),
    memoriesFeatureEnabled: getMemoriesFeatureEnabled(),
    memoryAutoRecall: getMemoryAutoRecallEnabled(),
    memoryAutoRecallMaxResults: getMemoryAutoRecallMaxResults(),
    memoryAutoRecallMaxTokens: getMemoryAutoRecallMaxTokens(),
    memoryAutoRecallMinScore: getMemoryAutoRecallMinScore(),
    memoryAutoRecallMinScoreGap: getMemoryAutoRecallMinScoreGap(),
    memoryAutoRecallMaxAgeDays: getMemoryAutoRecallMaxAgeDays(),
    memoryAdvancedLimits: getMemoryAdvancedLimits(),
    memoryActionStatus: idleMemoryActionStatus,
    explorePrepass: getExplorePrepassEnabled(),
    explorePrepassMaxChars: getExplorePrepassMaxChars(),
    subagentModelOverride: getSubagentModelOverride(),
    subagentTaskMaxOutputChars: getSubagentTaskMaxOutputChars(),
    autoCompaction: getAutoCompactionEnabled(),
    compactionPrune: getCompactionPruneEnabled(),
    compactionPruneProtectTokens: getCompactionPruneProtectTokens(),
    compactionPruneMinimumTokens: getCompactionPruneMinimumTokens(),
    compactionToolOutputMode: getCompactionToolOutputMode(),
    modelLimits: getModelLimits(),
    generationSettings: getGenerationSettings(),
    mode: runtime.mode,
    skillsEnabled: getSkillsEnabled(),
    skillSearchPaths: getSkillSearchPaths(),
    skillsBudget: getSkillsBudget(),
    sessionsPersist: getSessionsPersistEnabled(),
    sessionsMaxSessions: getSessionsMaxSessions(),
    sessionsMaxSessionBytes: getSessionsMaxSessionBytes(),
    skills,
  };
}

async function buildWebviewInitMessage(
  runtime: ChatWebviewRuntime,
  params: { modelLabel: string; currentModelIsFavorite: boolean }
): Promise<ChatWebviewInitMessage> {
  const pendingPlan = runtime.getActiveSession().pendingPlan;
  const approvalState = buildApprovalStateForUI({
    pendingApprovals: runtime.pendingApprovals,
    autoApproveThisRun: runtime.autoApproveThisRun,
  });
  const settingsState = await buildWebviewSettingsStateMessage(runtime, {
    type: 'init',
    modelLabel: params.modelLabel,
    currentModelIsFavorite: params.currentModelIsFavorite,
    deferOptional: true,
  });
  const transcriptPage = createInitialTranscriptPage(runtime.getRenderableMessages());

  return {
    ...settingsState,
    type: 'init',
    sessions: runtime.getSessionsForUI(),
    activeSessionId: runtime.activeSessionId,
    messages: transcriptPage.messages,
    transcriptHistory: {
      mode: 'paged',
      hasEarlierMessages: transcriptPage.hasEarlierMessages,
      cursor: transcriptPage.cursor ?? '',
    },
    inputHistory: runtime.inputHistoryEntries,
    revertState: runtime.getRevertBarStateForUI(),
    context: runtime.getContextForUI(),
    todos: [],
    planPending: !!pendingPlan,
    activePlanMessageId: pendingPlan?.planMessageId ?? '',
    processing: runtime.isProcessing,
    queuedInputs: runtime.queueManager.getQueuedInputs(),
    composerAttachments: runtime.pendingComposerAttachments,
    ...(runtime.composerSubmissionState
      ? { composerSubmissionState: runtime.composerSubmissionState }
      : {}),
    pendingApprovals: approvalState.count,
    manualApprovals: approvalState.manualCount,
    autoApproveThisRun: approvalState.autoApproveThisRun,
    ...runtime.getUndoRedoAvailability(),
  };
}

type DeferredWebviewTask = {
  view: vscode.WebviewView;
  provider: ChatWebviewRuntime['llmProvider'];
  promise: Promise<void>;
};

type DeferredTodoTask = {
  view: vscode.WebviewView;
  sessionId: string;
  promise: Promise<void>;
};

const deferredWebviewTasks = new WeakMap<ChatWebviewRuntime, DeferredWebviewTask>();
const deferredTodoTasks = new WeakMap<ChatWebviewRuntime, DeferredTodoTask>();

function logDeferredWebviewTaskFailure(
  runtime: ChatWebviewRuntime,
  label: string,
  error: unknown
): void {
  appendErrorLog(runtime.outputChannel, `Failed to refresh deferred chat ${label}`, error, {
    tag: 'Webview',
  });
}

async function refreshDeferredWebviewState(
  runtime: ChatWebviewRuntime,
  view: vscode.WebviewView
): Promise<void> {
  const provider = runtime.llmProvider;
  const tasks: Array<{ label: string; promise: Promise<void> }> = [];

  if (runtime.availableModels.length === 0) {
    tasks.push({
      label: 'models',
      promise: runtime.loadModels(),
    });
  }

  tasks.push({
    label: 'provider state',
    promise: runtime.getProviderAuthStateForUI().then((providerAuth) => {
      if (runtime.view !== view || runtime.llmProvider !== provider) return;
      runtime.postMessage({
        type: 'providerState',
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth,
      });
    }),
  });

  tasks.push({
    label: 'skills',
    promise: runtime.getSkillNamesForUI().then((skills) => {
      if (runtime.view !== view) return;
      runtime.postMessage({
        type: 'skillsEnabledState',
        skillsEnabled: getSkillsEnabled(),
        skills,
      });
    }),
  });

  const results = await Promise.allSettled(tasks.map((task) => task.promise));
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === 'rejected') {
      logDeferredWebviewTaskFailure(runtime, tasks[index].label, result.reason);
    }
  }
}

function scheduleDeferredWebviewState(runtime: ChatWebviewRuntime): void {
  const view = runtime.view;
  if (!view) return;

  const provider = runtime.llmProvider;
  const current = deferredWebviewTasks.get(runtime);
  if (current?.view === view && current.provider === provider) return;

  const promise = refreshDeferredWebviewState(runtime, view).catch((error) => {
    logDeferredWebviewTaskFailure(runtime, 'state', error);
  });
  const task = { view, provider, promise };
  deferredWebviewTasks.set(runtime, task);
}

function scheduleDeferredTodos(runtime: ChatWebviewRuntime): void {
  const view = runtime.view;
  if (!view) return;

  const sessionId = runtime.activeSessionId;
  const current = deferredTodoTasks.get(runtime);
  if (current?.view === view && current.sessionId === sessionId) return;

  const promise = readTodos(runtime.context, sessionId)
    .then((todos) => {
      if (runtime.view !== view || runtime.activeSessionId !== sessionId) return;
      runtime.postMessage({ type: 'todos', todos });
    })
    .catch((error) => {
      logDeferredWebviewTaskFailure(runtime, 'TODO state', error);
    });
  const task = { view, sessionId, promise };
  deferredTodoTasks.set(runtime, task);
}

export function createChatWebviewService(controller: ChatWebviewDeps): ChatWebviewService {
  const runtime = controller as ChatWebviewRuntime;
  const service = bindChatControllerService(runtime, {
  resolveWebviewView(this: ChatWebviewRuntime, webviewView: vscode.WebviewView): void {
    for (const d of this.viewDisposables) {
      d.dispose();
    }
    this.viewDisposables = [];

    this.view = webviewView;
    this.initAcked = false;
    this.webviewClientInstanceId = undefined;
    resetWebviewCrashToastState(this);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    this.viewDisposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (!this.view) return;

        if (webviewView.visible) {
          if (!this.initAcked) {
            this.startInitPusher();
          }
          return;
        }

        // Stop pushing init while hidden.
        if (this.initInterval) {
          clearInterval(this.initInterval);
          this.initInterval = undefined;
        }
      })
    );

    this.viewDisposables.push(
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.initAcked = false;
        this.webviewClientInstanceId = undefined;
        resetWebviewCrashToastState(this);
        if (this.initInterval) {
          clearInterval(this.initInterval);
          this.initInterval = undefined;
        }
      })
    );

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (data) => {
        const messageType = getWebviewMessageType(data);
        try {
        switch (messageType) {
          case 'newSession':
            try {
              await this.createNewSession();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'newSession', pending: false });
            }
            break;
          case 'openLocation': {
            const workspaceFolderUris = getWorkspaceFolderUrisByPriority();
            const payload = data as Record<string, unknown>;
            const filePathRaw = typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
            const lineRaw =
              typeof payload.line === 'number'
                ? payload.line
                : typeof payload.line === 'string'
                  ? Number(payload.line)
                  : NaN;
            const characterRaw =
              typeof payload.character === 'number'
                ? payload.character
                : typeof payload.character === 'string'
                  ? Number(payload.character)
                  : NaN;
            const line = Number.isFinite(lineRaw) ? Math.max(1, Math.floor(lineRaw)) : undefined;
            const character = Number.isFinite(characterRaw) ? Math.max(1, Math.floor(characterRaw)) : 1;
            if (!filePathRaw || !line) break;

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;

            try {
              const normalized = normalizeCandidatePath(filePathRaw);
              if (!normalized) break;
              const candidates: string[] = [];
              if ((normalized.startsWith('a/') || normalized.startsWith('b/')) && normalized.length > 2) {
                candidates.push(normalized.slice(2));
              }
              candidates.push(normalized);

              let resolved:
                | { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }
                | undefined;
              let blockedExternalMessage: string | undefined;

              for (const candidate of candidates) {
                const attempt = await resolveExistingFilePath(candidate, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                  break;
                }
                if (attempt.blockedMessage) blockedExternalMessage = attempt.blockedMessage;
              }

              if (!resolved) {
                if (blockedExternalMessage) {
                  postInputNotice(this, blockedExternalMessage);
                } else {
                  postInputNotice(this, 'File not found.');
                }
                break;
              }

              const doc = await vscode.workspace.openTextDocument(resolved.uri);
              const editor = await vscode.window.showTextDocument(doc, { preview: false });
              const pos = new vscode.Position(line - 1, character - 1);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            } catch (error) {
              appendErrorLog(this.outputChannel, 'Failed to open linked location from webview', error, { tag: 'Webview' });
              postInputNotice(this, 'Failed to open file location. See logs for details.');
            }
            break;
          }
          case 'resolveFileLinks': {
            const workspaceFolderUris = getWorkspaceFolderUrisByPriority();
            const payload = data as Record<string, unknown>;
            const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
            const candidatesRaw = Array.isArray(payload.candidates) ? payload.candidates : [];
            if (!requestId) break;
            if (workspaceFolderUris.length === 0) {
              this.postMessage({ type: 'resolvedFileLinks', requestId, results: [] });
              break;
            }

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;

            const results: Array<{ raw: string; ok: boolean; path?: string }> = [];
            const seen = new Set<string>();
            let uniqueCount = 0;
            for (const item of candidatesRaw) {
              const raw =
                item && typeof item === 'object' && typeof (item as any).raw === 'string'
                  ? String((item as any).raw).trim()
                  : '';
              if (!raw) continue;
              if (seen.has(raw)) continue;
              if (uniqueCount >= 200) break;
              seen.add(raw);
              uniqueCount++;

              const normalized = normalizeCandidatePath(raw);
              if (!normalized) {
                results.push({ raw, ok: false });
                continue;
              }
              let resolved:
                | { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }
                | undefined;

              if ((normalized.startsWith('a/') || normalized.startsWith('b/')) && normalized.length > 2) {
                const stripped = normalized.slice(2);
                const attempt = await resolveExistingFilePath(stripped, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                }
              }

              if (!resolved) {
                const attempt = await resolveExistingFilePath(normalized, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                }
              }

              if (!resolved) {
                results.push({ raw, ok: false });
                continue;
              }

              // Use absolute paths to avoid ambiguity in multi-root workspaces.
              results.push({ raw, ok: true, path: resolved.absPath });
            }

            this.postMessage({ type: 'resolvedFileLinks', requestId, results });
            break;
          }
          case 'openNativeDiff': {
            const payload = data as Record<string, unknown>;
            const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId.trim() : '';
            if (!toolCallId) break;

            const snapshot = this.toolDiffSnapshotsByToolCallId.get(toolCallId);
            if (!snapshot) {
              postInputNotice(this, 'Diff snapshot is unavailable (try rerunning the tool).');
              break;
            }

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;
            if (!allowExternalPaths && snapshot.isExternal) {
              postInputNotice(this, 'External paths are disabled. Enable Allow external paths in chat settings to view this diff.');
              break;
            }

            const fileName = path.basename(snapshot.absPath || snapshot.displayPath || 'file');
            const left = createLingyunDiffUri({ toolCallId, side: 'before', fileName });
            const right = createLingyunDiffUri({ toolCallId, side: 'after', fileName });
            const title = `LingYun Diff: ${snapshot.displayPath || fileName}`;

            try {
              await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
            } catch {
              postInputNotice(this, 'Failed to open diff editor.');
            }

            break;
          }
          case 'compactSession':
            try {
              await this.compactCurrentSession();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'compactSession', pending: false });
            }
            break;
          case 'undo':
            try {
              await this.undo();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'undo', pending: false });
            }
            break;
          case 'redo':
            try {
              await this.redo();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'redo', pending: false });
            }
            break;
          case 'redoAll':
            try {
              await this.redoAll();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'redoAll', pending: false });
            }
            break;
          case 'discardUndone':
            try {
              await this.discardUndone(data.confirmed === true);
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'discardUndone', pending: false });
            }
            break;
          case 'viewRevertDiff':
            try {
              await this.viewRevertDiff();
            } finally {
              this.postMessage({ type: 'revertActionState', action: 'viewRevertDiff', pending: false });
            }
            break;
          case 'switchSession':
            if (typeof data.sessionId === 'string') {
              await this.switchToSession(data.sessionId);
            } else {
              this.postSessions();
            }
            break;
          case 'clearCurrentSession': {
            try {
              if (this.isProcessing) {
                postInputNotice(this, 'Stop the current task before clearing the session.');
                break;
              }
              if (data.confirmed !== true) break;
              this.toolDiffBeforeByToolCallId.clear();
              this.toolDiffSnapshotsByToolCallId.clear();
              await this.clearCurrentSession();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'clearCurrentSession', pending: false });
            }
            break;
          }
          case 'clearSavedSessions': {
            try {
              if (this.isProcessing) {
                postInputNotice(this, 'Stop the current task before clearing saved sessions.');
                break;
              }
              if (data.confirmed !== true) break;
              await this.clearSavedSessions();
            } finally {
              this.postMessage({ type: 'sessionActionState', action: 'clearSavedSessions', pending: false });
            }
            break;
          }
          case 'send':
            {
              const payload = data as Record<string, unknown>;
              const submissionId = parseComposerSubmissionId(payload.submissionId);
              if (!submissionId) {
                postInputNotice(this, 'Message could not be accepted. Your draft was kept.');
                break;
              }
              const attachments = parseWebviewImageAttachments(payload.attachments);
              const message = typeof payload.message === 'string' ? payload.message : '';
              const draft = typeof payload.draft === 'string' ? payload.draft : message;
              this.pendingComposerAttachments = attachments;
              this.composerSubmissionState = {
                id: submissionId,
                status: 'pending',
                draft,
              };
              this.postMessage({
                type: 'sendState',
                submissionId,
                status: 'pending',
                draft,
              });

              let accepted = false;
              const onAccepted = () => {
                if (accepted) return;
                accepted = true;
                if (this.composerSubmissionState?.id === submissionId) {
                  this.pendingComposerAttachments = [];
                  this.composerSubmissionState = {
                    id: submissionId,
                    status: 'accepted',
                    draft,
                  };
                }
                this.postMessage({
                  type: 'sendState',
                  submissionId,
                  status: 'accepted',
                  draft,
                });
              };
              const input: ChatUserInput = {
                message,
                attachments,
              };
              try {
                await this.handleUserMessage(input, { onAccepted });
              } catch (error) {
                if (accepted) throw error;
                appendErrorLog(this.outputChannel, 'Failed to accept composer submission', error, {
                  tag: 'Webview',
                });
              }

              if (!accepted) {
                if (this.composerSubmissionState?.id === submissionId) {
                  this.composerSubmissionState = {
                    id: submissionId,
                    status: 'rejected',
                    draft,
                  };
                }
                this.postMessage({
                  type: 'sendState',
                  submissionId,
                  status: 'rejected',
                  draft,
                  message: 'Message was not accepted. Your draft was restored.',
                });
              }
            }
            break;
          case 'composerSubmissionSettled': {
            const payload = data as Record<string, unknown>;
            const submissionId = parseComposerSubmissionId(payload.submissionId);
            if (
              submissionId &&
              this.composerSubmissionState?.id === submissionId &&
              this.composerSubmissionState.status !== 'pending'
            ) {
              this.composerSubmissionState = undefined;
            }
            break;
          }
          case 'composerAttachmentsState': {
            const payload = data as Record<string, unknown>;
            this.pendingComposerAttachments = parseWebviewImageAttachments(payload.attachments);
            break;
          }
          case 'clearQueue': {
            try {
              this.queueManager.clearActiveSession({ notify: false });
              this.queueManager.flushAutosendForActiveSession().catch(() => {});
            } finally {
              this.queueManager.postState();
            }
            break;
          }
          case 'steerQueuedInput': {
            const id = typeof (data as any).id === 'string' ? String((data as any).id) : '';
            let queueStateAlreadyPosted = false;
            try {
              if (id) {
                queueStateAlreadyPosted = await this.runner.steerQueuedInput(id);
              }
            } finally {
              if (!queueStateAlreadyPosted) {
                this.queueManager.postState();
              }
            }
            break;
          }
          case 'abort':
            this.abortCurrentRun();
            break;
          case 'approveAll':
            this.approveAllPendingApprovals({ includeManual: false });
            break;
          case 'clear': {
            this.toolDiffBeforeByToolCallId.clear();
            this.toolDiffSnapshotsByToolCallId.clear();
            await this.clearCurrentSession();
            break;
          }
          case WEBVIEW_MESSAGE_READY:
            handleWebviewReadyMessage(this, parseWebviewReadyMessage(data));
            break;
          case WEBVIEW_MESSAGE_INIT_ACK:
            if (!handleWebviewInitAckMessage(this, parseWebviewInitAckMessage(data))) {
              return;
            }
            break;
          case WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST: {
            const request = parseWebviewTranscriptHistoryRequest(data);
            if (request) {
              service.loadEarlierTranscriptMessages(request);
            }
            break;
          }
          case 'refreshSettingsState':
            await service.refreshSettingsState();
            break;
          case 'showModelPicker':
            await this.postModelPickerState(true);
            break;
          case 'refreshModels':
            await this.refreshModelsForUI();
            break;
          case 'clearRecentModels':
            await this.clearRecentModels();
            break;
          case 'authenticateProvider':
            await service.authenticateProvider();
            break;
          case 'disconnectProvider':
            await service.disconnectProvider();
            break;
          case 'switchProvider':
            if (typeof data.providerId === 'string') {
              await service.switchProvider(data.providerId);
            } else {
              await service.postProviderState();
            }
            break;
          case 'setOpenAICompatibleSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setOpenAICompatibleSettings(data.settings as Partial<OpenAICompatibleSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setCodexSubscriptionSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setCodexSubscriptionSettings(data.settings as Partial<CodexSubscriptionSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setPlanFirst':
            if (typeof data.enabled === 'boolean') {
              await service.setPlanFirst(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setAutoApprove':
            if (typeof data.enabled === 'boolean') {
              await service.setAutoApprove(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setAllowExternalPaths':
            if (typeof data.enabled === 'boolean') {
              await service.setAllowExternalPaths(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setBlockGitPush':
            if (typeof data.enabled === 'boolean') {
              await service.setBlockGitPush(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setDebugSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setDebugSettings(data.settings as Partial<DebugSettingsUi>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setPluginSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setPluginSettings(data.settings as Partial<PluginSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setToolRuntimeLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setToolRuntimeLimits(data.limits as Partial<ToolRuntimeLimits>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setToolFilter':
            if (Array.isArray(data.patterns) || typeof data.patterns === 'string') {
              await service.setToolFilter(normalizeToolFilter(data.patterns));
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'revokeAutoApprovedTool':
            if (typeof data.toolId === 'string') {
              await service.revokeAlwaysAllowedTool(data.toolId);
            } else {
              this.postMessage({ type: 'autoApprovedToolsState', autoApprovedTools: this.getAutoApprovedToolsForUI() });
            }
            break;
          case 'clearAutoApprovedTools':
            await service.clearAlwaysAllowedTools(data.confirmed === true);
            break;
          case 'setWorkspaceEnv':
            if (data.env && typeof data.env === 'object') {
              await service.setWorkspaceEnv(data.env as WorkspaceEnv);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setInstructionPatterns':
            if (Array.isArray(data.patterns) || typeof data.patterns === 'string') {
              await service.setInstructionPatterns(normalizeInstructionPatterns(data.patterns));
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setInstructionFileSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setInstructionFileSettings(data.settings as Partial<InstructionFileSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSkillsEnabled':
            if (typeof data.enabled === 'boolean') {
              await service.setSkillsEnabled(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSkillSearchPaths':
            if (Array.isArray(data.paths) || typeof data.paths === 'string') {
              await service.setSkillSearchPaths(normalizeSkillSearchPaths(data.paths));
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSkillsBudget':
            if (data.budget && typeof data.budget === 'object') {
              await service.setSkillsBudget(data.budget as Partial<SkillsBudget>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSessionsPersist':
            if (typeof data.enabled === 'boolean') {
              await service.setSessionsPersist(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSessionRetentionLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setSessionRetentionLimits(data.limits as Partial<SessionRetentionLimits>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setShowThinking':
            if (typeof data.enabled === 'boolean') {
              await service.setShowThinking(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoriesFeatureEnabled':
            if (typeof data.enabled === 'boolean') {
              await service.setMemoriesFeatureEnabled(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAutoRecall':
            if (typeof data.enabled === 'boolean') {
              await service.setMemoryAutoRecall(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAutoRecallBudget':
            if (data.budget && typeof data.budget === 'object') {
              await service.setMemoryAutoRecallBudget(data.budget as Partial<MemoryAutoRecallBudget>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAutoRecallFilters':
            if (data.filters && typeof data.filters === 'object') {
              await service.setMemoryAutoRecallFilters(data.filters as Partial<MemoryAutoRecallFilters>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setMemoryAdvancedLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setMemoryAdvancedLimits(data.limits as Partial<MemoryAdvancedLimits>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'updateMemories':
            await service.updateMemoriesNow();
            break;
          case 'dropMemories':
            await service.dropMemoriesNow(data.confirmed === true);
            break;
          case 'showLogs':
            try {
              service.showLogs();
            } finally {
              this.postMessage({ type: 'logsActionState', pending: false });
            }
            break;
          case 'listTools':
            await service.listTools();
            break;
          case 'runTool':
            await service.runTool(
              typeof data.toolId === 'string' ? data.toolId : undefined,
              data.args && typeof data.args === 'object' ? data.args as Record<string, unknown> : undefined,
              data.confirmed === true
            );
            break;
          case 'createToolsConfig':
            await service.createToolsConfig();
            break;
          case 'setExplorePrepass':
            if (typeof data.enabled === 'boolean') {
              await service.setExplorePrepass(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setExplorePrepassMaxChars':
            if (typeof data.maxChars === 'number') {
              await service.setExplorePrepassMaxChars(data.maxChars);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSubagentModelOverride':
            if (typeof data.model === 'string') {
              await service.setSubagentModelOverride(data.model);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setSubagentTaskMaxOutputChars':
            if (typeof data.maxChars === 'number') {
              await service.setSubagentTaskMaxOutputChars(data.maxChars);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setAutoCompaction':
            if (typeof data.enabled === 'boolean') {
              await service.setAutoCompaction(data.enabled);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setCompactionPruneSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setCompactionPruneSettings(data.settings as Partial<CompactionPruneSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setCompactionToolOutputMode':
            if (typeof data.mode === 'string') {
              await service.setCompactionToolOutputMode(data.mode);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setModelLimits':
            if (data.limits && typeof data.limits === 'object') {
              await service.setModelLimits(data.limits as ModelLimits);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'setGenerationSettings':
            if (data.settings && typeof data.settings === 'object') {
              await service.setGenerationSettings(data.settings as Partial<GenerationSettings>);
            } else {
              await service.refreshSettingsState();
            }
            break;
          case 'changeModel':
            if (typeof data.model === 'string') {
              await this.setCurrentModel(data.model);
            } else {
              await this.postModelState();
              await this.postModelPickerState(false);
            }
            break;
          case 'setReasoningEffort':
            if (typeof data.reasoningEffort === 'string') {
              await this.setReasoningEffort(data.reasoningEffort);
            } else {
              await this.postModelState();
            }
            break;
          case 'openAdvancedModelSettings':
            try {
              await this.openAdvancedModelSettings();
            } finally {
              this.postMessage({ type: 'advancedModelSettingsState', pending: false });
            }
            break;
          case 'toggleFavoriteModel': {
            const modelId =
              typeof data.model === 'string' && data.model.trim()
                ? data.model.trim()
                : this.currentModel;
            if (modelId) {
              await this.toggleFavoriteModel(modelId);
            } else {
              await this.postModelState();
              await this.postModelPickerState(false);
            }
            break;
          }
          case 'changeMode': {
            const postCurrentMode = () => this.postMessage({ type: 'modeChanged', mode: this.mode });
            if (this.isProcessing) {
              postInputNotice(this, 'Stop the current task before switching modes.');
              postCurrentMode();
              break;
            }
            if (data.mode !== 'plan' && data.mode !== 'build') {
              postCurrentMode();
              break;
            }
            if (data.mode === 'build') {
              const pendingPlan = this.getActiveSession().pendingPlan;
              if (pendingPlan) {
                postCurrentMode();
                await this.executePendingPlan(pendingPlan.planMessageId);
                break;
              }
            }
            if (data.mode === this.mode) {
              postCurrentMode();
              break;
            }
            await this.setModeAndPersist(data.mode);
            break;
          }
          case 'executePlan':
            await this.executePendingPlan(
              typeof data.planMessageId === 'string' ? data.planMessageId : undefined
            );
            break;
          case 'cancelPlan': {
            const pendingPlan = this.getActiveSession().pendingPlan;
            if (pendingPlan?.planMessageId === data.planMessageId && data.confirmed !== true) {
              this.postMessage({ type: 'planPending', value: true, planMessageId: pendingPlan?.planMessageId ?? '' });
              break;
            }
            await this.cancelPendingPlan(typeof data.planMessageId === 'string' ? data.planMessageId : '');
            break;
          }
          case 'revisePlan':
            {
              const pendingPlan = this.getActiveSession().pendingPlan;
              if (!pendingPlan || pendingPlan.planMessageId !== data.planMessageId) {
                this.postMessage({
                  type: 'planPending',
                  value: !!pendingPlan,
                  planMessageId: pendingPlan?.planMessageId ?? '',
                });
                break;
              }
            }

            if (typeof data.instructions === 'string' && data.instructions.trim()) {
              await this.revisePendingPlan(data.planMessageId, data.instructions);
              return;
            }

            postInputNotice(this, 'Type plan revisions in the chat input, then press Enter or click Revise again.');
            this.postMessage({
              type: 'setInput',
              value: '',
              placeholder: 'Type plan revisions or answer questions, then press Enter or click Revise again…',
            });
            break;
          case 'approveToolCall':
            this.handleApprovalResponse(data.approvalId, true);
            break;
          case 'rejectToolCall':
            this.handleApprovalResponse(data.approvalId, false);
            break;
          case 'retryTool':
            if (typeof data.approvalId === 'string' && data.approvalId.trim()) {
              await this.retryToolCall(data.approvalId.trim());
            } else {
              this.postMessage({ type: 'processing', value: this.isProcessing });
            }
            break;
          case 'alwaysAllowTool': {
            if (typeof data.approvalId === 'string' && data.approvalId.trim()) {
              await this.handleAlwaysAllowApproval(data.approvalId.trim());
            } else {
              this.postApprovalState();
            }
            break;
          }
          case WEBVIEW_MESSAGE_ERROR: {
            const message = parseWebviewErrorMessage(data);
            handleWebviewCrashMessage(this, message?.error);
            break;
          }
        }
        } catch (error) {
          appendErrorLog(this.outputChannel, `Failed to handle webview message: ${messageType}`, error, { tag: 'Webview' });
          postInputNotice(this, 'That chat UI action failed. See logs for details.');
          await service.refreshSettingsState().catch(() => {});
          this.postMessage({ type: 'processing', value: this.isProcessing });
        }
      })
    );

    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.startInitPusher();
  },

  startInitPusher(this: ChatWebviewRuntime): void {
    if (this.initInterval) {
      clearInterval(this.initInterval);
      this.initInterval = undefined;
    }

    this.initInterval = setInterval(() => {
      void this.sendInit();
    }, 2000);

    void this.sendInit();
  },

  async sendInit(this: ChatWebviewRuntime, force = false): Promise<void> {
    if (!this.view) return;
    if (!force && this.initAcked) return;
    if (this.initInFlight) return;

    this.initInFlight = true;
    let initPosted = false;
    try {
      await this.ensureSessionsLoaded();

      const modelLabel = this.getModelLabel(this.currentModel) || this.currentModel;
      const currentModelIsFavorite = await this.isModelFavorite(this.currentModel);
      this.postMessage(
        await buildWebviewInitMessage(this, {
          modelLabel,
          currentModelIsFavorite,
        })
      );
      initPosted = true;
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to send init', error, { tag: 'Webview' });

      const fallback = this.currentModel || 'gpt-4o';
      this.currentModel = fallback;
      let currentModelIsFavorite = false;
      try {
        currentModelIsFavorite = await this.isModelFavorite(fallback);
      } catch {
        currentModelIsFavorite = false;
      }

      try {
        this.postMessage(
          await buildWebviewInitMessage(this, {
            modelLabel: fallback,
            currentModelIsFavorite,
          })
        );
        initPosted = true;
      } catch (postError) {
        appendErrorLog(this.outputChannel, 'Failed to post init fallback', postError, {
          tag: 'Webview',
        });
      }
    } finally {
      this.initInFlight = false;
      if (initPosted) {
        scheduleDeferredWebviewState(this);
        scheduleDeferredTodos(this);
      }
      void this.queueManager.flushAutosendForActiveSession();
    }
  },

  loadEarlierTranscriptMessages(
    this: ChatWebviewRuntime,
    request: WebviewTranscriptHistoryRequest
  ): void {
    const responseBase = {
      type: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE,
      requestId: request.requestId,
      sessionId: request.sessionId,
      requestCursor: request.cursor,
    };

    if (request.sessionId !== this.activeSessionId) {
      this.postMessage({
        ...responseBase,
        messages: [],
        hasEarlierMessages: false,
        cursor: '',
        error: 'staleSession',
      });
      return;
    }

    const page = createEarlierTranscriptPage(this.getRenderableMessages(), request.cursor);
    if (!page) {
      this.postMessage({
        ...responseBase,
        messages: [],
        hasEarlierMessages: false,
        cursor: '',
        error: 'staleCursor',
      });
      return;
    }

    this.postMessage({
      ...responseBase,
      messages: page.messages,
      hasEarlierMessages: page.hasEarlierMessages,
      cursor: page.cursor ?? '',
    });
  },

  async refreshSettingsState(this: ChatWebviewRuntime): Promise<void> {
    if (!this.view) return;

    try {
      this.skillNamesForUiPromise = undefined;
      this.postMessage(await buildWebviewSettingsStateMessage(this));
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to refresh chat settings state', error, { tag: 'Webview' });
    }
  },

  async getProviderAuthStateForUI(this: ChatWebviewRuntime): Promise<ProviderAuthUiState> {
    const provider = this.llmProvider;
    const providerId = typeof provider?.id === 'string' ? provider.id : '';
    const providerName = typeof provider?.name === 'string' ? provider.name : '';

    if (!provider?.getAuthStatus) {
      return {
        providerId,
        providerName,
        supported: false,
        authenticated: false,
        status: 'hidden',
        label: '',
      };
    }

    const status = await provider.getAuthStatus().catch(() => undefined);
    if (!status) {
      return {
        providerId,
        providerName,
        supported: true,
        authenticated: false,
        status: 'signed_out',
        label: 'Sign in',
      };
    }

    return {
      providerId,
      providerName,
      supported: status.supported !== false,
      authenticated: !!status.authenticated,
      status: status.status || (status.authenticated ? 'signed_in' : 'signed_out'),
      label: status.label || '',
      ...(status.detail ? { detail: status.detail } : {}),
      ...(status.accountLabel ? { accountLabel: status.accountLabel } : {}),
      ...(status.primaryActionLabel ? { primaryActionLabel: status.primaryActionLabel } : {}),
      ...(status.secondaryActionLabel ? { secondaryActionLabel: status.secondaryActionLabel } : {}),
    };
  },

  async postProviderState(this: ChatWebviewRuntime): Promise<void> {
    const providerAuth = await service.getProviderAuthStateForUI();
    this.postMessage({ type: 'providerState', currentProviderId: getConfiguredLlmProviderId(), providerAuth });
  },

  async switchProvider(this: ChatWebviewRuntime, providerId: string): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before switching providers.');
      await service.postProviderState();
      return;
    }

    const normalized = normalizeLlmProviderId(providerId);
    if (!normalized) {
      postInputNotice(this, 'Unsupported provider.');
      await service.postProviderState();
      return;
    }

    if (normalized === getConfiguredLlmProviderId()) {
      await service.postProviderState();
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('llmProvider', normalized, true);
      this.postMessage({ type: 'providerState', currentProviderId: normalized, providerAuth: await service.getProviderAuthStateForUI() });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist provider setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to switch provider. See logs for details.');
      await service.postProviderState();
    }
  },

  async setOpenAICompatibleSettings(this: ChatWebviewRuntime, settings: Partial<OpenAICompatibleSettings>): Promise<void> {
    const postCurrentState = async () => {
      this.postMessage({
        type: 'openAICompatibleSettingsState',
        openAICompatibleSettings: getOpenAICompatibleSettings(),
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing OpenAI-compatible provider settings.');
      await postCurrentState();
      return;
    }

    const current = getOpenAICompatibleSettings();
    const raw = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
    const displayNamesValidationError = Object.prototype.hasOwnProperty.call(raw, 'modelDisplayNames')
      ? getOpenAICompatibleModelDisplayNamesValidationError(raw.modelDisplayNames)
      : undefined;
    if (displayNamesValidationError) {
      postInputNotice(this, displayNamesValidationError);
      await postCurrentState();
      return;
    }

    const next: OpenAICompatibleSettings = {
      baseURL: Object.prototype.hasOwnProperty.call(raw, 'baseURL')
        ? normalizeOpenAICompatibleText(raw.baseURL, 500)
        : current.baseURL,
      defaultModelId: Object.prototype.hasOwnProperty.call(raw, 'defaultModelId')
        ? normalizeOpenAICompatibleText(raw.defaultModelId, 200)
        : current.defaultModelId,
      apiKeyEnv: Object.prototype.hasOwnProperty.call(raw, 'apiKeyEnv')
        ? (normalizeOpenAICompatibleText(raw.apiKeyEnv, 120) || 'OPENAI_API_KEY')
        : current.apiKeyEnv,
      allowInsecureTLS: Object.prototype.hasOwnProperty.call(raw, 'allowInsecureTLS')
        ? raw.allowInsecureTLS === true
        : current.allowInsecureTLS,
      modelDisplayNames: Object.prototype.hasOwnProperty.call(raw, 'modelDisplayNames')
        ? normalizeOpenAICompatibleModelDisplayNames(raw.modelDisplayNames)
        : current.modelDisplayNames,
    };

    if (next.baseURL && !/^https?:\/\//i.test(next.baseURL)) {
      postInputNotice(this, 'OpenAI-compatible base URL must start with http:// or https://.');
      await postCurrentState();
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next.apiKeyEnv)) {
      postInputNotice(this, 'API key environment variable must be a valid environment variable name.');
      await postCurrentState();
      return;
    }
    if (openAICompatibleSettingsEqual(next, current)) {
      this.postMessage({
        type: 'openAICompatibleSettingsState',
        openAICompatibleSettings: current,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('openaiCompatible.baseURL', next.baseURL, true);
      await config.update('openaiCompatible.defaultModelId', next.defaultModelId, true);
      await config.update('openaiCompatible.apiKeyEnv', next.apiKeyEnv, true);
      await config.update('openaiCompatible.allowInsecureTLS', next.allowInsecureTLS, true);
      await config.update('openaiCompatible.modelDisplayNames', next.modelDisplayNames, true);
      this.postMessage({
        type: 'openAICompatibleSettingsState',
        openAICompatibleSettings: next,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist OpenAI-compatible provider settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update OpenAI-compatible provider settings. See logs for details.');
      await postCurrentState();
    }
  },

  async setCodexSubscriptionSettings(this: ChatWebviewRuntime, settings: Partial<CodexSubscriptionSettings>): Promise<void> {
    const postCurrentState = async () => {
      this.postMessage({
        type: 'codexSubscriptionSettingsState',
        codexSubscriptionSettings: getCodexSubscriptionSettings(),
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing Codex subscription provider settings.');
      await postCurrentState();
      return;
    }

    const current = getCodexSubscriptionSettings();
    const raw = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
    if (Object.prototype.hasOwnProperty.call(raw, 'defaultModelId') && typeof raw.defaultModelId !== 'string') {
      postInputNotice(this, 'Codex subscription default model must be a string.');
      await postCurrentState();
      return;
    }

    const next: CodexSubscriptionSettings = {
      defaultModelId: Object.prototype.hasOwnProperty.call(raw, 'defaultModelId')
        ? (normalizeOpenAICompatibleText(raw.defaultModelId, 200) || 'gpt-5.3-codex')
        : current.defaultModelId,
    };
    if (next.defaultModelId === current.defaultModelId) {
      this.postMessage({
        type: 'codexSubscriptionSettingsState',
        codexSubscriptionSettings: current,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('codexSubscription.defaultModelId', next.defaultModelId, true);
      this.postMessage({
        type: 'codexSubscriptionSettingsState',
        codexSubscriptionSettings: next,
        currentProviderId: getConfiguredLlmProviderId(),
        providerAuth: await service.getProviderAuthStateForUI(),
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist Codex subscription provider settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update Codex subscription provider settings. See logs for details.');
      await postCurrentState();
    }
  },

  async setPlanFirst(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing plan-first behavior.');
      this.postMessage({ type: 'planFirstState', planFirst: getPlanFirstEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getPlanFirstEnabled();
    if (next === current) {
      this.postMessage({ type: 'planFirstState', planFirst: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('planFirst', next, true);
      this.postMessage({ type: 'planFirstState', planFirst: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist plan-first setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update plan-first behavior. See logs for details.');
      this.postMessage({ type: 'planFirstState', planFirst: getPlanFirstEnabled() });
    }
  },

  async setAutoApprove(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing tool safety behavior.');
      this.postMessage({ type: 'autoApproveState', autoApprove: getAutoApproveEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getAutoApproveEnabled();
    if (next === current) {
      this.postMessage({ type: 'autoApproveState', autoApprove: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('autoApprove', next, true);
      this.postMessage({ type: 'autoApproveState', autoApprove: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist auto-approve setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update tool safety behavior. See logs for details.');
      this.postMessage({ type: 'autoApproveState', autoApprove: getAutoApproveEnabled() });
    }
  },

  async setAllowExternalPaths(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing external path access.');
      this.postMessage({ type: 'allowExternalPathsState', allowExternalPaths: getAllowExternalPathsEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getAllowExternalPathsEnabled();
    if (next === current) {
      this.postMessage({ type: 'allowExternalPathsState', allowExternalPaths: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('security.allowExternalPaths', next, true);
      this.postMessage({ type: 'allowExternalPathsState', allowExternalPaths: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist external path access setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update external path access. See logs for details.');
      this.postMessage({ type: 'allowExternalPathsState', allowExternalPaths: getAllowExternalPathsEnabled() });
    }
  },

  async setBlockGitPush(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing git push protection.');
      this.postMessage({ type: 'blockGitPushState', blockGitPush: getBlockGitPushEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getBlockGitPushEnabled();
    if (next === current) {
      this.postMessage({ type: 'blockGitPushState', blockGitPush: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('security.blockGitPush', next, true);
      this.postMessage({ type: 'blockGitPushState', blockGitPush: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist git push protection setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update git push protection. See logs for details.');
      this.postMessage({ type: 'blockGitPushState', blockGitPush: getBlockGitPushEnabled() });
    }
  },

  async setDebugSettings(this: ChatWebviewRuntime, settings: Partial<DebugSettingsUi>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'debugSettingsState', debugSettings: getDebugSettingsForUi() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing diagnostics logging.');
      postCurrentState();
      return;
    }

    const current = getDebugSettingsForUi();
    const normalized = normalizeDebugSettings(settings, current);
    if (debugSettingsEqual(normalized, current)) {
      this.postMessage({ type: 'debugSettingsState', debugSettings: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('debug.details', normalized.details, true);
      await config.update('debug.llm', normalized.llm, true);
      await config.update('debug.tools', normalized.tools, true);
      await config.update('debug.plugins', normalized.plugins, true);
      this.postMessage({ type: 'debugSettingsState', debugSettings: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist diagnostics logging settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update diagnostics logging. See logs for details.');
      postCurrentState();
    }
  },

  async setPluginSettings(this: ChatWebviewRuntime, settings: Partial<PluginSettings>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'pluginSettingsState', pluginSettings: getPluginSettings() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing plugin loading behavior.');
      postCurrentState();
      return;
    }

    const current = getPluginSettings();
    const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
    const next: PluginSettings = {
      plugins: Object.prototype.hasOwnProperty.call(raw, 'plugins')
        ? normalizePluginSpecs(raw.plugins)
        : current.plugins,
      autoDiscover: typeof raw.autoDiscover === 'boolean' ? raw.autoDiscover : current.autoDiscover,
      workspaceDir: Object.prototype.hasOwnProperty.call(raw, 'workspaceDir')
        ? normalizePluginWorkspaceDir(raw.workspaceDir)
        : current.workspaceDir,
    };

    if (hasListItemLongerThan(next.plugins, 240)) {
      postInputNotice(this, 'Plugin module specs must be 240 characters or shorter.');
      postCurrentState();
      return;
    }
    if (next.workspaceDir.length > 120) {
      postInputNotice(this, 'Plugin workspace directory must be 120 characters or shorter.');
      postCurrentState();
      return;
    }
    if (pluginSettingsEqual(next, current)) {
      this.postMessage({ type: 'pluginSettingsState', pluginSettings: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('plugins', next.plugins, true);
      await config.update('plugins.autoDiscover', next.autoDiscover, true);
      await config.update('plugins.workspaceDir', next.workspaceDir, true);
      this.postMessage({ type: 'pluginSettingsState', pluginSettings: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist plugin settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update plugin settings. See logs for details.');
      postCurrentState();
    }
  },

  async setToolRuntimeLimits(this: ChatWebviewRuntime, limits: Partial<ToolRuntimeLimits>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'toolRuntimeLimitsState', toolRuntimeLimits: getToolRuntimeLimits() });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing tool runtime limits.');
      postCurrentState();
      return;
    }

    const current = getToolRuntimeLimits();
    const next: ToolRuntimeLimits = {
      toolTimeoutMs: Number(limits.toolTimeoutMs ?? current.toolTimeoutMs),
      readMaxLines: Number(limits.readMaxLines ?? current.readMaxLines),
      bashBackgroundTtlMs: Number(limits.bashBackgroundTtlMs ?? current.bashBackgroundTtlMs),
      bashBackgroundCaptureMs: Number(limits.bashBackgroundCaptureMs ?? current.bashBackgroundCaptureMs),
      bashBackgroundCaptureLines: Number(limits.bashBackgroundCaptureLines ?? current.bashBackgroundCaptureLines),
      workspaceShellTimeoutMs: Number(limits.workspaceShellTimeoutMs ?? current.workspaceShellTimeoutMs),
      httpTimeoutMs: Number(limits.httpTimeoutMs ?? current.httpTimeoutMs),
    };

    if (
      !Number.isFinite(next.toolTimeoutMs) || next.toolTimeoutMs < 0 ||
      !Number.isFinite(next.readMaxLines) || next.readMaxLines < 1 ||
      !Number.isFinite(next.bashBackgroundTtlMs) || next.bashBackgroundTtlMs < 0 ||
      !Number.isFinite(next.bashBackgroundCaptureMs) || next.bashBackgroundCaptureMs < 0 ||
      !Number.isFinite(next.bashBackgroundCaptureLines) || next.bashBackgroundCaptureLines < 0 ||
      !Number.isFinite(next.workspaceShellTimeoutMs) || next.workspaceShellTimeoutMs < 0 ||
      !Number.isFinite(next.httpTimeoutMs) || next.httpTimeoutMs < 0
    ) {
      postInputNotice(this, 'Tool runtime limits must be non-negative, and Read max lines must be at least 1.');
      postCurrentState();
      return;
    }

    const normalized: ToolRuntimeLimits = {
      toolTimeoutMs: Math.floor(next.toolTimeoutMs),
      readMaxLines: Math.floor(next.readMaxLines),
      bashBackgroundTtlMs: Math.floor(next.bashBackgroundTtlMs),
      bashBackgroundCaptureMs: Math.floor(next.bashBackgroundCaptureMs),
      bashBackgroundCaptureLines: Math.floor(next.bashBackgroundCaptureLines),
      workspaceShellTimeoutMs: Math.floor(next.workspaceShellTimeoutMs),
      httpTimeoutMs: Math.floor(next.httpTimeoutMs),
    };
    if (toolRuntimeLimitsEqual(normalized, current)) {
      this.postMessage({ type: 'toolRuntimeLimitsState', toolRuntimeLimits: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('toolTimeoutMs', normalized.toolTimeoutMs, true);
      await config.update('tools.read.maxLines', normalized.readMaxLines, true);
      await config.update('tools.bash.backgroundTtlMs', normalized.bashBackgroundTtlMs, true);
      await config.update('tools.bash.backgroundCaptureMs', normalized.bashBackgroundCaptureMs, true);
      await config.update('tools.bash.backgroundCaptureLines', normalized.bashBackgroundCaptureLines, true);
      await config.update('tools.workspaceShell.timeoutMs', normalized.workspaceShellTimeoutMs, true);
      await config.update('tools.http.timeoutMs', normalized.httpTimeoutMs, true);
      this.postMessage({ type: 'toolRuntimeLimitsState', toolRuntimeLimits: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist tool runtime limits', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update tool runtime limits. See logs for details.');
      postCurrentState();
    }
  },

  async setToolFilter(this: ChatWebviewRuntime, patterns: ToolFilter): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'toolFilterState', toolFilter: getToolFilter() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing tool availability.');
      postCurrentState();
      return;
    }

    const normalized = normalizeToolFilter(patterns);
    if (hasListItemLongerThan(normalized, 120)) {
      postInputNotice(this, 'Tool filter patterns must be 120 characters or shorter.');
      postCurrentState();
      return;
    }

    const current = getToolFilter();
    if (stringListsEqual(normalized, current)) {
      this.postMessage({ type: 'toolFilterState', toolFilter: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('toolFilter', normalized, true);
      this.postMessage({ type: 'toolFilterState', toolFilter: normalized, toolsCatalog: await buildToolCatalogForUI() });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist tool filter setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update tool availability. See logs for details.');
      postCurrentState();
    }
  },

  async revokeAlwaysAllowedTool(this: ChatWebviewRuntime, toolId: string): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'autoApprovedToolsState', autoApprovedTools: this.getAutoApprovedToolsForUI() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing always-allowed tools.');
      postCurrentState();
      return;
    }

    const normalizedToolId = typeof toolId === 'string' ? toolId.trim() : '';
    if (!normalizedToolId) {
      postInputNotice(this, 'Choose an always-allowed tool to revoke.');
      postCurrentState();
      return;
    }

    try {
      await this.revokeAutoApprovedTool(normalizedToolId);
      postCurrentState();
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to revoke always-allowed tool', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to revoke always-allowed tool. See logs for details.');
      postCurrentState();
    }
  },

  async clearAlwaysAllowedTools(this: ChatWebviewRuntime, confirmed?: boolean): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'autoApprovedToolsState', autoApprovedTools: this.getAutoApprovedToolsForUI() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before clearing always-allowed tools.');
      postCurrentState();
      return;
    }

    if (this.getAutoApprovedToolsForUI().length === 0 || confirmed !== true) {
      postCurrentState();
      return;
    }

    try {
      await this.clearAutoApprovedToolsForUI();
      postCurrentState();
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to clear always-allowed tools', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to clear always-allowed tools. See logs for details.');
      postCurrentState();
    }
  },

  async setWorkspaceEnv(this: ChatWebviewRuntime, env: WorkspaceEnv): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'workspaceEnvState', workspaceEnv: getWorkspaceEnv() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing workspace tool environment variables.');
      postCurrentState();
      return;
    }

    const validationError = getWorkspaceEnvValidationError(env);
    if (validationError) {
      postInputNotice(this, validationError);
      postCurrentState();
      return;
    }

    const normalized = normalizeWorkspaceEnv(env);
    const current = getWorkspaceEnv();
    if (workspaceEnvEqual(normalized, current)) {
      this.postMessage({ type: 'workspaceEnvState', workspaceEnv: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('env', normalized, true);
      this.postMessage({ type: 'workspaceEnvState', workspaceEnv: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist workspace tool environment variables', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update workspace tool environment variables. See logs for details.');
      postCurrentState();
    }
  },

  async setInstructionPatterns(this: ChatWebviewRuntime, patterns: InstructionPatterns): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'instructionPatternsState', instructionPatterns: getInstructionPatterns() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing instruction files.');
      postCurrentState();
      return;
    }

    const normalized = normalizeInstructionPatterns(patterns);
    if (hasListItemLongerThan(normalized, 240)) {
      postInputNotice(this, 'Instruction paths and glob patterns must be 240 characters or shorter.');
      postCurrentState();
      return;
    }

    const current = getInstructionPatterns();
    if (stringListsEqual(normalized, current)) {
      this.postMessage({ type: 'instructionPatternsState', instructionPatterns: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('instructions', normalized, true);
      this.postMessage({ type: 'instructionPatternsState', instructionPatterns: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist instruction pattern setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update instruction files. See logs for details.');
      postCurrentState();
    }
  },

  async setInstructionFileSettings(this: ChatWebviewRuntime, settings: Partial<InstructionFileSettings>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'instructionFileSettingsState', instructionFileSettings: getInstructionFileSettings() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing instruction file loading.');
      postCurrentState();
      return;
    }

    const current = getInstructionFileSettings();
    const includeGlobal = typeof settings.includeGlobal === 'boolean' ? settings.includeGlobal : current.includeGlobal;
    const maxCharsPerFile = Number(settings.maxCharsPerFile ?? current.maxCharsPerFile);
    const maxTotalChars = Number(settings.maxTotalChars ?? current.maxTotalChars);

    if (
      !Number.isFinite(maxCharsPerFile) || maxCharsPerFile < 1000 ||
      !Number.isFinite(maxTotalChars) || maxTotalChars < 1000
    ) {
      postInputNotice(this, 'Instruction file character limits must be at least 1000.');
      postCurrentState();
      return;
    }

    const normalized: InstructionFileSettings = {
      includeGlobal,
      maxCharsPerFile: Math.floor(maxCharsPerFile),
      maxTotalChars: Math.floor(maxTotalChars),
    };
    if (instructionFileSettingsEqual(normalized, current)) {
      this.postMessage({ type: 'instructionFileSettingsState', instructionFileSettings: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('instructionFiles.includeGlobal', normalized.includeGlobal, true);
      await config.update('instructionFiles.maxCharsPerFile', normalized.maxCharsPerFile, true);
      await config.update('instructionFiles.maxTotalChars', normalized.maxTotalChars, true);
      this.postMessage({ type: 'instructionFileSettingsState', instructionFileSettings: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist instruction file loading settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update instruction file loading. See logs for details.');
      postCurrentState();
    }
  },

  async setSkillsEnabled(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing skills behavior.');
      this.postMessage({
        type: 'skillsEnabledState',
        skillsEnabled: getSkillsEnabled(),
        skills: await this.getSkillNamesForUI(),
      });
      return;
    }

    const next = !!enabled;
    const current = getSkillsEnabled();
    if (next === current) {
      this.postMessage({
        type: 'skillsEnabledState',
        skillsEnabled: current,
        skills: await this.getSkillNamesForUI(),
      });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('skills.enabled', next, true);
      this.skillNamesForUiPromise = undefined;
      this.postMessage({
        type: 'skillsEnabledState',
        skillsEnabled: next,
        skills: await this.getSkillNamesForUI(),
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist skills enabled setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update skills behavior. See logs for details.');
      this.skillNamesForUiPromise = undefined;
      this.postMessage({
        type: 'skillsEnabledState',
        skillsEnabled: getSkillsEnabled(),
        skills: await this.getSkillNamesForUI(),
      });
    }
  },

  async setSkillSearchPaths(this: ChatWebviewRuntime, paths: SkillSearchPaths): Promise<void> {
    const postCurrentState = async () => this.postMessage({
      type: 'skillSearchPathsState',
      skillSearchPaths: getSkillSearchPaths(),
      skills: await this.getSkillNamesForUI(),
    });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing skill search paths.');
      await postCurrentState();
      return;
    }

    const normalized = normalizeSkillSearchPaths(paths);
    if (hasListItemLongerThan(normalized, 240)) {
      postInputNotice(this, 'Skill search paths must be 240 characters or shorter.');
      await postCurrentState();
      return;
    }

    const current = getSkillSearchPaths();
    if (stringListsEqual(normalized, current)) {
      this.postMessage({
        type: 'skillSearchPathsState',
        skillSearchPaths: current,
        skills: await this.getSkillNamesForUI(),
      });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('skills.paths', normalized, true);
      this.skillNamesForUiPromise = undefined;
      this.postMessage({
        type: 'skillSearchPathsState',
        skillSearchPaths: normalized,
        skills: await this.getSkillNamesForUI(),
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist skill search paths setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update skill search paths. See logs for details.');
      this.skillNamesForUiPromise = undefined;
      await postCurrentState();
    }
  },

  async setSkillsBudget(this: ChatWebviewRuntime, budget: Partial<SkillsBudget>): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'skillsBudgetState', skillsBudget: getSkillsBudget() });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing skills prompt budgets.');
      postCurrentState();
      return;
    }

    const current = getSkillsBudget();
    const next = { ...current, ...(budget || {}) };
    if (
      !Number.isFinite(next.maxPromptSkills) || next.maxPromptSkills < 0 ||
      !Number.isFinite(next.maxInjectSkills) || next.maxInjectSkills < 1 ||
      !Number.isFinite(next.maxInjectChars) || next.maxInjectChars < 1
    ) {
      postInputNotice(this, 'Skills budgets must be valid non-negative prompt cap and positive injection caps.');
      postCurrentState();
      return;
    }

    const normalized: SkillsBudget = {
      maxPromptSkills: Math.floor(next.maxPromptSkills),
      maxInjectSkills: Math.floor(next.maxInjectSkills),
      maxInjectChars: Math.floor(next.maxInjectChars),
    };
    if (skillsBudgetEqual(normalized, current)) {
      this.postMessage({ type: 'skillsBudgetState', skillsBudget: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('skills.maxPromptSkills', normalized.maxPromptSkills, true);
      await config.update('skills.maxInjectSkills', normalized.maxInjectSkills, true);
      await config.update('skills.maxInjectChars', normalized.maxInjectChars, true);
      this.skillNamesForUiPromise = undefined;
      this.postMessage({ type: 'skillsBudgetState', skillsBudget: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist skills budget settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update skills budgets. See logs for details.');
      postCurrentState();
    }
  },

  async setSessionsPersist(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing session persistence.');
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: getSessionsPersistEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getSessionsPersistEnabled();
    if (next === current) {
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('sessions.persist', next, true);
      await this.onSessionPersistenceConfigChanged();
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: getSessionsPersistEnabled() });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist session persistence setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update session persistence. See logs for details.');
      this.postMessage({ type: 'sessionsPersistState', sessionsPersist: getSessionsPersistEnabled() });
    }
  },

  async setSessionRetentionLimits(this: ChatWebviewRuntime, limits: Partial<SessionRetentionLimits>): Promise<void> {
    const postCurrentState = () => {
      const current = getSessionRetentionLimits();
      this.postMessage({
        type: 'sessionRetentionState',
        sessionsMaxSessions: current.maxSessions,
        sessionsMaxSessionBytes: current.maxSessionBytes,
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing session retention.');
      postCurrentState();
      return;
    }

    const current = getSessionRetentionLimits();
    const nextMaxSessions = Number(limits.maxSessions ?? current.maxSessions);
    const nextMaxSessionBytes = Number(limits.maxSessionBytes ?? current.maxSessionBytes);
    if (!Number.isFinite(nextMaxSessions) || nextMaxSessions < 1 || !Number.isFinite(nextMaxSessionBytes) || nextMaxSessionBytes < 1000) {
      postInputNotice(this, 'Session retention must keep at least 1 session and 1000 bytes per session.');
      postCurrentState();
      return;
    }

    const normalized: SessionRetentionLimits = {
      maxSessions: Math.floor(nextMaxSessions),
      maxSessionBytes: Math.floor(nextMaxSessionBytes),
    };
    if (normalized.maxSessions === current.maxSessions && normalized.maxSessionBytes === current.maxSessionBytes) {
      this.postMessage({
        type: 'sessionRetentionState',
        sessionsMaxSessions: current.maxSessions,
        sessionsMaxSessionBytes: current.maxSessionBytes,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('sessions.maxSessions', normalized.maxSessions, true);
      await config.update('sessions.maxSessionBytes', normalized.maxSessionBytes, true);
      await this.onSessionPersistenceConfigChanged();
      this.postMessage({
        type: 'sessionRetentionState',
        sessionsMaxSessions: normalized.maxSessions,
        sessionsMaxSessionBytes: normalized.maxSessionBytes,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist session retention settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update session retention. See logs for details.');
      postCurrentState();
    }
  },

  async setShowThinking(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing thinking display.');
      this.postMessage({ type: 'showThinkingState', showThinking: getShowThinkingEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getShowThinkingEnabled();
    if (next === current) {
      this.postMessage({ type: 'showThinkingState', showThinking: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('showThinking', next, true);
      this.postMessage({ type: 'showThinkingState', showThinking: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist show-thinking setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update thinking display. See logs for details.');
      this.postMessage({ type: 'showThinkingState', showThinking: getShowThinkingEnabled() });
    }
  },

  async setMemoriesFeatureEnabled(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    const postCurrentState = () => this.postMessage({
      type: 'memoriesFeatureState',
      memoriesFeatureEnabled: getMemoriesFeatureEnabled(),
    });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory features.');
      postCurrentState();
      return;
    }

    const next = !!enabled;
    const current = getMemoriesFeatureEnabled();
    if (next === current) {
      this.postMessage({ type: 'memoriesFeatureState', memoriesFeatureEnabled: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('features.memories', next, true);
      this.postMessage({ type: 'memoriesFeatureState', memoriesFeatureEnabled: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memories feature setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory features. See logs for details.');
      postCurrentState();
    }
  },

  async setMemoryAutoRecall(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory recall behavior.');
      this.postMessage({ type: 'memoryAutoRecallState', memoryAutoRecall: getMemoryAutoRecallEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getMemoryAutoRecallEnabled();
    if (next === current) {
      this.postMessage({ type: 'memoryAutoRecallState', memoryAutoRecall: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('memories.autoRecall', next, true);
      this.postMessage({ type: 'memoryAutoRecallState', memoryAutoRecall: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memory auto-recall setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory recall behavior. See logs for details.');
      this.postMessage({ type: 'memoryAutoRecallState', memoryAutoRecall: getMemoryAutoRecallEnabled() });
    }
  },

  async setMemoryAutoRecallBudget(this: ChatWebviewRuntime, budget: Partial<MemoryAutoRecallBudget>): Promise<void> {
    const postCurrentState = () => {
      const current = getMemoryAutoRecallBudget();
      this.postMessage({
        type: 'memoryAutoRecallBudgetState',
        memoryAutoRecallMaxResults: current.maxResults,
        memoryAutoRecallMaxTokens: current.maxTokens,
      });
    };
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory recall budget.');
      postCurrentState();
      return;
    }

    const current = getMemoryAutoRecallBudget();
    const nextMaxResults = Number(budget.maxResults ?? current.maxResults);
    const nextMaxTokens = Number(budget.maxTokens ?? current.maxTokens);
    if (!Number.isFinite(nextMaxResults) || nextMaxResults < 1 || !Number.isFinite(nextMaxTokens) || nextMaxTokens < 100) {
      postInputNotice(this, 'Memory recall budget must allow at least 1 result and 100 tokens.');
      postCurrentState();
      return;
    }

    const normalized: MemoryAutoRecallBudget = {
      maxResults: Math.floor(nextMaxResults),
      maxTokens: Math.floor(nextMaxTokens),
    };
    if (normalized.maxResults === current.maxResults && normalized.maxTokens === current.maxTokens) {
      this.postMessage({
        type: 'memoryAutoRecallBudgetState',
        memoryAutoRecallMaxResults: current.maxResults,
        memoryAutoRecallMaxTokens: current.maxTokens,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('memories.maxAutoRecallResults', normalized.maxResults, true);
      await config.update('memories.maxAutoRecallTokens', normalized.maxTokens, true);
      this.postMessage({
        type: 'memoryAutoRecallBudgetState',
        memoryAutoRecallMaxResults: normalized.maxResults,
        memoryAutoRecallMaxTokens: normalized.maxTokens,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memory auto-recall budget', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory recall budget. See logs for details.');
      postCurrentState();
    }
  },

  async setMemoryAutoRecallFilters(this: ChatWebviewRuntime, filters: Partial<MemoryAutoRecallFilters>): Promise<void> {
    const postCurrentState = () => {
      const current = getMemoryAutoRecallFilters();
      this.postMessage({
        type: 'memoryAutoRecallFiltersState',
        memoryAutoRecallMinScore: current.minScore,
        memoryAutoRecallMinScoreGap: current.minScoreGap,
        memoryAutoRecallMaxAgeDays: current.maxAgeDays,
      });
    };
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory recall filters.');
      postCurrentState();
      return;
    }

    const current = getMemoryAutoRecallFilters();
    const nextMinScore = Number(filters.minScore ?? current.minScore);
    const nextMinScoreGap = Number(filters.minScoreGap ?? current.minScoreGap);
    const nextMaxAgeDays = Number(filters.maxAgeDays ?? current.maxAgeDays);
    if (!Number.isFinite(nextMinScore) || nextMinScore < 0 || !Number.isFinite(nextMinScoreGap) || nextMinScoreGap < 0 || !Number.isFinite(nextMaxAgeDays) || nextMaxAgeDays < 1) {
      postInputNotice(this, 'Memory recall filters must use non-negative scores and at least 1 max-age day.');
      postCurrentState();
      return;
    }

    const normalized: MemoryAutoRecallFilters = {
      minScore: Math.min(100, nextMinScore),
      minScoreGap: Math.min(50, nextMinScoreGap),
      maxAgeDays: Math.min(3650, Math.floor(nextMaxAgeDays)),
    };
    if (
      normalized.minScore === current.minScore
      && normalized.minScoreGap === current.minScoreGap
      && normalized.maxAgeDays === current.maxAgeDays
    ) {
      this.postMessage({
        type: 'memoryAutoRecallFiltersState',
        memoryAutoRecallMinScore: current.minScore,
        memoryAutoRecallMinScoreGap: current.minScoreGap,
        memoryAutoRecallMaxAgeDays: current.maxAgeDays,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('memories.autoRecallMinScore', normalized.minScore, true);
      await config.update('memories.autoRecallMinScoreGap', normalized.minScoreGap, true);
      await config.update('memories.autoRecallMaxAgeDays', normalized.maxAgeDays, true);
      this.postMessage({
        type: 'memoryAutoRecallFiltersState',
        memoryAutoRecallMinScore: normalized.minScore,
        memoryAutoRecallMinScoreGap: normalized.minScoreGap,
        memoryAutoRecallMaxAgeDays: normalized.maxAgeDays,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memory auto-recall filters', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory recall filters. See logs for details.');
      postCurrentState();
    }
  },

  async updateMemoriesNow(this: ChatWebviewRuntime): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before updating memories.');
      postMemoryActionStatus(this, idleMemoryActionStatus);
      return;
    }

    postMemoryActionStatus(this, { state: 'running', message: 'Updating memories…' });
    try {
      const memories = new WorkspaceMemories(this.context);
      const result = await memories.updateFromSessions(getWorkspaceFolderUrisByPriority()[0]);
      const message = formatMemoryUpdateMessage(result);
      appendLog(this.outputChannel, message, { tag: 'Memory' });
      postMemoryActionStatus(this, { state: 'success', message });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to update memories from webview', error, { tag: 'Webview' });
      postMemoryActionStatus(this, { state: 'error', message: 'Failed to update memories. See logs for details.' });
      postInputNotice(this, 'Failed to update memories. See logs for details.');
    }
  },

  async dropMemoriesNow(this: ChatWebviewRuntime, confirmed?: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before dropping memories.');
      postMemoryActionStatus(this, idleMemoryActionStatus);
      return;
    }

    if (confirmed !== true) {
      postMemoryActionStatus(this, idleMemoryActionStatus);
      return;
    }

    postMemoryActionStatus(this, { state: 'running', message: 'Dropping generated memories…' });
    try {
      const memories = new WorkspaceMemories(this.context);
      const result = await memories.dropMemories(getWorkspaceFolderUrisByPriority()[0]);
      const message = formatMemoryDropMessage(result);
      appendLog(this.outputChannel, message, { tag: 'Memory' });
      postMemoryActionStatus(this, { state: 'success', message });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to drop memories from webview', error, { tag: 'Webview' });
      postMemoryActionStatus(this, { state: 'error', message: 'Failed to drop memories. See logs for details.' });
      postInputNotice(this, 'Failed to drop memories. See logs for details.');
    }
  },

  showLogs(this: ChatWebviewRuntime): void {
    try {
      this.outputChannel?.show();
    } catch {
      // Ignore output-channel failures.
    }
  },

  async postToolCatalog(this: ChatWebviewRuntime): Promise<void> {
    try {
      this.postMessage({ type: 'toolsCatalogState', toolsCatalog: await buildToolCatalogForUI(), reveal: true });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to build tool catalog for webview', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to list tools. See logs for details.');
      this.postMessage({ type: 'toolsCatalogState', toolsCatalog: { total: 0, shown: 0, filter: getToolFilter(), tools: [] }, reveal: true });
    }
  },

  async listTools(this: ChatWebviewRuntime): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before listing tools.');
      await this.postToolCatalog();
      return;
    }

    await this.postToolCatalog();
  },

  async runTool(this: ChatWebviewRuntime, toolId?: string, args?: Record<string, unknown>, confirmed?: boolean): Promise<void> {
    const id = typeof toolId === 'string' ? toolId.trim() : '';
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before running a tool manually.');
      if (id) {
        this.postMessage({
          type: 'manualToolResult',
          toolId: id,
          success: false,
          error: 'Stop the current task before running a tool manually.',
        });
      } else {
        await this.postToolCatalog();
      }
      return;
    }

    if (!id) {
      await this.postToolCatalog();
      postInputNotice(this, 'Choose a tool from the inline tool list, edit JSON arguments, then click Run.');
      return;
    }

    const filter = getToolFilter();
    if (!isToolAllowedByFilter(id, filter)) {
      postInputNotice(this, 'That tool is blocked by the current Allowed tools filter.');
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: 'Tool is blocked by the current Allowed tools filter.',
      });
      await this.postToolCatalog();
      return;
    }

    const allTools = await toolRegistry.getTools();
    let tool: (typeof allTools)[number] | undefined;
    for (const candidate of allTools) {
      if (candidate.id === id) {
        tool = candidate;
        break;
      }
    }
    if (!tool) {
      postInputNotice(this, `Tool "${id}" is not registered.`);
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: `Tool "${id}" is not registered.`,
      });
      await this.postToolCatalog();
      return;
    }

    if (this.mode === 'plan' && tool.metadata?.readOnly !== true) {
      postInputNotice(this, 'Plan mode blocks manual non-read-only tool runs. Switch to Build mode first.');
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: 'Plan mode blocks manual non-read-only tool runs. Switch to Build mode first.',
      });
      return;
    }

    const nextArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const requiresManualConfirmation = tool.metadata?.readOnly !== true || tool.metadata?.requiresApproval === true;
    if (requiresManualConfirmation && confirmed !== true) {
      this.postMessage({
        type: 'manualToolConfirmationRequired',
        toolId: tool.id,
        toolName: tool.name || tool.id,
        reasons: collectManualToolConfirmationReasons(tool),
      });
      return;
    }

    try {
      this.outputChannel?.show();
    } catch {
      // Ignore output-channel failures.
    }
    appendLog(this.outputChannel, `\nRunning ${tool.name || tool.id}...`, { tag: 'ManualTool' });
    appendLog(this.outputChannel, `Args: ${summarizeToolArgsForDebug(nextArgs, { redactionLevel: getDebugRedactionLevel() })}`, { tag: 'ManualTool' });

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const context = {
        workspaceFolder: getWorkspaceFolderUrisByPriority()[0],
        activeEditor: vscode.window.activeTextEditor,
        extensionContext: this.context,
        cancellationToken: tokenSource.token,
        progress: { report: () => {} },
        log: (msg: string) => appendLog(this.outputChannel, msg, { tag: 'ManualTool' }),
      };

      const result = await toolRegistry.executeTool(tool.id, nextArgs, context);
      const formatted = formatManualToolResultData(result.data);
      appendLog(this.outputChannel, `\nResult: ${result.success ? '✅' : '❌'}`, { tag: 'ManualTool' });
      appendLog(this.outputChannel, formatted.text, { tag: 'ManualTool' });
      if (result.error) appendLog(this.outputChannel, `Error: ${result.error}`, { tag: 'ManualTool' });

      this.postMessage({
        type: 'manualToolResult',
        toolId: tool.id,
        success: result.success,
        error: result.error,
        data: formatted.text,
        truncated: formatted.truncated,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, `Failed to run manual tool "${id}" from webview`, error, { tag: 'ManualTool' });
      this.postMessage({
        type: 'manualToolResult',
        toolId: id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      postInputNotice(this, 'Failed to run tool manually. See logs for details.');
    } finally {
      tokenSource.dispose();
    }
  },

  async createToolsConfig(this: ChatWebviewRuntime): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before creating a workspace tools config.');
      await this.postToolCatalog();
      return;
    }

    try {
      await createSampleToolsConfig();
      await this.postToolCatalog();
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to create workspace tools config from webview', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to create workspace tools config. See logs for details.');
      await this.postToolCatalog();
    }
  },

  async setMemoryAdvancedLimits(this: ChatWebviewRuntime, limits: Partial<MemoryAdvancedLimits>): Promise<void> {
    const postCurrentState = () => this.postMessage({
      type: 'memoryAdvancedLimitsState',
      memoryAdvancedLimits: getMemoryAdvancedLimits(),
    });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing memory limits.');
      postCurrentState();
      return;
    }

    const current = getMemoryAdvancedLimits();
    const next = { ...current, ...(limits || {}) };
    const numeric = {
      maxRawMemoriesForGlobal: Number(next.maxRawMemoriesForGlobal),
      maxRolloutAgeDays: Number(next.maxRolloutAgeDays),
      maxRolloutsPerStartup: Number(next.maxRolloutsPerStartup),
      minRolloutIdleHours: Number(next.minRolloutIdleHours),
      maxStateOutputs: Number(next.maxStateOutputs),
      maxRecords: Number(next.maxRecords),
      maxSearchResults: Number(next.maxSearchResults),
      maxResultsPerKind: Number(next.maxResultsPerKind),
      searchNeighborWindow: Number(next.searchNeighborWindow),
    };

    if (
      !Number.isFinite(numeric.maxRawMemoriesForGlobal) || numeric.maxRawMemoriesForGlobal < 1 ||
      !Number.isFinite(numeric.maxRolloutAgeDays) || numeric.maxRolloutAgeDays < 1 ||
      !Number.isFinite(numeric.maxRolloutsPerStartup) || numeric.maxRolloutsPerStartup < 1 ||
      !Number.isFinite(numeric.minRolloutIdleHours) || numeric.minRolloutIdleHours < 0 ||
      !Number.isFinite(numeric.maxStateOutputs) || numeric.maxStateOutputs < 10 ||
      !Number.isFinite(numeric.maxRecords) || numeric.maxRecords < 100 ||
      !Number.isFinite(numeric.maxSearchResults) || numeric.maxSearchResults < 1 ||
      !Number.isFinite(numeric.maxResultsPerKind) || numeric.maxResultsPerKind < 1 ||
      !Number.isFinite(numeric.searchNeighborWindow) || numeric.searchNeighborWindow < 0
    ) {
      postInputNotice(this, 'Memory limits must satisfy the minimum values shown in the UI.');
      postCurrentState();
      return;
    }

    const normalized: MemoryAdvancedLimits = {
      maxRawMemoriesForGlobal: Math.min(2000, Math.floor(numeric.maxRawMemoriesForGlobal)),
      maxRolloutAgeDays: Math.min(3650, Math.floor(numeric.maxRolloutAgeDays)),
      maxRolloutsPerStartup: Math.min(2000, Math.floor(numeric.maxRolloutsPerStartup)),
      minRolloutIdleHours: Math.min(24 * 30, numeric.minRolloutIdleHours),
      maxStateOutputs: Math.min(5000, Math.floor(numeric.maxStateOutputs)),
      maxRecords: Math.min(50000, Math.floor(numeric.maxRecords)),
      maxSearchResults: Math.min(100, Math.floor(numeric.maxSearchResults)),
      maxResultsPerKind: Math.min(20, Math.floor(numeric.maxResultsPerKind)),
      searchNeighborWindow: Math.min(5, Math.floor(numeric.searchNeighborWindow)),
    };
    if (memoryAdvancedLimitsEqual(normalized, current)) {
      this.postMessage({ type: 'memoryAdvancedLimitsState', memoryAdvancedLimits: current });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('memories.maxRawMemoriesForGlobal', normalized.maxRawMemoriesForGlobal, true);
      await config.update('memories.maxRolloutAgeDays', normalized.maxRolloutAgeDays, true);
      await config.update('memories.maxRolloutsPerStartup', normalized.maxRolloutsPerStartup, true);
      await config.update('memories.minRolloutIdleHours', normalized.minRolloutIdleHours, true);
      await config.update('memories.maxStateOutputs', normalized.maxStateOutputs, true);
      await config.update('memories.maxRecords', normalized.maxRecords, true);
      await config.update('memories.maxSearchResults', normalized.maxSearchResults, true);
      await config.update('memories.maxResultsPerKind', normalized.maxResultsPerKind, true);
      await config.update('memories.searchNeighborWindow', normalized.searchNeighborWindow, true);
      this.postMessage({ type: 'memoryAdvancedLimitsState', memoryAdvancedLimits: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist memory limits', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update memory limits. See logs for details.');
      postCurrentState();
    }
  },

  async setExplorePrepass(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing explore prepass behavior.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
      return;
    }

    const next = !!enabled;
    const current = getExplorePrepassEnabled();
    if (next === current) {
      this.postMessage({ type: 'explorePrepassState', explorePrepass: current, explorePrepassMaxChars: getExplorePrepassMaxChars() });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('subagents.explorePrepass.enabled', next, true);
      this.postMessage({ type: 'explorePrepassState', explorePrepass: next, explorePrepassMaxChars: getExplorePrepassMaxChars() });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist explore prepass setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update explore prepass behavior. See logs for details.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
    }
  },

  async setExplorePrepassMaxChars(this: ChatWebviewRuntime, maxChars: number): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing explore prepass limits.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
      return;
    }

    if (!Number.isFinite(maxChars) || maxChars < 500) {
      postInputNotice(this, 'Explore prepass max chars must be at least 500.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
      return;
    }

    const normalized = Math.floor(maxChars);
    const current = getExplorePrepassMaxChars();
    if (normalized === current) {
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('subagents.explorePrepass.maxChars', normalized, true);
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist explore prepass max chars', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update explore prepass limit. See logs for details.');
      this.postMessage({ type: 'explorePrepassState', explorePrepass: getExplorePrepassEnabled(), explorePrepassMaxChars: getExplorePrepassMaxChars() });
    }
  },

  async setSubagentModelOverride(this: ChatWebviewRuntime, model: string): Promise<void> {
    const postCurrentState = () => this.postMessage({
      type: 'subagentModelOverrideState',
      subagentModelOverride: getSubagentModelOverride(),
    });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing the subagent model.');
      postCurrentState();
      return;
    }

    const normalized = normalizeSubagentModelOverride(model);
    const current = getSubagentModelOverride();
    if (normalized === current) {
      this.postMessage({ type: 'subagentModelOverrideState', subagentModelOverride: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('subagents.model', normalized, true);
      this.postMessage({ type: 'subagentModelOverrideState', subagentModelOverride: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist subagent model override', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update subagent model. See logs for details.');
      postCurrentState();
    }
  },

  async setSubagentTaskMaxOutputChars(this: ChatWebviewRuntime, maxChars: number): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'subagentTaskMaxOutputCharsState', subagentTaskMaxOutputChars: getSubagentTaskMaxOutputChars() });
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing subagent output limits.');
      postCurrentState();
      return;
    }

    if (!Number.isFinite(maxChars) || maxChars < 500) {
      postInputNotice(this, 'Subagent task output cap must be at least 500 characters.');
      postCurrentState();
      return;
    }

    const normalized = Math.floor(maxChars);
    const current = getSubagentTaskMaxOutputChars();
    if (normalized === current) {
      this.postMessage({ type: 'subagentTaskMaxOutputCharsState', subagentTaskMaxOutputChars: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('subagents.task.maxOutputChars', normalized, true);
      this.postMessage({ type: 'subagentTaskMaxOutputCharsState', subagentTaskMaxOutputChars: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist subagent task output cap', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update subagent output limit. See logs for details.');
      postCurrentState();
    }
  },

  async setAutoCompaction(this: ChatWebviewRuntime, enabled: boolean): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing auto-compaction behavior.');
      this.postMessage({ type: 'autoCompactionState', autoCompaction: getAutoCompactionEnabled() });
      return;
    }

    const next = !!enabled;
    const current = getAutoCompactionEnabled();
    if (next === current) {
      this.postMessage({ type: 'autoCompactionState', autoCompaction: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('compaction.auto', next, true);
      this.postMessage({ type: 'autoCompactionState', autoCompaction: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist auto-compaction setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update auto-compaction behavior. See logs for details.');
      this.postMessage({ type: 'autoCompactionState', autoCompaction: getAutoCompactionEnabled() });
    }
  },

  async setCompactionPruneSettings(this: ChatWebviewRuntime, settings: Partial<CompactionPruneSettings>): Promise<void> {
    const postCurrentState = () => {
      const current = getCompactionPruneSettings();
      this.postMessage({
        type: 'compactionPruneState',
        compactionPrune: current.prune,
        compactionPruneProtectTokens: current.pruneProtectTokens,
        compactionPruneMinimumTokens: current.pruneMinimumTokens,
      });
    };

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing compaction prune behavior.');
      postCurrentState();
      return;
    }

    const current = getCompactionPruneSettings();
    const nextPrune = settings.prune ?? current.prune;
    const nextProtectTokens = Number(settings.pruneProtectTokens ?? current.pruneProtectTokens);
    const nextMinimumTokens = Number(settings.pruneMinimumTokens ?? current.pruneMinimumTokens);
    if (typeof nextPrune !== 'boolean' || !Number.isFinite(nextProtectTokens) || nextProtectTokens < 0 || !Number.isFinite(nextMinimumTokens) || nextMinimumTokens < 0) {
      postInputNotice(this, 'Compaction prune token limits must be zero or greater.');
      postCurrentState();
      return;
    }

    const normalizedProtectTokens = Math.floor(nextProtectTokens);
    const normalizedMinimumTokens = Math.floor(nextMinimumTokens);
    const normalized: CompactionPruneSettings = {
      prune: nextPrune,
      pruneProtectTokens: normalizedProtectTokens,
      pruneMinimumTokens: normalizedMinimumTokens,
    };
    if (compactionPruneSettingsEqual(normalized, current)) {
      this.postMessage({
        type: 'compactionPruneState',
        compactionPrune: current.prune,
        compactionPruneProtectTokens: current.pruneProtectTokens,
        compactionPruneMinimumTokens: current.pruneMinimumTokens,
      });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('compaction.prune', normalized.prune, true);
      await config.update('compaction.pruneProtectTokens', normalized.pruneProtectTokens, true);
      await config.update('compaction.pruneMinimumTokens', normalized.pruneMinimumTokens, true);
      this.postMessage({
        type: 'compactionPruneState',
        compactionPrune: normalized.prune,
        compactionPruneProtectTokens: normalized.pruneProtectTokens,
        compactionPruneMinimumTokens: normalized.pruneMinimumTokens,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist compaction prune settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update compaction prune behavior. See logs for details.');
      postCurrentState();
    }
  },

  async setCompactionToolOutputMode(this: ChatWebviewRuntime, mode: string): Promise<void> {
    const normalized = normalizeCompactionToolOutputMode(mode);
    if (!normalized) {
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: getCompactionToolOutputMode() });
      return;
    }

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing tool-output compaction behavior.');
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: getCompactionToolOutputMode() });
      return;
    }

    const current = getCompactionToolOutputMode();
    if (normalized === current) {
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('compaction.toolOutputMode', normalized, true);
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: normalized });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist tool-output compaction setting', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update tool-output compaction behavior. See logs for details.');
      this.postMessage({ type: 'compactionToolOutputModeState', compactionToolOutputMode: getCompactionToolOutputMode() });
    }
  },

  async setModelLimits(this: ChatWebviewRuntime, limits: ModelLimits): Promise<void> {
    const postCurrentState = () => this.postMessage({ type: 'modelLimitsState', modelLimits: getModelLimits() });

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing model token limits.');
      postCurrentState();
      return;
    }

    const validationError = getModelLimitsValidationError(limits);
    if (validationError) {
      postInputNotice(this, validationError);
      postCurrentState();
      return;
    }

    const current = getModelLimits();
    const next = normalizeModelLimits(limits);
    if (modelLimitsEqual(next, current)) {
      this.postMessage({ type: 'modelLimitsState', modelLimits: current });
      return;
    }

    try {
      await vscode.workspace.getConfiguration('lingyun').update('modelLimits', next, true);
      this.postMessage({ type: 'modelLimitsState', modelLimits: next });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist model token limits', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update model token limits. See logs for details.');
      postCurrentState();
    }
  },

  async setGenerationSettings(this: ChatWebviewRuntime, settings: Partial<GenerationSettings>): Promise<void> {
    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before changing generation settings.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }

    const currentSettings = getGenerationSettings();
    const nextTemperature = Number(settings.temperature ?? currentSettings.temperature);
    const nextTopP = Number(settings.topP ?? currentSettings.topP);
    const nextTopK = Number(settings.topK ?? currentSettings.topK);
    const nextMaxOutputTokens = Number(settings.maxOutputTokens ?? currentSettings.maxOutputTokens);
    const nextMaxIterations = Number(settings.maxIterations ?? currentSettings.maxIterations);
    const nextMaxRetries = Number(settings.maxRetries ?? currentSettings.maxRetries);
    const nextRetryWithPartialOutput = typeof settings.retryWithPartialOutput === 'boolean'
      ? settings.retryWithPartialOutput
      : currentSettings.retryWithPartialOutput;
    const nextTimeoutMs = Number(settings.timeoutMs ?? currentSettings.timeoutMs);
    const nextTextVerbosity = Object.prototype.hasOwnProperty.call(settings, 'textVerbosity')
      ? normalizeTextVerbosity(settings.textVerbosity, '__invalid__')
      : currentSettings.textVerbosity;
    if (nextTextVerbosity === '__invalid__') {
      postInputNotice(this, 'Text verbosity must be provider default, low, medium, or high.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTemperature) || nextTemperature < 0 || nextTemperature > 2) {
      postInputNotice(this, 'Temperature must be between 0 and 2.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTopP) || nextTopP < 0 || nextTopP > 1) {
      postInputNotice(this, 'Top-p must be between 0 and 1, where 0 uses the provider default.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTopK) || nextTopK < 0) {
      postInputNotice(this, 'Top-k must be zero or greater, where 0 uses the provider default.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextMaxOutputTokens) || nextMaxOutputTokens <= 0) {
      postInputNotice(this, 'Max output tokens must be a positive number.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextMaxIterations) || (nextMaxIterations !== -1 && nextMaxIterations <= 0)) {
      postInputNotice(this, 'Max iterations must be -1 for no limit or a positive number.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextMaxRetries) || nextMaxRetries < 0) {
      postInputNotice(this, 'Max retries must be zero or greater.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }
    if (!Number.isFinite(nextTimeoutMs) || nextTimeoutMs < 0) {
      postInputNotice(this, 'LLM timeout must be zero or greater.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
      return;
    }

    const normalizedTemperature = Math.round(nextTemperature * 100) / 100;
    const normalizedTopP = Math.round(nextTopP * 1000) / 1000;
    const normalizedTopK = Math.floor(nextTopK);
    const normalizedMaxOutputTokens = Math.floor(nextMaxOutputTokens);
    const normalizedMaxIterations = nextMaxIterations === -1 ? -1 : Math.floor(nextMaxIterations);
    const normalizedMaxRetries = Math.floor(nextMaxRetries);
    const normalizedTimeoutMs = Math.floor(nextTimeoutMs);
    const normalizedSettings: GenerationSettings = {
      temperature: normalizedTemperature,
      topP: normalizedTopP,
      topK: normalizedTopK,
      maxOutputTokens: normalizedMaxOutputTokens,
      maxIterations: normalizedMaxIterations,
      maxRetries: normalizedMaxRetries,
      retryWithPartialOutput: nextRetryWithPartialOutput,
      timeoutMs: normalizedTimeoutMs,
      textVerbosity: nextTextVerbosity,
    };
    if (generationSettingsEqual(normalizedSettings, currentSettings)) {
      this.postMessage({ type: 'generationSettingsState', generationSettings: currentSettings });
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration('lingyun');
      await config.update('temperature', normalizedSettings.temperature, true);
      await config.update('topP', normalizedSettings.topP, true);
      await config.update('topK', normalizedSettings.topK, true);
      await config.update('maxOutputTokens', normalizedSettings.maxOutputTokens, true);
      await config.update('maxIterations', normalizedSettings.maxIterations, true);
      await config.update('llm.maxRetries', normalizedSettings.maxRetries, true);
      await config.update('llm.retryWithPartialOutput', normalizedSettings.retryWithPartialOutput, true);
      await config.update('llm.timeoutMs', normalizedSettings.timeoutMs, true);
      await config.update('llm.textVerbosity', normalizedSettings.textVerbosity, true);
      this.postMessage({
        type: 'generationSettingsState',
        generationSettings: normalizedSettings,
      });
    } catch (error) {
      appendErrorLog(this.outputChannel, 'Failed to persist generation settings', error, { tag: 'Webview' });
      postInputNotice(this, 'Failed to update generation settings. See logs for details.');
      this.postMessage({ type: 'generationSettingsState', generationSettings: getGenerationSettings() });
    }
  },

  async authenticateProvider(this: ChatWebviewRuntime): Promise<void> {
    const provider = this.llmProvider;
    if (!provider?.authenticate) {
      await service.postProviderState().catch(() => {});
      return;
    }

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before signing in to a provider.');
      await service.postProviderState().catch(() => {});
      return;
    }

    try {
      await provider.authenticate();
      provider.clearModelCache?.();
      await this.loadModels();
      await service.postProviderState();
      postInputNotice(this, `Connected to ${provider.name}.`);
    } catch (error) {
      await service.postProviderState().catch(() => {});
      postInputNotice(this, getToastErrorMessage(error, this.llmProvider?.id));
    }
  },

  async disconnectProvider(this: ChatWebviewRuntime): Promise<void> {
    const provider = this.llmProvider;
    if (!provider?.disconnect) {
      await service.postProviderState().catch(() => {});
      return;
    }

    if (this.isProcessing) {
      postInputNotice(this, 'Stop the current task before signing out of a provider.');
      await service.postProviderState().catch(() => {});
      return;
    }

    try {
      await provider.disconnect();
      provider.clearModelCache?.();
      await this.loadModels();
      await service.postProviderState();
      postInputNotice(this, `Disconnected ${provider.name}.`);
    } catch (error) {
      await service.postProviderState().catch(() => {});
      postInputNotice(this, getToastErrorMessage(error, this.llmProvider?.id));
    }
  },

  postMessage(this: ChatWebviewRuntime, message: unknown): void {
    this.view?.webview.postMessage(message);
  },

  getHtml(this: ChatWebviewRuntime, webview: vscode.Webview): string {
    const nonce = getNonce();
    const version = String((this.context as any)?.extension?.packageJSON?.version || '');
    const versionSuffix = version ? `(${version})` : '';

    let scripts = renderBrowserChatProtocolBootstrapScript(nonce);
    for (const parts of CHAT_WEBVIEW_SCRIPT_PARTS) {
      const uri = webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'media', ...parts)
      );
      scripts += `\n<script nonce="${nonce}" src="${String(uri)}"></script>`;
    }
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'images', 'icon.png')
    );

    const templatePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.html').fsPath;
    const template = fs.readFileSync(templatePath, 'utf8');

    return template
      .replace(/{{CSP_SOURCE}}/g, webview.cspSource)
      .replace(/{{NONCE}}/g, nonce)
      .replace(/{{SCRIPTS}}/g, scripts)
      .replace(/{{LOGO_URI}}/g, String(logoUri))
      .replace(/{{VERSION_SUFFIX}}/g, versionSuffix);
  },
  });
  Object.assign(runtime, service);
  return service;
}

function createChatWebviewDepsForController(controller: ChatController): ChatWebviewDeps {
  return {
    context: controller.context,
    get outputChannel() {
      return controller.outputChannel;
    },
    get view() {
      return controller.view;
    },
    set view(value) {
      controller.view = value;
    },
    get viewDisposables() {
      return controller.viewDisposables;
    },
    set viewDisposables(value) {
      controller.viewDisposables = value;
    },
    get currentModel() {
      return controller.currentModel;
    },
    set currentModel(value) {
      controller.currentModel = value;
    },
    get availableModels() {
      return controller.availableModels;
    },
    set availableModels(value) {
      controller.availableModels = value;
    },
    get activeSessionId() {
      return controller.activeSessionId;
    },
    get inputHistoryEntries() {
      return controller.inputHistoryEntries;
    },
    get skillNamesForUiPromise() {
      return controller.skillNamesForUiPromise;
    },
    set skillNamesForUiPromise(value) {
      controller.skillNamesForUiPromise = value;
    },
    get mode() {
      return controller.mode;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    get autoApproveThisRun() {
      return controller.autoApproveThisRun;
    },
    set autoApproveThisRun(value) {
      controller.autoApproveThisRun = value;
    },
    get pendingApprovals() {
      return controller.pendingApprovals;
    },
    get initAcked() {
      return controller.initAcked;
    },
    set initAcked(value) {
      controller.initAcked = value;
    },
    get initInterval() {
      return controller.initInterval;
    },
    set initInterval(value) {
      controller.initInterval = value;
    },
    get initInFlight() {
      return controller.initInFlight;
    },
    set initInFlight(value) {
      controller.initInFlight = value;
    },
    get webviewClientInstanceId() {
      return controller.webviewClientInstanceId;
    },
    set webviewClientInstanceId(value) {
      controller.webviewClientInstanceId = value;
    },
    get webviewCrashToastClientId() {
      return controller.webviewCrashToastClientId;
    },
    set webviewCrashToastClientId(value) {
      controller.webviewCrashToastClientId = value;
    },
    get pendingComposerAttachments() {
      return controller.pendingComposerAttachments;
    },
    set pendingComposerAttachments(value) {
      controller.pendingComposerAttachments = value;
    },
    get composerSubmissionState() {
      return controller.composerSubmissionState;
    },
    set composerSubmissionState(value) {
      controller.composerSubmissionState = value;
    },
    get llmProvider() {
      return controller.llmProvider;
    },
    get toolDiffBeforeByToolCallId() {
      return controller.toolDiffBeforeByToolCallId;
    },
    get toolDiffSnapshotsByToolCallId() {
      return controller.toolDiffSnapshotsByToolCallId;
    },
    abortCurrentRun: (reason?: string) => controller.abortCurrentRun(reason),
    get queueManager() {
      return controller.queueManager;
    },
    get runner() {
      return controller.runner;
    },
    createNewSession: () => controller.sessionApi.createNewSession(),
    compactCurrentSession: () => controller.sessionApi.compactCurrentSession(),
    undo: () => controller.revertApi.undo(),
    redo: () => controller.revertApi.redo(),
    redoAll: () => controller.revertApi.redoAll(),
    discardUndone: (confirmed?: boolean) => controller.revertApi.discardUndone(confirmed),
    viewRevertDiff: () => controller.revertApi.viewRevertDiff(),
    switchToSession: (sessionId: string) => controller.sessionApi.switchToSession(sessionId),
    postSessions: () => controller.sessionApi.postSessions(),
    handleUserMessage: (content: string | ChatUserInput, options?: ChatUserMessageOptions) =>
      controller.runnerInputApi.handleUserMessage(content, options),
    approveAllPendingApprovals: (options?: { includeManual?: boolean }) =>
      controller.approvalsApi.approveAllPendingApprovals(options),
    postApprovalState: () => controller.approvalsApi.postApprovalState(),
    handleAlwaysAllowApproval: (approvalId: string) => controller.approvalsApi.handleAlwaysAllowApproval(approvalId),
    getAutoApprovedToolsForUI: () => controller.approvalsApi.getAutoApprovedToolsForUI(),
    revokeAutoApprovedTool: (toolId: string) => controller.approvalsApi.revokeAutoApprovedTool(toolId),
    clearAutoApprovedToolsForUI: () => controller.approvalsApi.clearAutoApprovedToolsForUI(),
    clearCurrentSession: () => controller.sessionApi.clearCurrentSession(),
    clearSavedSessions: () => controller.sessionApi.clearSavedSessions(),
    executePendingPlan: (planMessageId?: string) => controller.runnerPlanApi.executePendingPlan(planMessageId),
    loadModels: () => controller.modelApi.loadModels(),
    postModelState: () => controller.modelApi.postModelState(),
    postModelPickerState: (reveal?: boolean) => controller.modelApi.postModelPickerState(reveal),
    refreshModelsForUI: () => controller.modelApi.refreshModelsForUI(),
    clearRecentModels: () => controller.modelApi.clearRecentModels(),
    setCurrentModel: (modelId: string) => controller.modelApi.setCurrentModel(modelId),
    setReasoningEffort: (reasoningEffort: string) => controller.modelApi.setReasoningEffort(reasoningEffort),
    openAdvancedModelSettings: () => controller.modelApi.openAdvancedModelSettings(),
    toggleFavoriteModel: (modelId: string) => controller.modelApi.toggleFavoriteModel(modelId),
    getActiveSession: () => controller.sessionApi.getActiveSession(),
    setModeAndPersist: (
      mode: 'build' | 'plan',
      options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
    ) => controller.modeApi.setModeAndPersist(mode, options),
    cancelPendingPlan: (planMessageId: string) => controller.runnerPlanApi.cancelPendingPlan(planMessageId),
    revisePendingPlan: (planMessageId: string, instructions: string) =>
      controller.runnerPlanApi.revisePendingPlan(planMessageId, instructions),
    handleApprovalResponse: (approvalId: string, approved: boolean) =>
      controller.approvalsApi.handleApprovalResponse(approvalId, approved),
    retryToolCall: (approvalId: string) => controller.runnerInputApi.retryToolCall(approvalId),
    ensureSessionsLoaded: () => controller.sessionApi.ensureSessionsLoaded(),
    onSessionPersistenceConfigChanged: () => controller.sessionApi.onSessionPersistenceConfigChanged(),
    getModelLabel: (modelId: string) => controller.modelApi.getModelLabel(modelId),
    getRenderableMessages: () => controller.sessionApi.getRenderableMessages(),
    getRevertBarStateForUI: () => controller.revertApi.getRevertBarStateForUI(),
    getContextForUI: () => controller.sessionApi.getContextForUI(),
    getSessionsForUI: () => controller.sessionApi.getSessionsForUI(),
    getSkillNamesForUI: () => controller.skillsApi.getSkillNamesForUI(),
    getUndoRedoAvailability: () => controller.revertApi.getUndoRedoAvailability(),
    isModelFavorite: (modelId: string) => controller.modelApi.isModelFavorite(modelId),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
  };
}

export function createChatWebviewServiceForController(controller: ChatController): ChatWebviewService {
  return createChatWebviewService(createChatWebviewDepsForController(controller));
}
