import { createTwoFilesPatch } from 'diff';

export type DiffStats = { additions: number; deletions: number };

export type ToolDiffLineView = {
  kind: 'ctx' | 'add' | 'del' | 'meta';
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type ToolDiffHunkView = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: ToolDiffLineView[];
};

export type ToolDiffFileView = {
  filePath: string;
  hunks: ToolDiffHunkView[];
};

export type ToolDiffView = {
  files: ToolDiffFileView[];
};

export function createUnifiedDiff(params: {
  filePath: string;
  beforeText: string;
  afterText: string;
  context?: number;
}): string {
  const filePath = params.filePath || 'file';
  const beforeText = params.beforeText ?? '';
  const afterText = params.afterText ?? '';
  const context = typeof params.context === 'number' && params.context >= 0 ? params.context : 3;

  return createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, beforeText, afterText, '', '', {
    context,
  });
}

export function computeUnifiedDiffStats(diffText: string): DiffStats {
  const diff = typeof diffText === 'string' ? diffText : '';
  let additions = 0;
  let deletions = 0;

  forEachUnifiedDiffLine(diff, line => {
    if (!line) return;
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('@@') ||
      line.startsWith('diff ') ||
      line.startsWith('Index:') ||
      line.startsWith('===================================================================')
    ) {
      return;
    }
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  });

  return { additions, deletions };
}

export function trimUnifiedDiff(
  diffText: string,
  options?: { maxChars?: number; maxLines?: number }
): { text: string; truncated: boolean } {
  const raw = typeof diffText === 'string' ? diffText : '';
  const maxChars = options?.maxChars ?? 20_000;
  const maxLines = options?.maxLines ?? 400;

  if (raw.length <= maxChars) {
    if (!hasMoreUnifiedDiffLinesThan(raw, maxLines)) return { text: raw, truncated: false };
  }

  let text = collectUnifiedDiffPrefix(raw, maxLines);
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }
  if (!text.endsWith('\n')) text += '\n';
  text += '\n... [TRUNCATED]';

  return { text, truncated: true };
}

function forEachUnifiedDiffLine(diffText: string, visit: (line: string) => void): void {
  let lineStart = 0;
  for (let i = 0; i < diffText.length; i++) {
    if (diffText.charCodeAt(i) !== 10) continue;
    const lineEnd = i > lineStart && diffText.charCodeAt(i - 1) === 13 ? i - 1 : i;
    visit(diffText.slice(lineStart, lineEnd));
    lineStart = i + 1;
  }
  visit(diffText.slice(lineStart));
}

function hasMoreUnifiedDiffLinesThan(diffText: string, maxLines: number): boolean {
  if (maxLines < 1) return true;

  let lineCount = 1;
  for (let i = 0; i < diffText.length; i++) {
    if (diffText.charCodeAt(i) !== 10) continue;
    lineCount += 1;
    if (lineCount > maxLines) return true;
  }

  return false;
}

function collectUnifiedDiffPrefix(diffText: string, maxLines: number): string {
  if (maxLines < 1) return '';

  let lineCount = 0;
  let sawCarriageReturn = false;

  for (let i = 0; i < diffText.length; i++) {
    const code = diffText.charCodeAt(i);
    if (code === 13) {
      sawCarriageReturn = true;
      continue;
    }
    if (code !== 10) continue;
    lineCount += 1;
    if (lineCount >= maxLines) {
      const end = i > 0 && diffText.charCodeAt(i - 1) === 13 ? i - 1 : i;
      const prefix = diffText.slice(0, end);
      return sawCarriageReturn ? prefix.replace(/\r\n/g, '\n') : prefix;
    }
  }

  return sawCarriageReturn ? diffText.replace(/\r\n/g, '\n') : diffText;
}

const TRUNCATED_DIFF_MARKER = '... [TRUNCATED]';

function stripTruncationMarker(diffText: string): string {
  const raw = typeof diffText === 'string' ? diffText : '';
  const index = raw.lastIndexOf(TRUNCATED_DIFF_MARKER);
  if (index < 0) return raw;
  return raw.slice(0, index).replace(/\s+$/g, '') + '\n';
}

const UNIFIED_DIFF_HUNK_HEADER_RE = /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function buildToolDiffView(diffText: string, params: { filePath: string }): ToolDiffView | undefined {
  const filePath = (params.filePath || '').trim();
  if (!filePath) return undefined;

  const cleaned = stripTruncationMarker(diffText);

  const hunks: ToolDiffHunkView[] = [];
  let current: ToolDiffHunkView | undefined;
  let oldLine = 0;
  let newLine = 0;

  const flush = () => {
    if (current && current.lines.length > 0) {
      hunks.push(current);
    }
    current = undefined;
  };

  forEachUnifiedDiffLine(cleaned, rawLine => {
    if (!rawLine) return;

    const headerMatch = UNIFIED_DIFF_HUNK_HEADER_RE.exec(rawLine);
    if (headerMatch) {
      flush();

      const oldStart = Number.parseInt(headerMatch[1], 10);
      const oldLinesCount = headerMatch[2] ? Number.parseInt(headerMatch[2], 10) : 1;
      const newStart = Number.parseInt(headerMatch[3], 10);
      const newLinesCount = headerMatch[4] ? Number.parseInt(headerMatch[4], 10) : 1;

      oldLine = Number.isFinite(oldStart) ? oldStart : 0;
      newLine = Number.isFinite(newStart) ? newStart : 0;

      current = {
        header: rawLine,
        oldStart,
        oldLines: oldLinesCount,
        newStart,
        newLines: newLinesCount,
        lines: [],
      };
      return;
    }

    if (!current) return;

    const prefix = rawLine[0];
    if (prefix === ' ') {
      current.lines.push({ kind: 'ctx', text: rawLine.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      return;
    }

    if (prefix === '-') {
      current.lines.push({ kind: 'del', text: rawLine.slice(1), oldLine });
      oldLine += 1;
      return;
    }

    if (prefix === '+') {
      current.lines.push({ kind: 'add', text: rawLine.slice(1), newLine });
      newLine += 1;
      return;
    }

    current.lines.push({ kind: 'meta', text: rawLine });
  });

  flush();

  return { files: [{ filePath, hunks }] };
}
