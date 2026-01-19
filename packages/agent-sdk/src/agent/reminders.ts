import type { AgentHistoryMessage } from '@kooka/core';
import { BUILD_SWITCH_PROMPT, PLAN_PROMPT } from './prompts.js';

type ReminderOptions = {
  allowExternalPaths?: boolean;
};

function wrapSystemReminder(text: string): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  return `<system-reminder>\n${trimmed}\n</system-reminder>`;
}

export function insertModeReminders(
  history: AgentHistoryMessage[],
  mode: 'build' | 'plan',
  options?: ReminderOptions,
): AgentHistoryMessage[] {
  let lastUserIndex = -1;
  for (let idx = history.length - 1; idx >= 0; idx--) {
    if (history[idx].role === 'user') {
      lastUserIndex = idx;
      break;
    }
  }

  if (lastUserIndex === -1) return history;

  const additions: string[] = [];
  if (mode === 'plan') {
    additions.push(wrapSystemReminder(PLAN_PROMPT));
  }

  const wasPlan = history.some((msg) => msg.role === 'assistant' && msg.metadata?.mode === 'plan');
  if (wasPlan && mode === 'build') {
    additions.push(wrapSystemReminder(BUILD_SWITCH_PROMPT));
  }

  if (typeof options?.allowExternalPaths === 'boolean') {
    additions.push(
      wrapSystemReminder(
        options.allowExternalPaths
          ? 'External paths are enabled (allowExternalPaths=true). Tools like list/read can access paths outside the workspace.'
          : 'External paths are disabled (allowExternalPaths=false). Tools must stay within the current workspace.',
      ),
    );
  }

  if (additions.length === 0) return history;

  const out = history.slice();
  const userMessage = history[lastUserIndex];
  const parts = [...userMessage.parts];
  for (const text of additions) {
    parts.push({ type: 'text', text } as any);
  }
  out[lastUserIndex] = { ...userMessage, parts };
  return out;
}
