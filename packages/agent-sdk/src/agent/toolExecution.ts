import * as path from 'path';

import {
  TOOL_ERROR_CODES,
  collectDotEnvApprovalTargets,
  evaluateShellSafetyForTool,
  evaluateToolPermissionAction,
  findExternalPathReferencesInShellCommand,
  getDefaultLingyunPermissionRuleset,
  getExternalPathPatterns,
  getToolPermissionName,
  getToolPermissionPatterns,
  isPathInsideWorkspace,
  isToolAllowedInPlanMode,
  toToolCall,
} from '@kooka/core';

import type { ToolDefinition, ToolResult, AgentCallbacks, AgentConfig } from '../types.js';
import type { LingyunHookName } from '../plugins/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { FileHandleLike, SemanticHandleRegistry } from './semanticHandles.js';
import { invokeCallbackSafely } from './callbacks.js';
import { LingyunSession } from './session.js';
import { FileHandleRegistry } from './fileHandles.js';

type PluginManagerLike = {
  trigger: <Name extends LingyunHookName, Output>(
    name: Name,
    input: unknown,
    output: Output,
  ) => Promise<Output>;
};

type ToolExecutionHost = {
  config: AgentConfig;
  plugins: PluginManagerLike;
  registry: Pick<ToolRegistry, 'executeTool'>;
  fileHandles: FileHandleRegistry;
  allowExternalPaths: boolean;
  workspaceRoot?: string;

  createToolContext: (signal: AbortSignal, session: LingyunSession, callbacks?: AgentCallbacks) => unknown;
  formatToolResult: (result: ToolResult, toolName: string) => Promise<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function executeToolWithPolicies(params: {
  host: ToolExecutionHost;
  def: ToolDefinition;
  toolName: string;
  mode: 'build' | 'plan';
  session: LingyunSession;
  semanticHandles: SemanticHandleRegistry;
  callbacks: AgentCallbacks | undefined;
  args: unknown;
  options: { toolCallId: string; abortSignal: AbortSignal };
}): Promise<ToolResult> {
  const { host, def, toolName, mode, session, semanticHandles, callbacks, args, options } = params;

  const callId = String(options.toolCallId);
  let resolvedArgs: any = args ?? {};
  const sessionId = session.sessionId ?? host.config.sessionId;

  // tool.execute.before
  {
    const before = await host.plugins.trigger(
      'tool.execute.before',
      { tool: toolName, sessionId, callId },
      { args: resolvedArgs },
    );
    if (before && typeof (before as any).args === 'object' && (before as any).args !== null) {
      resolvedArgs = (before as any).args;
    }
  }

  if (
    isRecord(resolvedArgs) &&
    def.metadata?.protocol?.input?.fileId &&
    typeof (resolvedArgs as any).fileId === 'string'
  ) {
    const filePathRaw =
      typeof (resolvedArgs as any).filePath === 'string' ? String((resolvedArgs as any).filePath) : '';
    if (!filePathRaw.trim()) {
      const fileId = String((resolvedArgs as any).fileId);
      const resolvedPath = host.fileHandles.resolveFileId(session, fileId);
      if (!resolvedPath) {
        return {
          success: false,
          error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
          metadata: { errorCode: TOOL_ERROR_CODES.unknown_file_id, fileId },
        };
      }
      resolvedArgs = { ...resolvedArgs, filePath: resolvedPath };
    }
  }

  if (isRecord(resolvedArgs) && def.metadata?.protocol?.input?.semanticHandle) {
    const symbolId =
      typeof (resolvedArgs as any).symbolId === 'string' ? String((resolvedArgs as any).symbolId) : '';
    const matchId =
      typeof (resolvedArgs as any).matchId === 'string' ? String((resolvedArgs as any).matchId) : '';
    const locId = typeof (resolvedArgs as any).locId === 'string' ? String((resolvedArgs as any).locId) : '';

    const handleId = symbolId.trim() || matchId.trim() || locId.trim();
    if (handleId) {
      const handle = symbolId.trim()
        ? semanticHandles.resolveSymbol(handleId)
        : matchId.trim()
          ? semanticHandles.resolveMatch(handleId)
          : semanticHandles.resolveLocation(handleId);

      if (!handle) {
        const errorCode = symbolId.trim()
          ? TOOL_ERROR_CODES.unknown_symbol_id
          : matchId.trim()
            ? TOOL_ERROR_CODES.unknown_match_id
            : TOOL_ERROR_CODES.unknown_loc_id;
        return {
          success: false,
          error: `${errorCode}: ${handleId}. Re-run symbols_search (for symbolId) or grep (for matchId) and use the returned handle.`,
          metadata: { errorCode, handleId },
        };
      }

      const fileId = handle.fileId;
      const filePath = host.fileHandles.resolveFileId(session, fileId);
      if (!filePath) {
        return {
          success: false,
          error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
          metadata: { errorCode: TOOL_ERROR_CODES.unknown_file_id, fileId },
        };
      }

      const props = def.parameters?.properties as Record<string, unknown> | undefined;
      const supportsLine = !!props && typeof props === 'object' && 'line' in props;
      const supportsCharacter = !!props && typeof props === 'object' && 'character' in props;
      const supportsStartLine = !!props && typeof props === 'object' && 'startLine' in props;
      const supportsEndLine = !!props && typeof props === 'object' && 'endLine' in props;

      const nextArgs: Record<string, unknown> = {
        ...resolvedArgs,
        fileId,
        filePath,
      };

      const rangeStart = handle.range.start;
      const rangeEnd = handle.range.end;

      if (
        supportsLine &&
        !(typeof (resolvedArgs as any).line === 'number' && Number.isFinite((resolvedArgs as any).line) && (resolvedArgs as any).line > 0)
      ) {
        nextArgs.line = rangeStart.line;
      }

      if (
        supportsCharacter &&
        !(typeof (resolvedArgs as any).character === 'number' && Number.isFinite((resolvedArgs as any).character) && (resolvedArgs as any).character > 0)
      ) {
        nextArgs.character = rangeStart.character;
      }

      if (
        supportsStartLine &&
        !(typeof (resolvedArgs as any).startLine === 'number' && Number.isFinite((resolvedArgs as any).startLine) && (resolvedArgs as any).startLine > 0)
      ) {
        nextArgs.startLine = rangeStart.line;
      }

      if (
        supportsEndLine &&
        !(typeof (resolvedArgs as any).endLine === 'number' && Number.isFinite((resolvedArgs as any).endLine) && (resolvedArgs as any).endLine > 0)
      ) {
        nextArgs.endLine = rangeEnd.line;
      }

      resolvedArgs = nextArgs;
    }
  }

  const tc = toToolCall(callId, toolName, resolvedArgs);

  const permission = getToolPermissionName(def);

  if (mode === 'plan') {
    const gate = isToolAllowedInPlanMode(def);
    if (!gate.allowed) {
      const reason = gate.reason || 'Tool is disabled in Plan mode. Switch to Build mode to use it.';
      invokeCallbackSafely(
        callbacks?.onToolBlocked,
        { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug },
        tc,
        def,
        reason,
      );
      return { success: false, error: reason };
    }
  }

  const patterns = getToolPermissionPatterns(def, resolvedArgs, { workspaceRoot: host.workspaceRoot });
  const ruleset = getDefaultLingyunPermissionRuleset(mode);

  const permissionAction = evaluateToolPermissionAction({ permission, patterns, ruleset });

  if (permissionAction === 'deny') {
    const reason =
      mode === 'plan'
        ? 'Tool is disabled in Plan mode. Switch to Build mode to use it.'
        : 'Tool is denied by permissions.';
    invokeCallbackSafely(
      callbacks?.onToolBlocked,
      { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug },
      tc,
      def,
      reason,
    );
    return { success: false, error: reason };
  }

  let requiresApproval = permissionAction === 'ask' || !!def.metadata?.requiresApproval;
  const dotEnvApprovalTargets = collectDotEnvApprovalTargets(def, resolvedArgs as any);
  if (dotEnvApprovalTargets.length > 0) {
    requiresApproval = true;
  }

  const isShellExecutionTool = def.id === 'bash' || def.execution?.type === 'shell';

  const workspaceRoot = host.workspaceRoot;
  if (isShellExecutionTool && !host.allowExternalPaths && workspaceRoot) {
    const cwdRaw =
      typeof resolvedArgs?.workdir === 'string'
        ? resolvedArgs.workdir
        : def.execution?.type === 'shell' && typeof (def.execution as any).cwd === 'string'
          ? String((def.execution as any).cwd)
          : '';

    const cwd =
      cwdRaw && cwdRaw.trim()
        ? path.isAbsolute(cwdRaw.trim())
          ? path.resolve(cwdRaw.trim())
          : path.resolve(workspaceRoot, cwdRaw.trim())
        : workspaceRoot;

    const commandText =
      typeof resolvedArgs?.command === 'string'
        ? resolvedArgs.command
        : def.execution?.type === 'shell' && typeof (def.execution as any).script === 'string'
          ? String((def.execution as any).script)
          : undefined;

    const externalRefs = new Set<string>();
    if (!isPathInsideWorkspace(cwd, workspaceRoot)) {
      externalRefs.add(cwd);
    }
    if (typeof commandText === 'string' && commandText.trim()) {
      for (const p of findExternalPathReferencesInShellCommand(commandText, { cwd, workspaceRoot })) {
        externalRefs.add(p);
      }
    }

    if (externalRefs.size > 0) {
      const reason =
        'External paths are disabled. This shell command references paths outside the current workspace. Enable allowExternalPaths to allow external path access.';
      invokeCallbackSafely(
        callbacks?.onToolBlocked,
        { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug },
        tc,
        def,
        reason,
      );
      const blockedPaths = [...externalRefs];
      const blockedPathsMax = 20;
      return {
        success: false,
        error: reason,
        metadata: {
          errorCode: TOOL_ERROR_CODES.external_paths_disabled,
          blockedSettingKey: 'lingyun.security.allowExternalPaths',
          isOutsideWorkspace: true,
          blockedPaths: blockedPaths.slice(0, blockedPathsMax),
          blockedPathsTruncated: blockedPaths.length > blockedPathsMax,
        },
      };
    }
  }

  const safety = evaluateShellSafetyForTool(def, resolvedArgs as any);
  if (safety?.verdict === 'deny') {
    const reason = `Blocked command: ${safety.reason}`;
    invokeCallbackSafely(
      callbacks?.onToolBlocked,
      { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug },
      tc,
      def,
      reason,
    );
    return { success: false, error: reason };
  }
  if (safety?.verdict === 'needs_approval') {
    requiresApproval = true;
  }

  const externalPaths = getExternalPathPatterns(def, resolvedArgs, { workspaceRoot: host.workspaceRoot });
  if (externalPaths.length > 0 && !host.allowExternalPaths) {
    const reason =
      'External paths are disabled. Enable allowExternalPaths to allow access outside the current workspace.';
    invokeCallbackSafely(
      callbacks?.onToolBlocked,
      { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug },
      tc,
      def,
      reason,
    );
    return {
      success: false,
      error: reason,
      metadata: {
        errorCode: TOOL_ERROR_CODES.external_paths_disabled,
        blockedSettingKey: 'lingyun.security.allowExternalPaths',
        isOutsideWorkspace: true,
      },
    };
  }

  // permission.ask plugin hook
  {
    const permissionDecision = await host.plugins.trigger(
      'permission.ask',
      {
        tool: toolName,
        sessionId,
        callId,
        patterns,
        metadata: {
          mode,
          requiresApproval,
          permission,
        },
      },
      { status: requiresApproval ? 'ask' : 'allow' },
    );

    if ((permissionDecision as any)?.status === 'deny') {
      const reason = 'Tool is denied by a plugin permission hook.';
      invokeCallbackSafely(
        callbacks?.onToolBlocked,
        { label: `onToolBlocked tool=${def.id}`, onDebug: callbacks?.onDebug },
        tc,
        def,
        reason,
      );
      return { success: false, error: reason };
    }

    if ((permissionDecision as any)?.status === 'allow') {
      requiresApproval = false;
    }

    if ((permissionDecision as any)?.status === 'ask') {
      requiresApproval = true;
    }
  }

  const allowAutoApprove = mode !== 'plan' && !!host.config.autoApprove;
  if (requiresApproval && !allowAutoApprove) {
    let approved = false;
    try {
      approved = (await callbacks?.onRequestApproval?.(tc, def)) ?? false;
    } catch (error) {
      invokeCallbackSafely(
        callbacks?.onDebug,
        { label: 'onRequestApproval error' },
        `[Callbacks] onRequestApproval threw (${error instanceof Error ? error.name : typeof error})`,
      );
      approved = false;
    }
    if (!approved) {
      return { success: false, error: 'User rejected this action' };
    }
  }

  const ctx = host.createToolContext(options.abortSignal, session, callbacks);
  let result = await host.registry.executeTool(def.id, resolvedArgs ?? {}, ctx as any);

  const fileHandleProvider = {
    getOrCreate: (filePath: string): FileHandleLike => host.fileHandles.getOrCreate(session, filePath),
  };

  const protocolOutput = def.metadata?.protocol?.output;
  if (protocolOutput?.glob) {
    result = host.fileHandles.decorateGlobResult(session, result);
  }
  if (protocolOutput?.grep) {
    result = host.fileHandles.decorateGrepResult(session, result, semanticHandles);
  }
  if (protocolOutput?.symbolsSearch) {
    result = semanticHandles.decorateSymbolsSearchResult(result, fileHandleProvider);
  }
  if (protocolOutput?.symbolsPeek) {
    result = semanticHandles.decorateSymbolsPeekResult(result, fileHandleProvider);
  }

  // tool.execute.after
  {
    const baseText = await host.formatToolResult(result, def.name);
    const output = await host.plugins.trigger(
      'tool.execute.after',
      { tool: toolName, sessionId, callId },
      {
        title: def.name,
        output: baseText,
        metadata: isRecord(result.metadata) ? { ...result.metadata } : {},
      },
    );

    const mergedMeta: Record<string, unknown> = {
      ...(isRecord(result.metadata) ? result.metadata : {}),
      ...(isRecord((output as any).metadata) ? (output as any).metadata : {}),
    };

    if (typeof (output as any).title === 'string' && (output as any).title.trim()) {
      mergedMeta.title = (output as any).title;
    }
    if (typeof (output as any).output === 'string') {
      mergedMeta.outputText = (output as any).output;
    }

    result = { ...result, metadata: mergedMeta };
  }

  return result;
}
