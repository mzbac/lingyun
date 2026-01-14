import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readTodos } from '../../core/todo';
import { getNonce } from './utils';
import { getWorkspaceFolderUrisByPriority, resolveExistingFilePath } from './fileLinks';
import { ChatViewProvider } from '../chat';
import { createLingyunDiffUri } from './diffContentProvider';

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeCandidatePath(raw: string): string {
  let value = stripWrappingQuotes(raw || '');
  if (!value) return '';
  if (value.startsWith('file://')) {
    try {
      return vscode.Uri.parse(value).fsPath;
    } catch {
      // ignore
    }
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    try {
      value = path.join(os.homedir(), value.slice(2));
    } catch {
      // ignore
    }
  }
  return value;
}

Object.assign(ChatViewProvider.prototype, {
  resolveWebviewView(this: ChatViewProvider, webviewView: vscode.WebviewView): void {
    for (const d of this.viewDisposables) {
      d.dispose();
    }
    this.viewDisposables = [];

    this.view = webviewView;
    this.initAcked = false;
    this.webviewClientInstanceId = undefined;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    this.viewDisposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (!this.view) return;

        if (webviewView.visible) {
          if (!this.initAcked) {
            this.startInitPusher();
          }
          return;
        }

        // Stop pushing init while hidden.
        if (this.initInterval) {
          clearInterval(this.initInterval);
          this.initInterval = undefined;
        }
      })
    );

    this.viewDisposables.push(
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.initAcked = false;
        this.webviewClientInstanceId = undefined;
        if (this.initInterval) {
          clearInterval(this.initInterval);
          this.initInterval = undefined;
        }
      })
    );

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (data) => {
        switch (data.type) {
          case 'newSession':
            await this.createNewSession();
            break;
          case 'openLocation': {
            const workspaceFolderUris = getWorkspaceFolderUrisByPriority();
            const payload = data as Record<string, unknown>;
            const filePathRaw = typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
            const lineRaw =
              typeof payload.line === 'number'
                ? payload.line
                : typeof payload.line === 'string'
                  ? Number(payload.line)
                  : NaN;
            const characterRaw =
              typeof payload.character === 'number'
                ? payload.character
                : typeof payload.character === 'string'
                  ? Number(payload.character)
                  : NaN;
            const line = Number.isFinite(lineRaw) ? Math.max(1, Math.floor(lineRaw)) : undefined;
            const character = Number.isFinite(characterRaw) ? Math.max(1, Math.floor(characterRaw)) : 1;
            if (!filePathRaw || !line) break;

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;

            try {
              const normalized = normalizeCandidatePath(filePathRaw);
              if (!normalized) break;
              const candidates: string[] = [];
              if ((normalized.startsWith('a/') || normalized.startsWith('b/')) && normalized.length > 2) {
                candidates.push(normalized.slice(2));
              }
              candidates.push(normalized);

              let resolved:
                | { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }
                | undefined;
              let blockedExternalMessage: string | undefined;

              for (const candidate of candidates) {
                const attempt = await resolveExistingFilePath(candidate, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                  break;
                }
                if (attempt.blockedMessage) blockedExternalMessage = attempt.blockedMessage;
              }

              if (!resolved) {
                if (blockedExternalMessage) {
                  void vscode.window.showWarningMessage(`LingYun: ${blockedExternalMessage}`);
                } else {
                  void vscode.window.showInformationMessage('LingYun: file not found.');
                }
                break;
              }

              const doc = await vscode.workspace.openTextDocument(resolved.uri);
              const editor = await vscode.window.showTextDocument(doc, { preview: false });
              const pos = new vscode.Position(line - 1, character - 1);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            } catch {
              // ignore open failures
            }
            break;
          }
          case 'resolveFileLinks': {
            const workspaceFolderUris = getWorkspaceFolderUrisByPriority();
            const payload = data as Record<string, unknown>;
            const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
            const candidatesRaw = Array.isArray(payload.candidates) ? payload.candidates : [];
            if (!requestId) break;
            if (workspaceFolderUris.length === 0) {
              this.postMessage({ type: 'resolvedFileLinks', requestId, results: [] });
              break;
            }

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;

            const deduped: string[] = [];
            const seen = new Set<string>();
            for (const item of candidatesRaw) {
              const raw =
                item && typeof item === 'object' && typeof (item as any).raw === 'string'
                  ? String((item as any).raw).trim()
                  : '';
              if (!raw) continue;
              if (seen.has(raw)) continue;
              seen.add(raw);
              deduped.push(raw);
              if (deduped.length >= 200) break;
            }

            const results: Array<{ raw: string; ok: boolean; path?: string }> = [];

            for (const raw of deduped) {
              const normalized = normalizeCandidatePath(raw);
              if (!normalized) {
                results.push({ raw, ok: false });
                continue;
              }
              const candidates: string[] = [];
              if ((normalized.startsWith('a/') || normalized.startsWith('b/')) && normalized.length > 2) {
                candidates.push(normalized.slice(2));
              }
              candidates.push(normalized);

              let resolved:
                | { uri: vscode.Uri; absPath: string; relPath: string; isExternal: boolean }
                | undefined;

              for (const candidate of candidates) {
                const attempt = await resolveExistingFilePath(candidate, workspaceFolderUris, allowExternalPaths);
                if (attempt.resolved) {
                  resolved = attempt.resolved;
                  break;
                }
              }

              if (!resolved) {
                results.push({ raw, ok: false });
                continue;
              }

              // Use absolute paths to avoid ambiguity in multi-root workspaces.
              results.push({ raw, ok: true, path: resolved.absPath });
            }

            this.postMessage({ type: 'resolvedFileLinks', requestId, results });
            break;
          }
          case 'openNativeDiff': {
            const payload = data as Record<string, unknown>;
            const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId.trim() : '';
            if (!toolCallId) break;

            const snapshot = this.toolDiffSnapshotsByToolCallId.get(toolCallId);
            if (!snapshot) {
              void vscode.window.showInformationMessage(
                'LingYun: diff snapshot is unavailable (try rerunning the tool).'
              );
              break;
            }

            const allowExternalPaths =
              vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ??
              false;
            if (!allowExternalPaths && snapshot.isExternal) {
              void vscode.window.showWarningMessage(
                'LingYun: external paths are disabled. Enable lingyun.security.allowExternalPaths to view this diff.'
              );
              break;
            }

            const fileName = path.basename(snapshot.absPath || snapshot.displayPath || 'file');
            const left = createLingyunDiffUri({ toolCallId, side: 'before', fileName });
            const right = createLingyunDiffUri({ toolCallId, side: 'after', fileName });
            const title = `LingYun Diff: ${snapshot.displayPath || fileName}`;

            try {
              await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
            } catch {
              void vscode.window.showErrorMessage('LingYun: failed to open diff editor.');
            }

            break;
          }
          case 'compactSession':
            await this.compactCurrentSession();
            break;
          case 'undo':
            await this.undo();
            break;
          case 'redo':
            await this.redo();
            break;
          case 'redoAll':
            await this.redoAll();
            break;
          case 'discardUndone':
            await this.discardUndone();
            break;
          case 'viewRevertDiff':
            await this.viewRevertDiff();
            break;
          case 'switchSession':
            if (typeof data.sessionId === 'string') {
              await this.switchToSession(data.sessionId);
            }
            break;
          case 'send':
            this.abortRequested = false;
            if (this.pendingPlan && this.mode === 'plan') {
              await this.revisePendingPlan(this.pendingPlan.planMessageId, data.message);
            } else {
              await this.handleUserMessage(data.message);
            }
            break;
          case 'abort':
            // If we're blocked waiting for tool approval, resolve those promises so the agent can unwind.
            this.rejectAllPendingApprovals('Canceled by user.');
            this.agent.abort();
            this.abortRequested = true;
            this.markActiveStepStatus('canceled');
            this.persistActiveSession();
            break;
          case 'approveAll':
            this.approveAllPendingApprovals();
            break;
          case 'clear': {
            const session = this.getActiveSession();
            session.messages = [];
            session.pendingPlan = undefined;
            session.stepCounter = 0;
            session.activeStepId = undefined;
            session.agentState = this.getBlankAgentState();
            this.switchToSessionSync(session.id);

            this.toolDiffBeforeByToolCallId.clear();
            this.toolDiffSnapshotsByToolCallId.clear();

            this.stepCounter = 0;
            this.activeStepId = undefined;
            this.abortRequested = false;
            this.pendingPlan = undefined;
            this.postMessage({ type: 'cleared' });
            this.postMessage({ type: 'planPending', value: false, planMessageId: '' });
            this.persistActiveSession();
            break;
          }
          case 'ready':
            if (typeof data.clientInstanceId === 'string' && data.clientInstanceId.trim()) {
              this.webviewClientInstanceId = data.clientInstanceId.trim();
            }
            this.initAcked = false;
            this.startInitPusher();
            break;
          case 'initAck':
            if (typeof data.clientInstanceId === 'string' && data.clientInstanceId.trim()) {
              const incoming = data.clientInstanceId.trim();
              if (this.webviewClientInstanceId && incoming !== this.webviewClientInstanceId) {
                return;
              }
              this.webviewClientInstanceId = incoming;
            }
            this.initAcked = true;
            if (this.initInterval) {
              clearInterval(this.initInterval);
              this.initInterval = undefined;
            }
            break;
          case 'pickModel':
            await this.pickModel();
            break;
          case 'changeModel':
            if (typeof data.model === 'string') {
              await this.setCurrentModel(data.model);
            }
            break;
          case 'toggleFavoriteModel': {
            const modelId =
              typeof data.model === 'string' && data.model.trim()
                ? data.model.trim()
                : this.currentModel;
            if (modelId) {
              await this.toggleFavoriteModel(modelId);
            }
            break;
          }
          case 'changeMode':
            if (this.isProcessing) {
              vscode.window.showInformationMessage(
                'LingYun: Stop the current task before switching modes.'
              );
              break;
            }
            if (data.mode !== 'plan' && data.mode !== 'build') break;
            if (data.mode === 'build' && this.pendingPlan) {
              await this.executePendingPlan(this.pendingPlan.planMessageId);
              break;
            }
            this.mode = data.mode;
            this.agent.setMode(this.mode);
            try {
              await vscode.workspace.getConfiguration('lingyun').update('mode', this.mode, true);
            } catch {
              // Ignore persistence errors; mode still updated for this session.
            }
            this.postMessage({ type: 'modeChanged', mode: this.mode });
            this.persistActiveSession();
            break;
          case 'executePlan':
            await this.executePendingPlan(
              typeof data.planMessageId === 'string' ? data.planMessageId : undefined
            );
            break;
          case 'cancelPlan':
            if (this.pendingPlan?.planMessageId === data.planMessageId) {
              const choice = await vscode.window.showWarningMessage(
                'Cancel this plan?',
                { modal: true },
                'Cancel Plan'
              );
              if (choice !== 'Cancel Plan') return;
            }
            await this.cancelPendingPlan(data.planMessageId);
            break;
          case 'revisePlan':
            if (!this.pendingPlan) return;
            if (this.pendingPlan.planMessageId !== data.planMessageId) return;

            if (typeof data.instructions === 'string' && data.instructions.trim()) {
              await this.revisePendingPlan(data.planMessageId, data.instructions);
              return;
            }

            {
              const instructions = await vscode.window.showInputBox({
                title: 'Revise plan',
                prompt: 'Answer the plan questions or add constraints',
                placeHolder: 'e.g. Use TypeScript, keep changes minimal, focus on UI streaming, …',
                ignoreFocusOut: true,
              });

              if (instructions && instructions.trim()) {
                await this.revisePendingPlan(data.planMessageId, instructions.trim());
              }
            }
            break;
          case 'approveToolCall':
            this.handleApprovalResponse(data.approvalId, true);
            break;
          case 'rejectToolCall':
            this.handleApprovalResponse(data.approvalId, false);
            break;
          case 'retryTool':
            if (typeof data.approvalId === 'string' && data.approvalId.trim()) {
              await this.retryToolCall(data.approvalId.trim());
            }
            break;
          case 'alwaysAllowTool':
            this.autoApprovedTools.add(data.toolId);
            await this.context.globalState.update('autoApprovedTools', [...this.autoApprovedTools]);
            this.handleApprovalResponse(data.approvalId, true);
            break;
          case 'webviewError': {
            const errorText =
              typeof data.error === 'string' ? data.error : JSON.stringify(data.error, null, 2);
            console.error('LingYun webview error:', errorText);
            if (!this.webviewErrorShown) {
              this.webviewErrorShown = true;
              void vscode.window.showErrorMessage(
                'LingYun chat UI crashed. Open “Developer: Open Webview Developer Tools” to see details.'
              );
            }
            break;
          }
        }
      })
    );

    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.startInitPusher();
  },

  startInitPusher(this: ChatViewProvider): void {
    if (this.initInterval) {
      clearInterval(this.initInterval);
      this.initInterval = undefined;
    }

    this.initInterval = setInterval(() => {
      void this.sendInit();
    }, 2000);

    void this.sendInit();
  },

  async sendInit(this: ChatViewProvider, force = false): Promise<void> {
    if (!this.view) return;
    if (!force && this.initAcked) return;
    if (this.initInFlight) return;

    this.initInFlight = true;
    try {
      await this.ensureSessionsLoaded();

      const modelLabel = this.getModelLabel(this.currentModel) || this.currentModel;
      const currentModelIsFavorite = await this.isModelFavorite(this.currentModel);

      const todos = await readTodos(this.context, this.activeSessionId);

      this.postMessage({
        type: 'init',
        sessions: this.getSessionsForUI(),
        activeSessionId: this.activeSessionId,
        messages: this.getRenderableMessages(),
        inputHistory: this.inputHistoryEntries,
        revertState: this.getRevertBarStateForUI(),
        context: this.getContextForUI(),
        todos,
        currentModel: this.currentModel,
        currentModelLabel: modelLabel,
        currentModelIsFavorite,
        mode: this.mode,
        planPending: !!this.pendingPlan,
        activePlanMessageId: this.pendingPlan?.planMessageId ?? '',
        processing: this.isProcessing,
        pendingApprovals: this.pendingApprovals.size,
        autoApproveThisRun: this.autoApproveThisRun,
        ...this.getUndoRedoAvailability(),
      });
    } catch (error) {
      console.error('Failed to send init:', error);

      const fallback = this.currentModel || 'gpt-4o';
      this.currentModel = fallback;
      const modelLabel = fallback;
      let currentModelIsFavorite = false;
      try {
        currentModelIsFavorite = await this.isModelFavorite(fallback);
      } catch {
        currentModelIsFavorite = false;
      }

      try {
        const todos = await readTodos(this.context, this.activeSessionId);
        this.postMessage({
          type: 'init',
          sessions: this.getSessionsForUI(),
          activeSessionId: this.activeSessionId,
          messages: this.getRenderableMessages(),
          inputHistory: this.inputHistoryEntries,
          revertState: this.getRevertBarStateForUI(),
          context: this.getContextForUI(),
          todos,
          currentModel: this.currentModel,
          currentModelLabel: modelLabel,
          currentModelIsFavorite,
          mode: this.mode,
          planPending: !!this.pendingPlan,
          activePlanMessageId: this.pendingPlan?.planMessageId ?? '',
          processing: this.isProcessing,
          pendingApprovals: this.pendingApprovals.size,
          autoApproveThisRun: this.autoApproveThisRun,
          ...this.getUndoRedoAvailability(),
        });
      } catch (postError) {
        console.error('Failed to post init fallback:', postError);
      }
    } finally {
      this.initInFlight = false;
    }
  },

  postMessage(this: ChatViewProvider, message: unknown): void {
    this.view?.webview.postMessage(message);
  },

  getHtml(this: ChatViewProvider, webview: vscode.Webview): string {
    const nonce = getNonce();
    const version = String((this.context as any)?.extension?.packageJSON?.version || '');
    const versionSuffix = version ? `(${version})` : '';

    const scriptFiles = [
      ['chat', 'bootstrap.js'],
      ['chat', 'render-utils.js'],
      ['chat', 'render-messages.js'],
      ['chat', 'context.js'],
      ['chat', 'main.js'],
    ];
    const scripts = scriptFiles
      .map(parts => {
        const uri = webview.asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'media', ...parts)
        );
        return `<script nonce="${nonce}" src="${String(uri)}"></script>`;
      })
      .join('\n');
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'images', 'icon.png')
    );

    const templatePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.html').fsPath;
    const template = fs.readFileSync(templatePath, 'utf8');

    return template
      .replace(/{{CSP_SOURCE}}/g, webview.cspSource)
      .replace(/{{NONCE}}/g, nonce)
      .replace(/{{SCRIPTS}}/g, scripts)
      .replace(/{{LOGO_URI}}/g, String(logoUri))
      .replace(/{{VERSION_SUFFIX}}/g, versionSuffix);
  },
});
