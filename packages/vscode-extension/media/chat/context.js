		    const HTML_ESCAPE_TEST_RE = /[&<>"']/;
		    const HTML_ESCAPE_RE = /[&<>"']/g;

		    function escapeHtmlChar(ch) {
		      switch (ch) {
		        case '&': return '&amp;';
		        case '<': return '&lt;';
		        case '>': return '&gt;';
		        case '"': return '&quot;';
		        case "'": return '&#39;';
		        default: return ch;
		      }
		    }

		    function escapeHtml(text) {
		      const value = String(text === undefined || text === null ? '' : text);
		      return HTML_ESCAPE_TEST_RE.test(value) ? value.replace(HTML_ESCAPE_RE, escapeHtmlChar) : value;
		    }

	    let sessionSelectRenderKey = '';
	    const SESSION_OPTION_LABEL_DISPLAY_LIMIT = 160;

	    function getSessionSelectRenderKey(sessions, selectedId) {
	      const list = Array.isArray(sessions) ? sessions : [];
	      const key = createCompactRenderKeyBuilder();
	      appendCompactContextRenderKeyPart(key, selectedId || '');
		      appendCompactContextRenderKeyPart(key, list.length);
	      for (let sessionIndex = 0; sessionIndex < list.length; sessionIndex++) {
	        const s = list[sessionIndex];
	        const id = s && s.id ? String(s.id) : '';
	        appendCompactContextRenderKeyPart(key, id);
	        appendCompactContextRenderKeyPart(key, s && s.title ? String(s.title) : id);
	      }
	      return finishCompactRenderKey(key);
	    }

	    function getSessionOptionLabelDisplayText(value) {
	      const text = String(value === undefined || value === null ? '' : value);
	      return text.length <= SESSION_OPTION_LABEL_DISPLAY_LIMIT
	        ? text
	        : text.slice(0, SESSION_OPTION_LABEL_DISPLAY_LIMIT) + '…';
	    }

		    function isSessionSelectRenderKeyCurrent(renderKey) {
		      return renderKey === sessionSelectRenderKey;
		    }

		    function isSessionSelectCurrent(sessions, selectedId) {
		      return isSessionSelectRenderKeyCurrent(getSessionSelectRenderKey(sessions, selectedId || ''));
		    }

		    let contextPopoverRenderKey = '';
		    let todoPopoverRenderKey = null;
		    let contextIndicatorStateKey = '';
		    let todoIndicatorStateKey = '';
		    let contextIndicatorVisible = false;
		    let todoIndicatorVisible = false;
		    const FILE_LINK_CANDIDATE_LABEL_DISPLAY_LIMIT = 160;
		    const FILE_LINK_OPEN_LABEL_DISPLAY_LIMIT = 160;

			    function appendCompactContextRenderKeyPart(builder, value) {
			      const text = String(value === undefined || value === null ? '' : value);
			      appendCompactRenderKeyText(builder, String(text.length));
			      appendCompactRenderKeyCode(builder, 58);
			      appendCompactRenderKeyText(builder, text);
			      appendCompactRenderKeyCode(builder, 59);
			      return builder;
			    }

			    function getFileLinkOpenDisplayPath(path) {
			      const value = formatFilePath(path);
			      return value.length <= FILE_LINK_OPEN_LABEL_DISPLAY_LIMIT
			        ? value
			        : value.slice(0, FILE_LINK_OPEN_LABEL_DISPLAY_LIMIT) + '…';
			    }

			    function getFileLinkCandidateDisplayLabel(label, raw) {
			      const value = String(label || raw || '');
			      return value.length <= FILE_LINK_CANDIDATE_LABEL_DISPLAY_LIMIT
			        ? value
			        : value.slice(0, FILE_LINK_CANDIDATE_LABEL_DISPLAY_LIMIT) + '…';
			    }

	    function getContextPopoverRenderKey(ctx) {
	      const key = createCompactRenderKeyBuilder();
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.totalTokens === 'number' ? ctx.totalTokens : '');
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.contextLimitTokens === 'number' ? ctx.contextLimitTokens : '');
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.outputLimitTokens === 'number' ? ctx.outputLimitTokens : '');
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.percent === 'number' ? ctx.percent : '');
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.inputTokens === 'number' ? ctx.inputTokens : '');
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.outputTokens === 'number' ? ctx.outputTokens : '');
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.cacheReadTokens === 'number' ? ctx.cacheReadTokens : '');
	      appendCompactContextRenderKeyPart(key, ctx && typeof ctx.cacheWriteTokens === 'number' ? ctx.cacheWriteTokens : '');
	      return finishCompactRenderKey(key);
	    }

		    function isContextIndicatorRenderKeyCurrent(renderKey) {
		      return renderKey === contextIndicatorStateKey;
		    }

		    function isContextIndicatorStateCurrent(ctx) {
		      return isContextIndicatorRenderKeyCurrent(getContextPopoverRenderKey(ctx));
		    }

	    function normalizeTodoStatus(value) {
	      return value === 'in_progress' || value === 'completed' || value === 'cancelled' ? value : 'pending';
	    }

		    function normalizeTodoPriority(value) {
		      return value === 'high' || value === 'low' ? value : 'medium';
		    }

			    const TODO_CONTENT_BOUNDARY_WHITESPACE_RE = /^\s|\s$/;
			    const TODO_POPOVER_RENDER_LIMIT = 100;
			    const TODO_CONTENT_DISPLAY_LIMIT = 240;

		    function getTodoRenderContent(todo) {
		      if (!todo || typeof todo !== 'object') return '';
		      const content = typeof todo.content === 'string' ? todo.content : '';
		      if (!content) return '';
		      return TODO_CONTENT_BOUNDARY_WHITESPACE_RE.test(content) ? content.trim() : content;
		    }

		    function getTodoDisplayContent(content) {
		      const text = String(content === undefined || content === null ? '' : content);
		      return text.length <= TODO_CONTENT_DISPLAY_LIMIT
		        ? text
		        : text.slice(0, TODO_CONTENT_DISPLAY_LIMIT) + '…';
		    }

		    function getTodoRenderState(todos) {
		      const list = Array.isArray(todos) ? todos : [];
		      const key = createCompactRenderKeyBuilder();
		      let open = 0;
		      let total = 0;
		      for (let todoIndex = 0; todoIndex < list.length; todoIndex++) {
		        const todo = list[todoIndex];
	        const content = getTodoRenderContent(todo);
	        if (!content) continue;
	        const status = normalizeTodoStatus(typeof todo.status === 'string' ? todo.status : 'pending');
	        const priority = normalizeTodoPriority(typeof todo.priority === 'string' ? todo.priority : 'medium');
		        total++;
		        if (status !== 'completed' && status !== 'cancelled') open++;
		        appendCompactContextRenderKeyPart(key, content);
		        appendCompactContextRenderKeyPart(key, status);
		        appendCompactContextRenderKeyPart(key, priority);
		      }
		      return { key: finishCompactRenderKey(key), open, total };
		    }

	    function getTodoPopoverRenderKey(todos) {
	      return getTodoRenderState(todos).key;
	    }

	    function normalizeTodoRenderState(todosOrRenderState) {
	      if (todosOrRenderState && typeof todosOrRenderState.key === 'string') {
	        return todosOrRenderState;
	      }
	      return getTodoRenderState(todosOrRenderState);
	    }

	    function isTodoIndicatorStateCurrent(todosOrRenderState) {
	      const renderState = normalizeTodoRenderState(todosOrRenderState);
	      return renderState.key === todoIndicatorStateKey;
	    }

		    function updateSessionSelect(sessions, selectedId, renderKey) {
		      if (!sessionSelect) return;
		      const nextSelectedId = selectedId || '';
		      const nextRenderKey = typeof renderKey === 'string' && renderKey ? renderKey : getSessionSelectRenderKey(sessions, nextSelectedId);
		      currentSessionId = nextSelectedId;
		      if (nextRenderKey === sessionSelectRenderKey) return;
	      sessionSelectRenderKey = nextRenderKey;
	      currentSessionOption = null;
		      const list = Array.isArray(sessions) ? sessions : [];
		      const fragment = list.length > 1 ? document.createDocumentFragment() : null;
		      let singleOption = null;
		      for (let sessionIndex = 0; sessionIndex < list.length; sessionIndex++) {
		        const s = list[sessionIndex];
		        const opt = document.createElement('option');
	        const id = s && s.id ? String(s.id) : '';
	        const rawLabel = s && s.title ? String(s.title) : id;
	        const baseLabel = getSessionOptionLabelDisplayText(rawLabel);
	        let label = baseLabel;
	        opt.__lingyunSessionBaseLabel = baseLabel;
	        if (id === nextSelectedId) {
	          currentSessionOption = opt;
	          if (isProcessing) {
	            label = '◉ ' + baseLabel;
	          }
	        }
		        opt.value = id;
		        opt.textContent = label;
		        if (id === nextSelectedId) opt.selected = true;
		        if (fragment) {
		          fragment.appendChild(opt);
		        } else {
		          singleOption = opt;
		        }
		      }
		      replaceElementChildren(sessionSelect, fragment || singleOption);
		    }

	    let modelHeaderRenderKey = '';
	    const MODEL_HEADER_REASONING_EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

	    function normalizeModelHeaderState(state) {
	      const modelId = state && (state.model || state.id) ? String(state.model || state.id) : '';
	      const label = state && state.label ? String(state.label) : (modelId || 'Pick model');
	      const isFavorite = !!(state && state.isFavorite);
	      const nextReasoningEffort = state && typeof state.reasoningEffort === 'string' ? String(state.reasoningEffort) : 'high';
	      const reasoningEffort = MODEL_HEADER_REASONING_EFFORTS.indexOf(nextReasoningEffort) >= 0 ? nextReasoningEffort : 'high';
	      const reasoningLabel = reasoningEffort ? reasoningEffort : 'off';
	      return { modelId, label, isFavorite, reasoningEffort, reasoningLabel };
	    }

	    function getModelHeaderRenderKeyForState(state) {
	      const key = createCompactRenderKeyBuilder();
	      appendCompactContextRenderKeyPart(key, state.modelId);
	      appendCompactContextRenderKeyPart(key, state.label);
	      appendCompactContextRenderKeyPart(key, state.isFavorite ? '1' : '0');
	      appendCompactContextRenderKeyPart(key, state.reasoningEffort);
	      appendCompactContextRenderKeyPart(key, initReceived ? '1' : '0');
	      appendCompactContextRenderKeyPart(key, isProcessing ? '1' : '0');
	      appendCompactContextRenderKeyPart(key, reasoningEffortPending ? '1' : '0');
	      appendCompactContextRenderKeyPart(key, modelSwitchPending ? '1' : '0');
	      appendCompactContextRenderKeyPart(key, modelFavoritePending ? '1' : '0');
	      appendCompactContextRenderKeyPart(key, modelPickerRefreshPending ? '1' : '0');
	      return finishCompactRenderKey(key);
	    }

		    function getModelHeaderRenderKey(state) {
		      return getModelHeaderRenderKeyForState(normalizeModelHeaderState(state));
		    }

		    function isModelHeaderRenderKeyCurrent(renderKey) {
		      return renderKey === modelHeaderRenderKey;
		    }

		    function isModelHeaderStateCurrent(state) {
		      return isModelHeaderRenderKeyCurrent(getModelHeaderRenderKey(state));
		    }

		    function updateNormalizedModelHeader(modelHeaderState, renderKey) {
		      const nextRenderKey = typeof renderKey === 'string' && renderKey ? renderKey : getModelHeaderRenderKeyForState(modelHeaderState);
		      const modelId = modelHeaderState.modelId;
		      const label = modelHeaderState.label;
		      const isFavorite = modelHeaderState.isFavorite;
	      const reasoningEffort = modelHeaderState.reasoningEffort;
	      const reasoningLabel = modelHeaderState.reasoningLabel;
	      const displayLabel = getModelDisplayText(label);
	      const displayTitle = displayLabel + ' • reasoning ' + reasoningLabel;

	      currentModel = modelId;
	      currentReasoningEffort = reasoningEffort;
	      if (typeof updateCustomModelInputState === 'function') {
	        updateCustomModelInputState(modelId);
	      }

	      if (nextRenderKey === modelHeaderRenderKey) return;
	      modelHeaderRenderKey = nextRenderKey;

	      if (modelPickerLabel) {
	        setTextContent(modelPickerLabel, displayLabel);
	        setTitle(modelPickerLabel, displayTitle);
	      } else if (modelPicker) {
	        setTextContent(modelPicker, displayLabel);
	      }

	      if (modelPicker) {
	        setTitle(modelPicker, displayTitle);
	        setAttributeValue(modelPicker, 'aria-label', displayLabel + ', select AI model');
	      }

	      if (reasoningEffortSelect) {
        setValue(reasoningEffortSelect, reasoningEffort);
        setDisabled(reasoningEffortSelect, !initReceived || isProcessing || reasoningEffortPending || modelSwitchPending);
        setTitle(reasoningEffortSelect, 'Reasoning effort: ' + reasoningLabel + ' (GPT-5/Codex models)');
      }

	      if (modelFavoriteToggle) {
	        const favoriteModelLabel = displayLabel || getModelDisplayText(modelId) || 'current model';
	        setDisabled(modelFavoriteToggle, !currentModel || !initReceived || isProcessing || modelFavoritePending || modelSwitchPending || modelPickerRefreshPending);
	        setTextContent(modelFavoriteIcon || modelFavoriteToggle, isFavorite ? '★' : '☆');
	        setTitle(modelFavoriteToggle, (isFavorite ? 'Remove from favorites: ' : 'Add to favorites: ') + favoriteModelLabel);
        setAttributeValue(modelFavoriteToggle, 'aria-label', 'Toggle favorite model: ' + favoriteModelLabel);
        setAttributeValue(modelFavoriteToggle, 'aria-pressed', isFavorite ? 'true' : 'false');
      }

	      if (modelSettings) {
	        setDisabled(modelSettings, !initReceived || isProcessing || modelSwitchPending || modelFavoritePending || modelPickerRefreshPending);
	      }
	    }

		    function updateModelHeader(state, renderKey) {
		      updateNormalizedModelHeader(normalizeModelHeaderState(state), renderKey);
		    }

		    function normalizeProviderAuthState(state) {
		      const next = state && typeof state === 'object' ? state : {};
		      return {
	        providerId: next.providerId ? String(next.providerId) : '',
	        providerName: next.providerName ? String(next.providerName) : '',
	        supported: !!next.supported,
	        authenticated: !!next.authenticated,
	        status: next.status ? String(next.status) : 'hidden',
	        label: next.label ? String(next.label) : '',
	        detail: next.detail ? String(next.detail) : '',
	        accountLabel: next.accountLabel ? String(next.accountLabel) : '',
	        primaryActionLabel: next.primaryActionLabel ? String(next.primaryActionLabel) : '',
	        secondaryActionLabel: next.secondaryActionLabel ? String(next.secondaryActionLabel) : '',
		      };
		    }

		    let providerAuthRenderKey = '';
		    let providerAuthGroupVisible = false;
		    let providerAuthPrimaryConnected = false;
		    let providerAuthSecondaryVisible = null;
		    const PROVIDER_AUTH_DISPLAY_LIMIT = 160;

			    function getProviderAuthHeaderRenderKey(state) {
			      const key = createCompactRenderKeyBuilder();
			      appendCompactContextRenderKeyPart(key, state.providerId);
			      appendCompactContextRenderKeyPart(key, state.providerName);
			      appendCompactContextRenderKeyPart(key, state.supported ? '1' : '0');
			      appendCompactContextRenderKeyPart(key, state.authenticated ? '1' : '0');
			      appendCompactContextRenderKeyPart(key, state.status);
			      appendCompactContextRenderKeyPart(key, state.label);
			      appendCompactContextRenderKeyPart(key, state.detail);
			      appendCompactContextRenderKeyPart(key, state.accountLabel);
			      appendCompactContextRenderKeyPart(key, state.primaryActionLabel);
			      appendCompactContextRenderKeyPart(key, state.secondaryActionLabel);
			      appendCompactContextRenderKeyPart(key, providerAuthBusy ? '1' : '0');
			      return finishCompactRenderKey(key);
			    }

			    function getProviderAuthDisplayText(value) {
			      const text = String(value === undefined || value === null ? '' : value);
			      return text.length <= PROVIDER_AUTH_DISPLAY_LIMIT
			        ? text
			        : text.slice(0, PROVIDER_AUTH_DISPLAY_LIMIT) + '…';
			    }

		    function providerAuthStatesEqual(left, right) {
		      return !!left && !!right &&
		        left.providerId === right.providerId &&
		        left.providerName === right.providerName &&
		        left.supported === right.supported &&
		        left.authenticated === right.authenticated &&
		        left.status === right.status &&
		        left.label === right.label &&
		        left.detail === right.detail &&
		        left.accountLabel === right.accountLabel &&
		        left.primaryActionLabel === right.primaryActionLabel &&
		        left.secondaryActionLabel === right.secondaryActionLabel;
		    }

		    function setProviderAuthGroupVisible(visible) {
		      const visibleFlag = !!visible;
		      if (providerAuthGroupVisible === visibleFlag) return;
		      providerAuthGroupVisible = visibleFlag;
		      if (providerAuthGroup && providerAuthGroup.classList) {
		        providerAuthGroup.classList.toggle('hidden', !visibleFlag);
		      }
		    }

		    function setProviderAuthPrimaryConnected(connected) {
		      const connectedFlag = !!connected;
		      if (providerAuthPrimaryConnected === connectedFlag) return;
		      providerAuthPrimaryConnected = connectedFlag;
		      if (providerAuthPrimary && providerAuthPrimary.classList) {
		        providerAuthPrimary.classList.toggle('connected', connectedFlag);
		      }
		    }

		    function setProviderAuthSecondaryVisible(visible) {
		      const visibleFlag = !!visible;
		      if (providerAuthSecondaryVisible === visibleFlag) return;
		      providerAuthSecondaryVisible = visibleFlag;
		      if (providerAuthSecondary && providerAuthSecondary.classList) {
		        providerAuthSecondary.classList.toggle('hidden', !visibleFlag);
		      }
		    }

				    function updateNormalizedProviderAuthHeader(nextProviderAuth, renderKey) {
			      currentProviderAuth = nextProviderAuth;

			      if (!providerAuthGroup) return;
			      const nextRenderKey = typeof renderKey === 'string' && renderKey ? renderKey : getProviderAuthHeaderRenderKey(currentProviderAuth);
			      if (nextRenderKey === providerAuthRenderKey) return;
			      providerAuthRenderKey = nextRenderKey;

		      const visible =
	        !!currentProviderAuth.supported &&
	        currentProviderAuth.status !== 'hidden';
	      setProviderAuthGroupVisible(visible);
	      if (!visible) return;

	      const connected = !!currentProviderAuth.authenticated;
	      const rawPrimaryLabel = providerAuthBusy
	        ? (connected ? 'Updating…' : 'Signing in…')
	        : (connected
	          ? (currentProviderAuth.accountLabel || currentProviderAuth.label || 'Connected')
	          : (currentProviderAuth.primaryActionLabel || currentProviderAuth.label || 'Sign in'));
	      const primaryLabel = getProviderAuthDisplayText(rawPrimaryLabel);
	      const providerName = getProviderAuthDisplayText(currentProviderAuth.providerName);
	      const providerDetail = getProviderAuthDisplayText(currentProviderAuth.detail);
		      let title = primaryLabel;
		      if (providerName) {
		        title = providerName;
		        if (providerDetail) {
		          title += ' • ' + providerDetail;
		        }
		      } else if (providerDetail) {
		        title = providerDetail;
		      }

	      if (providerAuthPrimary) {
	        setTextContent(providerAuthPrimary, primaryLabel);
	        setTitle(providerAuthPrimary, title);
	        const providerAccountLabel = providerName
	          ? (primaryLabel + ', ' + providerName + ' account')
	          : primaryLabel;
	        setAttributeValue(providerAuthPrimary, 'aria-label', providerAccountLabel);
	        setProviderAuthPrimaryConnected(connected);
	      }

	      if (providerAuthSecondary) {
	        const secondaryLabel = getProviderAuthDisplayText(currentProviderAuth.secondaryActionLabel || 'Disconnect');
	        const secondaryTitle = providerName
	          ? (secondaryLabel + ' from ' + providerName)
	          : secondaryLabel;
	        setTextContent(providerAuthSecondary, secondaryLabel);
	        setTitle(providerAuthSecondary, secondaryTitle);
	        setAttributeValue(providerAuthSecondary, 'aria-label', secondaryTitle);
	        setProviderAuthSecondaryVisible(connected);
	      }
	    }

				    function updateProviderAuthHeader(state, renderKey) {
			      updateNormalizedProviderAuthHeader(normalizeProviderAuthState(state), renderKey);
			    }

	    function formatInt(value) {
	      try {
	        return Number(value).toLocaleString();
	      } catch {
	        return String(value);
	      }
	    }

	    const COMPACT_NUMBER_DECIMAL_ZERO_SUFFIX_RE = /\.0$/;

	    function formatCompact(value) {
	      const num = Number(value);
	      if (!Number.isFinite(num)) return String(value);
	      const abs = Math.abs(num);
	      if (abs < 1000) return String(Math.round(num));
	      if (abs < 100_000) return (num / 1000).toFixed(1).replace(COMPACT_NUMBER_DECIMAL_ZERO_SUFFIX_RE, '') + 'k';
	      if (abs < 1_000_000) return Math.round(num / 1000) + 'k';
	      if (abs < 100_000_000) return (num / 1_000_000).toFixed(1).replace(COMPACT_NUMBER_DECIMAL_ZERO_SUFFIX_RE, '') + 'm';
	      return Math.round(num / 1_000_000) + 'm';
	    }

	    function setContextIndicatorVisible(visible) {
	      const visibleFlag = !!visible;
	      if (contextIndicatorVisible === visibleFlag) return;
	      contextIndicatorVisible = visibleFlag;
	      if (contextIndicator && contextIndicator.classList) {
	        contextIndicator.classList.toggle('hidden', !visibleFlag);
	      }
	    }

	    function setTodoIndicatorVisible(visible) {
	      const visibleFlag = !!visible;
	      if (todoIndicatorVisible === visibleFlag) return;
	      todoIndicatorVisible = visibleFlag;
	      if (todoIndicator && todoIndicator.classList) {
	        todoIndicator.classList.toggle('hidden', !visibleFlag);
	      }
	    }

		    let contextPopoverFocusReturnTarget = null;
		    let todoPopoverFocusReturnTarget = null;
		    let popoverFocusRestoreTimer = null;
		    const popoverOpenStates = new WeakMap();
		    if (contextPopover) popoverOpenStates.set(contextPopover, false);
		    if (todoPopover) popoverOpenStates.set(todoPopover, false);

		    function isPopoverOpen(popover) {
		      if (!popover) return false;
		      const knownOpen = popoverOpenStates.get(popover);
		      if (knownOpen === true) return true;
		      if (knownOpen === false) return false;
		      const open = !popover.classList || !popover.classList.contains('hidden');
		      popoverOpenStates.set(popover, open);
		      return open;
		    }

		    function setPopoverOpenState(popover, open) {
		      if (!popover) return;
		      const nextOpen = !!open;
		      if (popover.classList) {
		        popover.classList.toggle('hidden', !nextOpen);
		      }
		      popoverOpenStates.set(popover, nextOpen);
		    }

	    function canFocusPopoverTarget(element) {
	      if (!element || typeof element.focus !== 'function') return false;
	      if (element.disabled) return false;
	      if (element.isConnected === false) return false;
	      if (element.classList && element.classList.contains('hidden')) return false;
	      if (element.getAttribute && element.getAttribute('aria-hidden') === 'true') return false;
	      return true;
	    }

		    function focusPopoverTarget(element) {
		      if (!canFocusPopoverTarget(element)) return false;
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

	    function getPopoverFocusReturnTarget(fallback) {
	      const activeElement = document && document.activeElement;
	      if (canFocusPopoverTarget(activeElement) && activeElement !== document.body) return activeElement;
	      return canFocusPopoverTarget(fallback) ? fallback : null;
	    }

		    function restorePopoverFocus(target) {
		      if (focusPopoverTarget(target)) return;
		      focusPopoverTarget(input);
		    }

		    function clearPopoverFocusRestoreTimer() {
		      if (popoverFocusRestoreTimer === null) return;
		      clearTimeout(popoverFocusRestoreTimer);
		      popoverFocusRestoreTimer = null;
		    }

	    function popoverContainsFocus(popover) {
	      if (!popover || !popover.contains) return false;
	      const activeElement = document && document.activeElement;
	      return !!activeElement && popover.contains(activeElement);
	    }

		    function restoreFocusAfterPointerDismiss(popover, target) {
		      if (!popoverContainsFocus(popover)) return;
		      const fallbackTarget = target && target !== document.body ? target : null;
		      clearPopoverFocusRestoreTimer();
		      const timer = setTimeout(() => {
		        if (popoverFocusRestoreTimer !== timer) return;
		        popoverFocusRestoreTimer = null;
		        if (!popoverContainsFocus(popover)) return;
		        if (focusPopoverTarget(fallbackTarget)) return;
		        restorePopoverFocus(null);
		      }, 0);
		      popoverFocusRestoreTimer = timer;
		    }

		    function dismissPopoverFromOutsidePointer(popover, trigger, closePopover, target) {
		      if (!isPopoverOpen(popover)) return;
		      if (elementContainsTarget(popover, target) || elementContainsTarget(trigger, target)) return;
		      restoreFocusAfterPointerDismiss(popover, target);
		      closePopover({ restoreFocus: false });
		    }

	    function closeContextPopover(options) {
	      if (!contextPopover) return;
	      const wasOpen = isPopoverOpen(contextPopover);
	      const focusReturnTarget = contextPopoverFocusReturnTarget || contextIndicator;
	      contextPopoverFocusReturnTarget = null;
	      if (!wasOpen) return;
	      setPopoverOpenState(contextPopover, false);
	      setAttributeValue(contextIndicator, 'aria-expanded', 'false');
	      if (!options || options.restoreFocus !== false) {
	        restorePopoverFocus(focusReturnTarget);
	      }
	    }

	    function closeTodoPopover(options) {
	      if (!todoPopover) return;
	      const wasOpen = isPopoverOpen(todoPopover);
	      const focusReturnTarget = todoPopoverFocusReturnTarget || todoIndicator;
	      todoPopoverFocusReturnTarget = null;
	      if (!wasOpen) return;
	      setPopoverOpenState(todoPopover, false);
	      setAttributeValue(todoIndicator, 'aria-expanded', 'false');
	      if (!options || options.restoreFocus !== false) {
	        restorePopoverFocus(focusReturnTarget);
	      }
	    }

	    let outputModalText = '';
		    let outputModalTitleText = '';
	    let outputModalOpen = false;
	    let outputModalFocusReturnTarget = null;
	    const OUTPUT_MODAL_TITLE_DISPLAY_LIMIT = 160;

			    async function writeClipboard(text) {
			      if (text === undefined || text === null) return false;
			      const textToCopy = String(text);
			      if (!textToCopy) return false;
			      try {
			        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
			          await navigator.clipboard.writeText(textToCopy);
			          return true;
			        }
			      } catch {}

			      const el = document.createElement('textarea');
			      let appended = false;
			      try {
			        el.value = textToCopy;
		        el.setAttribute('readonly', 'true');
		        el.style.position = 'fixed';
		        el.style.top = '-9999px';
		        el.style.left = '-9999px';
		        el.style.opacity = '0';
		        el.style.pointerEvents = 'none';
		        document.body.appendChild(el);
		        appended = true;
		        el.select();
		        return !!document.execCommand('copy');
		      } catch {
		        return false;
		      } finally {
		        if (appended) {
		          try { document.body.removeChild(el); } catch {}
		        }
		      }
		    }

		    async function writeClipboardHtml(html, plainText) {
		      const htmlText = String(html || '');
		      if (!htmlText) return false;

		      try {
		        const ClipboardItemCtor = typeof ClipboardItem !== 'undefined' ? ClipboardItem : null;
		        if (ClipboardItemCtor && navigator && navigator.clipboard && navigator.clipboard.write) {
		          const plain = String(plainText || '').trim() || htmlText;
		          const item = new ClipboardItemCtor({
		            'text/html': new Blob([htmlText], { type: 'text/html' }),
		            'text/plain': new Blob([plain], { type: 'text/plain' })
		          });
		          await navigator.clipboard.write([item]);
		          return true;
		        }
		      } catch {}

		      return writeClipboard(htmlText);
			    }

			    let outputModalCopyResetTimer = null;
			    let outputModalCopyButtonCopied = null;

				    function setOutputModalCopyButtonState(copied) {
				      if (!outputModalCopy) return;
			      const copiedFlag = !!copied;
			      if (outputModalCopyButtonCopied === copiedFlag) return;
			      outputModalCopyButtonCopied = copiedFlag;
				      setTextContent(outputModalCopy, copiedFlag ? 'Copied' : 'Copy');
				      setAttributeValue(outputModalCopy, 'aria-label', copiedFlag ? 'Copied full output' : 'Copy full output');
				      setTitle(outputModalCopy, copiedFlag ? 'Copied full output' : 'Copy full output');
				    }

		    function clearOutputModalCopyResetTimer() {
		      if (!outputModalCopyResetTimer) return;
		      clearTimeout(outputModalCopyResetTimer);
		      outputModalCopyResetTimer = null;
		    }

		    function closeOutputModal() {
		      if (!outputModal) return;
		      const wasOpen = outputModalOpen;
		      const focusReturnTarget = outputModalFocusReturnTarget;
		      outputModalFocusReturnTarget = null;
		      clearOutputModalCopyResetTimer();
			      setOutputModalCopyButtonState(false);
		      if (!wasOpen) return;
		      if (outputModal.classList) {
		        outputModal.classList.toggle('hidden', true);
		      }
				      outputModalOpen = false;
				      setTitle(outputModalTitle, '');
				      setAttributeValue(outputModalBody, 'aria-label', 'Full output');
				      outputModalText = '';
			      outputModalTitleText = '';
				      if (focusReturnTarget && typeof focusReturnTarget.focus === 'function') {
				        focusPopoverTarget(focusReturnTarget);
				      }
			    }

	    function getOutputModalTitleDisplayText(title) {
	      const value = String(title || 'Output');
	      return value.length <= OUTPUT_MODAL_TITLE_DISPLAY_LIMIT
	        ? value
	        : value.slice(0, OUTPUT_MODAL_TITLE_DISPLAY_LIMIT) + '…';
	    }

		    function openOutputModal(title, text) {
		      if (!outputModal || !outputModalTitle || !outputModalBody) return;
	      const nextTitleText = String(title || 'Output');
	      const outputModalTitleDisplayText = getOutputModalTitleDisplayText(nextTitleText);
	      const nextModalText = String(text === undefined || text === null ? '' : text);
	      const wasOpen = outputModalOpen;
	      if (wasOpen && nextTitleText === outputModalTitleText && nextModalText === outputModalText) return;
	      if (wasOpen) {
	        clearOutputModalCopyResetTimer();
	        setOutputModalCopyButtonState(false);
	      }
	      if (!wasOpen) {
	        try {
	          const activeElement = document.activeElement;
	          outputModalFocusReturnTarget =
	            activeElement &&
	            activeElement !== document.body &&
	            activeElement !== outputModal &&
	            (!outputModal.contains || !outputModal.contains(activeElement)) &&
	            typeof activeElement.focus === 'function'
	              ? activeElement
	              : null;
	        } catch {
		          outputModalFocusReturnTarget = null;
		        }
		      }
		      outputModalTitleText = nextTitleText;
		      outputModalText = nextModalText;
		      setTextContent(outputModalTitle, outputModalTitleDisplayText);
	      setTitle(outputModalTitle, outputModalTitleDisplayText);
		      setTextContent(outputModalBody, outputModalText);
		      setAttributeValue(outputModalBody, 'aria-label', outputModalTitleDisplayText + ', full output');
		      if (!wasOpen) {
		        if (outputModal.classList) {
		          outputModal.classList.toggle('hidden', false);
		        }
		        outputModalOpen = true;
		      }
	      try { outputModalBody.scrollTop = 0; } catch {}
	      focusPopoverTarget(outputModalClose || outputModalCopy || outputModal);
    }

	    function isOutputModalOpen() {
	      return !!outputModal && outputModalOpen;
	    }

		    function isNodeEventTarget(target) {
		      if (!target) return false;
		      if (typeof Node === 'function') return target instanceof Node;
		      return typeof target.nodeType === 'number';
		    }

		    function elementContainsTarget(element, target) {
		      if (!element || !target) return false;
		      if (element === target) return true;
		      if (!isNodeEventTarget(target)) return false;
		      if (typeof element.contains !== 'function') return false;
		      return !!element.contains(target);
		    }

		    function isOutputModalEventTarget(target) {
		      if (!outputModal || !target) return false;
		      if (target === outputModal) return true;
		      return elementContainsTarget(outputModal, target);
		    }

		    function isInsideOpenOutputModal(target) {
		      return isOutputModalOpen() && isOutputModalEventTarget(target);
		    }

		    function consumeHandledEvent(event, preventDefault) {
		      if (!event) return;
		      if (preventDefault && event.preventDefault) event.preventDefault();
		      if (event.stopImmediatePropagation) {
		        event.stopImmediatePropagation();
		      } else if (event.stopPropagation) {
		        event.stopPropagation();
		      }
		    }

		    function isOutputModalFocusableControl(el) {
		      if (!el) return false;
		      if (el.disabled) return false;
		      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
		      if (typeof el.tabIndex === 'number' && el.tabIndex < 0) return false;
		      return typeof el.focus === 'function';
		    }

		    function getFirstOutputModalFocusableControl() {
		      if (isOutputModalFocusableControl(outputModalCopy)) return outputModalCopy;
		      if (isOutputModalFocusableControl(outputModalClose)) return outputModalClose;
		      if (isOutputModalFocusableControl(outputModalBody)) return outputModalBody;
		      return null;
		    }

		    function getLastOutputModalFocusableControl() {
		      if (isOutputModalFocusableControl(outputModalBody)) return outputModalBody;
		      if (isOutputModalFocusableControl(outputModalClose)) return outputModalClose;
		      if (isOutputModalFocusableControl(outputModalCopy)) return outputModalCopy;
		      return null;
		    }

		    function getNextOutputModalFocusableControl(activeElement, reverse) {
		      const copyFocusable = isOutputModalFocusableControl(outputModalCopy);
		      const closeFocusable = isOutputModalFocusableControl(outputModalClose);
		      const bodyFocusable = isOutputModalFocusableControl(outputModalBody);
		      if (!copyFocusable && !closeFocusable && !bodyFocusable) return null;
		      if (reverse) {
		        if (activeElement === outputModalCopy) return bodyFocusable ? outputModalBody : closeFocusable ? outputModalClose : outputModalCopy;
		        if (activeElement === outputModalClose) return copyFocusable ? outputModalCopy : bodyFocusable ? outputModalBody : outputModalClose;
		        if (activeElement === outputModalBody) return closeFocusable ? outputModalClose : copyFocusable ? outputModalCopy : outputModalBody;
		        return bodyFocusable ? outputModalBody : closeFocusable ? outputModalClose : outputModalCopy;
		      }
		      if (activeElement === outputModalCopy) return closeFocusable ? outputModalClose : bodyFocusable ? outputModalBody : outputModalCopy;
		      if (activeElement === outputModalClose) return bodyFocusable ? outputModalBody : copyFocusable ? outputModalCopy : outputModalClose;
		      if (activeElement === outputModalBody) return copyFocusable ? outputModalCopy : closeFocusable ? outputModalClose : outputModalBody;
		      return copyFocusable ? outputModalCopy : closeFocusable ? outputModalClose : outputModalBody;
		    }

		    function handleOutputModalTabKey(event) {
		      if (!isOutputModalOpen() || !event || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return false;
		      if (typeof event.preventDefault === 'function') event.preventDefault();
		      const firstFocusable = getFirstOutputModalFocusableControl();
		      const lastFocusable = getLastOutputModalFocusableControl();
		      if (!firstFocusable || !lastFocusable) {
			        focusPopoverTarget(outputModal);
			        return true;
			      }
		      const activeElement = document.activeElement;
		      const nextFocusable = getNextOutputModalFocusableControl(activeElement, !!event.shiftKey) || (event.shiftKey ? lastFocusable : firstFocusable);
			      focusPopoverTarget(nextFocusable);
			      return true;
			    }

	    function getToolModalTitle(toolCall) {
	      if (!toolCall) return 'Output';
	      const toolId = toolCall.id || '';
	      const rawArgsText = typeof toolCall.args === 'string' ? toolCall.args : '';
	      const args = getToolCardArgs(toolCall, rawArgsText);

		      const filePath = toolCall.path || args.filePath || args.path || '';
		      if (toolId === 'task') {
		        if (args.description) return String(args.description);
		        return String(toolCall.name || toolId);
		      }
		      if (toolId === 'bash') {
		        if (args.command) return 'Run: ' + String(args.command);
		        return 'Run Command';
		      }
		      if (toolId === 'grep') {
		        const p = args.pattern || args.query;
		        return p ? 'Grep "' + String(p) + '"' : 'Grep';
		      }
		      if (toolId === 'glob') {
		        return args.pattern ? ('Glob ' + String(args.pattern)) : (filePath ? 'List ' + filePath : 'List Files');
		      }
		      if (toolId === 'list') {
		        return filePath ? 'List ' + filePath : 'List Files';
		      }
		      if (toolId === 'read' || toolId === 'read_range') {
		        return filePath ? 'Read ' + filePath : 'Read File';
		      }
		      if (toolId === 'write' || toolId === 'edit') {
		        return filePath ? 'Edit ' + filePath : (toolCall.name || toolId);
		      }
		      if (toolCall.name) return String(toolCall.name);
		      return toolId || 'Output';
		    }

		    if (outputModal) {
		      outputModal.addEventListener('click', (e) => {
		        if (e && e.stopPropagation) e.stopPropagation();
		      });
		    }
		    if (outputModalBackdrop) {
		      outputModalBackdrop.addEventListener('click', (e) => {
		        consumeHandledEvent(e, true);
		        closeOutputModal();
		      });
		    }
		    if (outputModalClose) {
		      outputModalClose.addEventListener('click', (e) => {
		        consumeHandledEvent(e, true);
		        closeOutputModal();
		      });
		    }
		    function showOutputModalCopyFeedback() {
		      if (!outputModalCopy) return;
		      clearOutputModalCopyResetTimer();
		      setOutputModalCopyButtonState(true);
		      if (typeof announceStatus === 'function') announceStatus('Copied output.');
		      outputModalCopyResetTimer = setTimeout(() => {
		        setOutputModalCopyButtonState(false);
		        outputModalCopyResetTimer = null;
		      }, 900);
		    }

		    if (outputModalCopy) {
		      setOutputModalCopyButtonState(false);
		      outputModalCopy.addEventListener('click', async () => {
		        const ok = await writeClipboard(outputModalText);
		        if (!ok) return;
		        showOutputModalCopyFeedback();
		      });
		    }

	    // --- File path linkification (click to open) ---
	    const fileLinkCache = new Map(); // raw -> { ok, path, checkedAt }
	    const fileLinkPending = new Set(); // raw
		    const fileLinkCandidatesByRaw = new Map(); // raw -> Set<HTMLElement>
		    const fileLinkCandidatesByRoot = new WeakMap(); // root -> { generation, elements }
		    const fileLinkRawByElement = new WeakMap();
			    const fileLinkLocationByElement = new WeakMap();
			    const fileLinkGateStateByRoot = new WeakMap(); // root -> { generation, checkedLength, hasPathSignal }
			    const linkifyQueue = new Set(); // Set<Element>
			    const linkifyForceRootGeneration = new WeakMap(); // root -> fileLinkGeneration
			    let linkifyTimer = null;
			    let fileLinkGeneration = 0;
			    const FILE_LINK_CACHE_MAX_ENTRIES = 500;
			    const FILE_LINK_NEGATIVE_CACHE_TTL_MS = 5000;
			    const FILE_LINK_GATE_OVERLAP_CHARS = 256;
				    const FILE_LINK_TEXT_SIGNAL_RE = /(^|[\s([{<"'`])(?:[A-Za-z0-9_.-]*\.[A-Za-z][A-Za-z0-9_-]{0,15}|Makefile|Dockerfile|LICENSE|README)(?:#L\d+(?:C\d+)?|:\d+(?::\d+)?|:)?(?=$|[\s)\]}>,.;"'`])/i;
				    const FILE_LINK_TOKEN_RE = /\S+/g;
				    const EMPTY_FILE_LINK_CANDIDATES = [];
			    const FILE_LINK_TRAILING_COLON_WITHOUT_LINE_RE = /:\d+$/;
			    const FILE_LINK_VERSION_NUMBER_RE = /^\d+(?:\.\d+)+$/;
			    const FILE_LINK_ALPHA_RE = /[a-zA-Z]/;
			    const FILE_LINK_SPECIAL_BASENAME_RE = /^(Makefile|Dockerfile|LICENSE|README)$/i;
			    const FILE_LINK_HASH_LOCATION_RE = /^(.*)#L(\d+)(?:C(\d+))?$/;
			    const FILE_LINK_COLON_LOCATION_RE = /^(.*):(\d+)(?::(\d+))?$/;
			    const FILE_LINK_COLON_PREFIX_LOCATION_RE = /^(.*):(\d+)(?::(\d+))?:(.+)$/;
			    const FILE_LINK_LEADING_PUNCTUATION = '([{<"\'`';
			    const FILE_LINK_TRAILING_PUNCTUATION = ')]}>,.;"\'`';

		    function scheduleFileLinkify(rootEl, opts) {
		      if (!rootEl) return;
		      if (opts && opts.force) {
		        try { linkifyForceRootGeneration.set(rootEl, fileLinkGeneration); } catch {}
		      }
		      linkifyQueue.add(rootEl);
	      if (linkifyTimer) return;
	      linkifyTimer = setTimeout(() => {
	        linkifyTimer = null;
	        flushFileLinkifyQueue();
	      }, 80);
	    }

			    function scheduleFileLinkifyIfNeeded(rootEl, text, opts) {
			      if (!rootEl) return;
			      let gateState = fileLinkGateStateByRoot.get(rootEl);
			      if (!gateState || gateState.generation !== fileLinkGeneration) {
			        gateState = { generation: fileLinkGeneration, checkedLength: 0, hasPathSignal: false };
			        fileLinkGateStateByRoot.set(rootEl, gateState);
			      }
			      if (opts && opts.force) {
			        scheduleFileLinkify(rootEl, opts);
			        return;
			      }
			      if (gateState.hasPathSignal && !(opts && opts.appendOnly)) {
			        scheduleFileLinkify(rootEl, opts);
			        return;
			      }

			      const value = String(text === undefined || text === null ? '' : text);
			      const start = value.length >= gateState.checkedLength
			        ? Math.max(0, gateState.checkedLength - FILE_LINK_GATE_OVERLAP_CHARS)
			        : 0;
			      const checkText = value.slice(start);
			      gateState.checkedLength = value.length;
			      if (!looksLikeTextMayContainPath(checkText)) return;
			      gateState.hasPathSignal = true;
			      scheduleFileLinkify(rootEl, opts);
			    }

	    function resetFileLinkState() {
	      if (linkifyTimer) {
	        clearTimeout(linkifyTimer);
	        linkifyTimer = null;
	      }
	      linkifyQueue.clear();
	      fileLinkCache.clear();
	      fileLinkPending.clear();
	      fileLinkCandidatesByRaw.clear();
	      fileLinkGeneration++;
	    }

		    function pruneFileLinkCache() {
		      const oldestRaws = fileLinkCache.keys();
		      while (fileLinkCache.size > FILE_LINK_CACHE_MAX_ENTRIES) {
		        const next = oldestRaws.next();
		        if (next.done) return;
		        const oldestRaw = next.value;
		        if (oldestRaw === undefined) return;
		        fileLinkCache.delete(oldestRaw);
		      }
		    }

		    function rememberFileLinkCandidateRaw(el, raw) {
		      const value = String(raw || '');
		      if (el && value) fileLinkRawByElement.set(el, value);
		      return value;
		    }

		    function getFileLinkCandidateRaw(el) {
		      if (!el) return '';
		      const cached = fileLinkRawByElement.get(el);
		      return cached === undefined ? '' : cached;
		    }

		    function normalizeFileLinkLocationCoordinate(value) {
		      const parsed = Number(value);
		      return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
		    }

		    function rememberFileLinkCandidateLocation(el, line, character) {
		      const location = {
		        line: normalizeFileLinkLocationCoordinate(line),
		        character: normalizeFileLinkLocationCoordinate(character),
		      };
		      if (el) fileLinkLocationByElement.set(el, location);
		      return location;
		    }

		    function getFileLinkCandidateLocation(el) {
		      const cached = el ? fileLinkLocationByElement.get(el) : null;
		      return cached && cached.line > 0 ? cached : { line: 1, character: 1 };
		    }

		    function flushFileLinkifyQueue() {
	      const rootCount = linkifyQueue.size;
	      if (rootCount === 0) return;

	      const pendingRaw = [];
	      const pendingRawSet = new Set();
	      let negativeCacheNow = null;
	      function getNegativeCacheNow() {
	        if (negativeCacheNow === null) negativeCacheNow = Date.now();
	        return negativeCacheNow;
	      }

	      const roots = linkifyQueue.values();
	      for (let i = 0; i < rootCount; i++) {
	        const next = roots.next();
	        if (next.done) break;
	        const rootEl = next.value;
		        if (!rootEl) break;
		        linkifyQueue.delete(rootEl);
		        try {
		          const forceGeneration = linkifyForceRootGeneration.get(rootEl);
		          const force = forceGeneration === fileLinkGeneration;
		          if (forceGeneration !== undefined) {
		            try { linkifyForceRootGeneration.delete(rootEl); } catch {}
		          }
		          const markedCandidates = markFileCandidatesInElement(rootEl) || [];
	          for (let markedIndex = 0; markedIndex < markedCandidates.length; markedIndex++) {
	            const el = markedCandidates[markedIndex];
	            collectPendingFileLinkCandidate(el, force, pendingRawSet, pendingRaw, getNegativeCacheNow);
	          }
	          if (force || markedCandidates.length === 0) {
	            collectKnownFileLinkCandidatesForRoot(rootEl, force, pendingRawSet, pendingRaw, getNegativeCacheNow);
	          }
	        } catch {}
	      }

	      if (pendingRaw.length === 0) return;
	      requestResolveFileLinks(pendingRaw);
	    }

				    function isFileLinkTokenElement(el) {
				      if (!el) return false;
				      if (el.classList && typeof el.classList.contains === 'function') return el.classList.contains('file-link-token');
				      return (' ' + String(el.className || '') + ' ').indexOf(' file-link-token ') >= 0;
				    }

				    function createFileLinkCandidateSpan(part, rootEl, markedCandidates) {
				      const span = document.createElement('span');
				      span.className = 'file-link-token file-link-candidate';
				      rememberFileLinkCandidateRaw(span, part.fileRaw);
				      rememberFileLinkCandidateLocation(span, part.line, part.character);
				      span.textContent = getFileLinkCandidateDisplayLabel(part.label, part.fileRaw);
				      registerFileLinkCandidate(part.fileRaw, span, rootEl);
				      markedCandidates.push(span);
				      return span;
				    }

					    function markFileCandidatesInElement(rootEl) {
					      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
					      let candidates = null;
				      let n;
			      while ((n = walker.nextNode())) {
				        if (!n || !n.nodeValue) continue;
				        const text = String(n.nodeValue || '');
				        if (!looksLikeTextMayContainPath(text)) continue;
				        if (shouldSkipFileLinkify(n)) continue;
				        if (!candidates) candidates = [];
				        candidates.push(n);
				      }
				      if (!candidates) return EMPTY_FILE_LINK_CANDIDATES;

				      const markedCandidates = [];
		      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
		        const textNode = candidates[candidateIndex];
		        if (!textNode || !textNode.nodeValue) continue;
		        const text = String(textNode.nodeValue || '');

		        const parts = splitTextIntoFileLinkParts(text);
		        if (!parts || parts.length === 0) continue;

		        if (parts.length === 1 && parts[0].kind === 'file' && !parts[0].prefix && !parts[0].suffix) {
		          const span = createFileLinkCandidateSpan(parts[0], rootEl, markedCandidates);
		          try { textNode.parentNode.replaceChild(span, textNode); } catch {}
		          continue;
		        }

		        const frag = document.createDocumentFragment();
		        let didChange = false;
		        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
	          const part = parts[partIndex];
	          if (part.kind === 'text') {
	            frag.appendChild(document.createTextNode(part.text));
	            continue;
	          }

	          didChange = true;
		          if (part.prefix) frag.appendChild(document.createTextNode(part.prefix));

		          const span = createFileLinkCandidateSpan(part, rootEl, markedCandidates);
			          frag.appendChild(span);

			          if (part.suffix) frag.appendChild(document.createTextNode(part.suffix));
			        }

		        if (didChange) {
		          try { textNode.parentNode.replaceChild(frag, textNode); } catch {}
		        }
		      }
		      return markedCandidates;
		    }

		    function collectPendingFileLinkCandidate(el, force, pendingRawSet, pendingRaw, getNegativeCacheNow) {
		      const raw = getFileLinkCandidateRaw(el);
		      if (!raw) return;
	      registerFileLinkCandidate(raw, el);
	      if (!force) {
	        const cached = fileLinkCache.get(raw);
	        if (cached && cached.ok) return;
	        if (cached && !cached.ok) {
	          const now = typeof getNegativeCacheNow === 'function' ? getNegativeCacheNow() : Date.now();
	          const age = now - (Number(cached.checkedAt || 0) || 0);
	          if (age < FILE_LINK_NEGATIVE_CACHE_TTL_MS) return;
	          fileLinkCache.delete(raw);
	        }
	      }
	      if (fileLinkPending.has(raw)) return;
	      if (pendingRawSet.has(raw)) return;
	      pendingRawSet.add(raw);
	      pendingRaw.push(raw);
	    }

				    function shouldSkipFileLinkify(textNode) {
			      const parentEl = textNode ? textNode.parentElement : null;
			      let el = parentEl || null;
		      if (!el) return true;
		      while (el) {
	        const tag = String(el.tagName || '').toUpperCase();
		        if (
		          tag === 'A' ||
		          tag === 'BUTTON' ||
		          tag === 'TEXTAREA' ||
		          tag === 'SCRIPT' ||
		          tag === 'STYLE' ||
		          tag === 'PRE' ||
		          tag === 'CODE'
		        ) {
			          return true;
			        }
		        if (isFileLinkTokenElement(el)) return true;
		        if (
		          el.classList &&
	          (el.classList.contains('tool-diff-ln') ||
	            el.classList.contains('copy-btn') ||
	            el.classList.contains('tool-output') ||
	            el.classList.contains('tool-diff') ||
	            el.classList.contains('tool-diff-viewer'))
	        ) {
	          return true;
	        }
	        el = el.parentElement;
	      }
	      return false;
	    }

		    function looksLikeTextMayContainPath(text) {
		      const value = String(text === undefined || text === null ? '' : text);
	      if (!value) return false;
	      if (value.includes('file://') || value.includes('~/') || value.includes('/') || value.includes('\\')) return true;

		      return FILE_LINK_TEXT_SIGNAL_RE.test(value);
			    }

			    function splitTextIntoFileLinkParts(text) {
			      let out = null;
			      const re = FILE_LINK_TOKEN_RE;
			      re.lastIndex = 0;
		      let lastIndex = 0;
		      let match;

		      while ((match = re.exec(text))) {
		        const start = match.index;
	        const end = start + match[0].length;
	        const word = match[0];

		        const candidate = parseWordAsFileLinkCandidate(word);
		        if (!candidate) continue;

		        if (!out) out = [];
		        if (start > lastIndex) out.push({ kind: 'text', text: text.slice(lastIndex, start) });
		        out.push(candidate);
		        lastIndex = end;
		      }

		      if (!out) return null;
		      if (lastIndex < text.length) out.push({ kind: 'text', text: text.slice(lastIndex) });
		      return out;
		    }

	    function parseWordAsFileLinkCandidate(word) {
	      const raw = String(word || '');
	      if (!wordMayContainFileLinkSignal(raw)) return null;
	      const split = splitWordPunctuation(raw);
	      if (!split || !split.core) return null;
	      const core = split.core;
	      if (!isLikelyFilePathToken(core)) return null;

	      const loc = parsePathLocation(core);
	      if (!loc || !loc.path) return null;

	      return {
	        kind: 'file',
	        prefix: split.prefix,
	        suffix: String(loc.trailing || '') + split.suffix,
	        label: String(loc.label || core),
	        fileRaw: loc.path,
	        line: loc.line,
	        character: loc.character,
	      };
	    }

	    function wordMayContainFileLinkSignal(raw) {
	      if (!raw) return false;
	      let firstContentCode = 0;
	      for (let index = 0; index < raw.length; index++) {
	        const code = raw.charCodeAt(index);
	        if (code === 47 || code === 92 || code === 46 || code === 35 || code === 126 || code === 58) return true;
	        if (!firstContentCode && !isFileLinkLeadingPunctuationCode(code)) firstContentCode = code;
	      }
	      return isLikelySpecialFileBasenameStartCode(firstContentCode);
	    }

	    function isFileLinkLeadingPunctuationCode(code) {
	      return code === 40 || code === 91 || code === 123 || code === 60 ||
	        code === 34 || code === 39 || code === 96;
	    }

	    function isLikelySpecialFileBasenameStartCode(code) {
	      return code === 68 || code === 76 || code === 77 || code === 82 ||
	        code === 100 || code === 108 || code === 109 || code === 114;
	    }

	    function splitWordPunctuation(word) {
	      const raw = String(word || '');
	      if (!raw) return null;

	      let start = 0;
	      let end = raw.length;

	      while (start < end && FILE_LINK_LEADING_PUNCTUATION.includes(raw[start])) start++;
	      while (end > start && FILE_LINK_TRAILING_PUNCTUATION.includes(raw[end - 1])) end--;

	      let prefix = '';
	      let core = raw;
	      let suffix = '';
	      if (start > 0 || end < raw.length) {
	        prefix = start > 0 ? raw.slice(0, start) : '';
	        core = raw.slice(start, end);
	        suffix = end < raw.length ? raw.slice(end) : '';
	      }

		      if (core.endsWith(':') && !FILE_LINK_TRAILING_COLON_WITHOUT_LINE_RE.test(core)) {
	        core = core.slice(0, -1);
	        suffix = ':' + suffix;
	      }

	      if (!core) return null;
	      return { prefix, core, suffix };
	    }

	    function isLikelyFilePathToken(token) {
	      const value = String(token || '').trim();
	      if (!value) return false;
	      if (value.length > 260) return false;
	      const firstCode = value.charCodeAt(0);
	      if (firstCode === 72 || firstCode === 104 || firstCode === 87 || firstCode === 119) {
	        const lower = value.toLowerCase();
	        if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
	        if (lower.startsWith('www.')) return false;
	      }
	      const hasDot = value.includes('.');
	      if (value.includes('@') && hasDot) return false;
		      if (value.startsWith('file://')) return true;
		      if (value.startsWith('~/') || value.startsWith('~\\')) return true;
		      if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
		      if (value.includes('/') || value.includes('\\')) return true;
		      if (hasDot && FILE_LINK_VERSION_NUMBER_RE.test(value)) return false;
		      if (hasDot && FILE_LINK_ALPHA_RE.test(value)) return true;
		      if (FILE_LINK_SPECIAL_BASENAME_RE.test(value)) return true;
	      return false;
	    }

		    function hasPathLocationColon(value) {
		      let index = value.indexOf(':');
		      while (index >= 0 && index + 1 < value.length) {
		        const nextCode = value.charCodeAt(index + 1);
		        if (nextCode >= 48 && nextCode <= 57) return true;
		        index = value.indexOf(':', index + 1);
		      }
		      return false;
		    }

	    function parsePathLocation(token) {
	      const value = String(token || '').trim();
	      if (!value) return null;

		      if (value.includes('#L')) {
		        const hashMatch = FILE_LINK_HASH_LOCATION_RE.exec(value);
	        if (hashMatch) {
	          return {
	            path: hashMatch[1] || '',
	            line: Number(hashMatch[2] || 1) || 1,
	            character: Number(hashMatch[3] || 1) || 1,
	            label: value,
	            trailing: '',
	          };
	        }
	      }

		      if (hasPathLocationColon(value)) {
		        const colonMatch = FILE_LINK_COLON_LOCATION_RE.exec(value);
	        if (colonMatch) {
	          const character = Number(colonMatch[3] || 1) || 1;
	          return {
	            path: colonMatch[1] || '',
	            line: Number(colonMatch[2] || 1) || 1,
	            character,
	            label: value,
	            trailing: '',
	          };
	        }

		        const colonPrefixMatch = FILE_LINK_COLON_PREFIX_LOCATION_RE.exec(value);
	        if (colonPrefixMatch) {
	          const basePath = colonPrefixMatch[1] || '';
	          const line = Number(colonPrefixMatch[2] || 1) || 1;
	          const character = Number(colonPrefixMatch[3] || 1) || 1;
	          const hasCharacter = !!colonPrefixMatch[3];
	          const label = basePath + ':' + String(line) + (hasCharacter ? ':' + String(character) : '');
	          return {
	            path: basePath,
	            line,
	            character,
	            label,
	            trailing: ':' + String(colonPrefixMatch[4] || ''),
	          };
	        }
	      }

	      return { path: value, line: 1, character: 1, label: value, trailing: '' };
	    }

	    function registerFileLinkCandidate(raw, el, rootEl) {
	      if (!raw || !el) return;
	      rememberFileLinkCandidateRaw(el, raw);
	      let set = fileLinkCandidatesByRaw.get(raw);
	      if (!set) {
	        set = new Set();
	        fileLinkCandidatesByRaw.set(raw, set);
	      }
	      set.add(el);
	      registerRootFileLinkCandidate(rootEl, el);
	    }

	    function registerRootFileLinkCandidate(rootEl, el) {
	      if (!rootEl || !el) return;
	      let record = fileLinkCandidatesByRoot.get(rootEl);
	      if (!record || record.generation !== fileLinkGeneration) {
	        record = { generation: fileLinkGeneration, elements: new Set() };
	        fileLinkCandidatesByRoot.set(rootEl, record);
	      }
	      record.elements.add(el);
	    }

	    function getKnownFileLinkCandidatesForRoot(rootEl) {
	      const record = rootEl ? fileLinkCandidatesByRoot.get(rootEl) : null;
	      if (!record) return null;
	      if (record.generation !== fileLinkGeneration) {
	        fileLinkCandidatesByRoot.delete(rootEl);
	        return null;
	      }
	      return record.elements;
	    }

	    function collectKnownFileLinkCandidatesForRoot(rootEl, force, pendingRawSet, pendingRaw, getNegativeCacheNow) {
	      const elements = getKnownFileLinkCandidatesForRoot(rootEl);
	      if (!elements || elements.size === 0) return;
	      for (const el of elements) {
	        if (!el || el.isConnected === false) {
	          elements.delete(el);
	          continue;
	        }
	        collectPendingFileLinkCandidate(el, force, pendingRawSet, pendingRaw, getNegativeCacheNow);
	      }
	    }

	    function requestResolveFileLinks(rawPaths) {
	      if (!Array.isArray(rawPaths) || rawPaths.length === 0) return;

	      const chunkSize = 150;
	      let candidates = [];
	      for (let i = 0; i < rawPaths.length; i++) {
	        const raw = rawPaths[i];
	        if (!raw) continue;
	        candidates.push({ raw });
	        fileLinkPending.add(raw);
	        if (candidates.length >= chunkSize) {
	          postFileLinkResolveChunk(candidates);
	          candidates = [];
	        }
	      }
	      if (candidates.length > 0) {
	        postFileLinkResolveChunk(candidates);
	      }
	    }

	    function postFileLinkResolveChunk(candidates) {
	      if (!candidates || candidates.length === 0) return;
	      const requestId = String(Date.now()) + '_' + Math.random().toString(16).slice(2);
	      try {
	        vscode.postMessage({
	          type: 'resolveFileLinks',
	          requestId,
	          candidates,
	        });
		      } catch {
		        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
		          const candidate = candidates[candidateIndex];
		          fileLinkPending.delete(candidate.raw);
		        }
		      }
		    }

		    function handleResolvedFileLinks(data) {
		      const payload = data || {};
		      const results = Array.isArray(payload.results) ? payload.results : [];
		      if (results.length === 0) return;
		      const checkedAt = Date.now();
		      let cacheChanged = false;
		      for (let i = 0; i < results.length; i++) {
		        const r = results[i];
		        if (!r || typeof r !== 'object') continue;
		        const raw = typeof r.raw === 'string' ? r.raw : '';
		        if (!raw) continue;
		        const ok = !!r.ok;
		        const resolvedPath = ok && typeof r.path === 'string' ? r.path : '';
		        fileLinkCache.set(raw, { ok, path: resolvedPath, checkedAt });
		        cacheChanged = true;
		        fileLinkPending.delete(raw);
		        applyResolvedFileLink(raw);
		      }
		      if (cacheChanged) pruneFileLinkCache();
		    }

	    function applyResolvedFileLink(raw) {
	      const cached = fileLinkCache.get(raw);
	      if (!cached) return;
	      const set = fileLinkCandidatesByRaw.get(raw);
	      if (!set || set.size === 0) return;

	      for (const el of set) {
	        try {
	          if (!el || !el.isConnected) {
	            continue;
	          }
		          if (cached.ok && cached.path) {
		            const btn = document.createElement('button');
		            btn.type = 'button';
		            btn.className = 'file-link-token file-link';
		            rememberRenderedAction(btn, 'openLocation');
			            const location = getFileLinkCandidateLocation(el);
			            const line = location.line;
			            const character = location.character;
			            rememberOpenLocationPayload(btn, cached.path, line, character);
				            const displayPath = getFileLinkOpenDisplayPath(cached.path);
				            const openLabel = formatOpenLocationLabel(displayPath, line, character);
			            const visibleLabel = el.textContent || raw;
			            const accessibleLabel = formatOpenLocationAccessibleLabel(visibleLabel, displayPath, line, character);
		            setAttributeValue(btn, 'title', openLabel);
		            setAttributeValue(btn, 'aria-label', accessibleLabel);
		            btn.textContent = visibleLabel;
		            el.replaceWith(btn);
			          } else {
			            el.className = 'file-link-token file-link-candidate file-link-missing';
			            rememberFileLinkCandidateRaw(el, raw);
			          }
	        } catch {}
	      }

	      set.clear();
	      fileLinkCandidatesByRaw.delete(raw);
	    }

		    function renderContextPopover(ctx, renderKey) {
		      if (!contextPopoverBody) return;
			      const nextRenderKey = typeof renderKey === 'string' && renderKey ? renderKey : getContextPopoverRenderKey(ctx);
			      if (nextRenderKey === contextPopoverRenderKey) return;
		      contextPopoverRenderKey = nextRenderKey;
		      let fragment = null;
		      let singleContextNode = null;

	      const total = ctx && typeof ctx.totalTokens === 'number' ? ctx.totalTokens : undefined;
	      const contextLimit = ctx && typeof ctx.contextLimitTokens === 'number' ? ctx.contextLimitTokens : undefined;
	      const outputLimit = ctx && typeof ctx.outputLimitTokens === 'number' ? ctx.outputLimitTokens : undefined;
	      const percent = ctx && typeof ctx.percent === 'number' ? ctx.percent : undefined;
	      const input = ctx && typeof ctx.inputTokens === 'number' ? ctx.inputTokens : undefined;
	      const output = ctx && typeof ctx.outputTokens === 'number' ? ctx.outputTokens : undefined;
	      const cacheRead = ctx && typeof ctx.cacheReadTokens === 'number' ? ctx.cacheReadTokens : undefined;
	      const cacheWrite = ctx && typeof ctx.cacheWriteTokens === 'number' ? ctx.cacheWriteTokens : undefined;
		      const hasTokens = !!total && total > 0;
		      const appendContextNode = (node) => {
		        if (fragment) {
		          fragment.appendChild(node);
		        } else if (singleContextNode) {
		          fragment = document.createDocumentFragment();
		          fragment.appendChild(singleContextNode);
		          fragment.appendChild(node);
		          singleContextNode = null;
		        } else {
		          singleContextNode = node;
		        }
		      };

		      const addRow = (key, value) => {
	        const row = document.createElement('div');
	        row.className = 'context-row';
	        const k = document.createElement('span');
	        k.className = 'context-key';
	        k.textContent = key;
	        const v = document.createElement('span');
	        v.className = 'context-value';
		        v.textContent = value;
		        row.appendChild(k);
		        row.appendChild(v);
		        appendContextNode(row);
		      };

		      const addDivider = () => {
		        const div = document.createElement('div');
		        div.className = 'context-divider';
		        appendContextNode(div);
		      };

	      addRow('Total', total && total > 0 ? formatInt(total) : '—');
	      if (contextLimit && contextLimit > 0) {
	        const pct = hasTokens && percent !== undefined ? ' (' + String(percent) + '%)' : '';
	        addRow('Context limit', formatInt(contextLimit) + pct);
	      }
	      if (outputLimit && outputLimit > 0) addRow('Max output', formatInt(outputLimit));

	      const hasBreakdown =
	        (input !== undefined && input > 0) ||
	        (output !== undefined && output > 0) ||
	        (cacheRead !== undefined && cacheRead > 0) ||
	        (cacheWrite !== undefined && cacheWrite > 0);

	      if (hasBreakdown || !hasTokens) addDivider();

	      if (input !== undefined && input > 0) addRow('Input', formatInt(input));
	      if (output !== undefined && output > 0) addRow('Output', formatInt(output));
	      if (cacheRead !== undefined && cacheRead > 0) addRow('Cache read', formatInt(cacheRead));
	      if (cacheWrite !== undefined && cacheWrite > 0) addRow('Cache write', formatInt(cacheWrite));

		      if (!hasTokens) addRow('Note', 'Token usage unavailable');
		      replaceElementChildren(contextPopoverBody, fragment || singleContextNode);
		    }

		    function updateContextIndicatorState(ctx, renderKey) {
		      if (!contextIndicator) return;

		      latestContext = ctx || {};
		      const nextStateKey = typeof renderKey === 'string' && renderKey ? renderKey : getContextPopoverRenderKey(latestContext);
		      if (nextStateKey === contextIndicatorStateKey) {
		        if (isPopoverOpen(contextPopover)) {
		          renderContextPopover(latestContext, nextStateKey);
		        }
	        return;
	      }
	      contextIndicatorStateKey = nextStateKey;

	      const total = ctx && typeof ctx.totalTokens === 'number' ? ctx.totalTokens : undefined;
	      const contextLimit = ctx && typeof ctx.contextLimitTokens === 'number' ? ctx.contextLimitTokens : undefined;
	      const percent = ctx && typeof ctx.percent === 'number' ? ctx.percent : undefined;

	      const hasTokens = !!total && total > 0;
	      const shortTotal = hasTokens ? formatCompact(total) : '';
	      const shortPercent = hasTokens && typeof percent === 'number' ? String(percent) + '%' : '';
	      const label = hasTokens
	        ? (shortPercent ? shortTotal + ' tok ' + shortPercent : shortTotal + ' tok')
	        : 'Context';

	      let title = 'Context: ' + (hasTokens ? formatInt(total) : 'token usage unavailable');
	      if (contextLimit && contextLimit > 0) {
	        title += hasTokens ? ' / ' + formatInt(contextLimit) : ' · limit ' + formatInt(contextLimit);
	        if (hasTokens && percent !== undefined) {
	          title += ' (' + String(percent) + '%)';
	        }
	      } else {
	        title += hasTokens ? ' tokens' : '';
	      }
	      const input = ctx && typeof ctx.inputTokens === 'number' ? ctx.inputTokens : undefined;
	      const output = ctx && typeof ctx.outputTokens === 'number' ? ctx.outputTokens : undefined;
	      if (hasTokens && (input !== undefined || output !== undefined)) {
	        title += '\nInput: ' + formatInt(input || 0) + '  Output: ' + formatInt(output || 0);
	      } else if (!hasTokens) {
	        title += '\nOpen for memory recall and compaction controls.';
	      }

	      const isDanger = hasTokens && typeof percent === 'number' && percent >= 95;
	      const isWarn = hasTokens && typeof percent === 'number' && percent >= 80 && percent < 95;
	      setTextContent(contextIndicator, label);
	      setContextIndicatorVisible(true);
	      setClassPresence(contextIndicator, 'danger', isDanger);
	      setClassPresence(contextIndicator, 'warn', isWarn);
	      setTitle(contextIndicator, title);
	      setAttributeValue(contextIndicator, 'aria-label', label + ', context usage');

		      if (isPopoverOpen(contextPopover)) {
		        renderContextPopover(ctx, nextStateKey);
		      }
		    }

		    function renderEmptyTodoPopover() {
		      setAttributeValue(todoPopoverBody, 'role', 'note');
		      setAttributeValue(todoPopoverBody, 'aria-label', 'Todo list status');
		      const emptyEl = document.createElement('div');
		      emptyEl.className = 'todo-empty';
		      emptyEl.textContent = 'No todos yet. The agent can use todowrite to track a plan.';
		      replaceElementChildren(todoPopoverBody, emptyEl);
	    }

	    function renderTodoPopover(todos, renderState) {
	      if (!todoPopoverBody) return;
	      const todoRenderState = renderState && typeof renderState.key === 'string'
	        ? renderState
	        : getTodoRenderState(todos);
	      const nextRenderKey = todoRenderState.key;
	      if (nextRenderKey === todoPopoverRenderKey) return;
	      todoPopoverRenderKey = nextRenderKey;

	      const list = Array.isArray(todos) ? todos : [];
	      if (list.length === 0) {
	        renderEmptyTodoPopover();
	        return;
		      }
		      setAttributeValue(todoPopoverBody, 'role', 'list');
		      setAttributeValue(todoPopoverBody, 'aria-label', 'Todos');

	      const statusIcon = (status) => {
	        switch (status) {
	          case 'completed': return '[✓]';
	          case 'in_progress': return '[•]';
	          case 'cancelled': return '[✕]';
	          default: return '[ ]';
	        }
	      };

		      const totalFromState =
		        typeof todoRenderState.total === 'number' && todoRenderState.total >= 0
		          ? todoRenderState.total
		          : null;
			      let fragment = null;
			      let singleTodoRow = null;
			      let renderedCount = 0;
			      let scannedRenderableCount = 0;
		      for (let todoIndex = 0; todoIndex < list.length; todoIndex++) {
		        const t = list[todoIndex];
		        const content = getTodoRenderContent(t);
		        if (!content) continue;
		        scannedRenderableCount++;
		        if (renderedCount >= TODO_POPOVER_RENDER_LIMIT) {
		          if (totalFromState !== null) break;
		          continue;
		        }

		        const status = normalizeTodoStatus(typeof t.status === 'string' ? t.status : 'pending');
		        const priority = normalizeTodoPriority(typeof t.priority === 'string' ? t.priority : 'medium');

	        const row = document.createElement('div');
	        row.className = 'todo-item ' + status;
	        row.setAttribute('role', 'listitem');

	        const icon = document.createElement('div');
	        icon.className = 'todo-icon';
	        icon.setAttribute('aria-hidden', 'true');
	        icon.textContent = statusIcon(status);

	        const body = document.createElement('div');
	        body.className = 'todo-content';
	        body.textContent = getTodoDisplayContent(content);

	        const meta = document.createElement('div');
	        meta.className = 'todo-meta';

	        const statusPill = document.createElement('div');
	        statusPill.className = 'todo-pill ' + status;
	        statusPill.textContent =
	          status === 'in_progress'
	            ? 'in progress'
	            : status === 'cancelled'
	              ? 'cancelled'
	              : status;

	        const priorityPill = document.createElement('div');
	        priorityPill.className = 'todo-pill ' + priority;
	        priorityPill.textContent = priority;

	        meta.appendChild(statusPill);
	        meta.appendChild(priorityPill);

		        row.appendChild(icon);
		        row.appendChild(body);
		        row.appendChild(meta);
			        if (fragment) {
			          fragment.appendChild(row);
			        } else if (singleTodoRow) {
			          fragment = document.createDocumentFragment();
			          fragment.appendChild(singleTodoRow);
			          fragment.appendChild(row);
			          singleTodoRow = null;
			        } else {
			          singleTodoRow = row;
			        }
			        renderedCount++;
			      }
		      const totalRenderableCount =
		        totalFromState !== null && totalFromState >= renderedCount
		          ? totalFromState
		          : scannedRenderableCount;
		      if (!totalRenderableCount) {
		        renderEmptyTodoPopover();
		        return;
		      }
		      const hiddenCount = totalRenderableCount - renderedCount;
			      if (hiddenCount > 0) {
				        const overflow = document.createElement('div');
				        overflow.className = 'todo-popover-overflow';
				        overflow.setAttribute('role', 'listitem');
				        const hiddenText = hiddenCount + ' more ' + (hiddenCount === 1 ? 'todo' : 'todos');
				        overflow.setAttribute('aria-label', hiddenText);
				        overflow.textContent = '… and ' + hiddenText;
				        if (!fragment) {
				          fragment = document.createDocumentFragment();
				          if (singleTodoRow) {
				            fragment.appendChild(singleTodoRow);
				            singleTodoRow = null;
				          }
				        }
			        fragment.appendChild(overflow);
			      }
			      replaceElementChildren(todoPopoverBody, fragment || singleTodoRow);
			    }

	    function updateTodoIndicatorState(todos, renderState) {
	      if (!todoIndicator) return;
	      latestTodos = Array.isArray(todos) ? todos : [];
	      const todoRenderState = renderState && typeof renderState.key === 'string'
	        ? renderState
	        : getTodoRenderState(latestTodos);
	      const nextStateKey = todoRenderState.key;
	      if (nextStateKey === todoIndicatorStateKey) {
	        if (isPopoverOpen(todoPopover)) {
	          const existingTotal = typeof todoRenderState.total === 'number' ? todoRenderState.total : 0;
	          if (existingTotal > 0) {
	            renderTodoPopover(latestTodos, todoRenderState);
	          } else {
	            closeTodoPopover();
	          }
	        }
	        return;
	      }
	      todoIndicatorStateKey = nextStateKey;

	      const totalCount = typeof todoRenderState.total === 'number' ? todoRenderState.total : 0;
	      if (!totalCount) {
	        setTextContent(todoIndicator, '');
	        setAttributeValue(todoIndicator, 'aria-label', 'Todo list');
	        setTodoIndicatorVisible(false);
	        closeTodoPopover();
	        return;
	      }

	      setTodoIndicatorVisible(true);
	      const openCount = typeof todoRenderState.open === 'number' ? todoRenderState.open : 0;
	      const label = 'Todo · ' + formatCompact(openCount);
	      setTextContent(todoIndicator, label);
	      setAttributeValue(todoIndicator, 'aria-label', label + ', todo list');

	      if (isPopoverOpen(todoPopover)) {
	        renderTodoPopover(latestTodos, todoRenderState);
	      }
	    }

	    function openTodoPopover() {
	      if (!todoPopover) return;
	      const wasOpen = isPopoverOpen(todoPopover);
	      renderTodoPopover(latestTodos);
	      if (wasOpen) return;
	      todoPopoverFocusReturnTarget = getPopoverFocusReturnTarget(todoIndicator);
	      setPopoverOpenState(todoPopover, true);
	      setAttributeValue(todoIndicator, 'aria-expanded', 'true');
	      focusPopoverTarget(todoPopoverClose);
	    }

	    function toggleTodoPopover() {
	      if (!todoPopover) return;
	      if (isPopoverOpen(todoPopover)) {
	        closeTodoPopover();
	      } else {
	        openTodoPopover();
	      }
	    }

	    function openContextPopover() {
	      if (!contextPopover || !latestContext) return;
	      const wasOpen = isPopoverOpen(contextPopover);
	      renderContextPopover(latestContext);
	      if (wasOpen) return;
	      contextPopoverFocusReturnTarget = getPopoverFocusReturnTarget(contextIndicator);
	      setPopoverOpenState(contextPopover, true);
	      setAttributeValue(contextIndicator, 'aria-expanded', 'true');
	      focusPopoverTarget(contextPopoverClose);
	    }

	    function toggleContextPopover() {
	      if (!contextPopover) return;
	      if (isPopoverOpen(contextPopover)) {
	        closeContextPopover();
	      } else {
	        openContextPopover();
	      }
	    }

	    if (contextIndicator) {
	      contextIndicator.addEventListener('click', (e) => {
	        e.preventDefault();
	        e.stopPropagation();
	        toggleContextPopover();
	      });
	    }

	    if (todoIndicator) {
	      todoIndicator.addEventListener('click', (e) => {
	        e.preventDefault();
	        e.stopPropagation();
	        toggleTodoPopover();
	      });
	    }

	    if (contextPopoverClose) {
	      contextPopoverClose.addEventListener('click', (e) => {
	        e.preventDefault();
	        closeContextPopover();
	      });
	    }

	    if (todoPopoverClose) {
	      todoPopoverClose.addEventListener('click', (e) => {
	        e.preventDefault();
	        closeTodoPopover();
	      });
	    }

	    if (contextCompactNowBtn) {
	      contextCompactNowBtn.addEventListener('click', (e) => {
	        e.preventDefault();
	        if (!initReceived || isProcessing || sessionActionPending) return;
	        closeContextPopover();
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

				    document.addEventListener('mousedown', (e) => {
				      const target = e.target;
				      if (isInsideOpenOutputModal(target)) return;
				      dismissPopoverFromOutsidePointer(contextPopover, contextIndicator, closeContextPopover, target);
				      dismissPopoverFromOutsidePointer(todoPopover, todoIndicator, closeTodoPopover, target);
				    }, { capture: true });

		    document.addEventListener('keydown', (e) => {
		      if (handleOutputModalTabKey(e)) return;
		      if (typeof isEscapeKey === 'function' ? isEscapeKey(e) : e.key === 'Escape') {
		        if (isOutputModalOpen()) {
		          closeOutputModal();
		          consumeHandledEvent(e, true);
		          return;
		        }
		        const hadContextPopover = isPopoverOpen(contextPopover);
		        const hadTodoPopover = isPopoverOpen(todoPopover);
		        closeContextPopover();
		        closeTodoPopover();
		        if (hadContextPopover || hadTodoPopover) consumeHandledEvent(e, true);
		      }
		    });
