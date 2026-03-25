import {
  createChatSessionPersistenceService,
  type ChatSessionPersistenceDeps,
  type ChatSessionPersistenceService,
} from './methods.sessions.persistence';
import {
  createChatSessionRuntimeService,
  type ChatSessionRuntimeDeps,
  type ChatSessionRuntimeService,
} from './methods.sessions.runtime';
import type { ChatController } from './controller';

type ChatSessionPersistenceBridge = Pick<
  ChatSessionPersistenceService,
  'ensureSessionsLoaded' | 'markSessionDirty'
>;

type ChatSessionRuntimeBridge = Pick<
  ChatSessionRuntimeService,
  'getBlankAgentState' | 'switchToSessionSync' | 'initializeSessions' | 'persistActiveSession'
>;

type ChatSessionPersistenceBaseDeps = Omit<ChatSessionPersistenceDeps, 'runtime'>;
type ChatSessionRuntimeBaseDeps = Omit<ChatSessionRuntimeDeps, 'persistence'>;

export interface ChatSessionsService
  extends ChatSessionPersistenceService,
    ChatSessionRuntimeService {}

export type ChatSessionsDeps = ChatSessionPersistenceBaseDeps & ChatSessionRuntimeBaseDeps;

function createChatSessionRuntimeDeps(
  controller: ChatSessionsDeps,
  persistence: ChatSessionPersistenceBridge
): ChatSessionRuntimeDeps {
  return {
    get view() {
      return controller.view;
    },
    get outputChannel() {
      return controller.outputChannel;
    },
    get officeSync() {
      return controller.officeSync;
    },
    get agent() {
      return controller.agent;
    },
    set agent(value) {
      controller.agent = value;
    },
    get llmProvider() {
      return controller.llmProvider;
    },
    set llmProvider(value) {
      controller.llmProvider = value;
    },
    get availableModels() {
      return controller.availableModels;
    },
    set availableModels(value) {
      controller.availableModels = value;
    },
    get currentModel() {
      return controller.currentModel;
    },
    set currentModel(value) {
      controller.currentModel = value;
    },
    get mode() {
      return controller.mode;
    },
    set mode(value) {
      controller.mode = value;
    },
    get activeSessionId() {
      return controller.activeSessionId;
    },
    set activeSessionId(value) {
      controller.activeSessionId = value;
    },
    get messages() {
      return controller.messages;
    },
    set messages(value) {
      controller.messages = value;
    },
    get sessions() {
      return controller.sessions;
    },
    get signals() {
      return controller.signals;
    },
    set signals(value) {
      controller.signals = value;
    },
    get stepCounter() {
      return controller.stepCounter;
    },
    set stepCounter(value) {
      controller.stepCounter = value;
    },
    get activeStepId() {
      return controller.activeStepId;
    },
    set activeStepId(value) {
      controller.activeStepId = value;
    },
    get abortRequested() {
      return controller.abortRequested;
    },
    set abortRequested(value) {
      controller.abortRequested = value;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    set isProcessing(value) {
      controller.isProcessing = value;
    },
    get pendingApprovals() {
      return controller.pendingApprovals;
    },
    get initAcked() {
      return controller.initAcked;
    },
    set initAcked(value) {
      controller.initAcked = value;
    },
    get loopManager() {
      return controller.loopManager;
    },
    get queueManager() {
      return controller.queueManager;
    },
    persistence,
    sendInit: (force?: boolean) => controller.sendInit(force),
    postMessage: (message: unknown) => controller.postMessage(message),
    postLoopState: () => controller.postLoopState(),
  };
}

function createChatSessionPersistenceDeps(
  controller: ChatSessionsDeps,
  runtime: ChatSessionRuntimeBridge
): ChatSessionPersistenceDeps {
  return {
    context: controller.context,
    get outputChannel() {
      return controller.outputChannel;
    },
    get view() {
      return controller.view;
    },
    get currentModel() {
      return controller.currentModel;
    },
    get activeSessionId() {
      return controller.activeSessionId;
    },
    set activeSessionId(value) {
      controller.activeSessionId = value;
    },
    get sessions() {
      return controller.sessions;
    },
    set sessions(value) {
      controller.sessions = value;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    set isProcessing(value) {
      controller.isProcessing = value;
    },
    get abortRequested() {
      return controller.abortRequested;
    },
    set abortRequested(value) {
      controller.abortRequested = value;
    },
    get pendingApprovals() {
      return controller.pendingApprovals;
    },
    get sessionsLoadedFromDisk() {
      return controller.sessionsLoadedFromDisk;
    },
    set sessionsLoadedFromDisk(value) {
      controller.sessionsLoadedFromDisk = value;
    },
    get sessionsLoadPromise() {
      return controller.sessionsLoadPromise;
    },
    set sessionsLoadPromise(value) {
      controller.sessionsLoadPromise = value;
    },
    get sessionStore() {
      return controller.sessionStore;
    },
    set sessionStore(value) {
      controller.sessionStore = value;
    },
    get sessionSaveTimer() {
      return controller.sessionSaveTimer;
    },
    set sessionSaveTimer(value) {
      controller.sessionSaveTimer = value;
    },
    get dirtySessionIds() {
      return controller.dirtySessionIds;
    },
    get inputHistoryEntries() {
      return controller.inputHistoryEntries;
    },
    set inputHistoryEntries(value) {
      controller.inputHistoryEntries = value;
    },
    get inputHistoryLoadedFromDisk() {
      return controller.inputHistoryLoadedFromDisk;
    },
    set inputHistoryLoadedFromDisk(value) {
      controller.inputHistoryLoadedFromDisk = value;
    },
    get inputHistoryStore() {
      return controller.inputHistoryStore;
    },
    set inputHistoryStore(value) {
      controller.inputHistoryStore = value;
    },
    get loopManager() {
      return controller.loopManager;
    },
    get queueManager() {
      return controller.queueManager;
    },
    runtime,
    ensureInputHistoryLoaded: () => controller.ensureInputHistoryLoaded(),
    sendInit: (force?: boolean) => controller.sendInit(force),
    postMessage: (message: unknown) => controller.postMessage(message),
  };
}

class ChatSessionsFacade implements ChatSessionsService {
  private readonly runtimeService: ChatSessionRuntimeService;
  private readonly persistenceService: ChatSessionPersistenceService;

  constructor(controller: ChatSessionsDeps) {
    this.runtimeService = createChatSessionRuntimeService(
      createChatSessionRuntimeDeps(controller, this)
    );
    this.persistenceService = createChatSessionPersistenceService(
      createChatSessionPersistenceDeps(controller, this)
    );
  }

  initializeSessions(): void {
    this.runtimeService.initializeSessions();
  }

  getBlankAgentState() {
    return this.runtimeService.getBlankAgentState();
  }

  getActiveSession() {
    return this.runtimeService.getActiveSession();
  }

  getContextForUI() {
    return this.runtimeService.getContextForUI();
  }

  getRenderableMessages() {
    return this.runtimeService.getRenderableMessages();
  }

  persistActiveSession(): void {
    this.runtimeService.persistActiveSession();
  }

  getSessionsForUI() {
    return this.runtimeService.getSessionsForUI();
  }

  postSessions(): void {
    this.runtimeService.postSessions();
  }

  createNewSession(): Promise<void> {
    return this.runtimeService.createNewSession();
  }

  switchToSession(sessionId: string): Promise<void> {
    return this.runtimeService.switchToSession(sessionId);
  }

  switchToSessionSync(sessionId: string): void {
    this.runtimeService.switchToSessionSync(sessionId);
  }

  setBackend(agent: ChatSessionRuntimeDeps['agent'], llmProvider?: ChatSessionRuntimeDeps['llmProvider']): Promise<void> {
    return this.runtimeService.setBackend(agent, llmProvider);
  }

  clearCurrentSession(): Promise<void> {
    return this.runtimeService.clearCurrentSession();
  }

  compactCurrentSession(): Promise<void> {
    return this.runtimeService.compactCurrentSession();
  }

  isSessionPersistenceEnabled(): boolean {
    return this.persistenceService.isSessionPersistenceEnabled();
  }

  getSessionPersistenceLimits() {
    return this.persistenceService.getSessionPersistenceLimits();
  }

  getOrCreateSessionStore() {
    return this.persistenceService.getOrCreateSessionStore();
  }

  pruneSessionForStorage(
    session: Parameters<ChatSessionPersistenceService['pruneSessionForStorage']>[0],
    maxSessionBytes: Parameters<ChatSessionPersistenceService['pruneSessionForStorage']>[1]
  ) {
    return this.persistenceService.pruneSessionForStorage(session, maxSessionBytes);
  }

  markSessionDirty(sessionId: string): void {
    this.persistenceService.markSessionDirty(sessionId);
  }

  scheduleSessionSave(): void {
    this.persistenceService.scheduleSessionSave();
  }

  pruneSessionsInMemory(maxSessions: number): void {
    this.persistenceService.pruneSessionsInMemory(maxSessions);
  }

  flushSessionSave(): Promise<void> {
    return this.persistenceService.flushSessionSave();
  }

  normalizeLoadedSession(
    raw: Parameters<ChatSessionPersistenceService['normalizeLoadedSession']>[0]
  ) {
    return this.persistenceService.normalizeLoadedSession(raw);
  }

  normalizeLoadedAgentState(
    raw: Parameters<ChatSessionPersistenceService['normalizeLoadedAgentState']>[0]
  ) {
    return this.persistenceService.normalizeLoadedAgentState(raw);
  }

  recoverInterruptedSessions(): void {
    this.persistenceService.recoverInterruptedSessions();
  }

  ensureSessionsLoaded(): Promise<void> {
    return this.persistenceService.ensureSessionsLoaded();
  }

  onSessionPersistenceConfigChanged(): Promise<void> {
    return this.persistenceService.onSessionPersistenceConfigChanged();
  }

  clearSavedSessions(): Promise<void> {
    return this.persistenceService.clearSavedSessions();
  }
}

function createChatSessionsDepsForController(controller: ChatController): ChatSessionsDeps {
  return {
    context: controller.context,
    get outputChannel() {
      return controller.outputChannel;
    },
    get view() {
      return controller.view;
    },
    get officeSync() {
      return controller.officeSync;
    },
    set officeSync(value) {
      controller.officeSync = value;
    },
    get agent() {
      return controller.agent;
    },
    set agent(value) {
      controller.agent = value;
    },
    get llmProvider() {
      return controller.llmProvider;
    },
    set llmProvider(value) {
      controller.llmProvider = value;
    },
    get availableModels() {
      return controller.availableModels;
    },
    set availableModels(value) {
      controller.availableModels = value;
    },
    get currentModel() {
      return controller.currentModel;
    },
    set currentModel(value) {
      controller.currentModel = value;
    },
    get mode() {
      return controller.mode;
    },
    set mode(value) {
      controller.mode = value;
    },
    get activeSessionId() {
      return controller.activeSessionId;
    },
    set activeSessionId(value) {
      controller.activeSessionId = value;
    },
    get messages() {
      return controller.messages;
    },
    set messages(value) {
      controller.messages = value;
    },
    get sessions() {
      return controller.sessions;
    },
    set sessions(value) {
      controller.sessions = value;
    },
    get signals() {
      return controller.signals;
    },
    set signals(value) {
      controller.signals = value;
    },
    get stepCounter() {
      return controller.stepCounter;
    },
    set stepCounter(value) {
      controller.stepCounter = value;
    },
    get activeStepId() {
      return controller.activeStepId;
    },
    set activeStepId(value) {
      controller.activeStepId = value;
    },
    get abortRequested() {
      return controller.abortRequested;
    },
    set abortRequested(value) {
      controller.abortRequested = value;
    },
    get isProcessing() {
      return controller.isProcessing;
    },
    set isProcessing(value) {
      controller.isProcessing = value;
    },
    get pendingApprovals() {
      return controller.pendingApprovals;
    },
    get initAcked() {
      return controller.initAcked;
    },
    set initAcked(value) {
      controller.initAcked = value;
    },
    get sessionsLoadedFromDisk() {
      return controller.sessionsLoadedFromDisk;
    },
    set sessionsLoadedFromDisk(value) {
      controller.sessionsLoadedFromDisk = value;
    },
    get sessionsLoadPromise() {
      return controller.sessionsLoadPromise;
    },
    set sessionsLoadPromise(value) {
      controller.sessionsLoadPromise = value;
    },
    get sessionStore() {
      return controller.sessionStore;
    },
    set sessionStore(value) {
      controller.sessionStore = value;
    },
    get sessionSaveTimer() {
      return controller.sessionSaveTimer;
    },
    set sessionSaveTimer(value) {
      controller.sessionSaveTimer = value;
    },
    get dirtySessionIds() {
      return controller.dirtySessionIds;
    },
    get inputHistoryEntries() {
      return controller.inputHistoryEntries;
    },
    set inputHistoryEntries(value) {
      controller.inputHistoryEntries = value;
    },
    get inputHistoryLoadedFromDisk() {
      return controller.inputHistoryLoadedFromDisk;
    },
    set inputHistoryLoadedFromDisk(value) {
      controller.inputHistoryLoadedFromDisk = value;
    },
    get inputHistoryStore() {
      return controller.inputHistoryStore;
    },
    set inputHistoryStore(value) {
      controller.inputHistoryStore = value;
    },
    get loopManager() {
      return controller.loopManager;
    },
    get queueManager() {
      return controller.queueManager;
    },
    ensureInputHistoryLoaded: () => controller.inputHistoryApi.ensureInputHistoryLoaded(),
    sendInit: (force?: boolean) => controller.webviewApi.sendInit(force),
    postMessage: (message: unknown) => controller.webviewApi.postMessage(message),
    postLoopState: () => controller.loopApi.postLoopState(),
  };
}

export function createChatSessionsService(controller: ChatSessionsDeps): ChatSessionsService {
  return new ChatSessionsFacade(controller);
}

export function createChatSessionsServiceForController(controller: ChatController): ChatSessionsService {
  return createChatSessionsService(createChatSessionsDepsForController(controller));
}
