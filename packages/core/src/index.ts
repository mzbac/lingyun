export type { ToolParameterSchema } from './toolSchema';

export { expandHome, isSubPath, normalizeFsPath, redactFsPathForPrompt } from './fsPath';

export type { PermissionAction, PermissionRule, PermissionRuleset } from './permission';
export { evaluatePermission, mergeRulesets, wildcardMatch } from './permission';

export { isCopilotResponsesModelId } from './copilot';

export {
  THINK_BLOCK_REGEX,
  TOOL_BLOCK_REGEX,
  stripThinkBlocks,
  stripToolBlocks,
} from './agentText';

export { extractPlanFromReasoning } from './plan';

export { getDefaultLingyunPermissionRuleset } from './lingyunPermissions';

export type { ToolCall } from './toolCall';
export { toToolCall } from './toolCall';

export { findExternalPathReferencesInShellCommand, isPathInsideWorkspace } from './shellPaths';

export type { SafeChildProcessEnvOptions } from './shellEnv';
export { buildSafeChildProcessEnv } from './shellEnv';

export type { SkillListEntry } from './skills';
export { extractSkillMentions, renderSkillsSectionForPrompt, selectSkillsForText } from './skills';

export type { SkillInfo, SkillIndex } from './skillIndex';
export { getSkillIndex, invalidateSkillIndexCache, loadSkillFile, parseSkillMarkdown } from './skillIndex';

export type { ToolPathErrorCode } from './toolPaths';
export { BINARY_EXTENSIONS, containsBinaryData, isToolPathError, resolveToolPath, ToolPathError, toPosixPath } from './toolPaths';

export type { ToolErrorCode } from './toolErrors';
export { TOOL_ERROR_CODES } from './toolErrors';

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

export {
  applyAssistantReplayForPrompt,
  applyCopilotImageInputPattern,
  applyCopilotReasoningFields,
  applyOpenAICompatibleReasoningField,
} from './modelMessages';
