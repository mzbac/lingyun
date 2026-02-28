import * as vscode from 'vscode';

import type { AgentLoop } from '../core/agent';
import type { ToolDiffSnapshot } from './chat/runner/callbackUtils';
import type { LLMProviderWithModels } from './chat/controller';
import { ChatController } from './chat/controller';

export { ChatController, installChatControllerMethods } from './chat/controller';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lingyun.chatView';

  readonly controller: ChatController;

  constructor(
    context: vscode.ExtensionContext,
    agent: AgentLoop,
    llmProvider?: LLMProviderWithModels,
    outputChannel?: vscode.OutputChannel,
  ) {
    this.controller = new ChatController(context, agent, llmProvider, outputChannel);
  }

  // Used by the diff content provider.
  get toolDiffSnapshotsByToolCallId(): Map<string, ToolDiffSnapshot> {
    return this.controller.toolDiffSnapshotsByToolCallId as any;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.controller.resolveWebviewView(webviewView);
  }

  // Facade methods used by extension.ts commands/config listeners.
  setBackend(...args: Parameters<ChatController['setBackend']>): ReturnType<ChatController['setBackend']> {
    return (this.controller.setBackend as any)(...args);
  }

  sendMessage(...args: Parameters<ChatController['sendMessage']>): ReturnType<ChatController['sendMessage']> {
    return (this.controller.sendMessage as any)(...args);
  }

  clearCurrentSession(...args: Parameters<ChatController['clearCurrentSession']>): ReturnType<ChatController['clearCurrentSession']> {
    return (this.controller.clearCurrentSession as any)(...args);
  }

  clearSavedSessions(...args: Parameters<ChatController['clearSavedSessions']>): ReturnType<ChatController['clearSavedSessions']> {
    return (this.controller.clearSavedSessions as any)(...args);
  }

  compactCurrentSession(...args: Parameters<ChatController['compactCurrentSession']>): ReturnType<ChatController['compactCurrentSession']> {
    return (this.controller.compactCurrentSession as any)(...args);
  }

  undo(...args: Parameters<ChatController['undo']>): ReturnType<ChatController['undo']> {
    return (this.controller.undo as any)(...args);
  }

  redo(...args: Parameters<ChatController['redo']>): ReturnType<ChatController['redo']> {
    return (this.controller.redo as any)(...args);
  }

  onAutoApproveEnabled(...args: Parameters<ChatController['onAutoApproveEnabled']>): ReturnType<ChatController['onAutoApproveEnabled']> {
    return (this.controller.onAutoApproveEnabled as any)(...args);
  }

  onSessionPersistenceConfigChanged(...args: Parameters<ChatController['onSessionPersistenceConfigChanged']>): ReturnType<ChatController['onSessionPersistenceConfigChanged']> {
    return (this.controller.onSessionPersistenceConfigChanged as any)(...args);
  }
}

