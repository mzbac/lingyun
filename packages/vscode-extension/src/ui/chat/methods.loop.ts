import * as vscode from 'vscode';

import { appendErrorLog } from '../../core/logger';

import {
  formatLoopIntervalLabel,
  normalizeLoopIntervalMinutes,
  type ChatLoopDefaults,
  type ChatLoopManager,
} from './loopManager';
import { bindChatControllerService } from './controllerService';
import { postWebviewInputNotice as postInputNotice } from './inputNotice';
import type { RunCoordinator } from './runner/runCoordinator';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';
import type { ChatSessionInfo } from './types';

export type LoopSessionSettingsInput = {
  enabled?: boolean;
  intervalMinutes?: number;
  prompt?: string;
};

export type LoopWorkspaceDefaultsInput = {
  enabled?: boolean;
  intervalMinutes?: number;
  prompt?: string;
};

export interface ChatLoopService {
  getLoopStateForUI(session?: ChatSessionInfo): ReturnType<ChatLoopManager['getSessionStatus']>;
  getLoopDefaultsForUI(): ChatLoopDefaults;
  postLoopState(session?: ChatSessionInfo): void;
  postLoopDefaults(): void;
  injectLoopPrompt(prompt?: string): Promise<boolean>;
  setLoopSettingsForActiveSession(settings: LoopSessionSettingsInput): Promise<void>;
  resetLoopSettingsForActiveSession(): Promise<void>;
  setLoopWorkspaceDefaults(settings: LoopWorkspaceDefaultsInput): Promise<void>;
}

export interface ChatLoopDeps {
  view?: vscode.WebviewView;
  activeSessionId: string;
  isProcessing: boolean;
  outputChannel?: vscode.OutputChannel;
  loopManager: ChatLoopManager;
  runner: Pick<RunCoordinator, 'triggerLoopPrompt'>;
  sessionApi: Pick<ChatSessionsService, 'getActiveSession' | 'persistActiveSession'>;
  webviewApi: Pick<ChatWebviewService, 'postMessage'>;
}

export function createChatLoopService(controller: ChatLoopDeps): ChatLoopService {
  const service = bindChatControllerService(controller, {
    getLoopStateForUI(this: ChatLoopDeps, session: ChatSessionInfo = this.sessionApi.getActiveSession()) {
      return this.loopManager.getSessionStatus(session);
    },

    getLoopDefaultsForUI(this: ChatLoopDeps): ChatLoopDefaults {
      return this.loopManager.getDefaults();
    },

    postLoopState(this: ChatLoopDeps, session: ChatSessionInfo = this.sessionApi.getActiveSession()): void {
      if (session.id !== this.activeSessionId) return;
      this.webviewApi.postMessage({
        type: 'loopState',
        loop: service.getLoopStateForUI(session),
      });
    },

    postLoopDefaults(this: ChatLoopDeps): void {
      this.webviewApi.postMessage({
        type: 'loopDefaultsState',
        loopDefaults: service.getLoopDefaultsForUI(),
      });
    },

    async injectLoopPrompt(this: ChatLoopDeps, prompt?: string): Promise<boolean> {
      const session = this.sessionApi.getActiveSession();
      const status = this.loopManager.getSessionStatus(session);
      if (!this.view) return false;
      if (this.activeSessionId !== session.id) return false;
      if (!status.canRunNow) return false;

      const raw = typeof prompt === 'string' && prompt.trim() ? prompt.trim() : status.prompt;
      return await this.runner.triggerLoopPrompt(raw);
    },

    async setLoopSettingsForActiveSession(this: ChatLoopDeps, settings: LoopSessionSettingsInput): Promise<void> {
      const session = this.sessionApi.getActiveSession();
      const postCurrentState = () => service.postLoopState(session);

      if (session.parentSessionId || session.subagentType) {
        postInputNotice(this, 'Loop steering is only available for top-level sessions.');
        postCurrentState();
        service.postLoopDefaults();
        return;
      }

      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before changing loop steering.');
        postCurrentState();
        service.postLoopDefaults();
        return;
      }

      const current = this.loopManager.getSessionStatus(session);
      const raw = settings && typeof settings === 'object' ? settings : {};
      const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : current.enabled;
      const intervalSource = Object.prototype.hasOwnProperty.call(raw, 'intervalMinutes')
        ? raw.intervalMinutes
        : current.intervalMinutes;
      const intervalNumber = Number(intervalSource);
      const prompt = Object.prototype.hasOwnProperty.call(raw, 'prompt')
        ? String(raw.prompt ?? '').trim()
        : current.prompt;

      if (!Number.isFinite(intervalNumber) || intervalNumber < 1 || intervalNumber > 24 * 60) {
        postInputNotice(this, 'Loop interval must be between 1 and 1440 minutes.');
        postCurrentState();
        return;
      }
      if (!prompt) {
        postInputNotice(this, 'Loop prompt cannot be empty.');
        postCurrentState();
        return;
      }

      this.loopManager.updateSessionState(session.id, (currentState) => ({
        ...currentState,
        enabled,
        intervalMinutes: normalizeLoopIntervalMinutes(intervalNumber),
        prompt,
      }));
      service.postLoopState(session);
      service.postLoopDefaults();
      this.sessionApi.persistActiveSession();
    },

    async resetLoopSettingsForActiveSession(this: ChatLoopDeps): Promise<void> {
      const session = this.sessionApi.getActiveSession();
      const postCurrentState = () => service.postLoopState(session);

      if (session.parentSessionId || session.subagentType) {
        postInputNotice(this, 'Loop steering is only available for top-level sessions.');
        postCurrentState();
        service.postLoopDefaults();
        return;
      }

      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before changing loop steering.');
        postCurrentState();
        service.postLoopDefaults();
        return;
      }

      const defaults = this.loopManager.getDefaults();
      this.loopManager.updateSessionState(session.id, () => ({
        enabled: defaults.enabled,
        intervalMinutes: defaults.intervalMinutes,
        prompt: defaults.prompt,
      }));
      service.postLoopState(session);
      service.postLoopDefaults();
      this.sessionApi.persistActiveSession();
    },

    async setLoopWorkspaceDefaults(this: ChatLoopDeps, settings: LoopWorkspaceDefaultsInput): Promise<void> {
      const session = this.sessionApi.getActiveSession();
      const postCurrentState = () => {
        service.postLoopDefaults();
        service.postLoopState(session);
      };

      if (this.isProcessing) {
        postInputNotice(this, 'Stop the current task before changing loop workspace defaults.');
        postCurrentState();
        return;
      }

      const current = this.loopManager.getDefaults();
      const raw = settings && typeof settings === 'object' ? settings : {};
      const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : current.enabled;
      const intervalSource = Object.prototype.hasOwnProperty.call(raw, 'intervalMinutes')
        ? raw.intervalMinutes
        : current.intervalMinutes;
      const intervalNumber = Number(intervalSource);
      const prompt = Object.prototype.hasOwnProperty.call(raw, 'prompt')
        ? String(raw.prompt ?? '').trim()
        : current.prompt;

      if (!Number.isFinite(intervalNumber) || intervalNumber < 1 || intervalNumber > 24 * 60) {
        postInputNotice(this, 'Default loop interval must be between 1 and 1440 minutes.');
        postCurrentState();
        return;
      }
      if (!prompt) {
        postInputNotice(this, 'Default loop prompt cannot be empty.');
        postCurrentState();
        return;
      }

      const normalized: ChatLoopDefaults = {
        enabled,
        intervalMinutes: normalizeLoopIntervalMinutes(intervalNumber),
        prompt,
      };

      try {
        const config = vscode.workspace.getConfiguration('lingyun');
        await config.update('loop.enabled', normalized.enabled, true);
        await config.update('loop.intervalMinutes', normalized.intervalMinutes, true);
        await config.update('loop.prompt', normalized.prompt, true);
        service.postLoopDefaults();
        service.postLoopState(session);
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to persist loop workspace defaults', error, {
          tag: 'Loop',
        });
        postInputNotice(this, 'Failed to update loop workspace defaults. See logs for details.');
        postCurrentState();
      }
    },
  });

  return service;
}
