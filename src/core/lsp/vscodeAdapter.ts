import * as vscode from 'vscode';

import type { LspAdapter, LspTouchOptions } from './types';

const DEFAULT_DIAGNOSTIC_DEBOUNCE_MS = 150;
const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 3000;

function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
  return a.toString() === b.toString();
}

async function waitForDiagnostics(uri: vscode.Uri, options?: LspTouchOptions): Promise<readonly vscode.Diagnostic[]> {
  const debounceMs =
    typeof options?.debounceMs === 'number' && options.debounceMs > 0
      ? Math.floor(options.debounceMs)
      : DEFAULT_DIAGNOSTIC_DEBOUNCE_MS;
  const timeoutMs =
    typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : DEFAULT_DIAGNOSTIC_TIMEOUT_MS;

  const token = options?.cancellationToken;

  return await new Promise((resolve) => {
    let settled = false;
    let debounceTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      onChange.dispose();
      cancelListener?.dispose();
      resolve(vscode.languages.getDiagnostics(uri));
    };

    const scheduleFinish = () => {
      if (settled) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(finish, debounceMs);
    };

    const onChange = vscode.languages.onDidChangeDiagnostics((event) => {
      if (event.uris.some((u) => sameUri(u, uri))) {
        scheduleFinish();
      }
    });

    const cancelListener = token ? token.onCancellationRequested(() => finish()) : undefined;

    timeoutTimer = setTimeout(finish, timeoutMs);

    // If diagnostics never change for this URI, resolve after a short debounce with whatever VS Code currently has.
    scheduleFinish();
  });
}

export class VsCodeLspAdapter implements LspAdapter {
  async touchFile(uri: vscode.Uri, options?: LspTouchOptions): Promise<readonly vscode.Diagnostic[]> {
    await vscode.workspace.openTextDocument(uri);

    if (!options?.waitForDiagnostics) {
      return vscode.languages.getDiagnostics(uri);
    }

    return waitForDiagnostics(uri, options);
  }

  async workspaceSymbol(query: string): Promise<vscode.SymbolInformation[]> {
    const raw = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', query);
    return Array.isArray(raw) ? (raw as vscode.SymbolInformation[]) : [];
  }

  async documentSymbol(uri: vscode.Uri): Promise<Array<vscode.SymbolInformation | vscode.DocumentSymbol>> {
    const raw = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
    return Array.isArray(raw) ? (raw as Array<vscode.SymbolInformation | vscode.DocumentSymbol>) : [];
  }

  async goToDefinition(
    uri: vscode.Uri,
    position: vscode.Position
  ): Promise<Array<vscode.Location | vscode.LocationLink>> {
    const raw = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position);
    return Array.isArray(raw) ? (raw as Array<vscode.Location | vscode.LocationLink>) : [];
  }

  async findReferences(
    uri: vscode.Uri,
    position: vscode.Position
  ): Promise<Array<vscode.Location | vscode.LocationLink>> {
    const raw = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position);
    return Array.isArray(raw) ? (raw as Array<vscode.Location | vscode.LocationLink>) : [];
  }

  async goToImplementation(
    uri: vscode.Uri,
    position: vscode.Position
  ): Promise<Array<vscode.Location | vscode.LocationLink>> {
    const raw = await vscode.commands.executeCommand('vscode.executeImplementationProvider', uri, position);
    return Array.isArray(raw) ? (raw as Array<vscode.Location | vscode.LocationLink>) : [];
  }

  async hover(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Hover[]> {
    const raw = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position);
    return Array.isArray(raw) ? (raw as vscode.Hover[]) : [];
  }

  async prepareCallHierarchy(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[]> {
    const raw = await vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, position);
    return Array.isArray(raw) ? (raw as vscode.CallHierarchyItem[]) : [];
  }

  async incomingCallsForItem(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[]> {
    const raw = await vscode.commands.executeCommand('vscode.provideIncomingCalls', item);
    return Array.isArray(raw) ? (raw as vscode.CallHierarchyIncomingCall[]) : [];
  }

  async outgoingCallsForItem(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[]> {
    const raw = await vscode.commands.executeCommand('vscode.provideOutgoingCalls', item);
    return Array.isArray(raw) ? (raw as vscode.CallHierarchyOutgoingCall[]) : [];
  }

  async incomingCallsAtPosition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyIncomingCall[]> {
    const items = await this.prepareCallHierarchy(uri, position);
    if (items.length === 0) return [];
    return this.incomingCallsForItem(items[0]);
  }

  async outgoingCallsAtPosition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyOutgoingCall[]> {
    const items = await this.prepareCallHierarchy(uri, position);
    if (items.length === 0) return [];
    return this.outgoingCallsForItem(items[0]);
  }
}

