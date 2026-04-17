import type { ChatController } from '../controller';
import type { ChatMessage } from '../types';
import type { RunCoordinatorHost } from '../controllerPorts';
import { recordUserIntent } from '../../../core/sessionSignals';
import { isDefaultSessionTitle } from '../sessionTitle';
import { RunCoordinator, createRunCoordinator } from './runCoordinator';

/**
 * Adapts the chat controller to the run-coordinator dependency contract.
 *
 * This keeps controller field wiring out of the coordinator module so the
 * runner can evolve independently from controller storage/layout details.
 */
export function createRunCoordinatorHostForController(controller: ChatController): RunCoordinatorHost {
  return {
    get activeSessionId() {
      return controller.activeSessionId;
    },
    agent: {
      get running() {
        return controller.agent.running ?? false;
      },
      run: (task, callbacks) => controller.agent.run(task as any, callbacks),
      continue: (message, callbacks) => controller.agent.continue(message, callbacks),
      getHistory: () =>
        typeof controller.agent.getHistory === 'function'
          ? controller.agent.getHistory()
          : controller.agent.exportState().history,
      exportState: () => controller.agent.exportState(),
      clear: () => controller.agent.clear(),
      steer: (input) => controller.agent.steer(input),
      plan: (task, callbacks) => controller.agent.plan(task, callbacks),
      resume: (callbacks) => controller.agent.resume(callbacks),
      execute: (callbacks, options) => controller.agent.execute(callbacks, options),
    },
    get autoApproveThisRun() {
      return controller.autoApproveThisRun;
    },
    set autoApproveThisRun(value: boolean) {
      controller.autoApproveThisRun = value;
    },
    get abortRequested() {
      return controller.abortRequested;
    },
    set abortRequested(value: boolean) {
      controller.abortRequested = value;
    },
    classifyPlanStatus: (plan: string) => controller.runnerInputApi.classifyPlanStatus(plan),
    commitRevertedConversationIfNeeded: () => controller.revertApi.commitRevertedConversationIfNeeded(),
    createAgentCallbacks: () => controller.runnerCallbacksApi.createAgentCallbacks(),
    createPlanningCallbacks: (planMsg: ChatMessage) => controller.runnerCallbacksApi.createPlanningCallbacks(planMsg),
    get currentTurnId() {
      return controller.currentTurnId;
    },
    set currentTurnId(value: string | undefined) {
      controller.currentTurnId = value;
    },
    ensureSessionsLoaded: () => controller.sessionApi.ensureSessionsLoaded(),
    getActiveSession: () => controller.sessionApi.getActiveSession(),
    getContextForUI: () => controller.sessionApi.getContextForUI(),
    isPlanFirstEnabled: () => controller.runnerInputApi.isPlanFirstEnabled(),
    get isProcessing() {
      return controller.isProcessing;
    },
    set isProcessing(value: boolean) {
      controller.isProcessing = value;
    },
    isSessionPersistenceEnabled: () => controller.sessionApi.isSessionPersistenceEnabled(),
    get llmProvider() {
      return controller.llmProvider;
    },
    loopManager: {
      hasLoopContext: (session) => controller.loopManager.hasLoopContext(session),
      onRunStart: (sessionId) => controller.loopManager.onRunStart(sessionId),
      onRunEnd: (sessionId) => controller.loopManager.onRunEnd(sessionId),
      syncActiveSession: (options) => controller.loopManager.syncActiveSession(options),
    },
    maybeGenerateSessionTitle: ({ sessionId, message, synthetic }) => {
      if (!message || !message.trim() || synthetic) return;
      const session = controller.sessions.get(sessionId);
      if (!session || !isDefaultSessionTitle(session.title)) return;

      void controller.agent
        .generateSessionTitle(message, { maxChars: 50 })
        .then(title => {
          const active = controller.sessions.get(sessionId);
          if (!active) return;
          if (!isDefaultSessionTitle(active.title)) return;
          if (!title || !title.trim()) return;

          active.title = title.trim();
          active.updatedAt = Date.now();
          controller.sessionApi.postSessions();
          controller.sessionApi.markSessionDirty(active.id);
        })
        .catch(() => {});
    },
    markActiveStepStatus: (status) => controller.approvalsApi.markActiveStepStatus(status),
    get messages() {
      return controller.messages;
    },
    get mode() {
      return controller.mode;
    },
    get officeSync() {
      return controller.officeSync;
    },
    get pendingApprovals() {
      return controller.pendingApprovals;
    },
    persistActiveSession: () => controller.sessionApi.persistActiveSession(),
    postApprovalState: () => controller.approvalsApi.postApprovalState(),
    postLoopState: (session) => controller.loopApi.postLoopState(session),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
    postUnknownSkillWarnings: (content: string, turnId?: string) =>
      controller.skillsApi.postUnknownSkillWarnings(content, turnId),
    queueManager: {
      enqueueActiveInput: (payload) => controller.queueManager.enqueueActiveInput(payload),
      takeByIdFromActiveSession: (id: string) => controller.queueManager.takeByIdFromActiveSession(id),
      scheduleAutosendForSession: (sessionId: string, options?: { suppress?: boolean }) =>
        controller.queueManager.scheduleAutosendForSession(sessionId, options),
      flushAutosendForActiveSession: () => controller.queueManager.flushAutosendForActiveSession(),
    },
    recordInputHistory: (content: string) => controller.inputHistoryApi.recordInputHistory(content),
    recordUserIntent: (text: string) => recordUserIntent(controller.signals, text),
    setModeAndPersist: (mode, options) => controller.modeApi.setModeAndPersist(mode, options),
    get view() {
      return controller.view;
    },
  };
}

export function createRunCoordinatorForController(controller: ChatController): RunCoordinator {
  return createRunCoordinator(createRunCoordinatorHostForController(controller));
}
