import * as vscode from 'vscode';

export const LINGYUN_DIFF_SCHEME = 'lingyun-diff';

export type LingyunDiffSide = 'before' | 'after';

export function createLingyunDiffUri(params: {
  toolCallId: string;
  side: LingyunDiffSide;
  fileName: string;
}): vscode.Uri {
  const safeFileName = sanitizeFileName(params.fileName);
  const safeToolCallId = encodeURIComponent(params.toolCallId);
  return vscode.Uri.from({
    scheme: LINGYUN_DIFF_SCHEME,
    path: `/${params.side}/${safeToolCallId}/${safeFileName}`,
  });
}

export function parseLingyunDiffUri(uri: vscode.Uri): { toolCallId: string; side: LingyunDiffSide } | null {
  if (uri.scheme !== LINGYUN_DIFF_SCHEME) return null;
  const parts = uri.path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const side = parts[0] === 'before' || parts[0] === 'after' ? (parts[0] as LingyunDiffSide) : null;
  if (!side) return null;

  const toolCallId = decodeURIComponent(parts[1] || '');
  if (!toolCallId) return null;
  return { toolCallId, side };
}

export class LingyunDiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly getSnapshot: (
      toolCallId: string
    ) => { beforeText: string; afterText: string } | undefined
  ) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const parsed = parseLingyunDiffUri(uri);
    if (!parsed) return '';
    const snapshot = this.getSnapshot(parsed.toolCallId);
    if (!snapshot) return 'LingYun: diff snapshot unavailable.';
    return parsed.side === 'before' ? snapshot.beforeText : snapshot.afterText;
  }
}

function sanitizeFileName(fileName: string): string {
  const raw = typeof fileName === 'string' ? fileName.trim() : '';
  const base = raw.replace(/\\/g, '/').split('/').pop() || 'file';

  // Normalize to a filename-safe subset without relying on control-character regex ranges.
  const withoutReserved = base.replace(/[<>:"|?*]/g, '_');
  let out = '';
  for (const ch of withoutReserved) {
    out += ch.charCodeAt(0) < 0x20 ? '_' : ch;
  }
  return out;
}
