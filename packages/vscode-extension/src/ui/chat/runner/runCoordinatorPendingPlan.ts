import type { RunCoordinatorHost } from '../controllerPorts';
import type { ChatMessage } from '../types';

export type PlanMessageKind = 'initial' | 'update';

const INITIAL_PLAN_PLACEHOLDER = 'Planning...';
const UPDATE_PLAN_PLACEHOLDER = 'Updating plan...';
const NO_PLAN_GENERATED_TEXT = '(No plan generated)';

export function getPlanPlaceholderText(kind: PlanMessageKind): string {
  return kind === 'update' ? UPDATE_PLAN_PLACEHOLDER : INITIAL_PLAN_PLACEHOLDER;
}

export function getPlanMessageKindFromPlaceholder(content: string | undefined): PlanMessageKind | undefined {
  const trimmed = (content || '').trim();
  if (trimmed === UPDATE_PLAN_PLACEHOLDER) return 'update';
  if (trimmed === INITIAL_PLAN_PLACEHOLDER) return 'initial';
  return undefined;
}

export function isPlanPlaceholderText(content: string | undefined): boolean {
  return !!getPlanMessageKindFromPlaceholder(content);
}

export function getPlanFailureText(params: { kind: PlanMessageKind; wasCanceled: boolean }): string {
  if (params.wasCanceled) {
    return params.kind === 'update' ? '(Plan update canceled)' : '(Plan generation canceled)';
  }
  return params.kind === 'update' ? '(Plan update failed)' : '(Plan generation failed)';
}

type PendingPlanRunView = Pick<
  RunCoordinatorHost,
  | 'activeSessionId'
  | 'abortRequested'
  | 'postApprovalState'
  | 'postMessage'
  | 'persistActiveSession'
  | 'officeSync'
  | 'pendingApprovals'
  | 'queueManager'
> & {
  isProcessing: boolean;
  autoApproveThisRun: boolean;
};

/**
 * Owns pending-plan lifecycle knowledge shared across initial planning,
 * regenerate-plan, and revise-plan flows.
 *
 * Hidden knowledge kept here:
 * - which placeholder text represents an in-flight plan
 * - how blank plan output falls back to a stable UI message
 * - how plan status/task fields are finalized after generation
 * - how plan update runs clear stale abort state and synchronize processing/approval/office/autosend state
 * - how the planPending indicator is posted consistently
 */
export function createPlanMessage(params: {
  kind: PlanMessageKind;
  task: string;
  turnId?: string;
}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'plan',
    content: getPlanPlaceholderText(params.kind),
    timestamp: Date.now(),
    turnId: params.turnId,
    plan: { status: 'generating', task: params.task },
  };
}

export function createPlanFollowUpUserMessage(params: {
  content: string;
  historyLength: number;
  turnId?: string;
}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: params.content,
    timestamp: Date.now(),
    turnId: params.turnId,
    checkpoint: {
      historyLength: params.historyLength,
    },
  };
}

export function applyGeneratedPlanContent(params: {
  planMsg: ChatMessage;
  task: string;
  plan: string;
  classifyPlanStatus(plan: string): 'draft' | 'needs_input';
}): void {
  const { planMsg, task, plan, classifyPlanStatus } = params;
  const trimmedPlan = (plan || '').trim();

  if (trimmedPlan) {
    planMsg.content = trimmedPlan;
  } else {
    const existing = (planMsg.content || '').trim();
    planMsg.content = !isPlanPlaceholderText(existing) && existing ? planMsg.content : NO_PLAN_GENERATED_TEXT;
  }

  const status = classifyPlanStatus(planMsg.content);
  if (planMsg.plan) {
    planMsg.plan.status = status;
    planMsg.plan.task = task;
  } else {
    planMsg.plan = { status, task };
  }
}

export function postPlanPendingState(
  view: { postMessage(message: unknown): void },
  params: { active: boolean; planMessageId?: string },
): void {
  view.postMessage({
    type: 'planPending',
    value: params.active,
    planMessageId: params.planMessageId ?? '',
  });
}

export function beginPendingPlanUpdateRun(view: PendingPlanRunView): void {
  view.isProcessing = true;
  view.abortRequested = false;
  view.autoApproveThisRun = false;
  view.postApprovalState();
  view.officeSync?.onRunStart();
}

export function finishPendingPlanUpdateRun(
  view: PendingPlanRunView,
  params: { currentPlanMessageId?: string; wasCanceled: boolean },
): void {
  view.isProcessing = false;
  view.abortRequested = false;
  view.postMessage({ type: 'processing', value: false });
  postPlanPendingState(view, {
    active: true,
    planMessageId: params.currentPlanMessageId,
  });
  view.autoApproveThisRun = false;
  view.pendingApprovals.clear();
  view.postApprovalState();
  view.officeSync?.onRunEnd();
  view.persistActiveSession();
  view.queueManager.scheduleAutosendForSession(view.activeSessionId, { suppress: params.wasCanceled });
}
