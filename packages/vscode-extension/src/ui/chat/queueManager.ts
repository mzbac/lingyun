import * as vscode from 'vscode';

import type { ChatQueueHost } from './controllerPorts';
import type { ChatController } from './controller';
import type {
  ChatImageAttachment,
  ChatMessage,
  ChatQueuedInput,
  ChatSessionInfo,
  ChatUserInput,
  ChatUserMessageOptions,
} from './types';

const MAX_QUEUED_INPUTS = 50;
const DEFAULT_MAX_RUNTIME_ATTACHMENT_BYTES = 96_000_000;

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

function getMaxRuntimeAttachmentBytes(): number {
  const raw = vscode.workspace.getConfiguration('lingyun').get<number>('chat.queue.maxAttachmentBytes');
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_RUNTIME_ATTACHMENT_BYTES;
  return Math.max(0, Math.floor(raw));
}

function estimateAttachmentBytes(attachments: ChatImageAttachment[]): number {
  let total = 0;
  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index];
    if (!attachment) continue;
    const dataUrl = typeof attachment.dataUrl === 'string' ? attachment.dataUrl.length : 0;
    const mediaType = typeof attachment.mediaType === 'string' ? attachment.mediaType.length : 0;
    const filename = typeof attachment.filename === 'string' ? attachment.filename.length : 0;
    total += dataUrl + mediaType + filename;
  }
  return total;
}

export class ChatQueueManager {
  private readonly attachmentsById = new Map<string, ChatImageAttachment[]>();
  private readonly attachmentBytesById = new Map<string, number>();
  private readonly autosendTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingAutosendSessionIds = new Set<string>();
  private runtimeAttachmentBytes = 0;

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

    if (payload.attachments.length > 0) {
      this.setAttachments(queued.id, payload.attachments);
    }

    if (queue.length > MAX_QUEUED_INPUTS) {
      const removeCount = queue.length - MAX_QUEUED_INPUTS;
      for (let index = 0; index < removeCount; index++) {
        const removed = queue[index];
        if (removed?.id) {
          this.deleteAttachments(removed.id);
        }
      }
      queue.splice(0, removeCount);
    }

    session.queuedInputs = queue;
    this.enforceAttachmentBudget(session);

    this.commitActiveSession(session);
    return queued;
  }

  clearActiveSession(options?: CommitOptions): void {
    this.clearSession(this.controller.getActiveSession(), options);
  }

  clearSession(session: ChatSessionInfo, options?: CommitOptions): void {
    this.cancelAutosendForSession(session.id);
    const hadQueueArray = Array.isArray(session.queuedInputs);
    const queue = this.getQueuedInputs(session);
    if (hadQueueArray && queue.length === 0) return;
    for (const item of queue) {
      if (item?.id) {
        this.deleteAttachments(item.id);
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
        this.deleteAttachments(item.id);
      }
    }
  }

  clearAllRuntimeData(): void {
    this.attachmentsById.clear();
    this.attachmentBytesById.clear();
    this.runtimeAttachmentBytes = 0;
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

  takeByIdFromActiveSession(id: string): { input?: ChatUserInput; queueChanged: boolean } {
    if (!id) return { queueChanged: false };
    const session = this.controller.getActiveSession();
    const queue = this.getQueuedInputs(session);
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      if (item?.id === id) {
        return {
          input: this.takeAtIndex(session, index),
          queueChanged: true,
        };
      }
    }
    return { queueChanged: false };
  }

  takeNextRunnableFromActiveSession(): ChatUserInput | undefined {
    return this.takeNextRunnable(this.controller.getActiveSession());
  }

  getRuntimeAttachmentCount(): number {
    return this.attachmentsById.size;
  }

  getRuntimeAttachmentBytes(): number {
    return this.runtimeAttachmentBytes;
  }

  private setAttachments(id: string, attachments: ChatImageAttachment[]): void {
    this.deleteAttachments(id);
    const bytes = estimateAttachmentBytes(attachments);
    this.attachmentsById.set(id, attachments);
    this.attachmentBytesById.set(id, bytes);
    this.runtimeAttachmentBytes += bytes;
  }

  private deleteAttachments(id: string): void {
    const bytes = this.attachmentBytesById.get(id) ?? 0;
    if (bytes > 0) {
      this.runtimeAttachmentBytes = Math.max(0, this.runtimeAttachmentBytes - bytes);
    }
    this.attachmentBytesById.delete(id);
    this.attachmentsById.delete(id);
  }

  private enforceAttachmentBudget(session: ChatSessionInfo): void {
    const maxBytes = getMaxRuntimeAttachmentBytes();
    if (this.runtimeAttachmentBytes <= maxBytes) return;

    const queue = this.getQueuedInputs(session);
    let removed = 0;
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < queue.length; readIndex++) {
      const item = queue[readIndex];
      if (this.runtimeAttachmentBytes > maxBytes && item?.id && this.attachmentsById.has(item.id)) {
        this.deleteAttachments(item.id);
        removed++;
        continue;
      }
      queue[writeIndex++] = item;
    }
    if (writeIndex < queue.length) {
      queue.length = writeIndex;
    }

    session.queuedInputs = queue;
    if (removed > 0) {
      this.postAttachmentBudgetWarning(removed, { persist: false });
    }
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
    const queue = this.getQueuedInputs(session);
    let removeCount = 0;
    let unavailableAttachmentCount = 0;
    let next: ChatUserInput | undefined;

    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      removeCount++;
      if (!item) continue;

      const attachments = item.id ? this.attachmentsById.get(item.id) || [] : [];
      const message = typeof item.message === 'string' ? item.message : '';
      const hasContent = !!message.trim() || attachments.length > 0;
      if (item.id) {
        this.deleteAttachments(item.id);
      }

      if (!hasContent) {
        if (item.attachmentCount > 0) {
          unavailableAttachmentCount++;
        }
        continue;
      }

      next = {
        message,
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      break;
    }

    if (removeCount <= 0) return undefined;
    queue.splice(0, removeCount);
    session.queuedInputs = queue;

    if (unavailableAttachmentCount > 0) {
      this.postUnavailableAttachmentWarning(unavailableAttachmentCount, { persist: false });
    }
    this.commitActiveSession(session);
    return next;
  }

  private takeAtIndex(session: ChatSessionInfo, index: number): ChatUserInput | undefined {
    const queue = this.getQueuedInputs(session);
    const item = queue[index];
    if (!item) return undefined;

    const attachments = item.id ? this.attachmentsById.get(item.id) || [] : [];
    const message = typeof item.message === 'string' ? item.message : '';
    const hasContent = !!message.trim() || attachments.length > 0;
    const missingAttachments = !hasContent && item.attachmentCount > 0;

    queue.splice(index, 1);
    session.queuedInputs = queue;
    if (item.id) {
      this.deleteAttachments(item.id);
    }

    if (missingAttachments) {
      this.postUnavailableAttachmentWarning(1, { persist: false });
      this.commitActiveSession(session);
      return undefined;
    }
    this.commitActiveSession(session);
    if (!hasContent) return undefined;

    return {
      message,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  private postAttachmentBudgetWarning(removedCount: number, options?: { persist?: boolean }): void {
    const label = removedCount === 1 ? 'message' : 'messages';
    const warningMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'warning',
      content:
        `LingYun: Removed ${removedCount} older queued image ${label} to keep runtime attachment memory bounded.`,
      timestamp: Date.now(),
    };
    this.controller.messages.push(warningMsg);
    this.controller.postMessage({ type: 'message', message: warningMsg });
    if (options?.persist !== false) {
      this.controller.persistActiveSession();
    }
  }

  private postUnavailableAttachmentWarning(removedCount = 1, options?: { persist?: boolean }): void {
    const content = removedCount === 1
      ? 'LingYun: Removed a queued message because its image attachments are no longer available (likely due to reload). Resend it with images if still needed.'
      : `LingYun: Removed ${removedCount} queued messages because their image attachments are no longer available (likely due to reload). Resend them with images if still needed.`;
    const warningMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'warning',
      content,
      timestamp: Date.now(),
    };
    this.controller.messages.push(warningMsg);
    this.controller.postMessage({ type: 'message', message: warningMsg });
    if (options?.persist !== false) {
      this.controller.persistActiveSession();
    }
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
        options?: ChatUserMessageOptions
      ) => controller.runner.handleUserMessage(content, options),
    },
    getActiveSession: () => controller.sessionApi.getActiveSession(),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
    persistActiveSession: () => controller.sessionApi.persistActiveSession(),
  });
}
