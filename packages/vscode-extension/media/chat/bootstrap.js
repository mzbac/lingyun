		    let vscode;
		    try {
		      vscode = acquireVsCodeApi();
		    } catch (err) {
		      vscode = { postMessage: () => {} };
		    }
		    const clientInstanceId = String(Date.now()) + '_' + Math.random().toString(16).slice(2);
			    const messages = document.getElementById('messages');
			    const empty = document.getElementById('empty');
	    const input = document.getElementById('input');
	    const skillDropdown = document.getElementById('skillDropdown');
	    const liveRegion = document.getElementById('liveRegion');

	    const skillsToggleLabel = document.getElementById('skillsToggleLabel');
	    const skillsToggle = document.getElementById('skillsToggle');
	    const skillsSettings = document.getElementById('skillsSettings');
	    const skillsSettingsPopover = document.getElementById('skillsSettingsPopover');
	    const skillsSettingsClose = document.getElementById('skillsSettingsClose');
	    const skillsMaxPromptInput = document.getElementById('skillsMaxPromptInput');
	    const skillsMaxInjectInput = document.getElementById('skillsMaxInjectInput');
	    const skillsMaxInjectCharsInput = document.getElementById('skillsMaxInjectCharsInput');
	    const skillSearchPathsLabel = document.getElementById('skillSearchPathsLabel');
	    const skillSearchPathsInput = document.getElementById('skillSearchPathsInput');
	    const skillsSettingsApply = document.getElementById('skillsSettingsApply');
	    const inputHint = document.getElementById('inputHint');
		    const queueBanner = document.getElementById('queueBanner');
		    const queueBannerCount = document.getElementById('queueBannerCount');
		    const queueBannerText = document.getElementById('queueBannerText');
		    const queueBannerHint = document.getElementById('queueBannerHint');
		    const queueItems = document.getElementById('queueItems');
		    const queueClearBtn = document.getElementById('queueClear');
			    const sendBtn = document.getElementById('send');
			    const stopBtn = document.getElementById('stop');
		    const newSessionBtn = document.getElementById('newSession');
		    const compactSessionBtn = document.getElementById('compactSession');
		    const loopControlBtn = document.getElementById('loopControl');
	    const loopSettingsPopover = document.getElementById('loopSettingsPopover');
	    const loopSettingsClose = document.getElementById('loopSettingsClose');
	    const loopEnabledLabel = document.getElementById('loopEnabledLabel');
	    const loopEnabledToggle = document.getElementById('loopEnabledToggle');
	    const loopStatusHint = document.getElementById('loopStatusHint');
	    const loopIntervalLabel = document.getElementById('loopIntervalLabel');
	    const loopIntervalInput = document.getElementById('loopIntervalInput');
	    const loopPromptLabel = document.getElementById('loopPromptLabel');
	    const loopPromptInput = document.getElementById('loopPromptInput');
	    const loopResetDefaults = document.getElementById('loopResetDefaults');
	    const loopSettingsApply = document.getElementById('loopSettingsApply');
	    const loopDefaultEnabledLabel = document.getElementById('loopDefaultEnabledLabel');
	    const loopDefaultEnabledToggle = document.getElementById('loopDefaultEnabledToggle');
	    const loopDefaultIntervalLabel = document.getElementById('loopDefaultIntervalLabel');
	    const loopDefaultIntervalInput = document.getElementById('loopDefaultIntervalInput');
	    const loopDefaultPromptLabel = document.getElementById('loopDefaultPromptLabel');
	    const loopDefaultPromptInput = document.getElementById('loopDefaultPromptInput');
	    const loopDefaultsApply = document.getElementById('loopDefaultsApply');
		    const undoBtn = document.getElementById('undo');
		    const redoBtn = document.getElementById('redo');
	    const clearInputBtn = document.getElementById('clearInput');
	    const inputAttachments = document.getElementById('inputAttachments');
		    const sessionSelect = document.getElementById('sessionSelect');
	    const sessionSettings = document.getElementById('sessionSettings');
	    const sessionSettingsPopover = document.getElementById('sessionSettingsPopover');
	    const sessionSettingsClose = document.getElementById('sessionSettingsClose');
	    const sessionsPersistLabel = document.getElementById('sessionsPersistLabel');
	    const sessionsPersistToggle = document.getElementById('sessionsPersistToggle');
	    const sessionsMaxSessionsInput = document.getElementById('sessionsMaxSessionsInput');
	    const sessionsMaxSessionBytesInput = document.getElementById('sessionsMaxSessionBytesInput');
	    const sessionSettingsApply = document.getElementById('sessionSettingsApply');
	    const sessionClearCurrentBtn = document.getElementById('sessionClearCurrent');
	    const sessionClearSavedBtn = document.getElementById('sessionClearSaved');
	    const sessionClearConfirm = document.getElementById('sessionClearConfirm');
	    const sessionClearConfirmText = document.getElementById('sessionClearConfirmText');
	    const sessionClearCancelBtn = document.getElementById('sessionClearCancel');
	    const sessionClearConfirmRunBtn = document.getElementById('sessionClearConfirmRun');
	    const providerSelect = document.getElementById('providerSelect');
	    const providerSettings = document.getElementById('providerSettings');
	    const providerSettingsPopover = document.getElementById('providerSettingsPopover');
	    const providerSettingsClose = document.getElementById('providerSettingsClose');
	    const codexDefaultModelLabel = document.getElementById('codexDefaultModelLabel');
	    const codexDefaultModelInput = document.getElementById('codexDefaultModelInput');
	    const openAIBaseURLLabel = document.getElementById('openAIBaseURLLabel');
	    const openAIBaseURLInput = document.getElementById('openAIBaseURLInput');
	    const openAIDefaultModelLabel = document.getElementById('openAIDefaultModelLabel');
	    const openAIDefaultModelInput = document.getElementById('openAIDefaultModelInput');
	    const openAIApiKeyEnvLabel = document.getElementById('openAIApiKeyEnvLabel');
	    const openAIApiKeyEnvInput = document.getElementById('openAIApiKeyEnvInput');
	    const openAIModelDisplayNamesLabel = document.getElementById('openAIModelDisplayNamesLabel');
	    const openAIModelDisplayNamesInput = document.getElementById('openAIModelDisplayNamesInput');
	    const providerSettingsApply = document.getElementById('providerSettingsApply');
	    const safetySelect = document.getElementById('safetySelect');
	    const safetySettings = document.getElementById('safetySettings');
	    const safetySettingsPopover = document.getElementById('safetySettingsPopover');
	    const safetySettingsClose = document.getElementById('safetySettingsClose');
	    const allowExternalPathsLabel = document.getElementById('allowExternalPathsLabel');
	    const allowExternalPathsToggle = document.getElementById('allowExternalPathsToggle');
	    const blockGitPushLabel = document.getElementById('blockGitPushLabel');
	    const blockGitPushToggle = document.getElementById('blockGitPushToggle');
	    const debugDetailsLabel = document.getElementById('debugDetailsLabel');
	    const debugDetailsToggle = document.getElementById('debugDetailsToggle');
	    const debugLlmLabel = document.getElementById('debugLlmLabel');
	    const debugLlmToggle = document.getElementById('debugLlmToggle');
	    const debugToolsLabel = document.getElementById('debugToolsLabel');
	    const debugToolsToggle = document.getElementById('debugToolsToggle');
	    const debugPluginsLabel = document.getElementById('debugPluginsLabel');
	    const debugPluginsToggle = document.getElementById('debugPluginsToggle');
	    const showLogsBtn = document.getElementById('showLogs');
	    const pluginsAutoDiscoverLabel = document.getElementById('pluginsAutoDiscoverLabel');
	    const pluginsAutoDiscoverToggle = document.getElementById('pluginsAutoDiscoverToggle');
	    const pluginsWorkspaceDirLabel = document.getElementById('pluginsWorkspaceDirLabel');
	    const pluginsWorkspaceDirInput = document.getElementById('pluginsWorkspaceDirInput');
	    const pluginSpecsLabel = document.getElementById('pluginSpecsLabel');
	    const pluginSpecsInput = document.getElementById('pluginSpecsInput');
	    const pluginSettingsApply = document.getElementById('pluginSettingsApply');
	    const toolTimeoutMsLabel = document.getElementById('toolTimeoutMsLabel');
	    const toolTimeoutMsInput = document.getElementById('toolTimeoutMsInput');
	    const readMaxLinesLabel = document.getElementById('readMaxLinesLabel');
	    const readMaxLinesInput = document.getElementById('readMaxLinesInput');
	    const bashBackgroundTtlMsLabel = document.getElementById('bashBackgroundTtlMsLabel');
	    const bashBackgroundTtlMsInput = document.getElementById('bashBackgroundTtlMsInput');
	    const bashBackgroundCaptureMsLabel = document.getElementById('bashBackgroundCaptureMsLabel');
	    const bashBackgroundCaptureMsInput = document.getElementById('bashBackgroundCaptureMsInput');
	    const bashBackgroundCaptureLinesLabel = document.getElementById('bashBackgroundCaptureLinesLabel');
	    const bashBackgroundCaptureLinesInput = document.getElementById('bashBackgroundCaptureLinesInput');
	    const workspaceShellTimeoutMsLabel = document.getElementById('workspaceShellTimeoutMsLabel');
	    const workspaceShellTimeoutMsInput = document.getElementById('workspaceShellTimeoutMsInput');
	    const httpTimeoutMsLabel = document.getElementById('httpTimeoutMsLabel');
	    const httpTimeoutMsInput = document.getElementById('httpTimeoutMsInput');
	    const toolLimitsApply = document.getElementById('toolLimitsApply');
	    const toolFilterLabel = document.getElementById('toolFilterLabel');
	    const toolFilterInput = document.getElementById('toolFilterInput');
	    const toolFilterApply = document.getElementById('toolFilterApply');
	    const listToolsBtn = document.getElementById('listTools');
	    const toolsCatalogSearchLabel = document.getElementById('toolsCatalogSearchLabel');
	    const toolsCatalogSearchInput = document.getElementById('toolsCatalogSearchInput');
	    const toolsCatalog = document.getElementById('toolsCatalog');
	    const autoApprovedToolsList = document.getElementById('autoApprovedToolsList');
	    const autoApprovedToolsClear = document.getElementById('autoApprovedToolsClear');
	    const autoApprovedToolsClearConfirm = document.getElementById('autoApprovedToolsClearConfirm');
	    const autoApprovedToolsClearCancel = document.getElementById('autoApprovedToolsClearCancel');
	    const autoApprovedToolsClearConfirmRun = document.getElementById('autoApprovedToolsClearConfirmRun');
	    const runToolBtn = document.getElementById('runTool');
	    const createToolsConfigBtn = document.getElementById('createToolsConfig');
	    const workspaceEnvLabel = document.getElementById('workspaceEnvLabel');
	    const workspaceEnvInput = document.getElementById('workspaceEnvInput');
	    const workspaceEnvApply = document.getElementById('workspaceEnvApply');
	    const thinkingLabel = document.getElementById('thinkingLabel');
	    const thinkingToggle = document.getElementById('thinkingToggle');
	    const planFirstLabel = document.getElementById('planFirstLabel');
	    const planFirstToggle = document.getElementById('planFirstToggle');
	    const modelPicker = document.getElementById('modelPicker');
	    const modelPickerLabel = document.getElementById('modelPickerLabel');
	    const reasoningEffortSelect = document.getElementById('reasoningEffortSelect');
	    const modelFavoriteToggle = document.getElementById('modelFavoriteToggle');
	    const modelSettings = document.getElementById('modelSettings');
	    const modelSettingsPopover = document.getElementById('modelSettingsPopover');
	    const modelSettingsClose = document.getElementById('modelSettingsClose');
	    const customModelLabel = document.getElementById('customModelLabel');
	    const customModelInput = document.getElementById('customModelInput');
	    const customModelApply = document.getElementById('customModelApply');
	    const modelRefreshList = document.getElementById('modelRefreshList');
	    const modelClearRecents = document.getElementById('modelClearRecents');
	    const modelPickerSearchLabel = document.getElementById('modelPickerSearchLabel');
	    const modelPickerSearchInput = document.getElementById('modelPickerSearchInput');
	    const modelPickerList = document.getElementById('modelPickerList');
	    const temperatureInput = document.getElementById('temperatureInput');
	    const topPLabel = document.getElementById('topPLabel');
	    const topPInput = document.getElementById('topPInput');
	    const topKLabel = document.getElementById('topKLabel');
	    const topKInput = document.getElementById('topKInput');
	    const maxOutputTokensInput = document.getElementById('maxOutputTokensInput');
	    const textVerbosityLabel = document.getElementById('textVerbosityLabel');
	    const textVerbositySelect = document.getElementById('textVerbositySelect');
	    const maxRetriesInput = document.getElementById('maxRetriesInput');
	    const llmTimeoutInput = document.getElementById('llmTimeoutInput');
	    const retryWithPartialOutputLabel = document.getElementById('retryWithPartialOutputLabel');
	    const retryWithPartialOutputToggle = document.getElementById('retryWithPartialOutputToggle');
	    const modelSettingsApply = document.getElementById('modelSettingsApply');
	    const modelSettingsOpenSettings = document.getElementById('modelSettingsOpenSettings');
	    const providerAuthGroup = document.getElementById('providerAuthGroup');
	    const providerAuthPrimary = document.getElementById('providerAuthPrimary');
	    const providerAuthSecondary = document.getElementById('providerAuthSecondary');
	    const modePlanBtn = document.getElementById('modePlan');
	    const modeBuildBtn = document.getElementById('modeBuild');
	    const operationBanner = document.getElementById('operationBanner');
	    const operationSpinner = document.getElementById('operationSpinner');
	    const operationLabelEl = document.getElementById('operationLabel');
	    const operationElapsedEl = document.getElementById('operationElapsed');
	    const operationStopBtn = document.getElementById('operationStop');
	    const approvalBanner = document.getElementById('approvalBanner');
	    const approvalLabelEl = document.getElementById('approvalLabel');
	    const approvalAllowAllBtn = document.getElementById('approvalAllowAll');
	    const approvalStopBtn = document.getElementById('approvalStop');
	    const revertBar = document.getElementById('revertBar');
	    const revertSummary = document.getElementById('revertSummary');
	    const revertFiles = document.getElementById('revertFiles');
	    const revertFilesSummary = document.getElementById('revertFilesSummary');
	    const revertFilesList = document.getElementById('revertFilesList');
	    const revertRedoBtn = document.getElementById('revertRedo');
	    const revertRedoAllBtn = document.getElementById('revertRedoAll');
	    const revertDiffBtn = document.getElementById('revertDiff');
	    const revertDiscardBtn = document.getElementById('revertDiscard');
	    const revertDiscardConfirm = document.getElementById('revertDiscardConfirm');
	    const revertDiscardCancelBtn = document.getElementById('revertDiscardCancel');
	    const revertDiscardConfirmRunBtn = document.getElementById('revertDiscardConfirmRun');
	    const contextIndicator = document.getElementById('contextIndicator');
	    const contextPopover = document.getElementById('contextPopover');
	    const contextPopoverBody = document.getElementById('contextPopoverBody');
	    const contextPopoverClose = document.getElementById('contextPopoverClose');
	    const contextCompactNowBtn = document.getElementById('contextCompactNow');
	    const instructionPatternsLabel = document.getElementById('instructionPatternsLabel');
	    const instructionPatternsInput = document.getElementById('instructionPatternsInput');
	    const instructionPatternsApply = document.getElementById('instructionPatternsApply');
	    const instructionIncludeGlobalLabel = document.getElementById('instructionIncludeGlobalLabel');
	    const instructionIncludeGlobalToggle = document.getElementById('instructionIncludeGlobalToggle');
	    const instructionMaxCharsPerFileLabel = document.getElementById('instructionMaxCharsPerFileLabel');
	    const instructionMaxCharsPerFileInput = document.getElementById('instructionMaxCharsPerFileInput');
	    const instructionMaxTotalCharsLabel = document.getElementById('instructionMaxTotalCharsLabel');
	    const instructionMaxTotalCharsInput = document.getElementById('instructionMaxTotalCharsInput');
	    const memoriesFeatureLabel = document.getElementById('memoriesFeatureLabel');
	    const memoriesFeatureToggle = document.getElementById('memoriesFeatureToggle');
	    const memoryAutoRecallLabel = document.getElementById('memoryAutoRecallLabel');
	    const memoryAutoRecallToggle = document.getElementById('memoryAutoRecallToggle');
	    const memoryAutoRecallMaxResultsLabel = document.getElementById('memoryAutoRecallMaxResultsLabel');
	    const memoryAutoRecallMaxResultsInput = document.getElementById('memoryAutoRecallMaxResultsInput');
	    const memoryAutoRecallMaxTokensLabel = document.getElementById('memoryAutoRecallMaxTokensLabel');
	    const memoryAutoRecallMaxTokensInput = document.getElementById('memoryAutoRecallMaxTokensInput');
	    const memoryAutoRecallMinScoreLabel = document.getElementById('memoryAutoRecallMinScoreLabel');
	    const memoryAutoRecallMinScoreInput = document.getElementById('memoryAutoRecallMinScoreInput');
	    const memoryAutoRecallMinScoreGapLabel = document.getElementById('memoryAutoRecallMinScoreGapLabel');
	    const memoryAutoRecallMinScoreGapInput = document.getElementById('memoryAutoRecallMinScoreGapInput');
	    const memoryAutoRecallMaxAgeDaysLabel = document.getElementById('memoryAutoRecallMaxAgeDaysLabel');
	    const memoryAutoRecallMaxAgeDaysInput = document.getElementById('memoryAutoRecallMaxAgeDaysInput');
	    const memoryMaxRawMemoriesForGlobalLabel = document.getElementById('memoryMaxRawMemoriesForGlobalLabel');
	    const memoryMaxRawMemoriesForGlobalInput = document.getElementById('memoryMaxRawMemoriesForGlobalInput');
	    const memoryMaxRolloutAgeDaysLabel = document.getElementById('memoryMaxRolloutAgeDaysLabel');
	    const memoryMaxRolloutAgeDaysInput = document.getElementById('memoryMaxRolloutAgeDaysInput');
	    const memoryMaxRolloutsPerStartupLabel = document.getElementById('memoryMaxRolloutsPerStartupLabel');
	    const memoryMaxRolloutsPerStartupInput = document.getElementById('memoryMaxRolloutsPerStartupInput');
	    const memoryMinRolloutIdleHoursLabel = document.getElementById('memoryMinRolloutIdleHoursLabel');
	    const memoryMinRolloutIdleHoursInput = document.getElementById('memoryMinRolloutIdleHoursInput');
	    const memoryMaxStateOutputsLabel = document.getElementById('memoryMaxStateOutputsLabel');
	    const memoryMaxStateOutputsInput = document.getElementById('memoryMaxStateOutputsInput');
	    const memoryMaxRecordsLabel = document.getElementById('memoryMaxRecordsLabel');
	    const memoryMaxRecordsInput = document.getElementById('memoryMaxRecordsInput');
	    const memoryMaxSearchResultsLabel = document.getElementById('memoryMaxSearchResultsLabel');
	    const memoryMaxSearchResultsInput = document.getElementById('memoryMaxSearchResultsInput');
	    const memoryMaxResultsPerKindLabel = document.getElementById('memoryMaxResultsPerKindLabel');
	    const memoryMaxResultsPerKindInput = document.getElementById('memoryMaxResultsPerKindInput');
	    const memorySearchNeighborWindowLabel = document.getElementById('memorySearchNeighborWindowLabel');
	    const memorySearchNeighborWindowInput = document.getElementById('memorySearchNeighborWindowInput');
	    const memoryAdvancedLimitsApply = document.getElementById('memoryAdvancedLimitsApply');
	    const memoryUpdateNowBtn = document.getElementById('memoryUpdateNow');
	    const memoryDropBtn = document.getElementById('memoryDrop');
	    const memoryDropConfirm = document.getElementById('memoryDropConfirm');
	    const memoryDropCancelBtn = document.getElementById('memoryDropCancel');
	    const memoryDropConfirmRunBtn = document.getElementById('memoryDropConfirmRun');
	    const memoryActionStatus = document.getElementById('memoryActionStatus');
	    const explorePrepassLabel = document.getElementById('explorePrepassLabel');
	    const explorePrepassToggle = document.getElementById('explorePrepassToggle');
	    const explorePrepassMaxCharsLabel = document.getElementById('explorePrepassMaxCharsLabel');
	    const explorePrepassMaxCharsInput = document.getElementById('explorePrepassMaxCharsInput');
	    const subagentModelOverrideLabel = document.getElementById('subagentModelOverrideLabel');
	    const subagentModelOverrideInput = document.getElementById('subagentModelOverrideInput');
	    const subagentTaskMaxOutputCharsLabel = document.getElementById('subagentTaskMaxOutputCharsLabel');
	    const subagentTaskMaxOutputCharsInput = document.getElementById('subagentTaskMaxOutputCharsInput');
	    const autoCompactionLabel = document.getElementById('autoCompactionLabel');
	    const autoCompactionToggle = document.getElementById('autoCompactionToggle');
	    const modelLimitsLabel = document.getElementById('modelLimitsLabel');
	    const modelLimitsInput = document.getElementById('modelLimitsInput');
	    const modelLimitsApply = document.getElementById('modelLimitsApply');
	    const compactionPruneLabel = document.getElementById('compactionPruneLabel');
	    const compactionPruneToggle = document.getElementById('compactionPruneToggle');
	    const compactionPruneProtectTokensLabel = document.getElementById('compactionPruneProtectTokensLabel');
	    const compactionPruneProtectTokensInput = document.getElementById('compactionPruneProtectTokensInput');
	    const compactionPruneMinimumTokensLabel = document.getElementById('compactionPruneMinimumTokensLabel');
	    const compactionPruneMinimumTokensInput = document.getElementById('compactionPruneMinimumTokensInput');
	    const compactionToolOutputModeLabel = document.getElementById('compactionToolOutputModeLabel');
	    const compactionToolOutputModeSelect = document.getElementById('compactionToolOutputModeSelect');
	    const todoIndicator = document.getElementById('todoIndicator');
	    const todoPopover = document.getElementById('todoPopover');
	    const todoPopoverBody = document.getElementById('todoPopoverBody');
	    const todoPopoverClose = document.getElementById('todoPopoverClose');
	    const outputModal = document.getElementById('outputModal');
	    const outputModalBackdrop = document.getElementById('outputModalBackdrop');
	    const outputModalTitle = document.getElementById('outputModalTitle');
	    const outputModalBody = document.getElementById('outputModalBody');
	    const outputModalClose = document.getElementById('outputModalClose');
	    const outputModalCopy = document.getElementById('outputModalCopy');

		    let initReceived = false;
		    let isProcessing = false;
			    let planPending = false;
			    let activePlanMessageId = '';
			    let activeTurnId = '';
			    let queuedInputs = [];
	    let queueClearPending = false;
	    let queueSteerPendingId = '';
	    let lastQueueItemsRenderKey = '';
	    let sendButtonPresentationKey = '';
	    let abortRequestPending = false;
			    let approveAllPending = false;
	    let canUndo = false;
	    let canRedo = false;
	    let currentRevertState = null;
	    let revertActionPending = '';
	    let revertDiscardConfirmPending = false;
		    let currentSessionId = '';
		    let sessionSwitchPending = false;
		    let sessionActionPending = '';
		    let sessionClearConfirmAction = '';
		    let sessionsPersistEnabled = true;
		    let sessionsMaxSessions = 20;
		    let sessionsMaxSessionBytes = 2000000;
			    let currentModel = '';
			    let currentReasoningEffort = 'high';
			    let modelSwitchPending = false;
			    let modelFavoritePending = false;
			    let modelPickerRefreshPending = false;
			    let modelPickerOpenPending = false;
			    let advancedModelSettingsPending = false;
			    let showLogsPending = false;
			    let reasoningEffortPending = false;
			    let generationTemperature = 0;
			    let generationTopP = 0;
			    let generationTopK = 0;
			    let generationMaxOutputTokens = 32000;
			    let generationTextVerbosity = '';
			    let generationMaxRetries = 2;
			    let generationRetryWithPartialOutput = false;
			    let generationTimeoutMs = 0;
			    let currentModelPickerState = null;
			    let modelPickerSearchQuery = '';
			    let currentProviderId = 'copilot';
			    let providerSwitchPending = false;
			    let codexSubscriptionSettings = { defaultModelId: 'gpt-5.3-codex' };
			    let openAICompatibleSettings = { baseURL: '', defaultModelId: '', apiKeyEnv: 'OPENAI_API_KEY', modelDisplayNames: {} };
			    let planFirstEnabled = true;
			    let autoApproveEnabled = false;
			    let allowExternalPathsEnabled = false;
			    let blockGitPushEnabled = true;
			    let debugSettings = { details: false, llm: false, tools: false, plugins: false, effectiveLlm: false, effectiveTools: false, effectivePlugins: false };
			    let debugSettingsPending = false;
			    let pluginSettings = { plugins: [], autoDiscover: false, workspaceDir: '.lingyun' };
			    let pluginSettingsPending = false;
			    let pendingSettingStateTypes = new Set();
			    let toolFilter = [];
	    let workspaceEnv = {};
	    let toolsCatalogRequestPending = false;
	    let currentToolsCatalog = null;
	    let toolsCatalogSearchQuery = '';
	    let manualToolRunBusy = false;
	    let pendingManualToolConfirmation = null;
	    let latestManualToolResult = null;
	    let autoApprovedTools = [];
	    let autoApprovedToolsPending = false;
	    let autoApprovedToolsClearConfirmPending = false;
	    let instructionPatterns = [];

			    let instructionFileSettings = { includeGlobal: true, maxCharsPerFile: 60000, maxTotalChars: 180000 };
			    let toolRuntimeLimits = {
			      toolTimeoutMs: 0,
			      readMaxLines: 300,
			      bashBackgroundTtlMs: 600000,
			      bashBackgroundCaptureMs: 2000,
			      bashBackgroundCaptureLines: 50,
			      workspaceShellTimeoutMs: 60000,
			      httpTimeoutMs: 30000,
			    };
			    let showThinkingEnabled = true;
			    let memoriesFeatureEnabled = true;
			    let memoryAutoRecallEnabled = true;
			    let memoryAutoRecallMaxResults = 4;
			    let memoryAutoRecallMaxTokens = 1200;
			    let memoryAutoRecallMinScore = 7;
			    let memoryAutoRecallMinScoreGap = 1.25;
			    let memoryAutoRecallMaxAgeDays = 45;
			    let memoryAdvancedLimits = {
			      maxRawMemoriesForGlobal: 120,
			      maxRolloutAgeDays: 30,
			      maxRolloutsPerStartup: 24,
			      minRolloutIdleHours: 2,
			      maxStateOutputs: 500,
			      maxRecords: 5000,
			      maxSearchResults: 8,
			      maxResultsPerKind: 3,
			      searchNeighborWindow: 1,
			    };
			    let memoryActionBusy = false;
			    let memoryDropConfirmPending = false;
			    let explorePrepassEnabled = false;
			    let explorePrepassMaxChars = 8000;
			    let subagentModelOverride = '';
			    let subagentTaskMaxOutputChars = 8000;
			    let autoCompactionEnabled = true;
			    let modelLimits = {};
			    let compactionPruneEnabled = true;
			    let compactionPruneProtectTokens = 40000;
			    let compactionPruneMinimumTokens = 20000;
			    let compactionToolOutputMode = 'afterToolCall';
			    let currentProviderAuth = {
			      providerId: '',
			      providerName: '',
			      supported: false,
			      authenticated: false,
			      status: 'hidden',
			      label: '',
			      detail: '',
			      accountLabel: '',
			      primaryActionLabel: '',
			      secondaryActionLabel: '',
			    };
			    let providerAuthBusy = false;
			    let currentMode = 'build';
			    let modeSwitchPending = false;
		    let currentLoop = {
		      available: true,
		      enabled: false,
		      canRunNow: false,
		      intervalMinutes: 5,
		      prompt: '',
		      reason: 'disabled',
		      statusText: 'Loop is off for this session.',
		      lastFiredAt: undefined,
		      nextFireAt: undefined,
		    };
	    let loopDefaults = {
	      enabled: false,
	      intervalMinutes: 5,
	      prompt: 'review your recent activity - has it been in alignment with our principles? ./AGENTS.md',
	    };
			    let currentOperation = null;
		    let operationTimer = null;
		    let pendingApprovalsCount = 0;
		    let manualApprovalsCount = 0;
		    let autoApproveThisRun = false;
		    let latestContext = null;
		    let latestTodos = null;
		    const messageEls = new Map();
		    const messageDataById = new Map();
		    const turnEls = new Map();
		    const stepBodies = new Map();
		    const pendingTokens = new Map();
	    let lastToolMsg = null;
		    const BATCH_TOOL_TYPES = ['read', 'read_range', 'glob', 'list'];
	    let suppressAutoScroll = false;
	    let userScrolledAway = false;
	    const AUTO_SCROLL_THRESHOLD_PX = 80;
	    let activityOpenStates = {};

	    const INPUT_HISTORY_MAX_ENTRIES = 100;
	    const INPUT_HISTORY_MAX_ENTRY_CHARS = 10000;
	    let inputHistoryEntries = [];
	    let inputHistoryIndex = -1;
	    let inputHistorySavedDraft = null;
	    const MAX_CLIPBOARD_IMAGES = 8;
	    const MAX_CLIPBOARD_IMAGE_DATA_URL_CHARS = 12000000;
	    const INPUT_NOTICE_DURATION_MS = 4000;
	    const PENDING_ACTION_TIMEOUT_MS = 10000;
	    const SETTINGS_PENDING_TIMEOUT_MS = 10000;
	    let pendingImageAttachments = [];
	    let inputNoticeMessage = '';
	    let inputNoticeTimer = null;
	    const pendingSettingTimers = new Map();
	    const pendingActionTimers = new Map();

	    const SKILL_DROPDOWN_MAX_ITEMS = 30;
	    let skillsEnabled = true;
	    let skillsBudget = { maxPromptSkills: 50, maxInjectSkills: 5, maxInjectChars: 20000 };
	    let skillSearchPaths = [];
	    let availableSkills = [];
	    let skillDropdownOpen = false;
	    let skillDropdownItems = [];
	    let skillDropdownSelectedIndex = 0;
	    let skillDropdownTokenStart = -1;
	    let skillDropdownQuery = '';

	    function updateSkillsEnabledState(enabled) {
	      skillsEnabled = !!enabled;
	      if (skillsToggle) {
	        skillsToggle.checked = skillsEnabled;
	      }
	      if (skillsToggleLabel) {
	        skillsToggleLabel.title = skillsEnabled
	          ? 'Skills are on: $ suggestions and the skill tool are available.'
	          : 'Skills are off: $ suggestions and the skill tool are disabled.';
	      }
	      if (!skillsEnabled) {
	        closeSkillDropdown();
	      } else {
	        updateSkillDropdown();
	      }
	    }

	    function normalizeSkillSearchPaths(raw) {
	      const source = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[\n,]/) : []);
	      const seen = new Set();
	      const normalized = [];
	      source.forEach((value) => {
	        if (typeof value !== 'string') return;
	        const pathValue = value.trim();
	        if (!pathValue || seen.has(pathValue)) return;
	        seen.add(pathValue);
	        normalized.push(pathValue);
	      });
	      return normalized;
	    }

	    function updateSkillsSettingsTitle() {
	      if (!skillsSettings) return;
	      const pathText = skillSearchPaths.length ? skillSearchPaths.length + ' path(s)' : 'no paths';
	      skillsSettings.title = 'Skills: ' + pathText + ', prompt ' + skillsBudget.maxPromptSkills + ', inject ' + skillsBudget.maxInjectSkills + ', chars ' + skillsBudget.maxInjectChars;
	    }

	    function updateSkillSearchPathsState(paths) {
	      skillSearchPaths = normalizeSkillSearchPaths(paths);
	      if (skillSearchPathsInput) {
	        skillSearchPathsInput.value = skillSearchPaths.join('\n');
	        skillSearchPathsInput.title = skillSearchPaths.length
	          ? skillSearchPaths.length + ' skill search path(s) configured.'
	          : 'No skill search paths configured.';
	      }
	      if (skillSearchPathsLabel) {
	        skillSearchPathsLabel.title = skillSearchPaths.length
	          ? 'Skill search paths: ' + skillSearchPaths.join(', ')
	          : 'No skill search paths configured.';
	      }
	      updateSkillsSettingsTitle();
	    }

	    function updateSkillsBudgetState(budget) {
	      const raw = budget && typeof budget === 'object' ? budget : {};
	      const maxPromptSkills = Number(raw.maxPromptSkills);
	      const maxInjectSkills = Number(raw.maxInjectSkills);
	      const maxInjectChars = Number(raw.maxInjectChars);
	      skillsBudget = {
	        maxPromptSkills: Number.isFinite(maxPromptSkills) && maxPromptSkills >= 0 ? Math.floor(maxPromptSkills) : 50,
	        maxInjectSkills: Number.isFinite(maxInjectSkills) && maxInjectSkills >= 1 ? Math.floor(maxInjectSkills) : 5,
	        maxInjectChars: Number.isFinite(maxInjectChars) && maxInjectChars >= 1 ? Math.floor(maxInjectChars) : 20000,
	      };
	      if (skillsMaxPromptInput) skillsMaxPromptInput.value = String(skillsBudget.maxPromptSkills);
	      if (skillsMaxInjectInput) skillsMaxInjectInput.value = String(skillsBudget.maxInjectSkills);
	      if (skillsMaxInjectCharsInput) skillsMaxInjectCharsInput.value = String(skillsBudget.maxInjectChars);
	      updateSkillsSettingsTitle();
	    }

	    function setAvailableSkills(skills) {
	      const next = Array.isArray(skills) ? skills : [];
	      const seen = new Set();
	      const normalized = [];
	      for (const item of next) {
	        if (typeof item !== 'string') continue;
	        const name = item.trim();
	        if (!name) continue;
	        if (seen.has(name)) continue;
	        seen.add(name);
	        normalized.push(name);
	      }
	      availableSkills = normalized;
	      updateSkillDropdown();
	    }

	    function closeSkillDropdown() {
	      if (!skillDropdown) return;
	      skillDropdownOpen = false;
	      skillDropdownItems = [];
	      skillDropdownSelectedIndex = 0;
	      skillDropdownTokenStart = -1;
	      skillDropdownQuery = '';
	      skillDropdown.classList.add('hidden');
	      skillDropdown.innerHTML = '';
	    }

	    function getSkillMentionContext() {
	      if (!input) return null;
	      if (input.selectionStart !== input.selectionEnd) return null;
	      const caret = input.selectionStart || 0;
	      const before = (input.value || '').slice(0, caret);
	      const match = before.match(/(^|\s)\$([A-Za-z0-9_.-]*)$/);
	      if (!match) return null;
	      const query = match[2] || '';
	      const start = caret - query.length - 1;
	      return { start, query };
	    }

	    function filterSkillsForQuery(query) {
	      const q = (query || '').toLowerCase();
	      if (!q) return availableSkills.slice(0, SKILL_DROPDOWN_MAX_ITEMS);
	      const starts = availableSkills.filter((name) => name.toLowerCase().startsWith(q));
	      const matches = starts.length > 0 ? starts : availableSkills.filter((name) => name.toLowerCase().includes(q));
	      return matches.length > SKILL_DROPDOWN_MAX_ITEMS ? matches.slice(0, SKILL_DROPDOWN_MAX_ITEMS) : matches;
	    }

	    function renderSkillDropdown() {
	      if (!skillDropdown) return;
	      skillDropdown.innerHTML = '';

	      if (skillDropdownItems.length === 0) {
	        const emptyEl = document.createElement('div');
	        emptyEl.className = 'skill-dropdown-empty';
	        emptyEl.textContent = availableSkills.length === 0 ? 'No skills available.' : 'No matching skills.';
	        skillDropdown.appendChild(emptyEl);
	      } else {
	        for (let i = 0; i < skillDropdownItems.length; i++) {
	          const name = skillDropdownItems[i];
	          const itemEl = document.createElement('button');
	          itemEl.type = 'button';
	          itemEl.className = 'skill-dropdown-item' + (i === skillDropdownSelectedIndex ? ' selected' : '');
	          itemEl.dataset.index = String(i);
	          itemEl.setAttribute('role', 'option');
	          itemEl.setAttribute('aria-selected', i === skillDropdownSelectedIndex ? 'true' : 'false');
	          itemEl.textContent = name;
	          skillDropdown.appendChild(itemEl);
	        }
	      }

	      skillDropdown.classList.toggle('hidden', false);
	      skillDropdownOpen = true;

	      const selected = skillDropdown.querySelector('.skill-dropdown-item.selected');
	      if (selected && typeof selected.scrollIntoView === 'function') {
	        try { selected.scrollIntoView({ block: 'nearest' }); } catch {}
	      }
	    }

	    function updateSkillDropdown() {
	      if (!skillDropdown) return;
	      if (!initReceived || isProcessing || !skillsEnabled) {
	        closeSkillDropdown();
	        return;
	      }

	      const ctx = getSkillMentionContext();
	      if (!ctx) {
	        closeSkillDropdown();
	        return;
	      }

	      const prevQuery = skillDropdownQuery;
	      const prevStart = skillDropdownTokenStart;

	      const nextItems = filterSkillsForQuery(ctx.query);
	      skillDropdownItems = nextItems;
	      skillDropdownTokenStart = ctx.start;
	      skillDropdownQuery = ctx.query;

	      const queryChanged = prevQuery !== ctx.query || prevStart !== ctx.start;
	      if (queryChanged || skillDropdownSelectedIndex >= nextItems.length) {
	        skillDropdownSelectedIndex = 0;
	      }

	      renderSkillDropdown();
	    }

	    function moveSkillDropdownSelection(delta) {
	      if (!skillDropdownOpen) return;
	      if (!skillDropdownItems || skillDropdownItems.length === 0) return;
	      const count = skillDropdownItems.length;
	      let next = (skillDropdownSelectedIndex + delta) % count;
	      if (next < 0) next += count;
	      skillDropdownSelectedIndex = next;
	      renderSkillDropdown();
	    }

	    function applySkillSuggestion(name) {
	      if (!input) return;
	      const text = input.value || '';
	      const start = skillDropdownTokenStart;
	      if (!Number.isFinite(start) || start < 0 || start >= text.length || text[start] !== '$') return;

	      let end = start + 1;
	      while (end < text.length && /[A-Za-z0-9_.-]/.test(text[end])) end++;

	      const before = text.slice(0, start);
	      const after = text.slice(end);
	      let nextText = before + '$' + name + after;
	      let caret = before.length + 1 + name.length;
	      if (caret === nextText.length) {
	        nextText += ' ';
	        caret += 1;
	      }

	      input.value = nextText;
	      try { input.setSelectionRange(caret, caret); } catch {}
	      updateInputLayout();
	      closeSkillDropdown();
	      try { input.focus(); } catch {}
	    }

	    function applySelectedSkill() {
	      if (!skillDropdownOpen) return false;
	      if (!skillDropdownItems || skillDropdownItems.length === 0) return false;
	      const name = skillDropdownItems[skillDropdownSelectedIndex];
	      if (!name) return false;
	      applySkillSuggestion(name);
	      return true;
	    }

	    function setInputHistoryEntries(entries) {
	      const next = Array.isArray(entries) ? entries : [];
	      const normalized = [];
	      for (const item of next) {
	        if (typeof item !== 'string') continue;
	        const trimmed = item.trim();
	        if (!trimmed) continue;
	        normalized.push(trimmed.length > INPUT_HISTORY_MAX_ENTRY_CHARS ? trimmed.slice(0, INPUT_HISTORY_MAX_ENTRY_CHARS) : trimmed);
	        if (normalized.length >= INPUT_HISTORY_MAX_ENTRIES) break;
	      }

	      inputHistoryEntries = normalized;
	      if (inputHistoryIndex >= 0) {
	        inputHistoryIndex = -1;
	        inputHistorySavedDraft = null;
	      }
	    }

	    function addToInputHistory(text) {
	      const trimmed = (text || '').trim();
	      if (!trimmed) return;
	      const entry = trimmed.length > INPUT_HISTORY_MAX_ENTRY_CHARS ? trimmed.slice(0, INPUT_HISTORY_MAX_ENTRY_CHARS) : trimmed;
	      if (inputHistoryEntries[0] === entry) return;
	      inputHistoryEntries.unshift(entry);
	      if (inputHistoryEntries.length > INPUT_HISTORY_MAX_ENTRIES) {
	        inputHistoryEntries.length = INPUT_HISTORY_MAX_ENTRIES;
	      }
	    }

	    function persistActivityOpenState(turnId, open) {
	      if (!turnId) return;
	      try {
	        const state = vscode.getState() || {};
	        state.activityOpenStates = state.activityOpenStates || {};
	        state.activityOpenStates[turnId] = !!open;
	        vscode.setState(state);
	      } catch {}
	    }

	    function pruneActivityOpenStatesToTurns() {
	      try {
	        const state = vscode.getState() || {};
	        const source = state.activityOpenStates && typeof state.activityOpenStates === 'object'
	          ? state.activityOpenStates
	          : {};
	        const next = {};
	        turnEls.forEach((turnData, turnId) => {
	          if (source[turnId]) next[turnId] = true;
	        });
	        activityOpenStates = next;
	        state.activityOpenStates = next;
	        vscode.setState(state);
	      } catch {
	        activityOpenStates = {};
	      }
	    }

	    function clearActivityOpenStates() {
	      activityOpenStates = {};
	      try {
	        const state = vscode.getState() || {};
	        delete state.activityOpenStates;
	        vscode.setState(state);
	      } catch {}
	    }

	    function clearModelPickerCache() {
	      currentModelPickerState = null;
	      modelPickerSearchQuery = '';
	      if (modelPickerSearchInput) modelPickerSearchInput.value = '';
	      if (modelPickerList) {
	        modelPickerList.innerHTML = '';
	        modelPickerList.classList.add('hidden');
	      }
	    }

	    function markInvalidField(el, message) {
	      if (!el) return;
	      const hasMessage = !!message;
	      try { el.setCustomValidity(hasMessage ? message : ''); } catch {}
	      if (hasMessage) {
	        try { el.reportValidity(); } catch {}
	      }
	      try { el.setAttribute('aria-invalid', hasMessage ? 'true' : 'false'); } catch {}
	      try {
	        if (hasMessage) {
	          if (!el.hasAttribute('data-lingyun-valid-title')) {
	            el.setAttribute('data-lingyun-valid-title', el.getAttribute('title') || '');
	          }
	          el.title = message;
	        } else if (el.hasAttribute('data-lingyun-valid-title')) {
	          const previousTitle = el.getAttribute('data-lingyun-valid-title') || '';
	          if (previousTitle) {
	            el.title = previousTitle;
	          } else {
	            el.removeAttribute('title');
	          }
	          el.removeAttribute('data-lingyun-valid-title');
	        }
	      } catch {
	        if (hasMessage) el.title = message;
	      }
	    }

	    function clearInvalidFields(fields) {
	      (Array.isArray(fields) ? fields : []).forEach((field) => markInvalidField(field, ''));
	    }

	    function validateNumberField(el, value, min, message, max) {
	      const parsed = Number(value);
	      if (!Number.isFinite(parsed) || parsed < min || (Number.isFinite(max) && parsed > max)) {
	        markInvalidField(el, message);
	        return false;
	      }
	      return true;
	    }

	    function announceStatus(message) {
	      if (!liveRegion) return;
	      const text = typeof message === 'string' ? message.trim() : '';
	      if (!text) return;
	      liveRegion.textContent = '';
	      try {
	        requestAnimationFrame(() => { liveRegion.textContent = text; });
	      } catch {
	        liveRegion.textContent = text;
	      }
	    }

	    function hasPendingSettingState(stateType) {
	      return pendingSettingStateTypes.has(stateType);
	    }

	    function clearPendingSettingTimer(stateType) {
	      const timer = pendingSettingTimers.get(stateType);
	      if (timer) {
	        clearTimeout(timer);
	        pendingSettingTimers.delete(stateType);
	      }
	    }

	    function requestSettingsStateRefresh() {
	      try { vscode.postMessage({ type: 'refreshSettingsState' }); } catch {}
	    }

	    function setPendingSettingState(stateType, pending) {
	      if (!stateType) return;
	      clearPendingSettingTimer(stateType);
	      if (pending) {
	        pendingSettingStateTypes.add(stateType);
	        const timer = setTimeout(() => {
	          pendingSettingTimers.delete(stateType);
	          if (!pendingSettingStateTypes.has(stateType)) return;
	          pendingSettingStateTypes.delete(stateType);
	          showInputNotice('Settings update is taking longer than expected. Controls were re-enabled and state was refreshed.');
	          requestSettingsStateRefresh();
	          syncInputState();
	        }, SETTINGS_PENDING_TIMEOUT_MS);
	        pendingSettingTimers.set(stateType, timer);
	      } else {
	        pendingSettingStateTypes.delete(stateType);
	      }
	    }

	    function clearPendingSettingStates() {
	      pendingSettingTimers.forEach((timer) => clearTimeout(timer));
	      pendingSettingTimers.clear();
	      pendingSettingStateTypes.clear();
	    }

	    function clearPendingActionTimer(actionType) {
	      const timer = pendingActionTimers.get(actionType);
	      if (timer) {
	        clearTimeout(timer);
	        pendingActionTimers.delete(actionType);
	      }
	    }

	    function armPendingActionTimer(actionType, onTimeout) {
	      if (!actionType || typeof onTimeout !== 'function') return;
	      clearPendingActionTimer(actionType);
	      const timer = setTimeout(() => {
	        pendingActionTimers.delete(actionType);
	        onTimeout();
	      }, PENDING_ACTION_TIMEOUT_MS);
	      pendingActionTimers.set(actionType, timer);
	    }

	    function clearAllPendingActionTimers() {
	      pendingActionTimers.forEach((timer) => clearTimeout(timer));
	      pendingActionTimers.clear();
	    }

	    function recoverPendingAction(actionType, message, resetState) {
	      clearPendingActionTimer(actionType);
	      if (typeof resetState === 'function') resetState();
	      showInputNotice(message || 'Action is taking longer than expected. Controls were re-enabled.');
	      syncInputState();
	    }

	    function postSettingWithPendingState(stateType, message, restoreCurrentState) {
	      if (hasPendingSettingState(stateType)) {
	        if (typeof restoreCurrentState === 'function') restoreCurrentState();
	        return;
	      }
	      if (typeof restoreCurrentState === 'function') restoreCurrentState();
	      setPendingSettingState(stateType, true);
	      syncInputState();
	      try {
	        vscode.postMessage(message);
	      } catch {
	        setPendingSettingState(stateType, false);
	        showInputNotice('Failed to request settings update.');
	        syncInputState();
	      }
	    }

	    function postSettingsWithPendingStates(stateTypes, messages, restoreCurrentState) {
	      const types = (Array.isArray(stateTypes) ? stateTypes : [stateTypes]).filter(Boolean);
	      if (types.some((stateType) => hasPendingSettingState(stateType))) {
	        if (typeof restoreCurrentState === 'function') restoreCurrentState();
	        return;
	      }
	      if (typeof restoreCurrentState === 'function') restoreCurrentState();
	      types.forEach((stateType) => setPendingSettingState(stateType, true));
	      syncInputState();
	      try {
	        (Array.isArray(messages) ? messages : [messages]).forEach((message) => vscode.postMessage(message));
	      } catch {
	        types.forEach((stateType) => setPendingSettingState(stateType, false));
	        showInputNotice('Failed to request settings update.');
	        syncInputState();
	      }
	    }

	    function updateTurnActivitySummary(turnData) {
	      if (!turnData || !turnData.activity) return;
	      const count = Number.isFinite(turnData.activityCount) ? turnData.activityCount : 0;
	      if (turnData.activityCountEl) {
	        turnData.activityCountEl.textContent = count > 0 ? '(' + count + ')' : '';
	      }
	      const hasItems = turnData.activityBody && turnData.activityBody.children && turnData.activityBody.children.length > 0;
	      turnData.activity.hidden = !hasItems;
	    }

	    function isNearBottom() {
	      if (!messages) return true;
	      const distance = messages.scrollHeight - (messages.scrollTop + messages.clientHeight);
	      return distance < AUTO_SCROLL_THRESHOLD_PX;
	    }

	    function maybeAutoScroll(wasNearBottom) {
	      if (suppressAutoScroll) return;
	      if (userScrolledAway) return;
	      if (!wasNearBottom) return;
	      messages.scrollTop = messages.scrollHeight;
	    }

	    function maybeAutoScrollAfterLayout(wasNearBottom) {
	      maybeAutoScroll(wasNearBottom);
	      try {
	        requestAnimationFrame(() => maybeAutoScroll(wasNearBottom));
	      } catch {
	        // ignore
	      }
	    }

	    function formatElapsed(ms) {
	      if (!Number.isFinite(ms) || ms < 0) return '';
	      const totalSeconds = Math.floor(ms / 1000);
	      const minutes = Math.floor(totalSeconds / 60);
	      const seconds = totalSeconds % 60;
	      if (minutes <= 0) return totalSeconds + 's';
	      return minutes + 'm ' + seconds + 's';
	    }

	    function stopOperationTimer() {
	      if (operationTimer) {
	        clearInterval(operationTimer);
	        operationTimer = null;
	      }
	    }

	    function updateOperationBanner() {
	      if (!operationBanner || !operationLabelEl || !operationElapsedEl) return;
	      if (!currentOperation) {
	        operationBanner.classList.add('hidden');
	        stopOperationTimer();
	        return;
	      }

	      operationBanner.classList.remove('hidden');
	      const previousLabel = operationLabelEl.textContent || '';
	      operationLabelEl.textContent = currentOperation.label || 'Working…';

	      const status = currentOperation.status || 'running';
	      if (operationSpinner) {
	        operationSpinner.style.display = status === 'running' ? '' : 'none';
	      }
	      if (operationLabelEl.textContent !== previousLabel) announceStatus(operationLabelEl.textContent);
	      const elapsed = Date.now() - (currentOperation.startedAt || Date.now());
	      operationElapsedEl.textContent = status === 'running' ? formatElapsed(elapsed) : '';

	      if (operationStopBtn) {
	        operationStopBtn.disabled = !initReceived || !isProcessing || abortRequestPending || status !== 'running';
	      }
	    }

	    function updateApprovalBanner() {
	      if (!approvalBanner || !approvalLabelEl) return;

	      const show = pendingApprovalsCount > 0 && isProcessing && initReceived;
	      approvalBanner.classList.toggle('hidden', !show);
	      if (!show) return;

	      const previousApprovalLabel = approvalLabelEl.textContent || '';
	      approvalLabelEl.textContent =
	        pendingApprovalsCount === 1
	          ? 'Waiting for approval (1)'
	          : 'Waiting for approval (' + pendingApprovalsCount + ')';
	      if (manualApprovalsCount > 0) {
	        approvalLabelEl.textContent += ' • ' + manualApprovalsCount + ' manual';
	      }
	      if (approvalLabelEl.textContent !== previousApprovalLabel) announceStatus(approvalLabelEl.textContent);

	      if (approvalAllowAllBtn) {
	        approvalAllowAllBtn.disabled = pendingApprovalsCount <= 0 || manualApprovalsCount > 0 || approveAllPending || abortRequestPending;
	      }
	      if (approvalStopBtn) {
	        approvalStopBtn.disabled = abortRequestPending;
	      }
	    }

	    function startOperation(operation) {
	      currentOperation = operation || null;
	      updateOperationBanner();
	      stopOperationTimer();
	      if (currentOperation && (currentOperation.status || 'running') === 'running') {
	        operationTimer = setInterval(updateOperationBanner, 1000);
	      }
	    }

	    function endOperation(status, labelOverride) {
	      if (!currentOperation) return;
	      currentOperation.status = status || 'done';
	      if (typeof labelOverride === 'string' && labelOverride.trim()) {
	        currentOperation.label = labelOverride.trim();
	      }
	      updateOperationBanner();
	      stopOperationTimer();

	      const hideTimer = setTimeout(() => {
	        if (hideTimer) clearTimeout(hideTimer);
	        currentOperation = null;
	        updateOperationBanner();
	      }, 1200);
	    }

	    if (messages) {
	      messages.addEventListener('scroll', () => {
	        if (!initReceived) return;
	        userScrolledAway = !isNearBottom();
	      }, { passive: true });
	    }

    function getFatalErrorDetails(err) {
      const record = err && typeof err === 'object' ? err : null;
      const name = record && typeof record.name === 'string' ? record.name : '';
      const message = record && typeof record.message === 'string'
        ? record.message
        : (record && typeof record.stack === 'string' ? record.stack : String(err));
      const stack = record && typeof record.stack === 'string' ? record.stack : '';
      return {
        name,
        message,
        stack,
        displayText: stack || message,
      };
    }

    const chatProtocol = window.LINGYUN_CHAT_PROTOCOL;

    function postWebviewCrash(details, source) {
      try {
        vscode.postMessage({
          type: chatProtocol.webviewError,
          error: {
            kind: 'fatal',
            source: source || 'webview',
            name: details && details.name ? details.name : undefined,
            message: details && details.message ? details.message : undefined,
            stack: details && details.stack ? details.stack : undefined,
          }
        });
      } catch {}
    }

	    function setCustomModelInputsDisabled(disabled) {
      if (customModelInput) customModelInput.disabled = disabled;
      if (customModelLabel) customModelLabel.classList.toggle('disabled', !!disabled);
    }

	    function setGenerationInputsDisabled(disabled) {
      if (temperatureInput) temperatureInput.disabled = disabled;
      if (topPInput) topPInput.disabled = disabled;
      if (topPLabel) topPLabel.classList.toggle('disabled', !!disabled);
      if (topKInput) topKInput.disabled = disabled;
      if (topKLabel) topKLabel.classList.toggle('disabled', !!disabled);
      if (maxOutputTokensInput) maxOutputTokensInput.disabled = disabled;
      if (textVerbositySelect) textVerbositySelect.disabled = disabled;
      if (textVerbosityLabel) textVerbosityLabel.classList.toggle('disabled', !!disabled);
      if (maxRetriesInput) maxRetriesInput.disabled = disabled;
      if (llmTimeoutInput) llmTimeoutInput.disabled = disabled;
      if (retryWithPartialOutputToggle) retryWithPartialOutputToggle.disabled = disabled;
      if (retryWithPartialOutputLabel) retryWithPartialOutputLabel.classList.toggle('disabled', !!disabled);
    }

    function setInstructionFileInputsDisabled(disabled) {
      if (instructionPatternsInput) instructionPatternsInput.disabled = disabled;
      if (instructionPatternsLabel) instructionPatternsLabel.classList.toggle('disabled', !!disabled);
      if (instructionIncludeGlobalToggle) instructionIncludeGlobalToggle.disabled = disabled;
      if (instructionIncludeGlobalLabel) instructionIncludeGlobalLabel.classList.toggle('disabled', !!disabled);
      if (instructionMaxCharsPerFileInput) instructionMaxCharsPerFileInput.disabled = disabled;
      if (instructionMaxCharsPerFileLabel) instructionMaxCharsPerFileLabel.classList.toggle('disabled', !!disabled);
      if (instructionMaxTotalCharsInput) instructionMaxTotalCharsInput.disabled = disabled;
      if (instructionMaxTotalCharsLabel) instructionMaxTotalCharsLabel.classList.toggle('disabled', !!disabled);
      if (instructionPatternsApply) instructionPatternsApply.disabled = disabled;
    }


    function showFatalError(err, source) {
      try {
        const details = getFatalErrorDetails(err);
        if (modelPickerLabel) {
          modelPickerLabel.textContent = 'Webview error';
        } else if (modelPicker) {
          modelPicker.textContent = 'Webview error';
        }
	      if (providerSelect) {
	        providerSelect.disabled = true;
	      }
	      if (providerSettings) {
	        providerSettings.disabled = true;
	      }
	      if (providerSettingsApply) {
	        providerSettingsApply.disabled = true;
	      }
	      if (codexDefaultModelInput) {
	        codexDefaultModelInput.disabled = true;
	      }
	      if (codexDefaultModelLabel) {
	        codexDefaultModelLabel.classList.add('disabled');
	      }
	      if (safetySelect) {
          safetySelect.disabled = true;
        }
        if (showLogsBtn) {
          showLogsBtn.disabled = true;
        }
        if (listToolsBtn) {
          listToolsBtn.disabled = true;
        }
        if (runToolBtn) {
          runToolBtn.disabled = true;
        }
        if (createToolsConfigBtn) {
          createToolsConfigBtn.disabled = true;
        }
        if (sessionClearCurrentBtn) {
          sessionClearCurrentBtn.disabled = true;
        }
        if (sessionClearSavedBtn) {
          sessionClearSavedBtn.disabled = true;
        }
        setInstructionFileInputsDisabled(true);
        setLoopInputsDisabled(true);
        if (thinkingToggle) {
          thinkingToggle.disabled = true;
        }
        if (thinkingLabel) {
          thinkingLabel.classList.add('disabled');
        }
        if (memoriesFeatureToggle) {
          memoriesFeatureToggle.disabled = true;
        }
        if (memoriesFeatureLabel) {
          memoriesFeatureLabel.classList.add('disabled');
        }
        if (memoryAutoRecallToggle) {
          memoryAutoRecallToggle.disabled = true;
        }
        if (memoryAutoRecallLabel) {
          memoryAutoRecallLabel.classList.add('disabled');
        }
        [
          memoryMaxRawMemoriesForGlobalInput,
          memoryMaxRolloutAgeDaysInput,
          memoryMaxRolloutsPerStartupInput,
          memoryMinRolloutIdleHoursInput,
          memoryMaxStateOutputsInput,
          memoryMaxRecordsInput,
          memoryMaxSearchResultsInput,
          memoryMaxResultsPerKindInput,
          memorySearchNeighborWindowInput,
        ].forEach((memoryLimitInput) => {
          if (memoryLimitInput) memoryLimitInput.disabled = true;
        });
        if (memoryAdvancedLimitsApply) {
          memoryAdvancedLimitsApply.disabled = true;
        }
        if (memoryUpdateNowBtn) {
          memoryUpdateNowBtn.disabled = true;
        }
        if (memoryDropBtn) {
          memoryDropBtn.disabled = true;
        }
        [
          memoryMaxRawMemoriesForGlobalLabel,
          memoryMaxRolloutAgeDaysLabel,
          memoryMaxRolloutsPerStartupLabel,
          memoryMinRolloutIdleHoursLabel,
          memoryMaxStateOutputsLabel,
          memoryMaxRecordsLabel,
          memoryMaxSearchResultsLabel,
          memoryMaxResultsPerKindLabel,
          memorySearchNeighborWindowLabel,
        ].forEach((memoryLimitLabel) => {
          if (memoryLimitLabel) memoryLimitLabel.classList.add('disabled');
        });
        if (autoCompactionToggle) {
          autoCompactionToggle.disabled = true;
        }
        if (autoCompactionLabel) {
          autoCompactionLabel.classList.add('disabled');
        }
        if (modelLimitsInput) {
          modelLimitsInput.disabled = true;
        }
        if (modelLimitsApply) {
          modelLimitsApply.disabled = true;
        }
        if (modelLimitsLabel) {
          modelLimitsLabel.classList.add('disabled');
        }
        if (compactionToolOutputModeSelect) {
          compactionToolOutputModeSelect.disabled = true;
        }
        if (compactionToolOutputModeLabel) {
          compactionToolOutputModeLabel.classList.add('disabled');
        }
        if (planFirstToggle) {
          planFirstToggle.disabled = true;
        }
        if (planFirstLabel) {
          planFirstLabel.classList.add('disabled');
        }
        if (reasoningEffortSelect) {
          reasoningEffortSelect.disabled = true;
        }
        if (modelFavoriteToggle) {
          modelFavoriteToggle.disabled = true;
          modelFavoriteToggle.textContent = '☆';
        }
	      if (modelSettings) {
	        modelSettings.disabled = true;
	      }
	      if (customModelApply) {
	        customModelApply.disabled = true;
	      }
	      if (modelRefreshList) {
	        modelRefreshList.disabled = true;
	      }
	      if (modelClearRecents) {
	        modelClearRecents.disabled = true;
	      }
	      if (modelSettingsApply) {
          modelSettingsApply.disabled = true;
        }
        if (modelSettingsOpenSettings) {
          modelSettingsOpenSettings.disabled = true;
        }
        const banner = document.createElement('div');
        banner.style.padding = '10px 12px';
        banner.style.margin = '10px';
        banner.style.border = '1px solid var(--vscode-testing-iconFailed, #f14c4c)';
        banner.style.borderRadius = '8px';
        banner.style.background = 'var(--vscode-inputValidation-errorBackground, rgba(241,76,76,0.1))';
        banner.style.color = 'var(--vscode-foreground)';
        banner.style.whiteSpace = 'pre-wrap';
        banner.textContent = 'LingYun webview crashed:\n\n' + details.displayText + '\n\nOpen “Developer: Open Webview Developer Tools” for details.';
        document.body.insertBefore(banner, document.body.firstChild);
        postWebviewCrash(details, source || 'webview');
      } catch {
        // Ignore secondary errors
      }
    }

    window.addEventListener('error', (e) => showFatalError(e.error || e.message, 'window.error'));
    window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason, 'window.unhandledrejection'));


	    if (modelPickerLabel) {
	      modelPickerLabel.textContent = 'Connecting…';
	    } else if (modelPicker) {
	      modelPicker.textContent = 'Connecting…';
	    }
	    if (providerSelect) {
	      providerSelect.disabled = true;
	    }
	    if (providerSettings) {
	      providerSettings.disabled = true;
	    }
	    if (providerSettingsApply) {
	      providerSettingsApply.disabled = true;
	    }
	    if (codexDefaultModelInput) {
	      codexDefaultModelInput.disabled = true;
	    }
	    if (codexDefaultModelLabel) {
	      codexDefaultModelLabel.classList.add('disabled');
	    }
	    if (safetySelect) {
	      safetySelect.disabled = true;
	    }
	    if (showLogsBtn) {
	      showLogsBtn.disabled = true;
	    }
	    if (listToolsBtn) {
	      listToolsBtn.disabled = true;
	    }
	    if (runToolBtn) {
	      runToolBtn.disabled = true;
	    }
	    if (createToolsConfigBtn) {
	      createToolsConfigBtn.disabled = true;
	    }
	    if (sessionClearCurrentBtn) {
	      sessionClearCurrentBtn.disabled = true;
	    }
	    if (sessionClearSavedBtn) {
	      sessionClearSavedBtn.disabled = true;
	    }
	    setInstructionFileInputsDisabled(true);
	    setLoopInputsDisabled(true);
	    if (thinkingToggle) {
	      thinkingToggle.disabled = true;
	    }
	    if (thinkingLabel) {
	      thinkingLabel.classList.add('disabled');
	    }
	    if (memoriesFeatureToggle) {
	      memoriesFeatureToggle.disabled = true;
	    }
	    if (memoriesFeatureLabel) {
	      memoriesFeatureLabel.classList.add('disabled');
	    }
	    if (memoryAutoRecallToggle) {
	      memoryAutoRecallToggle.disabled = true;
	    }
	    if (memoryAutoRecallLabel) {
	      memoryAutoRecallLabel.classList.add('disabled');
	    }
	    [
	      memoryMaxRawMemoriesForGlobalInput,
	      memoryMaxRolloutAgeDaysInput,
	      memoryMaxRolloutsPerStartupInput,
	      memoryMinRolloutIdleHoursInput,
	      memoryMaxStateOutputsInput,
	      memoryMaxRecordsInput,
	      memoryMaxSearchResultsInput,
	      memoryMaxResultsPerKindInput,
	      memorySearchNeighborWindowInput,
	    ].forEach((memoryLimitInput) => {
	      if (memoryLimitInput) memoryLimitInput.disabled = true;
	    });
	    if (memoryAdvancedLimitsApply) {
	      memoryAdvancedLimitsApply.disabled = true;
	    }
	    if (memoryUpdateNowBtn) {
	      memoryUpdateNowBtn.disabled = true;
	    }
	    if (memoryDropBtn) {
	      memoryDropBtn.disabled = true;
	    }
	    [
	      memoryMaxRawMemoriesForGlobalLabel,
	      memoryMaxRolloutAgeDaysLabel,
	      memoryMaxRolloutsPerStartupLabel,
	      memoryMinRolloutIdleHoursLabel,
	      memoryMaxStateOutputsLabel,
	      memoryMaxRecordsLabel,
	      memoryMaxSearchResultsLabel,
	      memoryMaxResultsPerKindLabel,
	      memorySearchNeighborWindowLabel,
	    ].forEach((memoryLimitLabel) => {
	      if (memoryLimitLabel) memoryLimitLabel.classList.add('disabled');
	    });
	    if (autoCompactionToggle) {
	      autoCompactionToggle.disabled = true;
	    }
	    if (autoCompactionLabel) {
	      autoCompactionLabel.classList.add('disabled');
	    }
	    if (modelLimitsInput) {
	      modelLimitsInput.disabled = true;
	    }
	    if (modelLimitsApply) {
	      modelLimitsApply.disabled = true;
	    }
	    if (modelLimitsLabel) {
	      modelLimitsLabel.classList.add('disabled');
	    }
	    if (compactionToolOutputModeSelect) {
	      compactionToolOutputModeSelect.disabled = true;
	    }
	    if (compactionToolOutputModeLabel) {
	      compactionToolOutputModeLabel.classList.add('disabled');
	    }
	    if (planFirstToggle) {
	      planFirstToggle.disabled = true;
	    }
	    if (planFirstLabel) {
	      planFirstLabel.classList.add('disabled');
	    }
	    if (reasoningEffortSelect) {
	      reasoningEffortSelect.disabled = true;
	    }
	    if (modelFavoriteToggle) {
	      modelFavoriteToggle.disabled = true;
	      modelFavoriteToggle.textContent = '☆';
	    }
	    if (modelSettings) {
	      modelSettings.disabled = true;
	    }
	    if (customModelApply) {
	      customModelApply.disabled = true;
	    }
	    setGenerationInputsDisabled(true);
	    if (modelSettingsApply) {
	      modelSettingsApply.disabled = true;
	    }
	    if (modelSettingsOpenSettings) {
	      modelSettingsOpenSettings.disabled = true;
	    }
	    if (providerAuthGroup) {
	      providerAuthGroup.classList.add('hidden');
	    }

		    const toolIcons = {
		      'read': '📝',
		      'read_range': '📝',
		      'write': '±',
		      'edit': '±',
		      'glob': '📁',
		      'list': '📂',
		      'grep': '🔍',
		      'lsp': '🧭',
		      'symbols_search': '🧭',
		      'symbols_peek': '🧭',
		      'bash': '⚡',
		      'task': '🧩',
		      'skill': '📚',
		      'get_memory': '📘',
		      'todowrite': '☑',
		      'todoread': '☑',
		    };

	    const avatarColors = {
	      user: 'U',
	      assistant: 'A',
	      thought: 'T',
	      warning: '!',
	    };

	    function formatLoopIntervalText(intervalMinutes) {
	      const minutes = Number(intervalMinutes);
	      const normalized = Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) : 5;
	      if (normalized === 60) return 'every hour';
	      if (normalized % 60 === 0 && normalized > 60) return 'every ' + (normalized / 60) + ' hours';
	      if (normalized === 1) return 'every minute';
	      return 'every ' + normalized + ' minutes';
	    }

	    function normalizeLoopSettings(raw, fallback) {
	      const source = raw && typeof raw === 'object' ? raw : {};
	      const base = fallback && typeof fallback === 'object' ? fallback : {};
	      const parsedInterval = Number(source.intervalMinutes);
	      const fallbackInterval = Number(base.intervalMinutes);
	      const intervalMinutes = Number.isFinite(parsedInterval) && parsedInterval >= 1
	        ? Math.min(1440, Math.floor(parsedInterval))
	        : Number.isFinite(fallbackInterval) && fallbackInterval >= 1
	          ? Math.min(1440, Math.floor(fallbackInterval))
	          : 5;
	      const prompt = typeof source.prompt === 'string' && source.prompt.trim()
	        ? source.prompt.trim()
	        : typeof base.prompt === 'string' && base.prompt.trim()
	          ? base.prompt.trim()
	          : 'review your recent activity - has it been in alignment with our principles? ./AGENTS.md';
	      return {
	        enabled: typeof source.enabled === 'boolean' ? source.enabled : !!base.enabled,
	        intervalMinutes,
	        prompt,
	      };
	    }

	    function updateLoopSessionInputs() {
	      if (loopEnabledToggle) loopEnabledToggle.checked = !!currentLoop.enabled;
	      if (loopIntervalInput) loopIntervalInput.value = String(currentLoop.intervalMinutes || 5);
	      if (loopPromptInput) loopPromptInput.value = currentLoop.prompt || '';
	      if (loopStatusHint) loopStatusHint.textContent = currentLoop.statusText || 'Loop is off for this session.';
	      if (loopEnabledLabel) loopEnabledLabel.title = currentLoop.enabled
	        ? 'Loop steering is enabled for this session.'
	        : 'Loop steering is disabled for this session.';
	      if (loopIntervalLabel) loopIntervalLabel.title = 'Session loop interval: ' + formatLoopIntervalText(currentLoop.intervalMinutes) + '.';
	      if (loopPromptLabel) loopPromptLabel.title = currentLoop.prompt
	        ? 'Session loop prompt: ' + currentLoop.prompt
	        : 'Prompt injected on each loop tick.';
	    }

	    function updateLoopDefaultsState(defaults) {
	      loopDefaults = normalizeLoopSettings(defaults, loopDefaults);
	      if (loopDefaultEnabledToggle) loopDefaultEnabledToggle.checked = !!loopDefaults.enabled;
	      if (loopDefaultIntervalInput) loopDefaultIntervalInput.value = String(loopDefaults.intervalMinutes || 5);
	      if (loopDefaultPromptInput) loopDefaultPromptInput.value = loopDefaults.prompt || '';
	      if (loopDefaultEnabledLabel) loopDefaultEnabledLabel.title = loopDefaults.enabled
	        ? 'New sessions default to loop steering on.'
	        : 'New sessions default to loop steering off.';
	      if (loopDefaultIntervalLabel) loopDefaultIntervalLabel.title = 'Default loop interval: ' + formatLoopIntervalText(loopDefaults.intervalMinutes) + '.';
	      if (loopDefaultPromptLabel) loopDefaultPromptLabel.title = loopDefaults.prompt
	        ? 'Default loop prompt: ' + loopDefaults.prompt
	        : 'Default loop prompt.';
	    }

	    function setLoopState(loop) {
	      const next = loop && typeof loop === 'object' ? loop : {};
	      const parsedInterval = Number(next.intervalMinutes);
	      currentLoop = {
	        available: next.available !== false,
	        enabled: !!next.enabled,
	        canRunNow: !!next.canRunNow,
	        intervalMinutes: Number.isFinite(parsedInterval) && parsedInterval > 0 ? Math.min(1440, Math.floor(parsedInterval)) : 5,
	        prompt: typeof next.prompt === 'string' ? next.prompt : '',
	        reason: typeof next.reason === 'string' ? next.reason : 'disabled',
	        statusText:
	          typeof next.statusText === 'string' && next.statusText.trim()
	            ? next.statusText.trim()
	            : 'Loop is off for this session.',
	        lastFiredAt:
	          typeof next.lastFiredAt === 'number' && Number.isFinite(next.lastFiredAt)
	            ? next.lastFiredAt
	            : undefined,
	        nextFireAt:
	          typeof next.nextFireAt === 'number' && Number.isFinite(next.nextFireAt)
	            ? next.nextFireAt
	            : undefined,
	      };
	      updateLoopSessionInputs();
	      updateLoopControl();
	    }

	    function updateLoopControl() {
	      if (!loopControlBtn) return;
	      const available = currentLoop.available !== false;
	      const intervalText = formatLoopIntervalText(currentLoop.intervalMinutes);
	      const nextFireText =
	        typeof currentLoop.nextFireAt === 'number'
	          ? new Date(currentLoop.nextFireAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	          : '';

	      loopControlBtn.classList.toggle('active', available && currentLoop.enabled);
	      loopControlBtn.setAttribute(
	        'aria-pressed',
	        available && currentLoop.enabled ? 'true' : 'false'
	      );

	      if (!available) {
	        loopControlBtn.title = 'Loop steering is unavailable for subagent sessions';
	        loopControlBtn.setAttribute('aria-label', 'Loop steering unavailable');
	        return;
	      }

	      if (!currentLoop.enabled) {
	        loopControlBtn.title = 'Loop off. Click to configure. Current interval: ' + intervalText + '.';
	        loopControlBtn.setAttribute('aria-label', 'Loop steering off. Click to configure.');
	        return;
	      }

	      if (currentLoop.canRunNow) {
	        loopControlBtn.title = 'Loop on, ' + intervalText + (nextFireText ? (', next ' + nextFireText) : '') + '. Click to configure.';
	        loopControlBtn.setAttribute('aria-label', 'Loop steering on. ' + intervalText + '. Click to configure.');
	        return;
	      }

	      loopControlBtn.title = currentLoop.statusText + ' Current interval: ' + intervalText + '. Click to configure.';
	      loopControlBtn.setAttribute('aria-label', 'Loop steering on. ' + currentLoop.statusText);
	    }

	    function setLoopInputsDisabled(disabled) {
	      [
	        loopEnabledToggle,
	        loopIntervalInput,
	        loopPromptInput,
	        loopResetDefaults,
	        loopSettingsApply,
	        loopDefaultEnabledToggle,
	        loopDefaultIntervalInput,
	        loopDefaultPromptInput,
	        loopDefaultsApply,
	      ].forEach((el) => {
	        if (el) el.disabled = !!disabled;
	      });
	      [
	        loopEnabledLabel,
	        loopIntervalLabel,
	        loopPromptLabel,
	        loopDefaultEnabledLabel,
	        loopDefaultIntervalLabel,
	        loopDefaultPromptLabel,
	      ].forEach((el) => {
	        if (el) el.classList.toggle('disabled', !!disabled);
	      });
	    }

	    function closeLoopSettingsPopover() {
	      if (loopSettingsPopover) loopSettingsPopover.classList.add('hidden');
	    }

	    function openLoopSettingsPopover() {
	      if (!loopSettingsPopover || currentLoop.available === false) return;
	      clearInvalidFields([loopIntervalInput, loopPromptInput, loopDefaultIntervalInput, loopDefaultPromptInput]);
	      updateLoopSessionInputs();
	      updateLoopDefaultsState(loopDefaults);
	      loopSettingsPopover.classList.remove('hidden');
	    }

	    function toggleLoopSettingsPopover() {
	      if (!loopSettingsPopover) return;
	      if (loopSettingsPopover.classList.contains('hidden')) {
	        openLoopSettingsPopover();
	      } else {
	        closeLoopSettingsPopover();
	      }
	    }

	    function applyLoopSettings() {
	      if (!initReceived || isProcessing || currentLoop.available === false || hasPendingSettingState('loopState')) {
	        updateLoopSessionInputs();
	        updateLoopControl();
	        clearInvalidFields([loopIntervalInput, loopPromptInput]);
	        return;
	      }
	      const intervalMinutes = Number(loopIntervalInput ? loopIntervalInput.value : currentLoop.intervalMinutes);
	      const prompt = loopPromptInput ? String(loopPromptInput.value || '').trim() : currentLoop.prompt;
	      if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
	        markInvalidField(loopIntervalInput, 'Loop interval must be between 1 and 1440 minutes.');
	        return;
	      }
	      if (!prompt) {
	        markInvalidField(loopPromptInput, 'Loop prompt cannot be empty.');
	        return;
	      }
	      clearInvalidFields([loopIntervalInput, loopPromptInput]);
	      const settings = {
	        enabled: !!(loopEnabledToggle && loopEnabledToggle.checked),
	        intervalMinutes: Math.floor(intervalMinutes),
	        prompt,
	      };
	      postSettingWithPendingState(
	        'loopState',
	        { type: 'setLoopSettings', settings },
	        () => {
	          updateLoopSessionInputs();
	          updateLoopControl();
	        }
	      );
	    }

	    function resetLoopSettings() {
	      if (!initReceived || isProcessing || currentLoop.available === false || hasPendingSettingState('loopState')) {
	        updateLoopSessionInputs();
	        updateLoopControl();
	        return;
	      }
	      clearInvalidFields([loopIntervalInput, loopPromptInput]);
	      postSettingWithPendingState(
	        'loopState',
	        { type: 'resetLoopSettings' },
	        () => {
	          updateLoopSessionInputs();
	          updateLoopControl();
	        }
	      );
	    }

	    function applyLoopDefaults() {
	      if (!initReceived || isProcessing || hasPendingSettingState('loopDefaultsState')) {
	        updateLoopDefaultsState(loopDefaults);
	        clearInvalidFields([loopDefaultIntervalInput, loopDefaultPromptInput]);
	        return;
	      }
	      const intervalMinutes = Number(loopDefaultIntervalInput ? loopDefaultIntervalInput.value : loopDefaults.intervalMinutes);
	      const prompt = loopDefaultPromptInput ? String(loopDefaultPromptInput.value || '').trim() : loopDefaults.prompt;
	      if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
	        markInvalidField(loopDefaultIntervalInput, 'Default loop interval must be between 1 and 1440 minutes.');
	        return;
	      }
	      if (!prompt) {
	        markInvalidField(loopDefaultPromptInput, 'Default loop prompt cannot be empty.');
	        return;
	      }
	      clearInvalidFields([loopDefaultIntervalInput, loopDefaultPromptInput]);
	      const settings = {
	        enabled: !!(loopDefaultEnabledToggle && loopDefaultEnabledToggle.checked),
	        intervalMinutes: Math.floor(intervalMinutes),
	        prompt,
	      };
	      postSettingWithPendingState(
	        'loopDefaultsState',
	        { type: 'setLoopDefaults', settings },
	        () => updateLoopDefaultsState(loopDefaults)
	      );
	    }

	    function normalizeProviderId(value) {
	      const id = String(value || '').trim();
	      return ['copilot', 'codexSubscription', 'openaiCompatible'].indexOf(id) >= 0 ? id : 'copilot';
	    }

	    function updateProviderSelection(providerId) {
	      currentProviderId = normalizeProviderId(providerId);
	      if (providerSelect) {
	        providerSelect.value = currentProviderId;
	        providerSelect.title = currentProviderId === 'copilot'
	          ? 'Provider: GitHub Copilot'
	          : currentProviderId === 'codexSubscription'
	            ? 'Provider: Codex subscription'
	            : 'Provider: OpenAI-compatible';
	      }
	      updateOpenAICompatibleSettingsState(openAICompatibleSettings);
	    }

	    function normalizeOpenAICompatibleDisplayNames(raw) {
	      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	      const normalized = {};
	      Object.keys(source).forEach((rawKey) => {
	        const key = String(rawKey || '').trim().slice(0, 200);
	        const value = typeof source[rawKey] === 'string' ? source[rawKey].trim().slice(0, 200) : '';
	        if (!key || !value || Object.keys(normalized).length >= 100) return;
	        normalized[key] = value;
	      });
	      return normalized;
	    }

	    function parseOpenAICompatibleDisplayNames(raw) {
	      const normalized = {};
	      const lines = String(raw || '').split(/\n/);
	      for (let index = 0; index < lines.length; index += 1) {
	        const trimmed = lines[index].trim();
	        if (!trimmed || trimmed.startsWith('#')) continue;
	        const sepIndex = trimmed.indexOf('=') >= 0 ? trimmed.indexOf('=') : trimmed.indexOf(':');
	        if (sepIndex <= 0) {
	          return { names: normalized, error: 'Display name line ' + (index + 1) + ' must use model-id = Display name.' };
	        }
	        const key = trimmed.slice(0, sepIndex).trim();
	        const value = trimmed.slice(sepIndex + 1).trim();
	        if (!key || !value) {
	          return { names: normalized, error: 'Display name line ' + (index + 1) + ' needs both a model ID and a display name.' };
	        }
	        if (key.length > 200 || value.length > 200) {
	          return { names: normalized, error: 'Display name line ' + (index + 1) + ' must keep model IDs and names at 200 characters or fewer.' };
	        }
	        if (Object.keys(normalized).length >= 100 && !Object.prototype.hasOwnProperty.call(normalized, key)) {
	          return { names: normalized, error: 'Use 100 or fewer OpenAI-compatible display name aliases.' };
	        }
	        normalized[key] = value;
	      }
	      return { names: normalized, error: '' };
	    }

	    function serializeOpenAICompatibleDisplayNames(names) {
	      const normalized = normalizeOpenAICompatibleDisplayNames(names);
	      return Object.keys(normalized)
	        .sort((a, b) => a.localeCompare(b))
	        .map((key) => key + ' = ' + normalized[key])
	        .join('\n');
	    }

	    function normalizeOpenAICompatibleSettings(raw) {
	      const source = raw && typeof raw === 'object' ? raw : {};
	      const apiKeyEnv = typeof source.apiKeyEnv === 'string' && source.apiKeyEnv.trim()
	        ? source.apiKeyEnv.trim().slice(0, 120)
	        : 'OPENAI_API_KEY';
	      return {
	        baseURL: typeof source.baseURL === 'string' ? source.baseURL.trim().slice(0, 500) : '',
	        defaultModelId: typeof source.defaultModelId === 'string' ? source.defaultModelId.trim().slice(0, 200) : '',
	        apiKeyEnv,
	        modelDisplayNames: normalizeOpenAICompatibleDisplayNames(source.modelDisplayNames),
	      };
	    }

	    function normalizeCodexSubscriptionSettings(raw) {
	      const source = raw && typeof raw === 'object' ? raw : {};
	      const defaultModelId = typeof source.defaultModelId === 'string' && source.defaultModelId.trim()
	        ? source.defaultModelId.trim().slice(0, 200)
	        : 'gpt-5.3-codex';
	      return { defaultModelId };
	    }

	    function updateProviderSettingsSummary() {
	      const hasBaseURL = !!openAICompatibleSettings.baseURL;
	      const modelCount = Object.keys(openAICompatibleSettings.modelDisplayNames).length;
	      if (providerSettings) {
	        providerSettings.title = 'Provider settings: Codex default ' + codexSubscriptionSettings.defaultModelId
	          + ', OpenAI-compatible ' + (hasBaseURL ? 'base URL set' : 'base URL not set')
	          + (openAICompatibleSettings.defaultModelId ? ', OpenAI-compatible default ' + openAICompatibleSettings.defaultModelId : ', no OpenAI-compatible default')
	          + (modelCount ? ', ' + modelCount + ' display name(s)' : '');
	      }
	    }

	    function updateCodexSubscriptionSettingsState(settings) {
	      codexSubscriptionSettings = normalizeCodexSubscriptionSettings(settings);
	      if (codexDefaultModelInput) codexDefaultModelInput.value = codexSubscriptionSettings.defaultModelId;
	      if (codexDefaultModelLabel) {
	        codexDefaultModelLabel.title = 'Codex subscription fallback model: ' + codexSubscriptionSettings.defaultModelId;
	      }
	      updateProviderSettingsSummary();
	    }

	    function updateOpenAICompatibleSettingsState(settings) {
	      openAICompatibleSettings = normalizeOpenAICompatibleSettings(settings);
	      if (openAIBaseURLInput) openAIBaseURLInput.value = openAICompatibleSettings.baseURL;
	      if (openAIDefaultModelInput) openAIDefaultModelInput.value = openAICompatibleSettings.defaultModelId;
	      if (openAIApiKeyEnvInput) openAIApiKeyEnvInput.value = openAICompatibleSettings.apiKeyEnv;
	      if (openAIModelDisplayNamesInput) openAIModelDisplayNamesInput.value = serializeOpenAICompatibleDisplayNames(openAICompatibleSettings.modelDisplayNames);
	      const hasBaseURL = !!openAICompatibleSettings.baseURL;
	      const modelCount = Object.keys(openAICompatibleSettings.modelDisplayNames).length;
	      updateProviderSettingsSummary();
	      if (openAIBaseURLLabel) {
	        openAIBaseURLLabel.title = hasBaseURL ? 'OpenAI-compatible base URL is configured.' : 'OpenAI-compatible base URL is not configured.';
	      }
	      if (openAIDefaultModelLabel) {
	        openAIDefaultModelLabel.title = openAICompatibleSettings.defaultModelId
	          ? 'Fallback model: ' + openAICompatibleSettings.defaultModelId
	          : 'No fallback OpenAI-compatible model configured.';
	      }
	      if (openAIApiKeyEnvLabel) {
	        openAIApiKeyEnvLabel.title = 'API key environment variable: ' + openAICompatibleSettings.apiKeyEnv;
	      }
	      if (openAIModelDisplayNamesLabel) {
	        openAIModelDisplayNamesLabel.title = modelCount
	          ? modelCount + ' OpenAI-compatible model display name(s) configured.'
	          : 'No OpenAI-compatible model display names configured.';
	      }
	    }

	    function closeProviderSettingsPopover() {
	      if (providerSettingsPopover) providerSettingsPopover.classList.add('hidden');
	    }

	    function openProviderSettingsPopover() {
	      if (!providerSettingsPopover) return;
	      updateCodexSubscriptionSettingsState(codexSubscriptionSettings);
	      updateOpenAICompatibleSettingsState(openAICompatibleSettings);
	      clearInvalidFields([codexDefaultModelInput, openAIBaseURLInput, openAIApiKeyEnvInput, openAIModelDisplayNamesInput]);
	      providerSettingsPopover.classList.remove('hidden');
	    }

	    function toggleProviderSettingsPopover() {
	      if (!providerSettingsPopover) return;
	      if (providerSettingsPopover.classList.contains('hidden')) {
	        openProviderSettingsPopover();
	      } else {
	        closeProviderSettingsPopover();
	      }
	    }

	    function buildCodexSubscriptionSettingsFromInputs() {
	      return normalizeCodexSubscriptionSettings({
	        defaultModelId: codexDefaultModelInput ? codexDefaultModelInput.value : codexSubscriptionSettings.defaultModelId,
	      });
	    }

	    function buildOpenAICompatibleSettingsFromInputs() {
	      const displayNames = parseOpenAICompatibleDisplayNames(openAIModelDisplayNamesInput ? openAIModelDisplayNamesInput.value : '');
	      if (displayNames.error) {
	        markInvalidField(openAIModelDisplayNamesInput, displayNames.error);
	        return null;
	      }
	      const next = normalizeOpenAICompatibleSettings({
	        baseURL: openAIBaseURLInput ? openAIBaseURLInput.value : openAICompatibleSettings.baseURL,
	        defaultModelId: openAIDefaultModelInput ? openAIDefaultModelInput.value : openAICompatibleSettings.defaultModelId,
	        apiKeyEnv: openAIApiKeyEnvInput ? openAIApiKeyEnvInput.value : openAICompatibleSettings.apiKeyEnv,
	        modelDisplayNames: displayNames.names,
	      });
	      if (next.baseURL && !/^https?:\/\//i.test(next.baseURL)) {
	        markInvalidField(openAIBaseURLInput, 'Base URL must start with http:// or https://.');
	        return null;
	      }
	      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next.apiKeyEnv)) {
	        markInvalidField(openAIApiKeyEnvInput, 'API key environment variable must be a valid environment variable name.');
	        return null;
	      }
	      return next;
	    }

	    function applyProviderSettings() {
	      const fields = [codexDefaultModelInput, openAIBaseURLInput, openAIApiKeyEnvInput, openAIModelDisplayNamesInput];
	      const pending = hasPendingSettingState('codexSubscriptionSettingsState') || hasPendingSettingState('openAICompatibleSettingsState');
	      if (!initReceived || isProcessing || providerSwitchPending || pending) {
	        updateCodexSubscriptionSettingsState(codexSubscriptionSettings);
	        updateOpenAICompatibleSettingsState(openAICompatibleSettings);
	        clearInvalidFields(fields);
	        return;
	      }
	      const codexNext = buildCodexSubscriptionSettingsFromInputs();
	      const openAINext = buildOpenAICompatibleSettingsFromInputs();
	      if (!openAINext) return;
	      clearInvalidFields(fields);
	      postSettingsWithPendingStates(
	        ['codexSubscriptionSettingsState', 'openAICompatibleSettingsState'],
	        [
	          { type: 'setCodexSubscriptionSettings', settings: codexNext },
	          { type: 'setOpenAICompatibleSettings', settings: openAINext },
	        ],
	        () => {
	          updateCodexSubscriptionSettingsState(codexSubscriptionSettings);
	          updateOpenAICompatibleSettingsState(openAICompatibleSettings);
	        }
	      );
	    }

	    function normalizeTextVerbosity(value) {
	      const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	      return ['', 'low', 'medium', 'high'].indexOf(normalized) >= 0 ? normalized : '';
	    }

	    function updateGenerationSettingsState(settings) {
	      const next = settings && typeof settings === 'object' ? settings : {};
	      const temp = Number(next.temperature);
	      const topP = Number(next.topP);
	      const topK = Number(next.topK);
	      const max = Number(next.maxOutputTokens);
	      const retries = Number(next.maxRetries);
	      const timeoutMs = Number(next.timeoutMs);
	      generationTemperature = Number.isFinite(temp) ? Math.max(0, Math.min(2, temp)) : 0;
	      generationTopP = Number.isFinite(topP) ? Math.max(0, Math.min(1, topP)) : 0;
	      generationTopK = Number.isFinite(topK) && topK > 0 ? Math.floor(topK) : 0;
	      generationMaxOutputTokens = Number.isFinite(max) && max > 0 ? Math.floor(max) : 32000;
	      generationTextVerbosity = normalizeTextVerbosity(next.textVerbosity);
	      generationMaxRetries = Number.isFinite(retries) && retries >= 0 ? Math.floor(retries) : 2;
	      generationRetryWithPartialOutput = !!next.retryWithPartialOutput;
	      generationTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.floor(timeoutMs) : 0;
	      if (temperatureInput) {
	        temperatureInput.value = String(generationTemperature);
	      }
	      if (topPInput) {
	        topPInput.value = String(generationTopP);
	      }
	      if (topPLabel) {
	        topPLabel.title = generationTopP > 0
	          ? 'Top-p: ' + generationTopP
	          : 'Top-p uses the provider default.';
	      }
	      if (topKInput) {
	        topKInput.value = String(generationTopK);
	      }
	      if (topKLabel) {
	        topKLabel.title = generationTopK > 0
	          ? 'Top-k: ' + generationTopK
	          : 'Top-k uses the provider default.';
	      }
	      if (maxOutputTokensInput) {
	        maxOutputTokensInput.value = String(generationMaxOutputTokens);
	      }
	      if (textVerbositySelect) {
	        textVerbositySelect.value = generationTextVerbosity;
	      }
	      if (textVerbosityLabel) {
	        textVerbosityLabel.title = generationTextVerbosity
	          ? 'Text verbosity: ' + generationTextVerbosity
	          : 'Text verbosity uses the provider default.';
	      }
	      if (maxRetriesInput) {
	        maxRetriesInput.value = String(generationMaxRetries);
	      }
	      if (llmTimeoutInput) {
	        llmTimeoutInput.value = String(generationTimeoutMs);
	      }
	      if (retryWithPartialOutputToggle) {
	        retryWithPartialOutputToggle.checked = generationRetryWithPartialOutput;
	      }
	      if (retryWithPartialOutputLabel) {
	        retryWithPartialOutputLabel.title = generationRetryWithPartialOutput
	          ? 'Partial-output retry is on: transient streaming failures may discard partial output and retry.'
	          : 'Partial-output retry is off: transient streaming failures after partial output are shown for manual retry.';
	      }
	      if (modelSettings) {
	        modelSettings.title = 'Generation settings: temperature ' + generationTemperature + ', top-p ' + (generationTopP || 'default') + ', top-k ' + (generationTopK || 'default') + ', max output ' + generationMaxOutputTokens + ', verbosity ' + (generationTextVerbosity || 'default') + ', retries ' + generationMaxRetries + ', timeout ' + generationTimeoutMs + 'ms';
	      }
	    }

	    function closeModelSettingsPopover() {
	      if (modelSettingsPopover) modelSettingsPopover.classList.add('hidden');
	    }

	    function openModelSettingsPopover() {
	      if (!modelSettingsPopover) return;
	      clearInvalidFields([
	        temperatureInput,
	        topPInput,
	        topKInput,
	        maxOutputTokensInput,
	        maxRetriesInput,
	        llmTimeoutInput,
	      ]);
	      updateGenerationSettingsState({
	        temperature: generationTemperature,
	        topP: generationTopP,
	        topK: generationTopK,
	        maxOutputTokens: generationMaxOutputTokens,
	        textVerbosity: generationTextVerbosity,
	        maxRetries: generationMaxRetries,
	        retryWithPartialOutput: generationRetryWithPartialOutput,
	        timeoutMs: generationTimeoutMs,
	      });
	      modelSettingsPopover.classList.remove('hidden');
	    }

	    function toggleModelSettingsPopover() {
	      if (!modelSettingsPopover) return;
	      if (modelSettingsPopover.classList.contains('hidden')) {
	        openModelSettingsPopover();
	      } else {
	        closeModelSettingsPopover();
	      }
	    }

	    function applyGenerationSettings() {
	      const currentSettings = {
	        temperature: generationTemperature,
	        topP: generationTopP,
	        topK: generationTopK,
	        maxOutputTokens: generationMaxOutputTokens,
	        textVerbosity: generationTextVerbosity,
	        maxRetries: generationMaxRetries,
	        retryWithPartialOutput: generationRetryWithPartialOutput,
	        timeoutMs: generationTimeoutMs,
	      };
	      const generationFields = [
	        temperatureInput,
	        topPInput,
	        topKInput,
	        maxOutputTokensInput,
	        maxRetriesInput,
	        llmTimeoutInput,
	      ];
	      if (!initReceived || isProcessing || hasPendingSettingState('generationSettingsState')) {
	        updateGenerationSettingsState(currentSettings);
	        clearInvalidFields(generationFields);
	        return;
	      }
	      const temperature = Number(temperatureInput ? temperatureInput.value : generationTemperature);
	      const topP = Number(topPInput ? topPInput.value : generationTopP);
	      const topK = Number(topKInput ? topKInput.value : generationTopK);
	      const maxOutputTokens = Number(maxOutputTokensInput ? maxOutputTokensInput.value : generationMaxOutputTokens);
	      const maxRetries = Number(maxRetriesInput ? maxRetriesInput.value : generationMaxRetries);
	      const textVerbosity = normalizeTextVerbosity(textVerbositySelect ? textVerbositySelect.value : generationTextVerbosity);
	      const timeoutMs = Number(llmTimeoutInput ? llmTimeoutInput.value : generationTimeoutMs);
	      const retryWithPartialOutput = !!(retryWithPartialOutputToggle && retryWithPartialOutputToggle.checked);
	      if (!validateNumberField(temperatureInput, temperature, 0, 'Temperature must be between 0 and 2.', 2)) return;
	      if (!validateNumberField(topPInput, topP, 0, 'Top-p must be between 0 and 1. Use 0 for provider default.', 1)) return;
	      if (!validateNumberField(topKInput, topK, 0, 'Top-k must be 0 or greater. Use 0 for provider default.')) return;
	      if (!validateNumberField(maxOutputTokensInput, maxOutputTokens, Number.MIN_VALUE, 'Max output tokens must be greater than 0.')) return;
	      if (!validateNumberField(maxRetriesInput, maxRetries, 0, 'Max retries must be 0 or greater.')) return;
	      if (!validateNumberField(llmTimeoutInput, timeoutMs, 0, 'Timeout must be 0 or greater. Use 0 for no override.')) return;
	      clearInvalidFields(generationFields);
	      const settings = { temperature, topP, topK, maxOutputTokens, textVerbosity, maxRetries, retryWithPartialOutput, timeoutMs };
	      postSettingWithPendingState(
	        'generationSettingsState',
	        { type: 'setGenerationSettings', settings },
	        () => updateGenerationSettingsState(currentSettings)
	      );
	    }

	    function updateCustomModelInputState(modelId) {
	      const nextModel = typeof modelId === 'string' ? modelId : (currentModel || '');
	      if (customModelInput && document.activeElement !== customModelInput) {
	        customModelInput.value = nextModel;
	      }
	      if (customModelLabel) {
	        customModelLabel.title = nextModel
	          ? 'Current model ID: ' + nextModel
	          : 'Set an exact model ID.';
	      }
	    }

	    function modelMatchesSearch(model, query) {
	      if (!query) return true;
	      if (!model) return false;
	      const haystack = [
	        model.id,
	        model.name,
	        model.vendor,
	        model.family,
	      ].filter(Boolean).join(' ').toLowerCase();
	      return haystack.indexOf(query) >= 0;
	    }

	    function renderModelPickerSection(title, models, currentModelId, query, favoriteIds) {
	      if (!modelPickerList || !Array.isArray(models) || models.length === 0) return 0;
	      const filteredModels = models.filter((model) => modelMatchesSearch(model, query));
	      if (!filteredModels.length) return 0;
	      const favoriteSet = favoriteIds instanceof Set ? favoriteIds : new Set();
	      const sectionEl = document.createElement('div');
	      sectionEl.className = 'model-picker-section';
	      sectionEl.textContent = title;
	      modelPickerList.appendChild(sectionEl);
	      filteredModels.forEach((model) => {
	        if (!model || !model.id) return;
	        const modelId = String(model.id);
	        const isFavorite = favoriteSet.has(modelId);
	        const rowEl = document.createElement('div');
	        rowEl.className = 'model-picker-row' + (modelId === currentModelId ? ' current' : '');
	        const itemEl = document.createElement('button');
	        itemEl.className = 'model-picker-item';
	        itemEl.type = 'button';
	        const nameEl = document.createElement('span');
	        nameEl.className = 'model-picker-name';
	        nameEl.textContent = String(model.name || modelId);
	        const detailParts = [];
	        if (model.name && model.name !== modelId) detailParts.push(modelId);
	        if (model.vendor) detailParts.push(String(model.vendor));
	        if (model.family && model.family !== model.vendor) detailParts.push(String(model.family));
	        if (Number.isFinite(Number(model.maxInputTokens)) && Number(model.maxInputTokens) > 0) {
	          detailParts.push('maxIn=' + Math.floor(Number(model.maxInputTokens)));
	        }
	        if (modelId === currentModelId) detailParts.unshift('Current');
	        const detailEl = document.createElement('span');
	        detailEl.className = 'model-picker-detail';
	        detailEl.textContent = detailParts.join(' • ');
	        itemEl.appendChild(nameEl);
	        if (detailEl.textContent) itemEl.appendChild(detailEl);
	        itemEl.addEventListener('click', (e) => {
	          e.preventDefault();
	          if (!initReceived || isProcessing || modelSwitchPending || modelId === currentModel) return;
	          modelSwitchPending = true;
	          armPendingActionTimer('modelSwitch', () => recoverPendingAction('modelSwitch', 'Model switch is taking longer than expected. Controls were re-enabled.', () => { modelSwitchPending = false; }));
	          syncInputState();
	          try { vscode.postMessage({ type: 'changeModel', model: modelId }); } catch {
	            clearPendingActionTimer('modelSwitch');
	            modelSwitchPending = false;
	            showInputNotice('Failed to request model switch.');
	            syncInputState();
	          }
	        });
	        const favoriteEl = document.createElement('button');
	        favoriteEl.className = 'model-picker-favorite' + (isFavorite ? ' active' : '');
	        favoriteEl.type = 'button';
	        favoriteEl.textContent = isFavorite ? '★' : '☆';
	        favoriteEl.setAttribute('aria-label', (isFavorite ? 'Remove from favorites: ' : 'Add to favorites: ') + modelId);
	        favoriteEl.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
	        favoriteEl.addEventListener('click', (e) => {
	          e.preventDefault();
	          e.stopPropagation();
	          if (!initReceived || isProcessing || modelFavoritePending) return;
	          modelFavoritePending = true;
	          armPendingActionTimer('modelFavorite', () => recoverPendingAction('modelFavorite', 'Favorite update is taking longer than expected. Controls were re-enabled.', () => { modelFavoritePending = false; }));
	          syncInputState();
	          try { vscode.postMessage({ type: 'toggleFavoriteModel', model: modelId }); } catch {
	            clearPendingActionTimer('modelFavorite');
	            modelFavoritePending = false;
	            showInputNotice('Failed to update favorite model.');
	            syncInputState();
	          }
	        });
	        rowEl.appendChild(itemEl);
	        rowEl.appendChild(favoriteEl);
	        modelPickerList.appendChild(rowEl);
	      });
	      return filteredModels.length;
	    }

	    function updateModelPickerState(picker, options) {
	      currentModelPickerState = picker && typeof picker === 'object' ? picker : currentModelPickerState;
	      if (!modelPickerList) return;
	      const reveal = !!(options && options.reveal);
	      if (!currentModelPickerState) {
	        if (!reveal) modelPickerList.classList.add('hidden');
	        return;
	      }
	      modelPickerList.innerHTML = '';
	      const currentModelId = String(currentModelPickerState.currentModel || currentModel || '');
	      const favoriteIds = new Set((currentModelPickerState.favorites || [])
	        .map((model) => model && model.id ? String(model.id) : '')
	        .filter(Boolean));
	      const query = modelPickerSearchQuery.trim().toLowerCase();
	      const rendered =
	        renderModelPickerSection('Favorites', currentModelPickerState.favorites || [], currentModelId, query, favoriteIds) +
	        renderModelPickerSection('Recent', currentModelPickerState.recent || [], currentModelId, query, favoriteIds) +
	        renderModelPickerSection('All models', currentModelPickerState.all || [], currentModelId, query, favoriteIds);
	      if (!rendered) {
	        const emptyEl = document.createElement('div');
	        emptyEl.className = 'tools-catalog-empty';
	        emptyEl.textContent = query
	          ? 'No listed models match "' + modelPickerSearchQuery.trim() + '". Use custom model ID if needed.'
	          : 'No models available. Try Refresh models or enter a custom model ID.';
	        modelPickerList.appendChild(emptyEl);
	      }
	      if (reveal) {
	        openModelSettingsPopover();
	        modelPickerList.classList.remove('hidden');
	      }
	      modelPickerList.querySelectorAll('button').forEach((button) => {
	        button.disabled = !initReceived || isProcessing || modelSwitchPending || modelFavoritePending;
	      });
	    }

	    function applyCustomModelId() {
	      if (!initReceived || isProcessing || modelSwitchPending) {
	        updateCustomModelInputState(currentModel || '');
	        clearInvalidFields([customModelInput]);
	        return;
	      }
	      const model = customModelInput ? String(customModelInput.value || '').trim().slice(0, 200) : '';
	      if (!model) {
	        markInvalidField(customModelInput, 'Model ID is required.');
	        return;
	      }
	      clearInvalidFields([customModelInput]);
	      if (model === currentModel) {
	        updateCustomModelInputState(model);
	        return;
	      }
	      modelSwitchPending = true;
	      armPendingActionTimer('modelSwitch', () => recoverPendingAction('modelSwitch', 'Model switch is taking longer than expected. Controls were re-enabled.', () => { modelSwitchPending = false; }));
	      updateCustomModelInputState(currentModel || '');
	      syncInputState();
	      try { vscode.postMessage({ type: 'changeModel', model }); } catch {
	        clearPendingActionTimer('modelSwitch');
	        modelSwitchPending = false;
	        showInputNotice('Failed to request model switch.');
	        syncInputState();
	      }
	    }

	    function updatePlanFirstState(enabled) {
	      planFirstEnabled = !!enabled;
	      if (planFirstToggle) {
	        planFirstToggle.checked = planFirstEnabled;
	      }
	      if (planFirstLabel) {
	        planFirstLabel.title = planFirstEnabled
	          ? 'Plan-first is on: build-mode tasks generate a plan before the first change.'
	          : 'Plan-first is off: build-mode tasks may act immediately, subject to approvals.';
	      }
	    }

	    function updateSessionSettingsTitle() {
	      if (!sessionSettings) return;
	      const persistText = sessionsPersistEnabled ? 'persistence on' : 'persistence off';
	      sessionSettings.title = 'Session settings: ' + persistText + ', keeps ' + sessionsMaxSessions + ' saved sessions';
	    }

	    function updateSessionsPersistState(enabled) {
	      sessionsPersistEnabled = !!enabled;
	      if (sessionsPersistToggle) {
	        sessionsPersistToggle.checked = sessionsPersistEnabled;
	      }
	      if (sessionsPersistLabel) {
	        sessionsPersistLabel.title = sessionsPersistEnabled
	          ? 'Session persistence is on: sessions and input history are restored after VS Code restarts.'
	          : 'Session persistence is off: sessions and input history are kept only for this VS Code window.';
	      }
	      updateSessionSettingsTitle();
	    }

	    function updateSessionRetentionState(maxSessions, maxSessionBytes) {
	      const parsedMaxSessions = Number(maxSessions);
	      const parsedMaxSessionBytes = Number(maxSessionBytes);
	      sessionsMaxSessions = Number.isFinite(parsedMaxSessions) && parsedMaxSessions >= 1 ? Math.floor(parsedMaxSessions) : 20;
	      sessionsMaxSessionBytes = Number.isFinite(parsedMaxSessionBytes) && parsedMaxSessionBytes >= 1000 ? Math.floor(parsedMaxSessionBytes) : 2000000;
	      if (sessionsMaxSessionsInput) {
	        sessionsMaxSessionsInput.value = String(sessionsMaxSessions);
	      }
	      if (sessionsMaxSessionBytesInput) {
	        sessionsMaxSessionBytesInput.value = String(sessionsMaxSessionBytes);
	      }
	      updateSessionSettingsTitle();
	    }

	    function applySessionRetentionLimits() {
	      const currentLimits = { maxSessions: sessionsMaxSessions, maxSessionBytes: sessionsMaxSessionBytes };
	      const fields = [sessionsMaxSessionsInput, sessionsMaxSessionBytesInput];
	      if (!initReceived || isProcessing || hasPendingSettingState('sessionRetentionState')) {
	        updateSessionRetentionState(currentLimits.maxSessions, currentLimits.maxSessionBytes);
	        clearInvalidFields(fields);
	        return;
	      }
	      const maxSessions = Number(sessionsMaxSessionsInput ? sessionsMaxSessionsInput.value : sessionsMaxSessions);
	      const maxSessionBytes = Number(sessionsMaxSessionBytesInput ? sessionsMaxSessionBytesInput.value : sessionsMaxSessionBytes);
	      if (!Number.isFinite(maxSessions) || maxSessions < 1) {
	        markInvalidField(sessionsMaxSessionsInput, 'Saved sessions must be at least 1.');
	        updateSessionRetentionState(currentLimits.maxSessions, currentLimits.maxSessionBytes);
	        return;
	      }
	      if (!Number.isFinite(maxSessionBytes) || maxSessionBytes < 1000) {
	        markInvalidField(sessionsMaxSessionBytesInput, 'Max session size must be at least 1000 bytes.');
	        updateSessionRetentionState(currentLimits.maxSessions, currentLimits.maxSessionBytes);
	        return;
	      }
	      clearInvalidFields(fields);
	      const limits = { maxSessions, maxSessionBytes };
	      postSettingWithPendingState(
	        'sessionRetentionState',
	        { type: 'setSessionRetentionLimits', limits },
	        () => updateSessionRetentionState(currentLimits.maxSessions, currentLimits.maxSessionBytes)
	      );
	    }

	    function setSessionClearConfirmAction(action, options) {
	      const normalized = action === 'clearCurrentSession' || action === 'clearSavedSessions' ? action : '';
	      sessionClearConfirmAction = normalized;
	      if (sessionClearConfirm) sessionClearConfirm.classList.toggle('hidden', !normalized);
	      if (sessionClearCurrentBtn) sessionClearCurrentBtn.setAttribute('aria-expanded', normalized === 'clearCurrentSession' ? 'true' : 'false');
	      if (sessionClearSavedBtn) sessionClearSavedBtn.setAttribute('aria-expanded', normalized === 'clearSavedSessions' ? 'true' : 'false');
	      if (sessionClearConfirmText) {
	        sessionClearConfirmText.textContent = normalized === 'clearSavedSessions'
	          ? 'Delete all saved LingYun sessions, todos, and input history from workspace storage? This cannot be undone.'
	          : 'Clear messages and runtime state for the current session?';
	      }
	      if (sessionClearConfirmRunBtn) {
	        sessionClearConfirmRunBtn.textContent = normalized === 'clearSavedSessions' ? 'Clear saved' : 'Clear current';
	      }
	      if (!options || options.sync !== false) syncInputState();
	    }

	    function closeSessionSettingsPopover() {
	      if (sessionSettingsPopover) sessionSettingsPopover.classList.add('hidden');
	      setSessionClearConfirmAction('', { sync: false });
	    }

	    function openSessionSettingsPopover() {
	      if (!sessionSettingsPopover) return;
	      sessionSettingsPopover.classList.remove('hidden');
	    }

	    function toggleSessionSettingsPopover() {
	      if (!sessionSettingsPopover) return;
	      if (sessionSettingsPopover.classList.contains('hidden')) {
	        openSessionSettingsPopover();
	      } else {
	        closeSessionSettingsPopover();
	      }
	    }

	    function updateAutoApproveState(enabled) {
	      autoApproveEnabled = !!enabled;
	      if (!safetySelect) return;
	      safetySelect.value = autoApproveEnabled ? 'auto' : 'ask';
	      safetySelect.title = autoApproveEnabled
	        ? 'Safety: auto-approve tool calls in build mode (not recommended).'
	        : 'Safety: ask before tool calls that need approval.';
	    }

	    function updateAllowExternalPathsState(enabled) {
	      allowExternalPathsEnabled = !!enabled;
	      if (allowExternalPathsToggle) {
	        allowExternalPathsToggle.checked = allowExternalPathsEnabled;
	      }
	      if (allowExternalPathsLabel) {
	        allowExternalPathsLabel.title = allowExternalPathsEnabled
	          ? 'External path access is on: tools may access files outside the workspace.'
	          : 'External path access is off: tools stay inside the workspace.';
	      }
	      updateSafetySettingsTitle();
	    }

	    function updateBlockGitPushState(enabled) {
	      blockGitPushEnabled = !!enabled;
	      if (blockGitPushToggle) {
	        blockGitPushToggle.checked = blockGitPushEnabled;
	      }
	      if (blockGitPushLabel) {
	        blockGitPushLabel.title = blockGitPushEnabled
	          ? 'Git push protection is on: bash blocks git push commands.'
	          : 'Git push protection is off: bash may run git push commands.';
	      }
	      updateSafetySettingsTitle();
	    }

	    function normalizeDebugSettings(raw) {
	      const source = raw && typeof raw === 'object' ? raw : {};
	      const details = !!source.details;
	      const llm = !!source.llm;
	      const tools = !!source.tools;
	      const plugins = !!source.plugins;
	      return {
	        details,
	        llm,
	        tools,
	        plugins,
	        effectiveLlm: details || llm,
	        effectiveTools: details || tools,
	        effectivePlugins: details || plugins,
	      };
	    }

	    function updateDebugSettingsState(settings) {
	      debugSettings = normalizeDebugSettings(settings);
	      if (debugDetailsToggle) debugDetailsToggle.checked = debugSettings.details;
	      if (debugLlmToggle) debugLlmToggle.checked = debugSettings.effectiveLlm;
	      if (debugToolsToggle) debugToolsToggle.checked = debugSettings.effectiveTools;
	      if (debugPluginsToggle) debugPluginsToggle.checked = debugSettings.effectivePlugins;
	      if (debugDetailsLabel) {
	        debugDetailsLabel.title = debugSettings.details
	          ? 'Detailed diagnostics are on; LLM, tool, and plugin debug streams are effectively enabled.'
	          : 'Detailed diagnostics are off.';
	      }
	      if (debugLlmLabel) {
	        debugLlmLabel.title = debugSettings.details
	          ? 'LLM debug is on because detailed diagnostics are enabled.'
	          : (debugSettings.llm ? 'LLM debug logging is on.' : 'LLM debug logging is off.');
	      }
	      if (debugToolsLabel) {
	        debugToolsLabel.title = debugSettings.details
	          ? 'Tool debug is on because detailed diagnostics are enabled.'
	          : (debugSettings.tools ? 'Tool debug logging is on.' : 'Tool debug logging is off.');
	      }
	      if (debugPluginsLabel) {
	        debugPluginsLabel.title = debugSettings.details
	          ? 'Plugin debug is on because detailed diagnostics are enabled.'
	          : (debugSettings.plugins ? 'Plugin debug logging is on.' : 'Plugin debug logging is off.');
	      }
	      updateSafetySettingsTitle();
	    }

	    function applyDebugSettings(partial) {
	      if (!initReceived || isProcessing || debugSettingsPending) {
	        updateDebugSettingsState(debugSettings);
	        return;
	      }
	      const next = normalizeDebugSettings({ ...debugSettings, ...(partial || {}) });
	      updateDebugSettingsState(debugSettings);
	      debugSettingsPending = true;
	      syncInputState();
	      try {
	        vscode.postMessage({
	          type: 'setDebugSettings',
	          settings: {
	            details: next.details,
	            llm: next.llm,
	            tools: next.tools,
	            plugins: next.plugins,
	          },
	        });
      } catch {
        debugSettingsPending = false;
        showInputNotice('Failed to request debug settings update.');
        syncInputState();
      }

	    }

	    function normalizePluginSpecs(raw) {
	      const source = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[\n,]/) : []);
	      const seen = new Set();
	      const normalized = [];
	      source.forEach((value) => {
	        if (typeof value !== 'string') return;
	        const spec = value.trim();
	        if (!spec || seen.has(spec)) return;
	        seen.add(spec);
	        normalized.push(spec);
	      });
	      return normalized;
	    }

	    function normalizePluginSettings(raw) {
	      const source = raw && typeof raw === 'object' ? raw : {};
	      const workspaceDir = typeof source.workspaceDir === 'string' && source.workspaceDir.trim()
	        ? source.workspaceDir.trim()
	        : '.lingyun';
	      return {
	        plugins: normalizePluginSpecs(source.plugins),
	        autoDiscover: !!source.autoDiscover,
	        workspaceDir,
	      };
	    }

	    function updatePluginSettingsState(settings) {
	      pluginSettings = normalizePluginSettings(settings);
	      if (pluginsAutoDiscoverToggle) {
	        pluginsAutoDiscoverToggle.checked = pluginSettings.autoDiscover;
	      }
	      if (pluginsWorkspaceDirInput) {
	        pluginsWorkspaceDirInput.value = pluginSettings.workspaceDir;
	        pluginsWorkspaceDirInput.title = 'Workspace plugins are discovered under ' + pluginSettings.workspaceDir + '/plugin.';
	      }
	      if (pluginSpecsInput) {
	        pluginSpecsInput.value = pluginSettings.plugins.join('\n');
	        pluginSpecsInput.title = pluginSettings.plugins.length
	          ? pluginSettings.plugins.length + ' explicit plugin module(s) configured.'
	          : 'No explicit plugin modules configured.';
	      }
	      if (pluginsAutoDiscoverLabel) {
	        pluginsAutoDiscoverLabel.title = pluginSettings.autoDiscover
	          ? 'Workspace plugin auto-discovery is on.'
	          : 'Workspace plugin auto-discovery is off.';
	      }
	      if (pluginsWorkspaceDirLabel) {
	        pluginsWorkspaceDirLabel.title = 'Workspace plugin directory: ' + pluginSettings.workspaceDir;
	      }
	      if (pluginSpecsLabel) {
	        pluginSpecsLabel.title = pluginSettings.plugins.length
	          ? 'Plugin modules: ' + pluginSettings.plugins.join(', ')
	          : 'No explicit plugin modules configured.';
	      }
	      updateSafetySettingsTitle();
	    }

	    function applyPluginSettings() {
	      if (!initReceived || isProcessing || pluginSettingsPending) {
	        updatePluginSettingsState(pluginSettings);
	        return;
	      }
	      const next = {
	        plugins: normalizePluginSpecs(pluginSpecsInput ? pluginSpecsInput.value : pluginSettings.plugins),
	        autoDiscover: !!(pluginsAutoDiscoverToggle && pluginsAutoDiscoverToggle.checked),
	        workspaceDir: pluginsWorkspaceDirInput && pluginsWorkspaceDirInput.value.trim()
	          ? pluginsWorkspaceDirInput.value.trim()
	          : '.lingyun',
	      };
	      if (next.plugins.some((spec) => spec.length > 240)) {
	        markInvalidField(pluginSpecsInput, 'Plugin module specs must be 240 characters or shorter.');
	        updatePluginSettingsState(pluginSettings);
	        return;
	      }
	      if (next.workspaceDir.length > 120) {
	        markInvalidField(pluginsWorkspaceDirInput, 'Workspace plugin directory must be 120 characters or shorter.');
	        updatePluginSettingsState(pluginSettings);
	        return;
	      }
	      clearInvalidFields([pluginSpecsInput, pluginsWorkspaceDirInput]);
	      if (pluginsAutoDiscoverToggle) pluginsAutoDiscoverToggle.checked = pluginSettings.autoDiscover;
	      pluginSettingsPending = true;
	      syncInputState();
	      try { vscode.postMessage({ type: 'setPluginSettings', settings: next }); } catch {
	        pluginSettingsPending = false;
	        showInputNotice('Failed to request plugin settings update.');
	        syncInputState();
	      }
	    }

	    function normalizeToolFilter(raw) {
	      const source = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[\n,]/) : []);
	      const seen = new Set();
	      const normalized = [];
	      source.forEach((value) => {
	        if (typeof value !== 'string') return;
	        const pattern = value.trim();
	        if (!pattern || seen.has(pattern)) return;
	        seen.add(pattern);
	        normalized.push(pattern);
	      });
	      return normalized;
	    }

	    function updateToolFilterState(patterns) {
	      toolFilter = normalizeToolFilter(patterns);
	      if (toolFilterInput) {
	        toolFilterInput.value = toolFilter.join('\n');
	        toolFilterInput.title = toolFilter.length
	          ? 'Only tools matching ' + toolFilter.length + ' configured pattern(s) are available.'
	          : 'All tools are available.';
	      }
	      if (toolFilterLabel) {
	        toolFilterLabel.title = toolFilter.length
	          ? 'Tool filter is active: ' + toolFilter.join(', ')
	          : 'Tool filter is empty: all tools are available.';
	      }
	      updateSafetySettingsTitle();
	    }

	    function applyToolFilter() {
	      if (!initReceived || isProcessing || hasPendingSettingState('toolFilterState')) {
	        updateToolFilterState(toolFilter);
	        clearInvalidFields([toolFilterInput]);
	        return;
	      }
	      const patterns = normalizeToolFilter(toolFilterInput ? toolFilterInput.value : toolFilter);
	      if (patterns.some((pattern) => pattern.length > 120)) {
	        markInvalidField(toolFilterInput, 'Allowed tool patterns must be 120 characters or shorter.');
	        updateToolFilterState(toolFilter);
	        return;
	      }
	      clearInvalidFields([toolFilterInput]);
	      postSettingWithPendingState(
	        'toolFilterState',
	        { type: 'setToolFilter', patterns },
	        () => updateToolFilterState(toolFilter)
	      );
	    }

	    function normalizeAutoApprovedTools(raw) {
	      const source = Array.isArray(raw) ? raw : [];
	      const seen = new Set();
	      const normalized = [];
	      source.forEach((value) => {
	        if (typeof value !== 'string') return;
	        const toolId = value.trim();
	        if (!toolId || seen.has(toolId)) return;
	        seen.add(toolId);
	        normalized.push(toolId);
	      });
	      return normalized.sort((a, b) => a.localeCompare(b));
	    }

	    function setAutoApprovedToolsClearConfirmPending(pending, options) {
	      autoApprovedToolsClearConfirmPending = !!pending;
	      if (autoApprovedToolsClearConfirm) autoApprovedToolsClearConfirm.classList.toggle('hidden', !autoApprovedToolsClearConfirmPending);
	      if (autoApprovedToolsClear) autoApprovedToolsClear.setAttribute('aria-expanded', autoApprovedToolsClearConfirmPending ? 'true' : 'false');
	      if (!options || options.sync !== false) syncInputState();
	    }

	    function setAutoApprovedToolsControlsDisabled(disabled) {
	      const disabledFlag = !!disabled || autoApprovedToolsPending;
	      if (disabledFlag && autoApprovedToolsClearConfirmPending) {
	        setAutoApprovedToolsClearConfirmPending(false, { sync: false });
	      }
	      if (autoApprovedToolsClear) autoApprovedToolsClear.disabled = disabledFlag || autoApprovedTools.length === 0;
	      if (autoApprovedToolsClearCancel) autoApprovedToolsClearCancel.disabled = disabledFlag;
	      if (autoApprovedToolsClearConfirmRun) autoApprovedToolsClearConfirmRun.disabled = disabledFlag;
	      if (autoApprovedToolsList) {
	        autoApprovedToolsList.querySelectorAll('button[data-tool-id]').forEach((button) => {
	          button.disabled = disabledFlag;
	        });
	      }
	    }

	    function updateAutoApprovedToolsState(toolIds) {
	      autoApprovedToolsPending = false;
	      setAutoApprovedToolsClearConfirmPending(false, { sync: false });
	      autoApprovedTools = normalizeAutoApprovedTools(toolIds);
	      if (!autoApprovedToolsList) return;
	      autoApprovedToolsList.innerHTML = '';
	      if (!autoApprovedTools.length) {
	        const emptyEl = document.createElement('div');
	        emptyEl.className = 'auto-approved-tools-empty';
	        emptyEl.textContent = 'No tools are always allowed.';
	        autoApprovedToolsList.appendChild(emptyEl);
	        if (autoApprovedToolsClear) autoApprovedToolsClear.disabled = true;
	        updateSafetySettingsTitle();
	        return;
	      }
	      autoApprovedTools.forEach((toolId) => {
	        const itemEl = document.createElement('div');
	        itemEl.className = 'auto-approved-tool-item';
	        const idEl = document.createElement('span');
	        idEl.className = 'auto-approved-tool-id';
	        idEl.textContent = toolId;
	        const revokeEl = document.createElement('button');
	        revokeEl.className = 'context-btn';
	        revokeEl.type = 'button';
	        revokeEl.dataset.toolId = toolId;
	        revokeEl.textContent = 'Revoke';
	        revokeEl.addEventListener('click', (e) => {
	          e.preventDefault();
	          if (!initReceived || isProcessing || autoApprovedToolsPending) return;
	          autoApprovedToolsPending = true;
	          syncInputState();
          try { vscode.postMessage({ type: 'revokeAutoApprovedTool', toolId }); } catch {
            autoApprovedToolsPending = false;
            showInputNotice('Failed to revoke always-allowed tool.');
            syncInputState();
          }
	        });
	        itemEl.appendChild(idEl);
	        itemEl.appendChild(revokeEl);
	        autoApprovedToolsList.appendChild(itemEl);
	      });
	      setAutoApprovedToolsControlsDisabled(!initReceived || isProcessing);
	      updateSafetySettingsTitle();
	    }

	    function clearAutoApprovedTools() {
	      if (!initReceived || isProcessing || autoApprovedToolsPending || autoApprovedTools.length === 0) {
	        updateAutoApprovedToolsState(autoApprovedTools);
	        return;
	      }
	      autoApprovedToolsPending = true;
	      setAutoApprovedToolsClearConfirmPending(false, { sync: false });
	      syncInputState();
      try { vscode.postMessage({ type: 'clearAutoApprovedTools', confirmed: true }); } catch {
        autoApprovedToolsPending = false;
        showInputNotice('Failed to clear always-allowed tools.');
        syncInputState();
      }
	    }

	    function normalizeWorkspaceEnv(raw) {
	      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	      const normalized = {};
	      Object.keys(source).forEach((rawKey) => {
	        if (Object.keys(normalized).length >= 100) return;
	        const key = String(rawKey || '').trim().slice(0, 120);
	        const value = source[rawKey];
	        if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
	        if (typeof value !== 'string') return;
	        normalized[key] = value.slice(0, 10000);
	      });
	      return normalized;
	    }

	    function serializeWorkspaceEnv(env) {
	      const normalized = normalizeWorkspaceEnv(env);
	      return Object.keys(normalized)
	        .sort((a, b) => a.localeCompare(b))
	        .map((key) => key + '=' + normalized[key])
	        .join('\n');
	    }

	    function parseWorkspaceEnv(raw) {
	      const text = String(raw || '').trim();
	      const parsed = {};
	      if (!text) return parsed;
	      if (text.startsWith('{')) {
	        try { return normalizeWorkspaceEnv(JSON.parse(text)); } catch { return null; }
	      }
	      const lines = text.split(/\n/);
	      for (const line of lines) {
	        if (Object.keys(parsed).length >= 100) return null;
	        const trimmed = line.trim();
	        if (!trimmed || trimmed.startsWith('#')) continue;
	        const equalsIndex = trimmed.indexOf('=');
	        if (equalsIndex <= 0) return null;
	        const key = trimmed.slice(0, equalsIndex).trim();
	        const value = trimmed.slice(equalsIndex + 1);
	        if (!key || key.length > 120 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
	        if (value.length > 10000) return null;
	        parsed[key] = value;
	      }
	      return parsed;
	    }

	    function updateWorkspaceEnvState(env) {
	      workspaceEnv = normalizeWorkspaceEnv(env);
	      const count = Object.keys(workspaceEnv).length;
	      if (workspaceEnvInput) {
	        workspaceEnvInput.value = serializeWorkspaceEnv(workspaceEnv);
	        workspaceEnvInput.title = count
	          ? count + ' workspace tool environment variable(s) configured.'
	          : 'No workspace tool environment variables configured.';
	      }
	      if (workspaceEnvLabel) {
	        workspaceEnvLabel.title = count
	          ? count + ' workspace tool environment variable(s) are available to workspace tools.'
	          : 'No workspace tool environment variables configured.';
	      }
	      updateSafetySettingsTitle();
	    }

	    function applyWorkspaceEnv() {
	      if (!initReceived || isProcessing || hasPendingSettingState('workspaceEnvState')) {
	        updateWorkspaceEnvState(workspaceEnv);
	        clearInvalidFields([workspaceEnvInput]);
	        return;
	      }
	      const parsed = parseWorkspaceEnv(workspaceEnvInput ? workspaceEnvInput.value : '');
	      if (!parsed) {
	        markInvalidField(workspaceEnvInput, 'Use JSON object syntax or one valid NAME=value entry per line. Names must be valid environment variable names.');
	        updateWorkspaceEnvState(workspaceEnv);
	        return;
	      }
	      clearInvalidFields([workspaceEnvInput]);
	      postSettingWithPendingState(
	        'workspaceEnvState',
	        { type: 'setWorkspaceEnv', env: parsed },
	        () => updateWorkspaceEnvState(workspaceEnv)
	      );
	    }

	    function buildDefaultToolArgs(tool) {
	      const properties = tool && tool.parameters && tool.parameters.properties && typeof tool.parameters.properties === 'object'
	        ? tool.parameters.properties
	        : {};
	      const required = tool && Array.isArray(tool.required) ? tool.required : [];
	      const args = {};
	      Object.keys(properties).forEach((name) => {
	        if (required.indexOf(name) < 0) return;
	        const schema = properties[name] && typeof properties[name] === 'object' ? properties[name] : {};
	        if (schema.type === 'number' || schema.type === 'integer') {
	          args[name] = 0;
	        } else if (schema.type === 'boolean') {
	          args[name] = false;
	        } else if (schema.type === 'array') {
	          args[name] = [];
	        } else if (schema.type === 'object') {
	          args[name] = {};
	        } else {
	          args[name] = '';
	        }
	      });
	      return args;
	    }

	    function setToolsCatalogControlsDisabled(disabled) {
	      const disabledFlag = !!disabled;
	      if (toolsCatalogSearchInput) toolsCatalogSearchInput.disabled = disabledFlag;
	      if (toolsCatalogSearchLabel) toolsCatalogSearchLabel.classList.toggle('disabled', disabledFlag);
	      if (!toolsCatalog) return;
	      toolsCatalog.querySelectorAll('.tools-catalog-runner textarea, .tools-catalog-runner button').forEach((el) => {
	        el.disabled = disabledFlag;
	      });
	      const confirmationDisabled = !!disabled && !pendingManualToolConfirmation;
		      toolsCatalog.querySelectorAll('.tools-catalog-confirmation button').forEach((el) => {
		        el.disabled = confirmationDisabled || manualToolRunBusy || isProcessing || !initReceived;
		      });
		    }

		    function toolMatchesCatalogSearch(tool, query) {
		      if (!query) return true;
		      if (!tool) return false;
		      const params = tool.parameters && tool.parameters.properties && typeof tool.parameters.properties === 'object'
		        ? Object.keys(tool.parameters.properties).join(' ')
		        : '';
		      const haystack = [
		        tool.id,
		        tool.name,
		        tool.description,
		        tool.category,
		        tool.readOnly ? 'read-only' : 'writes',
		        tool.requiresApproval ? 'approval' : '',
		        params,
		      ].filter(Boolean).join(' ').toLowerCase();
		      return haystack.indexOf(query) >= 0;
		    }


	    function showManualToolResult(data) {
	      latestManualToolResult = data && typeof data === 'object' ? data : null;
	      if (!toolsCatalog || toolsCatalog.classList.contains('hidden') || !latestManualToolResult) return;
	      const resultEl = document.createElement('div');
	      resultEl.className = 'tools-catalog-result' + (latestManualToolResult.success ? '' : ' error');
	      const toolId = latestManualToolResult.toolId ? String(latestManualToolResult.toolId) : 'tool';
	      const status = latestManualToolResult.success ? 'succeeded' : 'failed';
	      const details = latestManualToolResult.error
	        ? ' — ' + String(latestManualToolResult.error)
	        : (latestManualToolResult.truncated ? ' — output truncated' : '');
	      const summaryEl = document.createElement('div');
	      summaryEl.textContent = 'Tool ' + toolId + ' ' + status + details;
	      resultEl.appendChild(summaryEl);
	      if (latestManualToolResult.data) {
	        const outputEl = document.createElement('details');
	        outputEl.className = 'tools-catalog-result-output';
	        const outputSummaryEl = document.createElement('summary');
	        outputSummaryEl.textContent = 'Show output';
	        const preEl = document.createElement('pre');
	        preEl.textContent = String(latestManualToolResult.data);
	        outputEl.appendChild(outputSummaryEl);
	        outputEl.appendChild(preEl);
	        resultEl.appendChild(outputEl);
	      }
	      toolsCatalog.insertBefore(resultEl, toolsCatalog.firstChild);
	    }

	    function renderManualToolConfirmation() {
	      if (!toolsCatalog || !pendingManualToolConfirmation) return;
	      const confirmationEl = document.createElement('div');
	      confirmationEl.className = 'tools-catalog-confirmation';
	      const toolId = pendingManualToolConfirmation.toolId || 'tool';
	      const toolName = pendingManualToolConfirmation.toolName || toolId;
	      const reasons = Array.isArray(pendingManualToolConfirmation.reasons)
	        ? pendingManualToolConfirmation.reasons.filter(Boolean).join(' and ')
	        : '';
	      const textEl = document.createElement('div');
	      textEl.textContent = 'Run guarded tool "' + toolName + '"?'
	        + (reasons ? ' This tool is guarded because ' + reasons + '.' : '');
	      const actionsEl = document.createElement('div');
	      actionsEl.className = 'tools-catalog-confirmation-actions';
	      const cancelEl = document.createElement('button');
	      cancelEl.className = 'context-btn';
	      cancelEl.type = 'button';
	      cancelEl.textContent = 'Cancel';
	      cancelEl.addEventListener('click', (e) => {
	        e.preventDefault();
	        pendingManualToolConfirmation = null;
	        updateToolsCatalogState(currentToolsCatalog);
	        syncInputState();
	      });
	      const runEl = document.createElement('button');
	      runEl.className = 'context-btn';
	      runEl.type = 'button';
	      runEl.textContent = 'Run guarded tool';
	      runEl.addEventListener('click', (e) => {
	        e.preventDefault();
	        if (!initReceived || isProcessing || manualToolRunBusy || !pendingManualToolConfirmation) return;
	        const pending = pendingManualToolConfirmation;
	        manualToolRunBusy = true;
	        latestManualToolResult = null;
	        armPendingActionTimer('manualToolRun', () => recoverPendingAction('manualToolRun', 'Guarded tool run is taking longer than expected. Controls were re-enabled.', () => { manualToolRunBusy = false; pendingManualToolConfirmation = pending; updateToolsCatalogState(currentToolsCatalog); }));
	        updateToolsCatalogState(currentToolsCatalog);
        try { vscode.postMessage({ type: 'runTool', toolId: pending.toolId, args: pending.args || {}, confirmed: true }); } catch {
          clearPendingActionTimer('manualToolRun');
          manualToolRunBusy = false;
          pendingManualToolConfirmation = pending;
          showInputNotice('Failed to request guarded tool run.');
          updateToolsCatalogState(currentToolsCatalog);
        }
        syncInputState();
	      });
	      actionsEl.appendChild(cancelEl);
	      actionsEl.appendChild(runEl);
	      confirmationEl.appendChild(textEl);
	      confirmationEl.appendChild(actionsEl);
	      toolsCatalog.insertBefore(confirmationEl, toolsCatalog.firstChild);
	    }

	    function handleManualToolConfirmationRequired(data) {
	      clearPendingActionTimer('manualToolRun');
	      manualToolRunBusy = false;
	      const toolId = data && data.toolId ? String(data.toolId) : '';
	      if (!toolId) {
	        pendingManualToolConfirmation = null;
	        syncInputState();
	        return;
	      }
	      const previous = pendingManualToolConfirmation && pendingManualToolConfirmation.toolId === toolId
	        ? pendingManualToolConfirmation
	        : null;
	      pendingManualToolConfirmation = {
	        toolId,
	        args: previous ? previous.args : {},
	        toolName: data && data.toolName ? String(data.toolName) : toolId,
	        reasons: data && Array.isArray(data.reasons) ? data.reasons.filter(Boolean) : [],
	      };
	      updateToolsCatalogState(currentToolsCatalog);
	      syncInputState();
	    }

	    function handleManualToolResult(data) {
	      clearPendingActionTimer('manualToolRun');
	      manualToolRunBusy = false;
	      pendingManualToolConfirmation = null;
	      showManualToolResult(data);
	      updateToolsCatalogState(currentToolsCatalog);
	      syncInputState();
	    }

	    function updateToolsCatalogState(catalog, options) {
	      const reveal = !!(options && options.reveal);
	      clearPendingActionTimer('toolsCatalog');
	      toolsCatalogRequestPending = false;
	      currentToolsCatalog = catalog && typeof catalog === 'object' ? catalog : null;
	      if (!toolsCatalog) return;
	      toolsCatalog.innerHTML = '';
	      if (!currentToolsCatalog) {
	        toolsCatalog.classList.add('hidden');
	        if (toolsCatalogSearchLabel) toolsCatalogSearchLabel.classList.add('hidden');
	        return;
	      }
	      const tools = Array.isArray(currentToolsCatalog.tools) ? currentToolsCatalog.tools : [];
	      const total = Number.isFinite(Number(currentToolsCatalog.total)) ? Number(currentToolsCatalog.total) : tools.length;
	      const shown = Number.isFinite(Number(currentToolsCatalog.shown)) ? Number(currentToolsCatalog.shown) : tools.length;
	      const localQuery = toolsCatalogSearchQuery.trim().toLowerCase();
	      const visibleTools = tools.filter((tool) => toolMatchesCatalogSearch(tool, localQuery));
	      toolsCatalog.classList.remove('hidden');
	      if (toolsCatalogSearchLabel) toolsCatalogSearchLabel.classList.remove('hidden');
	      if (toolsCatalogSearchInput && document.activeElement !== toolsCatalogSearchInput) {
	        toolsCatalogSearchInput.value = toolsCatalogSearchQuery;
	      }
	      if (reveal) openSafetySettingsPopover();
	      const summary = document.createElement('div');
	      summary.className = 'tools-catalog-summary';
	      const filter = Array.isArray(currentToolsCatalog.filter) ? currentToolsCatalog.filter : [];
	      const baseSummary = filter.length
	        ? 'Showing ' + shown + ' of ' + total + ' tools matching ' + filter.join(', ')
	        : 'Showing all ' + total + ' registered tools';
	      summary.textContent = localQuery
	        ? baseSummary + '; ' + visibleTools.length + ' match "' + toolsCatalogSearchQuery.trim() + '".'
	        : baseSummary + '.';
	      toolsCatalog.appendChild(summary);
	      if (latestManualToolResult) showManualToolResult(latestManualToolResult);
	      if (pendingManualToolConfirmation) renderManualToolConfirmation();
	      if (!tools.length) {
	        const emptyEl = document.createElement('div');
	        emptyEl.className = 'tools-catalog-empty';
	        emptyEl.textContent = filter.length ? 'No registered tools match the current Allowed tools filter.' : 'No tools are registered.';
	        toolsCatalog.appendChild(emptyEl);
	        return;
	      }
	      if (!visibleTools.length) {
	        const emptyEl = document.createElement('div');
	        emptyEl.className = 'tools-catalog-empty';
	        emptyEl.textContent = 'No visible tools match "' + toolsCatalogSearchQuery.trim() + '".';
	        toolsCatalog.appendChild(emptyEl);
	        setToolsCatalogControlsDisabled(!initReceived || isProcessing || manualToolRunBusy || !!pendingManualToolConfirmation);
	        return;
	      }
	      visibleTools.slice(0, 100).forEach((tool) => {
	        const itemEl = document.createElement('div');
	        itemEl.className = 'tools-catalog-item';
	        const headEl = document.createElement('div');
	        headEl.className = 'tools-catalog-head';
	        const idEl = document.createElement('div');
	        idEl.className = 'tools-catalog-id';
	        idEl.textContent = tool && tool.id ? String(tool.id) : 'tool';
	        const badgesEl = document.createElement('div');
	        badgesEl.className = 'tools-catalog-badges';
	        const addBadge = (text) => {
	          const badgeEl = document.createElement('span');
	          badgeEl.className = 'tools-catalog-badge';
	          badgeEl.textContent = text;
	          badgesEl.appendChild(badgeEl);
	        };
	        addBadge(tool && tool.readOnly ? 'read-only' : 'writes');
	        if (tool && tool.requiresApproval) addBadge('approval');
	        if (tool && tool.category) addBadge(String(tool.category));
	        headEl.appendChild(idEl);
	        headEl.appendChild(badgesEl);
	        itemEl.appendChild(headEl);
	        const descEl = document.createElement('div');
	        descEl.className = 'tools-catalog-desc';
	        descEl.textContent = tool && (tool.description || tool.name) ? String(tool.description || tool.name) : 'No description.';
	        itemEl.appendChild(descEl);
	        const required = tool && Array.isArray(tool.required) ? tool.required : [];
	        const params = tool && tool.parameters && tool.parameters.properties && typeof tool.parameters.properties === 'object'
	          ? Object.keys(tool.parameters.properties)
	          : [];
	        const paramsEl = document.createElement('div');
	        paramsEl.className = 'tools-catalog-params';
	        paramsEl.textContent = params.length
	          ? 'Params: ' + params.map((name) => required.indexOf(name) >= 0 ? name + '*' : name).join(', ')
	          : 'Params: none';
	        itemEl.appendChild(paramsEl);

	        const runnerEl = document.createElement('div');
	        runnerEl.className = 'tools-catalog-runner';
	        const argsEl = document.createElement('textarea');
	        argsEl.className = 'tools-catalog-args';
	        argsEl.rows = 3;
	        argsEl.spellcheck = false;
	        argsEl.value = JSON.stringify(buildDefaultToolArgs(tool), null, 2);
	        argsEl.setAttribute('aria-label', 'Arguments for ' + (tool && tool.id ? String(tool.id) : 'tool'));
	        const rowEl = document.createElement('div');
	        rowEl.className = 'tools-catalog-run-row';
	        const statusEl = document.createElement('span');
	        statusEl.className = 'tools-catalog-status';
	        argsEl.addEventListener('input', () => {
	          clearInvalidFields([argsEl]);
	          if (statusEl.textContent && statusEl.textContent !== 'Requesting…') statusEl.textContent = '';
	        });
	        const runEl = document.createElement('button');
	        runEl.className = 'context-btn';
	        runEl.type = 'button';
	        runEl.textContent = 'Run';
	        runEl.disabled = !initReceived || isProcessing || manualToolRunBusy;
	        runEl.addEventListener('click', (e) => {
	          e.preventDefault();
	          if (!initReceived || isProcessing || manualToolRunBusy) return;
	          pendingManualToolConfirmation = null;
	          let args = {};
	          try {
	            const parsed = argsEl.value.trim() ? JSON.parse(argsEl.value) : {};
	            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
	              throw new Error('Arguments must be a JSON object.');
	            }
	            args = parsed;
	          } catch (error) {
	            const message = error && error.message ? error.message : 'Invalid JSON arguments.';
	            statusEl.textContent = message;
	            markInvalidField(argsEl, message);
	            return;
	          }
	          clearInvalidFields([argsEl]);
	          const nextToolId = tool && tool.id ? String(tool.id) : '';
	          if (!nextToolId) return;
	          manualToolRunBusy = true;
	          pendingManualToolConfirmation = { toolId: nextToolId, args };
	          latestManualToolResult = null;
	          statusEl.textContent = 'Requesting…';
	          armPendingActionTimer('manualToolRun', () => {
	            manualToolRunBusy = false;
	            pendingManualToolConfirmation = null;
	            statusEl.textContent = 'Tool run is taking longer than expected.';
	            showInputNotice('Tool run is taking longer than expected. Controls were re-enabled.');
	            syncInputState();
	          });
	          syncInputState();
	          try { vscode.postMessage({ type: 'runTool', toolId: nextToolId, args }); } catch {
	            clearPendingActionTimer('manualToolRun');
	            manualToolRunBusy = false;
	            pendingManualToolConfirmation = null;
	            statusEl.textContent = 'Failed to request tool run.';
	            syncInputState();
	          }
	        });
	        rowEl.appendChild(statusEl);
	        rowEl.appendChild(runEl);
	        runnerEl.appendChild(argsEl);
	        runnerEl.appendChild(rowEl);
	        itemEl.appendChild(runnerEl);
	        toolsCatalog.appendChild(itemEl);
	      });
	      if (visibleTools.length > 100) {
	        const moreEl = document.createElement('div');
	        moreEl.className = 'tools-catalog-empty';
	        moreEl.textContent = localQuery
	          ? 'Showing first 100 matching tools; refine Find tool to inspect more.'
	          : 'Showing first 100 tools; narrow Find tool or the Allowed tools filter to inspect more.';
	        toolsCatalog.appendChild(moreEl);
	      }
	      setToolsCatalogControlsDisabled(!initReceived || isProcessing || manualToolRunBusy || !!pendingManualToolConfirmation);
	    }

	    function updateSafetySettingsTitle() {
	      if (!safetySettings) return;
	      const externalText = allowExternalPathsEnabled ? 'external paths allowed' : 'external paths blocked';
	      const pushText = blockGitPushEnabled ? 'git push blocked' : 'git push allowed';
	      const pluginText = pluginSettings.autoDiscover
	        ? 'plugins auto-discovered'
	        : (pluginSettings.plugins.length ? pluginSettings.plugins.length + ' plugin module(s)' : 'plugins off');
	      const filterText = toolFilter.length ? toolFilter.length + ' tool filter pattern(s)' : 'all tools allowed';
	      const envCount = Object.keys(workspaceEnv || {}).length;
	      const envText = envCount ? envCount + ' env var(s)' : 'no tool env';
	      const debugCount = [debugSettings.effectiveLlm, debugSettings.effectiveTools, debugSettings.effectivePlugins].filter(Boolean).length;
	      const debugText = debugSettings.details
	        ? 'detailed logs'
	        : (debugCount ? debugCount + ' debug stream(s)' : 'diagnostics off');
	      safetySettings.title = 'Advanced safety: ' + externalText + ', ' + pushText + ', ' + debugText + ', ' + pluginText + ', ' + filterText + ', ' + envText + ', tool timeout ' + toolRuntimeLimits.toolTimeoutMs + 'ms';
	    }

	    function normalizeInstructionPatterns(raw) {
	      const source = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[\n,]/) : []);
	      const seen = new Set();
	      const normalized = [];
	      source.forEach((value) => {
	        if (typeof value !== 'string') return;
	        const pattern = value.trim();
	        if (!pattern || seen.has(pattern)) return;
	        seen.add(pattern);
	        normalized.push(pattern);
	      });
	      return normalized;
	    }

	    function updateInstructionPatternsState(patterns) {
	      instructionPatterns = normalizeInstructionPatterns(patterns);
	      if (instructionPatternsInput) {
	        instructionPatternsInput.value = instructionPatterns.join('\n');
	        instructionPatternsInput.title = instructionPatterns.length
	          ? instructionPatterns.length + ' custom instruction pattern(s) are included in the system prompt.'
	          : 'No custom instruction patterns are configured; default instruction discovery still applies.';
	      }
	      updateInstructionFileTitles();
	    }

	    function normalizeInstructionFileSettings(raw) {
	      const source = raw && typeof raw === 'object' ? raw : {};
	      const normalize = (value, fallback) => {
	        const parsed = Number(value);
	        return Number.isFinite(parsed) && parsed >= 1000 ? Math.floor(parsed) : fallback;
	      };
	      return {
	        includeGlobal: source.includeGlobal !== false,
	        maxCharsPerFile: normalize(source.maxCharsPerFile, 60000),
	        maxTotalChars: normalize(source.maxTotalChars, 180000),
	      };
	    }

	    function updateInstructionFileTitles() {
	      const patternText = instructionPatterns.length
	        ? instructionPatterns.length + ' custom pattern(s)'
	        : 'default discovery only';
	      const globalText = instructionFileSettings.includeGlobal ? 'global enabled' : 'global disabled';
	      const limitText = instructionFileSettings.maxCharsPerFile + ' chars/file, ' + instructionFileSettings.maxTotalChars + ' chars total';
	      if (instructionPatternsLabel) {
	        instructionPatternsLabel.title = instructionPatterns.length
	          ? 'Custom instruction patterns: ' + instructionPatterns.join(', ')
	          : 'No custom instruction patterns; default AGENTS.md/CONTEXT.md discovery still applies.';
	      }
	      if (instructionIncludeGlobalLabel) {
	        instructionIncludeGlobalLabel.title = instructionFileSettings.includeGlobal
	          ? 'Global instruction file is included when present.'
	          : 'Global instruction file is not included.';
	      }
	      if (instructionMaxCharsPerFileLabel) {
	        instructionMaxCharsPerFileLabel.title = 'Each instruction file is capped at ' + instructionFileSettings.maxCharsPerFile + ' characters.';
	      }
	      if (instructionMaxTotalCharsLabel) {
	        instructionMaxTotalCharsLabel.title = 'All instruction files are capped at ' + instructionFileSettings.maxTotalChars + ' total characters.';
	      }
	      if (instructionPatternsApply) {
	        instructionPatternsApply.title = 'Apply instruction files: ' + patternText + ', ' + globalText + ', ' + limitText + '.';
	      }
	    }

	    function updateInstructionFileSettingsState(settings) {
	      instructionFileSettings = normalizeInstructionFileSettings(settings);
	      if (instructionIncludeGlobalToggle) instructionIncludeGlobalToggle.checked = instructionFileSettings.includeGlobal;
	      if (instructionMaxCharsPerFileInput) instructionMaxCharsPerFileInput.value = String(instructionFileSettings.maxCharsPerFile);
	      if (instructionMaxTotalCharsInput) instructionMaxTotalCharsInput.value = String(instructionFileSettings.maxTotalChars);
	      updateInstructionFileTitles();
	    }

	    function applyInstructionSettings() {
	      const fields = [instructionPatternsInput, instructionMaxCharsPerFileInput, instructionMaxTotalCharsInput];
	      const pending = hasPendingSettingState('instructionPatternsState') || hasPendingSettingState('instructionFileSettingsState');
	      if (!initReceived || isProcessing || pending) {
	        updateInstructionPatternsState(instructionPatterns);
	        updateInstructionFileSettingsState(instructionFileSettings);
	        clearInvalidFields(fields);
	        return;
	      }
	      const patterns = normalizeInstructionPatterns(instructionPatternsInput ? instructionPatternsInput.value : instructionPatterns);
	      const settings = {
	        includeGlobal: instructionIncludeGlobalToggle ? !!instructionIncludeGlobalToggle.checked : instructionFileSettings.includeGlobal,
	        maxCharsPerFile: Number(instructionMaxCharsPerFileInput ? instructionMaxCharsPerFileInput.value : instructionFileSettings.maxCharsPerFile),
	        maxTotalChars: Number(instructionMaxTotalCharsInput ? instructionMaxTotalCharsInput.value : instructionFileSettings.maxTotalChars),
	      };
	      if (patterns.some((pattern) => pattern.length > 240)) {
	        markInvalidField(instructionPatternsInput, 'Instruction patterns must be 240 characters or shorter.');
	        return;
	      }
	      if (!validateNumberField(instructionMaxCharsPerFileInput, settings.maxCharsPerFile, 1000, 'Instruction max characters per file must be at least 1000.')) return;
	      if (!validateNumberField(instructionMaxTotalCharsInput, settings.maxTotalChars, 1000, 'Instruction total character budget must be at least 1000.')) return;
	      clearInvalidFields(fields);
	      postSettingsWithPendingStates(
	        ['instructionPatternsState', 'instructionFileSettingsState'],
	        [
	          { type: 'setInstructionPatterns', patterns },
	          { type: 'setInstructionFileSettings', settings: normalizeInstructionFileSettings(settings) },
	        ],
	        () => {
	          updateInstructionPatternsState(instructionPatterns);
	          updateInstructionFileSettingsState(instructionFileSettings);
	        }
	      );
	    }

	    function normalizeToolRuntimeLimits(raw) {
	      const source = raw && typeof raw === 'object' ? raw : {};
	      const normalize = (value, fallback, minimum) => {
	        const parsed = Number(value);
	        return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
	      };
	      return {
	        toolTimeoutMs: normalize(source.toolTimeoutMs, 0, 0),
	        readMaxLines: normalize(source.readMaxLines, 300, 1),
	        bashBackgroundTtlMs: normalize(source.bashBackgroundTtlMs, 600000, 0),
	        bashBackgroundCaptureMs: normalize(source.bashBackgroundCaptureMs, 2000, 0),
	        bashBackgroundCaptureLines: normalize(source.bashBackgroundCaptureLines, 50, 0),
	        workspaceShellTimeoutMs: normalize(source.workspaceShellTimeoutMs, 60000, 0),
	        httpTimeoutMs: normalize(source.httpTimeoutMs, 30000, 0),
	      };
	    }

	    function updateToolRuntimeLimitsState(limits) {
	      toolRuntimeLimits = normalizeToolRuntimeLimits(limits);
	      if (toolTimeoutMsInput) toolTimeoutMsInput.value = String(toolRuntimeLimits.toolTimeoutMs);
	      if (readMaxLinesInput) readMaxLinesInput.value = String(toolRuntimeLimits.readMaxLines);
	      if (bashBackgroundTtlMsInput) bashBackgroundTtlMsInput.value = String(toolRuntimeLimits.bashBackgroundTtlMs);
	      if (bashBackgroundCaptureMsInput) bashBackgroundCaptureMsInput.value = String(toolRuntimeLimits.bashBackgroundCaptureMs);
	      if (bashBackgroundCaptureLinesInput) bashBackgroundCaptureLinesInput.value = String(toolRuntimeLimits.bashBackgroundCaptureLines);
	      if (workspaceShellTimeoutMsInput) workspaceShellTimeoutMsInput.value = String(toolRuntimeLimits.workspaceShellTimeoutMs);
	      if (httpTimeoutMsInput) httpTimeoutMsInput.value = String(toolRuntimeLimits.httpTimeoutMs);
	      if (toolTimeoutMsLabel) toolTimeoutMsLabel.title = 'Global tool timeout is ' + toolRuntimeLimits.toolTimeoutMs + 'ms (0 disables it).';
	      if (readMaxLinesLabel) readMaxLinesLabel.title = 'Read tools can return up to ' + toolRuntimeLimits.readMaxLines + ' lines per call.';
	      if (bashBackgroundTtlMsLabel) bashBackgroundTtlMsLabel.title = 'Background bash commands auto-stop after ' + toolRuntimeLimits.bashBackgroundTtlMs + 'ms (0 disables auto-stop).';
	      if (bashBackgroundCaptureMsLabel) bashBackgroundCaptureMsLabel.title = 'Background bash startup capture waits up to ' + toolRuntimeLimits.bashBackgroundCaptureMs + 'ms.';
	      if (bashBackgroundCaptureLinesLabel) bashBackgroundCaptureLinesLabel.title = 'Background bash startup capture includes up to ' + toolRuntimeLimits.bashBackgroundCaptureLines + ' lines.';
	      if (workspaceShellTimeoutMsLabel) workspaceShellTimeoutMsLabel.title = 'Workspace shell tools time out after ' + toolRuntimeLimits.workspaceShellTimeoutMs + 'ms (0 disables it).';
	      if (httpTimeoutMsLabel) httpTimeoutMsLabel.title = 'Workspace HTTP tools time out after ' + toolRuntimeLimits.httpTimeoutMs + 'ms (0 disables it).';
	      updateSafetySettingsTitle();
	    }

	    function applyToolRuntimeLimits() {
	      const fields = [
	        toolTimeoutMsInput,
	        readMaxLinesInput,
	        bashBackgroundTtlMsInput,
	        bashBackgroundCaptureMsInput,
	        bashBackgroundCaptureLinesInput,
	        workspaceShellTimeoutMsInput,
	        httpTimeoutMsInput,
	      ];
	      if (!initReceived || isProcessing || hasPendingSettingState('toolRuntimeLimitsState')) {
	        updateToolRuntimeLimitsState(toolRuntimeLimits);
	        clearInvalidFields(fields);
	        return;
	      }
	      const limits = {
	        toolTimeoutMs: Number(toolTimeoutMsInput ? toolTimeoutMsInput.value : toolRuntimeLimits.toolTimeoutMs),
	        readMaxLines: Number(readMaxLinesInput ? readMaxLinesInput.value : toolRuntimeLimits.readMaxLines),
	        bashBackgroundTtlMs: Number(bashBackgroundTtlMsInput ? bashBackgroundTtlMsInput.value : toolRuntimeLimits.bashBackgroundTtlMs),
	        bashBackgroundCaptureMs: Number(bashBackgroundCaptureMsInput ? bashBackgroundCaptureMsInput.value : toolRuntimeLimits.bashBackgroundCaptureMs),
	        bashBackgroundCaptureLines: Number(bashBackgroundCaptureLinesInput ? bashBackgroundCaptureLinesInput.value : toolRuntimeLimits.bashBackgroundCaptureLines),
	        workspaceShellTimeoutMs: Number(workspaceShellTimeoutMsInput ? workspaceShellTimeoutMsInput.value : toolRuntimeLimits.workspaceShellTimeoutMs),
	        httpTimeoutMs: Number(httpTimeoutMsInput ? httpTimeoutMsInput.value : toolRuntimeLimits.httpTimeoutMs),
	      };
	      if (!validateNumberField(toolTimeoutMsInput, limits.toolTimeoutMs, 0, 'Tool timeout must be 0 or greater.')) return;
	      if (!validateNumberField(readMaxLinesInput, limits.readMaxLines, 1, 'Read max lines must be at least 1.')) return;
	      if (!validateNumberField(bashBackgroundTtlMsInput, limits.bashBackgroundTtlMs, 0, 'Background bash TTL must be 0 or greater.')) return;
	      if (!validateNumberField(bashBackgroundCaptureMsInput, limits.bashBackgroundCaptureMs, 0, 'Background capture wait must be 0 or greater.')) return;
	      if (!validateNumberField(bashBackgroundCaptureLinesInput, limits.bashBackgroundCaptureLines, 0, 'Background capture lines must be 0 or greater.')) return;
	      if (!validateNumberField(workspaceShellTimeoutMsInput, limits.workspaceShellTimeoutMs, 0, 'Workspace shell timeout must be 0 or greater.')) return;
	      if (!validateNumberField(httpTimeoutMsInput, limits.httpTimeoutMs, 0, 'HTTP timeout must be 0 or greater.')) return;
	      clearInvalidFields(fields);
	      postSettingWithPendingState(
	        'toolRuntimeLimitsState',
	        { type: 'setToolRuntimeLimits', limits },
	        () => updateToolRuntimeLimitsState(toolRuntimeLimits)
	      );
	    }

	    function closeSafetySettingsPopover() {
	      if (safetySettingsPopover) safetySettingsPopover.classList.add('hidden');
	    }

	    function openSafetySettingsPopover() {
	      if (!safetySettingsPopover) return;
	      safetySettingsPopover.classList.remove('hidden');
	    }

	    function toggleSafetySettingsPopover() {
	      if (!safetySettingsPopover) return;
	      if (safetySettingsPopover.classList.contains('hidden')) {
	        openSafetySettingsPopover();
	      } else {
	        closeSafetySettingsPopover();
	      }
	    }

	    function updateShowThinkingState(enabled) {
	      showThinkingEnabled = !!enabled;
	      if (thinkingToggle) {
	        thinkingToggle.checked = showThinkingEnabled;
	      }
	      if (thinkingLabel) {
	        thinkingLabel.title = showThinkingEnabled
	          ? 'Thinking is shown: model thinking output appears as collapsible blocks.'
	          : 'Thinking is hidden: model thinking output is omitted from new runs.';
	      }
	    }

	    function updateMemoriesFeatureState(enabled) {
	      memoriesFeatureEnabled = enabled !== false;
	      if (memoriesFeatureToggle) {
	        memoriesFeatureToggle.checked = memoriesFeatureEnabled;
	      }
	      if (memoriesFeatureLabel) {
	        memoriesFeatureLabel.title = memoriesFeatureEnabled
	          ? 'Memories are on: memory extraction, recall, and memory tools are available.'
	          : 'Memories are off: memory extraction, recall, and memory tools are disabled.';
	      }
	    }

	    function setMemoryDropConfirmPending(pending, options) {
	      memoryDropConfirmPending = !!pending;
	      if (memoryDropConfirm) memoryDropConfirm.classList.toggle('hidden', !memoryDropConfirmPending);
	      if (memoryDropBtn) memoryDropBtn.setAttribute('aria-expanded', memoryDropConfirmPending ? 'true' : 'false');
	      if (!options || options.sync !== false) syncInputState();
	    }

	    function updateMemoryActionStatusState(status) {
	      const message = status && typeof status.message === 'string' ? status.message.trim() : '';
	      const state = status && typeof status.state === 'string' ? status.state : '';
	      memoryActionBusy = state === 'running';
	      if (status && typeof status === 'object' && state !== 'idle') {
	        setMemoryDropConfirmPending(false, { sync: false });
	      }
	      if (memoryActionStatus) {
	        memoryActionStatus.textContent = message;
	        memoryActionStatus.classList.toggle('hidden', !message);
	        memoryActionStatus.classList.toggle('error', state === 'error');
	        memoryActionStatus.classList.toggle('success', state === 'success');
	      }
	      if (memoryUpdateNowBtn) {
	        memoryUpdateNowBtn.textContent = state === 'running' && /updat/i.test(message) ? 'Updating…' : 'Update memories';
	        memoryUpdateNowBtn.title = state === 'running' ? message : 'Rebuild memory artifacts from saved sessions';
	      }
	      if (memoryDropBtn) {
	        memoryDropBtn.textContent = state === 'running' && /dropp|delet/i.test(message) ? 'Dropping…' : 'Drop memories';
	        memoryDropBtn.title = state === 'running' ? message : 'Delete generated memory artifacts and extraction outputs';
	      }
	      if (message) announceStatus(message);
	      syncInputState();
	    }

	    function updateMemoryAutoRecallState(enabled) {
	      memoryAutoRecallEnabled = !!enabled;
	      if (memoryAutoRecallToggle) {
	        memoryAutoRecallToggle.checked = memoryAutoRecallEnabled;
	      }
	      if (memoryAutoRecallLabel) {
	        memoryAutoRecallLabel.title = memoryAutoRecallEnabled
	          ? 'Memory recall is on: relevant saved memories are injected into new turns.'
	          : 'Memory recall is off: saved memories are not automatically injected into new turns.';
	      }
	    }

	    function updateMemoryAutoRecallBudgetState(maxResults, maxTokens) {
	      const parsedMaxResults = Number(maxResults);
	      const parsedMaxTokens = Number(maxTokens);
	      memoryAutoRecallMaxResults = Number.isFinite(parsedMaxResults) && parsedMaxResults >= 1 ? Math.floor(parsedMaxResults) : 4;
	      memoryAutoRecallMaxTokens = Number.isFinite(parsedMaxTokens) && parsedMaxTokens >= 100 ? Math.floor(parsedMaxTokens) : 1200;
	      if (memoryAutoRecallMaxResultsInput) {
	        memoryAutoRecallMaxResultsInput.value = String(memoryAutoRecallMaxResults);
	        memoryAutoRecallMaxResultsInput.title = 'Inject up to ' + memoryAutoRecallMaxResults + ' recalled memory matches.';
	      }
	      if (memoryAutoRecallMaxTokensInput) {
	        memoryAutoRecallMaxTokensInput.value = String(memoryAutoRecallMaxTokens);
	        memoryAutoRecallMaxTokensInput.title = 'Inject up to about ' + memoryAutoRecallMaxTokens + ' memory tokens.';
	      }
	      if (memoryAutoRecallMaxResultsLabel) {
	        memoryAutoRecallMaxResultsLabel.title = 'Auto-recall injects up to ' + memoryAutoRecallMaxResults + ' memory matches.';
	      }
	      if (memoryAutoRecallMaxTokensLabel) {
	        memoryAutoRecallMaxTokensLabel.title = 'Auto-recall injects up to about ' + memoryAutoRecallMaxTokens + ' memory tokens.';
	      }
	    }

	    function applyMemoryAutoRecallBudget() {
	      const currentBudget = { maxResults: memoryAutoRecallMaxResults, maxTokens: memoryAutoRecallMaxTokens };
	      const fields = [memoryAutoRecallMaxResultsInput, memoryAutoRecallMaxTokensInput];
	      if (!initReceived || isProcessing || !memoriesFeatureEnabled || hasPendingSettingState('memoryAutoRecallBudgetState')) {
	        updateMemoryAutoRecallBudgetState(currentBudget.maxResults, currentBudget.maxTokens);
	        clearInvalidFields(fields);
	        return;
	      }
	      const maxResults = Number(memoryAutoRecallMaxResultsInput ? memoryAutoRecallMaxResultsInput.value : memoryAutoRecallMaxResults);
	      const maxTokens = Number(memoryAutoRecallMaxTokensInput ? memoryAutoRecallMaxTokensInput.value : memoryAutoRecallMaxTokens);
	      if (!validateNumberField(memoryAutoRecallMaxResultsInput, maxResults, 1, 'Memory recall results must be at least 1.')) return;
	      if (!validateNumberField(memoryAutoRecallMaxTokensInput, maxTokens, 100, 'Memory recall token budget must be at least 100.')) return;
	      clearInvalidFields(fields);
	      const budget = { maxResults, maxTokens };
	      postSettingWithPendingState(
	        'memoryAutoRecallBudgetState',
	        { type: 'setMemoryAutoRecallBudget', budget },
	        () => updateMemoryAutoRecallBudgetState(currentBudget.maxResults, currentBudget.maxTokens)
	      );
	    }

	    function updateMemoryAutoRecallFiltersState(minScore, minScoreGap, maxAgeDays) {
	      const parsedMinScore = Number(minScore);
	      const parsedMinScoreGap = Number(minScoreGap);
	      const parsedMaxAgeDays = Number(maxAgeDays);
	      memoryAutoRecallMinScore = Number.isFinite(parsedMinScore) && parsedMinScore >= 0 ? Math.min(100, parsedMinScore) : 7;
	      memoryAutoRecallMinScoreGap = Number.isFinite(parsedMinScoreGap) && parsedMinScoreGap >= 0 ? Math.min(50, parsedMinScoreGap) : 1.25;
	      memoryAutoRecallMaxAgeDays = Number.isFinite(parsedMaxAgeDays) && parsedMaxAgeDays >= 1 ? Math.min(3650, Math.floor(parsedMaxAgeDays)) : 45;
	      if (memoryAutoRecallMinScoreInput) {
	        memoryAutoRecallMinScoreInput.value = String(memoryAutoRecallMinScore);
	        memoryAutoRecallMinScoreInput.title = 'Require memory recall score of at least ' + memoryAutoRecallMinScore + '.';
	      }
	      if (memoryAutoRecallMinScoreGapInput) {
	        memoryAutoRecallMinScoreGapInput.value = String(memoryAutoRecallMinScoreGap);
	        memoryAutoRecallMinScoreGapInput.title = 'Require top memory score to beat the next candidate by at least ' + memoryAutoRecallMinScoreGap + '.';
	      }
	      if (memoryAutoRecallMaxAgeDaysInput) {
	        memoryAutoRecallMaxAgeDaysInput.value = String(memoryAutoRecallMaxAgeDays);
	        memoryAutoRecallMaxAgeDaysInput.title = 'Ignore auto-recall matches older than ' + memoryAutoRecallMaxAgeDays + ' days.';
	      }
	      if (memoryAutoRecallMinScoreLabel) {
	        memoryAutoRecallMinScoreLabel.title = 'Auto-recall requires retrieval score of at least ' + memoryAutoRecallMinScore + '.';
	      }
	      if (memoryAutoRecallMinScoreGapLabel) {
	        memoryAutoRecallMinScoreGapLabel.title = 'Auto-recall requires top score gap of at least ' + memoryAutoRecallMinScoreGap + '.';
	      }
	      if (memoryAutoRecallMaxAgeDaysLabel) {
	        memoryAutoRecallMaxAgeDaysLabel.title = 'Auto-recall ignores matches older than ' + memoryAutoRecallMaxAgeDays + ' days.';
	      }
	    }

	    function applyMemoryAutoRecallFilters() {
	      const currentFilters = {
	        minScore: memoryAutoRecallMinScore,
	        minScoreGap: memoryAutoRecallMinScoreGap,
	        maxAgeDays: memoryAutoRecallMaxAgeDays,
	      };
	      const fields = [memoryAutoRecallMinScoreInput, memoryAutoRecallMinScoreGapInput, memoryAutoRecallMaxAgeDaysInput];
	      if (!initReceived || isProcessing || !memoriesFeatureEnabled || hasPendingSettingState('memoryAutoRecallFiltersState')) {
	        updateMemoryAutoRecallFiltersState(currentFilters.minScore, currentFilters.minScoreGap, currentFilters.maxAgeDays);
	        clearInvalidFields(fields);
	        return;
	      }
	      const minScore = Number(memoryAutoRecallMinScoreInput ? memoryAutoRecallMinScoreInput.value : memoryAutoRecallMinScore);
	      const minScoreGap = Number(memoryAutoRecallMinScoreGapInput ? memoryAutoRecallMinScoreGapInput.value : memoryAutoRecallMinScoreGap);
	      const maxAgeDays = Number(memoryAutoRecallMaxAgeDaysInput ? memoryAutoRecallMaxAgeDaysInput.value : memoryAutoRecallMaxAgeDays);
	      if (!validateNumberField(memoryAutoRecallMinScoreInput, minScore, 0, 'Memory recall minimum score must be 0 or greater.')) return;
	      if (!validateNumberField(memoryAutoRecallMinScoreGapInput, minScoreGap, 0, 'Memory recall score gap must be 0 or greater.')) return;
	      if (!validateNumberField(memoryAutoRecallMaxAgeDaysInput, maxAgeDays, 1, 'Memory recall max age must be at least 1 day.')) return;
	      clearInvalidFields(fields);
	      const filters = { minScore, minScoreGap, maxAgeDays };
	      postSettingWithPendingState(
	        'memoryAutoRecallFiltersState',
	        { type: 'setMemoryAutoRecallFilters', filters },
	        () => updateMemoryAutoRecallFiltersState(currentFilters.minScore, currentFilters.minScoreGap, currentFilters.maxAgeDays)
	      );
	    }

	    function clampMemoryLimit(value, fallback, min, max, integer) {
	      const parsed = Number(value);
	      if (!Number.isFinite(parsed) || parsed < min) return fallback;
	      const normalized = integer === false ? parsed : Math.floor(parsed);
	      return Math.min(max, normalized);
	    }

	    function normalizeMemoryAdvancedLimits(raw) {
	      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	      return {
	        maxRawMemoriesForGlobal: clampMemoryLimit(source.maxRawMemoriesForGlobal, 120, 1, 2000),
	        maxRolloutAgeDays: clampMemoryLimit(source.maxRolloutAgeDays, 30, 1, 3650),
	        maxRolloutsPerStartup: clampMemoryLimit(source.maxRolloutsPerStartup, 24, 1, 2000),
	        minRolloutIdleHours: clampMemoryLimit(source.minRolloutIdleHours, 2, 0, 720, false),
	        maxStateOutputs: clampMemoryLimit(source.maxStateOutputs, 500, 10, 5000),
	        maxRecords: clampMemoryLimit(source.maxRecords, 5000, 100, 50000),
	        maxSearchResults: clampMemoryLimit(source.maxSearchResults, 8, 1, 100),
	        maxResultsPerKind: clampMemoryLimit(source.maxResultsPerKind, 3, 1, 20),
	        searchNeighborWindow: clampMemoryLimit(source.searchNeighborWindow, 1, 0, 5),
	      };
	    }

	    function updateMemoryAdvancedLimitsState(limits) {
	      memoryAdvancedLimits = normalizeMemoryAdvancedLimits(limits);
	      if (memoryMaxRawMemoriesForGlobalInput) {
	        memoryMaxRawMemoriesForGlobalInput.value = String(memoryAdvancedLimits.maxRawMemoriesForGlobal);
	        memoryMaxRawMemoriesForGlobalInput.title = 'Retain up to ' + memoryAdvancedLimits.maxRawMemoriesForGlobal + ' latest rollout memories in generated artifacts.';
	      }
	      if (memoryMaxRolloutAgeDaysInput) {
	        memoryMaxRolloutAgeDaysInput.value = String(memoryAdvancedLimits.maxRolloutAgeDays);
	        memoryMaxRolloutAgeDaysInput.title = 'Extract memory from sessions up to ' + memoryAdvancedLimits.maxRolloutAgeDays + ' days old.';
	      }
	      if (memoryMaxRolloutsPerStartupInput) {
	        memoryMaxRolloutsPerStartupInput.value = String(memoryAdvancedLimits.maxRolloutsPerStartup);
	        memoryMaxRolloutsPerStartupInput.title = 'Scan up to ' + memoryAdvancedLimits.maxRolloutsPerStartup + ' sessions per memory update.';
	      }
	      if (memoryMinRolloutIdleHoursInput) {
	        memoryMinRolloutIdleHoursInput.value = String(memoryAdvancedLimits.minRolloutIdleHours);
	        memoryMinRolloutIdleHoursInput.title = 'Extract only from sessions idle for at least ' + memoryAdvancedLimits.minRolloutIdleHours + ' hours.';
	      }
	      if (memoryMaxStateOutputsInput) {
	        memoryMaxStateOutputsInput.value = String(memoryAdvancedLimits.maxStateOutputs);
	        memoryMaxStateOutputsInput.title = 'Retain up to ' + memoryAdvancedLimits.maxStateOutputs + ' stage-1 memory outputs.';
	      }
	      if (memoryMaxRecordsInput) {
	        memoryMaxRecordsInput.value = String(memoryAdvancedLimits.maxRecords);
	        memoryMaxRecordsInput.title = 'Retain up to ' + memoryAdvancedLimits.maxRecords + ' transcript-backed memory records.';
	      }
	      if (memoryMaxSearchResultsInput) {
	        memoryMaxSearchResultsInput.value = String(memoryAdvancedLimits.maxSearchResults);
	        memoryMaxSearchResultsInput.title = 'Memory search returns up to ' + memoryAdvancedLimits.maxSearchResults + ' matches by default.';
	      }
	      if (memoryMaxResultsPerKindInput) {
	        memoryMaxResultsPerKindInput.value = String(memoryAdvancedLimits.maxResultsPerKind);
	        memoryMaxResultsPerKindInput.title = 'Memory search returns up to ' + memoryAdvancedLimits.maxResultsPerKind + ' top-level matches per kind.';
	      }
	      if (memorySearchNeighborWindowInput) {
	        memorySearchNeighborWindowInput.value = String(memoryAdvancedLimits.searchNeighborWindow);
	        memorySearchNeighborWindowInput.title = 'Include ' + memoryAdvancedLimits.searchNeighborWindow + ' neighboring transcript chunks around each memory hit.';
	      }
	      if (memoryMaxRawMemoriesForGlobalLabel) memoryMaxRawMemoriesForGlobalLabel.title = memoryMaxRawMemoriesForGlobalInput ? memoryMaxRawMemoriesForGlobalInput.title : '';
	      if (memoryMaxRolloutAgeDaysLabel) memoryMaxRolloutAgeDaysLabel.title = memoryMaxRolloutAgeDaysInput ? memoryMaxRolloutAgeDaysInput.title : '';
	      if (memoryMaxRolloutsPerStartupLabel) memoryMaxRolloutsPerStartupLabel.title = memoryMaxRolloutsPerStartupInput ? memoryMaxRolloutsPerStartupInput.title : '';
	      if (memoryMinRolloutIdleHoursLabel) memoryMinRolloutIdleHoursLabel.title = memoryMinRolloutIdleHoursInput ? memoryMinRolloutIdleHoursInput.title : '';
	      if (memoryMaxStateOutputsLabel) memoryMaxStateOutputsLabel.title = memoryMaxStateOutputsInput ? memoryMaxStateOutputsInput.title : '';
	      if (memoryMaxRecordsLabel) memoryMaxRecordsLabel.title = memoryMaxRecordsInput ? memoryMaxRecordsInput.title : '';
	      if (memoryMaxSearchResultsLabel) memoryMaxSearchResultsLabel.title = memoryMaxSearchResultsInput ? memoryMaxSearchResultsInput.title : '';
	      if (memoryMaxResultsPerKindLabel) memoryMaxResultsPerKindLabel.title = memoryMaxResultsPerKindInput ? memoryMaxResultsPerKindInput.title : '';
	      if (memorySearchNeighborWindowLabel) memorySearchNeighborWindowLabel.title = memorySearchNeighborWindowInput ? memorySearchNeighborWindowInput.title : '';
	    }

	    function applyMemoryAdvancedLimits() {
	      const currentLimits = memoryAdvancedLimits;
	      const fields = [
	        memoryMaxRawMemoriesForGlobalInput,
	        memoryMaxRolloutAgeDaysInput,
	        memoryMaxRolloutsPerStartupInput,
	        memoryMinRolloutIdleHoursInput,
	        memoryMaxStateOutputsInput,
	        memoryMaxRecordsInput,
	        memoryMaxSearchResultsInput,
	        memoryMaxResultsPerKindInput,
	        memorySearchNeighborWindowInput,
	      ];
	      if (!initReceived || isProcessing || !memoriesFeatureEnabled || hasPendingSettingState('memoryAdvancedLimitsState')) {
	        updateMemoryAdvancedLimitsState(currentLimits);
	        clearInvalidFields(fields);
	        return;
	      }
	      const limits = {
	        maxRawMemoriesForGlobal: Number(memoryMaxRawMemoriesForGlobalInput ? memoryMaxRawMemoriesForGlobalInput.value : memoryAdvancedLimits.maxRawMemoriesForGlobal),
	        maxRolloutAgeDays: Number(memoryMaxRolloutAgeDaysInput ? memoryMaxRolloutAgeDaysInput.value : memoryAdvancedLimits.maxRolloutAgeDays),
	        maxRolloutsPerStartup: Number(memoryMaxRolloutsPerStartupInput ? memoryMaxRolloutsPerStartupInput.value : memoryAdvancedLimits.maxRolloutsPerStartup),
	        minRolloutIdleHours: Number(memoryMinRolloutIdleHoursInput ? memoryMinRolloutIdleHoursInput.value : memoryAdvancedLimits.minRolloutIdleHours),
	        maxStateOutputs: Number(memoryMaxStateOutputsInput ? memoryMaxStateOutputsInput.value : memoryAdvancedLimits.maxStateOutputs),
	        maxRecords: Number(memoryMaxRecordsInput ? memoryMaxRecordsInput.value : memoryAdvancedLimits.maxRecords),
	        maxSearchResults: Number(memoryMaxSearchResultsInput ? memoryMaxSearchResultsInput.value : memoryAdvancedLimits.maxSearchResults),
	        maxResultsPerKind: Number(memoryMaxResultsPerKindInput ? memoryMaxResultsPerKindInput.value : memoryAdvancedLimits.maxResultsPerKind),
	        searchNeighborWindow: Number(memorySearchNeighborWindowInput ? memorySearchNeighborWindowInput.value : memoryAdvancedLimits.searchNeighborWindow),
	      };
	      if (!validateNumberField(memoryMaxRawMemoriesForGlobalInput, limits.maxRawMemoriesForGlobal, 1, 'Global raw memories limit must be at least 1.')) return;
	      if (!validateNumberField(memoryMaxRolloutAgeDaysInput, limits.maxRolloutAgeDays, 1, 'Rollout max age must be at least 1 day.')) return;
	      if (!validateNumberField(memoryMaxRolloutsPerStartupInput, limits.maxRolloutsPerStartup, 1, 'Rollouts per startup must be at least 1.')) return;
	      if (!validateNumberField(memoryMinRolloutIdleHoursInput, limits.minRolloutIdleHours, 0, 'Minimum rollout idle hours must be 0 or greater.')) return;
	      if (!validateNumberField(memoryMaxStateOutputsInput, limits.maxStateOutputs, 10, 'State outputs limit must be at least 10.')) return;
	      if (!validateNumberField(memoryMaxRecordsInput, limits.maxRecords, 100, 'Memory records limit must be at least 100.')) return;
	      if (!validateNumberField(memoryMaxSearchResultsInput, limits.maxSearchResults, 1, 'Memory search results must be at least 1.')) return;
	      if (!validateNumberField(memoryMaxResultsPerKindInput, limits.maxResultsPerKind, 1, 'Memory results per kind must be at least 1.')) return;
	      if (!validateNumberField(memorySearchNeighborWindowInput, limits.searchNeighborWindow, 0, 'Memory neighbor window must be 0 or greater.')) return;
	      clearInvalidFields(fields);
	      const normalized = normalizeMemoryAdvancedLimits(limits);
	      postSettingWithPendingState(
	        'memoryAdvancedLimitsState',
	        { type: 'setMemoryAdvancedLimits', limits: normalized },
	        () => updateMemoryAdvancedLimitsState(currentLimits)
	      );
	    }

	    function updateExplorePrepassState(enabled, maxChars) {
	      explorePrepassEnabled = !!enabled;
	      const parsedMaxChars = Number(maxChars);
	      explorePrepassMaxChars = Number.isFinite(parsedMaxChars) && parsedMaxChars >= 500 ? Math.floor(parsedMaxChars) : 8000;
	      if (explorePrepassToggle) {
	        explorePrepassToggle.checked = explorePrepassEnabled;
	      }
	      if (explorePrepassMaxCharsInput) {
	        explorePrepassMaxCharsInput.value = String(explorePrepassMaxChars);
	        explorePrepassMaxCharsInput.title = 'Inject up to ' + explorePrepassMaxChars + ' characters from the explore prepass.';
	      }
	      if (explorePrepassLabel) {
	        explorePrepassLabel.title = explorePrepassEnabled
	          ? 'Explore prepass is on: LingYun gathers lightweight workspace context before new turns.'
	          : 'Explore prepass is off: new turns start without automatic workspace exploration.';
	      }
	    }

	    function updateSubagentModelOverrideState(model) {
	      subagentModelOverride = typeof model === 'string' ? model.trim().slice(0, 200) : '';
	      if (subagentModelOverrideInput) {
	        subagentModelOverrideInput.value = subagentModelOverride;
	        subagentModelOverrideInput.title = subagentModelOverride
	          ? 'Subagents use model: ' + subagentModelOverride
	          : 'Subagents use the current main model.';
	      }
	      if (subagentModelOverrideLabel) {
	        subagentModelOverrideLabel.title = subagentModelOverride
	          ? 'Explore/task subagents use model: ' + subagentModelOverride
	          : 'Explore/task subagents use the current main model.';
	      }
	    }

	    function updateSubagentTaskMaxOutputCharsState(maxChars) {
	      const parsedMaxChars = Number(maxChars);
	      subagentTaskMaxOutputChars = Number.isFinite(parsedMaxChars) && parsedMaxChars >= 500 ? Math.floor(parsedMaxChars) : 8000;
	      if (subagentTaskMaxOutputCharsInput) {
	        subagentTaskMaxOutputCharsInput.value = String(subagentTaskMaxOutputChars);
	        subagentTaskMaxOutputCharsInput.title = 'Inject up to ' + subagentTaskMaxOutputChars + ' characters from each task subagent result.';
	      }
	      if (subagentTaskMaxOutputCharsLabel) {
	        subagentTaskMaxOutputCharsLabel.title = 'Task subagent results inject up to ' + subagentTaskMaxOutputChars + ' characters into the main prompt.';
	      }
	    }

	    function normalizeCompactionToolOutputMode(mode) {
	      return mode === 'onCompaction' ? 'onCompaction' : 'afterToolCall';
	    }

	    function updateAutoCompactionState(enabled) {
	      autoCompactionEnabled = !!enabled;
	      if (autoCompactionToggle) {
	        autoCompactionToggle.checked = autoCompactionEnabled;
	      }
	      if (autoCompactionLabel) {
	        autoCompactionLabel.title = autoCompactionEnabled
	          ? 'Auto-compaction is on: LingYun summarizes older context before overflow.'
	          : 'Auto-compaction is off: overflowing context may fail until you compact manually.';
	      }
	    }

	    function normalizeModelLimits(raw) {
	      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	      const normalized = {};
	      Object.keys(source).forEach((rawKey) => {
	        if (Object.keys(normalized).length >= 100) return;
	        const key = String(rawKey || '').trim().slice(0, 240);
	        const entry = source[rawKey];
	        if (!key || !entry || typeof entry !== 'object' || Array.isArray(entry)) return;
	        const context = Number(entry.context);
	        const output = Number(entry.output);
	        if (!Number.isFinite(context) || context <= 0) return;
	        normalized[key] = {
	          context: Math.floor(context),
	          ...(Number.isFinite(output) && output > 0 ? { output: Math.floor(output) } : {}),
	        };
	      });
	      return normalized;
	    }

	    function serializeModelLimits(limits) {
	      const normalized = normalizeModelLimits(limits);
	      return Object.keys(normalized)
	        .sort((a, b) => a.localeCompare(b))
	        .map((key) => {
	          const entry = normalized[key];
	          return key + ' = ' + entry.context + (entry.output ? ' / ' + entry.output : '');
	        })
	        .join('\n');
	    }

	    function parseModelLimits(raw) {
	      const normalized = {};
	      const text = String(raw || '').trim();
	      if (!text) return normalized;

	      if (text.startsWith('{')) {
	        try {
	          return normalizeModelLimits(JSON.parse(text));
	        } catch {
	          return null;
	        }
	      }

	      const lines = text.split(/\n/);
	      for (const line of lines) {
	        if (Object.keys(normalized).length >= 100) return null;
	        const trimmed = line.trim();
	        if (!trimmed || trimmed.startsWith('#')) continue;

	        const equalsIndex = trimmed.indexOf('=');
	        const colonSpaceIndex = trimmed.indexOf(': ');
	        const sepIndex = equalsIndex >= 0 ? equalsIndex : colonSpaceIndex;
	        if (sepIndex <= 0) return null;

	        const separatorLength = equalsIndex >= 0 ? 1 : 2;
	        const key = trimmed.slice(0, sepIndex).trim().slice(0, 240);
	        const rest = trimmed.slice(sepIndex + separatorLength).trim();
	        const parts = rest.split(/[\/,]/).map((part) => part.trim()).filter(Boolean);
	        const context = Number(parts[0]);
	        const output = parts.length > 1 ? Number(parts[1]) : undefined;

	        if (!key || !Number.isFinite(context) || context <= 0) return null;
	        if (output !== undefined && (!Number.isFinite(output) || output <= 0)) return null;

	        normalized[key] = {
	          context: Math.floor(context),
	          ...(output ? { output: Math.floor(output) } : {}),
	        };
	      }
	      return normalized;
	    }

	    function updateModelLimitsState(limits) {
	      modelLimits = normalizeModelLimits(limits);
	      const count = Object.keys(modelLimits).length;
	      if (modelLimitsInput) {
	        modelLimitsInput.value = serializeModelLimits(modelLimits);
	        modelLimitsInput.title = count
	          ? count + ' model token limit override(s) configured.'
	          : 'No model token limit overrides configured.';
	      }
	      if (modelLimitsLabel) {
	        modelLimitsLabel.title = count
	          ? count + ' model token limit override(s) affect context tracking and auto-compaction.'
	          : 'No model token limit overrides configured.';
	      }
	    }

	    function applyModelLimits() {
	      if (!initReceived || isProcessing || hasPendingSettingState('modelLimitsState')) {
	        updateModelLimitsState(modelLimits);
	        clearInvalidFields([modelLimitsInput]);
	        return;
	      }
	      const parsed = parseModelLimits(modelLimitsInput ? modelLimitsInput.value : '');
	      if (!parsed) {
	        markInvalidField(modelLimitsInput, 'Use JSON or lines like: model-id = contextTokens / outputTokens. Token limits must be positive.');
	        return;
	      }
	      clearInvalidFields([modelLimitsInput]);
	      postSettingWithPendingState(
	        'modelLimitsState',
	        { type: 'setModelLimits', limits: parsed },
	        () => updateModelLimitsState(modelLimits)
	      );
	    }

	    function updateCompactionPruneState(prune, protectTokens, minimumTokens) {
	      compactionPruneEnabled = prune !== false;
	      const parsedProtectTokens = Number(protectTokens);
	      const parsedMinimumTokens = Number(minimumTokens);
	      compactionPruneProtectTokens = Number.isFinite(parsedProtectTokens) && parsedProtectTokens >= 0 ? Math.floor(parsedProtectTokens) : 40000;
	      compactionPruneMinimumTokens = Number.isFinite(parsedMinimumTokens) && parsedMinimumTokens >= 0 ? Math.floor(parsedMinimumTokens) : 20000;
	      if (compactionPruneToggle) {
	        compactionPruneToggle.checked = compactionPruneEnabled;
	      }
	      if (compactionPruneProtectTokensInput) {
	        compactionPruneProtectTokensInput.value = String(compactionPruneProtectTokens);
	        compactionPruneProtectTokensInput.title = 'Keep at least ' + compactionPruneProtectTokens + ' recent tool-output tokens before pruning.';
	      }
	      if (compactionPruneMinimumTokensInput) {
	        compactionPruneMinimumTokensInput.value = String(compactionPruneMinimumTokens);
	        compactionPruneMinimumTokensInput.title = 'Only prune when at least ' + compactionPruneMinimumTokens + ' tokens would be cleared.';
	      }
	      if (compactionPruneLabel) {
	        compactionPruneLabel.title = compactionPruneEnabled
	          ? 'Tool-output pruning is on: older tool-output context can be cleared before full compaction.'
	          : 'Tool-output pruning is off: full compaction handles context cleanup.';
	      }
	      if (compactionPruneProtectTokensLabel) {
	        compactionPruneProtectTokensLabel.title = 'Keep at least ' + compactionPruneProtectTokens + ' recent tool-output tokens before pruning.';
	      }
	      if (compactionPruneMinimumTokensLabel) {
	        compactionPruneMinimumTokensLabel.title = 'Only prune when at least ' + compactionPruneMinimumTokens + ' tokens would be cleared.';
	      }
	    }

	    function applyCompactionPruneSettings() {
	      const current = {
	        prune: compactionPruneEnabled,
	        pruneProtectTokens: compactionPruneProtectTokens,
	        pruneMinimumTokens: compactionPruneMinimumTokens,
	      };
	      const fields = [compactionPruneProtectTokensInput, compactionPruneMinimumTokensInput];
	      if (!initReceived || isProcessing || hasPendingSettingState('compactionPruneState')) {
	        updateCompactionPruneState(current.prune, current.pruneProtectTokens, current.pruneMinimumTokens);
	        clearInvalidFields(fields);
	        return;
	      }
	      const prune = !!(compactionPruneToggle && compactionPruneToggle.checked);
	      const pruneProtectTokens = Number(compactionPruneProtectTokensInput ? compactionPruneProtectTokensInput.value : compactionPruneProtectTokens);
	      const pruneMinimumTokens = Number(compactionPruneMinimumTokensInput ? compactionPruneMinimumTokensInput.value : compactionPruneMinimumTokens);
	      if (!validateNumberField(compactionPruneProtectTokensInput, pruneProtectTokens, 0, 'Compaction protect tokens must be 0 or greater.')) return;
	      if (!validateNumberField(compactionPruneMinimumTokensInput, pruneMinimumTokens, 0, 'Compaction minimum tokens must be 0 or greater.')) return;
	      clearInvalidFields(fields);
	      const settings = { prune, pruneProtectTokens, pruneMinimumTokens };
	      if (compactionPruneToggle) compactionPruneToggle.checked = compactionPruneEnabled;
	      postSettingWithPendingState(
	        'compactionPruneState',
	        { type: 'setCompactionPruneSettings', settings },
	        null
	      );
	    }

	    function updateCompactionToolOutputModeState(mode) {
	      compactionToolOutputMode = normalizeCompactionToolOutputMode(mode);
	      if (compactionToolOutputModeSelect) {
	        compactionToolOutputModeSelect.value = compactionToolOutputMode;
	        compactionToolOutputModeSelect.title = compactionToolOutputMode === 'afterToolCall'
	          ? 'Tool outputs are compacted after the model has seen them once.'
	          : 'Tool outputs are only compacted during session compaction.';
	      }
	    }

	    function setMode(mode) {
	      currentMode = mode === 'plan' ? 'plan' : 'build';
	      if (modePlanBtn) {
	        modePlanBtn.classList.toggle('active', currentMode === 'plan');
	        modePlanBtn.setAttribute('aria-pressed', currentMode === 'plan' ? 'true' : 'false');
	      }
	      if (modeBuildBtn) {
	        modeBuildBtn.classList.toggle('active', currentMode === 'build');
	        modeBuildBtn.setAttribute('aria-pressed', currentMode === 'build' ? 'true' : 'false');
	      }
	      syncInputState();
	    }

	    function requestModeChange(mode) {
	      const nextMode = mode === 'plan' ? 'plan' : 'build';
	      if (!initReceived || isProcessing || modeSwitchPending) return;
	      if (nextMode === currentMode) return;
	      modeSwitchPending = true;
	      armPendingActionTimer('modeSwitch', () => recoverPendingAction('modeSwitch', 'Mode switch is taking longer than expected. Controls were re-enabled.', () => { modeSwitchPending = false; }));
	      syncInputState();
	      try {
	        vscode.postMessage({ type: 'changeMode', mode: nextMode });
      } catch {
        clearPendingActionTimer('modeSwitch');
        modeSwitchPending = false;
        showInputNotice('Failed to request mode change.');
        syncInputState();
      }
	    }

	    if (modePlanBtn) {
	      modePlanBtn.addEventListener('click', () => requestModeChange('plan'));
	      modePlanBtn.setAttribute('aria-pressed', 'false');
	    }
	    if (modeBuildBtn) {
	      modeBuildBtn.addEventListener('click', () => requestModeChange('build'));
	      modeBuildBtn.setAttribute('aria-pressed', 'true');
	    }

	    if (newSessionBtn) {
	      newSessionBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || sessionActionPending) return;
	          sessionActionPending = 'newSession';
	          armPendingActionTimer('sessionAction', () => recoverPendingAction('sessionAction', 'Session action is taking longer than expected. Controls were re-enabled.', () => { sessionActionPending = ''; }));
	          syncInputState();
	          try {
	            vscode.postMessage({ type: 'newSession' });
	          } catch {
	            clearPendingActionTimer('sessionAction');
	            sessionActionPending = '';

	          showInputNotice('Failed to request a new session.');
	          syncInputState();
	        }
	      });
	    }

	    if (compactSessionBtn) {
	      compactSessionBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || sessionActionPending) return;
	          sessionActionPending = 'compactSession';
	          armPendingActionTimer('sessionAction', () => recoverPendingAction('sessionAction', 'Context compaction is taking longer than expected. Controls were re-enabled.', () => { sessionActionPending = ''; }));
	          syncInputState();
	          try {
	            vscode.postMessage({ type: 'compactSession' });
	          } catch {
	            clearPendingActionTimer('sessionAction');
	            sessionActionPending = '';

	          showInputNotice('Failed to request context compaction.');
	          syncInputState();
	        }
	      });
	    }

	    if (loopControlBtn) {
	      loopControlBtn.addEventListener('click', (e) => {
	        if (e) {
	          e.preventDefault();
	          e.stopPropagation();
	        }
	        if (!initReceived || isProcessing || currentLoop.available === false) return;
	        toggleLoopSettingsPopover();
	      });
	      loopControlBtn.setAttribute('aria-pressed', 'false');
	    }

	    if (loopSettingsClose) {
	      loopSettingsClose.addEventListener('click', (e) => {
	        if (e) e.preventDefault();
	        closeLoopSettingsPopover();
	      });
	    }

	    if (loopSettingsApply) {
	      loopSettingsApply.addEventListener('click', (e) => {
	        if (e) e.preventDefault();
	        applyLoopSettings();
	      });
	    }

	    if (loopResetDefaults) {
	      loopResetDefaults.addEventListener('click', (e) => {
	        if (e) e.preventDefault();
	        resetLoopSettings();
	      });
	    }

	    if (loopDefaultsApply) {
	      loopDefaultsApply.addEventListener('click', (e) => {
	        if (e) e.preventDefault();
	        applyLoopDefaults();
	      });
	    }

	    [loopIntervalInput, loopDefaultIntervalInput].forEach((el) => {
	      if (!el) return;
	      el.addEventListener('keydown', (e) => {
	        if (e.key !== 'Enter') return;
	        if (el === loopDefaultIntervalInput) {
	          applyLoopDefaults();
	        } else {
	          applyLoopSettings();
	        }
	      });
	    });

	    if (loopPromptInput) {
	      loopPromptInput.addEventListener('keydown', (e) => {
	        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
	          e.preventDefault();
	          applyLoopSettings();
	        }
	      });
	    }

	    if (loopDefaultPromptInput) {
	      loopDefaultPromptInput.addEventListener('keydown', (e) => {
	        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
	          e.preventDefault();
	          applyLoopDefaults();
	        }
	      });
	    }

	    function requestAbort() {
	      if (!initReceived || !isProcessing || abortRequestPending) return;
	      abortRequestPending = true;
	      armPendingActionTimer('abort', () => recoverPendingAction('abort', 'Stop request is taking longer than expected. Controls were re-enabled.', () => { abortRequestPending = false; updateOperationBanner(); updateApprovalBanner(); }));
	      syncInputState();
	      updateOperationBanner();
	      updateApprovalBanner();
	      try {
	        vscode.postMessage({ type: 'abort' });
	      } catch {
	        clearPendingActionTimer('abort');
	        abortRequestPending = false;
	        showInputNotice('Failed to request stop.');
	        syncInputState();
	        updateOperationBanner();
	        updateApprovalBanner();
	      }
	    }

	    if (operationStopBtn) {
	      operationStopBtn.addEventListener('click', requestAbort);
	    }

	    function setRevertDiscardConfirmPending(pending, options) {
	      revertDiscardConfirmPending = !!pending;
	      if (revertDiscardConfirm) revertDiscardConfirm.classList.toggle('hidden', !revertDiscardConfirmPending);
	      if (revertDiscardBtn) revertDiscardBtn.setAttribute('aria-expanded', revertDiscardConfirmPending ? 'true' : 'false');
	      if (!options || options.sync !== false) syncInputState();
	    }

	    function requestRevertAction(type, failureMessage, extra) {
	      if (!initReceived || isProcessing || revertActionPending) return false;
	      revertActionPending = type;
	      if (type !== 'discardUndone') setRevertDiscardConfirmPending(false, { sync: false });
	      armPendingActionTimer('revertAction', () => recoverPendingAction('revertAction', 'Revert action is taking longer than expected. Controls were re-enabled.', () => { revertActionPending = ''; }));
	      syncInputState();
	      try {
	        vscode.postMessage({ type, ...(extra && typeof extra === 'object' ? extra : {}) });
	      } catch {
	        clearPendingActionTimer('revertAction');
	        revertActionPending = '';
	        if (failureMessage) showInputNotice(failureMessage);
	        syncInputState();
	      }
	      return true;
	    }

	    if (undoBtn) {
	      undoBtn.addEventListener('click', () => {
	        if (!canUndo) return;
	        requestRevertAction('undo', 'Failed to request undo.');
	      });
	    }

	    if (redoBtn) {
	      redoBtn.addEventListener('click', () => {
	        if (!canRedo) return;
	        requestRevertAction('redo', 'Failed to request redo.');
	      });
	    }

	    if (revertRedoBtn) {
	      revertRedoBtn.addEventListener('click', () => {
	        if (!canRedo) return;
	        requestRevertAction('redo', 'Failed to request redo.');
	      });
	    }

	    if (revertRedoAllBtn) {
	      revertRedoAllBtn.addEventListener('click', () => {
	        if (!canRedo) return;
	        requestRevertAction('redoAll', 'Failed to request redo all.');
	      });
	    }

	    if (revertDiscardBtn) {
	      revertDiscardBtn.addEventListener('click', () => {
	        if (!currentRevertState || revertActionPending) return;
	        setRevertDiscardConfirmPending(!revertDiscardConfirmPending);
	      });
	    }

	    if (revertDiscardCancelBtn) {
	      revertDiscardCancelBtn.addEventListener('click', () => {
	        setRevertDiscardConfirmPending(false);
	      });
	    }

	    if (revertDiscardConfirmRunBtn) {
	      revertDiscardConfirmRunBtn.addEventListener('click', () => {
	        if (!currentRevertState || !revertDiscardConfirmPending) return;
	        setRevertDiscardConfirmPending(false, { sync: false });
	        requestRevertAction('discardUndone', 'Failed to request discard.', { confirmed: true });
	      });
	    }

	    if (revertDiffBtn) {
	      revertDiffBtn.addEventListener('click', () => {
	        if (!currentRevertState) return;
	        requestRevertAction('viewRevertDiff', 'Failed to request undo diff.');
	      });
	    }

			    if (sessionSelect) {
			      sessionSelect.addEventListener('change', () => {
			        const next = sessionSelect.value;
			        if (!initReceived || isProcessing || sessionSwitchPending) {
			          sessionSelect.value = currentSessionId;
			          return;
			        }
			        if (!next || next === currentSessionId) {
			          sessionSelect.value = currentSessionId;
			          return;
			        }
			        sessionSelect.value = currentSessionId;
			        sessionSwitchPending = true;
			        armPendingActionTimer('sessionSwitch', () => recoverPendingAction('sessionSwitch', 'Session switch is taking longer than expected. Controls were re-enabled.', () => { sessionSwitchPending = false; }));
			        syncInputState();
        try {
          vscode.postMessage({ type: 'switchSession', sessionId: next });
        } catch {
          clearPendingActionTimer('sessionSwitch');
          sessionSwitchPending = false;
          showInputNotice('Failed to request session switch.');
          syncInputState();
        }
			      });
			    }

			    if (sessionSettings) {
			      sessionSettings.addEventListener('click', (e) => {
			        e.preventDefault();
			        e.stopPropagation();
			        if (!initReceived || isProcessing) return;
			        toggleSessionSettingsPopover();
			      });
			    }

			    if (sessionSettingsClose) {
			      sessionSettingsClose.addEventListener('click', (e) => {
			        e.preventDefault();
			        closeSessionSettingsPopover();
			      });
			    }

			    if (sessionsPersistToggle) {
			      sessionsPersistToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('sessionsPersistState')) {
			          sessionsPersistToggle.checked = sessionsPersistEnabled;
			          return;
			        }
			        const enabled = !!sessionsPersistToggle.checked;
			        if (enabled === sessionsPersistEnabled) return;
			        postSettingWithPendingState(
			          'sessionsPersistState',
			          { type: 'setSessionsPersist', enabled },
			          () => updateSessionsPersistState(sessionsPersistEnabled)
			        );
			      });
			    }

			    if (sessionSettingsApply) {
			      sessionSettingsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applySessionRetentionLimits();
			      });
			    }

			    if (sessionClearCurrentBtn) {
			      sessionClearCurrentBtn.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || sessionActionPending) return;
			        setSessionClearConfirmAction(sessionClearConfirmAction === 'clearCurrentSession' ? '' : 'clearCurrentSession');
			      });
			    }

			    if (sessionClearSavedBtn) {
			      sessionClearSavedBtn.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || sessionActionPending) return;
			        setSessionClearConfirmAction(sessionClearConfirmAction === 'clearSavedSessions' ? '' : 'clearSavedSessions');
			      });
			    }

			    if (sessionClearCancelBtn) {
			      sessionClearCancelBtn.addEventListener('click', (e) => {
			        e.preventDefault();
			        setSessionClearConfirmAction('');
			      });
			    }

			    if (sessionClearConfirmRunBtn) {
			      sessionClearConfirmRunBtn.addEventListener('click', (e) => {
			        e.preventDefault();
			        const action = sessionClearConfirmAction;
			        if (!initReceived || isProcessing || sessionActionPending || !action) return;
			        setSessionClearConfirmAction('', { sync: false });
			        sessionActionPending = action;
			        armPendingActionTimer('sessionAction', () => recoverPendingAction('sessionAction', 'Session clear action is taking longer than expected. Controls were re-enabled.', () => { sessionActionPending = ''; }));
			        syncInputState();
			        try {
			          vscode.postMessage({ type: action, confirmed: true });
			        } catch {
			          clearPendingActionTimer('sessionAction');
			          sessionActionPending = '';
			          showInputNotice(action === 'clearSavedSessions' ? 'Failed to request saved-session clear.' : 'Failed to request session clear.');
			          syncInputState();
			        }
			      });
			    }


			    if (sessionsMaxSessionsInput) {
			      sessionsMaxSessionsInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applySessionRetentionLimits();
			      });
			    }

			    if (sessionsMaxSessionBytesInput) {
			      sessionsMaxSessionBytesInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applySessionRetentionLimits();
			      });
			    }

			    if (providerSelect) {
			      providerSelect.addEventListener('change', () => {
			        if (!initReceived || isProcessing || providerSwitchPending) {
			          providerSelect.value = currentProviderId;
			          return;
			        }
			        const next = normalizeProviderId(providerSelect.value);
			        if (next === currentProviderId) return;
			        providerSelect.value = currentProviderId;
			        providerSwitchPending = true;
			        armPendingActionTimer('providerSwitch', () => recoverPendingAction('providerSwitch', 'Provider switch is taking longer than expected. Controls were re-enabled.', () => { providerSwitchPending = false; }));
			        syncInputState();
				        try {
				          vscode.postMessage({ type: 'switchProvider', providerId: next });
				        } catch {
				          clearPendingActionTimer('providerSwitch');
				          providerSwitchPending = false;
				          showInputNotice('Failed to request provider switch.');
				          syncInputState();
				        }
			      });
			    }

			    if (providerSettings) {
			      providerSettings.addEventListener('click', (e) => {
			        e.preventDefault();
			        e.stopPropagation();
			        if (!initReceived || isProcessing || providerSwitchPending) return;
			        toggleProviderSettingsPopover();
			      });
			    }

			    if (providerSettingsClose) {
			      providerSettingsClose.addEventListener('click', (e) => {
			        e.preventDefault();
			        closeProviderSettingsPopover();
			      });
			    }

			    if (providerSettingsApply) {
			      providerSettingsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyProviderSettings();
			      });
			    }

			    [codexDefaultModelInput, openAIBaseURLInput, openAIDefaultModelInput, openAIApiKeyEnvInput].forEach((providerInput) => {
			      if (!providerInput) return;
			      providerInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyProviderSettings();
			      });
			    });

			    if (openAIModelDisplayNamesInput) {
			      openAIModelDisplayNamesInput.addEventListener('keydown', (e) => {
			        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			          e.preventDefault();
			          applyProviderSettings();
			        }
			      });
			    }

			    if (safetySelect) {
			      safetySelect.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('autoApproveState')) {
			          safetySelect.value = autoApproveEnabled ? 'auto' : 'ask';
			          return;
			        }
			        const enabled = safetySelect.value === 'auto';
			        if (enabled === autoApproveEnabled) return;
			        postSettingWithPendingState(
			          'autoApproveState',
			          { type: 'setAutoApprove', enabled },
			          () => updateAutoApproveState(autoApproveEnabled)
			        );
			      });
			    }

			    if (safetySettings) {
			      safetySettings.addEventListener('click', (e) => {
			        e.preventDefault();
			        e.stopPropagation();
			        if (!initReceived || isProcessing) return;
			        toggleSafetySettingsPopover();
			      });
			    }

			    if (safetySettingsClose) {
			      safetySettingsClose.addEventListener('click', (e) => {
			        e.preventDefault();
			        closeSafetySettingsPopover();
			      });
			    }

			    if (allowExternalPathsToggle) {
			      allowExternalPathsToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('allowExternalPathsState')) {
			          allowExternalPathsToggle.checked = allowExternalPathsEnabled;
			          return;
			        }
			        const enabled = !!allowExternalPathsToggle.checked;
			        if (enabled === allowExternalPathsEnabled) return;
			        postSettingWithPendingState(
			          'allowExternalPathsState',
			          { type: 'setAllowExternalPaths', enabled },
			          () => updateAllowExternalPathsState(allowExternalPathsEnabled)
			        );
			      });
			    }

			    if (blockGitPushToggle) {
			      blockGitPushToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('blockGitPushState')) {
			          blockGitPushToggle.checked = blockGitPushEnabled;
			          return;
			        }
			        const enabled = !!blockGitPushToggle.checked;
			        if (enabled === blockGitPushEnabled) return;
			        postSettingWithPendingState(
			          'blockGitPushState',
			          { type: 'setBlockGitPush', enabled },
			          () => updateBlockGitPushState(blockGitPushEnabled)
			        );
			      });
			    }

			    if (debugDetailsToggle) {
			      debugDetailsToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing) {
			          updateDebugSettingsState(debugSettings);
			          return;
			        }
			        applyDebugSettings({ details: !!debugDetailsToggle.checked });
			      });
			    }

			    if (debugLlmToggle) {
			      debugLlmToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || debugSettings.details) {
			          updateDebugSettingsState(debugSettings);
			          return;
			        }
			        applyDebugSettings({ llm: !!debugLlmToggle.checked });
			      });
			    }

			    if (debugToolsToggle) {
			      debugToolsToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || debugSettings.details) {
			          updateDebugSettingsState(debugSettings);
			          return;
			        }
			        applyDebugSettings({ tools: !!debugToolsToggle.checked });
			      });
			    }

			    if (debugPluginsToggle) {
			      debugPluginsToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || debugSettings.details) {
			          updateDebugSettingsState(debugSettings);
			          return;
			        }
			        applyDebugSettings({ plugins: !!debugPluginsToggle.checked });
			      });
			    }

			    if (showLogsBtn) {
			      showLogsBtn.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || showLogsPending) return;
			        showLogsPending = true;
			        armPendingActionTimer('showLogs', () => recoverPendingAction('showLogs', 'Show logs action is taking longer than expected. Controls were re-enabled.', () => { showLogsPending = false; }));
			        syncInputState();
			        try {
			          vscode.postMessage({ type: 'showLogs' });
			        } catch {
			          clearPendingActionTimer('showLogs');
			          showLogsPending = false;
			          showInputNotice('Failed to request logs.');
			          syncInputState();
			        }
			      });
			    }

		      if (listToolsBtn) {
		        listToolsBtn.addEventListener('click', (e) => {
		          e.preventDefault();
		          if (!initReceived || isProcessing || toolsCatalogRequestPending) return;
		          if (toolsCatalog && !toolsCatalog.classList.contains('hidden')) {
		            toolsCatalogSearchQuery = '';
		            if (toolsCatalogSearchInput) toolsCatalogSearchInput.value = '';
		            updateToolsCatalogState(null);
		            return;
		          }
			        if (currentToolsCatalog) {
			          updateToolsCatalogState(currentToolsCatalog);
			        }
			        toolsCatalogRequestPending = true;
			        armPendingActionTimer('toolsCatalog', () => recoverPendingAction('toolsCatalog', 'Tool list is taking longer than expected. Controls were re-enabled.', () => { toolsCatalogRequestPending = false; }));
			        syncInputState();
        try { vscode.postMessage({ type: 'listTools' }); } catch {
          clearPendingActionTimer('toolsCatalog');
          toolsCatalogRequestPending = false;
          showInputNotice('Failed to request tools list.');
          syncInputState();
        }
		      });
		    }


			    if (runToolBtn) {
			      runToolBtn.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || toolsCatalogRequestPending) return;
			        if (currentToolsCatalog) {
			          updateToolsCatalogState(currentToolsCatalog);
			        }
			        toolsCatalogRequestPending = true;
			        armPendingActionTimer('toolsCatalog', () => recoverPendingAction('toolsCatalog', 'Tool runner is taking longer than expected. Controls were re-enabled.', () => { toolsCatalogRequestPending = false; }));
			        syncInputState();
        try { vscode.postMessage({ type: 'runTool' }); } catch {
          clearPendingActionTimer('toolsCatalog');
          toolsCatalogRequestPending = false;
          showInputNotice('Failed to request tool runner.');
          syncInputState();
        }
			      });
			    }

			    if (createToolsConfigBtn) {
			      createToolsConfigBtn.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || toolsCatalogRequestPending) return;
			        toolsCatalogRequestPending = true;
			        armPendingActionTimer('toolsCatalog', () => recoverPendingAction('toolsCatalog', 'Tools config creation is taking longer than expected. Controls were re-enabled.', () => { toolsCatalogRequestPending = false; }));
			        syncInputState();
        try { vscode.postMessage({ type: 'createToolsConfig' }); } catch {
          clearPendingActionTimer('toolsCatalog');
          toolsCatalogRequestPending = false;
          showInputNotice('Failed to request tools config creation.');
          syncInputState();
        }
			      });
			    }

			    if (autoApprovedToolsClear) {
			      autoApprovedToolsClear.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || autoApprovedToolsPending || autoApprovedTools.length === 0) return;
			        setAutoApprovedToolsClearConfirmPending(!autoApprovedToolsClearConfirmPending);
			      });
			    }

			    if (autoApprovedToolsClearCancel) {
			      autoApprovedToolsClearCancel.addEventListener('click', (e) => {
			        e.preventDefault();
			        setAutoApprovedToolsClearConfirmPending(false);
			      });
			    }

			    if (autoApprovedToolsClearConfirmRun) {
			      autoApprovedToolsClearConfirmRun.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!autoApprovedToolsClearConfirmPending) return;
			        clearAutoApprovedTools();
			      });
			    }

			    if (toolsCatalogSearchInput) {
			      toolsCatalogSearchInput.addEventListener('input', () => {
			        toolsCatalogSearchQuery = String(toolsCatalogSearchInput.value || '');
			        updateToolsCatalogState(currentToolsCatalog);
			      });
			      toolsCatalogSearchInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Escape') {
			          toolsCatalogSearchQuery = '';
			          toolsCatalogSearchInput.value = '';
			          updateToolsCatalogState(currentToolsCatalog);
			        }
			      });
			    }

			    const toolLimitInputs = [
			      toolTimeoutMsInput,
			      readMaxLinesInput,
			      bashBackgroundTtlMsInput,
			      bashBackgroundCaptureMsInput,
			      bashBackgroundCaptureLinesInput,
			      workspaceShellTimeoutMsInput,
			      httpTimeoutMsInput,
			    ];
			    toolLimitInputs.forEach((toolLimitInput) => {
			      if (!toolLimitInput) return;
			      toolLimitInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyToolRuntimeLimits();
			      });
			    });

			    if (pluginsAutoDiscoverToggle) {
			      pluginsAutoDiscoverToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || pluginSettingsPending) {
			          pluginsAutoDiscoverToggle.checked = pluginSettings.autoDiscover;
			          return;
			        }
			        const next = { ...pluginSettings, autoDiscover: !!pluginsAutoDiscoverToggle.checked };
			        pluginsAutoDiscoverToggle.checked = pluginSettings.autoDiscover;
			        pluginSettingsPending = true;
			        syncInputState();
				        try { vscode.postMessage({ type: 'setPluginSettings', settings: next }); } catch {
				          pluginSettingsPending = false;
				          showInputNotice('Failed to request plugin settings update.');
				          syncInputState();
				        }
			      });
			    }

			    if (pluginsWorkspaceDirInput) {
			      pluginsWorkspaceDirInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyPluginSettings();
			      });
			    }

			    if (pluginSpecsInput) {
			      pluginSpecsInput.addEventListener('keydown', (e) => {
			        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			          e.preventDefault();
			          applyPluginSettings();
			        }
			      });
			    }

			    if (pluginSettingsApply) {
			      pluginSettingsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyPluginSettings();
			      });
			    }

			    if (toolFilterInput) {
			      toolFilterInput.addEventListener('keydown', (e) => {
			        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			          e.preventDefault();
			          applyToolFilter();
			        }
			      });
			    }

			    if (toolFilterApply) {
			      toolFilterApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyToolFilter();
			      });
			    }

			    if (workspaceEnvInput) {
			      workspaceEnvInput.addEventListener('keydown', (e) => {
			        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			          e.preventDefault();
			          applyWorkspaceEnv();
			        }
			      });
			    }

			    if (workspaceEnvApply) {
			      workspaceEnvApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyWorkspaceEnv();
			      });
			    }

			    if (toolLimitsApply) {
			      toolLimitsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyToolRuntimeLimits();
			      });
			    }

			    if (instructionPatternsInput) {
			      instructionPatternsInput.addEventListener('keydown', (e) => {
			        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			          e.preventDefault();
			          applyInstructionSettings();
			        }
			      });
			    }

			    if (instructionPatternsApply) {
			      instructionPatternsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyInstructionSettings();
			      });
			    }

			    const memoryAdvancedLimitInputs = [
			      memoryMaxRawMemoriesForGlobalInput,
			      memoryMaxRolloutAgeDaysInput,
			      memoryMaxRolloutsPerStartupInput,
			      memoryMinRolloutIdleHoursInput,
			      memoryMaxStateOutputsInput,
			      memoryMaxRecordsInput,
			      memoryMaxSearchResultsInput,
			      memoryMaxResultsPerKindInput,
			      memorySearchNeighborWindowInput,
			    ];
			    memoryAdvancedLimitInputs.forEach((memoryLimitInput) => {
			      if (!memoryLimitInput) return;
			      memoryLimitInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyMemoryAdvancedLimits();
			      });
			    });

			    if (memoryAdvancedLimitsApply) {
			      memoryAdvancedLimitsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyMemoryAdvancedLimits();
			      });
			    }

	    if (memoryUpdateNowBtn) {
	      memoryUpdateNowBtn.addEventListener('click', (e) => {
	        e.preventDefault();
	        if (!initReceived || isProcessing || !memoriesFeatureEnabled || memoryActionBusy) return;
	        setMemoryDropConfirmPending(false, { sync: false });
	        updateMemoryActionStatusState({ state: 'running', message: 'Updating memories…' });
	        try { vscode.postMessage({ type: 'updateMemories' }); } catch {
	          updateMemoryActionStatusState({ state: 'error', message: 'Failed to request memory update.' });
	        }
	      });
	    }

	    if (memoryDropBtn) {
	      memoryDropBtn.addEventListener('click', (e) => {
	        e.preventDefault();
	        if (!initReceived || isProcessing || !memoriesFeatureEnabled || memoryActionBusy) return;
	        setMemoryDropConfirmPending(!memoryDropConfirmPending);
	      });
	    }

	    if (memoryDropCancelBtn) {
	      memoryDropCancelBtn.addEventListener('click', (e) => {
	        e.preventDefault();
	        setMemoryDropConfirmPending(false);
	      });
	    }

	    if (memoryDropConfirmRunBtn) {
	      memoryDropConfirmRunBtn.addEventListener('click', (e) => {
	        e.preventDefault();
	        if (!initReceived || isProcessing || !memoriesFeatureEnabled || memoryActionBusy || !memoryDropConfirmPending) return;
	        setMemoryDropConfirmPending(false, { sync: false });
	        updateMemoryActionStatusState({ state: 'running', message: 'Dropping generated memories…' });
	        try { vscode.postMessage({ type: 'dropMemories', confirmed: true }); } catch {
	          updateMemoryActionStatusState({ state: 'error', message: 'Failed to request memory drop.' });
	        }
	      });
	    }



			    if (thinkingToggle) {
			      thinkingToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('showThinkingState')) {
			          thinkingToggle.checked = showThinkingEnabled;
			          return;
			        }
			        const enabled = !!thinkingToggle.checked;
			        if (enabled === showThinkingEnabled) return;
			        postSettingWithPendingState(
			          'showThinkingState',
			          { type: 'setShowThinking', enabled },
			          () => updateShowThinkingState(showThinkingEnabled)
			        );
			      });
			    }

			    if (memoriesFeatureToggle) {
			      memoriesFeatureToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('memoriesFeatureState') || hasPendingSettingState('memoryAutoRecallState')) {
			          memoriesFeatureToggle.checked = memoriesFeatureEnabled;
			          return;
			        }
			        const enabled = !!memoriesFeatureToggle.checked;
			        if (enabled === memoriesFeatureEnabled) return;
			        postSettingWithPendingState(
			          'memoriesFeatureState',
			          { type: 'setMemoriesFeatureEnabled', enabled },
			          () => updateMemoriesFeatureState(memoriesFeatureEnabled)
			        );
			      });
			    }

			    if (memoryAutoRecallToggle) {
			      memoryAutoRecallToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || !memoriesFeatureEnabled || hasPendingSettingState('memoriesFeatureState') || hasPendingSettingState('memoryAutoRecallState')) {
			          memoryAutoRecallToggle.checked = memoryAutoRecallEnabled;
			          return;
			        }
			        const enabled = !!memoryAutoRecallToggle.checked;
			        if (enabled === memoryAutoRecallEnabled) return;
			        postSettingWithPendingState(
			          'memoryAutoRecallState',
			          { type: 'setMemoryAutoRecall', enabled },
			          () => updateMemoryAutoRecallState(memoryAutoRecallEnabled)
			        );
			      });
			    }

			    if (memoryAutoRecallMaxResultsInput) {
			      memoryAutoRecallMaxResultsInput.addEventListener('change', applyMemoryAutoRecallBudget);
			      memoryAutoRecallMaxResultsInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyMemoryAutoRecallBudget();
			      });
			    }

			    if (memoryAutoRecallMaxTokensInput) {
			      memoryAutoRecallMaxTokensInput.addEventListener('change', applyMemoryAutoRecallBudget);
			      memoryAutoRecallMaxTokensInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyMemoryAutoRecallBudget();
			      });
			    }

			    if (memoryAutoRecallMinScoreInput) {
			      memoryAutoRecallMinScoreInput.addEventListener('change', applyMemoryAutoRecallFilters);
			      memoryAutoRecallMinScoreInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyMemoryAutoRecallFilters();
			      });
			    }

			    if (memoryAutoRecallMinScoreGapInput) {
			      memoryAutoRecallMinScoreGapInput.addEventListener('change', applyMemoryAutoRecallFilters);
			      memoryAutoRecallMinScoreGapInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyMemoryAutoRecallFilters();
			      });
			    }

			    if (memoryAutoRecallMaxAgeDaysInput) {
			      memoryAutoRecallMaxAgeDaysInput.addEventListener('change', applyMemoryAutoRecallFilters);
			      memoryAutoRecallMaxAgeDaysInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyMemoryAutoRecallFilters();
			      });
			    }

			    if (explorePrepassToggle) {
			      explorePrepassToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('explorePrepassState')) {
			          explorePrepassToggle.checked = explorePrepassEnabled;
			          return;
			        }
			        const enabled = !!explorePrepassToggle.checked;
			        if (enabled === explorePrepassEnabled) return;
			        postSettingWithPendingState(
			          'explorePrepassState',
			          { type: 'setExplorePrepass', enabled },
			          () => updateExplorePrepassState(explorePrepassEnabled, explorePrepassMaxChars)
			        );
			      });
			    }

			    if (explorePrepassMaxCharsInput) {
			      const applyExplorePrepassMaxChars = () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('explorePrepassState')) {
			          updateExplorePrepassState(explorePrepassEnabled, explorePrepassMaxChars);
			          clearInvalidFields([explorePrepassMaxCharsInput]);
			          return;
			        }
			        const maxChars = Number(explorePrepassMaxCharsInput.value);
			        if (!validateNumberField(explorePrepassMaxCharsInput, maxChars, 500, 'Explore prepass max characters must be at least 500.')) return;
			        clearInvalidFields([explorePrepassMaxCharsInput]);
			        postSettingWithPendingState(
			          'explorePrepassState',
			          { type: 'setExplorePrepassMaxChars', maxChars },
			          () => updateExplorePrepassState(explorePrepassEnabled, explorePrepassMaxChars)
			        );
			      };
			      explorePrepassMaxCharsInput.addEventListener('change', applyExplorePrepassMaxChars);
			      explorePrepassMaxCharsInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyExplorePrepassMaxChars();
			      });
			    }

			    if (subagentModelOverrideInput) {
			      const applySubagentModelOverride = () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('subagentModelOverrideState')) {
			          updateSubagentModelOverrideState(subagentModelOverride);
			          return;
			        }
			        const model = (subagentModelOverrideInput.value || '').trim().slice(0, 200);
			        postSettingWithPendingState(
			          'subagentModelOverrideState',
			          { type: 'setSubagentModelOverride', model },
			          () => updateSubagentModelOverrideState(subagentModelOverride)
			        );
			      };
			      subagentModelOverrideInput.addEventListener('change', applySubagentModelOverride);
			      subagentModelOverrideInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applySubagentModelOverride();
			      });
			    }

			    if (subagentTaskMaxOutputCharsInput) {
			      const applySubagentTaskMaxOutputChars = () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('subagentTaskMaxOutputCharsState')) {
			          updateSubagentTaskMaxOutputCharsState(subagentTaskMaxOutputChars);
			          clearInvalidFields([subagentTaskMaxOutputCharsInput]);
			          return;
			        }
			        const maxChars = Number(subagentTaskMaxOutputCharsInput.value);
			        if (!validateNumberField(subagentTaskMaxOutputCharsInput, maxChars, 500, 'Task subagent max output characters must be at least 500.')) return;
			        clearInvalidFields([subagentTaskMaxOutputCharsInput]);
			        postSettingWithPendingState(
			          'subagentTaskMaxOutputCharsState',
			          { type: 'setSubagentTaskMaxOutputChars', maxChars },
			          () => updateSubagentTaskMaxOutputCharsState(subagentTaskMaxOutputChars)
			        );
			      };
			      subagentTaskMaxOutputCharsInput.addEventListener('change', applySubagentTaskMaxOutputChars);
			      subagentTaskMaxOutputCharsInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applySubagentTaskMaxOutputChars();
			      });
			    }

			    if (autoCompactionToggle) {
			      autoCompactionToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('autoCompactionState')) {
			          autoCompactionToggle.checked = autoCompactionEnabled;
			          return;
			        }
			        const enabled = !!autoCompactionToggle.checked;
			        if (enabled === autoCompactionEnabled) return;
			        postSettingWithPendingState(
			          'autoCompactionState',
			          { type: 'setAutoCompaction', enabled },
			          () => updateAutoCompactionState(autoCompactionEnabled)
			        );
			      });
			    }

			    if (modelLimitsInput) {
			      modelLimitsInput.addEventListener('keydown', (e) => {
			        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			          e.preventDefault();
			          applyModelLimits();
			        }
			      });
			    }

			    if (modelLimitsApply) {
			      modelLimitsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyModelLimits();
			      });
			    }

			    if (compactionPruneToggle) {
			      compactionPruneToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing) {
			          compactionPruneToggle.checked = compactionPruneEnabled;
			          return;
			        }
			        applyCompactionPruneSettings();
			      });
			    }

			    if (compactionPruneProtectTokensInput) {
			      compactionPruneProtectTokensInput.addEventListener('change', applyCompactionPruneSettings);
			      compactionPruneProtectTokensInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyCompactionPruneSettings();
			      });
			    }

			    if (compactionPruneMinimumTokensInput) {
			      compactionPruneMinimumTokensInput.addEventListener('change', applyCompactionPruneSettings);
			      compactionPruneMinimumTokensInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyCompactionPruneSettings();
			      });
			    }

			    if (compactionToolOutputModeSelect) {
			      compactionToolOutputModeSelect.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('compactionToolOutputModeState')) {
			          compactionToolOutputModeSelect.value = compactionToolOutputMode;
			          return;
			        }
			        const mode = normalizeCompactionToolOutputMode(compactionToolOutputModeSelect.value);
			        if (mode === compactionToolOutputMode) return;
			        postSettingWithPendingState(
			          'compactionToolOutputModeState',
			          { type: 'setCompactionToolOutputMode', mode },
			          () => updateCompactionToolOutputModeState(compactionToolOutputMode)
			        );
			      });
			    }

			    if (planFirstToggle) {
			      planFirstToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('planFirstState')) {
			          planFirstToggle.checked = planFirstEnabled;
			          return;
			        }
			        const enabled = !!planFirstToggle.checked;
			        if (enabled === planFirstEnabled) return;
			        postSettingWithPendingState(
			          'planFirstState',
			          { type: 'setPlanFirst', enabled },
			          () => updatePlanFirstState(planFirstEnabled)
			        );
			      });
			    }

			    if (modelPicker) {
			      modelPicker.addEventListener('click', () => {
			        if (!initReceived || isProcessing || modelSwitchPending || modelFavoritePending || modelPickerOpenPending) return;
			        if (currentModelPickerState) {
			          updateModelPickerState(currentModelPickerState, { reveal: true });
			        }
			        modelPickerOpenPending = true;
			        armPendingActionTimer('modelPickerOpen', () => recoverPendingAction('modelPickerOpen', 'Model picker is taking longer than expected. Controls were re-enabled.', () => { modelPickerOpenPending = false; }));
			        syncInputState();
			        try {
			          vscode.postMessage({ type: 'showModelPicker' });
			        } catch {
			          clearPendingActionTimer('modelPickerOpen');
			          modelPickerOpenPending = false;
			          showInputNotice('Failed to request model picker.');
			          syncInputState();
			        }
			      });
			    }

			    if (reasoningEffortSelect) {
			      reasoningEffortSelect.addEventListener('change', () => {
			        if (!initReceived || isProcessing || reasoningEffortPending) {
			          reasoningEffortSelect.value = currentReasoningEffort;
			          return;
			        }
			        const next = reasoningEffortSelect.value;
			        if (next === currentReasoningEffort) return;
			        reasoningEffortSelect.value = currentReasoningEffort;
			        reasoningEffortPending = true;
			        armPendingActionTimer('reasoningEffort', () => recoverPendingAction('reasoningEffort', 'Reasoning effort update is taking longer than expected. Controls were re-enabled.', () => { reasoningEffortPending = false; if (reasoningEffortSelect) reasoningEffortSelect.value = currentReasoningEffort; }));
			        syncInputState();
				        try {
				          vscode.postMessage({ type: 'setReasoningEffort', reasoningEffort: next });
				        } catch {
				          clearPendingActionTimer('reasoningEffort');
				          reasoningEffortPending = false;
				          showInputNotice('Failed to update reasoning effort.');
				          syncInputState();
				        }
			      });
			    }

			    if (modelFavoriteToggle) {
			      modelFavoriteToggle.addEventListener('click', () => {
			        if (!initReceived || isProcessing || modelFavoritePending) return;
			        if (!currentModel) return;
			        modelFavoritePending = true;
			        armPendingActionTimer('modelFavorite', () => recoverPendingAction('modelFavorite', 'Favorite update is taking longer than expected. Controls were re-enabled.', () => { modelFavoritePending = false; }));
			        syncInputState();
				        try { vscode.postMessage({ type: 'toggleFavoriteModel', model: currentModel }); } catch {
				          clearPendingActionTimer('modelFavorite');
				          modelFavoritePending = false;
				          showInputNotice('Failed to update favorite model.');
				          syncInputState();
				        }
			      });
			    }

			    if (modelSettings) {
			      modelSettings.addEventListener('click', (e) => {
			        e.preventDefault();
			        e.stopPropagation();
			        if (!initReceived || isProcessing) return;
			        toggleModelSettingsPopover();
			      });
			    }

			    if (modelSettingsClose) {
			      modelSettingsClose.addEventListener('click', (e) => {
			        e.preventDefault();
			        closeModelSettingsPopover();
			      });
			    }

			    if (customModelApply) {
			      customModelApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyCustomModelId();
			      });
			    }

			    if (customModelInput) {
			      customModelInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') {
			          e.preventDefault();
			          applyCustomModelId();
			        }
			      });
			    }

			    if (modelRefreshList) {
			      modelRefreshList.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || modelPickerRefreshPending || modelSwitchPending || modelFavoritePending) return;
			        modelPickerRefreshPending = true;
			        armPendingActionTimer('modelPickerRefresh', () => recoverPendingAction('modelPickerRefresh', 'Model refresh is taking longer than expected. Controls were re-enabled.', () => { modelPickerRefreshPending = false; }));
			        syncInputState();
				        try { vscode.postMessage({ type: 'refreshModels' }); } catch {
				          clearPendingActionTimer('modelPickerRefresh');
				          modelPickerRefreshPending = false;
				          showInputNotice('Failed to refresh models.');
				          syncInputState();
				        }
			      });
			    }

			    if (modelPickerSearchInput) {
			      modelPickerSearchInput.addEventListener('input', () => {
			        modelPickerSearchQuery = String(modelPickerSearchInput.value || '');
			        updateModelPickerState(currentModelPickerState, { reveal: !modelPickerList || !modelPickerList.classList.contains('hidden') });
			      });
			      modelPickerSearchInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Escape') {
			          modelPickerSearchInput.value = '';
			          modelPickerSearchQuery = '';
			          updateModelPickerState(currentModelPickerState, { reveal: !modelPickerList || !modelPickerList.classList.contains('hidden') });
			        }
			      });
			    }

			    if (modelClearRecents) {
			      modelClearRecents.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || modelPickerRefreshPending || modelSwitchPending || modelFavoritePending) return;
			        modelPickerRefreshPending = true;
			        armPendingActionTimer('modelPickerRefresh', () => recoverPendingAction('modelPickerRefresh', 'Clearing recent models is taking longer than expected. Controls were re-enabled.', () => { modelPickerRefreshPending = false; }));
			        syncInputState();
				        try { vscode.postMessage({ type: 'clearRecentModels' }); } catch {
				          clearPendingActionTimer('modelPickerRefresh');
				          modelPickerRefreshPending = false;
				          showInputNotice('Failed to clear recent models.');
				          syncInputState();
				        }
			      });
			    }

			    if (modelSettingsApply) {
			      modelSettingsApply.addEventListener('click', (e) => {
			        e.preventDefault();
			        applyGenerationSettings();
			      });
			    }

			    if (modelSettingsOpenSettings) {
			      modelSettingsOpenSettings.addEventListener('click', (e) => {
			        e.preventDefault();
			        if (!initReceived || isProcessing || advancedModelSettingsPending) return;
			        advancedModelSettingsPending = true;
			        armPendingActionTimer('advancedModelSettings', () => recoverPendingAction('advancedModelSettings', 'Advanced model settings action is taking longer than expected. Controls were re-enabled.', () => { advancedModelSettingsPending = false; }));
			        syncInputState();
			        try {
			          vscode.postMessage({ type: 'openAdvancedModelSettings' });
			        } catch {
			          clearPendingActionTimer('advancedModelSettings');
			          advancedModelSettingsPending = false;
			          showInputNotice('Failed to request advanced model settings.');
			          syncInputState();
			        }
			      });
			    }

			    if (temperatureInput) {
			      temperatureInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyGenerationSettings();
			      });
			    }

			    if (topPInput) {
			      topPInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyGenerationSettings();
			      });
			    }

			    if (topKInput) {
			      topKInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyGenerationSettings();
			      });
			    }

			    if (maxOutputTokensInput) {
			      maxOutputTokensInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyGenerationSettings();
			      });
			    }

			    if (maxRetriesInput) {
			      maxRetriesInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyGenerationSettings();
			      });
			    }

			    if (llmTimeoutInput) {
			      llmTimeoutInput.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') applyGenerationSettings();
			      });
			    }

			    if (providerAuthPrimary) {
			      providerAuthPrimary.addEventListener('click', () => {
			        if (!initReceived || isProcessing || providerAuthBusy) return;
			        if (!currentProviderAuth || currentProviderAuth.status === 'hidden') return;
			        if (currentProviderAuth.authenticated) return;
			        providerAuthBusy = true;
			        armPendingActionTimer('providerAuth', () => recoverPendingAction('providerAuth', 'Provider authentication is taking longer than expected. Controls were re-enabled.', () => { providerAuthBusy = false; updateProviderAuthHeader(currentProviderAuth); }));
			        updateProviderAuthHeader(currentProviderAuth);
			        syncInputState();
				        try {
				          vscode.postMessage({ type: 'authenticateProvider' });
				        } catch {
				          clearPendingActionTimer('providerAuth');
				          providerAuthBusy = false;
				          showInputNotice('Failed to request provider authentication.');
				          updateProviderAuthHeader(currentProviderAuth);
				          syncInputState();
				        }
			      });
			    }

			    if (providerAuthSecondary) {
			      providerAuthSecondary.addEventListener('click', () => {
			        if (!initReceived || isProcessing || providerAuthBusy) return;
			        if (!currentProviderAuth || !currentProviderAuth.authenticated) return;
			        providerAuthBusy = true;
			        armPendingActionTimer('providerAuth', () => recoverPendingAction('providerAuth', 'Provider disconnect is taking longer than expected. Controls were re-enabled.', () => { providerAuthBusy = false; updateProviderAuthHeader(currentProviderAuth); }));
			        updateProviderAuthHeader(currentProviderAuth);
			        syncInputState();
				        try {
				          vscode.postMessage({ type: 'disconnectProvider' });
				        } catch {
				          clearPendingActionTimer('providerAuth');
				          providerAuthBusy = false;
				          showInputNotice('Failed to request provider disconnect.');
				          updateProviderAuthHeader(currentProviderAuth);
				          syncInputState();
				        }
			      });
			    }

    function inferImageFileName(mediaType, fallbackName) {
      const trimmed = typeof fallbackName === 'string' ? fallbackName.trim() : '';
      if (trimmed) return trimmed;
      const type = typeof mediaType === 'string' ? mediaType.trim().toLowerCase() : '';
      const slash = type.indexOf('/');
      const ext = slash >= 0 ? type.slice(slash + 1).replace(/[^a-z0-9.+-]/g, '') : '';
      return ext ? ('image.' + ext) : 'image.png';
    }

    function showInputNotice(message) {
      inputNoticeMessage = typeof message === 'string' ? message.trim() : '';
      if (inputNoticeTimer) {
        clearTimeout(inputNoticeTimer);
        inputNoticeTimer = null;
      }
	      if (inputNoticeMessage) {
	        announceStatus(inputNoticeMessage);
	        inputNoticeTimer = setTimeout(() => {
	          inputNoticeMessage = '';
	          inputNoticeTimer = null;
	          syncInputState();
	        }, INPUT_NOTICE_DURATION_MS);
	      }
	      syncInputState();

    }

    function renderInputAttachments() {
      if (!inputAttachments) return;
      inputAttachments.innerHTML = '';

      if (!pendingImageAttachments.length) {
        inputAttachments.classList.add('hidden');
        return;
      }

      inputAttachments.classList.remove('hidden');
      for (let i = 0; i < pendingImageAttachments.length; i++) {
        const attachment = pendingImageAttachments[i];
        const chip = document.createElement('div');
        chip.className = 'input-attachment-chip';
        chip.dataset.attachmentId = attachment.id;

        const label = document.createElement('span');
        label.className = 'input-attachment-label';
        label.textContent = inferImageFileName(attachment.mediaType, attachment.filename);
        label.title = attachment.mediaType || 'image';
        chip.appendChild(label);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'input-attachment-remove';
        removeBtn.dataset.attachmentId = attachment.id;
        removeBtn.setAttribute('aria-label', 'Remove image attachment');
        removeBtn.title = 'Remove image';
        removeBtn.textContent = '✕';
        chip.appendChild(removeBtn);

        inputAttachments.appendChild(chip);
      }
    }

    function clearPendingImageAttachments() {
      if (!pendingImageAttachments.length) return;
      pendingImageAttachments = [];
      renderInputAttachments();
    }

    function removePendingImageAttachmentById(attachmentId) {
      if (!attachmentId) return;
      const before = pendingImageAttachments.length;
      pendingImageAttachments = pendingImageAttachments.filter((item) => item.id !== attachmentId);
      if (pendingImageAttachments.length === before) return;
      renderInputAttachments();
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            } else {
              reject(new Error('Clipboard image read failed'));
            }
          };
          reader.onerror = () => reject(reader.error || new Error('Clipboard image read failed'));
          reader.readAsDataURL(file);
        } catch (err) {
          reject(err);
        }
      });
    }

    async function handleClipboardPaste(e) {
      if (!initReceived) return;

      const items = e && e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
      if (!items.length) return;

      const imageItems = [];
      for (const item of items) {
        if (!item || item.kind !== 'file') continue;
        const mediaType = typeof item.type === 'string' ? item.type.toLowerCase() : '';
        if (mediaType.startsWith('image/')) imageItems.push(item);
      }
      if (!imageItems.length) return;

      const slotsLeft = MAX_CLIPBOARD_IMAGES - pendingImageAttachments.length;
      if (slotsLeft <= 0) {
        showInputNotice('Image limit reached (' + MAX_CLIPBOARD_IMAGES + '). Remove an image before pasting more.');
        return;
      }

      const imageFiles = [];
      let skippedForLimit = 0;
      let skippedUnreadable = 0;
      for (const item of imageItems) {
        if (imageFiles.length >= slotsLeft) {
          skippedForLimit += 1;
          continue;
        }
        const file = item.getAsFile ? item.getAsFile() : null;
        if (!file) {
          skippedUnreadable += 1;
          continue;
        }
        imageFiles.push(file);
      }

      if (!imageFiles.length) {
        if (skippedUnreadable > 0) showInputNotice('Could not read pasted image from the clipboard.');
        return;
      }

      const next = [];
      let skippedTooLarge = 0;
      for (const file of imageFiles) {
        const mediaType = typeof file.type === 'string' ? file.type.trim() : '';
        if (!mediaType.toLowerCase().startsWith('image/')) {
          skippedUnreadable += 1;
          continue;
        }

        let dataUrl = '';
        try {
          dataUrl = String(await readFileAsDataUrl(file));
        } catch {
          skippedUnreadable += 1;
          continue;
        }

        const trimmedData = dataUrl.trim();
        if (!trimmedData.startsWith('data:image/')) {
          skippedUnreadable += 1;
          continue;
        }
        if (trimmedData.length > MAX_CLIPBOARD_IMAGE_DATA_URL_CHARS) {
          skippedTooLarge += 1;
          continue;
        }

        next.push({
          id: String(Date.now()) + '_' + Math.random().toString(16).slice(2),
          mediaType,
          filename: typeof file.name === 'string' ? file.name : '',
          dataUrl: trimmedData,
        });
      }

      if (!next.length) {
        if (skippedTooLarge > 0) {
          showInputNotice('Pasted image is too large. Use an image under about ' + Math.floor(MAX_CLIPBOARD_IMAGE_DATA_URL_CHARS / 1000000) + ' MB.');
        } else if (skippedUnreadable > 0) {
          showInputNotice('Could not read pasted image from the clipboard.');
        }
        return;
      }

      pendingImageAttachments = pendingImageAttachments.concat(next).slice(0, MAX_CLIPBOARD_IMAGES);
      renderInputAttachments();
      if (skippedForLimit > 0 || skippedTooLarge > 0 || skippedUnreadable > 0) {
        const skipped = skippedForLimit + skippedTooLarge + skippedUnreadable;
        showInputNotice('Attached ' + next.length + ' image' + (next.length === 1 ? '' : 's') + '; skipped ' + skipped + '.');
      } else {
        showInputNotice('');
      }
      syncInputState();
    }

    function updateInputLayout() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      clearInputBtn.disabled = !input.value.trim() && pendingImageAttachments.length === 0;
    }

    function applyInputHistoryValue(value, position) {
      input.value = typeof value === 'string' ? value : '';
      updateInputLayout();
      syncInputState();
      const pos = position === 'start' ? 0 : input.value.length;
      try { input.setSelectionRange(pos, pos); } catch {}
      try { input.focus(); } catch {}
    }

    function navigateInputHistory(direction) {
      const entries = inputHistoryEntries;
      const current = inputHistoryIndex;

      if (direction === 'up') {
        if (entries.length === 0) return false;
        if (current === -1) {
          inputHistorySavedDraft = input.value;
          inputHistoryIndex = 0;
          applyInputHistoryValue(entries[0], 'start');
          return true;
        }
        if (current < entries.length - 1) {
          const next = current + 1;
          inputHistoryIndex = next;
          applyInputHistoryValue(entries[next], 'start');
          return true;
        }
        return false;
      }

      if (current > 0) {
        const next = current - 1;
        inputHistoryIndex = next;
        applyInputHistoryValue(entries[next], 'end');
        return true;
      }
      if (current === 0) {
        inputHistoryIndex = -1;
        const saved = inputHistorySavedDraft;
        inputHistorySavedDraft = null;
        applyInputHistoryValue(typeof saved === 'string' ? saved : '', 'end');
        return true;
      }

      return false;
    }

    input.addEventListener('input', () => {
      updateInputLayout();
      syncInputState();
      if (inputHistoryIndex >= 0) {
        inputHistoryIndex = -1;
        inputHistorySavedDraft = null;
      }
      updateSkillDropdown();
    });

    input.addEventListener('click', () => updateSkillDropdown());
    input.addEventListener('keyup', () => updateSkillDropdown());
    input.addEventListener('focus', () => updateSkillDropdown());
    input.addEventListener('paste', (e) => {
      void handleClipboardPaste(e);
    });

    if (inputAttachments) {
      inputAttachments.addEventListener('click', (e) => {
        const target = e && e.target && e.target.closest ? e.target.closest('.input-attachment-remove') : null;
        if (!target) return;
        const attachmentId = target.dataset.attachmentId || '';
        if (!attachmentId) return;
        removePendingImageAttachmentById(attachmentId);
        syncInputState();
      });
    }

	    if (skillsToggle) {
	      skillsToggle.addEventListener('change', () => {
	        if (!initReceived || isProcessing || hasPendingSettingState('skillsEnabledState')) {
	          skillsToggle.checked = skillsEnabled;
	          return;
	        }
	        const enabled = !!skillsToggle.checked;
	        if (enabled === skillsEnabled) return;
	        postSettingWithPendingState(
	          'skillsEnabledState',
	          { type: 'setSkillsEnabled', enabled },
	          () => updateSkillsEnabledState(skillsEnabled)
	        );
	      });
	    }

	    function closeSkillsSettingsPopover() {
	      if (skillsSettingsPopover) skillsSettingsPopover.classList.add('hidden');
	    }

	    function openSkillsSettingsPopover() {
	      if (!skillsSettingsPopover) return;
	      clearInvalidFields([skillSearchPathsInput, skillsMaxPromptInput, skillsMaxInjectInput, skillsMaxInjectCharsInput]);
	      updateSkillsBudgetState(skillsBudget);
	      updateSkillSearchPathsState(skillSearchPaths);
	      skillsSettingsPopover.classList.remove('hidden');
	    }

	    function toggleSkillsSettingsPopover() {
	      if (!skillsSettingsPopover) return;
	      if (skillsSettingsPopover.classList.contains('hidden')) {
	        openSkillsSettingsPopover();
	      } else {
	        closeSkillsSettingsPopover();
	      }
	    }

	    function applySkillSearchPaths() {
	      if (!initReceived || isProcessing || hasPendingSettingState('skillSearchPathsState')) {
	        updateSkillSearchPathsState(skillSearchPaths);
	        clearInvalidFields([skillSearchPathsInput]);
	        return;
	      }
	      const paths = normalizeSkillSearchPaths(skillSearchPathsInput ? skillSearchPathsInput.value : skillSearchPaths);
	      if (paths.some((pathValue) => pathValue.length > 240)) {
	        markInvalidField(skillSearchPathsInput, 'Skill search paths must be 240 characters or shorter.');
	        return;
	      }
	      clearInvalidFields([skillSearchPathsInput]);
	      postSettingWithPendingState(
	        'skillSearchPathsState',
	        { type: 'setSkillSearchPaths', paths },
	        () => updateSkillSearchPathsState(skillSearchPaths)
	      );
	    }

	    function applySkillsBudget() {
	      const fields = [skillsMaxPromptInput, skillsMaxInjectInput, skillsMaxInjectCharsInput, skillSearchPathsInput];
	      const pending = hasPendingSettingState('skillsBudgetState') || hasPendingSettingState('skillSearchPathsState');
	      if (!initReceived || isProcessing || pending) {
	        updateSkillsBudgetState(skillsBudget);
	        updateSkillSearchPathsState(skillSearchPaths);
	        clearInvalidFields(fields);
	        return;
	      }
	      const maxPromptSkills = Number(skillsMaxPromptInput ? skillsMaxPromptInput.value : skillsBudget.maxPromptSkills);
	      const maxInjectSkills = Number(skillsMaxInjectInput ? skillsMaxInjectInput.value : skillsBudget.maxInjectSkills);
	      const maxInjectChars = Number(skillsMaxInjectCharsInput ? skillsMaxInjectCharsInput.value : skillsBudget.maxInjectChars);
	      const paths = normalizeSkillSearchPaths(skillSearchPathsInput ? skillSearchPathsInput.value : skillSearchPaths);
	      if (!validateNumberField(skillsMaxPromptInput, maxPromptSkills, 0, 'Prompt skill suggestions must be 0 or greater.')) return;
	      if (!validateNumberField(skillsMaxInjectInput, maxInjectSkills, 1, 'Injected skills must be at least 1.')) return;
	      if (!validateNumberField(skillsMaxInjectCharsInput, maxInjectChars, 1, 'Injected skill character budget must be at least 1.')) return;
	      if (paths.some((pathValue) => pathValue.length > 240)) {
	        markInvalidField(skillSearchPathsInput, 'Skill search paths must be 240 characters or shorter.');
	        return;
	      }
	      clearInvalidFields(fields);
	      const budget = { maxPromptSkills, maxInjectSkills, maxInjectChars };
	      postSettingsWithPendingStates(
	        ['skillsBudgetState', 'skillSearchPathsState'],
	        [
	          { type: 'setSkillsBudget', budget },
	          { type: 'setSkillSearchPaths', paths },
	        ],
	        () => {
	          updateSkillsBudgetState(skillsBudget);
	          updateSkillSearchPathsState(skillSearchPaths);
	        }
	      );
	    }

	    if (skillsSettings) {
	      skillsSettings.addEventListener('click', () => {
	        if (!initReceived || isProcessing) return;
	        toggleSkillsSettingsPopover();
	      });
	    }
	    if (skillsSettingsClose) {
	      skillsSettingsClose.addEventListener('click', closeSkillsSettingsPopover);
	    }
	    if (skillsSettingsApply) {
	      skillsSettingsApply.addEventListener('click', applySkillsBudget);
	    }
	    if (skillSearchPathsInput) {
	      skillSearchPathsInput.addEventListener('keydown', (e) => {
	        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
	          e.preventDefault();
	          applySkillsBudget();
	        }
	      });
	    }
	    [skillsMaxPromptInput, skillsMaxInjectInput, skillsMaxInjectCharsInput].forEach((el) => {
	      if (!el) return;
	      el.addEventListener('keydown', (e) => {
	        if (e.key === 'Enter') applySkillsBudget();
	      });
	    });

	    if (skillDropdown) {
	      skillDropdown.addEventListener('mousedown', (e) => {
        // Keep focus in the textarea when selecting a skill.
        e.preventDefault();
      });

      skillDropdown.addEventListener('click', (e) => {
        const item = e.target && e.target.closest ? e.target.closest('.skill-dropdown-item') : null;
        if (!item) return;
        const idx = Number(item.dataset.index);
        if (!Number.isFinite(idx)) return;
        skillDropdownSelectedIndex = Math.max(0, Math.min(idx, (skillDropdownItems || []).length - 1));
        applySelectedSkill();
      });
    }

    input.addEventListener('keydown', (e) => {
      if (skillDropdownOpen) {
        const noModifiers = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && noModifiers) {
          e.preventDefault();
          moveSkillDropdownSelection(e.key === 'ArrowDown' ? 1 : -1);
          return;
        }

        if (e.key === 'Tab' && noModifiers) {
          if (applySelectedSkill()) {
            e.preventDefault();
            return;
          }
        }

        if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
          if (applySelectedSkill()) {
            e.preventDefault();
            return;
          }
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          closeSkillDropdown();
          return;
        }
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!initReceived || isProcessing) return;
        if (input.selectionStart !== input.selectionEnd) return;

        const text = input.value || '';
        const caret = input.selectionStart || 0;
        const isEmpty = text.trim() === '';
        const hasNewlines = text.includes('\n');
        const inHistory = inputHistoryIndex >= 0;
        const atStart = caret <= 0;
        const atEnd = caret >= text.length;
        const allowUp = isEmpty || atStart || (!hasNewlines && !inHistory) || (inHistory && atEnd);
        const allowDown = isEmpty || atEnd || (!hasNewlines && !inHistory) || (inHistory && atStart);

        if (e.key === 'ArrowUp') {
          if (!allowUp) return;
          if (navigateInputHistory('up')) e.preventDefault();
          return;
        }

        if (!allowDown) return;
        if (navigateInputHistory('down')) e.preventDefault();
        return;
      }

	      if (e.key === 'Enter' && !e.shiftKey) {
	        e.preventDefault();
	        send();
	      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (revertBar && !revertBar.hidden) {
          revertBar.hidden = true;
        } else {
          input.blur();
        }
      }
      if (e.key === '.' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        requestAbort();
      }
    });

	    clearInputBtn.addEventListener('click', () => {
      inputHistoryIndex = -1;
      inputHistorySavedDraft = null;
      input.value = '';
      clearPendingImageAttachments();
      updateInputLayout();
      syncInputState();
      closeSkillDropdown();
      input.focus();
    });

	    sendBtn.addEventListener('click', () => send());

	    if (stopBtn) {
	      stopBtn.addEventListener('click', requestAbort);
	    }

		    if (queueClearBtn) {
		      queueClearBtn.addEventListener('click', () => {
		        if (!initReceived || queueClearPending || queueSteerPendingId || queuedInputs.length <= 0) return;
		        queueClearPending = true;
		        armPendingActionTimer('queueAction', () => recoverPendingAction('queueAction', 'Queue action is taking longer than expected. Controls were re-enabled.', () => { queueClearPending = false; queueSteerPendingId = ''; try { setQueueState(queuedInputs); } catch {} }));
		        try { setQueueState(queuedInputs); } catch {}
		        try {
		          vscode.postMessage({ type: 'clearQueue' });
		        } catch {
		          clearPendingActionTimer('queueAction');
		          queueClearPending = false;
		          showInputNotice('Failed to request queue clear.');
		          try { setQueueState(queuedInputs); } catch {}
		        }
	      });
	    }

	    if (approvalAllowAllBtn) {
	      approvalAllowAllBtn.addEventListener('click', () => {
	        if (!initReceived || !isProcessing || approveAllPending || abortRequestPending) return;
	        if (pendingApprovalsCount <= 0 || manualApprovalsCount > 0) return;
	        approveAllPending = true;
	        armPendingActionTimer('approveAll', () => recoverPendingAction('approveAll', 'Approve-all action is taking longer than expected. Controls were re-enabled.', () => { approveAllPending = false; updateApprovalBanner(); }));
	        updateApprovalBanner();
	        try {
	          vscode.postMessage({ type: 'approveAll' });
	        } catch {
	          clearPendingActionTimer('approveAll');
	          approveAllPending = false;
	          showInputNotice('Failed to approve pending tool calls.');
	          updateApprovalBanner();
	        }
	      });
	    }
	    if (approvalStopBtn) {
	      approvalStopBtn.addEventListener('click', requestAbort);
	    }

	    document.addEventListener('click', (e) => {
      const target = e && e.target ? e.target : null;
      if (skillDropdownOpen) {
        const clickedDropdown = !!(skillDropdown && target && skillDropdown.contains && skillDropdown.contains(target));
        const clickedInput = target === input;
        if (!clickedDropdown && !clickedInput) {
          closeSkillDropdown();
        }
      }

      if (modelSettingsPopover && !modelSettingsPopover.classList.contains('hidden')) {
        const clickedPopover = !!(target && modelSettingsPopover.contains && modelSettingsPopover.contains(target));
        const clickedButton = !!(target && modelSettings && modelSettings.contains && modelSettings.contains(target));
        if (!clickedPopover && !clickedButton) {
          closeModelSettingsPopover();
        }
      }

      if (providerSettingsPopover && !providerSettingsPopover.classList.contains('hidden')) {
        const clickedPopover = !!(target && providerSettingsPopover.contains && providerSettingsPopover.contains(target));
        const clickedButton = !!(target && providerSettings && providerSettings.contains && providerSettings.contains(target));
        if (!clickedPopover && !clickedButton) {
          closeProviderSettingsPopover();
        }
      }

      if (sessionSettingsPopover && !sessionSettingsPopover.classList.contains('hidden')) {
        const clickedPopover = !!(target && sessionSettingsPopover.contains && sessionSettingsPopover.contains(target));
        const clickedButton = !!(target && sessionSettings && sessionSettings.contains && sessionSettings.contains(target));
        if (!clickedPopover && !clickedButton) {
          closeSessionSettingsPopover();
        }
      }

      if (loopSettingsPopover && !loopSettingsPopover.classList.contains('hidden')) {
        const clickedPopover = !!(target && loopSettingsPopover.contains && loopSettingsPopover.contains(target));
        const clickedButton = !!(target && loopControlBtn && loopControlBtn.contains && loopControlBtn.contains(target));
        if (!clickedPopover && !clickedButton) {
          closeLoopSettingsPopover();
        }
      }

      if (safetySettingsPopover && !safetySettingsPopover.classList.contains('hidden')) {
        const clickedPopover = !!(target && safetySettingsPopover.contains && safetySettingsPopover.contains(target));
        const clickedButton = !!(target && safetySettings && safetySettings.contains && safetySettings.contains(target));
        if (!clickedPopover && !clickedButton) {
          closeSafetySettingsPopover();
        }
      }

      if (skillsSettingsPopover && !skillsSettingsPopover.classList.contains('hidden')) {
        const clickedPopover = !!(target && skillsSettingsPopover.contains && skillsSettingsPopover.contains(target));
        const clickedButton = !!(target && skillsSettings && skillsSettings.contains && skillsSettings.contains(target));
        if (!clickedPopover && !clickedButton) {
          closeSkillsSettingsPopover();
        }
      }

      const quickAction = target && target.closest ? target.closest('.quick-action') : null;
      if (quickAction) {
        const cmd = quickAction.dataset.cmd;
        if (cmd) {
          inputHistoryIndex = -1;
          inputHistorySavedDraft = null;
          input.value = cmd;
          updateInputLayout();
          syncInputState();
          input.focus();
        }
      }
	    });

	    document.addEventListener('keydown', (e) => {
	      if (!e || e.key !== 'Escape') return;
	      if (modelSettingsPopover && !modelSettingsPopover.classList.contains('hidden')) {
	        closeModelSettingsPopover();
	      }
	      if (providerSettingsPopover && !providerSettingsPopover.classList.contains('hidden')) {
	        closeProviderSettingsPopover();
	      }
	      if (sessionSettingsPopover && !sessionSettingsPopover.classList.contains('hidden')) {
	        closeSessionSettingsPopover();
	      }
	      if (loopSettingsPopover && !loopSettingsPopover.classList.contains('hidden')) {
	        closeLoopSettingsPopover();
	      }
	      if (safetySettingsPopover && !safetySettingsPopover.classList.contains('hidden')) {
	        closeSafetySettingsPopover();
	      }
	      if (skillsSettingsPopover && !skillsSettingsPopover.classList.contains('hidden')) {
	        closeSkillsSettingsPopover();
	      }
	    });

		    const defaultPlaceholder = input.placeholder || 'Describe a task...';

			    function send() {
			      const text = input.value.trim();
			      const hasAttachments = pendingImageAttachments.length > 0;
			      const requiresText = planPending && currentMode === 'plan' && !isProcessing;
			      if (!initReceived) return;
			      if (requiresText && !text) return;
		      if (!text && !hasAttachments) return;
		      closeSkillDropdown();
		      inputHistoryIndex = -1;
		      inputHistorySavedDraft = null;
		      if (text) {
		        addToInputHistory(text);
			      }
			      try {
			        vscode.postMessage({
			          type: 'send',
			          message: text,
			          attachments: pendingImageAttachments.map((attachment) => ({
			            mediaType: attachment.mediaType,
			            dataUrl: attachment.dataUrl,
		            ...(attachment.filename ? { filename: attachment.filename } : {}),
		          })),
		        });
		      } catch {
		        showInputNotice('Failed to send message.');
		        syncInputState();
		        return;
		      }
		      input.value = '';
		      clearPendingImageAttachments();
			      updateInputLayout();
			      syncInputState();
			    }

				    function setQueueState(next, options) {
				      queuedInputs = Array.isArray(next) ? next : [];
				      const count = queuedInputs.length;
				      if (queueBanner) {
				        if (count <= 0) {
				          queueBanner.classList.add('hidden');
				        } else {
				          queueBanner.classList.remove('hidden');
				          if (queueBannerCount) queueBannerCount.textContent = count === 1 ? '1 queued' : count + ' queued';
				          if (queueBannerText) {
				            queueBannerText.textContent = isProcessing
				              ? 'Queued for the next step'
				              : 'Queued messages ready to run';
				          }
				          if (queueBannerHint) {
				            queueBannerHint.textContent = isProcessing
				              ? 'Click a queued message to steer it into the current run.'
				              : 'Click a queued message to run it now.';
				          }
				        }
				      }
				      const queueActionBusy = queueClearPending || !!queueSteerPendingId;
				      if (queueClearBtn) {
				        queueClearBtn.disabled = !initReceived || count <= 0 || queueActionBusy;
				      }
				      if (queueItems) {
				        const renderItems = [];
				        for (const item of queuedInputs) {
				          if (!item || typeof item !== 'object') continue;
				          const id = typeof item.id === 'string' ? item.id : '';
				          if (!id) continue;
				          const previewRaw =
				            typeof item.displayContent === 'string' && item.displayContent.trim()
				              ? item.displayContent.trim()
				              : typeof item.message === 'string'
				                ? item.message.trim()
				                : '';
				          const preview = previewRaw.length > 96 ? previewRaw.slice(0, 93) + '…' : previewRaw;
				          const attachmentCount = Number(item.attachmentCount || 0);
				          const itemPending = queueSteerPendingId === id;
				          renderItems.push({
				            id,
				            preview: preview || 'Queued message',
				            attachmentCount: Number.isFinite(attachmentCount) && attachmentCount > 0 ? attachmentCount : 0,
				            disabled: !initReceived || queueActionBusy,
				            label: itemPending ? 'Working…' : isProcessing ? 'Steer now' : 'Run now',
				            title: itemPending
				              ? 'Queued message action is pending…'
				              : isProcessing ? 'Steer this queued message now' : 'Run this queued message now',
				          });
				        }

				        const nextQueueItemsRenderKey = JSON.stringify(renderItems);
				        if (nextQueueItemsRenderKey !== lastQueueItemsRenderKey) {
				          queueItems.innerHTML = '';
				          const fragment = typeof document.createDocumentFragment === 'function'
				            ? document.createDocumentFragment()
				            : queueItems;
				          for (const renderItem of renderItems) {
				            const btn = document.createElement('button');
				            btn.type = 'button';
				            btn.className = 'queue-item';
				            btn.dataset.id = renderItem.id;
				            btn.disabled = renderItem.disabled;
				            btn.title = renderItem.title;

				            const bodyEl = document.createElement('span');
				            bodyEl.className = 'queue-item-body';

				            const labelEl = document.createElement('span');
				            labelEl.className = 'queue-item-label';
				            labelEl.textContent = renderItem.label;

				            const textEl = document.createElement('span');
				            textEl.className = 'queue-item-text';
				            textEl.textContent = renderItem.preview;

				            let metaEl;
				            if (renderItem.attachmentCount > 0) {
				              metaEl = document.createElement('span');
				              metaEl.className = 'queue-item-meta';
				              metaEl.textContent = renderItem.attachmentCount === 1 ? '1 image' : renderItem.attachmentCount + ' images';
				              metaEl.title = metaEl.textContent + ' attached';
				            }

				            btn.addEventListener('click', () => {
				              if (!initReceived || queueClearPending || queueSteerPendingId) return;
				              queueSteerPendingId = renderItem.id;
				              armPendingActionTimer('queueAction', () => recoverPendingAction('queueAction', 'Queue action is taking longer than expected. Controls were re-enabled.', () => { queueClearPending = false; queueSteerPendingId = ''; try { setQueueState(queuedInputs); } catch {} }));
				              try { setQueueState(queuedInputs); } catch {}
				              try {
				                vscode.postMessage({ type: 'steerQueuedInput', id: renderItem.id });
				              } catch {
				                clearPendingActionTimer('queueAction');
				                queueSteerPendingId = '';
				                showInputNotice('Failed to request queued message.');
				                try { setQueueState(queuedInputs); } catch {}
				              }
				            });

				            bodyEl.appendChild(labelEl);
				            bodyEl.appendChild(textEl);
				            if (metaEl) bodyEl.appendChild(metaEl);
				            btn.appendChild(bodyEl);

				            fragment.appendChild(btn);
				          }
				          if (fragment !== queueItems) queueItems.appendChild(fragment);
				          lastQueueItemsRenderKey = nextQueueItemsRenderKey;
				        }
				      }
				      if (!options || options.sync !== false) syncInputState();
				    }

	    function setSendButtonPresentation(icon, label, title) {
	      const nextKey = String(icon || '') + '\u0000' + String(label || '') + '\u0000' + String(title || '');
	      if (sendButtonPresentationKey !== nextKey) {
	        const iconEl = document.createElement('span');
	        iconEl.textContent = String(icon || '');
	        const labelEl = document.createElement('span');
	        labelEl.textContent = String(label || '');
	        if (typeof sendBtn.replaceChildren === 'function') {
	          sendBtn.replaceChildren(iconEl, labelEl);
	        } else {
	          sendBtn.innerHTML = '';
	          sendBtn.appendChild(iconEl);
	          sendBtn.appendChild(labelEl);
	        }
	        sendBtn.title = String(title || '');
	        sendButtonPresentationKey = nextKey;
	      }
	      if (sendBtn.classList.contains('stop')) sendBtn.classList.remove('stop');
	    }

	    function setSendButtonDisabled(disabled) {
	      const disabledFlag = !!disabled;
	      if (sendBtn.disabled !== disabledFlag) sendBtn.disabled = disabledFlag;
	    }

		    function syncInputState() {
		      const connected = initReceived;
		      const showPlanUpdate = planPending && currentMode === 'plan';
		      const hasContent = showPlanUpdate
		        ? !!input.value.trim()
		        : (!!input.value.trim() || pendingImageAttachments.length > 0);
		      input.disabled = !connected;
		      input.placeholder = connected
	        ? (showPlanUpdate ? 'Answer plan questions / add constraints…' : defaultPlaceholder)
	        : 'Connecting…';
		      clearInputBtn.disabled = !connected || (!input.value.trim() && pendingImageAttachments.length === 0);
		      const sessionActionBusy = !!sessionActionPending;
		      if ((!connected || isProcessing || sessionActionBusy) && sessionClearConfirmAction) {
		        setSessionClearConfirmAction('', { sync: false });
		      }
		      if (newSessionBtn) newSessionBtn.disabled = !connected || isProcessing || sessionActionBusy;
		      if (compactSessionBtn) compactSessionBtn.disabled = !connected || isProcessing || sessionActionBusy;
		      const loopSettingsPending = hasPendingSettingState('loopState') || hasPendingSettingState('loopDefaultsState');
		      const loopControlsDisabled = !connected || isProcessing || currentLoop.available === false || loopSettingsPending;
		      if (loopControlBtn) loopControlBtn.disabled = loopControlsDisabled;
		      setLoopInputsDisabled(loopControlsDisabled);
		      if (!connected || isProcessing || currentLoop.available === false) closeLoopSettingsPopover();
		      const revertActionBusy = !!revertActionPending;
		      if (undoBtn) undoBtn.disabled = !connected || isProcessing || revertActionBusy || !canUndo;
		      if (redoBtn) redoBtn.disabled = !connected || isProcessing || revertActionBusy || !canRedo;
		      if (sessionSelect) sessionSelect.disabled = !connected || isProcessing || sessionSwitchPending;
		      if (sessionSettings) sessionSettings.disabled = !connected || isProcessing;
		      const sessionsPersistDisabled = !connected || isProcessing || hasPendingSettingState('sessionsPersistState');
		      if (sessionsPersistToggle) sessionsPersistToggle.disabled = sessionsPersistDisabled;
		      if (sessionsPersistLabel) sessionsPersistLabel.classList.toggle('disabled', sessionsPersistDisabled);
		      const sessionRetentionDisabled = !connected || isProcessing || hasPendingSettingState('sessionRetentionState');
		      if (sessionsMaxSessionsInput) sessionsMaxSessionsInput.disabled = sessionRetentionDisabled;
		      if (sessionsMaxSessionBytesInput) sessionsMaxSessionBytesInput.disabled = sessionRetentionDisabled;
		      if (sessionSettingsApply) sessionSettingsApply.disabled = sessionRetentionDisabled;
		      if (sessionClearCurrentBtn) sessionClearCurrentBtn.disabled = !connected || isProcessing || sessionActionBusy;
		      if (sessionClearSavedBtn) sessionClearSavedBtn.disabled = !connected || isProcessing || sessionActionBusy;
		      if (sessionClearCancelBtn) sessionClearCancelBtn.disabled = !connected || isProcessing || sessionActionBusy;
		      if (sessionClearConfirmRunBtn) sessionClearConfirmRunBtn.disabled = !connected || isProcessing || sessionActionBusy;
		      if (!connected || isProcessing) closeSessionSettingsPopover();
		      const providerSettingsStatePending =
		        hasPendingSettingState('codexSubscriptionSettingsState') ||
		        hasPendingSettingState('openAICompatibleSettingsState');
		      if (providerSelect) providerSelect.disabled = !connected || isProcessing || providerSwitchPending || providerSettingsStatePending;
		      const providerSettingsDisabled = !connected || isProcessing || providerSwitchPending || providerSettingsStatePending;
		      if (providerSettings) providerSettings.disabled = providerSettingsDisabled;
		      if (codexDefaultModelInput) codexDefaultModelInput.disabled = providerSettingsDisabled;
		      if (codexDefaultModelLabel) codexDefaultModelLabel.classList.toggle('disabled', providerSettingsDisabled);
		      if (openAIBaseURLInput) openAIBaseURLInput.disabled = providerSettingsDisabled;
		      if (openAIBaseURLLabel) openAIBaseURLLabel.classList.toggle('disabled', providerSettingsDisabled);
		      if (openAIDefaultModelInput) openAIDefaultModelInput.disabled = providerSettingsDisabled;
		      if (openAIDefaultModelLabel) openAIDefaultModelLabel.classList.toggle('disabled', providerSettingsDisabled);
		      if (openAIApiKeyEnvInput) openAIApiKeyEnvInput.disabled = providerSettingsDisabled;
		      if (openAIApiKeyEnvLabel) openAIApiKeyEnvLabel.classList.toggle('disabled', providerSettingsDisabled);
		      if (openAIModelDisplayNamesInput) openAIModelDisplayNamesInput.disabled = providerSettingsDisabled;
		      if (openAIModelDisplayNamesLabel) openAIModelDisplayNamesLabel.classList.toggle('disabled', providerSettingsDisabled);
		      if (providerSettingsApply) providerSettingsApply.disabled = providerSettingsDisabled;
		      if (!connected || isProcessing || providerSwitchPending) closeProviderSettingsPopover();
		      const safetyControlsDisabled = !connected || isProcessing || hasPendingSettingState('autoApproveState') || hasPendingSettingState('allowExternalPathsState') || hasPendingSettingState('blockGitPushState');
		      if (safetySelect) safetySelect.disabled = safetyControlsDisabled;
		      if (safetySettings) safetySettings.disabled = safetyControlsDisabled;
		      if (allowExternalPathsToggle) allowExternalPathsToggle.disabled = safetyControlsDisabled;
		      if (allowExternalPathsLabel) allowExternalPathsLabel.classList.toggle('disabled', safetyControlsDisabled);
		      if (blockGitPushToggle) blockGitPushToggle.disabled = safetyControlsDisabled;
		      if (blockGitPushLabel) blockGitPushLabel.classList.toggle('disabled', safetyControlsDisabled);
		      const debugDisabled = !connected || isProcessing || debugSettingsPending;
		      const debugStreamDisabled = debugDisabled || debugSettings.details;
		      if (debugDetailsToggle) debugDetailsToggle.disabled = debugDisabled;
		      if (debugDetailsLabel) debugDetailsLabel.classList.toggle('disabled', debugDisabled);
		      if (debugLlmToggle) debugLlmToggle.disabled = debugStreamDisabled;
		      if (debugLlmLabel) debugLlmLabel.classList.toggle('disabled', debugStreamDisabled);
		      if (debugToolsToggle) debugToolsToggle.disabled = debugStreamDisabled;
		      if (debugToolsLabel) debugToolsLabel.classList.toggle('disabled', debugStreamDisabled);
		      if (debugPluginsToggle) debugPluginsToggle.disabled = debugStreamDisabled;
		      if (debugPluginsLabel) debugPluginsLabel.classList.toggle('disabled', debugStreamDisabled);
		      if (showLogsBtn) {
		        showLogsBtn.disabled = !connected || showLogsPending;
		        showLogsBtn.textContent = showLogsPending ? 'Opening logs…' : 'Show logs';
		      }
		      if (listToolsBtn) listToolsBtn.disabled = !connected || isProcessing || toolsCatalogRequestPending;
		      if (runToolBtn) runToolBtn.disabled = !connected || isProcessing || toolsCatalogRequestPending || manualToolRunBusy || !!pendingManualToolConfirmation;
		      if (createToolsConfigBtn) createToolsConfigBtn.disabled = !connected || isProcessing || toolsCatalogRequestPending;
		      setToolsCatalogControlsDisabled(!connected || isProcessing || toolsCatalogRequestPending || manualToolRunBusy || !!pendingManualToolConfirmation);
		      setAutoApprovedToolsControlsDisabled(!connected || isProcessing);
		      const pluginSettingsDisabled = !connected || isProcessing || pluginSettingsPending;
		      if (pluginsAutoDiscoverToggle) pluginsAutoDiscoverToggle.disabled = pluginSettingsDisabled;
		      if (pluginsAutoDiscoverLabel) pluginsAutoDiscoverLabel.classList.toggle('disabled', pluginSettingsDisabled);
		      if (pluginsWorkspaceDirInput) pluginsWorkspaceDirInput.disabled = pluginSettingsDisabled;
		      if (pluginsWorkspaceDirLabel) pluginsWorkspaceDirLabel.classList.toggle('disabled', pluginSettingsDisabled);
		      if (pluginSpecsInput) pluginSpecsInput.disabled = pluginSettingsDisabled;
		      if (pluginSpecsLabel) pluginSpecsLabel.classList.toggle('disabled', pluginSettingsDisabled);
		      if (pluginSettingsApply) pluginSettingsApply.disabled = pluginSettingsDisabled;
		      const toolLimitsDisabled = !connected || isProcessing ||
		        hasPendingSettingState('toolRuntimeLimitsState') ||
		        hasPendingSettingState('toolFilterState') ||
		        hasPendingSettingState('workspaceEnvState');
		      if (toolFilterInput) toolFilterInput.disabled = toolLimitsDisabled;
		      if (toolFilterLabel) toolFilterLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (toolFilterApply) toolFilterApply.disabled = toolLimitsDisabled;
		      if (workspaceEnvInput) workspaceEnvInput.disabled = toolLimitsDisabled;
		      if (workspaceEnvLabel) workspaceEnvLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (workspaceEnvApply) workspaceEnvApply.disabled = toolLimitsDisabled;
		      if (toolTimeoutMsInput) toolTimeoutMsInput.disabled = toolLimitsDisabled;
		      if (toolTimeoutMsLabel) toolTimeoutMsLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (readMaxLinesInput) readMaxLinesInput.disabled = toolLimitsDisabled;
		      if (readMaxLinesLabel) readMaxLinesLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (bashBackgroundTtlMsInput) bashBackgroundTtlMsInput.disabled = toolLimitsDisabled;
		      if (bashBackgroundTtlMsLabel) bashBackgroundTtlMsLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (bashBackgroundCaptureMsInput) bashBackgroundCaptureMsInput.disabled = toolLimitsDisabled;
		      if (bashBackgroundCaptureMsLabel) bashBackgroundCaptureMsLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (bashBackgroundCaptureLinesInput) bashBackgroundCaptureLinesInput.disabled = toolLimitsDisabled;
		      if (bashBackgroundCaptureLinesLabel) bashBackgroundCaptureLinesLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (workspaceShellTimeoutMsInput) workspaceShellTimeoutMsInput.disabled = toolLimitsDisabled;
		      if (workspaceShellTimeoutMsLabel) workspaceShellTimeoutMsLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (httpTimeoutMsInput) httpTimeoutMsInput.disabled = toolLimitsDisabled;
		      if (httpTimeoutMsLabel) httpTimeoutMsLabel.classList.toggle('disabled', toolLimitsDisabled);
		      if (toolLimitsApply) toolLimitsApply.disabled = toolLimitsDisabled;
		      if (!connected || isProcessing) closeSafetySettingsPopover();
		      const instructionFileDisabled = !connected || isProcessing ||
		        hasPendingSettingState('instructionPatternsState') ||
		        hasPendingSettingState('instructionFileSettingsState');
		      setInstructionFileInputsDisabled(instructionFileDisabled);
		      const thinkingDisabled = !connected || isProcessing || hasPendingSettingState('showThinkingState');
		      if (thinkingToggle) thinkingToggle.disabled = thinkingDisabled;
		      if (thinkingLabel) thinkingLabel.classList.toggle('disabled', thinkingDisabled);
		      const memoriesFeatureDisabled = !connected || isProcessing || hasPendingSettingState('memoriesFeatureState') || hasPendingSettingState('memoryAutoRecallState');
		      if (memoriesFeatureToggle) memoriesFeatureToggle.disabled = memoriesFeatureDisabled;
		      if (memoriesFeatureLabel) memoriesFeatureLabel.classList.toggle('disabled', memoriesFeatureDisabled);
		      const memoryControlsDisabled = memoriesFeatureDisabled ||
		        !memoriesFeatureEnabled ||
		        memoryActionBusy ||
		        hasPendingSettingState('memoryAutoRecallBudgetState') ||
		        hasPendingSettingState('memoryAutoRecallFiltersState') ||
		        hasPendingSettingState('memoryAdvancedLimitsState');
		      if (memoryAutoRecallToggle) memoryAutoRecallToggle.disabled = memoryControlsDisabled;
		      if (memoryAutoRecallLabel) memoryAutoRecallLabel.classList.toggle('disabled', memoryControlsDisabled);
		      if (memoryAutoRecallMaxResultsInput) memoryAutoRecallMaxResultsInput.disabled = memoryControlsDisabled;
		      if (memoryAutoRecallMaxResultsLabel) memoryAutoRecallMaxResultsLabel.classList.toggle('disabled', memoryControlsDisabled);
		      if (memoryAutoRecallMaxTokensInput) memoryAutoRecallMaxTokensInput.disabled = memoryControlsDisabled;
		      if (memoryAutoRecallMaxTokensLabel) memoryAutoRecallMaxTokensLabel.classList.toggle('disabled', memoryControlsDisabled);
		      if (memoryAutoRecallMinScoreInput) memoryAutoRecallMinScoreInput.disabled = memoryControlsDisabled;
		      if (memoryAutoRecallMinScoreLabel) memoryAutoRecallMinScoreLabel.classList.toggle('disabled', memoryControlsDisabled);
		      if (memoryAutoRecallMinScoreGapInput) memoryAutoRecallMinScoreGapInput.disabled = memoryControlsDisabled;
		      if (memoryAutoRecallMinScoreGapLabel) memoryAutoRecallMinScoreGapLabel.classList.toggle('disabled', memoryControlsDisabled);
		      if (memoryAutoRecallMaxAgeDaysInput) memoryAutoRecallMaxAgeDaysInput.disabled = memoryControlsDisabled;
		      if (memoryAutoRecallMaxAgeDaysLabel) memoryAutoRecallMaxAgeDaysLabel.classList.toggle('disabled', memoryControlsDisabled);
		      [
		        memoryMaxRawMemoriesForGlobalInput,
		        memoryMaxRolloutAgeDaysInput,
		        memoryMaxRolloutsPerStartupInput,
		        memoryMinRolloutIdleHoursInput,
		        memoryMaxStateOutputsInput,
		        memoryMaxRecordsInput,
		        memoryMaxSearchResultsInput,
		        memoryMaxResultsPerKindInput,
		        memorySearchNeighborWindowInput,
		      ].forEach((memoryLimitInput) => {
		        if (memoryLimitInput) memoryLimitInput.disabled = memoryControlsDisabled;
		      });
		      if (memoryControlsDisabled && memoryDropConfirmPending) {
		        setMemoryDropConfirmPending(false, { sync: false });
		      }
		      if (memoryAdvancedLimitsApply) memoryAdvancedLimitsApply.disabled = memoryControlsDisabled;
		      if (memoryUpdateNowBtn) memoryUpdateNowBtn.disabled = memoryControlsDisabled;
		      if (memoryDropBtn) memoryDropBtn.disabled = memoryControlsDisabled;
		      if (memoryDropCancelBtn) memoryDropCancelBtn.disabled = memoryControlsDisabled;
		      if (memoryDropConfirmRunBtn) memoryDropConfirmRunBtn.disabled = memoryControlsDisabled;
		      [
		        memoryMaxRawMemoriesForGlobalLabel,
		        memoryMaxRolloutAgeDaysLabel,
		        memoryMaxRolloutsPerStartupLabel,
		        memoryMinRolloutIdleHoursLabel,
		        memoryMaxStateOutputsLabel,
		        memoryMaxRecordsLabel,
		        memoryMaxSearchResultsLabel,
		        memoryMaxResultsPerKindLabel,
		        memorySearchNeighborWindowLabel,
		      ].forEach((memoryLimitLabel) => {
		        if (memoryLimitLabel) memoryLimitLabel.classList.toggle('disabled', memoryControlsDisabled);
		      });
		      const explorePrepassDisabled = !connected || isProcessing || hasPendingSettingState('explorePrepassState');
		      if (explorePrepassToggle) explorePrepassToggle.disabled = explorePrepassDisabled;
		      if (explorePrepassLabel) explorePrepassLabel.classList.toggle('disabled', explorePrepassDisabled);
		      if (explorePrepassMaxCharsInput) explorePrepassMaxCharsInput.disabled = explorePrepassDisabled;
		      if (explorePrepassMaxCharsLabel) explorePrepassMaxCharsLabel.classList.toggle('disabled', explorePrepassDisabled);
		      const subagentModelOverrideDisabled = !connected || isProcessing || hasPendingSettingState('subagentModelOverrideState');
		      const subagentTaskMaxOutputCharsDisabled = !connected || isProcessing || hasPendingSettingState('subagentTaskMaxOutputCharsState');
		      if (subagentModelOverrideInput) subagentModelOverrideInput.disabled = subagentModelOverrideDisabled;
		      if (subagentModelOverrideLabel) subagentModelOverrideLabel.classList.toggle('disabled', subagentModelOverrideDisabled);
		      if (subagentTaskMaxOutputCharsInput) subagentTaskMaxOutputCharsInput.disabled = subagentTaskMaxOutputCharsDisabled;
		      if (subagentTaskMaxOutputCharsLabel) subagentTaskMaxOutputCharsLabel.classList.toggle('disabled', subagentTaskMaxOutputCharsDisabled);
		      const autoCompactionDisabled = !connected || isProcessing || hasPendingSettingState('autoCompactionState');
		      if (autoCompactionToggle) autoCompactionToggle.disabled = autoCompactionDisabled;
		      if (autoCompactionLabel) autoCompactionLabel.classList.toggle('disabled', autoCompactionDisabled);
		      const modelLimitsDisabled = !connected || isProcessing || hasPendingSettingState('modelLimitsState');
		      if (modelLimitsInput) modelLimitsInput.disabled = modelLimitsDisabled;
		      if (modelLimitsApply) modelLimitsApply.disabled = modelLimitsDisabled;
		      if (modelLimitsLabel) modelLimitsLabel.classList.toggle('disabled', modelLimitsDisabled);
		      const compactionPruneDisabled = !connected || isProcessing || hasPendingSettingState('compactionPruneState');
		      if (compactionPruneToggle) compactionPruneToggle.disabled = compactionPruneDisabled;
		      if (compactionPruneLabel) compactionPruneLabel.classList.toggle('disabled', compactionPruneDisabled);
		      if (compactionPruneProtectTokensInput) compactionPruneProtectTokensInput.disabled = compactionPruneDisabled;
		      if (compactionPruneProtectTokensLabel) compactionPruneProtectTokensLabel.classList.toggle('disabled', compactionPruneDisabled);
		      if (compactionPruneMinimumTokensInput) compactionPruneMinimumTokensInput.disabled = compactionPruneDisabled;
		      if (compactionPruneMinimumTokensLabel) compactionPruneMinimumTokensLabel.classList.toggle('disabled', compactionPruneDisabled);
		      const compactionToolOutputModeDisabled = !connected || isProcessing || hasPendingSettingState('compactionToolOutputModeState');
		      if (compactionToolOutputModeSelect) compactionToolOutputModeSelect.disabled = compactionToolOutputModeDisabled;
		      if (compactionToolOutputModeLabel) compactionToolOutputModeLabel.classList.toggle('disabled', compactionToolOutputModeDisabled);
		      const planFirstDisabled = !connected || isProcessing || hasPendingSettingState('planFirstState');
		      if (planFirstToggle) planFirstToggle.disabled = planFirstDisabled;
		      if (planFirstLabel) planFirstLabel.classList.toggle('disabled', planFirstDisabled);
		      const modelControlsDisabled = !connected || isProcessing || modelSwitchPending || modelFavoritePending || modelPickerRefreshPending || modelPickerOpenPending;
		      if (modelPicker) modelPicker.disabled = modelControlsDisabled;
		      if (reasoningEffortSelect) reasoningEffortSelect.disabled = !connected || isProcessing || reasoningEffortPending || modelSwitchPending;
			      if (modelFavoriteToggle) modelFavoriteToggle.disabled = modelControlsDisabled || !currentModel;
		      if (modelSettings) modelSettings.disabled = modelControlsDisabled;
		      setCustomModelInputsDisabled(!connected || isProcessing || modelSwitchPending);
		      if (customModelApply) customModelApply.disabled = !connected || isProcessing || modelSwitchPending;
		      if (modelRefreshList) modelRefreshList.disabled = modelControlsDisabled;
		      if (modelClearRecents) modelClearRecents.disabled = modelControlsDisabled;
		      if (modelPickerSearchInput) modelPickerSearchInput.disabled = modelControlsDisabled;
		      if (modelPickerSearchLabel) modelPickerSearchLabel.classList.toggle('disabled', modelControlsDisabled);
		      if (modelPickerList) {
		        modelPickerList.querySelectorAll('button').forEach((button) => { button.disabled = modelControlsDisabled; });
		      }
		      const generationSettingsDisabled = !connected || isProcessing || hasPendingSettingState('generationSettingsState');
		      if (modelSettingsApply) modelSettingsApply.disabled = generationSettingsDisabled;
		      setGenerationInputsDisabled(generationSettingsDisabled);
		      if (modelSettingsOpenSettings) modelSettingsOpenSettings.disabled = !connected || isProcessing || advancedModelSettingsPending;
			      if (!connected || isProcessing) closeModelSettingsPopover();
			      if (modePlanBtn) modePlanBtn.disabled = !connected || isProcessing || modeSwitchPending;
			      if (modeBuildBtn) modeBuildBtn.disabled = !connected || isProcessing || modeSwitchPending;
			      if (contextIndicator) contextIndicator.disabled = !connected;
		      if (contextCompactNowBtn) contextCompactNowBtn.disabled = !connected || isProcessing || sessionActionBusy;
		      if (providerAuthPrimary) {
		        const canAuthenticate =
		          connected &&
		          !isProcessing &&
		          !providerAuthBusy &&
		          !!currentProviderAuth &&
		          currentProviderAuth.status !== 'hidden' &&
		          !currentProviderAuth.authenticated;
		        providerAuthPrimary.disabled =
		          providerAuthPrimary.classList.contains('connected') || !canAuthenticate;
		      }
		      if (providerAuthSecondary) {
		        const canDisconnect =
		          connected &&
		          !isProcessing &&
		          !providerAuthBusy &&
		          !!currentProviderAuth &&
		          currentProviderAuth.authenticated;
		        providerAuthSecondary.disabled = !canDisconnect;
		      }
		      if (operationStopBtn) {
		        operationStopBtn.disabled =
		          !connected ||
		          !isProcessing ||
		          abortRequestPending ||
		          !currentOperation ||
		          (currentOperation.status || 'running') !== 'running';
		      }
		      syncRevertBarButtons();
		      updateApprovalBanner();

		      const skillsEnabledDisabled = !connected || isProcessing || hasPendingSettingState('skillsEnabledState');
		      if (skillsToggle) skillsToggle.disabled = skillsEnabledDisabled;
		      if (skillsToggleLabel) skillsToggleLabel.classList.toggle('disabled', skillsEnabledDisabled);
		      const skillsSettingsDisabled = !connected || isProcessing ||
		        hasPendingSettingState('skillsEnabledState') ||
		        hasPendingSettingState('skillsBudgetState') ||
		        hasPendingSettingState('skillSearchPathsState');
		      if (skillsSettings) skillsSettings.disabled = skillsSettingsDisabled;
		      if (skillsMaxPromptInput) skillsMaxPromptInput.disabled = skillsSettingsDisabled;
		      if (skillsMaxInjectInput) skillsMaxInjectInput.disabled = skillsSettingsDisabled;
		      if (skillsMaxInjectCharsInput) skillsMaxInjectCharsInput.disabled = skillsSettingsDisabled;
		      if (skillSearchPathsInput) skillSearchPathsInput.disabled = skillsSettingsDisabled;
		      if (skillSearchPathsLabel) skillSearchPathsLabel.classList.toggle('disabled', skillsSettingsDisabled);
		      if (skillsSettingsApply) skillsSettingsApply.disabled = skillsSettingsDisabled;
		      if (!connected || isProcessing) closeSkillsSettingsPopover();

		      if (inputHint) {
		        const queuedCount = Array.isArray(queuedInputs) ? queuedInputs.length : 0;
		        const showNotice = !!inputNoticeMessage;
		        const showHint = connected && (showNotice || isProcessing || queuedCount === 0);
		        inputHint.classList.toggle('hidden', !showHint);
		        if (showHint) {
		          inputHint.textContent = showNotice
		            ? inputNoticeMessage
		            : showPlanUpdate
		              ? 'Answer plan questions · Enter to update plan · Shift+Enter for newline'
	              : isProcessing
	                ? 'Enter to queue another message · ' + queuedCount + ' queued · Paste images · Stop button or Ctrl/Cmd+. to stop'

		                : skillsEnabled
		                  ? 'Enter to send · Shift+Enter for newline · Paste images · $ for skills'
		                  : 'Enter to send · Shift+Enter for newline · Paste images';
		        }
		      }

		      if (!connected) {
		        setSendButtonPresentation('…', 'Connecting', 'Connecting…');
		        setSendButtonDisabled(true);
		        if (stopBtn) {
		          stopBtn.classList.add('hidden');
		          stopBtn.disabled = true;
		        }
		        return;
	      }

	      if (stopBtn) {
	        if (isProcessing) {
	          stopBtn.classList.remove('hidden');
	          stopBtn.disabled = abortRequestPending;
	        } else {
	          stopBtn.classList.add('hidden');
	          stopBtn.disabled = true;
	        }
	      }

		      if (showPlanUpdate) {
		        setSendButtonPresentation('↻', 'Update Plan', 'Enter to update the plan; Shift+Enter for newline');
		      } else if (isProcessing) {
		        setSendButtonPresentation('⏸', 'Queue', 'Queue input to run after the current task finishes');
		      } else {
		        setSendButtonPresentation('→', 'Send', 'Enter to send; Shift+Enter for newline');
		      }
		      setSendButtonDisabled(!hasContent);
		      updateLoopControl();
	    }

		    function setProcessing(val) {
		      isProcessing = val;
		      try { setQueueState(queuedInputs, { sync: false }); } catch {}
		      syncInputState();
		      updateApprovalBanner();
	      const suppressTurnStatus =
	        !!val &&
	        !!currentOperation &&
	        (currentOperation.status || 'running') === 'running' &&
	        currentOperation.kind === 'compact';

	      if (!val || suppressTurnStatus) {
	        turnEls.forEach((_turnData, turnId) => {
	          updateTurnState(turnId, false);
	        });
	      } else {
	        turnEls.forEach((_turnData, turnId) => {
	          updateTurnState(turnId, turnId === activeTurnId);
	        });
	      }
	      if (sessionSelect && sessionSelect.options.length > 0) {
	        const currentSessionOption = Array.from(sessionSelect.options).find(opt => opt.value === currentSessionId);
	        if (currentSessionOption) {
	          let label = currentSessionOption.textContent;
	          if (label.startsWith('◉ ')) {
	            label = label.substring(2);
	          }
	          currentSessionOption.textContent = val ? '◉ ' + label : label;
	        }
	      }
	      updateOperationBanner();
	    }

	    function setPlanPending(val) {
	      planPending = val;
	      syncInputState();
	      if (planPending && !isProcessing) {
	        input.focus();
	      }
	    }

	    function syncRevertBarButtons() {
	      const enabled = initReceived && !isProcessing && !revertActionPending && !!currentRevertState;
	      if (!enabled && revertDiscardConfirmPending) {
	        setRevertDiscardConfirmPending(false, { sync: false });
	      }
	      if (revertRedoBtn) revertRedoBtn.disabled = !enabled || !canRedo;
	      if (revertRedoAllBtn) revertRedoAllBtn.disabled = !enabled || !canRedo;
	      if (revertDiffBtn) revertDiffBtn.disabled = !enabled;
	      if (revertDiscardBtn) revertDiscardBtn.disabled = !enabled;
	      if (revertDiscardCancelBtn) revertDiscardCancelBtn.disabled = !enabled;
	      if (revertDiscardConfirmRunBtn) revertDiscardConfirmRunBtn.disabled = !enabled;
	    }

	    function updateRevertBar(state) {
	      currentRevertState = state && state.active ? state : null;
	      if (!revertBar) return;

	      if (!currentRevertState) {
	        revertBar.classList.add('hidden');
	        if (revertSummary) revertSummary.textContent = '';
	        if (revertFiles) revertFiles.hidden = true;
	        if (revertFilesList) revertFilesList.innerHTML = '';
	        setRevertDiscardConfirmPending(false, { sync: false });
	        syncRevertBarButtons();
	        return;
	      }

	      revertBar.classList.remove('hidden');

	      const revertedMessages = Number.isFinite(currentRevertState.revertedMessages)
	        ? currentRevertState.revertedMessages
	        : 0;
	      const files = Array.isArray(currentRevertState.files) ? currentRevertState.files : [];
	      const fileCount = files.length;

	      const plural = (n, word) => (n === 1 ? word : word + 's');
	      let summary = 'Undid ' + revertedMessages + ' ' + plural(revertedMessages, 'message') + '.';
	      if (fileCount > 0) {
	        summary =
	          'Undid ' +
	          revertedMessages +
	          ' ' +
	          plural(revertedMessages, 'message') +
	          ' and reverted ' +
	          fileCount +
	          ' ' +
	          plural(fileCount, 'file') +
	          '.';
	      }
	      if (revertSummary) revertSummary.textContent = summary;

	      if (revertFiles) {
	        if (fileCount === 0) {
	          revertFiles.hidden = true;
	        } else {
	          revertFiles.hidden = false;
	          if (revertFilesSummary) revertFilesSummary.textContent = 'Reverted files (' + fileCount + ')';

	          if (revertFilesList) {
	            revertFilesList.innerHTML = '';
	            const maxFiles = 8;
	            for (const file of files.slice(0, maxFiles)) {
	              const row = document.createElement('div');
	              row.className = 'revert-file';

		              const pathEl = document.createElement('span');
		              pathEl.className = 'revert-path';
		              pathEl.textContent = formatFilePath(file.path || '');
		              pathEl.title = String(file.path || '');

	              const stats = document.createElement('span');
	              stats.className = 'revert-stats';

	              const add = document.createElement('span');
	              add.className = 'revert-add';
	              const additions = Number.isFinite(file.additions) ? file.additions : 0;
	              add.textContent = '+' + additions;

	              const del = document.createElement('span');
	              del.className = 'revert-del';
	              const deletions = Number.isFinite(file.deletions) ? file.deletions : 0;
	              del.textContent = '-' + deletions;

	              stats.appendChild(add);
	              stats.appendChild(del);

	              row.appendChild(pathEl);
	              row.appendChild(stats);
	              revertFilesList.appendChild(row);
	            }

	            if (fileCount > maxFiles) {
	              const more = document.createElement('div');
	              more.className = 'revert-more';
	              more.textContent = '… and ' + (fileCount - maxFiles) + ' more';
	              revertFilesList.appendChild(more);
	            }
	          }
	        }
	      }

	      syncRevertBarButtons();
	    }
