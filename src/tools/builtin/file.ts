import * as vscode from 'vscode';
import * as path from 'path';
import { toolRegistry } from '../../core/registry';
import type { ToolDefinition, ToolHandler } from '../../core/types';
import { requireString, optionalNumber } from '../../core/validation';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
  '.ttf', '.otf', '.woff', '.woff2',
  '.pyc', '.class', '.o', '.obj',
  '.sqlite', '.db',
]);

const MAX_FILE_SIZE = 50000;

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function containsBinaryData(buffer: Uint8Array): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function getWorkspaceUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('No workspace folder open');
  return folder.uri;
}

function validatePath(filePath: string): vscode.Uri {
  const root = getWorkspaceUri();
  const resolved = vscode.Uri.joinPath(root, filePath);
  if (!resolved.fsPath.startsWith(root.fsPath)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

const readFileDef: ToolDefinition = {
  id: 'file.read',
  name: 'Read File',
  description: 'Read file contents. Supports line ranges (startLine/endLine). Auto-rejects binary files. Max ~50KB, larger files truncated. Use file.list or file.search first to find files.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to workspace root',
      },
      startLine: {
        type: 'number',
        description: 'Start line (1-indexed, optional)',
      },
      endLine: {
        type: 'number',
        description: 'End line (1-indexed, optional)',
      },
    },
    required: ['path'],
  },
  execution: { type: 'function', handler: 'file.read' },
  metadata: {
    category: 'file',
    icon: 'file',
    requiresApproval: false,
  },
};

const readFileHandler: ToolHandler = async (args) => {
  try {
    const pathResult = requireString(args, 'path');
    if ('error' in pathResult) {
      return { success: false, error: pathResult.error };
    }
    const filePath = pathResult.value;

    const startLine = optionalNumber(args, 'startLine');
    const endLine = optionalNumber(args, 'endLine');

    if (isBinaryFile(filePath)) {
      return {
        success: false,
        error: `Cannot read binary file: ${filePath}. This appears to be a binary file (${path.extname(filePath)}).`,
      };
    }

    const uri = validatePath(filePath);
    const content = await vscode.workspace.fs.readFile(uri);

    if (containsBinaryData(content)) {
      return {
        success: false,
        error: `Cannot read binary file: ${filePath}. The file contains binary data.`,
      };
    }

    let text = new TextDecoder().decode(content);

    if (startLine !== undefined || endLine !== undefined) {
      const lines = text.split('\n');
      const start = (startLine || 1) - 1;
      const end = endLine || lines.length;
      text = lines.slice(start, end).join('\n');
    }

    if (text.length > MAX_FILE_SIZE) {
      const truncated = text.substring(0, MAX_FILE_SIZE);
      const lineCount = truncated.split('\n').length;
      return {
        success: true,
        data: truncated + `\n\n... [TRUNCATED - showing first ${lineCount} lines of ${text.split('\n').length} total]`,
        metadata: { truncated: true, originalSize: text.length },
      };
    }

    return { success: true, data: text };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const writeFileDef: ToolDefinition = {
  id: 'file.write',
  name: 'Write File',
  description: 'Write content to a file. Creates parent directories if needed. Overwrites existing files. Requires user approval.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to workspace root',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
    },
    required: ['path', 'content'],
  },
  execution: { type: 'function', handler: 'file.write' },
  metadata: {
    category: 'file',
    icon: 'file-add',
    requiresApproval: true,
  },
};

const writeFileHandler: ToolHandler = async (args) => {
  try {
    const pathResult = requireString(args, 'path');
    if ('error' in pathResult) {
      return { success: false, error: pathResult.error };
    }
    const filePath = pathResult.value;

    const contentResult = requireString(args, 'content');
    if ('error' in contentResult) {
      return { success: false, error: contentResult.error };
    }
    const content = contentResult.value;

    const uri = validatePath(filePath);

    const parentDir = vscode.Uri.joinPath(uri, '..');
    try {
      await vscode.workspace.fs.createDirectory(parentDir);
    } catch {
      // Directory may already exist, ignore
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    return { success: true, data: `Wrote ${content.length} bytes to ${filePath}` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const listDirDef: ToolDefinition = {
  id: 'file.list',
  name: 'List Directory',
  description: 'List files using glob patterns (e.g., **/*.ts, src/**/*). Use pattern param to filter. maxDepth controls recursion (default 3). Returns up to 1000 files, excludes node_modules.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path (default: workspace root)',
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern to filter (e.g., **/*.ts)',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum depth to recurse (default: 3)',
      },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'file.list' },
  metadata: {
    category: 'file',
    icon: 'folder',
    requiresApproval: false,
  },
};

const listDirHandler: ToolHandler = async (args) => {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return { success: false, error: 'No workspace folder open' };
    }

    const pattern = (args.pattern as string) || '**/*';
    const maxDepth = (args.maxDepth as number) || 3;

    const files = await vscode.workspace.findFiles(
      pattern,
      '**/node_modules/**',
      1000
    );

    const root = folder.uri.fsPath;
    const filtered = files.filter(f => {
      const rel = path.relative(root, f.fsPath);
      const depth = rel.split(path.sep).length;
      return depth <= maxDepth;
    });

    const paths = filtered.map(f => vscode.workspace.asRelativePath(f));

    if (paths.length === 0) {
      return { success: true, data: 'No files found matching the criteria' };
    }

    return { success: true, data: paths.join('\n') };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const searchDef: ToolDefinition = {
  id: 'file.search',
  name: 'Search in Files',
  description: 'Search text/regex across files. Returns file:line:content for each match. Use pattern param to filter file types. Default 50 results max. Best for finding specific code patterns before reading files.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text or regex pattern to search',
      },
      pattern: {
        type: 'string',
        description: 'File pattern to search in (default: **/*.{ts,js,json})',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results (default: 50)',
      },
    },
    required: ['query'],
  },
  execution: { type: 'function', handler: 'file.search' },
  metadata: {
    category: 'file',
    icon: 'search',
    requiresApproval: false,
  },
};

const searchHandler: ToolHandler = async (args, context) => {
  try {
    const query = args.query as string;
    const filePattern = (args.pattern as string) || '**/*.{ts,js,jsx,tsx,json,md,py}';
    const maxResults = (args.maxResults as number) || 50;

    const files = await vscode.workspace.findFiles(filePattern, '**/node_modules/**', 500);
    const results: string[] = [];
    const regex = new RegExp(query, 'gi');

    for (const file of files) {
      if (results.length >= maxResults) break;
      if (context.cancellationToken.isCancellationRequested) break;

      try {
        const content = await vscode.workspace.fs.readFile(file);
        const text = new TextDecoder().decode(content);
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (regex.test(lines[i])) {
            const relPath = vscode.workspace.asRelativePath(file);
            results.push(`${relPath}:${i + 1}: ${lines[i].trim().substring(0, 100)}`);
          }
          regex.lastIndex = 0;
        }
      } catch {
        // Skip files that can't be read
      }
    }

    if (results.length === 0) {
      return { success: true, data: 'No matches found' };
    }

    return { success: true, data: results.join('\n') };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const getCurrentFileDef: ToolDefinition = {
  id: 'file.getCurrent',
  name: 'Get Current File',
  description: 'Get contents of the active editor file. Returns path, language, content, and selection info. Use includeSelection=true to get only selected text.',
  parameters: {
    type: 'object',
    properties: {
      includeSelection: {
        type: 'boolean',
        description: 'If true, only return selected text',
      },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'file.getCurrent' },
  metadata: {
    category: 'file',
    icon: 'file-code',
    requiresApproval: false,
  },
};

const getCurrentFileHandler: ToolHandler = async (args) => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { success: false, error: 'No active editor' };
  }

  const doc = editor.document;
  const selection = editor.selection;

  let content: string;
  if (args.includeSelection && !selection.isEmpty) {
    content = doc.getText(selection);
  } else {
    content = doc.getText();
  }

  return {
    success: true,
    data: {
      path: vscode.workspace.asRelativePath(doc.uri),
      language: doc.languageId,
      content,
      selection: selection.isEmpty ? null : {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
      },
    },
  };
};

export function registerFileTools(): vscode.Disposable[] {
  return [
    toolRegistry.registerTool(readFileDef, readFileHandler),
    toolRegistry.registerTool(writeFileDef, writeFileHandler),
    toolRegistry.registerTool(listDirDef, listDirHandler),
    toolRegistry.registerTool(searchDef, searchHandler),
    toolRegistry.registerTool(getCurrentFileDef, getCurrentFileHandler),
  ];
}
