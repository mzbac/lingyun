		    let vscode;
		    try {
		      vscode = acquireVsCodeApi();
		    } catch (err) {
		      vscode = { postMessage: () => {} };
		    }
				    const clientInstanceId = String(Date.now()) + '_' + Math.random().toString(16).slice(2);
				    const SKILL_SEARCH_PATHS_TITLE_DISPLAY_LIMIT = 240;
				    const SKILL_DROPDOWN_ITEM_DISPLAY_LIMIT = 160;
					    const MODEL_DISPLAY_LIMIT = 160;
					    const MODEL_PICKER_SECTION_RENDER_LIMIT = 64;
					    const MODEL_PICKER_DETAIL_LIMIT = 160;
					    const MODEL_PICKER_SEARCH_QUERY_DISPLAY_LIMIT = 80;
						    const TOOLS_CATALOG_RENDER_LIMIT = 100;
						    const TOOLS_CATALOG_ID_DISPLAY_LIMIT = 160;
						    const TOOLS_CATALOG_DESCRIPTION_LIMIT = 240;
						    const TOOLS_CATALOG_PARAMS_LIMIT = 240;
						    const TOOLS_CATALOG_BADGE_LIMIT = 48;
						    const TOOLS_CATALOG_SUMMARY_QUERY_LIMIT = 80;
						    const TOOLS_CATALOG_SUMMARY_FILTER_LIMIT = 240;
						    const AUTO_APPROVED_TOOL_ID_DISPLAY_LIMIT = 160;
						    const PLUGIN_SPECS_TITLE_DISPLAY_LIMIT = 240;
						    const TOOL_FILTER_TITLE_DISPLAY_LIMIT = 240;
						    const INSTRUCTION_PATTERNS_TITLE_DISPLAY_LIMIT = 240;
					    const QUEUE_ITEMS_RENDER_LIMIT = 24;
					    const QUEUE_ITEM_PREVIEW_LIMIT = 96;
					    const LIVE_REGION_ANNOUNCEMENT_LIMIT = 240;
					    const MEMORY_ACTION_STATUS_MESSAGE_LIMIT = 240;
					    const MANUAL_TOOL_RESULT_SUMMARY_LIMIT = 240;
					    const MANUAL_TOOL_CONFIRMATION_TOOL_NAME_LIMIT = 120;
					    const MANUAL_TOOL_CONFIRMATION_REASON_LIMIT = 240;
					    const REVERT_FILE_PATH_DISPLAY_LIMIT = 160;
				    const MANUAL_TOOL_RESULT_OUTPUT_PREVIEW_LIMIT = 4000;
					    const messages = document.getElementById('messages');
				    const empty = document.getElementById('empty');
				    const quickActions = document.getElementById('quickActions');
				    const quickActionCommandByButton = new WeakMap();
		    const input = document.getElementById('input');
	    const skillDropdown = document.getElementById('skillDropdown');
	    const goalCommandSuggestion = document.getElementById('goalCommandSuggestion');
	    const goalCommandInsert = document.getElementById('goalCommandInsert');
	    const liveRegion = document.getElementById('liveRegion');
	    let liveRegionAnnouncementFrame = null;
	    let liveRegionAnnouncementVersion = 0;
	    let pendingLiveRegionAnnouncement = '';
	    let lastLiveRegionAnnouncement = '';
	    let lastLiveRegionRenderedText = '';

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
	    const skillsBudgetInputs = [skillsMaxPromptInput, skillsMaxInjectInput, skillsMaxInjectCharsInput];
	    const inputHint = document.getElementById('inputHint');
		    const queueStatus = document.getElementById('queueStatus');
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
	    const undoBtn = document.getElementById('undo');
		    const redoBtn = document.getElementById('redo');
	    const clearInputBtn = document.getElementById('clearInput');
	    const attachImageButton = document.getElementById('attachImageButton');
	    const imageFileInput = document.getElementById('imageFileInput');
	    const inputComposer = document.getElementById('inputComposer');
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
	    const openAIAllowInsecureTLSLabel = document.getElementById('openAIAllowInsecureTLSLabel');
	    const openAIAllowInsecureTLSInput = document.getElementById('openAIAllowInsecureTLSInput');
		    const openAIModelDisplayNamesLabel = document.getElementById('openAIModelDisplayNamesLabel');
		    const openAIModelDisplayNamesInput = document.getElementById('openAIModelDisplayNamesInput');
		    const providerSettingsApply = document.getElementById('providerSettingsApply');
		    const providerSettingsShortcutInputs = [codexDefaultModelInput, openAIBaseURLInput, openAIDefaultModelInput, openAIApiKeyEnvInput];
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
		    const toolRuntimeLimitInputs = [
		      toolTimeoutMsInput,
		      readMaxLinesInput,
		      bashBackgroundTtlMsInput,
		      bashBackgroundCaptureMsInput,
		      bashBackgroundCaptureLinesInput,
		      workspaceShellTimeoutMsInput,
		      httpTimeoutMsInput,
		    ];
		    const toolFilterLabel = document.getElementById('toolFilterLabel');
	    const toolFilterInput = document.getElementById('toolFilterInput');
	    const toolFilterApply = document.getElementById('toolFilterApply');
	    const listToolsBtn = document.getElementById('listTools');
	    const toolsCatalogSearchLabel = document.getElementById('toolsCatalogSearchLabel');
	    const toolsCatalogSearchInput = document.getElementById('toolsCatalogSearchInput');
	    const toolsCatalogStatus = document.getElementById('toolsCatalogStatus');
	    const toolsCatalog = document.getElementById('toolsCatalog');
	    const autoApprovedToolsStatus = document.getElementById('autoApprovedToolsStatus');
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
	    const modelFavoriteIcon = document.getElementById('modelFavoriteIcon');
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
	    const modelPickerStatus = document.getElementById('modelPickerStatus');
	    const modelPickerList = document.getElementById('modelPickerList');
	    const temperatureInput = document.getElementById('temperatureInput');
	    const topPLabel = document.getElementById('topPLabel');
	    const topPInput = document.getElementById('topPInput');
	    const topKLabel = document.getElementById('topKLabel');
	    const topKInput = document.getElementById('topKInput');
	    const maxOutputTokensInput = document.getElementById('maxOutputTokensInput');
	    const maxIterationsInput = document.getElementById('maxIterationsInput');
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
	    const revertStatus = document.getElementById('revertStatus');
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
	    const memoryAdvancedLimitLabels = [
	      memoryMaxRawMemoriesForGlobalLabel,
	      memoryMaxRolloutAgeDaysLabel,
	      memoryMaxRolloutsPerStartupLabel,
	      memoryMinRolloutIdleHoursLabel,
	      memoryMaxStateOutputsLabel,
	      memoryMaxRecordsLabel,
	      memoryMaxSearchResultsLabel,
	      memoryMaxResultsPerKindLabel,
	      memorySearchNeighborWindowLabel,
	    ];
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
				    let activeProcessingTurnId = '';
				    let queuedInputs = [];
	    let queueClearPending = false;
	    let queueSteerPendingId = '';
	    let lastQueueBannerRenderKey = '';
	    let queueBannerVisible = false;
	    let lastQueueInputsStateKey = '';
	    let lastQueueInputsRenderState = null;
	    let lastQueueItemsRenderKey = '';
	    let lastQueueActionStateKey = '';
	    const queueItemIdByButton = new WeakMap();
	    const queueItemLabelElementCache = new WeakMap();
	    let lastRevertBarRenderKey = '';
	    let lastRevertBarButtonsKey = '';
	    let revertBarVisible = false;
	    let sendButtonPresentationKey = '';
	    let sendButtonDisabledState = null;
	    let clearInputButtonDisabledState = null;
	    let stopButtonVisible = false;
	    let abortRequestPending = false;
			    let approveAllPending = false;
	    let canUndo = false;
	    let canRedo = false;
		    let currentRevertState = null;
		    let revertActionPending = '';
		    let revertDiscardConfirmPending = false;
		    let revertDiscardConfirmSynced = false;
		    let revertDiscardConfirmVisible = false;
			    let currentSessionId = '';
			    let currentSessionOption = null;
			    let sessionSwitchPending = false;
			    let sessionActionPending = '';
			    let sessionClearConfirmAction = '';
			    let sessionClearConfirmSynced = false;
			    let sessionClearConfirmVisible = false;
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
			    let generationMaxIterations = 50;
			    let generationTextVerbosity = '';
			    let generationMaxRetries = 2;
				    let generationRetryWithPartialOutput = true;
				    let generationTimeoutMs = 0;
						    let currentModelPickerState = null;
						    let modelPickerSearchQuery = '';
						    let modelPickerSearchDisplayQuery = '';
						    let modelPickerSearchLocalQuery = '';
						    let modelPickerSearchRenderFrame = null;
						    let modelPickerListControlsDisabledKey = '';
					    let modelPickerListControls = [];
					    let modelPickerListVisible = false;
					    let modelPickerRenderKey = '';
					    let modelPickerRenderedState = null;
					    let modelPickerRenderedCurrentModelId = '';
				    let modelPickerRenderedQuery = '';
					    let modelSearchTextCache = new WeakMap();
					    const modelPickerModelIdByButton = new WeakMap();
				    let currentProviderId = 'copilot';
			    let providerSwitchPending = false;
			    let codexSubscriptionSettings = { defaultModelId: 'gpt-5.3-codex' };
			    let openAICompatibleSettings = { baseURL: '', defaultModelId: '', apiKeyEnv: 'OPENAI_API_KEY', allowInsecureTLS: false, modelDisplayNames: {} };
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
				    let toolsCatalogSearchDisplayQuery = '';
				    let toolsCatalogSearchLocalQuery = '';
					    let toolsCatalogSearchRenderFrame = null;
						    let toolsCatalogControlsDisabledKey = '';
					    let toolsCatalogVisible = false;
				    let toolsCatalogSearchVisible = false;
						    let toolsCatalogRenderKey = '';
					    let toolsCatalogRenderedState = null;
					    let toolsCatalogRenderedTools = null;
					    let toolsCatalogRenderedFilter = null;
					    let toolsCatalogRenderedTotal = 0;
					    let toolsCatalogRenderedShown = 0;
					    let toolsCatalogRenderedRawQuery = '';
					    let toolsCatalogRenderedLocalQuery = '';
					    let toolsCatalogRenderedOverlayVersion = 0;
				    let toolsCatalogOverlayVersion = 0;
			    let toolsCatalogSearchTextCache = new WeakMap();
		    let toolsCatalogParamTextCache = new WeakMap();
		    let toolsCatalogRenderTextCache = new WeakMap();
		    let toolsCatalogDefaultArgsTextCache = new WeakMap();
	    const toolsCatalogRunToolIdByButton = new WeakMap();
	    const toolsCatalogRunArgsByButton = new WeakMap();
	    const toolsCatalogRunStatusByButton = new WeakMap();
	    const toolsCatalogRunStatusByArgs = new WeakMap();
	    let toolsCatalogRunnerControls = [];
	    let toolsCatalogConfirmationControls = [];
		    let manualToolRunBusy = false;
		    let pendingManualToolConfirmation = null;
		    let lastFocusedManualToolConfirmationKey = '';
		    let latestManualToolResult = null;
		    let latestManualToolResultRenderKey = '';
		    let latestManualToolResultSummaryText = '';
		    let latestManualToolResultOutputText = '';
		    let latestManualToolResultOutputPreviewText = '';
	    let autoApprovedTools = [];
	    let autoApprovedToolsPending = false;
	    let autoApprovedToolsClearConfirmPending = false;
	    let autoApprovedToolsClearConfirmSynced = false;
	    let autoApprovedToolsClearConfirmVisible = false;
	    let autoApprovedToolButtonsDisabledKey = '';
	    let autoApprovedToolButtons = [];
	    let autoApprovedToolsRenderKey = '';
	    const autoApprovedToolIdByRevokeButton = new WeakMap();
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
				    let memoryDropConfirmSynced = false;
				    let memoryDropConfirmVisible = false;
				    let memoryActionStatusKey = '';
				    let memoryActionStatusVisible = false;
				    let memoryActionStatusError = false;
				    let memoryActionStatusSuccess = false;
				    let lastMemoryActionAnnouncement = '';
				    let explorePrepassEnabled = false;
				    let explorePrepassMaxChars = 8000;
				    let subagentModelOverride = '';
			    let subagentTaskMaxOutputChars = 8000;
			    let autoCompactionEnabled = true;
			    let modelLimits = {};
			    let compactionPruneEnabled = true;
			    let compactionPruneProtectTokens = 40000;
			    let compactionPruneMinimumTokens = 20000;
			    let compactionToolOutputMode = 'onCompaction';
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
			    let currentOperation = null;
			    let operationTimer = null;
			    let operationHideTimer = null;
			    let operationBannerVisible = false;
			    let lastOperationLabelText = '';
		    let pendingApprovalsCount = 0;
		    let manualApprovalsCount = 0;
		    let autoApproveThisRun = false;
		    let approvalBannerVisible = false;
		    let lastApprovalLabelText = '';
		    let latestContext = null;
		    let latestTodos = null;
			    const messageEls = new Map();
			    const messageDataById = new Map();
			    const planMessageIds = new Set();
			    const turnEls = new Map();
			    const stepBodies = new Map();
			    const pendingTokens = new Map();
			    let lastToolMsg = null;
			    let lastToolBatchPathSet = null;
				    const BATCH_TOOL_TYPES = ['read', 'read_range', 'glob', 'list'];
		    const BATCH_TOOL_TYPE_SET = new Set(BATCH_TOOL_TYPES);
				    let messageAppendTarget = null;
				    let suppressAutoScroll = false;
				    let transcriptScrollAnchorLocked = false;
		    let userScrolledAway = false;
	    const AUTO_SCROLL_THRESHOLD_PX = 80;
	    const AUTO_SCROLL_SETTLE_FRAMES = 12;
	    const SCROLL_GESTURE_WINDOW_MS = 250;
	    let autoScrollFramePending = false;
	    let autoScrollFrame = null;
	    let autoScrollSettleFramesRemaining = 0;
	    let scrollStateFramePending = false;
	    let scrollStateFrame = null;
	    let scrollStateObservedUserGesture = false;
	    let scrollStateObservedUserScrollUp = false;
	    let lastObservedMessagesScrollTop = 0;
	    let lastMessagesScrollGestureAt = 0;
		    let messagesPointerScrollGesture = false;
		    let messagesTouchClientY = null;
			    const COMPOSER_DRAFT_WEBVIEW_STATE_KEY = 'composerDraft';
		    const COMPOSER_SUBMISSION_WEBVIEW_STATE_KEY = 'composerSubmissionId';
		    const TRANSCRIPT_POSITION_WEBVIEW_STATE_KEY = 'transcriptPosition';
		    const WEBVIEW_STATE_WRITE_DEBOUNCE_MS = 160;
		    let composerDraftStateTimer = null;
		    let transcriptPositionStateTimer = null;
		    let lastPersistedComposerDraft = null;
		    let pendingComposerSubmission = null;
		    let lastPersistedTranscriptPositionKey = '';

	    const INPUT_HISTORY_MAX_ENTRIES = 100;
	    const INPUT_HISTORY_MAX_ENTRY_CHARS = 10000;
	    let inputHistoryEntries = [];
	    let inputHistoryIndex = -1;
		    let inputHistorySavedDraft = null;
		    let inputImeComposing = false;
		    let inputLayoutFramePending = false;
		    let inputLayoutFrame = null;
		    let goalCommandSuggestionVisible = false;
		    let composerInputAssistState = null;
		    let inputHintVisible = !!inputHint;
		    let inputHintText = inputHint ? String(inputHint.textContent || '') : '';
			    const MAX_IMAGE_ATTACHMENTS = 8;
			    const MAX_IMAGE_ATTACHMENT_FILENAME_CHARS = 512;
			    const IMAGE_ATTACHMENT_FILENAME_DISPLAY_LIMIT = 120;
		    const IMAGE_ATTACHMENT_META_DISPLAY_LIMIT = 120;
    const MAX_IMAGE_DATA_URL_CHARS = 12000000;
    const IMAGE_ATTACHMENT_READ_TIMEOUT_MS = 15000;
	    const INPUT_NOTICE_DURATION_MS = 4000;
		    const PENDING_ACTION_TIMEOUT_MS = 10000;
		    const SETTINGS_PENDING_TIMEOUT_MS = 10000;
		    let pendingImageAttachments = [];
		    let pendingImageAttachmentOperations = 0;
		    let composerAttachmentsHydrated = false;
		    let lastInputAttachmentsRenderKey = '';
		    let inputAttachmentsVisible = false;
		    const inputAttachmentIdByRemoveButton = new WeakMap();
		    const imageFileMediaTypeFallbackByFile = new WeakMap();
		    let inputNoticeMessage = '';
	    let inputNoticeTimer = null;
			    let inputImageDragDepth = 0;
			    let inputImageDragActive = false;
			    const pendingSettingTimers = new Map();
			    const pendingActionTimers = new Map();
			    const STREAM_TEXT_CACHE_KEY = '__lingyunStreamText';

		    function rememberMessageData(msg) {
		      if (!msg || typeof msg.id !== 'string') return;
		      const previous = messageDataById.get(msg.id);
		      if (previous && previous.role === 'plan' && msg.role !== 'plan') {
		        planMessageIds.delete(msg.id);
		      }
		      messageDataById.set(msg.id, msg);
		      if (msg.role === 'plan') {
		        planMessageIds.add(msg.id);
		      }
		    }

		    function updateAssistantMessageContent(messageId, content) {
		      if (!messageId) return;
		      const msg = messageDataById.get(messageId);
		      if (msg && msg.role === 'assistant') {
		        msg.content = getMessageTextContent(content, '');
		      }
		    }

		    function getMessageTextContent(value, fallback) {
		      if (value === undefined || value === null) return fallback || '';
		      const text = String(value);
		      return text === '' && fallback !== undefined ? fallback : text;
		    }

		    function clearMessageDataIndexes() {
		      messageDataById.clear();
		      planMessageIds.clear();
		    }

		    const SKILL_DROPDOWN_MAX_ITEMS = 30;
		    const GOAL_COMMAND_TEXT = '/goal';
		    const SKILL_QUERY_CHAR_RE = /[A-Za-z0-9_.-]/;
		    const WHITESPACE_CHAR_RE = /\s/;
	    let skillsEnabled = true;
	    let skillsBudget = { maxPromptSkills: 50, maxInjectSkills: 5, maxInjectChars: 20000 };
	    let skillSearchPaths = [];
			    let availableSkills = [];
			    let availableSkillSearchText = [];
			    let availableSkillsKey = '';
			    let availableSkillsVersion = 0;
		    let skillDropdownOpen = false;
		    let skillDropdownVisible = false;
		    let skillDropdownItems = [];
		    let skillDropdownItemsVersion = -1;
		    let skillDropdownRenderKey = '';
		    let skillDropdownInputStateKey = '';
			    let skillDropdownSelectedIndex = 0;
			    let skillDropdownSyncedSelectedIndex = -1;
			    const skillDropdownItemIndexByElement = new WeakMap();
			    let skillDropdownTokenStart = -1;
			    let skillDropdownQuery = '';
			    let skillDropdownLocalQuery = '';
				    const settingsPopoverFocusReturnTargets = new WeakMap();
				    const settingsPopoverOpenStates = new WeakMap();
				    let settingsPopoverOpenStack = [];
			    let settingsPopoverFocusRestoreTimer = null;

		    function canFocusSettingsPopoverTarget(element) {
		      if (!element || typeof element.focus !== 'function') return false;
		      if (element.disabled) return false;
		      if (element.isConnected === false) return false;
		      if (element.classList && element.classList.contains('hidden')) return false;
		      if (element.getAttribute && element.getAttribute('aria-hidden') === 'true') return false;
		      return true;
		    }

		    function focusSettingsPopoverTarget(element) {
		      if (!canFocusSettingsPopoverTarget(element)) return false;
		      try {
		        element.focus({ preventScroll: true });
		      } catch {
		        try {
		          element.focus();
		        } catch {
		          return false;
		        }
		      }
		      return document.activeElement === element;
		    }

			    function setSettingsPopoverTriggersExpanded(triggers, expanded) {
				      const value = expanded ? 'true' : 'false';
				      if (Array.isArray(triggers)) {
				        for (let triggerIndex = 0; triggerIndex < triggers.length; triggerIndex++) {
				          const trigger = triggers[triggerIndex];
				          setAttributeValue(trigger, 'aria-expanded', value);
				        }
			        return;
			      }
			      setAttributeValue(triggers, 'aria-expanded', value);
			    }

		    function isNodeEventTarget(target) {
		      if (!target) return false;
		      if (typeof Node === 'function') return target instanceof Node;
		      return typeof target.nodeType === 'number';
		    }

		    function elementContainsEventTarget(element, target) {
		      if (!element || !target) return false;
		      if (element === target) return true;
		      if (!isNodeEventTarget(target)) return false;
		      if (typeof element.contains !== 'function') return false;
		      return !!element.contains(target);
		    }

			    function settingsTargetMatchesAny(target, triggers) {
			      if (Array.isArray(triggers)) {
			        for (let triggerIndex = 0; triggerIndex < triggers.length; triggerIndex++) {
			          const trigger = triggers[triggerIndex];
			          if (elementContainsEventTarget(trigger, target)) return true;
			        }
		        return false;
		      }
		      return elementContainsEventTarget(triggers, target);
		    }

		    function isSettingsPopoverBoundaryTarget(popover, target, triggers) {
		      return elementContainsEventTarget(popover, target) || settingsTargetMatchesAny(target, triggers);
		    }

		    function getSettingsPopoverFocusReturnTarget(popover, fallback) {
		      const activeElement = document && document.activeElement;
		      if (
		        canFocusSettingsPopoverTarget(activeElement) &&
		        activeElement !== document.body &&
		        !elementContainsEventTarget(popover, activeElement)
		      ) {
		        return activeElement;
		      }
		      return canFocusSettingsPopoverTarget(fallback) ? fallback : null;
		    }

		    function restoreSettingsPopoverFocus(target) {
		      if (focusSettingsPopoverTarget(target)) return;
		      focusSettingsPopoverTarget(input);
		    }

		    function clearSettingsPopoverFocusRestoreTimer() {
		      if (settingsPopoverFocusRestoreTimer === null) return;
		      clearTimeout(settingsPopoverFocusRestoreTimer);
		      settingsPopoverFocusRestoreTimer = null;
		    }

			    function settingsPopoverContainsFocus(popover) {
			      const activeElement = document && document.activeElement;
			      return elementContainsEventTarget(popover, activeElement);
			    }

			    function isSettingsPopoverOpen(popover) {
			      if (!popover) return false;
			      const knownOpen = settingsPopoverOpenStates.get(popover);
			      if (knownOpen === true) return true;
			      if (knownOpen === false) return false;
			      const open = !popover.classList || !popover.classList.contains('hidden');
			      settingsPopoverOpenStates.set(popover, open);
			      return open;
			    }

			    function removeSettingsPopoverFromStack(popover) {
			      if (!popover || settingsPopoverOpenStack.length === 0) return;
			      for (let i = settingsPopoverOpenStack.length - 1; i >= 0; i--) {
			        if (settingsPopoverOpenStack[i] === popover) settingsPopoverOpenStack.splice(i, 1);
			      }
			    }

			    function trackSettingsPopoverOpen(popover) {
			      if (!popover) return;
			      removeSettingsPopoverFromStack(popover);
			      settingsPopoverOpenStack.push(popover);
			    }

			    function trackSettingsPopoverClosed(popover) {
			      removeSettingsPopoverFromStack(popover);
			    }

			    const SETTINGS_POPOVER_ESCAPE_ENTRIES = [
			      { popover: modelSettingsPopover, close: closeModelSettingsPopover },
			      { popover: providerSettingsPopover, close: closeProviderSettingsPopover },
			      { popover: sessionSettingsPopover, close: closeSessionSettingsPopover },
			      { popover: safetySettingsPopover, close: closeSafetySettingsPopover },
			      { popover: skillsSettingsPopover, close: closeSkillsSettingsPopover },
			    ];

			    const SETTINGS_POPOVER_OUTSIDE_POINTER_ENTRIES = [
			      { popover: modelSettingsPopover, triggers: [modelSettings, modelPicker], close: closeModelSettingsPopover },
			      { popover: providerSettingsPopover, triggers: providerSettings, close: closeProviderSettingsPopover },
			      { popover: sessionSettingsPopover, triggers: sessionSettings, close: closeSessionSettingsPopover },
			      { popover: safetySettingsPopover, triggers: safetySettings, close: closeSafetySettingsPopover },
			      { popover: skillsSettingsPopover, triggers: skillsSettings, close: closeSkillsSettingsPopover },
			    ];

				    for (let settingsEntryIndex = 0; settingsEntryIndex < SETTINGS_POPOVER_ESCAPE_ENTRIES.length; settingsEntryIndex++) {
				      const settingsEntry = SETTINGS_POPOVER_ESCAPE_ENTRIES[settingsEntryIndex];
				      if (settingsEntry.popover) settingsPopoverOpenStates.set(settingsEntry.popover, false);
				    }

				    function findSettingsPopoverEntry(popover, entries) {
				      for (let settingsEntryIndex = 0; settingsEntryIndex < entries.length; settingsEntryIndex++) {
				        const settingsEntry = entries[settingsEntryIndex];
				        if (settingsEntry.popover === popover) return settingsEntry;
				      }
				      return null;
				    }

			    function closeSettingsPopoverForEscape() {
			      const entries = SETTINGS_POPOVER_ESCAPE_ENTRIES;
			      while (settingsPopoverOpenStack.length > 0) {
			        const popover = settingsPopoverOpenStack[settingsPopoverOpenStack.length - 1];
			        const entry = findSettingsPopoverEntry(popover, entries);
			        if (!entry || !isSettingsPopoverOpen(popover)) {
			          settingsPopoverOpenStack.pop();
			          continue;
			        }
			        entry.close();
			        return true;
			      }
				      for (let settingsEntryIndex = 0; settingsEntryIndex < entries.length; settingsEntryIndex++) {
				        const settingsEntry = entries[settingsEntryIndex];
				        if (!isSettingsPopoverOpen(settingsEntry.popover)) continue;
				        settingsEntry.close();
				        return true;
				      }
			      return false;
			    }

			    function closeOpenSettingsPopoversFromOutsidePointer(target) {
			      if (settingsPopoverOpenStack.length === 0) return;
			      const entries = SETTINGS_POPOVER_OUTSIDE_POINTER_ENTRIES;
			      for (let i = settingsPopoverOpenStack.length - 1; i >= 0; i--) {
			        const popover = settingsPopoverOpenStack[i];
			        const entry = findSettingsPopoverEntry(popover, entries);
			        if (!entry || !isSettingsPopoverOpen(popover)) {
			          settingsPopoverOpenStack.splice(i, 1);
			          continue;
			        }
			        closeSettingsPopoverFromOutsidePointer(entry.popover, entry.triggers, entry.close, target);
			      }
			    }

		    function restoreSettingsPopoverFocusAfterPointerDismiss(popover, target) {
		      if (!settingsPopoverContainsFocus(popover)) return;
		      const fallbackTarget = target && target !== document.body ? target : null;
		      clearSettingsPopoverFocusRestoreTimer();
		      const timer = setTimeout(() => {
		        if (settingsPopoverFocusRestoreTimer !== timer) return;
		        settingsPopoverFocusRestoreTimer = null;
		        if (!settingsPopoverContainsFocus(popover)) return;
		        if (focusSettingsPopoverTarget(fallbackTarget)) return;
		        restoreSettingsPopoverFocus(null);
		      }, 0);
		      settingsPopoverFocusRestoreTimer = timer;
		    }

			    function closeSettingsPopoverFromOutsidePointer(popover, triggers, close, target) {
			      if (!isSettingsPopoverOpen(popover)) return;
			      if (isSettingsPopoverBoundaryTarget(popover, target, triggers)) return;
			      restoreSettingsPopoverFocusAfterPointerDismiss(popover, target);
			      close({ restoreFocus: false });
			    }

			    function toggleSettingsPopover(popover, open, close) {
			      if (!popover) return;
			      if (isSettingsPopoverOpen(popover)) {
			        close();
			      } else {
			        open();
			      }
			    }

				    function openSettingsPopover(popover, fallbackTrigger, closeControl, expandedTriggers) {
				      if (!popover) return;
				      const knownOpen = settingsPopoverOpenStates.get(popover);
				      if (knownOpen === true) return;
			      const wasHidden = knownOpen === false ? true : (!popover.classList || popover.classList.contains('hidden'));
			      if (wasHidden) {
			        settingsPopoverFocusReturnTargets.set(popover, getSettingsPopoverFocusReturnTarget(popover, fallbackTrigger));
			      }
				      if (popover.classList) popover.classList.toggle('hidden', false);
			      settingsPopoverOpenStates.set(popover, true);
					      if (wasHidden) trackSettingsPopoverOpen(popover);
					      setSettingsPopoverTriggersExpanded(expandedTriggers || fallbackTrigger, true);
			      if (wasHidden) focusSettingsPopoverTarget(closeControl);
			    }

				    function closeSettingsPopover(popover, expandedTriggers, options) {
				      if (!popover) return;
				      const knownOpen = settingsPopoverOpenStates.get(popover);
				      if (knownOpen === false) return;
				      const wasOpen = knownOpen === true ? true : (!popover.classList || !popover.classList.contains('hidden'));
				      let focusReturnTarget = settingsPopoverFocusReturnTargets.get(popover) || null;
				      settingsPopoverFocusReturnTargets.delete(popover);
			      if (!focusReturnTarget) {
				        if (Array.isArray(expandedTriggers)) {
				          for (let triggerIndex = 0; triggerIndex < expandedTriggers.length; triggerIndex++) {
				            const trigger = expandedTriggers[triggerIndex];
				            if (canFocusSettingsPopoverTarget(trigger)) {
			              focusReturnTarget = trigger;
			              break;
			            }
			          }
			        } else if (canFocusSettingsPopoverTarget(expandedTriggers)) {
			          focusReturnTarget = expandedTriggers;
			        }
				      }
				      if (popover.classList) popover.classList.toggle('hidden', true);
				      settingsPopoverOpenStates.set(popover, false);
					      trackSettingsPopoverClosed(popover);
				      setSettingsPopoverTriggersExpanded(expandedTriggers, false);
		      if (wasOpen && (!options || options.restoreFocus !== false)) {
		        restoreSettingsPopoverFocus(focusReturnTarget);
		      }
		    }

		    function updateSkillsEnabledState(enabled) {
	      skillsEnabled = !!enabled;
	      setChecked(skillsToggle, skillsEnabled);
	      if (skillsToggleLabel) {
	        setTitle(skillsToggleLabel, skillsEnabled
	          ? 'Skills are on: $ suggestions and the skill tool are available.'
	          : 'Skills are off: $ suggestions and the skill tool are disabled.');
	      }
	      if (!skillsEnabled) {
	        closeSkillDropdown();
	      } else {
	        updateSkillDropdown();
	      }
	    }

	    function normalizeSkillSearchPaths(raw) {
	      return normalizeSeparatedStringList(raw);
	    }

	    function getSkillSearchPathsTitleDisplayText(paths) {
	      const value = formatCommaSeparatedList(paths);
	      return value.length <= SKILL_SEARCH_PATHS_TITLE_DISPLAY_LIMIT
	        ? value
	        : value.slice(0, SKILL_SEARCH_PATHS_TITLE_DISPLAY_LIMIT) + '…';
	    }

	    function updateSkillsSettingsTitle() {
	      if (!skillsSettings) return;
	      const pathText = skillSearchPaths.length ? skillSearchPaths.length + ' path(s)' : 'no paths';
	      setTitle(skillsSettings, 'Skills: ' + pathText + ', prompt ' + skillsBudget.maxPromptSkills + ', inject ' + skillsBudget.maxInjectSkills + ', chars ' + skillsBudget.maxInjectChars);
	    }

	    function updateNormalizedSkillSearchPathsState(paths) {
	      skillSearchPaths = paths;
	      if (skillSearchPathsInput) {
	        setValue(skillSearchPathsInput, skillSearchPaths.join('\n'));
	        setTitle(skillSearchPathsInput, skillSearchPaths.length
	          ? skillSearchPaths.length + ' skill search path(s) configured.'
	          : 'No skill search paths configured.');
	      }
		      if (skillSearchPathsLabel) {
		        setTitle(skillSearchPathsLabel, skillSearchPaths.length
		          ? 'Skill search paths: ' + getSkillSearchPathsTitleDisplayText(skillSearchPaths)
		          : 'No skill search paths configured.');
	      }
	      updateSkillsSettingsTitle();
	    }

	    function updateSkillSearchPathsState(paths) {
	      updateNormalizedSkillSearchPathsState(normalizeSkillSearchPaths(paths));
	    }

		    function normalizeSkillsBudget(budget) {
		      const raw = budget && typeof budget === 'object' ? budget : {};
		      const maxPromptSkills = Number(raw.maxPromptSkills);
		      const maxInjectSkills = Number(raw.maxInjectSkills);
		      const maxInjectChars = Number(raw.maxInjectChars);
		      return {
		        maxPromptSkills: Number.isFinite(maxPromptSkills) && maxPromptSkills >= 0 ? Math.floor(maxPromptSkills) : 50,
		        maxInjectSkills: Number.isFinite(maxInjectSkills) && maxInjectSkills >= 1 ? Math.floor(maxInjectSkills) : 5,
		        maxInjectChars: Number.isFinite(maxInjectChars) && maxInjectChars >= 1 ? Math.floor(maxInjectChars) : 20000,
		      };
		    }

		    function updateNormalizedSkillsBudgetState(budget) {
		      skillsBudget = budget;
		      setValue(skillsMaxPromptInput, skillsBudget.maxPromptSkills);
		      setValue(skillsMaxInjectInput, skillsBudget.maxInjectSkills);
		      setValue(skillsMaxInjectCharsInput, skillsBudget.maxInjectChars);
		      updateSkillsSettingsTitle();
		    }

		    function updateSkillsBudgetState(budget) {
		      updateNormalizedSkillsBudgetState(normalizeSkillsBudget(budget));
		    }

			    function normalizeAvailableSkills(skills) {
			      const next = Array.isArray(skills) ? skills : [];
				      const seen = new Set();
				      const normalized = [];
				      const searchText = [];
				      const key = createCompactRenderStateKeyBuilder();
				      for (let i = 0; i < next.length; i++) {
				        const item = next[i];
				        if (typeof item !== 'string') continue;
				        const name = item.trim();
				        if (!name) continue;
				        if (seen.has(name)) continue;
				        seen.add(name);
				        normalized.push(name);
				        searchText.push(name.toLowerCase());
				        appendCompactRenderStateKeyPart(key, name);
				      }
				      appendCompactRenderStateKeyPart(key, normalized.length);
				      return {
				        items: normalized,
				        searchText,
				        key: finishCompactRenderStateKey(key),
				      };
				    }

			    function setAvailableSkillsFromNormalized(next) {
			      if (!next || next.key === availableSkillsKey) return false;
			      const items = Array.isArray(next.items) ? next.items : [];
			      const searchText = Array.isArray(next.searchText) ? next.searchText : [];
			      availableSkills = items;
			      availableSkillSearchText = searchText;
			      availableSkillsKey = next.key;
			      availableSkillsVersion += 1;
			      updateSkillDropdown();
			      return true;
			    }

			    function setAvailableSkills(skills) {
			      return setAvailableSkillsFromNormalized(normalizeAvailableSkills(skills));
			    }

	    function setSkillDropdownVisible(visible) {
	      if (!skillDropdown) return;
	      const visibleFlag = !!visible;
	      if (skillDropdownVisible === visibleFlag) return;
	      skillDropdownVisible = visibleFlag;
	      if (skillDropdown.classList) {
	        skillDropdown.classList.toggle('hidden', !visibleFlag);
	      }
	    }

	    function closeSkillDropdown() {
	      if (!skillDropdown) return;
	      if (!skillDropdownOpen && skillDropdownItems.length === 0 && skillDropdownTokenStart === -1 && !skillDropdownQuery) return;
	      skillDropdownOpen = false;
	      skillDropdownItems = [];
	      skillDropdownItemsVersion = -1;
	      skillDropdownRenderKey = '';
	      skillDropdownSelectedIndex = 0;
	      skillDropdownSyncedSelectedIndex = -1;
	      skillDropdownTokenStart = -1;
	      skillDropdownQuery = '';
	      skillDropdownLocalQuery = '';
	      setSkillDropdownVisible(false);
	      syncSkillDropdownInputState();
	      replaceElementChildren(skillDropdown);
	    }

	    function isSkillQueryChar(ch) {
	      return SKILL_QUERY_CHAR_RE.test(ch || '');
	    }

		    function isWhitespaceChar(ch) {
		      const text = String(ch || '');
		      if (!text) return false;
		      const code = text.charCodeAt(0);
		      if (code === 32 || (code >= 9 && code <= 13)) return true;
		      if (code < 128) return false;
		      return WHITESPACE_CHAR_RE.test(text[0]);
		    }

	    function getSkillMentionContext() {
	      if (!input) return null;
	      const selectionStart = input.selectionStart;
	      const selectionEnd = input.selectionEnd;
	      if (selectionStart !== selectionEnd) return null;
	      const value = String(input.value || '');
	      const caret = selectionStart || 0;
	      let tokenStart = caret;
	      while (tokenStart > 0 && !isWhitespaceChar(value[tokenStart - 1])) tokenStart -= 1;
	      if (value[tokenStart] !== '$') return null;
	      for (let i = tokenStart + 1; i < caret; i++) {
	        if (!isSkillQueryChar(value[i])) return null;
	      }
	      return { start: tokenStart, query: value.slice(tokenStart + 1, caret) };
	    }

	    function filterSkillsForQuery(localQuery) {
	      const q = localQuery || '';
	      const matches = [];
	      let hasPrefixMatches = false;
		      for (let i = 0; i < availableSkills.length; i++) {
		        const name = availableSkills[i];
		        if (!q) {
		          matches.push(name);
		          if (matches.length >= SKILL_DROPDOWN_MAX_ITEMS) break;
		          continue;
		        }
		        const haystack = availableSkillSearchText[i] || '';
	        if (haystack.startsWith(q)) {
	          if (!hasPrefixMatches) {
	            matches.length = 0;
	            hasPrefixMatches = true;
	          }
	          matches.push(name);
	          if (matches.length >= SKILL_DROPDOWN_MAX_ITEMS) break;
	        } else if (!hasPrefixMatches && matches.length < SKILL_DROPDOWN_MAX_ITEMS && haystack.includes(q)) {
	          matches.push(name);
	        }
	      }
	      return matches;
	    }

	    function getSkillDropdownOptionId(index) {
	      return 'skillDropdownOption-' + index;
	    }

	    function syncSkillDropdownInputState() {
	      const expanded = skillDropdownOpen ? 'true' : 'false';
	      const activeId = skillDropdownOpen && skillDropdownItems.length > 0
	        ? getSkillDropdownOptionId(skillDropdownSelectedIndex)
	        : '';
	      const nextStateKeyBuilder = createCompactRenderStateKeyBuilder();
	      appendCompactRenderStateKeyPart(nextStateKeyBuilder, expanded);
	      appendCompactRenderStateKeyPart(nextStateKeyBuilder, activeId);
	      const nextStateKey = finishCompactRenderStateKey(nextStateKeyBuilder);
	      if (nextStateKey === skillDropdownInputStateKey) return;
	      skillDropdownInputStateKey = nextStateKey;
	      setAttributeValue(input, 'aria-expanded', expanded);
	      if (activeId) {
	        setAttributeValue(input, 'aria-activedescendant', activeId);
	      } else {
	        removeAttributeValue(input, 'aria-activedescendant');
	      }
	    }

		    function scrollSelectedSkillDropdownItemIntoView() {
		      if (!skillDropdown || !skillDropdownOpen || !skillDropdownItems.length) return;
		      const selectedEl = skillDropdown.children && skillDropdown.children[skillDropdownSelectedIndex];
		      if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
		        try { selectedEl.scrollIntoView({ block: 'nearest' }); } catch {}
		      }
		    }

		    function syncSkillDropdownItemSelection(index, selected) {
		      if (!skillDropdown || index < 0) return;
		      const itemEl = skillDropdown.children && skillDropdown.children[index];
		      if (!itemEl || !skillDropdownItemIndexByElement.has(itemEl)) return;
		      const nextClassName = 'skill-dropdown-item' + (selected ? ' selected' : '');
		      if (itemEl.className !== nextClassName) itemEl.className = nextClassName;
		      if (selected) {
		        setAttributeValue(itemEl, 'aria-selected', 'true');
		      } else {
		        removeAttributeValue(itemEl, 'aria-selected');
		      }
		    }

		    function syncSkillDropdownSelection(previousIndex) {
		      if (!skillDropdown || !skillDropdownOpen || !skillDropdownItems.length) {
		        skillDropdownSyncedSelectedIndex = -1;
		        syncSkillDropdownInputState();
		        return;
		      }
		      if (skillDropdownSyncedSelectedIndex === skillDropdownSelectedIndex) {
		        syncSkillDropdownInputState();
		        return;
		      }
		      if (Number.isFinite(previousIndex) && previousIndex !== skillDropdownSelectedIndex) {
		        syncSkillDropdownItemSelection(previousIndex, false);
		        syncSkillDropdownItemSelection(skillDropdownSelectedIndex, true);
		        skillDropdownSyncedSelectedIndex = skillDropdownSelectedIndex;
		        syncSkillDropdownInputState();
		        scrollSelectedSkillDropdownItemIntoView();
		        return;
		      }
		      const children = skillDropdown.children || [];
		      for (let i = 0; i < children.length; i++) {
		        const itemEl = children[i];
		        if (!itemEl || !skillDropdownItemIndexByElement.has(itemEl)) continue;
		        syncSkillDropdownItemSelection(i, i === skillDropdownSelectedIndex);
		      }
		      skillDropdownSyncedSelectedIndex = skillDropdownSelectedIndex;
		      syncSkillDropdownInputState();
		      scrollSelectedSkillDropdownItemIntoView();
		    }

		    function getSkillDropdownRenderKey() {
		      const key = createCompactRenderStateKeyBuilder();
		      appendCompactRenderStateKeyPart(key, skillDropdownItems.length);
		      if (skillDropdownItems.length === 0) {
		        appendCompactRenderStateKeyPart(key, availableSkills.length === 0 ? 'No skills available.' : 'No matching skills.');
		        return finishCompactRenderStateKey(key);
		      }
		      for (let i = 0; i < skillDropdownItems.length; i++) {
		        appendCompactRenderStateKeyPart(key, skillDropdownItems[i]);
		      }
		      return finishCompactRenderStateKey(key);
		    }

	    function renderSkillDropdown() {
	      if (!skillDropdown) return;
	      const nextRenderKey = getSkillDropdownRenderKey();
	      if (skillDropdownOpen && skillDropdownRenderKey === nextRenderKey) {
	        syncSkillDropdownSelection();
	        return;
	      }
	      skillDropdownRenderKey = nextRenderKey;

	      if (skillDropdownItems.length === 0) {
	        const emptyEl = document.createElement('div');
	        emptyEl.className = 'skill-dropdown-empty';
	        const emptyText = availableSkills.length === 0 ? 'No skills available.' : 'No matching skills.';
	        emptyEl.setAttribute('role', 'option');
	        emptyEl.setAttribute('aria-disabled', 'true');
	        emptyEl.setAttribute('aria-label', emptyText);
	        emptyEl.textContent = emptyText;
	        replaceElementChildren(skillDropdown, emptyEl);
	      } else {
	        const fragment = skillDropdownItems.length > 1 ? document.createDocumentFragment() : null;
	        let singleItemEl = null;
	        for (let i = 0; i < skillDropdownItems.length; i++) {
	          const name = skillDropdownItems[i];
	          const displayName = name.length <= SKILL_DROPDOWN_ITEM_DISPLAY_LIMIT
	            ? name
	            : name.slice(0, SKILL_DROPDOWN_ITEM_DISPLAY_LIMIT) + '…';
	          const itemEl = document.createElement('div');
	          itemEl.className = 'skill-dropdown-item' + (i === skillDropdownSelectedIndex ? ' selected' : '');
	          itemEl.id = getSkillDropdownOptionId(i);
	          skillDropdownItemIndexByElement.set(itemEl, i);
	          itemEl.setAttribute('role', 'option');
	          if (i === skillDropdownSelectedIndex) itemEl.setAttribute('aria-selected', 'true');
	          itemEl.textContent = displayName;
	          itemEl.title = displayName;
	          if (fragment) {
	            fragment.appendChild(itemEl);
	          } else {
	            singleItemEl = itemEl;
	          }
	        }
	        replaceElementChildren(skillDropdown, fragment || singleItemEl);
	      }
	      skillDropdownSyncedSelectedIndex = skillDropdownItems.length > 0 ? skillDropdownSelectedIndex : -1;

	      setSkillDropdownVisible(true);
	      skillDropdownOpen = true;
	      syncSkillDropdownInputState();
	      scrollSelectedSkillDropdownItemIntoView();
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
	      const queryChanged = prevQuery !== ctx.query || prevStart !== ctx.start;
	      const skillsChanged = skillDropdownItemsVersion !== availableSkillsVersion;
	      if (!queryChanged && !skillsChanged && skillDropdownOpen) return;

	      const nextLocalQuery = queryChanged ? ctx.query.toLowerCase() : skillDropdownLocalQuery;
	      const nextItems = filterSkillsForQuery(nextLocalQuery);
	      skillDropdownItems = nextItems;
	      skillDropdownItemsVersion = availableSkillsVersion;
	      skillDropdownTokenStart = ctx.start;
	      skillDropdownQuery = ctx.query;
	      skillDropdownLocalQuery = nextLocalQuery;

	      if (queryChanged || skillsChanged || skillDropdownSelectedIndex >= nextItems.length) {
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
		      if (next === skillDropdownSelectedIndex) return;
		      const previousIndex = skillDropdownSelectedIndex;
		      skillDropdownSelectedIndex = next;
		      syncSkillDropdownSelection(previousIndex);
		    }

	    function applySkillSuggestion(name) {
	      if (!input) return;
	      const text = input.value || '';
	      const start = skillDropdownTokenStart;
	      if (!Number.isFinite(start) || start < 0 || start >= text.length || text[start] !== '$') return;

	      let end = start + 1;
	      while (end < text.length && isSkillQueryChar(text[end])) end++;

	      const before = text.slice(0, start);
	      const after = text.slice(end);
	      let nextText = before + '$' + name + after;
	      let caret = before.length + 1 + name.length;
	      if (caret === nextText.length) {
	        nextText += ' ';
	        caret += 1;
	      }

	      if (text !== nextText) {
	        input.value = nextText;
	        updateInputLayout();
	      }
	      try { input.setSelectionRange(caret, caret); } catch {}
	      closeSkillDropdown();
	      focusComposerInput();
	    }

	    function applySelectedSkill() {
	      if (!skillDropdownOpen) return false;
	      if (!skillDropdownItems || skillDropdownItems.length === 0) return false;
	      const name = skillDropdownItems[skillDropdownSelectedIndex];
	      if (!name) return false;
	      applySkillSuggestion(name);
	      return true;
	    }

	    function matchesGoalCommandTextAt(value, tokenStart, tokenLength) {
	      for (let offset = 0; offset < tokenLength; offset++) {
	        const index = tokenStart + offset;
	        const char = value[index];
		        if (isWhitespaceChar(char)) return false;
	        const code = value.charCodeAt(index);
	        const expectedCode = GOAL_COMMAND_TEXT.charCodeAt(offset);
	        if (offset === 0) {
	          if (code !== expectedCode) return false;
	        } else if (code !== expectedCode && code !== expectedCode - 32) {
	          return false;
	        }
	      }
	      return true;
	    }

	    function inputStartsWithGoalCommand(value) {
	      let tokenStart = 0;
		      while (tokenStart < value.length && isWhitespaceChar(value[tokenStart])) tokenStart++;
	      if (value.length - tokenStart < GOAL_COMMAND_TEXT.length) return false;
	      return matchesGoalCommandTextAt(value, tokenStart, GOAL_COMMAND_TEXT.length);
	    }

	    function shouldShowGoalCommandSuggestion() {
	      if (!input || !initReceived) return false;
	      const value = String(input.value || '');
	      let tokenStart = 0;
		      while (tokenStart < value.length && isWhitespaceChar(value[tokenStart])) tokenStart++;
	      const tokenLength = value.length - tokenStart;
	      if (tokenLength === 0 || tokenLength > GOAL_COMMAND_TEXT.length) return false;
	      return matchesGoalCommandTextAt(value, tokenStart, tokenLength);
	    }

	    function updateGoalCommandSuggestion() {
	      if (!goalCommandSuggestion) return;
	      const nextVisible = shouldShowGoalCommandSuggestion();
	      if (nextVisible === goalCommandSuggestionVisible) return;
	      goalCommandSuggestionVisible = nextVisible;
	      if (goalCommandSuggestion.classList) {
	        goalCommandSuggestion.classList.toggle('hidden', !nextVisible);
	      }
	    }

	    function getComposerInputAssistState() {
	      return {
	        initReceived: !!initReceived,
	        isProcessing: !!isProcessing,
	        skillsEnabled: !!skillsEnabled,
	        availableSkillsVersion,
	        goalCommandSuggestionVisible,
	        skillDropdownOpen,
	        skillDropdownTokenStart,
	        skillDropdownQuery,
	        skillDropdownItemsVersion,
	        value: input ? String(input.value || '') : '',
	        selectionStart: input ? input.selectionStart || 0 : 0,
	        selectionEnd: input ? input.selectionEnd || 0 : 0,
	      };
	    }

	    function composerInputAssistStatesEqual(a, b) {
	      return !!a && !!b &&
	        a.initReceived === b.initReceived &&
	        a.isProcessing === b.isProcessing &&
	        a.skillsEnabled === b.skillsEnabled &&
	        a.availableSkillsVersion === b.availableSkillsVersion &&
	        a.goalCommandSuggestionVisible === b.goalCommandSuggestionVisible &&
	        a.skillDropdownOpen === b.skillDropdownOpen &&
	        a.skillDropdownTokenStart === b.skillDropdownTokenStart &&
	        a.skillDropdownQuery === b.skillDropdownQuery &&
	        a.skillDropdownItemsVersion === b.skillDropdownItemsVersion &&
	        a.value === b.value &&
	        a.selectionStart === b.selectionStart &&
	        a.selectionEnd === b.selectionEnd;
	    }

	    function rememberComposerInputAssistState() {
	      composerInputAssistState = getComposerInputAssistState();
	    }

	    function refreshComposerInputAssist() {
	      const nextState = getComposerInputAssistState();
	      if (composerInputAssistStatesEqual(nextState, composerInputAssistState)) return;
	      updateGoalCommandSuggestion();
	      updateSkillDropdown();
	      rememberComposerInputAssistState();
	    }

	    function insertGoalCommand() {
	      if (!input) return;
	      const current = String(input.value || '');
	      const next = inputStartsWithGoalCommand(current) ? current : '/goal ';
	      inputHistoryIndex = -1;
	      inputHistorySavedDraft = null;
	      if (next !== current) {
	        input.value = next;
	        updateInputLayout({ clearButton: false });
	      }
		      const caret = next.length;
		      closeSkillDropdown();
		      syncComposerInputState();
		      focusComposerInput();
		      try { input.setSelectionRange(caret, caret); } catch {}
	    }

			    function setInputHistoryEntries(entries) {
			      const next = Array.isArray(entries) ? entries : [];
			      const normalized = [];
			      for (let itemIndex = 0; itemIndex < next.length; itemIndex++) {
			        const item = next[itemIndex];
			        if (typeof item !== 'string') continue;
		        const trimmed = item.trim();
	        if (!trimmed) continue;
	        normalized.push(trimmed.length > INPUT_HISTORY_MAX_ENTRY_CHARS ? trimmed.slice(0, INPUT_HISTORY_MAX_ENTRY_CHARS) : trimmed);
		        if (normalized.length >= INPUT_HISTORY_MAX_ENTRIES) break;
		      }

		      if (stringListsEqual(normalized, inputHistoryEntries)) return false;
		      inputHistoryEntries = normalized;
		      if (inputHistoryIndex >= 0) {
		        inputHistoryIndex = -1;
		        inputHistorySavedDraft = null;
		      }
		      return true;
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

	    function readWebviewState() {
	      try {
	        const state = vscode.getState();
	        return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
	      } catch {
	        return {};
	      }
	    }

	    function writeWebviewStateValue(key, value) {
	      if (!key) return false;
	      try {
	        const state = Object.assign({}, readWebviewState());
	        if (value === undefined) {
	          delete state[key];
	        } else {
	          state[key] = value;
	        }
	        vscode.setState(state);
	        return true;
	      } catch {
	        return false;
	      }
	    }

	    function clearComposerDraftStateTimer() {
	      if (composerDraftStateTimer === null) return;
	      clearTimeout(composerDraftStateTimer);
	      composerDraftStateTimer = null;
	    }

	    function persistComposerDraftStateNow() {
	      clearComposerDraftStateTimer();
	      const draft = input ? String(input.value || '') : '';
	      if (pendingComposerSubmission && !draft) return false;
	      if (draft === lastPersistedComposerDraft) return false;
	      const persisted = writeWebviewStateValue(
	        COMPOSER_DRAFT_WEBVIEW_STATE_KEY,
	        draft ? draft : undefined
	      );
	      if (persisted) lastPersistedComposerDraft = draft;
	      return persisted;
	    }

	    function scheduleComposerDraftStatePersistence() {
	      if (composerDraftStateTimer !== null) return;
	      composerDraftStateTimer = setTimeout(() => {
	        composerDraftStateTimer = null;
	        persistComposerDraftStateNow();
	      }, WEBVIEW_STATE_WRITE_DEBOUNCE_MS);
	    }

	    function restoreComposerDraftState() {
	      const state = readWebviewState();
	      const draft = typeof state[COMPOSER_DRAFT_WEBVIEW_STATE_KEY] === 'string'
	        ? state[COMPOSER_DRAFT_WEBVIEW_STATE_KEY]
	        : '';
	      lastPersistedComposerDraft = draft;
	      if (!input || input.value === draft) return false;
	      input.value = draft;
	      updateInputLayout({ clearButton: false, persistDraft: false });
	      return true;
	    }

	    function readPersistedComposerSubmissionId() {
	      const state = readWebviewState();
	      const submissionId = state[COMPOSER_SUBMISSION_WEBVIEW_STATE_KEY];
	      return typeof submissionId === 'string' ? submissionId : '';
	    }

	    function persistComposerSubmissionId(submissionId) {
	      return writeWebviewStateValue(
	        COMPOSER_SUBMISSION_WEBVIEW_STATE_KEY,
	        submissionId ? String(submissionId) : undefined
	      );
	    }

	    function getTranscriptPositionStateKey(state) {
	      if (!state || typeof state !== 'object') return '';
	      return [
	        String(state.sessionId || ''),
	        state.atBottom === false ? 'away' : 'bottom',
	        String(state.anchorId || ''),
	        String(Number.isFinite(state.anchorOffset) ? state.anchorOffset : ''),
	        String(Number.isFinite(state.distanceFromBottom) ? state.distanceFromBottom : ''),
	      ].join('\n');
	    }

	    function readPersistedTranscriptPositionState() {
	      const state = readWebviewState();
	      const position = state[TRANSCRIPT_POSITION_WEBVIEW_STATE_KEY];
	      return position && typeof position === 'object' && !Array.isArray(position) ? position : null;
	    }

	    function rememberPersistedTranscriptPositionState(state) {
	      lastPersistedTranscriptPositionKey = getTranscriptPositionStateKey(state);
	    }

	    function clearTranscriptPositionStateTimer() {
	      if (transcriptPositionStateTimer === null) return;
	      clearTimeout(transcriptPositionStateTimer);
	      transcriptPositionStateTimer = null;
	    }

	    function persistTranscriptPositionStateNow() {
	      clearTranscriptPositionStateTimer();
	      if (!currentSessionId || typeof captureTranscriptPositionState !== 'function') return false;
	      const state = captureTranscriptPositionState(currentSessionId);
	      if (!state) return false;
	      const key = getTranscriptPositionStateKey(state);
	      if (key === lastPersistedTranscriptPositionKey) return false;
	      const persisted = writeWebviewStateValue(TRANSCRIPT_POSITION_WEBVIEW_STATE_KEY, state);
	      if (persisted) lastPersistedTranscriptPositionKey = key;
	      return persisted;
	    }

	    function scheduleTranscriptPositionStatePersistence() {
	      if (!initReceived || !currentSessionId || transcriptPositionStateTimer !== null) return;
	      transcriptPositionStateTimer = setTimeout(() => {
	        transcriptPositionStateTimer = null;
	        persistTranscriptPositionStateNow();
	      }, WEBVIEW_STATE_WRITE_DEBOUNCE_MS);
	    }

			    function cancelModelPickerSearchRender() {
			      cancelAnimationFrameHandle(modelPickerSearchRenderFrame);
			      modelPickerSearchRenderFrame = null;
			    }

			    function cancelToolsCatalogSearchRender() {
			      cancelAnimationFrameHandle(toolsCatalogSearchRenderFrame);
			      toolsCatalogSearchRenderFrame = null;
			    }

		    function setModelPickerListVisible(visible) {
		      const nextVisible = !!visible;
		      if (!modelPickerList || modelPickerListVisible === nextVisible) return;
		      modelPickerListVisible = nextVisible;
		      if (modelPickerList.classList) {
		        modelPickerList.classList.toggle('hidden', !nextVisible);
		      }
		    }

		    function setToolsCatalogVisible(visible) {
		      const nextVisible = !!visible;
		      if (toolsCatalog && toolsCatalogVisible !== nextVisible) {
		        toolsCatalogVisible = nextVisible;
		        if (toolsCatalog.classList) {
		          toolsCatalog.classList.toggle('hidden', !nextVisible);
		        }
		      }
		      if (toolsCatalogSearchLabel && toolsCatalogSearchVisible !== nextVisible) {
		        toolsCatalogSearchVisible = nextVisible;
		        if (toolsCatalogSearchLabel.classList) {
		          toolsCatalogSearchLabel.classList.toggle('hidden', !nextVisible);
		        }
		      }
		    }

			    function clearModelPickerCache() {
				      cancelModelPickerSearchRender();
				      currentModelPickerState = null;
				      modelPickerSearchQuery = '';
				      modelPickerSearchDisplayQuery = '';
				      modelPickerSearchLocalQuery = '';
				      modelPickerListControlsDisabledKey = '';
				      modelPickerListControls = [];
					      modelPickerRenderKey = '';
					      modelPickerRenderedState = null;
					      modelPickerRenderedCurrentModelId = '';
					      modelPickerRenderedQuery = '';
					      modelSearchTextCache = new WeakMap();
				      if (modelPickerSearchInput) setValue(modelPickerSearchInput, '');
				      if (modelPickerList) {
				        replaceElementChildren(modelPickerList);
				        setModelPickerListVisible(false);
				      }
				      setTextContent(modelPickerStatus, '');
		    }

	    const invalidFieldStateByElement = new WeakMap();

	    function markInvalidField(el, message) {
	      if (!el) return;
	      const nextMessage = message ? String(message) : '';
	      const hasMessage = !!nextMessage;
	      const previousState = invalidFieldStateByElement.get(el) || null;
	      if (!hasMessage && !previousState) return;
	      try { el.setCustomValidity(nextMessage); } catch {}
	      if (hasMessage) {
	        try { el.reportValidity(); } catch {}
	      }
	      try { setAttributeValue(el, 'aria-invalid', hasMessage ? 'true' : 'false'); } catch {}
	      try {
	        if (hasMessage) {
	          const previousTitle = previousState ? previousState.previousTitle : (el.getAttribute ? el.getAttribute('title') || '' : '');
	          invalidFieldStateByElement.set(el, { previousTitle });
	          setTitle(el, nextMessage);
	        } else {
	          invalidFieldStateByElement.delete(el);
	          const previousTitle = previousState ? previousState.previousTitle || '' : '';
	          if (previousTitle) {
	            setTitle(el, previousTitle);
	          } else if (!el.hasAttribute || el.hasAttribute('title')) {
	            if (el.removeAttribute) el.removeAttribute('title');
	          }
	        }
	      } catch {
	        if (hasMessage) el.title = nextMessage;
	      }
	    }

		    function clearInvalidFields(fields) {
		      if (!Array.isArray(fields)) return;
		      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
		        const field = fields[fieldIndex];
		        markInvalidField(field, '');
		      }
		    }

	    function validateNumberField(el, value, min, message, max) {
	      const parsed = Number(value);
	      if (!Number.isFinite(parsed) || parsed < min || (Number.isFinite(max) && parsed > max)) {
	        markInvalidField(el, message);
	        return false;
	      }
	      return true;
	    }

	    function requestAnimationFrameHandle(callback) {
	      if (typeof callback !== 'function') return null;
	      let ranSynchronously = false;
	      const runCallback = () => {
	        ranSynchronously = true;
	        callback();
	      };
	      let frame = null;
	      if (typeof window !== 'undefined' && window && typeof window.requestAnimationFrame === 'function') {
	        frame = window.requestAnimationFrame(runCallback);
	      } else if (typeof requestAnimationFrame === 'function') {
	        frame = requestAnimationFrame(runCallback);
	      } else {
	        callback();
	        return null;
	      }
	      return ranSynchronously ? null : frame;
	    }

	    function cancelAnimationFrameHandle(frame) {
	      if (frame === null || frame === undefined) return;
	      if (typeof window !== 'undefined' && window && typeof window.cancelAnimationFrame === 'function') {
	        window.cancelAnimationFrame(frame);
	        return;
	      }
	      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
	    }

	    function clearQueuedAnimationFrames() {
	      liveRegionAnnouncementVersion += 1;
	      cancelAnimationFrameHandle(liveRegionAnnouncementFrame);
	      liveRegionAnnouncementFrame = null;
	      pendingLiveRegionAnnouncement = '';

	      cancelAnimationFrameHandle(scrollStateFrame);
	      scrollStateFrame = null;
	      scrollStateFramePending = false;
	      scrollStateObservedUserGesture = false;
	      scrollStateObservedUserScrollUp = false;

	      cancelAnimationFrameHandle(autoScrollFrame);
	      autoScrollFrame = null;
	      autoScrollFramePending = false;
	      autoScrollSettleFramesRemaining = 0;

	      lastMessagesScrollGestureAt = 0;
	      messagesPointerScrollGesture = false;
	      messagesTouchClientY = null;

	      cancelAnimationFrameHandle(inputLayoutFrame);
	      inputLayoutFrame = null;
	      inputLayoutFramePending = false;

		      cancelModelPickerSearchRender();
		      cancelToolsCatalogSearchRender();
	    }

		    function getLiveRegionAnnouncementText(message) {
		      const text = typeof message === 'string' ? message.trim() : '';
		      return text.length <= LIVE_REGION_ANNOUNCEMENT_LIMIT
		        ? text
		        : text.slice(0, LIVE_REGION_ANNOUNCEMENT_LIMIT) + '…';
		    }

		    function announceStatus(message) {
		      if (!liveRegion) return;
		      const text = getLiveRegionAnnouncementText(message);
		      if (!text) return;
	      if (text === pendingLiveRegionAnnouncement) return;
	      if (liveRegionAnnouncementFrame === null && text === lastLiveRegionAnnouncement && lastLiveRegionRenderedText === text) return;
	      if (liveRegionAnnouncementFrame !== null) {
	        cancelAnimationFrameHandle(liveRegionAnnouncementFrame);
	        liveRegionAnnouncementFrame = null;
	      }
	      pendingLiveRegionAnnouncement = text;
	      liveRegionAnnouncementVersion += 1;
	      const version = liveRegionAnnouncementVersion;
	      setTextContent(liveRegion, '');
	      lastLiveRegionRenderedText = '';
	      liveRegionAnnouncementFrame = requestAnimationFrameHandle(() => {
	        if (version !== liveRegionAnnouncementVersion || pendingLiveRegionAnnouncement !== text) return;
	        liveRegionAnnouncementFrame = null;
	        pendingLiveRegionAnnouncement = '';
	        lastLiveRegionAnnouncement = text;
	        setTextContent(liveRegion, text);
	        lastLiveRegionRenderedText = text;
	      });
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
	          showInputNotice('Settings update is taking longer than expected. Controls were re-enabled and state was refreshed.', { sync: false });
	          requestSettingsStateRefresh();
	          syncInputState();
	        }, SETTINGS_PENDING_TIMEOUT_MS);
	        pendingSettingTimers.set(stateType, timer);
	      } else {
	        pendingSettingStateTypes.delete(stateType);
	      }
	    }

	    function clearPendingSettingStates() {
	      for (const timer of pendingSettingTimers.values()) {
	        clearTimeout(timer);
	      }
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
	      for (const timer of pendingActionTimers.values()) {
	        clearTimeout(timer);
	      }
	      pendingActionTimers.clear();
	    }

	    function recoverPendingAction(actionType, message, resetState) {
	      clearPendingActionTimer(actionType);
	      if (typeof resetState === 'function') resetState();
	      showInputNotice(message || 'Action is taking longer than expected. Controls were re-enabled.', { sync: false });
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
	        showInputNotice('Failed to request settings update.', { sync: false });
	        syncInputState();
	      }
	    }

		    function hasPendingSettingStates(stateTypes) {
		      if (Array.isArray(stateTypes)) {
		        for (let stateTypeIndex = 0; stateTypeIndex < stateTypes.length; stateTypeIndex++) {
		          const stateType = stateTypes[stateTypeIndex];
		          if (stateType && hasPendingSettingState(stateType)) return true;
		        }
	        return false;
	      }
	      return !!stateTypes && hasPendingSettingState(stateTypes);
	    }

		    function setPendingSettingStates(stateTypes, pending) {
		      if (Array.isArray(stateTypes)) {
		        for (let stateTypeIndex = 0; stateTypeIndex < stateTypes.length; stateTypeIndex++) {
		          const stateType = stateTypes[stateTypeIndex];
		          if (stateType) setPendingSettingState(stateType, pending);
		        }
	        return;
	      }
	      if (stateTypes) setPendingSettingState(stateTypes, pending);
	    }

	    function postSettingsMessages(messages) {
	      if (Array.isArray(messages)) {
	        for (let i = 0; i < messages.length; i++) {
	          if (Object.prototype.hasOwnProperty.call(messages, i)) {
	            vscode.postMessage(messages[i]);
	          }
	        }
	        return;
	      }
	      vscode.postMessage(messages);
	    }

	    function postSettingsWithPendingStates(stateTypes, messages, restoreCurrentState) {
	      if (hasPendingSettingStates(stateTypes)) {
	        if (typeof restoreCurrentState === 'function') restoreCurrentState();
	        return;
	      }
	      if (typeof restoreCurrentState === 'function') restoreCurrentState();
	      setPendingSettingStates(stateTypes, true);
	      syncInputState();
	      try {
	        postSettingsMessages(messages);
	      } catch {
	        setPendingSettingStates(stateTypes, false);
	        showInputNotice('Failed to request settings update.', { sync: false });
	        syncInputState();
	      }
	    }

		    function isCompactOperationRunning() {
		      return (
		        !!currentOperation &&
		        (currentOperation.status || 'running') === 'running' &&
		        currentOperation.kind === 'compact'
		      );
		    }

		    function shouldShowActiveTurnProcessing() {
		      return !!isProcessing && !isCompactOperationRunning();
		    }

		    function syncActiveTurnProcessingState(showActiveTurn) {
		      const nextTurnId = showActiveTurn && activeTurnId ? activeTurnId : '';
		      const previousTurnId = activeProcessingTurnId;
		      if (previousTurnId && previousTurnId !== nextTurnId) {
		        updateTurnState(previousTurnId, false);
		      }
		      if (nextTurnId) {
		        const turnData = turnEls.get(nextTurnId);
		        if (turnData && (!turnData.isProcessing || previousTurnId !== nextTurnId)) {
		          updateTurnState(nextTurnId, true);
		        }
		      }
		      activeProcessingTurnId = nextTurnId;
		    }

		    function isNearBottom() {
		      if (!messages) return true;
	      const distance = messages.scrollHeight - (messages.scrollTop + messages.clientHeight);
	      return distance < AUTO_SCROLL_THRESHOLD_PX;
	    }

		    function updateMessagesOverflowAnchor() {
		      if (!messages || !messages.style) return;
		      const nextOverflowAnchor = userScrolledAway && !transcriptScrollAnchorLocked ? 'auto' : 'none';
	      if (messages.style.overflowAnchor !== nextOverflowAnchor) {
	        messages.style.overflowAnchor = nextOverflowAnchor;
	      }
	    }

		    function setUserScrolledAway(value) {
		      const next = !!value;
		      if (next) stopAutoScrollSettle();
		      if (userScrolledAway === next) {
		        updateMessagesOverflowAnchor();
		        return;
	      }
		      userScrolledAway = next;
		      updateMessagesOverflowAnchor();
		    }

		    function rememberMessagesScrollTop() {
		      if (!messages) return;
		      lastObservedMessagesScrollTop = Number(messages.scrollTop || 0) || 0;
		    }

	    function canAutoScroll(wasNearBottom) {
	      return !!messages && !suppressAutoScroll && !userScrolledAway && !!wasNearBottom;
	    }

	    function scrollMessagesToBottom() {
	      if (!messages) return;
	      messages.scrollTop = messages.scrollHeight;
	      rememberMessagesScrollTop();
	    }

	    function stopAutoScrollSettle() {
	      autoScrollSettleFramesRemaining = 0;
	      if (!autoScrollFramePending) return;
	      cancelAnimationFrameHandle(autoScrollFrame);
	      autoScrollFrame = null;
	      autoScrollFramePending = false;
	    }

	    function queueAutoScrollFrame() {
	      if (autoScrollFramePending || autoScrollSettleFramesRemaining <= 0) return;
	      autoScrollFramePending = true;
	      autoScrollFrame = requestAnimationFrameHandle(flushScheduledAutoScroll);
	    }

	    function scheduleAutoScrollAfterLayout(wasNearBottom) {
	      if (!canAutoScroll(wasNearBottom)) return;
	      autoScrollSettleFramesRemaining = AUTO_SCROLL_SETTLE_FRAMES;
	      queueAutoScrollFrame();
	    }

	    function maybeAutoScroll(wasNearBottom) {
	      if (!canAutoScroll(wasNearBottom)) return;
	      scrollMessagesToBottom();
	      scheduleAutoScrollAfterLayout(true);
	    }

	    function markMessagesScrollGesture() {
	      lastMessagesScrollGestureAt = Date.now();
	    }

	    function hasMessagesScrollGesture() {
	      return messagesPointerScrollGesture || Date.now() - lastMessagesScrollGestureAt < SCROLL_GESTURE_WINDOW_MS;
	    }

	    function flushScrollStateUpdate() {
	      scrollStateFramePending = false;
	      scrollStateFrame = null;
	      if (!initReceived || !messages) return;
	      const observedUserGesture = scrollStateObservedUserGesture;
	      const observedUserScrollUp = scrollStateObservedUserScrollUp;
	      scrollStateObservedUserGesture = false;
	      scrollStateObservedUserScrollUp = false;
	      rememberMessagesScrollTop();
		      if (!observedUserGesture) return;
		      if (typeof cancelPendingTranscriptPositionRestore === 'function') {
		        cancelPendingTranscriptPositionRestore();
		      }
		      setUserScrolledAway(observedUserScrollUp ? true : !isNearBottom());
		      if (observedUserScrollUp && typeof maybeLoadEarlierTranscriptOnScroll === 'function') {
		        maybeLoadEarlierTranscriptOnScroll();
		      }
		      scheduleTranscriptPositionStatePersistence();
		    }

	    function scheduleScrollStateUpdate() {
	      if (!initReceived || !messages) return;
	      const currentScrollTop = Number(messages.scrollTop || 0) || 0;
	      if (hasMessagesScrollGesture()) {
	        scrollStateObservedUserGesture = true;
	      }
	      if (scrollStateObservedUserGesture && currentScrollTop < lastObservedMessagesScrollTop) {
	        scrollStateObservedUserScrollUp = true;
	        setUserScrolledAway(true);
	      }
	      lastObservedMessagesScrollTop = currentScrollTop;
	      if (scrollStateFramePending) return;
	      scrollStateFramePending = true;
	      scrollStateFrame = requestAnimationFrameHandle(flushScrollStateUpdate);
	    }

	    function flushScheduledAutoScroll() {
	      autoScrollFramePending = false;
	      autoScrollFrame = null;
	      if (autoScrollSettleFramesRemaining <= 0 || !canAutoScroll(true)) {
	        autoScrollSettleFramesRemaining = 0;
	        return;
	      }
	      scrollMessagesToBottom();
	      autoScrollSettleFramesRemaining -= 1;
	      queueAutoScrollFrame();
	    }

	    function maybeAutoScrollAfterLayout(wasNearBottom) {
	      maybeAutoScroll(wasNearBottom);
	    }

		    function hasScrollableDataMarker(el) {
		      if (!el || el.nodeType !== 1) return false;
		      if (typeof el.getAttribute === 'function' && el.getAttribute('data-scrollable') === 'true') return true;
		      return !!(el.dataset && el.dataset.scrollable === 'true');
		    }

		    function findNestedScrollableTarget(event) {
		      let target = event && event.target ? event.target : null;
		      if (target && target.nodeType !== 1) {
		        target = target.parentElement || target.parentNode || null;
		      }
		      while (target && target.nodeType === 1) {
		        if (target === messages) return null;
		        if (hasScrollableDataMarker(target)) return target;
		        target = target.parentElement || target.parentNode || null;
		      }
		      return null;
		    }

	    function handleMessagesWheel(event) {
	      if (!initReceived) return;
	      if (!event) return;
	      if (findNestedScrollableTarget(event)) return;
	      if (typeof stopTranscriptPrependSettle === 'function') {
	        stopTranscriptPrependSettle();
	      }
	      markMessagesScrollGesture();
	      stopAutoScrollSettle();
	      if (Number(event.deltaY || 0) >= 0) return;
	      setUserScrolledAway(true);
	      if (typeof maybeLoadEarlierTranscriptOnScroll === 'function') {
	        maybeLoadEarlierTranscriptOnScroll();
	      }
	    }

	    function handleMessagesPointerDown(event) {
	      if (!initReceived || !event || event.target !== messages) return;
	      if (typeof stopTranscriptPrependSettle === 'function') {
	        stopTranscriptPrependSettle();
	      }
	      messagesPointerScrollGesture = true;
	      markMessagesScrollGesture();
	      stopAutoScrollSettle();
	    }

	    function handleMessagesPointerEnd() {
	      messagesPointerScrollGesture = false;
	    }

	    function handleMessagesTouchStart(event) {
	      if (!initReceived || !event || findNestedScrollableTarget(event)) return;
	      if (typeof stopTranscriptPrependSettle === 'function') {
	        stopTranscriptPrependSettle();
	      }
	      const touch = event.touches && event.touches[0];
	      messagesTouchClientY = touch && Number.isFinite(touch.clientY) ? touch.clientY : null;
	      markMessagesScrollGesture();
	      stopAutoScrollSettle();
	    }

	    function handleMessagesTouchMove(event) {
	      if (!initReceived || !event || findNestedScrollableTarget(event)) return;
	      const touch = event.touches && event.touches[0];
	      const nextClientY = touch && Number.isFinite(touch.clientY) ? touch.clientY : null;
	      const previousClientY = messagesTouchClientY;
	      messagesTouchClientY = nextClientY;
	      if (nextClientY === null || previousClientY === null) return;
	      markMessagesScrollGesture();
	      if (previousClientY - nextClientY < 0) setUserScrolledAway(true);
	    }

	    function handleMessagesTouchEnd() {
	      messagesTouchClientY = null;
	    }

	    function handleMessagesKeyDown(event) {
	      if (!initReceived || !event || (event.target && event.target !== messages)) return;
	      if (event.altKey || event.ctrlKey || event.metaKey) return;
	      const key = event.key;
	      const isSpace = key === ' ' || key === 'Spacebar';
	      const isScrollKey =
	        key === 'ArrowUp' ||
	        key === 'ArrowDown' ||
	        key === 'PageUp' ||
	        key === 'PageDown' ||
	        key === 'Home' ||
	        key === 'End' ||
	        isSpace;
	      if (!isScrollKey) return;
	      if (typeof stopTranscriptPrependSettle === 'function') {
	        stopTranscriptPrependSettle();
	      }
	      markMessagesScrollGesture();
	      stopAutoScrollSettle();
	      if (key === 'ArrowUp' || key === 'PageUp' || key === 'Home' || (isSpace && event.shiftKey)) {
	        setUserScrolledAway(true);
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

			    function clearOperationHideTimer() {
			      if (operationHideTimer) {
			        clearTimeout(operationHideTimer);
			        operationHideTimer = null;
			      }
			    }

			    function setOperationBannerVisible(visible) {
			      if (!operationBanner) return;
			      const visibleFlag = !!visible;
			      if (operationBannerVisible === visibleFlag) return;
			      operationBannerVisible = visibleFlag;
			      operationBanner.classList.toggle('hidden', !visibleFlag);
			    }

			    function setApprovalBannerVisible(visible) {
			      if (!approvalBanner) return;
			      const visibleFlag = !!visible;
			      if (approvalBannerVisible === visibleFlag) return;
			      approvalBannerVisible = visibleFlag;
			      approvalBanner.classList.toggle('hidden', !visibleFlag);
			    }

		    function updateOperationBanner() {
		      if (!operationBanner || !operationLabelEl || !operationElapsedEl) return;
		      if (!currentOperation) {
		        setOperationBannerVisible(false);
		        lastOperationLabelText = '';
		        stopOperationTimer();
		        return;
		      }

		      setOperationBannerVisible(true);
	      const nextLabel = currentOperation.label || 'Working…';
	      if (lastOperationLabelText !== nextLabel) {
	        setTextContent(operationLabelEl, nextLabel);
	        lastOperationLabelText = nextLabel;
	        announceStatus(nextLabel);
	      }

	      const status = currentOperation.status || 'running';
		      setDisplay(operationSpinner, status === 'running' ? '' : 'none');
	      const elapsed = Date.now() - (currentOperation.startedAt ?? Date.now());
	      const nextElapsed = status === 'running' ? formatElapsed(elapsed) : '';
	      setTextContent(operationElapsedEl, nextElapsed);

			      setDisabled(operationStopBtn, !initReceived || !isProcessing || abortRequestPending || status !== 'running');
		    }

	    function updateApprovalBanner() {
	      if (!approvalBanner || !approvalLabelEl) return;

		      const show = pendingApprovalsCount > 0 && isProcessing && initReceived;
		      if (!show) {
		        setApprovalBannerVisible(false);
		        lastApprovalLabelText = '';
		        return;
		      }
		      setApprovalBannerVisible(true);

	      let nextApprovalLabel =
	        pendingApprovalsCount === 1
	          ? 'Waiting for approval (1)'
	          : 'Waiting for approval (' + pendingApprovalsCount + ')';
	      if (manualApprovalsCount > 0) {
	        nextApprovalLabel += ' • ' + manualApprovalsCount + ' manual';
	      }
	      if (lastApprovalLabelText !== nextApprovalLabel) {
	        setTextContent(approvalLabelEl, nextApprovalLabel);
	        lastApprovalLabelText = nextApprovalLabel;
	        announceStatus(nextApprovalLabel);
	      }

	      if (approvalAllowAllBtn) {
	        const disableAllowAll = pendingApprovalsCount <= 0 || manualApprovalsCount > 0 || approveAllPending || abortRequestPending;
	        let allowAllLabel = 'Allow all pending automatic approvals';
	        if (manualApprovalsCount > 0) {
	          allowAllLabel = 'Allow all unavailable while manual approvals are pending';
	        } else if (pendingApprovalsCount === 1) {
	          allowAllLabel = 'Allow the pending automatic approval';
	        }
	        setTitle(approvalAllowAllBtn, allowAllLabel);
	        setAttributeValue(approvalAllowAllBtn, 'aria-label', allowAllLabel);
	        setDisabled(approvalAllowAllBtn, disableAllowAll);
	      }
	      if (approvalStopBtn) {
	        setDisabled(approvalStopBtn, abortRequestPending);
	      }
	    }

		    function startOperation(operation) {
			      const nextOperation = operation || null;
			      if (currentOperation && nextOperation && !operationPatchHasChanges(nextOperation)) {
			        const currentStatus = currentOperation.status || 'running';
			        if (!operationHideTimer && (currentStatus !== 'running' || operationTimer)) return;
			      }
			      clearOperationHideTimer();
			      currentOperation = nextOperation;
			      syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
			      updateOperationBanner();
			      stopOperationTimer();
	      if (currentOperation && (currentOperation.status || 'running') === 'running') {
	        operationTimer = setInterval(updateOperationBanner, 1000);
	      }
	    }

			    function operationPatchHasChanges(operation) {
			      if (!currentOperation || !operation || typeof operation !== 'object') return false;
			      for (const key in operation) {
			        if (!Object.prototype.hasOwnProperty.call(operation, key)) continue;
			        if (operation[key] !== currentOperation[key]) return true;
			      }
			      return false;
			    }

		    function endOperation(status, labelOverride) {
	      if (!currentOperation) return;
	      const nextStatus = status || 'done';
	      const nextLabel = typeof labelOverride === 'string' && labelOverride.trim() ? labelOverride.trim() : '';
	      if (
	        operationHideTimer &&
	        (currentOperation.status || 'running') === nextStatus &&
	        (!nextLabel || (currentOperation.label || '') === nextLabel)
	      ) return;
	      currentOperation.status = nextStatus;
			      if (nextLabel) {
			        currentOperation.label = nextLabel;
			      }
		      syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
		      updateOperationBanner();
		      stopOperationTimer();
		      clearOperationHideTimer();

		      const hideTimer = setTimeout(() => {
		        if (operationHideTimer !== hideTimer) return;
		        operationHideTimer = null;
			        currentOperation = null;
			        syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
			        updateOperationBanner();
		      }, 1200);
		      operationHideTimer = hideTimer;
		    }

			    if (messages) {
			      updateMessagesOverflowAnchor();
			      messages.addEventListener('wheel', handleMessagesWheel, { passive: true });
			      messages.addEventListener('pointerdown', handleMessagesPointerDown, { passive: true });
			      messages.addEventListener('touchstart', handleMessagesTouchStart, { passive: true });
			      messages.addEventListener('touchmove', handleMessagesTouchMove, { passive: true });
			      messages.addEventListener('touchend', handleMessagesTouchEnd, { passive: true });
			      messages.addEventListener('touchcancel', handleMessagesTouchEnd, { passive: true });
			      messages.addEventListener('keydown', handleMessagesKeyDown);
			      messages.addEventListener('scroll', scheduleScrollStateUpdate, { passive: true });
			    }
			    if (typeof window !== 'undefined' && window) {
			      window.addEventListener('pointerup', handleMessagesPointerEnd, { passive: true });
			      window.addEventListener('pointercancel', handleMessagesPointerEnd, { passive: true });
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
	    let fatalErrorBanner = null;

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
      setDisabled(customModelInput, disabled);
      setDisabledClass(customModelLabel, disabled);
    }

	    function setGenerationInputsDisabled(disabled) {
      setDisabled(temperatureInput, disabled);
      setDisabled(topPInput, disabled);
      setDisabledClass(topPLabel, disabled);
      setDisabled(topKInput, disabled);
      setDisabledClass(topKLabel, disabled);
      setDisabled(maxOutputTokensInput, disabled);
      setDisabled(maxIterationsInput, disabled);
      setDisabled(textVerbositySelect, disabled);
      setDisabledClass(textVerbosityLabel, disabled);
      setDisabled(maxRetriesInput, disabled);
      setDisabled(llmTimeoutInput, disabled);
      setDisabled(retryWithPartialOutputToggle, disabled);
      setDisabledClass(retryWithPartialOutputLabel, disabled);
    }

	    function setInstructionFileInputsDisabled(disabled) {
	      setDisabled(instructionPatternsInput, disabled);
	      setDisabledClass(instructionPatternsLabel, disabled);
	      setDisabled(instructionIncludeGlobalToggle, disabled);
	      setDisabledClass(instructionIncludeGlobalLabel, disabled);
      setDisabled(instructionMaxCharsPerFileInput, disabled);
      setDisabledClass(instructionMaxCharsPerFileLabel, disabled);
      setDisabled(instructionMaxTotalCharsInput, disabled);
      setDisabledClass(instructionMaxTotalCharsLabel, disabled);
	      setDisabled(instructionPatternsApply, disabled);
	    }


	    function setUnavailableControlState(label, state) {
	      const isStartup = state === 'startup';
	      const isFatal = state === 'fatal';
	      if (modelPickerLabel) {
	        setTextContent(modelPickerLabel, label);
	      } else {
	        setTextContent(modelPicker, label);
	      }
	      setDisabled(providerSelect, true);
	      setDisabled(providerSettings, true);
	      setDisabled(providerSettingsApply, true);
	      setDisabled(codexDefaultModelInput, true);
	      setDisabledClass(codexDefaultModelLabel, true);
	      setDisabled(safetySelect, true);
	      setDisabled(showLogsBtn, true);
	      setDisabled(listToolsBtn, true);
	      setDisabled(runToolBtn, true);
	      setDisabled(createToolsConfigBtn, true);
	      setDisabled(sessionClearCurrentBtn, true);
	      setDisabled(sessionClearSavedBtn, true);
	      setInstructionFileInputsDisabled(true);
	      setDisabled(thinkingToggle, true);
	      setDisabledClass(thinkingLabel, true);
	      setDisabled(memoriesFeatureToggle, true);
	      setDisabledClass(memoriesFeatureLabel, true);
	      setDisabled(memoryAutoRecallToggle, true);
	      setDisabledClass(memoryAutoRecallLabel, true);
		      for (let memoryLimitInputIndex = 0; memoryLimitInputIndex < memoryAdvancedLimitInputs.length; memoryLimitInputIndex++) {
		        const memoryLimitInput = memoryAdvancedLimitInputs[memoryLimitInputIndex];
		        setDisabled(memoryLimitInput, true);
	      }
	      setDisabled(memoryAdvancedLimitsApply, true);
	      setDisabled(memoryUpdateNowBtn, true);
	      setDisabled(memoryDropBtn, true);
		      for (let memoryLimitLabelIndex = 0; memoryLimitLabelIndex < memoryAdvancedLimitLabels.length; memoryLimitLabelIndex++) {
		        const memoryLimitLabel = memoryAdvancedLimitLabels[memoryLimitLabelIndex];
		        setDisabledClass(memoryLimitLabel, true);
	      }
	      setDisabled(autoCompactionToggle, true);
	      setDisabledClass(autoCompactionLabel, true);
	      setDisabled(modelLimitsInput, true);
	      setDisabled(modelLimitsApply, true);
	      setDisabledClass(modelLimitsLabel, true);
	      setDisabled(compactionToolOutputModeSelect, true);
	      setDisabledClass(compactionToolOutputModeLabel, true);
	      setDisabled(planFirstToggle, true);
	      setDisabledClass(planFirstLabel, true);
	      setDisabled(reasoningEffortSelect, true);
	      setDisabled(modelFavoriteToggle, true);
	      setTextContent(modelFavoriteIcon || modelFavoriteToggle, '☆');
	      setDisabled(modelSettings, true);
	      setDisabled(customModelApply, true);
	      if (isFatal) {
	        setDisabled(modelRefreshList, true);
	        setDisabled(modelClearRecents, true);
	      }
	      if (isStartup) setGenerationInputsDisabled(true);
	      setDisabled(modelSettingsApply, true);
	      setDisabled(modelSettingsOpenSettings, true);
	    }


		    function showFatalError(err, source) {
		      try {
		        const details = getFatalErrorDetails(err);
		        setUnavailableControlState('Webview error', 'fatal');
	        const bannerText = 'LingYun webview crashed:\n\n' + details.displayText + '\n\nOpen “Developer: Open Webview Developer Tools” for details.';
	        if (!fatalErrorBanner) {
	          fatalErrorBanner = document.createElement('div');
	          setAttributeValue(fatalErrorBanner, 'role', 'alert');
	          setAttributeValue(fatalErrorBanner, 'aria-atomic', 'true');
	          fatalErrorBanner.style.padding = '10px 12px';
	          fatalErrorBanner.style.margin = '10px';
	          fatalErrorBanner.style.border = '1px solid var(--vscode-testing-iconFailed, #f14c4c)';
	          fatalErrorBanner.style.borderRadius = '8px';
	          fatalErrorBanner.style.background = 'var(--vscode-inputValidation-errorBackground, rgba(241,76,76,0.1))';
	          fatalErrorBanner.style.color = 'var(--vscode-foreground)';
	          fatalErrorBanner.style.whiteSpace = 'pre-wrap';
	          document.body.insertBefore(fatalErrorBanner, document.body.firstChild);
	        }
	        setTextContent(fatalErrorBanner, bannerText);
	        postWebviewCrash(details, source || 'webview');
	      } catch {
	        // Ignore secondary errors
	      }
    }

	    window.addEventListener('error', (e) => showFatalError(e.error || e.message, 'window.error'));
	    window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason, 'window.unhandledrejection'));


	    setUnavailableControlState('Connecting…', 'startup');

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

    function normalizeProviderId(value) {
	      const id = String(value || '').trim();
	      return ['copilot', 'codexSubscription', 'openaiCompatible'].indexOf(id) >= 0 ? id : 'copilot';
	    }

	    function updateProviderSelection(providerId) {
	      currentProviderId = normalizeProviderId(providerId);
	      if (providerSelect) {
	        setValue(providerSelect, currentProviderId);
	        setTitle(providerSelect, currentProviderId === 'copilot'
	          ? 'Provider: GitHub Copilot'
	          : currentProviderId === 'codexSubscription'
	            ? 'Provider: Codex subscription'
	            : 'Provider: OpenAI-compatible');
	      }
	    }

	    function normalizeOpenAICompatibleDisplayNames(raw) {
	      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	      const normalized = {};
	      let count = 0;
	      for (const rawKey in source) {
	        if (!Object.prototype.hasOwnProperty.call(source, rawKey)) continue;
	        const key = String(rawKey || '').trim().slice(0, 200);
	        const value = typeof source[rawKey] === 'string' ? source[rawKey].trim().slice(0, 200) : '';
	        if (!key || !value || count >= 100) continue;
	        const hadKey = Object.prototype.hasOwnProperty.call(normalized, key);
	        normalized[key] = value;
	        if (!hadKey) count++;
	      }
	      return normalized;
	    }

	    function parseOpenAICompatibleDisplayNames(raw) {
	      const normalized = {};
	      let count = 0;
	      let error = '';
	      forEachTextLine(raw, (line, lineNumber) => {
	        const trimmed = line.trim();
	        if (!trimmed || trimmed.startsWith('#')) return;
	        const sepIndex = trimmed.indexOf('=') >= 0 ? trimmed.indexOf('=') : trimmed.indexOf(':');
	        if (sepIndex <= 0) {
	          error = 'Display name line ' + lineNumber + ' must use model-id = Display name.';
	          return false;
	        }
	        const key = trimmed.slice(0, sepIndex).trim();
	        const value = trimmed.slice(sepIndex + 1).trim();
	        const hadKey = Object.prototype.hasOwnProperty.call(normalized, key);
	        if (!key || !value) {
	          error = 'Display name line ' + lineNumber + ' needs both a model ID and a display name.';
	          return false;
	        }
	        if (key.length > 200 || value.length > 200) {
	          error = 'Display name line ' + lineNumber + ' must keep model IDs and names at 200 characters or fewer.';
	          return false;
	        }
	        if (count >= 100 && !hadKey) {
	          error = 'Use 100 or fewer OpenAI-compatible display name aliases.';
	          return false;
	        }
	        normalized[key] = value;
	        if (!hadKey) count++;
	      });
	      return { names: normalized, error };
	    }

	    function serializeNormalizedOpenAICompatibleDisplayNames(names) {
	      return serializeSortedOwnEnumerableEntries(names, (key, value) => key + ' = ' + value);
	    }

	    function serializeOpenAICompatibleDisplayNames(names) {
	      return serializeNormalizedOpenAICompatibleDisplayNames(normalizeOpenAICompatibleDisplayNames(names));
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
	        allowInsecureTLS: source.allowInsecureTLS === true,
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
	      const modelCount = countOwnEnumerableKeys(openAICompatibleSettings.modelDisplayNames);
	      const codexDefaultModelDisplay = getModelDisplayText(codexSubscriptionSettings.defaultModelId);
	      const openAIDefaultModelDisplay = getModelDisplayText(openAICompatibleSettings.defaultModelId);
	      if (providerSettings) {
	        setTitle(providerSettings, 'Provider settings: Codex default ' + codexDefaultModelDisplay
	          + ', OpenAI-compatible ' + (hasBaseURL ? 'base URL set' : 'base URL not set')
	          + (openAICompatibleSettings.defaultModelId ? ', OpenAI-compatible default ' + openAIDefaultModelDisplay : ', no OpenAI-compatible default')
	          + (openAICompatibleSettings.allowInsecureTLS ? ', insecure TLS allowed' : '')
	          + (modelCount ? ', ' + modelCount + ' display name(s)' : ''));
	      }
	    }

	    function updateNormalizedCodexSubscriptionSettingsState(settings) {
	      codexSubscriptionSettings = settings;
	      setValue(codexDefaultModelInput, codexSubscriptionSettings.defaultModelId);
	      if (codexDefaultModelLabel) {
	        setTitle(codexDefaultModelLabel, 'Codex subscription fallback model: ' + getModelDisplayText(codexSubscriptionSettings.defaultModelId));
	      }
	      updateProviderSettingsSummary();
	    }

	    function updateCodexSubscriptionSettingsState(settings) {
	      updateNormalizedCodexSubscriptionSettingsState(normalizeCodexSubscriptionSettings(settings));
	    }

	    function updateNormalizedOpenAICompatibleSettingsState(settings) {
	      openAICompatibleSettings = settings;
	      setValue(openAIBaseURLInput, openAICompatibleSettings.baseURL);
	      setValue(openAIDefaultModelInput, openAICompatibleSettings.defaultModelId);
	      setValue(openAIApiKeyEnvInput, openAICompatibleSettings.apiKeyEnv);
	      setChecked(openAIAllowInsecureTLSInput, openAICompatibleSettings.allowInsecureTLS);
	      setValue(openAIModelDisplayNamesInput, serializeNormalizedOpenAICompatibleDisplayNames(openAICompatibleSettings.modelDisplayNames));
	      const hasBaseURL = !!openAICompatibleSettings.baseURL;
	      const modelCount = countOwnEnumerableKeys(openAICompatibleSettings.modelDisplayNames);
	      updateProviderSettingsSummary();
	      if (openAIBaseURLLabel) {
	        setTitle(openAIBaseURLLabel, hasBaseURL ? 'OpenAI-compatible base URL is configured.' : 'OpenAI-compatible base URL is not configured.');
	      }
	      if (openAIDefaultModelLabel) {
	        setTitle(openAIDefaultModelLabel, openAICompatibleSettings.defaultModelId
	          ? 'Fallback model: ' + getModelDisplayText(openAICompatibleSettings.defaultModelId)
	          : 'No fallback OpenAI-compatible model configured.');
	      }
	      if (openAIApiKeyEnvLabel) {
	        setTitle(openAIApiKeyEnvLabel, 'API key environment variable: ' + openAICompatibleSettings.apiKeyEnv);
	      }
	      if (openAIAllowInsecureTLSLabel) {
	        setTitle(openAIAllowInsecureTLSLabel, openAICompatibleSettings.allowInsecureTLS
	          ? 'OpenAI-compatible TLS certificate verification is disabled.'
	          : 'OpenAI-compatible TLS certificate verification is enabled.');
	      }
	      if (openAIModelDisplayNamesLabel) {
	        setTitle(openAIModelDisplayNamesLabel, modelCount
	          ? modelCount + ' OpenAI-compatible model display name(s) configured.'
	          : 'No OpenAI-compatible model display names configured.');
	      }
	    }

	    function updateOpenAICompatibleSettingsState(settings) {
	      updateNormalizedOpenAICompatibleSettingsState(normalizeOpenAICompatibleSettings(settings));
	    }

		    function closeProviderSettingsPopover(options) {
		      closeSettingsPopover(providerSettingsPopover, providerSettings, options);
		    }

	    function openProviderSettingsPopover() {
	      if (!providerSettingsPopover) return;
	      updateNormalizedCodexSubscriptionSettingsState(codexSubscriptionSettings);
	      updateNormalizedOpenAICompatibleSettingsState(openAICompatibleSettings);
	      clearInvalidFields([codexDefaultModelInput, openAIBaseURLInput, openAIApiKeyEnvInput, openAIModelDisplayNamesInput]);
		      openSettingsPopover(providerSettingsPopover, providerSettings, providerSettingsClose);
	    }

		    function toggleProviderSettingsPopover() {
		      toggleSettingsPopover(providerSettingsPopover, openProviderSettingsPopover, closeProviderSettingsPopover);
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
	        allowInsecureTLS: openAIAllowInsecureTLSInput ? openAIAllowInsecureTLSInput.checked : openAICompatibleSettings.allowInsecureTLS,
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
	        updateNormalizedCodexSubscriptionSettingsState(codexSubscriptionSettings);
	        updateNormalizedOpenAICompatibleSettingsState(openAICompatibleSettings);
	        clearInvalidFields(fields);
	        return;
	      }
		      const codexNext = buildCodexSubscriptionSettingsFromInputs();
		      const openAINext = buildOpenAICompatibleSettingsFromInputs();
		      if (!openAINext) return;
		      clearInvalidFields(fields);
		      const codexChanged = !codexSubscriptionSettingsEqual(codexNext, codexSubscriptionSettings);
		      const openAIChanged = !openAICompatibleSettingsEqual(openAINext, openAICompatibleSettings);
		      if (!codexChanged && !openAIChanged) {
		        updateNormalizedCodexSubscriptionSettingsState(codexSubscriptionSettings);
		        updateNormalizedOpenAICompatibleSettingsState(openAICompatibleSettings);
		        return;
		      }
		      const stateTypes = [];
		      const messages = [];
		      if (codexChanged) {
		        stateTypes.push('codexSubscriptionSettingsState');
		        messages.push({ type: 'setCodexSubscriptionSettings', settings: codexNext });
		      }
		      if (openAIChanged) {
		        stateTypes.push('openAICompatibleSettingsState');
		        messages.push({ type: 'setOpenAICompatibleSettings', settings: openAINext });
		      }
		      postSettingsWithPendingStates(
		        stateTypes,
		        messages,
		        () => {
		          updateNormalizedCodexSubscriptionSettingsState(codexSubscriptionSettings);
		          updateNormalizedOpenAICompatibleSettingsState(openAICompatibleSettings);
	        }
	      );
	    }

		    function normalizeTextVerbosity(value) {
		      const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
		      return ['', 'low', 'medium', 'high'].indexOf(normalized) >= 0 ? normalized : '';
		    }

		    function normalizeGenerationSettings(settings) {
		      const next = settings && typeof settings === 'object' ? settings : {};
		      const temp = Number(next.temperature);
		      const topP = Number(next.topP);
		      const topK = Number(next.topK);
		      const max = Number(next.maxOutputTokens);
		      const iterations = Number(next.maxIterations);
		      const retries = Number(next.maxRetries);
		      const timeoutMs = Number(next.timeoutMs);
		      return {
		        temperature: Number.isFinite(temp) ? Math.max(0, Math.min(2, temp)) : 0,
		        topP: Number.isFinite(topP) ? Math.max(0, Math.min(1, topP)) : 0,
		        topK: Number.isFinite(topK) && topK > 0 ? Math.floor(topK) : 0,
		        maxOutputTokens: Number.isFinite(max) && max > 0 ? Math.floor(max) : 32000,
		        maxIterations: iterations === -1 ? -1 : Number.isFinite(iterations) && iterations > 0 ? Math.floor(iterations) : 50,
		        textVerbosity: normalizeTextVerbosity(next.textVerbosity),
		        maxRetries: Number.isFinite(retries) && retries >= 0 ? Math.floor(retries) : 2,
			        retryWithPartialOutput: typeof next.retryWithPartialOutput === 'boolean'
			          ? next.retryWithPartialOutput
			          : true,
		        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.floor(timeoutMs) : 0,
		      };
		    }

		    function currentGenerationSettings() {
		      return {
		        temperature: generationTemperature,
		        topP: generationTopP,
		        topK: generationTopK,
		        maxOutputTokens: generationMaxOutputTokens,
		        maxIterations: generationMaxIterations,
		        textVerbosity: generationTextVerbosity,
		        maxRetries: generationMaxRetries,
		        retryWithPartialOutput: generationRetryWithPartialOutput,
		        timeoutMs: generationTimeoutMs,
		      };
		    }

		    function generationSettingsEqual(left, right) {
		      return !!left && !!right &&
		        left.temperature === right.temperature &&
		        left.topP === right.topP &&
		        left.topK === right.topK &&
		        left.maxOutputTokens === right.maxOutputTokens &&
		        left.maxIterations === right.maxIterations &&
		        left.textVerbosity === right.textVerbosity &&
		        left.maxRetries === right.maxRetries &&
		        left.retryWithPartialOutput === right.retryWithPartialOutput &&
		        left.timeoutMs === right.timeoutMs;
		    }

			    function updateNormalizedGenerationSettingsState(settings) {
			      generationTemperature = settings.temperature;
			      generationTopP = settings.topP;
			      generationTopK = settings.topK;
			      generationMaxOutputTokens = settings.maxOutputTokens;
			      generationMaxIterations = settings.maxIterations;
			      generationTextVerbosity = settings.textVerbosity;
			      generationMaxRetries = settings.maxRetries;
			      generationRetryWithPartialOutput = settings.retryWithPartialOutput;
			      generationTimeoutMs = settings.timeoutMs;
	      setValue(temperatureInput, generationTemperature);
	      setValue(topPInput, generationTopP);
	      if (topPLabel) {
	        setTitle(topPLabel, generationTopP > 0
	          ? 'Top-p: ' + generationTopP
	          : 'Top-p uses the provider default.');
	      }
	      setValue(topKInput, generationTopK);
	      if (topKLabel) {
	        setTitle(topKLabel, generationTopK > 0
	          ? 'Top-k: ' + generationTopK
	          : 'Top-k uses the provider default.');
	      }
	      setValue(maxOutputTokensInput, generationMaxOutputTokens);
	      setValue(maxIterationsInput, generationMaxIterations);
	      setValue(textVerbositySelect, generationTextVerbosity);
	      if (textVerbosityLabel) {
	        setTitle(textVerbosityLabel, generationTextVerbosity
	          ? 'Text verbosity: ' + generationTextVerbosity
	          : 'Text verbosity uses the provider default.');
	      }
	      setValue(maxRetriesInput, generationMaxRetries);
	      setValue(llmTimeoutInput, generationTimeoutMs);
	      setChecked(retryWithPartialOutputToggle, generationRetryWithPartialOutput);
	      if (retryWithPartialOutputLabel) {
	        setTitle(retryWithPartialOutputLabel, generationRetryWithPartialOutput
	          ? 'Partial-output retry is on: transient streaming failures replace the incomplete response and retry.'
	          : 'Partial-output retry is off: transient streaming failures after partial output are shown for manual retry.');
	      }
	      if (modelSettings) {
	        setTitle(modelSettings, 'Generation settings: temperature ' + generationTemperature + ', top-p ' + (generationTopP || 'default') + ', top-k ' + (generationTopK || 'default') + ', max output ' + generationMaxOutputTokens + ', max iterations ' + (generationMaxIterations === -1 ? 'unlimited' : generationMaxIterations) + ', verbosity ' + (generationTextVerbosity || 'default') + ', retries ' + generationMaxRetries + ', timeout ' + generationTimeoutMs + 'ms');
	      }
	    }

			    function updateGenerationSettingsState(settings) {
			      updateNormalizedGenerationSettingsState(normalizeGenerationSettings(settings));
			    }

			    function closeModelSettingsPopover(options) {
			      closeSettingsPopover(modelSettingsPopover, [modelSettings, modelPicker], options);
			    }

	    function openModelSettingsPopover() {
	      if (!modelSettingsPopover) return;
	      clearInvalidFields([
	        temperatureInput,
	        topPInput,
	        topKInput,
	        maxOutputTokensInput,
	        maxIterationsInput,
	        maxRetriesInput,
	        llmTimeoutInput,
	      ]);
	      updateNormalizedGenerationSettingsState(currentGenerationSettings());
			      openSettingsPopover(modelSettingsPopover, modelSettings, modelSettingsClose, [modelSettings, modelPicker]);
		    }

		    function toggleModelSettingsPopover() {
		      toggleSettingsPopover(modelSettingsPopover, openModelSettingsPopover, closeModelSettingsPopover);
		    }

	    function applyGenerationSettings() {
	      const currentSettings = {
	        temperature: generationTemperature,
	        topP: generationTopP,
	        topK: generationTopK,
	        maxOutputTokens: generationMaxOutputTokens,
	        maxIterations: generationMaxIterations,
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
	        maxIterationsInput,
	        maxRetriesInput,
	        llmTimeoutInput,
	      ];
	      if (!initReceived || isProcessing || hasPendingSettingState('generationSettingsState')) {
	        updateNormalizedGenerationSettingsState(currentSettings);
	        clearInvalidFields(generationFields);
	        return;
	      }
	      const temperature = Number(temperatureInput ? temperatureInput.value : generationTemperature);
	      const topP = Number(topPInput ? topPInput.value : generationTopP);
	      const topK = Number(topKInput ? topKInput.value : generationTopK);
	      const maxOutputTokens = Number(maxOutputTokensInput ? maxOutputTokensInput.value : generationMaxOutputTokens);
	      const maxIterations = Number(maxIterationsInput ? maxIterationsInput.value : generationMaxIterations);
	      const maxRetries = Number(maxRetriesInput ? maxRetriesInput.value : generationMaxRetries);
	      const textVerbosity = normalizeTextVerbosity(textVerbositySelect ? textVerbositySelect.value : generationTextVerbosity);
	      const timeoutMs = Number(llmTimeoutInput ? llmTimeoutInput.value : generationTimeoutMs);
	      const retryWithPartialOutput = !!(retryWithPartialOutputToggle && retryWithPartialOutputToggle.checked);
	      if (!validateNumberField(temperatureInput, temperature, 0, 'Temperature must be between 0 and 2.', 2)) return;
	      if (!validateNumberField(topPInput, topP, 0, 'Top-p must be between 0 and 1. Use 0 for provider default.', 1)) return;
	      if (!validateNumberField(topKInput, topK, 0, 'Top-k must be 0 or greater. Use 0 for provider default.')) return;
	      if (!validateNumberField(maxOutputTokensInput, maxOutputTokens, Number.MIN_VALUE, 'Max output tokens must be greater than 0.')) return;
		      if (!(maxIterations === -1 || validateNumberField(maxIterationsInput, maxIterations, Number.MIN_VALUE, 'Max iterations must be -1 for no limit or greater than 0.'))) return;
		      if (!validateNumberField(maxRetriesInput, maxRetries, 0, 'Max retries must be 0 or greater.')) return;
		      if (!validateNumberField(llmTimeoutInput, timeoutMs, 0, 'Timeout must be 0 or greater. Use 0 for no override.')) return;
		      const normalizedTemperature = Math.round(temperature * 100) / 100;
		      const normalizedTopP = Math.round(topP * 1000) / 1000;
		      const normalizedTopK = Math.floor(topK);
		      const normalizedMaxOutputTokens = Math.floor(maxOutputTokens);
		      const normalizedMaxIterations = maxIterations === -1 ? -1 : Math.floor(maxIterations);
		      const normalizedMaxRetries = Math.floor(maxRetries);
		      const normalizedTimeoutMs = Math.floor(timeoutMs);
		      const settings = {
		        temperature: normalizedTemperature,
		        topP: normalizedTopP,
		        topK: normalizedTopK,
		        maxOutputTokens: normalizedMaxOutputTokens,
		        maxIterations: normalizedMaxIterations,
		        textVerbosity,
		        maxRetries: normalizedMaxRetries,
		        retryWithPartialOutput,
		        timeoutMs: normalizedTimeoutMs,
		      };
		      clearInvalidFields(generationFields);
		      if (
		        normalizedTemperature === generationTemperature &&
		        normalizedTopP === generationTopP &&
		        normalizedTopK === generationTopK &&
		        normalizedMaxOutputTokens === generationMaxOutputTokens &&
		        normalizedMaxIterations === generationMaxIterations &&
		        textVerbosity === generationTextVerbosity &&
		        normalizedMaxRetries === generationMaxRetries &&
		        retryWithPartialOutput === generationRetryWithPartialOutput &&
		        normalizedTimeoutMs === generationTimeoutMs
		      ) {
		        updateNormalizedGenerationSettingsState(currentSettings);
		        return;
		      }
		      postSettingWithPendingState(
		        'generationSettingsState',
		        { type: 'setGenerationSettings', settings },
	        () => updateNormalizedGenerationSettingsState(currentSettings)
	      );
	    }

	    function updateCustomModelInputState(modelId) {
	      const nextModel = typeof modelId === 'string' ? modelId : (currentModel || '');
	      if (customModelInput && document.activeElement !== customModelInput) {
	        setValue(customModelInput, nextModel);
	      }
	      setTitle(customModelLabel, nextModel
	        ? 'Current model ID: ' + getModelDisplayText(nextModel)
	        : 'Set an exact model ID.');
	    }

	    function getModelDisplayText(value) {
	      const text = String(value === undefined || value === null ? '' : value);
	      return text.length <= MODEL_DISPLAY_LIMIT
	        ? text
	        : text.slice(0, MODEL_DISPLAY_LIMIT) + '…';
	    }

		    function appendSearchToken(text, value) {
		      if (value === undefined || value === null || value === '') return text;
		      const token = String(value);
		      return text ? text + ' ' + token : token;
		    }

		    function getModelSearchText(model) {
		      if (!model || typeof model !== 'object') return '';
		      const cached = modelSearchTextCache.get(model);
		      if (cached !== undefined) return cached;
		      let text = '';
		      text = appendSearchToken(text, model.id);
		      text = appendSearchToken(text, model.name);
		      text = appendSearchToken(text, model.vendor);
		      text = appendSearchToken(text, model.family);
		      text = text.toLowerCase();
		      modelSearchTextCache.set(model, text);
		      return text;
		    }

		    function modelMatchesSearch(model, query) {
		      if (!query) return true;
		      if (!model) return false;
		      return getModelSearchText(model).indexOf(query) >= 0;
		    }

				    function getModelPickerSearchDisplayText(query) {
				      const value = String(query === undefined || query === null ? '' : query);
				      return value.length <= MODEL_PICKER_SEARCH_QUERY_DISPLAY_LIMIT
				        ? value
				        : value.slice(0, MODEL_PICKER_SEARCH_QUERY_DISPLAY_LIMIT) + '…';
				    }

				    function setModelPickerSearchQuery(query) {
				      const nextQuery = String(query || '');
				      if (nextQuery === modelPickerSearchQuery) return false;
				      const nextDisplayQuery = nextQuery.trim();
				      const nextLocalQuery = nextDisplayQuery.toLowerCase();
				      const nextDisplayText = getModelPickerSearchDisplayText(nextDisplayQuery);
				      const changed =
				        nextDisplayText !== modelPickerSearchDisplayQuery ||
				        nextLocalQuery !== modelPickerSearchLocalQuery;
				      modelPickerSearchQuery = nextQuery;
				      modelPickerSearchDisplayQuery = nextDisplayText;
				      modelPickerSearchLocalQuery = nextLocalQuery;
				      return changed;
				    }

			    function requestSearchRenderFrame(callback) {
			      return requestAnimationFrameHandle(callback);
			    }

			    function scheduleModelPickerSearchRender() {
			      if (modelPickerSearchRenderFrame !== null) return;
			      modelPickerSearchRenderFrame = requestSearchRenderFrame(() => {
			        modelPickerSearchRenderFrame = null;
			        updateModelPickerState(currentModelPickerState, { reveal: !modelPickerList || modelPickerListVisible });
			      });
			    }

					    function appendModelPickerRenderKey(key, name, models) {
					      const list = Array.isArray(models) ? models : [];
					      appendCompactRenderStateKeyPart(key, name);
					      appendCompactRenderStateKeyPart(key, list.length);
					      for (let i = 0; i < list.length; i++) {
					        const model = list[i];
					        if (!model || typeof model !== 'object' || !model.id) {
					          appendCompactRenderStateKeyPart(key, '');
					          continue;
					        }
					        appendCompactRenderStateKeyPart(key, model.id);
					        appendCompactRenderStateKeyPart(key, model.name || '');
					        appendCompactRenderStateKeyPart(key, model.vendor || '');
					        appendCompactRenderStateKeyPart(key, model.family || '');
					        appendCompactRenderStateKeyPart(key, model.maxInputTokens || '');
					        appendCompactRenderStateKeyPart(key, model.maxOutputTokens || '');
					      }
					      return key;
					    }

					    function getModelPickerRenderKey(state, currentModelId, query) {
					      const key = createCompactRenderStateKeyBuilder();
					      appendCompactRenderStateKeyPart(key, currentModelId || '');
					      appendCompactRenderStateKeyPart(key, query || '');
					      appendModelPickerRenderKey(key, 'favorites', state && state.favorites);
					      appendModelPickerRenderKey(key, 'recent', state && state.recent);
					      appendModelPickerRenderKey(key, 'all', state && state.all);
					      return finishCompactRenderStateKey(key);
					    }

					    function getModelPickerCurrentRenderKey(picker) {
					      if (!picker || typeof picker !== 'object') return '';
					      if (isModelPickerListReferenceCurrent(picker)) return modelPickerRenderKey;
					      const currentModelId = String(picker.currentModel || currentModel || '');
					      return getModelPickerRenderKey(picker, currentModelId, modelPickerSearchLocalQuery);
					    }

					    function isModelPickerRenderKeyCurrent(renderKey) {
					      return modelPickerSearchRenderFrame === null && !!renderKey && renderKey === modelPickerRenderKey;
					    }

					    function isModelPickerStateCurrent(picker) {
					      return isModelPickerRenderKeyCurrent(getModelPickerCurrentRenderKey(picker));
					    }

					    function modelPickerListsShareRenderableContent(left, right) {
					      if (left === right) return true;
					      const leftList = Array.isArray(left) ? left : [];
					      const rightList = Array.isArray(right) ? right : [];
					      if (leftList.length !== rightList.length) return false;
					      for (let index = 0; index < leftList.length; index++) {
					        if (leftList[index] !== rightList[index]) return false;
					      }
					      return true;
					    }

					    function isModelPickerListReferenceCurrent(picker) {
					      if (!picker || typeof picker !== 'object' || !currentModelPickerState || typeof currentModelPickerState !== 'object') return false;
					      if (modelPickerSearchRenderFrame !== null || !modelPickerRenderKey) return false;
					      if (modelPickerRenderedState !== currentModelPickerState) return false;
					      const currentModelId = String(picker.currentModel || currentModel || '');
					      if (currentModelId !== modelPickerRenderedCurrentModelId || modelPickerSearchLocalQuery !== modelPickerRenderedQuery) return false;
					      return modelPickerListsShareRenderableContent(picker.favorites, currentModelPickerState.favorites) &&
					        modelPickerListsShareRenderableContent(picker.recent, currentModelPickerState.recent) &&
					        modelPickerListsShareRenderableContent(picker.all, currentModelPickerState.all);
					    }

				    function collectFavoriteModelIds(models) {
				      const out = new Set();
				      const list = Array.isArray(models) ? models : [];
				      for (let i = 0; i < list.length; i++) {
				        const model = list[i];
				        if (model && model.id) out.add(String(model.id));
				      }
				      return out;
				    }

					    function appendModelDetailText(text, part) {
					      const value = String(part === undefined || part === null ? '' : part);
					      if (!value) return text;
					      return text ? text + ' • ' + value : value;
					    }

					    function getModelPickerDetailDisplayText(text) {
					      const value = String(text === undefined || text === null ? '' : text);
					      return value.length <= MODEL_PICKER_DETAIL_LIMIT
					        ? value
					        : value.slice(0, MODEL_PICKER_DETAIL_LIMIT) + '…';
					    }

						    function getModelPickerDetailText(model, modelId, currentModelId) {
						      let detailText = '';
				      if (modelId === currentModelId) detailText = appendModelDetailText(detailText, 'Current');
				      if (model.name && model.name !== modelId) detailText = appendModelDetailText(detailText, modelId);
				      if (model.vendor) detailText = appendModelDetailText(detailText, model.vendor);
				      if (model.family && model.family !== model.vendor) detailText = appendModelDetailText(detailText, model.family);
				      const maxInputTokens = Number(model.maxInputTokens);
				      if (Number.isFinite(maxInputTokens) && maxInputTokens > 0) {
				        detailText = appendModelDetailText(detailText, 'maxIn=' + Math.floor(maxInputTokens));
				      }
				      const maxOutputTokens = Number(model.maxOutputTokens);
						      if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
						        detailText = appendModelDetailText(detailText, 'maxOut=' + Math.floor(maxOutputTokens));
						      }
						      return getModelPickerDetailDisplayText(detailText);
						    }

					    const MODEL_PICKER_SECTION_ID_UNSAFE_RE = /[^a-z0-9]+/g;

					    function requestModelSwitch(modelId) {
					      if (!modelId || !initReceived || isProcessing || isComposerRoutingLocked() || modelSwitchPending || modelId === currentModel) return;
					      modelSwitchPending = true;
				      armPendingActionTimer('modelSwitch', () => recoverPendingAction('modelSwitch', 'Model switch is taking longer than expected. Controls were re-enabled.', () => { modelSwitchPending = false; }));
				      syncInputState();
				      try { vscode.postMessage({ type: 'changeModel', model: modelId }); } catch {
				        clearPendingActionTimer('modelSwitch');
				        modelSwitchPending = false;
				        showInputNotice('Failed to request model switch.', { sync: false });
				        syncInputState();
				      }
					    }

					    function requestFavoriteModelToggle(modelId) {
					      if (!modelId || !initReceived || isProcessing || modelFavoritePending) return;
					      modelFavoritePending = true;
				      armPendingActionTimer('modelFavorite', () => recoverPendingAction('modelFavorite', 'Favorite update is taking longer than expected. Controls were re-enabled.', () => { modelFavoritePending = false; }));
				      syncInputState();
				      try { vscode.postMessage({ type: 'toggleFavoriteModel', model: modelId }); } catch {
				        clearPendingActionTimer('modelFavorite');
				        modelFavoritePending = false;
				        showInputNotice('Failed to update favorite model.', { sync: false });
				        syncInputState();
				      }
					    }

					    function findModelPickerActionButton(target, className) {
					      let el = target && typeof target === 'object' ? target : null;
					      while (el && el !== modelPickerList) {
					        if (el.classList && el.classList.contains(className)) return el;
					        el = el.parentNode || null;
					      }
					      return null;
					    }

					    function createModelPickerRow(model, currentModelId, favoriteSet) {
				      const modelId = String(model.id);
				      const isCurrentModel = modelId === currentModelId;
				      const isFavorite = favoriteSet.has(modelId);
				      const rowEl = document.createElement('div');
			      rowEl.className = 'model-picker-row' + (isCurrentModel ? ' current' : '');
			      rowEl.setAttribute('role', 'listitem');
			      const itemEl = document.createElement('button');
			      itemEl.className = 'model-picker-item';
			      itemEl.type = 'button';
				      const rawModelLabel = String(model.name || modelId);
				      const modelLabel = getModelDisplayText(rawModelLabel);
				      const nameEl = document.createElement('span');
				      nameEl.className = 'model-picker-name';
				      nameEl.textContent = modelLabel;
			      const detailText = getModelPickerDetailText(model, modelId, currentModelId);
				      if (isCurrentModel) {
				        itemEl.setAttribute('aria-current', 'true');
				        itemEl.setAttribute('aria-label', modelLabel + ', current model');
				        itemEl.title = 'Current model: ' + modelLabel;
				        itemEl.disabled = true;
				      } else {
				        itemEl.setAttribute('aria-label', modelLabel + ', switch model');
				        itemEl.title = 'Switch to model: ' + modelLabel;
				      }
		      const detailEl = document.createElement('span');
		      detailEl.className = 'model-picker-detail';
		      detailEl.textContent = detailText;
		      itemEl.appendChild(nameEl);
		      if (detailText) itemEl.appendChild(detailEl);
		      modelPickerModelIdByButton.set(itemEl, modelId);
		      const favoriteEl = document.createElement('button');
		      favoriteEl.className = 'model-picker-favorite' + (isFavorite ? ' active' : '');
		      favoriteEl.type = 'button';
		      const favoriteIcon = document.createElement('span');
		      favoriteIcon.setAttribute('aria-hidden', 'true');
		      favoriteIcon.textContent = isFavorite ? '★' : '☆';
		      favoriteEl.appendChild(favoriteIcon);
		      favoriteEl.setAttribute('aria-label', 'Toggle favorite model: ' + modelLabel);
		      favoriteEl.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
		      favoriteEl.title = (isFavorite ? 'Remove from favorites: ' : 'Add to favorites: ') + modelLabel;
		      modelPickerModelIdByButton.set(favoriteEl, modelId);
		      rowEl.appendChild(itemEl);
		      rowEl.appendChild(favoriteEl);
		      if (!isCurrentModel) modelPickerListControls.push(itemEl);
		      modelPickerListControls.push(favoriteEl);
		      return rowEl;
		    }

		    function handleModelPickerListClick(e) {
		      const target = e && e.target ? e.target : null;
		      const favoriteButton = findModelPickerActionButton(target, 'model-picker-favorite');
		      if (favoriteButton && modelPickerModelIdByButton.has(favoriteButton)) {
		        e.preventDefault();
		        e.stopPropagation();
		        if (favoriteButton.disabled) return;
		        requestFavoriteModelToggle(modelPickerModelIdByButton.get(favoriteButton));
		        return;
		      }
		      const itemButton = findModelPickerActionButton(target, 'model-picker-item');
		      if (!itemButton || !modelPickerModelIdByButton.has(itemButton)) return;
		      e.preventDefault();
		      if (itemButton.disabled) return;
		      requestModelSwitch(modelPickerModelIdByButton.get(itemButton));
		    }

				    function formatModelPickerStatus(shownCount, matchedCount, query) {
				      if (matchedCount <= 0) return query ? 'No matching models.' : 'No models available.';
					      if (shownCount < matchedCount) {
				        return String(shownCount) + ' of ' + matchedCount + (query ? ' matching ' : ' available ') + (matchedCount === 1 ? 'model shown.' : 'models shown.');
				      }
				      return String(matchedCount) + (query ? ' matching ' : ' available ') + (matchedCount === 1 ? 'model.' : 'models.');
				    }

				    function renderModelPickerSection(target, title, models, currentModelId, query, favoriteIds, stats) {
				      if (!modelPickerList || !Array.isArray(models) || models.length === 0) return 0;
				      const favoriteSet = favoriteIds instanceof Set ? favoriteIds : new Set();
		      let rowsFragment = null;
		      let singleModelRow = null;
		      function appendModelPickerRow(row) {
		        if (rowsFragment) {
		          rowsFragment.appendChild(row);
		          return;
		        }
		        if (singleModelRow) {
		          rowsFragment = document.createDocumentFragment();
		          rowsFragment.appendChild(singleModelRow);
		          singleModelRow = null;
		          rowsFragment.appendChild(row);
		          return;
		        }
		        singleModelRow = row;
		      }
		      let matchedCount = 0;
		      let renderedCount = 0;
		      let pendingLastModel = null;
	      for (let i = 0; i < models.length; i++) {
	        const model = models[i];
	        if (!model || !model.id || !modelMatchesSearch(model, query)) continue;
		        matchedCount++;
		        if (renderedCount + (pendingLastModel ? 1 : 0) < MODEL_PICKER_SECTION_RENDER_LIMIT) {
		          if (pendingLastModel) {
		            appendModelPickerRow(createModelPickerRow(pendingLastModel, currentModelId, favoriteSet));
		            renderedCount++;
		          }
		          pendingLastModel = model;
	          continue;
	        }
	        if (String(model.id) === currentModelId) {
	          pendingLastModel = model;
	        }
	      }
			      if (!matchedCount) return 0;
			      if (pendingLastModel && renderedCount < MODEL_PICKER_SECTION_RENDER_LIMIT) {
			        appendModelPickerRow(createModelPickerRow(pendingLastModel, currentModelId, favoriteSet));
			        renderedCount++;
			      }
			      if (stats) {
			        stats.matched += matchedCount;
			        stats.shown += renderedCount;
			      }
				      const groupEl = document.createElement('div');
				      groupEl.className = 'model-picker-section-group';
		      groupEl.setAttribute('role', 'group');
		      const sectionEl = document.createElement('div');
		      sectionEl.className = 'model-picker-section';
			      sectionEl.id = 'modelPickerSection-' + String(title || 'models').toLowerCase().replace(MODEL_PICKER_SECTION_ID_UNSAFE_RE, '-');
			      sectionEl.textContent = title;
			      groupEl.setAttribute('aria-labelledby', sectionEl.id);
			      groupEl.appendChild(sectionEl);
			      groupEl.appendChild(rowsFragment || singleModelRow);
			      if (matchedCount > renderedCount) {
			        const overflowEl = document.createElement('div');
			        overflowEl.className = 'model-picker-overflow';
			        const overflowText = query
			          ? 'Showing first ' + renderedCount + ' of ' + matchedCount + ' matches. Refine search or use custom model ID.'
			          : 'Showing first ' + renderedCount + ' of ' + matchedCount + ' available models. Refine search or use custom model ID.';
			        overflowEl.setAttribute('role', 'note');
			        overflowEl.setAttribute('aria-label', overflowText);
			        overflowEl.textContent = overflowText;
			        groupEl.appendChild(overflowEl);
			      }
			      target.appendChild(groupEl);
			      return matchedCount;
			    }

		    function getModelPickerListControlsDisabled() {
		      return !initReceived || isProcessing || modelSwitchPending || modelFavoritePending || modelPickerRefreshPending || modelPickerOpenPending;
		    }

		    function hasRecentModelsForPicker() {
		      const recent = currentModelPickerState && currentModelPickerState.recent;
		      return Array.isArray(recent) && recent.length > 0;
		    }

		    function getModelClearRecentsDisabled(modelControlsDisabled) {
		      return !!modelControlsDisabled || !hasRecentModelsForPicker();
		    }

	    function pruneDetachedModelPickerListControls() {
	      if (!modelPickerList || typeof modelPickerList.contains !== 'function') return;
	      let writeIndex = 0;
	      for (let i = 0; i < modelPickerListControls.length; i++) {
	        const button = modelPickerListControls[i];
	        if (!button || !modelPickerList.contains(button)) continue;
	        modelPickerListControls[writeIndex++] = button;
	      }
	      if (writeIndex !== modelPickerListControls.length) modelPickerListControls.length = writeIndex;
	    }

	    function setModelPickerListControlsDisabled(disabled, options) {
	      if (!modelPickerList || !modelPickerListVisible) {
	        modelPickerListControlsDisabledKey = '';
	        return;
	      }
	      const nextKey = disabled ? '1' : '0';
	      if ((!options || options.force !== true) && modelPickerListControlsDisabledKey === nextKey) return;
		      modelPickerListControlsDisabledKey = nextKey;
	      pruneDetachedModelPickerListControls();
		      for (let i = 0; i < modelPickerListControls.length; i++) {
		        const button = modelPickerListControls[i];
		        setDisabled(button, disabled);
		      }
		    }

				    function updateModelPickerState(picker, options) {
				      cancelModelPickerSearchRender();
				      const nextModelPickerState = picker && typeof picker === 'object' ? picker : currentModelPickerState;
			      const stateChanged = nextModelPickerState !== currentModelPickerState;
			      currentModelPickerState = nextModelPickerState;
			      if (!modelPickerList) return;
		      const reveal = !!(options && options.reveal);
			      if (!currentModelPickerState) {
				        if (!reveal) {
				          setModelPickerListVisible(false);
				          modelPickerListControlsDisabledKey = '';
				          modelPickerListControls = [];
				          modelPickerRenderKey = '';
				          modelPickerRenderedState = null;
				          modelPickerRenderedCurrentModelId = '';
				          modelPickerRenderedQuery = '';
				          setTextContent(modelPickerStatus, '');
				        }
			        return;
			      }
			      const currentModelId = String(currentModelPickerState.currentModel || currentModel || '');
			      const query = modelPickerSearchLocalQuery;
			      if (
			        !stateChanged &&
			        modelPickerRenderedState === currentModelPickerState &&
			        modelPickerRenderedCurrentModelId === currentModelId &&
			        modelPickerRenderedQuery === query
			      ) {
				        if (reveal) {
				          openModelSettingsPopover();
				          setModelPickerListVisible(true);
				        }
			        setModelPickerListControlsDisabled(getModelPickerListControlsDisabled());
			        return;
			      }
			      const nextRenderKey = options && typeof options.renderKey === 'string' && options.renderKey
			        ? options.renderKey
			        : getModelPickerRenderKey(currentModelPickerState, currentModelId, query);
			      if (nextRenderKey === modelPickerRenderKey) {
			        modelPickerRenderedState = currentModelPickerState;
			        modelPickerRenderedCurrentModelId = currentModelId;
			        modelPickerRenderedQuery = query;
				        if (reveal) {
				          openModelSettingsPopover();
				          setModelPickerListVisible(true);
			        }
		        setModelPickerListControlsDisabled(getModelPickerListControlsDisabled());
		        return;
		      }
				      if (stateChanged) modelSearchTextCache = new WeakMap();
				      modelPickerRenderKey = nextRenderKey;
				      modelPickerRenderedState = currentModelPickerState;
				      modelPickerRenderedCurrentModelId = currentModelId;
				      modelPickerRenderedQuery = query;
				      modelPickerListControlsDisabledKey = '';
			      modelPickerListControls = [];
			      const favoriteIds = collectFavoriteModelIds(currentModelPickerState.favorites || []);
		      let sectionsFragment = null;
		      let singleSectionGroup = null;
		      const sectionTarget = {
		        appendChild(groupEl) {
		          if (sectionsFragment) {
		            sectionsFragment.appendChild(groupEl);
		            return groupEl;
		          }
		          if (singleSectionGroup) {
		            sectionsFragment = document.createDocumentFragment();
		            sectionsFragment.appendChild(singleSectionGroup);
		            singleSectionGroup = null;
		            sectionsFragment.appendChild(groupEl);
		            return groupEl;
		          }
		          singleSectionGroup = groupEl;
		          return groupEl;
		        },
		      };
				      const modelPickerSectionStats = { matched: 0, shown: 0 };
				      renderModelPickerSection(sectionTarget, 'Favorites', currentModelPickerState.favorites || [], currentModelId, query, favoriteIds, modelPickerSectionStats);
				      renderModelPickerSection(sectionTarget, 'Recent', currentModelPickerState.recent || [], currentModelId, query, favoriteIds, modelPickerSectionStats);
				      renderModelPickerSection(sectionTarget, 'All models', currentModelPickerState.all || [], currentModelId, query, favoriteIds, modelPickerSectionStats);
				      if (!modelPickerSectionStats.matched) {
				        const emptyEl = document.createElement('div');
				        emptyEl.className = 'tools-catalog-empty';
				        const emptyText = query
				          ? 'No listed models match "' + modelPickerSearchDisplayQuery + '". Use custom model ID if needed.'
				          : 'No models available. Try Refresh models or enter a custom model ID.';
				        emptyEl.setAttribute('role', 'listitem');
				        emptyEl.setAttribute('aria-label', emptyText);
				        emptyEl.textContent = emptyText;
				        replaceElementChildren(modelPickerList, emptyEl);
				      } else {
			        replaceElementChildren(modelPickerList, sectionsFragment || singleSectionGroup);
			      }
			      setTextContent(modelPickerStatus, formatModelPickerStatus(modelPickerSectionStats.shown, modelPickerSectionStats.matched, query));
			      if (reveal) {
			        openModelSettingsPopover();
			        setModelPickerListVisible(true);
		      }
	      setModelPickerListControlsDisabled(getModelPickerListControlsDisabled(), { force: true });
	    }

	    function applyCustomModelId() {
	      if (!initReceived || isProcessing || isComposerRoutingLocked() || modelSwitchPending) {
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
	        showInputNotice('Failed to request model switch.', { sync: false });
	        syncInputState();
	      }
	    }

		    function updatePlanFirstState(enabled) {
		      planFirstEnabled = !!enabled;
		      setChecked(planFirstToggle, planFirstEnabled);
		      if (planFirstLabel) {
		        setTitle(planFirstLabel, planFirstEnabled
		          ? 'Plan-first is on: build-mode tasks generate a plan before the first change.'
		          : 'Plan-first is off: build-mode tasks may act immediately, subject to approvals.');
		      }
		    }

		    function updateSessionSettingsTitle() {
		      if (!sessionSettings) return;
		      const persistText = sessionsPersistEnabled ? 'persistence on' : 'persistence off';
		      setTitle(sessionSettings, 'Session settings: ' + persistText + ', keeps ' + sessionsMaxSessions + ' saved sessions');
		    }

		    function updateSessionsPersistState(enabled) {
		      sessionsPersistEnabled = !!enabled;
		      setChecked(sessionsPersistToggle, sessionsPersistEnabled);
		      if (sessionsPersistLabel) {
		        setTitle(sessionsPersistLabel, sessionsPersistEnabled
		          ? 'Session persistence is on: sessions and input history are restored after VS Code restarts.'
		          : 'Session persistence is off: sessions and input history are kept only for this VS Code window.');
		      }
		      updateSessionSettingsTitle();
		    }

		    function normalizeSessionRetentionLimits(maxSessions, maxSessionBytes) {
		      const parsedMaxSessions = Number(maxSessions);
		      const parsedMaxSessionBytes = Number(maxSessionBytes);
		      return {
		        maxSessions: Number.isFinite(parsedMaxSessions) && parsedMaxSessions >= 1 ? Math.floor(parsedMaxSessions) : 20,
		        maxSessionBytes: Number.isFinite(parsedMaxSessionBytes) && parsedMaxSessionBytes >= 1000 ? Math.floor(parsedMaxSessionBytes) : 2000000,
		      };
		    }

			    function updateNormalizedSessionRetentionState(limits) {
			      sessionsMaxSessions = limits.maxSessions;
			      sessionsMaxSessionBytes = limits.maxSessionBytes;
				      setValue(sessionsMaxSessionsInput, sessionsMaxSessions);
				      setValue(sessionsMaxSessionBytesInput, sessionsMaxSessionBytes);
				      updateSessionSettingsTitle();
				    }

			    function updateSessionRetentionState(maxSessions, maxSessionBytes) {
			      updateNormalizedSessionRetentionState(normalizeSessionRetentionLimits(maxSessions, maxSessionBytes));
				    }

	    function applySessionRetentionLimits() {
	      const currentLimits = { maxSessions: sessionsMaxSessions, maxSessionBytes: sessionsMaxSessionBytes };
	      const fields = [sessionsMaxSessionsInput, sessionsMaxSessionBytesInput];
	      if (!initReceived || isProcessing || hasPendingSettingState('sessionRetentionState')) {
	        updateNormalizedSessionRetentionState(currentLimits);
	        clearInvalidFields(fields);
	        return;
	      }
	      const maxSessions = Number(sessionsMaxSessionsInput ? sessionsMaxSessionsInput.value : sessionsMaxSessions);
	      const maxSessionBytes = Number(sessionsMaxSessionBytesInput ? sessionsMaxSessionBytesInput.value : sessionsMaxSessionBytes);
	      if (!Number.isFinite(maxSessions) || maxSessions < 1) {
	        markInvalidField(sessionsMaxSessionsInput, 'Saved sessions must be at least 1.');
	        updateNormalizedSessionRetentionState(currentLimits);
	        return;
	      }
	      if (!Number.isFinite(maxSessionBytes) || maxSessionBytes < 1000) {
	        markInvalidField(sessionsMaxSessionBytesInput, 'Max session size must be at least 1000 bytes.');
	        updateNormalizedSessionRetentionState(currentLimits);
	        return;
	      }
	      clearInvalidFields(fields);
	      const limits = { maxSessions: Math.floor(maxSessions), maxSessionBytes: Math.floor(maxSessionBytes) };
	      if (sessionRetentionLimitsEqual(limits, currentLimits)) {
	        updateNormalizedSessionRetentionState(currentLimits);
	        return;
	      }
	      postSettingWithPendingState(
	        'sessionRetentionState',
	        { type: 'setSessionRetentionLimits', limits },
	        () => updateNormalizedSessionRetentionState(currentLimits)
	      );
	    }

		    function getSessionClearConfirmTrigger(action) {
		      if (action === 'clearSavedSessions') return sessionClearSavedBtn;
		      if (action === 'clearCurrentSession') return sessionClearCurrentBtn;
		      return null;
		    }

		    function setSessionClearConfirmVisible(visible) {
		      const visibleFlag = !!visible;
		      if (sessionClearConfirmVisible === visibleFlag) return;
		      sessionClearConfirmVisible = visibleFlag;
		      if (sessionClearConfirm && sessionClearConfirm.classList) {
		        sessionClearConfirm.classList.toggle('hidden', !visibleFlag);
		      }
		    }

			    function setSessionClearConfirmAction(action, options) {
			      const previousAction = sessionClearConfirmAction;
			      const normalized = action === 'clearCurrentSession' || action === 'clearSavedSessions' ? action : '';
			      if (sessionClearConfirmSynced && previousAction === normalized) {
			        if (!options || options.sync !== false) syncInputState();
			        return;
			      }
			      const isSavedClear = normalized === 'clearSavedSessions';
			      const runLabel = isSavedClear ? 'Clear saved' : 'Clear current';
			      const runAccessibleLabel = isSavedClear ? 'Clear saved sessions' : 'Clear current session';
			      sessionClearConfirmAction = normalized;
			      sessionClearConfirmSynced = true;
	      setSessionClearConfirmVisible(!!normalized);
	      setAttributeValue(sessionClearCurrentBtn, 'aria-expanded', normalized === 'clearCurrentSession' ? 'true' : 'false');
	      setAttributeValue(sessionClearSavedBtn, 'aria-expanded', normalized === 'clearSavedSessions' ? 'true' : 'false');
	      setTextContent(
	        sessionClearConfirmText,
	        isSavedClear
	          ? 'Delete all saved LingYun sessions, todos, and input history from workspace storage? This cannot be undone.'
	          : 'Clear messages and runtime state for the current session?'
	      );
		      setTextContent(sessionClearConfirmRunBtn, runLabel);
		      setAttributeValue(sessionClearConfirmRunBtn, 'aria-label', runAccessibleLabel);
		      setTitle(sessionClearConfirmRunBtn, runAccessibleLabel);
		      if (normalized && normalized !== previousAction) {
		        focusInlineConfirmationTarget(sessionClearCancelBtn);
		      } else if (!normalized && previousAction && (!options || options.restoreFocus !== false)) {
		        focusInlineConfirmationTarget(getSessionClearConfirmTrigger(previousAction));
		      }
		      if (!options || options.sync !== false) syncInputState();
		    }

		    function closeSessionSettingsPopover(options) {
		      closeSettingsPopover(sessionSettingsPopover, sessionSettings, options);
			      setSessionClearConfirmAction('', { sync: false, restoreFocus: false });
		    }

	    function openSessionSettingsPopover() {
	      if (!sessionSettingsPopover) return;
		      openSettingsPopover(sessionSettingsPopover, sessionSettings, sessionSettingsClose);
	    }

		    function toggleSessionSettingsPopover() {
		      toggleSettingsPopover(sessionSettingsPopover, openSessionSettingsPopover, closeSessionSettingsPopover);
		    }

		    function updateAutoApproveState(enabled) {
		      autoApproveEnabled = !!enabled;
		      setValue(safetySelect, autoApproveEnabled ? 'auto' : 'ask');
		      setTitle(safetySelect, autoApproveEnabled
		        ? 'Safety: auto-approve tool calls in build mode (not recommended).'
		        : 'Safety: ask before tool calls that need approval.');
		    }

		    function updateAllowExternalPathsState(enabled) {
		      allowExternalPathsEnabled = !!enabled;
		      setChecked(allowExternalPathsToggle, allowExternalPathsEnabled);
		      if (allowExternalPathsLabel) {
		        setTitle(allowExternalPathsLabel, allowExternalPathsEnabled
		          ? 'External path access is on: tools may access files outside the workspace.'
		          : 'External path access is off: tools stay inside the workspace.');
		      }
		      updateSafetySettingsTitle();
		    }

		    function updateBlockGitPushState(enabled) {
		      blockGitPushEnabled = !!enabled;
		      setChecked(blockGitPushToggle, blockGitPushEnabled);
		      if (blockGitPushLabel) {
		        setTitle(blockGitPushLabel, blockGitPushEnabled
		          ? 'Git push protection is on: bash blocks git push commands.'
		          : 'Git push protection is off: bash may run git push commands.');
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

		    function updateNormalizedDebugSettingsState(settings) {
		      debugSettings = settings;
		      setChecked(debugDetailsToggle, debugSettings.details);
		      setChecked(debugLlmToggle, debugSettings.effectiveLlm);
		      setChecked(debugToolsToggle, debugSettings.effectiveTools);
		      setChecked(debugPluginsToggle, debugSettings.effectivePlugins);
		      if (debugDetailsLabel) {
		        setTitle(debugDetailsLabel, debugSettings.details
		          ? 'Detailed diagnostics are on; LLM, tool, and plugin debug streams are effectively enabled.'
		          : 'Detailed diagnostics are off.');
		      }
		      if (debugLlmLabel) {
		        setTitle(debugLlmLabel, debugSettings.details
		          ? 'LLM debug is on because detailed diagnostics are enabled.'
		          : (debugSettings.llm ? 'LLM debug logging is on.' : 'LLM debug logging is off.'));
		      }
		      if (debugToolsLabel) {
		        setTitle(debugToolsLabel, debugSettings.details
		          ? 'Tool debug is on because detailed diagnostics are enabled.'
		          : (debugSettings.tools ? 'Tool debug logging is on.' : 'Tool debug logging is off.'));
		      }
		      if (debugPluginsLabel) {
		        setTitle(debugPluginsLabel, debugSettings.details
		          ? 'Plugin debug is on because detailed diagnostics are enabled.'
		          : (debugSettings.plugins ? 'Plugin debug logging is on.' : 'Plugin debug logging is off.'));
		      }
		      updateSafetySettingsTitle();
		    }

		    function updateDebugSettingsState(settings) {
		      updateNormalizedDebugSettingsState(normalizeDebugSettings(settings));
		    }

		    function applyDebugSettings(partial) {
		      if (!initReceived || isProcessing || debugSettingsPending) {
		        updateNormalizedDebugSettingsState(debugSettings);
		        return;
		      }
		      const next = normalizeDebugSettings({ ...debugSettings, ...(partial || {}) });
		      if (debugSettingsEqual(next, debugSettings)) {
		        updateNormalizedDebugSettingsState(debugSettings);
		        return;
		      }
		      updateNormalizedDebugSettingsState(debugSettings);
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
        showInputNotice('Failed to request debug settings update.', { sync: false });
        syncInputState();
      }

	    }

	    function normalizePluginSpecs(raw) {
	      return normalizeSeparatedStringList(raw);
	    }

	    function getPluginSpecsTitleDisplayText(plugins) {
	      const value = formatCommaSeparatedList(plugins);
	      return value.length <= PLUGIN_SPECS_TITLE_DISPLAY_LIMIT
	        ? value
	        : value.slice(0, PLUGIN_SPECS_TITLE_DISPLAY_LIMIT) + '…';
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

		    function updateNormalizedPluginSettingsState(settings) {
		      pluginSettings = settings;
		      setChecked(pluginsAutoDiscoverToggle, pluginSettings.autoDiscover);
		      if (pluginsWorkspaceDirInput) {
		        setValue(pluginsWorkspaceDirInput, pluginSettings.workspaceDir);
		        setTitle(pluginsWorkspaceDirInput, 'Workspace plugins are discovered under ' + pluginSettings.workspaceDir + '/plugin.');
		      }
		      if (pluginSpecsInput) {
		        setValue(pluginSpecsInput, pluginSettings.plugins.join('\n'));
		        setTitle(pluginSpecsInput, pluginSettings.plugins.length
		          ? pluginSettings.plugins.length + ' explicit plugin module(s) configured.'
		          : 'No explicit plugin modules configured.');
		      }
		      if (pluginsAutoDiscoverLabel) {
		        setTitle(pluginsAutoDiscoverLabel, pluginSettings.autoDiscover
		          ? 'Workspace plugin auto-discovery is on.'
		          : 'Workspace plugin auto-discovery is off.');
		      }
		      if (pluginsWorkspaceDirLabel) {
		        setTitle(pluginsWorkspaceDirLabel, 'Workspace plugin directory: ' + pluginSettings.workspaceDir);
		      }
			      if (pluginSpecsLabel) {
			        setTitle(pluginSpecsLabel, pluginSettings.plugins.length
			          ? 'Plugin modules: ' + getPluginSpecsTitleDisplayText(pluginSettings.plugins)
			          : 'No explicit plugin modules configured.');
			      }
		      updateSafetySettingsTitle();
		    }

		    function updatePluginSettingsState(settings) {
		      updateNormalizedPluginSettingsState(normalizePluginSettings(settings));
		    }

		    function applyPluginSettings() {
		      if (!initReceived || isProcessing || pluginSettingsPending) {
		        updateNormalizedPluginSettingsState(pluginSettings);
		        return;
		      }
	      const next = {
	        plugins: normalizePluginSpecs(pluginSpecsInput ? pluginSpecsInput.value : pluginSettings.plugins),
	        autoDiscover: !!(pluginsAutoDiscoverToggle && pluginsAutoDiscoverToggle.checked),
	        workspaceDir: pluginsWorkspaceDirInput && pluginsWorkspaceDirInput.value.trim()
	          ? pluginsWorkspaceDirInput.value.trim()
	          : '.lingyun',
	      };
			      if (hasListItemLongerThan(next.plugins, 240)) {
			        markInvalidField(pluginSpecsInput, 'Plugin module specs must be 240 characters or shorter.');
			        updateNormalizedPluginSettingsState(pluginSettings);
			        return;
		      }
		      if (next.workspaceDir.length > 120) {
		        markInvalidField(pluginsWorkspaceDirInput, 'Workspace plugin directory must be 120 characters or shorter.');
		        updateNormalizedPluginSettingsState(pluginSettings);
		        return;
		      }
		      clearInvalidFields([pluginSpecsInput, pluginsWorkspaceDirInput]);
		      if (pluginSettingsEqual(next, pluginSettings)) {
		        updateNormalizedPluginSettingsState(pluginSettings);
		        return;
		      }
		      setChecked(pluginsAutoDiscoverToggle, pluginSettings.autoDiscover);
	      pluginSettingsPending = true;
	      syncInputState();
	      try { vscode.postMessage({ type: 'setPluginSettings', settings: next }); } catch {
	        pluginSettingsPending = false;
	        showInputNotice('Failed to request plugin settings update.', { sync: false });
	        syncInputState();
	      }
	    }

	    function normalizeToolFilter(raw) {
	      return normalizeSeparatedStringList(raw);
	    }

	    function getToolFilterTitleDisplayText(patterns) {
	      const value = formatCommaSeparatedList(patterns);
	      return value.length <= TOOL_FILTER_TITLE_DISPLAY_LIMIT
	        ? value
	        : value.slice(0, TOOL_FILTER_TITLE_DISPLAY_LIMIT) + '…';
	    }

		    function updateNormalizedToolFilterState(patterns) {
		      toolFilter = patterns;
		      if (toolFilterInput) {
		        setValue(toolFilterInput, toolFilter.join('\n'));
		        setTitle(toolFilterInput, toolFilter.length
		          ? 'Only tools matching ' + toolFilter.length + ' configured pattern(s) are available.'
		          : 'All tools are available.');
		      }
			      if (toolFilterLabel) {
			        setTitle(toolFilterLabel, toolFilter.length
			          ? 'Tool filter is active: ' + getToolFilterTitleDisplayText(toolFilter)
			          : 'Tool filter is empty: all tools are available.');
			      }
		      updateSafetySettingsTitle();
		    }

		    function updateToolFilterState(patterns) {
		      updateNormalizedToolFilterState(normalizeToolFilter(patterns));
		    }

	    function applyToolFilter() {
	      if (!initReceived || isProcessing || hasPendingSettingState('toolFilterState')) {
	        updateNormalizedToolFilterState(toolFilter);
	        clearInvalidFields([toolFilterInput]);
	        return;
		      }
	      const patterns = normalizeToolFilter(toolFilterInput ? toolFilterInput.value : toolFilter);
		      if (hasListItemLongerThan(patterns, 120)) {
		        markInvalidField(toolFilterInput, 'Allowed tool patterns must be 120 characters or shorter.');
	        updateNormalizedToolFilterState(toolFilter);
	        return;
	      }
	      clearInvalidFields([toolFilterInput]);
	      if (stringListsEqual(patterns, toolFilter)) {
	        updateNormalizedToolFilterState(toolFilter);
	        return;
	      }
	      postSettingWithPendingState(
	        'toolFilterState',
	        { type: 'setToolFilter', patterns },
	        () => updateNormalizedToolFilterState(toolFilter)
	      );
		    }

			    function normalizeAutoApprovedTools(raw) {
			      const source = Array.isArray(raw) ? raw : [];
			      const seen = new Set();
			      const normalized = [];
		      for (let i = 0; i < source.length; i++) {
		        const value = source[i];
		        if (typeof value !== 'string') continue;
		        const toolId = value.trim();
		        if (!toolId || seen.has(toolId)) continue;
		        seen.add(toolId);
		        normalized.push(toolId);
			      }
			      if (normalized.length > 1) normalized.sort(compareLocaleAscending);
			      return normalized;
			    }

			    function getAutoApprovedToolsRenderKey(toolIds) {
			      const source = Array.isArray(toolIds) ? toolIds : [];
			      const key = createCompactRenderStateKeyBuilder();
			      appendCompactRenderStateKeyPart(key, source.length);
			      for (let i = 0; i < source.length; i++) {
			        const toolId = source[i];
			        appendCompactRenderStateKeyPart(key, toolId);
			      }
			      return finishCompactRenderStateKey(key);
			    }

			    function getAutoApprovedToolDisplayId(toolId) {
			      const value = String(toolId === undefined || toolId === null ? '' : toolId);
			      return value.length <= AUTO_APPROVED_TOOL_ID_DISPLAY_LIMIT
			        ? value
			        : value.slice(0, AUTO_APPROVED_TOOL_ID_DISPLAY_LIMIT) + '…';
			    }

			    function focusInlineConfirmationTarget(element) {
			      if (!element || typeof element.focus !== 'function') return false;
			      if (element.disabled) return false;
			      if (element.isConnected === false) return false;
			      if (element.classList && element.classList.contains('hidden')) return false;
			      try {
			        element.focus({ preventScroll: true });
			      } catch {
			        try {
			          element.focus();
			        } catch {
			          return false;
			        }
			      }
			      return document.activeElement === element;
			    }

				    function setAutoApprovedToolsClearConfirmVisible(visible) {
				      const visibleFlag = !!visible;
				      if (autoApprovedToolsClearConfirmVisible === visibleFlag) return;
				      autoApprovedToolsClearConfirmVisible = visibleFlag;
				      if (autoApprovedToolsClearConfirm && autoApprovedToolsClearConfirm.classList) {
				        autoApprovedToolsClearConfirm.classList.toggle('hidden', !visibleFlag);
				      }
				    }

		    function setAutoApprovedToolsClearConfirmPending(pending, options) {
		      const wasPending = autoApprovedToolsClearConfirmPending;
		      const nextPending = !!pending;
		      if (autoApprovedToolsClearConfirmSynced && wasPending === nextPending) {
				        if (!options || options.sync !== false) syncInputState();
				        return;
				      }
				      autoApprovedToolsClearConfirmPending = nextPending;
				      autoApprovedToolsClearConfirmSynced = true;
			      setAutoApprovedToolsClearConfirmVisible(autoApprovedToolsClearConfirmPending);
		      setAttributeValue(autoApprovedToolsClear, 'aria-expanded', autoApprovedToolsClearConfirmPending ? 'true' : 'false');
		      if (autoApprovedToolsClearConfirmPending && !wasPending) {
		        focusInlineConfirmationTarget(autoApprovedToolsClearCancel);
		      } else if (!autoApprovedToolsClearConfirmPending && wasPending && (!options || options.restoreFocus !== false)) {
		        focusInlineConfirmationTarget(autoApprovedToolsClear);
		      }
		      if (!options || options.sync !== false) syncInputState();
		    }

		    function pruneDetachedAutoApprovedToolButtons() {
		      if (!autoApprovedToolsList || typeof autoApprovedToolsList.contains !== 'function') return;
		      let writeIndex = 0;
		      for (let i = 0; i < autoApprovedToolButtons.length; i++) {
		        const button = autoApprovedToolButtons[i];
		        if (!button || !autoApprovedToolsList.contains(button)) continue;
		        autoApprovedToolButtons[writeIndex++] = button;
		      }
		      if (writeIndex !== autoApprovedToolButtons.length) autoApprovedToolButtons.length = writeIndex;
		    }

	    function setAutoApprovedToolsControlsDisabled(disabled, options) {
	      const disabledFlag = !!disabled || autoApprovedToolsPending;
		      if (disabledFlag && autoApprovedToolsClearConfirmPending) {
		        setAutoApprovedToolsClearConfirmPending(false, { sync: false, restoreFocus: false });
	      }
	      setDisabled(autoApprovedToolsClear, disabledFlag || autoApprovedTools.length === 0);
	      setDisabled(autoApprovedToolsClearCancel, disabledFlag);
	      setDisabled(autoApprovedToolsClearConfirmRun, disabledFlag);
	      if (!autoApprovedToolsList) {
	        autoApprovedToolButtonsDisabledKey = '';
	        autoApprovedToolButtons = [];
	        return;
	      }
	      const nextKey = disabledFlag ? '1' : '0';
	      if ((!options || options.force !== true) && autoApprovedToolButtonsDisabledKey === nextKey) return;
	      autoApprovedToolButtonsDisabledKey = nextKey;
	      pruneDetachedAutoApprovedToolButtons();
	      for (let i = 0; i < autoApprovedToolButtons.length; i++) {
	        setDisabled(autoApprovedToolButtons[i], disabledFlag);
	      }
	    }

		    function updateAutoApprovedToolsStatus() {
		      const count = autoApprovedTools.length;
		      setTextContent(
		        autoApprovedToolsStatus,
		        count ? String(count) + (count === 1 ? ' always-allowed tool.' : ' always-allowed tools.') : 'No tools are always allowed.'
		      );
		    }

		    function requestAutoApprovedToolRevoke(toolId) {
		      if (!toolId || !initReceived || isProcessing || autoApprovedToolsPending) return;
		      autoApprovedToolsPending = true;
		      syncInputState();
	      try { vscode.postMessage({ type: 'revokeAutoApprovedTool', toolId }); } catch {
	        autoApprovedToolsPending = false;
	        showInputNotice('Failed to revoke always-allowed tool.', { sync: false });
	        syncInputState();
	      }
		    }

		    function findAutoApprovedToolRevokeButton(target) {
		      let el = target && typeof target === 'object' ? target : null;
		      while (el && el !== autoApprovedToolsList) {
		        if (autoApprovedToolIdByRevokeButton.has(el)) return el;
		        el = el.parentNode || null;
		      }
		      return null;
		    }

		    function handleAutoApprovedToolsListClick(e) {
		      const revokeButton = findAutoApprovedToolRevokeButton(e && e.target ? e.target : null);
		      if (!revokeButton) return;
		      e.preventDefault();
		      requestAutoApprovedToolRevoke(autoApprovedToolIdByRevokeButton.get(revokeButton));
		    }

			    function updateNormalizedAutoApprovedToolsState(nextAutoApprovedTools) {
			      autoApprovedToolsPending = false;
				      setAutoApprovedToolsClearConfirmPending(false, { sync: false, restoreFocus: false });
		      const nextRenderKey = getAutoApprovedToolsRenderKey(nextAutoApprovedTools);
		      autoApprovedTools = nextAutoApprovedTools;
		      updateAutoApprovedToolsStatus();
		      if (!autoApprovedToolsList) {
		        autoApprovedToolButtons = [];
		        return;
		      }
		      if (nextRenderKey === autoApprovedToolsRenderKey) {
		        if (!autoApprovedTools.length) {
		          setDisabled(autoApprovedToolsClear, true);
		        } else {
		          setAutoApprovedToolsControlsDisabled(!initReceived || isProcessing);
		        }
		        updateSafetySettingsTitle();
		        return;
		      }
			      autoApprovedToolsRenderKey = nextRenderKey;
			      autoApprovedToolButtonsDisabledKey = '';
			      autoApprovedToolButtons = [];
		      if (!autoApprovedTools.length) {
		        const emptyEl = document.createElement('li');
		        emptyEl.className = 'auto-approved-tools-empty';
		        emptyEl.textContent = 'No tools are always allowed.';
		        replaceElementChildren(autoApprovedToolsList, emptyEl);
		        setDisabled(autoApprovedToolsClear, true);
		        updateSafetySettingsTitle();
		        return;
		      }
			      const fragment = autoApprovedTools.length > 1 ? document.createDocumentFragment() : null;
			      let singleItemEl = null;
			      for (let i = 0; i < autoApprovedTools.length; i++) {
			        const toolId = autoApprovedTools[i];
			        const displayToolId = getAutoApprovedToolDisplayId(toolId);
			        const itemEl = document.createElement('li');
		        itemEl.className = 'auto-approved-tool-item';
		        const idEl = document.createElement('span');
	        idEl.className = 'auto-approved-tool-id';
	        idEl.textContent = displayToolId;
	        const revokeEl = document.createElement('button');
	        revokeEl.className = 'context-btn';
	        revokeEl.type = 'button';
	        revokeEl.textContent = 'Revoke';
	        const revokeLabel = 'Revoke ' + displayToolId + ' from always-allowed tools';
	        revokeEl.setAttribute('aria-label', revokeLabel);
	        revokeEl.title = revokeLabel;
	        autoApprovedToolIdByRevokeButton.set(revokeEl, toolId);
			        itemEl.appendChild(idEl);
					        itemEl.appendChild(revokeEl);
					        autoApprovedToolButtons.push(revokeEl);
				        if (fragment) {
				          fragment.appendChild(itemEl);
				        } else {
				          singleItemEl = itemEl;
				        }
				      }
				      replaceElementChildren(autoApprovedToolsList, fragment || singleItemEl);
				      setAutoApprovedToolsControlsDisabled(!initReceived || isProcessing, { force: true });
				      updateSafetySettingsTitle();
			    }

			    function updateAutoApprovedToolsState(toolIds) {
			      updateNormalizedAutoApprovedToolsState(normalizeAutoApprovedTools(toolIds));
			    }

	    function clearAutoApprovedTools() {
	      if (!initReceived || isProcessing || autoApprovedToolsPending || autoApprovedTools.length === 0) {
	        updateNormalizedAutoApprovedToolsState(autoApprovedTools);
	        return;
	      }
	      autoApprovedToolsPending = true;
		      setAutoApprovedToolsClearConfirmPending(false, { sync: false, restoreFocus: false });
	      syncInputState();
      try { vscode.postMessage({ type: 'clearAutoApprovedTools', confirmed: true }); } catch {
        autoApprovedToolsPending = false;
        showInputNotice('Failed to clear always-allowed tools.', { sync: false });
        syncInputState();
      }
	    }

	    function normalizeWorkspaceEnv(raw) {
	      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	      const normalized = {};
	      let count = 0;
	      for (const rawKey in source) {
	        if (!Object.prototype.hasOwnProperty.call(source, rawKey)) continue;
	        if (count >= 100) continue;
	        const key = String(rawKey || '').trim().slice(0, 120);
	        const value = source[rawKey];
	        if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
	        if (typeof value !== 'string') continue;
	        const hadKey = Object.prototype.hasOwnProperty.call(normalized, key);
	        normalized[key] = value.slice(0, 10000);
	        if (!hadKey) count++;
	      }
	      return normalized;
	    }

		    function serializeNormalizedWorkspaceEnv(env) {
		      return serializeSortedOwnEnumerableEntries(env, (key, value) => key + '=' + value);
		    }

		    function serializeWorkspaceEnv(env) {
		      return serializeNormalizedWorkspaceEnv(normalizeWorkspaceEnv(env));
		    }

	    function parseWorkspaceEnv(raw) {
	      const text = String(raw || '').trim();
	      const parsed = {};
	      if (!text) return parsed;
	      if (text.startsWith('{')) {
	        try { return normalizeWorkspaceEnv(JSON.parse(text)); } catch { return null; }
	      }
	      let count = 0;
	      let valid = true;
	      forEachTextLine(text, (line) => {
	        if (count >= 100) {
	          valid = false;
	          return false;
	        }
	        const trimmed = line.trim();
	        if (!trimmed || trimmed.startsWith('#')) return;
	        const equalsIndex = trimmed.indexOf('=');
	        if (equalsIndex <= 0) {
	          valid = false;
	          return false;
	        }
	        const key = trimmed.slice(0, equalsIndex).trim();
	        const value = trimmed.slice(equalsIndex + 1);
	        if (!key || key.length > 120 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
	          valid = false;
	          return false;
	        }
	        if (value.length > 10000) {
	          valid = false;
	          return false;
	        }
	        const hadKey = Object.prototype.hasOwnProperty.call(parsed, key);
	        parsed[key] = value;
	        if (!hadKey) count++;
	      });
	      return valid ? parsed : null;
	    }

		    function updateNormalizedWorkspaceEnvState(env) {
		      workspaceEnv = env;
		      const count = countOwnEnumerableKeys(workspaceEnv);
		      if (workspaceEnvInput) {
		        setValue(workspaceEnvInput, serializeNormalizedWorkspaceEnv(workspaceEnv));
		        setTitle(workspaceEnvInput, count
		          ? count + ' workspace tool environment variable(s) configured.'
		          : 'No workspace tool environment variables configured.');
		      }
		      if (workspaceEnvLabel) {
		        setTitle(workspaceEnvLabel, count
		          ? count + ' workspace tool environment variable(s) are available to workspace tools.'
		          : 'No workspace tool environment variables configured.');
		      }
		      updateSafetySettingsTitle();
		    }

		    function updateWorkspaceEnvState(env) {
		      updateNormalizedWorkspaceEnvState(normalizeWorkspaceEnv(env));
		    }

		    function applyWorkspaceEnv() {
		      if (!initReceived || isProcessing || hasPendingSettingState('workspaceEnvState')) {
		        updateNormalizedWorkspaceEnvState(workspaceEnv);
		        clearInvalidFields([workspaceEnvInput]);
		        return;
		      }
	      const parsed = parseWorkspaceEnv(workspaceEnvInput ? workspaceEnvInput.value : '');
		      if (!parsed) {
		        markInvalidField(workspaceEnvInput, 'Use JSON object syntax or one valid NAME=value entry per line. Names must be valid environment variable names.');
		        updateNormalizedWorkspaceEnvState(workspaceEnv);
		        return;
			      }
			      const next = normalizeWorkspaceEnv(parsed);
			      clearInvalidFields([workspaceEnvInput]);
			      if (workspaceEnvsEqual(next, workspaceEnv)) {
			        updateNormalizedWorkspaceEnvState(workspaceEnv);
			        return;
			      }
			      postSettingWithPendingState(
			        'workspaceEnvState',
			        { type: 'setWorkspaceEnv', env: next },
			        () => updateNormalizedWorkspaceEnvState(workspaceEnv)
			      );
			    }

		    function hasToolCatalogSchemaDefault(schema) {
		      return !!schema
		        && typeof schema === 'object'
		        && Object.prototype.hasOwnProperty.call(schema, 'default')
		        && schema.default !== undefined;
		    }

		    function getToolCatalogDefaultRenderKey(schema) {
		      if (!hasToolCatalogSchemaDefault(schema)) return null;
		      try {
		        const json = JSON.stringify(schema.default);
		        return json === undefined ? String(schema.default) : json;
		      } catch {
		        return String(schema.default);
		      }
		    }

		    function buildDefaultToolArgs(tool) {
		      const properties = tool && tool.parameters && tool.parameters.properties && typeof tool.parameters.properties === 'object'
		        ? tool.parameters.properties
		        : {};
		      const requiredParamNames = getToolCatalogParamText(tool).requiredParamNames || [];
		      const args = {};
		      for (let i = 0; i < requiredParamNames.length; i++) {
		        const name = requiredParamNames[i];
		        const schema = properties[name] && typeof properties[name] === 'object' ? properties[name] : {};
		        if (hasToolCatalogSchemaDefault(schema)) {
		          args[name] = schema.default;
		        } else if (schema.type === 'number' || schema.type === 'integer') {
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
		      }
		      return args;
		    }

		    function getDefaultToolArgsText(tool) {
		      if (!tool || typeof tool !== 'object') return '{}';
		      const cached = toolsCatalogDefaultArgsTextCache.get(tool);
		      if (cached !== undefined) return cached;
		      const text = JSON.stringify(buildDefaultToolArgs(tool), null, 2);
		      toolsCatalogDefaultArgsTextCache.set(tool, text);
		      return text;
		    }

		    function pruneDetachedToolsCatalogControls(controls) {
		      if (!toolsCatalog || typeof toolsCatalog.contains !== 'function' || !Array.isArray(controls)) return controls;
		      let writeIndex = 0;
		      for (let i = 0; i < controls.length; i++) {
		        const el = controls[i];
		        if (!el || !toolsCatalog.contains(el)) continue;
		        controls[writeIndex++] = el;
		      }
		      if (writeIndex !== controls.length) controls.length = writeIndex;
		      return controls;
		    }

	    function setToolsCatalogControlsDisabled(disabled, options) {
	      const disabledFlag = !!disabled;
	      setDisabled(toolsCatalogSearchInput, disabledFlag);
	      setDisabledClass(toolsCatalogSearchLabel, disabledFlag);
	      if (!toolsCatalog || !toolsCatalogVisible) {
	        toolsCatalogControlsDisabledKey = '';
	        return;
	      }
	      const confirmationDisabled = !!disabled && !pendingManualToolConfirmation;
		      const nextKey = (disabledFlag ? '1' : '0') +
		        '|' + (confirmationDisabled ? '1' : '0') +
		        '|' + (manualToolRunBusy ? '1' : '0') +
		        '|' + (isProcessing ? '1' : '0') +
		        '|' + (initReceived ? '1' : '0') +
		        '|' + (pendingManualToolConfirmation ? '1' : '0');
	      if ((!options || options.force !== true) && toolsCatalogControlsDisabledKey === nextKey) return;
	      toolsCatalogControlsDisabledKey = nextKey;
	      const runnerControls = pruneDetachedToolsCatalogControls(toolsCatalogRunnerControls);
	      for (let i = 0; i < runnerControls.length; i++) {
	        const el = runnerControls[i];
	        setDisabled(el, disabledFlag);
	      }
	      const confirmationControls = pruneDetachedToolsCatalogControls(toolsCatalogConfirmationControls);
	      for (let i = 0; i < confirmationControls.length; i++) {
	        const el = confirmationControls[i];
	        setDisabled(el, confirmationDisabled || manualToolRunBusy || isProcessing || !initReceived);
	      }
	    }

			    function getToolCatalogParamText(tool) {
			      if (!tool || typeof tool !== 'object') return { searchText: '', renderKey: '', renderText: 'Params: none', requiredParamNames: [] };
			      const cached = toolsCatalogParamTextCache.get(tool);
			      if (cached !== undefined) return cached;
			      const required = tool && Array.isArray(tool.required) ? tool.required : [];
			      const properties = tool.parameters && tool.parameters.properties && typeof tool.parameters.properties === 'object'
			        ? tool.parameters.properties
			        : null;
			      let searchText = '';
				      const paramRenderKey = createCompactRenderStateKeyBuilder();
			      let renderText = '';
			      let firstParam = true;
			      let paramCount = 0;
			      const requiredParamNames = [];
			      if (properties) for (const param in properties) {
			        if (!Object.prototype.hasOwnProperty.call(properties, param)) continue;
			        const schema = properties[param] && typeof properties[param] === 'object' ? properties[param] : {};
			        const isRequired = required.indexOf(param) >= 0;
			        paramCount++;
			        if (isRequired) requiredParamNames.push(param);
			        searchText = appendSearchToken(searchText, param);
				        appendCompactRenderStateKeyPart(paramRenderKey, param);
				        appendCompactRenderStateKeyPart(paramRenderKey, isRequired ? '1' : '0');
				        appendCompactRenderStateKeyPart(paramRenderKey, schema.type);
			        if (!firstParam) renderText += ', ';
			        renderText += param + (isRequired ? '*' : '');
			        firstParam = false;
			      }
				      appendCompactRenderStateKeyPart(paramRenderKey, paramCount);
				      const renderKey = finishCompactRenderStateKey(paramRenderKey);
			      if (paramCount) renderText = 'Params: ' + renderText;
			      else renderText = 'Params: none';
			      renderText = getToolsCatalogRowDisplayText(renderText, TOOLS_CATALOG_PARAMS_LIMIT);
			      const out = { searchText, renderKey, renderText, requiredParamNames };
			      toolsCatalogParamTextCache.set(tool, out);
			      return out;
			    }

			    function getToolCatalogSearchText(tool) {
			      if (!tool || typeof tool !== 'object') return '';
			      const cached = toolsCatalogSearchTextCache.get(tool);
			      if (cached !== undefined) return cached;
			      let text = '';
			      text = appendSearchToken(text, tool.id);
		      text = appendSearchToken(text, tool.name);
		      text = appendSearchToken(text, tool.description);
			      text = appendSearchToken(text, tool.category);
			      text = appendSearchToken(text, tool.readOnly ? 'read-only' : 'writes');
			      if (tool.requiresApproval) text = appendSearchToken(text, 'approval');
			      text = appendSearchToken(text, getToolCatalogParamText(tool).searchText);
			      text = text.toLowerCase();
			      toolsCatalogSearchTextCache.set(tool, text);
			      return text;
			    }

		    function toolMatchesCatalogSearch(tool, query) {
		      if (!query) return true;
		      if (!tool) return false;
		      return getToolCatalogSearchText(tool).indexOf(query) >= 0;
		    }

					    function setToolsCatalogSearchQuery(query) {
					      const nextQuery = String(query || '');
					      if (nextQuery === toolsCatalogSearchQuery) return false;
					      const nextDisplayQuery = nextQuery.trim();
					      const nextLocalQuery = nextDisplayQuery.toLowerCase();
					      const changed =
					        nextDisplayQuery !== toolsCatalogSearchDisplayQuery ||
					        nextLocalQuery !== toolsCatalogSearchLocalQuery;
					      toolsCatalogSearchQuery = nextQuery;
					      toolsCatalogSearchDisplayQuery = nextDisplayQuery;
					      toolsCatalogSearchLocalQuery = nextLocalQuery;
					      return changed;
					    }

				    function scheduleToolsCatalogSearchRender() {
				      if (toolsCatalogSearchRenderFrame !== null) return;
				      toolsCatalogSearchRenderFrame = requestSearchRenderFrame(() => {
				        toolsCatalogSearchRenderFrame = null;
				        updateToolsCatalogState(currentToolsCatalog);
				      });
				    }

				    function bumpToolsCatalogOverlayVersion() {
			      toolsCatalogOverlayVersion = toolsCatalogOverlayVersion >= Number.MAX_SAFE_INTEGER
			        ? 1
			        : toolsCatalogOverlayVersion + 1;
			    }

				    function manualToolConfirmationsEqual(left, right) {
				      if (left === right) return true;
				      if (!left || !right) return !left && !right;
				      return String(left.toolId || '') === String(right.toolId || '') &&
				        String(left.toolName || '') === String(right.toolName || '') &&
				        left.args === right.args &&
				        stringListsEqual(left.reasons || [], right.reasons || []);
				    }

				    function setPendingManualToolConfirmation(next) {
				      const value = next && typeof next === 'object' ? next : null;
				      if (manualToolConfirmationsEqual(pendingManualToolConfirmation, value)) return false;
				      pendingManualToolConfirmation = value;
				      if (!pendingManualToolConfirmation) lastFocusedManualToolConfirmationKey = '';
				      bumpToolsCatalogOverlayVersion();
				      return true;
				    }

				    function getManualToolResultRenderInfo(result) {
				      const value = result && typeof result === 'object' ? result : null;
				      if (!value) return null;
				      const summaryText = getManualToolResultSummary(value);
				      const outputText = formatManualToolResultOutput(value.data);
				      const outputPreviewText = getManualToolResultOutputPreview(outputText);
				      const renderKeyBuilder = createCompactRenderStateKeyBuilder();
				      appendCompactRenderStateKeyPart(renderKeyBuilder, summaryText);
				      appendCompactRenderStateKeyPart(renderKeyBuilder, outputText.length);
				      appendCompactRenderStateKeyPart(renderKeyBuilder, outputPreviewText);
				      const renderKey = finishCompactRenderStateKey(renderKeyBuilder);
				      return {
				        value,
				        summaryText,
				        outputText,
				        outputPreviewText,
				        renderKey,
				      };
				    }

				    function setLatestManualToolResult(next, renderInfoOverride) {
				      const info = renderInfoOverride && renderInfoOverride.value === next
				        ? renderInfoOverride
				        : getManualToolResultRenderInfo(next);
				      const renderKey = info ? info.renderKey : '';
				      if (latestManualToolResultRenderKey === renderKey) return false;
				      latestManualToolResult = info ? info.value : null;
				      latestManualToolResultRenderKey = renderKey;
				      latestManualToolResultSummaryText = info ? info.summaryText : '';
				      latestManualToolResultOutputText = info ? info.outputText : '';
				      latestManualToolResultOutputPreviewText = info ? info.outputPreviewText : '';
				      bumpToolsCatalogOverlayVersion();
				      return true;
				    }

					    function collectToolsCatalogMatches(tools, query) {
			      const renderTools = [];
			      const renderKey = createCompactRenderStateKeyBuilder();
			      if (!query) {
			        const limit = Math.min(tools.length, TOOLS_CATALOG_RENDER_LIMIT);
			        for (let i = 0; i < limit; i++) {
			          const tool = tools[i];
			          renderTools.push(tool);
			          appendCompactRenderStateKeyPart(renderKey, getToolCatalogRenderText(tool));
			        }
			        return { matchedCount: tools.length, renderTools, renderKey: finishCompactRenderStateKey(renderKey) };
			      }
			      let matchedCount = 0;
			      for (let i = 0; i < tools.length; i++) {
			        const tool = tools[i];
			        if (!toolMatchesCatalogSearch(tool, query)) continue;
			        matchedCount++;
			        if (renderTools.length < TOOLS_CATALOG_RENDER_LIMIT) {
			          renderTools.push(tool);
			          appendCompactRenderStateKeyPart(renderKey, getToolCatalogRenderText(tool));
			        }
			      }
				      return { matchedCount, renderTools, renderKey: finishCompactRenderStateKey(renderKey) };
				    }

						    function getToolsCatalogSummaryText(total, shown, filter, rawQuery, localQuery, visibleToolCount, visibleToolShown) {
						      const filterText = getToolsCatalogSummaryFilterText(filter);
						      const summaryQuery = getToolsCatalogSummaryQuery(rawQuery);
					      const hasVisibleCap = visibleToolShown < visibleToolCount;
				      let baseSummary;
				      if (hasVisibleCap) {
				        baseSummary = localQuery
				          ? 'Showing first ' + visibleToolShown + ' of ' + visibleToolCount + ' matching tools'
				          : 'Showing first ' + visibleToolShown + ' of ' + visibleToolCount + (filter.length ? ' tools matching ' + filterText : ' registered tools');
				        if (localQuery && filter.length) baseSummary += ' within ' + shown + ' of ' + total + ' tools matching ' + filterText;
				      } else {
				        baseSummary = filter.length
				          ? 'Showing ' + shown + ' of ' + total + ' tools matching ' + filterText
				          : 'Showing all ' + total + ' registered tools';
				      }
					      if (!localQuery) return baseSummary + '.';
					      const matchWord = visibleToolCount === 1 ? ' match "' : ' matches "';
						      return baseSummary + '; ' + visibleToolCount + matchWord + summaryQuery + '".';
						    }

						    function getToolsCatalogSummaryQuery(rawQuery) {
						      const value = typeof rawQuery === 'string' ? rawQuery.trim() : '';
						      return value.length <= TOOLS_CATALOG_SUMMARY_QUERY_LIMIT
						        ? value
						        : value.slice(0, TOOLS_CATALOG_SUMMARY_QUERY_LIMIT) + '…';
						    }

						    function getToolsCatalogSummaryFilterText(filter) {
						      const value = formatCommaSeparatedList(filter);
						      return value.length <= TOOLS_CATALOG_SUMMARY_FILTER_LIMIT
						        ? value
						        : value.slice(0, TOOLS_CATALOG_SUMMARY_FILTER_LIMIT) + '…';
						    }

					    function normalizeToolsCatalogCount(value, fallback) {
					      const fallbackNumber = Number(fallback);
					      const fallbackCount = Number.isFinite(fallbackNumber) && fallbackNumber >= 0
					        ? Math.floor(fallbackNumber)
					        : 0;
					      const count = Number(value);
					      return Number.isFinite(count) && count >= 0 ? Math.floor(count) : fallbackCount;
					    }

					    function getToolCatalogRenderText(tool) {
				      if (!tool || typeof tool !== 'object') return '';
			      const cached = toolsCatalogRenderTextCache.get(tool);
			      if (cached !== undefined) return cached;
			      const key = createCompactRenderStateKeyBuilder();
			      appendCompactRenderStateKeyPart(key, tool.id);
			      appendCompactRenderStateKeyPart(key, tool.name);
			      appendCompactRenderStateKeyPart(key, tool.description);
			      appendCompactRenderStateKeyPart(key, tool.category);
			      appendCompactRenderStateKeyPart(key, tool.readOnly ? '1' : '0');
			      appendCompactRenderStateKeyPart(key, tool.requiresApproval ? '1' : '0');
			      const paramText = getToolCatalogParamText(tool);
			      appendCompactRenderStateKeyPart(key, paramText.renderKey);
		      const properties = tool.parameters && tool.parameters.properties && typeof tool.parameters.properties === 'object'
		        ? tool.parameters.properties
		        : null;
		      for (let i = 0; i < paramText.requiredParamNames.length; i++) {
		        const name = paramText.requiredParamNames[i];
		        const schema = properties && properties[name] && typeof properties[name] === 'object' ? properties[name] : {};
		        const defaultRenderKey = getToolCatalogDefaultRenderKey(schema);
			        appendCompactRenderStateKeyPart(key, defaultRenderKey === null ? '0' : '1');
			        if (defaultRenderKey !== null) appendCompactRenderStateKeyPart(key, defaultRenderKey);
			      }
			      const renderKey = finishCompactRenderStateKey(key);
			      toolsCatalogRenderTextCache.set(tool, renderKey);
			      return renderKey;
			    }

				    function getToolsCatalogRenderKey(catalog, total, shown, rawQuery, localQuery, visibleToolCount, visibleToolsRenderKey) {
				      const key = createCompactRenderStateKeyBuilder();
				      const tools = catalog && Array.isArray(catalog.tools) ? catalog.tools : [];
				      const filter = catalog && Array.isArray(catalog.filter) ? catalog.filter : [];
				      appendCompactRenderStateKeyPart(key, total);
			      appendCompactRenderStateKeyPart(key, shown);
			      appendCompactRenderStateKeyPart(key, rawQuery);
				      appendCompactRenderStateKeyPart(key, localQuery);
				      appendCompactRenderStateKeyPart(key, tools.length);
				      appendCompactRenderStateKeyPart(key, filter.length);
				      for (let filterIndex = 0; filterIndex < filter.length; filterIndex++) {
				        appendCompactRenderStateKeyPart(key, filter[filterIndex]);
				      }
				      appendCompactRenderStateKeyPart(key, visibleToolCount);
			      appendCompactRenderStateKeyPart(key, toolsCatalogOverlayVersion);
			      appendCompactRenderStateKeyPart(key, visibleToolsRenderKey || '');
					      return finishCompactRenderStateKey(key);
					    }

					    function toolsCatalogListsShareRenderableContent(left, right) {
					      if (left === right) return true;
					      const leftList = Array.isArray(left) ? left : [];
					      const rightList = Array.isArray(right) ? right : [];
					      if (leftList.length !== rightList.length) return false;
					      for (let index = 0; index < leftList.length; index++) {
					        const leftItem = leftList[index];
					        const rightItem = rightList[index];
					        if (leftItem !== rightItem) return false;
					        if (leftItem !== null && typeof leftItem === 'object') return false;
					      }
					      return true;
					    }

					    function isToolsCatalogReferenceCurrent(catalog, total, shown, rawQuery, localQuery) {
					      if (!catalog || typeof catalog !== 'object' || !currentToolsCatalog || typeof currentToolsCatalog !== 'object') return false;
					      if (toolsCatalogSearchRenderFrame !== null || !toolsCatalogRenderKey) return false;
					      if (toolsCatalogRenderedState !== currentToolsCatalog) return false;
					      if (toolsCatalogRenderedTotal !== total || toolsCatalogRenderedShown !== shown) return false;
					      if (toolsCatalogRenderedRawQuery !== rawQuery || toolsCatalogRenderedLocalQuery !== localQuery) return false;
					      if (toolsCatalogRenderedOverlayVersion !== toolsCatalogOverlayVersion) return false;
					      return toolsCatalogListsShareRenderableContent(catalog.tools, toolsCatalogRenderedTools) &&
					        toolsCatalogListsShareRenderableContent(catalog.filter, toolsCatalogRenderedFilter);
					    }

					    function getToolsCatalogRowDisplayText(text, limit) {
					      const value = String(text === undefined || text === null ? '' : text);
					      return value.length <= limit ? value : value.slice(0, limit) + '…';
					    }

			    function appendToolsCatalogBadge(target, text) {
		      const badgeEl = document.createElement('span');
		      badgeEl.className = 'tools-catalog-badge';
		      badgeEl.textContent = getToolsCatalogRowDisplayText(text, TOOLS_CATALOG_BADGE_LIMIT);
		      target.appendChild(badgeEl);
		    }

			    function getManualToolResultSummaryText(text) {
			      const value = String(text || '');
			      return value.length <= MANUAL_TOOL_RESULT_SUMMARY_LIMIT
			        ? value
			        : value.slice(0, MANUAL_TOOL_RESULT_SUMMARY_LIMIT) + '…';
			    }

			    function getManualToolResultSummary(result) {
			      const value = result && typeof result === 'object' ? result : {};
			      const toolId = value.toolId ? String(value.toolId) : 'tool';
		      const status = value.success ? 'succeeded' : 'failed';
		      const details = value.error
		        ? ' — ' + String(value.error)
		        : (value.truncated ? ' — output truncated' : '');
		      return getManualToolResultSummaryText('Tool ' + toolId + ' ' + status + details);
		    }

			    function showManualToolResult(data, renderInfo) {
			      const changed = setLatestManualToolResult(data, renderInfo);
			      if (changed && data && typeof data === 'object') {
			        announceStatus(latestManualToolResultSummaryText);
			      }
			      return changed;
			    }

			    function formatManualToolResultOutput(data) {
		      if (typeof data === 'string') return data;
		      if (data === undefined) return '';
		      if (data === null) return 'null';
		      if (typeof data === 'object') {
		        try {
		          const json = JSON.stringify(data, null, 2);
		          if (json !== undefined) return json;
		        } catch {}
		      }
			      return String(data);
			    }

			    function getManualToolResultOutputPreview(outputText) {
			      const text = String(outputText || '');
			      if (text.length <= MANUAL_TOOL_RESULT_OUTPUT_PREVIEW_LIMIT) return text;
			      return text.slice(0, MANUAL_TOOL_RESULT_OUTPUT_PREVIEW_LIMIT) + '\n… (output preview truncated)';
			    }

				    const TOOLS_CATALOG_DOM_ID_UNSAFE_RE = /[^a-zA-Z0-9_-]+/g;

		    function renderManualToolResult(target) {
			      if (!target || !latestManualToolResult) return false;
			      const resultEl = document.createElement('div');
			      resultEl.className = 'tools-catalog-result' + (latestManualToolResult.success ? '' : ' error');
		      const summaryEl = document.createElement('div');
		      summaryEl.textContent = latestManualToolResultSummaryText;
		      resultEl.appendChild(summaryEl);
			      const outputText = latestManualToolResultOutputText;
		      if (outputText !== '') {
		        const outputPreviewText = latestManualToolResultOutputPreviewText;
		        const outputEl = document.createElement('details');
	        outputEl.className = 'tools-catalog-result-output';
		        const outputSummaryEl = document.createElement('summary');
		        outputSummaryEl.textContent = 'Show output';
		        const preEl = document.createElement('pre');
		        preEl.setAttribute('tabindex', '0');
		        preEl.setAttribute('data-scrollable', 'true');
		        preEl.setAttribute('aria-label', 'Tool output preview');
		        preEl.textContent = outputPreviewText;
		        outputEl.appendChild(outputSummaryEl);
		        outputEl.appendChild(preEl);
	        resultEl.appendChild(outputEl);
	      }
		      target.appendChild(resultEl);
		      return true;
		    }

		    function focusManualToolConfirmationOnce(target) {
		      const focusKey = String(toolsCatalogOverlayVersion);
		      if (!target || !focusKey || focusKey === lastFocusedManualToolConfirmationKey) return;
		      if (focusInlineConfirmationTarget(target)) {
		        lastFocusedManualToolConfirmationKey = focusKey;
		      }
		    }

			    function focusManualToolRunButton(toolId) {
			      const expectedToolId = String(toolId || '');
			      if (!expectedToolId) return false;
			      for (let controlIndex = 0; controlIndex < toolsCatalogRunnerControls.length; controlIndex++) {
			        const el = toolsCatalogRunnerControls[controlIndex];
			        if (!el || toolsCatalogRunToolIdByButton.get(el) !== expectedToolId) continue;
			        if (focusInlineConfirmationTarget(el)) return true;
		      }
		      return false;
		    }

				    function isManualToolControlFocused() {
				      const activeElement = document.activeElement;
			      if (!activeElement) return false;
			      for (let controlIndex = 0; controlIndex < toolsCatalogRunnerControls.length; controlIndex++) {
			        const el = toolsCatalogRunnerControls[controlIndex];
			        if (el === activeElement) return true;
			      }
			      for (let controlIndex = 0; controlIndex < toolsCatalogConfirmationControls.length; controlIndex++) {
			        const el = toolsCatalogConfirmationControls[controlIndex];
			        if (el === activeElement) return true;
		      }
			      return false;
			    }

			    function requestManualToolRun(button) {
			      const toolId = toolsCatalogRunToolIdByButton.get(button) || '';
			      const argsEl = toolsCatalogRunArgsByButton.get(button);
			      const statusEl = toolsCatalogRunStatusByButton.get(button);
			      if (!initReceived || isProcessing || manualToolRunBusy) return;
			      setPendingManualToolConfirmation(null);
			      let args = {};
			      try {
			        const argsText = argsEl && typeof argsEl.value === 'string' ? argsEl.value : '';
			        const parsed = hasNonWhitespaceText(argsText) ? JSON.parse(argsText) : {};
			        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			          throw new Error('Arguments must be a JSON object.');
			        }
			        args = parsed;
			      } catch (error) {
			        const message = error && error.message ? error.message : 'Invalid JSON arguments.';
			        setTextContent(statusEl, message);
			        setAttributeValue(argsEl, 'aria-errormessage', statusEl ? statusEl.id : '');
			        markInvalidField(argsEl, message);
			        return;
			      }
			      clearInvalidFields([argsEl]);
			      removeAttributeValue(argsEl, 'aria-errormessage');
			      if (!toolId) return;
			      manualToolRunBusy = true;
			      setPendingManualToolConfirmation({ toolId, args });
			      setLatestManualToolResult(null);
			      setTextContent(statusEl, 'Requesting…');
			      armPendingActionTimer('manualToolRun', () => {
			        manualToolRunBusy = false;
			        setPendingManualToolConfirmation(null);
			        setTextContent(statusEl, 'Tool run is taking longer than expected.');
			        showInputNotice('Tool run is taking longer than expected. Controls were re-enabled.', { sync: false });
			        syncInputState();
			      });
			      syncInputState();
			      try { vscode.postMessage({ type: 'runTool', toolId, args }); } catch {
			        clearPendingActionTimer('manualToolRun');
			        manualToolRunBusy = false;
			        setPendingManualToolConfirmation(null);
			        setTextContent(statusEl, 'Failed to request tool run.');
			        syncInputState();
			      }
			    }

			    function findToolsCatalogRunButton(target) {
			      let el = target && typeof target === 'object' ? target : null;
			      while (el && el !== toolsCatalog) {
			        if (toolsCatalogRunToolIdByButton.has(el)) return el;
			        el = el.parentNode || null;
			      }
			      return null;
			    }

			    function handleToolsCatalogClick(e) {
			      const button = findToolsCatalogRunButton(e && e.target ? e.target : null);
			      if (!button) return;
			      e.preventDefault();
			      if (button.disabled) return;
			      requestManualToolRun(button);
			    }

			    function handleToolsCatalogInput(e) {
			      const argsEl = e && e.target && toolsCatalogRunStatusByArgs.has(e.target) ? e.target : null;
			      if (!argsEl) return;
			      const statusEl = toolsCatalogRunStatusByArgs.get(argsEl);
			      clearInvalidFields([argsEl]);
			      removeAttributeValue(argsEl, 'aria-errormessage');
			      if (statusEl && statusEl.textContent && statusEl.textContent !== 'Requesting…') {
			        setTextContent(statusEl, '');
			      }
			    }

			    function getManualToolConfirmationDisplayText(text, limit) {
			      const value = String(text === undefined || text === null ? '' : text);
			      return value.length <= limit ? value : value.slice(0, limit) + '…';
			    }

			    function renderManualToolConfirmation(target) {
		      if (!target || !pendingManualToolConfirmation) return null;
		      const confirmationEl = document.createElement('div');
		      confirmationEl.className = 'tools-catalog-confirmation';
	      const toolId = pendingManualToolConfirmation.toolId ? String(pendingManualToolConfirmation.toolId) : 'tool';
	      const toolName = pendingManualToolConfirmation.toolName ? String(pendingManualToolConfirmation.toolName) : toolId;
	      const displayToolName = getManualToolConfirmationDisplayText(toolName, MANUAL_TOOL_CONFIRMATION_TOOL_NAME_LIMIT);
		      const confirmationId = 'toolsCatalogConfirmation-' + toolId.replace(TOOLS_CATALOG_DOM_ID_UNSAFE_RE, '-');
	      let reasons = '';
	      if (Array.isArray(pendingManualToolConfirmation.reasons)) {
	        for (let i = 0; i < pendingManualToolConfirmation.reasons.length; i++) {
	          const reason = pendingManualToolConfirmation.reasons[i];
	          if (!reason) continue;
	          reasons += (reasons ? ' and ' : '') + String(reason);
	        }
	      }
	      const displayReasons = getManualToolConfirmationDisplayText(reasons, MANUAL_TOOL_CONFIRMATION_REASON_LIMIT);
	      const titleEl = document.createElement('div');
	      titleEl.className = 'tools-catalog-confirmation-title';
	      titleEl.id = confirmationId + '-title';
	      titleEl.textContent = 'Run guarded tool "' + displayToolName + '"?';
	      confirmationEl.setAttribute('role', 'group');
	      confirmationEl.setAttribute('aria-labelledby', titleEl.id);
	      let reasonEl = null;
	      if (displayReasons) {
	        reasonEl = document.createElement('div');
	        reasonEl.className = 'tools-catalog-confirmation-reason';
	        reasonEl.id = confirmationId + '-reason';
	        reasonEl.textContent = 'This tool is guarded because ' + displayReasons + (displayReasons.endsWith('…') ? '' : '.');
	        confirmationEl.setAttribute('aria-describedby', reasonEl.id);
	      }
	      const actionsEl = document.createElement('div');
	      actionsEl.className = 'tools-catalog-confirmation-actions';
	      const cancelEl = document.createElement('button');
	      cancelEl.className = 'context-btn';
	      cancelEl.type = 'button';
	      cancelEl.textContent = 'Cancel';
	      cancelEl.setAttribute('aria-label', 'Cancel guarded tool run');
	      cancelEl.title = 'Cancel guarded tool run';
		      cancelEl.addEventListener('click', (e) => {
		        e.preventDefault();
		        const returnToolId = toolId;
		        setPendingManualToolConfirmation(null);
		        updateToolsCatalogState(currentToolsCatalog);
		        if (!focusManualToolRunButton(returnToolId)) focusInlineConfirmationTarget(toolsCatalogSearchInput);
		        syncInputState();
		      });
	      const runEl = document.createElement('button');
	      runEl.className = 'context-btn';
	      runEl.type = 'button';
	      runEl.textContent = 'Run guarded tool';
	      runEl.setAttribute('aria-label', 'Run guarded tool "' + displayToolName + '"');
	      runEl.title = 'Run guarded tool "' + displayToolName + '"';
	      runEl.addEventListener('click', (e) => {
	        e.preventDefault();
	        if (!initReceived || isProcessing || manualToolRunBusy || !pendingManualToolConfirmation) return;
	        const pending = pendingManualToolConfirmation;
	        manualToolRunBusy = true;
	        setLatestManualToolResult(null);
	        armPendingActionTimer('manualToolRun', () => recoverPendingAction('manualToolRun', 'Guarded tool run is taking longer than expected. Controls were re-enabled.', () => { manualToolRunBusy = false; setPendingManualToolConfirmation(pending); updateToolsCatalogState(currentToolsCatalog); }));
	        updateToolsCatalogState(currentToolsCatalog);
	        try { vscode.postMessage({ type: 'runTool', toolId: pending.toolId, args: pending.args || {}, confirmed: true }); } catch {
	          clearPendingActionTimer('manualToolRun');
	          manualToolRunBusy = false;
	          setPendingManualToolConfirmation(pending);
	          showInputNotice('Failed to request guarded tool run.', { sync: false });
	          updateToolsCatalogState(currentToolsCatalog);
	        }
	        syncInputState();
	      });
	      actionsEl.appendChild(cancelEl);
	      actionsEl.appendChild(runEl);
	      toolsCatalogConfirmationControls.push(cancelEl, runEl);
		      confirmationEl.appendChild(titleEl);
		      if (reasonEl) confirmationEl.appendChild(reasonEl);
		      confirmationEl.appendChild(actionsEl);
		      target.appendChild(confirmationEl);
		      return cancelEl;
		    }

		    function normalizeManualToolConfirmationReasons(raw) {
		      if (!Array.isArray(raw)) return [];
		      const reasons = [];
		      for (let i = 0; i < raw.length; i++) {
		        if (raw[i]) reasons.push(raw[i]);
		      }
		      return reasons;
		    }

		    function handleManualToolConfirmationRequired(data) {
		      clearPendingActionTimer('manualToolRun');
		      manualToolRunBusy = false;
			      const toolId = data && data.toolId ? String(data.toolId) : '';
		      if (!toolId) {
		        setPendingManualToolConfirmation(null);
		        syncInputState();
		        return;
		      }
	      const previous = pendingManualToolConfirmation && pendingManualToolConfirmation.toolId === toolId
	        ? pendingManualToolConfirmation
	        : null;
			      const changed = setPendingManualToolConfirmation({
				        toolId,
				        args: previous ? previous.args : {},
				        toolName: data && data.toolName ? String(data.toolName) : toolId,
				        reasons: normalizeManualToolConfirmationReasons(data && data.reasons),
				      });
			      if (!changed) return;
			      updateToolsCatalogState(currentToolsCatalog);
			      syncInputState();
			    }

		    function handleManualToolResult(data) {
			      clearPendingActionTimer('manualToolRun');
			      const restoreFocus = isManualToolControlFocused();
			      const wasManualToolRunBusy = manualToolRunBusy;
				      const nextResultRenderInfo = getManualToolResultRenderInfo(data);
				      const nextResultRenderKey = nextResultRenderInfo ? nextResultRenderInfo.renderKey : '';
			      if (
			        !wasManualToolRunBusy &&
			        !pendingManualToolConfirmation &&
			        nextResultRenderKey &&
			        nextResultRenderKey === latestManualToolResultRenderKey
			      ) return;
			      const resultToolId = pendingManualToolConfirmation && pendingManualToolConfirmation.toolId
			        ? String(pendingManualToolConfirmation.toolId)
			        : (data && data.toolId ? String(data.toolId) : '');
			      manualToolRunBusy = false;
			      setPendingManualToolConfirmation(null);
				      showManualToolResult(data, nextResultRenderInfo);
	      updateToolsCatalogState(currentToolsCatalog);
	      if (restoreFocus && !focusManualToolRunButton(resultToolId)) focusInlineConfirmationTarget(toolsCatalogSearchInput);
	      syncInputState();
				    }

		    function replaceToolsCatalogChildren(children) {
		      if (!toolsCatalog) return;
		      const list = Array.isArray(children) ? children : [];
		      if (typeof toolsCatalog.replaceChildren === 'function') {
		        if (list.length === 0) {
		          toolsCatalog.replaceChildren();
		          return;
		        }
		        if (list.length === 1) {
		          if (list[0]) toolsCatalog.replaceChildren(list[0]);
		          else toolsCatalog.replaceChildren();
		          return;
		        }
		        if (list.length === 2) {
		          if (list[0] && list[1]) toolsCatalog.replaceChildren(list[0], list[1]);
		          else if (list[0]) toolsCatalog.replaceChildren(list[0]);
		          else if (list[1]) toolsCatalog.replaceChildren(list[1]);
		          else toolsCatalog.replaceChildren();
		          return;
		        }
		        const fragment = document.createDocumentFragment();
		        for (let i = 0; i < list.length; i++) {
		          if (list[i]) fragment.appendChild(list[i]);
		        }
		        toolsCatalog.replaceChildren(fragment);
		        return;
		      }
		      const fragment = document.createDocumentFragment();
		      for (let i = 0; i < list.length; i++) {
		        if (list[i]) fragment.appendChild(list[i]);
		      }
		      replaceElementChildren(toolsCatalog, fragment);
		    }

				    function updateToolsCatalogState(catalog, options) {
				      cancelToolsCatalogSearchRender();
				      const reveal = !!(options && options.reveal);
			      clearPendingActionTimer('toolsCatalog');
			      toolsCatalogRequestPending = false;
				      const previousTools = currentToolsCatalog && Array.isArray(currentToolsCatalog.tools) ? currentToolsCatalog.tools : null;
				      const nextToolsCatalog = catalog && typeof catalog === 'object' ? catalog : null;
				      const nextTools = nextToolsCatalog && Array.isArray(nextToolsCatalog.tools) ? nextToolsCatalog.tools : null;
				      const tools = nextTools || [];
				      const shown = Math.max(tools.length, normalizeToolsCatalogCount(nextToolsCatalog && nextToolsCatalog.shown, tools.length));
				      const total = Math.max(shown, normalizeToolsCatalogCount(nextToolsCatalog && nextToolsCatalog.total, shown));
			      const rawQuery = toolsCatalogSearchDisplayQuery;
			      const localQuery = toolsCatalogSearchLocalQuery;
			      const toolsCatalogReferenceCurrent = isToolsCatalogReferenceCurrent(nextToolsCatalog, total, shown, rawQuery, localQuery);
			      if (toolsCatalogReferenceCurrent) {
			        currentToolsCatalog = nextToolsCatalog;
			        toolsCatalogRenderedState = currentToolsCatalog;
			        setToolsCatalogVisible(true);
			        if (toolsCatalogSearchInput && document.activeElement !== toolsCatalogSearchInput) {
			          setValue(toolsCatalogSearchInput, toolsCatalogSearchQuery);
			        }
			        if (reveal) openSafetySettingsPopover();
			        setToolsCatalogControlsDisabled(!initReceived || isProcessing || manualToolRunBusy || !!pendingManualToolConfirmation);
			        return;
			      }
				      if (nextTools !== previousTools) {
				        toolsCatalogSearchTextCache = new WeakMap();
				        toolsCatalogParamTextCache = new WeakMap();
				        toolsCatalogRenderTextCache = new WeakMap();
			        toolsCatalogDefaultArgsTextCache = new WeakMap();
			      }
			      currentToolsCatalog = nextToolsCatalog;
	      if (!toolsCatalog) return;
		      if (!currentToolsCatalog) {
		        replaceElementChildren(toolsCatalog);
		        toolsCatalogRunnerControls = [];
		        toolsCatalogConfirmationControls = [];
			        setTextContent(toolsCatalogStatus, '');
				        setToolsCatalogVisible(false);
					        toolsCatalogControlsDisabledKey = '';
					        toolsCatalogRenderKey = '';
					        toolsCatalogRenderedState = null;
					        toolsCatalogRenderedTools = null;
					        toolsCatalogRenderedFilter = null;
					        toolsCatalogRenderedTotal = 0;
					        toolsCatalogRenderedShown = 0;
					        toolsCatalogRenderedRawQuery = '';
					        toolsCatalogRenderedLocalQuery = '';
					        toolsCatalogRenderedOverlayVersion = 0;
					        return;
				      }
				      if (
				        nextToolsCatalog === currentToolsCatalog &&
				        toolsCatalogRenderedState === currentToolsCatalog &&
			        toolsCatalogRenderedTotal === total &&
			        toolsCatalogRenderedShown === shown &&
			        toolsCatalogRenderedRawQuery === rawQuery &&
			        toolsCatalogRenderedLocalQuery === localQuery &&
			        toolsCatalogRenderedOverlayVersion === toolsCatalogOverlayVersion
		      ) {
		        setToolsCatalogVisible(true);
		        if (toolsCatalogSearchInput && document.activeElement !== toolsCatalogSearchInput) {
		          setValue(toolsCatalogSearchInput, toolsCatalogSearchQuery);
		        }
		        if (reveal) openSafetySettingsPopover();
		        setToolsCatalogControlsDisabled(!initReceived || isProcessing || manualToolRunBusy || !!pendingManualToolConfirmation);
		        return;
		      }
			      const catalogMatches = collectToolsCatalogMatches(tools, localQuery);
		      const visibleTools = catalogMatches.renderTools;
		      const visibleToolCount = catalogMatches.matchedCount;
		      const visibleToolsRenderKey = catalogMatches.renderKey;
		      setToolsCatalogVisible(true);
		      if (toolsCatalogSearchInput && document.activeElement !== toolsCatalogSearchInput) {
		        setValue(toolsCatalogSearchInput, toolsCatalogSearchQuery);
		      }
		      if (reveal) openSafetySettingsPopover();
		      const nextRenderKey = getToolsCatalogRenderKey(
			        currentToolsCatalog,
			        total,
			        shown,
			        rawQuery,
			        localQuery,
			        visibleToolCount,
			        visibleToolsRenderKey
			      );
				      if (nextRenderKey === toolsCatalogRenderKey) {
				        toolsCatalogRenderedState = currentToolsCatalog;
				        toolsCatalogRenderedTools = tools;
				        toolsCatalogRenderedFilter = Array.isArray(currentToolsCatalog.filter) ? currentToolsCatalog.filter : [];
				        toolsCatalogRenderedTotal = total;
				        toolsCatalogRenderedShown = shown;
				        toolsCatalogRenderedRawQuery = rawQuery;
				        toolsCatalogRenderedLocalQuery = localQuery;
				        toolsCatalogRenderedOverlayVersion = toolsCatalogOverlayVersion;
			        setToolsCatalogControlsDisabled(!initReceived || isProcessing || manualToolRunBusy || !!pendingManualToolConfirmation);
			        return;
			      }
				      toolsCatalogRenderKey = nextRenderKey;
				      toolsCatalogRenderedState = currentToolsCatalog;
				      toolsCatalogRenderedTools = tools;
				      toolsCatalogRenderedFilter = Array.isArray(currentToolsCatalog.filter) ? currentToolsCatalog.filter : [];
				      toolsCatalogRenderedTotal = total;
				      toolsCatalogRenderedShown = shown;
				      toolsCatalogRenderedRawQuery = rawQuery;
				      toolsCatalogRenderedLocalQuery = localQuery;
				      toolsCatalogRenderedOverlayVersion = toolsCatalogOverlayVersion;
		      toolsCatalogControlsDisabledKey = '';
			      toolsCatalogRunnerControls = [];
			      toolsCatalogConfirmationControls = [];
		      const catalogChildren = [];
		      const catalogTarget = {
		        appendChild(child) {
		          catalogChildren.push(child);
		          return child;
		        },
		      };
		      const manualToolConfirmationFocusTarget = pendingManualToolConfirmation
		        ? renderManualToolConfirmation(catalogTarget)
		        : null;
		      if (latestManualToolResult) renderManualToolResult(catalogTarget);
				      const summary = document.createElement('div');
			      summary.className = 'tools-catalog-summary';
			      const filter = Array.isArray(currentToolsCatalog.filter) ? currentToolsCatalog.filter : [];
			      const summaryText = getToolsCatalogSummaryText(total, shown, filter, rawQuery, localQuery, visibleToolCount, visibleTools.length);
		      summary.textContent = summaryText;
		      setTextContent(toolsCatalogStatus, summaryText);
		      catalogChildren.push(summary);
		      if (!tools.length) {
		        const emptyEl = document.createElement('div');
		        emptyEl.className = 'tools-catalog-empty';
		        emptyEl.textContent = filter.length ? 'No registered tools match the current Allowed tools filter.' : 'No tools are registered.';
		        catalogChildren.push(emptyEl);
		        replaceToolsCatalogChildren(catalogChildren);
		        focusManualToolConfirmationOnce(manualToolConfirmationFocusTarget);
		        return;
		      }
			      if (!visibleToolCount) {
		        const emptyEl = document.createElement('div');
		        emptyEl.className = 'tools-catalog-empty';
			        emptyEl.textContent = 'No visible tools match "' + getToolsCatalogSummaryQuery(rawQuery) + '".';
		        catalogChildren.push(emptyEl);
		        replaceToolsCatalogChildren(catalogChildren);
		        focusManualToolConfirmationOnce(manualToolConfirmationFocusTarget);
			        setToolsCatalogControlsDisabled(!initReceived || isProcessing || manualToolRunBusy || !!pendingManualToolConfirmation, { force: true });
		        return;
	      }
			      const itemsEl = document.createElement('ul');
			      itemsEl.className = 'tools-catalog-items';
			      itemsEl.setAttribute('aria-label', 'Visible tools');
				      itemsEl.setAttribute('role', 'list');
				      const visibleFragment = visibleTools.length > 1 ? document.createDocumentFragment() : null;
					      for (let index = 0; index < visibleTools.length; index++) {
					        const tool = visibleTools[index];
			        const toolId = tool && tool.id ? String(tool.id) : 'tool';
			        const displayToolId = getToolsCatalogRowDisplayText(toolId, TOOLS_CATALOG_ID_DISPLAY_LIMIT);
			        const itemEl = document.createElement('li');
			        itemEl.className = 'tools-catalog-item';
		        itemEl.setAttribute('role', 'listitem');
	        const headEl = document.createElement('div');
	        headEl.className = 'tools-catalog-head';
		        const idEl = document.createElement('div');
		        idEl.className = 'tools-catalog-id';
		        idEl.textContent = displayToolId;
		        idEl.title = displayToolId;
		        const badgesEl = document.createElement('div');
		        badgesEl.className = 'tools-catalog-badges';
		        appendToolsCatalogBadge(badgesEl, tool && tool.readOnly ? 'read-only' : 'writes');
		        if (tool && tool.requiresApproval) appendToolsCatalogBadge(badgesEl, 'approval');
		        if (tool && tool.category) appendToolsCatalogBadge(badgesEl, String(tool.category));
		        headEl.appendChild(idEl);
		        headEl.appendChild(badgesEl);
		        itemEl.appendChild(headEl);
	        const descEl = document.createElement('div');
	        descEl.className = 'tools-catalog-desc';
	        descEl.textContent = tool && (tool.description || tool.name)
	          ? getToolsCatalogRowDisplayText(tool.description || tool.name, TOOLS_CATALOG_DESCRIPTION_LIMIT)
	          : 'No description.';
	        itemEl.appendChild(descEl);
	        const paramsEl = document.createElement('div');
	        paramsEl.className = 'tools-catalog-params';
	        paramsEl.textContent = getToolCatalogParamText(tool).renderText;
	        itemEl.appendChild(paramsEl);

	        const runnerEl = document.createElement('div');
	        runnerEl.className = 'tools-catalog-runner';
		        const argsEl = document.createElement('textarea');
	        argsEl.className = 'tools-catalog-args';
		        argsEl.rows = 3;
		        argsEl.spellcheck = false;
		        argsEl.value = getDefaultToolArgsText(tool);
		        argsEl.setAttribute('aria-label', 'Arguments for ' + displayToolId);
		        const rowEl = document.createElement('div');
		        rowEl.className = 'tools-catalog-run-row';
		        const statusEl = document.createElement('span');
		        statusEl.className = 'tools-catalog-status';
			        statusEl.id = 'toolsCatalogRunStatus-' + index;
			        statusEl.setAttribute('role', 'status');
			        statusEl.setAttribute('aria-live', 'polite');
			        statusEl.setAttribute('aria-atomic', 'true');
			        argsEl.setAttribute('aria-describedby', statusEl.id);
			        toolsCatalogRunStatusByArgs.set(argsEl, statusEl);
		        const runEl = document.createElement('button');
	        runEl.className = 'context-btn';
	        runEl.type = 'button';
	        runEl.textContent = 'Run';
	        runEl.setAttribute('aria-label', 'Run ' + displayToolId);
	        runEl.title = 'Run ' + displayToolId;
	        toolsCatalogRunToolIdByButton.set(runEl, tool && tool.id ? String(tool.id) : '');
	        toolsCatalogRunArgsByButton.set(runEl, argsEl);
	        toolsCatalogRunStatusByButton.set(runEl, statusEl);
		        setDisabled(runEl, !initReceived || isProcessing || manualToolRunBusy);
	        rowEl.appendChild(statusEl);
	        rowEl.appendChild(runEl);
			        toolsCatalogRunnerControls.push(argsEl, runEl);
			        runnerEl.appendChild(argsEl);
				        runnerEl.appendChild(rowEl);
				        itemEl.appendChild(runnerEl);
				        if (visibleFragment) {
				          visibleFragment.appendChild(itemEl);
				        } else {
				          itemsEl.appendChild(itemEl);
				        }
				      }
					      if (visibleFragment) itemsEl.appendChild(visibleFragment);
					      catalogChildren.push(itemsEl);
				      if (visibleToolCount > visibleTools.length) {
				        const moreEl = document.createElement('div');
			        moreEl.className = 'tools-catalog-empty';
				        const moreText = localQuery
				          ? 'Showing first ' + visibleTools.length + ' of ' + visibleToolCount + ' matching tools; refine Find tool to inspect more.'
				          : 'Showing first ' + visibleTools.length + ' of ' + visibleToolCount + ' tools; narrow Find tool or the Allowed tools filter to inspect more.';
				        moreEl.setAttribute('role', 'note');
				        moreEl.setAttribute('aria-label', moreText);
				        moreEl.textContent = moreText;
				        catalogChildren.push(moreEl);
				      }
			      replaceToolsCatalogChildren(catalogChildren);
			      focusManualToolConfirmationOnce(manualToolConfirmationFocusTarget);
			      setToolsCatalogControlsDisabled(!initReceived || isProcessing || manualToolRunBusy || !!pendingManualToolConfirmation, { force: true });
		    }

	    function updateSafetySettingsTitle() {
	      if (!safetySettings) return;
	      const externalText = allowExternalPathsEnabled ? 'external paths allowed' : 'external paths blocked';
	      const pushText = blockGitPushEnabled ? 'git push blocked' : 'git push allowed';
	      const pluginText = pluginSettings.autoDiscover
	        ? 'plugins auto-discovered'
	        : (pluginSettings.plugins.length ? pluginSettings.plugins.length + ' plugin module(s)' : 'plugins off');
	      const filterText = toolFilter.length ? toolFilter.length + ' tool filter pattern(s)' : 'all tools allowed';
	      const envCount = countOwnEnumerableKeys(workspaceEnv);
	      const envText = envCount ? envCount + ' env var(s)' : 'no tool env';
	      let debugCount = 0;
	      if (debugSettings.effectiveLlm) debugCount++;
	      if (debugSettings.effectiveTools) debugCount++;
	      if (debugSettings.effectivePlugins) debugCount++;
	      const debugText = debugSettings.details
	        ? 'detailed logs'
	        : (debugCount ? debugCount + ' debug stream(s)' : 'diagnostics off');
		      setTitle(safetySettings, 'Advanced safety: ' + externalText + ', ' + pushText + ', ' + debugText + ', ' + pluginText + ', ' + filterText + ', ' + envText + ', tool timeout ' + toolRuntimeLimits.toolTimeoutMs + 'ms');
		    }

	    function normalizeInstructionPatterns(raw) {
	      return normalizeSeparatedStringList(raw);
	    }

	    function getInstructionPatternsTitleDisplayText(patterns) {
	      const value = formatCommaSeparatedList(patterns);
	      return value.length <= INSTRUCTION_PATTERNS_TITLE_DISPLAY_LIMIT
	        ? value
	        : value.slice(0, INSTRUCTION_PATTERNS_TITLE_DISPLAY_LIMIT) + '…';
	    }

		    function updateNormalizedInstructionPatternsState(patterns) {
		      instructionPatterns = patterns;
		      if (instructionPatternsInput) {
		        setValue(instructionPatternsInput, instructionPatterns.join('\n'));
		        setTitle(instructionPatternsInput, instructionPatterns.length
		          ? instructionPatterns.length + ' custom instruction pattern(s) are included in the system prompt.'
		          : 'No custom instruction patterns are configured; default instruction discovery still applies.');
		      }
		      updateInstructionFileTitles();
		    }

		    function updateInstructionPatternsState(patterns) {
		      updateNormalizedInstructionPatternsState(normalizeInstructionPatterns(patterns));
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
			        setTitle(instructionPatternsLabel, instructionPatterns.length
			          ? 'Custom instruction patterns: ' + getInstructionPatternsTitleDisplayText(instructionPatterns)
			          : 'No custom instruction patterns; default AGENTS.md/CONTEXT.md discovery still applies.');
			      }
		      if (instructionIncludeGlobalLabel) {
		        setTitle(instructionIncludeGlobalLabel, instructionFileSettings.includeGlobal
		          ? 'Global instruction file is included when present.'
		          : 'Global instruction file is not included.');
		      }
		      if (instructionMaxCharsPerFileLabel) {
		        setTitle(instructionMaxCharsPerFileLabel, 'Each instruction file is capped at ' + instructionFileSettings.maxCharsPerFile + ' characters.');
		      }
		      if (instructionMaxTotalCharsLabel) {
		        setTitle(instructionMaxTotalCharsLabel, 'All instruction files are capped at ' + instructionFileSettings.maxTotalChars + ' total characters.');
		      }
		      if (instructionPatternsApply) {
		        setTitle(instructionPatternsApply, 'Apply instruction files: ' + patternText + ', ' + globalText + ', ' + limitText + '.');
		      }
		    }

		    function updateNormalizedInstructionFileSettingsState(settings) {
		      instructionFileSettings = settings;
		      setChecked(instructionIncludeGlobalToggle, instructionFileSettings.includeGlobal);
		      setValue(instructionMaxCharsPerFileInput, instructionFileSettings.maxCharsPerFile);
		      setValue(instructionMaxTotalCharsInput, instructionFileSettings.maxTotalChars);
		      updateInstructionFileTitles();
		    }

		    function updateInstructionFileSettingsState(settings) {
		      updateNormalizedInstructionFileSettingsState(normalizeInstructionFileSettings(settings));
		    }

	    function applyInstructionSettings() {
	      const fields = [instructionPatternsInput, instructionMaxCharsPerFileInput, instructionMaxTotalCharsInput];
	      const pending = hasPendingSettingState('instructionPatternsState') || hasPendingSettingState('instructionFileSettingsState');
	      if (!initReceived || isProcessing || pending) {
	        updateNormalizedInstructionPatternsState(instructionPatterns);
	        updateNormalizedInstructionFileSettingsState(instructionFileSettings);
	        clearInvalidFields(fields);
	        return;
	      }
	      const patterns = normalizeInstructionPatterns(instructionPatternsInput ? instructionPatternsInput.value : instructionPatterns);
	      const settings = {
	        includeGlobal: instructionIncludeGlobalToggle ? !!instructionIncludeGlobalToggle.checked : instructionFileSettings.includeGlobal,
	        maxCharsPerFile: Number(instructionMaxCharsPerFileInput ? instructionMaxCharsPerFileInput.value : instructionFileSettings.maxCharsPerFile),
	        maxTotalChars: Number(instructionMaxTotalCharsInput ? instructionMaxTotalCharsInput.value : instructionFileSettings.maxTotalChars),
	      };
	      if (hasListItemLongerThan(patterns, 240)) {
	        markInvalidField(instructionPatternsInput, 'Instruction patterns must be 240 characters or shorter.');
	        return;
	      }
	      if (!validateNumberField(instructionMaxCharsPerFileInput, settings.maxCharsPerFile, 1000, 'Instruction max characters per file must be at least 1000.')) return;
	      if (!validateNumberField(instructionMaxTotalCharsInput, settings.maxTotalChars, 1000, 'Instruction total character budget must be at least 1000.')) return;
		      const normalizedSettings = normalizeInstructionFileSettings(settings);
		      clearInvalidFields(fields);
		      if (stringListsEqual(patterns, instructionPatterns) && instructionFileSettingsEqual(normalizedSettings, instructionFileSettings)) {
		        updateNormalizedInstructionPatternsState(instructionPatterns);
		        updateNormalizedInstructionFileSettingsState(instructionFileSettings);
		        return;
		      }
		      postSettingsWithPendingStates(
		        ['instructionPatternsState', 'instructionFileSettingsState'],
		        [
		          { type: 'setInstructionPatterns', patterns },
		          { type: 'setInstructionFileSettings', settings: normalizedSettings },
		        ],
		        () => {
		          updateNormalizedInstructionPatternsState(instructionPatterns);
		          updateNormalizedInstructionFileSettingsState(instructionFileSettings);
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

		    function updateNormalizedToolRuntimeLimitsState(limits) {
		      toolRuntimeLimits = limits;
		      setValue(toolTimeoutMsInput, toolRuntimeLimits.toolTimeoutMs);
		      setValue(readMaxLinesInput, toolRuntimeLimits.readMaxLines);
		      setValue(bashBackgroundTtlMsInput, toolRuntimeLimits.bashBackgroundTtlMs);
		      setValue(bashBackgroundCaptureMsInput, toolRuntimeLimits.bashBackgroundCaptureMs);
		      setValue(bashBackgroundCaptureLinesInput, toolRuntimeLimits.bashBackgroundCaptureLines);
		      setValue(workspaceShellTimeoutMsInput, toolRuntimeLimits.workspaceShellTimeoutMs);
		      setValue(httpTimeoutMsInput, toolRuntimeLimits.httpTimeoutMs);
		      setTitle(toolTimeoutMsLabel, 'Global tool timeout is ' + toolRuntimeLimits.toolTimeoutMs + 'ms (0 disables it).');
		      setTitle(readMaxLinesLabel, 'Read tools can return up to ' + toolRuntimeLimits.readMaxLines + ' lines per call.');
		      setTitle(bashBackgroundTtlMsLabel, 'Background bash commands auto-stop after ' + toolRuntimeLimits.bashBackgroundTtlMs + 'ms (0 disables auto-stop).');
		      setTitle(bashBackgroundCaptureMsLabel, 'Background bash startup capture waits up to ' + toolRuntimeLimits.bashBackgroundCaptureMs + 'ms.');
		      setTitle(bashBackgroundCaptureLinesLabel, 'Background bash startup capture includes up to ' + toolRuntimeLimits.bashBackgroundCaptureLines + ' lines.');
		      setTitle(workspaceShellTimeoutMsLabel, 'Workspace shell tools time out after ' + toolRuntimeLimits.workspaceShellTimeoutMs + 'ms (0 disables it).');
		      setTitle(httpTimeoutMsLabel, 'Workspace HTTP tools time out after ' + toolRuntimeLimits.httpTimeoutMs + 'ms (0 disables it).');
		      updateSafetySettingsTitle();
		    }

		    function updateToolRuntimeLimitsState(limits) {
		      updateNormalizedToolRuntimeLimitsState(normalizeToolRuntimeLimits(limits));
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
	        updateNormalizedToolRuntimeLimitsState(toolRuntimeLimits);
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
	      const normalized = normalizeToolRuntimeLimits(limits);
	      if (toolRuntimeLimitsEqual(normalized, toolRuntimeLimits)) {
	        updateNormalizedToolRuntimeLimitsState(toolRuntimeLimits);
	        return;
	      }
	      postSettingWithPendingState(
	        'toolRuntimeLimitsState',
	        { type: 'setToolRuntimeLimits', limits: normalized },
	        () => updateNormalizedToolRuntimeLimitsState(toolRuntimeLimits)
	      );
	    }

		    function closeSafetySettingsPopover(options) {
		      closeSettingsPopover(safetySettingsPopover, safetySettings, options);
		    }

	    function openSafetySettingsPopover() {
	      if (!safetySettingsPopover) return;
		      openSettingsPopover(safetySettingsPopover, safetySettings, safetySettingsClose);
	    }

		    function toggleSafetySettingsPopover() {
		      toggleSettingsPopover(safetySettingsPopover, openSafetySettingsPopover, closeSafetySettingsPopover);
		    }

	    function updateShowThinkingState(enabled) {
	      showThinkingEnabled = !!enabled;
	      setChecked(thinkingToggle, showThinkingEnabled);
	      setTitle(thinkingLabel, showThinkingEnabled
	        ? 'Thinking is shown: model thinking output appears as collapsible blocks.'
	        : 'Thinking is hidden: model thinking output is omitted from new runs.');
	    }

	    function updateMemoriesFeatureState(enabled) {
	      memoriesFeatureEnabled = enabled !== false;
	      setChecked(memoriesFeatureToggle, memoriesFeatureEnabled);
	      setTitle(memoriesFeatureLabel, memoriesFeatureEnabled
	        ? 'Memories are on: memory extraction, recall, and memory tools are available.'
	        : 'Memories are off: memory extraction, recall, and memory tools are disabled.');
	    }

				    function setMemoryDropConfirmVisible(visible) {
				      const visibleFlag = !!visible;
				      if (memoryDropConfirmVisible === visibleFlag) return;
				      memoryDropConfirmVisible = visibleFlag;
				      if (memoryDropConfirm && memoryDropConfirm.classList) {
				        memoryDropConfirm.classList.toggle('hidden', !visibleFlag);
				      }
				    }

				    function setMemoryDropConfirmPending(pending, options) {
				      const wasPending = memoryDropConfirmPending;
				      const nextPending = !!pending;
				      if (memoryDropConfirmSynced && wasPending === nextPending) {
				        if (!options || options.sync !== false) syncInputState();
				        return;
				      }
				      memoryDropConfirmPending = nextPending;
				      memoryDropConfirmSynced = true;
				      setMemoryDropConfirmVisible(memoryDropConfirmPending);
			      setAttributeValue(memoryDropBtn, 'aria-expanded', memoryDropConfirmPending ? 'true' : 'false');
			      if (memoryDropConfirmPending && !wasPending) {
			        focusInlineConfirmationTarget(memoryDropCancelBtn);
			      } else if (!memoryDropConfirmPending && wasPending && (!options || options.restoreFocus !== false)) {
			        focusInlineConfirmationTarget(memoryDropBtn);
			      }
			      if (!options || options.sync !== false) syncInputState();
			    }

		    function getMemoryActionStatusMessage(message) {
		      const value = typeof message === 'string' ? message.trim() : '';
		      return value.length <= MEMORY_ACTION_STATUS_MESSAGE_LIMIT
		        ? value
		        : value.slice(0, MEMORY_ACTION_STATUS_MESSAGE_LIMIT) + '…';
		    }

		    function updateMemoryActionStatusState(status) {
		      const message = getMemoryActionStatusMessage(status && typeof status.message === 'string' ? status.message : '');
		      const state = status && typeof status.state === 'string' ? status.state : '';
		      const nextKey = state + '\n' + message;
		      if (nextKey === memoryActionStatusKey) return false;
		      memoryActionStatusKey = nextKey;
		      memoryActionBusy = state === 'running';
	      if (status && typeof status === 'object' && state !== 'idle') {
		        setMemoryDropConfirmPending(false, { sync: false, restoreFocus: false });
	      }
		      setTextContent(memoryActionStatus, message);
		      const hasMessage = !!message;
		      if (memoryActionStatusVisible !== hasMessage) {
		        memoryActionStatusVisible = hasMessage;
		        if (memoryActionStatus && memoryActionStatus.classList) {
		          memoryActionStatus.classList.toggle('hidden', !hasMessage);
		        }
		      }
		      const isError = state === 'error';
		      if (memoryActionStatusError !== isError) {
		        memoryActionStatusError = isError;
		        setClassPresence(memoryActionStatus, 'error', isError);
		      }
		      const isSuccess = state === 'success';
		      if (memoryActionStatusSuccess !== isSuccess) {
		        memoryActionStatusSuccess = isSuccess;
		        setClassPresence(memoryActionStatus, 'success', isSuccess);
		      }
			      const updateMemoriesText = state === 'running' && /updat/i.test(message) ? 'Updating…' : 'Update memories';
			      const updateMemoriesTitle = state === 'running' ? message : 'Rebuild memory artifacts from saved sessions';
			      const updateMemoriesAriaDetail = state === 'running' ? updateMemoriesTitle : 'rebuild memory artifacts from saved sessions';
			      setTextContent(memoryUpdateNowBtn, updateMemoriesText);
			      setTitle(memoryUpdateNowBtn, updateMemoriesTitle);
			      setAttributeValue(memoryUpdateNowBtn, 'aria-label', updateMemoriesAriaDetail ? updateMemoriesText + ', ' + updateMemoriesAriaDetail : updateMemoriesText);
			      const dropMemoriesText = state === 'running' && /dropp|delet/i.test(message) ? 'Dropping…' : 'Drop memories';
			      const dropMemoriesTitle = state === 'running' ? message : 'Delete generated memory artifacts and extraction outputs';
			      const dropMemoriesAriaDetail = state === 'running' ? dropMemoriesTitle : 'delete generated memory artifacts and extraction outputs';
			      setTextContent(memoryDropBtn, dropMemoriesText);
			      setTitle(memoryDropBtn, dropMemoriesTitle);
			      setAttributeValue(memoryDropBtn, 'aria-label', dropMemoriesAriaDetail ? dropMemoriesText + ', ' + dropMemoriesAriaDetail : dropMemoriesText);
		      if (message && lastMemoryActionAnnouncement !== message) {
		        lastMemoryActionAnnouncement = message;
		        announceStatus(message);
		      } else if (!message) {
		        lastMemoryActionAnnouncement = '';
		      }
		      syncInputState();
		      return true;
		    }

	    function updateMemoryAutoRecallState(enabled) {
	      memoryAutoRecallEnabled = !!enabled;
	      setChecked(memoryAutoRecallToggle, memoryAutoRecallEnabled);
	      setTitle(memoryAutoRecallLabel, memoryAutoRecallEnabled
	        ? 'Memory recall is on: relevant saved memories are injected into new turns.'
	        : 'Memory recall is off: saved memories are not automatically injected into new turns.');
	    }

	    function normalizeMemoryAutoRecallBudget(maxResults, maxTokens) {
	      const parsedMaxResults = Number(maxResults);
	      const parsedMaxTokens = Number(maxTokens);
	      return {
	        maxResults: Number.isFinite(parsedMaxResults) && parsedMaxResults >= 1 ? Math.floor(parsedMaxResults) : 4,
	        maxTokens: Number.isFinite(parsedMaxTokens) && parsedMaxTokens >= 100 ? Math.floor(parsedMaxTokens) : 1200,
	      };
	    }

	    function updateNormalizedMemoryAutoRecallBudgetState(budget) {
	      memoryAutoRecallMaxResults = budget.maxResults;
	      memoryAutoRecallMaxTokens = budget.maxTokens;
	      setValue(memoryAutoRecallMaxResultsInput, memoryAutoRecallMaxResults);
	      setTitle(memoryAutoRecallMaxResultsInput, 'Inject up to ' + memoryAutoRecallMaxResults + ' recalled memory matches.');
	      setValue(memoryAutoRecallMaxTokensInput, memoryAutoRecallMaxTokens);
	      setTitle(memoryAutoRecallMaxTokensInput, 'Inject up to about ' + memoryAutoRecallMaxTokens + ' memory tokens.');
	      setTitle(memoryAutoRecallMaxResultsLabel, 'Auto-recall injects up to ' + memoryAutoRecallMaxResults + ' memory matches.');
	      setTitle(memoryAutoRecallMaxTokensLabel, 'Auto-recall injects up to about ' + memoryAutoRecallMaxTokens + ' memory tokens.');
	    }

	    function updateMemoryAutoRecallBudgetState(maxResults, maxTokens) {
	      updateNormalizedMemoryAutoRecallBudgetState(normalizeMemoryAutoRecallBudget(maxResults, maxTokens));
	    }

	    function applyMemoryAutoRecallBudget() {
	      const currentBudget = { maxResults: memoryAutoRecallMaxResults, maxTokens: memoryAutoRecallMaxTokens };
	      const fields = [memoryAutoRecallMaxResultsInput, memoryAutoRecallMaxTokensInput];
	      if (!initReceived || isProcessing || !memoriesFeatureEnabled || hasPendingSettingState('memoryAutoRecallBudgetState')) {
	        updateNormalizedMemoryAutoRecallBudgetState(currentBudget);
	        clearInvalidFields(fields);
	        return;
	      }
	      const maxResults = Number(memoryAutoRecallMaxResultsInput ? memoryAutoRecallMaxResultsInput.value : memoryAutoRecallMaxResults);
	      const maxTokens = Number(memoryAutoRecallMaxTokensInput ? memoryAutoRecallMaxTokensInput.value : memoryAutoRecallMaxTokens);
	      if (!validateNumberField(memoryAutoRecallMaxResultsInput, maxResults, 1, 'Memory recall results must be at least 1.')) return;
	      if (!validateNumberField(memoryAutoRecallMaxTokensInput, maxTokens, 100, 'Memory recall token budget must be at least 100.')) return;
	      clearInvalidFields(fields);
	      const budget = { maxResults: Math.floor(maxResults), maxTokens: Math.floor(maxTokens) };
	      if (memoryAutoRecallBudgetEqual(budget, currentBudget)) {
	        updateNormalizedMemoryAutoRecallBudgetState(currentBudget);
	        return;
	      }
	      postSettingWithPendingState(
	        'memoryAutoRecallBudgetState',
	        { type: 'setMemoryAutoRecallBudget', budget },
	        () => updateNormalizedMemoryAutoRecallBudgetState(currentBudget)
	      );
	    }

	    function normalizeMemoryAutoRecallFilters(minScore, minScoreGap, maxAgeDays) {
	      const parsedMinScore = Number(minScore);
	      const parsedMinScoreGap = Number(minScoreGap);
	      const parsedMaxAgeDays = Number(maxAgeDays);
	      return {
	        minScore: Number.isFinite(parsedMinScore) && parsedMinScore >= 0 ? Math.min(100, parsedMinScore) : 7,
	        minScoreGap: Number.isFinite(parsedMinScoreGap) && parsedMinScoreGap >= 0 ? Math.min(50, parsedMinScoreGap) : 1.25,
	        maxAgeDays: Number.isFinite(parsedMaxAgeDays) && parsedMaxAgeDays >= 1 ? Math.min(3650, Math.floor(parsedMaxAgeDays)) : 45,
	      };
	    }

	    function updateNormalizedMemoryAutoRecallFiltersState(filters) {
	      memoryAutoRecallMinScore = filters.minScore;
	      memoryAutoRecallMinScoreGap = filters.minScoreGap;
	      memoryAutoRecallMaxAgeDays = filters.maxAgeDays;
	      setValue(memoryAutoRecallMinScoreInput, memoryAutoRecallMinScore);
	      setTitle(memoryAutoRecallMinScoreInput, 'Require memory recall score of at least ' + memoryAutoRecallMinScore + '.');
	      setValue(memoryAutoRecallMinScoreGapInput, memoryAutoRecallMinScoreGap);
	      setTitle(memoryAutoRecallMinScoreGapInput, 'Require top memory score to beat the next candidate by at least ' + memoryAutoRecallMinScoreGap + '.');
	      setValue(memoryAutoRecallMaxAgeDaysInput, memoryAutoRecallMaxAgeDays);
	      setTitle(memoryAutoRecallMaxAgeDaysInput, 'Ignore auto-recall matches older than ' + memoryAutoRecallMaxAgeDays + ' days.');
	      setTitle(memoryAutoRecallMinScoreLabel, 'Auto-recall requires retrieval score of at least ' + memoryAutoRecallMinScore + '.');
	      setTitle(memoryAutoRecallMinScoreGapLabel, 'Auto-recall requires top score gap of at least ' + memoryAutoRecallMinScoreGap + '.');
	      setTitle(memoryAutoRecallMaxAgeDaysLabel, 'Auto-recall ignores matches older than ' + memoryAutoRecallMaxAgeDays + ' days.');
	    }

	    function updateMemoryAutoRecallFiltersState(minScore, minScoreGap, maxAgeDays) {
	      updateNormalizedMemoryAutoRecallFiltersState(normalizeMemoryAutoRecallFilters(minScore, minScoreGap, maxAgeDays));
	    }

	    function applyMemoryAutoRecallFilters() {
	      const currentFilters = {
	        minScore: memoryAutoRecallMinScore,
	        minScoreGap: memoryAutoRecallMinScoreGap,
	        maxAgeDays: memoryAutoRecallMaxAgeDays,
	      };
	      const fields = [memoryAutoRecallMinScoreInput, memoryAutoRecallMinScoreGapInput, memoryAutoRecallMaxAgeDaysInput];
	      if (!initReceived || isProcessing || !memoriesFeatureEnabled || hasPendingSettingState('memoryAutoRecallFiltersState')) {
	        updateNormalizedMemoryAutoRecallFiltersState(currentFilters);
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
	      const filters = {
	        minScore: Math.min(100, minScore),
	        minScoreGap: Math.min(50, minScoreGap),
	        maxAgeDays: Math.min(3650, Math.floor(maxAgeDays)),
	      };
	      if (memoryAutoRecallFiltersEqual(filters, currentFilters)) {
	        updateNormalizedMemoryAutoRecallFiltersState(currentFilters);
	        return;
	      }
	      postSettingWithPendingState(
	        'memoryAutoRecallFiltersState',
	        { type: 'setMemoryAutoRecallFilters', filters },
	        () => updateNormalizedMemoryAutoRecallFiltersState(currentFilters)
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

	    function updateNormalizedMemoryAdvancedLimitsState(limits) {
	      memoryAdvancedLimits = limits;
	      const maxRawMemoriesForGlobalTitle = 'Retain up to ' + memoryAdvancedLimits.maxRawMemoriesForGlobal + ' latest rollout memories in generated artifacts.';
	      const maxRolloutAgeDaysTitle = 'Extract memory from sessions up to ' + memoryAdvancedLimits.maxRolloutAgeDays + ' days old.';
	      const maxRolloutsPerStartupTitle = 'Scan up to ' + memoryAdvancedLimits.maxRolloutsPerStartup + ' sessions per memory update.';
	      const minRolloutIdleHoursTitle = 'Extract only from sessions idle for at least ' + memoryAdvancedLimits.minRolloutIdleHours + ' hours.';
	      const maxStateOutputsTitle = 'Retain up to ' + memoryAdvancedLimits.maxStateOutputs + ' stage-1 memory outputs.';
	      const maxRecordsTitle = 'Retain up to ' + memoryAdvancedLimits.maxRecords + ' transcript-backed memory records.';
	      const maxSearchResultsTitle = 'Memory search returns up to ' + memoryAdvancedLimits.maxSearchResults + ' matches by default.';
	      const maxResultsPerKindTitle = 'Memory search returns up to ' + memoryAdvancedLimits.maxResultsPerKind + ' top-level matches per kind.';
	      const searchNeighborWindowTitle = 'Include ' + memoryAdvancedLimits.searchNeighborWindow + ' neighboring transcript chunks around each memory hit.';
	      setValue(memoryMaxRawMemoriesForGlobalInput, memoryAdvancedLimits.maxRawMemoriesForGlobal);
	      setTitle(memoryMaxRawMemoriesForGlobalInput, maxRawMemoriesForGlobalTitle);
	      setValue(memoryMaxRolloutAgeDaysInput, memoryAdvancedLimits.maxRolloutAgeDays);
	      setTitle(memoryMaxRolloutAgeDaysInput, maxRolloutAgeDaysTitle);
	      setValue(memoryMaxRolloutsPerStartupInput, memoryAdvancedLimits.maxRolloutsPerStartup);
	      setTitle(memoryMaxRolloutsPerStartupInput, maxRolloutsPerStartupTitle);
	      setValue(memoryMinRolloutIdleHoursInput, memoryAdvancedLimits.minRolloutIdleHours);
	      setTitle(memoryMinRolloutIdleHoursInput, minRolloutIdleHoursTitle);
	      setValue(memoryMaxStateOutputsInput, memoryAdvancedLimits.maxStateOutputs);
	      setTitle(memoryMaxStateOutputsInput, maxStateOutputsTitle);
	      setValue(memoryMaxRecordsInput, memoryAdvancedLimits.maxRecords);
	      setTitle(memoryMaxRecordsInput, maxRecordsTitle);
	      setValue(memoryMaxSearchResultsInput, memoryAdvancedLimits.maxSearchResults);
	      setTitle(memoryMaxSearchResultsInput, maxSearchResultsTitle);
	      setValue(memoryMaxResultsPerKindInput, memoryAdvancedLimits.maxResultsPerKind);
	      setTitle(memoryMaxResultsPerKindInput, maxResultsPerKindTitle);
	      setValue(memorySearchNeighborWindowInput, memoryAdvancedLimits.searchNeighborWindow);
	      setTitle(memorySearchNeighborWindowInput, searchNeighborWindowTitle);
	      setTitle(memoryMaxRawMemoriesForGlobalLabel, memoryMaxRawMemoriesForGlobalInput ? maxRawMemoriesForGlobalTitle : '');
	      setTitle(memoryMaxRolloutAgeDaysLabel, memoryMaxRolloutAgeDaysInput ? maxRolloutAgeDaysTitle : '');
	      setTitle(memoryMaxRolloutsPerStartupLabel, memoryMaxRolloutsPerStartupInput ? maxRolloutsPerStartupTitle : '');
	      setTitle(memoryMinRolloutIdleHoursLabel, memoryMinRolloutIdleHoursInput ? minRolloutIdleHoursTitle : '');
	      setTitle(memoryMaxStateOutputsLabel, memoryMaxStateOutputsInput ? maxStateOutputsTitle : '');
	      setTitle(memoryMaxRecordsLabel, memoryMaxRecordsInput ? maxRecordsTitle : '');
	      setTitle(memoryMaxSearchResultsLabel, memoryMaxSearchResultsInput ? maxSearchResultsTitle : '');
	      setTitle(memoryMaxResultsPerKindLabel, memoryMaxResultsPerKindInput ? maxResultsPerKindTitle : '');
	      setTitle(memorySearchNeighborWindowLabel, memorySearchNeighborWindowInput ? searchNeighborWindowTitle : '');
	    }

	    function updateMemoryAdvancedLimitsState(limits) {
	      updateNormalizedMemoryAdvancedLimitsState(normalizeMemoryAdvancedLimits(limits));
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
	        updateNormalizedMemoryAdvancedLimitsState(currentLimits);
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
	      if (memoryAdvancedLimitsEqual(normalized, currentLimits)) {
	        updateNormalizedMemoryAdvancedLimitsState(currentLimits);
	        return;
	      }
	      postSettingWithPendingState(
	        'memoryAdvancedLimitsState',
	        { type: 'setMemoryAdvancedLimits', limits: normalized },
	        () => updateNormalizedMemoryAdvancedLimitsState(currentLimits)
	      );
	    }

		    function normalizeExplorePrepassMaxChars(maxChars) {
		      const parsedMaxChars = Number(maxChars);
		      return Number.isFinite(parsedMaxChars) && parsedMaxChars >= 500 ? Math.floor(parsedMaxChars) : 8000;
		    }

		    function updateNormalizedExplorePrepassState(enabled, maxChars) {
		      explorePrepassEnabled = !!enabled;
		      explorePrepassMaxChars = maxChars;
		      setChecked(explorePrepassToggle, explorePrepassEnabled);
		      setValue(explorePrepassMaxCharsInput, explorePrepassMaxChars);
		      setTitle(explorePrepassMaxCharsInput, 'Inject up to ' + explorePrepassMaxChars + ' characters from the explore prepass.');
		      setTitle(explorePrepassLabel, explorePrepassEnabled
		        ? 'Explore prepass is on: LingYun gathers lightweight workspace context before new turns.'
		        : 'Explore prepass is off: new turns start without automatic workspace exploration.');
		    }

		    function updateExplorePrepassState(enabled, maxChars) {
		      updateNormalizedExplorePrepassState(enabled, normalizeExplorePrepassMaxChars(maxChars));
		    }

		    function normalizeSubagentModelOverride(model) {
		      return typeof model === 'string' ? model.trim().slice(0, 200) : '';
		    }

		    function updateNormalizedSubagentModelOverrideState(model) {
		      subagentModelOverride = model;
		      setValue(subagentModelOverrideInput, subagentModelOverride);
		      setTitle(subagentModelOverrideInput, subagentModelOverride
		        ? 'Subagents use model: ' + subagentModelOverride
		        : 'Subagents use the current main model.');
		      setTitle(subagentModelOverrideLabel, subagentModelOverride
		        ? 'Explore/task subagents use model: ' + subagentModelOverride
		        : 'Explore/task subagents use the current main model.');
		    }

		    function updateSubagentModelOverrideState(model) {
		      updateNormalizedSubagentModelOverrideState(normalizeSubagentModelOverride(model));
		    }

		    function normalizeSubagentTaskMaxOutputChars(maxChars) {
		      const parsedMaxChars = Number(maxChars);
		      return Number.isFinite(parsedMaxChars) && parsedMaxChars >= 500 ? Math.floor(parsedMaxChars) : 8000;
		    }

		    function updateNormalizedSubagentTaskMaxOutputCharsState(maxChars) {
		      subagentTaskMaxOutputChars = maxChars;
		      setValue(subagentTaskMaxOutputCharsInput, subagentTaskMaxOutputChars);
		      setTitle(subagentTaskMaxOutputCharsInput, 'Inject up to ' + subagentTaskMaxOutputChars + ' characters from each task subagent result.');
		      setTitle(subagentTaskMaxOutputCharsLabel, 'Task subagent results inject up to ' + subagentTaskMaxOutputChars + ' characters into the main prompt.');
		    }

		    function updateSubagentTaskMaxOutputCharsState(maxChars) {
		      updateNormalizedSubagentTaskMaxOutputCharsState(normalizeSubagentTaskMaxOutputChars(maxChars));
		    }

	    function normalizeCompactionToolOutputMode(mode) {
	      return mode === 'afterToolCall' ? 'afterToolCall' : 'onCompaction';
	    }

	    function updateAutoCompactionState(enabled) {
	      autoCompactionEnabled = !!enabled;
	      setChecked(autoCompactionToggle, autoCompactionEnabled);
	      setTitle(autoCompactionLabel, autoCompactionEnabled
	        ? 'Auto-compaction is on: LingYun summarizes older context before overflow.'
	        : 'Auto-compaction is off: overflowing context may fail until you compact manually.');
	    }

	    function normalizeModelLimits(raw) {
	      const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	      const normalized = {};
	      let count = 0;
	      for (const rawKey in source) {
	        if (!Object.prototype.hasOwnProperty.call(source, rawKey)) continue;
	        if (count >= 100) continue;
	        const key = String(rawKey || '').trim().slice(0, 240);
	        const entry = source[rawKey];
	        if (!key || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
	        const context = Number(entry.context);
	        const output = Number(entry.output);
	        if (!Number.isFinite(context) || context <= 0) continue;
	        const hadKey = Object.prototype.hasOwnProperty.call(normalized, key);
	        const normalizedEntry = { context: Math.floor(context) };
	        if (Number.isFinite(output) && output > 0) normalizedEntry.output = Math.floor(output);
	        normalized[key] = normalizedEntry;
	        if (!hadKey) count++;
	      }
	      return normalized;
	    }

		    function serializeNormalizedModelLimits(limits) {
		      return serializeSortedOwnEnumerableEntries(limits, (key, entry) => {
		        return key + ' = ' + entry.context + (entry.output ? ' / ' + entry.output : '');
		      });
		    }

		    function serializeModelLimits(limits) {
		      return serializeNormalizedModelLimits(normalizeModelLimits(limits));
		    }

	    function parseModelLimitValue(raw) {
	      const value = String(raw || '');
	      let context;
	      let output;
	      let partStart = 0;

	      for (let i = 0; i <= value.length; i++) {
	        const charCode = i < value.length ? value.charCodeAt(i) : 0;
	        if (i < value.length && charCode !== 47 && charCode !== 44) continue;
	        const part = value.slice(partStart, i).trim();
	        if (part) {
	          if (context === undefined) {
	            context = Number(part);
	          } else {
	            output = Number(part);
	            break;
	          }
	        }
	        partStart = i + 1;
	      }

	      return { context, output };
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

	      let count = 0;
	      let valid = true;
	      forEachTextLine(text, (line) => {
	        if (count >= 100) {
	          valid = false;
	          return false;
	        }
	        const trimmed = line.trim();
	        if (!trimmed || trimmed.startsWith('#')) return;

	        const equalsIndex = trimmed.indexOf('=');
	        const colonSpaceIndex = trimmed.indexOf(': ');
	        const sepIndex = equalsIndex >= 0 ? equalsIndex : colonSpaceIndex;
	        if (sepIndex <= 0) {
	          valid = false;
	          return false;
	        }

	        const separatorLength = equalsIndex >= 0 ? 1 : 2;
	        const key = trimmed.slice(0, sepIndex).trim().slice(0, 240);
	        const rest = trimmed.slice(sepIndex + separatorLength).trim();
	        const parsedValue = parseModelLimitValue(rest);
	        const context = parsedValue.context;
	        const output = parsedValue.output;

	        if (!key || !Number.isFinite(context) || context <= 0) {
	          valid = false;
	          return false;
	        }
	        if (output !== undefined && (!Number.isFinite(output) || output <= 0)) {
	          valid = false;
	          return false;
	        }

	        const hadKey = Object.prototype.hasOwnProperty.call(normalized, key);
	        const normalizedEntry = { context: Math.floor(context) };
	        if (output) normalizedEntry.output = Math.floor(output);
	        normalized[key] = normalizedEntry;
	        if (!hadKey) count++;
	      });
	      return valid ? normalized : null;
	    }

		    function updateNormalizedModelLimitsState(limits) {
		      modelLimits = limits;
		      const count = countOwnEnumerableKeys(modelLimits);
		      setValue(modelLimitsInput, serializeNormalizedModelLimits(modelLimits));
		      setTitle(modelLimitsInput, count
		        ? count + ' model token limit override(s) configured.'
		        : 'No model token limit overrides configured.');
	      setTitle(modelLimitsLabel, count
	        ? count + ' model token limit override(s) affect context tracking and auto-compaction.'
		        : 'No model token limit overrides configured.');
		    }

		    function updateModelLimitsState(limits) {
		      updateNormalizedModelLimitsState(normalizeModelLimits(limits));
		    }

		    function applyModelLimits() {
		      if (!initReceived || isProcessing || hasPendingSettingState('modelLimitsState')) {
		        updateNormalizedModelLimitsState(modelLimits);
		        clearInvalidFields([modelLimitsInput]);
		        return;
		      }
	      const parsed = parseModelLimits(modelLimitsInput ? modelLimitsInput.value : '');
	      if (!parsed) {
	        markInvalidField(modelLimitsInput, 'Use JSON or lines like: model-id = contextTokens / outputTokens. Token limits must be positive.');
	        return;
	      }
		      clearInvalidFields([modelLimitsInput]);
		      if (modelLimitsEqual(parsed, modelLimits)) {
		        updateNormalizedModelLimitsState(modelLimits);
		        return;
		      }
		      postSettingWithPendingState(
		        'modelLimitsState',
		        { type: 'setModelLimits', limits: parsed },
		        () => updateNormalizedModelLimitsState(modelLimits)
		      );
		    }

		    function normalizeCompactionPruneSettings(prune, protectTokens, minimumTokens) {
		      const parsedProtectTokens = Number(protectTokens);
		      const parsedMinimumTokens = Number(minimumTokens);
		      return {
		        prune: prune !== false,
		        pruneProtectTokens: Number.isFinite(parsedProtectTokens) && parsedProtectTokens >= 0 ? Math.floor(parsedProtectTokens) : 40000,
		        pruneMinimumTokens: Number.isFinite(parsedMinimumTokens) && parsedMinimumTokens >= 0 ? Math.floor(parsedMinimumTokens) : 20000,
		      };
		    }

		    function updateNormalizedCompactionPruneState(settings) {
		      compactionPruneEnabled = settings.prune;
		      compactionPruneProtectTokens = settings.pruneProtectTokens;
		      compactionPruneMinimumTokens = settings.pruneMinimumTokens;
		      setChecked(compactionPruneToggle, compactionPruneEnabled);
		      setValue(compactionPruneProtectTokensInput, compactionPruneProtectTokens);
		      setTitle(compactionPruneProtectTokensInput, 'Keep at least ' + compactionPruneProtectTokens + ' recent tool-output tokens before pruning.');
		      setValue(compactionPruneMinimumTokensInput, compactionPruneMinimumTokens);
		      setTitle(compactionPruneMinimumTokensInput, 'Only prune when at least ' + compactionPruneMinimumTokens + ' tokens would be cleared.');
		      setTitle(compactionPruneLabel, compactionPruneEnabled
		        ? 'Tool-output pruning is on: older tool-output context can be cleared before full compaction.'
		        : 'Tool-output pruning is off: full compaction handles context cleanup.');
		      setTitle(compactionPruneProtectTokensLabel, 'Keep at least ' + compactionPruneProtectTokens + ' recent tool-output tokens before pruning.');
		      setTitle(compactionPruneMinimumTokensLabel, 'Only prune when at least ' + compactionPruneMinimumTokens + ' tokens would be cleared.');
		    }

		    function updateCompactionPruneState(prune, protectTokens, minimumTokens) {
		      updateNormalizedCompactionPruneState(normalizeCompactionPruneSettings(prune, protectTokens, minimumTokens));
		    }

	    function applyCompactionPruneSettings() {
	      const current = {
	        prune: compactionPruneEnabled,
	        pruneProtectTokens: compactionPruneProtectTokens,
	        pruneMinimumTokens: compactionPruneMinimumTokens,
	      };
	      const fields = [compactionPruneProtectTokensInput, compactionPruneMinimumTokensInput];
	      if (!initReceived || isProcessing || hasPendingSettingState('compactionPruneState')) {
	        updateNormalizedCompactionPruneState(current);
	        clearInvalidFields(fields);
	        return;
	      }
	      const prune = !!(compactionPruneToggle && compactionPruneToggle.checked);
	      const pruneProtectTokens = Number(compactionPruneProtectTokensInput ? compactionPruneProtectTokensInput.value : compactionPruneProtectTokens);
	      const pruneMinimumTokens = Number(compactionPruneMinimumTokensInput ? compactionPruneMinimumTokensInput.value : compactionPruneMinimumTokens);
	      if (!validateNumberField(compactionPruneProtectTokensInput, pruneProtectTokens, 0, 'Compaction protect tokens must be 0 or greater.')) return;
	      if (!validateNumberField(compactionPruneMinimumTokensInput, pruneMinimumTokens, 0, 'Compaction minimum tokens must be 0 or greater.')) return;
		      clearInvalidFields(fields);
		      const settings = {
		        prune,
		        pruneProtectTokens: Math.floor(pruneProtectTokens),
		        pruneMinimumTokens: Math.floor(pruneMinimumTokens),
		      };
		      if (compactionPruneSettingsEqual(settings, current)) {
		        updateNormalizedCompactionPruneState(current);
		        return;
		      }
		      setChecked(compactionPruneToggle, compactionPruneEnabled);
		      postSettingWithPendingState(
	        'compactionPruneState',
	        { type: 'setCompactionPruneSettings', settings },
	        null
	      );
	    }

	    function updateNormalizedCompactionToolOutputModeState(mode) {
	      compactionToolOutputMode = mode;
	      setValue(compactionToolOutputModeSelect, compactionToolOutputMode);
	      setTitle(compactionToolOutputModeSelect, compactionToolOutputMode === 'afterToolCall'
	        ? 'Tool outputs are compacted after the model has seen them once.'
	        : 'Tool outputs are only compacted during session compaction.');
	    }

	    function updateCompactionToolOutputModeState(mode) {
	      updateNormalizedCompactionToolOutputModeState(normalizeCompactionToolOutputMode(mode));
	    }

	    function setMode(mode) {
	      currentMode = mode === 'plan' ? 'plan' : 'build';
	      setClassPresence(modePlanBtn, 'active', currentMode === 'plan');
	      setAttributeValue(modePlanBtn, 'aria-pressed', currentMode === 'plan' ? 'true' : 'false');
	      setClassPresence(modeBuildBtn, 'active', currentMode === 'build');
	      setAttributeValue(modeBuildBtn, 'aria-pressed', currentMode === 'build' ? 'true' : 'false');
	      syncInputState();
	    }

	    function requestModeChange(mode) {
	      const nextMode = mode === 'plan' ? 'plan' : 'build';
	      if (!initReceived || isProcessing || isComposerRoutingLocked() || modeSwitchPending) return;
	      if (nextMode === currentMode) return;
	      modeSwitchPending = true;
	      armPendingActionTimer('modeSwitch', () => recoverPendingAction('modeSwitch', 'Mode switch is taking longer than expected. Controls were re-enabled.', () => { modeSwitchPending = false; }));
	      syncInputState();
	      try {
	        vscode.postMessage({ type: 'changeMode', mode: nextMode });
	      } catch {
	        clearPendingActionTimer('modeSwitch');
	        modeSwitchPending = false;
	        showInputNotice('Failed to request mode change.', { sync: false });
	        syncInputState();
	      }
	    }

	    if (modePlanBtn) {
	      modePlanBtn.addEventListener('click', () => requestModeChange('plan'));
	      setAttributeValue(modePlanBtn, 'aria-pressed', 'false');
	    }
	    if (modeBuildBtn) {
	      modeBuildBtn.addEventListener('click', () => requestModeChange('build'));
	      setAttributeValue(modeBuildBtn, 'aria-pressed', 'true');
	    }

	    if (newSessionBtn) {
	      newSessionBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || isComposerRoutingLocked() || sessionActionPending) return;
	          sessionActionPending = 'newSession';
	          armPendingActionTimer('sessionAction', () => recoverPendingAction('sessionAction', 'Session action is taking longer than expected. Controls were re-enabled.', () => { sessionActionPending = ''; }));
	          syncInputState();
	          try {
	            vscode.postMessage({ type: 'newSession' });
	          } catch {
	            clearPendingActionTimer('sessionAction');
	            sessionActionPending = '';

	          showInputNotice('Failed to request a new session.', { sync: false });
	          syncInputState();
	        }
	      });
	    }

	    if (compactSessionBtn) {
	      compactSessionBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || isComposerRoutingLocked() || sessionActionPending) return;
	          sessionActionPending = 'compactSession';
	          armPendingActionTimer('sessionAction', () => recoverPendingAction('sessionAction', 'Context compaction is taking longer than expected. Controls were re-enabled.', () => { sessionActionPending = ''; }));
	          syncInputState();
	          try {
	            vscode.postMessage({ type: 'compactSession' });
	          } catch {
	            clearPendingActionTimer('sessionAction');
	            sessionActionPending = '';

	          showInputNotice('Failed to request context compaction.', { sync: false });
	          syncInputState();
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
	        showInputNotice('Failed to request stop.', { sync: false });
	        syncInputState();
	        updateOperationBanner();
	        updateApprovalBanner();
	      }
	    }

	    if (operationStopBtn) {
	      operationStopBtn.addEventListener('click', requestAbort);
	    }

	    function setRevertDiscardConfirmVisible(visible) {
	      const visibleFlag = !!visible;
	      if (revertDiscardConfirmVisible === visibleFlag) return;
	      revertDiscardConfirmVisible = visibleFlag;
	      if (revertDiscardConfirm && revertDiscardConfirm.classList) {
	        revertDiscardConfirm.classList.toggle('hidden', !visibleFlag);
	      }
	    }

	    function setRevertDiscardConfirmPending(pending, options) {
	      const wasPending = revertDiscardConfirmPending;
	      const nextPending = !!pending;
	      if (revertDiscardConfirmSynced && wasPending === nextPending) {
	        if (!options || options.sync !== false) syncInputState();
	        return;
	      }
	      revertDiscardConfirmPending = nextPending;
	      revertDiscardConfirmSynced = true;
	      setRevertDiscardConfirmVisible(revertDiscardConfirmPending);
	      setAttributeValue(revertDiscardBtn, 'aria-expanded', revertDiscardConfirmPending ? 'true' : 'false');
	      if (revertDiscardConfirmPending && !wasPending) {
	        focusInlineConfirmationTarget(revertDiscardCancelBtn);
	      } else if (!revertDiscardConfirmPending && wasPending && (!options || options.restoreFocus !== false)) {
	        focusInlineConfirmationTarget(revertDiscardBtn);
	      }
	      if (!options || options.sync !== false) syncInputState();
	    }

	    function requestRevertAction(type, failureMessage, extra) {
	      if (!initReceived || isProcessing || revertActionPending) return false;
	      revertActionPending = type;
	      if (type !== 'discardUndone') setRevertDiscardConfirmPending(false, { sync: false, restoreFocus: false });
	      armPendingActionTimer('revertAction', () => recoverPendingAction('revertAction', 'Revert action is taking longer than expected. Controls were re-enabled.', () => { revertActionPending = ''; }));
	      syncInputState();
	      try {
	        vscode.postMessage({ type, ...(extra && typeof extra === 'object' ? extra : {}) });
	      } catch {
	        clearPendingActionTimer('revertAction');
	        revertActionPending = '';
	        if (failureMessage) showInputNotice(failureMessage, { sync: false });
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
	        setRevertDiscardConfirmPending(false, { sync: false, restoreFocus: false });
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
			        if (!initReceived || isProcessing || isComposerRoutingLocked() || sessionSwitchPending) {
			          setValue(sessionSelect, currentSessionId);
			          return;
			        }
			        if (!next || next === currentSessionId) {
			          setValue(sessionSelect, currentSessionId);
			          return;
			        }
			        setValue(sessionSelect, currentSessionId);
			        sessionSwitchPending = true;
			        armPendingActionTimer('sessionSwitch', () => recoverPendingAction('sessionSwitch', 'Session switch is taking longer than expected. Controls were re-enabled.', () => { sessionSwitchPending = false; }));
			        syncInputState();
        try {
          vscode.postMessage({ type: 'switchSession', sessionId: next });
        } catch {
          clearPendingActionTimer('sessionSwitch');
          sessionSwitchPending = false;
          showInputNotice('Failed to request session switch.', { sync: false });
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
				          setChecked(sessionsPersistToggle, sessionsPersistEnabled);
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
			        if (!initReceived || isProcessing || isComposerRoutingLocked() || sessionActionPending || !action) return;
				        setSessionClearConfirmAction('', { sync: false, restoreFocus: false });
			        sessionActionPending = action;
			        armPendingActionTimer('sessionAction', () => recoverPendingAction('sessionAction', 'Session clear action is taking longer than expected. Controls were re-enabled.', () => { sessionActionPending = ''; }));
			        syncInputState();
			        try {
			          vscode.postMessage({ type: action, confirmed: true });
			        } catch {
			          clearPendingActionTimer('sessionAction');
			          sessionActionPending = '';
				          showInputNotice(action === 'clearSavedSessions' ? 'Failed to request saved-session clear.' : 'Failed to request session clear.', { sync: false });
			          syncInputState();
			        }
			      });
			    }


				    if (sessionsMaxSessionsInput) {
				      sessionsMaxSessionsInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applySessionRetentionLimits();
				      });
				    }

				    if (sessionsMaxSessionBytesInput) {
				      sessionsMaxSessionBytesInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applySessionRetentionLimits();
				      });
				    }

			    if (providerSelect) {
			      providerSelect.addEventListener('change', () => {
			        if (!initReceived || isProcessing || isComposerRoutingLocked() || providerSwitchPending) {
			          setValue(providerSelect, currentProviderId);
			          return;
			        }
			        const next = normalizeProviderId(providerSelect.value);
			        if (next === currentProviderId) return;
			        setValue(providerSelect, currentProviderId);
			        providerSwitchPending = true;
			        armPendingActionTimer('providerSwitch', () => recoverPendingAction('providerSwitch', 'Provider switch is taking longer than expected. Controls were re-enabled.', () => { providerSwitchPending = false; }));
			        syncInputState();
				        try {
				          vscode.postMessage({ type: 'switchProvider', providerId: next });
				        } catch {
				          clearPendingActionTimer('providerSwitch');
				          providerSwitchPending = false;
				          showInputNotice('Failed to request provider switch.', { sync: false });
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

						    for (let providerInputIndex = 0; providerInputIndex < providerSettingsShortcutInputs.length; providerInputIndex++) {
						      const providerInput = providerSettingsShortcutInputs[providerInputIndex];
						      if (!providerInput) continue;
						      providerInput.addEventListener('keydown', (e) => {
					        if (isEnterKey(e)) applyProviderSettings();
					      });
					    }

				    if (openAIModelDisplayNamesInput) {
				      openAIModelDisplayNamesInput.addEventListener('keydown', (e) => {
				        if (isShortcutEnterKey(e)) {
				          e.preventDefault();
				          applyProviderSettings();
				        }
			      });
			    }

			    if (safetySelect) {
			      safetySelect.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('autoApproveState')) {
			          setValue(safetySelect, autoApproveEnabled ? 'auto' : 'ask');
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
			          setChecked(allowExternalPathsToggle, allowExternalPathsEnabled);
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
			          setChecked(blockGitPushToggle, blockGitPushEnabled);
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
			          updateNormalizedDebugSettingsState(debugSettings);
			          return;
			        }
			        applyDebugSettings({ details: !!debugDetailsToggle.checked });
			      });
			    }

			    if (debugLlmToggle) {
			      debugLlmToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || debugSettings.details) {
			          updateNormalizedDebugSettingsState(debugSettings);
			          return;
			        }
			        applyDebugSettings({ llm: !!debugLlmToggle.checked });
			      });
			    }

			    if (debugToolsToggle) {
			      debugToolsToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || debugSettings.details) {
			          updateNormalizedDebugSettingsState(debugSettings);
			          return;
			        }
			        applyDebugSettings({ tools: !!debugToolsToggle.checked });
			      });
			    }

			    if (debugPluginsToggle) {
			      debugPluginsToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || debugSettings.details) {
			          updateNormalizedDebugSettingsState(debugSettings);
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
			          showInputNotice('Failed to request logs.', { sync: false });
			          syncInputState();
			        }
			      });
			    }

		      if (listToolsBtn) {
		        listToolsBtn.addEventListener('click', (e) => {
		          e.preventDefault();
		          if (!initReceived || isProcessing || toolsCatalogRequestPending) return;
		          if (toolsCatalogVisible) {
		            setToolsCatalogSearchQuery('');
		            setValue(toolsCatalogSearchInput, '');
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
          showInputNotice('Failed to request tools list.', { sync: false });
          syncInputState();
        }
		      });
		    }


			    if (runToolBtn) {
			      runToolBtn.addEventListener('click', (e) => {
			        e.preventDefault();
				        if (!initReceived || isProcessing || toolsCatalogRequestPending) return;
				        if (currentToolsCatalog) {
				          updateToolsCatalogState(currentToolsCatalog, { reveal: true });
				          return;
				        }
			        toolsCatalogRequestPending = true;
			        armPendingActionTimer('toolsCatalog', () => recoverPendingAction('toolsCatalog', 'Tool runner is taking longer than expected. Controls were re-enabled.', () => { toolsCatalogRequestPending = false; }));
			        syncInputState();
        try { vscode.postMessage({ type: 'runTool' }); } catch {
          clearPendingActionTimer('toolsCatalog');
          toolsCatalogRequestPending = false;
          showInputNotice('Failed to request tool runner.', { sync: false });
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
          showInputNotice('Failed to request tools config creation.', { sync: false });
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

					    if (autoApprovedToolsList) {
					      autoApprovedToolsList.addEventListener('click', handleAutoApprovedToolsListClick);
					    }

				    if (toolsCatalog) {
				      toolsCatalog.addEventListener('click', handleToolsCatalogClick);
				      toolsCatalog.addEventListener('input', handleToolsCatalogInput);
				    }

							    if (toolsCatalogSearchInput) {
					      toolsCatalogSearchInput.addEventListener('input', () => {
					        if (!setToolsCatalogSearchQuery(toolsCatalogSearchInput.value)) return;
					        scheduleToolsCatalogSearchRender();
					      });
					      toolsCatalogSearchInput.addEventListener('keydown', (e) => {
					        clearSearchInputForEscape(
					          e,
					          toolsCatalogSearchInput,
					          toolsCatalogSearchQuery,
					          setToolsCatalogSearchQuery,
					          () => updateToolsCatalogState(currentToolsCatalog)
					        );
				      });
			    }

						    for (let toolLimitInputIndex = 0; toolLimitInputIndex < toolRuntimeLimitInputs.length; toolLimitInputIndex++) {
						      const toolLimitInput = toolRuntimeLimitInputs[toolLimitInputIndex];
						      if (!toolLimitInput) continue;
						      toolLimitInput.addEventListener('keydown', (e) => {
					        if (isEnterKey(e)) applyToolRuntimeLimits();
					      });
					    }

			    if (pluginsAutoDiscoverToggle) {
			      pluginsAutoDiscoverToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || pluginSettingsPending) {
			          setChecked(pluginsAutoDiscoverToggle, pluginSettings.autoDiscover);
			          return;
			        }
			        applyPluginSettings();
			      });
			    }

				    if (pluginsWorkspaceDirInput) {
				      pluginsWorkspaceDirInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyPluginSettings();
				      });
				    }

				    if (pluginSpecsInput) {
				      pluginSpecsInput.addEventListener('keydown', (e) => {
				        if (isShortcutEnterKey(e)) {
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
				        if (isShortcutEnterKey(e)) {
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
				        if (isShortcutEnterKey(e)) {
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
				        if (isShortcutEnterKey(e)) {
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

					    for (let memoryLimitInputIndex = 0; memoryLimitInputIndex < memoryAdvancedLimitInputs.length; memoryLimitInputIndex++) {
					      const memoryLimitInput = memoryAdvancedLimitInputs[memoryLimitInputIndex];
					      if (!memoryLimitInput) continue;
					      memoryLimitInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyMemoryAdvancedLimits();
				      });
				    }

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
		        setMemoryDropConfirmPending(false, { sync: false, restoreFocus: false });
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
		        setMemoryDropConfirmPending(false, { sync: false, restoreFocus: false });
	        updateMemoryActionStatusState({ state: 'running', message: 'Dropping generated memories…' });
	        try { vscode.postMessage({ type: 'dropMemories', confirmed: true }); } catch {
	          updateMemoryActionStatusState({ state: 'error', message: 'Failed to request memory drop.' });
	        }
	      });
	    }



			    if (thinkingToggle) {
			      thinkingToggle.addEventListener('change', () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('showThinkingState')) {
			          setChecked(thinkingToggle, showThinkingEnabled);
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
			          setChecked(memoriesFeatureToggle, memoriesFeatureEnabled);
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
			          setChecked(memoryAutoRecallToggle, memoryAutoRecallEnabled);
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
				        if (isEnterKey(e)) applyMemoryAutoRecallBudget();
				      });
				    }

				    if (memoryAutoRecallMaxTokensInput) {
				      memoryAutoRecallMaxTokensInput.addEventListener('change', applyMemoryAutoRecallBudget);
				      memoryAutoRecallMaxTokensInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyMemoryAutoRecallBudget();
				      });
				    }

				    if (memoryAutoRecallMinScoreInput) {
				      memoryAutoRecallMinScoreInput.addEventListener('change', applyMemoryAutoRecallFilters);
				      memoryAutoRecallMinScoreInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyMemoryAutoRecallFilters();
				      });
				    }

				    if (memoryAutoRecallMinScoreGapInput) {
				      memoryAutoRecallMinScoreGapInput.addEventListener('change', applyMemoryAutoRecallFilters);
				      memoryAutoRecallMinScoreGapInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyMemoryAutoRecallFilters();
				      });
				    }

				    if (memoryAutoRecallMaxAgeDaysInput) {
				      memoryAutoRecallMaxAgeDaysInput.addEventListener('change', applyMemoryAutoRecallFilters);
				      memoryAutoRecallMaxAgeDaysInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyMemoryAutoRecallFilters();
				      });
				    }

				    if (explorePrepassToggle) {
				      explorePrepassToggle.addEventListener('change', () => {
				        if (!initReceived || isProcessing || hasPendingSettingState('explorePrepassState')) {
				          setChecked(explorePrepassToggle, explorePrepassEnabled);
				          return;
				        }
			        const enabled = !!explorePrepassToggle.checked;
			        if (enabled === explorePrepassEnabled) return;
			        postSettingWithPendingState(
			          'explorePrepassState',
			          { type: 'setExplorePrepass', enabled },
			          () => updateNormalizedExplorePrepassState(explorePrepassEnabled, explorePrepassMaxChars)
			        );
			      });
			    }

			    if (explorePrepassMaxCharsInput) {
			      const applyExplorePrepassMaxChars = () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('explorePrepassState')) {
			          updateNormalizedExplorePrepassState(explorePrepassEnabled, explorePrepassMaxChars);
			          clearInvalidFields([explorePrepassMaxCharsInput]);
			          return;
			        }
				        const maxChars = Number(explorePrepassMaxCharsInput.value);
				        if (!validateNumberField(explorePrepassMaxCharsInput, maxChars, 500, 'Explore prepass max characters must be at least 500.')) return;
				        clearInvalidFields([explorePrepassMaxCharsInput]);
				        const normalizedMaxChars = Math.floor(maxChars);
				        if (normalizedMaxChars === explorePrepassMaxChars) {
				          updateNormalizedExplorePrepassState(explorePrepassEnabled, explorePrepassMaxChars);
				          return;
				        }
				        postSettingWithPendingState(
				          'explorePrepassState',
				          { type: 'setExplorePrepassMaxChars', maxChars: normalizedMaxChars },
				          () => updateNormalizedExplorePrepassState(explorePrepassEnabled, explorePrepassMaxChars)
				        );
				      };
				      explorePrepassMaxCharsInput.addEventListener('change', applyExplorePrepassMaxChars);
				      explorePrepassMaxCharsInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyExplorePrepassMaxChars();
				      });
				    }

			    if (subagentModelOverrideInput) {
			      const applySubagentModelOverride = () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('subagentModelOverrideState')) {
			          updateNormalizedSubagentModelOverrideState(subagentModelOverride);
			          return;
				        }
				        const model = (subagentModelOverrideInput.value || '').trim().slice(0, 200);
				        if (model === subagentModelOverride) {
				          updateNormalizedSubagentModelOverrideState(subagentModelOverride);
				          return;
				        }
				        postSettingWithPendingState(
				          'subagentModelOverrideState',
				          { type: 'setSubagentModelOverride', model },
			          () => updateNormalizedSubagentModelOverrideState(subagentModelOverride)
			        );
				      };
				      subagentModelOverrideInput.addEventListener('change', applySubagentModelOverride);
				      subagentModelOverrideInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applySubagentModelOverride();
				      });
				    }

			    if (subagentTaskMaxOutputCharsInput) {
			      const applySubagentTaskMaxOutputChars = () => {
			        if (!initReceived || isProcessing || hasPendingSettingState('subagentTaskMaxOutputCharsState')) {
			          updateNormalizedSubagentTaskMaxOutputCharsState(subagentTaskMaxOutputChars);
			          clearInvalidFields([subagentTaskMaxOutputCharsInput]);
			          return;
			        }
				        const maxChars = Number(subagentTaskMaxOutputCharsInput.value);
				        if (!validateNumberField(subagentTaskMaxOutputCharsInput, maxChars, 500, 'Task subagent max output characters must be at least 500.')) return;
				        clearInvalidFields([subagentTaskMaxOutputCharsInput]);
				        const normalizedMaxChars = Math.floor(maxChars);
				        if (normalizedMaxChars === subagentTaskMaxOutputChars) {
				          updateNormalizedSubagentTaskMaxOutputCharsState(subagentTaskMaxOutputChars);
				          return;
				        }
				        postSettingWithPendingState(
				          'subagentTaskMaxOutputCharsState',
				          { type: 'setSubagentTaskMaxOutputChars', maxChars: normalizedMaxChars },
				          () => updateNormalizedSubagentTaskMaxOutputCharsState(subagentTaskMaxOutputChars)
				        );
				      };
				      subagentTaskMaxOutputCharsInput.addEventListener('change', applySubagentTaskMaxOutputChars);
				      subagentTaskMaxOutputCharsInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applySubagentTaskMaxOutputChars();
				      });
				    }

				    if (autoCompactionToggle) {
				      autoCompactionToggle.addEventListener('change', () => {
				        if (!initReceived || isProcessing || hasPendingSettingState('autoCompactionState')) {
				          setChecked(autoCompactionToggle, autoCompactionEnabled);
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
				        if (isShortcutEnterKey(e)) {
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
				          setChecked(compactionPruneToggle, compactionPruneEnabled);
				          return;
				        }
			        applyCompactionPruneSettings();
			      });
			    }

				    if (compactionPruneProtectTokensInput) {
				      compactionPruneProtectTokensInput.addEventListener('change', applyCompactionPruneSettings);
				      compactionPruneProtectTokensInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyCompactionPruneSettings();
				      });
				    }

				    if (compactionPruneMinimumTokensInput) {
				      compactionPruneMinimumTokensInput.addEventListener('change', applyCompactionPruneSettings);
				      compactionPruneMinimumTokensInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyCompactionPruneSettings();
				      });
				    }

				    if (compactionToolOutputModeSelect) {
				      compactionToolOutputModeSelect.addEventListener('change', () => {
				        if (!initReceived || isProcessing || hasPendingSettingState('compactionToolOutputModeState')) {
				          setValue(compactionToolOutputModeSelect, compactionToolOutputMode);
				          return;
				        }
			        const mode = normalizeCompactionToolOutputMode(compactionToolOutputModeSelect.value);
			        if (mode === compactionToolOutputMode) return;
			        postSettingWithPendingState(
			          'compactionToolOutputModeState',
			          { type: 'setCompactionToolOutputMode', mode },
				          () => updateNormalizedCompactionToolOutputModeState(compactionToolOutputMode)
			        );
			      });
			    }

				    if (planFirstToggle) {
				      planFirstToggle.addEventListener('change', () => {
				        if (!initReceived || isProcessing || hasPendingSettingState('planFirstState')) {
				          setChecked(planFirstToggle, planFirstEnabled);
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
				      modelPicker.addEventListener('click', (e) => {
				        e.preventDefault();
				        e.stopPropagation();
				        if (!initReceived || isProcessing || isComposerRoutingLocked() || modelSwitchPending || modelFavoritePending || modelPickerOpenPending) return;
				        if (currentModelPickerState) {
				          updateModelPickerState(currentModelPickerState, { reveal: true });
				          return;
			        }
			        modelPickerOpenPending = true;
			        armPendingActionTimer('modelPickerOpen', () => recoverPendingAction('modelPickerOpen', 'Model picker is taking longer than expected. Controls were re-enabled.', () => { modelPickerOpenPending = false; }));
			        syncInputState();
			        try {
			          vscode.postMessage({ type: 'showModelPicker' });
			        } catch {
			          clearPendingActionTimer('modelPickerOpen');
			          modelPickerOpenPending = false;
			          showInputNotice('Failed to request model picker.', { sync: false });
			          syncInputState();
			        }
			      });
			    }

			    if (modelPickerList) {
			      modelPickerList.addEventListener('click', handleModelPickerListClick);
			    }

				    if (reasoningEffortSelect) {
				      reasoningEffortSelect.addEventListener('change', () => {
				        if (!initReceived || isProcessing || isComposerRoutingLocked() || reasoningEffortPending) {
				          setValue(reasoningEffortSelect, currentReasoningEffort);
				          return;
				        }
				        const next = reasoningEffortSelect.value;
				        if (next === currentReasoningEffort) return;
				        setValue(reasoningEffortSelect, currentReasoningEffort);
				        reasoningEffortPending = true;
				        armPendingActionTimer('reasoningEffort', () => recoverPendingAction('reasoningEffort', 'Reasoning effort update is taking longer than expected. Controls were re-enabled.', () => { reasoningEffortPending = false; setValue(reasoningEffortSelect, currentReasoningEffort); }));
			        syncInputState();
				        try {
				          vscode.postMessage({ type: 'setReasoningEffort', reasoningEffort: next });
				        } catch {
				          clearPendingActionTimer('reasoningEffort');
				          reasoningEffortPending = false;
				          showInputNotice('Failed to update reasoning effort.', { sync: false });
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
				          showInputNotice('Failed to update favorite model.', { sync: false });
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
				        if (isEnterKey(e)) {
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
				          showInputNotice('Failed to refresh models.', { sync: false });
				          syncInputState();
				        }
			      });
			    }

					    if (modelPickerSearchInput) {
					      modelPickerSearchInput.addEventListener('input', () => {
					        if (!setModelPickerSearchQuery(modelPickerSearchInput.value)) return;
					        scheduleModelPickerSearchRender();
					      });
					      modelPickerSearchInput.addEventListener('keydown', (e) => {
					        clearSearchInputForEscape(
					          e,
					          modelPickerSearchInput,
					          modelPickerSearchQuery,
					          setModelPickerSearchQuery,
					          () => updateModelPickerState(currentModelPickerState, { reveal: !modelPickerList || modelPickerListVisible })
					        );
				      });
			    }

				    if (modelClearRecents) {
				      modelClearRecents.addEventListener('click', (e) => {
				        e.preventDefault();
				        if (!initReceived || isProcessing || modelPickerRefreshPending || modelSwitchPending || modelFavoritePending || !hasRecentModelsForPicker()) return;
				        modelPickerRefreshPending = true;
				        armPendingActionTimer('modelPickerRefresh', () => recoverPendingAction('modelPickerRefresh', 'Clearing recent models is taking longer than expected. Controls were re-enabled.', () => { modelPickerRefreshPending = false; }));
				        syncInputState();
				        try { vscode.postMessage({ type: 'clearRecentModels' }); } catch {
				          clearPendingActionTimer('modelPickerRefresh');
				          modelPickerRefreshPending = false;
				          showInputNotice('Failed to clear recent models.', { sync: false });
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
			          showInputNotice('Failed to request advanced model settings.', { sync: false });
			          syncInputState();
			        }
			      });
			    }

				    if (temperatureInput) {
				      temperatureInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyGenerationSettings();
				      });
				    }

				    if (topPInput) {
				      topPInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyGenerationSettings();
				      });
				    }

				    if (topKInput) {
				      topKInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyGenerationSettings();
				      });
				    }

				    if (maxOutputTokensInput) {
				      maxOutputTokensInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyGenerationSettings();
				      });
				    }

				    if (maxIterationsInput) {
				      maxIterationsInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyGenerationSettings();
				      });
				    }

				    if (maxRetriesInput) {
				      maxRetriesInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyGenerationSettings();
				      });
				    }

				    if (llmTimeoutInput) {
				      llmTimeoutInput.addEventListener('keydown', (e) => {
				        if (isEnterKey(e)) applyGenerationSettings();
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
			          showInputNotice('Failed to request provider authentication.', { sync: false });
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
			          showInputNotice('Failed to request provider disconnect.', { sync: false });
			          updateProviderAuthHeader(currentProviderAuth);
			          syncInputState();
			        }
			      });
			    }

	    const IMAGE_ATTACHMENT_MEDIA_EXT_UNSAFE_RE = /[^a-z0-9.+-]/g;
	    const IMAGE_ATTACHMENT_DECIMAL_ZERO_SUFFIX_RE = /\.0$/;

	    function inferImageFileName(mediaType, fallbackName) {
      const trimmed = typeof fallbackName === 'string' ? fallbackName.trim() : '';
      if (trimmed) return trimmed;
      const type = typeof mediaType === 'string' ? mediaType.trim().toLowerCase() : '';
      const slash = type.indexOf('/');
	      const ext = slash >= 0 ? type.slice(slash + 1).replace(IMAGE_ATTACHMENT_MEDIA_EXT_UNSAFE_RE, '') : '';
      return ext ? ('image.' + ext) : 'image.png';
    }

	    function getImageAttachmentDisplayFileName(filename) {
	      const value = String(filename === undefined || filename === null ? '' : filename);
	      return value.length <= IMAGE_ATTACHMENT_FILENAME_DISPLAY_LIMIT
	        ? value
	        : value.slice(0, IMAGE_ATTACHMENT_FILENAME_DISPLAY_LIMIT) + '…';
	    }

	    function getImageAttachmentDisplayMeta(meta) {
	      const value = String(meta === undefined || meta === null ? '' : meta);
	      return value.length <= IMAGE_ATTACHMENT_META_DISPLAY_LIMIT
	        ? value
	        : value.slice(0, IMAGE_ATTACHMENT_META_DISPLAY_LIMIT) + '…';
	    }

    function formatImageAttachmentSize(size) {
      const value = Number(size);
      if (!Number.isFinite(value) || value <= 0) return '';
      if (value < 1024) return String(Math.round(value)) + ' B';
      if (value < 1024 * 1024) return String(Math.round(value / 1024)) + ' KB';
      const mb = value / (1024 * 1024);
	      return mb.toFixed(mb >= 10 ? 0 : 1).replace(IMAGE_ATTACHMENT_DECIMAL_ZERO_SUFFIX_RE, '') + ' MB';
    }

    function formatImageAttachmentMeta(attachment) {
      const mediaType = typeof attachment.mediaType === 'string' ? attachment.mediaType.trim() : '';
      const size = formatImageAttachmentSize(attachment.size);
      const meta = mediaType && size ? mediaType + ' · ' + size : (mediaType || size);
      return getImageAttachmentDisplayMeta(meta);
    }

	    function getImageFileMediaType(file) {
	      const mediaType = file && typeof file.type === 'string' ? file.type.trim() : '';
	      if (mediaType) return mediaType;
	      if (!file || (typeof file !== 'object' && typeof file !== 'function')) return '';
	      const fallback = imageFileMediaTypeFallbackByFile.get(file);
	      return typeof fallback === 'string' ? fallback : '';
	    }

	    function rememberImageFileMediaTypeFallback(file, mediaType) {
	      const trimmed = typeof mediaType === 'string' ? mediaType.trim() : '';
	      if (!trimmed || !startsWithImageMediaType(trimmed)) return;
	      if (!file || (typeof file !== 'object' && typeof file !== 'function')) return;
	      if (file && typeof file.type === 'string' && file.type.trim()) return;
	      imageFileMediaTypeFallbackByFile.set(file, trimmed);
	    }

	    function startsWithImageMediaType(mediaType) {
	      const value = typeof mediaType === 'string' ? mediaType : '';
	      return value.length >= 6 &&
	        (value[0] === 'i' || value[0] === 'I') &&
	        (value[1] === 'm' || value[1] === 'M') &&
	        (value[2] === 'a' || value[2] === 'A') &&
	        (value[3] === 'g' || value[3] === 'G') &&
	        (value[4] === 'e' || value[4] === 'E') &&
	        value[5] === '/';
	    }

	    function isImageFile(file) {
	      return startsWithImageMediaType(getImageFileMediaType(file));
	    }

	    function isImageFileTooLargeBeforeRead(file) {
	      const size = file && Number(file.size);
	      if (!Number.isFinite(size) || size <= 0) return false;
	      const mediaType = getImageFileMediaType(file);
	      const projectedDataUrlLength = 'data:'.length + mediaType.length + ';base64,'.length + (Math.ceil(size / 3) * 4);
	      return projectedDataUrlLength > MAX_IMAGE_DATA_URL_CHARS;
	    }

	    function normalizeImageAttachmentDataUrl(dataUrl, mediaType) {
	      const trimmed = typeof dataUrl === 'string' ? dataUrl.trim() : '';
	      if (/^data:image\//i.test(trimmed)) return trimmed;
	      if (!startsWithImageMediaType(mediaType)) return '';
	      const comma = trimmed.indexOf(',');
	      if (comma < 0) return '';
	      if (!/^data:;base64$/i.test(trimmed.slice(0, comma))) return '';
	      return 'data:' + mediaType + ';base64,' + trimmed.slice(comma + 1);
	    }

    function showInputNotice(message, options) {
      const nextNoticeMessage = typeof message === 'string' ? message.trim() : '';
      const noticeChanged = inputNoticeMessage !== nextNoticeMessage;
      inputNoticeMessage = nextNoticeMessage;
      clearInputNoticeTimer();
      if (inputNoticeMessage) {
        if (noticeChanged) announceStatus(inputNoticeMessage);
        const timer = setTimeout(() => {
          if (inputNoticeTimer !== timer) return;
          inputNoticeMessage = '';
          inputNoticeTimer = null;
          syncComposerInputState();
        }, INPUT_NOTICE_DURATION_MS);
        inputNoticeTimer = timer;
      }
      if (noticeChanged && (!options || options.sync !== false)) syncComposerInputState();
    }

    function clearInputNoticeTimer() {
      if (!inputNoticeTimer) return;
      clearTimeout(inputNoticeTimer);
      inputNoticeTimer = null;
    }

    function clearInputNotice(options) {
      const hadNotice = !!inputNoticeMessage;
      clearInputNoticeTimer();
      inputNoticeMessage = '';
      if (hadNotice && (!options || options.sync !== false)) syncComposerInputState();
    }

	    function getInputAttachmentsRenderKey() {
	      const key = createCompactRenderStateKeyBuilder();
	      appendCompactRenderStateKeyPart(key, pendingImageAttachments.length);
	      for (let i = 0; i < pendingImageAttachments.length; i++) {
	        const attachment = pendingImageAttachments[i];
	        appendCompactRenderStateKeyPart(key, attachment && attachment.id);
	        appendCompactRenderStateKeyPart(key, attachment && attachment.mediaType);
	        appendCompactRenderStateKeyPart(key, attachment && attachment.filename);
	        appendCompactRenderStateKeyPart(key, attachment && attachment.size);
	        appendCompactRenderStateKeyPart(key, attachment && attachment.dataUrl ? attachment.dataUrl.length : 0);
	      }
	      return finishCompactRenderStateKey(key);
	    }

    function setInputAttachmentsVisible(visible) {
      if (!inputAttachments) return;
      const visibleFlag = !!visible;
      if (inputAttachmentsVisible === visibleFlag) return;
      inputAttachmentsVisible = visibleFlag;
      if (inputAttachments.classList) {
        inputAttachments.classList.toggle('hidden', !visibleFlag);
      }
    }

    function renderInputAttachments() {
      if (!inputAttachments) return;
      const nextRenderKey = getInputAttachmentsRenderKey();
      if (nextRenderKey === lastInputAttachmentsRenderKey) return;
      lastInputAttachmentsRenderKey = nextRenderKey;

      if (!pendingImageAttachments.length) {
        setInputAttachmentsVisible(false);
        replaceElementChildren(inputAttachments);
        return;
      }

      const fragment = pendingImageAttachments.length > 1 ? document.createDocumentFragment() : null;
      let singleChip = null;
      setInputAttachmentsVisible(true);
      for (let i = 0; i < pendingImageAttachments.length; i++) {
        const attachment = pendingImageAttachments[i];
        const filename = inferImageFileName(attachment.mediaType, attachment.filename);
        const displayFilename = getImageAttachmentDisplayFileName(filename);
        const meta = formatImageAttachmentMeta(attachment);

        const chip = document.createElement('div');
        chip.className = 'input-attachment-chip';
        chip.setAttribute('role', 'listitem');
        chip.title = displayFilename + (meta ? ' · ' + meta : '');

        const thumb = document.createElement('img');
        thumb.className = 'input-attachment-thumb';
        thumb.src = attachment.dataUrl;
        thumb.alt = '';
        thumb.loading = 'lazy';
        chip.appendChild(thumb);

        const detail = document.createElement('span');
        detail.className = 'input-attachment-detail';

        const label = document.createElement('span');
        label.className = 'input-attachment-label';
        label.textContent = displayFilename;
        detail.appendChild(label);

        if (meta) {
          const metaEl = document.createElement('span');
          metaEl.className = 'input-attachment-meta';
          metaEl.textContent = meta;
          detail.appendChild(metaEl);
        }

        chip.appendChild(detail);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'input-attachment-remove';
        inputAttachmentIdByRemoveButton.set(removeBtn, attachment.id);
        const removeLabel = 'Remove image attachment: ' + displayFilename;
        removeBtn.setAttribute('aria-label', removeLabel);
        removeBtn.title = removeLabel;
        const removeIcon = document.createElement('span');
        removeIcon.setAttribute('aria-hidden', 'true');
        removeIcon.textContent = '✕';
        removeBtn.appendChild(removeIcon);
        chip.appendChild(removeBtn);

        if (fragment) {
          fragment.appendChild(chip);
        } else {
          singleChip = chip;
        }
      }

      replaceElementChildren(inputAttachments, fragment || singleChip);
    }

    function serializePendingImageAttachments() {
      if (!pendingImageAttachments.length) return [];
      const attachments = new Array(pendingImageAttachments.length);
      for (let i = 0; i < pendingImageAttachments.length; i++) {
        const attachment = pendingImageAttachments[i];
        const serialized = {
          mediaType: attachment.mediaType,
          dataUrl: attachment.dataUrl,
        };
        if (attachment.filename) serialized.filename = attachment.filename;
        attachments[i] = serialized;
      }
      return attachments;
    }

    function postPendingImageAttachmentsState() {
      try {
        vscode.postMessage({
          type: 'composerAttachmentsState',
          attachments: serializePendingImageAttachments(),
        });
      } catch {}
    }

    function restorePendingImageAttachments(raw) {
      if (composerAttachmentsHydrated) return false;
      composerAttachmentsHydrated = true;
      const source = Array.isArray(raw) ? raw : [];
      const restored = [];
      for (let i = 0; i < source.length && restored.length < MAX_IMAGE_ATTACHMENTS; i++) {
        const attachment = source[i];
        if (!attachment || typeof attachment !== 'object') continue;
        const mediaType = typeof attachment.mediaType === 'string' ? attachment.mediaType.trim() : '';
        if (!startsWithImageMediaType(mediaType)) continue;
        const dataUrl = normalizeImageAttachmentDataUrl(attachment.dataUrl, mediaType);
        if (!dataUrl || dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) continue;
        restored.push({
          id: String(Date.now()) + '_' + restored.length + '_' + Math.random().toString(16).slice(2),
          mediaType,
          filename: typeof attachment.filename === 'string'
            ? attachment.filename.slice(0, MAX_IMAGE_ATTACHMENT_FILENAME_CHARS)
            : '',
          size: 0,
          dataUrl,
        });
      }
      pendingImageAttachments = restored;
      renderInputAttachments();
      return restored.length > 0;
    }

    function clearPendingImageAttachments(options) {
      if (!pendingImageAttachments.length) return;
      pendingImageAttachments = [];
      clearInputNotice({ sync: false });
      renderInputAttachments();
      if (!options || options.syncExtension !== false) postPendingImageAttachmentsState();
    }

    function removePendingImageAttachmentById(attachmentId) {
      if (!attachmentId) return;
      for (let i = 0; i < pendingImageAttachments.length; i++) {
        if (pendingImageAttachments[i].id !== attachmentId) continue;
        pendingImageAttachments.splice(i, 1);
        clearInputNotice({ sync: false });
        renderInputAttachments();
        postPendingImageAttachmentsState();
        return;
      }
    }

    function createComposerSubmissionId() {
      return 'composer-' + String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    }

    function composerAttachmentsMatch(left, right) {
      return !!left && !!right &&
        left.id === right.id &&
        left.mediaType === right.mediaType &&
        left.filename === right.filename &&
        left.dataUrl === right.dataUrl;
    }

    function mergeComposerSubmissionAttachments(submitted) {
      const source = Array.isArray(submitted) ? submitted : [];
      const current = pendingImageAttachments.slice();
      const merged = [];
      const appendUnique = (attachment) => {
        if (!attachment || merged.length >= MAX_IMAGE_ATTACHMENTS) return;
        for (let i = 0; i < merged.length; i++) {
          if (composerAttachmentsMatch(merged[i], attachment)) return;
        }
        merged.push(attachment);
      };
      for (let i = 0; i < source.length; i++) appendUnique(source[i]);
      for (let i = 0; i < current.length; i++) appendUnique(current[i]);
      return merged;
    }

    function mergeRejectedComposerDraft(submittedDraft, currentDraft) {
      const submitted = String(submittedDraft || '');
      const current = String(currentDraft || '');
      if (!submitted) return current;
      if (!current || current === submitted || current.startsWith(submitted + '\n\n')) {
        return current || submitted;
      }
      return submitted + '\n\n' + current;
    }

    function postComposerSubmissionSettled(submissionId) {
      if (!submissionId) return;
      try {
        vscode.postMessage({
          type: 'composerSubmissionSettled',
          submissionId,
        });
      } catch {}
    }

    function handleComposerSubmissionTimeout() {
      if (!pendingComposerSubmission) return;
      showInputNotice('Message acceptance is taking longer than expected. Your draft is still saved.', {
        sync: false,
      });
      syncComposerInputState();
    }

    function restoreRejectedComposerSubmission(submission, message) {
      if (!submission || !submission.id) return false;
      clearPendingActionTimer('composerSubmission');
      pendingComposerSubmission = null;
      persistComposerSubmissionId('');

      const currentDraft = input ? String(input.value || '') : '';
      const restoredDraft = mergeRejectedComposerDraft(submission.rawText, currentDraft);
      if (input && input.value !== restoredDraft) {
        input.value = restoredDraft;
        updateInputLayout({ clearButton: false, persistDraft: false });
      }

      pendingImageAttachments = mergeComposerSubmissionAttachments(submission.attachments);
      clearInputNotice({ sync: false });
      renderInputAttachments();
      postPendingImageAttachmentsState();
      persistComposerDraftStateNow();
      showInputNotice(message || 'Message was not accepted. Your draft was restored.', { sync: false });
      syncInputState();
      focusComposerInput();
      postComposerSubmissionSettled(submission.id);
      return true;
    }

    function acceptComposerSubmission(submission) {
      if (!submission || !submission.id) return false;
      clearPendingActionTimer('composerSubmission');
      pendingComposerSubmission = null;
      persistComposerSubmissionId('');

      if (
        submission.reconstructed &&
        input &&
        String(input.value || '') === String(submission.rawText || '')
      ) {
        input.value = '';
        updateInputLayout({ clearButton: false, persistDraft: false });
      }

      clearPendingImageAttachments({ syncExtension: false });
      persistComposerDraftStateNow();
      clearInputNotice({ sync: false });
      syncInputState();
      postComposerSubmissionSettled(submission.id);
      return true;
    }

    function applyComposerSubmissionState(rawState) {
      const state = rawState && typeof rawState === 'object' ? rawState : null;
      if (!state) return false;
      const submissionId = typeof state.submissionId === 'string'
        ? state.submissionId
        : (typeof state.id === 'string' ? state.id : '');
      const status = typeof state.status === 'string' ? state.status : '';
      if (!submissionId || !status) return false;

      const persistedSubmissionId = readPersistedComposerSubmissionId();
      const liveSubmission = pendingComposerSubmission && pendingComposerSubmission.id === submissionId
        ? pendingComposerSubmission
        : null;
      if (!liveSubmission && persistedSubmissionId !== submissionId) {
        if (status === 'accepted' || status === 'rejected') {
          postComposerSubmissionSettled(submissionId);
        }
        return false;
      }

      const draft = typeof state.draft === 'string'
        ? state.draft
        : (liveSubmission ? liveSubmission.rawText : '');

      if (status === 'pending') {
        if (liveSubmission) {
          liveSubmission.received = true;
          clearPendingActionTimer('composerSubmission');
          armPendingActionTimer('composerSubmission', handleComposerSubmissionTimeout);
          return true;
        }

        const reconstructed = {
          id: submissionId,
          rawText: draft,
          attachments: pendingImageAttachments.slice(),
          reconstructed: true,
          received: true,
        };
        pendingComposerSubmission = reconstructed;
        if (input && String(input.value || '') === draft) {
          input.value = '';
          updateInputLayout({ clearButton: false, persistDraft: false });
        }
        clearPendingImageAttachments({ syncExtension: false });
        armPendingActionTimer('composerSubmission', handleComposerSubmissionTimeout);
        syncInputState();
        return true;
      }

      const submission = liveSubmission || {
        id: submissionId,
        rawText: draft,
        attachments: pendingImageAttachments.slice(),
        reconstructed: true,
      };
      if (status === 'accepted') {
        return acceptComposerSubmission(submission);
      }
      if (status === 'rejected') {
        const rejectionMessage = typeof state.message === 'string' ? state.message : '';
        return restoreRejectedComposerSubmission(submission, rejectionMessage);
      }
      return false;
    }

    function reconcileComposerSubmissionState(rawState) {
      if (rawState && typeof rawState === 'object' && applyComposerSubmissionState(rawState)) {
        return true;
      }
      const submissionId = readPersistedComposerSubmissionId();
      if (!submissionId) return false;
      const submission = pendingComposerSubmission || {
        id: submissionId,
        rawText: input ? String(input.value || '') : '',
        attachments: pendingImageAttachments.slice(),
        reconstructed: true,
      };
      return restoreRejectedComposerSubmission(
        submission,
        'The previous message was not confirmed. Your draft was restored.'
      );
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        let reader = null;
        let timeoutId = null;
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (reader) {
            reader.onload = null;
            reader.onerror = null;
            reader.onabort = null;
          }
          if (error) {
            reject(error);
          } else {
            resolve(value);
          }
        };

        try {
          reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              finish(null, reader.result);
            } else {
              finish(new Error('Image read failed'));
            }
          };
          reader.onerror = () => finish(reader.error || new Error('Image read failed'));
          reader.onabort = () => finish(new Error('Image read timed out'));
          timeoutId = setTimeout(() => {
            try {
              if (reader && typeof reader.abort === 'function') reader.abort();
            } catch {}
            finish(new Error('Image read timed out'));
          }, IMAGE_ATTACHMENT_READ_TIMEOUT_MS);
          reader.readAsDataURL(file);
        } catch (err) {
          finish(err);
        }
      });
    }

    function setInputImageDragActive(active) {
      const activeFlag = !!active;
      if (inputImageDragActive === activeFlag) return;
      inputImageDragActive = activeFlag;
      if (inputComposer && inputComposer.classList) {
        inputComposer.classList.toggle('drag-over', activeFlag);
      }
    }

    function hasInputImageDragActiveState() {
      return inputImageDragActive;
    }

    function clearInputImageDragState() {
      inputImageDragDepth = 0;
      setInputImageDragActive(false);
    }

    function getArrayLikeLength(list) {
      if (!list) return 0;
      const length = Number(list.length);
      if (!Number.isFinite(length) || length <= 0) return 0;
      return Math.floor(length);
    }

    function getArrayLikeItem(list, index) {
      if (!list) return undefined;
      const indexed = list[index];
      if (indexed !== undefined) return indexed;
      if (typeof list.item === 'function') {
        try { return list.item(index); } catch {}
      }
      return undefined;
    }

    function copyArrayLike(list) {
      const length = getArrayLikeLength(list);
      const copy = [];
      for (let i = 0; i < length; i++) {
        copy.push(getArrayLikeItem(list, i));
      }
      return copy;
    }

    function collectImageFilesFromItems(items) {
      const files = [];
      let skippedUnreadable = 0;
      const itemCount = getArrayLikeLength(items);
      for (let i = 0; i < itemCount; i++) {
        const item = getArrayLikeItem(items, i);
        if (!item || item.kind !== 'file') continue;
        const mediaType = typeof item.type === 'string' ? item.type.trim() : '';
        if (mediaType && !startsWithImageMediaType(mediaType)) continue;
        const file = item.getAsFile ? item.getAsFile() : null;
        if (!file) {
          skippedUnreadable += 1;
          continue;
        }
        if (mediaType) rememberImageFileMediaTypeFallback(file, mediaType);
        if (!mediaType && !isImageFile(file)) {
          skippedUnreadable += 1;
          continue;
        }
        files.push(file);
      }
      return { files, skippedUnreadable };
    }

    function hasImageTransfer(dataTransfer) {
      if (!dataTransfer) return false;
	      const items = dataTransfer.items;
	      const itemCount = getArrayLikeLength(items);
	      for (let i = 0; i < itemCount; i++) {
	        const item = getArrayLikeItem(items, i);
	        const type = item && typeof item.type === 'string' ? item.type.trim() : '';
	        if (item && item.kind === 'file' && (!type || startsWithImageMediaType(type))) {
	          return true;
	        }
	      }

      const files = dataTransfer.files;
      const fileCount = getArrayLikeLength(files);
      for (let i = 0; i < fileCount; i++) {
        if (isImageFile(getArrayLikeItem(files, i))) return true;
      }
      return false;
    }

    function isComposerRoutingLocked() {
      return !!pendingComposerSubmission || pendingImageAttachmentOperations > 0;
    }

    async function attachImageFiles(files, options) {
      if (!initReceived || pendingComposerSubmission) return;
      pendingImageAttachmentOperations += 1;
      try {
        clearInputNotice({ sync: false });
        syncInputState();
        await attachImageFilesInternal(files, options);
      } finally {
        pendingImageAttachmentOperations = Math.max(0, pendingImageAttachmentOperations - 1);
        syncInputState();
      }
    }

    async function attachImageFilesInternal(files, options) {
      const opts = options || {};
      const source = opts.source === 'pasted' ? 'pasted' : opts.source === 'dropped' ? 'dropped' : 'selected';
      let skippedUnreadable = Number.isFinite(opts.skippedUnreadable) ? opts.skippedUnreadable : 0;
      const fileCount = getArrayLikeLength(files);
      const slotsLeft = MAX_IMAGE_ATTACHMENTS - pendingImageAttachments.length;
      let imageCount = 0;
      let attachedCount = 0;
      let skippedForLimit = 0;
      let skippedTooLarge = 0;
      for (let i = 0; i < fileCount; i++) {
        const file = getArrayLikeItem(files, i);
        if (!file || !isImageFile(file)) {
          skippedUnreadable += 1;
          continue;
        }
        imageCount += 1;
        if (slotsLeft <= 0) continue;
        if (attachedCount >= slotsLeft) {
          skippedForLimit += 1;
          continue;
        }
        if (isImageFileTooLargeBeforeRead(file)) {
          skippedTooLarge += 1;
          continue;
        }

        const mediaType = getImageFileMediaType(file);

        let dataUrl = '';
        try {
          dataUrl = String(await readFileAsDataUrl(file));
        } catch {
          skippedUnreadable += 1;
          continue;
        }

        const trimmedData = normalizeImageAttachmentDataUrl(dataUrl, mediaType);
        if (!trimmedData) {
          skippedUnreadable += 1;
          continue;
        }
        if (trimmedData.length > MAX_IMAGE_DATA_URL_CHARS) {
          skippedTooLarge += 1;
          continue;
        }

        if (pendingImageAttachments.length >= MAX_IMAGE_ATTACHMENTS) {
          skippedForLimit += 1;
          continue;
        }

        pendingImageAttachments.push({
          id: String(Date.now()) + '_' + Math.random().toString(16).slice(2),
          mediaType,
          filename: typeof file.name === 'string' ? file.name : '',
          size: Number.isFinite(file.size) ? file.size : 0,
          dataUrl: trimmedData,
        });
        attachedCount += 1;
      }

      if (!imageCount) {
        if (skippedUnreadable > 0) showInputNotice(opts.noImagesMessage || 'Only image files can be attached.');
        return;
      }

      if (slotsLeft <= 0) {
        showInputNotice('Image limit reached (' + MAX_IMAGE_ATTACHMENTS + '). Remove an image before attaching more.');
        return;
      }

      if (!attachedCount) {
        if (skippedTooLarge > 0) {
          showInputNotice('Image is too large. Use an image under about ' + Math.floor(MAX_IMAGE_DATA_URL_CHARS / 1000000) + ' MB.');
        } else if (source === 'pasted') {
          showInputNotice('Could not read pasted image from the clipboard.');
        } else {
          showInputNotice('Could not read image file.');
        }
        return;
      }

      renderInputAttachments();
      postPendingImageAttachmentsState();

      if (skippedForLimit > 0 || skippedTooLarge > 0 || skippedUnreadable > 0) {
        const skipped = skippedForLimit + skippedTooLarge + skippedUnreadable;
        showInputNotice('Attached ' + attachedCount + ' image' + (attachedCount === 1 ? '' : 's') + '; skipped ' + skipped + '.', { sync: false });
      } else {
        showInputNotice('Attached ' + attachedCount + ' image' + (attachedCount === 1 ? '' : 's') + '.', { sync: false });
      }
    }

    async function handleClipboardPaste(e) {
      if (!initReceived) return;

      const items = e && e.clipboardData ? e.clipboardData.items : null;
      const itemCount = getArrayLikeLength(items);
      if (!itemCount) return;

      const imageItems = collectImageFilesFromItems(items);
      if (!imageItems.files.length && imageItems.skippedUnreadable <= 0) return;
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      await attachImageFiles(imageItems.files, {
        source: 'pasted',
        skippedUnreadable: imageItems.skippedUnreadable,
        noImagesMessage: 'Could not read pasted image from the clipboard.',
      });
    }

    function applyInputLayout() {
      inputLayoutFramePending = false;
      inputLayoutFrame = null;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }

	    function scheduleInputLayout() {
	      if (inputLayoutFramePending) return;
	      inputLayoutFramePending = true;
	      inputLayoutFrame = requestAnimationFrameHandle(applyInputLayout);
	    }

    function updateInputLayout(options) {
      if (!options || options.clearButton !== false) {
        setClearInputButtonDisabled(!hasNonWhitespaceText(input.value) && pendingImageAttachments.length === 0);
      }
      if (!options || options.persistDraft !== false) {
        scheduleComposerDraftStatePersistence();
      }
      scheduleInputLayout();
    }

	    function applyInputHistoryValue(value, position) {
	      const nextValue = typeof value === 'string' ? value : '';
	      if (input.value !== nextValue) {
	        input.value = nextValue;
		        updateInputLayout({ clearButton: false });
	      }
	      syncComposerInputState();
	      const pos = position === 'start' ? 0 : nextValue.length;
	      try { input.setSelectionRange(pos, pos); } catch {}
      focusComposerInput();
    }

    function focusComposerInput() {
      if (!input || typeof input.focus !== 'function') return false;
      try {
        input.focus({ preventScroll: true });
      } catch {
        try {
          input.focus();
        } catch {
          return false;
        }
      }
      return document.activeElement === input;
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

	    function isImeComposingEvent(event) {
	      return !!(event && (event.isComposing || event.keyCode === 229));
	    }

	    function isInputImeComposing(event) {
	      return !!(inputImeComposing || isImeComposingEvent(event));
	    }

	    function isEnterKey(event) {
	      return !!(event && event.key === 'Enter' && !isImeComposingEvent(event));
	    }

	    function isShortcutEnterKey(event) {
	      return !!(event && (event.ctrlKey || event.metaKey) && isEnterKey(event));
	    }

	    function isEscapeKey(event) {
	      return !!(event && event.key === 'Escape' && !isInputImeComposing(event));
	    }

		    function consumeHandledKeyEvent(event) {
		      if (!event) return;
		      if (event.preventDefault) event.preventDefault();
		      if (event.stopImmediatePropagation) {
		        event.stopImmediatePropagation();
		      } else if (event.stopPropagation) {
		        event.stopPropagation();
		      }
		    }

	    function clearSearchInputForEscape(event, inputEl, currentQuery, setQuery, onCleared) {
	      if (!isEscapeKey(event) || !inputEl) return false;
	      const visibleQuery = String(inputEl.value || currentQuery || '');
	      if (!visibleQuery) return false;
	      setValue(inputEl, '');
	      const changed = setQuery('');
	      if (changed && typeof onCleared === 'function') onCleared();
	      consumeHandledKeyEvent(event);
	      return true;
	    }

	    input.addEventListener('input', () => {
		      updateInputLayout({ clearButton: false });
	      syncComposerInputState();
	      if (inputHistoryIndex >= 0) {
		        inputHistoryIndex = -1;
		        inputHistorySavedDraft = null;
		      }
		      updateSkillDropdown();
		      rememberComposerInputAssistState();
		    });

    input.addEventListener('click', refreshComposerInputAssist);
    input.addEventListener('keyup', refreshComposerInputAssist);
	    input.addEventListener('focus', refreshComposerInputAssist);
	    input.addEventListener('compositionstart', () => {
	      inputImeComposing = true;
	    });
	    input.addEventListener('compositionend', () => {
	      inputImeComposing = false;
	    });
	    input.addEventListener('blur', () => {
	      inputImeComposing = false;
	    });
	    input.addEventListener('paste', (e) => {
	      void handleClipboardPaste(e);
	    });

    if (goalCommandSuggestion) {
      goalCommandSuggestion.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      goalCommandSuggestion.addEventListener('click', () => {
        insertGoalCommand();
      });
    }

    if (goalCommandInsert) {
      goalCommandInsert.addEventListener('click', () => {
        insertGoalCommand();
      });
    }

    if (attachImageButton && imageFileInput) {
      attachImageButton.addEventListener('click', () => {
        if (!initReceived) return;
        if (typeof imageFileInput.click === 'function') imageFileInput.click();
      });
    }

	    if (imageFileInput) {
	      imageFileInput.addEventListener('change', () => {
	        const files = copyArrayLike(imageFileInput.files);
	        imageFileInput.value = '';
	        void attachImageFiles(files, { source: 'selected' });
	      });
    }

    if (inputComposer) {
      inputComposer.addEventListener('dragenter', (e) => {
        if (!initReceived || !hasImageTransfer(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        inputImageDragDepth += 1;
        setInputImageDragActive(true);
      });

      inputComposer.addEventListener('dragover', (e) => {
        if (!initReceived || !hasImageTransfer(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setInputImageDragActive(true);
      });

      inputComposer.addEventListener('dragleave', (e) => {
        if (!inputImageDragDepth && !hasInputImageDragActiveState()) return;
        e.preventDefault();
        e.stopPropagation();
        if (!inputImageDragDepth) {
          clearInputImageDragState();
          return;
        }
        inputImageDragDepth -= 1;
        if (inputImageDragDepth <= 0) clearInputImageDragState();
      });

      inputComposer.addEventListener('drop', (e) => {
        if (!initReceived || !hasImageTransfer(e.dataTransfer)) {
          if (hasInputImageDragActiveState()) clearInputImageDragState();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        clearInputImageDragState();
        let dropFiles = e.dataTransfer ? e.dataTransfer.files : null;
        let skippedUnreadable = 0;
        if (e.dataTransfer && getArrayLikeLength(e.dataTransfer.items) > 0) {
          const imageItems = collectImageFilesFromItems(e.dataTransfer.items);
          if (imageItems.files.length > 0 || getArrayLikeLength(dropFiles) === 0) {
            dropFiles = imageItems.files;
          }
          skippedUnreadable = imageItems.skippedUnreadable;
        }
        void attachImageFiles(dropFiles, {
          source: 'dropped',
          skippedUnreadable,
          noImagesMessage: 'Could not read dropped image.',
        });
      });
    }

	    function findInputAttachmentRemoveButton(target) {
	      let el = target && typeof target === 'object' ? target : null;
	      while (el && el !== inputAttachments) {
	        if (inputAttachmentIdByRemoveButton.has(el)) return el;
	        el = el.parentNode || null;
	      }
	      return null;
	    }

	    if (inputAttachments) {
	      inputAttachments.addEventListener('click', (e) => {
	        const removeButton = findInputAttachmentRemoveButton(e && e.target ? e.target : null);
	        if (!removeButton) return;
	        const attachmentId = inputAttachmentIdByRemoveButton.get(removeButton) || '';
	        if (!attachmentId) return;
	        removePendingImageAttachmentById(attachmentId);
	        syncInputState();
      });
    }

		    if (skillsToggle) {
		      skillsToggle.addEventListener('change', () => {
		        if (!initReceived || isProcessing || hasPendingSettingState('skillsEnabledState')) {
		          setChecked(skillsToggle, skillsEnabled);
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

		    function closeSkillsSettingsPopover(options) {
		      closeSettingsPopover(skillsSettingsPopover, skillsSettings, options);
		    }

	    function openSkillsSettingsPopover() {
	      if (!skillsSettingsPopover) return;
	      clearInvalidFields([skillSearchPathsInput, skillsMaxPromptInput, skillsMaxInjectInput, skillsMaxInjectCharsInput]);
		      updateNormalizedSkillsBudgetState(skillsBudget);
		      updateNormalizedSkillSearchPathsState(skillSearchPaths);
		      openSettingsPopover(skillsSettingsPopover, skillsSettings, skillsSettingsClose);
	    }

		    function toggleSkillsSettingsPopover() {
		      toggleSettingsPopover(skillsSettingsPopover, openSkillsSettingsPopover, closeSkillsSettingsPopover);
		    }

	    function applySkillSearchPaths() {
	      if (!initReceived || isProcessing || hasPendingSettingState('skillSearchPathsState')) {
	        updateNormalizedSkillSearchPathsState(skillSearchPaths);
	        clearInvalidFields([skillSearchPathsInput]);
	        return;
	      }
	      const paths = normalizeSkillSearchPaths(skillSearchPathsInput ? skillSearchPathsInput.value : skillSearchPaths);
		      if (hasListItemLongerThan(paths, 240)) {
		        markInvalidField(skillSearchPathsInput, 'Skill search paths must be 240 characters or shorter.');
		        return;
		      }
		      clearInvalidFields([skillSearchPathsInput]);
		      if (stringListsEqual(paths, skillSearchPaths)) {
		        updateNormalizedSkillSearchPathsState(skillSearchPaths);
		        return;
		      }
		      postSettingWithPendingState(
		        'skillSearchPathsState',
		        { type: 'setSkillSearchPaths', paths },
	        () => updateNormalizedSkillSearchPathsState(skillSearchPaths)
	      );
	    }

	    function applySkillsBudget() {
	      const fields = [skillsMaxPromptInput, skillsMaxInjectInput, skillsMaxInjectCharsInput, skillSearchPathsInput];
	      const pending = hasPendingSettingState('skillsBudgetState') || hasPendingSettingState('skillSearchPathsState');
	      if (!initReceived || isProcessing || pending) {
		        updateNormalizedSkillsBudgetState(skillsBudget);
		        updateNormalizedSkillSearchPathsState(skillSearchPaths);
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
			      if (hasListItemLongerThan(paths, 240)) {
			        markInvalidField(skillSearchPathsInput, 'Skill search paths must be 240 characters or shorter.');
			        return;
			      }
		      clearInvalidFields(fields);
		      const budget = {
		        maxPromptSkills: Math.floor(maxPromptSkills),
		        maxInjectSkills: Math.floor(maxInjectSkills),
		        maxInjectChars: Math.floor(maxInjectChars),
		      };
		      const budgetChanged = !skillsBudgetsEqual(budget, skillsBudget);
		      const pathsChanged = !stringListsEqual(paths, skillSearchPaths);
		      if (!budgetChanged && !pathsChanged) {
		        updateNormalizedSkillsBudgetState(skillsBudget);
		        updateNormalizedSkillSearchPathsState(skillSearchPaths);
		        return;
		      }
		      const stateTypes = [];
		      const messages = [];
		      if (budgetChanged) {
		        stateTypes.push('skillsBudgetState');
		        messages.push({ type: 'setSkillsBudget', budget });
		      }
		      if (pathsChanged) {
		        stateTypes.push('skillSearchPathsState');
		        messages.push({ type: 'setSkillSearchPaths', paths });
		      }
		      postSettingsWithPendingStates(
		        stateTypes,
		        messages,
		        () => {
		          updateNormalizedSkillsBudgetState(skillsBudget);
		          updateNormalizedSkillSearchPathsState(skillSearchPaths);
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
	        if (isShortcutEnterKey(e)) {
	          e.preventDefault();
	          applySkillsBudget();
	        }
	      });
	    }
			    for (let skillsBudgetInputIndex = 0; skillsBudgetInputIndex < skillsBudgetInputs.length; skillsBudgetInputIndex++) {
			      const el = skillsBudgetInputs[skillsBudgetInputIndex];
			      if (!el) continue;
			      el.addEventListener('keydown', (e) => {
		        if (isEnterKey(e)) applySkillsBudget();
		      });
		    }

	    if (skillDropdown) {
	      skillDropdown.addEventListener('mousedown', (e) => {
	        // Keep focus in the textarea when selecting a skill.
	        e.preventDefault();
	      });

	      skillDropdown.addEventListener('click', (e) => {
	        const item = findSkillDropdownItem(e && e.target ? e.target : null);
	        if (!item) return;
	        const idx = skillDropdownItemIndexByElement.get(item);
	        if (!Number.isFinite(idx)) return;
	        skillDropdownSelectedIndex = Math.max(0, Math.min(idx, (skillDropdownItems || []).length - 1));
	        applySelectedSkill();
	      });
	    }

	    function findSkillDropdownItem(target) {
	      let el = target && typeof target === 'object' ? target : null;
	      while (el && el !== skillDropdown) {
	        if (skillDropdownItemIndexByElement.has(el)) return el;
	        el = el.parentNode || null;
	      }
	      return null;
	    }

		    input.addEventListener('keydown', (e) => {
	      if (isInputImeComposing(e)) {
	        return;
	      }

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

		        if (isEscapeKey(e)) {
		          consumeHandledKeyEvent(e);
		          closeSkillDropdown();
		          return;
	        }
      }

      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && shouldShowGoalCommandSuggestion()) {
        e.preventDefault();
        insertGoalCommand();
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!initReceived || isProcessing) return;
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        if (selectionStart !== selectionEnd) return;

        const text = input.value || '';
        const caret = selectionStart || 0;
        const isEmpty = !hasNonWhitespaceText(text);
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
			      if (isEscapeKey(e)) {
			        consumeHandledKeyEvent(e);
			        if (revertBarVisible) {
	          setRevertBarVisible(false);
		        } else {
		          input.blur();
		        }
	        return;
      }
      if (e.key === '.' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        requestAbort();
      }
    });

	    clearInputBtn.addEventListener('click', () => {
      inputHistoryIndex = -1;
	      inputHistorySavedDraft = null;
	      const hadInputValue = input.value !== '';
	      if (hadInputValue) {
	        input.value = '';
	        updateInputLayout({ clearButton: false });
	      }
	      clearPendingImageAttachments();
	      persistComposerDraftStateNow();
	      syncComposerInputState();
	      closeSkillDropdown();
	      focusComposerInput();
    });

	    sendBtn.addEventListener('click', () => send());

	    if (stopBtn) {
	      stopBtn.addEventListener('click', requestAbort);
	    }

			    if (queueClearBtn) {
			      queueClearBtn.addEventListener('click', () => {
				        if (!initReceived || queueClearPending || queueSteerPendingId || getCurrentRenderableQueueCount() <= 0) return;
			        queueClearPending = true;
			        armPendingActionTimer('queueAction', () => recoverPendingAction('queueAction', 'Queue action is taking longer than expected. Controls were re-enabled.', () => { queueClearPending = false; queueSteerPendingId = ''; try { setQueueState(queuedInputs, { sync: false }); } catch {} }));
		        try { setQueueState(queuedInputs); } catch {}
		        try {
		          vscode.postMessage({ type: 'clearQueue' });
		        } catch {
		          clearPendingActionTimer('queueAction');
		          queueClearPending = false;
		          showInputNotice('Failed to request queue clear.', { sync: false });
		          try { setQueueState(queuedInputs); } catch {}
			        }
		      });
		    }

		    if (queueItems) {
		      queueItems.addEventListener('click', handleQueueItemsClick);
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

		    if (quickActions) {
		      cacheQuickActionCommands();
		      quickActions.addEventListener('click', (e) => {
		        const quickAction = findQuickActionButton(e && e.target ? e.target : null);
		        if (!quickAction) return;
		        const cmd = getQuickActionCommand(quickAction);
		        if (!cmd) return;
		        inputHistoryIndex = -1;
		        inputHistorySavedDraft = null;
		        if (input.value !== cmd) {
		          input.value = cmd;
		          updateInputLayout({ clearButton: false });
		        }
		        syncComposerInputState();
		        focusComposerInput();
		      });
		    }

				    function cacheQuickActionCommands() {
				      const buttons = quickActions && quickActions.children ? quickActions.children : [];
			      for (let i = 0; i < buttons.length; i++) {
			        const button = buttons[i];
			        if (!isQuickActionElement(button)) continue;
			        const command = getQuickActionCommandLabel(button);
			        if (button && command) quickActionCommandByButton.set(button, command);
				      }
				    }

				    function isQuickActionElement(el) {
				      return !!(el && el.classList && el.classList.contains('quick-action'));
				    }

				    function findQuickActionButton(target) {
				      let el = target && typeof target === 'object' ? target : null;
				      while (el && el !== quickActions) {
				        if (quickActionCommandByButton.has(el)) return el;
				        if (isQuickActionElement(el)) return el;
				        el = el.parentNode || null;
				      }
				      return null;
				    }

			    function getQuickActionCommand(quickAction) {
			      return quickActionCommandByButton.get(quickAction) || getQuickActionCommandLabel(quickAction);
			    }

		    function getQuickActionCommandLabel(quickAction) {
		      if (!quickAction) return '';
		      const title = typeof quickAction.title === 'string' ? quickAction.title.trim() : '';
		      if (title) return title;
		      const ariaLabel = quickAction.getAttribute ? String(quickAction.getAttribute('aria-label') || '').trim() : '';
		      const suffix = ', quick action';
		      if (ariaLabel.endsWith(suffix)) return ariaLabel.slice(0, -suffix.length).trim();
		      return typeof quickAction.textContent === 'string' ? quickAction.textContent.trim() : '';
		    }

		    document.addEventListener('click', (e) => {
		      const target = e && e.target ? e.target : null;
	      if (
	        outputModal &&
	        (typeof isOutputModalOpen === 'function' ? isOutputModalOpen() : !outputModal.classList.contains('hidden')) &&
	        elementContainsEventTarget(outputModal, target)
	      ) {
	        return;
	      }
	      if (skillDropdownOpen) {
	        const clickedDropdown = elementContainsEventTarget(skillDropdown, target);
	        const clickedInput = target === input;
        if (!clickedDropdown && !clickedInput) {
          closeSkillDropdown();
        }
      }

	      closeOpenSettingsPopoversFromOutsidePointer(target);
		    });

			    document.addEventListener('keydown', (e) => {
			      if (!isEscapeKey(e)) return;
			      if (outputModal && (typeof isOutputModalOpen === 'function' ? isOutputModalOpen() : !outputModal.classList.contains('hidden'))) return;
			      if (!closeSettingsPopoverForEscape()) return;
			      if (e.preventDefault) e.preventDefault();
			      if (e.stopImmediatePropagation) {
			        e.stopImmediatePropagation();
			      } else if (e.stopPropagation) {
			        e.stopPropagation();
			      }
		    });

		    const defaultPlaceholder = input.placeholder || 'Describe a task...';

			    function trimComposerSendText(value) {
			      const text = String(value === undefined || value === null ? '' : value);
			      let start = 0;
			      while (start < text.length && isWhitespaceChar(text[start])) start++;
			      if (start >= text.length) return '';
			      let end = text.length;
			      while (end > start && isWhitespaceChar(text[end - 1])) end--;
			      return start === 0 && end === text.length ? text : text.slice(start, end);
			    }

			    function send() {
			      if (!initReceived || pendingComposerSubmission || pendingImageAttachmentOperations > 0) return;
			      const rawText = input.value || '';
			      const text = trimComposerSendText(rawText);
			      const hasText = text !== '';
			      const hasAttachments = pendingImageAttachments.length > 0;
			      const requiresText = planPending && currentMode === 'plan' && !isProcessing;
			      if (requiresText && !hasText) return;
		      if (!hasText && !hasAttachments) return;
		      closeSkillDropdown();
		      inputHistoryIndex = -1;
		      inputHistorySavedDraft = null;
		      if (text) {
		        addToInputHistory(text);
			      }
			      persistComposerDraftStateNow();
			      const submissionId = createComposerSubmissionId();
			      const submission = {
			        id: submissionId,
			        rawText,
			        attachments: pendingImageAttachments.slice(),
			        reconstructed: false,
			        received: false,
			      };
			      pendingComposerSubmission = submission;
			      persistComposerSubmissionId(submissionId);
			      try {
				        vscode.postMessage({
				          type: 'send',
				          submissionId,
				          message: text,
				          draft: rawText,
				          attachments: serializePendingImageAttachments(),
			        });
			      } catch {
			        clearPendingActionTimer('composerSubmission');
			        pendingComposerSubmission = null;
			        persistComposerSubmissionId('');
			        showInputNotice('Failed to send message.');
			        return;
			      }
			      const hadInputValue = input.value !== '';
			      if (hadInputValue) {
			        input.value = '';
			        updateInputLayout({ clearButton: false, persistDraft: false });
			      }
			      clearPendingImageAttachments({ syncExtension: false });
			      armPendingActionTimer('composerSubmission', handleComposerSubmissionTimeout);
				      syncInputState();
				    }

					    function createCompactRenderStateKeyBuilder() {
					      return { hash: 2166136261, length: 0 };
					    }

					    function appendCompactRenderStateKeyText(builder, text) {
					      const value = String(text === undefined || text === null ? '' : text);
					      for (let i = 0; i < value.length; i++) {
					        builder.hash ^= value.charCodeAt(i);
					        builder.hash = Math.imul(builder.hash, 16777619);
					      }
					      builder.length += value.length;
					      return builder;
					    }

					    function appendCompactRenderStateKeyCode(builder, code) {
					      builder.hash ^= code;
					      builder.hash = Math.imul(builder.hash, 16777619);
					      builder.length++;
					      return builder;
					    }

					    function appendCompactRenderStateKeyPart(builder, value) {
					      const text = String(value === undefined || value === null ? '' : value);
					      appendCompactRenderStateKeyText(builder, String(text.length));
					      appendCompactRenderStateKeyCode(builder, 58);
					      appendCompactRenderStateKeyText(builder, text);
					      appendCompactRenderStateKeyCode(builder, 1);
					      return builder;
					    }

					    function finishCompactRenderStateKey(builder) {
					      return builder && builder.length ? builder.length + ':' + (builder.hash >>> 0).toString(36) : '';
					    }

					    function getQueuedInputId(item) {
				      if (!item || typeof item !== 'object') return '';
				      return typeof item.id === 'string' ? item.id : '';
				    }

				    function isQueuedInputPreviewWhitespaceCode(code) {
				      return (code >= 9 && code <= 13) ||
				        code === 32 ||
				        code === 160 ||
				        code === 5760 ||
				        code === 8232 ||
				        code === 8233 ||
				        code === 8239 ||
				        code === 8287 ||
				        code === 12288 ||
				        code === 65279 ||
				        (code >= 8192 && code <= 8202);
				    }

					    function getQueuedInputPreviewText(value) {
					      const text = typeof value === 'string' ? value : '';
					      let start = 0;
					      while (start < text.length && isQueuedInputPreviewWhitespaceCode(text.charCodeAt(start))) start++;
				      if (start >= text.length) return '';
				      let end = text.length;
				      while (end > start && isQueuedInputPreviewWhitespaceCode(text.charCodeAt(end - 1))) end--;
				      const trimmedLength = end - start;
				      if (trimmedLength > QUEUE_ITEM_PREVIEW_LIMIT) {
				        return text.slice(start, start + QUEUE_ITEM_PREVIEW_LIMIT - 3) + '…';
				      }
					      return text.slice(start, end);
					    }

					    function normalizeQueuedAttachmentCount(value) {
					      const count = Number(value);
					      return Number.isInteger(count) && count > 0 ? count : 0;
					    }

					    function getQueuedInputRenderInfo(item, knownId) {
					      const id = knownId || getQueuedInputId(item);
					      if (!id) return null;
					      const rawDisplayContent = item && typeof item === 'object' ? item.displayContent : '';
					      const displayContent = getQueuedInputPreviewText(rawDisplayContent);
					      const rawMessage = item && typeof item === 'object' ? item.message : '';
					      const preview = displayContent || getQueuedInputPreviewText(rawMessage);
					      const attachmentCount = normalizeQueuedAttachmentCount(item && typeof item === 'object' ? item.attachmentCount : 0);
					      return {
					        id,
					        preview: preview || 'Queued message',
					        attachmentCount,
					      };
					    }

				    function getQueueInputsRenderState(next) {
					      const list = Array.isArray(next) ? next : [];
					      const key = createCompactRenderStateKeyBuilder();
					      appendCompactRenderStateKeyPart(key, list.length);
					      let visibleCount = 0;
					      let renderableCount = 0;
					      const visibleRenderBases = [];
					      for (let queueIndex = 0; queueIndex < list.length; queueIndex++) {
					        const item = list[queueIndex];
					        const itemId = getQueuedInputId(item);
				        if (!itemId) continue;
				        renderableCount++;
					        if (visibleCount >= QUEUE_ITEMS_RENDER_LIMIT) continue;
					        const renderInfo = getQueuedInputRenderInfo(item, itemId);
					        appendCompactRenderStateKeyPart(key, renderInfo ? renderInfo.id : '');
					        appendCompactRenderStateKeyPart(key, renderInfo ? renderInfo.preview : '');
					        appendCompactRenderStateKeyPart(key, renderInfo ? renderInfo.attachmentCount : '');
					        if (renderInfo) visibleRenderBases.push(renderInfo);
					        visibleCount++;
					      }
					      appendCompactRenderStateKeyPart(key, renderableCount);
					      const renderKey = finishCompactRenderStateKey(key);
				      return {
				        key: renderKey,
				        list,
				        renderableCount,
				        visibleRenderBases,
				      };
				    }

					    function getQueueItemAriaLabel(renderItem) {
					      const label = String(renderItem && renderItem.label ? renderItem.label : 'Queued message').trim() || 'Queued message';
					      const preview = String(renderItem && renderItem.preview ? renderItem.preview : '').trim();
					      const attachmentCount = normalizeQueuedAttachmentCount(renderItem && renderItem.attachmentCount);
					      let ariaLabel = preview ? label + ': ' + preview : label;
					      if (attachmentCount > 0) {
					        ariaLabel += attachmentCount === 1 ? ', 1 image attached' : ', ' + attachmentCount + ' images attached';
					      }
					      return ariaLabel;
					    }

				    function getQueueInputsStateKey(next) {
				      return getQueueInputsRenderState(next).key;
				    }

				    function isQueueInputsRenderState(value) {
				      return !!value &&
				        typeof value === 'object' &&
				        typeof value.key === 'string' &&
				        Array.isArray(value.list) &&
				        Array.isArray(value.visibleRenderBases);
				    }

				    function isQueueRenderStateCurrent(renderState) {
				      return isQueueInputsRenderState(renderState) && renderState.key === lastQueueInputsStateKey;
				    }

				    function isQueueStateCurrent(next) {
				      return isQueueRenderStateCurrent(getQueueInputsRenderState(next));
				    }

				    function getCurrentRenderableQueueCount() {
				      return isQueueInputsRenderState(lastQueueInputsRenderState) && lastQueueInputsRenderState.list === queuedInputs
				        ? lastQueueInputsRenderState.renderableCount
				        : (Array.isArray(queuedInputs) ? queuedInputs.length : 0);
				    }

				    function setQueueBannerVisible(visible) {
				      if (!queueBanner) return;
				      const visibleFlag = !!visible;
				      if (queueBannerVisible === visibleFlag) return;
				      queueBannerVisible = visibleFlag;
				      queueBanner.classList.toggle('hidden', !visibleFlag);
				    }

				    function setQueueBannerState(count) {
				      if (!queueBanner) return;
				      const queueCountText = count === 1 ? '1 queued' : count + ' queued';
				      const queueText = isProcessing ? 'Queued for the next step' : 'Queued messages ready to run';
				      const queueHint = isProcessing
				        ? 'Click a queued message to steer it into the current run.'
				        : 'Click a queued message to run it now.';
				      const nextQueueBannerRenderKeyBuilder = createCompactRenderStateKeyBuilder();
				      appendCompactRenderStateKeyPart(nextQueueBannerRenderKeyBuilder, count);
				      appendCompactRenderStateKeyPart(nextQueueBannerRenderKeyBuilder, isProcessing ? '1' : '0');
				      const nextQueueBannerRenderKey = finishCompactRenderStateKey(nextQueueBannerRenderKeyBuilder);
				      if (nextQueueBannerRenderKey === lastQueueBannerRenderKey) return;
					      lastQueueBannerRenderKey = nextQueueBannerRenderKey;
					      if (count <= 0) {
					        setQueueBannerVisible(false);
					        setTextContent(queueStatus, 'No queued messages.');
					        return;
					      }
					      setQueueBannerVisible(true);
					      setTextContent(queueBannerCount, queueCountText);
					      setTextContent(queueBannerText, queueText);
					      setTextContent(queueBannerHint, queueHint);
					      setTextContent(queueStatus, queueCountText + '. ' + queueText + '.');
					    }

					    function setQueueState(next, options) {
					      const queueInputsRenderState = isQueueInputsRenderState(next)
					        ? next
					        : getQueueInputsRenderState(next);
					      const nextQueueInputsStateKey = queueInputsRenderState.key;
				      lastQueueInputsRenderState = queueInputsRenderState;
					      queuedInputs = queueInputsRenderState.list;
					      const count = queueInputsRenderState.renderableCount;
				      setQueueBannerState(count);
				      const queueActionBusy = queueClearPending || !!queueSteerPendingId;
				      if (queueClearBtn) {
				        setDisabled(queueClearBtn, !initReceived || count <= 0 || queueActionBusy);
				      }
				      if (queueItems) {
				        const renderItems = [];
				        const renderableCount = count;
				        let pendingItemBeyondLimit = null;
				        let pendingItemInVisibleRows = false;
						        const visibleRenderBases = queueInputsRenderState.visibleRenderBases;
						        for (let queueRenderIndex = 0; queueRenderIndex < visibleRenderBases.length; queueRenderIndex++) {
						          const renderBase = visibleRenderBases[queueRenderIndex];
						          const itemPending = queueSteerPendingId === renderBase.id;
					          if (itemPending) pendingItemInVisibleRows = true;
				          renderItems.push({
				            id: renderBase.id,
				            preview: renderBase.preview,
				            attachmentCount: renderBase.attachmentCount,
				            disabled: !initReceived || queueActionBusy,
				            label: itemPending ? 'Working…' : isProcessing ? 'Steer now' : 'Run now',
				            title: itemPending
				              ? 'Queued message action is pending…'
				              : isProcessing ? 'Steer this queued message now' : 'Run this queued message now',
				          });
				        }
				        if (queueSteerPendingId && !pendingItemInVisibleRows && renderItems.length >= QUEUE_ITEMS_RENDER_LIMIT) {
					          for (let queueIndex = 0; queueIndex < queuedInputs.length; queueIndex++) {
					            const item = queuedInputs[queueIndex];
					            const itemId = getQueuedInputId(item);
				            if (itemId !== queueSteerPendingId) continue;
				            const renderBase = getQueuedInputRenderInfo(item, itemId);
				            if (renderBase) {
				              pendingItemBeyondLimit = {
				                id: renderBase.id,
				                preview: renderBase.preview,
				                attachmentCount: renderBase.attachmentCount,
				                disabled: !initReceived || queueActionBusy,
				                label: 'Working…',
				                title: 'Queued message action is pending…',
				              };
				            }
				            break;
				          }
				        }

				        if (pendingItemBeyondLimit && renderItems.length > 0) {
				          renderItems[renderItems.length - 1] = pendingItemBeyondLimit;
				        }

					        const nextQueueItemsRenderKeyBuilder = createCompactRenderStateKeyBuilder();
					        appendCompactRenderStateKeyPart(nextQueueItemsRenderKeyBuilder, renderableCount);
						        for (let renderIndex = 0; renderIndex < renderItems.length; renderIndex++) {
						          const renderItem = renderItems[renderIndex];
						          appendCompactRenderStateKeyPart(nextQueueItemsRenderKeyBuilder, renderItem.id);
					          appendCompactRenderStateKeyPart(nextQueueItemsRenderKeyBuilder, renderItem.preview);
					          appendCompactRenderStateKeyPart(nextQueueItemsRenderKeyBuilder, renderItem.attachmentCount);
					        }
					        const nextQueueItemsRenderKey = finishCompactRenderStateKey(nextQueueItemsRenderKeyBuilder);
				        const nextQueueActionStateKeyBuilder = createCompactRenderStateKeyBuilder();
				        appendCompactRenderStateKeyPart(nextQueueActionStateKeyBuilder, initReceived ? '1' : '0');
				        appendCompactRenderStateKeyPart(nextQueueActionStateKeyBuilder, queueActionBusy ? '1' : '0');
				        appendCompactRenderStateKeyPart(nextQueueActionStateKeyBuilder, queueSteerPendingId || '');
				        appendCompactRenderStateKeyPart(nextQueueActionStateKeyBuilder, isProcessing ? '1' : '0');
					        const nextQueueActionStateKey = finishCompactRenderStateKey(nextQueueActionStateKeyBuilder);

					        if (nextQueueItemsRenderKey !== lastQueueItemsRenderKey) {
					          let fragment = null;
					          let singleQueueChild = null;
					          function appendQueueChild(child) {
					            if (fragment) {
					              fragment.appendChild(child);
					              return;
					            }
					            if (singleQueueChild) {
					              fragment = document.createDocumentFragment();
					              fragment.appendChild(singleQueueChild);
					              singleQueueChild = null;
					              fragment.appendChild(child);
					              return;
					            }
					            singleQueueChild = child;
					          }
					          for (let renderIndex = 0; renderIndex < renderItems.length; renderIndex++) {
					            const renderItem = renderItems[renderIndex];
					            const btn = document.createElement('button');
				            btn.type = 'button';
				            btn.className = 'queue-item';
				            queueItemIdByButton.set(btn, renderItem.id);
				            btn.disabled = renderItem.disabled;
				            btn.title = renderItem.title;
				            btn.setAttribute('aria-label', getQueueItemAriaLabel(renderItem));

				            const bodyEl = document.createElement('span');
				            bodyEl.className = 'queue-item-body';

				            const labelEl = document.createElement('span');
				            labelEl.className = 'queue-item-label';
				            labelEl.textContent = renderItem.label;
				            queueItemLabelElementCache.set(btn, labelEl);

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

					            bodyEl.appendChild(labelEl);
					            bodyEl.appendChild(textEl);
					            if (metaEl) bodyEl.appendChild(metaEl);
					            btn.appendChild(bodyEl);

				            appendQueueChild(btn);
				          }
					          if (renderableCount > renderItems.length) {
					            const moreEl = document.createElement('div');
					            moreEl.className = 'queue-overflow';
					            const moreText = 'Showing ' + renderItems.length + ' of ' + renderableCount + ' queued messages.';
					            moreEl.setAttribute('role', 'note');
					            moreEl.setAttribute('aria-label', moreText);
					            moreEl.textContent = moreText;
					            appendQueueChild(moreEl);
					          }
					          replaceElementChildren(queueItems, fragment || singleQueueChild);
					          lastQueueItemsRenderKey = nextQueueItemsRenderKey;
					          lastQueueActionStateKey = nextQueueActionStateKey;
					        } else if (nextQueueActionStateKey !== lastQueueActionStateKey) {
					          if (renderItems.length > 0) syncQueueItemControls(renderItems);
					          lastQueueActionStateKey = nextQueueActionStateKey;
					        }
				      }
				      lastQueueInputsStateKey = nextQueueInputsStateKey;
					      if (!options || options.sync !== false) syncInputState();
					    }

					    function requestSteerQueuedInput(id) {
					      if (!id || !initReceived || queueClearPending || queueSteerPendingId) return;
					      queueSteerPendingId = id;
					      armPendingActionTimer('queueAction', () => recoverPendingAction('queueAction', 'Queue action is taking longer than expected. Controls were re-enabled.', () => { queueClearPending = false; queueSteerPendingId = ''; try { setQueueState(queuedInputs, { sync: false }); } catch {} }));
					      try { setQueueState(queuedInputs); } catch {}
					      try {
					        vscode.postMessage({ type: 'steerQueuedInput', id });
					      } catch {
					        clearPendingActionTimer('queueAction');
					        queueSteerPendingId = '';
					        showInputNotice('Failed to request queued message.', { sync: false });
					        try { setQueueState(queuedInputs); } catch {}
					      }
					    }

					    function findQueueItemButton(target) {
					      let el = target && typeof target === 'object' ? target : null;
					      while (el && el !== queueItems) {
					        if (queueItemIdByButton.has(el)) return el;
					        el = el.parentNode || null;
					      }
					      return null;
					    }

					    function handleQueueItemsClick(e) {
					      const button = findQueueItemButton(e && e.target ? e.target : null);
					      if (!button) return;
					      e.preventDefault();
					      if (button.disabled) return;
					      requestSteerQueuedInput(queueItemIdByButton.get(button));
					    }

					    function getQueueItemLabelElement(button) {
				      if (!button) return null;
				      const cached = queueItemLabelElementCache.get(button);
				      if (cached) {
				        if (typeof button.contains !== 'function' || button.contains(cached)) return cached;
				        queueItemLabelElementCache.delete(button);
				      }
				      const bodyEl = button.firstElementChild || (button.children ? button.children[0] : null);
				      const labelEl = bodyEl && bodyEl.firstElementChild ? bodyEl.firstElementChild : null;
				      if (labelEl && labelEl.className === 'queue-item-label') {
				        queueItemLabelElementCache.set(button, labelEl);
				        return labelEl;
				      }
				      return null;
				    }

				    function syncQueueItemControls(renderItems) {
				      if (!queueItems || !Array.isArray(renderItems)) return;
				      const children = queueItems.children || [];
				      let renderIndex = 0;
				      for (let i = 0; i < children.length && renderIndex < renderItems.length; i++) {
				        const btn = children[i];
				        if (!btn || btn.className !== 'queue-item') continue;
				        const renderItem = renderItems[renderIndex++];
				        if (!renderItem || !renderItem.id) continue;
				        if (queueItemIdByButton.get(btn) !== renderItem.id) continue;
				        setDisabled(btn, renderItem.disabled);
				        setTitle(btn, renderItem.title);
				        setAttributeValue(btn, 'aria-label', getQueueItemAriaLabel(renderItem));
				        setTextContent(getQueueItemLabelElement(btn), renderItem.label);
				      }
				    }

		    function setSendButtonPresentation(icon, label, title, ariaLabel) {
		      const nextAriaLabel = String(ariaLabel || label || title || '');
		      const nextKey = String(icon || '') + '\u0000' + String(label || '') + '\u0000' + String(title || '') + '\u0000' + nextAriaLabel;
		      if (sendButtonPresentationKey !== nextKey) {
		        const iconEl = document.createElement('span');
		        iconEl.textContent = String(icon || '');
		        iconEl.setAttribute('aria-hidden', 'true');
        const labelEl = document.createElement('span');
        labelEl.textContent = String(label || '');
        if (typeof sendBtn.replaceChildren === 'function') {
          sendBtn.replaceChildren(iconEl, labelEl);
        } else {
          const fragment = document.createDocumentFragment();
          fragment.appendChild(iconEl);
          fragment.appendChild(labelEl);
          replaceElementChildren(sendBtn, fragment);
        }
        sendBtn.title = String(title || '');
        setAttributeValue(sendBtn, 'aria-label', nextAriaLabel);
        sendButtonPresentationKey = nextKey;
		      }
		      if (sendBtn.classList.contains('stop')) sendBtn.classList.remove('stop');
	    }

		    function setSendButtonDisabled(disabled) {
		      if (!sendBtn) return;
		      const disabledFlag = !!disabled;
		      if (sendButtonDisabledState === disabledFlag) return;
		      sendButtonDisabledState = disabledFlag;
		      if (sendBtn.disabled !== disabledFlag) sendBtn.disabled = disabledFlag;
		    }

			    function setClearInputButtonDisabled(disabled) {
			      if (!clearInputBtn) return;
			      const disabledFlag = !!disabled;
			      if (clearInputButtonDisabledState === disabledFlag) return;
			      clearInputButtonDisabledState = disabledFlag;
			      if (clearInputBtn.disabled !== disabledFlag) clearInputBtn.disabled = disabledFlag;
			    }

			    function setStopButtonVisible(visible) {
			      if (!stopBtn) return;
			      const visibleFlag = !!visible;
			      if (stopButtonVisible === visibleFlag) return;
			      stopButtonVisible = visibleFlag;
			      stopBtn.classList.toggle('hidden', !visibleFlag);
			    }

			    function setDisabled(element, disabled) {
		      if (!element) return;
		      const disabledFlag = !!disabled;
		      if (element.disabled !== disabledFlag) element.disabled = disabledFlag;
		    }

		    function setClassPresence(element, className, present) {
		      if (!element || !element.classList) return;
		      const presentFlag = !!present;
		      if (element.classList.contains(className) !== presentFlag) {
		        element.classList.toggle(className, presentFlag);
		      }
		    }

		    function setDisabledClass(element, disabled) {
		      setClassPresence(element, 'disabled', disabled);
		    }

		    function setClassName(element, className) {
		      if (!element) return;
		      const nextClassName = String(className || '');
		      if ((element.className || '') !== nextClassName) element.className = nextClassName;
		    }

		    function setDisplay(element, display) {
		      if (!element || !element.style) return;
		      const nextDisplay = String(display === undefined || display === null ? '' : display);
		      if ((element.style.display || '') !== nextDisplay) element.style.display = nextDisplay;
		    }

			    function setHidden(element, hidden) {
			      setClassPresence(element, 'hidden', hidden);
			    }

			    function replaceElementChildren(element, child) {
			      if (!element) return;
		      if (typeof element.replaceChildren === 'function') {
		        if (child) {
		          element.replaceChildren(child);
		        } else {
		          element.replaceChildren();
		        }
		        return;
		      }
		      while (element.firstChild) {
		        element.removeChild(element.firstChild);
		      }
			      if (child) element.appendChild(child);
			    }

		    function isBatchToolType(toolId) {
		      return BATCH_TOOL_TYPE_SET.has(toolId);
		    }

				    function setElementHidden(element, hidden) {
				      if (!element) return;
			      const hiddenFlag = !!hidden;
		      if (element.hidden !== hiddenFlag) element.hidden = hiddenFlag;
		    }

	    function appendNormalizedStringListItem(value, seen, normalized) {
		        if (typeof value !== 'string') return;
		        const item = value.trim();
		        if (!item || seen.has(item)) return;
		        seen.add(item);
		        normalized.push(item);
		      }

	    function normalizeSeparatedStringList(raw) {
	      const seen = new Set();
	      const normalized = [];
		      if (Array.isArray(raw)) {
		        for (let i = 0; i < raw.length; i++) appendNormalizedStringListItem(raw[i], seen, normalized);
		      } else if (typeof raw === 'string') {
		        let itemStart = 0;
		        for (let i = 0; i <= raw.length; i++) {
		          if (i < raw.length) {
		            const charCode = raw.charCodeAt(i);
		            if (charCode !== 10 && charCode !== 44) continue;
		          }
		          appendNormalizedStringListItem(raw.slice(itemStart, i), seen, normalized);
		          itemStart = i + 1;
		        }
		      }
	      return normalized;
	    }

	    function hasListItemLongerThan(values, maxLength) {
	      if (!Array.isArray(values)) return false;
	      for (let i = 0; i < values.length; i++) {
	        if (typeof values[i] === 'string' && values[i].length > maxLength) return true;
	      }
	      return false;
	    }

	    function stringListsEqual(left, right) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
      }
      return true;
    }

    function workspaceEnvsEqual(left, right) {
      if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
      if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
      for (const key in left) {
        if (!Object.prototype.hasOwnProperty.call(left, key)) continue;
        if (!Object.prototype.hasOwnProperty.call(right, key) || left[key] !== right[key]) return false;
      }
      return true;
    }

    function stringRecordsEqual(left, right) {
      return workspaceEnvsEqual(left, right);
    }

    function openAICompatibleSettingsEqual(left, right) {
      return !!left && !!right &&
        left.baseURL === right.baseURL &&
        left.defaultModelId === right.defaultModelId &&
        left.apiKeyEnv === right.apiKeyEnv &&
        left.allowInsecureTLS === right.allowInsecureTLS &&
        stringRecordsEqual(left.modelDisplayNames, right.modelDisplayNames);
    }

    function codexSubscriptionSettingsEqual(left, right) {
      return !!left && !!right && left.defaultModelId === right.defaultModelId;
    }

    function debugSettingsEqual(left, right) {
      return !!left && !!right &&
        left.details === right.details &&
        left.llm === right.llm &&
        left.tools === right.tools &&
        left.plugins === right.plugins;
    }

    function pluginSettingsEqual(left, right) {
      return !!left && !!right &&
        left.autoDiscover === right.autoDiscover &&
        left.workspaceDir === right.workspaceDir &&
        stringListsEqual(left.plugins, right.plugins);
    }

    function sessionRetentionLimitsEqual(left, right) {
      return !!left && !!right &&
        left.maxSessions === right.maxSessions &&
        left.maxSessionBytes === right.maxSessionBytes;
    }

    function instructionFileSettingsEqual(left, right) {
      return !!left && !!right &&
        left.includeGlobal === right.includeGlobal &&
        left.maxCharsPerFile === right.maxCharsPerFile &&
        left.maxTotalChars === right.maxTotalChars;
    }

    function skillsBudgetsEqual(left, right) {
      return !!left && !!right &&
        left.maxPromptSkills === right.maxPromptSkills &&
        left.maxInjectSkills === right.maxInjectSkills &&
        left.maxInjectChars === right.maxInjectChars;
    }

    function toolRuntimeLimitsEqual(left, right) {
      return !!left && !!right &&
        left.toolTimeoutMs === right.toolTimeoutMs &&
        left.readMaxLines === right.readMaxLines &&
        left.bashBackgroundTtlMs === right.bashBackgroundTtlMs &&
        left.bashBackgroundCaptureMs === right.bashBackgroundCaptureMs &&
        left.bashBackgroundCaptureLines === right.bashBackgroundCaptureLines &&
        left.workspaceShellTimeoutMs === right.workspaceShellTimeoutMs &&
        left.httpTimeoutMs === right.httpTimeoutMs;
    }

    function memoryAutoRecallBudgetEqual(left, right) {
      return !!left && !!right &&
        left.maxResults === right.maxResults &&
        left.maxTokens === right.maxTokens;
    }

    function memoryAutoRecallFiltersEqual(left, right) {
      return !!left && !!right &&
        left.minScore === right.minScore &&
        left.minScoreGap === right.minScoreGap &&
        left.maxAgeDays === right.maxAgeDays;
    }

    function memoryAdvancedLimitsEqual(left, right) {
      return !!left && !!right &&
        left.maxRawMemoriesForGlobal === right.maxRawMemoriesForGlobal &&
        left.maxRolloutAgeDays === right.maxRolloutAgeDays &&
        left.maxRolloutsPerStartup === right.maxRolloutsPerStartup &&
        left.minRolloutIdleHours === right.minRolloutIdleHours &&
        left.maxStateOutputs === right.maxStateOutputs &&
        left.maxRecords === right.maxRecords &&
        left.maxSearchResults === right.maxSearchResults &&
        left.maxResultsPerKind === right.maxResultsPerKind &&
        left.searchNeighborWindow === right.searchNeighborWindow;
    }

    function modelLimitsEqual(left, right) {
      if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
      if (countOwnEnumerableKeys(left) !== countOwnEnumerableKeys(right)) return false;
      for (const key in left) {
        if (!Object.prototype.hasOwnProperty.call(left, key)) continue;
        if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
        const leftEntry = left[key] || {};
        const rightEntry = right[key] || {};
        if (leftEntry.context !== rightEntry.context || leftEntry.output !== rightEntry.output) return false;
      }
      return true;
    }

    function compactionPruneSettingsEqual(left, right) {
      return !!left && !!right &&
        left.prune === right.prune &&
        left.pruneProtectTokens === right.pruneProtectTokens &&
        left.pruneMinimumTokens === right.pruneMinimumTokens;
    }

    function compareLocaleAscending(left, right) {
      return left.localeCompare(right);
    }

    function formatCommaSeparatedList(values) {
      if (!Array.isArray(values) || !values.length) return '';
      let text = '';
			      for (let i = 0; i < values.length; i++) {
			        if (i > 0) text += ', ';
			        const value = values[i];
			        if (value !== undefined && value !== null) text += String(value);
			      }
			      return text;
			    }

			    function countOwnEnumerableKeys(value) {
		      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return 0;
		      let count = 0;
		      for (const key in value) {
		        if (Object.prototype.hasOwnProperty.call(value, key)) count++;
		      }
		      return count;
		    }

			    function serializeSortedOwnEnumerableEntries(value, formatEntry) {
			      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return '';
			      let keys = null;
			      for (const key in value) {
			        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
			        if (!keys) keys = [];
			        keys.push(key);
			      }
			      if (!keys) return '';
			      if (keys.length > 1) keys.sort(compareLocaleAscending);
			      let text = '';
			      for (let i = 0; i < keys.length; i++) {
			        const key = keys[i];
		        if (i > 0) text += '\n';
		        text += formatEntry(key, value[key]);
		      }
		      return text;
		    }

				    function forEachTextLine(value, callback) {
				      const text = String(value === undefined || value === null ? '' : value);
			      let lineStart = 0;
		      let lineNumber = 1;
		      for (let i = 0; i <= text.length; i++) {
		        if (i < text.length && text.charCodeAt(i) !== 10) continue;
		        if (callback(text.slice(lineStart, i), lineNumber) === false) return false;
		        lineStart = i + 1;
		        lineNumber++;
		      }
			      return true;
			    }

			    function formatOpenLocationLabel(filePath, line, character) {
			      const displayPath = typeof filePath === 'string' && hasNonWhitespaceText(filePath) ? filePath.trim() : 'file';
			      const parsedLine = Number(line);
			      const parsedCharacter = Number(character);
			      const lineNumber = Number.isInteger(parsedLine) && parsedLine > 0 ? parsedLine : 1;
			      const characterNumber = Number.isInteger(parsedCharacter) && parsedCharacter > 0 ? parsedCharacter : 1;
			      let label = 'Open ' + displayPath + ' at line ' + lineNumber;
			      if (characterNumber > 1) label += ', character ' + characterNumber;
			      return label;
			    }

			    function formatOpenLocationAccessibleLabel(visibleLabel, filePath, line, character) {
			      const text = typeof visibleLabel === 'string' && hasNonWhitespaceText(visibleLabel) ? visibleLabel.trim() : '';
			      const action = formatOpenLocationLabel(filePath, line, character);
			      return text ? text + ', ' + action : action;
			    }

						    function setTextContent(element, text) {
					      if (!element) return;
				      const nextText = String(text === undefined || text === null ? '' : text);
				      if ((element.textContent || '') !== nextText) element.textContent = nextText;
				      if (Object.prototype.hasOwnProperty.call(element, STREAM_TEXT_CACHE_KEY)) {
				        element[STREAM_TEXT_CACHE_KEY] = nextText;
				      }
				    }

				    function appendStreamTextContent(element, text, replacePlaceholder) {
				      if (!element || text === undefined || text === null) return '';
				      const chunk = String(text);
				      if (!chunk) return '';
				      const hasCachedText = Object.prototype.hasOwnProperty.call(element, STREAM_TEXT_CACHE_KEY);
				      let currentText = hasCachedText
				        ? String(element[STREAM_TEXT_CACHE_KEY] === undefined || element[STREAM_TEXT_CACHE_KEY] === null ? '' : element[STREAM_TEXT_CACHE_KEY])
				        : String(element.textContent === undefined || element.textContent === null ? '' : element.textContent);
				      if (!hasCachedText && replacePlaceholder && currentText === '…') {
				        currentText = '';
				        element.textContent = '';
				      }
				      const nextText = currentText + chunk;
				      element[STREAM_TEXT_CACHE_KEY] = nextText;

				      const lastChild = element.lastChild;
				      if (lastChild && lastChild.nodeType === 3) {
				        lastChild.nodeValue = String(lastChild.nodeValue === undefined || lastChild.nodeValue === null ? '' : lastChild.nodeValue) + chunk;
				      } else {
				        element.appendChild(document.createTextNode(chunk));
				      }
				      return nextText;
				    }

			    function setTitle(element, title) {
			      if (!element) return;
			      const nextTitle = String(title === undefined || title === null ? '' : title);
			      if ((element.title || '') !== nextTitle) element.title = nextTitle;
			    }

				    function setValue(element, value) {
				      if (!element) return;
				      const nextValue = String(value === undefined || value === null ? '' : value);
				      if ((element.value || '') !== nextValue) element.value = nextValue;
				    }

				    function setPlaceholder(element, placeholder) {
				      if (!element) return;
				      const nextPlaceholder = String(placeholder === undefined || placeholder === null ? '' : placeholder);
				      if ((element.placeholder || '') !== nextPlaceholder) element.placeholder = nextPlaceholder;
				    }

				    function setChecked(element, checked) {
				      if (!element) return;
				      const nextChecked = !!checked;
				      if (!!element.checked !== nextChecked) element.checked = nextChecked;
				    }

					    function setAttributeValue(element, name, value) {
				      if (!element) return;
				      const attrName = String(name || '');
				      if (!attrName) return;
				      const nextValue = String(value === undefined || value === null ? '' : value);
				      if (element.getAttribute && element.getAttribute(attrName) === nextValue) return;
				      element.setAttribute(attrName, nextValue);
				    }

				    function removeAttributeValue(element, name) {
				      if (!element) return;
				      const attrName = String(name || '');
				      if (!attrName) return;
				      if (element.hasAttribute && !element.hasAttribute(attrName)) return;
				      if (element.removeAttribute) element.removeAttribute(attrName);
				    }

		    function setInputHintState(visible, text) {
		      if (!inputHint) return;
		      const nextVisible = !!visible;
		      if (inputHintVisible !== nextVisible) {
		        inputHintVisible = nextVisible;
		        if (inputHint.classList) {
		          inputHint.classList.toggle('hidden', !nextVisible);
		        }
		      }
		      if (!nextVisible) return;

			      const nextText = String(text === undefined || text === null ? '' : text);
		      if (inputHintText !== nextText) {
		        inputHintText = nextText;
		        inputHint.textContent = nextText;
		      }
		    }

			    function hasNonWhitespaceText(value) {
			      const text = String(value || '');
			      for (let index = 0; index < text.length; index++) {
			        if (!isWhitespaceChar(text[index])) return true;
			      }
			      return false;
			    }

		    function getComposerInputState() {
		      const connected = initReceived;
		      const submissionPending = !!pendingComposerSubmission;
		      const attachmentReadPending = pendingImageAttachmentOperations > 0;
		      const showPlanUpdate = planPending && currentMode === 'plan';
		      const hasText = hasNonWhitespaceText(input.value);
		      const hasContent = showPlanUpdate
		        ? hasText
		        : (hasText || pendingImageAttachments.length > 0);
			      const queuedCount = getCurrentRenderableQueueCount();
		      const showNotice = !!inputNoticeMessage;
		      const showHint = connected && (showNotice || submissionPending || attachmentReadPending || isProcessing || queuedCount === 0);
		      const hintText = showNotice
		        ? inputNoticeMessage
		        : submissionPending
		          ? 'Sending message...'
		        : attachmentReadPending
		          ? 'Attaching images...'
		        : showPlanUpdate
		          ? 'Answer plan questions · Enter to update plan · Shift+Enter for newline'
		          : isProcessing
		            ? 'Enter to queue another message · ' + queuedCount + ' queued · Attach images · Stop button or Ctrl/Cmd+. to stop'
		            : skillsEnabled
		              ? 'Enter to send · Shift+Enter for newline · Paste or attach images · /goal for goals · $ for skills'
		              : 'Enter to send · Shift+Enter for newline · Paste or attach images · /goal for goals';
		      return {
		        connected,
		        submissionPending,
		        attachmentReadPending,
		        showPlanUpdate,
		        hasText,
		        hasContent,
		        showHint,
		        hintText,
		      };
		    }

		    function syncComposerInputState() {
		      const state = getComposerInputState();
		      setDisabled(input, !state.connected);
		      const nextPlaceholder = state.connected
		        ? (state.showPlanUpdate ? 'Answer plan questions / add constraints…' : defaultPlaceholder)
		        : 'Connecting…';
		      setPlaceholder(input, nextPlaceholder);
		      setClearInputButtonDisabled(
		        !state.connected ||
		        state.attachmentReadPending ||
		        (!state.hasText && pendingImageAttachments.length === 0)
		      );
		      setDisabled(goalCommandInsert, !state.connected);
		      updateGoalCommandSuggestion();
		      setDisabled(attachImageButton, !state.connected || state.submissionPending || state.attachmentReadPending);
		      setDisabled(imageFileInput, !state.connected || state.submissionPending || state.attachmentReadPending);
		      if (!state.connected || state.submissionPending || state.attachmentReadPending) clearInputImageDragState();
		      setInputHintState(state.showHint, state.hintText);

		      if (!state.connected) {
			        setSendButtonPresentation('…', 'Connecting', 'Connecting…', 'Connecting');
			        setSendButtonDisabled(true);
			        if (stopBtn) {
			          setStopButtonVisible(false);
			          setDisabled(stopBtn, true);
			        }
		        return;
		      }

			      if (stopBtn) {
			        if (isProcessing) {
			          setStopButtonVisible(true);
			          setDisabled(stopBtn, abortRequestPending);
			        } else {
			          setStopButtonVisible(false);
			          setDisabled(stopBtn, true);
			        }
		      }

		      if (state.submissionPending) {
		        setSendButtonPresentation('...', 'Sending', 'Waiting for message acceptance', 'Sending message');
		      } else if (state.attachmentReadPending) {
		        setSendButtonPresentation('...', 'Attaching', 'Waiting for image attachments', 'Attaching images');
		      } else if (state.showPlanUpdate) {
		        setSendButtonPresentation('↻', 'Update Plan', 'Enter to update the plan; Shift+Enter for newline', 'Update Plan, update the plan');
		      } else if (isProcessing) {
		        setSendButtonPresentation('⏸', 'Queue', 'Queue input to run after the current task finishes', 'Queue, queue input');
		      } else {
		        setSendButtonPresentation('→', 'Send', 'Enter to send; Shift+Enter for newline', 'Send, send message');
		      }
		      setSendButtonDisabled(state.submissionPending || state.attachmentReadPending || !state.hasContent);
		    }

	    function syncInputState() {
		      const connected = initReceived;
		      syncComposerInputState();
		      const submissionPending = !!pendingComposerSubmission;
		      const attachmentReadPending = pendingImageAttachmentOperations > 0;
		      const routingControlsBusy = isProcessing || submissionPending || attachmentReadPending;
		      const sessionActionBusy = !!sessionActionPending;
		      if ((!connected || routingControlsBusy || sessionActionBusy) && sessionClearConfirmAction) {
			        setSessionClearConfirmAction('', { sync: false, restoreFocus: false });
		      }
		      const sessionControlsDisabled = !connected || routingControlsBusy || sessionActionBusy;
		      setDisabled(newSessionBtn, sessionControlsDisabled);
		      setDisabled(compactSessionBtn, sessionControlsDisabled);
		      const revertActionBusy = !!revertActionPending;
		      setDisabled(undoBtn, !connected || isProcessing || revertActionBusy || !canUndo);
		      setDisabled(redoBtn, !connected || isProcessing || revertActionBusy || !canRedo);
		      setDisabled(sessionSelect, !connected || routingControlsBusy || sessionSwitchPending);
		      setDisabled(sessionSettings, !connected || isProcessing);
		      const sessionsPersistDisabled = !connected || isProcessing || hasPendingSettingState('sessionsPersistState');
		      setDisabled(sessionsPersistToggle, sessionsPersistDisabled);
		      setDisabledClass(sessionsPersistLabel, sessionsPersistDisabled);
		      const sessionRetentionDisabled = !connected || isProcessing || hasPendingSettingState('sessionRetentionState');
		      setDisabled(sessionsMaxSessionsInput, sessionRetentionDisabled);
		      setDisabled(sessionsMaxSessionBytesInput, sessionRetentionDisabled);
		      setDisabled(sessionSettingsApply, sessionRetentionDisabled);
		      setDisabled(sessionClearCurrentBtn, sessionControlsDisabled);
		      setDisabled(sessionClearSavedBtn, sessionControlsDisabled);
		      setDisabled(sessionClearCancelBtn, sessionControlsDisabled);
		      setDisabled(sessionClearConfirmRunBtn, sessionControlsDisabled);
		      if (!connected || isProcessing) closeSessionSettingsPopover();
		      const providerSettingsStatePending =
		        hasPendingSettingState('codexSubscriptionSettingsState') ||
		        hasPendingSettingState('openAICompatibleSettingsState');
		      const providerSettingsDisabled = !connected || routingControlsBusy || providerSwitchPending || providerSettingsStatePending;
		      setDisabled(providerSelect, providerSettingsDisabled);
		      setDisabled(providerSettings, providerSettingsDisabled);
		      setDisabled(codexDefaultModelInput, providerSettingsDisabled);
		      setDisabledClass(codexDefaultModelLabel, providerSettingsDisabled);
		      setDisabled(openAIBaseURLInput, providerSettingsDisabled);
		      setDisabledClass(openAIBaseURLLabel, providerSettingsDisabled);
		      setDisabled(openAIDefaultModelInput, providerSettingsDisabled);
		      setDisabledClass(openAIDefaultModelLabel, providerSettingsDisabled);
		      setDisabled(openAIApiKeyEnvInput, providerSettingsDisabled);
		      setDisabledClass(openAIApiKeyEnvLabel, providerSettingsDisabled);
		      setDisabled(openAIAllowInsecureTLSInput, providerSettingsDisabled);
		      setDisabledClass(openAIAllowInsecureTLSLabel, providerSettingsDisabled);
		      setDisabled(openAIModelDisplayNamesInput, providerSettingsDisabled);
		      setDisabledClass(openAIModelDisplayNamesLabel, providerSettingsDisabled);
		      setDisabled(providerSettingsApply, providerSettingsDisabled);
		      if (!connected || isProcessing || providerSwitchPending) closeProviderSettingsPopover();
		      const safetyControlsDisabled = !connected || isProcessing || hasPendingSettingState('autoApproveState') || hasPendingSettingState('allowExternalPathsState') || hasPendingSettingState('blockGitPushState');
		      setDisabled(safetySelect, safetyControlsDisabled);
		      setDisabled(safetySettings, safetyControlsDisabled);
		      setDisabled(allowExternalPathsToggle, safetyControlsDisabled);
		      setDisabledClass(allowExternalPathsLabel, safetyControlsDisabled);
		      setDisabled(blockGitPushToggle, safetyControlsDisabled);
		      setDisabledClass(blockGitPushLabel, safetyControlsDisabled);
		      const debugDisabled = !connected || isProcessing || debugSettingsPending;
		      const debugStreamDisabled = debugDisabled || debugSettings.details;
		      setDisabled(debugDetailsToggle, debugDisabled);
		      setDisabledClass(debugDetailsLabel, debugDisabled);
		      setDisabled(debugLlmToggle, debugStreamDisabled);
		      setDisabledClass(debugLlmLabel, debugStreamDisabled);
		      setDisabled(debugToolsToggle, debugStreamDisabled);
		      setDisabledClass(debugToolsLabel, debugStreamDisabled);
		      setDisabled(debugPluginsToggle, debugStreamDisabled);
		      setDisabledClass(debugPluginsLabel, debugStreamDisabled);
			      setDisabled(showLogsBtn, !connected || showLogsPending);
			      const showLogsText = showLogsPending ? 'Opening logs…' : 'Show logs';
			      setTextContent(showLogsBtn, showLogsText);
			      setAttributeValue(showLogsBtn, 'aria-label', showLogsText + ', open the LingYun output channel');
		      setDisabled(listToolsBtn, !connected || isProcessing || toolsCatalogRequestPending);
		      setDisabled(runToolBtn, !connected || isProcessing || toolsCatalogRequestPending || manualToolRunBusy || !!pendingManualToolConfirmation);
		      setDisabled(createToolsConfigBtn, !connected || isProcessing || toolsCatalogRequestPending);
		      setToolsCatalogControlsDisabled(!connected || isProcessing || toolsCatalogRequestPending || manualToolRunBusy || !!pendingManualToolConfirmation);
		      setAutoApprovedToolsControlsDisabled(!connected || isProcessing);
		      const pluginSettingsDisabled = !connected || isProcessing || pluginSettingsPending;
		      setDisabled(pluginsAutoDiscoverToggle, pluginSettingsDisabled);
		      setDisabledClass(pluginsAutoDiscoverLabel, pluginSettingsDisabled);
		      setDisabled(pluginsWorkspaceDirInput, pluginSettingsDisabled);
		      setDisabledClass(pluginsWorkspaceDirLabel, pluginSettingsDisabled);
		      setDisabled(pluginSpecsInput, pluginSettingsDisabled);
		      setDisabledClass(pluginSpecsLabel, pluginSettingsDisabled);
		      setDisabled(pluginSettingsApply, pluginSettingsDisabled);
		      const toolLimitsDisabled = !connected || isProcessing ||
		        hasPendingSettingState('toolRuntimeLimitsState') ||
		        hasPendingSettingState('toolFilterState') ||
		        hasPendingSettingState('workspaceEnvState');
		      setDisabled(toolFilterInput, toolLimitsDisabled);
		      setDisabledClass(toolFilterLabel, toolLimitsDisabled);
		      setDisabled(toolFilterApply, toolLimitsDisabled);
		      setDisabled(workspaceEnvInput, toolLimitsDisabled);
		      setDisabledClass(workspaceEnvLabel, toolLimitsDisabled);
		      setDisabled(workspaceEnvApply, toolLimitsDisabled);
		      setDisabled(toolTimeoutMsInput, toolLimitsDisabled);
		      setDisabledClass(toolTimeoutMsLabel, toolLimitsDisabled);
		      setDisabled(readMaxLinesInput, toolLimitsDisabled);
		      setDisabledClass(readMaxLinesLabel, toolLimitsDisabled);
		      setDisabled(bashBackgroundTtlMsInput, toolLimitsDisabled);
		      setDisabledClass(bashBackgroundTtlMsLabel, toolLimitsDisabled);
		      setDisabled(bashBackgroundCaptureMsInput, toolLimitsDisabled);
		      setDisabledClass(bashBackgroundCaptureMsLabel, toolLimitsDisabled);
		      setDisabled(bashBackgroundCaptureLinesInput, toolLimitsDisabled);
		      setDisabledClass(bashBackgroundCaptureLinesLabel, toolLimitsDisabled);
		      setDisabled(workspaceShellTimeoutMsInput, toolLimitsDisabled);
		      setDisabledClass(workspaceShellTimeoutMsLabel, toolLimitsDisabled);
		      setDisabled(httpTimeoutMsInput, toolLimitsDisabled);
		      setDisabledClass(httpTimeoutMsLabel, toolLimitsDisabled);
		      setDisabled(toolLimitsApply, toolLimitsDisabled);
		      if (!connected || isProcessing) closeSafetySettingsPopover();
		      const instructionFileDisabled = !connected || isProcessing ||
		        hasPendingSettingState('instructionPatternsState') ||
		        hasPendingSettingState('instructionFileSettingsState');
		      setInstructionFileInputsDisabled(instructionFileDisabled);
			      const thinkingDisabled = !connected || isProcessing || hasPendingSettingState('showThinkingState');
			      setDisabled(thinkingToggle, thinkingDisabled);
			      setDisabledClass(thinkingLabel, thinkingDisabled);
			      const memoriesFeatureDisabled = !connected || isProcessing || hasPendingSettingState('memoriesFeatureState') || hasPendingSettingState('memoryAutoRecallState');
			      setDisabled(memoriesFeatureToggle, memoriesFeatureDisabled);
			      setDisabledClass(memoriesFeatureLabel, memoriesFeatureDisabled);
			      const memoryControlsDisabled = memoriesFeatureDisabled ||
			        !memoriesFeatureEnabled ||
			        memoryActionBusy ||
			        hasPendingSettingState('memoryAutoRecallBudgetState') ||
			        hasPendingSettingState('memoryAutoRecallFiltersState') ||
			        hasPendingSettingState('memoryAdvancedLimitsState');
			      setDisabled(memoryAutoRecallToggle, memoryControlsDisabled);
			      setDisabledClass(memoryAutoRecallLabel, memoryControlsDisabled);
			      setDisabled(memoryAutoRecallMaxResultsInput, memoryControlsDisabled);
			      setDisabledClass(memoryAutoRecallMaxResultsLabel, memoryControlsDisabled);
			      setDisabled(memoryAutoRecallMaxTokensInput, memoryControlsDisabled);
			      setDisabledClass(memoryAutoRecallMaxTokensLabel, memoryControlsDisabled);
			      setDisabled(memoryAutoRecallMinScoreInput, memoryControlsDisabled);
			      setDisabledClass(memoryAutoRecallMinScoreLabel, memoryControlsDisabled);
			      setDisabled(memoryAutoRecallMinScoreGapInput, memoryControlsDisabled);
			      setDisabledClass(memoryAutoRecallMinScoreGapLabel, memoryControlsDisabled);
			      setDisabled(memoryAutoRecallMaxAgeDaysInput, memoryControlsDisabled);
			      setDisabledClass(memoryAutoRecallMaxAgeDaysLabel, memoryControlsDisabled);
				      for (let memoryLimitInputIndex = 0; memoryLimitInputIndex < memoryAdvancedLimitInputs.length; memoryLimitInputIndex++) {
				        const memoryLimitInput = memoryAdvancedLimitInputs[memoryLimitInputIndex];
				        setDisabled(memoryLimitInput, memoryControlsDisabled);
			      }
				      if (memoryControlsDisabled && memoryDropConfirmPending) {
				        setMemoryDropConfirmPending(false, { sync: false, restoreFocus: false });
			      }
			      setDisabled(memoryAdvancedLimitsApply, memoryControlsDisabled);
			      setDisabled(memoryUpdateNowBtn, memoryControlsDisabled);
			      setDisabled(memoryDropBtn, memoryControlsDisabled);
			      setDisabled(memoryDropCancelBtn, memoryControlsDisabled);
			      setDisabled(memoryDropConfirmRunBtn, memoryControlsDisabled);
				      for (let memoryLimitLabelIndex = 0; memoryLimitLabelIndex < memoryAdvancedLimitLabels.length; memoryLimitLabelIndex++) {
				        const memoryLimitLabel = memoryAdvancedLimitLabels[memoryLimitLabelIndex];
				        setDisabledClass(memoryLimitLabel, memoryControlsDisabled);
			      }
			      const explorePrepassDisabled = !connected || isProcessing || hasPendingSettingState('explorePrepassState');
			      setDisabled(explorePrepassToggle, explorePrepassDisabled);
			      setDisabledClass(explorePrepassLabel, explorePrepassDisabled);
			      setDisabled(explorePrepassMaxCharsInput, explorePrepassDisabled);
			      setDisabledClass(explorePrepassMaxCharsLabel, explorePrepassDisabled);
			      const subagentModelOverrideDisabled = !connected || isProcessing || hasPendingSettingState('subagentModelOverrideState');
			      const subagentTaskMaxOutputCharsDisabled = !connected || isProcessing || hasPendingSettingState('subagentTaskMaxOutputCharsState');
			      setDisabled(subagentModelOverrideInput, subagentModelOverrideDisabled);
			      setDisabledClass(subagentModelOverrideLabel, subagentModelOverrideDisabled);
			      setDisabled(subagentTaskMaxOutputCharsInput, subagentTaskMaxOutputCharsDisabled);
			      setDisabledClass(subagentTaskMaxOutputCharsLabel, subagentTaskMaxOutputCharsDisabled);
			      const autoCompactionDisabled = !connected || isProcessing || hasPendingSettingState('autoCompactionState');
			      setDisabled(autoCompactionToggle, autoCompactionDisabled);
			      setDisabledClass(autoCompactionLabel, autoCompactionDisabled);
			      const modelLimitsDisabled = !connected || isProcessing || hasPendingSettingState('modelLimitsState');
			      setDisabled(modelLimitsInput, modelLimitsDisabled);
			      setDisabled(modelLimitsApply, modelLimitsDisabled);
			      setDisabledClass(modelLimitsLabel, modelLimitsDisabled);
			      const compactionPruneDisabled = !connected || isProcessing || hasPendingSettingState('compactionPruneState');
			      setDisabled(compactionPruneToggle, compactionPruneDisabled);
			      setDisabledClass(compactionPruneLabel, compactionPruneDisabled);
			      setDisabled(compactionPruneProtectTokensInput, compactionPruneDisabled);
			      setDisabledClass(compactionPruneProtectTokensLabel, compactionPruneDisabled);
			      setDisabled(compactionPruneMinimumTokensInput, compactionPruneDisabled);
			      setDisabledClass(compactionPruneMinimumTokensLabel, compactionPruneDisabled);
			      const compactionToolOutputModeDisabled = !connected || isProcessing || hasPendingSettingState('compactionToolOutputModeState');
			      setDisabled(compactionToolOutputModeSelect, compactionToolOutputModeDisabled);
			      setDisabledClass(compactionToolOutputModeLabel, compactionToolOutputModeDisabled);
			      const planFirstDisabled = !connected || isProcessing || hasPendingSettingState('planFirstState');
			      setDisabled(planFirstToggle, planFirstDisabled);
			      setDisabledClass(planFirstLabel, planFirstDisabled);
			      const modelControlsDisabled = !connected || routingControlsBusy || modelSwitchPending || modelFavoritePending || modelPickerRefreshPending || modelPickerOpenPending;
			      setDisabled(modelPicker, modelControlsDisabled);
			      setDisabled(reasoningEffortSelect, !connected || routingControlsBusy || reasoningEffortPending || modelSwitchPending);
				      setDisabled(modelFavoriteToggle, modelControlsDisabled || !currentModel);
			      setDisabled(modelSettings, modelControlsDisabled);
			      setCustomModelInputsDisabled(!connected || routingControlsBusy || modelSwitchPending);
			      setDisabled(customModelApply, !connected || routingControlsBusy || modelSwitchPending);
			      setDisabled(modelRefreshList, modelControlsDisabled);
				      setDisabled(modelClearRecents, getModelClearRecentsDisabled(modelControlsDisabled));
			      setDisabled(modelPickerSearchInput, modelControlsDisabled);
				      setDisabledClass(modelPickerSearchLabel, modelControlsDisabled);
				      setModelPickerListControlsDisabled(modelControlsDisabled);
			      const generationSettingsDisabled = !connected || isProcessing || hasPendingSettingState('generationSettingsState');
			      setDisabled(modelSettingsApply, generationSettingsDisabled);
			      setGenerationInputsDisabled(generationSettingsDisabled);
			      setDisabled(modelSettingsOpenSettings, !connected || isProcessing || advancedModelSettingsPending);
				      if (!connected || isProcessing) closeModelSettingsPopover();
				      const modeControlsDisabled = !connected || routingControlsBusy || modeSwitchPending;
				      setDisabled(modePlanBtn, modeControlsDisabled);
				      setDisabled(modeBuildBtn, modeControlsDisabled);
				      setDisabled(contextIndicator, !connected);
			      setDisabled(contextCompactNowBtn, !connected || isProcessing || sessionActionBusy);
		      const canAuthenticate =
		        connected &&
		        !isProcessing &&
		        !providerAuthBusy &&
		        !!currentProviderAuth &&
		        currentProviderAuth.status !== 'hidden' &&
		        !currentProviderAuth.authenticated;
		      const providerAuthPrimaryConnected = !!(currentProviderAuth && currentProviderAuth.authenticated);
		      setDisabled(providerAuthPrimary, providerAuthPrimaryConnected || !canAuthenticate);
		      const canDisconnect =
		        connected &&
		        !isProcessing &&
		        !providerAuthBusy &&
		        !!currentProviderAuth &&
		        currentProviderAuth.authenticated;
		      setDisabled(providerAuthSecondary, !canDisconnect);
		      setDisabled(
		        operationStopBtn,
		        !connected ||
		          !isProcessing ||
		          abortRequestPending ||
		          !currentOperation ||
		          (currentOperation.status || 'running') !== 'running'
		      );
		      syncRevertBarButtons();
		      updateApprovalBanner();

		      const skillsEnabledDisabled = !connected || isProcessing || hasPendingSettingState('skillsEnabledState');
		      setDisabled(skillsToggle, skillsEnabledDisabled);
		      setDisabledClass(skillsToggleLabel, skillsEnabledDisabled);
		      const skillsSettingsDisabled = !connected || isProcessing ||
		        hasPendingSettingState('skillsEnabledState') ||
		        hasPendingSettingState('skillsBudgetState') ||
		        hasPendingSettingState('skillSearchPathsState');
		      setDisabled(skillsSettings, skillsSettingsDisabled);
		      setDisabled(skillsMaxPromptInput, skillsSettingsDisabled);
		      setDisabled(skillsMaxInjectInput, skillsSettingsDisabled);
		      setDisabled(skillsMaxInjectCharsInput, skillsSettingsDisabled);
		      setDisabled(skillSearchPathsInput, skillsSettingsDisabled);
		      setDisabledClass(skillSearchPathsLabel, skillsSettingsDisabled);
		      setDisabled(skillsSettingsApply, skillsSettingsDisabled);
		      if (!connected || isProcessing) closeSkillsSettingsPopover();

	    }

		    function findSessionOptionById(options, sessionId) {
		      if (!options) return null;
		      for (let i = 0; i < options.length; i++) {
		        const option = options[i];
		        if (option && option.value === sessionId) return option;
		      }
		      return null;
		    }

		    function getSessionOptionFallbackBaseLabel(option) {
		      let label = String(option && option.textContent ? option.textContent : '');
		      if (label.startsWith('◉ ')) {
		        label = label.substring(2);
		      }
		      return label;
		    }

		    function isCachedCurrentSessionOptionValid(option) {
		      if (!option || option.value !== currentSessionId) return false;
		      if (!sessionSelect) return false;
		      if (typeof sessionSelect.contains === 'function') return sessionSelect.contains(option);
		      const children = sessionSelect.children;
		      if (!children) return false;
		      for (let i = 0; i < children.length; i++) {
		        if (children[i] === option) return true;
		      }
		      return false;
		    }

		    function getCurrentSessionOption(sessionOptions) {
		      if (isCachedCurrentSessionOptionValid(currentSessionOption)) return currentSessionOption;
		      currentSessionOption = findSessionOptionById(sessionOptions, currentSessionId);
		      return currentSessionOption;
		    }

		    function setProcessing(val) {
		      const nextProcessing = !!val;
		      if (isProcessing === nextProcessing) {
		        syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
		        return;
		      }
		      isProcessing = nextProcessing;
		      const currentQueueInputsRenderState =
		        isQueueInputsRenderState(lastQueueInputsRenderState) && lastQueueInputsRenderState.list === queuedInputs
		          ? lastQueueInputsRenderState
		          : queuedInputs;
		      try { setQueueState(currentQueueInputsRenderState, { sync: false }); } catch {}
		      syncInputState();
		      updateApprovalBanner();
		      syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
		      let activeSessionOption = isCachedCurrentSessionOptionValid(currentSessionOption) ? currentSessionOption : null;
		      if (!activeSessionOption) {
		        const sessionOptions = sessionSelect ? sessionSelect.options : null;
		        if (sessionOptions && sessionOptions.length > 0) {
		          activeSessionOption = getCurrentSessionOption(sessionOptions);
		        }
		      }
	        if (activeSessionOption) {
	          const rememberedLabel = activeSessionOption.__lingyunSessionBaseLabel === undefined || activeSessionOption.__lingyunSessionBaseLabel === null
	            ? ''
	            : String(activeSessionOption.__lingyunSessionBaseLabel);
	          const label = rememberedLabel || getSessionOptionFallbackBaseLabel(activeSessionOption);
		          setTextContent(activeSessionOption, nextProcessing ? '◉ ' + label : label);
	        }
	      updateOperationBanner();
	    }

	    function setPlanPending(val) {
	      planPending = val;
	      syncInputState();
	      if (planPending && !isProcessing) {
	        focusComposerInput();
	      }
	    }

	    function syncRevertBarButtons() {
	      const enabled = initReceived && !isProcessing && !revertActionPending && !!currentRevertState;
	      if (!enabled && revertDiscardConfirmPending) {
	        setRevertDiscardConfirmPending(false, { sync: false, restoreFocus: false });
	      }
	      const redoDisabled = !enabled || !canRedo;
	      const actionDisabled = !enabled;
	      const nextRevertBarButtonsKeyBuilder = createCompactRenderStateKeyBuilder();
	      appendCompactRenderStateKeyPart(nextRevertBarButtonsKeyBuilder, redoDisabled ? 1 : 0);
	      appendCompactRenderStateKeyPart(nextRevertBarButtonsKeyBuilder, actionDisabled ? 1 : 0);
	      const nextRevertBarButtonsKey = finishCompactRenderStateKey(nextRevertBarButtonsKeyBuilder);
	      if (nextRevertBarButtonsKey === lastRevertBarButtonsKey) return;
	      lastRevertBarButtonsKey = nextRevertBarButtonsKey;
	      setDisabled(revertRedoBtn, redoDisabled);
	      setDisabled(revertRedoAllBtn, redoDisabled);
	      setDisabled(revertDiffBtn, actionDisabled);
	      setDisabled(revertDiscardBtn, actionDisabled);
	      setDisabled(revertDiscardCancelBtn, actionDisabled);
	      setDisabled(revertDiscardConfirmRunBtn, actionDisabled);
	    }

			    function getRevertBarSummary(revertedMessages, fileCount) {
			      const plural = (n, word) => (n === 1 ? word : word + 's');
			      if (fileCount > 0) {
			        return 'Undid ' + revertedMessages + ' ' + plural(revertedMessages, 'message') + ' and reverted ' + fileCount + ' ' + plural(fileCount, 'file') + '.';
			      }
			      return 'Undid ' + revertedMessages + ' ' + plural(revertedMessages, 'message') + '.';
			    }

			    function normalizeRevertCount(value) {
			      const count = Number(value);
			      return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
			    }

			    function getRevertFileDisplayPath(path) {
			      const value = formatFilePath(path);
			      return value.length <= REVERT_FILE_PATH_DISPLAY_LIMIT
			        ? value
			        : value.slice(0, REVERT_FILE_PATH_DISPLAY_LIMIT) + '…';
			    }

			    function getRevertBarRenderKey(state) {
			      const value = state && state.active ? state : null;
			      if (!value) return 'inactive';
			      const revertedMessages = normalizeRevertCount(value.revertedMessages);
			      const files = Array.isArray(value.files) ? value.files : [];
			      const fileCount = files.length;
			      const summary = getRevertBarSummary(revertedMessages, fileCount);
			      const key = createCompactRenderStateKeyBuilder();
			      appendCompactRenderStateKeyPart(key, revertedMessages);
			      appendCompactRenderStateKeyPart(key, summary);
			      appendCompactRenderStateKeyPart(key, fileCount);
		      const maxFiles = 8;
		      const renderedFilesCount = Math.min(fileCount, maxFiles);
			      for (let index = 0; index < renderedFilesCount; index++) {
			        const file = files[index] || {};
				        appendCompactRenderStateKeyPart(key, file.path || '');
				        appendCompactRenderStateKeyPart(key, normalizeRevertCount(file.additions));
				        appendCompactRenderStateKeyPart(key, normalizeRevertCount(file.deletions));
					      }
				      return finishCompactRenderStateKey(key);
				    }

			    function setRevertBarVisible(visible) {
			      if (!revertBar) return;
			      const visibleFlag = !!visible;
			      if (revertBarVisible === visibleFlag) return;
			      revertBarVisible = visibleFlag;
			      revertBar.classList.toggle('hidden', !visibleFlag);
			    }

				    function updateRevertBar(state) {
			      currentRevertState = state && state.active ? state : null;
			      if (!revertBar) return;

	      if (!currentRevertState) {
	        setRevertBarVisible(false);
	        const hadActiveRevertState = lastRevertBarRenderKey && lastRevertBarRenderKey !== 'inactive';
	        if (lastRevertBarRenderKey !== 'inactive') {
          setTextContent(revertSummary, '');
          if (hadActiveRevertState) setTextContent(revertStatus, 'No undone messages.');
          setElementHidden(revertFiles, true);
          if (revertFilesList && revertFilesList.firstChild) replaceElementChildren(revertFilesList);
          lastRevertBarRenderKey = 'inactive';
        }
	        if (revertDiscardConfirmPending) setRevertDiscardConfirmPending(false, { sync: false, restoreFocus: false });
	        syncRevertBarButtons();
	        return;
	      }

		      setRevertBarVisible(true);

		      const revertedMessages = normalizeRevertCount(currentRevertState.revertedMessages);
	      const files = Array.isArray(currentRevertState.files) ? currentRevertState.files : [];
	      const fileCount = files.length;

		      const summary = getRevertBarSummary(revertedMessages, fileCount);
		      const maxFiles = 8;
		      const renderedFilesCount = Math.min(fileCount, maxFiles);
		      const nextRevertBarRenderKey = getRevertBarRenderKey(currentRevertState);

	      if (nextRevertBarRenderKey === lastRevertBarRenderKey) {
	        syncRevertBarButtons();
	        return;
	      }
	      lastRevertBarRenderKey = nextRevertBarRenderKey;
	      setTextContent(revertSummary, summary);
	      setTextContent(revertStatus, summary);

	      if (revertFiles) {
	        setElementHidden(revertFiles, fileCount === 0);
        if (fileCount === 0) {
          setTextContent(revertFilesSummary, '');
          if (revertFilesList && revertFilesList.firstChild) replaceElementChildren(revertFilesList);
        } else {
          setTextContent(revertFilesSummary, 'Reverted files (' + fileCount + ')');

	          if (revertFilesList) {
	            const fragment = renderedFilesCount > 1 || fileCount > maxFiles ? document.createDocumentFragment() : null;
	            let singleFileRow = null;
	            for (let index = 0; index < renderedFilesCount; index++) {
              const file = files[index] || {};
              const row = document.createElement('div');
              row.className = 'revert-file';
              row.setAttribute('role', 'listitem');

              const rawPath = String(file.path || '');
              const displayPath = getRevertFileDisplayPath(rawPath);
              const pathEl = document.createElement('span');
              pathEl.className = 'revert-path';
              pathEl.textContent = displayPath;
              pathEl.title = displayPath;

              const stats = document.createElement('span');
              stats.className = 'revert-stats';

              const add = document.createElement('span');
              add.className = 'revert-add';
	              const additions = normalizeRevertCount(file.additions);
	              add.textContent = '+' + additions;

	              const del = document.createElement('span');
	              del.className = 'revert-del';
	              const deletions = normalizeRevertCount(file.deletions);
              del.textContent = '-' + deletions;
              row.setAttribute(
                'aria-label',
                (displayPath || 'File') + ', ' +
                  additions + (additions === 1 ? ' addition, ' : ' additions, ') +
                  deletions + (deletions === 1 ? ' deletion' : ' deletions')
              );

	              stats.appendChild(add);
	              stats.appendChild(del);

		              row.appendChild(pathEl);
		              row.appendChild(stats);
		              if (fragment) {
		                fragment.appendChild(row);
		              } else {
		                singleFileRow = row;
		              }
		            }

		            if (fileCount > maxFiles) {
	              const more = document.createElement('div');
	              more.className = 'revert-more';
	              more.setAttribute('role', 'listitem');
	              const hiddenFileCount = fileCount - maxFiles;
	              more.setAttribute('aria-label', hiddenFileCount + ' more reverted ' + (hiddenFileCount === 1 ? 'file' : 'files'));
	              more.textContent = '… and ' + hiddenFileCount + ' more';
	              fragment.appendChild(more);
	            }
	            replaceElementChildren(revertFilesList, fragment || singleFileRow);
	          }
        }
      }

	      syncRevertBarButtons();
	    }
