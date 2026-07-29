const LONG_RUNNING_SERVER_COMMAND_PATTERNS: readonly RegExp[] = [
  /\bnpx\s+serve\b/,
  /\bnpx\s+http-server\b/,
  /\bhttp-server\b/,
  /\bpython(?:3)?\s+-m\s+http\.server\b/,
  /\bpython(?:3)?\s+-m\s+simplehttpserver\b/,
  /\bflask\s+run\b/,
  /\buvicorn\b/,
  /\bdjango-admin\s+runserver\b/,
  /\bmanage\.py\s+runserver\b/,
  /\bnpm\s+run\s+(dev|start|serve)\b/,
  /\bpnpm\s+(dev|start)\b/,
  /\byarn\s+(dev|start)\b/,
  /\bbun\s+(dev|start)\b/,
  /\bvite\b/,
  /\bnext\s+dev\b/,
  /\breact-scripts\s+start\b/,
];

const GIT_PUSH_OPTIONS_WITH_VALUE = new Set(['-c', '--config-env', '-C', '--git-dir', '--work-tree']);

function normalizeCommandForHeuristics(command: string): string {
  const collapsed = command.trim().toLowerCase().replace(/\s+/g, ' ');
  // Drop leading env assignments: `FOO=bar BAR=baz <cmd>`
  return collapsed.replace(/^(?:[a-z_][a-z0-9_]*=\S+\s+)+/gi, '');
}

export function looksLikeLongRunningServerCommand(command: string): boolean {
  const normalized = normalizeCommandForHeuristics(command);
  return LONG_RUNNING_SERVER_COMMAND_PATTERNS.some((re) => re.test(normalized));
}

function sanitizeGitToken(token: string): string {
  return token.replace(/^[^a-z0-9_-]+/gi, '').replace(/[^a-z0-9_-]+$/gi, '');
}

function nextTokenEnd(text: string, start: number): number {
  const nextSpace = text.indexOf(' ', start);
  return nextSpace === -1 ? text.length : nextSpace;
}

function nextTokenStart(text: string, tokenEnd: number): number {
  return tokenEnd < text.length ? tokenEnd + 1 : tokenEnd;
}

function segmentInvokesGitPush(segment: string): boolean {
  const normalized = normalizeCommandForHeuristics(segment);
  if (!normalized) return false;

  const firstEnd = nextTokenEnd(normalized, 0);
  const first = sanitizeGitToken(normalized.slice(0, firstEnd));
  if (first !== 'git') return false;

  let index = nextTokenStart(normalized, firstEnd);
  while (index < normalized.length) {
    const tokenEnd = nextTokenEnd(normalized, index);
    const token = normalized.slice(index, tokenEnd);

    if (token === '--') {
      const nextStart = nextTokenStart(normalized, tokenEnd);
      if (nextStart >= normalized.length) return false;
      const nextEnd = nextTokenEnd(normalized, nextStart);
      return sanitizeGitToken(normalized.slice(nextStart, nextEnd)) === 'push';
    }

    if (token.startsWith('-')) {
      if (GIT_PUSH_OPTIONS_WITH_VALUE.has(token)) {
        const valueStart = nextTokenStart(normalized, tokenEnd);
        const valueEnd = nextTokenEnd(normalized, valueStart);
        index = nextTokenStart(normalized, valueEnd);
      } else {
        index = nextTokenStart(normalized, tokenEnd);
      }
      continue;
    }

    return sanitizeGitToken(token) === 'push';
  }

  return false;
}

function shellSegmentSeparatorLength(command: string, index: number): number {
  const char = command.charCodeAt(index);
  if (char === 59 || char === 10 || char === 13) return 1;
  if (char === 38) return command.charCodeAt(index + 1) === 38 ? 2 : 0;
  if (char === 124) return command.charCodeAt(index + 1) === 124 ? 2 : 1;
  return 0;
}

export function looksLikeGitPushCommand(command: string): boolean {
  // Scan common shell control operators to avoid false positives like: `echo git push`
  // This is intentionally conservative; it primarily targets direct `git push` invocations.
  let segmentStart = 0;
  for (let i = 0; i < command.length; i++) {
    const separatorLength = shellSegmentSeparatorLength(command, i);
    if (separatorLength === 0) continue;

    if (segmentInvokesGitPush(command.slice(segmentStart, i))) return true;
    i += separatorLength - 1;
    segmentStart = i + 1;
  }

  return segmentInvokesGitPush(command.slice(segmentStart));
}

export function computeStopHint(pid?: number): string | undefined {
  if (typeof pid !== 'number') return undefined;
  return process.platform === 'win32'
    ? `taskkill /pid ${pid} /T /F`
    : `kill -TERM -${pid}`;
}
