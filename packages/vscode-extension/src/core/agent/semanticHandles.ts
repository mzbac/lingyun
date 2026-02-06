import type { ToolResult } from '../types';
import { isRecord } from '../utils/guards';
import type { FileHandleRegistry } from './fileHandles';

export type OneBasedPos = { line: number; character: number };
export type OneBasedRange = { start: OneBasedPos; end: OneBasedPos };

export type MatchHandle = {
  matchId: string;
  fileId: string;
  range: OneBasedRange;
  preview: string;
};

export type SymbolHandle = {
  symbolId: string;
  name: string;
  kind: string;
  fileId: string;
  range: OneBasedRange;
  containerName?: string;
};

export type LocationHandle = {
  locId: string;
  fileId: string;
  range: OneBasedRange;
  label?: string;
};

export type SemanticHandlesState = {
  nextMatchId: number;
  nextSymbolId: number;
  nextLocId: number;
  matches: Record<string, Omit<MatchHandle, 'matchId'>>;
  symbols: Record<string, Omit<SymbolHandle, 'symbolId'>>;
  locations: Record<string, Omit<LocationHandle, 'locId'>>;
};

const MAX_MATCH_HANDLES = 500;
const MAX_SYMBOL_HANDLES = 500;
const MAX_LOCATION_HANDLES = 500;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function clampOneBasedInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function parseRange(raw: unknown): OneBasedRange | null {
  const rawRecord = asRecord(raw);
  if (!rawRecord) return null;
  const start = asRecord(rawRecord.start);
  const end = asRecord(rawRecord.end);
  if (!start || !end) return null;
  const startLine = clampOneBasedInt(start.line, 1);
  const startChar = clampOneBasedInt(start.character, 1);
  const endLine = clampOneBasedInt(end.line, startLine);
  const endChar = clampOneBasedInt(end.character, startChar);
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

function trimHandleMap<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const first = map.keys().next().value as string | undefined;
    if (!first) break;
    map.delete(first);
  }
}

export class SemanticHandleRegistry {
  private nextMatchId = 1;
  private nextSymbolId = 1;
  private nextLocId = 1;

  private readonly matches = new Map<string, Omit<MatchHandle, 'matchId'>>();
  private readonly symbols = new Map<string, Omit<SymbolHandle, 'symbolId'>>();
  private readonly locations = new Map<string, Omit<LocationHandle, 'locId'>>();

  reset(): void {
    this.nextMatchId = 1;
    this.nextSymbolId = 1;
    this.nextLocId = 1;
    this.matches.clear();
    this.symbols.clear();
    this.locations.clear();
  }

  exportState(): SemanticHandlesState {
    return {
      nextMatchId: this.nextMatchId,
      nextSymbolId: this.nextSymbolId,
      nextLocId: this.nextLocId,
      matches: Object.fromEntries(this.matches.entries()),
      symbols: Object.fromEntries(this.symbols.entries()),
      locations: Object.fromEntries(this.locations.entries()),
    };
  }

  importState(raw: unknown): void {
    this.reset();
    const rawRecord = asRecord(raw);
    if (!rawRecord) return;

    const nextMatchId = rawRecord.nextMatchId;
    const nextSymbolId = rawRecord.nextSymbolId;
    const nextLocId = rawRecord.nextLocId;
    if (typeof nextMatchId === 'number' && Number.isFinite(nextMatchId) && nextMatchId >= 1) {
      this.nextMatchId = Math.floor(nextMatchId);
    }
    if (typeof nextSymbolId === 'number' && Number.isFinite(nextSymbolId) && nextSymbolId >= 1) {
      this.nextSymbolId = Math.floor(nextSymbolId);
    }
    if (typeof nextLocId === 'number' && Number.isFinite(nextLocId) && nextLocId >= 1) {
      this.nextLocId = Math.floor(nextLocId);
    }

    const matchesRaw = asRecord(rawRecord.matches);
    if (matchesRaw) {
      for (const [id, value] of Object.entries(matchesRaw)) {
        if (typeof id !== 'string' || !/^M\\d+$/.test(id)) continue;
        const valueRecord = asRecord(value);
        if (!valueRecord) continue;
        const fileId = asTrimmedString(valueRecord.fileId);
        if (!/^F\\d+$/.test(fileId)) continue;
        const range = parseRange(valueRecord.range);
        if (!range) continue;
        const preview = asString(valueRecord.preview) ?? '';
        this.matches.set(id, { fileId, range, preview });
      }
    }

    const symbolsRaw = asRecord(rawRecord.symbols);
    if (symbolsRaw) {
      for (const [id, value] of Object.entries(symbolsRaw)) {
        if (typeof id !== 'string' || !/^S\\d+$/.test(id)) continue;
        const valueRecord = asRecord(value);
        if (!valueRecord) continue;
        const fileId = asTrimmedString(valueRecord.fileId);
        if (!/^F\\d+$/.test(fileId)) continue;
        const range = parseRange(valueRecord.range);
        if (!range) continue;
        const name = asString(valueRecord.name) ?? '';
        if (!name.trim()) continue;
        const kind = asString(valueRecord.kind) ?? '';
        const containerNameValue = asTrimmedString(valueRecord.containerName);
        const containerName = containerNameValue ? containerNameValue : undefined;
        this.symbols.set(id, { name, kind, fileId, range, ...(containerName ? { containerName } : {}) });
      }
    }

    const locationsRaw = asRecord(rawRecord.locations);
    if (locationsRaw) {
      for (const [id, value] of Object.entries(locationsRaw)) {
        if (typeof id !== 'string' || !/^L\\d+$/.test(id)) continue;
        const valueRecord = asRecord(value);
        if (!valueRecord) continue;
        const fileId = asTrimmedString(valueRecord.fileId);
        if (!/^F\\d+$/.test(fileId)) continue;
        const range = parseRange(valueRecord.range);
        if (!range) continue;
        const labelValue = asTrimmedString(valueRecord.label);
        const label = labelValue ? labelValue : undefined;
        this.locations.set(id, { fileId, range, ...(label ? { label } : {}) });
      }
    }

    trimHandleMap(this.matches, MAX_MATCH_HANDLES);
    trimHandleMap(this.symbols, MAX_SYMBOL_HANDLES);
    trimHandleMap(this.locations, MAX_LOCATION_HANDLES);
  }

  createMatchHandle(fileId: string, line: number, character: number, preview: string): MatchHandle {
    const id = `M${this.nextMatchId++}`;
    const startLine = Math.max(1, Math.floor(line));
    const startChar = Math.max(1, Math.floor(character));
    const range: OneBasedRange = {
      start: { line: startLine, character: startChar },
      end: { line: startLine, character: startChar + 1 },
    };
    const value = { fileId, range, preview };
    this.matches.set(id, value);
    trimHandleMap(this.matches, MAX_MATCH_HANDLES);
    return { matchId: id, ...value };
  }

  createSymbolHandle(params: Omit<SymbolHandle, 'symbolId'>): SymbolHandle {
    const id = `S${this.nextSymbolId++}`;
    this.symbols.set(id, params);
    trimHandleMap(this.symbols, MAX_SYMBOL_HANDLES);
    return { symbolId: id, ...params };
  }

  createLocationHandle(params: Omit<LocationHandle, 'locId'>): LocationHandle {
    const id = `L${this.nextLocId++}`;
    this.locations.set(id, params);
    trimHandleMap(this.locations, MAX_LOCATION_HANDLES);
    return { locId: id, ...params };
  }

  resolveMatch(matchId: string): MatchHandle | undefined {
    const id = matchId.trim();
    const value = this.matches.get(id);
    if (!value) return undefined;
    return { matchId: id, ...value };
  }

  resolveSymbol(symbolId: string): SymbolHandle | undefined {
    const id = symbolId.trim();
    const value = this.symbols.get(id);
    if (!value) return undefined;
    return { symbolId: id, ...value };
  }

  resolveLocation(locId: string): LocationHandle | undefined {
    const id = locId.trim();
    const value = this.locations.get(id);
    if (!value) return undefined;
    return { locId: id, ...value };
  }

  decorateSymbolsSearchResult(result: ToolResult, fileHandles: FileHandleRegistry): ToolResult {
    if (!result.success) return result;
    const data = asRecord(result.data);
    if (!data) return result;

    const query = asString(data.query) ?? '';
    const resultsRaw = data.results;
    if (!Array.isArray(resultsRaw)) return result;

    const note = asTrimmedString(data.note);
    const truncated = Boolean(data.truncated);
    const skippedOutsideWorkspace =
      typeof data.skippedOutsideWorkspace === 'number' && Number.isFinite(data.skippedOutsideWorkspace)
        ? Math.max(0, Math.floor(data.skippedOutsideWorkspace))
        : 0;

    const lines: string[] = [];
    lines.push(`Query: ${query}`);
    if (note) lines.push(`Note: ${note}`);
    if (skippedOutsideWorkspace > 0) {
      lines.push(`Skipped outside workspace: ${skippedOutsideWorkspace}`);
    }
    lines.push('');

    if (resultsRaw.length === 0) {
      lines.push('No symbols found');
      return { ...result, metadata: { ...(result.metadata || {}), outputText: lines.join('\n').trimEnd() } };
    }

    lines.push('Use symbolId with symbols_peek:', '');

    let count = 0;
    for (const item of resultsRaw) {
      const itemRecord = asRecord(item);
      if (!itemRecord) continue;
      const name = asString(itemRecord.name) ?? '';
      const kind = asString(itemRecord.kind) ?? '';
      const containerNameValue = asTrimmedString(itemRecord.containerName);
      const containerName = containerNameValue ? containerNameValue : undefined;
      const loc = asRecord(itemRecord.location);
      if (!name.trim() || !loc) continue;
      const filePath = asString(loc.filePath) ?? '';
      if (!filePath.trim()) continue;
      const range = loc.range;
      const parsedRange = parseRange(range);
      if (!parsedRange) continue;

      const file = fileHandles.getOrCreate(filePath);
      const symbol = this.createSymbolHandle({
        name,
        kind,
        fileId: file.id,
        range: parsedRange,
        ...(containerName ? { containerName } : {}),
      });

      const at = `${parsedRange.start.line}:${parsedRange.start.character}`;
      const containerPart = containerName ? ` (${containerName})` : '';
      lines.push(`${symbol.symbolId}  ${name}${containerPart}  kind=${kind}  ${file.id}  ${file.filePath}  @ ${at}`);
      count += 1;
      if (count >= MAX_SYMBOL_HANDLES) break;
    }

    if (truncated) {
      lines.push('', '(Results are truncated. Try a more specific query.)');
    }

    return {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        outputText: lines.join('\n').trimEnd(),
      },
    };
  }

  decorateSymbolsPeekResult(result: ToolResult, fileHandles: FileHandleRegistry): ToolResult {
    if (!result.success) return result;
    const data = asRecord(result.data);
    if (!data) return result;

    const filePath = asTrimmedString(data.filePath);
    const position = asRecord(data.position);
    const line = position ? clampOneBasedInt(position.line, 1) : undefined;
    const character = position ? clampOneBasedInt(position.character, 1) : undefined;

    const file = filePath ? fileHandles.getOrCreate(filePath) : undefined;

    const linesOut: string[] = [];
    if (file && line) {
      linesOut.push(`Target: ${file.id}  ${file.filePath} @ ${line}:${character ?? 1}`);
    } else if (file) {
      linesOut.push(`Target: ${file.id}  ${file.filePath}`);
    } else if (filePath) {
      linesOut.push(`Target: ${filePath}`);
    }

    const hover = asTrimmedString(data.hover);
    if (hover) {
      linesOut.push('', 'Hover:', hover);
    }

    const defsRaw = Array.isArray(data.definition) ? data.definition : [];
    const skippedDefsOutsideWorkspace =
      typeof data.skippedDefsOutsideWorkspace === 'number' && Number.isFinite(data.skippedDefsOutsideWorkspace)
        ? Math.max(0, Math.floor(data.skippedDefsOutsideWorkspace))
        : 0;

    if (defsRaw.length > 0 || skippedDefsOutsideWorkspace > 0) {
      linesOut.push('', 'Definition:');
      for (const entry of defsRaw) {
        const entryRecord = asRecord(entry);
        if (!entryRecord) continue;
        const defPath = asString(entryRecord.filePath) ?? '';
        const range = parseRange(entryRecord.range);
        if (!defPath.trim() || !range) continue;
        const defFile = fileHandles.getOrCreate(defPath);
        const loc = this.createLocationHandle({
          fileId: defFile.id,
          range,
          label: 'definition',
        });
        linesOut.push(
          `${loc.locId}  ${defFile.id}  ${defFile.filePath}  @ ${range.start.line}:${range.start.character}`
        );
      }
      if (skippedDefsOutsideWorkspace > 0) {
        linesOut.push(`(Skipped outside workspace: ${skippedDefsOutsideWorkspace})`);
      }
    }

    const refsRaw = Array.isArray(data.refsSample) ? data.refsSample : [];
    const skippedRefsOutsideWorkspace =
      typeof data.skippedRefsOutsideWorkspace === 'number' && Number.isFinite(data.skippedRefsOutsideWorkspace)
        ? Math.max(0, Math.floor(data.skippedRefsOutsideWorkspace))
        : 0;

    if (refsRaw.length > 0 || skippedRefsOutsideWorkspace > 0) {
      linesOut.push('', 'References (sample):');
      for (const entry of refsRaw) {
        const entryRecord = asRecord(entry);
        if (!entryRecord) continue;
        const refPath = asString(entryRecord.filePath) ?? '';
        const range = parseRange(entryRecord.range);
        if (!refPath.trim() || !range) continue;
        const refFile = fileHandles.getOrCreate(refPath);
        const loc = this.createLocationHandle({
          fileId: refFile.id,
          range,
          label: 'reference',
        });
        linesOut.push(
          `${loc.locId}  ${refFile.id}  ${refFile.filePath}  @ ${range.start.line}:${range.start.character}`
        );
      }
      if (skippedRefsOutsideWorkspace > 0) {
        linesOut.push(`(Skipped outside workspace: ${skippedRefsOutsideWorkspace})`);
      }
    }

    const snippetRaw = asRecord(data.snippet);
    if (snippetRaw && typeof snippetRaw.text === 'string') {
      linesOut.push('', `Snippet (${String(snippetRaw.startLine)}-${String(snippetRaw.endLine)}):`);
      linesOut.push(String(snippetRaw.text).trimEnd());
    }

    return {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        outputText: linesOut.join('\n').trimEnd(),
      },
    };
  }
}
