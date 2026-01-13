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

  for (const line of diff.split(/\r?\n/)) {
    if (!line) continue;
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('@@') ||
      line.startsWith('diff ') ||
      line.startsWith('Index:') ||
      line.startsWith('===================================================================')
    ) {
      continue;
    }
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }

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
    const lines = raw.split(/\r?\n/);
    if (lines.length <= maxLines) return { text: raw, truncated: false };
  }

  const lines = raw.split(/\r?\n/).slice(0, maxLines);
  let text = lines.join('\n');
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }
  if (!text.endsWith('\n')) text += '\n';
  text += '\n... [TRUNCATED]';

  return { text, truncated: true };
}

function stripTruncationMarker(diffText: string): string {
  const raw = typeof diffText === 'string' ? diffText : '';
  const marker = '... [TRUNCATED]';
  if (!raw.includes(marker)) return raw;
  const index = raw.lastIndexOf(marker);
  if (index < 0) return raw;
  return raw.slice(0, index).replace(/\s+$/g, '') + '\n';
}

export function buildToolDiffView(diffText: string, params: { filePath: string }): ToolDiffView | undefined {
  const filePath = (params.filePath || '').trim();
  if (!filePath) return undefined;

  const cleaned = stripTruncationMarker(diffText);

  const hunks: ToolDiffHunkView[] = [];
  const lines = cleaned.split(/\r?\n/);
  let current: ToolDiffHunkView | undefined;
  let oldLine = 0;
  let newLine = 0;

  const flush = () => {
    if (current && current.lines.length > 0) {
      hunks.push(current);
    }
    current = undefined;
  };

  for (const rawLine of lines) {
    if (!rawLine) continue;

    const headerMatch = rawLine.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
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
      continue;
    }

    if (!current) continue;

    const prefix = rawLine[0];
    if (prefix === ' ') {
      current.lines.push({ kind: 'ctx', text: rawLine.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (prefix === '-') {
      current.lines.push({ kind: 'del', text: rawLine.slice(1), oldLine });
      oldLine += 1;
      continue;
    }

    if (prefix === '+') {
      current.lines.push({ kind: 'add', text: rawLine.slice(1), newLine });
      newLine += 1;
      continue;
    }

    current.lines.push({ kind: 'meta', text: rawLine });
  }

  flush();

  return { files: [{ filePath, hunks }] };
}
