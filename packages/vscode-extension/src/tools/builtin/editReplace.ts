// Replacement heuristics for the edit tool, adapted to run as a pure string utility.

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;
const REGEXP_SPECIAL_CHARS_RE = /[.*+?^${}()|[\]\\]/g;
const WHITESPACE_CHAR_RE = /\s/;

function escapeRegExpLiteral(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHARS_RE, '\\$&');
}

function buildWhitespaceFlexiblePattern(value: string): string {
  const trimmed = value.trim();
  let pattern = '';
  let tokenStart = -1;
  let hasToken = false;

  for (let i = 0; i <= trimmed.length; i++) {
    if (i < trimmed.length && !WHITESPACE_CHAR_RE.test(trimmed[i])) {
      if (tokenStart < 0) tokenStart = i;
      continue;
    }
    if (tokenStart < 0) continue;

    if (hasToken) pattern += '\\s+';
    pattern += escapeRegExpLiteral(trimmed.slice(tokenStart, i));
    hasToken = true;
    tokenStart = -1;
  }

  return pattern;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '' || b === '') {
    return Math.max(a.length, b.length);
  }

  let source = a;
  let target = b;
  if (target.length > source.length) {
    source = b;
    target = a;
  }

  let previous = new Array<number>(target.length + 1);
  let current = new Array<number>(target.length + 1);
  for (let j = 0; j <= target.length; j++) {
    previous[j] = j;
  }

  for (let i = 1; i <= source.length; i++) {
    current[0] = i;
    for (let j = 1; j <= target.length; j++) {
      const cost = source.charCodeAt(i - 1) === target.charCodeAt(j - 1) ? 0 : 1;
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      const substitution = previous[j - 1] + cost;
      const best = deletion < insertion ? deletion : insertion;
      current[j] = substitution < best ? substitution : best;
    }

    const nextPrevious = current;
    current = previous;
    previous = nextPrevious;
  }
  return previous[target.length];
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

export const FileTagStrippingReplacer: Replacer = function* (_content, find) {
  const trimmed = find.trim();
  if (!trimmed.startsWith('<file>') || !trimmed.endsWith('</file>')) return;

  const withoutStart = trimmed.replace(/^<file>\s*/i, '');
  const withoutEnd = withoutStart.replace(/\s*<\/file>$/i, '');
  if (withoutEnd && withoutEnd !== find) {
    yield withoutEnd;
  }
};

export const ReadLinePrefixStrippingReplacer: Replacer = function* (_content, find) {
  // Handle accidental inclusion of the read tool's line-number prefix (e.g. "00001| ").
  let stripped = '';
  let changed = false;
  let lineStart = 0;
  for (let i = 0; i <= find.length; i++) {
    if (i < find.length && find.charCodeAt(i) !== 10) continue;
    const line = find.slice(lineStart, i);
    const nextLine = line.replace(/^\s*\d+\|\s?/, '').replace(/^\s*\d+\t/, '');
    if (nextLine !== line) changed = true;
    stripped += lineStart === 0 ? nextLine : '\n' + nextLine;
    lineStart = i + 1;
  }
  if (changed) {
    yield stripped;
  }
};

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');

  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim();
      const searchTrimmed = searchLines[j].trim();

      if (originalTrimmed !== searchTrimmed) {
        matches = false;
        break;
      }
    }

    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1;
      }

      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length;
        if (k < searchLines.length - 1) {
          matchEndIndex += 1;
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');

  if (searchLines.length < 3) {
    return;
  }

  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }

  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();
  const searchBlockSize = searchLines.length;

  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue;
    }

    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }

  if (candidates.length === 0) {
    return;
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    let matchStartIndex = 0;
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1;
    }
    let matchEndIndex = matchStartIndex;
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length;
      if (k < endLine) {
        matchEndIndex += 1;
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex);
    return;
  }

  let bestMatch: { startLine: number; endLine: number } | null = null;
  let maxSimilarity = -1;

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate;
    const actualBlockSize = endLine - startLine + 1;

    let similarity = 0;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim();
        const searchLine = searchLines[j].trim();
        const maxLen = Math.max(originalLine.length, searchLine.length);
        if (maxLen === 0) {
          continue;
        }
        const distance = levenshtein(originalLine, searchLine);
        similarity += 1 - distance / maxLen;
      }
      similarity /= linesToCheck;
    } else {
      similarity = 1.0;
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatch = candidate;
    }
  }

  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch;
    let matchStartIndex = 0;
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1;
    }
    let matchEndIndex = matchStartIndex;
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length;
      if (k < endLine) {
        matchEndIndex += 1;
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex);
  }
};

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
  const normalizedFind = normalizeWhitespace(find);
  const whitespaceFlexibleRegex = new RegExp(buildWhitespaceFlexiblePattern(find));

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalizedLine = normalizeWhitespace(line);
    if (normalizedLine === normalizedFind) {
      yield line;
    } else if (normalizedLine.includes(normalizedFind)) {
      const match = line.match(whitespaceFlexibleRegex);
      if (match) {
        yield match[0];
      }
    }
  }

  const findLines = find.split('\n');
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length);
      if (normalizeWhitespace(block.join('\n')) === normalizedFind) {
        yield block.join('\n');
      }
    }
  }
};

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split('\n');
    let minIndent = Number.POSITIVE_INFINITY;
    let hasNonEmptyLine = false;

    for (const line of lines) {
      let indent = 0;
      while (indent < line.length) {
        const charCode = line.charCodeAt(indent);
        if (charCode !== 32 && charCode !== 9) break;
        indent++;
      }
      if (indent === line.length) continue;
      hasNonEmptyLine = true;
      if (indent < minIndent) minIndent = indent;
    }
    if (!hasNonEmptyLine || minIndent <= 0) return text;

    let normalized = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let indent = 0;
      while (indent < line.length) {
        const charCode = line.charCodeAt(indent);
        if (charCode !== 32 && charCode !== 9) break;
        indent++;
      }
      const nextLine = indent === line.length ? line : line.slice(minIndent);
      normalized += i === 0 ? nextLine : '\n' + nextLine;
    }

    return normalized;
  };

  const normalizedFind = removeIndentation(find);
  const contentLines = content.split('\n');
  const findLines = find.split('\n');

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n');
    if (removeIndentation(block) === normalizedFind) {
      yield block;
    }
  }
};

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case "'":
          return "'";
        case '"':
          return '"';
        case '`':
          return '`';
        case '\\':
          return '\\';
        case '\n':
          return '\n';
        case '$':
          return '$';
        default:
          return match;
      }
    });
  };

  const unescapedFind = unescapeString(find);

  if (content.includes(unescapedFind)) {
    yield unescapedFind;
  }

  const lines = content.split('\n');
  const findLines = unescapedFind.split('\n');

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');
    const unescapedBlock = unescapeString(block);

    if (unescapedBlock === unescapedFind) {
      yield block;
    }
  }
};

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim();

  if (trimmedFind === find) {
    return;
  }

  if (content.includes(trimmedFind)) {
    yield trimmedFind;
  }

  const lines = content.split('\n');
  const findLines = find.split('\n');

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');

    if (block.trim() === trimmedFind) {
      yield block;
    }
  }
};

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split('\n');
  if (findLines.length < 3) {
    return;
  }

  if (findLines[findLines.length - 1] === '') {
    findLines.pop();
  }

  const contentLines = content.split('\n');

  const firstLine = findLines[0].trim();
  const lastLine = findLines[findLines.length - 1].trim();

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue;

    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        const blockLines = contentLines.slice(i, j + 1);
        const block = blockLines.join('\n');

        if (blockLines.length === findLines.length) {
          let matchingLines = 0;
          let totalNonEmptyLines = 0;

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim();
            const findLine = findLines[k].trim();

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++;
              if (blockLine === findLine) {
                matchingLines++;
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block;
            break;
          }
        }
        break;
      }
    }
  }
};

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let startIndex = 0;

  while (true) {
    const index = content.indexOf(find, startIndex);
    if (index === -1) break;

    yield find;
    startIndex = index + find.length;
  }
};

export function replaceInContent(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error('oldString and newString must be different');
  }

  let notFound = true;

  for (const replacer of [
    SimpleReplacer,
    FileTagStrippingReplacer,
    ReadLinePrefixStrippingReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;
      if (replaceAll) {
        return content.replaceAll(search, newString);
      }
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) continue;
      return content.substring(0, index) + newString + content.substring(index + search.length);
    }
  }

  if (notFound) {
    throw new Error('oldString not found in content');
  }
  throw new Error(
    'oldString found multiple times and requires more code context to uniquely identify the intended match. Provide a larger oldString or use replaceAll.'
  );
}
