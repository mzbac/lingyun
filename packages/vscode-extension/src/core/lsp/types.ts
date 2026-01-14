import * as vscode from 'vscode';

export type LspTouchOptions = {
  waitForDiagnostics?: boolean;
  debounceMs?: number;
  timeoutMs?: number;
  cancellationToken?: vscode.CancellationToken;
};

export interface LspAdapter {
  touchFile(uri: vscode.Uri, options?: LspTouchOptions): Promise<readonly vscode.Diagnostic[]>;

  workspaceSymbol(query: string): Promise<vscode.SymbolInformation[]>;
  documentSymbol(uri: vscode.Uri): Promise<Array<vscode.SymbolInformation | vscode.DocumentSymbol>>;

  goToDefinition(uri: vscode.Uri, position: vscode.Position): Promise<Array<vscode.Location | vscode.LocationLink>>;
  findReferences(uri: vscode.Uri, position: vscode.Position): Promise<Array<vscode.Location | vscode.LocationLink>>;
  goToImplementation(
    uri: vscode.Uri,
    position: vscode.Position
  ): Promise<Array<vscode.Location | vscode.LocationLink>>;

  hover(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Hover[]>;

  prepareCallHierarchy(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[]>;
  incomingCallsAtPosition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyIncomingCall[]>;
  outgoingCallsAtPosition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyOutgoingCall[]>;
  incomingCallsForItem(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[]>;
  outgoingCallsForItem(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[]>;
}

