import * as vscode from 'vscode';
import type { DebugRedactionLevel } from './agent/debug';

export type DebugSettings = {
  details: boolean;
  llm: boolean;
  tools: boolean;
  plugins: boolean;
};

export function getDebugSettings(config?: vscode.WorkspaceConfiguration): DebugSettings {
  const cfg = config ?? vscode.workspace.getConfiguration('lingyun');
  const details = cfg.get<boolean>('debug.details') ?? false;

  return {
    details,
    llm: details || (cfg.get<boolean>('debug.llm') ?? false),
    tools: details || (cfg.get<boolean>('debug.tools') ?? false),
    plugins: details || (cfg.get<boolean>('debug.plugins') ?? false),
  };
}

export function getDebugRedactionLevel(config?: vscode.WorkspaceConfiguration): DebugRedactionLevel {
  return getDebugSettings(config).details ? 'secrets-only' : 'full';
}
