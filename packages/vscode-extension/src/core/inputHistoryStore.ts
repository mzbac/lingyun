import * as vscode from 'vscode';

export const INPUT_HISTORY_VERSION = 1;
export const DEFAULT_INPUT_HISTORY_MAX_ENTRIES = 100;
export const DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS = 10_000;

export type InputHistoryFile = {
  version: typeof INPUT_HISTORY_VERSION;
  updatedAt: number;
  entries: string[];
};

export type InputHistoryStoreOptions = {
  maxEntries?: number;
  maxEntryChars?: number;
  log?: (message: string) => void;
};

export function addInputHistoryEntry(
  entries: string[],
  text: string,
  options?: { maxEntries?: number; maxEntryChars?: number }
): string[] {
  const maxEntries =
    options?.maxEntries && Number.isFinite(options.maxEntries)
      ? Math.max(1, Math.floor(options.maxEntries))
      : DEFAULT_INPUT_HISTORY_MAX_ENTRIES;
  const maxEntryChars =
    options?.maxEntryChars && Number.isFinite(options.maxEntryChars)
      ? Math.max(1, Math.floor(options.maxEntryChars))
      : DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS;

  const trimmed = (text || '').trim();
  if (!trimmed) return entries;

  const nextEntry = trimmed.length > maxEntryChars ? trimmed.slice(0, maxEntryChars) : trimmed;
  const last = entries[0];
  if (last === nextEntry) return entries;

  const next = [nextEntry, ...entries];
  if (next.length > maxEntries) next.length = maxEntries;
  return next;
}

function normalizeEntries(
  raw: unknown,
  options?: { maxEntries?: number; maxEntryChars?: number }
): string[] {
  if (!Array.isArray(raw)) return [];

  const maxEntries =
    options?.maxEntries && Number.isFinite(options.maxEntries)
      ? Math.max(1, Math.floor(options.maxEntries))
      : DEFAULT_INPUT_HISTORY_MAX_ENTRIES;
  const maxEntryChars =
    options?.maxEntryChars && Number.isFinite(options.maxEntryChars)
      ? Math.max(1, Math.floor(options.maxEntryChars))
      : DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS;

  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const normalized = trimmed.length > maxEntryChars ? trimmed.slice(0, maxEntryChars) : trimmed;
    out.push(normalized);
    if (out.length >= maxEntries) break;
  }

  return out;
}

export class InputHistoryStore {
  private readonly sessionsDir: vscode.Uri;
  private readonly historyUri: vscode.Uri;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder('utf-8');

  constructor(
    private readonly baseUri: vscode.Uri,
    private readonly options: InputHistoryStoreOptions = {}
  ) {
    this.sessionsDir = vscode.Uri.joinPath(baseUri, 'sessions');
    this.historyUri = vscode.Uri.joinPath(this.sessionsDir, 'input-history.json');
  }

  async load(): Promise<InputHistoryFile | undefined> {
    const raw = await this.tryReadJson<InputHistoryFile>(this.historyUri);
    if (!raw || raw.version !== INPUT_HISTORY_VERSION) return undefined;

    return {
      version: INPUT_HISTORY_VERSION,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      entries: normalizeEntries(raw.entries, this.options),
    };
  }

  async save(entries: string[]): Promise<void> {
    const normalized = normalizeEntries(entries, this.options);
    const next: InputHistoryFile = {
      version: INPUT_HISTORY_VERSION,
      updatedAt: Date.now(),
      entries: normalized,
    };

    await this.enqueueWrite(async () => {
      await vscode.workspace.fs.createDirectory(this.sessionsDir);
      await this.writeJsonAtomic(this.historyUri, next);
    });
  }

  private async enqueueWrite(fn: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(fn).catch(err => {
      this.options.log?.(
        `InputHistoryStore write failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
    return this.writeChain;
  }

  private async tryReadJson<T>(uri: vscode.Uri): Promise<T | undefined> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = this.decoder.decode(raw);
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  private async writeJsonAtomic(uri: vscode.Uri, value: unknown): Promise<void> {
    const json = JSON.stringify(value, null, 2);
    const bytes = this.encoder.encode(json);

    const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1) || 'data.json';
    const tmpUri = vscode.Uri.joinPath(this.sessionsDir, `${fileName}.tmp-${crypto.randomUUID()}`);

    await vscode.workspace.fs.writeFile(tmpUri, bytes);
    await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
  }
}

