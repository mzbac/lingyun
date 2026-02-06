import * as path from 'path';

import type { ToolDefinition } from '../types';
import type { PermissionAction, PermissionRuleset } from '@kooka/core';
import { EDIT_TOOL_IDS } from './constants';

export function getPermissionRuleset(mode: 'build' | 'plan'): PermissionRuleset {
  if (mode === 'plan') {
    return [
      // Default: ask for anything not explicitly allowlisted.
      { permission: '*', pattern: '*', action: 'ask' },
      // Read-only tools can run without prompting in plan mode.
      { permission: 'read', pattern: '*', action: 'allow' },
      { permission: 'list', pattern: '*', action: 'allow' },
      { permission: 'glob', pattern: '*', action: 'allow' },
      { permission: 'grep', pattern: '*', action: 'allow' },
      { permission: 'lsp', pattern: '*', action: 'allow' },
      { permission: 'memory', pattern: '*', action: 'allow' },
      { permission: 'task', pattern: '*', action: 'allow' },
      // Planning state tools are safe in plan mode.
      { permission: 'todoread', pattern: '*', action: 'allow' },
      { permission: 'todowrite', pattern: '*', action: 'allow' },
      // Editing is always denied in plan mode.
      { permission: 'edit', pattern: '*', action: 'deny' },
    ];
  }

  // Build mode: allow, with per-tool approvals handled separately.
  return [{ permission: '*', pattern: '*', action: 'allow' }];
}

export function getPermissionName(def: ToolDefinition): string {
  const explicit = def.metadata?.permission;
  if (explicit && explicit.trim()) return explicit.trim();

  if (EDIT_TOOL_IDS.has(def.id)) return 'edit';
  return def.id;
}

export function combinePermissionActions(
  current: PermissionAction,
  next: PermissionAction,
): PermissionAction {
  if (current === 'deny' || next === 'deny') return 'deny';
  if (current === 'ask' || next === 'ask') return 'ask';
  return 'allow';
}

function normalizePermissionPath(input: string, workspaceRootFsPath: string | undefined): string {
  if (!workspaceRootFsPath) return input;

  try {
    const abs = path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspaceRootFsPath, input);
    const rel = path.relative(workspaceRootFsPath, abs);
    if (!rel || rel === '.') return '.';
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return abs;
    }
    return rel.replace(/\\/g, '/');
  } catch {
    return input;
  }
}

export function getPermissionPatterns(
  def: ToolDefinition,
  args: unknown,
  workspaceRootFsPath: string | undefined,
): string[] {
  const patternsMeta = def.metadata?.permissionPatterns;
  if (!patternsMeta || patternsMeta.length === 0) {
    return ['*'];
  }

  const argsRecord = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined;
  const patterns: string[] = [];
  for (const item of patternsMeta) {
    if (!item || typeof item.arg !== 'string' || !item.arg) continue;
    const raw = argsRecord?.[item.arg];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (item.kind === 'path') {
      patterns.push(normalizePermissionPath(value, workspaceRootFsPath));
    } else {
      patterns.push(value);
    }
  }

  return patterns.length > 0 ? patterns : ['*'];
}

export function getExternalPathPatterns(
  def: ToolDefinition,
  args: unknown,
  workspaceRootFsPath: string | undefined,
): string[] {
  if (!def.metadata?.supportsExternalPaths) return [];

  const patternsMeta = def.metadata?.permissionPatterns;
  if (!patternsMeta || patternsMeta.length === 0) return [];
  if (!workspaceRootFsPath) return [];

  const argsRecord = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined;
  const out = new Set<string>();
  for (const item of patternsMeta) {
    if (!item || typeof item.arg !== 'string' || !item.arg) continue;
    if (item.kind !== 'path') continue;
    const raw = argsRecord?.[item.arg];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    const normalized = normalizePermissionPath(value, workspaceRootFsPath);
    if (path.isAbsolute(normalized)) {
      out.add(normalized);
    }
  }

  return [...out];
}
