import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler, ToolContext } from '../../core/types';
import { getLspAdapter } from '../../core/lsp';
import { optionalNumber, optionalString, requireString } from '@kooka/core';
import { getWorkspaceRootUri, resolveWorkspacePath, toPosixPath } from './workspace';

type LspOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls';

type LegacyLspOperation =
  | 'definition'
  | 'references'
  | 'implementation'
  | 'callHierarchyPrepare'
  | 'callHierarchyIncoming'
  | 'callHierarchyOutgoing';

type LspOperationInput = LspOperation | LegacyLspOperation;

const CANONICAL_OPERATIONS: ReadonlySet<LspOperation> = new Set([
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls',
]);

const OPERATION_ALIASES: Readonly<Record<LegacyLspOperation, LspOperation>> = {
  definition: 'goToDefinition',
  references: 'findReferences',
  implementation: 'goToImplementation',
  callHierarchyPrepare: 'prepareCallHierarchy',
  callHierarchyIncoming: 'incomingCalls',
  callHierarchyOutgoing: 'outgoingCalls',
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SYMBOL_NODES = 200;
const MAX_HOVER_CHARS = 8000;
const WORKSPACE_SYMBOL_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Variable,
  vscode.SymbolKind.Constant,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Enum,
]);

type OneBasedPosition = { line: number; character: number };
type OneBasedRange = { start: OneBasedPosition; end: OneBasedPosition };

type NormalizedLocation = {
  filePath: string;
  range: OneBasedRange;
};

type NormalizedDocumentSymbol = {
  name: string;
  detail?: string;
  kind: string;
  range: OneBasedRange;
  selectionRange: OneBasedRange;
  children: NormalizedDocumentSymbol[];
};

type NormalizedSymbolInformation = {
  name: string;
  kind: string;
  containerName?: string;
  location?: NormalizedLocation;
};

type NormalizedCallHierarchyItem = {
  name: string;
  kind: string;
  detail?: string;
  uri: string;
  filePath: string;
  range: OneBasedRange;
  selectionRange: OneBasedRange;
};

type NormalizedIncomingCall = {
  from: NormalizedCallHierarchyItem;
  fromRanges: OneBasedRange[];
};

type NormalizedOutgoingCall = {
  to: NormalizedCallHierarchyItem;
  fromRanges: OneBasedRange[];
};

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const lspTool: ToolDefinition = {
  id: 'lsp',
  name: 'Language Features (VS Code)',
  description:
    `Interact with VS Code language features to get semantic code intelligence.

Prefer higher-level tools for common navigation:
- symbols_search -> find a symbol by name (no file/position needed)
- symbols_peek -> hover + definition + snippet in one call

Supported operations (OpenCode-aligned; line/character are 1-based):
- goToDefinition
- findReferences
- hover
- documentSymbol
- workspaceSymbol
- goToImplementation
- prepareCallHierarchy
- incomingCalls
- outgoingCalls

Inputs:
- filePath: absolute or workspace-relative path
- line/character: 1-based position (required for position-based operations)
- query (optional): workspaceSymbol search query (default "")
- limit (optional): max results (default 20, max 100)`,
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'Operation to run',
        enum: Array.from(CANONICAL_OPERATIONS),
      },
      fileId: {
        type: 'string',
        description: 'File handle from glob output (e.g. "F1"). Prefer this over spelling file paths.',
      },
      filePath: {
        type: 'string',
        description:
          'Absolute path or workspace-relative path. Required for file-based operations.',
      },
      line: { type: 'number', description: '1-based line number for position-based operations' },
      character: { type: 'number', description: '1-based character (column) number for position-based operations' },
      query: { type: 'string', description: 'Search query for workspaceSymbol' },
      limit: { type: 'number', description: 'Max results to return (default 20, max 100)' },
      item: {
        type: 'object',
        description:
          'Deprecated (legacy retry compatibility): call hierarchy item for callHierarchyIncoming/callHierarchyOutgoing. Prefer position-based incomingCalls/outgoingCalls.',
        properties: {
          name: { type: 'string' },
          kind: { type: 'number' },
          detail: { type: 'string' },
          uri: { type: 'string' },
          range: {
            type: 'object',
            properties: {
              start: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
              end: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
            },
          },
          selectionRange: {
            type: 'object',
            properties: {
              start: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
              end: { type: 'object', properties: { line: { type: 'number' }, character: { type: 'number' } } },
            },
          },
        },
      },
    },
    required: ['operation'],
  },
  execution: { type: 'function', handler: 'builtin.lsp' },
  metadata: {
    category: 'code',
    icon: 'symbol',
    requiresApproval: false,
    permission: 'lsp',
    readOnly: true,
    permissionPatterns: [
      { arg: 'operation', kind: 'raw' },
      { arg: 'filePath', kind: 'path' },
      { arg: 'query', kind: 'raw' },
    ],
  },
};

function clampLimit(raw: number | undefined): number {
  if (!Number.isFinite(raw as number)) return DEFAULT_LIMIT;
  const value = Math.floor(raw as number);
  return Math.min(MAX_LIMIT, Math.max(1, value));
}

function ensureOperation(raw: string): LspOperation | { error: string } {
  const op = raw.trim() as LspOperationInput;
  if (CANONICAL_OPERATIONS.has(op as LspOperation)) {
    return op as LspOperation;
  }
  if (op in OPERATION_ALIASES) {
    return OPERATION_ALIASES[op as LegacyLspOperation];
  }
  return { error: `Unsupported operation: ${raw}` };
}

function toOneBasedPosition(pos: vscode.Position): { line: number; character: number } {
  return { line: pos.line + 1, character: pos.character + 1 };
}

function toOneBasedRange(range: vscode.Range): OneBasedRange {
  return { start: toOneBasedPosition(range.start), end: toOneBasedPosition(range.end) };
}

function symbolKindToString(kind: vscode.SymbolKind): string {
  const symbolKindTable = vscode.SymbolKind as unknown as Record<number, string>;
  const name = symbolKindTable[kind];
  return typeof name === 'string' ? name : String(kind);
}

function getTargetDocumentUri(
  args: Record<string, unknown>,
  context: ToolContext,
  allowMissing: boolean
): { uri: vscode.Uri; relPath?: string } | { error: string } {
  const filePath = optionalString(args, 'filePath');
  if (filePath && filePath.trim()) {
    const resolved = resolveWorkspacePath(filePath, context);
    return { uri: resolved.uri, relPath: toPosixPath(resolved.relPath) };
  }

  const active = context.activeEditor?.document?.uri;
  if (active && active.scheme === 'file') {
    try {
      const resolved = resolveWorkspacePath(active.fsPath, context);
      return { uri: resolved.uri, relPath: toPosixPath(resolved.relPath) };
    } catch {
      // ignore
    }
  }

  if (allowMissing) {
    return { uri: getWorkspaceRootUri(context) };
  }

  return { error: 'filePath is required (or focus an editor inside the workspace)' };
}

function getPosition(
  args: Record<string, unknown>,
  context: ToolContext,
  targetUri: vscode.Uri
): { position: vscode.Position } | { error: string } {
  const lineRaw = optionalNumber(args, 'line');
  const characterRaw = optionalNumber(args, 'character');

  if (Number.isFinite(lineRaw as number)) {
    const line = Math.max(1, Math.floor(lineRaw as number));
    const character = Number.isFinite(characterRaw as number) ? Math.max(1, Math.floor(characterRaw as number)) : 1;
    return { position: new vscode.Position(line - 1, character - 1) };
  }

  const active = context.activeEditor;
  if (active && active.document?.uri?.toString() === targetUri.toString()) {
    return { position: active.selection.active };
  }

  return { error: 'line is required for this operation (1-based) unless the target file is the active editor' };
}

function isLocation(value: unknown): value is vscode.Location {
  const v = asUnknownRecord(value);
  return !!v && v.uri instanceof vscode.Uri && v.range instanceof vscode.Range;
}

function normalizeLocationLike(
  value: vscode.Location | vscode.LocationLink,
  context: ToolContext
): { location?: NormalizedLocation; skippedOutsideWorkspace?: boolean } {
  const uri = isLocation(value) ? value.uri : (value as vscode.LocationLink).targetUri;
  const range = isLocation(value)
    ? value.range
    : (value as vscode.LocationLink).targetSelectionRange || (value as vscode.LocationLink).targetRange;

  try {
    const resolved = resolveWorkspacePath(uri.fsPath, context);
    return {
      location: {
        filePath: toPosixPath(resolved.relPath),
        range: toOneBasedRange(range),
      },
    };
  } catch {
    return { skippedOutsideWorkspace: true };
  }
}

function normalizeHoverContents(contents: readonly unknown[]): string {
  const parts: string[] = [];

  for (const entry of contents) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (entry instanceof vscode.MarkdownString) {
      parts.push(entry.value);
      continue;
    }
    const entryRecord = asUnknownRecord(entry);
    if (entryRecord) {
      if (typeof entryRecord.value === 'string') {
        const language = asString(entryRecord.language);
        if (language && language.trim()) {
          parts.push(`\`\`\`${language}\n${entryRecord.value}\n\`\`\``);
        } else {
          parts.push(entryRecord.value);
        }
        continue;
      }
    }
  }

  const joined = parts.join('\n\n').trim();
  if (joined.length <= MAX_HOVER_CHARS) return joined;
  return joined.slice(0, MAX_HOVER_CHARS) + '\n\n(Truncated)';
}

function normalizeDocumentSymbols(
  symbols: readonly vscode.DocumentSymbol[],
  remaining: { count: number }
): NormalizedDocumentSymbol[] {
  const out: NormalizedDocumentSymbol[] = [];
  for (const symbol of symbols) {
    if (remaining.count <= 0) break;
    remaining.count -= 1;

    out.push({
      name: symbol.name,
      detail: symbol.detail || undefined,
      kind: symbolKindToString(symbol.kind),
      range: toOneBasedRange(symbol.range),
      selectionRange: toOneBasedRange(symbol.selectionRange),
      children: symbol.children && symbol.children.length > 0 ? normalizeDocumentSymbols(symbol.children, remaining) : [],
    });
  }
  return out;
}

function normalizeSymbolInformation(
  info: vscode.SymbolInformation,
  context: ToolContext
): NormalizedSymbolInformation | null {
  const normalized = normalizeLocationLike(info.location, context);
  if (normalized.skippedOutsideWorkspace) return null;
  return {
    name: info.name,
    kind: symbolKindToString(info.kind),
    containerName: info.containerName || undefined,
    location: normalized.location,
  };
}

function createCallHierarchyItemFromArgs(args: unknown): vscode.CallHierarchyItem | { error: string } {
  const argsRecord = asUnknownRecord(args);
  if (!argsRecord) return { error: 'item is required for this operation' };
  const name = asString(argsRecord.name) ?? '';
  const detail = asString(argsRecord.detail) ?? '';
  const uriRaw = asString(argsRecord.uri) ?? '';
  const kindRaw = typeof argsRecord.kind === 'number' ? argsRecord.kind : Number(argsRecord.kind);

  if (!name || !uriRaw || !Number.isFinite(kindRaw)) {
    return { error: 'item must include name, kind, and uri' };
  }

  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(uriRaw);
  } catch {
    return { error: 'item.uri must be a valid URI string' };
  }

  const rangeObj = argsRecord.range;
  const selectionObj = argsRecord.selectionRange;
  const range = parseRange(rangeObj);
  const selectionRange = parseRange(selectionObj);
  if (!range || !selectionRange) {
    return { error: 'item.range and item.selectionRange are required with start/end line/character (1-based)' };
  }

  return new vscode.CallHierarchyItem(kindRaw, name, detail, uri, range, selectionRange);
}

function parseRange(rangeObj: unknown): vscode.Range | null {
  const rangeRecord = asUnknownRecord(rangeObj);
  if (!rangeRecord) return null;
  const start = asUnknownRecord(rangeRecord.start);
  const end = asUnknownRecord(rangeRecord.end);
  if (!start || !end) return null;
  const startLine = Number(start.line);
  const startChar = Number(start.character);
  const endLine = Number(end.line);
  const endChar = Number(end.character);
  if (![startLine, startChar, endLine, endChar].every(n => Number.isFinite(n))) return null;
  return new vscode.Range(
    new vscode.Position(Math.max(0, startLine - 1), Math.max(0, startChar - 1)),
    new vscode.Position(Math.max(0, endLine - 1), Math.max(0, endChar - 1))
  );
}

function normalizeCallHierarchyItem(
  item: vscode.CallHierarchyItem,
  context: ToolContext
): NormalizedCallHierarchyItem | null {
  try {
    const resolved = resolveWorkspacePath(item.uri.fsPath, context);
    return {
      name: item.name,
      kind: symbolKindToString(item.kind),
      detail: item.detail || undefined,
      uri: item.uri.toString(),
      filePath: toPosixPath(resolved.relPath),
      range: toOneBasedRange(item.range),
      selectionRange: toOneBasedRange(item.selectionRange),
    };
  } catch {
    return null;
  }
}

function normalizeIncomingCalls(
  calls: readonly vscode.CallHierarchyIncomingCall[],
  context: ToolContext
): NormalizedIncomingCall[] {
  const out: NormalizedIncomingCall[] = [];
  for (const call of calls) {
    const from = normalizeCallHierarchyItem(call.from, context);
    if (!from) continue;
    out.push({
      from,
      fromRanges: call.fromRanges.map(r => toOneBasedRange(r)),
    });
  }
  return out;
}

function normalizeOutgoingCalls(
  calls: readonly vscode.CallHierarchyOutgoingCall[],
  context: ToolContext
): NormalizedOutgoingCall[] {
  const out: NormalizedOutgoingCall[] = [];
  for (const call of calls) {
    const to = normalizeCallHierarchyItem(call.to, context);
    if (!to) continue;
    out.push({
      to,
      fromRanges: call.fromRanges.map(r => toOneBasedRange(r)),
    });
  }
  return out;
}

export const lspHandler: ToolHandler = async (args, context) => {
  try {
    const adapter = getLspAdapter();

    const opResult = requireString(args, 'operation');
    if ('error' in opResult) return { success: false, error: opResult.error };
    const opChecked = ensureOperation(opResult.value);
    if (typeof opChecked !== 'string') return { success: false, error: opChecked.error };
    const operation = opChecked;

    const limit = clampLimit(optionalNumber(args, 'limit'));

    if (operation === 'workspaceSymbol') {
      const query = optionalString(args, 'query') || '';
      let touchedFilePath: string | undefined;

      const filePath = optionalString(args, 'filePath');
      if (filePath && filePath.trim()) {
        try {
          const resolved = resolveWorkspacePath(filePath, context);
          const stat = await vscode.workspace.fs.stat(resolved.uri);
          if (stat.type === vscode.FileType.File) {
            await adapter.touchFile(resolved.uri, {
              waitForDiagnostics: true,
              cancellationToken: context.cancellationToken,
            });
            touchedFilePath = toPosixPath(resolved.relPath);
          }
        } catch {
          // ignore
        }
      } else if (context.activeEditor?.document?.uri?.scheme === 'file') {
        try {
          const resolved = resolveWorkspacePath(context.activeEditor.document.uri.fsPath, context);
          const stat = await vscode.workspace.fs.stat(resolved.uri);
          if (stat.type === vscode.FileType.File) {
            await adapter.touchFile(resolved.uri, {
              waitForDiagnostics: true,
              cancellationToken: context.cancellationToken,
            });
            touchedFilePath = toPosixPath(resolved.relPath);
          }
        } catch {
          // ignore
        }
      }

      const items = await adapter.workspaceSymbol(query);
      const filtered = items.filter(item => WORKSPACE_SYMBOL_KINDS.has(item.kind));
      const results: NormalizedSymbolInformation[] = [];
      let skippedOutsideWorkspace = 0;
      for (const item of filtered) {
        const normalized = normalizeSymbolInformation(item, context);
        if (!normalized) {
          skippedOutsideWorkspace += 1;
          continue;
        }
        results.push(normalized);
        if (results.length >= limit) break;
      }
      const truncated = results.length >= limit && filtered.length > results.length;
      return {
        success: true,
        data: { operation, query, filePath: touchedFilePath, results, skippedOutsideWorkspace, truncated },
      };
    }

    if (operation === 'incomingCalls' || operation === 'outgoingCalls') {
      const legacyItemRaw = args.item;
      if (legacyItemRaw) {
        // Legacy retry compatibility: callers used to pass a CallHierarchyItem-like blob.
        const item = createCallHierarchyItemFromArgs(legacyItemRaw);
        if ('error' in item) return { success: false, error: item.error };
        const allResults =
          operation === 'incomingCalls'
            ? normalizeIncomingCalls(await adapter.incomingCallsForItem(item), context)
            : normalizeOutgoingCalls(await adapter.outgoingCallsForItem(item), context);
        const results = allResults.slice(0, limit);
        return { success: true, data: { operation, results, truncated: allResults.length > results.length } };
      }

      // OpenCode-aligned: position-based incomingCalls/outgoingCalls.
      const docResult = getTargetDocumentUri(args, context, false);
      if ('error' in docResult) return { success: false, error: docResult.error };
      const targetUri = docResult.uri;
      const targetFilePath = docResult.relPath;

      await adapter.touchFile(targetUri, {
        waitForDiagnostics: true,
        cancellationToken: context.cancellationToken,
      });

      const positionResult = getPosition(args, context, targetUri);
      if ('error' in positionResult) return { success: false, error: positionResult.error };

      const allResults =
        operation === 'incomingCalls'
          ? normalizeIncomingCalls(await adapter.incomingCallsAtPosition(targetUri, positionResult.position), context)
          : normalizeOutgoingCalls(await adapter.outgoingCallsAtPosition(targetUri, positionResult.position), context);
      const results = allResults.slice(0, limit);

      return {
        success: true,
        data: {
          operation,
          filePath: targetFilePath,
          position: toOneBasedPosition(positionResult.position),
          results,
          truncated: allResults.length > results.length,
        },
      };
    }

    const docResult = getTargetDocumentUri(args, context, false);
    if ('error' in docResult) return { success: false, error: docResult.error };
    const targetUri = docResult.uri;
    const targetFilePath = docResult.relPath;

    await adapter.touchFile(targetUri, {
      waitForDiagnostics: true,
      cancellationToken: context.cancellationToken,
    });

    if (operation === 'documentSymbol') {
      const raw = await adapter.documentSymbol(targetUri);
      const results: Array<NormalizedDocumentSymbol | NormalizedSymbolInformation> = [];
      let skippedOutsideWorkspace = 0;
      let truncated = false;

      if (Array.isArray(raw) && raw.length > 0) {
        const first = raw[0];
        const firstRecord = asUnknownRecord(first);
        if (firstRecord && 'location' in firstRecord) {
          // SymbolInformation[]
          for (const item of raw as vscode.SymbolInformation[]) {
            const normalized = normalizeSymbolInformation(item, context);
            if (!normalized) {
              skippedOutsideWorkspace += 1;
              continue;
            }
            results.push(normalized);
            if (results.length >= limit) break;
          }
          truncated = results.length >= limit && raw.length > results.length;
        } else {
          // DocumentSymbol[]
          const remaining = { count: Math.min(MAX_SYMBOL_NODES, limit * 10) };
          const tree = normalizeDocumentSymbols(raw as vscode.DocumentSymbol[], remaining);
          results.push(...tree);
          truncated = remaining.count <= 0;
        }
      }

      return {
        success: true,
        data: { operation, filePath: targetFilePath, results, skippedOutsideWorkspace, truncated },
      };
    }

    if (operation === 'prepareCallHierarchy') {
      const positionResult = getPosition(args, context, targetUri);
      if ('error' in positionResult) return { success: false, error: positionResult.error };
      const items = await adapter.prepareCallHierarchy(targetUri, positionResult.position);
      const results: NormalizedCallHierarchyItem[] = [];
      let skippedOutsideWorkspace = 0;
      for (const item of items) {
        const normalized = normalizeCallHierarchyItem(item, context);
        if (!normalized) {
          skippedOutsideWorkspace += 1;
          continue;
        }
        results.push(normalized);
        if (results.length >= limit) break;
      }
      const truncated = results.length >= limit && items.length > results.length;
      return {
        success: true,
        data: {
          operation,
          filePath: targetFilePath,
          position: toOneBasedPosition(positionResult.position),
          results,
          skippedOutsideWorkspace,
          truncated,
        },
      };
    }

    const positionResult = getPosition(args, context, targetUri);
    if ('error' in positionResult) return { success: false, error: positionResult.error };
    const position = positionResult.position;

    if (operation === 'hover') {
      const items = await adapter.hover(targetUri, position);
      const results = items.slice(0, Math.max(1, limit)).map(hover => ({
        contents: normalizeHoverContents(hover.contents || []),
        range: hover.range ? toOneBasedRange(hover.range) : undefined,
      }));
      return {
        success: true,
        data: { operation, filePath: targetFilePath, position: toOneBasedPosition(position), results, truncated: items.length > results.length },
      };
    }

    const items =
      operation === 'goToDefinition'
        ? await adapter.goToDefinition(targetUri, position)
        : operation === 'goToImplementation'
          ? await adapter.goToImplementation(targetUri, position)
          : await adapter.findReferences(targetUri, position);
    const results: NormalizedLocation[] = [];
    let skippedOutsideWorkspace = 0;
    for (const item of items) {
      const normalized = normalizeLocationLike(item, context);
      if (normalized.skippedOutsideWorkspace) {
        skippedOutsideWorkspace += 1;
        continue;
      }
      if (normalized.location) results.push(normalized.location);
      if (results.length >= limit) break;
    }
    const truncated = results.length >= limit && items.length > results.length;

    return {
      success: true,
      data: {
        operation,
        filePath: targetFilePath,
        position: toOneBasedPosition(position),
        results,
        skippedOutsideWorkspace,
        truncated,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
