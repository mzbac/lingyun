import * as vscode from 'vscode';

export type NormalizedDiagnostic = {
  severity: 'ERROR' | 'WARN' | 'INFO' | 'HINT';
  message: string;
  line: number;
  character: number;
  source?: string;
  code?: string | number;
};

function severityLabel(sev: vscode.DiagnosticSeverity): NormalizedDiagnostic['severity'] {
  switch (sev) {
    case vscode.DiagnosticSeverity.Error:
      return 'ERROR';
    case vscode.DiagnosticSeverity.Warning:
      return 'WARN';
    case vscode.DiagnosticSeverity.Information:
      return 'INFO';
    case vscode.DiagnosticSeverity.Hint:
      return 'HINT';
    default:
      return 'INFO';
  }
}

export function normalizeDiagnostics(diags: readonly vscode.Diagnostic[]): NormalizedDiagnostic[] {
  return diags.map((d) => ({
    severity: severityLabel(d.severity),
    message: d.message,
    line: d.range.start.line + 1,
    character: d.range.start.character + 1,
    source: d.source || undefined,
    code: typeof d.code === 'string' || typeof d.code === 'number' ? d.code : undefined,
  }));
}

export function formatDiagnosticsBlock(
  diags: readonly vscode.Diagnostic[],
  options?: { maxItems?: number }
): string | undefined {
  const normalized = normalizeDiagnostics(diags);
  if (normalized.length === 0) return undefined;

  const maxItems =
    typeof options?.maxItems === 'number' && options.maxItems > 0 ? Math.floor(options.maxItems) : 50;
  const sliced = normalized.slice(0, maxItems);
  const truncated = normalized.length > sliced.length;

  const counts = { ERROR: 0, WARN: 0, INFO: 0, HINT: 0 };
  for (const d of normalized) counts[d.severity] += 1;

  const header = `Diagnostics (errors: ${counts.ERROR}, warnings: ${counts.WARN}, info: ${counts.INFO}, hints: ${counts.HINT}):`;
  const lines = sliced.map((d) => {
    const suffixParts: string[] = [];
    if (d.source) suffixParts.push(d.source);
    if (d.code !== undefined) suffixParts.push(String(d.code));
    const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(':')})` : '';
    return `${d.severity} [${d.line}:${d.character}] ${d.message}${suffix}`;
  });

  if (truncated) {
    lines.push(`(Truncated; showing first ${sliced.length} of ${normalized.length})`);
  }

  return [header, ...lines].join('\n');
}

