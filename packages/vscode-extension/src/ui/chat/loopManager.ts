import * as vscode from 'vscode';

import type { ChatController } from './controller';
import type { ChatLoopUiState, ChatMode, ChatSessionInfo, ChatSessionLoopState } from './types';

const DEFAULT_LOOP_INTERVAL_MINUTES = 5;
const DEFAULT_LOOP_PROMPT =
  'review your recent activity - has it been in alignment with our principles? ./AGENTS.md';
const MIN_LOOP_INTERVAL_MINUTES = 1;
const MAX_LOOP_INTERVAL_MINUTES = 24 * 60;

export type ChatLoopDefaults = {
  enabled: boolean;
  intervalMinutes: number;
  prompt: string;
};

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function normalizeLoopIntervalMinutes(
  value: unknown,
  fallback = DEFAULT_LOOP_INTERVAL_MINUTES
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(numeric)) {
    return Math.min(MAX_LOOP_INTERVAL_MINUTES, Math.max(MIN_LOOP_INTERVAL_MINUTES, fallback));
  }

  return Math.min(
    MAX_LOOP_INTERVAL_MINUTES,
    Math.max(MIN_LOOP_INTERVAL_MINUTES, Math.floor(numeric))
  );
}

export function getLoopDefaults(): ChatLoopDefaults {
  const config = vscode.workspace.getConfiguration('lingyun');
  const enabled = config.get<boolean>('loop.enabled', false) ?? false;
  const intervalMinutes = normalizeLoopIntervalMinutes(
    config.get<number>('loop.intervalMinutes', DEFAULT_LOOP_INTERVAL_MINUTES) ??
      DEFAULT_LOOP_INTERVAL_MINUTES
  );
  const prompt =
    config.get<string>('loop.prompt', DEFAULT_LOOP_PROMPT)?.trim() || DEFAULT_LOOP_PROMPT;

  return {
    enabled,
    intervalMinutes,
    prompt,
  };
}

export function formatLoopIntervalLabel(intervalMinutes: number): string {
  const minutes = normalizeLoopIntervalMinutes(intervalMinutes);
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'every hour' : `every ${hours} hours`;
  }
  if (minutes === 1) return 'every minute';
  return `every ${minutes} minutes`;
}

export function normalizeSessionLoopState(
  raw: unknown,
  defaults: ChatLoopDefaults = getLoopDefaults()
): ChatSessionLoopState {
  const state = raw && typeof raw === 'object' ? (raw as Partial<ChatSessionLoopState>) : {};

  return {
    enabled: typeof state.enabled === 'boolean' ? state.enabled : defaults.enabled,
    intervalMinutes: normalizeLoopIntervalMinutes(state.intervalMinutes, defaults.intervalMinutes),
    prompt: typeof state.prompt === 'string' && state.prompt.trim() ? state.prompt.trim() : defaults.prompt,
    ...(isFiniteTimestamp(state.lastFiredAt) ? { lastFiredAt: state.lastFiredAt } : {}),
    ...(isFiniteTimestamp(state.nextFireAt) ? { nextFireAt: state.nextFireAt } : {}),
  };
}

export class ChatLoopManager {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly controller: ChatController) {}

  getDefaults(): ChatLoopDefaults {
    return getLoopDefaults();
  }

  normalizeSessionState(raw: unknown): ChatSessionLoopState {
    return normalizeSessionLoopState(raw, this.getDefaults());
  }

  normalizeStoredSessionState(raw: unknown): ChatSessionLoopState {
    const normalized = normalizeSessionLoopState(raw, this.getDefaults());
    if (normalized.nextFireAt) {
      delete normalized.nextFireAt;
    }
    return normalized;
  }

  getSessionState(session: ChatSessionInfo = this.controller.getActiveSession()): ChatSessionLoopState {
    return session.loop ?? this.normalizeSessionState(undefined);
  }

  // Single source of truth for whether loop steering is available and runnable.
  // Scheduling, prompt injection, and UI state should all consume this resolved status
  // instead of re-deriving mode/history/pending-plan rules independently.
  getSessionStatus(session: ChatSessionInfo = this.controller.getActiveSession()): ChatLoopUiState {
    const loop = this.getSessionState(session);

    if (!this.isSessionEligible(session)) {
      return {
        ...loop,
        available: false,
        canRunNow: false,
        reason: 'unavailable',
        statusText: 'Loop steering is unavailable for subagent sessions.',
      };
    }

    if (!loop.enabled) {
      return {
        ...loop,
        available: true,
        canRunNow: false,
        reason: 'disabled',
        statusText: 'Loop is off for this session.',
      };
    }

    if (session.pendingPlan) {
      return {
        ...loop,
        available: true,
        canRunNow: false,
        reason: 'pending_plan',
        statusText: 'Loop is paused while a plan is awaiting review or execution.',
      };
    }

    if (this.getSessionMode(session) !== 'build') {
      return {
        ...loop,
        available: true,
        canRunNow: false,
        reason: 'plan_mode',
        statusText: 'Loop is paused until the session returns to Build mode.',
      };
    }

    if (
      session.id === this.controller.activeSessionId &&
      this.controller.isProcessing &&
      !this.controller.runner.canAcceptLoopSteer()
    ) {
      return {
        ...loop,
        available: true,
        canRunNow: false,
        reason: 'busy',
        statusText: 'Loop is paused until the current operation can accept steering.',
      };
    }

    if (!this.hasLoopContext(session)) {
      return {
        ...loop,
        available: true,
        canRunNow: false,
        reason: 'no_context',
        statusText: 'Loop is waiting for existing agent history before it can run.',
      };
    }

    return {
      ...loop,
      available: true,
      canRunNow: true,
      reason: 'ready',
      statusText: 'Loop is ready.',
    };
  }

  clearAllRuntimeData(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  releaseSession(session: ChatSessionInfo | undefined): void {
    if (!session) return;
    this.cancelTimer(session.id);
    const loop = this.ensureSessionState(session);
    if (loop?.nextFireAt) {
      loop.nextFireAt = undefined;
    }
  }

  hasLoopContext(session: ChatSessionInfo = this.controller.getActiveSession()): boolean {
    if (this.controller.runner.canAcceptLoopSteer()) {
      return true;
    }

    return this.getSessionHistoryLength(session) > 0;
  }

  onRunStart(sessionId = this.controller.activeSessionId): void {
    if (sessionId === this.controller.activeSessionId) {
      this.syncActiveSession();
    } else {
      this.armForSession(sessionId);
    }
    const session = this.controller.sessions.get(sessionId);
    if (session) {
      this.controller.postLoopState(session);
    }
  }

  onRunEnd(sessionId = this.controller.activeSessionId): void {
    const session = this.controller.sessions.get(sessionId);
    if (!session) return;
    if (sessionId === this.controller.activeSessionId) {
      this.syncActiveSession();
    } else {
      this.cancelTimer(sessionId);
    }
    this.controller.postLoopState(session);
  }

  syncActiveSession(
    options?: {
      resetSchedule?: boolean;
    }
  ): void {
    const activeSessionId = this.controller.activeSessionId;
    for (const [sessionId, session] of this.controller.sessions) {
      if (sessionId === activeSessionId) continue;
      this.cancelTimer(sessionId);
      if (session.loop?.nextFireAt) {
        session.loop.nextFireAt = undefined;
      }
    }

    const activeSession = this.controller.sessions.get(activeSessionId);
    if (!activeSession) return;

    if (!this.isSessionEligible(activeSession)) {
      this.cancelTimer(activeSessionId);
      if (activeSession.loop?.nextFireAt) {
        activeSession.loop.nextFireAt = undefined;
      }
      return;
    }

    const loop = this.ensureSessionState(activeSession);
    const status = this.getSessionStatus(activeSession);
    if (!status.available || !status.enabled) {
      this.cancelTimer(activeSessionId);
      if (loop.nextFireAt) {
        loop.nextFireAt = undefined;
      }
      return;
    }

    if (this.shouldPauseSchedule(status)) {
      this.cancelTimer(activeSessionId);
      this.ensurePausedSchedule(loop, options);
      return;
    }

    if (!status.canRunNow) {
      this.cancelTimer(activeSessionId);
      if (loop.nextFireAt) {
        loop.nextFireAt = undefined;
      }
      return;
    }

    this.armForSession(activeSessionId, options);
  }

  updateSessionState(
    sessionId: string,
    updater: (current: ChatSessionLoopState) => ChatSessionLoopState
  ): ChatSessionLoopState | undefined {
    const session = this.controller.sessions.get(sessionId);
    if (!session) return undefined;

    const next = this.normalizeSessionState(updater(this.ensureSessionState(session)));
    session.loop = next;

    if (!this.isSessionEligible(session) || !next.enabled) {
      this.cancelTimer(sessionId);
      session.loop.nextFireAt = undefined;
      return session.loop;
    }

    if (this.controller.activeSessionId === sessionId) {
      this.syncActiveSession({ resetSchedule: true });
    } else {
      this.cancelTimer(sessionId);
      session.loop.nextFireAt = undefined;
    }

    return session.loop;
  }

  private isSessionEligible(session: ChatSessionInfo | undefined): boolean {
    if (!session) return false;
    if (session.parentSessionId || session.subagentType) return false;
    return true;
  }

  private ensureSessionState(session: ChatSessionInfo): ChatSessionLoopState {
    const normalized = this.normalizeSessionState(session.loop);
    session.loop = normalized;
    return normalized;
  }

  private cancelTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  private getSessionHistoryLength(session: ChatSessionInfo): number {
    const state =
      session.id === this.controller.activeSessionId
        ? this.controller.agent.exportState()
        : session.agentState;
    const history = state?.history;
    return Array.isArray(history) ? history.length : 0;
  }

  private getSessionMode(session: ChatSessionInfo): ChatMode {
    return session.id === this.controller.activeSessionId ? this.controller.mode : session.mode;
  }

  private armForSession(
    sessionId: string,
    options?: {
      resetSchedule?: boolean;
    }
  ): void {
    const session = this.controller.sessions.get(sessionId);
    if (!this.isSessionEligible(session)) return;
    if (!session) return;

    const loop = this.ensureSessionState(session);
    const status = this.getSessionStatus(session);
    if (!status.available || !status.enabled) {
      this.cancelTimer(sessionId);
      loop.nextFireAt = undefined;
      return;
    }

    if (this.shouldPauseSchedule(status)) {
      this.cancelTimer(sessionId);
      this.ensurePausedSchedule(loop, options);
      return;
    }

    if (!status.canRunNow) {
      this.cancelTimer(sessionId);
      loop.nextFireAt = undefined;
      return;
    }

    if (this.controller.activeSessionId !== sessionId) {
      this.cancelTimer(sessionId);
      loop.nextFireAt = undefined;
      return;
    }

    const intervalMs = loop.intervalMinutes * 60_000;
    const nextFireAt =
      options?.resetSchedule || !isFiniteTimestamp(loop.nextFireAt)
        ? Date.now() + intervalMs
        : Math.max(Date.now(), loop.nextFireAt);

    loop.nextFireAt = nextFireAt;
    this.cancelTimer(sessionId);

    const delayMs = Math.max(0, nextFireAt - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.fireSessionLoop(sessionId);
    }, delayMs);

    this.timers.set(sessionId, timer);
  }

  private async fireSessionLoop(sessionId: string): Promise<void> {
    const session = this.controller.sessions.get(sessionId);
    if (!session) return;

    const loop = this.ensureSessionState(session);
    const clearSchedule = (): void => {
      if (loop.nextFireAt) {
        loop.nextFireAt = undefined;
      }
      this.controller.postLoopState(session);
    };

    const status = this.getSessionStatus(session);
    if (!status.available || !status.enabled) {
      clearSchedule();
      return;
    }

    if (this.shouldPauseSchedule(status)) {
      this.ensurePausedSchedule(loop, { dueNow: true });
      this.controller.postLoopState(session);
      return;
    }

    if (!status.canRunNow) {
      clearSchedule();
      return;
    }

    if (this.controller.activeSessionId !== sessionId) {
      clearSchedule();
      return;
    }

    const intervalMs = loop.intervalMinutes * 60_000;
    const nextFireAt = Date.now() + intervalMs;
    loop.nextFireAt = nextFireAt;
    this.armForSession(sessionId);
    this.controller.postLoopState(session);

    const injected = await this.controller.injectLoopPrompt(loop.prompt);
    if (injected) {
      this.ensureSessionState(session).lastFiredAt = Date.now();
      this.controller.postLoopState(session);
      this.controller.persistActiveSession();
    }
  }

  private shouldPauseSchedule(status: ChatLoopUiState): boolean {
    return status.available && status.enabled && status.reason === 'busy';
  }

  private ensurePausedSchedule(
    loop: ChatSessionLoopState,
    options?: {
      resetSchedule?: boolean;
      dueNow?: boolean;
    }
  ): void {
    if (options?.dueNow) {
      loop.nextFireAt = isFiniteTimestamp(loop.nextFireAt) ? Math.min(loop.nextFireAt, Date.now()) : Date.now();
      return;
    }

    if (!options?.resetSchedule && isFiniteTimestamp(loop.nextFireAt)) {
      return;
    }

    loop.nextFireAt = Date.now() + loop.intervalMinutes * 60_000;
  }
}
