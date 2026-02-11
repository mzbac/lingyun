import * as vscode from 'vscode';
import type { UserHistoryInputPart } from '@kooka/core';
import type { ChatMessage, ChatUserInput } from './types';
import { isDefaultSessionTitle } from './sessionTitle';
import { ChatViewProvider } from '../chat';

const MAX_USER_IMAGE_ATTACHMENTS = 8;
const MAX_USER_IMAGE_DATA_URL_LENGTH = 12_000_000;

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

Object.assign(ChatViewProvider.prototype, {
  sendMessage(this: ChatViewProvider, content: string): void {
    if (this.view) {
      void this.handleUserMessage(content);
    }
  },

  async handleUserMessage(this: ChatViewProvider, content: string | ChatUserInput): Promise<void> {
    if (this.isProcessing || !this.view) return;

    const normalizedInput = normalizeUserInput(content);
    if (!normalizedInput.hasContent) return;

    if (this.pendingPlan) {
      const planMsg = this.messages.find(m => m.id === this.pendingPlan?.planMessageId);
      if (!planMsg || planMsg.role !== 'plan') {
        this.pendingPlan = undefined;
        this.postMessage({ type: 'planPending', value: false, planMessageId: '' });
        this.persistActiveSession();
      } else {
        if (!planMsg.plan) {
          planMsg.plan = { status: 'draft', task: this.pendingPlan.task };
          this.postMessage({ type: 'updateMessage', message: planMsg });
        }
        if (!normalizedInput.text) return;
        await this.revisePendingPlan(this.pendingPlan.planMessageId, normalizedInput.text);
        return;
      }
    }

    await this.ensureSessionsLoaded();

    this.recordInputHistory(normalizedInput.text);

    this.commitRevertedConversationIfNeeded();

    this.isProcessing = true;
    this.autoApproveThisRun = false;
    this.postApprovalState();

    const checkpointState = this.agent.exportState();
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
    this.messages.push(userMsg);
    this.currentTurnId = userMsg.id;

    const activeSession = this.getActiveSession();
    const userCount = activeSession.messages.filter(m => m.role === 'user').length;
    if (normalizedInput.text && userCount === 1 && isDefaultSessionTitle(activeSession.title)) {
      void this.agent
        .generateSessionTitle(normalizedInput.text, { maxChars: 50 })
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
    if (normalizedInput.text) {
      void this.postUnknownSkillWarnings(normalizedInput.text, userMsg.id);
    }
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
          plan: { status: 'generating', task: normalizedInput.displayContent },
        };
        this.messages.push(planMsg);
        this.postMessage({ type: 'message', message: planMsg });

        const plan = await this.agent.plan(normalizedInput.agentInput, this.createPlanningCallbacks(planMsg));

        const trimmedPlan = (plan || '').trim();
        if (trimmedPlan) {
          planMsg.content = trimmedPlan;
        } else {
          const existing = (planMsg.content || '').trim();
          const placeholder = existing === 'Planning...' || existing === 'Updating plan...';
          planMsg.content = !placeholder && existing ? planMsg.content : '(No plan generated)';
        }

        planMsg.plan = { status: this.classifyPlanStatus(planMsg.content), task: normalizedInput.displayContent };
        this.pendingPlan = { task: normalizedInput.displayContent, planMessageId: planMsg.id };
        this.postMessage({ type: 'updateMessage', message: planMsg });
        this.postMessage({ type: 'planPending', value: true, planMessageId: this.pendingPlan.planMessageId });
        // Plan runs can still produce usage metadata; update the global context indicator now.
        this.postMessage({ type: 'context', context: this.getContextForUI() });
        return;
      }

      await this.agent[isNew ? 'run' : 'continue'](normalizedInput.agentInput, this.createAgentCallbacks());
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
