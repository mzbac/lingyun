type CompiledToolFilterPattern =
  | { kind: 'literal'; pattern: string }
  | { kind: 'wildcard'; regex: RegExp };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeToolFilterSetting(raw: unknown, maxItems = 100): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  const append = (value: unknown): boolean => {
    const normalizedValue = typeof value === 'string' ? value.trim() : String(value).trim();
    if (!normalizedValue || seen.has(normalizedValue)) return normalized.length < maxItems;
    seen.add(normalizedValue);
    normalized.push(normalizedValue);
    return normalized.length < maxItems;
  };

  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (!append(value)) break;
    }
    return normalized;
  }

  if (typeof raw !== 'string') return normalized;

  let itemStart = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (i < raw.length) {
      const charCode = raw.charCodeAt(i);
      if (charCode !== 10 && charCode !== 44) continue;
    }
    if (!append(raw.slice(itemStart, i))) break;
    itemStart = i + 1;
  }

  return normalized;
}

function compileToolFilter(filter: readonly string[] | undefined): CompiledToolFilterPattern[] {
  if (!filter?.length) return [];

  const compiled: CompiledToolFilterPattern[] = [];
  const seen = new Set<string>();
  for (const rawPattern of filter) {
    const pattern = String(rawPattern).trim();
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);

    if (pattern.includes('*')) {
      compiled.push({
        kind: 'wildcard',
        regex: new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, '.*')}$`),
      });
      continue;
    }

    compiled.push({ kind: 'literal', pattern });
  }

  return compiled;
}

function isToolAllowedByCompiledFilter(toolId: string, filter: readonly CompiledToolFilterPattern[]): boolean {
  if (!filter.length) return true;

  for (const pattern of filter) {
    if (pattern.kind === 'wildcard') {
      if (pattern.regex.test(toolId)) return true;
      continue;
    }

    if (toolId === pattern.pattern || toolId.startsWith(`${pattern.pattern}.`)) {
      return true;
    }
  }

  return false;
}

export function createToolFilterMatcher(filter: readonly string[] | undefined): (toolId: string) => boolean {
  const compiled = compileToolFilter(filter);
  return (toolId: string) => isToolAllowedByCompiledFilter(toolId, compiled);
}

export function isToolAllowedByFilter(toolId: string, filter: readonly string[]): boolean {
  return createToolFilterMatcher(filter)(toolId);
}
