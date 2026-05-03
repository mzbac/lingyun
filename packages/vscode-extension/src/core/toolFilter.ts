export function normalizeToolFilterSetting(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function isToolAllowedByFilter(toolId: string, filter: readonly string[]): boolean {
  if (!filter.length) return true;
  return filter.some((pattern) => {
    if (pattern.includes('*')) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      return new RegExp(`^${escaped}$`).test(toolId);
    }
    return toolId === pattern || toolId.startsWith(`${pattern}.`);
  });
}
