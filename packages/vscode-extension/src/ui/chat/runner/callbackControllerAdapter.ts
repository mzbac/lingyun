import type { ChatController } from '../controller';
import type { ChatSessionInfo } from '../types';
import type { ChatRunnerCallbacksDeps } from './callbackContracts';

/**
 * Adapts the chat controller to the runner-callback dependency contract.
 *
 * This keeps controller field wiring out of the callback composition root so the
 * runner modules can evolve independently from controller storage/layout details.
 */
export function createChatRunnerCallbacksDepsForController(controller: ChatController): ChatRunnerCallbacksDeps {
  return {
    get activeSessionId() {
      return controller.activeSessionId;
    },
    get sessions() {
      return controller.sessions;
    },
    get agent() {
      return controller.agent;
    },
    get currentModel() {
      return controller.currentModel;
    },
    get currentTurnId() {
      return controller.currentTurnId;
    },
    set currentTurnId(value) {
      controller.currentTurnId = value;
    },
    get activeStepId() {
      return controller.activeStepId;
    },
    set activeStepId(value) {
      controller.activeStepId = value;
    },
    get stepCounter() {
      return controller.stepCounter;
    },
    set stepCounter(value) {
      controller.stepCounter = value;
    },
    get mode() {
      return controller.mode;
    },
    get llmProvider() {
      return controller.llmProvider;
    },
    get messages() {
      return controller.messages;
    },
    get abortRequested() {
      return controller.abortRequested;
    },
    set abortRequested(value) {
      controller.abortRequested = value;
    },
    get signals() {
      return controller.signals;
    },
    get officeSync() {
      return controller.officeSync;
    },
    get outputChannel() {
      return controller.outputChannel;
    },
    get snapshot() {
      return controller.snapshot;
    },
    set snapshot(value) {
      controller.snapshot = value;
    },
    get snapshotUnavailableReason() {
      return controller.snapshotUnavailableReason;
    },
    set snapshotUnavailableReason(value) {
      controller.snapshotUnavailableReason = value;
    },
    get toolDiffBeforeByToolCallId() {
      return controller.toolDiffBeforeByToolCallId;
    },
    get toolDiffSnapshotsByToolCallId() {
      return controller.toolDiffSnapshotsByToolCallId;
    },
    isSessionPersistenceEnabled: () => controller.sessionApi.isSessionPersistenceEnabled(),
    normalizeLoadedSession: (raw: ChatSessionInfo) => controller.sessionApi.normalizeLoadedSession(raw),
    persistActiveSession: () => controller.sessionApi.persistActiveSession(),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
    postSessions: () => controller.sessionApi.postSessions(),
    markSessionDirty: (sessionId: string) => controller.sessionApi.markSessionDirty(sessionId),
    flushSessionSave: () => controller.sessionApi.flushSessionSave(),
    getContextForUI: () => controller.sessionApi.getContextForUI(),
    requestInlineApproval: (
      tc: Parameters<ChatRunnerCallbacksDeps['requestInlineApproval']>[0],
      def: Parameters<ChatRunnerCallbacksDeps['requestInlineApproval']>[1],
      parentMessageId?: string,
      approvalContext?: Parameters<ChatRunnerCallbacksDeps['requestInlineApproval']>[3]
    ) => controller.approvalsApi.requestInlineApproval(tc, def, parentMessageId, approvalContext),
    getWorkspaceSnapshot: () => controller.revertApi.getWorkspaceSnapshot(),
  };
}
