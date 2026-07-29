const messageContentElementCache = new WeakMap();
const messageThinkingTextElementCache = new WeakMap();
const messageToolCardElementCache = new WeakMap();
const messageStepPartsCache = new WeakMap();
const messagePlanActivityPartsCache = new WeakMap();
const messageIdByElement = new WeakMap();
const assistantMarkdownRawByElement = new WeakMap();
const assistantMarkdownHtmlByElement = new WeakMap();
const stepRenderKeyByElement = new WeakMap();
const SVG_NS = 'http://www.w3.org/2000/svg';
const TRANSCRIPT_INITIAL_GROUP_LIMIT = 24;
const TRANSCRIPT_HISTORY_PAGE_GROUP_LIMIT = 16;
const TRANSCRIPT_HISTORY_AUTOLOAD_THRESHOLD_PX = 160;
const TRANSCRIPT_PREPEND_SETTLE_FRAMES = 12;
const TRANSCRIPT_HISTORY_REQUEST_TIMEOUT_MS = 10000;
let transcriptRestoreGroups = [];
let transcriptFirstRenderedGroupIndex = 0;
let transcriptHistoryControl = null;
let transcriptHistoryButton = null;
let transcriptHistoryRemote = false;
let transcriptHistorySessionId = '';
let transcriptHistoryCursor = '';
let transcriptHasEarlierMessages = false;
let transcriptHistoryNextRequestId = 0;
let transcriptHistoryPendingRequest = null;
let transcriptHistoryRequestTimeout = null;
let transcriptPendingPositionState = null;
let transcriptPrependAnchor = null;
let transcriptPrependAnchorTop = null;
let transcriptPrependSettleFrame = null;
let transcriptPrependSettleFramesRemaining = 0;
const messageAvatarIconPaths = {
	assistant: {
		path: 'M8 1a1.5 1.5 0 0 0-1.5 1.5V3H4.5A2.5 2.5 0 0 0 2 5.5V10a2.5 2.5 0 0 0 2.5 2.5h.504a4.49 4.49 0 0 1-.504 1 1 1 0 0 0 1 1h5a1 1 0 0 0 1-1 4.49 4.49 0 0 1-.504-1h.504a2.5 2.5 0 0 0 2.5-2.5V5.5A2.5 2.5 0 0 0 11.5 3H9.5v-.5A1.5 1.5 0 0 0 8 1zm3.5 4H4.5a.5.5 0 0 0-.5.5V10a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V5.5a.5.5 0 0 0-.5-.5zM6 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
		fillRule: 'evenodd',
	},
	user: {
		path: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 1 4zm-1 0c0-1-1-3-5-3S3 9 3 10h10z',
	},
	thought: {
		path: 'M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13a.5.5 0 0 1 0 1 .5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1 0-1 .5.5 0 0 1 0-1 .5.5 0 0 1-.46-.302l-.761-1.77a1.964 1.964 0 0 0-.453-.618A5.984 5.984 0 0 1 2 6zm6-5a5 5 0 0 0-3.479 8.592c.263.254.514.564.676.941L5.83 12h4.342l.632-1.467c.162-.377.413-.687.676-.941A5 5 0 0 0 8 1z',
	},
};

function rememberMessageContentElement(messageEl, contentEl) {
	if (messageEl && contentEl) messageContentElementCache.set(messageEl, contentEl);
	return contentEl || null;
}

function rememberMessageThinkingTextElement(messageEl, thinkingTextEl) {
	if (messageEl && thinkingTextEl) messageThinkingTextElementCache.set(messageEl, thinkingTextEl);
	return thinkingTextEl || null;
}

function rememberMessageToolCardElement(messageEl, toolCardEl) {
	if (messageEl && toolCardEl) messageToolCardElementCache.set(messageEl, toolCardEl);
	return toolCardEl || null;
}

function rememberMessageElementId(messageEl, messageId) {
	const id = String(messageId || '');
	if (messageEl && id) messageIdByElement.set(messageEl, id);
	return id;
}

function getMessageElementId(messageEl) {
	if (!messageEl) return '';
	const cached = messageIdByElement.get(messageEl);
	if (cached !== undefined) return cached;
	return messageEl.dataset ? String(messageEl.dataset.id || '') : '';
}

function getContainedMessageCachedElement(messageEl, cache) {
	if (!messageEl) return null;
	const cached = cache.get(messageEl);
	if (!cached) return null;
	if (typeof messageEl.contains !== 'function' || messageEl.contains(cached)) return cached;
	cache.delete(messageEl);
	return null;
}

function getContainedMessageCachedParts(messageEl, cache, keys) {
	if (!messageEl) return null;
	const cached = cache.get(messageEl);
	if (!cached) return null;
	if (typeof messageEl.contains !== 'function') return cached;
	for (let i = 0; i < keys.length; i++) {
		const part = cached[keys[i]];
		if (!part || !messageEl.contains(part)) {
			cache.delete(messageEl);
			return null;
		}
	}
	return cached;
}

function getCachedMessageContentElement(messageEl) {
	if (!messageEl) return null;
	const cached = getContainedMessageCachedElement(messageEl, messageContentElementCache);
	if (cached) return cached;
	const layoutContent = findMessageContentElementFromLayout(messageEl);
	if (layoutContent) return layoutContent;
	if (!messageEl.querySelector) return null;
	return rememberMessageContentElement(messageEl, messageEl.querySelector('.message-content'));
}

function getCachedMessageThinkingTextElement(messageEl) {
	if (!messageEl) return null;
	const cached = getContainedMessageCachedElement(messageEl, messageThinkingTextElementCache);
	if (cached) return cached;
	const layoutThinkingText = findMessageThinkingTextElementFromLayout(messageEl);
	if (layoutThinkingText) return layoutThinkingText;
	if (!messageEl.querySelector) return null;
	return rememberMessageThinkingTextElement(messageEl, messageEl.querySelector('.thinking-text'));
}

function getCachedMessageToolCardElement(messageEl) {
	if (!messageEl) return null;
	const cached = getContainedMessageCachedElement(messageEl, messageToolCardElementCache);
	if (cached) return cached;
	const layoutCard = findMessageToolCardElementFromLayout(messageEl);
	if (layoutCard) return layoutCard;
	if (!messageEl.querySelector) return null;
	return rememberMessageToolCardElement(messageEl, messageEl.querySelector('.tool-card'));
}

function createSvgPathIcon(icon) {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('fill', 'currentColor');
	const pathEl = document.createElementNS(SVG_NS, 'path');
	if (icon.fillRule) pathEl.setAttribute('fill-rule', icon.fillRule);
	pathEl.setAttribute('d', icon.path);
	svg.appendChild(pathEl);
	return svg;
}

function appendMessageAvatarContent(avatar, role) {
	const icon = Object.prototype.hasOwnProperty.call(messageAvatarIconPaths, role) ? messageAvatarIconPaths[role] : null;
	if (icon) {
		avatar.appendChild(createSvgPathIcon(icon));
		return;
	}
	avatar.textContent = avatarColors[role] || '?';
}

function createAssistantActionButton(action, label, title, ariaLabel) {
	const button = document.createElement('button');
	button.className = 'message-action-btn';
	button.type = 'button';
	rememberRenderedAction(button, action);
	button.title = title;
	button.setAttribute('aria-label', ariaLabel);
	button.textContent = label;
	return button;
}

function createAssistantMessageActions() {
	const actions = document.createElement('div');
	actions.className = 'message-actions';
	actions.appendChild(createAssistantActionButton('copyAssistantMarkdown', 'MD', 'Copy as Markdown', 'MD, copy assistant response as Markdown'));
	actions.appendChild(createAssistantActionButton('copyAssistantHtml', 'HTML', 'Copy as HTML', 'HTML, copy assistant response as HTML'));
	return actions;
}

function rememberMessageStepParts(messageEl, parts) {
	if (messageEl && parts) messageStepPartsCache.set(messageEl, parts);
	return parts || null;
}

function rememberMessagePlanActivityParts(messageEl, parts) {
	if (messageEl && parts) messagePlanActivityPartsCache.set(messageEl, parts);
	return parts || null;
}

function hasElementClass(el, className) {
	if (!el || el.nodeType !== 1) return false;
	if (el.classList && typeof el.classList.contains === 'function') return el.classList.contains(className);
	return (' ' + String(el.className || '') + ' ').indexOf(' ' + className + ' ') >= 0;
}

function findMessageContentElementFromLayout(messageEl) {
	const children = messageEl && messageEl.children ? messageEl.children : null;
	if (!children || children.length < 2) return null;
	const body = children[1];
	if (hasElementClass(body, 'message-content')) return rememberMessageContentElement(messageEl, body);
	if (!hasElementClass(body, 'message-bubble')) return null;
	const bubbleChildren = body && body.children ? body.children : null;
	if (!bubbleChildren || bubbleChildren.length <= 0) return null;
	const content = bubbleChildren[0];
	if (!hasElementClass(content, 'message-content')) return null;
	return rememberMessageContentElement(messageEl, content);
}

function findMessageThinkingTextElementFromLayout(messageEl) {
	const content = findMessageContentElementFromLayout(messageEl);
	const contentChildren = content && content.children ? content.children : null;
	if (!contentChildren || contentChildren.length <= 0) return null;
	const details = contentChildren[0];
	if (!hasElementClass(details, 'thinking-details')) return null;
	const detailChildren = details && details.children ? details.children : null;
	const body = detailChildren && detailChildren.length > 1 ? detailChildren[1] : null;
	if (!hasElementClass(body, 'thinking-text')) return null;
	return rememberMessageThinkingTextElement(messageEl, body);
}

function findMessageToolCardElementFromLayout(messageEl) {
	const children = messageEl && messageEl.children ? messageEl.children : null;
	if (!children || children.length < 2) return null;
	const card = children[1];
	if (!hasElementClass(card, 'tool-card')) return null;
	return rememberMessageToolCardElement(messageEl, card);
}

function findMessageStepPartsFromLayout(messageEl) {
	const children = messageEl && messageEl.children ? messageEl.children : null;
	if (!children || children.length < 2) return null;
	const body = children[0];
	const footer = children[1];
	if (!hasElementClass(body, 'step-body') || !hasElementClass(footer, 'step-footer')) return null;
	const footerChildren = footer && footer.children ? footer.children : null;
	const mode = footerChildren && footerChildren.length > 1 ? footerChildren[1] : null;
	const sep = footerChildren && footerChildren.length > 2 ? footerChildren[2] : null;
	const model = footerChildren && footerChildren.length > 3 ? footerChildren[3] : null;
	if (
		!hasElementClass(mode, 'step-mode') ||
		!hasElementClass(sep, 'step-sep') ||
		!hasElementClass(model, 'step-model')
	) return null;
	return rememberMessageStepParts(messageEl, { body, mode, sep, model });
}

function findMessagePlanActivityPartsFromLayout(messageEl) {
	const children = messageEl && messageEl.children ? messageEl.children : null;
	const childCount = children ? children.length : 0;
	if (childCount <= 0) return null;
	const details = children[childCount - 1];
	if (!hasElementClass(details, 'plan-activity')) return null;
	const detailChildren = details && details.children ? details.children : null;
	const summary = detailChildren && detailChildren.length > 0 ? detailChildren[0] : null;
	const body = detailChildren && detailChildren.length > 1 ? detailChildren[1] : null;
	const summaryChildren = summary && summary.children ? summary.children : null;
	const count = summaryChildren && summaryChildren.length > 0 ? summaryChildren[0] : null;
	if (
		!hasElementClass(summary, 'plan-activity-summary') ||
		!hasElementClass(body, 'plan-activity-body') ||
		!hasElementClass(count, 'plan-activity-count')
	) return null;
	return rememberMessagePlanActivityParts(messageEl, { details, body, count });
}

function rememberAssistantMarkdownRaw(contentEl, raw) {
	const text = getMessageTextContent(raw, '');
	if (contentEl) assistantMarkdownRawByElement.set(contentEl, text);
	return text;
}

function getAssistantMarkdownRaw(contentEl) {
	if (!contentEl) return '';
	const cached = assistantMarkdownRawByElement.get(contentEl);
	return cached === undefined ? '' : cached;
}

function isAssistantMarkdownHtmlCurrent(contentEl, html) {
	const cached = assistantMarkdownHtmlByElement.get(contentEl);
	if (cached !== undefined) return cached === html;
	return html === '' && !contentEl.firstChild;
}

function renderAssistantMarkdownInto(contentEl, raw) {
	const text = rememberAssistantMarkdownRaw(contentEl, raw);
	if (!contentEl) return { raw: text, htmlChanged: false };
	const html = renderMarkdown(text);
	if (isAssistantMarkdownHtmlCurrent(contentEl, html)) {
		assistantMarkdownHtmlByElement.set(contentEl, html);
		return { raw: text, htmlChanged: false };
	}
	contentEl.innerHTML = html;
	assistantMarkdownHtmlByElement.set(contentEl, html);
	return { raw: text, htmlChanged: true };
}

function getCachedMessageStepParts(messageEl) {
	if (!messageEl) return null;
	const cached = getContainedMessageCachedParts(messageEl, messageStepPartsCache, ['body', 'mode', 'sep', 'model']);
	if (cached) return cached;
	const layoutParts = findMessageStepPartsFromLayout(messageEl);
	if (layoutParts) return layoutParts;
	if (!messageEl.querySelector) return null;
	const parts = {
		body: messageEl.querySelector('.step-body'),
		mode: messageEl.querySelector('.step-mode'),
		sep: messageEl.querySelector('.step-sep'),
		model: messageEl.querySelector('.step-model'),
	};
	if (parts.body && parts.mode && parts.sep && parts.model) return rememberMessageStepParts(messageEl, parts);
	return parts.body || parts.mode || parts.sep || parts.model ? parts : null;
}

function findMessagePlanActivityParts(messageEl) {
	const layoutParts = findMessagePlanActivityPartsFromLayout(messageEl);
	if (layoutParts) return layoutParts;
	if (!messageEl || !messageEl.querySelector) return null;
	const parts = {
		details: messageEl.querySelector('.plan-activity'),
		body: messageEl.querySelector('.plan-activity-body'),
		count: null,
	};
	parts.count = parts.details && parts.details.querySelector ? parts.details.querySelector('.plan-activity-count') : null;
	if (parts.details && parts.body && parts.count) return rememberMessagePlanActivityParts(messageEl, parts);
	return parts.details || parts.body || parts.count ? parts : null;
}

function getCachedMessagePlanActivityParts(messageEl) {
	if (!messageEl) return null;
	const cached = getContainedMessageCachedParts(messageEl, messagePlanActivityPartsCache, ['details', 'body', 'count']);
	if (cached) return cached;
	return findMessagePlanActivityParts(messageEl);
}

function getMessageRenderDatasetKey(renderKey) {
	return getCompactRenderDatasetKey(renderKey);
}

function getStepRenderDatasetKey(renderKey) {
	return getCompactRenderDatasetKey(renderKey);
}

function rememberStepRenderKey(messageEl, renderKey) {
	const key = String(renderKey || '');
	if (!messageEl || !key) return '';
	stepRenderKeyByElement.set(messageEl, key);
	const datasetKey = getStepRenderDatasetKey(key);
	if (messageEl.dataset && datasetKey) messageEl.dataset.stepRenderKey = datasetKey;
	return datasetKey;
}

function getRememberedStepRenderKey(messageEl) {
	return messageEl ? stepRenderKeyByElement.get(messageEl) || '' : '';
}

function getStepRenderKey(msg) {
	const step = msg && msg.step && typeof msg.step === 'object' ? msg.step : {};
	const key = createCompactRenderKeyBuilder();
	appendCompactRenderKeyPart(key, step.status || 'running');
	appendCompactRenderKeyPart(key, step.mode || 'Build');
	appendCompactRenderKeyPart(key, step.model || '');
	return finishCompactRenderKey(key);
}

function getMessageRenderKey(msg) {
	if (!msg || typeof msg !== 'object') return '';
	const role = msg.role || '';
	if (!role || role === 'step' || role === 'plan' || msg.toolCall) return '';

	const key = createCompactRenderKeyBuilder();
	appendCompactRenderKeyPart(key, role);

	if (role === 'operation') {
		const op = msg.operation && typeof msg.operation === 'object' ? msg.operation : {};
		const startedAt = op.startedAt ?? msg.timestamp;
		if (startedAt === undefined || startedAt === null) return '';
		appendCompactRenderKeyPart(key, op.status || 'running');
		appendCompactRenderKeyPart(key, op.label || msg.content || 'Operation');
		appendCompactRenderKeyPart(key, startedAt);
		appendCompactRenderKeyPart(key, op.detail ? String(op.detail) : '');
		const summaryText = typeof op.summaryText === 'string' ? op.summaryText : '';
		appendCompactRenderKeyPart(key, hasNonWhitespaceText(summaryText) ? '1' : '0');
		return finishCompactRenderKey(key);
	}

	appendCompactRenderKeyPart(key, getMessageTextContent(msg.content, ''));
	return finishCompactRenderKey(key);
}

function getOperationStatusLabel(status) {
	switch (status) {
		case 'running':
			return 'Running';
		case 'done':
			return 'Done';
		case 'canceled':
			return 'Canceled';
		default:
			return 'Failed';
	}
}

function getOperationStatusClass(status) {
	switch (status) {
		case 'running':
		case 'done':
		case 'canceled':
			return status;
		default:
			return 'error';
	}
}

function createMessageElement(msg, isTool = false) {
	const el = document.createElement('div');

	if (msg.role === 'step') {
		const status = msg.step?.status || 'running';
		const mode = msg.step?.mode || 'Build';
		const model = msg.step?.model || '';

		el.className = 'step ' + status;
		rememberStepRenderKey(el, getStepRenderKey(msg));

		const body = document.createElement('div');
		body.className = 'step-body';

		const footer = document.createElement('div');
		footer.className = 'step-footer';

		const dot = document.createElement('span');
		dot.className = 'step-dot';
		dot.setAttribute('aria-hidden', 'true');

		const modeEl = document.createElement('span');
		modeEl.className = 'step-mode';
		modeEl.textContent = mode;

		const sepEl = document.createElement('span');
		sepEl.className = 'step-sep';
		sepEl.textContent = '·';
		if (!model) sepEl.style.display = 'none';

		const modelEl = document.createElement('span');
		modelEl.className = 'step-model';
		modelEl.textContent = model;
		if (!model) modelEl.style.display = 'none';

		footer.appendChild(dot);
		footer.appendChild(modeEl);
		footer.appendChild(sepEl);
		footer.appendChild(modelEl);
		el.appendChild(body);
		el.appendChild(footer);
		rememberMessageStepParts(el, { body, mode: modeEl, sep: sepEl, model: modelEl });
		if (body) stepBodies.set(msg.id, body);
	} else if (msg.role === 'plan') {
		el.className = 'message ' + msg.role;
		if (msg.plan?.status) el.classList.add(msg.plan.status);
		el.innerHTML = formatPlanCard(msg);
		if (typeof hydratePlanActionPayloads === 'function') hydratePlanActionPayloads(el);
		if (typeof getPlanCardRenderKey === 'function' && typeof rememberPlanCardRenderKey === 'function') {
			rememberPlanCardRenderKey(el, getPlanCardRenderKey(msg));
		}
		const activityParts = findMessagePlanActivityParts(el);
		const activityBody = activityParts ? activityParts.body : null;
		if (activityBody) stepBodies.set(msg.id, activityBody);
	} else if (msg.role === 'operation') {
		const op = msg.operation || {};
		const status = op.status || 'running';
		const label = op.label || msg.content || 'Operation';
		const startedAt = op.startedAt ?? msg.timestamp ?? Date.now();
		const time = new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		const statusLabel = getOperationStatusLabel(status);
		const detail = op.detail ? String(op.detail) : '';
		const summaryText = typeof op.summaryText === 'string' ? op.summaryText : '';
		const hasSummary = hasNonWhitespaceText(summaryText);

		el.className = 'operation-card ' + getOperationStatusClass(status);
		const iconEl = document.createElement('div');
		iconEl.className = 'operation-icon';
		iconEl.setAttribute('aria-hidden', 'true');
		iconEl.textContent = '↔';

		const bodyEl = document.createElement('div');
		bodyEl.className = 'operation-body';

		const topEl = document.createElement('div');
		topEl.className = 'operation-top';

		const titleEl = document.createElement('div');
		titleEl.className = 'operation-title';
		titleEl.textContent = String(label);

		const statusEl = document.createElement('div');
		statusEl.className = 'operation-status';
		statusEl.textContent = statusLabel + ' · ' + time;

		topEl.appendChild(titleEl);
		topEl.appendChild(statusEl);
		bodyEl.appendChild(topEl);

		if (detail) {
			const detailEl = document.createElement('div');
			detailEl.className = 'operation-detail';
			detailEl.textContent = detail;
			bodyEl.appendChild(detailEl);
		}

		if (hasSummary) {
			const actionsEl = document.createElement('div');
			actionsEl.className = 'operation-actions';
			const summaryBtn = document.createElement('button');
			summaryBtn.className = 'operation-action-link';
			summaryBtn.type = 'button';
			rememberRenderedAction(summaryBtn, 'viewCompactionSummary');
			summaryBtn.title = 'View compaction summary';
			summaryBtn.setAttribute('aria-label', 'View summary, compaction summary');
			summaryBtn.textContent = 'View summary';
			actionsEl.appendChild(summaryBtn);
			bodyEl.appendChild(actionsEl);
		}

		el.appendChild(iconEl);
		el.appendChild(bodyEl);
	} else if (msg.toolCall) {
		el.className = 'tool-message';
		const toolBodyHtml = formatToolCardBody(msg.toolCall);
		const toolAvatar = document.createElement('div');
		toolAvatar.className = 'tool-avatar';
		toolAvatar.setAttribute('aria-hidden', 'true');
		toolAvatar.textContent = String(toolIcons[msg.toolCall.id] || '🔧');
		const toolCardEl = document.createElement('div');
		toolCardEl.className = formatToolCardClass(msg.toolCall);
		toolCardEl.innerHTML = toolBodyHtml;
		hydrateToolCardPayloads(toolCardEl, toolBodyHtml);
		el.appendChild(toolAvatar);
		el.appendChild(toolCardEl);
		rememberMessageToolCardElement(el, toolCardEl);
		rememberToolCardBodyHtml(toolCardEl, toolBodyHtml);
	} else {
		el.className = 'message ' + msg.role;
		const avatar = document.createElement('div');
		avatar.className = 'message-avatar';
		avatar.setAttribute('aria-hidden', 'true');
		appendMessageAvatarContent(avatar, msg.role);
		el.appendChild(avatar);

		const content = document.createElement('div');
		content.className = 'message-content';
		rememberMessageContentElement(el, content);
		if (msg.role === 'assistant') {
			const bubble = document.createElement('div');
			bubble.className = 'message-bubble';

			const actions = createAssistantMessageActions();

			content.classList.add('md');
			const raw = getMessageTextContent(msg.content, '');
			renderAssistantMarkdownInto(content, raw);

			bubble.appendChild(content);
			bubble.appendChild(actions);
			el.appendChild(bubble);
		} else if (msg.role === 'user') {
			content.textContent = getMessageTextContent(msg.content, '');
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
			body.textContent = getMessageTextContent(msg.content, '');
			rememberMessageThinkingTextElement(el, body);

			details.appendChild(summary);
			details.appendChild(body);
			content.appendChild(details);
			el.appendChild(content);
		} else {
			content.textContent = getMessageTextContent(msg.content, '…');
			el.appendChild(content);
		}
	}

	if (el.dataset) {
		const renderKey = getMessageRenderKey(msg);
		const datasetRenderKey = getMessageRenderDatasetKey(renderKey);
		if (datasetRenderKey) el.dataset.messageRenderKey = datasetRenderKey;
	}
	rememberMessageElementId(el, msg.id);
	el.dataset.id = msg.id;
	return el;
}

function getStepBody(stepId) {
	if (!stepId) return null;
	const stepEl = messageEls.get(stepId);
	const cached = stepBodies.get(stepId);
	if (cached) {
		if (!stepEl || typeof stepEl.contains !== 'function' || stepEl.contains(cached)) return cached;
		stepBodies.delete(stepId);
	}
	if (!stepEl) return null;

	const stepParts = typeof getCachedMessageStepParts === 'function' ? getCachedMessageStepParts(stepEl) : null;
	const body = stepParts ? stepParts.body : stepEl.querySelector('.step-body');
	if (body) {
		stepBodies.set(stepId, body);
		return body;
	}

	const planParts = getCachedMessagePlanActivityParts(stepEl);
	const planBody = planParts ? planParts.body : null;
	if (planBody) {
		stepBodies.set(stepId, planBody);
		return planBody;
	}
	return null;
}

function appendMessageRoot(child) {
	const target = messageAppendTarget || messages;
	if (target) target.appendChild(child);
	return child;
}

function resetLastToolBatchState() {
	lastToolMsg = null;
	lastToolBatchPathSet = null;
}

function buildToolBatchPathSet(toolCall) {
	const paths = new Set();
	if (!toolCall) return paths;
	const firstPath = toolCall.path || '';
	if (firstPath) paths.add(firstPath);
	const batchFiles = Array.isArray(toolCall.batchFiles) ? toolCall.batchFiles : [];
	for (let i = 0; i < batchFiles.length; i++) {
		const path = batchFiles[i] || '';
		if (path) paths.add(path);
	}
	return paths;
}

function ensureLastToolBatchPathSet(toolCall) {
	if (!lastToolBatchPathSet) {
		lastToolBatchPathSet = buildToolBatchPathSet(toolCall);
	}
	return lastToolBatchPathSet;
}

function rememberLastToolBatchMessage(msg) {
	if (!msg || !msg.toolCall || !isBatchToolType(msg.toolCall.id)) {
		resetLastToolBatchState();
		return;
	}
	lastToolMsg = msg;
	lastToolBatchPathSet = buildToolBatchPathSet(msg.toolCall);
}

function addMessage(msg, options) {
	if (msg && typeof msg.id === 'string') {
		rememberMessageData(msg);
	}

	const historicalRestore = !!(options && options.historicalRestore);
	const restoredTranscript = !!(options && options.restoredTranscript);
	const prevCanUndo = canUndo;
	const prevCanRedo = canRedo;
	let wasNearBottomValue = false;
	let wasNearBottomRead = false;
	function readWasNearBottom() {
		if (!wasNearBottomRead) {
			wasNearBottomValue = suppressAutoScroll ? false : isNearBottom();
			wasNearBottomRead = true;
		}
		return wasNearBottomValue;
	}

	const isUserFollowup = msg.role === 'user' && msg.turnId && turnEls.has(msg.turnId);

	if (msg.toolCall && isBatchToolType(msg.toolCall.id)) {
		const currentToolId = msg.toolCall.id;
		const currentPath = msg.toolCall.path || '';

		if (lastToolMsg && lastToolMsg.toolCall && lastToolMsg.toolCall.id === currentToolId && currentPath) {
			const batchPathSet = ensureLastToolBatchPathSet(lastToolMsg.toolCall);
			const isDuplicate = batchPathSet.has(currentPath);
			const existingEl = messageEls.get(lastToolMsg.id);

			if (isDuplicate) {
				messageEls.set(msg.id, existingEl);
				return;
			}

			const wasNearBottom = readWasNearBottom();
			if (!lastToolMsg.toolCall.batchFiles) {
				const firstPath = lastToolMsg.toolCall.path || '';
				lastToolMsg.toolCall.batchFiles = firstPath ? [firstPath] : [];
			}
			lastToolMsg.toolCall.batchFiles.push(currentPath);
			batchPathSet.add(currentPath);

			if (existingEl) {
				const cardEl = getCachedMessageToolCardElement(existingEl);
				updateToolCardElement(cardEl, lastToolMsg.toolCall);
			}

			messageEls.set(msg.id, existingEl);
			maybeAutoScroll(wasNearBottom);
			return;
		}
	}

	setDisplay(empty, 'none');
	const wasNearBottom = readWasNearBottom();

	if (msg.role === 'user' && !historicalRestore) {
		activeTurnId = isUserFollowup ? msg.turnId : msg.id;
		canUndo = true;
		if (isProcessing) {
			syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
		}
	}

	if (msg.role === 'step') {
		resetLastToolBatchState();
	}

	if (!msg.toolCall || !isBatchToolType(msg.toolCall.id)) {
		resetLastToolBatchState();
	}

	let el;

	if (msg.role === 'user' && !isUserFollowup) {
			const turnId = msg.id;
			const turnEl = document.createElement('div');
			turnEl.className = 'turn';
			if (restoredTranscript) turnEl.dataset.restored = 'true';
			turnEl.dataset.turnId = turnId;
		turnEl.setAttribute('aria-busy', 'false');

		const turnResponse = document.createElement('div');
		turnResponse.className = 'turn-response';

		const turnStatusBar = document.createElement('div');
		turnStatusBar.className = 'turn-status-bar';
		turnStatusBar.setAttribute('role', 'status');
		turnStatusBar.setAttribute('aria-live', 'polite');
		turnStatusBar.setAttribute('aria-atomic', 'true');
		turnStatusBar.style.display = 'none';

		const spinner = document.createElement('span');
		spinner.className = 'turn-spinner';
		spinner.setAttribute('aria-hidden', 'true');
		turnStatusBar.appendChild(spinner);

		const statusText = document.createElement('span');
		statusText.className = 'turn-status-text';
		turnStatusBar.appendChild(statusText);

			turnResponse.appendChild(turnStatusBar);
			turnEl.appendChild(turnResponse);

		appendMessageRoot(turnEl);
		turnEls.set(turnId, {
			el: turnEl,
			response: turnResponse,
			statusBar: turnStatusBar,
			spinner: spinner,
			statusText: statusText,
			startTime: msg.timestamp,
			currentStatus: '',
			statusStateKey: '',
			statusRenderedText: '',
			statusRenderedTitle: '',
			isProcessing: false,
		});

		if (turnId === activeTurnId) {
			syncActiveTurnProcessingState(shouldShowActiveTurnProcessing());
		} else {
			updateTurnState(turnId, false);
		}

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
			el = createMessageElement(msg, !!msg.toolCall);
			if (parent) {
				parent.appendChild(el);
			} else {
				appendMessageRoot(el);
			}
		}
	} else {
		const parent = msg.stepId ? getStepBody(msg.stepId) : null;
		el = createMessageElement(msg, !!msg.toolCall);
		if (parent) {
			parent.appendChild(el);
		} else {
			appendMessageRoot(el);
		}
	}

		if (el) {
			if (restoredTranscript && el.dataset) el.dataset.restored = 'true';
			messageEls.set(msg.id, el);
		}

	if (msg.toolCall && msg.role !== 'user') {
		if (isBatchToolType(msg.toolCall.id)) {
			rememberLastToolBatchMessage(msg);
		}
		// Tool cards are now rendered inline in the turn timeline, so we don't need to
		// force-open the Activity drawer to expose approvals.
	}
	let linkifyText = getMessageTextContent(msg.content, '');
	let shouldScheduleFileLinkify = true;
	const pending = pendingTokens.get(msg.id);
		if (pending && el) {
			const contentEl = getCachedMessageContentElement(el);
			if (contentEl) {
				if (msg.role === 'thought') {
					const thinkingEl = getCachedMessageThinkingTextElement(el);
					if (thinkingEl) {
						const renderedText = appendStreamTextContent(thinkingEl, pending, false);
						if (renderedText) linkifyText = renderedText;
				}
			} else if (el.classList.contains('assistant') && contentEl.classList.contains('md')) {
				const renderInfo = renderAssistantMarkdownInto(contentEl, getAssistantMarkdownRaw(contentEl) + pending);
				updateAssistantMessageContent(msg.id, renderInfo.raw);
					linkifyText = renderInfo.raw;
					shouldScheduleFileLinkify = renderInfo.htmlChanged;
				} else {
					const renderedText = appendStreamTextContent(contentEl, pending, true);
					if (renderedText) linkifyText = renderedText;
				}
		}
			pendingTokens.delete(msg.id);
		}

		if (shouldScheduleFileLinkify && el && typeof scheduleFileLinkify === 'function') {
			try {
				if (msg.role === 'assistant' && typeof scheduleFileLinkifyIfNeeded === 'function') {
					scheduleFileLinkifyIfNeeded(el, linkifyText);
				} else {
					scheduleFileLinkify(el);
				}
			} catch {}
		}
		maybeAutoScroll(wasNearBottom);

		if (prevCanUndo !== canUndo || prevCanRedo !== canRedo) {
			syncInputState();
		}
}

	function createTranscriptRestoreGroup() {
		const group = { messageIds: [] };
		transcriptRestoreGroups.push(group);
		return group;
	}

	function buildTranscriptRestoreGroups(list) {
		transcriptRestoreGroups = [];
		const groupByTurnId = new Map();
		const groupByMessageId = new Map();

		for (let index = 0; index < list.length; index++) {
			const msg = list[index];
			if (!msg || typeof msg.id !== 'string' || !msg.id) continue;

			rememberMessageData(msg);
			let group = null;
			if (msg.role === 'user') {
				group = msg.turnId ? groupByTurnId.get(msg.turnId) || null : null;
				if (!group) {
					group = createTranscriptRestoreGroup();
				}
			} else {
				if (msg.turnId) group = groupByTurnId.get(msg.turnId) || null;
				if (!group && msg.stepId) group = groupByMessageId.get(msg.stepId) || null;
				if (!group) group = createTranscriptRestoreGroup();
			}

			group.messageIds.push(msg.id);
			groupByMessageId.set(msg.id, group);
			if (msg.turnId) groupByTurnId.set(msg.turnId, group);
			if (msg.role === 'user') groupByTurnId.set(msg.id, group);
		}
	}

	function renderTranscriptGroupRange(start, end, options) {
		let renderedMessages = 0;
		for (let groupIndex = start; groupIndex < end; groupIndex++) {
			const group = transcriptRestoreGroups[groupIndex];
			if (!group || !Array.isArray(group.messageIds)) continue;
			for (let messageIndex = 0; messageIndex < group.messageIds.length; messageIndex++) {
				const msg = messageDataById.get(group.messageIds[messageIndex]);
				if (!msg || typeof msg.id !== 'string') continue;
				try {
					addMessage(msg, options);
					renderedMessages++;
				} catch {
					console.error('Failed to render message');
				}
			}
		}
		return renderedMessages;
	}

	function createTranscriptHistoryControl() {
		const control = document.createElement('div');
		control.className = 'transcript-history-control';
		control.setAttribute('role', 'group');
		control.setAttribute('aria-label', 'Earlier chat messages');

		const button = document.createElement('button');
		button.className = 'transcript-history-load';
		button.type = 'button';
		button.textContent = 'Load earlier messages';
		button.title = 'Load earlier messages';
		button.setAttribute('aria-label', 'Load earlier messages');
		button.setAttribute('aria-controls', 'messages');
		button.addEventListener('click', () => {
			loadEarlierTranscriptPage({ restoreFocus: true });
		});

		control.appendChild(button);
		transcriptHistoryControl = control;
		transcriptHistoryButton = button;
		return control;
	}

	function clearTranscriptHistoryRequestTimeout() {
		if (transcriptHistoryRequestTimeout === null) return;
		clearTimeout(transcriptHistoryRequestTimeout);
		transcriptHistoryRequestTimeout = null;
	}

	function updateTranscriptHistoryLoadingState(loading) {
		if (!transcriptHistoryButton) return;
		transcriptHistoryButton.disabled = !!loading;
		transcriptHistoryButton.textContent = loading ? 'Loading earlier messages...' : 'Load earlier messages';
		transcriptHistoryButton.title = loading ? 'Loading earlier messages' : 'Load earlier messages';
		transcriptHistoryButton.setAttribute('aria-label', transcriptHistoryButton.title);
		if (loading) {
			transcriptHistoryButton.setAttribute('aria-busy', 'true');
			if (transcriptHistoryControl) transcriptHistoryControl.setAttribute('aria-busy', 'true');
		} else {
			transcriptHistoryButton.removeAttribute('aria-busy');
			if (transcriptHistoryControl) transcriptHistoryControl.removeAttribute('aria-busy');
		}
	}

	function finishTranscriptHistoryRequest(request) {
		if (!request || transcriptHistoryPendingRequest !== request) return false;
		clearTranscriptHistoryRequestTimeout();
		transcriptHistoryPendingRequest = null;
		updateTranscriptHistoryLoadingState(false);
		return true;
	}

	function requestEarlierTranscriptPage(options) {
		if (
			!transcriptHistoryRemote ||
			!transcriptHasEarlierMessages ||
			!transcriptHistorySessionId ||
			!transcriptHistoryCursor ||
			transcriptHistoryPendingRequest
		) {
			return false;
		}

		stopTranscriptPrependSettle();
		setUserScrolledAway(true);
		const request = {
			requestId: ++transcriptHistoryNextRequestId,
			sessionId: transcriptHistorySessionId,
			cursor: transcriptHistoryCursor,
			restoreFocus: !!(options && options.restoreFocus),
		};
		transcriptHistoryPendingRequest = request;
		updateTranscriptHistoryLoadingState(true);
		const protocol = window.LINGYUN_CHAT_PROTOCOL || {};
		vscode.postMessage({
			type: protocol.transcriptHistoryRequest || 'transcriptHistoryRequest',
			requestId: request.requestId,
			sessionId: request.sessionId,
			cursor: request.cursor,
		});
		transcriptHistoryRequestTimeout = setTimeout(() => {
			finishTranscriptHistoryRequest(request);
		}, TRANSCRIPT_HISTORY_REQUEST_TIMEOUT_MS);
		return true;
	}

	function releaseTranscriptScrollAnchorLock() {
		if (!transcriptScrollAnchorLocked) return;
		transcriptScrollAnchorLocked = false;
		updateMessagesOverflowAnchor();
	}

	function stopTranscriptPrependSettle() {
		transcriptPrependSettleFramesRemaining = 0;
		transcriptPrependAnchor = null;
		transcriptPrependAnchorTop = null;
		if (transcriptPrependSettleFrame !== null) {
			cancelAnimationFrameHandle(transcriptPrependSettleFrame);
			transcriptPrependSettleFrame = null;
		}
		releaseTranscriptScrollAnchorLock();
	}

	function getTranscriptAnchorTop(anchor) {
		if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return null;
		const rect = anchor.getBoundingClientRect();
		const top = rect && Number(rect.top);
		return Number.isFinite(top) ? top : null;
	}

	function flushTranscriptPrependSettle() {
		transcriptPrependSettleFrame = null;
		if (
			transcriptPrependSettleFramesRemaining <= 0 ||
			!messages ||
			!transcriptPrependAnchor ||
			transcriptPrependAnchorTop === null
		) {
			stopTranscriptPrependSettle();
			return;
		}

		const currentTop = getTranscriptAnchorTop(transcriptPrependAnchor);
		if (currentTop !== null) {
			const delta = currentTop - transcriptPrependAnchorTop;
			if (Math.abs(delta) >= 0.5) {
				messages.scrollTop = Math.max(0, Number(messages.scrollTop || 0) + delta);
				rememberMessagesScrollTop();
			}
		}

		transcriptPrependSettleFramesRemaining--;
		if (transcriptPrependSettleFramesRemaining <= 0) {
			stopTranscriptPrependSettle();
			return;
		}
		transcriptPrependSettleFrame = requestAnimationFrameHandle(flushTranscriptPrependSettle);
	}

	function startTranscriptPrependSettle(anchor, anchorTop) {
		if (!anchor || anchorTop === null) {
			releaseTranscriptScrollAnchorLock();
			return;
		}
		transcriptPrependAnchor = anchor;
		transcriptPrependAnchorTop = anchorTop;
		transcriptPrependSettleFramesRemaining = TRANSCRIPT_PREPEND_SETTLE_FRAMES;
		transcriptPrependSettleFrame = requestAnimationFrameHandle(flushTranscriptPrependSettle);
	}

	function resetTranscriptHistoryWindow() {
		stopTranscriptPrependSettle();
		clearTranscriptHistoryRequestTimeout();
		if (transcriptHistoryControl && transcriptHistoryControl.parentNode) {
			try {
				transcriptHistoryControl.parentNode.removeChild(transcriptHistoryControl);
			} catch {}
		}
		transcriptRestoreGroups = [];
		transcriptFirstRenderedGroupIndex = 0;
		transcriptHistoryControl = null;
		transcriptHistoryButton = null;
		transcriptHistoryRemote = false;
		transcriptHistorySessionId = '';
		transcriptHistoryCursor = '';
		transcriptHasEarlierMessages = false;
		transcriptHistoryPendingRequest = null;
		transcriptPendingPositionState = null;
	}

	function restoreTranscriptMessages(list, options) {
		resetTranscriptHistoryWindow();
		const source = Array.isArray(list) ? list : [];
		const history = options && options.history && typeof options.history === 'object'
			? options.history
			: null;
		const sessionId = options && typeof options.sessionId === 'string' ? options.sessionId : '';
		transcriptHistoryRemote = !!(history && history.mode === 'paged' && sessionId);
		transcriptHistorySessionId = transcriptHistoryRemote ? sessionId : '';
		transcriptHistoryCursor = transcriptHistoryRemote && typeof history.cursor === 'string'
			? history.cursor
			: '';
		transcriptHasEarlierMessages = !!(
			transcriptHistoryRemote &&
			history.hasEarlierMessages &&
			transcriptHistoryCursor
		);
		buildTranscriptRestoreGroups(source);

		if (transcriptRestoreGroups.length === 0) {
			replaceElementChildren(messages, empty);
			return 0;
		}

		const restoreFragment = document.createDocumentFragment();
		restoreFragment.appendChild(empty);
		transcriptFirstRenderedGroupIndex = transcriptHistoryRemote
			? 0
			: Math.max(0, transcriptRestoreGroups.length - TRANSCRIPT_INITIAL_GROUP_LIMIT);
		if (transcriptHasEarlierMessages || transcriptFirstRenderedGroupIndex > 0) {
			restoreFragment.appendChild(createTranscriptHistoryControl());
		}

		let renderedMessages = 0;
		messageAppendTarget = restoreFragment;
		try {
			renderedMessages = renderTranscriptGroupRange(
				transcriptFirstRenderedGroupIndex,
				transcriptRestoreGroups.length,
				{ restoredTranscript: true }
			);
		} finally {
			messageAppendTarget = null;
		}
		replaceElementChildren(messages, restoreFragment);
		return renderedMessages;
	}

	function findFirstRenderedTranscriptRoot() {
		if (!messages || !messages.children) return null;
		for (let index = 0; index < messages.children.length; index++) {
			const child = messages.children[index];
			if (!child || child === empty || child === transcriptHistoryControl) continue;
			return child;
		}
		return null;
	}

	function getTranscriptRootStateId(root) {
		if (!root || !root.dataset) return '';
		const turnId = typeof root.dataset.turnId === 'string' ? root.dataset.turnId : '';
		if (turnId) return 'turn:' + turnId;
		const messageId = typeof root.dataset.id === 'string' ? root.dataset.id : '';
		return messageId ? 'message:' + messageId : '';
	}

	function findTranscriptRootByStateId(stateId) {
		const id = typeof stateId === 'string' ? stateId : '';
		if (!id || !messages || !messages.children) return null;
		for (let index = 0; index < messages.children.length; index++) {
			const child = messages.children[index];
			if (!child || child === empty || child === transcriptHistoryControl) continue;
			if (getTranscriptRootStateId(child) === id) return child;
		}
		return null;
	}

	function getTranscriptContainerTop() {
		if (!messages || typeof messages.getBoundingClientRect !== 'function') return 0;
		const rect = messages.getBoundingClientRect();
		const top = rect && Number(rect.top);
		return Number.isFinite(top) ? top : 0;
	}

	function getTranscriptRootOffset(root) {
		const top = getTranscriptAnchorTop(root);
		return top === null ? null : top - getTranscriptContainerTop();
	}

	function findFirstVisibleTranscriptRoot() {
		if (!messages || !messages.children) return null;
		const containerTop = getTranscriptContainerTop();
		let firstRoot = null;
		for (let index = 0; index < messages.children.length; index++) {
			const child = messages.children[index];
			if (!child || child === empty || child === transcriptHistoryControl) continue;
			if (!firstRoot) firstRoot = child;
			if (typeof child.getBoundingClientRect !== 'function') continue;
			const rect = child.getBoundingClientRect();
			const top = rect && Number(rect.top);
			const bottom = rect && Number(rect.bottom);
			if (Number.isFinite(bottom) && bottom > containerTop + 0.5) return child;
			if (!Number.isFinite(bottom) && Number.isFinite(top) && top >= containerTop - 0.5) return child;
		}
		return firstRoot;
	}

	function captureTranscriptPositionState(sessionId) {
		const normalizedSessionId = typeof sessionId === 'string' ? sessionId : '';
		if (!normalizedSessionId || !messages) return null;
		if (
			transcriptPendingPositionState &&
			transcriptPendingPositionState.sessionId === normalizedSessionId
		) {
			return { ...transcriptPendingPositionState };
		}
		if (!userScrolledAway) {
			return { sessionId: normalizedSessionId, atBottom: true };
		}

		const scrollHeight = Number(messages.scrollHeight || 0) || 0;
		const clientHeight = Number(messages.clientHeight || 0) || 0;
		const scrollTop = Number(messages.scrollTop || 0) || 0;
		const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
		const state = {
			sessionId: normalizedSessionId,
			atBottom: false,
			distanceFromBottom: Math.max(0, maxScrollTop - scrollTop),
		};
		const anchor = findFirstVisibleTranscriptRoot();
		const anchorId = getTranscriptRootStateId(anchor);
		const anchorOffset = getTranscriptRootOffset(anchor);
		if (anchorId) state.anchorId = anchorId;
		if (anchorOffset !== null) state.anchorOffset = anchorOffset;
		return state;
	}

	function normalizeTranscriptPositionState(raw, sessionId) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
		const normalizedSessionId = typeof sessionId === 'string' ? sessionId : '';
		if (!normalizedSessionId || raw.sessionId !== normalizedSessionId || raw.atBottom !== false) return null;
		const distanceFromBottom = Number(raw.distanceFromBottom);
		const anchorOffset = Number(raw.anchorOffset);
		const anchorId = typeof raw.anchorId === 'string' && raw.anchorId.length <= 512 ? raw.anchorId : '';
		return {
			sessionId: normalizedSessionId,
			atBottom: false,
			distanceFromBottom: Number.isFinite(distanceFromBottom) && distanceFromBottom >= 0
				? distanceFromBottom
				: 0,
			anchorId,
			anchorOffset: Number.isFinite(anchorOffset) ? anchorOffset : null,
		};
	}

	function transcriptPositionNeedsEarlierMessages(state) {
		if (!state || !messages || !transcriptHistoryRemote || !transcriptHasEarlierMessages) {
			return false;
		}
		if (state.anchorId) {
			return !findTranscriptRootByStateId(state.anchorId);
		}
		const scrollHeight = Number(messages.scrollHeight || 0) || 0;
		const clientHeight = Number(messages.clientHeight || 0) || 0;
		return state.distanceFromBottom > Math.max(0, scrollHeight - clientHeight) + 0.5;
	}

	function applyNormalizedTranscriptPositionState(state) {
		if (!state || !messages) return false;
		stopTranscriptPrependSettle();
		setUserScrolledAway(true);

		const scrollHeight = Number(messages.scrollHeight || 0) || 0;
		const clientHeight = Number(messages.clientHeight || 0) || 0;
		const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
		let anchor = state.anchorId ? findTranscriptRootByStateId(state.anchorId) : null;
		let targetTop = null;

		if (anchor && state.anchorOffset !== null) {
			const currentOffset = getTranscriptRootOffset(anchor);
			if (currentOffset !== null) {
				const nextScrollTop = Number(messages.scrollTop || 0) + currentOffset - state.anchorOffset;
				messages.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
				targetTop = getTranscriptContainerTop() + state.anchorOffset;
			}
		}

		if (targetTop === null) {
			messages.scrollTop = Math.max(0, maxScrollTop - Math.min(maxScrollTop, state.distanceFromBottom));
			anchor = findFirstVisibleTranscriptRoot();
			targetTop = getTranscriptAnchorTop(anchor);
		}

		rememberMessagesScrollTop();
		if (anchor && targetTop !== null) {
			transcriptScrollAnchorLocked = true;
			updateMessagesOverflowAnchor();
			startTranscriptPrependSettle(anchor, targetTop);
		}
		return true;
	}

	function continuePendingTranscriptPositionRestore() {
		const state = transcriptPendingPositionState;
		if (!state || state.sessionId !== transcriptHistorySessionId) return false;
		if (transcriptPositionNeedsEarlierMessages(state)) {
			return requestEarlierTranscriptPage();
		}

		transcriptPendingPositionState = null;
		const restored = applyNormalizedTranscriptPositionState(state);
		if (restored) scheduleTranscriptPositionStatePersistence();
		return restored;
	}

	function cancelPendingTranscriptPositionRestore() {
		transcriptPendingPositionState = null;
	}

	function restoreTranscriptPositionState(raw, sessionId) {
		const state = normalizeTranscriptPositionState(raw, sessionId);
		if (!state || !messages) return false;
		if (transcriptPositionNeedsEarlierMessages(state)) {
			transcriptPendingPositionState = state;
			stopTranscriptPrependSettle();
			setUserScrolledAway(true);
			messages.scrollTop = 0;
			rememberMessagesScrollTop();
			requestEarlierTranscriptPage();
			return true;
		}

		transcriptPendingPositionState = null;
		return applyNormalizedTranscriptPositionState(state);
	}

	function removeTranscriptHistoryControl(restoreFocus) {
		const control = transcriptHistoryControl;
		const button = transcriptHistoryButton;
		const shouldRestoreFocus = !!restoreFocus && document.activeElement === button;
		if (control && control.parentNode) {
			try {
				control.parentNode.removeChild(control);
			} catch {}
		}
		transcriptHistoryControl = null;
		transcriptHistoryButton = null;
		if (shouldRestoreFocus && messages && typeof messages.focus === 'function') {
			try {
				messages.focus({ preventScroll: true });
			} catch {
				try { messages.focus(); } catch {}
			}
		}
	}

	function prependTranscriptGroupRange(start, end, options) {
		if (!messages || start < 0 || end <= start) return false;
		stopTranscriptPrependSettle();
		setUserScrolledAway(true);
		const anchor = findFirstRenderedTranscriptRoot();
		const anchorTopBefore = getTranscriptAnchorTop(anchor);
		const scrollHeightBefore = Number(messages.scrollHeight || 0) || 0;
		const scrollTopBefore = Number(messages.scrollTop || 0) || 0;
		const previousSuppressAutoScroll = suppressAutoScroll;
		const previousLastToolMsg = lastToolMsg;
		const previousLastToolBatchPathSet = lastToolBatchPathSet;
		const fragment = document.createDocumentFragment();

		transcriptScrollAnchorLocked = true;
		updateMessagesOverflowAnchor();
		suppressAutoScroll = true;
		messageAppendTarget = fragment;
		try {
			resetLastToolBatchState();
			renderTranscriptGroupRange(start, end, {
				historicalRestore: true,
				restoredTranscript: true,
			});
		} finally {
			messageAppendTarget = null;
			suppressAutoScroll = previousSuppressAutoScroll;
			lastToolMsg = previousLastToolMsg;
			lastToolBatchPathSet = previousLastToolBatchPathSet;
		}

		const restoreFocus = !!(options && options.restoreFocus);
		if (options && options.removeHistoryControl) {
			removeTranscriptHistoryControl(restoreFocus);
		}

		if (anchor && typeof messages.insertBefore === 'function') {
			messages.insertBefore(fragment, anchor);
		} else {
			messages.appendChild(fragment);
		}

		const anchorTopAfter = getTranscriptAnchorTop(anchor);
		const scrollHeightAfter = Number(messages.scrollHeight || 0) || 0;
		const measuredDelta =
			anchorTopBefore !== null && anchorTopAfter !== null
				? anchorTopAfter - anchorTopBefore
				: scrollHeightAfter - scrollHeightBefore;
		if (Number.isFinite(measuredDelta) && measuredDelta !== 0) {
			messages.scrollTop = Math.max(0, scrollTopBefore + measuredDelta);
		}
			rememberMessagesScrollTop();
			startTranscriptPrependSettle(anchor, anchorTopBefore);
			scheduleTranscriptPositionStatePersistence();
			return true;
		}

	function applyEarlierTranscriptPage(data) {
		const request = transcriptHistoryPendingRequest;
		if (
			!request ||
			!data ||
			Number(data.requestId) !== request.requestId ||
			data.sessionId !== request.sessionId ||
			data.requestCursor !== request.cursor ||
			request.sessionId !== transcriptHistorySessionId ||
			request.cursor !== transcriptHistoryCursor
		) {
			return false;
		}

		finishTranscriptHistoryRequest(request);
		if (data.error) return false;

		const source = Array.isArray(data.messages) ? data.messages : [];
		if (source.length === 0) {
			if (!data.hasEarlierMessages) {
				transcriptHasEarlierMessages = false;
				removeTranscriptHistoryControl(request.restoreFocus);
			}
			return false;
		}

		for (let index = 0; index < source.length; index++) {
			const message = source[index];
			if (
				!message ||
				typeof message.id !== 'string' ||
				!message.id ||
				messageDataById.has(message.id)
			) {
				return false;
			}
		}

		const nextCursor = typeof data.cursor === 'string' ? data.cursor : '';
		const hasEarlierMessages = !!(data.hasEarlierMessages && nextCursor);
		if (hasEarlierMessages && nextCursor === request.cursor) return false;

		buildTranscriptRestoreGroups(source);
		if (transcriptRestoreGroups.length === 0) return false;

		const applied = prependTranscriptGroupRange(0, transcriptRestoreGroups.length, {
			restoreFocus: request.restoreFocus,
			removeHistoryControl: !hasEarlierMessages,
		});
		if (!applied) return false;

		transcriptHistoryCursor = nextCursor;
		transcriptHasEarlierMessages = hasEarlierMessages;
		continuePendingTranscriptPositionRestore();
		return true;
	}

	function loadEarlierTranscriptPage(options) {
		if (transcriptHistoryRemote) {
			return requestEarlierTranscriptPage(options);
		}
		if (!messages || transcriptFirstRenderedGroupIndex <= 0) return false;

		const previousFirstIndex = transcriptFirstRenderedGroupIndex;
		const nextFirstIndex = Math.max(0, previousFirstIndex - TRANSCRIPT_HISTORY_PAGE_GROUP_LIMIT);
		const loaded = prependTranscriptGroupRange(nextFirstIndex, previousFirstIndex, {
			restoreFocus: !!(options && options.restoreFocus),
			removeHistoryControl: nextFirstIndex === 0,
		});
		if (loaded) transcriptFirstRenderedGroupIndex = nextFirstIndex;
		return loaded;
	}

	function maybeLoadEarlierTranscriptOnScroll() {
		if (
			!messages ||
			(transcriptHistoryRemote
				? !transcriptHasEarlierMessages || !!transcriptHistoryPendingRequest
				: transcriptFirstRenderedGroupIndex <= 0) ||
			Number(messages.scrollTop || 0) > TRANSCRIPT_HISTORY_AUTOLOAD_THRESHOLD_PX
		) {
			return false;
		}
		return loadEarlierTranscriptPage();
	}

	function setTurnStatusText(turnData, text) {
		if (!turnData || !turnData.statusText) return;
		const nextText = String(text === undefined || text === null ? '' : text);
		const nextTitle = nextText && nextText.length > 80 ? nextText : '';
		const textChanged = turnData.statusRenderedText !== nextText;
		const titleChanged = turnData.statusRenderedTitle !== nextTitle;
		if (!textChanged && !titleChanged) return;
		turnData.statusRenderedText = nextText;
		turnData.statusRenderedTitle = nextTitle;
		if (textChanged) turnData.statusText.textContent = nextText;
		if (titleChanged) turnData.statusText.title = nextTitle;
	}

	function setTurnBusyState(turnData, busy) {
		if (!turnData || !turnData.el || !turnData.el.setAttribute) return;
		const nextValue = busy ? 'true' : 'false';
		if (turnData.el.getAttribute && turnData.el.getAttribute('aria-busy') === nextValue) return;
		turnData.el.setAttribute('aria-busy', nextValue);
	}

function updateTurnState(turnId, processing) {
	const turnData = turnEls.get(turnId);
	if (!turnData) return;

	turnData.isProcessing = processing;
	setTurnBusyState(turnData, processing);

	if (processing) {
		turnData.statusStateKey = '';
		setDisplay(turnData.statusBar, 'flex');
		setDisplay(turnData.spinner, '');
		if (!hasNonWhitespaceText(turnData.statusRenderedText)) {
			setTurnStatusText(turnData, 'Thinking…');
		}
	} else {
		// Per-turn status is only meaningful while the turn is active.
		// Clear it unconditionally so stale "Thinking…" doesn't stick to past turns.
		setDisplay(turnData.spinner, 'none');
		setTurnStatusText(turnData, '');
		turnData.currentStatus = '';
		turnData.statusStateKey = '';
		turnData.retryInfo = null;
		clearTurnRetryCountdown(turnData);
		clearTurnStatusTimeout(turnData);
		setDisplay(turnData.statusBar, 'none');
	}
}

function clearTurnStatusTimeout(turnData) {
	if (!turnData || !turnData.statusTimeout) return;
	clearTimeout(turnData.statusTimeout);
	turnData.statusTimeout = null;
}

function clearTurnRetryCountdown(turnData) {
	if (!turnData) return;
	if (turnData.retryInterval) {
		clearInterval(turnData.retryInterval);
		turnData.retryInterval = null;
	}
	if (turnData.retryCleanupTimeout) {
		clearTimeout(turnData.retryCleanupTimeout);
		turnData.retryCleanupTimeout = null;
	}
}

function clearAllTurnTimers() {
	for (const turnData of turnEls.values()) {
		clearTurnRetryCountdown(turnData);
		clearTurnStatusTimeout(turnData);
	}
}

function startRetryCountdown(turnData) {
	if (!turnData.retryInfo || !turnData.retryInfo.nextRetryTime) {
		clearTurnRetryCountdown(turnData);
		return;
	}
	clearTurnRetryCountdown(turnData);

	const updateCountdown = () => {
		if (!turnData.retryInfo) return;

		const remaining = Math.max(0, Math.ceil((turnData.retryInfo.nextRetryTime - Date.now()) / 1000));
		const attempt = turnData.retryInfo.attempt || 1;
		let statusText = 'Retrying';
		if (remaining > 0) {
			statusText += ' in ' + remaining + 's';
		}
		statusText += ' (#' + attempt + ')';
		setTurnStatusText(turnData, statusText);
	};

	updateCountdown();
	turnData.retryInterval = setInterval(() => {
		if (!turnData.retryInfo || Date.now() >= turnData.retryInfo.nextRetryTime) {
			clearTurnRetryCountdown(turnData);
			return;
		}
		updateCountdown();
	}, 500);

	turnData.retryCleanupTimeout = setTimeout(() => {
		clearTurnRetryCountdown(turnData);
	}, Math.max(0, turnData.retryInfo.nextRetryTime - Date.now()) + 1000);
}
