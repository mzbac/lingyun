function createMessageElement(msg, isTool = false) {
	const el = document.createElement('div');

	if (msg.role === 'step') {
		const status = msg.step?.status || 'running';
		const mode = msg.step?.mode || 'Build';
		const model = msg.step?.model || '';

		el.className = 'step ' + status;
		el.innerHTML =
			'<div class="step-body"></div>' +
			'<div class="step-footer">' +
			'<span class="step-dot"></span>' +
			'<span class="step-mode">' + escapeHtml(mode) + '</span>' +
			'<span class="step-sep"' + (model ? '' : ' style="display:none"') + '>·</span>' +
			'<span class="step-model"' + (model ? '' : ' style="display:none"') + '>' + escapeHtml(model) + '</span>' +
			'</div>';

		const body = el.querySelector('.step-body');
		if (body) stepBodies.set(msg.id, body);
	} else if (msg.role === 'plan') {
		el.className = 'message ' + msg.role;
		if (msg.plan?.status) el.classList.add(msg.plan.status);
		el.innerHTML = formatPlanCard(msg);
		const activityBody = el.querySelector('.plan-activity-body');
		if (activityBody) stepBodies.set(msg.id, activityBody);
	} else if (msg.role === 'operation') {
		const op = msg.operation || {};
		const status = op.status || 'running';
		const label = op.label || msg.content || 'Operation';
		const startedAt = op.startedAt || msg.timestamp || Date.now();
		const time = new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		const statusLabel =
			status === 'running'
				? 'Running'
				: status === 'done'
					? 'Done'
					: status === 'canceled'
						? 'Canceled'
						: 'Failed';
		const detail = op.detail ? String(op.detail) : '';
		const summaryText = typeof op.summaryText === 'string' ? op.summaryText : '';
		const hasSummary = !!summaryText.trim();

		el.className = 'operation-card ' + status;
		el.innerHTML =
			'<div class="operation-icon">↔</div>' +
			'<div class="operation-body">' +
			'<div class="operation-top">' +
			'<div class="operation-title">' + escapeHtml(label) + '</div>' +
			'<div class="operation-status">' + escapeHtml(statusLabel + ' · ' + time) + '</div>' +
			'</div>' +
			(detail ? '<div class="operation-detail">' + escapeHtml(detail) + '</div>' : '') +
			(hasSummary
				? '<div class="operation-actions">' +
					'<button class="operation-action-link" type="button" data-action="viewCompactionSummary">View summary</button>' +
				'</div>'
				: '') +
			'</div>';
	} else if (msg.toolCall) {
		el.className = 'tool-message';
		el.innerHTML = '<div class="tool-avatar">' + (toolIcons[msg.toolCall.id] || '🔧') + '</div>' +
			'<div class="tool-card ' + msg.toolCall.status + '">' +
			formatToolSummary(msg.toolCall).replace(/<div class="tool-card[^>]*>/, '').replace(/<\/div>$/, '') +
			'</div>';
	} else {
		el.className = 'message ' + msg.role;
		const avatar = document.createElement('div');
		avatar.className = 'message-avatar';
		// Robot icon for Assistant
		if (msg.role === 'assistant') {
			avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M8 1a1.5 1.5 0 0 0-1.5 1.5V3H4.5A2.5 2.5 0 0 0 2 5.5V10a2.5 2.5 0 0 0 2.5 2.5h.504a4.49 4.49 0 0 1-.504 1 1 1 0 0 0 1 1h5a1 1 0 0 0 1-1 4.49 4.49 0 0 1-.504-1h.504a2.5 2.5 0 0 0 2.5-2.5V5.5A2.5 2.5 0 0 0 11.5 3H9.5v-.5A1.5 1.5 0 0 0 8 1zm3.5 4H4.5a.5.5 0 0 0-.5.5V10a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V5.5a.5.5 0 0 0-.5-.5zM6 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>';
		}
		// Person icon for User
		else if (msg.role === 'user') {
			avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 1 4zm-1 0c0-1-1-3-5-3S3 9 3 10h10z"/></svg>';
		}
		// Lightbulb for Thought
		else if (msg.role === 'thought') {
			avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13a.5.5 0 0 1 0 1 .5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1 0-1 .5.5 0 0 1 0-1 .5.5 0 0 1-.46-.302l-.761-1.77a1.964 1.964 0 0 0-.453-.618A5.984 5.984 0 0 1 2 6zm6-5a5 5 0 0 0-3.479 8.592c.263.254.514.564.676.941L5.83 12h4.342l.632-1.467c.162-.377.413-.687.676-.941A5 5 0 0 0 8 1z"/></svg>';
		} else {
			avatar.textContent = avatarColors[msg.role] || '?';
		}
		el.appendChild(avatar);

		const content = document.createElement('div');
		content.className = 'message-content';
		if (msg.role === 'assistant') {
			const bubble = document.createElement('div');
			bubble.className = 'message-bubble';

			const actions = document.createElement('div');
			actions.className = 'message-actions';
			actions.innerHTML =
				'<button class="message-action-btn" type="button" data-action="copyAssistantMarkdown" title="Copy Markdown" aria-label="Copy assistant markdown">MD</button>' +
				'<button class="message-action-btn" type="button" data-action="copyAssistantHtml" title="Copy HTML" aria-label="Copy assistant HTML">HTML</button>';

			content.classList.add('md');
			const raw = msg.content || '';
			content.dataset.raw = raw;
			content.innerHTML = renderMarkdown(raw);

			bubble.appendChild(content);
			bubble.appendChild(actions);
			el.appendChild(bubble);
		} else if (msg.role === 'user') {
			content.innerHTML = escapeHtml(msg.content || '');
			el.appendChild(content);
		} else if (msg.role === 'thought') {
			// Show thinking as a collapsible block (when enabled by settings).
			const details = document.createElement('details');
			details.className = 'thinking-details';
			// Default open so streamed reasoning is visible without an extra click.
			details.open = true;

			const summary = document.createElement('summary');
			summary.className = 'thinking-summary';
			summary.textContent = 'Thinking';

			const body = document.createElement('div');
			body.className = 'thinking-text';
			body.textContent = msg.content || '';

			details.appendChild(summary);
			details.appendChild(body);
			content.appendChild(details);
			el.appendChild(content);
		} else {
			content.textContent = msg.content || '…';
			el.appendChild(content);
		}
	}

	el.dataset.id = msg.id;
	return el;
}

function getStepBody(stepId) {
	if (!stepId) return null;
	const cached = stepBodies.get(stepId);
	if (cached) return cached;

	const stepEl = messageEls.get(stepId);
	if (!stepEl) return null;

	const body = stepEl.querySelector('.step-body');
	if (body) {
		stepBodies.set(stepId, body);
		return body;
	}

	const planBody = stepEl.querySelector('.plan-activity-body');
	if (planBody) {
		stepBodies.set(stepId, planBody);
		return planBody;
	}
	return null;
}

function addMessage(msg) {
	empty.style.display = 'none';

	if (msg && typeof msg.id === 'string') {
		messageDataById.set(msg.id, msg);
	}

	const prevCanUndo = canUndo;
	const prevCanRedo = canRedo;
	const wasNearBottom = isNearBottom();

	const isUserFollowup = msg.role === 'user' && msg.turnId && turnEls.has(msg.turnId);

	if (msg.role === 'user') {
		activeTurnId = isUserFollowup ? msg.turnId : msg.id;
		canUndo = true;
		if (isProcessing) {
			const suppressTurnStatus =
				!!currentOperation &&
				(currentOperation.status || 'running') === 'running' &&
				currentOperation.kind === 'compact';
			turnEls.forEach((_turnData, turnId) => {
				updateTurnState(turnId, !suppressTurnStatus && turnId === activeTurnId);
			});
		}
	}

	if (msg.role === 'step') {
		lastToolMsg = null;
	}

	if (msg.toolCall && BATCH_TOOL_TYPES.includes(msg.toolCall.id)) {
		const currentToolId = msg.toolCall.id;
		const currentPath = msg.toolCall.path || '';

		if (lastToolMsg && lastToolMsg.toolCall && lastToolMsg.toolCall.id === currentToolId && currentPath) {
			const existingFiles = lastToolMsg.toolCall.batchFiles || [lastToolMsg.toolCall.path || ''];
			const isDuplicate = existingFiles.includes(currentPath);

			if (!isDuplicate) {
				if (!lastToolMsg.toolCall.batchFiles) {
					const firstPath = lastToolMsg.toolCall.path || '';
					lastToolMsg.toolCall.batchFiles = firstPath ? [firstPath] : [];
				}
				lastToolMsg.toolCall.batchFiles.push(currentPath);

				const existingEl = messageEls.get(lastToolMsg.id);
				if (existingEl) {
					const cardEl = existingEl.querySelector('.tool-card');
					if (cardEl) {
						cardEl.innerHTML = formatToolSummary(lastToolMsg.toolCall).replace(/<div class="tool-card[^>]*>/, '').replace(/<\/div>$/, '');
					}
				}

				messageEls.set(msg.id, existingEl);
				maybeAutoScroll(wasNearBottom);
				return;
			}
		}
	}

	if (!msg.toolCall) {
		lastToolMsg = null;
	}

	let container;
	let el;

	if (msg.role === 'user' && !isUserFollowup) {
		const turnId = msg.id;
		const turnEl = document.createElement('div');
		turnEl.className = 'turn';
		turnEl.dataset.turnId = turnId;

		const turnResponse = document.createElement('div');
		turnResponse.className = 'turn-response';

		const turnStatusBar = document.createElement('div');
		turnStatusBar.className = 'turn-status-bar';
		turnStatusBar.style.display = 'none';

		const spinner = document.createElement('span');
		spinner.className = 'turn-spinner';
		turnStatusBar.appendChild(spinner);

		const statusText = document.createElement('span');
		statusText.className = 'turn-status-text';
		turnStatusBar.appendChild(statusText);

		const turnActivity = document.createElement('details');
		turnActivity.className = 'turn-activity';
		turnActivity.dataset.turnId = turnId;
		turnActivity.open = false;
		turnActivity.hidden = true;

		const activitySummary = document.createElement('summary');
		activitySummary.className = 'turn-activity-summary';
		activitySummary.textContent = 'Activity';

		const activityCountEl = document.createElement('span');
		activityCountEl.className = 'turn-activity-count';
		activitySummary.appendChild(activityCountEl);

		const activityBody = document.createElement('div');
		activityBody.className = 'turn-activity-body';

		turnActivity.appendChild(activitySummary);
		turnActivity.appendChild(activityBody);

		turnActivity.addEventListener('toggle', () => {
			persistActivityOpenState(turnId, turnActivity.open);
		});

		turnResponse.appendChild(turnStatusBar);
		turnEl.appendChild(turnResponse);
		turnEl.appendChild(turnActivity);

		messages.appendChild(turnEl);
		turnEls.set(turnId, {
			el: turnEl,
			response: turnResponse,
			statusBar: turnStatusBar,
			spinner: spinner,
			statusText: statusText,
			activity: turnActivity,
			activityBody: activityBody,
			activityCountEl,
			activityCount: 0,
			startTime: msg.timestamp,
			currentStatus: '',
			isProcessing: false,
		});

		updateTurnState(turnId, isProcessing && turnId === activeTurnId);

		el = createMessageElement(msg, !!msg.toolCall);
		turnResponse.insertBefore(el, turnStatusBar);
	} else if (msg.turnId) {
		const turnData = turnEls.get(msg.turnId);
		if (turnData) {
			const parent = msg.stepId ? getStepBody(msg.stepId) : null;
			if (parent) {
				el = createMessageElement(msg, !!msg.toolCall);
				parent.appendChild(el);
			} else if (msg.role === 'assistant' || msg.role === 'thought') {
				el = createMessageElement(msg, !!msg.toolCall);
				turnData.response.insertBefore(el, turnData.statusBar);
			} else if (msg.role === 'step' || msg.role === 'tool') {
				// Keep steps/tools in the main timeline so users can see progress.
				// even if the model emits tool calls before any assistant text.
				el = createMessageElement(msg, !!msg.toolCall);
				turnData.response.insertBefore(el, turnData.statusBar);
			} else {
				el = createMessageElement(msg, !!msg.toolCall);
				turnData.response.insertBefore(el, turnData.statusBar);
			}
		} else {
			const parent = msg.stepId ? getStepBody(msg.stepId) : null;
			container = parent || messages;
			el = createMessageElement(msg, !!msg.toolCall);
			container.appendChild(el);
		}
	} else {
		const parent = msg.stepId ? getStepBody(msg.stepId) : null;
		container = parent || messages;
		el = createMessageElement(msg, !!msg.toolCall);
		container.appendChild(el);
	}

	if (el) {
		messageEls.set(msg.id, el);
	}

	if (msg.toolCall && msg.role !== 'user') {
		// Tool cards are now rendered inline in the turn timeline, so we don't need to
		// force-open the Activity drawer to expose approvals.
	}
	const pending = pendingTokens.get(msg.id);
		if (pending && el) {
			const contentEl = el.querySelector('.message-content');
			if (contentEl) {
				if (msg.role === 'thought') {
					const thinkingEl = el.querySelector('.thinking-text');
				if (thinkingEl) {
					thinkingEl.textContent = (thinkingEl.textContent || '') + pending;
				}
			} else if (el.classList.contains('assistant') && contentEl.classList.contains('md')) {
				const raw = (contentEl.dataset.raw || '') + pending;
				contentEl.dataset.raw = raw;
				contentEl.innerHTML = renderMarkdown(raw);
			} else {
				contentEl.textContent = (contentEl.textContent === '…' ? '' : contentEl.textContent) + pending;
			}
		}
			pendingTokens.delete(msg.id);
		}

		if (el && typeof scheduleFileLinkify === 'function') {
			try { scheduleFileLinkify(el); } catch {}
		}
		maybeAutoScroll(wasNearBottom);

		if (prevCanUndo !== canUndo || prevCanRedo !== canRedo) {
			syncInputState();
		}
}

function updateTurnState(turnId, processing) {
	const turnData = turnEls.get(turnId);
	if (!turnData) return;

	turnData.isProcessing = processing;

	if (processing) {
		turnData.statusBar.style.display = 'flex';
		if (turnData.spinner) turnData.spinner.style.display = '';
		if (!turnData.statusText.textContent.trim()) {
			turnData.statusText.textContent = 'Thinking…';
		}
	} else {
		// Per-turn status is only meaningful while the turn is active.
		// Clear it unconditionally so stale "Thinking…" doesn't stick to past turns.
		if (turnData.spinner) turnData.spinner.style.display = 'none';
		turnData.statusText.textContent = '';
		turnData.currentStatus = '';
		turnData.retryInfo = null;
		if (turnData.statusTimeout) {
			clearTimeout(turnData.statusTimeout);
			turnData.statusTimeout = null;
		}
		turnData.statusBar.style.display = 'none';
	}
}

function startRetryCountdown(turnData) {
	if (!turnData.retryInfo || !turnData.retryInfo.nextRetryTime) return;

	const updateCountdown = () => {
		if (!turnData.retryInfo) return;

		const remaining = Math.max(0, Math.ceil((turnData.retryInfo.nextRetryTime - Date.now()) / 1000));
		const attempt = turnData.retryInfo.attempt || 1;
		let statusText = 'Retrying';
		if (remaining > 0) {
			statusText += ' in ' + remaining + 's';
		}
		statusText += ' (#' + attempt + ')';
		turnData.statusText.textContent = statusText;
	};

	updateCountdown();
	const timerId = setInterval(() => {
		if (!turnData.retryInfo || Date.now() >= turnData.retryInfo.nextRetryTime) {
			clearInterval(timerId);
			return;
		}
		updateCountdown();
	}, 500);

	setTimeout(() => {
		clearInterval(timerId);
	}, Math.max(0, turnData.retryInfo.nextRetryTime - Date.now()) + 1000);
}
