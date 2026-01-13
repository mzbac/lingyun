const DEFAULT_TITLE_PREFIX = 'New session - ';

export function createDefaultSessionTitle(now: Date = new Date()): string {
  return `${DEFAULT_TITLE_PREFIX}${now.toISOString()}`;
}

export function isDefaultSessionTitle(title: string): boolean {
  const value = (title || '').trim();
  if (!value) return true;

  // Legacy numbered titles are treated as auto-generated.
  if (/^Session\s+\d+$/i.test(value) || value === 'Session') return true;

  return new RegExp(
    `^${escapeForRegex(DEFAULT_TITLE_PREFIX)}\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(value);
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

