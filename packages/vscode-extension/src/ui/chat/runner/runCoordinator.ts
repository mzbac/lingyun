import * as vscode from 'vscode';

import type { UserHistoryInputPart } from '@kooka/core';
import { isDefaultSessionTitle } from '../sessionTitle';
import { formatErrorForUser } from '../utils';
import { recordUserIntent } from '../../../core/sessionSignals';

import type { ChatController } from '../controller';
import type { ChatMessage, ChatUserInput } from '../types';

const MAX_USER_IMAGE_ATTACHMENTS = 8;
const MAX_USER_IMAGE_DATA_URL_LENGTH = 12_000_000;

const ASSUMPTIONS_HEADING = '## Assumptions (auto)';
const ASSUMPTIONS_NOTE =
  `${ASSUMPTIONS_HEADING}\n` +
  '- Proceed without further clarification; make reasonable assumptions for unanswered questions.\n' +
  '- If multiple valid options exist, choose the simplest/lowest-risk default.\n' +
  '- Continue in Build mode; do not block waiting for user input.\n';

type NormalizedUserInput = {
  text: string;
  agentInput: UserHistoryInputPart[];
  imageAttachments: NonNullable<ChatUserInput['attachments']>;
  attachmentCount: number;
  displayContent: string;
  hasContent: boolean;
};

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

  constructor(private readonly controller: ChatController) {}

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

  private enqueueQueuedInput(params: { normalized: NormalizedUserInput; displayContent?: string }): void {
    this.controller.queueManager.enqueueActiveInput({
      message: params.normalized.text,
      displayContent: params.displayContent ?? params.normalized.displayContent,
      attachmentCount: params.normalized.attachmentCount,
      attachments: params.normalized.imageAttachments,
    });
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

    if (normalizedInput.text && !options?.fromQueue && !options?.synthetic) {
      recordUserIntent(c.signals, normalizedInput.text);
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
      const planMsg = c.messages.find(m => m.id === pendingPlan.planMessageId);
      if (!planMsg || planMsg.role !== 'plan') {
        activeSession.pendingPlan = undefined;
        c.postMessage({ type: 'planPending', value: false, planMessageId: '' });
        c.persistActiveSession();
      } else {
        if (!planMsg.plan) {
          planMsg.plan = { status: 'draft', task: pendingPlan.task };
          c.postMessage({ type: 'updateMessage', message: planMsg });
        }
        if (!normalizedInput.text) return;
        await c.revisePendingPlan(pendingPlan.planMessageId, normalizedInput.text);
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

    c.isProcessing = true;
    this.loopSteerableDuringProcessing = !shouldGeneratePlan;
    c.autoApproveThisRun = false;
    c.postApprovalState();
    c.loopManager.onRunStart(activeSession.id);

    c.officeSync?.onRunStart();

    const checkpointState = c.agent.exportState();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: options?.displayContent ?? normalizedInput.displayContent,
      timestamp: Date.now(),
      checkpoint: {
        historyLength: checkpointState.history.length,
      },
    };
    c.messages.push(userMsg);
    c.currentTurnId = userMsg.id;

    const userCount = activeSession.messages.filter(m => m.role === 'user').length;
    if (
      normalizedInput.text &&
      userCount === 1 &&
      isDefaultSessionTitle(activeSession.title) &&
      !options?.synthetic
    ) {
      void c.agent
        .generateSessionTitle(normalizedInput.text, { maxChars: 50 })
        .then(title => {
          const session = c.sessions.get(activeSession.id);
          if (!session) return;
          if (!isDefaultSessionTitle(session.title)) return;
          if (!title || !title.trim()) return;

          session.title = title.trim();
          session.updatedAt = Date.now();
          c.postSessions();
          c.markSessionDirty(session.id);
        })
        .catch(() => {});
    }

    c.postMessage({ type: 'message', message: userMsg });
    if (normalizedInput.text && !options?.synthetic) {
      void c.postUnknownSkillWarnings(normalizedInput.text, userMsg.id);
    }
    if (c.isSessionPersistenceEnabled()) {
      c.persistActiveSession();
    }

    // Important: the webview derives the active turn from the most recent user message.
    // Send the processing signal only after the user message is in the UI so the status indicator
    // attaches to the correct turn.
    c.postMessage({ type: 'processing', value: true });

    let wasCanceled = false;
    try {
      if (shouldGeneratePlan) {
        await c.setModeAndPersist('plan');

        const planMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'plan',
          content: 'Planning...',
          timestamp: Date.now(),
          turnId: c.currentTurnId,
          plan: { status: 'generating', task: normalizedInput.displayContent },
        };
        c.messages.push(planMsg);
        c.postMessage({ type: 'message', message: planMsg });

        const plan = await c.agent.plan(normalizedInput.agentInput, c.createPlanningCallbacks(planMsg));

        const trimmedPlan = (plan || '').trim();
        if (trimmedPlan) {
          planMsg.content = trimmedPlan;
        } else {
          const existing = (planMsg.content || '').trim();
          const placeholder = existing === 'Planning...' || existing === 'Updating plan...';
          planMsg.content = !placeholder && existing ? planMsg.content : '(No plan generated)';
        }

        planMsg.plan = { status: c.classifyPlanStatus(planMsg.content), task: normalizedInput.displayContent };
        activeSession.pendingPlan = { task: normalizedInput.displayContent, planMessageId: planMsg.id };
        c.postMessage({ type: 'updateMessage', message: planMsg });
        c.postMessage({ type: 'planPending', value: true, planMessageId: planMsg.id });
        // Plan runs can still produce usage metadata; update the global context indicator now.
        c.postMessage({ type: 'context', context: c.getContextForUI() });
        return;
      }

      await c.agent[isNew ? 'run' : 'continue'](normalizedInput.agentInput, c.createAgentCallbacks());
    } catch (error) {
      const message = formatErrorForUser(error, { llmProviderId: c.llmProvider?.id });
      const trimmed = message.trim();
      wasCanceled = c.abortRequested || trimmed === 'Agent aborted';
      c.markActiveStepStatus(wasCanceled ? 'canceled' : 'error');

      if (c.currentTurnId && !(trimmed === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: c.currentTurnId, status: { type: 'done' } });
      }

      const alreadyPosted =
        !!c.currentTurnId &&
        [...c.messages]
          .reverse()
          .some((m) => m.turnId === c.currentTurnId && m.role === 'error' && (m.content || '').trim() === trimmed);

      if (!alreadyPosted) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'error',
          content: message,
          timestamp: Date.now(),
          turnId: c.currentTurnId,
        };
        c.messages.push(errorMsg);
        c.postMessage({ type: 'message', message: errorMsg });
      }
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

    const toolMsg = [...c.messages].reverse().find(m => m.toolCall?.approvalId === approvalId);
    if (!toolMsg?.toolCall) return;

    // Keep the retry scoped to the most recent user turn by default ("continue the current task").
    const lastUserTurn = [...c.messages].reverse().find(m => m.role === 'user')?.id;
    c.currentTurnId = toolMsg.turnId || lastUserTurn || c.currentTurnId;

    c.commitRevertedConversationIfNeeded();

    c.isProcessing = true;
    this.loopSteerableDuringProcessing = true;
    c.autoApproveThisRun = false;
    c.postApprovalState();
    c.loopManager.onRunStart(c.activeSessionId);
    c.postMessage({ type: 'processing', value: true });

    c.officeSync?.onRunStart({ clearTools: false });

    let wasCanceled = false;
    try {
      await c.agent.resume(c.createAgentCallbacks());
    } catch (error) {
      const message = formatErrorForUser(error, { llmProviderId: c.llmProvider?.id });
      const trimmed = message.trim();
      wasCanceled = c.abortRequested || trimmed === 'Agent aborted';
      c.markActiveStepStatus(wasCanceled ? 'canceled' : 'error');

      if (c.currentTurnId && !(trimmed === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: c.currentTurnId, status: { type: 'done' } });
      }

      const alreadyPosted =
        !!c.currentTurnId &&
        [...c.messages]
          .reverse()
          .some((m) => m.turnId === c.currentTurnId && m.role === 'error' && (m.content || '').trim() === trimmed);

      if (!alreadyPosted) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'error',
          content: message,
          timestamp: Date.now(),
          turnId: c.currentTurnId,
        };
        c.messages.push(errorMsg);
        c.postMessage({ type: 'message', message: errorMsg });
      }
    } finally {
      this.finalizeRun({ keepAbortFlag: wasCanceled, suppressQueueAutosend: wasCanceled });
    }
  }

  async executePendingPlan(planMessageId?: string): Promise<void> {
    const c = this.controller;
    const session = c.getActiveSession();
    const pendingPlan = session.pendingPlan;
    if (c.isProcessing || !pendingPlan || !c.view) {
      if (!c.view) return;
      if (c.isProcessing) {
        void vscode.window.showInformationMessage('LingYun: A task is already running.');
      } else {
        void vscode.window.showInformationMessage('LingYun: No pending plan to execute.');
      }
      return;
    }

    await c.ensureSessionsLoaded();
    c.commitRevertedConversationIfNeeded();

    const refreshedPendingPlan = c.getActiveSession().pendingPlan;
    if (!refreshedPendingPlan) {
      void vscode.window.showInformationMessage('LingYun: No pending plan to execute.');
      return;
    }

    const requestedId =
      typeof planMessageId === 'string' && planMessageId.trim() ? planMessageId : undefined;
    const effectiveId =
      requestedId && requestedId === refreshedPendingPlan.planMessageId ? requestedId : refreshedPendingPlan.planMessageId;

    const planMsg = c.messages.find(m => m.id === effectiveId);
    if (!planMsg || planMsg.role !== 'plan') {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: 'No pending plan found to execute. Try regenerating the plan.',
        timestamp: Date.now(),
      };
      c.messages.push(errorMsg);
      c.postMessage({ type: 'message', message: errorMsg });
      return;
    }

    if (!planMsg.plan) {
      planMsg.plan = { status: 'draft' };
    }

    const previousMode = c.mode;
    await c.setModeAndPersist('build');
    const switchedToBuild = previousMode === 'plan';
    const lastUserTurn = [...c.messages].reverse().find(m => m.role === 'user')?.id;
    c.currentTurnId = planMsg.turnId || lastUserTurn || c.currentTurnId;

    c.isProcessing = true;
    this.loopSteerableDuringProcessing = true;
    c.autoApproveThisRun = false;
    c.postApprovalState();
    c.postMessage({ type: 'processing', value: true });
    c.postMessage({ type: 'planPending', value: false, planMessageId: '' });
    c.loopManager.onRunStart(c.activeSessionId);

    c.officeSync?.onRunStart();

    const previousStatus = planMsg.plan.status;
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
      c.getActiveSession().pendingPlan = undefined;
      c.persistActiveSession();
    } catch (error) {
      planMsg.plan.status = previousStatus;
      c.postMessage({ type: 'updateMessage', message: planMsg });
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: c.getActiveSession().pendingPlan?.planMessageId ?? '',
      });

      if (switchedToBuild) {
        await c.setModeAndPersist('plan');
      }

      const message = formatErrorForUser(error, { llmProviderId: c.llmProvider?.id });
      const trimmed = message.trim();
      wasCanceled = c.abortRequested || trimmed === 'Agent aborted';
      if (planMsg.turnId && !(trimmed === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const alreadyPosted =
        !!planMsg.turnId &&
        [...c.messages]
          .reverse()
          .some((m) => m.turnId === planMsg.turnId && m.role === 'error' && (m.content || '').trim() === trimmed);

      if (!alreadyPosted) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'error',
          content: message,
          timestamp: Date.now(),
          turnId: planMsg.turnId,
        };
        c.messages.push(errorMsg);
        c.postMessage({ type: 'message', message: errorMsg });
      }
    } finally {
      this.finalizeRun({ keepAbortFlag: wasCanceled, suppressQueueAutosend: wasCanceled });
    }
  }

  async regeneratePendingPlan(planMessageId: string, reason?: string): Promise<void> {
    const c = this.controller;
    const session = c.getActiveSession();
    const pendingPlan = session.pendingPlan;
    if (c.isProcessing || !pendingPlan || !c.view) return;
    if (pendingPlan.planMessageId !== planMessageId) return;

    await c.ensureSessionsLoaded();
    c.commitRevertedConversationIfNeeded();

    const planMsg = c.messages.find(m => m.id === planMessageId);
    if (!planMsg || planMsg.role !== 'plan' || !planMsg.plan) return;

    c.isProcessing = true;
    this.loopSteerableDuringProcessing = false;
    c.autoApproveThisRun = false;
    c.postApprovalState();

    c.officeSync?.onRunStart();

    const note = (reason || '').trim();
    if (note) {
      const checkpointState = c.agent.exportState();
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: note,
        timestamp: Date.now(),
        turnId: planMsg.turnId,
        checkpoint: {
          historyLength: checkpointState.history.length,
        },
      };
      c.messages.push(userMsg);
      c.postMessage({ type: 'message', message: userMsg });
    }

    // Ensure the regeneration notice is rendered before the global processing flag so the UI keeps the
    // status indicator tied to the correct (original) turn.
    c.postMessage({ type: 'processing', value: true });
    c.postMessage({
      type: 'planPending',
      value: true,
      planMessageId: pendingPlan.planMessageId,
    });

    const previousPendingPlan = { ...pendingPlan };
    const taskForPlan = note ? `${pendingPlan.task}\n\n${note}` : pendingPlan.task;

    let wasCanceled = false;
    try {
      const nextPlanMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'plan',
        content: 'Updating plan...',
        timestamp: Date.now(),
        turnId: planMsg.turnId,
        plan: { status: 'generating', task: taskForPlan },
      };
      c.messages.push(nextPlanMsg);
      c.postMessage({ type: 'message', message: nextPlanMsg });

      session.pendingPlan = { task: taskForPlan, planMessageId: nextPlanMsg.id };
      c.postMessage({ type: 'planPending', value: true, planMessageId: nextPlanMsg.id });

      const plan = await c.agent.plan(taskForPlan, c.createPlanningCallbacks(nextPlanMsg));
      const trimmedPlan = (plan || '').trim();
      if (trimmedPlan) {
        nextPlanMsg.content = trimmedPlan;
      } else {
        const existing = (nextPlanMsg.content || '').trim();
        const placeholder = existing === 'Planning...' || existing === 'Updating plan...';
        nextPlanMsg.content = !placeholder && existing ? nextPlanMsg.content : '(No plan generated)';
      }
      if (nextPlanMsg.plan) {
        nextPlanMsg.plan.status = c.classifyPlanStatus(nextPlanMsg.content);
        nextPlanMsg.plan.task = taskForPlan;
      }
      c.postMessage({ type: 'updateMessage', message: nextPlanMsg });
      c.persistActiveSession();
    } catch (error) {
      session.pendingPlan = previousPendingPlan;
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: previousPendingPlan.planMessageId,
      });

      const message = formatErrorForUser(error, { llmProviderId: c.llmProvider?.id });
      const trimmed = message.trim();
      wasCanceled = c.abortRequested || trimmed === 'Agent aborted';
      if (planMsg.turnId && !(trimmed === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const alreadyPosted =
        !!planMsg.turnId &&
        [...c.messages]
          .reverse()
          .some((m) => m.turnId === planMsg.turnId && m.role === 'error' && (m.content || '').trim() === trimmed);

      if (!alreadyPosted) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'error',
          content: message,
          timestamp: Date.now(),
          turnId: planMsg.turnId,
        };
        c.messages.push(errorMsg);
        c.postMessage({ type: 'message', message: errorMsg });
      }
    } finally {
      c.isProcessing = false;
      this.loopSteerableDuringProcessing = false;
      c.postMessage({ type: 'processing', value: false });
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: session.pendingPlan?.planMessageId ?? '',
      });
      c.autoApproveThisRun = false;
      c.pendingApprovals.clear();
      c.postApprovalState();
      c.officeSync?.onRunEnd();
      c.persistActiveSession();
      c.queueManager.scheduleAutosendForSession(c.activeSessionId, { suppress: wasCanceled });
    }
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
    c.postMessage({ type: 'planPending', value: false, planMessageId: '' });
    c.persistActiveSession();
    void c.queueManager.flushAutosendForActiveSession();
  }

  async revisePendingPlan(planMessageId: string, instructions: string): Promise<void> {
    const c = this.controller;
    const session = c.getActiveSession();
    const pendingPlan = session.pendingPlan;
    if (c.isProcessing || !pendingPlan || !c.view) return;
    if (pendingPlan.planMessageId !== planMessageId) return;

    const trimmed = (instructions || '').trim();
    if (!trimmed) return;

    await c.ensureSessionsLoaded();
    c.recordInputHistory(trimmed);
    c.commitRevertedConversationIfNeeded();

    const planMsg = c.messages.find(m => m.id === planMessageId);
    if (!planMsg || planMsg.role !== 'plan' || !planMsg.plan) return;

    c.isProcessing = true;
    this.loopSteerableDuringProcessing = false;
    c.autoApproveThisRun = false;
    c.postApprovalState();

    c.officeSync?.onRunStart();

    const previousPendingPlan = { ...pendingPlan };

    const checkpointState = c.agent.exportState();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      turnId: planMsg.turnId,
      checkpoint: {
        historyLength: checkpointState.history.length,
      },
    };
    c.messages.push(userMsg);
    c.postMessage({ type: 'message', message: userMsg });
    void c.postUnknownSkillWarnings(trimmed, planMsg.turnId);

    // Ensure the user follow-up is rendered before the global processing flag so the UI keeps the
    // status indicator tied to the correct (original) turn.
    c.postMessage({ type: 'processing', value: true });
    c.postMessage({
      type: 'planPending',
      value: true,
      planMessageId: pendingPlan.planMessageId,
    });

    const updatedTask = `${pendingPlan.task}\n\nUser clarifications:\n${trimmed}`;
    const nextPlanMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'plan',
      content: 'Updating plan...',
      timestamp: Date.now(),
      turnId: planMsg.turnId,
      plan: { status: 'generating', task: updatedTask },
    };
    c.messages.push(nextPlanMsg);
    c.postMessage({ type: 'message', message: nextPlanMsg });

    session.pendingPlan = { task: updatedTask, planMessageId: nextPlanMsg.id };
    c.postMessage({ type: 'planPending', value: true, planMessageId: nextPlanMsg.id });

    let wasCanceled = false;
    try {
      const plan = await c.agent.plan(updatedTask, c.createPlanningCallbacks(nextPlanMsg));
      const trimmedPlan = (plan || '').trim();
      if (trimmedPlan) {
        nextPlanMsg.content = trimmedPlan;
      } else {
        const existing = (nextPlanMsg.content || '').trim();
        const placeholder = existing === 'Planning...' || existing === 'Updating plan...';
        nextPlanMsg.content = !placeholder && existing ? nextPlanMsg.content : '(No plan generated)';
      }
      if (nextPlanMsg.plan) {
        nextPlanMsg.plan.status = c.classifyPlanStatus(nextPlanMsg.content);
        nextPlanMsg.plan.task = updatedTask;
      }
      c.postMessage({ type: 'updateMessage', message: nextPlanMsg });
      c.persistActiveSession();
    } catch (error) {
      session.pendingPlan = previousPendingPlan;
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: previousPendingPlan.planMessageId,
      });

      const message = formatErrorForUser(error, { llmProviderId: c.llmProvider?.id });
      const trimmed = message.trim();
      wasCanceled = c.abortRequested || trimmed === 'Agent aborted';
      if (planMsg.turnId && !(trimmed === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const alreadyPosted =
        !!planMsg.turnId &&
        [...c.messages]
          .reverse()
          .some((m) => m.turnId === planMsg.turnId && m.role === 'error' && (m.content || '').trim() === trimmed);

      if (!alreadyPosted) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'error',
          content: message,
          timestamp: Date.now(),
          turnId: planMsg.turnId,
        };
        c.messages.push(errorMsg);
        c.postMessage({ type: 'message', message: errorMsg });
      }
    } finally {
      c.isProcessing = false;
      this.loopSteerableDuringProcessing = false;
      c.postMessage({ type: 'processing', value: false });
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: session.pendingPlan?.planMessageId ?? '',
      });
      c.autoApproveThisRun = false;
      c.pendingApprovals.clear();
      c.postApprovalState();
      c.officeSync?.onRunEnd();
      c.persistActiveSession();
      c.queueManager.scheduleAutosendForSession(c.activeSessionId, { suppress: wasCanceled });
    }
  }
}
