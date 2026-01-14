import * as vscode from 'vscode';

export type TodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
};

function getBaseUri(context: vscode.ExtensionContext): vscode.Uri | undefined {
  return context.storageUri ?? context.globalStorageUri;
}

function getTodosDir(context: vscode.ExtensionContext): vscode.Uri | undefined {
  const base = getBaseUri(context);
  if (!base) return undefined;
  return vscode.Uri.joinPath(base, 'todos');
}

function getTodoUri(context: vscode.ExtensionContext, sessionId: string): vscode.Uri | undefined {
  const dir = getTodosDir(context);
  if (!dir) return undefined;
  return vscode.Uri.joinPath(dir, `${sessionId}.json`);
}

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

async function ensureDir(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(uri);
  } catch {
    // Ignore; reads/writes will fail with a clearer error if storage is unavailable.
  }
}

async function writeJsonAtomic(dir: vscode.Uri, uri: vscode.Uri, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  const bytes = encoder.encode(json);
  const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1) || 'todo.json';
  const tmpUri = vscode.Uri.joinPath(dir, `${fileName}.tmp-${crypto.randomUUID()}`);

  await vscode.workspace.fs.writeFile(tmpUri, bytes);
  await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
}

function normalizeTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];

  const out: TodoItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : crypto.randomUUID();
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!content) continue;

    const statusRaw = typeof item.status === 'string' ? item.status.trim() : 'pending';
    const status: TodoItem['status'] =
      statusRaw === 'in_progress' || statusRaw === 'completed' || statusRaw === 'cancelled'
        ? statusRaw
        : 'pending';

    const priorityRaw = typeof item.priority === 'string' ? item.priority.trim() : 'medium';
    const priority: TodoItem['priority'] =
      priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'medium';

    out.push({ id, content, status, priority });
  }

  return out;
}

export async function readTodos(
  context: vscode.ExtensionContext,
  sessionId: string
): Promise<TodoItem[]> {
  const uri = getTodoUri(context, sessionId);
  if (!uri) return [];

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const text = decoder.decode(raw);
    return normalizeTodos(JSON.parse(text));
  } catch {
    return [];
  }
}

export async function writeTodos(
  context: vscode.ExtensionContext,
  sessionId: string,
  todos: TodoItem[]
): Promise<void> {
  const dir = getTodosDir(context);
  const uri = getTodoUri(context, sessionId);
  if (!dir || !uri) return;

  await ensureDir(dir);
  await writeJsonAtomic(dir, uri, todos);
}

