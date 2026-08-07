import type { RunCoordinatorHost } from '../controllerPorts';

/**
 * Shared "enter/exit run" state transition owned once for every run flavor:
 * ordinary build/plan turns, pending-plan updates, and pending-plan execution.
 *
 * Hidden knowledge kept here:
 * - entering a run always clears stale abort state from any previous canceled run
 * - entering a run always clears per-run auto-approval state
 * - approval state must be reposted whenever processing begins
 * - exiting a run clears pending approvals, reposts approval state, emits the
 *   processing-stop signal, persists the session, and re-arms the input queue
 */
export type RunStateHost = Pick<
  RunCoordinatorHost,
  | 'activeSessionId'
  | 'autoApproveThisRun'
  | 'abortRequested'
  | 'isProcessing'
  | 'pendingApprovals'
  | 'persistActiveSession'
  | 'postApprovalState'
  | 'postMessage'
  | 'queueManager'
>;

export function enterRunState(host: RunStateHost): void {
  host.isProcessing = true;
  host.abortRequested = false;
  host.autoApproveThisRun = false;
  host.postApprovalState();
}

export function exitRunState(
  host: RunStateHost,
  params?: { postProcessingSignal?: boolean; keepAbortFlag?: boolean; suppressQueueAutosend?: boolean },
): void {
  host.isProcessing = false;
  if (!params?.keepAbortFlag) {
    host.abortRequested = false;
  }
  host.autoApproveThisRun = false;
  host.pendingApprovals.clear();
  host.postApprovalState();
  if (params?.postProcessingSignal !== false) {
    host.postMessage({ type: 'processing', value: false });
  }
  host.persistActiveSession();
  host.queueManager.scheduleAutosendForSession(host.activeSessionId, { suppress: params?.suppressQueueAutosend });
}
