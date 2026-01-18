import * as path from 'path';

import type { ToolResult } from '../types';
import { isRecord } from '../utils/guards';

export type FileHandlesState = {
  nextId: number;
  byId: Record<string, string>;
};

export class FileHandleRegistry {
  private nextId = 1;
  private readonly byId = new Map<string, string>();
  private readonly byPath = new Map<string, string>();

  constructor(private readonly getWorkspaceRootFsPath: () => string | undefined) {}

  reset(): void {
    this.nextId = 1;
    this.byId.clear();
    this.byPath.clear();
  }

  exportState(): FileHandlesState {
    return {
      nextId: this.nextId,
      byId: Object.fromEntries(this.byId.entries()),
    };
  }

  importState(raw: unknown): void {
    this.reset();

    if (!isRecord(raw)) return;

    const nextId = (raw as any).nextId;
    const byId = (raw as any).byId;
    if (typeof nextId !== 'number' || !Number.isFinite(nextId) || nextId < 1) return;
    if (!isRecord(byId)) return;

    const entries: Array<[string, string]> = [];
    let maxNumericId = 0;
    for (const [id, filePath] of Object.entries(byId as Record<string, unknown>)) {
      if (typeof id !== 'string' || !id.trim()) continue;
      if (typeof filePath !== 'string' || !filePath.trim()) continue;
      const normalizedId = id.trim();
      if (!/^F\d+$/.test(normalizedId)) continue;

      const normalizedPath = this.normalizePath(filePath.trim());
      if (!normalizedPath) continue;

      entries.push([normalizedId, normalizedPath]);

      const match = /^F(\d+)$/.exec(normalizedId);
      if (match) {
        const numeric = Number.parseInt(match[1], 10);
        if (Number.isFinite(numeric)) {
          maxNumericId = Math.max(maxNumericId, numeric);
        }
      }
    }

    this.nextId = Math.max(Math.floor(nextId), maxNumericId + 1);
    for (const [id, filePath] of entries) {
      this.byId.set(id, filePath);
      this.byPath.set(filePath, id);
    }
  }

  resolve(fileId: string): string | undefined {
    const id = fileId.trim();
    if (!id) return undefined;
    return this.byId.get(id);
  }

  getOrCreate(filePath: string): { id: string; filePath: string } {
    const normalizedPath = this.normalizePath(filePath);
    const existing = this.byPath.get(normalizedPath);
    if (existing) return { id: existing, filePath: normalizedPath };

    const id = `F${this.nextId++}`;
    this.byId.set(id, normalizedPath);
    this.byPath.set(normalizedPath, id);
    return { id, filePath: normalizedPath };
  }

  decorateGlobResultWithFileHandles(result: ToolResult): ToolResult {
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
      lines.push('Use fileId with read/edit/write/lsp:', '');
      for (const filePath of files) {
        const handle = this.getOrCreate(filePath);
        lines.push(`${handle.id}  ${handle.filePath}`);
      }
      lines.push(
        '',
        'Tip: For symbol/code-intelligence questions (functions/classes/definitions/references), prefer lsp (documentSymbol/workspaceSymbol/goToDefinition/findReferences) over grep.'
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

  decorateGrepResultWithFileHandles(result: ToolResult): ToolResult {
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

      const column =
        typeof columnRaw === 'number' && Number.isFinite(columnRaw) ? Math.floor(columnRaw) : undefined;

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
      'Tip: For symbol/code-intelligence tasks (functions/classes/definitions/references), use lsp (documentSymbol/workspaceSymbol/goToDefinition/findReferences) with fileId + line/character from matches.'
    );

    for (const [filePath, fileMatches] of byFile.entries()) {
      const handle = this.getOrCreate(filePath);

      const sorted = [...fileMatches].sort((a, b) => {
        if (a.line !== b.line) return a.line - b.line;
        return (a.column ?? 0) - (b.column ?? 0);
      });

      lines.push('');
      lines.push(`${handle.id}  ${handle.filePath}:`);
      for (const match of sorted) {
        const truncatedLine =
          match.text.length > MAX_LINE_LENGTH ? match.text.substring(0, MAX_LINE_LENGTH) + '...' : match.text;
        const pos = match.column ? `Line ${match.line}, Character ${match.column}` : `Line ${match.line}`;
        lines.push(`  ${pos}: ${truncatedLine}`);
      }

      const first = sorted[0];
      if (first) {
        const character = first.column && first.column > 0 ? first.column : 1;
        lines.push(
          `  LSP: hover/goToDefinition/findReferences at line=${first.line} character=${character} (fileId: ${handle.id})`
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

  private normalizePath(raw: string): string {
    const value = raw.trim();
    if (!value) return '';

    const workspaceRoot = this.getWorkspaceRootFsPath();
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
}
