import * as vscode from 'vscode';

import { formatLoopIntervalLabel } from './loopManager';
import type { ChatController } from './controller';
import type { ChatSessionInfo } from './types';

type LoopAction = 'enable' | 'disable' | 'interval' | 'prompt' | 'reset';

type LoopActionItem = vscode.QuickPickItem & {
  action: LoopAction;
};

function truncatePrompt(prompt: string, maxChars = 90): string {
  const text = (prompt || '').trim();
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function formatNextFire(nextFireAt: number | undefined): string | undefined {
  if (typeof nextFireAt !== 'number' || !Number.isFinite(nextFireAt) || nextFireAt <= 0) {
    return undefined;
  }
  return new Date(nextFireAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function pickLoopInterval(currentMinutes: number): Promise<number | undefined> {
  const presets = [5, 10, 15, 30, 60, 120];
  const items: Array<vscode.QuickPickItem & { minutes?: number; custom?: true }> = presets.map(
    minutes => ({
      label: `${minutes} minutes`,
      description: minutes === currentMinutes ? 'Current' : undefined,
      minutes,
    })
  );

  items.push({
    label: 'Custom…',
    description: 'Enter a custom interval in minutes',
    custom: true,
  });

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Loop interval',
    placeHolder: 'Choose how often the steering loop should run',
    ignoreFocusOut: true,
  });

  if (!selected) return undefined;
  if (selected.custom) {
    const input = await vscode.window.showInputBox({
      title: 'Custom loop interval',
      prompt: 'Enter the loop interval in minutes',
      value: String(currentMinutes || 5),
      ignoreFocusOut: true,
      validateInput: value => {
        const parsed = Number(value.trim());
        if (!Number.isFinite(parsed) || parsed < 1) {
          return 'Enter a whole number of minutes greater than or equal to 1.';
        }
        if (parsed > 24 * 60) {
          return 'Enter a value less than or equal to 1440 minutes.';
        }
        return undefined;
      },
    });

    if (!input) return undefined;
    return Math.max(1, Math.min(24 * 60, Math.floor(Number(input.trim()))));
  }

  return selected.minutes;
}

async function pickLoopPrompt(currentPrompt: string): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title: 'Loop prompt',
    prompt: 'Prompt injected into the active run on each loop tick',
    value: currentPrompt,
    ignoreFocusOut: true,
    validateInput: value => {
      if (!value.trim()) return 'Prompt cannot be empty.';
      return undefined;
    },
  });

  if (!input) return undefined;
  return input.trim();
}

export function installLoopMethods(controller: ChatController): void {
  Object.assign(controller, {
    getLoopStateForUI(this: ChatController, session: ChatSessionInfo = this.getActiveSession()) {
      return this.loopManager.getSessionStatus(session);
    },

    postLoopState(this: ChatController, session: ChatSessionInfo = this.getActiveSession()): void {
      if (session.id !== this.activeSessionId) return;
      this.postMessage({
        type: 'loopState',
        loop: this.getLoopStateForUI(session),
      });
    },

    async injectLoopPrompt(this: ChatController, prompt?: string): Promise<boolean> {
      const session = this.getActiveSession();
      const status = this.loopManager.getSessionStatus(session);
      if (!this.view) return false;
      if (this.activeSessionId !== session.id) return false;
      if (!status.canRunNow) return false;

      const raw = typeof prompt === 'string' && prompt.trim() ? prompt.trim() : status.prompt;
      return await this.runner.triggerLoopPrompt(raw);
    },

    async configureLoopForActiveSession(this: ChatController): Promise<void> {
      const session = this.getActiveSession();
      const loopState = this.loopManager.getSessionStatus(session);

      if (session.parentSessionId || session.subagentType) {
        void vscode.window.showInformationMessage(
          'LingYun: Loop steering is only available for top-level sessions.'
          );
        return;
      }

      const nextFireText = formatNextFire(loopState.nextFireAt);
      const items: LoopActionItem[] = [
        {
          label: loopState.enabled ? 'Disable loop' : 'Enable loop',
          detail: `${formatLoopIntervalLabel(loopState.intervalMinutes)}${nextFireText ? ` · next ${nextFireText}` : ''}`,
          action: loopState.enabled ? 'disable' : 'enable',
        },
        {
          label: 'Change interval',
          detail: `Current: ${formatLoopIntervalLabel(loopState.intervalMinutes)}`,
          action: 'interval',
        },
        {
          label: 'Change prompt',
          detail: truncatePrompt(loopState.prompt) || 'Current prompt',
          action: 'prompt',
        },
        {
          label: 'Reset to workspace defaults',
          detail: 'Restore enabled state, interval, and prompt from settings',
          action: 'reset',
        },
      ];

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Loop steering',
        placeHolder: 'Enable, disable, or configure this session loop',
        ignoreFocusOut: true,
      });

      if (!picked) return;

      let changed = false;
      let nextLoop = loopState;

      if (picked.action === 'enable') {
        this.loopManager.updateSessionState(session.id, current => ({
          ...current,
          enabled: true,
        }));
        changed = true;
      } else if (picked.action === 'disable') {
        this.loopManager.updateSessionState(session.id, current => ({
          ...current,
          enabled: false,
        }));
        changed = true;
      } else if (picked.action === 'interval') {
        const minutes = await pickLoopInterval(loopState.intervalMinutes);
        if (!minutes) return;
        this.loopManager.updateSessionState(session.id, current => ({
          ...current,
          intervalMinutes: minutes,
        }));
        changed = true;
      } else if (picked.action === 'prompt') {
        const prompt = await pickLoopPrompt(loopState.prompt);
        if (!prompt) return;
        this.loopManager.updateSessionState(session.id, current => ({
          ...current,
          prompt,
        }));
        changed = true;
      } else if (picked.action === 'reset') {
        const defaults = this.loopManager.getDefaults();
        this.loopManager.updateSessionState(session.id, () => ({
          enabled: defaults.enabled,
          intervalMinutes: defaults.intervalMinutes,
          prompt: defaults.prompt,
        }));
        changed = true;
      }

      if (!changed) return;

      nextLoop = this.loopManager.getSessionStatus(session);

      this.postLoopState(session);
      this.persistActiveSession();

      const stateLabel = nextLoop.enabled ? 'enabled' : 'disabled';
      const pausedSuffix = nextLoop.enabled && !nextLoop.canRunNow ? ` ${nextLoop.statusText}` : '';
      void vscode.window.showInformationMessage(
        `LingYun: Loop ${stateLabel} for this session (${formatLoopIntervalLabel(nextLoop.intervalMinutes)}).${pausedSuffix}`
      );
    },
  });
}
