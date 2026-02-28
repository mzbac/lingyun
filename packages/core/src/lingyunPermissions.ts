import type { PermissionRuleset } from './permission';

export function getDefaultLingyunPermissionRuleset(mode: 'build' | 'plan'): PermissionRuleset {
  if (mode === 'plan') {
    return [
      // Default: deny anything not explicitly allowlisted in plan mode.
      { permission: '*', pattern: '*', action: 'deny' },

      // Read-only tools (workspace inspection + navigation).
      { permission: 'read', pattern: '*', action: 'allow' },
      { permission: 'list', pattern: '*', action: 'allow' },
      { permission: 'glob', pattern: '*', action: 'allow' },
      { permission: 'grep', pattern: '*', action: 'allow' },
      { permission: 'lsp', pattern: '*', action: 'allow' },

      // Session-local state and retrieval.
      { permission: 'memory', pattern: '*', action: 'allow' },
      { permission: 'skill', pattern: '*', action: 'allow' },
      { permission: 'task', pattern: '*', action: 'allow' },
      { permission: 'todoread', pattern: '*', action: 'allow' },
      { permission: 'todowrite', pattern: '*', action: 'allow' },
    ];
  }

  // Build mode: allow, with per-tool approvals handled separately.
  return [{ permission: '*', pattern: '*', action: 'allow' }];
}

