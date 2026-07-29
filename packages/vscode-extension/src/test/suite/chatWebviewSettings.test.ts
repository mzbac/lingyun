import * as assert from 'assert';
import * as vscode from 'vscode';

import { toolRegistry } from '../../core/registry';
import {
  WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE,
  WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
} from '../../ui/chat/webviewProtocol';
import type { ChatMessage } from '../../ui/chat/types';
import { createStandaloneChatController } from './chatControllerHarness';

type ChatWebviewApi = ReturnType<typeof createStandaloneChatController>['webviewApi'];

type DefaultSettingCase = {
  name: string;
  key: string;
  invoke(api: ChatWebviewApi): Promise<void>;
  expectedMessage: unknown;
};

type GroupedDefaultSettingCase = {
  name: string;
  keys: string[];
  invoke(api: ChatWebviewApi): Promise<void>;
  expectedMessage: unknown;
};

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

function waitForImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

suite('Chat webview settings service', () => {
  test('initial transcript payload is bounded and earlier groups are served on demand', async () => {
    const controller = createStandaloneChatController();
    const posted: any[] = [];
    const history: ChatMessage[] = [];
    const content = 'x'.repeat(2048);
    for (let index = 0; index < 150; index++) {
      const turnId = `user-${index}`;
      history.push({
        id: turnId,
        role: 'user',
        content,
        timestamp: index,
      });
      history.push({
        id: `assistant-${index}`,
        role: 'assistant',
        turnId,
        content,
        timestamp: index,
      });
    }

    controller.messages = history;
    controller.sessionApi.getActiveSession().messages = history;
    controller.availableModels = [{ id: controller.currentModel, name: controller.currentModel } as any];
    controller.sessionApi.ensureSessionsLoaded = async () => {};
    controller.view = {
      webview: {
        postMessage(message: unknown) {
          posted.push(message);
          return Promise.resolve(true);
        },
      },
    } as unknown as vscode.WebviewView;

    await controller.webviewApi.sendInit();
    const init = posted.find((message) => message?.type === 'init');
    assert.ok(init);
    assert.strictEqual(init.messages.length, 48);
    assert.strictEqual(init.messages[0].id, 'user-126');
    assert.deepStrictEqual(init.transcriptHistory, {
      mode: 'paged',
      hasEarlierMessages: true,
      cursor: 'user-126',
    });

    const fullBytes = Buffer.byteLength(JSON.stringify(history));
    const initialBytes = Buffer.byteLength(JSON.stringify(init.messages));
    assert.ok(initialBytes < fullBytes * 0.2, `${initialBytes} should be less than 20% of ${fullBytes}`);

    controller.webviewApi.loadEarlierTranscriptMessages({
      type: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
      requestId: 1,
      sessionId: controller.activeSessionId,
      cursor: init.transcriptHistory.cursor,
    });
    const page = posted.find((message) => message?.type === 'transcriptHistoryPage');
    assert.ok(page);
    assert.strictEqual(page.requestId, 1);
    assert.strictEqual(page.requestCursor, 'user-126');
    assert.strictEqual(page.messages.length, 32);
    assert.strictEqual(page.messages[0].id, 'user-110');
    assert.strictEqual(page.messages.at(-1).id, 'assistant-125');
    assert.strictEqual(page.cursor, 'user-110');
    assert.strictEqual(page.hasEarlierMessages, true);
  });

  test('webview history requests are routed and stale sessions cannot read the active transcript', async () => {
    const controller = createStandaloneChatController();
    const posted: any[] = [];
    let receiveMessage: ((message: unknown) => unknown) | undefined;
    controller.messages = Array.from({ length: 30 }, (_, index) => {
      const turnId = `user-${index}`;
      return [
        {
          id: turnId,
          role: 'user',
          content: `Question ${index}`,
          timestamp: index,
        },
        {
          id: `assistant-${index}`,
          role: 'assistant',
          turnId,
          content: `Answer ${index}`,
          timestamp: index,
        },
      ] as ChatMessage[];
    }).flat();
    controller.sessionApi.getActiveSession().messages = controller.messages;

    const view = {
      visible: true,
      webview: {
        options: {},
        html: '',
        cspSource: 'test-csp',
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: (message: unknown) => {
          posted.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
          receiveMessage = listener;
          return { dispose() {} };
        },
      },
      onDidChangeVisibility: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    } as unknown as vscode.WebviewView;

    controller.initInFlight = true;
    controller.webviewApi.resolveWebviewView(view);
    if (controller.initInterval) {
      clearInterval(controller.initInterval);
      controller.initInterval = undefined;
    }
    controller.initInFlight = false;
    assert.ok(receiveMessage);

    await receiveMessage?.({
      type: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
      requestId: 1,
      sessionId: controller.activeSessionId,
      cursor: 'user-6',
    });
    const page = posted.find((message) => message?.type === WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE);
    assert.ok(page);
    assert.strictEqual(page.messages[0]?.id, 'user-0');
    assert.strictEqual(page.hasEarlierMessages, false);

    await receiveMessage?.({
      type: WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_REQUEST,
      requestId: 2,
      sessionId: 'stale-session',
      cursor: 'user-6',
    });
    const stalePage = posted.find((message) =>
      message?.type === WEBVIEW_MESSAGE_TRANSCRIPT_HISTORY_PAGE && message.requestId === 2
    );
    assert.ok(stalePage);
    assert.strictEqual(stalePage.error, 'staleSession');
    assert.deepStrictEqual(stalePage.messages, []);
  });

  test('initial transcript state does not wait for optional provider metadata', async () => {
    const models = createDeferred<any[]>();
    const auth = createDeferred<any>();
    const skills = createDeferred<string[]>();
    let modelRequests = 0;
    let authRequests = 0;
    let skillRequests = 0;
    const controller = createStandaloneChatController({
      llmProvider: {
        id: 'openaiCompatible',
        name: 'Deferred provider',
        getModels: () => {
          modelRequests++;
          return models.promise;
        },
        getAuthStatus: () => {
          authRequests++;
          return auth.promise;
        },
      } as any,
    });
    const posted: any[] = [];
    const currentModel = controller.currentModel;
    controller.availableModels = [];
    controller.sessionApi.ensureSessionsLoaded = async () => {};
    controller.pendingComposerAttachments = [{
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      filename: 'draft.png',
    }];
    controller.skillsApi.getSkillNamesForUI = () => {
      skillRequests++;
      return skills.promise;
    };
    controller.view = {
      webview: {
        postMessage(message: unknown) {
          posted.push(message);
          return Promise.resolve(true);
        },
      },
    } as unknown as vscode.WebviewView;

    let initResolved = false;
    const initPromise = controller.webviewApi.sendInit().then(() => {
      initResolved = true;
    });
    await waitForImmediate();

    assert.strictEqual(initResolved, true, 'initial transcript should not wait for optional provider requests');
    assert.strictEqual(posted[0]?.type, 'init');
    assert.deepStrictEqual(posted[0]?.skills, []);
    assert.deepStrictEqual(posted[0]?.todos, []);
    assert.deepStrictEqual(posted[0]?.composerAttachments, controller.pendingComposerAttachments);
    assert.strictEqual(posted[0]?.providerAuth?.status, 'hidden');
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(posted[0] || {}, 'toolsCatalog'),
      false,
      'tool catalog should remain lazy until requested'
    );
    assert.strictEqual(modelRequests, 1);
    assert.strictEqual(authRequests, 1);
    assert.strictEqual(skillRequests, 1);

    models.resolve([{ id: currentModel, name: 'Model A', vendor: 'test', family: 'test' }]);
    auth.resolve({
      supported: true,
      authenticated: true,
      status: 'signed_in',
      label: 'Connected',
    });
    skills.resolve(['repo-scout']);
    await initPromise;
    await waitForImmediate();
    await waitForImmediate();

    assert.ok(posted.some((message) => message?.type === 'modelState' && message.model === currentModel));
    assert.ok(posted.some((message) => message?.type === 'providerState' && message.providerAuth?.authenticated === true));
    assert.ok(posted.some((message) =>
      message?.type === 'skillsEnabledState' &&
      Array.isArray(message.skills) &&
      message.skills.includes('repo-scout')
    ));
  });

  test('pending composer attachments survive renderer replacement and clear only after send acceptance', async () => {
    const controller = createStandaloneChatController();
    const posted: any[] = [];
    let receiveMessage: ((message: unknown) => unknown) | undefined;
    const view = {
      visible: true,
      webview: {
        options: {},
        html: '',
        cspSource: 'test-csp',
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: (message: unknown) => {
          posted.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
          receiveMessage = listener;
          return { dispose() {} };
        },
      },
      onDidChangeVisibility: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    } as unknown as vscode.WebviewView;

    controller.initInFlight = true;
    controller.webviewApi.resolveWebviewView(view);
    if (controller.initInterval) {
      clearInterval(controller.initInterval);
      controller.initInterval = undefined;
    }
    controller.initInFlight = false;
    assert.ok(receiveMessage);

    await receiveMessage?.({
      type: 'composerAttachmentsState',
      attachments: [
        {
          mediaType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
          filename: 'x'.repeat(600),
        },
        {
          mediaType: 'text/plain',
          dataUrl: 'data:text/plain;base64,AAAA',
        },
      ],
    });
    assert.deepStrictEqual(controller.pendingComposerAttachments, [{
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      filename: 'x'.repeat(512),
    }]);

    let receivedInput: any;
    controller.runnerInputApi.handleUserMessage = async (input: any, options: any) => {
      receivedInput = input;
      assert.strictEqual(controller.pendingComposerAttachments.length, 1);
      options?.onAccepted?.();
    };
    await receiveMessage?.({
      type: 'send',
      submissionId: 'submission-accepted',
      message: 'use image',
      draft: '  use image  ',
      attachments: controller.pendingComposerAttachments,
    });

    assert.deepStrictEqual(receivedInput, {
      message: 'use image',
      attachments: [{
        mediaType: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
        filename: 'x'.repeat(512),
      }],
    });
    assert.deepStrictEqual(controller.pendingComposerAttachments, []);
    assert.deepStrictEqual(
      posted
        .filter((message) => message?.type === 'sendState')
        .map((message) => ({ status: message.status, draft: message.draft })),
      [
        { status: 'pending', draft: '  use image  ' },
        { status: 'accepted', draft: '  use image  ' },
      ]
    );
    assert.deepStrictEqual(controller.composerSubmissionState, {
      id: 'submission-accepted',
      status: 'accepted',
      draft: '  use image  ',
    });
  });

  test('send rejection retains extension-owned attachments and reports the saved draft', async () => {
    const controller = createStandaloneChatController();
    const posted: any[] = [];
    let receiveMessage: ((message: unknown) => unknown) | undefined;
    const view = {
      visible: true,
      webview: {
        options: {},
        html: '',
        cspSource: 'test-csp',
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: (message: unknown) => {
          posted.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
          receiveMessage = listener;
          return { dispose() {} };
        },
      },
      onDidChangeVisibility: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    } as unknown as vscode.WebviewView;

    controller.initInFlight = true;
    controller.webviewApi.resolveWebviewView(view);
    if (controller.initInterval) {
      clearInterval(controller.initInterval);
      controller.initInterval = undefined;
    }
    controller.initInFlight = false;
    assert.ok(receiveMessage);

    const attachment = {
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      filename: 'draft.png',
    };
    controller.runnerInputApi.handleUserMessage = async () => {
      throw new Error('pre-commit failure');
    };
    await receiveMessage?.({
      type: 'send',
      submissionId: 'submission-rejected',
      message: 'use image',
      draft: 'use image\n',
      attachments: [attachment],
    });

    assert.deepStrictEqual(controller.pendingComposerAttachments, [attachment]);
    assert.deepStrictEqual(
      posted
        .filter((message) => message?.type === 'sendState')
        .map((message) => ({ status: message.status, draft: message.draft })),
      [
        { status: 'pending', draft: 'use image\n' },
        { status: 'rejected', draft: 'use image\n' },
      ]
    );
    assert.deepStrictEqual(controller.composerSubmissionState, {
      id: 'submission-rejected',
      status: 'rejected',
      draft: 'use image\n',
    });
  });

  test('deferred init hydration restarts for a replacement provider', async () => {
    const firstModels = createDeferred<any[]>();
    let firstProviderRequests = 0;
    let replacementProviderRequests = 0;
    const controller = createStandaloneChatController({
      llmProvider: {
        id: 'first',
        name: 'First provider',
        getModels: () => {
          firstProviderRequests++;
          return firstModels.promise;
        },
      } as any,
    });
    const currentModel = controller.currentModel;
    controller.availableModels = [];
    controller.sessionApi.ensureSessionsLoaded = async () => {};
    controller.skillsApi.getSkillNamesForUI = async () => [];
    controller.view = {
      webview: {
        postMessage() {
          return Promise.resolve(true);
        },
      },
    } as unknown as vscode.WebviewView;

    await controller.webviewApi.sendInit();
    await waitForImmediate();
    controller.llmProvider = {
      id: 'replacement',
      name: 'Replacement provider',
      getModels: async () => {
        replacementProviderRequests++;
        return [{ id: currentModel, name: 'Replacement Model', vendor: 'provider', family: 'test' }];
      },
    } as any;
    controller.availableModels = [];

    await controller.webviewApi.sendInit(true);
    await waitForImmediate();
    await waitForImmediate();
    firstModels.resolve([{ id: currentModel, name: 'Stale Model', vendor: 'provider', family: 'test' }]);
    await waitForImmediate();

    assert.strictEqual(firstProviderRequests, 1);
    assert.strictEqual(replacementProviderRequests, 1);
    assert.deepStrictEqual(controller.availableModels, [
      { id: currentModel, name: 'Replacement Model', vendor: 'provider', family: 'test' },
    ]);
  });

  test('tool catalog remains unloaded until the user requests it', async () => {
    const originalGetTools = toolRegistry.getTools;
    let catalogRequests = 0;
    (toolRegistry as any).getTools = async () => {
      catalogRequests++;
      return [];
    };

    try {
      const controller = createStandaloneChatController();
      const posted: any[] = [];
      controller.availableModels = [{ id: controller.currentModel, name: controller.currentModel } as any];
      controller.sessionApi.ensureSessionsLoaded = async () => {};
      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return Promise.resolve(true);
          },
        },
      } as unknown as vscode.WebviewView;

      await controller.webviewApi.sendInit();
      await waitForImmediate();

      assert.strictEqual(catalogRequests, 0);
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(posted.find((message) => message?.type === 'init') || {}, 'toolsCatalog'),
        false
      );

      await controller.webviewApi.listTools();

      assert.strictEqual(catalogRequests, 1);
      assert.ok(posted.some((message) => message?.type === 'toolsCatalogState' && message.reveal === true));
    } finally {
      (toolRegistry as any).getTools = originalGetTools;
    }
  });

  const defaultSettingCases: DefaultSettingCase[] = [
    {
      name: 'plan-first',
      key: 'planFirst',
      invoke: (api) => api.setPlanFirst(true),
      expectedMessage: { type: 'planFirstState', planFirst: true },
    },
    {
      name: 'auto-approve',
      key: 'autoApprove',
      invoke: (api) => api.setAutoApprove(false),
      expectedMessage: { type: 'autoApproveState', autoApprove: false },
    },
    {
      name: 'external paths',
      key: 'security.allowExternalPaths',
      invoke: (api) => api.setAllowExternalPaths(false),
      expectedMessage: { type: 'allowExternalPathsState', allowExternalPaths: false },
    },
    {
      name: 'git push protection',
      key: 'security.blockGitPush',
      invoke: (api) => api.setBlockGitPush(true),
      expectedMessage: { type: 'blockGitPushState', blockGitPush: true },
    },
    {
      name: 'show thinking',
      key: 'showThinking',
      invoke: (api) => api.setShowThinking(true),
      expectedMessage: { type: 'showThinkingState', showThinking: true },
    },
    {
      name: 'memories feature',
      key: 'features.memories',
      invoke: (api) => api.setMemoriesFeatureEnabled(true),
      expectedMessage: { type: 'memoriesFeatureState', memoriesFeatureEnabled: true },
    },
    {
      name: 'memory auto recall',
      key: 'memories.autoRecall',
      invoke: (api) => api.setMemoryAutoRecall(true),
      expectedMessage: { type: 'memoryAutoRecallState', memoryAutoRecall: true },
    },
    {
      name: 'auto compaction',
      key: 'compaction.auto',
      invoke: (api) => api.setAutoCompaction(true),
      expectedMessage: { type: 'autoCompactionState', autoCompaction: true },
    },
    {
      name: 'tool output compaction mode',
      key: 'compaction.toolOutputMode',
      invoke: (api) => api.setCompactionToolOutputMode('onCompaction'),
      expectedMessage: { type: 'compactionToolOutputModeState', compactionToolOutputMode: 'onCompaction' },
    },
    {
      name: 'skills enabled',
      key: 'skills.enabled',
      invoke: (api) => api.setSkillsEnabled(true),
      expectedMessage: { type: 'skillsEnabledState', skillsEnabled: true, skills: [] },
    },
    {
      name: 'explore prepass',
      key: 'subagents.explorePrepass.enabled',
      invoke: (api) => api.setExplorePrepass(false),
      expectedMessage: { type: 'explorePrepassState', explorePrepass: false, explorePrepassMaxChars: 8000 },
    },
    {
      name: 'subagent model override',
      key: 'subagents.model',
      invoke: (api) => api.setSubagentModelOverride(''),
      expectedMessage: { type: 'subagentModelOverrideState', subagentModelOverride: '' },
    },
    {
      name: 'subagent output cap',
      key: 'subagents.task.maxOutputChars',
      invoke: (api) => api.setSubagentTaskMaxOutputChars(8000),
      expectedMessage: { type: 'subagentTaskMaxOutputCharsState', subagentTaskMaxOutputChars: 8000 },
    },
  ];

  for (const setting of defaultSettingCases) {
    test(`${setting.name} skips unchanged default persistence while resyncing state`, async () => {
      const config = vscode.workspace.getConfiguration('lingyun');
      const previous = config.inspect<unknown>(setting.key)?.globalValue;
      await config.update(setting.key, undefined, vscode.ConfigurationTarget.Global);

      try {
        const controller = createStandaloneChatController();
        const posted: unknown[] = [];
        controller.view = {
          webview: {
            postMessage(message: unknown) {
              posted.push(message);
              return Promise.resolve(true);
            },
          },
        } as unknown as vscode.WebviewView;

        await setting.invoke(controller.webviewApi);

        assert.strictEqual(config.inspect<unknown>(setting.key)?.globalValue, undefined, `${setting.key} should stay unpersisted`);
        assert.deepStrictEqual(posted, [setting.expectedMessage]);
      } finally {
        await config.update(setting.key, previous, vscode.ConfigurationTarget.Global);
      }
    });
  }

  const groupedDefaultSettingCases: GroupedDefaultSettingCase[] = [
    {
      name: 'tool runtime limits',
      keys: [
        'toolTimeoutMs',
        'tools.read.maxLines',
        'tools.bash.backgroundTtlMs',
        'tools.bash.backgroundCaptureMs',
        'tools.bash.backgroundCaptureLines',
        'tools.workspaceShell.timeoutMs',
        'tools.http.timeoutMs',
      ],
      invoke: (api) => api.setToolRuntimeLimits({
        toolTimeoutMs: 0,
        readMaxLines: 300,
        bashBackgroundTtlMs: 600000,
        bashBackgroundCaptureMs: 2000,
        bashBackgroundCaptureLines: 50,
        workspaceShellTimeoutMs: 60000,
        httpTimeoutMs: 30000,
      }),
      expectedMessage: {
        type: 'toolRuntimeLimitsState',
        toolRuntimeLimits: {
          toolTimeoutMs: 0,
          readMaxLines: 300,
          bashBackgroundTtlMs: 600000,
          bashBackgroundCaptureMs: 2000,
          bashBackgroundCaptureLines: 50,
          workspaceShellTimeoutMs: 60000,
          httpTimeoutMs: 30000,
        },
      },
    },
    {
      name: 'diagnostics logging',
      keys: ['debug.details', 'debug.llm', 'debug.tools', 'debug.plugins'],
      invoke: (api) => api.setDebugSettings({ details: false, llm: false, tools: false, plugins: false }),
      expectedMessage: {
        type: 'debugSettingsState',
        debugSettings: {
          details: false,
          llm: false,
          tools: false,
          plugins: false,
          effectiveLlm: false,
          effectiveTools: false,
          effectivePlugins: false,
        },
      },
    },
    {
      name: 'plugin settings',
      keys: ['plugins', 'plugins.autoDiscover', 'plugins.workspaceDir'],
      invoke: (api) => api.setPluginSettings({ plugins: [], autoDiscover: false, workspaceDir: '.lingyun' }),
      expectedMessage: {
        type: 'pluginSettingsState',
        pluginSettings: {
          plugins: [],
          autoDiscover: false,
          workspaceDir: '.lingyun',
        },
      },
    },
    {
      name: 'workspace env',
      keys: ['env'],
      invoke: (api) => api.setWorkspaceEnv({}),
      expectedMessage: { type: 'workspaceEnvState', workspaceEnv: {} },
    },
    {
      name: 'instruction patterns',
      keys: ['instructions'],
      invoke: (api) => api.setInstructionPatterns([]),
      expectedMessage: { type: 'instructionPatternsState', instructionPatterns: [] },
    },
    {
      name: 'instruction file settings',
      keys: ['instructionFiles.includeGlobal', 'instructionFiles.maxCharsPerFile', 'instructionFiles.maxTotalChars'],
      invoke: (api) => api.setInstructionFileSettings({ includeGlobal: true, maxCharsPerFile: 60000, maxTotalChars: 180000 }),
      expectedMessage: {
        type: 'instructionFileSettingsState',
        instructionFileSettings: {
          includeGlobal: true,
          maxCharsPerFile: 60000,
          maxTotalChars: 180000,
        },
      },
    },
    {
      name: 'compaction prune settings',
      keys: ['compaction.prune', 'compaction.pruneProtectTokens', 'compaction.pruneMinimumTokens'],
      invoke: (api) => api.setCompactionPruneSettings({ prune: true, pruneProtectTokens: 40000, pruneMinimumTokens: 20000 }),
      expectedMessage: {
        type: 'compactionPruneState',
        compactionPrune: true,
        compactionPruneProtectTokens: 40000,
        compactionPruneMinimumTokens: 20000,
      },
    },
    {
      name: 'skills budget',
      keys: ['skills.maxPromptSkills', 'skills.maxInjectSkills', 'skills.maxInjectChars'],
      invoke: (api) => api.setSkillsBudget({ maxPromptSkills: 50, maxInjectSkills: 5, maxInjectChars: 20000 }),
      expectedMessage: {
        type: 'skillsBudgetState',
        skillsBudget: {
          maxPromptSkills: 50,
          maxInjectSkills: 5,
          maxInjectChars: 20000,
        },
      },
    },
    {
      name: 'explore prepass max chars',
      keys: ['subagents.explorePrepass.maxChars'],
      invoke: (api) => api.setExplorePrepassMaxChars(8000),
      expectedMessage: { type: 'explorePrepassState', explorePrepass: false, explorePrepassMaxChars: 8000 },
    },
    {
      name: 'memory auto recall budget',
      keys: ['memories.maxAutoRecallResults', 'memories.maxAutoRecallTokens'],
      invoke: (api) => api.setMemoryAutoRecallBudget({ maxResults: 4, maxTokens: 1200 }),
      expectedMessage: {
        type: 'memoryAutoRecallBudgetState',
        memoryAutoRecallMaxResults: 4,
        memoryAutoRecallMaxTokens: 1200,
      },
    },
    {
      name: 'memory auto recall filters',
      keys: ['memories.autoRecallMinScore', 'memories.autoRecallMinScoreGap', 'memories.autoRecallMaxAgeDays'],
      invoke: (api) => api.setMemoryAutoRecallFilters({ minScore: 7, minScoreGap: 1.25, maxAgeDays: 45 }),
      expectedMessage: {
        type: 'memoryAutoRecallFiltersState',
        memoryAutoRecallMinScore: 7,
        memoryAutoRecallMinScoreGap: 1.25,
        memoryAutoRecallMaxAgeDays: 45,
      },
    },
    {
      name: 'memory advanced limits',
      keys: [
        'memories.maxRawMemoriesForGlobal',
        'memories.maxRolloutAgeDays',
        'memories.maxRolloutsPerStartup',
        'memories.minRolloutIdleHours',
        'memories.maxStateOutputs',
        'memories.maxRecords',
        'memories.maxSearchResults',
        'memories.maxResultsPerKind',
        'memories.searchNeighborWindow',
      ],
      invoke: (api) => api.setMemoryAdvancedLimits({
        maxRawMemoriesForGlobal: 120,
        maxRolloutAgeDays: 30,
        maxRolloutsPerStartup: 24,
        minRolloutIdleHours: 2,
        maxStateOutputs: 500,
        maxRecords: 5000,
        maxSearchResults: 8,
        maxResultsPerKind: 3,
        searchNeighborWindow: 1,
      }),
      expectedMessage: {
        type: 'memoryAdvancedLimitsState',
        memoryAdvancedLimits: {
          maxRawMemoriesForGlobal: 120,
          maxRolloutAgeDays: 30,
          maxRolloutsPerStartup: 24,
          minRolloutIdleHours: 2,
          maxStateOutputs: 500,
          maxRecords: 5000,
          maxSearchResults: 8,
          maxResultsPerKind: 3,
          searchNeighborWindow: 1,
        },
      },
    },
  ];

  for (const setting of groupedDefaultSettingCases) {
    test(`${setting.name} skips unchanged grouped default persistence while resyncing state`, async () => {
      const config = vscode.workspace.getConfiguration('lingyun');
      const previousValues = new Map<string, unknown>();
      for (const key of setting.keys) {
        previousValues.set(key, config.inspect<unknown>(key)?.globalValue);
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      }

      try {
        const controller = createStandaloneChatController();
        const posted: unknown[] = [];
        controller.view = {
          webview: {
            postMessage(message: unknown) {
              posted.push(message);
              return Promise.resolve(true);
            },
          },
        } as unknown as vscode.WebviewView;

        await setting.invoke(controller.webviewApi);

        for (const key of setting.keys) {
          assert.strictEqual(config.inspect<unknown>(key)?.globalValue, undefined, `${key} should stay unpersisted`);
        }
        assert.deepStrictEqual(posted, [setting.expectedMessage]);
      } finally {
        for (const [key, value] of previousValues) {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
      }
    });
  }

  test('tool filter skips unchanged default persistence while resyncing state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const previous = config.inspect<unknown>('toolFilter')?.globalValue;
    await config.update('toolFilter', undefined, vscode.ConfigurationTarget.Global);

    try {
      const controller = createStandaloneChatController();
      const posted: unknown[] = [];
      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return Promise.resolve(true);
          },
        },
      } as unknown as vscode.WebviewView;

      await controller.webviewApi.setToolFilter([]);

      assert.strictEqual(config.inspect<unknown>('toolFilter')?.globalValue, undefined, 'toolFilter should stay unpersisted');
      assert.deepStrictEqual(posted, [{ type: 'toolFilterState', toolFilter: [] }]);
    } finally {
      await config.update('toolFilter', previous, vscode.ConfigurationTarget.Global);
    }
  });

  test('list settings reject overlong entries without persisting', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const keys = ['plugins', 'plugins.autoDiscover', 'plugins.workspaceDir', 'toolFilter', 'instructions', 'skills.paths'];
    const previousValues = new Map<string, unknown>();
    for (const key of keys) {
      previousValues.set(key, config.inspect<unknown>(key)?.globalValue);
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }

    const long120 = 'x'.repeat(121);
    const long240 = 'x'.repeat(241);
    const cases = [
      {
        name: 'plugin specs',
        invoke: (api: ChatWebviewApi) => api.setPluginSettings({ plugins: [long240], autoDiscover: false, workspaceDir: '.lingyun' }),
        notice: 'Plugin module specs must be 240 characters or shorter.',
        assertState(message: any) {
          assert.deepStrictEqual(message, {
            type: 'pluginSettingsState',
            pluginSettings: {
              plugins: [],
              autoDiscover: false,
              workspaceDir: '.lingyun',
            },
          });
        },
      },
      {
        name: 'tool filter',
        invoke: (api: ChatWebviewApi) => api.setToolFilter([long120]),
        notice: 'Tool filter patterns must be 120 characters or shorter.',
        assertState(message: any) {
          assert.deepStrictEqual(message, { type: 'toolFilterState', toolFilter: [] });
        },
      },
      {
        name: 'instruction patterns',
        invoke: (api: ChatWebviewApi) => api.setInstructionPatterns([long240]),
        notice: 'Instruction paths and glob patterns must be 240 characters or shorter.',
        assertState(message: any) {
          assert.deepStrictEqual(message, { type: 'instructionPatternsState', instructionPatterns: [] });
        },
      },
      {
        name: 'skill search paths',
        invoke: (api: ChatWebviewApi) => api.setSkillSearchPaths([long240]),
        notice: 'Skill search paths must be 240 characters or shorter.',
        assertState(message: any) {
          assert.strictEqual(message?.type, 'skillSearchPathsState');
          assert.ok(Array.isArray(message?.skillSearchPaths));
          assert.ok(!message.skillSearchPaths.includes(long240));
          assert.ok(Array.isArray(message?.skills));
        },
      },
    ];

    try {
      for (const setting of cases) {
        const controller = createStandaloneChatController();
        const posted: unknown[] = [];
        controller.view = {
          webview: {
            postMessage(message: unknown) {
              posted.push(message);
              return Promise.resolve(true);
            },
          },
        } as unknown as vscode.WebviewView;

        await setting.invoke(controller.webviewApi);

        assert.strictEqual(posted.length, 2, `${setting.name} should post a notice and current state`);
        assert.deepStrictEqual(posted[0], { type: 'inputNotice', message: setting.notice });
        setting.assertState(posted[1]);
      }

      for (const key of keys) {
        assert.strictEqual(config.inspect<unknown>(key)?.globalValue, undefined, `${key} should stay unpersisted`);
      }
    } finally {
      for (const [key, value] of previousValues) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('provider settings skip unchanged default persistence while resyncing state', async () => {
    const config = vscode.workspace.getConfiguration('lingyun');
    const keys = [
      'codexSubscription.defaultModelId',
      'openaiCompatible.baseURL',
      'openaiCompatible.defaultModelId',
      'openaiCompatible.apiKeyEnv',
      'openaiCompatible.allowInsecureTLS',
      'openaiCompatible.modelDisplayNames',
    ];
    const previousValues = new Map<string, unknown>();
    for (const key of keys) {
      previousValues.set(key, config.inspect<unknown>(key)?.globalValue);
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }

    try {
      const controller = createStandaloneChatController();
      const posted: any[] = [];
      controller.view = {
        webview: {
          postMessage(message: unknown) {
            posted.push(message);
            return Promise.resolve(true);
          },
        },
      } as unknown as vscode.WebviewView;

      await controller.webviewApi.setCodexSubscriptionSettings({ defaultModelId: 'gpt-5.3-codex' });
      await controller.webviewApi.setOpenAICompatibleSettings({
        baseURL: '',
        defaultModelId: '',
        apiKeyEnv: 'OPENAI_API_KEY',
        allowInsecureTLS: false,
        modelDisplayNames: {},
      });

      for (const key of keys) {
        assert.strictEqual(config.inspect<unknown>(key)?.globalValue, undefined, `${key} should stay unpersisted`);
      }
      assert.strictEqual(posted.length, 2);
      assert.strictEqual(posted[0].type, 'codexSubscriptionSettingsState');
      assert.deepStrictEqual(posted[0].codexSubscriptionSettings, { defaultModelId: 'gpt-5.3-codex' });
      assert.strictEqual(posted[1].type, 'openAICompatibleSettingsState');
      assert.deepStrictEqual(posted[1].openAICompatibleSettings, {
        baseURL: '',
        defaultModelId: '',
        apiKeyEnv: 'OPENAI_API_KEY',
        allowInsecureTLS: false,
        modelDisplayNames: {},
      });
    } finally {
      for (const [key, value] of previousValues) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    }
  });
});
