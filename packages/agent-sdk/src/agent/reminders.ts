import type { AgentHistoryMessage } from '@kooka/core';
import { createSystemHistoryMessage } from '@kooka/core';

import { BUILD_SWITCH_PROMPT, PLAN_PROMPT } from './prompts.js';

type ReminderOptions = {
  prompts?: {
    planPrompt?: string;
    buildSwitchPrompt?: string;
  };
};

type ModeReminderKind = 'plan' | 'build-switch';

function wrapSystemReminder(text: string): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  return `<system-reminder>\n${trimmed}\n</system-reminder>`;
}

function getModeReminderText(kind: ModeReminderKind, options?: ReminderOptions): string {
  if (kind === 'plan') {
    return wrapSystemReminder(options?.prompts?.planPrompt ?? PLAN_PROMPT);
  }
  return wrapSystemReminder(options?.prompts?.buildSwitchPrompt ?? BUILD_SWITCH_PROMPT);
}

function getLastExplicitMode(history: readonly AgentHistoryMessage[]): 'build' | 'plan' | undefined {
  for (let idx = history.length - 1; idx >= 0; idx--) {
    const mode = history[idx]?.metadata?.modeReminder?.mode;
    if (mode === 'build' || mode === 'plan') {
      return mode;
    }
  }
  return undefined;
}

function getLastAssistantMode(history: readonly AgentHistoryMessage[]): 'build' | 'plan' | undefined {
  for (let idx = history.length - 1; idx >= 0; idx--) {
    const message = history[idx];
    if (message?.role !== 'assistant') continue;
    const mode = message.metadata?.mode;
    if (mode === 'build' || mode === 'plan') {
      return mode;
    }
  }
  return undefined;
}

export function getLastPromptMode(history: readonly AgentHistoryMessage[]): 'build' | 'plan' | undefined {
  return getLastExplicitMode(history) ?? getLastAssistantMode(history);
}

export function appendModeReminderMessage(
  history: AgentHistoryMessage[],
  mode: 'build' | 'plan',
  options?: ReminderOptions,
): AgentHistoryMessage[] {
  const previousMode = getLastPromptMode(history);

  if (mode === 'plan') {
    if (previousMode === 'plan') return history;
    history.push(
      createSystemHistoryMessage(getModeReminderText('plan', options), {
        synthetic: true,
        modeReminder: { mode: 'plan', kind: 'plan' },
      }),
    );
    return history;
  }

  if (previousMode !== 'plan') return history;

  history.push(
    createSystemHistoryMessage(getModeReminderText('build-switch', options), {
      synthetic: true,
      modeReminder: { mode: 'build', kind: 'build-switch' },
    }),
  );
  return history;
}
