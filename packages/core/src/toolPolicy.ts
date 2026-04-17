import * as path from 'path';

import type { PermissionAction, PermissionRuleset } from './permission';
import { evaluatePermission } from './permission';
import { collectProtectedDotEnvTargets } from './toolRisk';
import { evaluateShellCommand, type ShellCommandDecision } from './validation';

export type ToolPermissionPattern = {
  arg: string;
  kind?: 'path' | 'command' | 'raw';
};

export type ToolMetadataLike = {
  requiresApproval?: boolean;
  supportsExternalPaths?: boolean;
  permission?: string;
  readOnly?: boolean;
  permissionPatterns?: ToolPermissionPattern[];
};

export type ToolExecutionLike = {
  type?: string;
  script?: string;
  cwd?: string;
};

export type ToolDefinitionLike = {
  id: string;
  execution?: ToolExecutionLike;
  metadata?: ToolMetadataLike;
};

const DEFAULT_EDIT_PERMISSION_TOOL_IDS = new Set(['edit', 'write']);

export function getToolPermissionName(def: ToolDefinitionLike, options?: { editToolIds?: Set<string> }): string {
  const explicit = def.metadata?.permission;
  if (explicit && explicit.trim()) return explicit.trim();

  const editToolIds = options?.editToolIds ?? DEFAULT_EDIT_PERMISSION_TOOL_IDS;
  if (editToolIds.has(def.id)) return 'edit';
  return def.id;
}

export function normalizePermissionPath(input: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return input;

  try {
    const abs = path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspaceRoot, input);
    const rel = path.relative(workspaceRoot, abs);
    if (!rel || rel === '.') return '.';
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return abs;
    }
    return rel.replace(/\\/g, '/');
  } catch {
    return input;
  }
}

export function getToolPermissionPatterns(
  def: ToolDefinitionLike,
  args: unknown,
  options?: { workspaceRoot?: string }
): string[] {
  const patternsMeta = def.metadata?.permissionPatterns;
  if (!patternsMeta || patternsMeta.length === 0) {
    return ['*'];
  }

  const argsRecord = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined;
  if (!argsRecord) return ['*'];

  const patterns: string[] = [];
  for (const item of patternsMeta) {
    if (!item || typeof item.arg !== 'string' || !item.arg) continue;
    const raw = argsRecord[item.arg];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (item.kind === 'path') {
      patterns.push(normalizePermissionPath(value, options?.workspaceRoot));
    } else {
      patterns.push(value);
    }
  }

  return patterns.length > 0 ? patterns : ['*'];
}

export function getExternalPathPatterns(
  def: ToolDefinitionLike,
  args: unknown,
  options?: { workspaceRoot?: string }
): string[] {
  if (!def.metadata?.supportsExternalPaths) return [];

  const patternsMeta = def.metadata?.permissionPatterns;
  if (!patternsMeta || patternsMeta.length === 0) return [];

  const workspaceRoot = options?.workspaceRoot;
  if (!workspaceRoot) return [];

  const argsRecord = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined;
  if (!argsRecord) return [];

  const out = new Set<string>();
  for (const item of patternsMeta) {
    if (!item || typeof item.arg !== 'string' || !item.arg) continue;
    if (item.kind !== 'path') continue;
    const raw = argsRecord[item.arg];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    const normalized = normalizePermissionPath(value, workspaceRoot);
    if (path.isAbsolute(normalized)) {
      out.add(normalized);
    }
  }

  return [...out];
}

export function combinePermissionActions(current: PermissionAction, next: PermissionAction): PermissionAction {
  if (current === 'deny' || next === 'deny') return 'deny';
  if (current === 'ask' || next === 'ask') return 'ask';
  return 'allow';
}

export function evaluateToolPermissionAction(params: {
  permission: string;
  patterns: string[];
  ruleset: PermissionRuleset;
}): PermissionAction {
  let permissionAction: PermissionAction = 'allow';
  for (const pattern of params.patterns) {
    const rule = evaluatePermission(params.permission, pattern, params.ruleset);
    const action = rule?.action ?? 'ask';
    permissionAction = combinePermissionActions(permissionAction, action);
  }
  return permissionAction;
}

export function isToolAllowedInPlanMode(def: ToolDefinitionLike): { allowed: boolean; reason?: string } {
  const allowNonReadOnlyInPlan = def.id === 'task' || def.id === 'todowrite';
  if (def.metadata?.readOnly || allowNonReadOnlyInPlan) return { allowed: true };
  return { allowed: false, reason: 'Tool is disabled in Plan mode. Switch to Build mode to use it.' };
}

export function collectDotEnvApprovalTargets(def: ToolDefinitionLike, args: Record<string, unknown>): string[] {
  return collectProtectedDotEnvTargets(def, args);
}

export function evaluateShellSafetyForTool(def: ToolDefinitionLike, args: Record<string, unknown>): ShellCommandDecision | undefined {
  const isShellExecutionTool = def.id === 'bash' || def.execution?.type === 'shell';
  if (!isShellExecutionTool) return undefined;

  const commandForSafety =
    typeof (args as any).command === 'string'
      ? String((args as any).command)
      : def.execution?.type === 'shell' && typeof (def.execution as any).script === 'string'
        ? String((def.execution as any).script)
        : undefined;

  return typeof commandForSafety === 'string' ? evaluateShellCommand(commandForSafety) : undefined;
}

