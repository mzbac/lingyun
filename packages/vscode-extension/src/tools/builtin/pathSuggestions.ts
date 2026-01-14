import * as fs from 'fs/promises';
import * as path from 'path';

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const aLen = a.length;
  const bLen = b.length;
  const prev = new Array<number>(bLen + 1);
  const curr = new Array<number>(bLen + 1);

  for (let j = 0; j <= bLen; j++) prev[j] = j;

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    const aCh = a.charCodeAt(i - 1);
    for (let j = 1; j <= bLen; j++) {
      const cost = aCh === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= bLen; j++) prev[j] = curr[j];
  }

  return prev[bLen];
}

export async function suggestSiblingPaths(
  absPath: string,
  options?: { maxSuggestions?: number }
): Promise<string[]> {
  const maxSuggestions = options?.maxSuggestions ?? 3;
  if (maxSuggestions <= 0) return [];

  const dir = path.dirname(absPath);
  const base = path.basename(absPath);

  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const baseLower = base.toLowerCase();
  const baseNormalized = normalizeForComparison(base);
  if (!baseNormalized) return [];

  const candidates = dirEntries
    .map((entry) => {
      const entryLower = entry.toLowerCase();
      const normalized = normalizeForComparison(entry);
      const includes =
        entryLower.includes(baseLower) || baseLower.includes(entryLower);
      const distance = levenshteinDistance(baseNormalized, normalized);
      return { entry, includes, distance };
    })
    .filter((c) => c.includes || c.distance <= 2)
    .sort((a, b) => {
      if (a.includes !== b.includes) return a.includes ? -1 : 1;
      return a.distance - b.distance;
    })
    .slice(0, maxSuggestions)
    .map((c) => path.join(dir, c.entry));

  return candidates;
}

