import * as vscode from 'vscode';
import type { ChatMessage } from './types';
import type { ChatViewProvider } from '../chat';

const ASSUMPTIONS_HEADING = '## Assumptions (auto)';
const ASSUMPTIONS_NOTE =
  `${ASSUMPTIONS_HEADING}\n` +
  '- Proceed without further clarification; make reasonable assumptions for unanswered questions.\n' +
  '- If multiple valid options exist, choose the simplest/lowest-risk default.\n' +
  '- Continue in Build mode; do not block waiting for user input.\n';

function appendAssumptionsToPlan(plan: string): string {
  const text = (plan || '').trimEnd();
  if (!text) return ASSUMPTIONS_NOTE.trimEnd();
  if (text.includes(ASSUMPTIONS_HEADING)) return text;
  return `${text}\n\n${ASSUMPTIONS_NOTE.trimEnd()}`;
}

export function installRunnerPlanMethods(view: ChatViewProvider): void {
  Object.assign(view, {
  async executePendingPlan(this: ChatViewProvider, planMessageId?: string): Promise<void> {
    if (this.isProcessing || !this.pendingPlan || !this.view) {
      if (!this.view) return;
      if (this.isProcessing) {
        void vscode.window.showInformationMessage('LingYun: A task is already running.');
      } else {
        void vscode.window.showInformationMessage('LingYun: No pending plan to execute.');
      }
      return;
    }

    await this.ensureSessionsLoaded();
    this.commitRevertedConversationIfNeeded();

    if (!this.pendingPlan) {
      void vscode.window.showInformationMessage('LingYun: No pending plan to execute.');
      return;
    }

    const requestedId =
      typeof planMessageId === 'string' && planMessageId.trim() ? planMessageId : undefined;
    const effectiveId =
      requestedId && requestedId === this.pendingPlan.planMessageId ? requestedId : this.pendingPlan.planMessageId;

    const planMsg = this.messages.find(m => m.id === effectiveId);
    if (!planMsg || planMsg.role !== 'plan') {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: 'No pending plan found to execute. Try regenerating the plan.',
        timestamp: Date.now(),
      };
      this.messages.push(errorMsg);
      this.postMessage({ type: 'message', message: errorMsg });
      return;
    }

    if (!planMsg.plan) {
      planMsg.plan = { status: 'draft' };
    }

    const previousMode = this.mode;
    await this.setModeAndPersist('build');
    const switchedToBuild = previousMode === 'plan';

    this.isProcessing = true;
    this.autoApproveThisRun = false;
    this.postApprovalState();
    this.postMessage({ type: 'processing', value: true });
    this.postMessage({ type: 'planPending', value: false, planMessageId: '' });

    const previousStatus = planMsg.plan.status;
    planMsg.plan.status = 'executing';
    this.postMessage({ type: 'updateMessage', message: planMsg });
    if (this.isSessionPersistenceEnabled()) {
      this.persistActiveSession();
    }

    try {
      if (previousStatus === 'needs_input') {
        const state = this.agent.exportState();
        const basePlan =
          typeof state.pendingPlan === 'string' && state.pendingPlan.trim()
            ? state.pendingPlan
            : planMsg.content;
        if (basePlan && basePlan.trim()) {
          state.pendingPlan = appendAssumptionsToPlan(basePlan);
          this.agent.syncSession({ state, model: this.currentModel, mode: this.mode });
        }
      }

      await this.agent.execute(this.createAgentCallbacks());
      planMsg.plan.status = 'done';
      this.postMessage({ type: 'updateMessage', message: planMsg });
      this.pendingPlan = undefined;
      this.persistActiveSession();
    } catch (error) {
      planMsg.plan.status = previousStatus;
      this.postMessage({ type: 'updateMessage', message: planMsg });
      this.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: this.pendingPlan?.planMessageId ?? '',
      });

      if (switchedToBuild) {
        await this.setModeAndPersist('plan');
      }

      const message = error instanceof Error ? error.message : String(error);
      if (planMsg.turnId && !(message === 'Agent aborted' && !this.abortRequested)) {
        this.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: planMsg.turnId,
      };
      this.messages.push(errorMsg);
      this.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.isProcessing = false;
      this.postMessage({ type: 'processing', value: false });
      this.autoApproveThisRun = false;
      this.pendingApprovals.clear();
      this.postApprovalState();
      this.persistActiveSession();
    }
  },

  async regeneratePendingPlan(
    this: ChatViewProvider,
    planMessageId: string,
    reason?: string
  ): Promise<void> {
    if (this.isProcessing || !this.pendingPlan || !this.view) return;
    if (this.pendingPlan.planMessageId !== planMessageId) return;

    await this.ensureSessionsLoaded();
    this.commitRevertedConversationIfNeeded();

    const planMsg = this.messages.find(m => m.id === planMessageId);
    if (!planMsg || planMsg.role !== 'plan' || !planMsg.plan) return;

    this.isProcessing = true;
    this.autoApproveThisRun = false;
    this.postApprovalState();

    const note = (reason || '').trim();
    if (note) {
      const checkpointState = this.agent.exportState();
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
      this.messages.push(userMsg);
      this.postMessage({ type: 'message', message: userMsg });
    }

    // Ensure the regeneration notice is rendered before the global processing flag so the UI keeps the
    // status indicator tied to the correct (original) turn.
    this.postMessage({ type: 'processing', value: true });
    this.postMessage({
      type: 'planPending',
      value: true,
      planMessageId: this.pendingPlan.planMessageId,
    });

    const previousPendingPlan = { ...this.pendingPlan };
    const taskForPlan = note ? `${this.pendingPlan.task}\n\n${note}` : this.pendingPlan.task;

    try {
      const nextPlanMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'plan',
        content: 'Updating plan...',
        timestamp: Date.now(),
        turnId: planMsg.turnId,
        plan: { status: 'generating', task: taskForPlan },
      };
      this.messages.push(nextPlanMsg);
      this.postMessage({ type: 'message', message: nextPlanMsg });

      this.pendingPlan = { task: taskForPlan, planMessageId: nextPlanMsg.id };
      this.postMessage({ type: 'planPending', value: true, planMessageId: nextPlanMsg.id });

      const plan = await this.agent.plan(taskForPlan, this.createPlanningCallbacks(nextPlanMsg));
      const trimmedPlan = (plan || '').trim();
      if (trimmedPlan) {
        nextPlanMsg.content = trimmedPlan;
      } else {
        const existing = (nextPlanMsg.content || '').trim();
        const placeholder = existing === 'Planning...' || existing === 'Updating plan...';
        nextPlanMsg.content = !placeholder && existing ? nextPlanMsg.content : '(No plan generated)';
      }
      if (nextPlanMsg.plan) {
        nextPlanMsg.plan.status = this.classifyPlanStatus(nextPlanMsg.content);
        nextPlanMsg.plan.task = taskForPlan;
      }
      this.postMessage({ type: 'updateMessage', message: nextPlanMsg });
      this.persistActiveSession();
    } catch (error) {
      this.pendingPlan = previousPendingPlan;
      this.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: this.pendingPlan.planMessageId,
      });

      const message = error instanceof Error ? error.message : String(error);
      if (planMsg.turnId && !(message === 'Agent aborted' && !this.abortRequested)) {
        this.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: planMsg.turnId,
      };
      this.messages.push(errorMsg);
      this.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.isProcessing = false;
      this.postMessage({ type: 'processing', value: false });
      this.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: this.pendingPlan?.planMessageId ?? '',
      });
      this.autoApproveThisRun = false;
      this.pendingApprovals.clear();
      this.postApprovalState();
      this.persistActiveSession();
    }
  },

  async cancelPendingPlan(this: ChatViewProvider, planMessageId: string): Promise<void> {
    if (!this.pendingPlan || this.pendingPlan.planMessageId !== planMessageId) return;

    const planMsg = this.messages.find(m => m.id === planMessageId);
    if (planMsg?.role === 'plan' && planMsg.plan) {
      planMsg.plan.status = 'canceled';
      this.postMessage({ type: 'updateMessage', message: planMsg });
    }

    this.pendingPlan = undefined;
    await this.agent.clear();
    this.postMessage({ type: 'planPending', value: false, planMessageId: '' });
    this.persistActiveSession();
  },

  async revisePendingPlan(this: ChatViewProvider, planMessageId: string, instructions: string): Promise<void> {
    if (this.isProcessing || !this.pendingPlan || !this.view) return;
    if (this.pendingPlan.planMessageId !== planMessageId) return;

    const trimmed = (instructions || '').trim();
    if (!trimmed) return;

    await this.ensureSessionsLoaded();
    this.recordInputHistory(trimmed);
    this.commitRevertedConversationIfNeeded();

    const planMsg = this.messages.find(m => m.id === planMessageId);
    if (!planMsg || planMsg.role !== 'plan' || !planMsg.plan) return;

    this.isProcessing = true;
    this.autoApproveThisRun = false;
    this.postApprovalState();

    const previousPendingPlan = { ...this.pendingPlan };

    const checkpointState = this.agent.exportState();
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
    this.messages.push(userMsg);
    this.postMessage({ type: 'message', message: userMsg });
    void this.postUnknownSkillWarnings(trimmed, planMsg.turnId);

    // Ensure the user follow-up is rendered before the global processing flag so the UI keeps the
    // status indicator tied to the correct (original) turn.
    this.postMessage({ type: 'processing', value: true });
    this.postMessage({
      type: 'planPending',
      value: true,
      planMessageId: this.pendingPlan.planMessageId,
    });

    const updatedTask = `${this.pendingPlan.task}\n\nUser clarifications:\n${trimmed}`;
    const nextPlanMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'plan',
      content: 'Updating plan...',
      timestamp: Date.now(),
      turnId: planMsg.turnId,
      plan: { status: 'generating', task: updatedTask },
    };
    this.messages.push(nextPlanMsg);
    this.postMessage({ type: 'message', message: nextPlanMsg });

    this.pendingPlan = { task: updatedTask, planMessageId: nextPlanMsg.id };
    this.postMessage({ type: 'planPending', value: true, planMessageId: nextPlanMsg.id });

    try {
      const plan = await this.agent.plan(updatedTask, this.createPlanningCallbacks(nextPlanMsg));
      const trimmedPlan = (plan || '').trim();
      if (trimmedPlan) {
        nextPlanMsg.content = trimmedPlan;
      } else {
        const existing = (nextPlanMsg.content || '').trim();
        const placeholder = existing === 'Planning...' || existing === 'Updating plan...';
        nextPlanMsg.content = !placeholder && existing ? nextPlanMsg.content : '(No plan generated)';
      }
      if (nextPlanMsg.plan) {
        nextPlanMsg.plan.status = this.classifyPlanStatus(nextPlanMsg.content);
        nextPlanMsg.plan.task = updatedTask;
      }
      this.postMessage({ type: 'updateMessage', message: nextPlanMsg });
      this.persistActiveSession();
    } catch (error) {
      this.pendingPlan = previousPendingPlan;
      this.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: this.pendingPlan.planMessageId,
      });

      const message = error instanceof Error ? error.message : String(error);
      if (planMsg.turnId && !(message === 'Agent aborted' && !this.abortRequested)) {
        this.postMessage({ type: 'turnStatus', turnId: planMsg.turnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: planMsg.turnId,
      };
      this.messages.push(errorMsg);
      this.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.isProcessing = false;
      this.postMessage({ type: 'processing', value: false });
      this.postMessage({
        type: 'planPending',
        value: true,
        planMessageId: this.pendingPlan?.planMessageId ?? '',
      });
      this.autoApproveThisRun = false;
      this.pendingApprovals.clear();
      this.postApprovalState();
      this.persistActiveSession();
    }
  },
  });
}
