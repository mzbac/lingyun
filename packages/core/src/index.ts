export type { ToolParameterSchema } from './toolSchema';

export { expandHome, isSubPath, normalizeFsPath, redactFsPathForPrompt } from './fsPath';

export type { PermissionAction, PermissionRule, PermissionRuleset } from './permission';
export { evaluatePermission, mergeRulesets, wildcardMatch } from './permission';

export { findExternalPathReferencesInShellCommand, isPathInsideWorkspace } from './shellPaths';

export type { SkillListEntry } from './skills';
export { extractSkillMentions, renderSkillsSectionForPrompt, selectSkillsForText } from './skills';

export type { SubagentDefinition, SubagentName } from './subagents';
export { listBuiltinSubagents, resolveBuiltinSubagent } from './subagents';

export type { ValidationResult, ShellCommandDecision } from './validation';
export {
  evaluateShellCommand,
  normalizeSessionId,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  validateToolArgs,
} from './validation';

export type { BackgroundJob } from './backgroundJobs';
export {
  DEFAULT_BACKGROUND_KILL_GRACE_MS,
  DEFAULT_BACKGROUND_TTL_MS,
  cleanupDeadBackgroundJobs,
  createBackgroundJobKey,
  getBackgroundJob,
  isPidAlive,
  killProcessTree,
  listBackgroundJobs,
  refreshBackgroundJob,
  registerBackgroundJob,
  removeBackgroundJob,
} from './backgroundJobs';

export type {
  AgentHistoryMessage,
  AgentHistoryMetadata,
  UserHistoryFilePart,
  UserHistoryInput,
  UserHistoryInputPart,
  UserHistoryTextPart,
} from './history';
export {
  appendReasoning,
  appendText,
  createAssistantHistoryMessage,
  createUserHistoryMessage,
  finalizeStreamingParts,
  getUserHistoryInputText,
  getMessageText,
  normalizeUserHistoryInputParts,
  setDynamicToolError,
  setDynamicToolOutput,
  upsertDynamicToolCall,
} from './history';

export type { CompactionConfig, ModelLimit, ToolOutputCompactionMode } from './compaction';
export {
  COMPACTED_TOOL_PLACEHOLDER,
  COMPACTION_AUTO_CONTINUE_TEXT,
  COMPACTION_MARKER_TEXT,
  COMPACTION_PROMPT_TEXT,
  COMPACTION_SYSTEM_PROMPT,
  createHistoryForCompactionPrompt,
  createHistoryForModel,
  extractUsageTokens,
  getEffectiveHistory,
  markPreviousAssistantToolOutputs,
  getReservedOutputTokens,
  isOverflow,
  markPrunableToolOutputs,
} from './compaction';

export { applyCopilotImageInputPattern } from './modelMessages';
