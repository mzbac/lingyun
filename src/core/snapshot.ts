import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export type SnapshotPatch = {
  baseHash: string;
  files: string[]; // workspace-relative paths
};

export type SnapshotNumstat = {
  path: string; // workspace-relative
  additions: number;
  deletions: number;
};

type GitResult = { code: number; stdout: string; stderr: string };

export async function getSnapshotProjectId(worktreePath: string): Promise<string> {
  const resolved = path.resolve(worktreePath);
  try {
    const result = await spawn('git', ['rev-list', '--max-parents=0', '--all'], { cwd: resolved });
    if (result.code === 0) {
      const roots = (result.stdout || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .sort();
      if (roots.length > 0) {
        return roots[0];
      }
    }
  } catch {
    // Ignore and fall back to hashing the worktree path.
  }

  return crypto.createHash('sha256').update(resolved, 'utf8').digest('hex').slice(0, 40);
}

export class WorkspaceSnapshot {
  private readonly worktree: string;
  private readonly gitDir: string;
  private initialized = false;

  constructor(params: { worktree: string; storageDir: string }) {
    this.worktree = params.worktree;
    this.gitDir = path.join(params.storageDir, 'git');
  }

  async track(): Promise<string> {
    await this.ensureInitialized();
    await this.stageWorktree();
    const result = await this.git(['write-tree']);
    const hash = result.stdout.trim();
    if (!hash) throw new Error('Failed to create snapshot (empty hash)');
    return hash;
  }

  async patch(baseHash: string): Promise<SnapshotPatch> {
    await this.ensureInitialized();
    await this.stageWorktree();

    const result = await this.git([
      '-c',
      'core.autocrlf=false',
      'diff',
      '--no-ext-diff',
      '--name-only',
      baseHash,
      '--',
      '.',
    ], { allowFailure: true });

    if (result.code !== 0) {
      return { baseHash, files: [] };
    }

    const files = result.stdout
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(p => p.replace(/\\/g, '/'));

    return { baseHash, files };
  }

  async numstat(baseHash: string): Promise<SnapshotNumstat[]> {
    await this.ensureInitialized();
    await this.stageWorktree();

    const result = await this.git([
      '-c',
      'core.autocrlf=false',
      'diff',
      '--no-ext-diff',
      '--no-renames',
      '--numstat',
      baseHash,
      '--',
      '.',
    ], { allowFailure: true });

    if (result.code !== 0) return [];

    const rows: SnapshotNumstat[] = [];
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length < 3) continue;
      const [addStr, delStr, filePath] = parts;
      const additions = addStr === '-' ? 0 : Number(addStr);
      const deletions = delStr === '-' ? 0 : Number(delStr);
      rows.push({
        path: (filePath || '').replace(/\\/g, '/'),
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      });
    }

    return rows;
  }

  async diff(baseHash: string): Promise<string> {
    await this.ensureInitialized();
    await this.stageWorktree();

    const result = await this.git([
      '-c',
      'core.autocrlf=false',
      'diff',
      '--no-ext-diff',
      baseHash,
      '--',
      '.',
    ], { allowFailure: true });

    if (result.code !== 0) return '';
    return result.stdout || '';
  }

  async restore(snapshotHash: string): Promise<void> {
    await this.ensureInitialized();
    await this.git(['read-tree', snapshotHash], { allowFailure: false });
    await this.git(['checkout-index', '-a', '-f'], { allowFailure: false });
  }

  async revert(patches: SnapshotPatch[]): Promise<void> {
    await this.ensureInitialized();

    const seen = new Set<string>();
    for (const patch of patches) {
      if (!patch?.baseHash || !Array.isArray(patch.files)) continue;
      const baseHash = patch.baseHash;

      for (const relPath of patch.files) {
        if (!relPath) continue;
        const normalized = relPath.replace(/\\/g, '/');
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const checkout = await this.git(
          ['checkout', baseHash, '--', normalized],
          { allowFailure: true }
        );

        if (checkout.code === 0) continue;

        const existsInTree = await this.git(
          ['ls-tree', baseHash, '--', normalized],
          { allowFailure: true }
        );

        if (existsInTree.code === 0 && existsInTree.stdout.trim()) {
          continue;
        }

        const absPath = path.join(this.worktree, normalized);
        await fs.unlink(absPath).catch(() => {});
      }
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.gitDir, { recursive: true });
    const initResult = await this.git(['init'], { allowFailure: true });
    if (initResult.code !== 0) {
      throw new Error(initResult.stderr.trim() || 'Failed to initialize snapshot repository');
    }

    await this.git(['config', 'core.autocrlf', 'false'], { allowFailure: true });
    this.initialized = true;
  }

  private async stageWorktree(): Promise<void> {
    await this.git(['add', '-A', '--', '.', ':(exclude).git']);
  }

  private async git(
    args: string[],
    options?: { allowFailure?: boolean }
  ): Promise<GitResult> {
    const fullArgs = ['--git-dir', this.gitDir, '--work-tree', this.worktree, ...args];
    const result = await spawn('git', fullArgs, { cwd: this.worktree });

    if (!options?.allowFailure && result.code !== 0) {
      throw new Error(result.stderr.trim() || `git ${args[0]} failed (exit ${result.code})`);
    }

    return result;
  }
}

function spawn(
  command: string,
  args: string[],
  options: { cwd: string }
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({ code: typeof code === 'number' ? code : 0, stdout, stderr });
    });
  });
}
