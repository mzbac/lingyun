export type RenderFileTreeOptions = {
  rootLabel: string;
  relFiles: Iterable<string>;
  notes?: string[];
  truncated?: boolean;
};

const DEFAULT_FILE_TREE_IGNORE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'vendor',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.cache',
  'cache',
  'logs',
  '.venv',
  'venv',
  'env',
  '__pycache__',
];

type FileTreeNode = {
  dirs: Map<string, FileTreeNode>;
  files: string[];
};

function createFileTreeNode(): FileTreeNode {
  return { dirs: new Map(), files: [] };
}

function getChildDir(node: FileTreeNode, name: string): FileTreeNode {
  let child = node.dirs.get(name);
  if (!child) {
    child = createFileTreeNode();
    node.dirs.set(name, child);
  }
  return child;
}

function addFile(root: FileTreeNode, relFile: string): void {
  const normalized = relFile.replace(/\\/g, '/');
  if (!normalized || normalized === '.') return;

  const fileStart = normalized.lastIndexOf('/') + 1;
  const fileName = normalized.slice(fileStart);
  if (!fileName) return;

  let node = root;
  let partStart = 0;
  while (partStart < fileStart) {
    while (normalized.charCodeAt(partStart) === 47) partStart++;
    if (partStart >= fileStart) break;

    const slash = normalized.indexOf('/', partStart);
    const partEnd = slash < 0 || slash >= fileStart ? fileStart - 1 : slash;
    if (partEnd > partStart) {
      node = getChildDir(node, normalized.slice(partStart, partEnd));
    }
    partStart = partEnd + 1;
  }
  node.files.push(fileName);
}

function appendFileTreeNode(lines: string[], node: FileTreeNode, depth: number, name?: string): void {
  if (name) {
    lines.push(`${'  '.repeat(depth)}${name}/`);
  }

  const childDepth = depth + 1;
  const dirNames = Array.from(node.dirs.keys()).sort((a, b) => a.localeCompare(b));
  for (const dirName of dirNames) {
    appendFileTreeNode(lines, node.dirs.get(dirName)!, childDepth, dirName);
  }

  const childIndent = '  '.repeat(childDepth);
  node.files.sort((a, b) => a.localeCompare(b));
  for (const fileName of node.files) {
    lines.push(`${childIndent}${fileName}`);
  }
}

export function createFileTreeIgnoreDirs(extra?: Iterable<unknown>): Set<string> {
  const ignoreDirs = new Set<string>();
  for (const dir of DEFAULT_FILE_TREE_IGNORE_DIRS) {
    ignoreDirs.add(dir);
  }
  if (!extra) return ignoreDirs;
  for (const rawDir of extra) {
    const dir = String(rawDir);
    if (dir) ignoreDirs.add(dir);
  }
  return ignoreDirs;
}

export function renderFileTreeOutput(options: RenderFileTreeOptions): string {
  const root = createFileTreeNode();
  for (const relFile of options.relFiles) {
    addFile(root, relFile);
  }

  const lines: string[] = [];
  const notes = options.notes ?? [];
  if (notes.length > 0) {
    lines.push(`Note: ${notes.join(' ')}`, '');
  }

  lines.push(`${options.rootLabel}/`);
  appendFileTreeNode(lines, root, 0);

  if (options.truncated) {
    lines.push('', '(Results are truncated.)');
  }

  return lines.join('\n').trimEnd();
}
