export const TOOL_ERROR_CODES = {
  external_paths_disabled: 'external_paths_disabled',
  workspace_boundary_check_failed: 'workspace_boundary_check_failed',

  workspace_shell_requires_timeout: 'workspace_shell_requires_timeout',

  too_large: 'too_large',

  read_range_limit_exceeded: 'read_range_limit_exceeded',
  read_requires_range: 'read_requires_range',
  read_limit_exceeded: 'read_limit_exceeded',

  write_overwrite_blocked: 'write_overwrite_blocked',

  edit_overwrite_blocked: 'edit_overwrite_blocked',
  edit_oldstring_not_found: 'edit_oldstring_not_found',
  edit_oldstring_multiple_matches: 'edit_oldstring_multiple_matches',
  edit_failed: 'edit_failed',

  bash_background_pid_unavailable: 'bash_background_pid_unavailable',
  bash_git_push_blocked: 'bash_git_push_blocked',
  bash_requires_background_or_timeout: 'bash_requires_background_or_timeout',

  memory_disabled: 'memory_disabled',
  memory_rollout_missing: 'memory_rollout_missing',
  memory_missing: 'memory_missing',

  task_runtime_only: 'task_runtime_only',
  task_recursion_denied: 'task_recursion_denied',
  unknown_subagent_type: 'unknown_subagent_type',
  subagent_denied_in_plan: 'subagent_denied_in_plan',
  missing_model: 'missing_model',
  task_subagent_failed: 'task_subagent_failed',

  unknown_file_id: 'unknown_file_id',
  unknown_symbol_id: 'unknown_symbol_id',
  unknown_match_id: 'unknown_match_id',
  unknown_loc_id: 'unknown_loc_id',
} as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

