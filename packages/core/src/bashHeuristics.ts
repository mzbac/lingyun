function normalizeCommandForHeuristics(command: string): string {
  const collapsed = command.trim().toLowerCase().replace(/\s+/g, ' ');
  // Drop leading env assignments: `FOO=bar BAR=baz <cmd>`
  return collapsed.replace(/^(?:[a-z_][a-z0-9_]*=\S+\s+)+/gi, '');
}

export function looksLikeLongRunningServerCommand(command: string): boolean {
  const normalized = normalizeCommandForHeuristics(command);

  // Keep this conservative: only match common long-running dev servers.
  const patterns: readonly RegExp[] = [
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

  return patterns.some((re) => re.test(normalized));
}

function sanitizeGitToken(token: string): string {
  return token.replace(/^[^a-z0-9_-]+/gi, '').replace(/[^a-z0-9_-]+$/gi, '');
}

function segmentInvokesGitPush(segment: string): boolean {
  const normalized = normalizeCommandForHeuristics(segment);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  const first = sanitizeGitToken(tokens[0]);
  if (first !== 'git') return false;

  const optionsWithValue = new Set(['-c', '--config-env', '-C', '--git-dir', '--work-tree']);
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '--') {
      const next = tokens[i + 1];
      return sanitizeGitToken(next ?? '') === 'push';
    }

    if (token.startsWith('-')) {
      if (optionsWithValue.has(token)) {
        i += 1;
      }
      continue;
    }

    return sanitizeGitToken(token) === 'push';
  }

  return false;
}

export function looksLikeGitPushCommand(command: string): boolean {
  // Split on common shell control operators to avoid false positives like: `echo git push`
  // This is intentionally conservative; it primarily targets direct `git push` invocations.
  const segments = command.split(/(?:\|\||&&|;|\|(?!\|)|\n|\r)/);
  return segments.some((segment) => segmentInvokesGitPush(segment));
}

export function computeStopHint(pid?: number): string | undefined {
  if (typeof pid !== 'number') return undefined;
  return process.platform === 'win32'
    ? `taskkill /pid ${pid} /T /F`
    : `kill -TERM -${pid}`;
}
