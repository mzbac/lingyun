		    const mainChatProtocol = window.LINGYUN_CHAT_PROTOCOL;
		    let readyInterval = setInterval(() => {
		      if (!initReceived) {
		        vscode.postMessage({ type: mainChatProtocol.ready, clientInstanceId });
		      }
		    }, 2000);

		    function clearReadyInterval() {
		      if (readyInterval === null) return;
		      clearInterval(readyInterval);
		      readyInterval = null;
		    }

			    function planCardRenderKeyMatches(messageEl, renderKey) {
			      return !!renderKey
			        && !!messageEl
			        && typeof getRememberedPlanCardRenderKey === 'function'
			        && getRememberedPlanCardRenderKey(messageEl) === renderKey;
			    }

			    function rerenderPlanMessage(msg, wasNearBottomOverride, renderKeyOverride) {
			      if (!msg || msg.role !== 'plan') return false;
			      const msgEl = msg && typeof msg.id === 'string' ? messageEls.get(msg.id) : null;
			      if (!msgEl) return false;
			      const nextRenderKey = renderKeyOverride || (typeof getPlanCardRenderKey === 'function' ? getPlanCardRenderKey(msg) : '');
			      if (planCardRenderKeyMatches(msgEl, nextRenderKey)) return false;

			      const existingActivity = typeof getCachedMessagePlanActivityParts === 'function'
			        ? getCachedMessagePlanActivityParts(msgEl)
			        : null;
			      const existingBody = existingActivity ? existingActivity.body : msgEl.querySelector('.plan-activity-body');
			      let activityFragment = null;
			      const existingCount = existingBody ? existingBody.children.length : 0;
			      if (existingBody && existingBody.firstChild) {
			        activityFragment = document.createDocumentFragment();
			        while (existingBody.firstChild) {
			          activityFragment.appendChild(existingBody.firstChild);
			        }
			      }
			      const existingDetails = existingActivity ? existingActivity.details : msgEl.querySelector('.plan-activity');
			      const existingOpen = !!(existingDetails && existingDetails.open);
			      const shouldAutoScroll = typeof wasNearBottomOverride !== 'boolean';
			      const wasNearBottom = shouldAutoScroll ? isNearBottom() : wasNearBottomOverride;

		      msgEl.className = 'message plan';
		      if (msg.plan?.status) msgEl.classList.add(msg.plan.status);
		      msgEl.innerHTML = formatPlanCard(msg);
		      if (typeof hydratePlanActionPayloads === 'function') hydratePlanActionPayloads(msgEl);
		      if (nextRenderKey && typeof rememberPlanCardRenderKey === 'function') {
		        rememberPlanCardRenderKey(msgEl, nextRenderKey);
		      }

		      const nextActivity = typeof findMessagePlanActivityParts === 'function'
		        ? findMessagePlanActivityParts(msgEl)
		        : null;
		      const nextDetails = nextActivity ? nextActivity.details : msgEl.querySelector('.plan-activity');
		      if (nextDetails) {
		        nextDetails.open = existingOpen;
		        nextDetails.dataset.count = String(existingCount);
		        const countEl = nextActivity ? nextActivity.count : nextDetails.querySelector('.plan-activity-count');
		        if (countEl) countEl.textContent = existingCount > 0 ? '(' + existingCount + ')' : '';
		      }
		      const nextBody = nextActivity ? nextActivity.body : msgEl.querySelector('.plan-activity-body');
		      if (nextBody) {
		        if (activityFragment) nextBody.appendChild(activityFragment);
		        stepBodies.set(msg.id, nextBody);
		      }

			      if (shouldAutoScroll) maybeAutoScroll(wasNearBottom);
			      return true;
			    }

				    function rerenderPlanCards() {
				      let wasNearBottom;
				      let rerendered = false;
				      for (const messageId of planMessageIds) {
				        const msg = messageDataById.get(messageId);
				        if (msg && msg.role === 'plan') {
				          const msgEl = typeof msg.id === 'string' ? messageEls.get(msg.id) : null;
				          if (!msgEl) continue;
				          const nextRenderKey = typeof getPlanCardRenderKey === 'function' ? getPlanCardRenderKey(msg) : '';
				          if (planCardRenderKeyMatches(msgEl, nextRenderKey)) continue;
				          if (wasNearBottom === undefined) wasNearBottom = isNearBottom();
				          rerendered = rerenderPlanMessage(msg, wasNearBottom, nextRenderKey) || rerendered;
				        } else {
				          planMessageIds.delete(messageId);
				        }
				      }
				      if (rerendered) maybeAutoScroll(wasNearBottom);
				    }

				    const MARKDOWN_RENDER_DEBOUNCE_MS = 40;
				    const assistantMarkdownRenderQueue = new Map();
				    const streamTextRenderQueue = new Map();
					    const planActivityDetailsByToolElement = new WeakMap();

					    function findToolPlanActivityDetailsFromLayout(toolEl) {
					      const bodyEl = getParentElement(toolEl);
					      if (!hasRenderedElementClass(bodyEl, 'plan-activity-body')) return null;
					      const details = getParentElement(bodyEl);
					      if (!hasRenderedElementClass(details, 'plan-activity')) return null;
					      planActivityDetailsByToolElement.set(toolEl, details);
					      return details;
					    }

					    function getCachedToolPlanActivityDetails(toolEl) {
					      if (!toolEl) return null;
					      const cachedDetails = planActivityDetailsByToolElement.get(toolEl);
					      if (!cachedDetails || typeof cachedDetails.contains !== 'function') return null;
					      if (cachedDetails.contains(toolEl)) return cachedDetails;
					      planActivityDetailsByToolElement.delete(toolEl);
					      return null;
					    }

					    function getToolPlanActivityDetails(toolEl) {
					      const cachedDetails = getCachedToolPlanActivityDetails(toolEl);
					      if (cachedDetails) return cachedDetails;
					      const layoutDetails = findToolPlanActivityDetailsFromLayout(toolEl);
					      if (layoutDetails) return layoutDetails;
					      if (typeof getCachedClosestElement === 'function') {
					        return getCachedClosestElement(toolEl, '.plan-activity', planActivityDetailsByToolElement);
					      }
				      return toolEl && toolEl.closest ? toolEl.closest('.plan-activity') : null;
				    }

			    function clearAssistantMarkdownRenderQueue() {
			      for (const state of assistantMarkdownRenderQueue.values()) {
		        if (state && state.timer) clearTimeout(state.timer);
		      }
		      assistantMarkdownRenderQueue.clear();
		    }

		    function clearStreamTextRenderQueue() {
		      for (const state of streamTextRenderQueue.values()) {
		        if (state && state.timer) clearTimeout(state.timer);
		      }
		      streamTextRenderQueue.clear();
		    }

		    function normalizeStreamTokenText(token) {
		      return String(token === undefined || token === null ? '' : token);
		    }

		    function appendPendingToken(messageId, token) {
		      if (!messageId) return;
		      const tokenText = normalizeStreamTokenText(token);
		      if (!tokenText) return;
		      pendingTokens.set(messageId, (pendingTokens.get(messageId) || '') + tokenText);
		    }

		    function discardPendingStreamState(messageId) {
		      if (!messageId) return;
		      const state = assistantMarkdownRenderQueue.get(messageId);
		      if (state && state.timer) {
		        clearTimeout(state.timer);
		      }
		      assistantMarkdownRenderQueue.delete(messageId);
		      const textState = streamTextRenderQueue.get(messageId);
		      if (textState && textState.timer) {
		        clearTimeout(textState.timer);
		      }
		      streamTextRenderQueue.delete(messageId);
		      pendingTokens.delete(messageId);
		    }

		    function applySettingsState(data) {
		      updateModelHeader({
		        model: data.currentModel || '',
		        label: data.currentModelLabel || data.currentModel || 'Pick model',
		        isFavorite: !!data.currentModelIsFavorite,
		        reasoningEffort: data.currentReasoningEffort || '',
		      });
		      reasoningEffortPending = false;
		      modelSwitchPending = false;
			      modelFavoritePending = false;
			      providerAuthBusy = false;
			      providerSwitchPending = false;
			      clearPendingActionTimer('reasoningEffort');
			      clearPendingActionTimer('modelSwitch');
			      clearPendingActionTimer('modelFavorite');
			      clearPendingActionTimer('modelPickerOpen');
			      clearPendingActionTimer('modelPickerRefresh');
			      clearPendingActionTimer('providerAuth');
			      clearPendingActionTimer('providerSwitch');
			      updateCodexSubscriptionSettingsState(data.codexSubscriptionSettings || {});
		      updateOpenAICompatibleSettingsState(data.openAICompatibleSettings || {});
		      updateProviderSelection(data.currentProviderId || (data.providerAuth && data.providerAuth.providerId) || '');
		      updateProviderAuthHeader(data.providerAuth || null);
		      updatePlanFirstState(data.planFirst !== false);
		      updateSessionsPersistState(data.sessionsPersist !== false);
		      updateSessionRetentionState(data.sessionsMaxSessions || 20, data.sessionsMaxSessionBytes || 2000000);
		      updateAutoApproveState(!!data.autoApprove);
		      updateAllowExternalPathsState(!!data.allowExternalPaths);
		      updateBlockGitPushState(data.blockGitPush !== false);
		      debugSettingsPending = false;
		      pluginSettingsPending = false;
		      clearPendingSettingStates();
		      updateDebugSettingsState(data.debugSettings || {});
      updatePluginSettingsState(data.pluginSettings || {});
      updateToolFilterState(data.toolFilter || []);
      updateAutoApprovedToolsState(data.autoApprovedTools || []);
      if (data.toolsCatalog) updateToolsCatalogState(data.toolsCatalog);
      updateWorkspaceEnvState(data.workspaceEnv || {});
		      updateInstructionPatternsState(data.instructionPatterns || []);
		      updateInstructionFileSettingsState(data.instructionFileSettings || {});
		      updateToolRuntimeLimitsState(data.toolRuntimeLimits || {});
		      updateShowThinkingState(data.showThinking !== false);
		      updateMemoriesFeatureState(data.memoriesFeatureEnabled !== false);
		      updateMemoryAutoRecallState(data.memoryAutoRecall !== false);
		      updateMemoryAutoRecallBudgetState(data.memoryAutoRecallMaxResults || 4, data.memoryAutoRecallMaxTokens || 1200);
		      updateMemoryAutoRecallFiltersState(
		        typeof data.memoryAutoRecallMinScore === 'number' ? data.memoryAutoRecallMinScore : 7,
		        typeof data.memoryAutoRecallMinScoreGap === 'number' ? data.memoryAutoRecallMinScoreGap : 1.25,
		        typeof data.memoryAutoRecallMaxAgeDays === 'number' ? data.memoryAutoRecallMaxAgeDays : 45
		      );
      updateMemoryAdvancedLimitsState(data.memoryAdvancedLimits || {});
      updateMemoryActionStatusState(data.memoryActionStatus || null);
      updateExplorePrepassState(!!data.explorePrepass, data.explorePrepassMaxChars || 8000);

		      updateSubagentModelOverrideState(typeof data.subagentModelOverride === 'string' ? data.subagentModelOverride : '');
		      updateSubagentTaskMaxOutputCharsState(data.subagentTaskMaxOutputChars || 8000);
		      updateAutoCompactionState(data.autoCompaction !== false);
		      updateCompactionPruneState(
		        data.compactionPrune !== false,
		        typeof data.compactionPruneProtectTokens === 'number' ? data.compactionPruneProtectTokens : 40000,
		        typeof data.compactionPruneMinimumTokens === 'number' ? data.compactionPruneMinimumTokens : 20000
		      );
		      updateCompactionToolOutputModeState(data.compactionToolOutputMode || 'onCompaction');
		      updateModelLimitsState(data.modelLimits || {});
			      updateGenerationSettingsState(data.generationSettings || {});
			      updateSkillsEnabledState(data.skillsEnabled !== false);
			      updateSkillSearchPathsState(data.skillSearchPaths || []);
			      updateSkillsBudgetState(data.skillsBudget || {});
			      setMode(data.mode || 'build');
		      try { setAvailableSkills(Array.isArray(data.skills) ? data.skills : []); } catch {}
		      syncInputState();
		    }

		    function flushAssistantMarkdownRender(messageId) {
			      const state = assistantMarkdownRenderQueue.get(messageId);
			      if (!state) return;
			      if (state.timer) {
			        clearTimeout(state.timer);
			        state.timer = null;
			      }

			      const pending = state.pending || '';
			      const shouldScroll = !!state.wasNearBottom;
			      assistantMarkdownRenderQueue.delete(messageId);
			      if (!pending) return;

			      const el = messageEls.get(messageId);
			      if (!el) {
			        appendPendingToken(messageId, pending);
			        return;
			      }

			      const contentEl = getCachedMessageContentElement(el);
			      if (!contentEl || !el.classList.contains('assistant') || !contentEl.classList.contains('md')) {
			        if (contentEl) {
			          appendStreamTextContent(contentEl, pending, true);
			        } else {
			          appendPendingToken(messageId, pending);
			        }
			        maybeAutoScroll(shouldScroll);
			        return;
			      }

			      const renderInfo = renderAssistantMarkdownInto(contentEl, getAssistantMarkdownRaw(contentEl) + pending);
			      updateAssistantMessageContent(messageId, renderInfo.raw);
			      if (renderInfo.htmlChanged && typeof scheduleFileLinkify === 'function') {
			        try {
			          if (typeof scheduleFileLinkifyIfNeeded === 'function') {
			            scheduleFileLinkifyIfNeeded(el, renderInfo.raw);
			          } else {
			            scheduleFileLinkify(el);
			          }
			        } catch {}
			      }
			      maybeAutoScroll(shouldScroll);
			    }

				    function queueAssistantMarkdownToken(messageId, token, wasNearBottom) {
				      if (!messageId) return;
				      const tokenText = normalizeStreamTokenText(token);
				      if (!tokenText) return;
				      const state = assistantMarkdownRenderQueue.get(messageId) || {
				        pending: '',
				        timer: null,
				        wasNearBottom: false,
				      };
				      state.pending += tokenText;
			      state.wasNearBottom = state.wasNearBottom || !!wasNearBottom;
			      if (!state.timer) {
			        state.timer = setTimeout(() => {
			          flushAssistantMarkdownRender(messageId);
			        }, MARKDOWN_RENDER_DEBOUNCE_MS);
			      }
			      assistantMarkdownRenderQueue.set(messageId, state);
			    }

			    function flushStreamTextRender(messageId) {
			      const state = streamTextRenderQueue.get(messageId);
			      if (!state) return;
			      if (state.timer) {
			        clearTimeout(state.timer);
			        state.timer = null;
			      }

			      const pending = state.pending || '';
			      const shouldScroll = !!state.wasNearBottom;
			      const kind = state.kind || 'content';
			      streamTextRenderQueue.delete(messageId);
			      if (!pending) return;

			      const el = messageEls.get(messageId);
			      if (!el) {
			        appendPendingToken(messageId, pending);
			        return;
			      }

			      const targetEl = kind === 'thought' ? getCachedMessageThinkingTextElement(el) : getCachedMessageContentElement(el);
			      if (!targetEl) {
			        appendPendingToken(messageId, pending);
			        return;
			      }

			      const renderedText = appendStreamTextContent(targetEl, pending, kind !== 'thought');
			      if (kind !== 'thought' && typeof scheduleFileLinkify === 'function') {
			        try {
			          if (typeof scheduleFileLinkifyIfNeeded === 'function') {
			            scheduleFileLinkifyIfNeeded(el, renderedText, { appendOnly: true });
			          } else {
			            scheduleFileLinkify(el);
			          }
			        } catch {}
			      }
			      maybeAutoScroll(shouldScroll);
			    }

				    function flushPendingStreamRenders(messageId) {
				      flushAssistantMarkdownRender(messageId);
				      flushStreamTextRender(messageId);
				    }

				    function replayPendingTokenIntoRenderedMessage(messageId, messageEl, role, pending, wasNearBottom, scheduleAppendLinkify) {
				      if (!messageId || !messageEl || !pending) return false;
				      const contentEl = getCachedMessageContentElement(messageEl);
				      if (!contentEl) return false;
				      if (role === 'thought') {
				        const thinkingEl = getCachedMessageThinkingTextElement(messageEl);
				        if (!thinkingEl) return false;
				        appendStreamTextContent(thinkingEl, pending, false);
				        return true;
				      }
				      if (messageEl.classList.contains('assistant') && contentEl.classList.contains('md')) {
				        queueAssistantMarkdownToken(messageId, pending, wasNearBottom);
				        return true;
				      }
				      const renderedText = appendStreamTextContent(contentEl, pending, true);
				      if (scheduleAppendLinkify && typeof scheduleFileLinkify === 'function') {
				        try {
				          if (typeof scheduleFileLinkifyIfNeeded === 'function') {
				            scheduleFileLinkifyIfNeeded(messageEl, renderedText, { appendOnly: true });
				          } else {
				            scheduleFileLinkify(messageEl);
				          }
				        } catch {}
				      }
				      return true;
				    }

				    function queueStreamTextToken(messageId, token, wasNearBottom, kind) {
				      if (!messageId) return;
				      const tokenText = normalizeStreamTokenText(token);
				      if (!tokenText) return;
			      const state = streamTextRenderQueue.get(messageId) || {
			        pending: '',
			        timer: null,
			        wasNearBottom: false,
			        kind: kind || 'content',
			      };
			      state.pending += tokenText;
			      state.wasNearBottom = state.wasNearBottom || !!wasNearBottom;
			      state.kind = kind || state.kind || 'content';
			      if (!state.timer) {
			        state.timer = setTimeout(() => {
			          flushStreamTextRender(messageId);
			        }, MARKDOWN_RENDER_DEBOUNCE_MS);
			      }
			      streamTextRenderQueue.set(messageId, state);
			    }

			    function disposeWebviewTimers() {
			      if (typeof persistComposerDraftStateNow === 'function') {
			        try { persistComposerDraftStateNow(); } catch {}
			      }
			      if (typeof persistTranscriptPositionStateNow === 'function') {
			        try { persistTranscriptPositionStateNow(); } catch {}
			      }
			      if (typeof clearComposerDraftStateTimer === 'function') {
			        try { clearComposerDraftStateTimer(); } catch {}
			      }
			      if (typeof clearTranscriptPositionStateTimer === 'function') {
			        try { clearTranscriptPositionStateTimer(); } catch {}
			      }
			      clearReadyInterval();
			      if (typeof stopTranscriptPrependSettle === 'function') {
			        try { stopTranscriptPrependSettle(); } catch {}
			      }
			      if (typeof clearTranscriptHistoryRequestTimeout === 'function') {
			        try { clearTranscriptHistoryRequestTimeout(); } catch {}
			      }
			      clearAssistantMarkdownRenderQueue();
		      clearStreamTextRenderQueue();
			      if (typeof resetFileLinkState === 'function') {
			        try { resetFileLinkState(); } catch {}
			      }
			      if (typeof clearAllCopyFeedbackTimers === 'function') {
			        try { clearAllCopyFeedbackTimers(); } catch {}
			      }
				      if (typeof clearOutputModalCopyResetTimer === 'function') {
				        try { clearOutputModalCopyResetTimer(); } catch {}
				      }
				      if (typeof clearPopoverFocusRestoreTimer === 'function') {
				        try { clearPopoverFocusRestoreTimer(); } catch {}
				      }
				      if (typeof clearSettingsPopoverFocusRestoreTimer === 'function') {
				        try { clearSettingsPopoverFocusRestoreTimer(); } catch {}
				      }
				      if (typeof clearAllTurnTimers === 'function') {
				        try { clearAllTurnTimers(); } catch {}
				      }
		      if (typeof stopOperationTimer === 'function') {
		        try { stopOperationTimer(); } catch {}
		      }
		      if (typeof clearOperationHideTimer === 'function') {
		        try { clearOperationHideTimer(); } catch {}
		      }
		      if (typeof clearPendingSettingStates === 'function') {
		        try { clearPendingSettingStates(); } catch {}
		      }
		      if (typeof clearAllPendingActionTimers === 'function') {
		        try { clearAllPendingActionTimers(); } catch {}
		      }
		      if (typeof clearInputNotice === 'function') {
		        try { clearInputNotice(); } catch {}
		      }
		      if (typeof clearQueuedAnimationFrames === 'function') {
		        try { clearQueuedAnimationFrames(); } catch {}
		      }
		    }

		    window.addEventListener('pagehide', disposeWebviewTimers);
		    window.addEventListener('beforeunload', disposeWebviewTimers);

		    function turnHasNoPendingStatusWork(turnData) {
		      return !!turnData &&
		        !turnData.statusTimeout &&
		        !turnData.retryInfo &&
		        !turnData.retryInterval &&
		        !turnData.retryCleanupTimeout;
		    }

			    window.addEventListener('message', (e) => {
			      try {
			        const data = e.data || {};
			      switch (data.type) {
		        case '__testEval':
		          // Test-only DOM bridge: the extension host only sends this in
		          // ExtensionMode.Test, and the renderer only honors it when the
		          // test-mode flag was injected into the HTML.
		          if (window.__LINGYUN_TEST_MODE__ !== true || typeof data.id !== 'string' || typeof data.expression !== 'string') break;
		          try {
		            const result = new Function('"use strict"; return (' + data.expression + ');')();
		            vscode.postMessage({ type: '__testEvalResult', id: data.id, ok: true, value: result });
		          } catch (evalErr) {
		            vscode.postMessage({ type: '__testEvalResult', id: data.id, ok: false, error: String(evalErr && evalErr.message ? evalErr.message : evalErr) });
		          }
		          break;
		        case 'init':
				          initReceived = true;
				          clearReadyInterval();
				          const persistedTranscriptPosition = typeof readPersistedTranscriptPositionState === 'function'
				            ? readPersistedTranscriptPositionState()
				            : null;
				          if (typeof rememberPersistedTranscriptPositionState === 'function') {
				            rememberPersistedTranscriptPositionState(persistedTranscriptPosition);
				          }
				          if (typeof resetTranscriptHistoryWindow === 'function') {
				            try { resetTranscriptHistoryWindow(); } catch {}
				          }
				          if (typeof resetFileLinkState === 'function') {
				            try { resetFileLinkState(); } catch {}
					          }
					          clearAllTurnTimers();
					          turnEls.clear();
								          activeTurnId = '';
								          activeProcessingTurnId = '';
								          messageAppendTarget = null;

			          messageEls.clear();
			          clearMessageDataIndexes();
				          stepBodies.clear();
				          pendingTokens.clear();
				          clearAssistantMarkdownRenderQueue();
				          clearStreamTextRenderQueue();
				          resetLastToolBatchState();
				          currentOperation = null;
				          stopOperationTimer();
				          updateOperationBanner();
				          currentRevertState = null;
					          updateRevertBar(null);
						          activePlanMessageId = typeof data.activePlanMessageId === 'string' ? data.activePlanMessageId : '';
						          const restoredMessageList = Array.isArray(data.messages) ? data.messages : [];
						          suppressAutoScroll = true;
					          stopAutoScrollSettle();
					          setUserScrolledAway(false);
						          let restoredTranscriptHasMessages = false;
						          {
						            const renderedMessages = restoreTranscriptMessages(restoredMessageList, {
						              history: data.transcriptHistory,
						              sessionId: String(data.activeSessionId || ''),
						            });
						            setDisplay(empty, renderedMessages === 0 ? 'flex' : 'none');
						            restoredTranscriptHasMessages = renderedMessages > 0;
					          }
				          suppressAutoScroll = false;
				          const restoredTranscriptPosition = restoredTranscriptHasMessages &&
				            typeof restoreTranscriptPositionState === 'function' &&
				            restoreTranscriptPositionState(persistedTranscriptPosition, String(data.activeSessionId || ''));
				          if (restoredTranscriptHasMessages && !restoredTranscriptPosition) {
				            maybeAutoScrollAfterLayout(true);
				          } else {
				            if (!restoredTranscriptHasMessages) {
				              messages.scrollTop = 0;
				              rememberMessagesScrollTop();
				            }
				          }
	      sessionActionPending = '';
      sessionSwitchPending = false;
      revertActionPending = '';
      clearAllPendingActionTimers();
      modelPickerOpenPending = false;
      advancedModelSettingsPending = false;
      showLogsPending = false;
      abortRequestPending = false;
      approveAllPending = false;
      queueClearPending = false;
      queueSteerPendingId = '';
      if (data.sessions && data.sessions.length > 0) {
        sessionSwitchPending = false;
        updateSessionSelect(data.sessions, data.activeSessionId);
	      }
	      if (typeof restorePendingImageAttachments === 'function') {
	        restorePendingImageAttachments(data.composerAttachments);
	      }
	      if (typeof reconcileComposerSubmissionState === 'function') {
	        reconcileComposerSubmissionState(data.composerSubmissionState);
	      }
	      if (typeof scheduleTranscriptPositionStatePersistence === 'function') {
	        scheduleTranscriptPositionStatePersistence();
	      }
	      applySettingsState(data);
			      updateContextIndicatorState(data.context);

			      closeContextPopover();
			      updateTodoIndicatorState(data.todos);
			      closeTodoPopover();
		          setMode(data.mode || 'build');
		          setPlanPending(!!data.planPending);
		          setProcessing(!!data.processing);
		          try { setQueueState(Array.isArray(data.queuedInputs) ? data.queuedInputs : [], { sync: false }); } catch {}
		          try { setInputHistoryEntries(Array.isArray(data.inputHistory) ? data.inputHistory : []); } catch {}
		          try { setAvailableSkills(Array.isArray(data.skills) ? data.skills : []); } catch {}
		          pendingApprovalsCount = Number(data.pendingApprovals || 0) || 0;
		          manualApprovalsCount = Number(data.manualApprovals || 0) || 0;
		          autoApproveThisRun = !!data.autoApproveThisRun;
		          updateApprovalBanner();
		          canUndo = !!data.canUndo;
		          canRedo = !!data.canRedo;
		          updateRevertBar(data.revertState);
		          syncInputState();
		          vscode.postMessage({ type: mainChatProtocol.initAck, clientInstanceId });
		          break;
		        case 'sendState':
		          if (typeof applyComposerSubmissionState === 'function') {
		            applyComposerSubmissionState(data);
		          }
		          break;
		        case mainChatProtocol.transcriptHistoryPage:
		          if (typeof applyEarlierTranscriptPage === 'function') {
		            try { applyEarlierTranscriptPage(data); } catch {}
		          }
		          break;
		        case 'queueState':
		          const nextQueuedInputs = Array.isArray(data.queuedInputs) ? data.queuedInputs : [];
		          const nextQueueInputsRenderState = typeof getQueueInputsRenderState === 'function'
		            ? getQueueInputsRenderState(nextQueuedInputs)
		            : null;
		          const queueActionWasPending = queueClearPending || !!queueSteerPendingId;
		          if (
		            !queueActionWasPending &&
		            nextQueueInputsRenderState &&
		            typeof isQueueRenderStateCurrent === 'function' &&
		            isQueueRenderStateCurrent(nextQueueInputsRenderState)
		          ) break;
		          clearPendingActionTimer('queueAction');
		          queueClearPending = false;
		          queueSteerPendingId = '';
		          try { setQueueState(nextQueueInputsRenderState || nextQueuedInputs); } catch {}
		          break;
        case 'settingsState':
          debugSettingsPending = false;
          pluginSettingsPending = false;
          clearPendingSettingStates();
          applySettingsState(data);
          break;
		        case 'context':
		          const nextContextRenderKey = typeof getContextPopoverRenderKey === 'function'
		            ? getContextPopoverRenderKey(data.context)
		            : '';
		          if (
		            nextContextRenderKey &&
		            typeof isContextIndicatorRenderKeyCurrent === 'function' &&
		            isContextIndicatorRenderKeyCurrent(nextContextRenderKey)
		          ) break;
		          updateContextIndicatorState(data.context, nextContextRenderKey);
		          break;
	        case 'todos':
	          const nextTodoRenderState = typeof getTodoRenderState === 'function'
	            ? getTodoRenderState(data.todos)
	            : null;
	          if (
	            nextTodoRenderState &&
	            typeof isTodoIndicatorStateCurrent === 'function' &&
	            isTodoIndicatorStateCurrent(nextTodoRenderState)
	          ) break;
	          updateTodoIndicatorState(data.todos, nextTodoRenderState);
	          break;
	        case 'sessions':
	          const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
	          const nextActiveSessionId = data.activeSessionId || currentSessionId;
	          const sessionActionWasPending = !!sessionActionPending || sessionSwitchPending;
	          const nextSessionSelectRenderKey = !sessionActionWasPending &&
	            nextSessions.length > 0 &&
	            typeof getSessionSelectRenderKey === 'function'
	            ? getSessionSelectRenderKey(nextSessions, nextActiveSessionId)
	            : '';
	          if (
	            !sessionActionWasPending &&
	            nextSessions.length > 0 &&
	            nextSessionSelectRenderKey &&
	            typeof isSessionSelectRenderKeyCurrent === 'function' &&
	            isSessionSelectRenderKeyCurrent(nextSessionSelectRenderKey)
	          ) break;
	          clearPendingActionTimer('sessionSwitch');
	          sessionActionPending = '';
	          if (nextSessions.length > 0) {
	            sessionSwitchPending = false;
	            updateSessionSelect(nextSessions, nextActiveSessionId, nextSessionSelectRenderKey);
	          }
	          syncInputState();
	          break;
	        case 'inputHistory':
	          try { setInputHistoryEntries(Array.isArray(data.entries) ? data.entries : []); } catch {}
	          break;
        case 'message':
          if (!data.message || typeof data.message.id !== 'string') break;
          addMessage(data.message);
          break;
        case 'inputNotice':
          if (typeof showInputNotice === 'function') {
            showInputNotice(typeof data.message === 'string' ? data.message : '');
          }
          break;
				        case 'token':
				          const tokenText = normalizeStreamTokenText(data.token);
				          if (!data.messageId || !tokenText) break;
				          const el = messageEls.get(data.messageId);
				          if (el) {
			              const msg = messageDataById.get(data.messageId);
			              if (msg && msg.role === 'thought') {
		                const wasNearBottom = isNearBottom();
		                queueStreamTextToken(data.messageId, tokenText, wasNearBottom, 'thought');
		                break;
				            }
			              if (msg && msg.role === 'assistant') {
			                const wasNearBottom = isNearBottom();
			                queueAssistantMarkdownToken(data.messageId, tokenText, wasNearBottom);
			                break;
			              }
					            const contentEl = getCachedMessageContentElement(el);
				            let deferredStreamRender = false;
				            if (contentEl) {
				              const wasNearBottom = isNearBottom();
			                if (el.classList.contains('assistant') && contentEl.classList.contains('md')) {
			                  queueAssistantMarkdownToken(data.messageId, tokenText, wasNearBottom);
			                  deferredStreamRender = true;
			                } else {
			                  queueStreamTextToken(data.messageId, tokenText, wasNearBottom, 'content');
			                  deferredStreamRender = true;
			                }
				            }
				            if (!deferredStreamRender) {
				              const wasNearBottom = isNearBottom();
				              if (typeof scheduleFileLinkify === 'function') {
				                try { scheduleFileLinkify(el); } catch {}
				              }
				              maybeAutoScroll(wasNearBottom);
				            }
				          } else {
				            appendPendingToken(data.messageId, tokenText);
				          }
				          break;
			        case 'updateTool':
			          const updatedToolMessage = data.message;
			          if (!updatedToolMessage || typeof updatedToolMessage.id !== 'string' || !updatedToolMessage.toolCall) break;
			          let wasNearBottomToolUpdate = false;
			          let toolUpdateNeedsAutoScroll = false;
			          const markToolUpdateWillChange = () => {
			            if (toolUpdateNeedsAutoScroll) return;
			            wasNearBottomToolUpdate = isNearBottom();
			            toolUpdateNeedsAutoScroll = true;
			          };
				          rememberMessageData(updatedToolMessage);
				          const toolEl = messageEls.get(updatedToolMessage.id);
				          if (toolEl) {
			            const cardEl = getCachedMessageToolCardElement(toolEl);
			            const toolCardChanged = updateToolCardElement(cardEl, updatedToolMessage.toolCall, markToolUpdateWillChange);
		            if (toolCardChanged && typeof scheduleFileLinkify === 'function') {
		              try { scheduleFileLinkify(toolEl, { force: true }); } catch {}
		            }

		            const status = updatedToolMessage.toolCall.status;
								            if (status === 'pending' || status === 'error' || status === 'rejected') {
					              const details = getToolPlanActivityDetails(toolEl);
					              if (details && !details.open) {
				                markToolUpdateWillChange();
				                details.open = true;
			              }
			            }

				            if (status === 'pending' && updatedToolMessage.toolCall.approvalId && updatedToolMessage.turnId) {
				              const turnData = turnEls.get(updatedToolMessage.turnId);
				              if (turnData) {
				                const nextStatusText = 'Waiting approval: ' + (updatedToolMessage.toolCall.name || updatedToolMessage.toolCall.id || 'Tool');
				                const approvalStatusKey = 'approval\n' + nextStatusText;
				                const approvalStatusAlreadyCurrent = turnData.statusStateKey === approvalStatusKey && turnHasNoPendingStatusWork(turnData);
			                if (!approvalStatusAlreadyCurrent) {
			                  const statusBarWillChange = turnData.statusBar && turnData.statusBar.style && (turnData.statusBar.style.display || '') !== 'flex';
			                  const spinnerWillChange = turnData.spinner && turnData.spinner.style && (turnData.spinner.style.display || '') !== 'none';
			                  const statusTextWillChange = turnData.statusText && (turnData.statusRenderedText || '') !== nextStatusText;
			                  if (statusBarWillChange || spinnerWillChange || statusTextWillChange) markToolUpdateWillChange();
			                  turnData.currentStatus = '';
			                  turnData.statusStateKey = '';
			                  turnData.retryInfo = null;
			                  clearTurnRetryCountdown(turnData);
			                  clearTurnStatusTimeout(turnData);
			                  setDisplay(turnData.statusBar, 'flex');
			                  setDisplay(turnData.spinner, 'none');
			                  setTurnStatusText(turnData, nextStatusText);
			                  turnData.statusStateKey = approvalStatusKey;
			                }
			              }
			            }
		          }
			          if (toolUpdateNeedsAutoScroll) maybeAutoScrollAfterLayout(wasNearBottomToolUpdate);
			          break;
		        case 'resolvedFileLinks':
		          if (typeof handleResolvedFileLinks === 'function') {
		            try { handleResolvedFileLinks(data); } catch {}
		          }
		          break;
				        case 'updateMessage':
				          const updatedMessage = data.message;
				          if (!updatedMessage || typeof updatedMessage.id !== 'string') break;
				          const shouldDiscardPendingStreamState =
				            (updatedMessage.role === 'assistant' || updatedMessage.role === 'thought') &&
				            !hasNonWhitespaceText(getMessageTextContent(updatedMessage.content, ''));
					          if (shouldDiscardPendingStreamState) {
					            discardPendingStreamState(updatedMessage.id);
					          } else {
					            flushPendingStreamRenders(updatedMessage.id);
					          }
					          const previousMessage = messageDataById.get(updatedMessage.id);
					          const previousMessageRenderKey =
					            previousMessage && typeof getMessageRenderKey === 'function' ? getMessageRenderKey(previousMessage) : '';
					          rememberMessageData(updatedMessage);
				          const msgEl = messageEls.get(updatedMessage.id);
				          if (msgEl && updatedMessage.role === 'step') {
				            const status = updatedMessage.step?.status || 'running';
				            const mode = updatedMessage.step?.mode || 'Build';
				            const model = updatedMessage.step?.model || '';
				            const nextStepRenderKey = typeof getStepRenderKey === 'function' ? getStepRenderKey(updatedMessage) : '';
				            if (
				              nextStepRenderKey &&
				              typeof getRememberedStepRenderKey === 'function' &&
				              getRememberedStepRenderKey(msgEl) === nextStepRenderKey
				            ) {
				              break;
				            }
			            const stepParts = typeof getCachedMessageStepParts === 'function' ? getCachedMessageStepParts(msgEl) : null;
			            const modeEl = stepParts ? stepParts.mode : msgEl.querySelector('.step-mode');
			            const sepEl = stepParts ? stepParts.sep : msgEl.querySelector('.step-sep');
			            const modelEl = stepParts ? stepParts.model : msgEl.querySelector('.step-model');
			            const body = stepParts ? stepParts.body : msgEl.querySelector('.step-body');
			            const nextClassName = 'step ' + status;
			            const nextModelDisplay = model ? '' : 'none';
			            const stepWillChange =
			              (msgEl.className || '') !== nextClassName ||
			              !!(modeEl && (modeEl.textContent || '') !== mode) ||
			              !!(sepEl && sepEl.style && (sepEl.style.display || '') !== nextModelDisplay) ||
			              !!(modelEl && (modelEl.textContent || '') !== model) ||
			              !!(modelEl && modelEl.style && (modelEl.style.display || '') !== nextModelDisplay);
				            if (!stepWillChange) {
				              if (nextStepRenderKey && typeof rememberStepRenderKey === 'function') rememberStepRenderKey(msgEl, nextStepRenderKey);
				              if (body) stepBodies.set(updatedMessage.id, body);
				              break;
				            }
			            const wasNearBottomStepUpdate = isNearBottom();

		            setClassName(msgEl, nextClassName);
		            setTextContent(modeEl, mode);
		            setDisplay(sepEl, nextModelDisplay);
			            if (modelEl) {
			              setTextContent(modelEl, model);
			              setDisplay(modelEl, nextModelDisplay);
				            }
				            if (nextStepRenderKey && typeof rememberStepRenderKey === 'function') rememberStepRenderKey(msgEl, nextStepRenderKey);
				            if (body) stepBodies.set(updatedMessage.id, body);
				            maybeAutoScrollAfterLayout(wasNearBottomStepUpdate);
				          } else if (msgEl && updatedMessage.role === 'plan') {
				            rerenderPlanMessage(updatedMessage);
			          } else if (msgEl) {
			            const pending = pendingTokens.get(updatedMessage.id);
			            const nextMessageRenderKey = typeof getMessageRenderKey === 'function' ? getMessageRenderKey(updatedMessage) : '';
				            const messageRenderKeyUnchanged = !!(
				              nextMessageRenderKey &&
				              previousMessageRenderKey &&
				              previousMessageRenderKey === nextMessageRenderKey
				            );
				            if (!pending && messageRenderKeyUnchanged) {
				              break;
				            }
				            const wasNearBottomMessageUpdate = pending && updatedMessage.role === 'assistant' ? isNearBottom() : false;
				            if (
				              pending &&
				              messageRenderKeyUnchanged &&
				              replayPendingTokenIntoRenderedMessage(
				                updatedMessage.id,
				                msgEl,
				                updatedMessage.role,
				                pending,
				                wasNearBottomMessageUpdate,
				                true
				              )
				            ) {
				              pendingTokens.delete(updatedMessage.id);
				              break;
				            }
			            const newEl = createMessageElement(updatedMessage, !!updatedMessage.toolCall);
			            msgEl.replaceWith(newEl);
			            messageEls.set(updatedMessage.id, newEl);
			            if (typeof scheduleFileLinkify === 'function') {
			              try {
				                if (updatedMessage.role === 'assistant' && typeof scheduleFileLinkifyIfNeeded === 'function') {
				                  scheduleFileLinkifyIfNeeded(newEl, getMessageTextContent(updatedMessage.content, ''));
				                } else {
			                  scheduleFileLinkify(newEl);
				                }
			              } catch {}
			            }
				            if (pending) {
				              replayPendingTokenIntoRenderedMessage(
				                updatedMessage.id,
				                newEl,
				                updatedMessage.role,
				                pending,
				                wasNearBottomMessageUpdate,
				                false
				              );
				              pendingTokens.delete(updatedMessage.id);
				            }
				          } else {
			            addMessage(updatedMessage);
			          }
		          break;
        case 'processing':
          const nextProcessingState = !!data.value;
          const processingStopHadPendingAction = !nextProcessingState && (abortRequestPending || approveAllPending);
          if (!processingStopHadPendingAction && isProcessing === nextProcessingState) break;
          if (!nextProcessingState) {
            clearPendingActionTimer('abort');
            clearPendingActionTimer('approveAll');
            abortRequestPending = false;
            approveAllPending = false;
          }
          setProcessing(nextProcessingState);
          break;
        case 'sessionActionState':
          if (!data.pending && !sessionActionPending) break;
          if (!data.pending) {
            clearPendingActionTimer('sessionAction');
            sessionActionPending = '';
          }
          syncInputState();
          break;
        case 'revertActionState':
          if (!data.pending && !revertActionPending) break;
          if (!data.pending) {
            clearPendingActionTimer('revertAction');
            revertActionPending = '';
          }
          syncInputState();
          break;
        case 'operationStart':
          if (data.operation) {
            clearPendingActionTimer('sessionAction');
            sessionActionPending = '';
            startOperation(data.operation);
          }
          break;
        case 'approvalsChanged':
          const nextPendingApprovalsCount = Number(data.count || 0) || 0;
          const nextManualApprovalsCount = Number(data.manualCount || 0) || 0;
          const nextAutoApproveThisRun = !!data.autoApproveThisRun;
          if (
            !approveAllPending &&
            pendingApprovalsCount === nextPendingApprovalsCount &&
            manualApprovalsCount === nextManualApprovalsCount &&
            autoApproveThisRun === nextAutoApproveThisRun
          ) break;
          clearPendingActionTimer('approveAll');
          approveAllPending = false;
          pendingApprovalsCount = nextPendingApprovalsCount;
          manualApprovalsCount = nextManualApprovalsCount;
          autoApproveThisRun = nextAutoApproveThisRun;
          updateApprovalBanner();
          break;
	        case 'operationUpdate':
	          if (currentOperation && data.operation && data.operation.id === currentOperation.id) {
	            if (typeof operationPatchHasChanges === 'function' && !operationPatchHasChanges(data.operation)) break;
	            currentOperation = { ...currentOperation, ...data.operation };
	            syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
	            updateOperationBanner();
	          }
          break;
        case 'operationEnd':
          if (currentOperation && data.operation && (!data.operation.id || data.operation.id === currentOperation.id)) {
            endOperation(data.operation.status || 'done', data.operation.label || '');
          }
          break;
        case 'planPending':
          const nextPlanPending = !!data.value;
          const nextActivePlanMessageId = typeof data.planMessageId === 'string' ? data.planMessageId : '';
          if (planPending === nextPlanPending && activePlanMessageId === nextActivePlanMessageId) break;
          setPlanPending(nextPlanPending);
          activePlanMessageId = nextActivePlanMessageId;
          rerenderPlanCards();
          break;
        case 'revertState':
          const nextCanUndo = !!data.canUndo;
          const nextCanRedo = !!data.canRedo;
          const nextRevertBarRenderKey = typeof getRevertBarRenderKey === 'function' ? getRevertBarRenderKey(data.revertState) : '';
          if (
            !revertActionPending &&
            !revertDiscardConfirmPending &&
            canUndo === nextCanUndo &&
            canRedo === nextCanRedo &&
            nextRevertBarRenderKey &&
            nextRevertBarRenderKey === lastRevertBarRenderKey
          ) break;
          canUndo = nextCanUndo;
          canRedo = nextCanRedo;
          updateRevertBar(data.revertState);
          syncInputState();
          break;
	        case 'cleared':
			          sessionActionPending = '';
			          if (typeof resetTranscriptHistoryWindow === 'function') {
			            try { resetTranscriptHistoryWindow(); } catch {}
			          }
			          if (typeof resetFileLinkState === 'function') {
			            try { resetFileLinkState(); } catch {}
				          }
				          clearAllTurnTimers();
				          replaceElementChildren(messages, empty);
				          setDisplay(empty, 'flex');
			          turnEls.clear();
				          activeTurnId = '';
				          activeProcessingTurnId = '';
				          messageAppendTarget = null;
				          messageEls.clear();
				          clearMessageDataIndexes();
				          stepBodies.clear();
			          pendingTokens.clear();
			          clearAssistantMarkdownRenderQueue();
			          clearStreamTextRenderQueue();
			          resetLastToolBatchState();
			          activePlanMessageId = '';
			          currentOperation = null;
		          stopOperationTimer();
		          updateOperationBanner();
		          pendingApprovalsCount = 0;
		          manualApprovalsCount = 0;
		          autoApproveThisRun = false;
		          updateApprovalBanner();
		          updateContextIndicatorState({});
		          closeContextPopover();
		          currentRevertState = null;
		          updateRevertBar(null);
		          canUndo = false;
		          canRedo = false;
		          planPending = false;
		          try { setQueueState([], { sync: false }); } catch {}
		          syncInputState();
		          break;
	        case 'modelChanged':
	          const changedModelHeaderState = normalizeModelHeaderState({
	            model: data.model || '',
	            label: data.label || data.model || 'Pick model',
	            isFavorite: !!data.isFavorite,
	            reasoningEffort: data.reasoningEffort || '',
	          });
	          const changedModelHeaderActionWasPending = reasoningEffortPending ||
	            modelSwitchPending ||
	            modelFavoritePending ||
	            modelPickerRefreshPending ||
	            modelPickerOpenPending;
	          const changedModelHeaderRenderKey = !changedModelHeaderActionWasPending &&
	            typeof getModelHeaderRenderKeyForState === 'function'
	            ? getModelHeaderRenderKeyForState(changedModelHeaderState)
	            : '';
	          if (
	            !changedModelHeaderActionWasPending &&
	            changedModelHeaderRenderKey &&
	            typeof isModelHeaderRenderKeyCurrent === 'function' &&
	            isModelHeaderRenderKeyCurrent(changedModelHeaderRenderKey)
	          ) break;
	          clearPendingActionTimer('reasoningEffort');
	          clearPendingActionTimer('modelSwitch');
          clearPendingActionTimer('modelFavorite');
          reasoningEffortPending = false;
	          modelSwitchPending = false;
	          modelFavoritePending = false;
	          currentModel = data.model;
	          updateNormalizedModelHeader(changedModelHeaderState, changedModelHeaderRenderKey);
	          syncInputState();
	          break;
	        case 'modelState':
	          const nextModelHeaderState = normalizeModelHeaderState({
	            model: data.model || currentModel || '',
	            label: data.label || data.model || currentModel || 'Pick model',
	            isFavorite: !!data.isFavorite,
	            reasoningEffort: data.reasoningEffort || '',
	          });
	          const nextModelHeaderActionWasPending = reasoningEffortPending ||
	            modelSwitchPending ||
	            modelFavoritePending ||
	            modelPickerRefreshPending ||
	            modelPickerOpenPending;
	          const nextModelHeaderRenderKey = !nextModelHeaderActionWasPending &&
	            typeof getModelHeaderRenderKeyForState === 'function'
	            ? getModelHeaderRenderKeyForState(nextModelHeaderState)
	            : '';
	          if (
	            !nextModelHeaderActionWasPending &&
	            nextModelHeaderRenderKey &&
	            typeof isModelHeaderRenderKeyCurrent === 'function' &&
	            isModelHeaderRenderKeyCurrent(nextModelHeaderRenderKey)
	          ) break;
	          clearPendingActionTimer('reasoningEffort');
	          clearPendingActionTimer('modelSwitch');
          clearPendingActionTimer('modelFavorite');
	          reasoningEffortPending = false;
	          modelSwitchPending = false;
	          modelFavoritePending = false;
	          updateNormalizedModelHeader(nextModelHeaderState, nextModelHeaderRenderKey);
	          syncInputState();
	          break;
	        case 'modelPickerState':
	          const nextModelPickerState = data.picker || null;
	          const revealModelPickerState = data.reveal === true;
	          const nextModelPickerRenderKey = typeof getModelPickerCurrentRenderKey === 'function'
	            ? getModelPickerCurrentRenderKey(nextModelPickerState)
	            : '';
	          if (
	            !revealModelPickerState &&
	            !modelFavoritePending &&
	            !modelPickerRefreshPending &&
	            !modelPickerOpenPending &&
	            typeof isModelPickerRenderKeyCurrent === 'function' &&
	            isModelPickerRenderKeyCurrent(nextModelPickerRenderKey)
	          ) break;
          clearPendingActionTimer('modelFavorite');
          clearPendingActionTimer('modelPickerRefresh');
          clearPendingActionTimer('modelPickerOpen');
          modelFavoritePending = false;
          modelPickerRefreshPending = false;
          modelPickerOpenPending = false;
	          updateModelPickerState(nextModelPickerState, { reveal: revealModelPickerState, renderKey: nextModelPickerRenderKey });
          syncInputState();
          break;
        case 'advancedModelSettingsState':
          if (!data.pending && !advancedModelSettingsPending) break;
          clearPendingActionTimer('advancedModelSettings');
          advancedModelSettingsPending = false;
          syncInputState();
          break;
        case 'logsActionState':
          if (!data.pending && !showLogsPending) break;
          clearPendingActionTimer('showLogs');
          showLogsPending = false;
          syncInputState();
          break;
	        case 'providerState':
	          const nextProviderStateId = normalizeProviderId(data.currentProviderId || (data.providerAuth && data.providerAuth.providerId) || '');
	          const nextProviderStateAuth = normalizeProviderAuthState(data.providerAuth || null);
	          if (
	            !providerAuthBusy &&
	            !providerSwitchPending &&
	            currentProviderId === nextProviderStateId &&
	            providerAuthStatesEqual(nextProviderStateAuth, currentProviderAuth)
	          ) break;
	          clearPendingActionTimer('providerAuth');
	          clearPendingActionTimer('providerSwitch');
		          providerAuthBusy = false;
		          providerSwitchPending = false;
		          clearModelPickerCache();
		          updateProviderSelection(nextProviderStateId);
		          updateNormalizedProviderAuthHeader(nextProviderStateAuth);
		          syncInputState();
		          break;
	        case 'openAICompatibleSettingsState':
	          const nextOpenAICompatibleSettings = normalizeOpenAICompatibleSettings(data.openAICompatibleSettings || {});
	          const nextOpenAICompatibleProviderId = normalizeProviderId(data.currentProviderId || (data.providerAuth && data.providerAuth.providerId) || currentProviderId || '');
	          const hasOpenAICompatibleProviderAuth = !!data.providerAuth;
	          const nextOpenAICompatibleProviderAuth = hasOpenAICompatibleProviderAuth ? normalizeProviderAuthState(data.providerAuth) : currentProviderAuth;
	          if (
	            !providerAuthBusy &&
	            !providerSwitchPending &&
	            !hasPendingSettingState('openAICompatibleSettingsState') &&
	            openAICompatibleSettingsEqual(nextOpenAICompatibleSettings, openAICompatibleSettings) &&
	            currentProviderId === nextOpenAICompatibleProviderId &&
	            providerAuthStatesEqual(nextOpenAICompatibleProviderAuth, currentProviderAuth)
	          ) break;
	          clearPendingActionTimer('providerAuth');
	          clearPendingActionTimer('providerSwitch');
	          providerAuthBusy = false;
	          providerSwitchPending = false;
		          setPendingSettingState('openAICompatibleSettingsState', false);
		          updateNormalizedOpenAICompatibleSettingsState(nextOpenAICompatibleSettings);
		          updateProviderSelection(nextOpenAICompatibleProviderId);
		          if (hasOpenAICompatibleProviderAuth) updateNormalizedProviderAuthHeader(nextOpenAICompatibleProviderAuth);
		          syncInputState();
		          break;
	        case 'codexSubscriptionSettingsState':
	          const nextCodexSubscriptionSettings = normalizeCodexSubscriptionSettings(data.codexSubscriptionSettings || {});
	          const nextCodexSubscriptionProviderId = normalizeProviderId(data.currentProviderId || (data.providerAuth && data.providerAuth.providerId) || currentProviderId || '');
	          const hasCodexSubscriptionProviderAuth = !!data.providerAuth;
	          const nextCodexSubscriptionProviderAuth = hasCodexSubscriptionProviderAuth ? normalizeProviderAuthState(data.providerAuth) : currentProviderAuth;
	          if (
	            !providerAuthBusy &&
	            !providerSwitchPending &&
	            !hasPendingSettingState('codexSubscriptionSettingsState') &&
	            codexSubscriptionSettingsEqual(nextCodexSubscriptionSettings, codexSubscriptionSettings) &&
	            currentProviderId === nextCodexSubscriptionProviderId &&
	            providerAuthStatesEqual(nextCodexSubscriptionProviderAuth, currentProviderAuth)
	          ) break;
	          clearPendingActionTimer('providerAuth');
	          clearPendingActionTimer('providerSwitch');
	          providerAuthBusy = false;
	          providerSwitchPending = false;
		          setPendingSettingState('codexSubscriptionSettingsState', false);
		          updateNormalizedCodexSubscriptionSettingsState(nextCodexSubscriptionSettings);
		          updateProviderSelection(nextCodexSubscriptionProviderId);
		          if (hasCodexSubscriptionProviderAuth) updateNormalizedProviderAuthHeader(nextCodexSubscriptionProviderAuth);
		          syncInputState();
		          break;
        case 'planFirstState':
          const nextPlanFirstEnabled = data.planFirst !== false;
          if (!hasPendingSettingState('planFirstState') && planFirstEnabled === nextPlanFirstEnabled) break;
          setPendingSettingState('planFirstState', false);
          updatePlanFirstState(nextPlanFirstEnabled);
          syncInputState();
          break;
        case 'sessionsPersistState':
          const nextSessionsPersistEnabled = data.sessionsPersist !== false;
          if (!hasPendingSettingState('sessionsPersistState') && sessionsPersistEnabled === nextSessionsPersistEnabled) break;
          setPendingSettingState('sessionsPersistState', false);
          updateSessionsPersistState(nextSessionsPersistEnabled);
          syncInputState();
          break;
        case 'sessionRetentionState':
          const nextSessionRetentionLimits = normalizeSessionRetentionLimits(data.sessionsMaxSessions || 20, data.sessionsMaxSessionBytes || 2000000);
          const currentSessionRetentionLimits = { maxSessions: sessionsMaxSessions, maxSessionBytes: sessionsMaxSessionBytes };
          if (!hasPendingSettingState('sessionRetentionState') && sessionRetentionLimitsEqual(nextSessionRetentionLimits, currentSessionRetentionLimits)) break;
          setPendingSettingState('sessionRetentionState', false);
          updateNormalizedSessionRetentionState(nextSessionRetentionLimits);
          syncInputState();
          break;
        case 'autoApproveState':
          const nextAutoApproveEnabled = !!data.autoApprove;
          if (!hasPendingSettingState('autoApproveState') && autoApproveEnabled === nextAutoApproveEnabled) break;
          setPendingSettingState('autoApproveState', false);
          updateAutoApproveState(nextAutoApproveEnabled);
          syncInputState();
          break;
        case 'allowExternalPathsState':
          const nextAllowExternalPathsEnabled = !!data.allowExternalPaths;
          if (!hasPendingSettingState('allowExternalPathsState') && allowExternalPathsEnabled === nextAllowExternalPathsEnabled) break;
          setPendingSettingState('allowExternalPathsState', false);
          updateAllowExternalPathsState(nextAllowExternalPathsEnabled);
          syncInputState();
          break;
        case 'blockGitPushState':
          const nextBlockGitPushEnabled = data.blockGitPush !== false;
          if (!hasPendingSettingState('blockGitPushState') && blockGitPushEnabled === nextBlockGitPushEnabled) break;
          setPendingSettingState('blockGitPushState', false);
          updateBlockGitPushState(nextBlockGitPushEnabled);
          syncInputState();
          break;
	        case 'debugSettingsState':
	          const nextDebugSettings = normalizeDebugSettings(data.debugSettings || {});
	          if (!debugSettingsPending && debugSettingsEqual(nextDebugSettings, debugSettings)) break;
	          debugSettingsPending = false;
	          updateNormalizedDebugSettingsState(nextDebugSettings);
	          syncInputState();
	          break;
	        case 'toolRuntimeLimitsState':
	          const nextToolRuntimeLimits = normalizeToolRuntimeLimits(data.toolRuntimeLimits || {});
	          if (!hasPendingSettingState('toolRuntimeLimitsState') && toolRuntimeLimitsEqual(nextToolRuntimeLimits, toolRuntimeLimits)) break;
	          setPendingSettingState('toolRuntimeLimitsState', false);
	          updateNormalizedToolRuntimeLimitsState(nextToolRuntimeLimits);
	          syncInputState();
	          break;
	        case 'pluginSettingsState':
	          const nextPluginSettings = normalizePluginSettings(data.pluginSettings || {});
	          if (!pluginSettingsPending && pluginSettingsEqual(nextPluginSettings, pluginSettings)) break;
	          pluginSettingsPending = false;
	          updateNormalizedPluginSettingsState(nextPluginSettings);
	          syncInputState();
	          break;
	        case 'toolFilterState':
	          const nextToolFilter = normalizeToolFilter(data.toolFilter || []);
	          if (
	            !hasPendingSettingState('toolFilterState') &&
	            stringListsEqual(nextToolFilter, toolFilter) &&
	            !data.toolsCatalog
	          ) break;
	          setPendingSettingState('toolFilterState', false);
	          updateNormalizedToolFilterState(nextToolFilter);
	          if (data.toolsCatalog) updateToolsCatalogState(data.toolsCatalog);
	          syncInputState();
	          break;
	        case 'toolsCatalogState':
	          const nextToolsCatalog = data.toolsCatalog && typeof data.toolsCatalog === 'object' ? data.toolsCatalog : null;
	          if (!toolsCatalogRequestPending && data.reveal !== true && !nextToolsCatalog && !currentToolsCatalog) {
	            cancelToolsCatalogSearchRender();
	            break;
	          }
	          clearPendingActionTimer('toolsCatalog');
	          toolsCatalogRequestPending = false;
	          updateToolsCatalogState(nextToolsCatalog, { reveal: data.reveal === true });
	          syncInputState();
	          break;
        case 'autoApprovedToolsState':
          const nextAutoApprovedTools = normalizeAutoApprovedTools(data.autoApprovedTools || []);
          if (!autoApprovedToolsPending && stringListsEqual(nextAutoApprovedTools, autoApprovedTools)) break;
          autoApprovedToolsPending = false;
          updateNormalizedAutoApprovedToolsState(nextAutoApprovedTools);
          syncInputState();
          break;
        case 'manualToolConfirmationRequired':
          handleManualToolConfirmationRequired(data);
          break;
        case 'manualToolResult':
          handleManualToolResult(data);
          break;
	        case 'workspaceEnvState':
	          const nextWorkspaceEnv = normalizeWorkspaceEnv(data.workspaceEnv || {});
	          if (!hasPendingSettingState('workspaceEnvState') && workspaceEnvsEqual(nextWorkspaceEnv, workspaceEnv)) break;
	          setPendingSettingState('workspaceEnvState', false);
		          updateNormalizedWorkspaceEnvState(nextWorkspaceEnv);
	          syncInputState();
	          break;
	        case 'instructionPatternsState':
	          const nextInstructionPatterns = normalizeInstructionPatterns(data.instructionPatterns || []);
	          if (!hasPendingSettingState('instructionPatternsState') && stringListsEqual(nextInstructionPatterns, instructionPatterns)) break;
	          setPendingSettingState('instructionPatternsState', false);
	          updateNormalizedInstructionPatternsState(nextInstructionPatterns);
	          syncInputState();
	          break;
	        case 'instructionFileSettingsState':
	          const nextInstructionFileSettings = normalizeInstructionFileSettings(data.instructionFileSettings || {});
	          if (!hasPendingSettingState('instructionFileSettingsState') && instructionFileSettingsEqual(nextInstructionFileSettings, instructionFileSettings)) break;
	          setPendingSettingState('instructionFileSettingsState', false);
	          updateNormalizedInstructionFileSettingsState(nextInstructionFileSettings);
	          syncInputState();
	          break;
        case 'showThinkingState':
          const nextShowThinkingEnabled = data.showThinking !== false;
          if (!hasPendingSettingState('showThinkingState') && showThinkingEnabled === nextShowThinkingEnabled) break;
          setPendingSettingState('showThinkingState', false);
          updateShowThinkingState(nextShowThinkingEnabled);
          syncInputState();
          break;
        case 'memoriesFeatureState':
          const nextMemoriesFeatureEnabled = data.memoriesFeatureEnabled !== false;
          if (!hasPendingSettingState('memoriesFeatureState') && memoriesFeatureEnabled === nextMemoriesFeatureEnabled) break;
          setPendingSettingState('memoriesFeatureState', false);
          updateMemoriesFeatureState(nextMemoriesFeatureEnabled);
          syncInputState();
          break;
        case 'memoryAutoRecallState':
          const nextMemoryAutoRecallEnabled = data.memoryAutoRecall !== false;
          if (!hasPendingSettingState('memoryAutoRecallState') && memoryAutoRecallEnabled === nextMemoryAutoRecallEnabled) break;
          setPendingSettingState('memoryAutoRecallState', false);
          updateMemoryAutoRecallState(nextMemoryAutoRecallEnabled);
          syncInputState();
          break;
        case 'memoryAutoRecallBudgetState':
          const nextMemoryAutoRecallBudget = normalizeMemoryAutoRecallBudget(data.memoryAutoRecallMaxResults || 4, data.memoryAutoRecallMaxTokens || 1200);
          const currentMemoryAutoRecallBudget = { maxResults: memoryAutoRecallMaxResults, maxTokens: memoryAutoRecallMaxTokens };
          if (!hasPendingSettingState('memoryAutoRecallBudgetState') && memoryAutoRecallBudgetEqual(nextMemoryAutoRecallBudget, currentMemoryAutoRecallBudget)) break;
          setPendingSettingState('memoryAutoRecallBudgetState', false);
          updateNormalizedMemoryAutoRecallBudgetState(nextMemoryAutoRecallBudget);
          syncInputState();
          break;
        case 'memoryAutoRecallFiltersState':
          const nextMemoryAutoRecallFilters = normalizeMemoryAutoRecallFilters(
            typeof data.memoryAutoRecallMinScore === 'number' ? data.memoryAutoRecallMinScore : 7,
            typeof data.memoryAutoRecallMinScoreGap === 'number' ? data.memoryAutoRecallMinScoreGap : 1.25,
            typeof data.memoryAutoRecallMaxAgeDays === 'number' ? data.memoryAutoRecallMaxAgeDays : 45
          );
          const currentMemoryAutoRecallFilters = {
            minScore: memoryAutoRecallMinScore,
            minScoreGap: memoryAutoRecallMinScoreGap,
            maxAgeDays: memoryAutoRecallMaxAgeDays,
          };
          if (!hasPendingSettingState('memoryAutoRecallFiltersState') && memoryAutoRecallFiltersEqual(nextMemoryAutoRecallFilters, currentMemoryAutoRecallFilters)) break;
          setPendingSettingState('memoryAutoRecallFiltersState', false);
          updateNormalizedMemoryAutoRecallFiltersState(nextMemoryAutoRecallFilters);
          syncInputState();
          break;
        case 'memoryAdvancedLimitsState':
          const nextMemoryAdvancedLimits = normalizeMemoryAdvancedLimits(data.memoryAdvancedLimits || {});
          if (!hasPendingSettingState('memoryAdvancedLimitsState') && memoryAdvancedLimitsEqual(nextMemoryAdvancedLimits, memoryAdvancedLimits)) break;
          setPendingSettingState('memoryAdvancedLimitsState', false);
	          updateNormalizedMemoryAdvancedLimitsState(nextMemoryAdvancedLimits);
          syncInputState();
          break;
        case 'memoryActionStatusState':
          updateMemoryActionStatusState(data.memoryActionStatus || null);
          break;
        case 'explorePrepassState':
          const nextExplorePrepassEnabled = !!data.explorePrepass;
          const nextExplorePrepassMaxChars = normalizeExplorePrepassMaxChars(data.explorePrepassMaxChars);
          if (
            !hasPendingSettingState('explorePrepassState') &&
            explorePrepassEnabled === nextExplorePrepassEnabled &&
            explorePrepassMaxChars === nextExplorePrepassMaxChars
          ) break;
          setPendingSettingState('explorePrepassState', false);
          updateNormalizedExplorePrepassState(nextExplorePrepassEnabled, nextExplorePrepassMaxChars);
          syncInputState();
          break;
        case 'subagentModelOverrideState':
          const nextSubagentModelOverride = normalizeSubagentModelOverride(data.subagentModelOverride);
          if (!hasPendingSettingState('subagentModelOverrideState') && subagentModelOverride === nextSubagentModelOverride) break;
          setPendingSettingState('subagentModelOverrideState', false);
          updateNormalizedSubagentModelOverrideState(nextSubagentModelOverride);
          syncInputState();
          break;
        case 'subagentTaskMaxOutputCharsState':
          const nextSubagentTaskMaxOutputChars = normalizeSubagentTaskMaxOutputChars(data.subagentTaskMaxOutputChars || 8000);
          if (!hasPendingSettingState('subagentTaskMaxOutputCharsState') && subagentTaskMaxOutputChars === nextSubagentTaskMaxOutputChars) break;
          setPendingSettingState('subagentTaskMaxOutputCharsState', false);
          updateNormalizedSubagentTaskMaxOutputCharsState(nextSubagentTaskMaxOutputChars);
          syncInputState();
          break;
        case 'autoCompactionState':
          const nextAutoCompactionEnabled = data.autoCompaction !== false;
          if (!hasPendingSettingState('autoCompactionState') && autoCompactionEnabled === nextAutoCompactionEnabled) break;
          setPendingSettingState('autoCompactionState', false);
          updateAutoCompactionState(nextAutoCompactionEnabled);
          syncInputState();
          break;
        case 'compactionPruneState':
          const nextCompactionPruneProtectTokensSource = typeof data.compactionPruneProtectTokens === 'number' ? data.compactionPruneProtectTokens : 40000;
          const nextCompactionPruneMinimumTokensSource = typeof data.compactionPruneMinimumTokens === 'number' ? data.compactionPruneMinimumTokens : 20000;
          const nextCompactionPruneSettings = normalizeCompactionPruneSettings(
            data.compactionPrune !== false,
            nextCompactionPruneProtectTokensSource,
            nextCompactionPruneMinimumTokensSource
          );
          const currentCompactionPruneSettings = {
            prune: compactionPruneEnabled,
            pruneProtectTokens: compactionPruneProtectTokens,
            pruneMinimumTokens: compactionPruneMinimumTokens,
          };
          if (!hasPendingSettingState('compactionPruneState') && compactionPruneSettingsEqual(nextCompactionPruneSettings, currentCompactionPruneSettings)) break;
          setPendingSettingState('compactionPruneState', false);
          updateNormalizedCompactionPruneState(nextCompactionPruneSettings);
          syncInputState();
          break;
        case 'compactionToolOutputModeState':
          const nextCompactionToolOutputMode = normalizeCompactionToolOutputMode(data.compactionToolOutputMode || 'onCompaction');
          if (!hasPendingSettingState('compactionToolOutputModeState') && compactionToolOutputMode === nextCompactionToolOutputMode) break;
          setPendingSettingState('compactionToolOutputModeState', false);
	          updateNormalizedCompactionToolOutputModeState(nextCompactionToolOutputMode);
          syncInputState();
          break;
        case 'modelLimitsState':
          const nextModelLimits = normalizeModelLimits(data.modelLimits || {});
          if (!hasPendingSettingState('modelLimitsState') && modelLimitsEqual(nextModelLimits, modelLimits)) break;
          setPendingSettingState('modelLimitsState', false);
	          updateNormalizedModelLimitsState(nextModelLimits);
          syncInputState();
          break;
        case 'generationSettingsState':
          const nextGenerationSettings = normalizeGenerationSettings(data.generationSettings || {});
          if (!hasPendingSettingState('generationSettingsState') && generationSettingsEqual(nextGenerationSettings, currentGenerationSettings())) break;
          setPendingSettingState('generationSettingsState', false);
          updateNormalizedGenerationSettingsState(nextGenerationSettings);
          syncInputState();
          break;
	        case 'skillsEnabledState':
	          const nextSkillsEnabled = data.skillsEnabled !== false;
	          const nextSkillsEnabledAvailableSkills = normalizeAvailableSkills(Array.isArray(data.skills) ? data.skills : []);
	          if (
	            !hasPendingSettingState('skillsEnabledState') &&
	            skillsEnabled === nextSkillsEnabled &&
	            nextSkillsEnabledAvailableSkills.key === availableSkillsKey
	          ) break;
	          setPendingSettingState('skillsEnabledState', false);
	          updateSkillsEnabledState(nextSkillsEnabled);
	          try { setAvailableSkillsFromNormalized(nextSkillsEnabledAvailableSkills); } catch {}
	          syncInputState();
	          break;
	        case 'skillSearchPathsState':
	          const nextSkillSearchPaths = normalizeSkillSearchPaths(data.skillSearchPaths || []);
	          const nextSkillSearchPathsAvailableSkills = normalizeAvailableSkills(Array.isArray(data.skills) ? data.skills : []);
	          if (
	            !hasPendingSettingState('skillSearchPathsState') &&
	            stringListsEqual(nextSkillSearchPaths, skillSearchPaths) &&
	            nextSkillSearchPathsAvailableSkills.key === availableSkillsKey
	          ) break;
	          setPendingSettingState('skillSearchPathsState', false);
          updateNormalizedSkillSearchPathsState(nextSkillSearchPaths);
	          try { setAvailableSkillsFromNormalized(nextSkillSearchPathsAvailableSkills); } catch {}
	          syncInputState();
	          break;
	        case 'skillsBudgetState':
	          const nextSkillsBudget = normalizeSkillsBudget(data.skillsBudget || {});
	          if (!hasPendingSettingState('skillsBudgetState') && skillsBudgetsEqual(nextSkillsBudget, skillsBudget)) break;
	          setPendingSettingState('skillsBudgetState', false);
          updateNormalizedSkillsBudgetState(nextSkillsBudget);
	          syncInputState();
	          break;
        case 'modeChanged':
          const nextMode = data.mode === 'plan' ? 'plan' : 'build';
          if (!modeSwitchPending && currentMode === nextMode) break;
          clearPendingActionTimer('modeSwitch');
          modeSwitchPending = false;
          setMode(nextMode);
          break;
        case 'turnStatus':
          if (data.turnId && data.status) {
            const turnData = turnEls.get(data.turnId);
		            if (turnData) {
			              if (data.status.type === 'retry') {
			                const currentRetryInfo = turnData.retryInfo || null;
			                if (
			                  currentRetryInfo &&
			                  currentRetryInfo.attempt === data.status.attempt &&
			                  currentRetryInfo.nextRetryTime === data.status.nextRetryTime &&
			                  currentRetryInfo.message === data.status.message &&
			                  (turnData.retryInterval || turnData.retryCleanupTimeout)
			                ) break;
			                turnData.statusStateKey = '';
			                clearTurnStatusTimeout(turnData);
			                setTurnStatusText(turnData, 'Retrying: ' + (data.status.message || 'error'));
			                turnData.retryInfo = {
			                  attempt: data.status.attempt,
			                  nextRetryTime: data.status.nextRetryTime,
                  message: data.status.message,
			                };
			                startRetryCountdown(turnData);
			              } else if (data.status.type === 'paused') {
			                const pausedStatusText = 'Paused (' + (data.status.reason || 'permission denied') + ')';
			                const pausedStatusKey = 'paused\n' + pausedStatusText;
			                if (turnData.statusStateKey === pausedStatusKey && turnHasNoPendingStatusWork(turnData)) break;
			                setTurnStatusText(turnData, pausedStatusText);
			                turnData.currentStatus = '';
			                turnData.statusStateKey = pausedStatusKey;
			                turnData.retryInfo = null;
			                clearTurnRetryCountdown(turnData);
                clearTurnStatusTimeout(turnData);
              } else if (data.status.type === 'running') {
                const newStatus = hasNonWhitespaceText(data.status.message) ? data.status.message : 'Thinking…';
                if (
                  newStatus === turnData.currentStatus &&
                  !turnData.statusTimeout &&
                  !turnData.retryInfo &&
                  !turnData.retryInterval &&
                  !turnData.retryCleanupTimeout
                ) break;
                turnData.statusStateKey = '';
                if (newStatus !== turnData.currentStatus) {
                  const now = Date.now();
                  const timeSinceShow = now - turnData.statusShowTime;
                  clearTurnStatusTimeout(turnData);
			                  if (turnData.statusShowTime > 0 && timeSinceShow < 1000) {
			                    turnData.statusTimeout = setTimeout(() => {
			                      turnData.currentStatus = newStatus;
			                      setTurnStatusText(turnData, newStatus);
			                      turnData.statusShowTime = Date.now();
			                      turnData.statusTimeout = null;
			                    }, 1000 - timeSinceShow);
			                  } else {
			                    turnData.currentStatus = newStatus;
			                    setTurnStatusText(turnData, newStatus);
			                    turnData.statusShowTime = now;
			                  }
			                }
			                turnData.retryInfo = null;
			                clearTurnRetryCountdown(turnData);
			              } else if (data.status.type === 'done') {
			                if (turnData.statusStateKey === 'done' && turnHasNoPendingStatusWork(turnData)) break;
			                setTurnStatusText(turnData, '');
			                turnData.currentStatus = '';
			                turnData.statusStateKey = 'done';
			                turnData.retryInfo = null;
			                clearTurnRetryCountdown(turnData);
			                clearTurnStatusTimeout(turnData);
			              } else if (data.status.type === 'error') {
			                const errorStatusText = 'Error: ' + (data.status.message || 'unknown error');
			                const errorStatusKey = 'error\n' + errorStatusText;
			                if (turnData.statusStateKey === errorStatusKey && turnHasNoPendingStatusWork(turnData)) break;
			                setTurnStatusText(turnData, errorStatusText);
			                turnData.currentStatus = '';
			                turnData.statusStateKey = errorStatusKey;
			                turnData.retryInfo = null;
			                clearTurnRetryCountdown(turnData);
                clearTurnStatusTimeout(turnData);
              }

              if (hasNonWhitespaceText(turnData.statusRenderedText)) {
                setDisplay(turnData.statusBar, 'flex');
                setDisplay(turnData.spinner, data.status.type === 'running' || data.status.type === 'retry' ? '' : 'none');
              } else if (!turnData.isProcessing) {
                setDisplay(turnData.statusBar, 'none');
              }
            }
          }
          break;
		        case 'setInput':
		          setValue(input, data.value === undefined || data.value === null ? '' : data.value);
		          if (typeof data.placeholder === 'string' && data.placeholder) {
		            setPlaceholder(input, data.placeholder);
		          }
	          updateInputLayout();
	          focusComposerInput();
	          break;
	        case 'focusInput':
	          if (typeof data.placeholder === 'string' && data.placeholder && !hasNonWhitespaceText(input.value)) {
	            setPlaceholder(input, data.placeholder);
	          }
          updateInputLayout();
          focusComposerInput();
          break;
      }
      } catch (err) {
        showFatalError(err, 'message.dispatch');
      }
	    });

		    if (typeof restoreComposerDraftState === 'function') {
		      restoreComposerDraftState();
		    }
		    syncInputState();
		    vscode.postMessage({ type: mainChatProtocol.ready, clientInstanceId });
