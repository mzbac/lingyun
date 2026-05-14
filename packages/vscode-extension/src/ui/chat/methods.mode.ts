import * as vscode from 'vscode';

import type { AgentLoop } from '../../core/agent';
import { appendErrorLog } from '../../core/logger';

import { bindChatControllerService } from './controllerService';
import { postWebviewInputNotice as postInputNotice } from './inputNotice';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';
import type { ChatMode } from './types';

export interface ChatModeService {
  setModeAndPersist(
    mode: ChatMode,
    options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
  ): Promise<void>;
}

export interface ChatModeDeps {
  mode: ChatMode;
  agent: Pick<AgentLoop, 'setMode'>;
  outputChannel?: vscode.OutputChannel;
  sessionApi: Pick<ChatSessionsService, 'persistActiveSession'>;
  webviewApi: Pick<ChatWebviewService, 'postMessage'>;
}

export function createChatModeService(controller: ChatModeDeps): ChatModeService {
  return bindChatControllerService(controller, {
    async setModeAndPersist(
      this: ChatModeDeps,
      mode: ChatMode,
      options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
    ): Promise<void> {
      const nextMode: ChatMode = mode === 'plan' ? 'plan' : 'build';
      const changed = this.mode !== nextMode;
      this.mode = nextMode;
      this.agent.setMode(nextMode);

      if (changed && options?.persistConfig !== false) {
        try {
          await vscode.workspace.getConfiguration('lingyun').update('mode', nextMode, true);
        } catch (error) {
          appendErrorLog(this.outputChannel, 'Failed to persist chat mode setting', error, { tag: 'Mode' });
          postInputNotice(this, 'Mode changed for this session, but failed to save as the default. See logs for details.');
        }
      }

      if (changed && options?.notifyWebview !== false) {
        this.webviewApi.postMessage({ type: 'modeChanged', mode: nextMode });
      }

      if (changed && options?.persistSession !== false) {
        this.sessionApi.persistActiveSession();
      }
    },
  });
}
