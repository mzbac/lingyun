import * as vscode from 'vscode';

import type { AgentLoop } from '../../core/agent';

import { bindChatControllerService } from './controllerService';
import type { ChatLoopManager } from './loopManager';
import type { ChatLoopService } from './methods.loop';
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
  loopManager: Pick<ChatLoopManager, 'syncActiveSession'>;
  loopApi: Pick<ChatLoopService, 'postLoopState'>;
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
        } catch {
          // Ignore persistence errors; mode still updates for this session.
        }
      }

      if (changed && options?.notifyWebview !== false) {
        this.webviewApi.postMessage({ type: 'modeChanged', mode: nextMode });
      }

      if (changed) {
        this.loopManager.syncActiveSession();
        this.loopApi.postLoopState();
      }

      if (changed && options?.persistSession !== false) {
        this.sessionApi.persistActiveSession();
      }
    },
  });
}
