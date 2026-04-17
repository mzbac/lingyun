import type { AgentApprovalContext } from '../../core/types';

import type { PendingApprovalEntry } from './controllerPorts';

export type ChatApprovalUiState = {
  count: number;
  manualCount: number;
  autoApproveThisRun: boolean;
};

export function isManualApprovalContext(context?: AgentApprovalContext): boolean {
  return context?.manual === true;
}

export function isManualPendingApproval(pending?: PendingApprovalEntry): boolean {
  return isManualApprovalContext(pending?.approvalContext);
}

export function countManualPendingApprovals(pendingApprovals: Map<string, PendingApprovalEntry>): number {
  let count = 0;
  for (const pending of pendingApprovals.values()) {
    if (isManualPendingApproval(pending)) {
      count += 1;
    }
  }
  return count;
}

export function buildApprovalStateForUI(params: {
  pendingApprovals: Map<string, PendingApprovalEntry>;
  autoApproveThisRun: boolean;
}): ChatApprovalUiState {
  return {
    count: params.pendingApprovals.size,
    manualCount: countManualPendingApprovals(params.pendingApprovals),
    autoApproveThisRun: params.autoApproveThisRun,
  };
}

export function partitionPendingApprovals(
  pendingApprovals: Map<string, PendingApprovalEntry>,
  options?: { includeManual?: boolean }
): {
  manualEntries: Array<[string, PendingApprovalEntry]>;
  approvableEntries: Array<[string, PendingApprovalEntry]>;
} {
  const includeManual = options?.includeManual === true;
  const manualEntries: Array<[string, PendingApprovalEntry]> = [];
  const approvableEntries: Array<[string, PendingApprovalEntry]> = [];

  for (const entry of pendingApprovals.entries()) {
    if (!includeManual && isManualPendingApproval(entry[1])) {
      manualEntries.push(entry);
    } else {
      approvableEntries.push(entry);
    }
  }

  return {
    manualEntries,
    approvableEntries,
  };
}
