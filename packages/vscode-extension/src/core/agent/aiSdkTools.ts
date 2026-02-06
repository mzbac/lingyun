import * as path from 'path';
import * as vscode from 'vscode';
import { jsonSchema, tool as aiTool } from 'ai';

import {
  evaluatePermission,
  evaluateShellCommand,
  findExternalPathReferencesInShellCommand,
  isPathInsideWorkspace,
  type PermissionAction,
} from '@kooka/core';
import type { ToolRegistry } from '../registry';
import type { AgentCallbacks, AgentConfig, ToolContext, ToolDefinition, ToolResult } from '../types';
import { isRecord } from '../utils/guards';
import type { PluginManager } from '../hooks/pluginManager';
import { FileHandleRegistry } from './fileHandles';
import { SemanticHandleRegistry } from './semanticHandles';
import { toToolCall } from './toolCall';
import {
  combinePermissionActions,
  getExternalPathPatterns,
  getPermissionName,
  getPermissionPatterns,
  getPermissionRuleset,
} from './permissions';
import {
  formatToolFailureForDebug,
  redactSensitive,
  summarizeToolArgsForDebug,
  truncateForDebug,
} from './debug';

export type CreateAISDKToolsParams = {
  tools: ToolDefinition[];
  mode: 'build' | 'plan';
  callbacks?: AgentCallbacks;
  toolNameToDefinition: Map<string, ToolDefinition>;
  getConfig: () => AgentConfig;
  registry: ToolRegistry;
  plugins: PluginManager;
  fileHandles: FileHandleRegistry;
  semanticHandles: SemanticHandleRegistry;
  createToolContext: (abortSignal?: AbortSignal) => ToolContext;
  formatToolResult: (result: ToolResult, toolName: string) => Promise<string>;
};

type ExecuteOptions = {
  toolCallId?: string;
  abortSignal?: AbortSignal;
};

function isToolResult(value: unknown): value is ToolResult {
  return isRecord(value) && typeof value.success === 'boolean';
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getShellCwd(execution: ToolDefinition['execution']): string | undefined {
  if (execution.type !== 'shell') return undefined;
  const executionRecord = asUnknownRecord(execution);
  return asString(executionRecord?.cwd);
}

export function createAISDKTools(params: CreateAISDKToolsParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const def of params.tools) {
    const toolName = def.id;
    params.toolNameToDefinition.set(toolName, def);

    out[toolName] = aiTool({
      description: def.description,
      inputSchema: jsonSchema(def.parameters as unknown as Parameters<typeof jsonSchema>[0]),
      execute: async (args: unknown, options: unknown) => {
        const optionsRecord = asUnknownRecord(options);
        const executeOptions: ExecuteOptions = optionsRecord
          ? {
              toolCallId: asString(optionsRecord.toolCallId),
              abortSignal: optionsRecord.abortSignal instanceof AbortSignal ? optionsRecord.abortSignal : undefined,
            }
          : {};
        const callId = executeOptions.toolCallId?.trim() || `${toolName}-${Date.now().toString(36)}`;
        const argsRecord = asUnknownRecord(args);
        let resolvedArgs: Record<string, unknown> = argsRecord ? { ...argsRecord } : {};
        const config = params.getConfig();
        const sessionId = config.sessionId;

        // Allow plugins to normalize/mutate args before permissions are evaluated.
        {
          const before = await params.plugins.trigger(
            'tool.execute.before',
            { tool: toolName, sessionId, callId },
            { args: resolvedArgs },
          );
          const beforeRecord = asUnknownRecord(before);
          const beforeArgs = asUnknownRecord(beforeRecord?.args);
          if (beforeArgs) {
            resolvedArgs = { ...beforeArgs };
          }
        }

        if (
          isRecord(resolvedArgs) &&
          (def.id === 'read' ||
            def.id === 'read_range' ||
            def.id === 'edit' ||
            def.id === 'write' ||
            def.id === 'lsp' ||
            def.id === 'symbols_peek') &&
          typeof resolvedArgs.fileId === 'string'
        ) {
          const filePathRaw = asString(resolvedArgs.filePath) ?? '';
          if (!filePathRaw.trim()) {
            const fileId = String(resolvedArgs.fileId);
            const resolvedPath = params.fileHandles.resolve(fileId);
            if (!resolvedPath) {
              return {
                success: false,
                error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
                metadata: { errorType: 'unknown_file_id', fileId },
              };
            }
            resolvedArgs = { ...resolvedArgs, filePath: resolvedPath };
          }
        }

        if (isRecord(resolvedArgs) && def.id === 'symbols_peek') {
          const symbolId = asString(resolvedArgs.symbolId) ?? '';
          const matchId = asString(resolvedArgs.matchId) ?? '';
          const locId = asString(resolvedArgs.locId) ?? '';

          const handleId = symbolId.trim() || matchId.trim() || locId.trim();
          if (handleId) {
            const handle =
              symbolId.trim()
                ? params.semanticHandles.resolveSymbol(handleId)
                : matchId.trim()
                  ? params.semanticHandles.resolveMatch(handleId)
                  : params.semanticHandles.resolveLocation(handleId);

            if (!handle) {
              const errorType = symbolId.trim()
                ? 'unknown_symbol_id'
                : matchId.trim()
                  ? 'unknown_match_id'
                  : 'unknown_loc_id';
              return {
                success: false,
                error:
                  `${errorType}: ${handleId}. Re-run symbols_search (for symbolId) or grep (for matchId) and use the returned handle.`,
                metadata: { errorType, handleId },
              };
            }

            const fileId = handle.fileId;
            const filePath = params.fileHandles.resolve(fileId);
            if (!filePath) {
              return {
                success: false,
                error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
                metadata: { errorType: 'unknown_file_id', fileId },
              };
            }

            const line = handle.range.start.line;
            const character = handle.range.start.character;

            resolvedArgs = {
              ...resolvedArgs,
              fileId,
              filePath,
              line,
              character,
            };
          }
        }

        if (isRecord(resolvedArgs) && def.id === 'read_range') {
          const locId = asString(resolvedArgs.locId) ?? '';
          const symbolId = asString(resolvedArgs.symbolId) ?? '';
          const matchId = asString(resolvedArgs.matchId) ?? '';

          const handleId = locId.trim() || symbolId.trim() || matchId.trim();
          if (handleId) {
            const handle =
              locId.trim()
                ? params.semanticHandles.resolveLocation(handleId)
                : symbolId.trim()
                  ? params.semanticHandles.resolveSymbol(handleId)
                  : params.semanticHandles.resolveMatch(handleId);

            if (!handle) {
              const errorType = locId.trim()
                ? 'unknown_loc_id'
                : symbolId.trim()
                  ? 'unknown_symbol_id'
                  : 'unknown_match_id';
              return {
                success: false,
                error:
                  `${errorType}: ${handleId}. Re-run symbols_search (for symbolId) or symbols_peek/grep (for locId/matchId) and use the returned handle.`,
                metadata: { errorType, handleId },
              };
            }

            const fileId = handle.fileId;
            const filePath = params.fileHandles.resolve(fileId);
            if (!filePath) {
              return {
                success: false,
                error: `Unknown fileId: ${fileId}. Run glob first and use one of the returned fileId values.`,
                metadata: { errorType: 'unknown_file_id', fileId },
              };
            }

            const startLine = handle.range.start.line;
            const endLine = handle.range.end.line;

            resolvedArgs = {
              ...resolvedArgs,
              fileId,
              filePath,
              startLine,
              endLine,
            };
          }
        }

        const tc = toToolCall(callId, toolName, resolvedArgs);
        const debugToolsEnabled =
          vscode.workspace.getConfiguration('lingyun').get<boolean>('debug.tools') ?? false;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        const permission = getPermissionName(def);
        const patterns = getPermissionPatterns(def, resolvedArgs, workspaceRoot);
        const ruleset = getPermissionRuleset(params.mode);

        let permissionAction: PermissionAction = 'allow';
        for (const pattern of patterns) {
          const rule = evaluatePermission(permission, pattern, ruleset);
          const action = rule?.action ?? 'ask';
          permissionAction = combinePermissionActions(permissionAction, action);
        }

        if (permissionAction === 'deny') {
          const reason =
            params.mode === 'plan'
              ? 'Tool is disabled in Plan mode. Switch to Build mode to use it.'
              : 'Tool is denied by permissions.';
          params.callbacks?.onToolBlocked?.(tc, def, reason);
          if (debugToolsEnabled) {
            params.callbacks?.onDebug?.(
              `[Tool] blocked tool=${toolName} call=${tc.id} reason=permission-deny`,
            );
          }
          return { success: false, error: reason };
        }

        let requiresApproval = permissionAction === 'ask' || !!def.metadata?.requiresApproval;

        const isShellExecutionTool =
          def.id === 'bash' ||
          def.id === 'shell.run' ||
          def.id === 'shell.terminal' ||
          def.execution?.type === 'shell';

        const allowExternalPaths =
          vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
          false;

        if (isShellExecutionTool && !allowExternalPaths && workspaceRoot) {
          const cwdRaw =
            typeof resolvedArgs.workdir === 'string'
              ? resolvedArgs.workdir
              : typeof getShellCwd(def.execution) === 'string'
                ? String(getShellCwd(def.execution))
                : '';

          const cwd =
            cwdRaw && cwdRaw.trim()
              ? path.isAbsolute(cwdRaw.trim())
                ? path.resolve(cwdRaw.trim())
                : path.resolve(workspaceRoot, cwdRaw.trim())
              : workspaceRoot;

          const commandText =
            typeof resolvedArgs.command === 'string'
              ? resolvedArgs.command
              : def.execution?.type === 'shell' && typeof def.execution.script === 'string'
                ? String(def.execution.script)
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
              'External paths are disabled. This shell command references paths outside the current workspace. ' +
              'Enable lingyun.security.allowExternalPaths to allow external path access.';
            params.callbacks?.onToolBlocked?.(tc, def, reason);
            if (debugToolsEnabled) {
              params.callbacks?.onDebug?.(
                `[Tool] blocked tool=${toolName} call=${tc.id} reason=shell-external-path-disabled cmd=${truncateForDebug(redactSensitive(commandText ?? ''), 200)} paths=${[...externalRefs].map(p => truncateForDebug(p, 200)).join(',')}`,
              );
            }

            const blockedPaths = [...externalRefs];
            const blockedPathsMax = 20;
            const blockedPathsTruncated = blockedPaths.length > blockedPathsMax;
            return {
              success: false,
              error: reason,
              metadata: {
                errorType: 'external_paths_disabled',
                blockedSettingKey: 'lingyun.security.allowExternalPaths',
                isOutsideWorkspace: true,
                blockedPaths: blockedPaths.slice(0, blockedPathsMax),
                blockedPathsTruncated,
              },
            };
          }
        }

        const commandForSafety =
          typeof resolvedArgs.command === 'string'
            ? resolvedArgs.command
            : def.execution?.type === 'shell' && typeof def.execution.script === 'string'
              ? String(def.execution.script)
              : undefined;

        if (isShellExecutionTool && typeof commandForSafety === 'string') {
          const safety = evaluateShellCommand(commandForSafety);
          if (safety.verdict === 'deny') {
            const reason = `Blocked command: ${safety.reason}`;
            params.callbacks?.onToolBlocked?.(tc, def, reason);
            if (debugToolsEnabled) {
              params.callbacks?.onDebug?.(`[Tool] blocked tool=${toolName} call=${tc.id} reason=shell-deny`);
            }
            return { success: false, error: reason };
          }
          if (safety.verdict === 'needs_approval') {
            requiresApproval = true;
          }
        }

        const externalPaths = getExternalPathPatterns(def, resolvedArgs, workspaceRoot);
        if (externalPaths.length > 0) {
          if (!allowExternalPaths) {
            const reason =
              'External paths are disabled. Enable lingyun.security.allowExternalPaths to allow access outside the current workspace.';
            params.callbacks?.onToolBlocked?.(tc, def, reason);
            if (debugToolsEnabled) {
              params.callbacks?.onDebug?.(
                `[Tool] blocked tool=${toolName} call=${tc.id} reason=external-path-disabled paths=${externalPaths.map(p => truncateForDebug(p, 200)).join(',')}`,
              );
            }
            return {
              success: false,
              error: reason,
              metadata: {
                errorType: 'external_paths_disabled',
                blockedSettingKey: 'lingyun.security.allowExternalPaths',
                isOutsideWorkspace: true,
              },
            };
          }

          if (debugToolsEnabled) {
            params.callbacks?.onDebug?.(
              `[Tool] external-path allowed tool=${toolName} call=${tc.id} paths=${externalPaths.map(p => truncateForDebug(p, 200)).join(',')}`,
            );
          }
        }

        // Allow plugins to change approval behavior (ask/allow/deny).
        {
          const permissionDecision = await params.plugins.trigger(
            'permission.ask',
            {
              tool: toolName,
              sessionId,
              callId,
              patterns,
              metadata: {
                mode: params.mode,
                requiresApproval,
                permission,
              },
            },
            { status: requiresApproval ? 'ask' : 'allow' },
          );

          if (permissionDecision?.status === 'deny') {
            const reason = 'Tool is denied by a plugin permission hook.';
            params.callbacks?.onToolBlocked?.(tc, def, reason);
            if (debugToolsEnabled) {
              params.callbacks?.onDebug?.(`[Tool] blocked tool=${toolName} call=${tc.id} reason=plugin-deny`);
            }
            return { success: false, error: reason };
          }

          if (permissionDecision?.status === 'allow') {
            requiresApproval = false;
          }

          if (permissionDecision?.status === 'ask') {
            requiresApproval = true;
          }
        }

        const allowAutoApprove = params.mode !== 'plan' && !!config.autoApprove;
        if (requiresApproval && !allowAutoApprove) {
          const approved = (await params.callbacks?.onRequestApproval?.(tc, def)) ?? false;
          if (!approved) {
            if (debugToolsEnabled) {
              params.callbacks?.onDebug?.(`[Tool] blocked tool=${toolName} call=${tc.id} reason=user-rejected`);
            }
            return { success: false, error: 'User rejected this action' };
          }
        }

        if (debugToolsEnabled) {
          params.callbacks?.onDebug?.(
            `[Tool] start tool=${toolName} call=${tc.id} args=${summarizeToolArgsForDebug(argsRecord ?? {})}`,
          );
        }

        const context = params.createToolContext(executeOptions.abortSignal);
        let result = await params.registry.executeTool(def.id, resolvedArgs ?? {}, context);

        if (def.id === 'glob') {
          result = params.fileHandles.decorateGlobResultWithFileHandles(result);
        }

        if (def.id === 'grep') {
          result = params.fileHandles.decorateGrepResultWithFileHandles(result, {
            createMatchId: (fileId, line, character, preview) =>
              params.semanticHandles.createMatchHandle(fileId, line, character, preview).matchId,
          });
        }

        if (def.id === 'symbols_search') {
          result = params.semanticHandles.decorateSymbolsSearchResult(result, params.fileHandles);
        }

        if (def.id === 'symbols_peek') {
          result = params.semanticHandles.decorateSymbolsPeekResult(result, params.fileHandles);
        }

        // Allow plugins to rewrite the tool output that is fed back to the model.
        {
          const baseText = await params.formatToolResult(result, def.name);
          const output = await params.plugins.trigger(
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
            ...(isRecord(output.metadata) ? output.metadata : {}),
          };

          if (typeof output.title === 'string' && output.title.trim()) {
            mergedMeta.title = output.title;
          }
          if (typeof output.output === 'string') {
            mergedMeta.outputText = output.output;
          }

          result = { ...result, metadata: mergedMeta };
        }

        if (debugToolsEnabled) {
          if (result.success) {
            const duration = result.metadata?.duration ? String(result.metadata.duration) : '';
            params.callbacks?.onDebug?.(
              `[Tool] done tool=${toolName} call=${tc.id}${duration ? ` durationMs=${duration}` : ''}`,
            );
          } else {
            params.callbacks?.onDebug?.(
              `[Tool] failed tool=${toolName} call=${tc.id} ${formatToolFailureForDebug(result)}`,
            );
          }
        }
        return result;
      },
      toModelOutput: async (options: unknown) => {
        const optionsRecord = asUnknownRecord(options);
        const outputCandidate = optionsRecord?.output;
        const output = isToolResult(outputCandidate) ? outputCandidate : { success: false };
        const content = await params.formatToolResult(output, def.name);
        return { type: 'text', value: content };
      },
    });
  }

  return out;
}
