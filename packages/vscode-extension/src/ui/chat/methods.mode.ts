import * as vscode from 'vscode';
import type { ChatMode } from './types';
import type { ChatController } from './controller';

export function installModeMethods(controller: ChatController): void {
  Object.assign(controller, {
    async setModeAndPersist(
      this: ChatController,
      mode: ChatMode,
      options?: { persistConfig?: boolean; notifyWebview?: boolean; persistSession?: boolean }
    ): Promise<void> {
      const nextMode: ChatMode = mode === 'plan' ? 'plan' : 'build';
      const changed = this.mode !== nextMode;
      this.mode = nextMode;
      this.agent.setMode(nextMode);

      const persistConfig = options?.persistConfig !== false;
      if (persistConfig && changed) {
        try {
          await vscode.workspace.getConfiguration('lingyun').update('mode', nextMode, true);
        } catch {
          // Ignore persistence errors; mode still updated for this session.
        }
      }

      const notifyWebview = options?.notifyWebview !== false;
      if (notifyWebview && changed) {
        this.postMessage({ type: 'modeChanged', mode: nextMode });
      }

      const persistSession = options?.persistSession !== false;
      if (persistSession && changed) {
        this.persistActiveSession();
      }
    },
  });
}
