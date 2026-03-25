import * as vscode from 'vscode';

import type { AgentLoop } from '../core/agent';
import type { LLMProviderWithUi } from '../providers/providerUi';
import { ChatController } from './chat/controller';

export { ChatController } from './chat/controller';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lingyun.chatView';
  readonly controller: ChatController;

  constructor(
    context: vscode.ExtensionContext,
    agent: AgentLoop,
    llmProvider?: LLMProviderWithUi,
    outputChannel?: vscode.OutputChannel,
  ) {
    this.controller = new ChatController(context, agent, llmProvider, outputChannel);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.controller.webviewApi.resolveWebviewView(webviewView);
  }
}
