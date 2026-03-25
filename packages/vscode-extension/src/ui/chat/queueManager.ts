import type { ChatQueueHost } from './controllerPorts';
import type { ChatController } from './controller';
import type { ChatImageAttachment, ChatMessage, ChatQueuedInput, ChatSessionInfo, ChatUserInput } from './types';

type QueuedPayload = {
  message: string;
  displayContent: string;
  attachmentCount: number;
  attachments: ChatImageAttachment[];
};

type CommitOptions = {
  notify?: boolean;
  persist?: boolean;
};

export class ChatQueueManager {
  private readonly attachmentsById = new Map<string, ChatImageAttachment[]>();
  private readonly autosendTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingAutosendSessionIds = new Set<string>();

  constructor(private readonly controller: ChatQueueHost) {}

  getQueuedInputs(session: ChatSessionInfo = this.controller.getActiveSession()): ChatQueuedInput[] {
    if (!Array.isArray(session.queuedInputs)) {
      session.queuedInputs = [];
    }
    return session.queuedInputs;
  }

  postState(session: ChatSessionInfo = this.controller.getActiveSession()): void {
    if (session.id !== this.controller.activeSessionId) return;
    this.controller.postMessage({
      type: 'queueState',
      queuedInputs: this.getQueuedInputs(session),
    });
  }

  enqueueActiveInput(payload: QueuedPayload): ChatQueuedInput {
    const session = this.controller.getActiveSession();
    const queue = this.getQueuedInputs(session);
    const queued: ChatQueuedInput = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      message: payload.message,
      displayContent: payload.displayContent,
      attachmentCount: payload.attachmentCount,
    };

    queue.push(queued);

    while (queue.length > 50) {
      const removed = queue.shift();
      if (removed?.id) {
        this.attachmentsById.delete(removed.id);
      }
    }

    session.queuedInputs = queue;
    if (payload.attachments.length > 0) {
      this.attachmentsById.set(queued.id, payload.attachments);
    }

    this.commitActiveSession(session);
    return queued;
  }

  clearActiveSession(options?: CommitOptions): void {
    this.clearSession(this.controller.getActiveSession(), options);
  }

  clearSession(session: ChatSessionInfo, options?: CommitOptions): void {
    this.cancelAutosendForSession(session.id);
    const queue = this.getQueuedInputs(session);
    for (const item of queue) {
      if (item?.id) {
        this.attachmentsById.delete(item.id);
      }
    }
    session.queuedInputs = [];
    this.commitActiveSession(session, options);
  }

  releaseSession(session: ChatSessionInfo | undefined): void {
    if (!session) return;
    this.cancelAutosendForSession(session.id);
    const queue = this.getQueuedInputs(session);
    for (const item of queue) {
      if (item?.id) {
        this.attachmentsById.delete(item.id);
      }
    }
  }

  clearAllRuntimeData(): void {
    this.attachmentsById.clear();
    for (const timer of this.autosendTimers.values()) {
      clearTimeout(timer);
    }
    this.autosendTimers.clear();
    this.pendingAutosendSessionIds.clear();
  }

  scheduleAutosendForSession(sessionId: string, options?: { suppress?: boolean }): void {
    const id = String(sessionId || '').trim();
    if (!id) return;
    if (options?.suppress) {
      this.cancelAutosendForSession(id);
      return;
    }

    const session = this.controller.sessions.get(id);
    if (!session || this.getQueuedInputs(session).length === 0) {
      this.cancelAutosendForSession(id);
      return;
    }

    this.pendingAutosendSessionIds.add(id);
    this.armAutosendTimer(id);
  }

  async flushAutosendForActiveSession(): Promise<void> {
    await this.flushAutosendForSession(this.controller.activeSessionId);
  }

  takeByIdFromActiveSession(id: string): ChatUserInput | undefined {
    if (!id) return undefined;
    const session = this.controller.getActiveSession();
    const queue = this.getQueuedInputs(session);
    const index = queue.findIndex(item => item?.id === id);
    if (index < 0) return undefined;
    return this.takeAtIndex(session, index);
  }

  takeNextRunnableFromActiveSession(): ChatUserInput | undefined {
    return this.takeNextRunnable(this.controller.getActiveSession());
  }

  getRuntimeAttachmentCount(): number {
    return this.attachmentsById.size;
  }

  private armAutosendTimer(sessionId: string): void {
    if (this.autosendTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.autosendTimers.delete(sessionId);
      void this.flushAutosendForSession(sessionId);
    }, 0);
    this.autosendTimers.set(sessionId, timer);
  }

  private cancelAutosendForSession(sessionId: string): void {
    const id = String(sessionId || '').trim();
    if (!id) return;
    const timer = this.autosendTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.autosendTimers.delete(id);
    }
    this.pendingAutosendSessionIds.delete(id);
  }

  private async flushAutosendForSession(sessionId: string): Promise<void> {
    const id = String(sessionId || '').trim();
    if (!id) return;
    if (!this.pendingAutosendSessionIds.has(id)) return;
    if (!this.controller.view) return;
    if (this.controller.isProcessing) return;
    if (this.controller.activeSessionId !== id) return;

    const session = this.controller.sessions.get(id);
    if (!session) {
      this.cancelAutosendForSession(id);
      return;
    }
    if (session.pendingPlan) return;

    const next = this.takeNextRunnable(session);
    if (!next) {
      this.pendingAutosendSessionIds.delete(id);
      return;
    }

    this.pendingAutosendSessionIds.delete(id);
    await this.controller.runner.handleUserMessage(next, { fromQueue: true });
  }

  private takeNextRunnable(session: ChatSessionInfo): ChatUserInput | undefined {
    while (this.getQueuedInputs(session).length > 0) {
      const next = this.takeAtIndex(session, 0);
      if (next) return next;
    }
    return undefined;
  }

  private takeAtIndex(session: ChatSessionInfo, index: number): ChatUserInput | undefined {
    const queue = this.getQueuedInputs(session);
    const item = queue[index];
    if (!item) return undefined;

    const attachments = item.id ? this.attachmentsById.get(item.id) || [] : [];
    const hasContent = !!item.message.trim() || attachments.length > 0;
    const missingAttachments = !hasContent && item.attachmentCount > 0;

    queue.splice(index, 1);
    session.queuedInputs = queue;
    if (item.id) {
      this.attachmentsById.delete(item.id);
    }
    this.commitActiveSession(session);

    if (missingAttachments) {
      this.postUnavailableAttachmentWarning();
      return undefined;
    }
    if (!hasContent) return undefined;

    return {
      message: item.message,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  private postUnavailableAttachmentWarning(): void {
    const warningMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'warning',
      content:
        'LingYun: Removed a queued message because its image attachments are no longer available (likely due to reload). Resend it with images if still needed.',
      timestamp: Date.now(),
    };
    this.controller.messages.push(warningMsg);
    this.controller.postMessage({ type: 'message', message: warningMsg });
    this.controller.persistActiveSession();
  }

  private commitActiveSession(session: ChatSessionInfo, options?: CommitOptions): void {
    if (session.id !== this.controller.activeSessionId) return;
    if (options?.notify !== false) {
      this.postState(session);
    }
    if (options?.persist !== false) {
      this.controller.persistActiveSession();
    }
  }
}

export function createChatQueueManager(controller: ChatController): ChatQueueManager {
  return new ChatQueueManager({
    get activeSessionId() {
      return controller.activeSessionId;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    get messages() {
      return controller.messages;
    },
    get sessions() {
      return controller.sessions;
    },
    get view() {
      return controller.view;
    },
    runner: {
      handleUserMessage: (
        content: string | ChatUserInput,
        options?: { fromQueue?: boolean; synthetic?: boolean; displayContent?: string }
      ) => controller.runner.handleUserMessage(content, options),
    },
    getActiveSession: () => controller.sessionApi.getActiveSession(),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
    persistActiveSession: () => controller.sessionApi.persistActiveSession(),
  });
}
