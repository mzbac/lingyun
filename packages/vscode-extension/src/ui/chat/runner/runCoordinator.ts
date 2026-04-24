import * as vscode from 'vscode';

import type { UserHistoryInputPart } from '@kooka/core';
import {
  hasSessionMemoryDisableIntent,
  hasSessionMemoryEnableIntent,
  isSessionMemoryDisabled,
  setSessionMemoryMode,
  shouldExcludeUserTextFromMemoryCapture,
} from '../../../core/sessionSignals';
import { formatErrorForUser, isCancellationMessage } from '../utils';

import type { RunCoordinatorHost } from '../controllerPorts';
import type { ChatMessage, ChatUserInput } from '../types';
import { appendTurnErrorMessage, findLatestUserTurnId } from './runCoordinatorMessageState';
import {
  applyGeneratedPlanContent,
  beginPendingPlanUpdateRun,
  createPlanFollowUpUserMessage,
  createPlanMessage,
  finishPendingPlanUpdateRun,
  postPlanPendingState,
} from './runCoordinatorPendingPlan';
import { findLatestToolMessageByApprovalId } from '../toolMessageLookup';

const MAX_USER_IMAGE_ATTACHMENTS = 8;
const MAX_USER_IMAGE_DATA_URL_LENGTH = 12_000_000;

const ASSUMPTIONS_HEADING = '## Assumptions (auto)';
const ASSUMPTIONS_NOTE =
  `${ASSUMPTIONS_HEADING}\n` +
  '- Proceed without further clarification; make reasonable assumptions for unanswered questions.\n' +
  '- If multiple valid options exist, choose the simplest/lowest-risk default.\n' +
  '- Continue in Build mode; do not block waiting for user input.\n';

function applySessionMemoryModeIntent(signals: RunCoordinatorHost['signals'], text: string): void {
  if (!signals || !text.trim()) return;
  if (hasSessionMemoryDisableIntent(text)) {
    setSessionMemoryMode(signals, 'disabled', text);
  } else if (hasSessionMemoryEnableIntent(text)) {
    setSessionMemoryMode(signals, 'enabled', text);
  }
}

type NormalizedUserInput = {
  text: string;
  agentInput: UserHistoryInputPart[];
  imageAttachments: NonNullable<ChatUserInput['attachments']>;
  attachmentCount: number;
  displayContent: string;
  hasContent: boolean;
};

type ActiveSession = ReturnType<RunCoordinatorHost['getActiveSession']>;
type ActivePendingPlan = NonNullable<ActiveSession['pendingPlan']>;
type PendingPlanMessage = ChatMessage & {
  role: 'plan';
  plan: NonNullable<ChatMessage['plan']>;
};
type PendingPlanExecutionTarget = {
  pendingPlan: ActivePendingPlan;
  planMsg: PendingPlanMessage;
};
type PreparedPendingPlanTarget =
  | { kind: 'ready'; activeSession: ActiveSession; target: PendingPlanExecutionTarget }
  | { kind: 'busy' }
  | { kind: 'no-view' }
  | { kind: 'no-pending-plan' }
  | { kind: 'missing-target' }
  | { kind: 'stale-requested-id' };
type ReadyPendingPlanTarget = Extract<PreparedPendingPlanTarget, { kind: 'ready' }>;
type PendingPlanDirectAction = 'execute' | 'revise';

function normalizeUserInput(content: string | ChatUserInput): NormalizedUserInput {
  const message =
    typeof content === 'string' ? content : typeof content.message === 'string' ? content.message : '';
  const text = message.trim();

  const attachmentsRaw = typeof content === 'object' && content ? content.attachments : undefined;
  const imageParts: UserHistoryInputPart[] = [];
  const imageAttachments: NonNullable<ChatUserInput['attachments']> = [];

  if (Array.isArray(attachmentsRaw)) {
    for (const attachment of attachmentsRaw) {
      if (!attachment || typeof attachment !== 'object') continue;

      const mediaType = typeof attachment.mediaType === 'string' ? attachment.mediaType.trim() : '';
      const dataUrl = typeof attachment.dataUrl === 'string' ? attachment.dataUrl.trim() : '';
      const filename = typeof attachment.filename === 'string' ? attachment.filename.trim() : '';

      if (!mediaType.toLowerCase().startsWith('image/')) continue;
      if (!dataUrl.startsWith('data:image/')) continue;
      if (dataUrl.length > MAX_USER_IMAGE_DATA_URL_LENGTH) continue;

      imageParts.push({
        type: 'file',
        mediaType,
        ...(filename ? { filename } : {}),
        url: dataUrl,
      });
      imageAttachments.push({
        mediaType,
        dataUrl,
        ...(filename ? { filename } : {}),
      });

      if (imageParts.length >= MAX_USER_IMAGE_ATTACHMENTS) break;
    }
  }

  const textParts: UserHistoryInputPart[] = text ? [{ type: 'text', text }] : [];
  const agentInput = [...textParts, ...imageParts];
  const attachmentCount = imageParts.length;
  const displayContent =
    text ||
    (attachmentCount === 1 ? '[Image attached]' : attachmentCount > 1 ? `[${attachmentCount} images attached]` : '');

  return {
    text,
    agentInput,
    imageAttachments,
    attachmentCount,
    displayContent,
    hasContent: !!text || attachmentCount > 0,
  };
}

function appendAssumptionsToPlan(plan: string): string {
  const text = (plan || '').trimEnd();
  if (!text) return ASSUMPTIONS_NOTE.trimEnd();
  if (text.includes(ASSUMPTIONS_HEADING)) return text;
  return `${text}\n\n${ASSUMPTIONS_NOTE.trimEnd()}`;
}

export class RunCoordinator {
  private loopSteerableDuringProcessing = false;

  constructor(private readonly controller: RunCoordinatorHost) {}

  canAcceptLoopSteer(): boolean {
    const c = this.controller;
    const turnId = typeof c.currentTurnId === 'string' ? c.currentTurnId.trim() : '';
    return c.isProcessing && this.loopSteerableDuringProcessing && c.agent.running && !!turnId;
  }

  private finalizeRun(params?: { postProcessingSignal?: boolean; keepAbortFlag?: boolean; suppressQueueAutosend?: boolean }): void {
    const c = this.controller;
    const sessionId = c.activeSessionId;
    c.isProcessing = false;
    this.loopSteerableDuringProcessing = false;
    c.loopManager.onRunEnd(sessionId);
    if (!params?.keepAbortFlag) {
      c.abortRequested = false;
    }
    c.autoApproveThisRun = false;
    c.pendingApprovals.clear();
    c.postApprovalState();
    if (params?.postProcessingSignal !== false) {
      c.postMessage({ type: 'processing', value: false });
    }
    c.officeSync?.onRunEnd();
    c.persistActiveSession();
    c.queueManager.scheduleAutosendForSession(sessionId, { suppress: params?.suppressQueueAutosend });
  }

  /**
   * Shared activation state for ordinary build/plan executions.
   *
   * Hidden knowledge kept here:
   * - entering a run always clears stale abort state from any previous canceled run
   * - entering a run always clears per-run auto-approval state
   * - approval state must be reposted whenever processing begins
   * - loop steerability is part of the run activation contract, not an ad hoc branch detail
   */
  private activateRun(steerableDuringProcessing: boolean): void {
    const c = this.controller;
    c.isProcessing = true;
    c.abortRequested = false;
    this.loopSteerableDuringProcessing = steerableDuringProcessing;
    c.autoApproveThisRun = false;
    c.postApprovalState();
  }

  private enqueueQueuedInput(params: { normalized: NormalizedUserInput; displayContent?: string }): void {
    this.controller.queueManager.enqueueActiveInput({
      message: params.normalized.text,
      displayContent: params.displayContent ?? params.normalized.displayContent,
      attachmentCount: params.normalized.attachmentCount,
      attachments: params.normalized.imageAttachments,
    });
  }

  private postTurnErrorIfNeeded(turnId: string | undefined, content: string): void {
    const errorMsg = appendTurnErrorMessage({
      messages: this.controller.messages,
      turnId,
      content,
    });
    if (errorMsg) {
      this.controller.postMessage({ type: 'message', message: errorMsg });
    }
  }

  /**
   * Starts an ordinary user turn run and posts the bootstrap UI state in the
   * only ordering the webview can interpret correctly.
   *
   * Hidden knowledge kept here:
   * - the user message must exist before the processing signal so the active
   *   turn indicator binds to the correct turn
   * - title generation is opportunistic and only allowed while the session is
   *   still using an auto-generated title
   * - unknown-skill warnings and persistence happen after the user message is
   *   posted, so follow-up UI updates stay attached to the new turn
   */
  private beginUserTurnRun(params: {
    activeSession: ReturnType<RunCoordinatorHost['getActiveSession']>;
    normalizedInput: NormalizedUserInput;
    shouldGeneratePlan: boolean;
    synthetic?: boolean;
    displayContent?: string;
  }): void {
    const c = this.controller;
    this.activateRun(!params.shouldGeneratePlan);
    c.loopManager.onRunStart(params.activeSession.id);
    c.officeSync?.onRunStart();

    const checkpointState = c.agent.exportState();
    const memoryExcluded =
      shouldExcludeUserTextFromMemoryCapture(params.normalizedInput.text) || isSessionMemoryDisabled(c.signals);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: params.displayContent ?? params.normalizedInput.displayContent,
      timestamp: Date.now(),
      memoryExcluded: memoryExcluded || undefined,
      checkpoint: {
        historyLength: checkpointState.history.length,
      },
    };
    c.messages.push(userMsg);
    c.currentTurnId = userMsg.id;

    c.maybeGenerateSessionTitle({
      sessionId: params.activeSession.id,
      message: params.normalizedInput.text,
      synthetic: params.synthetic,
    });

    c.postMessage({ type: 'message', message: userMsg });
    if (params.normalizedInput.text && !params.synthetic) {
      void c.postUnknownSkillWarnings(params.normalizedInput.text, userMsg.id);
    }
    if (c.isSessionPersistenceEnabled()) {
      c.persistActiveSession();
    }

    // Important: the webview derives the active turn from the most recent user message.
    // Send the processing signal only after the user message is in the UI so the status indicator
    // attaches to the correct turn.
    c.postMessage({ type: 'processing', value: true });

  }

  /**
   * Shared failure handling for coordinator-controlled runs.
   *
   * Hidden knowledge kept here:
   * - how user-facing run errors are formatted
   * - how cancellation is detected from abort state plus canonical abort text
   * - when a turn should receive a terminal error status vs suppress it for cancellations
   * - which runs should also mark the active step status
   */
  private handleRunFailure(params: {
    error: unknown;
    turnId?: string;
    markStepStatus?: boolean;
  }): boolean {
    const c = this.controller;
    const message = formatErrorForUser(params.error, { llmProviderId: c.llmProvider?.id });
    const wasCanceled = c.abortRequested || isCancellationMessage(message);

    if (params.markStepStatus) {
      c.markActiveStepStatus(wasCanceled ? 'canceled' : 'error');
    }

    if (!wasCanceled && params.turnId) {
      c.postMessage({
        type: 'turnStatus',
        turnId: params.turnId,
        status: { type: 'error', message },
      });
    }

    this.postTurnErrorIfNeeded(params.turnId, message);
    return wasCanceled;
  }

  /**
   * Resolves the active pending-plan message and repairs transient drift between
   * session.pendingPlan and the rendered plan message collection.
   *
   * Hidden knowledge kept here:
   * - stale plan references are cleared from session + UI state in one place
   * - plan messages missing plan metadata are normalized before any downstream plan flow runs
   * - missing task metadata falls back to the session-level pending-plan task
   */
  private resolvePendingPlanMessage(params: {
    activeSession: ActiveSession;
    pendingPlan: ActivePendingPlan;
    clearStale?: boolean;
  }): PendingPlanExecutionTarget | undefined {
    const c = this.controller;
    const planMsg = c.messages.find(message => message.id === params.pendingPlan.planMessageId);
    if (!planMsg || planMsg.role !== 'plan') {
      if (params.clearStale) {
        params.activeSession.pendingPlan = undefined;
        postPlanPendingState(c, { active: false });
        c.persistActiveSession();
      }
      return undefined;
    }

    if (!planMsg.plan) {
      planMsg.plan = { status: 'draft', task: params.pendingPlan.task };
      c.postMessage({ type: 'updateMessage', message: planMsg });
    } else if (!planMsg.plan.task) {
      planMsg.plan.task = params.pendingPlan.task;
      c.postMessage({ type: 'updateMessage', message: planMsg });
    }

    return {
      pendingPlan: params.pendingPlan,
      planMsg: planMsg as PendingPlanMessage,
    };
  }

  /**
   * Handles the special user-input policy while a plan is waiting for clarification.
   *
   * Hidden knowledge kept here:
   * - stale pending-plan references must be cleared from session + UI state before ordinary input flow resumes
   * - attachment-only replies are ignored while the coordinator is explicitly waiting for textual clarification
   * - clarification flow uses the same post-load revision transaction as direct revise-plan actions
   */
  private async handlePendingPlanUserInput(params: {
    activeSession: ActiveSession;
    pendingPlan: ActivePendingPlan;
    normalizedInput: NormalizedUserInput;
  }): Promise<boolean> {
    const target = this.resolvePendingPlanMessage({
      activeSession: params.activeSession,
      pendingPlan: params.pendingPlan,
      clearStale: true,
    });
    if (!target) {
      return false;
    }

    if (!params.normalizedInput.text) {
      return true;
    }

    const prepared = await this.preparePendingPlanTarget({
      planMessageId: target.pendingPlan.planMessageId,
      beforeCommit: () => this.controller.recordInputHistory(params.normalizedInput.text),
    });
    if (prepared.kind !== 'ready') {
      return true;
    }

    await this.revisePendingPlanTarget({
      activeSession: prepared.activeSession,
      target: prepared.target,
      instructions: params.normalizedInput.text,
    });
    return true;
  }

  /**
   * Runs the state transition for executing an already-approved pending plan.
   *
   * Hidden knowledge kept here:
   * - pending-plan execution temporarily switches the coordinator into build mode
   * - UI ordering requires processing=true before planPending=false and before the executing status update
   * - execution failure must restore both plan status and plan-mode state before surfacing the turn error
   */
  private async executePendingPlanTarget(params: {
    activeSession: ActiveSession;
    target: PendingPlanExecutionTarget;
  }): Promise<void> {
    const c = this.controller;
    const { planMsg } = params.target;
    const previousMode = c.mode;
    await c.setModeAndPersist('build');
    const switchedToBuild = previousMode === 'plan';
    const lastUserTurn = findLatestUserTurnId(c.messages);
    c.currentTurnId = planMsg.turnId || lastUserTurn || c.currentTurnId;

    this.activateRun(true);
    c.postMessage({ type: 'processing', value: true });
    postPlanPendingState(c, { active: false });
    c.loopManager.onRunStart(c.activeSessionId);
    c.officeSync?.onRunStart();

    const previousStatus = planMsg.plan?.status ?? 'draft';
    if (!planMsg.plan) {
      planMsg.plan = { status: 'draft', task: params.target.pendingPlan.task };
    }
    planMsg.plan.status = 'executing';
    c.postMessage({ type: 'updateMessage', message: planMsg });
    if (c.isSessionPersistenceEnabled()) {
      c.persistActiveSession();
    }

    let wasCanceled = false;
    try {
      let approvedPlan = String(planMsg.content || '');
      if (previousStatus === 'needs_input' && approvedPlan.trim()) {
        approvedPlan = appendAssumptionsToPlan(approvedPlan);
      }

      await c.agent.execute(c.createAgentCallbacks(), { approvedPlan });
      planMsg.plan.status = 'done';
      c.postMessage({ type: 'updateMessage', message: planMsg });
      params.activeSession.pendingPlan = undefined;
      c.persistActiveSession();
    } catch (error) {
      planMsg.plan.status = previousStatus;
      c.postMessage({ type: 'updateMessage', message: planMsg });
      postPlanPendingState(c, {
        active: true,
        planMessageId: params.activeSession.pendingPlan?.planMessageId,
      });

      if (switchedToBuild) {
        await c.setModeAndPersist('plan');
      }

      wasCanceled = this.handleRunFailure({
        error,
        turnId: planMsg.turnId,
      });
    } finally {
      this.finalizeRun({ keepAbortFlag: wasCanceled, suppressQueueAutosend: wasCanceled });
    }
  }

  private beginPendingPlanUpdateRun(): void {
    this.loopSteerableDuringProcessing = false;
    beginPendingPlanUpdateRun(this.controller);
  }

  private finishPendingPlanUpdateRun(wasCanceled: boolean): void {
    this.loopSteerableDuringProcessing = false;
    finishPendingPlanUpdateRun(this.controller, {
      currentPlanMessageId: this.controller.getActiveSession().pendingPlan?.planMessageId,
      wasCanceled,
    });
  }

  /**
   * Prepares the current pending-plan target after the required load barrier,
   * then re-resolves the canonical plan target against post-commit session state.
   *
   * Hidden knowledge kept here:
   * - all pending-plan entrypoints share one load/commit/re-read sequence
   * - callers may inject one pre-commit side effect (for example input-history recording) without duplicating the sequencing logic
   * - pending-plan message repair happens after the commit boundary so downstream actions always see the canonical plan shape
   * - the returned outcome keeps revalidation details local so higher-level flows can decide how to surface non-ready states
   */
  private async preparePendingPlanTarget(params?: {
    planMessageId?: string;
    beforeCommit?: () => void;
  }): Promise<PreparedPendingPlanTarget> {
    const c = this.controller;
    if (!c.view) return { kind: 'no-view' };
    if (c.isProcessing) return { kind: 'busy' };

    const initialPendingPlan = c.getActiveSession().pendingPlan;
    if (!initialPendingPlan) return { kind: 'no-pending-plan' };

    const requestedId =
      typeof params?.planMessageId === 'string' && params.planMessageId.trim() ? params.planMessageId : undefined;
    if (requestedId && initialPendingPlan.planMessageId !== requestedId) {
      return { kind: 'stale-requested-id' };
    }

    await c.ensureSessionsLoaded();
    params?.beforeCommit?.();
    c.commitRevertedConversationIfNeeded();

    const activeSession = c.getActiveSession();
    const pendingPlan = activeSession.pendingPlan;
    if (!pendingPlan) return { kind: 'no-pending-plan' };
    if (requestedId && pendingPlan.planMessageId !== requestedId) {
      return { kind: 'stale-requested-id' };
    }

    const target = this.resolvePendingPlanMessage({
      activeSession,
      pendingPlan,
    });
    if (!target) return { kind: 'missing-target' };
    if (requestedId && target.planMsg.id !== requestedId) {
      return { kind: 'stale-requested-id' };
    }

    return { kind: 'ready', activeSession, target };
  }

  /**
   * Prepares a direct pending-plan action outside the clarification flow and
   * owns how non-ready outcomes surface back to the user.
   *
   * Hidden knowledge kept here:
   * - execute/revise share one target-preparation contract
   * - direct plan actions should not each decide how busy/no-pending/stale-target states appear in the UI
   * - stale or missing targets become durable chat errors for all direct plan actions
   * - execute keeps the existing transient info messages for busy/no-pending states; revise remains silent there because its UI entrypoints already gate those cases
   */
  private async prepareDirectPendingPlanAction(params: {
    action: PendingPlanDirectAction;
    planMessageId?: string;
    beforeCommit?: () => void;
  }): Promise<ReadyPendingPlanTarget | undefined> {
    const prepared = await this.preparePendingPlanTarget({
      planMessageId: params.planMessageId,
      beforeCommit: params.beforeCommit,
    });
    if (prepared.kind === 'ready' || prepared.kind === 'no-view') {
      return prepared.kind === 'ready' ? prepared : undefined;
    }

    if (prepared.kind === 'busy') {
      if (params.action === 'execute') {
        void vscode.window.showInformationMessage('LingYun: A task is already running.');
      }
      return undefined;
    }

    if (prepared.kind === 'no-pending-plan') {
      if (params.action === 'execute') {
        void vscode.window.showInformationMessage('LingYun: No pending plan to execute.');
      }
      return undefined;
    }

    const errorContent =
      params.action === 'revise'
        ? 'No pending plan found to revise. Try generating a new plan.'
        : 'No pending plan found to execute. Try updating or generating a new plan.';

    const errorMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'error',
      content: errorContent,
      timestamp: Date.now(),
    };
    this.controller.messages.push(errorMsg);
    this.controller.postMessage({ type: 'message', message: errorMsg });
    return undefined;
  }

  /**
   * Applies user clarification text to an already-resolved pending-plan target.
   *
   * Hidden knowledge kept here:
   * - revise-plan always appends clarifications using the canonical task format expected by future plan updates/execution
   * - revise-plan follow-up UI and unknown-skill warnings stay coupled to the same update transaction
   * - callers provide a repaired target so this method can stay focused on revise policy rather than load-barrier/session repair details
   */
  private async revisePendingPlanTarget(params: {
    activeSession: ActiveSession;
    target: PendingPlanExecutionTarget;
    instructions: string;
  }): Promise<void> {
    const trimmed = (params.instructions || '').trim();
    if (!trimmed) return;

    const updatedTask = `${params.target.pendingPlan.task}\n\nUser clarifications:\n${trimmed}`;
    await this.updatePendingPlan({
      activeSession: params.activeSession,
      target: params.target,
      nextTask: updatedTask,
      followUpText: trimmed,
      warnUnknownSkills: true,
    });
  }

  private async updatePendingPlan(params: {
    activeSession: ActiveSession;
    target: PendingPlanExecutionTarget;
    nextTask: string;
    followUpText?: string;
    warnUnknownSkills?: boolean;
  }): Promise<void> {
    const c = this.controller;
    this.beginPendingPlanUpdateRun();

    if (params.followUpText) {
      const checkpointState = c.agent.exportState();
      const userMsg = createPlanFollowUpUserMessage({
        content: params.followUpText,
        historyLength: checkpointState.history.length,
        turnId: params.target.planMsg.turnId,
      });
      c.messages.push(userMsg);
      c.postMessage({ type: 'message', message: userMsg });
      if (params.warnUnknownSkills) {
        void c.postUnknownSkillWarnings(params.followUpText, params.target.planMsg.turnId);
      }
    }

    // Ensure the follow-up notice is rendered before the global processing flag so the UI keeps the
    // status indicator tied to the correct (original) turn.
    c.postMessage({ type: 'processing', value: true });
    postPlanPendingState(c, {
      active: true,
      planMessageId: params.target.pendingPlan.planMessageId,
    });

    const previousPendingPlan = { ...params.target.pendingPlan };
    const nextPlanMsg = createPlanMessage({
      kind: 'update',
      task: params.nextTask,
      turnId: params.target.planMsg.turnId,
    });
    c.messages.push(nextPlanMsg);
    c.postMessage({ type: 'message', message: nextPlanMsg });

    params.activeSession.pendingPlan = {
      task: params.nextTask,
      planMessageId: nextPlanMsg.id,
    };
    postPlanPendingState(c, {
      active: true,
      planMessageId: nextPlanMsg.id,
    });

    let wasCanceled = false;
    try {
      const plan = await c.agent.plan(params.nextTask, c.createPlanningCallbacks(nextPlanMsg));
      applyGeneratedPlanContent({
        planMsg: nextPlanMsg,
        task: params.nextTask,
        plan,
        classifyPlanStatus: c.classifyPlanStatus,
      });
      c.postMessage({ type: 'updateMessage', message: nextPlanMsg });
      c.persistActiveSession();
    } catch (error) {
      params.activeSession.pendingPlan = previousPendingPlan;
      postPlanPendingState(c, {
        active: true,
        planMessageId: previousPendingPlan.planMessageId,
      });

      wasCanceled = this.handleRunFailure({
        error,
        turnId: params.target.planMsg.turnId,
      });
    } finally {
      this.finishPendingPlanUpdateRun(wasCanceled);
    }
  }

  async steerQueuedInput(id: string): Promise<void> {
    const c = this.controller;
    if (!id || typeof id !== 'string') return;

    await c.ensureSessionsLoaded();
    const input = c.queueManager.takeByIdFromActiveSession(id);
    if (!input) return;

    if (c.isProcessing) {
      const normalized = normalizeUserInput(input);
      if (!normalized.hasContent) return;
      this.steerIntoActiveRun({ normalized });
      return;
    }

    await this.handleUserMessage(input, { fromQueue: true });
  }

  private steerIntoActiveRun(params: {
    normalized: NormalizedUserInput;
    displayContent?: string;
    queueOnFailure?: boolean;
  }): boolean {
    const c = this.controller;
    const turnId = c.currentTurnId;
    if (!turnId) {
      if (params.queueOnFailure !== false) {
        this.enqueueQueuedInput(params);
      }
      return false;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: params.displayContent ?? params.normalized.displayContent,
      timestamp: Date.now(),
      turnId,
    };
    c.messages.push(userMsg);
    c.postMessage({ type: 'message', message: userMsg });

    try {
      c.agent.steer(params.normalized.agentInput);
    } catch (error) {
      const warningMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'warning',
        content: `LingYun: Failed to steer input into the active run (${String((error as any)?.message || error)}). Queuing instead.`,
        timestamp: Date.now(),
        turnId,
      };
      c.messages.push(warningMsg);
      c.postMessage({ type: 'message', message: warningMsg });
      if (params.queueOnFailure !== false) {
        this.enqueueQueuedInput(params);
      }
      return false;
    }

    c.persistActiveSession();
    return true;
  }

  async triggerLoopPrompt(content: string): Promise<boolean> {
    const c = this.controller;
    if (!c.view) return false;

    const normalized = normalizeUserInput(content);
    if (!normalized.hasContent) return false;

    if (this.canAcceptLoopSteer()) {
      return this.steerIntoActiveRun({
        normalized,
        queueOnFailure: false,
      });
    }

    if (c.isProcessing) return false;

    if (!c.loopManager.hasLoopContext(c.getActiveSession())) {
      return false;
    }

    await this.handleUserMessage(content, {
      fromQueue: true,
      synthetic: true,
    });
    return true;
  }

  async handleUserMessage(
    content: string | ChatUserInput,
    options?: { fromQueue?: boolean; synthetic?: boolean; displayContent?: string }
  ): Promise<void> {
    const c = this.controller;
    if (!c.view) return;

    const normalizedInput = normalizeUserInput(content);
    if (!normalizedInput.hasContent) return;

    if (normalizedInput.text && !options?.synthetic) {
      applySessionMemoryModeIntent(c.signals, normalizedInput.text);
    }

    if (normalizedInput.text && !options?.fromQueue && !options?.synthetic && !shouldExcludeUserTextFromMemoryCapture(normalizedInput.text)) {
      c.recordUserIntent(normalizedInput.text);
    }

    const activeSession = c.getActiveSession();
    const pendingPlan = activeSession.pendingPlan;

    if (c.isProcessing) {
      await c.ensureSessionsLoaded();
      if (normalizedInput.text && !options?.synthetic) {
        c.recordInputHistory(normalizedInput.text);
      }

      this.enqueueQueuedInput({ normalized: normalizedInput });
      return;
    }

    if (pendingPlan) {
      const handledPendingPlanInput = await this.handlePendingPlanUserInput({
        activeSession,
        pendingPlan,
        normalizedInput,
      });
      if (handledPendingPlanInput) {
        return;
      }
    }

    await c.ensureSessionsLoaded();

    if (!options?.fromQueue && !options?.synthetic) {
      c.recordInputHistory(normalizedInput.text);
    }

    c.commitRevertedConversationIfNeeded();

    const isNew = c.agent.getHistory().length === 0;
    const planFirst = c.isPlanFirstEnabled();
    const shouldGeneratePlan = c.mode === 'plan' || (planFirst && isNew);

    this.beginUserTurnRun({
      activeSession,
      normalizedInput,
      shouldGeneratePlan,
      synthetic: options?.synthetic,
      displayContent: options?.displayContent,
    });

    let wasCanceled = false;
    try {
      if (shouldGeneratePlan) {
        await c.setModeAndPersist('plan');

        const planMsg = createPlanMessage({
          kind: 'initial',
          task: normalizedInput.displayContent,
          turnId: c.currentTurnId,
        });
        c.messages.push(planMsg);
        c.postMessage({ type: 'message', message: planMsg });

        const plan = await c.agent.plan(normalizedInput.agentInput, c.createPlanningCallbacks(planMsg));
        applyGeneratedPlanContent({
          planMsg,
          task: normalizedInput.displayContent,
          plan,
          classifyPlanStatus: c.classifyPlanStatus,
        });

        activeSession.pendingPlan = { task: normalizedInput.displayContent, planMessageId: planMsg.id };
        c.postMessage({ type: 'updateMessage', message: planMsg });
        postPlanPendingState(c, { active: true, planMessageId: planMsg.id });
        // Plan runs can still produce usage metadata; update the global context indicator now.
        c.postMessage({ type: 'context', context: c.getContextForUI() });
        return;
      }


      await c.agent[isNew ? 'run' : 'continue'](normalizedInput.agentInput, c.createAgentCallbacks());
    } catch (error) {
      wasCanceled = this.handleRunFailure({
        error,
        turnId: c.currentTurnId,
        markStepStatus: true,
      });
    } finally {
      this.finalizeRun({ keepAbortFlag: wasCanceled, suppressQueueAutosend: wasCanceled });
    }
  }

  async retryToolCall(approvalId: string): Promise<void> {
    const c = this.controller;
    if (c.isProcessing || !c.view) return;
    if (!approvalId || typeof approvalId !== 'string') return;
    if (c.getActiveSession().pendingPlan) return;

    await c.ensureSessionsLoaded();

    const toolMsg = findLatestToolMessageByApprovalId(c.messages, approvalId);
    if (!toolMsg?.toolCall) return;

    // Keep the retry scoped to the most recent user turn by default ("continue the current task").
    const lastUserTurn = findLatestUserTurnId(c.messages);
    c.currentTurnId = toolMsg.turnId || lastUserTurn || c.currentTurnId;

    c.commitRevertedConversationIfNeeded();

    this.activateRun(true);
    c.loopManager.onRunStart(c.activeSessionId);
    c.postMessage({ type: 'processing', value: true });

    c.officeSync?.onRunStart({ clearTools: false });

    let wasCanceled = false;
    try {
      await c.agent.resume(c.createAgentCallbacks());
    } catch (error) {
      wasCanceled = this.handleRunFailure({
        error,
        turnId: c.currentTurnId,
        markStepStatus: true,
      });
    } finally {
      this.finalizeRun({ keepAbortFlag: wasCanceled, suppressQueueAutosend: wasCanceled });
    }
  }

  async executePendingPlan(planMessageId?: string): Promise<void> {
    const prepared = await this.prepareDirectPendingPlanAction({
      action: 'execute',
      planMessageId,
    });
    if (!prepared) return;

    await this.executePendingPlanTarget({
      activeSession: prepared.activeSession,
      target: prepared.target,
    });
  }

  async cancelPendingPlan(planMessageId: string): Promise<void> {
    const c = this.controller;
    const session = c.getActiveSession();
    const pendingPlan = session.pendingPlan;
    if (!pendingPlan || pendingPlan.planMessageId !== planMessageId) return;

    const planMsg = c.messages.find(m => m.id === planMessageId);
    if (planMsg?.role === 'plan' && planMsg.plan) {
      planMsg.plan.status = 'canceled';
      c.postMessage({ type: 'updateMessage', message: planMsg });
    }

    session.pendingPlan = undefined;
    await c.agent.clear();
    c.loopManager.syncActiveSession();
    c.postLoopState(session);
    postPlanPendingState(c, { active: false });
    c.persistActiveSession();
    void c.queueManager.flushAutosendForActiveSession();
  }

  async revisePendingPlan(planMessageId: string, instructions: string): Promise<void> {
    const c = this.controller;
    const trimmed = (instructions || '').trim();
    if (!trimmed) return;

    const prepared = await this.prepareDirectPendingPlanAction({
      action: 'revise',
      planMessageId,
      beforeCommit: () => c.recordInputHistory(trimmed),
    });
    if (!prepared) return;

    await this.revisePendingPlanTarget({
      activeSession: prepared.activeSession,
      target: prepared.target,
      instructions: trimmed,
    });
  }
}

export function createRunCoordinator(controller: RunCoordinatorHost): RunCoordinator {
  return new RunCoordinator(controller);
}
