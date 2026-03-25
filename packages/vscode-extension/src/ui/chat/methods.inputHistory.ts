import * as vscode from 'vscode';

import {
  DEFAULT_INPUT_HISTORY_MAX_ENTRIES,
  DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS,
  InputHistoryStore,
  addInputHistoryEntry,
} from '../../core/inputHistoryStore';
import { appendErrorLog, appendLog } from '../../core/logger';

import { bindChatControllerService } from './controllerService';
import type { ChatSessionsService } from './methods.sessions';
import type { ChatWebviewService } from './methods.webview';

export interface ChatInputHistoryService {
  getOrCreateInputHistoryStore(): InputHistoryStore | undefined;
  ensureInputHistoryLoaded(): Promise<void>;
  recordInputHistory(content: string): void;
  postInputHistory(): void;
}

export interface ChatInputHistoryDeps {
  context: { storageUri?: vscode.Uri; globalStorageUri?: vscode.Uri };
  inputHistoryStore?: InputHistoryStore;
  inputHistoryLoadedFromDisk: boolean;
  inputHistoryEntries: string[];
  outputChannel?: vscode.OutputChannel;
  sessionApi: Pick<ChatSessionsService, 'isSessionPersistenceEnabled'>;
  webviewApi: Pick<ChatWebviewService, 'postMessage'>;
}

export function createChatInputHistoryService(controller: ChatInputHistoryDeps): ChatInputHistoryService {
  const service = bindChatControllerService(controller, {
    getOrCreateInputHistoryStore(this: ChatInputHistoryDeps): InputHistoryStore | undefined {
      if (!this.sessionApi.isSessionPersistenceEnabled()) return undefined;

      const baseUri = this.context?.storageUri ?? this.context?.globalStorageUri;
      if (!baseUri) return undefined;

      if (this.inputHistoryStore) return this.inputHistoryStore;

      this.inputHistoryStore = new InputHistoryStore(baseUri, {
        maxEntries: DEFAULT_INPUT_HISTORY_MAX_ENTRIES,
        maxEntryChars: DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS,
        log: (message) => {
          appendLog(this.outputChannel, message, { level: 'debug', tag: 'InputHistory' });
        },
      });

      return this.inputHistoryStore;
    },

    async ensureInputHistoryLoaded(this: ChatInputHistoryDeps): Promise<void> {
      if (this.inputHistoryLoadedFromDisk) return;

      const store = service.getOrCreateInputHistoryStore();
      if (!store) return;

      try {
        const loaded = await store.load();
        if (loaded?.entries?.length && !this.inputHistoryEntries.length) {
          this.inputHistoryEntries = loaded.entries;
        }
      } catch (error) {
        appendErrorLog(this.outputChannel, 'Failed to load input history', error, {
          tag: 'InputHistory',
        });
      } finally {
        this.inputHistoryLoadedFromDisk = true;
      }
    },

    recordInputHistory(this: ChatInputHistoryDeps, content: string): void {
      const next = addInputHistoryEntry(this.inputHistoryEntries, content, {
        maxEntries: DEFAULT_INPUT_HISTORY_MAX_ENTRIES,
        maxEntryChars: DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS,
      });

      if (next === this.inputHistoryEntries) return;
      this.inputHistoryEntries = next;
      service.postInputHistory();

      const store = service.getOrCreateInputHistoryStore();
      if (!store) return;
      void store.save(next);
    },

    postInputHistory(this: ChatInputHistoryDeps): void {
      this.webviewApi.postMessage({ type: 'inputHistory', entries: this.inputHistoryEntries });
    },
  });

  return service;
}
