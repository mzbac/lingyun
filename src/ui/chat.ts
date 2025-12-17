import * as vscode from 'vscode';
import type { AgentLoop } from '../core/agent';
import type { ToolDefinition, ToolCall } from '../core/types';
import type { ModelInfo } from '../providers/copilot';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  timestamp: number;
  toolCall?: {
    id: string;
    name: string;
    args: string;
    status: 'pending' | 'running' | 'success' | 'error' | 'rejected';
    result?: string;
    approvalId?: string;
    diff?: string;
    path?: string;
    isProtected?: boolean;
    isOutsideWorkspace?: boolean;
    batchFiles?: string[];
    additionalCount?: number;
  };
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lingyun.chatView';

  private view?: vscode.WebviewView;
  private messages: ChatMessage[] = [];
  private isProcessing = false;
  private currentModel: string;
  private availableModels: ModelInfo[] = [];
  private autoApprovedTools: Set<string>;
  private pendingApprovals: Map<string, { resolve: (approved: boolean) => void; toolName: string }> = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private agent: AgentLoop,
    private llmProvider?: { getModels?: () => Promise<ModelInfo[]> }
  ) {
    this.currentModel = vscode.workspace.getConfiguration('lingyun').get('model') || 'gpt-4o';
    this.autoApprovedTools = new Set(
      this.context.globalState.get<string[]>('autoApprovedTools') || []
    );
  }

  public sendMessage(content: string): void {
    if (this.view) {
      this.handleUserMessage(content);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'send':
          await this.handleUserMessage(data.message);
          break;
        case 'abort':
          this.agent.abort();
          this.isProcessing = false;
          this.postMessage({ type: 'processing', value: false });
          break;
        case 'clear':
          this.messages = [];
          this.agent.clear();
          this.postMessage({ type: 'cleared' });
          break;
        case 'ready':
          await this.loadModels();
          this.postMessage({
            type: 'init',
            messages: this.messages,
            currentModel: this.currentModel,
            availableModels: this.availableModels,
          });
          break;
        case 'changeModel':
          this.currentModel = data.model;
          this.agent.updateConfig({ model: data.model });
          await vscode.workspace.getConfiguration('lingyun').update('model', data.model, true);
          this.postMessage({ type: 'modelChanged', model: data.model });
          break;
        case 'approveToolCall':
          this.handleApprovalResponse(data.approvalId, true);
          break;
        case 'rejectToolCall':
          this.handleApprovalResponse(data.approvalId, false);
          break;
        case 'alwaysAllowTool':
          this.autoApprovedTools.add(data.toolId);
          await this.context.globalState.update('autoApprovedTools', [...this.autoApprovedTools]);
          this.handleApprovalResponse(data.approvalId, true);
          break;
      }
    });
  }

  private async handleUserMessage(content: string): Promise<void> {
    if (this.isProcessing || !this.view) return;

    this.isProcessing = true;
    this.postMessage({ type: 'processing', value: true });

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);
    this.postMessage({ type: 'message', message: userMsg });

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    this.messages.push(assistantMsg);
    this.postMessage({ type: 'message', message: assistantMsg });

    try {
      const isNew = this.agent.getHistory().length === 0;

      await this.agent[isNew ? 'run' : 'continue'](content, {
        onToken: (token) => {
          assistantMsg.content += token;
          this.postMessage({ type: 'token', messageId: assistantMsg.id, token });
        },
        onToolCall: (tc: ToolCall, def: ToolDefinition) => {
          let path: string | undefined;
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            path = args.path;
          } catch {}

          const toolMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool',
            content: '',
            timestamp: Date.now(),
            toolCall: {
              id: def.id,
              name: def.name,
              args: tc.function.arguments,
              status: 'running',
              path,
            },
          };
          this.messages.push(toolMsg);
          this.postMessage({ type: 'message', message: toolMsg });
        },
        onToolResult: (_tc, result) => {
          const toolMsg = [...this.messages].reverse().find(
            m => m.toolCall?.status === 'running'
          );
          if (toolMsg?.toolCall) {
            toolMsg.toolCall.status = result.success ? 'success' : 'error';
            let resultStr: string;
            if (result.data === undefined || result.data === null) {
              resultStr = result.error || (result.success ? 'Done' : 'No data');
            } else if (typeof result.data === 'string') {
              resultStr = result.data;
            } else {
              resultStr = JSON.stringify(result.data, null, 2);
            }
            toolMsg.toolCall.result = resultStr.substring(0, 500);

            if (result.data && typeof result.data === 'object') {
              const data = result.data as Record<string, unknown>;
              if (data.diff && typeof data.diff === 'string') {
                toolMsg.toolCall.diff = data.diff;
              }
              if (data.isProtected) {
                toolMsg.toolCall.isProtected = true;
              }
              if (data.isOutsideWorkspace) {
                toolMsg.toolCall.isOutsideWorkspace = true;
              }
            }

            this.postMessage({ type: 'updateTool', message: toolMsg });
          }
        },
        onRequestApproval: async (tc, def) => {
          return this.requestInlineApproval(tc, def);
        },
        onComplete: () => {
          this.postMessage({ type: 'complete' });
        },
        onError: (error) => {
          const errorMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'error',
            content: error.message,
            timestamp: Date.now(),
          };
          this.messages.push(errorMsg);
          this.postMessage({ type: 'message', message: errorMsg });
        },
      });
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
      this.messages.push(errorMsg);
      this.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.isProcessing = false;
      this.postMessage({ type: 'processing', value: false });
    }
  }

  private async loadModels(): Promise<void> {
    if (this.llmProvider?.getModels) {
      try {
        this.availableModels = await this.llmProvider.getModels();
      } catch (error) {
        console.error('Failed to load models:', error);
        this.availableModels = [
          { id: 'gpt-4o', name: 'gpt-4o', vendor: 'copilot', family: 'gpt' },
          { id: 'gpt-4.1', name: 'gpt-4.1', vendor: 'copilot', family: 'gpt' },
        ];
      }
    }
  }

  private handleApprovalResponse(approvalId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      pending.resolve(approved);
      this.pendingApprovals.delete(approvalId);

      const toolMsg = this.messages.find(m => m.toolCall?.approvalId === approvalId);
      if (toolMsg?.toolCall) {
        toolMsg.toolCall.status = approved ? 'running' : 'rejected';
        this.postMessage({ type: 'updateTool', message: toolMsg });
      }
    }
  }

  private requestInlineApproval(tc: ToolCall, def: ToolDefinition): Promise<boolean> {
    if (this.autoApprovedTools.has(def.id)) {
      return Promise.resolve(true);
    }

    const approvalId = tc.id;

    let path: string | undefined;
    try {
      const args = JSON.parse(tc.function.arguments || '{}');
      path = args.path;
    } catch {}

    const toolMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      toolCall: {
        id: def.id,
        name: def.name,
        args: tc.function.arguments,
        status: 'pending',
        approvalId,
        path,
      },
    };
    this.messages.push(toolMsg);
    this.postMessage({ type: 'message', message: toolMsg });

    return new Promise((resolve) => {
      this.pendingApprovals.set(approvalId, { resolve, toolName: def.id });
    });
  }

  private postMessage(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  private getHtml(): string {
    return /*html*/ `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .header-label { font-size: 0.85em; opacity: 0.7; }
    .model-select {
      flex: 1;
      padding: 4px 8px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      font-size: 0.9em;
      cursor: pointer;
    }
    .model-select:focus { outline: 1px solid var(--vscode-focusBorder); }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      padding: 10px 14px;
      border-radius: 8px;
      max-width: 90%;
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 1.4;
    }
    .user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      align-self: flex-end;
    }
    .assistant {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      align-self: flex-start;
    }
    .tool {
      background: transparent;
      font-size: 0.85em;
      padding: 4px 8px;
      align-self: flex-start;
      opacity: 0.7;
      max-width: 100%;
    }
    .tool.pending {
      opacity: 1;
      background: var(--vscode-editor-background);
      border-left: 2px solid var(--vscode-editorWarning-foreground);
      padding: 8px 12px;
      border-radius: 4px;
    }
    .tool.running { opacity: 0.5; }
    .tool.success { opacity: 0.7; }
    .tool.error { opacity: 0.7; color: var(--vscode-testing-iconFailed); }
    .tool.rejected { opacity: 0.5; text-decoration: line-through; }
    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      align-self: flex-start;
    }
    .tool-container { display: flex; flex-direction: column; gap: 4px; }
    .tool-header { display: flex; align-items: center; gap: 6px; font-weight: bold; }
    .tool-details { margin-left: 16px; color: var(--vscode-descriptionForeground); }
    .tool-path {
      color: var(--vscode-textLink-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }
    .tool-diff {
      margin-left: 16px;
      margin-top: 4px;
      padding: 6px 8px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
      overflow-x: auto;
      background: var(--vscode-editor-background);
    }
    .tool-line-add { color: var(--vscode-gitDecoration-addedResourceForeground, #4ec9b0); }
    .tool-line-del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); }
    .tool-line-info { color: var(--vscode-editorInfo-foreground, #3794ff); }
    .tool-line-ctx { color: var(--vscode-descriptionForeground); opacity: 0.7; }
    .tool-more { color: var(--vscode-descriptionForeground); opacity: 0.6; font-style: italic; margin-top: 2px; }
    .tool-batch { border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 8px 10px; }
    .tool-file-list { margin-left: 16px; margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
    .tool-file-item { color: var(--vscode-textLink-foreground); font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
    .tool-warning { color: var(--vscode-editorWarning-foreground, #cca700); font-size: 0.85em; margin-left: 8px; }
    .tool-success { color: var(--vscode-testing-iconPassed, #4ec9b0); font-size: 0.85em; margin-left: 16px; margin-top: 4px; }
    .tool-error { color: var(--vscode-testing-iconFailed, #f14c4c); font-size: 0.85em; margin-left: 16px; margin-top: 4px; }
    .tool-summary { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .tool-icon { font-size: 1em; }
    .tool-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
    .tool-actions { display: flex; gap: 4px; margin-left: auto; }
    .tool-btn { padding: 2px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; border: none; font-family: inherit; }
    .tool-btn.approve { background: var(--vscode-testing-iconPassed); color: white; }
    .tool-btn.approve:hover { filter: brightness(1.1); }
    .tool-btn.always { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .tool-btn.always:hover { filter: brightness(1.1); }
    .tool-btn.reject { background: var(--vscode-testing-iconFailed); color: white; }
    .tool-btn.reject:hover { filter: brightness(1.1); }
    .input-area { padding: 12px; border-top: 1px solid var(--vscode-widget-border); display: flex; gap: 8px; }
    textarea {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      font-family: inherit;
      font-size: inherit;
      resize: none;
      min-height: 36px;
      max-height: 120px;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: inherit;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.6; text-align: center; padding: 20px; }
    .empty h2 { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-label">Model:</span>
    <select id="modelSelect" class="model-select">
      <option value="">Loading...</option>
    </select>
  </div>
  <div class="messages" id="messages">
    <div class="empty" id="empty">
      <h2>LingYun</h2>
      <p>Ask me to help with tasks in your workspace</p>
    </div>
  </div>
  <div class="input-area">
    <textarea id="input" placeholder="Describe a task..." rows="1"></textarea>
    <button id="send">Send</button>
    <button id="clear" class="secondary">Clear</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const empty = document.getElementById('empty');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const clearBtn = document.getElementById('clear');
    const modelSelect = document.getElementById('modelSelect');

    let isProcessing = false;
    let currentModel = '';
    const messageEls = new Map();
    let lastToolMsg = null;
    const BATCH_TOOL_TYPES = ['file.read', 'file.list'];

    const toolIcons = {
      'file.read': '📝', 'file.write': '±', 'file.list': '📁',
      'file.search': '🔍', 'file.getCurrent': '📋',
      'shell.run': '⚡', 'shell.terminal': '💻', 'shell.which': '❓',
      'file.insert': '+', 'file.replace': '⇄', 'file.create': '📄'
    };

    modelSelect.addEventListener('change', () => {
      const newModel = modelSelect.value;
      if (newModel && newModel !== currentModel) {
        vscode.postMessage({ type: 'changeModel', model: newModel });
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    sendBtn.addEventListener('click', () => isProcessing ? vscode.postMessage({ type: 'abort' }) : send());
    clearBtn.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

    function send() {
      const text = input.value.trim();
      if (!text || isProcessing) return;
      vscode.postMessage({ type: 'send', message: text });
      input.value = '';
      input.style.height = 'auto';
    }

    function setProcessing(val) {
      isProcessing = val;
      input.disabled = val;
      sendBtn.textContent = val ? 'Stop' : 'Send';
    }

    function truncateText(text, maxLen) {
      return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
    }

    function formatFilePath(path) {
      if (!path) return '';
      if (path.length > 50) {
        const parts = path.split('/');
        return '.../' + parts.slice(-2).join('/');
      }
      return path;
    }

    function renderDiffLines(diff, maxLines) {
      if (!diff) return '';
      const lines = diff.split('\\n');
      const displayLines = lines.slice(0, maxLines);
      const remaining = lines.length - maxLines;

      let html = '<div class="tool-diff">';
      displayLines.forEach(line => {
        let className = 'tool-line-ctx';
        if (line.startsWith('+')) className = 'tool-line-add';
        else if (line.startsWith('-')) className = 'tool-line-del';
        else if (line.startsWith('@@')) className = 'tool-line-info';
        html += '<div class="' + className + '">' + escapeHtml(truncateText(line, 80)) + '</div>';
      });
      if (remaining > 0) {
        html += '<div class="tool-more">... (' + remaining + ' more lines)</div>';
      }
      html += '</div>';
      return html;
    }

    function formatToolSummary(toolCall) {
      const toolId = toolCall.id || '';
      let icon = toolIcons[toolId];
      if (!icon) {
        if (toolId.startsWith('kb.') || toolId.includes('search') || toolId.includes('knowledge')) icon = '🧠';
        else if (toolId.startsWith('workspace.')) icon = '🔧';
        else icon = '🔧';
      }

      let args = {};
      try { args = JSON.parse(toolCall.args || '{}'); } catch {}

      const path = toolCall.path || args.path || '';
      const diff = toolCall.diff || '';
      const isProtected = toolCall.isProtected;
      const isOutsideWorkspace = toolCall.isOutsideWorkspace;
      const batchFiles = toolCall.batchFiles || [];
      const additionalCount = toolCall.additionalCount || 0;

      if (batchFiles.length > 0) {
        const totalCount = batchFiles.length + additionalCount;
        const toolName = toolId === 'file.read' ? 'Read Files' : toolId === 'file.write' ? 'Edit Files' : 'Files';
        let html = '<div class="tool-batch">';
        html += '<div class="tool-header">' + icon + ' ' + toolName + ' (' + totalCount + ' files)</div>';
        html += '<div class="tool-file-list">';
        batchFiles.slice(0, 5).forEach(file => {
          html += '<div class="tool-file-item">- ' + escapeHtml(formatFilePath(file)) + '</div>';
        });
        if (batchFiles.length > 5 || additionalCount > 0) {
          const moreCount = (batchFiles.length - 5) + additionalCount;
          if (moreCount > 0) html += '<div class="tool-more">... and ' + moreCount + ' more files</div>';
        }
        html += '</div></div>';
        return html;
      }

      let headerText = '';
      let showDiff = false;

      if (toolId === 'file.read') {
        headerText = 'Read File';
      } else if (toolId === 'file.write' || toolId.includes('edit') || toolId.includes('write')) {
        headerText = path ? 'Edit File: ' + formatFilePath(path) : 'Edit File';
        icon = '±';
        showDiff = !!diff;
      } else if (toolId === 'file.list') {
        headerText = path ? 'List ' + formatFilePath(path) : 'List Files';
      } else if (toolId === 'file.search') {
        headerText = args.query ? 'Search "' + truncateText(args.query, 30) + '"' : 'Search Files';
      } else if (toolId === 'shell.run') {
        headerText = args.command ? 'Run: ' + truncateText(args.command, 40) : 'Run Command';
      } else if (args.query && (toolId.includes('search') || toolId.startsWith('kb.'))) {
        headerText = 'Search "' + truncateText(args.query, 30) + '"';
      } else {
        headerText = toolCall.name || toolId;
        if (path) headerText += ': ' + formatFilePath(path);
      }

      if (toolCall.status === 'running') headerText += '...';
      if (toolCall.status === 'rejected') headerText = '✗ ' + headerText;
      if (toolCall.status === 'error') headerText = '✗ ' + headerText;

      let warnings = '';
      if (isProtected) warnings += '<span class="tool-warning">🔒 Protected</span>';
      if (isOutsideWorkspace) warnings += '<span class="tool-warning">⚠ Outside workspace</span>';

      if (toolCall.status === 'pending' && toolCall.approvalId) {
        let html = '<div class="tool-container">';
        html += '<div class="tool-header">' + icon + ' ' + escapeHtml(headerText) + warnings + '</div>';
        if (path && toolId === 'file.read') {
          html += '<div class="tool-details"><span class="tool-path">' + escapeHtml(formatFilePath(path)) + '</span></div>';
        }
        html += '<div class="tool-actions">' +
          '<button class="tool-btn approve" data-action="approve" data-approval="' + escapeHtml(toolCall.approvalId) + '">Allow</button>' +
          '<button class="tool-btn always" data-action="always" data-approval="' + escapeHtml(toolCall.approvalId) + '" data-tool="' + escapeHtml(toolId) + '">Always</button>' +
          '<button class="tool-btn reject" data-action="reject" data-approval="' + escapeHtml(toolCall.approvalId) + '">Deny</button>' +
        '</div>';
        html += '</div>';
        return html;
      }

      let html = '<div class="tool-container">';
      html += '<div class="tool-header">' + icon + ' ' + escapeHtml(headerText) + warnings + '</div>';

      if (path && toolId === 'file.read') {
        html += '<div class="tool-details"><span class="tool-path">' + escapeHtml(formatFilePath(path)) + '</span></div>';
      }

      if (showDiff && diff) {
        html += renderDiffLines(diff, 10);
      }

      if (toolCall.status === 'success' && (toolId === 'file.write' || toolId.includes('edit'))) {
        html += '<div class="tool-success">✓ Done</div>';
      }

      if (toolCall.status === 'error' && toolCall.result) {
        html += '<div class="tool-error">' + escapeHtml(truncateText(toolCall.result, 100)) + '</div>';
      }

      html += '</div>';
      return html;
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.tool-btn');
      if (!btn) return;

      const action = btn.dataset.action;
      const approvalId = btn.dataset.approval;
      const toolId = btn.dataset.tool;

      if (action === 'approve') {
        vscode.postMessage({ type: 'approveToolCall', approvalId });
      } else if (action === 'always') {
        vscode.postMessage({ type: 'alwaysAllowTool', approvalId, toolId });
      } else if (action === 'reject') {
        vscode.postMessage({ type: 'rejectToolCall', approvalId });
      }
    });

    function addMessage(msg) {
      empty.style.display = 'none';

      if (msg.toolCall && BATCH_TOOL_TYPES.includes(msg.toolCall.id)) {
        const currentToolId = msg.toolCall.id;
        const currentPath = msg.toolCall.path || '';

        if (lastToolMsg && lastToolMsg.toolCall && lastToolMsg.toolCall.id === currentToolId && currentPath) {
          const existingFiles = lastToolMsg.toolCall.batchFiles || [lastToolMsg.toolCall.path || ''];
          const isDuplicate = existingFiles.includes(currentPath);

          if (!isDuplicate) {
            if (!lastToolMsg.toolCall.batchFiles) {
              const firstPath = lastToolMsg.toolCall.path || '';
              lastToolMsg.toolCall.batchFiles = firstPath ? [firstPath] : [];
            }
            lastToolMsg.toolCall.batchFiles.push(currentPath);

            const existingEl = messageEls.get(lastToolMsg.id);
            if (existingEl) {
              existingEl.innerHTML = formatToolSummary(lastToolMsg.toolCall);
            }

            messageEls.set(msg.id, existingEl);
            messages.scrollTop = messages.scrollHeight;
            return;
          }
        }
      }

      if (!msg.toolCall) {
        lastToolMsg = null;
      }

      const el = document.createElement('div');
      el.className = 'message ' + msg.role + (msg.toolCall ? ' ' + msg.toolCall.status : '');
      el.dataset.id = msg.id;

      if (msg.toolCall) {
        el.innerHTML = formatToolSummary(msg.toolCall);
        if (BATCH_TOOL_TYPES.includes(msg.toolCall.id)) {
          lastToolMsg = msg;
        } else {
          lastToolMsg = null;
        }
      } else {
        el.textContent = msg.content || '...';
      }

      messageEls.set(msg.id, el);
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    function updateModelSelect(models, selected) {
      modelSelect.innerHTML = '';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        if (m.id === selected) opt.selected = true;
        modelSelect.appendChild(opt);
      });
      currentModel = selected;
    }

    window.addEventListener('message', (e) => {
      const data = e.data;
      switch (data.type) {
        case 'init':
          data.messages.forEach(addMessage);
          if (data.availableModels && data.availableModels.length > 0) {
            updateModelSelect(data.availableModels, data.currentModel);
          }
          break;
        case 'message':
          addMessage(data.message);
          break;
        case 'token':
          const el = messageEls.get(data.messageId);
          if (el) {
            el.textContent = (el.textContent === '...' ? '' : el.textContent) + data.token;
            messages.scrollTop = messages.scrollHeight;
          }
          break;
        case 'updateTool':
          const toolEl = messageEls.get(data.message.id);
          if (toolEl && data.message.toolCall) {
            toolEl.className = 'message tool ' + data.message.toolCall.status;
            toolEl.innerHTML = formatToolSummary(data.message.toolCall);
          }
          break;
        case 'processing':
          setProcessing(data.value);
          break;
        case 'cleared':
          messages.innerHTML = '';
          messages.appendChild(empty);
          empty.style.display = 'flex';
          messageEls.clear();
          lastToolMsg = null;
          break;
        case 'modelChanged':
          currentModel = data.model;
          modelSelect.value = data.model;
          break;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
