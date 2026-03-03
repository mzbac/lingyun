import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ChatController } from '../chat/controller';
import { OfficeBridge } from './bridge';
import { isWebviewToExtensionMessage, type OfficeSpriteData, type OfficeToWebviewMessage } from '../../shared/officeProtocol';
import { loadOfficeFurnitureSpriteOverrides, loadOfficeTilesetFurnitureAssets } from './tileset';

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'office-webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  if (!fs.existsSync(indexPath)) {
    return [
      '<!doctype html>',
      '<html>',
      '<body style="font-family: var(--vscode-font-family); padding: 12px;">',
      '<h3>LingYun Office</h3>',
      '<p>Office webview assets are missing.</p>',
      '<p>Run <code>pnpm --filter lingyun office:build</code> (or <code>pnpm --filter lingyun bundle</code>) to build <code>dist/office-webview</code>.</p>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  let html = fs.readFileSync(indexPath, 'utf-8');

  // Allow Vite-built assets in the webview by rewriting relative href/src to webview URIs.
  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  // Inject CSP. Vite build emits module scripts with src=... and link tags; allow them from cspSource.
  const csp = [
    `default-src 'none';`,
    `img-src ${webview.cspSource} data:;`,
    `style-src ${webview.cspSource} 'unsafe-inline';`,
    `script-src ${webview.cspSource};`,
    `font-src ${webview.cspSource} data:;`,
  ].join(' ');

  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  }

  return html;
}

export class OfficeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lingyun.officeView';

  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
  private pendingResetToDefault = false;
  private messageDisposable?: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly chat: ChatController,
    private readonly bridge: OfficeBridge,
  ) {}

  private findSessionIdForAgentId(agentId: number): string | undefined {
    for (const sessionId of this.chat.sessions.keys()) {
      if (this.bridge.getAgentIdForSessionId(sessionId) === agentId) {
        return sessionId;
      }
    }
    return undefined;
  }

  private async postTilesetSpritesInBatches(webview: vscode.Webview, sprites: Record<string, OfficeSpriteData>): Promise<void> {
    const entries = Object.entries(sprites || {});
    if (entries.length === 0) return;

    const batchSize = 25;
    for (let i = 0; i < entries.length; i += batchSize) {
      if (!this.webviewView || this.webviewView.webview !== webview || !this.webviewReady) return;

      const batch: Record<string, OfficeSpriteData> = {};
      for (const [type, sprite] of entries.slice(i, i + batchSize)) {
        batch[type] = sprite;
      }
      const loaded: OfficeToWebviewMessage = { type: 'furnitureSpritesLoaded', sprites: batch };
      await webview.postMessage(loaded);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    this.webviewReady = false;
    const officeDistUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'office-webview');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [officeDistUri],
    };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.context.extensionUri);

    this.bridge.attachWebview(webviewView.webview);

    this.messageDisposable?.dispose();
    this.messageDisposable = webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!isWebviewToExtensionMessage(message)) return;
      const type = message.type;
      if (type === 'webviewReady') {
        this.webviewReady = true;

        const tilesetAssets = loadOfficeTilesetFurnitureAssets(this.context);
        if (tilesetAssets) {
          const catalogLoaded: OfficeToWebviewMessage = { type: 'furnitureCatalogLoaded', catalog: tilesetAssets.catalog };
          await webviewView.webview.postMessage(catalogLoaded);
          void this.postTilesetSpritesInBatches(webviewView.webview, tilesetAssets.sprites);
        }

        const furnitureSprites = loadOfficeFurnitureSpriteOverrides(this.context);
        if (furnitureSprites) {
          const loaded: OfficeToWebviewMessage = { type: 'furnitureSpritesLoaded', sprites: furnitureSprites };
          webviewView.webview.postMessage(loaded);
        }

        const layout = this.bridge.getLayout();
        const layoutLoaded: OfficeToWebviewMessage = { type: 'layoutLoaded', layout: layout ?? null };
        webviewView.webview.postMessage(layoutLoaded);

        const soundEnabled = this.bridge.getSoundEnabled(true);
        const settingsLoaded: OfficeToWebviewMessage = { type: 'settingsLoaded', soundEnabled };
        webviewView.webview.postMessage(settingsLoaded);

        await this.chat.ensureSessionsLoaded();
        if (this.chat.officeSync) {
          this.chat.officeSync.onWebviewReady();
        } else {
          const visibleSessionId = this.bridge.syncSessions(this.chat.sessions.values(), this.chat.activeSessionId);
          if (visibleSessionId) {
            this.bridge.postAgentStatus(visibleSessionId, this.chat.isProcessing ? 'active' : 'idle');
          }
        }

        if (this.pendingResetToDefault) {
          this.pendingResetToDefault = false;
          try {
            const reset: OfficeToWebviewMessage = { type: 'resetLayoutToDefault' };
            void webviewView.webview.postMessage(reset);
          } catch {
            // ignore post errors (view may be gone)
          }
        }
        return;
      }

      if (type === 'focusAgent') {
        await this.chat.ensureSessionsLoaded();
        const sessionId = this.findSessionIdForAgentId(message.id);
        if (!sessionId) return;
        await vscode.commands.executeCommand('lingyun.openAgent', sessionId);
        return;
      }

      if (type === 'closeAgent') {
        await this.chat.ensureSessionsLoaded();
        const sessionId = this.findSessionIdForAgentId(message.id);
        if (!sessionId) return;
        await this.deleteSession(sessionId);
        return;
      }

      if (type === 'saveAgentSeats') {
        const seats = (message.seats ?? {}) as Record<string, unknown>;
        this.bridge.saveSeatsFromWebview(seats);
        return;
      }

      if (type === 'saveLayout') {
        this.bridge.setLayout(message.layout);
        return;
      }

      if (type === 'setSoundEnabled') {
        this.bridge.setSoundEnabled(!!message.enabled);
        return;
      }

      if (type === 'openSessionsFolder') {
        const root = this.context.storageUri ?? this.context.globalStorageUri;
        if (!root) {
          vscode.window.showInformationMessage('LingYun: Sessions folder is unavailable.');
          return;
        }
        const sessionsUri = vscode.Uri.joinPath(root, 'sessions');
        try {
          fs.mkdirSync(sessionsUri.fsPath, { recursive: true });
        } catch {
          // ignore mkdir failures
        }
        await vscode.commands.executeCommand('revealFileInOS', sessionsUri);
        return;
      }

      if (type === 'exportLayout') {
        const layout = this.bridge.getLayout();
        if (!layout) {
          vscode.window.showWarningMessage('LingYun Office: No saved layout to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'] },
          defaultUri: vscode.Uri.file(path.join(this.context.globalStorageUri?.fsPath || '', 'lingyun-office-layout.json')),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
          vscode.window.showInformationMessage('LingYun Office: Layout exported successfully.');
        }
        return;
      }

      if (type === 'importLayout') {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'JSON Files': ['json'] },
          canSelectMany: false,
        });
        if (!uris || uris.length === 0) return;
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
          const imported = JSON.parse(raw) as Record<string, unknown>;
          this.bridge.setLayout(imported);
          const layoutLoaded: OfficeToWebviewMessage = { type: 'layoutLoaded', layout: imported };
          webviewView.webview.postMessage(layoutLoaded);
          vscode.window.showInformationMessage('LingYun Office: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('LingYun Office: Failed to read or parse layout file.');
        }
        return;
      }
    });

    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
        this.webviewReady = false;
        this.pendingResetToDefault = false;
      }
      this.messageDisposable?.dispose();
      this.messageDisposable = undefined;
      this.bridge.detachWebview();
    });
  }

  resetLayoutToDefault(): boolean {
    if (!this.webviewView) return false;

    if (!this.webviewReady) {
      this.pendingResetToDefault = true;
      return true;
    }

    try {
      const reset: OfficeToWebviewMessage = { type: 'resetLayoutToDefault' };
      void this.webviewView.webview.postMessage(reset);
      return true;
    } catch {
      return false;
    }
  }

  reloadWebview(): boolean {
    if (!this.webviewView) return false;
    this.webviewReady = false;
    this.webviewView.webview.html = getWebviewContent(this.webviewView.webview, this.context.extensionUri);
    return true;
  }

  private async deleteSession(sessionId: string): Promise<void> {
    if (this.chat.isProcessing) {
      vscode.window.showInformationMessage('LingYun: Stop the current task before closing a session.');
      return;
    }

    const active = this.chat.activeSessionId;
    if (!this.chat.sessions.has(sessionId)) return;
    if (this.chat.sessions.size <= 1) {
      vscode.window.showInformationMessage('LingYun: Cannot close the last session.');
      return;
    }

    this.chat.sessions.delete(sessionId);
    this.chat.dirtySessionIds.delete(sessionId);

    if (active === sessionId) {
      const fallback = this.chat.sessions.keys().next().value as string | undefined;
      if (fallback) {
        this.chat.switchToSessionSync(fallback);
      }
    }

    this.chat.postSessions();
    await this.chat.sendInit(true);
    this.chat.markSessionDirty(this.chat.activeSessionId);
    await this.chat.flushSessionSave();
  }
}
