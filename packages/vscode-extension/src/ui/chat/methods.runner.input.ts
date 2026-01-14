import * as vscode from 'vscode';
import type { ChatMessage } from './types';
import { isDefaultSessionTitle } from './sessionTitle';
import { createUserHistoryMessage, getMessageText } from '@lingyun/core';
import { ChatViewProvider } from '../chat';

Object.assign(ChatViewProvider.prototype, {
  sendMessage(this: ChatViewProvider, content: string): void {
    if (this.view) {
      if (this.pendingPlan && this.mode === 'plan') {
        void this.revisePendingPlan(this.pendingPlan.planMessageId, content);
      } else {
        void this.handleUserMessage(content);
      }
    }
  },

  async handleUserMessage(this: ChatViewProvider, content: string): Promise<void> {
    if (this.isProcessing || !this.view) return;
    if (this.pendingPlan) return;

    await this.ensureSessionsLoaded();

    this.recordInputHistory(content);

    this.commitRevertedConversationIfNeeded();

    this.isProcessing = true;
    this.autoApproveThisRun = false;
    this.postApprovalState();

    const checkpointState = this.agent.exportState();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      checkpoint: {
        historyLength: checkpointState.history.length,
        pendingPlan: checkpointState.pendingPlan,
      },
    };
    this.messages.push(userMsg);
    this.currentTurnId = userMsg.id;

    const activeSession = this.getActiveSession();
    const userCount = activeSession.messages.filter(m => m.role === 'user').length;
    if (userCount === 1 && isDefaultSessionTitle(activeSession.title)) {
      void this.agent
        .generateSessionTitle(content, { maxChars: 50 })
        .then(title => {
          const session = this.sessions.get(activeSession.id);
          if (!session) return;
          if (!isDefaultSessionTitle(session.title)) return;
          if (!title || !title.trim()) return;

          session.title = title.trim();
          session.updatedAt = Date.now();
          this.postSessions();
          this.markSessionDirty(session.id);
        })
        .catch(() => {});
    }

    this.postMessage({ type: 'message', message: userMsg });
    if (this.isSessionPersistenceEnabled()) {
      this.persistActiveSession();
    }

    // Important: the webview derives the active turn from the most recent user message.
    // Send the processing signal only after the user message is in the UI so the status indicator
    // attaches to the correct turn.
    this.postMessage({ type: 'processing', value: true });

    try {
      const isNew = this.agent.getHistory().length === 0;

      const planFirst = this.isPlanFirstEnabled();
      const shouldGeneratePlan = this.mode === 'plan' || (planFirst && isNew);
      if (shouldGeneratePlan) {
        if (this.mode !== 'plan') {
          this.mode = 'plan';
          this.agent.setMode('plan');
          try {
            await vscode.workspace.getConfiguration('lingyun').update('mode', 'plan', true);
          } catch {
            // Ignore persistence errors; still run in Plan mode.
          }
          this.postMessage({ type: 'modeChanged', mode: 'plan' });
        }

        const planMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'plan',
          content: 'Planning...',
          timestamp: Date.now(),
          turnId: this.currentTurnId,
          plan: { status: 'generating', task: content },
        };
        this.messages.push(planMsg);
        this.postMessage({ type: 'message', message: planMsg });

        const plan = await this.agent.plan(content, this.createPlanningCallbacks(planMsg));

        const trimmedPlan = (plan || '').trim();
        if (trimmedPlan) {
          planMsg.content = trimmedPlan;
        } else {
          const existing = (planMsg.content || '').trim();
          const placeholder = existing === 'Planning...' || existing === 'Updating plan...';
          planMsg.content = !placeholder && existing ? planMsg.content : '(No plan generated)';
        }

        planMsg.plan = { status: this.classifyPlanStatus(planMsg.content), task: content };
        this.pendingPlan = { task: content, planMessageId: planMsg.id };
        this.postMessage({ type: 'updateMessage', message: planMsg });
        this.postMessage({ type: 'planPending', value: true, planMessageId: this.pendingPlan.planMessageId });
        // Plan runs can still produce usage metadata; update the global context indicator now.
        this.postMessage({ type: 'context', context: this.getContextForUI() });
        return;
      }

      await this.agent[isNew ? 'run' : 'continue'](content, this.createAgentCallbacks());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.markActiveStepStatus(this.abortRequested || message === 'Agent aborted' ? 'canceled' : 'error');

      if (this.currentTurnId && !(message === 'Agent aborted' && !this.abortRequested)) {
        this.postMessage({ type: 'turnStatus', turnId: this.currentTurnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: this.currentTurnId,
      };
      this.messages.push(errorMsg);
      this.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.isProcessing = false;
      this.abortRequested = false;
      this.autoApproveThisRun = false;
      this.pendingApprovals.clear();
      this.postApprovalState();
      this.postMessage({ type: 'processing', value: false });
      this.persistActiveSession();
    }
  },

  async retryToolCall(this: ChatViewProvider, approvalId: string): Promise<void> {
    if (this.isProcessing || !this.view) return;
    if (!approvalId || typeof approvalId !== 'string') return;
    if (this.pendingPlan) return;

    await this.ensureSessionsLoaded();

    const toolMsg = [...this.messages].reverse().find(m => m.toolCall?.approvalId === approvalId);
    if (!toolMsg?.toolCall) return;

    // Keep the retry scoped to the most recent user turn by default ("continue the current task").
    const lastUserTurn = [...this.messages].reverse().find(m => m.role === 'user')?.id;
    this.currentTurnId = toolMsg.turnId || lastUserTurn || this.currentTurnId;

    this.commitRevertedConversationIfNeeded();

    if (toolMsg.toolCall.blockedReason === 'external_paths_disabled') {
      const allowExternalPaths =
        vscode.workspace.getConfiguration('lingyun').get<boolean>('security.allowExternalPaths', false) ?? false;

      if (allowExternalPaths) {
        const note =
          'System note: External paths are now enabled (lingyun.security.allowExternalPaths=true). ' +
          'You may retry actions that use paths outside the workspace.';

        const state = this.agent.exportState();
        const last = state.history.at(-1);
        const alreadyAdded =
          last?.role === 'user' && last?.metadata?.synthetic === true && getMessageText(last).trim() === note.trim();

        if (!alreadyAdded) {
          state.history.push(createUserHistoryMessage(note, { synthetic: true }));
          this.agent.importState(state);
          // Keep agent config in sync with the UI after state mutation.
          this.agent.updateConfig({ model: this.currentModel, mode: this.mode });
          this.agent.setMode(this.mode);
        }
      }
    }

    this.isProcessing = true;
    this.autoApproveThisRun = false;
    this.postApprovalState();
    this.postMessage({ type: 'processing', value: true });

    try {
      await this.agent.resume(this.createAgentCallbacks());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.markActiveStepStatus(this.abortRequested || message === 'Agent aborted' ? 'canceled' : 'error');

      if (this.currentTurnId && !(message === 'Agent aborted' && !this.abortRequested)) {
        this.postMessage({ type: 'turnStatus', turnId: this.currentTurnId, status: { type: 'done' } });
      }

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: message,
        timestamp: Date.now(),
        turnId: this.currentTurnId,
      };
      this.messages.push(errorMsg);
      this.postMessage({ type: 'message', message: errorMsg });
    } finally {
      this.isProcessing = false;
      this.abortRequested = false;
      this.autoApproveThisRun = false;
      this.pendingApprovals.clear();
      this.postApprovalState();
      this.postMessage({ type: 'processing', value: false });
      this.persistActiveSession();
    }
  },

  isPlanFirstEnabled(this: ChatViewProvider): boolean {
    return vscode.workspace.getConfiguration('lingyun').get<boolean>('planFirst', true) ?? true;
  },

  classifyPlanStatus(this: ChatViewProvider, plan: string): 'draft' | 'needs_input' {
    const text = (plan || '').trim();
    if (!text) return 'needs_input';

    const steps = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => /^\d+\.\s+/.test(l) || /^[-*•]\s+/.test(l))
      .map(l => l.replace(/^\d+\.\s+/, '').replace(/^[-*•]\s+/, '').trim())
      .filter(Boolean);

    if (steps.length === 0) return 'needs_input';

    const questionSteps = steps.filter(s => /\?\s*$/.test(s));
    if (questionSteps.length >= Math.ceil(steps.length / 2)) return 'needs_input';

    return 'draft';
  },
});
