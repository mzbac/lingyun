import * as vscode from 'vscode';

import type { ToolDefinition, ToolHandler } from '../../core/types';
import { getLspAdapter } from '../../core/lsp';
import { optionalNumber, optionalString, requireString } from '@kooka/core';
import { getWorkspaceRootUri, resolveWorkspacePath, toPosixPath } from './workspace';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_HOVER_CHARS = 8000;
const MAX_SNIPPET_LINES = 80;
const MAX_SNIPPET_LINE_LENGTH = 2000;
const SNIPPET_CONTEXT_LINES = 15;

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

function clampLimit(raw: number | undefined): number {
  if (!Number.isFinite(raw as number)) return DEFAULT_LIMIT;
  const value = Math.floor(raw as number);
  return Math.min(MAX_LIMIT, Math.max(1, value));
}

function toOneBasedPosition(pos: vscode.Position): { line: number; character: number } {
  return { line: pos.line + 1, character: pos.character + 1 };
}

function toOneBasedRange(range: vscode.Range): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return { start: toOneBasedPosition(range.start), end: toOneBasedPosition(range.end) };
}

function symbolKindToString(kind: vscode.SymbolKind): string {
  const name = (vscode.SymbolKind as any)[kind];
  return typeof name === 'string' ? name : String(kind);
}

function isLocation(value: unknown): value is vscode.Location {
  const v = value as any;
  return !!v && typeof v === 'object' && v.uri instanceof vscode.Uri && v.range instanceof vscode.Range;
}

function normalizeLocationLike(
  value: vscode.Location | vscode.LocationLink,
  context: { workspaceFolder?: vscode.Uri }
): { location?: any; skippedOutsideWorkspace?: boolean } {
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

function normalizeHoverContents(contents: readonly any[]): string {
  const parts: string[] = [];

  for (const entry of contents) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (typeof entry === 'object') {
      const maybeMarkdown = entry as vscode.MarkdownString;
      if (typeof (maybeMarkdown as any).value === 'string') {
        parts.push((maybeMarkdown as any).value);
        continue;
      }
      const marked = entry as { language?: string; value?: string };
      if (typeof marked.value === 'string') {
        if (marked.language) {
          parts.push(`\`\`\`${marked.language}\n${marked.value}\n\`\`\``);
        } else {
          parts.push(marked.value);
        }
      }
    }
  }

  const joined = parts.join('\n\n').trim();
  if (joined.length <= MAX_HOVER_CHARS) return joined;
  return joined.slice(0, MAX_HOVER_CHARS) + '\n\n(Truncated)';
}

function buildSnippet(doc: vscode.TextDocument, centerLineOneBased: number): { startLine: number; endLine: number; text: string } {
  const totalLines = doc.lineCount;
  const centerLine = Math.max(1, Math.min(totalLines, Math.floor(centerLineOneBased)));
  const startLine = Math.max(1, centerLine - SNIPPET_CONTEXT_LINES);
  const endLine = Math.min(totalLines, centerLine + SNIPPET_CONTEXT_LINES);
  const maxLines = Math.min(MAX_SNIPPET_LINES, Math.max(1, endLine - startLine + 1));

  const lines: string[] = [];
  for (let line = startLine; line < startLine + maxLines; line++) {
    const raw = doc.lineAt(line - 1).text;
    const trimmed = raw.length > MAX_SNIPPET_LINE_LENGTH ? raw.slice(0, MAX_SNIPPET_LINE_LENGTH) + '...' : raw;
    lines.push(`${String(line).padStart(5, '0')}| ${trimmed}`);
  }

  return { startLine, endLine: startLine + maxLines - 1, text: '<file>\n' + lines.join('\n') + '\n</file>' };
}

export const symbolsSearchTool: ToolDefinition = {
  id: 'symbols.search',
  name: 'Search Symbols',
  description:
    'Semantic symbol search using VS Code workspace symbols. Use this to find where something is defined without regex grep.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Symbol query (e.g. "Foo" or "Foo bar")' },
      limit: { type: 'number', description: 'Max results to return (default 20, max 100)' },
      filePath: {
        type: 'string',
        description:
          'Optional: a file path (absolute or workspace-relative) to touch/warm the language server before searching.',
      },
    },
    required: ['query'],
  },
  execution: { type: 'function', handler: 'builtin.symbols.search' },
  metadata: {
    category: 'code',
    icon: 'symbol',
    requiresApproval: false,
    permission: 'lsp',
    readOnly: true,
    permissionPatterns: [
      { arg: 'query', kind: 'raw' },
      { arg: 'filePath', kind: 'path' },
    ],
  },
};

export const symbolsSearchHandler: ToolHandler = async (args, context) => {
  try {
    const queryResult = requireString(args, 'query');
    if ('error' in queryResult) return { success: false, error: queryResult.error };
    const query = queryResult.value;

    const limit = clampLimit(optionalNumber(args, 'limit'));
    const adapter = getLspAdapter();

    const filePath = optionalString(args, 'filePath');
    if (filePath && filePath.trim()) {
      try {
        const resolved = resolveWorkspacePath(filePath, context);
        await adapter.touchFile(resolved.uri, { waitForDiagnostics: true, cancellationToken: context.cancellationToken });
      } catch {
        // ignore
      }
    } else if (context.activeEditor?.document?.uri?.scheme === 'file') {
      try {
        const resolved = resolveWorkspacePath(context.activeEditor.document.uri.fsPath, context);
        await adapter.touchFile(resolved.uri, { waitForDiagnostics: true, cancellationToken: context.cancellationToken });
      } catch {
        // ignore
      }
    }

    const items = await adapter.workspaceSymbol(query);
    const filtered = items.filter(item => WORKSPACE_SYMBOL_KINDS.has(item.kind));

    const results: any[] = [];
    let skippedOutsideWorkspace = 0;
    for (const item of filtered) {
      const normalized = normalizeLocationLike(item.location, context);
      if (normalized.skippedOutsideWorkspace) {
        skippedOutsideWorkspace += 1;
        continue;
      }
      results.push({
        name: item.name,
        kind: symbolKindToString(item.kind),
        containerName: item.containerName || undefined,
        location: normalized.location,
      });
      if (results.length >= limit) break;
    }

    const truncated = results.length >= limit && filtered.length > results.length;
    const note =
      results.length === 0
        ? 'No workspace symbols found. If you expected results, try opening a relevant file in the editor to warm the language server, then retry. As a fallback, use grep.'
        : 'Use symbols.peek with a returned symbolId (or fileId + line/character) to fetch hover/definition/snippet.';

    return {
      success: true,
      data: {
        query,
        results,
        skippedOutsideWorkspace,
        truncated,
        note,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const symbolsPeekTool: ToolDefinition = {
  id: 'symbols.peek',
  name: 'Peek Symbol',
  description:
    'One-call semantic context pack: hover + definition + small snippet + optional reference sample. Prefer this over grep+read loops.',
  parameters: {
    type: 'object',
    properties: {
      symbolId: { type: 'string', description: 'Symbol handle from symbols.search output (e.g. "S1")' },
      matchId: { type: 'string', description: 'Match handle from grep output (e.g. "M1")' },
      locId: { type: 'string', description: 'Location handle from previous outputs (e.g. "L1")' },
      fileId: { type: 'string', description: 'File handle from glob/grep output (e.g. "F1")' },
      filePath: { type: 'string', description: 'Absolute path or workspace-relative path' },
      line: { type: 'number', description: '1-based line number' },
      character: { type: 'number', description: '1-based character (column) number' },
      include: {
        type: 'object',
        properties: {
          hover: { type: 'boolean', description: 'Include hover/signature text (default true)' },
          definition: { type: 'boolean', description: 'Include definition location(s) (default true)' },
          snippet: { type: 'boolean', description: 'Include a small snippet around the target (default true)' },
          refsSample: { type: 'number', description: 'Number of reference locations to sample (default 5, 0 disables)' },
        },
      },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.symbols.peek' },
  metadata: {
    category: 'code',
    icon: 'symbol',
    requiresApproval: false,
    permission: 'lsp',
    readOnly: true,
    permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
  },
};

export const symbolsPeekHandler: ToolHandler = async (args, context) => {
  try {
    const adapter = getLspAdapter();

    const includeObj = typeof (args as any).include === 'object' && (args as any).include ? (args as any).include : {};
    const includeHover = includeObj.hover !== false;
    const includeDefinition = includeObj.definition !== false;
    const includeSnippet = includeObj.snippet !== false;
    const refsSampleRaw = optionalNumber(includeObj, 'refsSample');
    const refsSample = Number.isFinite(refsSampleRaw as number) ? Math.max(0, Math.min(20, Math.floor(refsSampleRaw as number))) : 5;

    const filePath = optionalString(args, 'filePath');
    let targetUri: vscode.Uri | undefined;
    let targetRelPath: string | undefined;

    if (filePath && filePath.trim()) {
      const resolved = resolveWorkspacePath(filePath, context);
      targetUri = resolved.uri;
      targetRelPath = toPosixPath(resolved.relPath);
    } else if (context.activeEditor?.document?.uri?.scheme === 'file') {
      const resolved = resolveWorkspacePath(context.activeEditor.document.uri.fsPath, context);
      targetUri = resolved.uri;
      targetRelPath = toPosixPath(resolved.relPath);
    }

    if (!targetUri) {
      return {
        success: false,
        error: 'filePath is required (or focus an editor inside the workspace)',
      };
    }

    const lineRaw = optionalNumber(args, 'line');
    const characterRaw = optionalNumber(args, 'character');
    if (!Number.isFinite(lineRaw as number)) {
      return {
        success: false,
        error: 'line is required for symbols.peek (1-based). Provide symbolId/matchId/locId or a fileId/filePath + line/character.',
      };
    }

    const line = Math.max(1, Math.floor(lineRaw as number));
    const character = Number.isFinite(characterRaw as number) ? Math.max(1, Math.floor(characterRaw as number)) : 1;
    const position = new vscode.Position(line - 1, character - 1);

    await adapter.touchFile(targetUri, { waitForDiagnostics: true, cancellationToken: context.cancellationToken });
    const doc = await vscode.workspace.openTextDocument(targetUri);

    const hover = includeHover ? await adapter.hover(targetUri, position) : [];
    const hoverText =
      includeHover && hover.length > 0 ? normalizeHoverContents(hover[0]?.contents || []) : undefined;

    const defs = includeDefinition ? await adapter.goToDefinition(targetUri, position) : [];
    const defResults: any[] = [];
    let skippedDefsOutsideWorkspace = 0;
    for (const def of defs) {
      const normalized = normalizeLocationLike(def as any, context);
      if (normalized.skippedOutsideWorkspace) {
        skippedDefsOutsideWorkspace += 1;
        continue;
      }
      if (normalized.location) defResults.push(normalized.location);
      if (defResults.length >= 5) break;
    }

    const refs = refsSample > 0 ? await adapter.findReferences(targetUri, position) : [];
    const refResults: any[] = [];
    let skippedRefsOutsideWorkspace = 0;
    for (const ref of refs) {
      const normalized = normalizeLocationLike(ref as any, context);
      if (normalized.skippedOutsideWorkspace) {
        skippedRefsOutsideWorkspace += 1;
        continue;
      }
      if (normalized.location) refResults.push(normalized.location);
      if (refResults.length >= refsSample) break;
    }

    const snippet = includeSnippet ? buildSnippet(doc, line) : undefined;

    return {
      success: true,
      data: {
        filePath: targetRelPath,
        position: { line, character },
        ...(hoverText ? { hover: hoverText } : {}),
        ...(includeDefinition ? { definition: defResults, skippedDefsOutsideWorkspace } : {}),
        ...(refsSample > 0 ? { refsSample: refResults, skippedRefsOutsideWorkspace } : {}),
        ...(snippet ? { snippet: { filePath: targetRelPath, ...snippet } } : {}),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};

