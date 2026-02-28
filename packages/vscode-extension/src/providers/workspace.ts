import * as vscode from 'vscode';
import type {
  ToolProvider,
  ToolDefinition,
  ToolContext,
  ToolResult,
  WorkspaceToolsConfig,
  WorkspaceToolDefinition,
} from '../core/types';
import { executeShell, executeHttp } from './executors';
import { getPrimaryWorkspaceFolder, getPrimaryWorkspaceRootPath } from '../core/workspaceContext';

export class WorkspaceToolProvider implements ToolProvider {
  readonly id = 'workspace';
  readonly name = 'Workspace Tools';

  private tools: Map<string, WorkspaceToolDefinition> = new Map();
  private variables: Record<string, string> = {};
  private watcher?: vscode.FileSystemWatcher;
  private _onDidChange = new vscode.EventEmitter<void>();

  readonly onDidChange = this._onDidChange.event;

  constructor(private context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    await this.loadTools();
    this.startWatching();
  }

  private async loadTools(): Promise<void> {
    this.tools.clear();
    this.variables = {};

    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) return;

    const mainConfig = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'agent-tools.json');
    await this.loadConfigFile(mainConfig);

    const toolsDir = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'agent-tools');
    try {
      const files = await vscode.workspace.fs.readDirectory(toolsDir);
      for (const [name, type] of files) {
        if (type === vscode.FileType.File && name.endsWith('.json')) {
          const uri = vscode.Uri.joinPath(toolsDir, name);
          await this.loadConfigFile(uri);
        }
      }
    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        if (error.code !== 'FileNotFound') {
          console.warn(`[Workspace Tools] Failed to read agent-tools directory: ${error.message}`);
        }
      } else if (error instanceof Error) {
        console.warn(`[Workspace Tools] Unexpected error reading agent-tools directory: ${error.message}`);
      }
    }
  }

  private async loadConfigFile(uri: vscode.Uri): Promise<void> {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const config: WorkspaceToolsConfig = JSON.parse(new TextDecoder().decode(content));

      if (config.variables) {
        this.variables = { ...this.variables, ...config.variables };
      }

      for (const tool of config.tools) {
        const raw = typeof tool.id === 'string' ? tool.id.trim() : '';
        const toolId = raw.startsWith('workspace_') ? raw : `workspace_${raw}`;
        this.tools.set(toolId, { ...tool, id: toolId });
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        vscode.window.showWarningMessage(`Invalid JSON in ${uri.fsPath}: ${error.message}`);
      }
    }
  }

  private startWatching(): void {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) return;

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        workspaceFolder,
        '.vscode/agent-tools{.json,/*.json}'
      )
    );

    const reload = async () => {
      await this.loadTools();
      this._onDidChange.fire();
    };

    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
    this.watcher.onDidDelete(reload);
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => this.toToolDefinition(tool));
  }

  private toToolDefinition(tool: WorkspaceToolDefinition): ToolDefinition {
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execution: tool.execution,
      metadata: {
        category: tool.category || 'workspace',
        requiresApproval: tool.requiresApproval ?? true,
        tags: ['workspace'],
      },
    };
  }

  async executeTool(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolId}` };
    }

    const execution = this.substituteVariables(tool.execution, args);

    switch (execution.type) {
      case 'shell':
        return executeShell(execution, context);

      case 'http':
        return executeHttp(execution, args, context);

      case 'command':
        return this.executeCommand(execution, args);

      default:
        return { success: false, error: `Unknown execution type` };
    }
  }

  private async executeCommand(
    execution: { type: 'command'; command: string; args?: unknown[] },
    _args: Record<string, unknown>
  ): Promise<ToolResult> {
    try {
      const result = await vscode.commands.executeCommand(execution.command, ...(execution.args || []));

      return {
        success: true,
        data: result !== undefined ? result : 'Command executed successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private substituteVariables(
    execution: WorkspaceToolDefinition['execution'],
    args: Record<string, unknown>
  ): WorkspaceToolDefinition['execution'] {
    const substitute = (str: string): string => {
      const configEnv = vscode.workspace.getConfiguration('lingyun').get<Record<string, string>>('env') || {};
      const workspaceFolder = getPrimaryWorkspaceRootPath();
      str = str.replace(/\$\{env:(\w+)\}/g, (_, name) => {
        return configEnv[name] || process.env[name] || '';
      });

      str = str.replace(/\$\{arg:([A-Za-z0-9_]+)\}/g, (_, name) => {
        const value = args[name];
        return value !== undefined ? String(value) : '';
      });

      if (workspaceFolder) {
        str = str.replace(/\$\{workspaceFolder\}/g, workspaceFolder);
      }

      str = str.replace(/\$\{(\w+)\}/g, (_, name) => {
        return this.variables[name] || '';
      });

      return str;
    };

    const clone = JSON.parse(JSON.stringify(execution));

    const walk = (obj: unknown): unknown => {
      if (typeof obj === 'string') {
        return substitute(obj);
      }
      if (Array.isArray(obj)) {
        return obj.map(walk);
      }
      if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = walk(value);
        }
        return result;
      }
      return obj;
    };

    return walk(clone) as WorkspaceToolDefinition['execution'];
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}

export async function createSampleToolsConfig(): Promise<void> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const configPath = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'agent-tools.json');

  const sample: WorkspaceToolsConfig = {
    version: '1.0',
    variables: {
      API_BASE: 'https://api.example.com',
      RAG_API: 'https://your-rag-api.com',
    },
    tools: [
      {
        id: 'kb_search',
        name: 'Knowledge Search',
        description: 'Semantic search across knowledge base. Use BEFORE answering factual questions. Returns ranked results with snippets.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query - be specific',
            },
            maxResults: {
              type: 'number',
              description: 'Max results (default: 5)',
            },
          },
          required: ['query'],
        },
        execution: {
          type: 'http',
          url: '${RAG_API}/search',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ${env:RAG_API_KEY}',
          },
        },
        requiresApproval: false,
        category: 'knowledge',
      },
      {
        id: 'kb_retrieve',
        name: 'Get Document',
        description: 'Retrieve full document by ID when you need complete content from search results.',
        parameters: {
          type: 'object',
          properties: {
            documentId: {
              type: 'string',
              description: 'Document ID from search results',
            },
          },
          required: ['documentId'],
        },
        execution: {
          type: 'http',
          url: '${RAG_API}/retrieve',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ${env:RAG_API_KEY}',
          },
        },
        requiresApproval: false,
        category: 'knowledge',
      },
      {
        id: 'list_tasks',
        name: 'List Tasks',
        description: 'List all tasks from the task API',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'completed', 'all'],
              description: 'Filter by status',
            },
          },
          required: [],
        },
        execution: {
          type: 'http',
          url: '${API_BASE}/tasks?status=${arg:status}',
          method: 'GET',
        },
        requiresApproval: false,
        category: 'tasks',
      },
      {
        id: 'run_tests',
        name: 'Run Tests',
        description: 'Run the test suite',
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Test file pattern',
            },
          },
          required: [],
        },
        execution: {
          type: 'shell',
          script: 'npm test -- ${arg:pattern}',
          cwd: '${workspaceFolder}',
        },
        requiresApproval: true,
        category: 'development',
      },
      {
        id: 'format_code',
        name: 'Format Document',
        description: 'Format the current document',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
        execution: {
          type: 'command',
          command: 'editor.action.formatDocument',
        },
        requiresApproval: false,
        category: 'editor',
      },
    ],
  };

  const content = JSON.stringify(sample, null, 2);
  await vscode.workspace.fs.writeFile(configPath, Buffer.from(content));

  const doc = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(doc);
}
