import * as fs from 'fs';
import * as path from 'path';

type WorkspaceIdentityFile = {
  fileName: 'IDENTITY.md' | 'SOUL.md' | 'USER.md' | 'AGENTS.md';
  absPath: string;
  content: string;
  truncated: boolean;
};

function isReadableFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readUtf8FileBounded(filePath: string, options?: { maxBytes?: number }): { content: string; truncated: boolean } {
  const maxBytes = typeof options?.maxBytes === 'number' && options.maxBytes > 0 ? Math.floor(options.maxBytes) : 128 * 1024;

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return { content: '', truncated: false };
  }

  if (size <= maxBytes) {
    try {
      return { content: fs.readFileSync(filePath, 'utf8'), truncated: false };
    } catch {
      return { content: '', truncated: false };
    }
  }

  // Avoid reading extremely large files into memory; read a prefix only.
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    return { content: buf.subarray(0, n).toString('utf8'), truncated: true };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

export function loadWorkspaceIdentityFiles(workspaceRoot: string, options?: { maxBytesPerFile?: number }): WorkspaceIdentityFile[] {
  const files: Array<WorkspaceIdentityFile['fileName']> = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'AGENTS.md'];
  const out: WorkspaceIdentityFile[] = [];

  for (const fileName of files) {
    const absPath = path.join(workspaceRoot, fileName);
    if (!isReadableFile(absPath)) continue;

    const { content, truncated } = readUtf8FileBounded(absPath, { maxBytes: options?.maxBytesPerFile });
    const trimmed = String(content || '').replace(/\r\n/g, '\n').trim();
    if (!trimmed) continue;

    out.push({ fileName, absPath, content: trimmed, truncated });
  }

  return out;
}

export function renderWorkspaceIdentitySystemParts(workspaceRoot: string, options?: { maxBytesPerFile?: number }): string[] {
  const files = loadWorkspaceIdentityFiles(workspaceRoot, options);
  const parts: string[] = [];

  for (const f of files) {
    const suffix = f.truncated ? '\n\n[Truncated: file is large; only a prefix was loaded]' : '';
    parts.push(`# ${f.fileName}\n\n${f.content}${suffix}`.trimEnd());
  }

  return parts;
}

