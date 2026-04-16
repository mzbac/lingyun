export function buildShellOutputText(summary: string, output?: string): string {
  const trimmedSummary = typeof summary === 'string' ? summary.trim() : '';
  const trimmedOutput = typeof output === 'string' ? output.trimEnd() : '';

  if (!trimmedOutput) {
    return trimmedSummary;
  }

  if (!trimmedSummary) {
    return trimmedOutput;
  }

  return `${trimmedSummary}\n\nOutput:\n${trimmedOutput}`;
}

export function formatBackgroundTtl(ttlMs: number): string {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 'disabled';

  if (ttlMs % (60 * 60 * 1000) === 0) {
    const hours = ttlMs / (60 * 60 * 1000);
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }

  if (ttlMs % (60 * 1000) === 0) {
    const minutes = ttlMs / (60 * 1000);
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }

  if (ttlMs % 1000 === 0) {
    const seconds = ttlMs / 1000;
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }

  return `${ttlMs} ms`;
}

export function buildAutoStopMessage(ttlMs: number): string {
  return ttlMs > 0
    ? `Auto-stop: after ${formatBackgroundTtl(ttlMs)} (set ttlMs: 0 to disable).`
    : 'Auto-stop: disabled (ttlMs: 0).';
}
