export type { ToolParameterSchema } from './toolSchema';

export { expandHome, isSubPath, normalizeFsPath, redactFsPathForPrompt } from './fsPath';

export type { PermissionAction, PermissionRule, PermissionRuleset } from './permission';
export { evaluatePermission, mergeRulesets, wildcardMatch } from './permission';

export { isCopilotResponsesModelId, isGpt5FamilyModelId, normalizeTemperatureForModel, shouldUseResponsesApiForModelId } from './copilot';

export type { RenderFileTreeOptions } from './fileTree';
export { createFileTreeIgnoreDirs, renderFileTreeOutput } from './fileTree';

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

export {
  canonicalizePathForContainment,
  classifyDotEnvPath,
  collectProtectedDotEnvMentions,
  evaluateShellPathAccess,
  evaluateWorkspacePathPolicy,
  findExternalPathReferencesInShellCommand,
  findNearestExistingAncestor,
  isPathInsideWorkspace,
  isProtectedDotEnvPath,
  type DotEnvSensitivity,
  type ShellPathAccessEvaluation,
  type WorkspacePathPolicyEvaluation,
} from './pathPolicy';

export type { SafeChildProcessEnvOptions } from './shellEnv';
export { buildSafeChildProcessEnv } from './shellEnv';

export { computeStopHint, looksLikeGitPushCommand, looksLikeLongRunningServerCommand } from './bashHeuristics';
export { buildAutoStopMessage, buildShellOutputText, formatBackgroundTtl } from './bashResults';

export type { SkillListEntry } from './skills';
export { extractSkillMentions, renderSkillsSectionForPrompt, selectSkillsForText } from './skills';

export type { SkillInfo, SkillIndex } from './skillIndex';
export { getSkillIndex, invalidateSkillIndexCache, loadSkillFile, parseSkillMarkdown } from './skillIndex';

export type { RenderSkillCatalogToolOutputOptions, SkillCatalogEntry, SkillCatalogScannedDir } from './skillToolOutput';
export {
  formatAvailableSkillNames,
  formatAvailableSkills,
  formatSkillNotFoundError,
  renderSkillCatalogToolOutput,
} from './skillToolOutput';

export type { ToolPathErrorCode } from './toolPaths';
export { BINARY_EXTENSIONS, containsBinaryData, isToolPathError, resolveToolPath, ToolPathError, toPosixPath } from './toolPaths';

export type { ToolErrorCode } from './toolErrors';
export { TOOL_ERROR_CODES } from './toolErrors';

export type { SubagentDefinition, SubagentName } from './subagents';
export { formatBuiltinSubagentsForToolDescription, listBuiltinSubagents, resolveBuiltinSubagent } from './subagents';

export type { ValidationResult, ShellCommandDecision } from './validation';
export {
  evaluateShellCommand,
  getShellCommandBase,
  isUnsandboxableShellCommand,
  normalizeSessionId,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  validateToolArgs,
} from './validation';

export type { ToolDefinitionLike, ToolMetadataLike, ToolPermissionPattern } from './toolPolicy';
export {
  combinePermissionActions,
  collectDotEnvApprovalTargets,
  evaluateShellSafetyForTool,
  evaluateToolPermissionAction,
  getExternalPathPatterns,
  getToolPermissionName,
  getToolPermissionPatterns,
  isToolAllowedInPlanMode,
  normalizePermissionPath,
} from './toolPolicy';

export { createToolFilterMatcher, isToolAllowedByFilter, normalizeToolFilterSetting } from './toolFilter';

export type {
  ToolDefinitionRiskLike,
  ToolExecutionRiskLike,
  ToolMetadataRiskLike,
  ToolPermissionPatternLike,
  ToolRiskDecision,
  ToolRiskEvaluation,
  ToolRiskReason,
  ToolRiskReasonCode,
} from './toolRisk';
export {
  collectProtectedDotEnvTargets,
  evaluateToolRisk,
  getPrimaryToolRiskReason,
} from './toolRisk';

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
  AgentHistoryStats,
  UserHistoryFilePart,
  UserHistoryInput,
  UserHistoryInputPart,
  UserHistoryTextPart,
} from './history';
export {
  appendReasoning,
  appendText,
  cloneAgentHistoryMessage,
  cloneAgentHistoryMessages,
  cloneUserHistoryInput,
  createAssistantHistoryMessage,
  createSystemHistoryMessage,
  createUserHistoryMessage,
  finalizeStreamingParts,
  getAgentHistoryStats,
  getUserHistoryInputText,
  getMessageText,
  isSkillInjectedMessage,
  normalizeUserHistoryInputParts,
  parseUserHistoryInput,
  setDynamicToolError,
  setDynamicToolOutput,
  stripSkillInjectedMessages,
  upsertDynamicToolCall,
} from './history';

export type { CompactionConfig, ModelLimit, ToolOutputCompactionMode } from './compaction';
export {
  COMPACTED_TOOL_PLACEHOLDER,
  COMPACTION_AUTO_CONTINUE_TEXT,
  COMPACTION_MARKER_TEXT,
  COMPACTION_PROMPT_TEXT,
  COMPACTION_SYSTEM_PROMPT,
  MISSING_TOOL_RESULT_PLACEHOLDER,
  createHistoryForCompactionPrompt,
  createHistoryForModel,
  extractUsageTokens,
  getEffectiveHistory,
  markPreviousAssistantToolOutputs,
  getReservedOutputTokens,
  isOverflow,
  markPrunableToolOutputs,
} from './compaction';

export type { PlanPromptOptions } from './prompts';
export { BUILD_SWITCH_PROMPT, createPlanPrompt } from './prompts';

export {
  applyAssistantReplayForPrompt,
  applyCopilotImageInputPattern,
  applyCopilotReasoningFields,
  applyOpenAICompatibleReasoningField,
} from './modelMessages';

export type { ChatModelErrorContext } from './providerModelErrors';
export { attachChatModelErrorMetadata, wrapChatModelErrors } from './providerModelErrors';
export { isPrivateIpv4Address } from './ip';
