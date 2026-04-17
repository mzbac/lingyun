import type { ChatMessage } from '../types';
import type { RunnerSnapshotView } from './callbackContracts';

/**
 * Owns step-level workspace snapshot tracking for build-mode iterations.
 *
 * Hidden knowledge kept here:
 * - when snapshot tracking should be attempted
 * - how step snapshot/patch metadata is updated
 * - how snapshot failures are surfaced without breaking the run
 */
export function createStepSnapshotCallbacks(params: {
  view: RunnerSnapshotView;
  persistSessions: boolean;
}) {
  const { view, persistSessions } = params;

  async function onIterationStart(stepMsg: ChatMessage): Promise<void> {
    if (view.mode !== 'build' || !stepMsg.step) return;

    const snapshot = await view.getWorkspaceSnapshot();
    if (!snapshot) return;

    try {
      const baseHash = await snapshot.track();
      stepMsg.step.snapshot = { baseHash };
      if (persistSessions) {
        view.persistActiveSession();
      }
    } catch (error) {
      view.snapshotUnavailableReason = error instanceof Error ? error.message : String(error);
    }
  }

  async function onIterationEnd(stepMsg: ChatMessage | undefined): Promise<void> {
    if (view.mode !== 'build' || !stepMsg?.step?.snapshot?.baseHash) return;

    const snapshot = await view.getWorkspaceSnapshot();
    if (!snapshot) return;

    try {
      const baseHash = stepMsg.step.snapshot.baseHash;
      const patch = await snapshot.patch(baseHash);
      if (patch.files.length > 0) {
        stepMsg.step.patch = { baseHash: patch.baseHash, files: patch.files };
      } else {
        delete stepMsg.step.patch;
      }
      if (persistSessions) {
        view.persistActiveSession();
      }
    } catch (error) {
      view.snapshotUnavailableReason = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    onIterationStart,
    onIterationEnd,
  };
}
