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
		    const sendBtn = document.getElementById('send');
		    const newSessionBtn = document.getElementById('newSession');
		    const compactSessionBtn = document.getElementById('compactSession');
		    const undoBtn = document.getElementById('undo');
		    const redoBtn = document.getElementById('redo');
	    const clearInputBtn = document.getElementById('clearInput');
	    const inputAttachments = document.getElementById('inputAttachments');
		    const sessionSelect = document.getElementById('sessionSelect');
	    const modelPicker = document.getElementById('modelPicker');
	    const modelPickerLabel = document.getElementById('modelPickerLabel');
	    const modelFavoriteToggle = document.getElementById('modelFavoriteToggle');
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
	    const contextIndicator = document.getElementById('contextIndicator');
	    const contextPopover = document.getElementById('contextPopover');
	    const contextPopoverBody = document.getElementById('contextPopoverBody');
	    const contextPopoverClose = document.getElementById('contextPopoverClose');
	    const contextCompactNowBtn = document.getElementById('contextCompactNow');
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
	    let canUndo = false;
	    let canRedo = false;
	    let currentRevertState = null;
	    let currentSessionId = '';
		    let currentModel = '';
		    let currentMode = 'build';
		    let currentOperation = null;
		    let operationTimer = null;
		    let pendingApprovalsCount = 0;
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
	    let pendingImageAttachments = [];

	    const SKILL_DROPDOWN_MAX_ITEMS = 30;
	    let availableSkills = [];
	    let skillDropdownOpen = false;
	    let skillDropdownItems = [];
	    let skillDropdownSelectedIndex = 0;
	    let skillDropdownTokenStart = -1;
	    let skillDropdownQuery = '';

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
	      if (!initReceived || isProcessing) {
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
	      operationLabelEl.textContent = currentOperation.label || 'Working…';

	      const status = currentOperation.status || 'running';
	      if (operationSpinner) {
	        operationSpinner.style.display = status === 'running' ? '' : 'none';
	      }
	      const elapsed = Date.now() - (currentOperation.startedAt || Date.now());
	      operationElapsedEl.textContent = status === 'running' ? formatElapsed(elapsed) : '';

	      if (operationStopBtn) {
	        operationStopBtn.disabled = !initReceived || !isProcessing || status !== 'running';
	      }
	    }

	    function updateApprovalBanner() {
	      if (!approvalBanner || !approvalLabelEl) return;

	      const show = pendingApprovalsCount > 0 && isProcessing && initReceived;
	      approvalBanner.classList.toggle('hidden', !show);
	      if (!show) return;

	      approvalLabelEl.textContent =
	        pendingApprovalsCount === 1
	          ? 'Waiting for approval (1)'
	          : 'Waiting for approval (' + pendingApprovalsCount + ')';

	      if (approvalAllowAllBtn) {
	        approvalAllowAllBtn.disabled = pendingApprovalsCount <= 0;
	      }
	      if (approvalStopBtn) {
	        approvalStopBtn.disabled = false;
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

	    function showFatalError(err) {
	      try {
	        const message = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
	        if (modelPickerLabel) {
	          modelPickerLabel.textContent = 'Webview error';
	        } else if (modelPicker) {
	          modelPicker.textContent = 'Webview error';
	        }
	        if (modelFavoriteToggle) {
	          modelFavoriteToggle.disabled = true;
	          modelFavoriteToggle.textContent = '☆';
	        }
	        const banner = document.createElement('div');
	        banner.style.padding = '10px 12px';
	        banner.style.margin = '10px';
	        banner.style.border = '1px solid var(--vscode-testing-iconFailed, #f14c4c)';
	        banner.style.borderRadius = '8px';
	        banner.style.background = 'var(--vscode-inputValidation-errorBackground, rgba(241,76,76,0.1))';
	        banner.style.color = 'var(--vscode-foreground)';
	        banner.style.whiteSpace = 'pre-wrap';
	        banner.textContent = 'LingYun webview crashed:\\n\\n' + message + '\\n\\nOpen “Developer: Open Webview Developer Tools” for details.';
	        document.body.insertBefore(banner, document.body.firstChild);
	        try { vscode.postMessage({ type: 'webviewError', error: message }); } catch {}
	      } catch {
	        // Ignore secondary errors
	      }
	    }

	    window.addEventListener('error', (e) => showFatalError(e.error || e.message));
	    window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason));

	    if (modelPickerLabel) {
	      modelPickerLabel.textContent = 'Connecting…';
	    } else if (modelPicker) {
	      modelPicker.textContent = 'Connecting…';
	    }
	    if (modelFavoriteToggle) {
	      modelFavoriteToggle.disabled = true;
	      modelFavoriteToggle.textContent = '☆';
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
	      if (!initReceived || isProcessing) return;
	      if (nextMode === currentMode) return;
	      try { vscode.postMessage({ type: 'changeMode', mode: nextMode }); } catch {}
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
	        if (!initReceived || isProcessing) return;
	        try { vscode.postMessage({ type: 'newSession' }); } catch {}
	      });
	    }

	    if (compactSessionBtn) {
	      compactSessionBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing) return;
	        try { vscode.postMessage({ type: 'compactSession' }); } catch {}
	      });
	    }

	    if (operationStopBtn) {
	      operationStopBtn.addEventListener('click', () => {
	        if (!initReceived || !isProcessing) return;
	        try { vscode.postMessage({ type: 'abort' }); } catch {}
	      });
	    }

	    if (undoBtn) {
	      undoBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || !canUndo) return;
	        try { vscode.postMessage({ type: 'undo' }); } catch {}
	      });
	    }

	    if (redoBtn) {
	      redoBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || !canRedo) return;
	        try { vscode.postMessage({ type: 'redo' }); } catch {}
	      });
	    }

	    if (revertRedoBtn) {
	      revertRedoBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || !canRedo) return;
	        try { vscode.postMessage({ type: 'redo' }); } catch {}
	      });
	    }

	    if (revertRedoAllBtn) {
	      revertRedoAllBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || !canRedo) return;
	        try { vscode.postMessage({ type: 'redoAll' }); } catch {}
	      });
	    }

	    if (revertDiscardBtn) {
	      revertDiscardBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || !currentRevertState) return;
	        try { vscode.postMessage({ type: 'discardUndone' }); } catch {}
	      });
	    }

	    if (revertDiffBtn) {
	      revertDiffBtn.addEventListener('click', () => {
	        if (!initReceived || isProcessing || !currentRevertState) return;
	        try { vscode.postMessage({ type: 'viewRevertDiff' }); } catch {}
	      });
	    }

			    if (sessionSelect) {
			      sessionSelect.addEventListener('change', () => {
			        const next = sessionSelect.value;
			        if (!initReceived || isProcessing) return;
			        if (!next || next === currentSessionId) return;
			        try { vscode.postMessage({ type: 'switchSession', sessionId: next }); } catch {}
			      });
			    }

			    if (modelPicker) {
			      modelPicker.addEventListener('click', () => {
			        if (!initReceived || isProcessing) return;
			        try { vscode.postMessage({ type: 'pickModel' }); } catch {}
			      });
			    }

			    if (modelFavoriteToggle) {
			      modelFavoriteToggle.addEventListener('click', () => {
			        if (!initReceived || isProcessing) return;
			        if (!currentModel) return;
			        try { vscode.postMessage({ type: 'toggleFavoriteModel', model: currentModel }); } catch {}
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
      if (!initReceived || isProcessing) return;

      const items = e && e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
      if (!items.length) return;

      const slotsLeft = MAX_CLIPBOARD_IMAGES - pendingImageAttachments.length;
      if (slotsLeft <= 0) return;

      const imageFiles = [];
      for (const item of items) {
        if (!item || item.kind !== 'file') continue;
        const mediaType = typeof item.type === 'string' ? item.type.toLowerCase() : '';
        if (!mediaType.startsWith('image/')) continue;
        const file = item.getAsFile ? item.getAsFile() : null;
        if (!file) continue;
        imageFiles.push(file);
        if (imageFiles.length >= slotsLeft) break;
      }

      if (!imageFiles.length) return;

      const next = [];
      for (const file of imageFiles) {
        const mediaType = typeof file.type === 'string' ? file.type.trim() : '';
        if (!mediaType.toLowerCase().startsWith('image/')) continue;

        let dataUrl = '';
        try {
          dataUrl = String(await readFileAsDataUrl(file));
        } catch {
          continue;
        }

        const trimmedData = dataUrl.trim();
        if (!trimmedData.startsWith('data:image/')) continue;
        if (trimmedData.length > MAX_CLIPBOARD_IMAGE_DATA_URL_CHARS) continue;

        next.push({
          id: String(Date.now()) + '_' + Math.random().toString(16).slice(2),
          mediaType,
          filename: typeof file.name === 'string' ? file.name : '',
          dataUrl: trimmedData,
        });
      }

      if (!next.length) return;

      pendingImageAttachments = pendingImageAttachments.concat(next).slice(0, MAX_CLIPBOARD_IMAGES);
      renderInputAttachments();
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
        if (e.ctrlKey || e.metaKey) {
          send();
        } else if (isProcessing) {
          vscode.postMessage({ type: 'abort' });
        } else {
          send();
        }
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
        if (isProcessing) {
          vscode.postMessage({ type: 'abort' });
        }
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

	    sendBtn.addEventListener('click', () => isProcessing ? vscode.postMessage({ type: 'abort' }) : send());

	    if (approvalAllowAllBtn) {
	      approvalAllowAllBtn.addEventListener('click', () => {
	        if (!initReceived || !isProcessing) return;
	        vscode.postMessage({ type: 'approveAll' });
	      });
	    }
	    if (approvalStopBtn) {
	      approvalStopBtn.addEventListener('click', () => {
	        if (!initReceived || !isProcessing) return;
	        vscode.postMessage({ type: 'abort' });
	      });
	    }

	    document.addEventListener('click', (e) => {
      if (skillDropdownOpen) {
        const target = e && e.target ? e.target : null;
        const clickedDropdown = !!(skillDropdown && target && skillDropdown.contains && skillDropdown.contains(target));
        const clickedInput = target === input;
        if (!clickedDropdown && !clickedInput) {
          closeSkillDropdown();
        }
      }

      const quickAction = e.target.closest('.quick-action');
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

		    const defaultPlaceholder = input.placeholder || 'Describe a task...';

		    function send() {
		      const text = input.value.trim();
		      const hasAttachments = pendingImageAttachments.length > 0;
		      const requiresText = planPending && currentMode === 'plan';
		      if (!initReceived || isProcessing) return;
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
		      } catch {}
		      input.value = '';
		      clearPendingImageAttachments();
		      updateInputLayout();
		      syncInputState();
		    }

		    function syncInputState() {
		      const connected = initReceived;
		      const showPlanUpdate = planPending && currentMode === 'plan';
		      const hasContent = showPlanUpdate
		        ? !!input.value.trim()
		        : (!!input.value.trim() || pendingImageAttachments.length > 0);
		      input.disabled = !connected || isProcessing;
		      input.placeholder = connected
	        ? (showPlanUpdate ? 'Answer plan questions / add constraints…' : defaultPlaceholder)
	        : 'Connecting…';
		      clearInputBtn.disabled = !connected || (!input.value.trim() && pendingImageAttachments.length === 0) || isProcessing;
		      if (newSessionBtn) newSessionBtn.disabled = !connected || isProcessing;
		      if (compactSessionBtn) compactSessionBtn.disabled = !connected || isProcessing;
		      if (undoBtn) undoBtn.disabled = !connected || isProcessing || !canUndo;
		      if (redoBtn) redoBtn.disabled = !connected || isProcessing || !canRedo;
		      if (sessionSelect) sessionSelect.disabled = !connected || isProcessing;
		      if (modePlanBtn) modePlanBtn.disabled = !connected || isProcessing;
		      if (modeBuildBtn) modeBuildBtn.disabled = !connected || isProcessing;
		      if (contextIndicator) contextIndicator.disabled = !connected;
		      if (contextCompactNowBtn) contextCompactNowBtn.disabled = !connected || isProcessing;
		      if (operationStopBtn) {
		        operationStopBtn.disabled =
		          !connected ||
		          !isProcessing ||
		          !currentOperation ||
		          (currentOperation.status || 'running') !== 'running';
		      }
		      syncRevertBarButtons();
		      updateApprovalBanner();

		      if (!connected) {
		        sendBtn.innerHTML = '<span>…</span><span>Connecting</span>';
	        sendBtn.disabled = true;
	        return;
	      }

	      if (isProcessing) {
	        sendBtn.innerHTML = '<span class="stop-icon"></span><span>Stop</span>';
	        sendBtn.title = 'Stop the current run (Ctrl+.)';
	        sendBtn.classList.add('stop');
	      } else if (showPlanUpdate) {
	        sendBtn.innerHTML = '<span>↻</span><span>Update Plan</span>';
	        sendBtn.title = '';
	        sendBtn.classList.remove('stop');
	      } else {
	        sendBtn.innerHTML = '<span>→</span><span>Send</span>';
	        sendBtn.title = '';
	        sendBtn.classList.remove('stop');
	      }
	      sendBtn.disabled = !isProcessing && !hasContent;
	    }

	    function setProcessing(val) {
	      isProcessing = val;
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
	      const enabled = initReceived && !isProcessing && !!currentRevertState;
	      if (revertRedoBtn) revertRedoBtn.disabled = !enabled || !canRedo;
	      if (revertRedoAllBtn) revertRedoAllBtn.disabled = !enabled || !canRedo;
	      if (revertDiffBtn) revertDiffBtn.disabled = !enabled;
	      if (revertDiscardBtn) revertDiscardBtn.disabled = !enabled;
	    }

	    function updateRevertBar(state) {
	      currentRevertState = state && state.active ? state : null;
	      if (!revertBar) return;

	      if (!currentRevertState) {
	        revertBar.classList.add('hidden');
	        if (revertSummary) revertSummary.textContent = '';
	        if (revertFiles) revertFiles.hidden = true;
	        if (revertFilesList) revertFilesList.innerHTML = '';
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
