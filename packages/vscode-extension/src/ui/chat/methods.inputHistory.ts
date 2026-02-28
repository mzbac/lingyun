import {
  InputHistoryStore,
  addInputHistoryEntry,
  DEFAULT_INPUT_HISTORY_MAX_ENTRIES,
  DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS,
} from '../../core/inputHistoryStore';
import type { ChatViewProvider } from '../chat';

export function installInputHistoryMethods(view: ChatViewProvider): void {
  Object.assign(view, {
    getOrCreateInputHistoryStore(this: ChatViewProvider): InputHistoryStore | undefined {
      if (!this.isSessionPersistenceEnabled()) return undefined;

      const baseUri = this.context.storageUri ?? this.context.globalStorageUri;
      if (!baseUri) return undefined;

      if (this.inputHistoryStore) return this.inputHistoryStore;

      this.inputHistoryStore = new InputHistoryStore(baseUri, {
        maxEntries: DEFAULT_INPUT_HISTORY_MAX_ENTRIES,
        maxEntryChars: DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS,
        log: message => {
          try {
            this.outputChannel?.appendLine(message);
          } catch {
            // ignore
          }
        },
      });

      return this.inputHistoryStore;
    },

    async ensureInputHistoryLoaded(this: ChatViewProvider): Promise<void> {
      if (this.inputHistoryLoadedFromDisk) return;

      const store = this.getOrCreateInputHistoryStore();
      if (!store) return;

      try {
        const loaded = await store.load();
        if (loaded?.entries?.length) {
          if (!this.inputHistoryEntries.length) {
            this.inputHistoryEntries = loaded.entries;
          }
        }
      } catch (error) {
        console.error('Failed to load input history:', error);
      } finally {
        this.inputHistoryLoadedFromDisk = true;
      }
    },

    recordInputHistory(this: ChatViewProvider, content: string): void {
      const next = addInputHistoryEntry(this.inputHistoryEntries, content, {
        maxEntries: DEFAULT_INPUT_HISTORY_MAX_ENTRIES,
        maxEntryChars: DEFAULT_INPUT_HISTORY_MAX_ENTRY_CHARS,
      });

      if (next === this.inputHistoryEntries) return;
      this.inputHistoryEntries = next;
      this.postInputHistory();

      const store = this.getOrCreateInputHistoryStore();
      if (!store) return;
      void store.save(next);
    },

    postInputHistory(this: ChatViewProvider): void {
      this.postMessage({ type: 'inputHistory', entries: this.inputHistoryEntries });
    },
  });
}
