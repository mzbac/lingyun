import * as vscode from 'vscode';

import type { UserHistoryInputPart } from '@kooka/core';
import { isDefaultSessionTitle } from '../sessionTitle';
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
  constructor(private readonly controller: ChatController) {}

  private finalizeRun(params?: { postProcessingSignal?: boolean; keepAbortFlag?: boolean }): void {
    const c = this.controller;
    c.isProcessing = false;
    if (!params?.keepAbortFlag) {
      c.abortRequested = false;
    }
    c.autoApproveThisRun = false;
    c.pendingApprovals.clear();
    c.postApprovalState();
    if (params?.postProcessingSignal !== false) {
      c.postMessage({ type: 'processing', value: false });
    }
    c.persistActiveSession();
  }

  async handleUserMessage(content: string | ChatUserInput): Promise<void> {
    const c = this.controller;
    if (c.isProcessing || !c.view) return;

    const normalizedInput = normalizeUserInput(content);
    if (!normalizedInput.hasContent) return;

    if (normalizedInput.text) {
      recordUserIntent(c.signals, normalizedInput.text);
    }

    if (c.pendingPlan) {
      const planMsg = c.messages.find(m => m.id === c.pendingPlan?.planMessageId);
      if (!planMsg || planMsg.role !== 'plan') {
        c.pendingPlan = undefined;
        c.postMessage({ type: 'planPending', value: false, planMessageId: '' });
        c.persistActiveSession();
      } else {
        if (!planMsg.plan) {
          planMsg.plan = { status: 'draft', task: c.pendingPlan.task };
          c.postMessage({ type: 'updateMessage', message: planMsg });
        }
        if (!normalizedInput.text) return;
        await c.revisePendingPlan(c.pendingPlan.planMessageId, normalizedInput.text);
        return;
      }
    }

    await c.ensureSessionsLoaded();

    c.recordInputHistory(normalizedInput.text);

    c.commitRevertedConversationIfNeeded();

    c.isProcessing = true;
    c.autoApproveThisRun = false;
    c.postApprovalState();

    const checkpointState = c.agent.exportState();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: normalizedInput.displayContent,
      timestamp: Date.now(),
      checkpoint: {
        historyLength: checkpointState.history.length,
        pendingPlan: checkpointState.pendingPlan,
      },
    };
    c.messages.push(userMsg);
    c.currentTurnId = userMsg.id;

    const activeSession = c.getActiveSession();
    const userCount = activeSession.messages.filter(m => m.role === 'user').length;
    if (normalizedInput.text && userCount === 1 && isDefaultSessionTitle(activeSession.title)) {
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
    if (normalizedInput.text) {
      void c.postUnknownSkillWarnings(normalizedInput.text, userMsg.id);
    }
    if (c.isSessionPersistenceEnabled()) {
      c.persistActiveSession();
    }

    // Important: the webview derives the active turn from the most recent user message.
    // Send the processing signal only after the user message is in the UI so the status indicator
    // attaches to the correct turn.
    c.postMessage({ type: 'processing', value: true });

    try {
      const isNew = c.agent.getHistory().length === 0;

      const planFirst = c.isPlanFirstEnabled();
      const shouldGeneratePlan = c.mode === 'plan' || (planFirst && isNew);
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
        c.pendingPlan = { task: normalizedInput.displayContent, planMessageId: planMsg.id };
        c.postMessage({ type: 'updateMessage', message: planMsg });
        c.postMessage({ type: 'planPending', value: true, planMessageId: c.pendingPlan.planMessageId });
        // Plan runs can still produce usage metadata; update the global context indicator now.
        c.postMessage({ type: 'context', context: c.getContextForUI() });
        return;
      }

      await c.agent[isNew ? 'run' : 'continue'](normalizedInput.agentInput, c.createAgentCallbacks());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      c.markActiveStepStatus(c.abortRequested || message === 'Agent aborted' ? 'canceled' : 'error');

      if (c.currentTurnId && !(message === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: c.currentTurnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: c.currentTurnId,
      };
      c.messages.push(errorMsg);
      c.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.finalizeRun();
    }
  }

  async retryToolCall(approvalId: string): Promise<void> {
    const c = this.controller;
    if (c.isProcessing || !c.view) return;
    if (!approvalId || typeof approvalId !== 'string') return;
    if (c.pendingPlan) return;

    await c.ensureSessionsLoaded();

    const toolMsg = [...c.messages].reverse().find(m => m.toolCall?.approvalId === approvalId);
    if (!toolMsg?.toolCall) return;

    // Keep the retry scoped to the most recent user turn by default ("continue the current task").
    const lastUserTurn = [...c.messages].reverse().find(m => m.role === 'user')?.id;
    c.currentTurnId = toolMsg.turnId || lastUserTurn || c.currentTurnId;

    c.commitRevertedConversationIfNeeded();

    c.isProcessing = true;
    c.autoApproveThisRun = false;
    c.postApprovalState();
    c.postMessage({ type: 'processing', value: true });

    try {
      await c.agent.resume(c.createAgentCallbacks());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      c.markActiveStepStatus(c.abortRequested || message === 'Agent aborted' ? 'canceled' : 'error');

      if (c.currentTurnId && !(message === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: c.currentTurnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: c.currentTurnId,
      };
      c.messages.push(errorMsg);
      c.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.finalizeRun();
    }
  }

  async executePendingPlan(planMessageId?: string): Promise<void> {
    const c = this.controller;
    if (c.isProcessing || !c.pendingPlan || !c.view) {
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

    if (!c.pendingPlan) {
      void vscode.window.showInformationMessage('LingYun: No pending plan to execute.');
      return;
    }

    const requestedId =
      typeof planMessageId === 'string' && planMessageId.trim() ? planMessageId : undefined;
    const effectiveId =
      requestedId && requestedId === c.pendingPlan.planMessageId ? requestedId : c.pendingPlan.planMessageId;

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

    c.isProcessing = true;
    c.autoApproveThisRun = false;
    c.postApprovalState();
    c.postMessage({ type: 'processing', value: true });
    c.postMessage({ type: 'planPending', value: false, planMessageId: '' });

    const previousStatus = planMsg.plan.status;
    planMsg.plan.status = 'executing';
    c.postMessage({ type: 'updateMessage', message: planMsg });
    if (c.isSessionPersistenceEnabled()) {
      c.persistActiveSession();
    }

    try {
      if (previousStatus === 'needs_input') {
        const state = c.agent.exportState();
        const basePlan =
          typeof state.pendingPlan === 'string' && state.pendingPlan.trim()
            ? state.pendingPlan
            : planMsg.content;
        if (basePlan && basePlan.trim()) {
          state.pendingPlan = appendAssumptionsToPlan(basePlan);
          c.agent.syncSession({ state, model: c.currentModel, mode: c.mode });
        }
      }

      await c.agent.execute(c.createAgentCallbacks());
      planMsg.plan.status = 'done';
      c.postMessage({ type: 'updateMessage', message: planMsg });
      c.pendingPlan = undefined;
      c.persistActiveSession();
    } catch (error) {
      planMsg.plan.status = previousStatus;
      c.postMessage({ type: 'updateMessage', message: planMsg });
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: c.pendingPlan?.planMessageId ?? '',
      });

      if (switchedToBuild) {
        await c.setModeAndPersist('plan');
      }

      const message = error instanceof Error ? error.message : String(error);
      if (planMsg.turnId && !(message === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: planMsg.turnId,
      };
      c.messages.push(errorMsg);
      c.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.finalizeRun();
    }
  }

  async regeneratePendingPlan(planMessageId: string, reason?: string): Promise<void> {
    const c = this.controller;
    if (c.isProcessing || !c.pendingPlan || !c.view) return;
    if (c.pendingPlan.planMessageId !== planMessageId) return;

    await c.ensureSessionsLoaded();
    c.commitRevertedConversationIfNeeded();

    const planMsg = c.messages.find(m => m.id === planMessageId);
    if (!planMsg || planMsg.role !== 'plan' || !planMsg.plan) return;

    c.isProcessing = true;
    c.autoApproveThisRun = false;
    c.postApprovalState();

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
          pendingPlan: checkpointState.pendingPlan,
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
      planMessageId: c.pendingPlan.planMessageId,
    });

    const previousPendingPlan = { ...c.pendingPlan };
    const taskForPlan = note ? `${c.pendingPlan.task}\n\n${note}` : c.pendingPlan.task;

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

      c.pendingPlan = { task: taskForPlan, planMessageId: nextPlanMsg.id };
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
      c.pendingPlan = previousPendingPlan;
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: c.pendingPlan.planMessageId,
      });

      const message = error instanceof Error ? error.message : String(error);
      if (planMsg.turnId && !(message === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: planMsg.turnId,
      };
      c.messages.push(errorMsg);
      c.postMessage({ type: 'message', message: errorMsg });
    } finally {
      c.isProcessing = false;
      c.postMessage({ type: 'processing', value: false });
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: c.pendingPlan?.planMessageId ?? '',
      });
      c.autoApproveThisRun = false;
      c.pendingApprovals.clear();
      c.postApprovalState();
      c.persistActiveSession();
    }
  }

  async cancelPendingPlan(planMessageId: string): Promise<void> {
    const c = this.controller;
    if (!c.pendingPlan || c.pendingPlan.planMessageId !== planMessageId) return;

    const planMsg = c.messages.find(m => m.id === planMessageId);
    if (planMsg?.role === 'plan' && planMsg.plan) {
      planMsg.plan.status = 'canceled';
      c.postMessage({ type: 'updateMessage', message: planMsg });
    }

    c.pendingPlan = undefined;
    await c.agent.clear();
    c.postMessage({ type: 'planPending', value: false, planMessageId: '' });
    c.persistActiveSession();
  }

  async revisePendingPlan(planMessageId: string, instructions: string): Promise<void> {
    const c = this.controller;
    if (c.isProcessing || !c.pendingPlan || !c.view) return;
    if (c.pendingPlan.planMessageId !== planMessageId) return;

    const trimmed = (instructions || '').trim();
    if (!trimmed) return;

    await c.ensureSessionsLoaded();
    c.recordInputHistory(trimmed);
    c.commitRevertedConversationIfNeeded();

    const planMsg = c.messages.find(m => m.id === planMessageId);
    if (!planMsg || planMsg.role !== 'plan' || !planMsg.plan) return;

    c.isProcessing = true;
    c.autoApproveThisRun = false;
    c.postApprovalState();

    const previousPendingPlan = { ...c.pendingPlan };

    const checkpointState = c.agent.exportState();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      turnId: planMsg.turnId,
      checkpoint: {
        historyLength: checkpointState.history.length,
        pendingPlan: checkpointState.pendingPlan,
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
      planMessageId: c.pendingPlan.planMessageId,
    });

    const updatedTask = `${c.pendingPlan.task}\n\nUser clarifications:\n${trimmed}`;
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

    c.pendingPlan = { task: updatedTask, planMessageId: nextPlanMsg.id };
    c.postMessage({ type: 'planPending', value: true, planMessageId: nextPlanMsg.id });

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
      c.pendingPlan = previousPendingPlan;
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: c.pendingPlan.planMessageId,
      });

      const message = error instanceof Error ? error.message : String(error);
      if (planMsg.turnId && !(message === 'Agent aborted' && !c.abortRequested)) {
        c.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: planMsg.turnId,
      };
      c.messages.push(errorMsg);
      c.postMessage({ type: 'message', message: errorMsg });
    } finally {
      c.isProcessing = false;
      c.postMessage({ type: 'processing', value: false });
      c.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: c.pendingPlan?.planMessageId ?? '',
      });
      c.autoApproveThisRun = false;
      c.pendingApprovals.clear();
      c.postApprovalState();
      c.persistActiveSession();
    }
  }
}
