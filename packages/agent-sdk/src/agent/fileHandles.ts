import * as path from 'path';

import type { ToolResult } from '../types.js';
import type { SemanticHandleRegistry } from './semanticHandles.js';
import type { FileHandleLike } from './semanticHandles.js';

export type FileHandlesState = {
  fileHandles?: {
    nextId: number;
    byId: Record<string, string>;
  };
  workspaceRoot?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class FileHandleRegistry {
  constructor(private readonly params: { workspaceRoot?: string }) {}

  private normalizePath(raw: string): string {
    const value = raw.trim();
    if (!value) return '';

    const workspaceRoot = this.params.workspaceRoot;
    if (!workspaceRoot) return value;

    try {
      const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
      const rel = path.relative(workspaceRoot, abs);
      if (rel && rel !== '.' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.replace(/\\/g, '/');
      }
      return abs;
    } catch {
      return value;
    }
  }

  private ensureState(session: FileHandlesState): NonNullable<FileHandlesState['fileHandles']> {
    if (!session.fileHandles) {
      session.fileHandles = { nextId: 1, byId: {} };
      return session.fileHandles;
    }

    const nextId = (session.fileHandles as any).nextId;
    const byId = (session.fileHandles as any).byId;
    if (typeof nextId !== 'number' || !Number.isFinite(nextId) || nextId < 1 || !byId || typeof byId !== 'object') {
      session.fileHandles = { nextId: 1, byId: {} };
      return session.fileHandles;
    }

    return session.fileHandles;
  }

  resolveFileId(session: FileHandlesState, fileId: string): string | undefined {
    const id = fileId.trim();
    if (!id) return undefined;
    const handles = this.ensureState(session);
    const resolved = handles.byId[id];
    return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : undefined;
  }

  getOrCreate(session: FileHandlesState, filePath: string): FileHandleLike {
    const normalizedPath = this.normalizePath(filePath);
    if (!normalizedPath) {
      return { id: 'F0', filePath: filePath.trim() };
    }

    const handles = this.ensureState(session);
    for (const [existingId, existingPath] of Object.entries(handles.byId)) {
      if (existingPath === normalizedPath) {
        return { id: existingId, filePath: normalizedPath };
      }
    }

    const id = `F${handles.nextId++}`;
    handles.byId[id] = normalizedPath;
    return { id, filePath: normalizedPath };
  }

  decorateGlobResult(session: FileHandlesState, result: ToolResult): ToolResult {
    if (!result.success) return result;

    const data = result.data;
    if (!isRecord(data)) return result;

    const filesRaw = (data as any).files;
    if (!Array.isArray(filesRaw)) return result;

    const files = filesRaw
      .filter((value: unknown): value is string => typeof value === 'string')
      .map((value: string) => value.trim())
      .filter(Boolean);

    const notesRaw = (data as any).notes;
    const notes = Array.isArray(notesRaw)
      ? notesRaw
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value: string) => value.trim())
          .filter(Boolean)
      : [];

    const truncated = Boolean((data as any).truncated);

    const lines: string[] = [];
    if (notes.length > 0) {
      lines.push(`Note: ${notes.join(' ')}`, '');
    }

    if (files.length === 0) {
      lines.push('No files found');
    } else {
      lines.push('Use fileId with read/read_range/edit/write/lsp/symbols_peek:', '');
      for (const filePath of files) {
        const handle = this.getOrCreate(session, filePath);
        lines.push(`${handle.id}  ${handle.filePath}`);
      }
      lines.push(
        '',
        'Tip: For symbol navigation (definitions/references/types), prefer symbols_search → symbols_peek or lsp over grep.',
      );
      if (truncated) {
        lines.push('', '(Results are truncated. Consider using a more specific path or pattern.)');
      }
    }

    return {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        outputText: lines.join('\n').trimEnd(),
      },
    };
  }

  decorateGrepResult(session: FileHandlesState, result: ToolResult, semanticHandles: SemanticHandleRegistry): ToolResult {
    if (!result.success) return result;

    const data = result.data;
    if (!isRecord(data)) return result;

    const matchesRaw = (data as any).matches;
    if (!Array.isArray(matchesRaw)) return result;

    type GrepMatch = { filePath: string; line: number; column?: number; text: string };

    const matches: GrepMatch[] = [];
    for (const item of matchesRaw) {
      if (!isRecord(item)) continue;

      const filePathRaw = (item as any).filePath;
      const lineRaw = (item as any).line;
      const columnRaw = (item as any).column;
      const textRaw = (item as any).text;

      if (typeof filePathRaw !== 'string' || !filePathRaw.trim()) continue;
      if (typeof lineRaw !== 'number' || !Number.isFinite(lineRaw)) continue;
      if (typeof textRaw !== 'string') continue;

      const column = typeof columnRaw === 'number' && Number.isFinite(columnRaw) ? Math.floor(columnRaw) : undefined;

      matches.push({
        filePath: filePathRaw.trim(),
        line: Math.max(1, Math.floor(lineRaw)),
        ...(column && column > 0 ? { column } : {}),
        text: textRaw.trim(),
      });
    }

    const notesRaw = (data as any).notes;
    const notes = Array.isArray(notesRaw)
      ? notesRaw
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value: string) => value.trim())
          .filter(Boolean)
      : [];

    const truncated = Boolean((data as any).truncated);

    const byFile = new Map<string, GrepMatch[]>();
    for (const match of matches) {
      const entry = byFile.get(match.filePath) ?? [];
      entry.push(match);
      byFile.set(match.filePath, entry);
    }

    const totalMatchesRaw = (data as any).totalMatches;
    const totalMatches =
      typeof totalMatchesRaw === 'number' && Number.isFinite(totalMatchesRaw)
        ? Math.max(0, Math.floor(totalMatchesRaw))
        : matches.length;

    const MAX_LINE_LENGTH = 2000;

    const lines: string[] = [];
    if (notes.length > 0) {
      lines.push(`Note: ${notes.join(' ')}`, '');
    }

    if (matches.length === 0) {
      lines.push('No matches found');
      return {
        ...result,
        metadata: {
          ...(result.metadata || {}),
          outputText: lines.join('\n').trimEnd(),
        },
      };
    }

    lines.push(`Found ${totalMatches} matches`);
    lines.push('');
    lines.push(
      'Tip: For symbol/code-intelligence tasks (definitions/references/types), prefer symbols_peek (matchId) or lsp (hover/goToDefinition/findReferences) using fileId + line/character from matches.',
    );

    for (const [filePath, fileMatches] of byFile.entries()) {
      const handle = this.getOrCreate(session, filePath);

      lines.push('');
      lines.push(`${handle.id}  ${handle.filePath}`);

      const sorted = [...fileMatches].sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

      let firstMatchId: string | undefined;
      for (const match of sorted) {
        const truncatedLine =
          match.text.length > MAX_LINE_LENGTH ? match.text.substring(0, MAX_LINE_LENGTH) + '...' : match.text;
        const character = match.column && match.column > 0 ? match.column : 1;
        const matchId = semanticHandles.createMatchHandle(handle.id, match.line, character, truncatedLine).matchId;
        if (!firstMatchId) firstMatchId = matchId;
        const pos = match.column ? `Line ${match.line}, Character ${match.column}` : `Line ${match.line}`;
        lines.push(`  ${matchId}  ${pos}: ${truncatedLine}`);
      }

      const first = sorted[0];
      if (first) {
        const character = first.column && first.column > 0 ? first.column : 1;
        lines.push(
          `  Next: symbols_peek { matchId: ${firstMatchId ?? '(matchId)'} } OR lsp hover/goToDefinition/findReferences at line=${first.line} character=${character} (fileId: ${handle.id})`,
        );
      } else {
        lines.push(`  LSP: documentSymbol (fileId: ${handle.id})`);
      }
    }

    if (truncated) {
      lines.push('', '(Results are truncated. Consider using a more specific path or pattern.)');
    }

    return {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        outputText: lines.join('\n').trimEnd(),
      },
    };
  }
}

