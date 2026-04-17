import * as path from 'path';

import { TOOL_ERROR_CODES } from './toolErrors';
import {
  collectProtectedDotEnvMentions,
  classifyDotEnvPath,
  evaluateShellPathAccess,
  evaluateWorkspacePathPolicy,
} from './pathPolicy';
import { evaluateShellCommand, type ShellCommandDecision } from './validation';

export type ToolPermissionPatternLike = {
  arg: string;
  kind?: 'path' | 'command' | 'raw';
};

export type ToolMetadataRiskLike = {
  requiresApproval?: boolean;
  supportsExternalPaths?: boolean;
  permissionPatterns?: ToolPermissionPatternLike[];
};

export type ToolExecutionRiskLike = {
  type?: string;
  script?: string;
  cwd?: string;
};

export type ToolDefinitionRiskLike = {
  id: string;
  execution?: ToolExecutionRiskLike;
  metadata?: ToolMetadataRiskLike;
};

export type ToolRiskDecision = 'allow' | 'require_manual_approval' | 'deny';

export type ToolRiskReasonCode =
  | 'tool_metadata_requires_approval'
  | 'permission_requires_approval'
  | 'dotenv_protected'
  | 'shell_requires_approval'
  | 'external_paths_disabled'
  | 'workspace_boundary_check_failed'
  | 'shell_command_denied';

export type ToolRiskReason = {
  code: ToolRiskReasonCode;
  message: string;
  metadata?: Record<string, unknown>;
};

export type ToolRiskEvaluation = {
  decision: ToolRiskDecision;
  reasons: ToolRiskReason[];
  requiresApproval: boolean;
  manualApproval: boolean;
  denied: boolean;
  dotEnvTargets: string[];
  shellSafety?: ShellCommandDecision;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stripShellToken(token: string): string {
  return token.replace(/^[`"'()[\]{}<>,;|&]+|[`"'()[\]{}<>,;|&]+$/g, '');
}

function normalizePermissionPath(input: string, workspaceRoot?: string): string {
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

function evaluateShellSafetyForRisk(def: ToolDefinitionRiskLike, args: Record<string, unknown>): ShellCommandDecision | undefined {
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

function getExternalPathPatternsForRisk(
  def: ToolDefinitionRiskLike,
  args: Record<string, unknown>,
  options?: { workspaceRoot?: string }
): string[] {
  if (!def.metadata?.supportsExternalPaths) return [];

  const patternsMeta = def.metadata?.permissionPatterns;
  if (!patternsMeta || patternsMeta.length === 0) return [];

  const workspaceRoot = options?.workspaceRoot;
  if (!workspaceRoot) return [];

  const out = new Set<string>();
  for (const item of patternsMeta) {
    if (!item || typeof item.arg !== 'string' || !item.arg) continue;
    if (item.kind !== 'path') continue;
    const raw = args[item.arg];
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

export function collectProtectedDotEnvTargets(def: ToolDefinitionRiskLike, args: Record<string, unknown>): string[] {
  const out = new Set<string>();

  const filePath = asString((args as any).filePath);
  if (filePath && classifyDotEnvPath(filePath) === 'protected') {
    out.add(filePath);
  }

  if (def.id === 'grep') {
    const searchPath = asString((args as any).path);
    if (searchPath && classifyDotEnvPath(searchPath) === 'protected') {
      out.add(searchPath);
    }
    const include = asString((args as any).include);
    if (include) {
      for (const token of include.split(/\s+/).map(stripShellToken).filter(Boolean)) {
        if (classifyDotEnvPath(token) === 'protected') {
          out.add(token);
        }
      }
      for (const token of collectProtectedDotEnvMentions(include)) {
        out.add(token);
      }
    }
  }

  const isShellExecutionTool = def.id === 'bash' || def.execution?.type === 'shell';
  if (isShellExecutionTool) {
    const commandText =
      asString((args as any).command) ||
      (def.execution?.type === 'shell'
        ? asString((def.execution as unknown as Record<string, unknown>).script)
        : undefined);
    if (commandText) {
      for (const token of commandText.split(/\s+/).map(stripShellToken).filter(Boolean)) {
        const rhs = token.includes('=') ? token.slice(token.lastIndexOf('=') + 1) : token;
        if (rhs && classifyDotEnvPath(rhs) === 'protected') {
          out.add(rhs);
        }
      }
      for (const token of collectProtectedDotEnvMentions(commandText)) {
        out.add(token);
      }
    }
  }

  return [...out];
}

export function evaluateToolRisk(params: {
  def: ToolDefinitionRiskLike;
  args: Record<string, unknown>;
  workspaceRoot?: string;
  allowExternalPaths: boolean;
  permissionAction?: 'allow' | 'ask' | 'deny';
}): ToolRiskEvaluation {
  const reasons: ToolRiskReason[] = [];
  const dotEnvTargets = collectProtectedDotEnvTargets(params.def, params.args);
  const permissionAction = params.permissionAction ?? 'allow';

  let requiresApproval = permissionAction === 'ask' || !!params.def.metadata?.requiresApproval;
  let manualApproval = false;
  let denied = permissionAction === 'deny';

  if (permissionAction === 'ask') {
    reasons.push({
      code: 'permission_requires_approval',
      message: 'Tool requires approval by permission policy.',
    });
  }
  if (params.def.metadata?.requiresApproval) {
    reasons.push({
      code: 'tool_metadata_requires_approval',
      message: 'Tool requires approval by tool metadata.',
    });
  }
  if (dotEnvTargets.length > 0) {
    requiresApproval = true;
    manualApproval = true;
    reasons.push({
      code: 'dotenv_protected',
      message: 'Protected dotenv access requires manual approval.',
      metadata: { targets: dotEnvTargets },
    });
  }

  const shellSafety = evaluateShellSafetyForRisk(params.def, params.args);
  if (shellSafety?.verdict === 'deny') {
    denied = true;
    reasons.push({
      code: 'shell_command_denied',
      message: `Blocked command: ${shellSafety.reason}`,
    });
  } else if (shellSafety?.verdict === 'needs_approval') {
    requiresApproval = true;
    reasons.push({
      code: 'shell_requires_approval',
      message: shellSafety.reason,
    });
  }

  if (params.workspaceRoot && !params.allowExternalPaths) {
    const workspaceRoot = params.workspaceRoot;
    const isShellExecutionTool = params.def.id === 'bash' || params.def.execution?.type === 'shell';

    if (isShellExecutionTool) {
      const cwdRaw =
        typeof params.args?.workdir === 'string'
          ? params.args.workdir
          : params.def.execution?.type === 'shell' && typeof (params.def.execution as any).cwd === 'string'
            ? String((params.def.execution as any).cwd)
            : '';
      const cwd =
        cwdRaw && cwdRaw.trim()
          ? path.isAbsolute(cwdRaw.trim())
            ? path.resolve(cwdRaw.trim())
            : path.resolve(workspaceRoot, cwdRaw.trim())
          : workspaceRoot;
      const commandText =
        typeof params.args?.command === 'string'
          ? params.args.command
          : params.def.execution?.type === 'shell' && typeof (params.def.execution as any).script === 'string'
            ? String((params.def.execution as any).script)
            : undefined;

      const shellAccess = evaluateShellPathAccess(commandText || '', { cwd, workspaceRoot });
      if (shellAccess.blockedPaths.length > 0) {
        denied = true;
        const blockedPathsMax = 20;
        reasons.push({
          code: 'external_paths_disabled',
          message:
            'External paths are disabled. This shell command references paths outside the current workspace. Enable allowExternalPaths to allow external path access.',
          metadata: {
            errorCode: TOOL_ERROR_CODES.external_paths_disabled,
            blockedSettingKey: 'lingyun.security.allowExternalPaths',
            isOutsideWorkspace: true,
            blockedPaths: shellAccess.blockedPaths.slice(0, blockedPathsMax),
            blockedPathsTruncated: shellAccess.blockedPaths.length > blockedPathsMax,
          },
        });
      }
    }

    const externalPaths = getExternalPathPatternsForRisk(params.def, params.args, { workspaceRoot });
    if (externalPaths.length > 0) {
      denied = true;
      reasons.push({
        code: 'external_paths_disabled',
        message: 'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.',
        metadata: {
          errorCode: TOOL_ERROR_CODES.external_paths_disabled,
          blockedSettingKey: 'lingyun.security.allowExternalPaths',
          isOutsideWorkspace: true,
        },
      });
    }

    const pathPatternItems = params.def.metadata?.permissionPatterns ?? [];
    for (const item of pathPatternItems) {
      if (item?.kind !== 'path') continue;
      const raw = params.args[item.arg];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const evaluation = evaluateWorkspacePathPolicy(raw, { workspaceRoot });
      if (!evaluation.canonicalKnown) {
        denied = true;
        reasons.push({
          code: 'workspace_boundary_check_failed',
          message:
            'External paths are disabled. Unable to verify workspace boundary because canonical path resolution failed.',
          metadata: {
            errorCode: TOOL_ERROR_CODES.workspace_boundary_check_failed,
            blockedSettingKey: 'lingyun.security.allowExternalPaths',
            path: raw,
          },
        });
        break;
      }
    }
  }

  return {
    decision: denied ? 'deny' : requiresApproval ? 'require_manual_approval' : 'allow',
    reasons,
    requiresApproval,
    manualApproval,
    denied,
    dotEnvTargets,
    ...(shellSafety ? { shellSafety } : {}),
  };
}

export function getPrimaryToolRiskReason(evaluation: ToolRiskEvaluation): ToolRiskReason | undefined {
  return evaluation.reasons[0];
}
