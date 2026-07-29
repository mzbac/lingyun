	    function truncateText(text, maxLen) {
	      return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
	    }

		    const TOOL_ACTION_STATUS_PREFIX_RE = /^[✗✓]\s*/;
			    const TOOL_ACTION_ELLIPSIS_SUFFIX_RE = /\s*…$/;
				    const TOOL_HEADER_LABEL_DISPLAY_LIMIT = 160;
				    const TOOL_ACTION_TARGET_DISPLAY_LIMIT = 120;
				    const TOOL_BATCH_FILE_DISPLAY_LIMIT = 160;
				    const TOOL_PATH_DISPLAY_LIMIT = 160;
					    const TOOL_DIFF_HUNK_HEADER_DISPLAY_LIMIT = 160;
					    const TOOL_DIFF_UNAVAILABLE_REASON_DISPLAY_LIMIT = 240;
				    const NON_WHITESPACE_TEXT_RE = /\S/;
		    const openLocationPayloadByElement = new WeakMap();
		    const openLocationPayloadById = new Map();
		    const openLocationPayloadIdByKey = new Map();
		    const toolActionApprovalByElement = new WeakMap();
		    const toolActionApprovalById = new Map();
		    const toolActionApprovalIdByValue = new Map();
		    const planActionMessageIdByElement = new WeakMap();
		    const planActionMessageIdByToken = new Map();
		    const planActionMessageTokenByValue = new Map();
		    const renderedActionByElement = new WeakMap();
		    let nextOpenLocationPayloadId = 1;
		    let nextToolActionApprovalId = 1;
		    let nextPlanActionMessageToken = 1;

		    function hasNonWhitespaceText(value) {
		      return NON_WHITESPACE_TEXT_RE.test(String(value === undefined || value === null ? '' : value));
		    }

		    function getNonWhitespaceString(value) {
		      if (typeof value !== 'string') return '';
		      return hasNonWhitespaceText(value) ? value : '';
		    }

		    function getCompactRenderDatasetKey(renderKey) {
		      const text = String(renderKey || '');
		      if (!text) return '';
		      let hash = 2166136261;
		      for (let i = 0; i < text.length; i++) {
		        hash ^= text.charCodeAt(i);
		        hash = Math.imul(hash, 16777619);
		      }
		      return text.length + ':' + (hash >>> 0).toString(36);
		    }

		    function createCompactRenderKeyBuilder() {
		      return { hash: 2166136261, length: 0 };
		    }

		    function appendCompactRenderKeyText(builder, text) {
		      const value = String(text === undefined || text === null ? '' : text);
		      for (let i = 0; i < value.length; i++) {
		        builder.hash ^= value.charCodeAt(i);
		        builder.hash = Math.imul(builder.hash, 16777619);
		      }
		      builder.length += value.length;
		      return builder;
		    }

		    function appendCompactRenderKeyCode(builder, code) {
		      builder.hash ^= code;
		      builder.hash = Math.imul(builder.hash, 16777619);
		      builder.length++;
		      return builder;
		    }

		    function appendCompactRenderKeyPart(builder, value) {
		      const text = String(value === undefined || value === null ? '' : value);
		      appendCompactRenderKeyText(builder, String(text.length));
		      appendCompactRenderKeyCode(builder, 58);
		      appendCompactRenderKeyText(builder, text);
		      appendCompactRenderKeyCode(builder, 1);
		      return builder;
		    }

		    function finishCompactRenderKey(builder) {
		      return builder && builder.length ? builder.length + ':' + (builder.hash >>> 0).toString(36) : '';
		    }

		    function rememberRenderedAction(el, action) {
		      const value = String(action || '');
		      if (el && value) renderedActionByElement.set(el, value);
		      return value;
		    }

		    function getRenderedAction(el) {
		      if (!el) return '';
		      const cached = renderedActionByElement.get(el);
		      if (cached !== undefined) return cached;
		      if (el.dataset && el.dataset.action) return String(el.dataset.action);
		      return el.getAttribute ? String(el.getAttribute('data-action') || '') : '';
		    }

		    function createOpenLocationPayload(filePath, line, character) {
		      return {
		        filePath: getNonWhitespaceString(filePath),
		        line: typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : 0,
		        character: typeof character === 'number' && Number.isInteger(character) && character > 0 ? character : 1,
		      };
		    }

		    function rememberOpenLocationPayload(el, filePath, line, character) {
		      const payload = createOpenLocationPayload(filePath, line, character);
		      if (el && payload.filePath && payload.line > 0) openLocationPayloadByElement.set(el, payload);
		      return payload;
		    }

		    function getOpenLocationPayload(el) {
		      const cached = el ? openLocationPayloadByElement.get(el) : null;
		      if (cached && cached.filePath && cached.line > 0) return cached;
		      const id = el && el.getAttribute ? el.getAttribute('data-open-location-id') : '';
		      const payload = id ? openLocationPayloadById.get(id) : null;
		      return payload && payload.filePath && payload.line > 0 ? payload : null;
		    }

		    function getOpenLocationPayloadKey(payload) {
		      return payload.filePath.length + ':' + payload.filePath + ':' + payload.line + ':' + payload.character;
		    }

		    function rememberOpenLocationPayloadId(filePath, line, character) {
		      const payload = createOpenLocationPayload(filePath, line, character);
		      if (!payload.filePath || payload.line <= 0) return '';
		      const key = getOpenLocationPayloadKey(payload);
		      let id = openLocationPayloadIdByKey.get(key);
		      if (!id) {
		        id = 'loc' + String(nextOpenLocationPayloadId++);
		        openLocationPayloadIdByKey.set(key, id);
		      }
		      openLocationPayloadById.set(id, payload);
		      return id;
		    }

		    function renderOpenLocationAttrs(filePath, line, character) {
		      const id = rememberOpenLocationPayloadId(filePath, line, character);
		      return id ? ' data-action="openLocation" data-open-location-id="' + id + '"' : '';
		    }

		    function hydrateOpenLocationPayloadButton(button) {
		      const id = button && button.getAttribute ? button.getAttribute('data-open-location-id') : '';
		      const payload = id ? openLocationPayloadById.get(id) : null;
		      if (button && payload && payload.filePath && payload.line > 0) {
		        openLocationPayloadByElement.set(button, payload);
		        if (button.removeAttribute) button.removeAttribute('data-open-location-id');
		      }
		    }

		    function hydrateOpenLocationPayloads(rootEl) {
		      if (!rootEl || !rootEl.querySelectorAll) return;
		      const buttons = rootEl.querySelectorAll('[data-open-location-id]');
		      for (let i = 0; i < buttons.length; i++) hydrateOpenLocationPayloadButton(buttons[i]);
		    }

		    function rememberToolActionApprovalToken(approvalId) {
		      const value = String(approvalId || '');
		      if (!value) return '';
		      let id = toolActionApprovalIdByValue.get(value);
		      if (!id) {
		        id = 'act' + String(nextToolActionApprovalId++);
		        toolActionApprovalIdByValue.set(value, id);
		      }
		      toolActionApprovalById.set(id, value);
		      return id;
		    }

		    function renderToolActionApprovalAttrs(approvalId) {
		      const id = rememberToolActionApprovalToken(approvalId);
		      return id ? ' data-tool-action-id="' + id + '"' : '';
		    }

		    function getToolActionApprovalId(el) {
		      if (!el) return '';
		      const cached = toolActionApprovalByElement.get(el);
		      if (cached !== undefined) return cached;
		      const id = el.getAttribute ? el.getAttribute('data-tool-action-id') : '';
		      return id ? (toolActionApprovalById.get(id) || '') : '';
		    }

		    function hydrateToolActionPayloadButton(button) {
		      const id = button && button.getAttribute ? button.getAttribute('data-tool-action-id') : '';
		      const approvalId = id ? toolActionApprovalById.get(id) : '';
		      if (button && approvalId) {
		        toolActionApprovalByElement.set(button, approvalId);
		        if (button.removeAttribute) button.removeAttribute('data-tool-action-id');
		      }
		    }

		    function hydrateToolActionPayloads(rootEl) {
		      if (!rootEl || !rootEl.querySelectorAll) return;
		      const buttons = rootEl.querySelectorAll('[data-tool-action-id]');
		      for (let i = 0; i < buttons.length; i++) hydrateToolActionPayloadButton(buttons[i]);
		    }

			    function toolCardBodyHtmlHasHydratablePayloads(bodyHtml) {
			      const html = String(bodyHtml || '');
			      return html.indexOf('data-open-location-id=') !== -1 || html.indexOf('data-tool-action-id=') !== -1;
			    }

			    function hydrateToolCardPayloads(rootEl, bodyHtml) {
			      if (bodyHtml !== undefined && !toolCardBodyHtmlHasHydratablePayloads(bodyHtml)) return;
			      if (!rootEl || !rootEl.querySelectorAll) return;
			      const buttons = rootEl.querySelectorAll('[data-open-location-id],[data-tool-action-id]');
			      for (let i = 0; i < buttons.length; i++) {
			        const button = buttons[i];
			        hydrateOpenLocationPayloadButton(button);
		        hydrateToolActionPayloadButton(button);
		      }
		    }

		    function rememberPlanActionMessageToken(planMessageId) {
		      const value = String(planMessageId || '');
		      if (!value) return '';
		      let token = planActionMessageTokenByValue.get(value);
		      if (!token) {
		        token = 'planact' + String(nextPlanActionMessageToken++);
		        planActionMessageTokenByValue.set(value, token);
		      }
		      planActionMessageIdByToken.set(token, value);
		      return token;
		    }

		    function renderPlanActionAttrs(planMessageId) {
		      const token = rememberPlanActionMessageToken(planMessageId);
		      return token ? ' data-plan-action-id="' + token + '"' : '';
		    }

			    function getPlanActionMessageId(el) {
			      if (!el) return '';
			      const cached = planActionMessageIdByElement.get(el);
			      if (cached !== undefined) return cached;
			      const token = el.getAttribute ? el.getAttribute('data-plan-action-id') : '';
			      return token ? (planActionMessageIdByToken.get(token) || '') : '';
			    }

			    function hydratePlanActionPayloadButton(button) {
			      const token = button && button.getAttribute ? button.getAttribute('data-plan-action-id') : '';
			      const planMessageId = token ? planActionMessageIdByToken.get(token) : '';
			      if (button && planMessageId) {
			        planActionMessageIdByElement.set(button, planMessageId);
			        if (button.removeAttribute) button.removeAttribute('data-plan-action-id');
			      }
			    }

			    function hydratePlanActionPayloadChildren(parentEl) {
			      const children = parentEl && parentEl.children ? parentEl.children : null;
			      if (!children) return;
			      for (let i = 0; i < children.length; i++) hydratePlanActionPayloadButton(children[i]);
			    }

			    function hydratePlanActionPayloadsFromLayout(rootEl) {
			      const children = rootEl && rootEl.children ? rootEl.children : null;
			      if (!children || children.length < 3) return false;
			      const actionsEl = children[2];
			      if (hasRenderedElementClass(actionsEl, 'plan-activity')) return true;
			      if (!hasRenderedElementClass(actionsEl, 'plan-actions')) return false;
			      hydratePlanActionPayloadChildren(actionsEl);

			      const confirmEl = children.length > 3 ? children[3] : null;
			      if (!isPlanCancelConfirmElement(confirmEl)) return true;
			      const confirmChildren = confirmEl && confirmEl.children ? confirmEl.children : null;
			      const confirmActionsEl = confirmChildren && confirmChildren.length > 1 ? confirmChildren[1] : null;
			      if (!hasRenderedElementClass(confirmActionsEl, 'plan-cancel-confirm-actions')) return false;
			      hydratePlanActionPayloadChildren(confirmActionsEl);
			      return true;
			    }

			    function hydratePlanActionPayloads(rootEl) {
			      if (!rootEl) return;
			      if (hydratePlanActionPayloadsFromLayout(rootEl)) return;
			      if (!rootEl.querySelectorAll) return;
			      const buttons = rootEl.querySelectorAll('[data-plan-action-id]');
			      for (let i = 0; i < buttons.length; i++) hydratePlanActionPayloadButton(buttons[i]);
			    }

			    function getToolActionTargetLabel(headerText) {
			      const text = String(headerText || '').replace(TOOL_ACTION_STATUS_PREFIX_RE, '').replace(TOOL_ACTION_ELLIPSIS_SUFFIX_RE, '').trim();
		      return truncateText(text || 'tool', TOOL_ACTION_TARGET_DISPLAY_LIMIT);
		    }

	    function renderToolActionButton(className, action, approvalId, label, ariaLabel) {
	      const escapedLabel = escapeHtml(label);
	      const escapedAriaLabel = escapeHtml(ariaLabel || label);
	      return '<button class="tool-btn ' + escapeHtml(className) + '" type="button" data-action="' + escapeHtml(action) + '"' + renderToolActionApprovalAttrs(approvalId) + ' title="' + escapedAriaLabel + '" aria-label="' + escapedAriaLabel + '">' + escapedLabel + '</button>';
	    }

	    function renderDecorativeToolIcon(icon) {
	      const text = String(icon || '');
	      return text ? '<span class="tool-icon" aria-hidden="true">' + escapeHtml(text) + '</span>' : '';
	    }

		    function renderToolHeaderLabel(icon, label, suffix) {
		      const text = String(label || '');
		      const suffixText = String(suffix || '');
		      const displayText = truncateText(text, TOOL_HEADER_LABEL_DISPLAY_LIMIT);
		      return '<span class="tool-name" title="' + escapeHtml(displayText + suffixText) + '">' + renderDecorativeToolIcon(icon) + escapeHtml(displayText) + escapeHtml(suffixText) + '</span>';
		    }

	    function formatFilePath(path) {
	      if (!path) return '';
	      return String(path);
    }

    const PREVIEW_LINE_CHAR_LIMIT = 400;
    const PREVIEW_REMAINING_LINE_SCAN_LIMIT = 1000;
	    const DIFF_VIEW_MAX_VISIBLE_ROWS = 120;
	    const LSP_LOCATION_RENDER_LIMIT = 30;
	    const LSP_LOCATION_LABEL_DISPLAY_LIMIT = 120;
	    const LSP_HOVER_MARKDOWN_CHAR_LIMIT = 4000;

	    function renderDiffLines(diff, maxLines, options) {
	      if (!diff) return '';
	      if (!hasNonWhitespaceText(diff)) return '';
	      options = options || {};
	      const preview = collectPreviewLines(String(diff), maxLines);

      let html = '<div class="tool-diff" role="group" tabindex="0" data-scrollable="true" aria-label="Diff text preview">';
      for (let i = 0; i < preview.lines.length; i++) {
        const line = preview.lines[i];
        const text = String(line || '');
        let className = 'tool-line-ctx';
        if (
          text.startsWith('+++') ||
          text.startsWith('---') ||
          text.startsWith('Index:') ||
          text.startsWith('diff ') ||
          text.startsWith('===================================================================')
        ) {
          className = 'tool-line-meta';
        } else if (text.startsWith('@@')) {
          className = 'tool-line-info';
        } else if (text.startsWith('+')) {
          className = 'tool-line-add';
        } else if (text.startsWith('-')) {
          className = 'tool-line-del';
        }
        html += '<div class="tool-diff-line ' + className + '">' + escapeHtml(text) + '</div>';
      }
      if (preview.truncated) {
        html += renderDiffActionsFooter('… (' + formatPreviewRemainingText(preview) + ' more lines)', options);
      } else if (preview.clipped) {
        html += renderDiffActionsFooter('… (line truncated)', options);
      } else if (options.alwaysShowActions && hasNonWhitespaceText(diff)) {
        html += renderDiffActionsFooter('', options);
      }
      html += '</div>';
      return html;
    }

	    function renderDiffActionsFooter(message, options) {
	      options = options || {};
	      const footerText = String(message || '');
	      const escapedFooterText = escapeHtml(footerText);
	      let html = '<div class="tool-diff-footer">';
	      if (hasNonWhitespaceText(footerText)) {
	        html += '<div class="tool-more" role="note" aria-label="' + escapedFooterText + '">' + escapedFooterText + '</div>';
	      }
	      html += '<div class="tool-diff-actions">';
      if (options.canOpenNativeDiff) {
        html += '<button class="tool-diff-action" type="button" data-action="openNativeDiff" title="Open diff editor" aria-label="Open diff editor">Open diff</button>';
      }
      html += '<button class="tool-diff-action secondary" type="button" data-action="openFullDiff" title="View text diff" aria-label="Text diff, view text diff">Text diff</button>';
      html += '</div>';
      html += '</div>';
      return html;
    }

    function renderDiffViewer(toolCall) {
      const diffView = toolCall && toolCall.diffView ? toolCall.diffView : null;
      const diff = toolCall && typeof toolCall.diff === 'string' ? toolCall.diff : '';
      const truncated = !!(toolCall && toolCall.diffTruncated);
	      const filePath = toolCall ? getNonWhitespaceString(toolCall.path) : '';
      const actionOptions = { canOpenNativeDiff: !!(toolCall && toolCall.approvalId) };

      if (!diffView || !diffView.files || !diffView.files.length) {
        // Fallback to legacy rendering (still supports openFullDiff modal).
        return renderDiffLines(diff, 30, actionOptions);
      }

      const files = Array.isArray(diffView.files) ? diffView.files : [];
      if (!files.length) return renderDiffLines(diff, 30, actionOptions);

      let html = '<div class="tool-diff-viewer">';
      let diffViewClipped = false;
      let diffViewTruncated = false;
      let visibleDiffRows = 0;

	      for (let f = 0; f < files.length; f++) {
		        const file = files[f] || {};
		        const rawPath = typeof file.filePath === 'string' && hasNonWhitespaceText(file.filePath) ? file.filePath.trim() : filePath;
		        const displayPath = truncateText(formatFilePath(rawPath), TOOL_PATH_DISPLAY_LIMIT);
        const hunks = Array.isArray(file.hunks) ? file.hunks : [];
        let scrollHtml = '';
        let fileRowCount = 0;

        for (let h = 0; h < hunks.length; h++) {
          if (visibleDiffRows >= DIFF_VIEW_MAX_VISIBLE_ROWS) {
            diffViewTruncated = true;
            break;
          }
          const hunk = hunks[h] || {};
		          const header = truncateText(getNonWhitespaceString(hunk.header), TOOL_DIFF_HUNK_HEADER_DISPLAY_LIMIT);
          const lines = Array.isArray(hunk.lines) ? hunk.lines : [];
          let hunkHtml = '';
          let hunkRowCount = 0;

          for (let i = 0; i < lines.length; i++) {
            if (visibleDiffRows >= DIFF_VIEW_MAX_VISIBLE_ROWS) {
              diffViewTruncated = true;
              break;
            }
            const line = lines[i] || {};
            const kind = line.kind || 'ctx';
            const oldLine = typeof line.oldLine === 'number' && Number.isInteger(line.oldLine) && line.oldLine > 0 ? line.oldLine : 0;
            const newLine = typeof line.newLine === 'number' && Number.isInteger(line.newLine) && line.newLine > 0 ? line.newLine : 0;
            const text = typeof line.text === 'string' ? line.text : '';
            let displayText = text;
            if (displayText.length > PREVIEW_LINE_CHAR_LIMIT) {
              displayText = displayText.slice(0, PREVIEW_LINE_CHAR_LIMIT) + '…';
              diffViewClipped = true;
            }

            const rowClass =
              kind === 'add' ? 'add' :
              kind === 'del' ? 'del' :
              kind === 'meta' ? 'meta' : 'ctx';

            const sign =
              kind === 'add' ? '+' :
              kind === 'del' ? '-' :
              kind === 'meta' ? '' : ' ';

	            const openLine = newLine || oldLine;
	            const openAttrs = rawPath && openLine ? renderOpenLocationAttrs(rawPath, openLine, 1) : '';

            hunkHtml += '<div class="tool-diff-row ' + rowClass + '">';

            if (oldLine) {
              hunkHtml += '<span class="tool-diff-ln old">' + escapeHtml(String(oldLine)) + '</span>';
            } else {
              hunkHtml += '<span class="tool-diff-ln old"></span>';
            }

            if (newLine && openAttrs) {
              const visibleLine = String(newLine);
              const openLabel = 'Open ' + displayPath + ' at line ' + openLine;
              const accessibleLabel = formatOpenLocationAccessibleLabel(visibleLine, displayPath, openLine, 1);
              hunkHtml += '<button type="button" class="tool-diff-ln new"' + openAttrs + ' title="' + escapeHtml(openLabel) + '" aria-label="' + escapeHtml(accessibleLabel) + '">' + escapeHtml(visibleLine) + '</button>';
            } else if (newLine) {
              hunkHtml += '<span class="tool-diff-ln new">' + escapeHtml(String(newLine)) + '</span>';
            } else {
              hunkHtml += '<span class="tool-diff-ln new"></span>';
            }

            hunkHtml += '<span class="tool-diff-sign">' + escapeHtml(sign) + '</span>';
            hunkHtml += '<span class="tool-diff-code">' + escapeHtml(displayText) + '</span>';
            hunkHtml += '</div>';
            visibleDiffRows++;
            fileRowCount++;
            hunkRowCount++;
          }
          if (hunkRowCount > 0) {
            if (header) scrollHtml += '<div class="tool-diff-hunk-header">' + escapeHtml(header) + '</div>';
            scrollHtml += hunkHtml;
          }
        }

        if (fileRowCount > 0) {
          if (displayPath) {
            html += '<div class="tool-diff-file-header" title="' + escapeHtml(displayPath) + '">' + escapeHtml(displayPath) + '</div>';
          }
          html += '<div class="tool-diff-scroll" role="group" tabindex="0" data-scrollable="true" aria-label="Diff preview">' + scrollHtml + '</div>';
        }
        if (diffViewTruncated) break;
      }

      if (visibleDiffRows === 0 && hasNonWhitespaceText(diff)) {
        return renderDiffLines(diff, 30, { canOpenNativeDiff: actionOptions.canOpenNativeDiff, alwaysShowActions: true });
      }

      if (diffViewTruncated) {
        html += renderDiffActionsFooter('Diff preview truncated', actionOptions);
      } else if (truncated) {
        html += renderDiffActionsFooter('Diff truncated', actionOptions);
      } else if (diffViewClipped && diff) {
        html += renderDiffActionsFooter('… (line truncated)', actionOptions);
      } else if (diff && diff.length > 0) {
        html += renderDiffActionsFooter('', actionOptions);
      }

      html += '</div>';
      return html;
    }

		    const toolResultTextCache = new WeakMap();
		    const toolResultPreviewHtmlCache = new WeakMap();

		    function getToolResultText(toolCall) {
		      if (!toolCall || typeof toolCall !== 'object' || toolCall.result === undefined || toolCall.result === null) return '';
		      const resultValue = toolCall.result;
		      const resultType = typeof resultValue;
		      const canCache = resultType !== 'function';
		      if (canCache) {
		        const cached = toolResultTextCache.get(toolCall);
		        if (cached && cached.resultValue === resultValue) return cached.text;
		      }
		      let text;
		      if (resultType === 'object') {
		        try {
		          const json = JSON.stringify(resultValue, null, 2);
		          text = json === undefined ? String(resultValue) : json;
		        } catch {
		          text = String(resultValue);
		        }
		      } else {
		        text = String(resultValue);
		      }
		      if (canCache) {
		        toolResultTextCache.set(toolCall, { resultValue, text });
		      }
		      return text;
		    }

		    function getToolResultPreviewHtml(toolCall, resultText, maxLines) {
		      if (!toolCall || typeof toolCall !== 'object') return renderOutputPreview(resultText, maxLines);
		      const cached = toolResultPreviewHtmlCache.get(toolCall);
		      if (cached && cached.resultText === resultText && cached.maxLines === maxLines) return cached.html;
		      const html = renderOutputPreview(resultText, maxLines);
		      toolResultPreviewHtmlCache.set(toolCall, { resultText, maxLines, html });
		      return html;
		    }

			    function renderOutputPreview(text, maxLines) {
			      if (text === undefined || text === null) return '';
			      const fullText = String(text);
			      if (!fullText) return '';
			      if (!hasNonWhitespaceText(fullText)) return '';
			      const preview = collectPreviewLines(fullText, maxLines);
	      let out = '';
	      for (let i = 0; i < preview.lines.length; i++) {
	        if (i > 0) out += '\n';
	        out += preview.lines[i];
	      }
	      if (preview.truncated) out += '\n… (' + formatPreviewRemainingText(preview) + ' more lines)';
	      else if (preview.clipped) out += '\n… (output preview truncated)';

      const showExpand = preview.truncated || preview.clipped || preview.lineCount > 8 || fullText.length > 400;

	      let html = '<div class="tool-output"';
	      html += showExpand ? ' role="group" tabindex="0" data-scrollable="true" aria-label="Tool output preview"' : ' data-scrollable="true"';
	      html += '>';
      html += '<button class="copy-btn" type="button" data-action="copyToolOutput" title="Copy tool output" aria-label="Copy tool output">Copy</button>';
      html += escapeHtml(out);
      if (showExpand) {
        html += '<button class="tool-output-toggle" type="button" data-action="openFullOutput" title="View full tool output" aria-label="View full output, full tool output">View full output</button>';
      }
      html += '</div>';
      return html;
    }

    function formatPreviewRemainingText(preview) {
      const remaining = preview && typeof preview.remaining === 'number' ? preview.remaining : 0;
      if (preview && preview.remainingExact === false) return 'at least ' + String(remaining);
      return String(remaining);
    }

    function appendPreviewLine(lines, fullText, lineStart, lineEnd) {
      const normalizedEnd = lineEnd > lineStart && fullText.charCodeAt(lineEnd - 1) === 13
        ? lineEnd - 1
        : lineEnd;
      const lineLength = normalizedEnd - lineStart;
      if (lineLength > PREVIEW_LINE_CHAR_LIMIT) {
        lines.push(fullText.slice(lineStart, lineStart + PREVIEW_LINE_CHAR_LIMIT) + '…');
        return true;
      }
      lines.push(fullText.slice(lineStart, normalizedEnd));
      return false;
    }

    function collectPreviewLines(fullText, maxLines) {
      const limit = typeof maxLines === 'number' && maxLines > 0 ? Math.floor(maxLines) : 30;
      const lines = [];
      let lineCount = 1;
      let lineStart = 0;
      let clipped = false;
      let remainingExact = true;

      while (lineStart <= fullText.length) {
        const lineEnd = fullText.indexOf('\n', lineStart);
        if (lineEnd < 0) break;
        if (lines.length < limit) {
          clipped = appendPreviewLine(lines, fullText, lineStart, lineEnd) || clipped;
        }
        lineCount++;
        lineStart = lineEnd + 1;
        if (lines.length >= limit && lineCount >= PREVIEW_REMAINING_LINE_SCAN_LIMIT && lineStart < fullText.length) {
          remainingExact = false;
          break;
        }
      }

      if (remainingExact && lines.length < limit) {
        clipped = appendPreviewLine(lines, fullText, lineStart, fullText.length) || clipped;
      }

      return {
        lines,
        remaining: Math.max(0, lineCount - limit),
        remainingExact,
        lineCount,
        truncated: lineCount > limit,
        clipped,
      };
    }

	    const toolArgFallbackKeys = ['command', 'filePath', 'path', 'pattern', 'query'];
	    const TOOL_ARG_QUOTE_EDGE_RE = /^['"]|['"]$/g;

	    function createToolArgFallbackPatterns(key) {
	      return {
	        json: new RegExp('\"' + key + '\"\\\\s*:\\\\s*\"([^\"]+)\"'),
	        flag: new RegExp("--" + key + "\\s+((\\\"[^\\\"]+\\\")|('[^']+')|([^\\s]+))"),
	        kv: new RegExp(key + "\\s*(?:=>|:)\\s*((\\\"[^\\\"]+\\\")|('[^']+')|([^\\s,}]+))"),
	      };
	    }

		    const toolArgFallbackPatterns = Object.create(null);
		    for (let fallbackKeyIndex = 0; fallbackKeyIndex < toolArgFallbackKeys.length; fallbackKeyIndex++) {
		      const key = toolArgFallbackKeys[fallbackKeyIndex];
		      toolArgFallbackPatterns[key] = createToolArgFallbackPatterns(key);
		    }

	    function extractArgValue(raw, key) {
	      if (!raw || !key) return '';
	      const patterns = toolArgFallbackPatterns[key];
	      if (!patterns) return '';

	      try {
	        const jsonMatch = patterns.json.exec(raw);
        if (jsonMatch && jsonMatch[1]) return jsonMatch[1];
      } catch {}

      const flagMatch = patterns.flag.exec(raw);
      if (flagMatch) {
        const value = flagMatch[2] || flagMatch[3] || flagMatch[4] || '';
        return value.replace(TOOL_ARG_QUOTE_EDGE_RE, '');
      }

      const kvMatch = patterns.kv.exec(raw);
      if (kvMatch) {
        const value = kvMatch[2] || kvMatch[3] || kvMatch[4] || '';
        return value.replace(TOOL_ARG_QUOTE_EDGE_RE, '');
      }

	      return '';
	    }

	    function toolArgTextMayContainKey(rawArgsText, key) {
	      return rawArgsText.indexOf(key) !== -1;
	    }

    function getToolCardStatusClass(toolCall) {
      const status = String((toolCall && toolCall.status) || '').trim();
      switch (status) {
        case 'pending':
        case 'running':
        case 'success':
        case 'error':
        case 'rejected':
          return status;
        default:
          return status ? 'error' : 'running';
      }
    }

    function formatToolCardClass(toolCall) {
      return 'tool-card ' + getToolCardStatusClass(toolCall);
    }

	    const toolCardBodyHtmlCache = new WeakMap();
	    const toolCardArgsCache = new WeakMap();

    function getToolCardBodyHtml(cardEl) {
      const cached = toolCardBodyHtmlCache.get(cardEl);
      if (cached !== undefined) return cached;
      const current = cardEl.innerHTML || '';
      toolCardBodyHtmlCache.set(cardEl, current);
      return current;
    }

    function rememberToolCardBodyHtml(cardEl, bodyHtml) {
      if (!cardEl) return;
      toolCardBodyHtmlCache.set(cardEl, String(bodyHtml || ''));
    }

	    function formatToolSummary(toolCall, bodyHtml) {
	      const body = bodyHtml === undefined ? formatToolCardBody(toolCall) : String(bodyHtml || '');
	      return '<div class="' + escapeHtml(formatToolCardClass(toolCall)) + '">' + body + '</div>';
	    }

	    function parseToolArgs(rawArgsText) {
	      const text = typeof rawArgsText === 'string' ? rawArgsText.trim() : '';
	      if (!text) return {};
	      const firstChar = text[0];
	      if (firstChar !== '{' && firstChar !== '[') return {};
	      let args = {};
	      try { args = JSON.parse(text); } catch {}
	      return args && typeof args === 'object' ? args : {};
	    }

	    function hydrateToolArgs(args, rawArgsText) {
		      const hydrated = args && typeof args === 'object' ? args : {};
		      if (!rawArgsText) return hydrated;
		      for (let fallbackKeyIndex = 0; fallbackKeyIndex < toolArgFallbackKeys.length; fallbackKeyIndex++) {
		        const key = toolArgFallbackKeys[fallbackKeyIndex];
		        if (hydrated[key]) continue;
	        if (!toolArgTextMayContainKey(rawArgsText, key)) continue;
	        const extracted = extractArgValue(rawArgsText, key);
	        if (extracted) hydrated[key] = extracted;
	      }
	      return hydrated;
	    }

	    function getToolCardArgs(toolCall, rawArgsText) {
	      if (!toolCall || typeof toolCall !== 'object') return hydrateToolArgs(parseToolArgs(rawArgsText), rawArgsText);
	      const cached = toolCardArgsCache.get(toolCall);
	      if (cached && cached.rawArgsText === rawArgsText) return cached.args;
	      const args = hydrateToolArgs(parseToolArgs(rawArgsText), rawArgsText);
	      toolCardArgsCache.set(toolCall, { rawArgsText, args });
	      return args;
	    }

	    function updateToolCardElement(cardEl, toolCall, beforeUpdate) {
      if (!cardEl) return false;
      const nextClassName = formatToolCardClass(toolCall);
      const classChanged = (cardEl.className || '') !== nextClassName;
      const nextBody = formatToolCardBody(toolCall);
      const bodyChanged = getToolCardBodyHtml(cardEl) !== nextBody;
      if (!classChanged && !bodyChanged) return false;
      if (typeof beforeUpdate === 'function') beforeUpdate();
      if (classChanged) setClassName(cardEl, nextClassName);
      if (bodyChanged) {
        cardEl.innerHTML = nextBody;
        hydrateToolCardPayloads(cardEl, nextBody);
        toolCardBodyHtmlCache.set(cardEl, nextBody);
      }
      return true;
    }

    function normalizeTodoStatus(value) {
      return value === 'in_progress' || value === 'completed' || value === 'cancelled' ? value : 'pending';
    }

    function normalizeTodoPriority(value) {
      return value === 'high' || value === 'low' ? value : 'medium';
    }

    function todoStatusIcon(status) {
      switch (status) {
        case 'completed': return '[✓]';
        case 'in_progress': return '[•]';
        case 'cancelled': return '[✕]';
        default: return '[ ]';
      }
    }

	    const TOOL_TODO_RENDER_LIMIT = 20;
	    const TOOL_TODO_CONTENT_DISPLAY_LIMIT = 240;

    function renderTodoList(items) {
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) return '';

      let html = '<div class="tool-todos" role="list" aria-label="Todos">';
      let renderedCount = 0;
      let hiddenCount = 0;
	      for (let todoIndex = 0; todoIndex < list.length; todoIndex++) {
	        const t = list[todoIndex];
	        if (!t || typeof t !== 'object') continue;
        const content = typeof t.content === 'string' ? t.content : '';
        if (!hasNonWhitespaceText(content)) continue;
        if (renderedCount >= TOOL_TODO_RENDER_LIMIT) {
          hiddenCount++;
          continue;
        }
	        const status = normalizeTodoStatus(typeof t.status === 'string' ? t.status : 'pending');
	        const priority = normalizeTodoPriority(typeof t.priority === 'string' ? t.priority : 'medium');
	        const displayContent = truncateText(content, TOOL_TODO_CONTENT_DISPLAY_LIMIT);

	        html += '<div class="todo-item ' + escapeHtml(status) + '" role="listitem">';
	        html += '<div class="todo-icon" aria-hidden="true">' + escapeHtml(todoStatusIcon(status)) + '</div>';
	        html += '<div class="todo-content">' + escapeHtml(displayContent) + '</div>';
        html += '<div class="todo-meta">';
        html += '<div class="todo-pill ' + escapeHtml(status) + '">' + escapeHtml(status === 'in_progress' ? 'in progress' : status) + '</div>';
        html += '<div class="todo-pill ' + escapeHtml(priority) + '">' + escapeHtml(priority) + '</div>';
        html += '</div>';
        html += '</div>';
        renderedCount++;
	      }
	      if (renderedCount === 0) return '';
	      if (hiddenCount > 0) {
	        const hiddenText = hiddenCount + ' more ' + (hiddenCount === 1 ? 'todo' : 'todos');
	        html += '<div class="todo-overflow" role="listitem" aria-label="' + hiddenText + '">… and ' + hiddenText + '</div>';
	      }
      html += '</div>';
      return html;
    }

	    function formatToolCardBody(toolCall) {
	      toolCall = toolCall || {};
	      const toolId = getNonWhitespaceString(toolCall.id);
	      let icon = toolIcons[toolId];
	      if (!icon) {
	        if (toolId.includes('search') || toolId.includes('knowledge')) icon = '🧠';
	        else if (toolId.startsWith('workspace_')) icon = '🔧';
	        else icon = '🔧';
	      }

	      const rawArgsText = typeof toolCall.args === 'string' ? toolCall.args : '';
	      const args = getToolCardArgs(toolCall, rawArgsText);

		      const path = getNonWhitespaceString(toolCall.path) || getNonWhitespaceString(args.filePath) || getNonWhitespaceString(args.path);
		      const operationText = getNonWhitespaceString(args.operation);
		      const queryText = getNonWhitespaceString(args.query);
		      const patternText = getNonWhitespaceString(args.pattern);
		      const descriptionText = getNonWhitespaceString(args.description);
		      const commandText = getNonWhitespaceString(args.command);
      const diff = getNonWhitespaceString(toolCall.diff);
      const diffStats = toolCall.diffStats || null;
      const diffTruncated = !!toolCall.diffTruncated;
	      const approvalReason = getNonWhitespaceString(toolCall.approvalReason);
	      const diffUnavailableReason = getNonWhitespaceString(toolCall.diffUnavailableReason);
      const batchFiles = Array.isArray(toolCall.batchFiles) ? toolCall.batchFiles : [];
      const additionalCount = typeof toolCall.additionalCount === 'number' && Number.isInteger(toolCall.additionalCount) && toolCall.additionalCount > 0 ? toolCall.additionalCount : 0;
      const todosRaw = toolCall.todos;

	      if (batchFiles.length > 0) {
	        const toolName =
	          (toolId === 'read' || toolId === 'read_range') ? 'Read Files' :
	          (toolId === 'glob' || toolId === 'list') ? 'List Files' :
	          (toolId === 'write' || toolId === 'edit') ? 'Edit Files' : 'Files';
		        const title = toolId === 'glob' && patternText
		          ? ('Glob ' + truncateText(patternText, 50))
		          : toolName;
	        const maxFilesToShow = 10;
	        let visibleFileCount = 0;
	        let hiddenFileCount = additionalCount;
	        let filesHtml = '';
	        for (let i = 0; i < batchFiles.length; i++) {
	          const full = getNonWhitespaceString(batchFiles[i]);
	          if (!full) continue;
	          if (visibleFileCount >= maxFilesToShow) {
	            hiddenFileCount++;
	            continue;
	          }
		          const display = truncateText(formatFilePath(full), TOOL_BATCH_FILE_DISPLAY_LIMIT);
		          const escapedDisplay = escapeHtml(display);
		          filesHtml += '<div class="tool-file-item" role="listitem" title="' + escapedDisplay + '" aria-label="' + escapedDisplay + '">- ' + escapedDisplay + '</div>';
	          visibleFileCount++;
	        }
	        if (visibleFileCount > 0 || hiddenFileCount > 0) {
	          const totalCount = visibleFileCount + hiddenFileCount;
	          let html = '<div class="tool-batch">';
	          html += '<div class="tool-header">' + renderToolHeaderLabel(icon, title, ' (' + totalCount + ')') + '</div>';
	          if (visibleFileCount > 0) {
	            html += '<div class="tool-file-list" role="list" aria-label="Files">';
	            html += filesHtml;
	            if (hiddenFileCount > 0) {
	              const moreText = '… and ' + hiddenFileCount + ' more';
	              const escapedMoreText = escapeHtml(moreText);
	              html += '<div class="tool-more" role="note" aria-label="' + escapedMoreText + '">' + escapedMoreText + '</div>';
	            }
	            html += '</div>';
	          } else if (hiddenFileCount > 0) {
	            const moreText = '… and ' + hiddenFileCount + ' more';
	            const escapedMoreText = escapeHtml(moreText);
	            html += '<div class="tool-more" role="note" aria-label="' + escapedMoreText + '">' + escapedMoreText + '</div>';
	          }
	          html += '</div>';
	          return html;
	        }
      }

      let headerText = '';
      let showDiff = false;

	      if (toolId === 'read' || toolId === 'read_range') {
	        headerText = 'Read File';
	      } else if (toolId === 'todowrite') {
	        headerText = 'Todos';
	        icon = '☑';
      } else if (toolId === 'todoread') {
        headerText = 'Todos';
        icon = '☑';
	      } else if (toolId === 'lsp') {
	        headerText = operationText ? ('LSP ' + operationText) : 'LSP';
	        if (queryText) headerText += ' "' + truncateText(queryText, 30) + '"';
	        if (path) headerText += ': ' + formatFilePath(path);
	      } else if (toolId === 'write' || toolId === 'edit') {
	        headerText = path ? 'Edit: ' + formatFilePath(path) : 'Edit File';
	        icon = '±';
	        showDiff = hasNonWhitespaceText(diff);
	      } else if (toolId === 'glob') {
	        headerText = patternText
	          ? ('Glob ' + truncateText(patternText, 50))
	          : (path ? 'List ' + formatFilePath(path) : 'List Files');
	      } else if (toolId === 'list') {
	        headerText = path ? 'List ' + formatFilePath(path) : 'List Files';
	      } else if (toolId === 'grep') {
	        const p = patternText || queryText;
	        headerText = p ? 'Grep "' + truncateText(p, 30) + '"' : 'Grep';
	      } else if (toolId === 'task') {
	        headerText = descriptionText
	          ? truncateText(descriptionText, 60)
	          : 'Task';
	      } else if (toolId === 'bash') {
	        headerText = commandText ? 'Run: ' + truncateText(commandText, 40) : 'Run';
	      } else if (queryText && toolId.includes('search')) {
	        headerText = 'Search "' + truncateText(queryText, 30) + '"';
	      } else {
	        headerText = getNonWhitespaceString(toolCall.name) || toolId || 'Tool';
	        if (path) headerText += ': ' + formatFilePath(path);
	      }

	      if (toolCall.status === 'running') headerText += '…';
	      if (toolCall.status === 'rejected') headerText = '✗ ' + headerText;
	      if (toolCall.status === 'error') headerText = '✗ ' + headerText;
	      let actionTarget = '';

	      if (toolCall.status === 'pending' && toolCall.approvalId) {
	        actionTarget = getToolActionTargetLabel(headerText);
	        let html = '';
	        html += '<div class="tool-header">' + renderToolHeaderLabel(icon, headerText) + '</div>';
	        if (path && (toolId === 'read' || toolId === 'read_range')) {
	          const visibleLabel = truncateText(formatFilePath(path), TOOL_PATH_DISPLAY_LIMIT);
	          const title = escapeHtml(visibleLabel);
	          const label = escapeHtml(visibleLabel);
	          html += '<div class="tool-path" title="' + title + '">' + label + '</div>';
	        }
	        if (toolId === 'bash') {
	          const preview = commandText || rawArgsText;
	          if (preview) html += renderOutputPreview(preview, 6);
	        }
		        if (approvalReason) {
			          const approvalReasonText = truncateText(approvalReason, 140);
			          const escapedApprovalReasonText = escapeHtml(approvalReasonText);
			          html += '<div class="tool-note" role="note" aria-label="' + escapedApprovalReasonText + '">' + escapedApprovalReasonText + '</div>';
			        }
	        html += '<div class="tool-actions">' +
	          renderToolActionButton('approve', 'approve', toolCall.approvalId, 'Allow once', 'Allow once ' + actionTarget) +
	          (toolCall.isProtected
	            ? ''
	            : renderToolActionButton('always', 'always', toolCall.approvalId, 'Allow always', 'Allow always ' + actionTarget)) +
	          renderToolActionButton('reject', 'reject', toolCall.approvalId, 'Deny', 'Deny ' + actionTarget) +
	        '</div>';
	        return html;
	      }

      let html = '';
      html += '<div class="tool-header">' + renderToolHeaderLabel(icon, headerText);

	      if (diffStats) {
	        const additions = typeof diffStats.additions === 'number' && Number.isInteger(diffStats.additions) ? diffStats.additions : 0;
	        const deletions = typeof diffStats.deletions === 'number' && Number.isInteger(diffStats.deletions) ? diffStats.deletions : 0;
        if (additions > 0) html += '<span class="tool-badge add">+' + escapeHtml(String(additions)) + '</span>';
        if (deletions > 0) html += '<span class="tool-badge del">-' + escapeHtml(String(deletions)) + '</span>';
      }
      if (diffTruncated) {
        html += '<span class="tool-badge info" title="Diff was truncated for display/storage">truncated</span>';
      }

      html += '</div>';

		      if (path && (toolId === 'read' || toolId === 'read_range')) {
			        const visibleLabel = truncateText(formatFilePath(path), TOOL_PATH_DISPLAY_LIMIT);
			        const title = escapeHtml(visibleLabel);
			        const label = escapeHtml(visibleLabel);
			        const openLabel = escapeHtml(formatOpenLocationLabel(visibleLabel, 1, 1));
			        const accessibleLabel = escapeHtml(formatOpenLocationAccessibleLabel(visibleLabel, visibleLabel, 1, 1));
		        if (toolCall.status === 'success') {
	          html +=
	            '<div class="tool-path" title="' + title + '">' +
	            '<button type="button" class="file-link-token file-link"' +
	            renderOpenLocationAttrs(path, 1, 1) +
	            ' title="' +
	            openLabel +
	            '" aria-label="' +
	            accessibleLabel +
	            '">' +
	            label +
	            '</button>' +
	            '</div>';
        } else {
          html += '<div class="tool-path" title="' + title + '">' + label + '</div>';
        }
      }

      if ((toolId === 'todowrite' || toolId === 'todoread') && toolCall.status === 'success') {
        const list = Array.isArray(todosRaw) ? todosRaw : (Array.isArray(args.todos) ? args.todos : []);
        const rendered = renderTodoList(list);
        if (rendered) {
          html += rendered;
        }
      }

      if (showDiff && diff) {
        const diffActionOptions = { canOpenNativeDiff: !!toolCall.approvalId };
        html += toolCall.diffView ? renderDiffViewer(toolCall) : renderDiffLines(diff, 30, diffActionOptions);
		      } else if (diffUnavailableReason) {
		        const diffUnavailableText = truncateText(diffUnavailableReason, TOOL_DIFF_UNAVAILABLE_REASON_DISPLAY_LIMIT);
	        const escapedDiffUnavailableText = escapeHtml(diffUnavailableText);
	        html += '<div class="tool-note" role="note" aria-label="' + escapedDiffUnavailableText + '">' + escapedDiffUnavailableText + '</div>';
	      }

	      if (toolCall.status === 'success' && toolId === 'lsp' && toolCall.lsp) {
	        html += renderLspResults(toolCall.lsp);
		      } else if (toolCall.status === 'success') {
		        const resultText = getToolResultText(toolCall);
		        if (resultText && toolId !== 'todowrite' && toolId !== 'todoread') {
		          html += getToolResultPreviewHtml(toolCall, resultText, toolId === 'glob' ? 10 : 12);
		        }
		      }

	      if (toolCall.status === 'success' && (toolId === 'write' || toolId === 'edit')) {
	        html += '<div class="tool-success">✓ Done</div>';
	      }

		      if (toolCall.status === 'error') {
		        const resultText = getToolResultText(toolCall);
		        if (resultText) {
		          html += '<div class="tool-error-msg">' + escapeHtml(truncateText(resultText, 100)) + '</div>';
		          if (toolCall.approvalId) {
		            if (!actionTarget) actionTarget = getToolActionTargetLabel(headerText);
		            html += '<div class="tool-actions">' +
		              renderToolActionButton('retry', 'retryTool', toolCall.approvalId, '⟳ Retry', 'Retry ' + actionTarget) +
		              '</div>';
		          }
		        }
		      }

	      if (toolCall.status === 'rejected' && toolCall.approvalId) {
	        if (!actionTarget) actionTarget = getToolActionTargetLabel(headerText);
	        html += '<div class="tool-actions">' +
	          renderToolActionButton('retry', 'retryTool', toolCall.approvalId, '⟳ Retry', 'Retry ' + actionTarget) +
	        '</div>';
	      }

      return html;
    }

    function renderLspNote(text) {
      const escapedText = escapeHtml(text);
      return '<div class="lsp-note" role="note" aria-label="' + escapedText + '">' + escapedText + '</div>';
    }

    function renderLspResults(payload) {
      if (!payload || typeof payload !== 'object') {
        return '<div class="lsp-results">' + renderLspNote('No LSP results') + '</div>';
      }

      const op = typeof payload.operation === 'string' ? payload.operation : '';
      const filePath = typeof payload.filePath === 'string' ? payload.filePath : '';
      const results = Array.isArray(payload.results) ? payload.results : [];
      const truncated = !!payload.truncated;
      const skipped = typeof payload.skippedOutsideWorkspace === 'number' && Number.isInteger(payload.skippedOutsideWorkspace) && payload.skippedOutsideWorkspace > 0 ? payload.skippedOutsideWorkspace : 0;

      const locations = [];
      const max = LSP_LOCATION_RENDER_LIMIT;
      let locationRenderLimited = false;

      const pushLocation = (loc, labelHint) => {
        if (locations.length >= max) {
          locationRenderLimited = true;
          return;
        }
        if (!loc || typeof loc !== 'object') return;
        const fp = typeof loc.filePath === 'string' ? loc.filePath : '';
        const range = loc.range && typeof loc.range === 'object' ? loc.range : null;
        const start = range && range.start && typeof range.start === 'object' ? range.start : null;
        const line = start && typeof start.line === 'number' && Number.isInteger(start.line) && start.line > 0 ? start.line : null;
        const character = start && typeof start.character === 'number' && Number.isInteger(start.character) && start.character > 0 ? start.character : 1;
	        if (!fp || !hasNonWhitespaceText(fp) || !line) return;
        const label = typeof labelHint === 'string' && labelHint.trim() ? labelHint.trim() : '';
        locations.push({ filePath: fp, line, character, label });
      };

      const visit = (value, inheritedFilePath) => {
        if (!value) return;
        if (Array.isArray(value)) {
          for (let resultIndex = 0; resultIndex < value.length; resultIndex++) {
            if (locations.length >= max) {
              locationRenderLimited = true;
              break;
            }
            const item = value[resultIndex];
            visit(item, inheritedFilePath);
          }
          return;
        }
        if (locations.length >= max) {
          locationRenderLimited = true;
          return;
        }
        if (typeof value !== 'object') return;

        const fileFromNode = typeof value.filePath === 'string' ? value.filePath : inheritedFilePath;
        const labelHint = typeof value.name === 'string' ? value.name : '';

        if (value.location && typeof value.location === 'object') {
          pushLocation(value.location, labelHint);
        }
        if (value.range && fileFromNode) {
          pushLocation({ filePath: fileFromNode, range: value.range }, labelHint);
        }
        if (value.selectionRange && fileFromNode) {
          pushLocation({ filePath: fileFromNode, range: value.selectionRange }, labelHint);
        }
        if (value.children && Array.isArray(value.children)) {
          if (locations.length >= max) {
            if (value.children.length) locationRenderLimited = true;
          } else {
            visit(value.children, fileFromNode);
          }
        }
      };

      // Common shapes:
      // - definition/implementation/references: results -> Location[]
      // - workspaceSymbol/documentSymbol: results -> items w/ location or ranges
      // - hover: results -> {contents, range}[] (use payload.filePath)
      visit(results, filePath);

      let html = '<div class="lsp-results">';

      let hoverPreviewTruncated = false;
      let hasHoverPreview = false;
      if (op === 'hover' && results[0] && typeof results[0].contents === 'string') {
        const hoverContents = String(results[0].contents);
        if (hasNonWhitespaceText(hoverContents)) {
          const hoverPreview =
            hoverContents.length > LSP_HOVER_MARKDOWN_CHAR_LIMIT
              ? hoverContents.slice(0, LSP_HOVER_MARKDOWN_CHAR_LIMIT)
              : hoverContents;
          hoverPreviewTruncated = hoverPreview.length < hoverContents.length;
          hasHoverPreview = true;
          html += '<div class="lsp-hover" role="group" tabindex="0" data-scrollable="true" aria-label="LSP hover preview">' + renderMarkdown(hoverPreview) + '</div>';
        }
      }

      if (locations.length === 0) {
        if (!hasHoverPreview) html += renderLspNote('No locations found');
      } else {
	        html += '<div class="lsp-location-list" role="list" aria-label="LSP locations">';
	        for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
	          const loc = locations[locationIndex];
	          const labelText = loc.label ? truncateText(String(loc.label), LSP_LOCATION_LABEL_DISPLAY_LIMIT) + ' — ' : '';
	          const displayPath = truncateText(formatFilePath(loc.filePath), TOOL_PATH_DISPLAY_LIMIT);
	          const displayText = displayPath + ':' + loc.line + ':' + loc.character;
	          const label = escapeHtml(labelText);
	          const display = escapeHtml(displayText);
	          const openLabel = escapeHtml(formatOpenLocationLabel(displayPath, loc.line, loc.character));
	          const accessibleLabel = escapeHtml(formatOpenLocationAccessibleLabel(labelText + displayText, displayPath, loc.line, loc.character));
          html +=
            '<div class="lsp-location" role="listitem">' +
            '<button type="button" class="lsp-link"' +
            renderOpenLocationAttrs(loc.filePath, loc.line, loc.character) +
            ' title="' +
            openLabel +
            '" aria-label="' +
            accessibleLabel +
            '">' +
            label +
            '<span class="lsp-path">' +
            display +
            '</span>' +
            '</button>' +
            '</div>';
        }
        html += '</div>';
      }

      if (skipped > 0 || truncated || locationRenderLimited || hoverPreviewTruncated) {
        let noteText = '';
        if (skipped > 0) noteText = 'skipped ' + skipped + ' outside workspace';
        if (truncated) noteText += noteText ? ' · truncated' : 'truncated';
        if (locationRenderLimited) noteText += noteText ? ' · location preview limited' : 'location preview limited';
        if (hoverPreviewTruncated) noteText += noteText ? ' · hover preview truncated' : 'hover preview truncated';
        html += renderLspNote(noteText);
      }

      html += '</div>';
      return html;
    }

		    const PLAN_MAIN_NUMBERED_QUESTION_RE = /^\d+\.\s+.*\?$/;
		    const PLAN_MAIN_SENTENCE_QUESTION_RE = /^[A-Z][^.!?]*\?$/;
		    const PLAN_SUB_QUESTION_RE = /^[-\*]\s+.*\?$/;
		    const PLAN_QUESTION_DISPLAY_LIMIT = 240;

	    function isPlanMainQuestionLine(trimmed) {
	      const firstCode = trimmed.charCodeAt(0);
	      if (firstCode >= 48 && firstCode <= 57) {
	        return PLAN_MAIN_NUMBERED_QUESTION_RE.test(trimmed);
	      }
	      if (firstCode >= 65 && firstCode <= 90) {
	        return PLAN_MAIN_SENTENCE_QUESTION_RE.test(trimmed);
	      }
	      return false;
	    }

		    function extractPlanQuestionGroups(text) {
	      const normalizedText = String(text === undefined || text === null ? '' : text).trim();
      const questionGroups = [];
      let bodyText = '';
      let currentGroup = null;

      forEachNormalizedMarkdownLine(normalizedText, (line) => {
        const trimmed = line.trim();

	        if (isPlanMainQuestionLine(trimmed)) {
	          if (currentGroup) {
	            questionGroups.push(currentGroup);
	          }
	          currentGroup = { main: trimmed, sub: [] };
	          return;
	        }
	        if (currentGroup && PLAN_SUB_QUESTION_RE.test(trimmed)) {
	          currentGroup.sub.push(trimmed);
	          return;
	        }
	        if (trimmed && currentGroup) {
	          currentGroup.sub.push(trimmed);
	          return;
	        }
	        bodyText = bodyText ? bodyText + '\n' + line : line;
	      });
	      if (currentGroup) {
	        questionGroups.push(currentGroup);
	      }

	      return { questionGroups, bodyText: bodyText.trim() };
	    }

		    const planCardRenderKeyByElement = new WeakMap();

	    function getPlanCardRenderDatasetKey(renderKey) {
	      return getCompactRenderDatasetKey(renderKey);
	    }

	    function rememberPlanCardRenderKey(messageEl, renderKey) {
	      const key = String(renderKey || '');
	      if (!messageEl || !key) return '';
	      planCardRenderKeyByElement.set(messageEl, key);
	      const datasetKey = getPlanCardRenderDatasetKey(key);
	      if (messageEl.dataset && datasetKey) messageEl.dataset.planRenderKey = datasetKey;
	      return datasetKey;
	    }

	    function getRememberedPlanCardRenderKey(messageEl) {
	      return messageEl ? planCardRenderKeyByElement.get(messageEl) || '' : '';
	    }

			    function getPlanCardRenderKey(msg) {
		      const planId = String(msg && msg.id ? msg.id : '');
		      const status = String(msg && msg.plan && msg.plan.status ? msg.plan.status : 'draft');
	      const content = String(msg && msg.content ? msg.content : '').trim();
	      const isActivePlan = !!activePlanMessageId && planId === activePlanMessageId;
	      const key = createCompactRenderKeyBuilder();
	      appendCompactRenderKeyPart(key, planId);
		      appendCompactRenderKeyPart(key, status);
		      appendCompactRenderKeyPart(key, content);
		      appendCompactRenderKeyPart(key, isActivePlan ? '1' : '0');
			      return finishCompactRenderKey(key);
			    }

	    const PLAN_CARD_SAFE_ID_UNSAFE_RE = /[^A-Za-z0-9_-]/g;

	    function formatPlanCard(msg) {
      const status = msg.plan?.status || 'draft';
      const isActivePlan = !!activePlanMessageId && msg && msg.id === activePlanMessageId;
      const statusLabel =
        status === 'generating' ? 'Planning' :
        status === 'needs_input' ? 'Needs input' :
        status === 'draft' ? 'Draft' :
        status === 'executing' ? 'Executing' :
        status === 'done' ? 'Done' :
        status === 'canceled' ? 'Canceled' : status;

      const text = String(msg.content || '').trim();
      const { questionGroups, bodyText } = extractPlanQuestionGroups(text);
      const planId = String(msg.id || 'plan');
      const hasPlanActionControls = isActivePlan && (status === 'draft' || status === 'needs_input');
      const planActionAttrs = hasPlanActionControls ? renderPlanActionAttrs(planId) : '';
	      const hasQuestions = questionGroups.length > 0;
	      const canCancelPlan = hasPlanActionControls;
	      let safePlanId = '';
	      if (hasQuestions || canCancelPlan) {
	        safePlanId = planId.replace(PLAN_CARD_SAFE_ID_UNSAFE_RE, '_');
	      }

	      let questionsHtml = '';
	      if (hasQuestions) {
	        const questionTitleId = 'planQuestionsTitle-' + safePlanId;
	        const escapedQuestionTitleId = escapeHtml(questionTitleId);
        questionsHtml = '<div class="plan-questions"><div id="' + escapedQuestionTitleId + '" class="plan-questions-title">Questions</div><ul class="plan-question-list" role="list" tabindex="0" data-scrollable="true" aria-labelledby="' + escapedQuestionTitleId + '">';
        for (let i = 0; i < questionGroups.length; i++) {
          const group = questionGroups[i];
          let groupContent = '<li class="plan-question">';
	          groupContent += escapeHtml(truncateText(group.main, PLAN_QUESTION_DISPLAY_LIMIT));
          if (group.sub.length > 0) {
            groupContent += '<ul class="plan-sub-questions">';
	            for (let j = 0; j < group.sub.length; j++) {
	              const sub = group.sub[j];
		              groupContent += '<li>' + escapeHtml(truncateText(sub, PLAN_QUESTION_DISPLAY_LIMIT)) + '</li>';
            }
            groupContent += '</ul>';
          }
          groupContent += '</li>';
          questionsHtml += groupContent;
        }
        questionsHtml += '</ul></div>';
      }

	      let cancelPlanButtonHtml = '';
	      let cancelConfirmHtml = '';
	      if (canCancelPlan) {
	        const cancelConfirmId = 'planCancelConfirm-' + safePlanId;
	        const cancelConfirmTextId = 'planCancelConfirmText-' + safePlanId;
	        const escapedCancelConfirmId = escapeHtml(cancelConfirmId);
	        const escapedCancelConfirmTextId = escapeHtml(cancelConfirmTextId);
	        cancelPlanButtonHtml =
	          '<button class="plan-btn danger" type="button" data-action="cancelPlan"' + planActionAttrs + ' title="Cancel plan" aria-label="Cancel plan" aria-expanded="false" aria-controls="' + escapedCancelConfirmId + '">Cancel</button>';
	        cancelConfirmHtml = '<div id="' + escapedCancelConfirmId + '" class="plan-cancel-confirm hidden" role="group" aria-labelledby="' + escapedCancelConfirmTextId + '">' +
          '<div id="' + escapedCancelConfirmTextId + '">Cancel this plan?</div>' +
          '<div class="plan-cancel-confirm-actions">' +
          '<button class="plan-btn secondary" type="button" data-action="cancelPlanDismiss"' + planActionAttrs + ' title="Keep plan" aria-label="Keep plan">Keep plan</button>' +
          '<button class="plan-btn danger" type="button" data-action="cancelPlanConfirm"' + planActionAttrs + ' title="Cancel plan" aria-label="Cancel plan">Cancel plan</button>' +
          '</div>' +
          '</div>';
	      }

      let actions = '';
      if (status === 'draft' && isActivePlan) {
        actions = '<div class="plan-actions">' +
          '<button class="plan-btn primary" type="button" data-action="executePlan"' + planActionAttrs + ' title="Execute plan" aria-label="Execute plan">Execute</button>' +
          '<button class="plan-btn secondary" type="button" data-action="revisePlan"' + planActionAttrs + ' title="Revise plan" aria-label="Revise plan">Revise</button>' +
          cancelPlanButtonHtml +
        '</div>' + cancelConfirmHtml;
      } else if (status === 'needs_input' && isActivePlan) {
        const hintText =
          !text || text === '(No plan generated)'
            ? 'No plan generated. Add constraints in the chat box, then click "Update Plan", or click Revise.'
            : hasQuestions
              ? 'Answer the questions in the chat box, then click "Update Plan".'
              : 'Add constraints in the chat box, then click "Update Plan", or click Revise.';
        actions = '<div class="plan-actions">' +
          '<button class="plan-btn secondary" type="button" data-action="revisePlan"' + planActionAttrs + ' title="Revise plan" aria-label="Revise plan">Revise</button>' +
          cancelPlanButtonHtml +
        '</div>' +
        cancelConfirmHtml +
        '<div class="plan-hint">' + escapeHtml(hintText) + '</div>';
      } else if (status === 'generating' && isActivePlan) {
        actions = '<div class="plan-actions" role="status" aria-live="polite" aria-atomic="true"><button class="plan-btn secondary" type="button" disabled aria-busy="true" title="Planning in progress" aria-label="Planning in progress">Planning…</button></div>';
      } else if (status === 'executing' && isActivePlan) {
        actions = '<div class="plan-actions" role="status" aria-live="polite" aria-atomic="true"><button class="plan-btn secondary" type="button" disabled aria-busy="true" title="Executing plan" aria-label="Executing plan">Executing…</button></div>';
      }

      let html = '<div class="plan-header"><span aria-hidden="true">🧭</span> Plan <span class="plan-status">' + escapeHtml(statusLabel) + '</span></div>';
      html += '<div class="plan-body md">';
      if (questionsHtml) html += questionsHtml;
      html += renderMarkdown(bodyText);
      html += '</div>';
      html += actions;
      html += '<details class="plan-activity" data-count="0">';
      html += '<summary class="plan-activity-summary">Activity <span class="plan-activity-count"></span></summary>';
      html += '<div class="plan-activity-body" role="group" tabindex="0" data-scrollable="true" aria-label="Plan activity"></div>';
      html += '</details>';
      return html;
    }

		    const MARKDOWN_FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
		    const MARKDOWN_FENCE_CLOSE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;
		    const MARKDOWN_CODE_LANGUAGE_DISPLAY_LIMIT = 64;

	    function parseMarkdownFence(line) {
	      const match = MARKDOWN_FENCE_OPEN_RE.exec(String(line || ''));
      if (!match) return null;
      const marker = match[1] || '';
      return {
        char: marker[0],
        length: marker.length,
        info: String(match[2] || '').trim(),
      };
    }

	    function isMarkdownFenceClose(line, fence) {
	      if (!fence || !fence.char || !fence.length) return false;
	      const match = MARKDOWN_FENCE_CLOSE_RE.exec(String(line || ''));
      if (!match) return false;
      const marker = match[1] || '';
      return marker[0] === fence.char && marker.length >= fence.length;
    }

    function isMarkdownLanguageWhitespace(code) {
      return code <= 32 || code === 160;
    }

    function isMarkdownLanguageNameChar(code) {
      return (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code === 43 ||
        code === 46 ||
        code === 35 ||
        code === 45;
    }

    function normalizeMarkdownCodeLanguage(info) {
      const value = String(info || '');
      let output = '';
      let started = false;
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (isMarkdownLanguageWhitespace(code)) {
          if (started) break;
          continue;
        }
	        started = true;
	        if (isMarkdownLanguageNameChar(code)) {
	          output += value[i];
	          if (output.length >= MARKDOWN_CODE_LANGUAGE_DISPLAY_LIMIT) break;
	        }
	      }
      return output;
    }

    function renderMarkdownCodeBlock(block) {
      const lang = block.lang ? String(block.lang) : '';
      const langClass = lang ? ' language-' + escapeHtml(lang) : '';
      const codeBlockLabel = lang ? lang + ' code block' : 'code block';
      const escapedCodeBlockLabel = escapeHtml(codeBlockLabel);
      const copyLabel = 'Copy ' + codeBlockLabel;
      const escapedCopyLabel = escapeHtml(copyLabel);
      return '<div class="markdown-code-block" data-scrollable="true">' +
        '<button class="markdown-code-copy" type="button" data-action="copyCodeBlock" title="' + escapedCopyLabel + '" aria-label="' + escapedCopyLabel + '">Copy</button>' +
        '<pre tabindex="0" data-scrollable="true" aria-label="' + escapedCodeBlockLabel + '"><code class="' + langClass.trim() + '">' + escapeHtml(block.content) + '</code></pre>' +
        '</div>';
    }

	    function forEachNormalizedMarkdownLine(text, onLine) {
	      const value = String(text === undefined || text === null ? '' : text);
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code === 10) {
          onLine(value.slice(start, i));
          start = i + 1;
          continue;
        }
        if (code === 13 && i + 1 < value.length && value.charCodeAt(i + 1) === 10) {
          onLine(value.slice(start, i));
          i++;
          start = i + 1;
        }
      }
      onLine(value.slice(start));
    }

    function renderMarkdown(text) {
      if (!text) return '';

	      let html = '';
	      let inCode = false;
	      let codeLang = '';
	      let codeFence = null;
	      let codeText = '';
	      let codeLineCount = 0;
	      let textLines = [];

      function flushText() {
        if (textLines.length === 0) return;
        html += renderMarkdownTextLines(textLines);
        textLines = [];
	      }

	      function appendCodeLine(line) {
	        if (codeLineCount > 0) codeText += '\n';
	        codeText += line;
	        codeLineCount++;
	      }

	      function flushCode(closed) {
	        const content = codeText;
	        const lang = String(codeLang || '').trim().toLowerCase();
	        if (closed && (lang === 'markdown' || lang === 'md')) {
	          html += renderMarkdown(content);
	        } else {
	          html += renderMarkdownCodeBlock({ lang: codeLang, content, closed: !!closed });
	        }
	        codeLang = '';
	        codeFence = null;
	        codeText = '';
	        codeLineCount = 0;
	      }

      forEachNormalizedMarkdownLine(text, (line) => {
        if (inCode) {
	          if (isMarkdownFenceClose(line, codeFence)) {
	            flushCode(true);
	            inCode = false;
	          } else {
	            appendCodeLine(line);
	          }
          return;
        }

        const fence = parseMarkdownFence(line);
        if (fence) {
          flushText();
          inCode = true;
          codeFence = { char: fence.char, length: fence.length };
          codeLang = normalizeMarkdownCodeLanguage(fence.info);
          return;
        }

        textLines.push(line);
      });

      if (inCode) flushCode(false);
      flushText();

      return html;
    }

	    const MARKDOWN_HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
	    const MARKDOWN_HEADING_START_RE = /^\s*(#{1,6})\s+/;
	    const MARKDOWN_TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
	    const MARKDOWN_ORDERED_LIST_START_RE = /^\s*\d+\.\s+/;
	    const MARKDOWN_BULLET_LIST_START_RE = /^\s*[-*•]\s+/;
	    const MARKDOWN_ORDERED_LIST_ITEM_RE = /^\s*\d+\.\s+(.*)$/;
	    const MARKDOWN_BULLET_LIST_ITEM_RE = /^\s*[-*•]\s+(.*)$/;

	    function isMarkdownBlankLine(line) {
	      return !NON_WHITESPACE_TEXT_RE.test(String(line || ''));
	    }

	    function renderMarkdownTextLines(lines) {
      let html = '';
      let i = 0;

      while (i < lines.length) {
        const raw = String(lines[i] || '');

        if (isMarkdownBlankLine(raw)) {
          i++;
          continue;
        }

	        const headingMatch = MARKDOWN_HEADING_RE.exec(raw);
        if (headingMatch) {
          const level = Math.min(6, Math.max(1, headingMatch[1].length));
          const text = headingMatch[2] || '';
          html += '<h' + level + '>' + renderInlineMarkdown(text) + '</h' + level + '>';
          i++;
          continue;
        }

	        // Tables: header row + separator row (---)
	        const next = i + 1 < lines.length ? String(lines[i + 1] || '') : '';
		        if (raw.includes('|') && next && MARKDOWN_TABLE_SEPARATOR_RE.test(next)) {
	          const tableStart = i;
	          i += 2;
	          while (i < lines.length && !isMarkdownBlankLine(lines[i])) {
	            i++;
	          }
	          html += renderTable(lines, tableStart, i);
	          continue;
	        }

	        const orderedStart = MARKDOWN_ORDERED_LIST_START_RE.test(raw);
	        const bulletStart = MARKDOWN_BULLET_LIST_START_RE.test(raw);
	        if (orderedStart || bulletStart) {
	          const listType = orderedStart ? 'ol' : 'ul';
	          const listStart = i;
	          let hasListContent = false;
	          while (i < lines.length) {
	            const line = String(lines[i] || '');
	            if (isMarkdownBlankLine(line)) {
              // Markdown allows blank lines inside lists; keep scanning if the next non-blank
              // line continues the same list type.
              let j = i + 1;
              while (j < lines.length && isMarkdownBlankLine(lines[j])) j++;
              if (j < lines.length) {
                const nextLine = String(lines[j] || '');
	                const nextIsOrdered = MARKDOWN_ORDERED_LIST_START_RE.test(nextLine);
	                const nextIsBullet = MARKDOWN_BULLET_LIST_START_RE.test(nextLine);
                if ((listType === 'ol' && nextIsOrdered) || (listType === 'ul' && nextIsBullet)) {
                  i = j;
                  continue;
                }
              }
              break;
            }
	            const heading = MARKDOWN_HEADING_START_RE.test(line);
            if (heading) break;
	            const isOrdered = MARKDOWN_ORDERED_LIST_START_RE.test(line);
	            const isBullet = MARKDOWN_BULLET_LIST_START_RE.test(line);
	            if (listType === 'ol' && !isOrdered && !hasListContent) break;
	            if (listType === 'ul' && !isBullet && !hasListContent) break;
	            // Allow continuation lines inside list items.
	            if (!isOrdered && !isBullet && !hasListContent) break;
	            hasListContent = true;
	            i++;
	          }
	          html += renderList(lines, listType, listStart, i);
	          continue;
	        }

	        // Paragraphs until blank line or next structural element.
	        const paragraphStart = i;
	        while (i < lines.length) {
	          const line = String(lines[i] || '');
	          if (isMarkdownBlankLine(line)) break;
		          if (MARKDOWN_HEADING_START_RE.test(line)) break;
		          const maybeNext = i + 1 < lines.length ? String(lines[i + 1] || '') : '';
		          if (line.includes('|') && maybeNext && MARKDOWN_TABLE_SEPARATOR_RE.test(maybeNext)) break;
		          if (MARKDOWN_ORDERED_LIST_START_RE.test(line) || MARKDOWN_BULLET_LIST_START_RE.test(line)) break;
	          i++;
	        }
	        html += renderParagraphs(lines, paragraphStart, i);
	      }

      return html;
    }

	    function splitTableRow(line) {
	      const trimmed = String(line || '').trim();
	      let start = 0;
	      let end = trimmed.length;
      if (trimmed.charCodeAt(0) === 124) start = 1;
      if (end > start && trimmed.charCodeAt(end - 1) === 124) end--;

      const cells = [];
      let cellStart = start;
      for (let i = start; i <= end; i++) {
        if (i !== end && trimmed.charCodeAt(i) !== 124) continue;
        cells.push(trimmed.slice(cellStart, i).trim());
        cellStart = i + 1;
      }
	      return cells;
	    }

	    function countTableCells(line) {
	      const trimmed = String(line || '').trim();
	      let start = 0;
	      let end = trimmed.length;
	      if (trimmed.charCodeAt(0) === 124) start = 1;
	      if (end > start && trimmed.charCodeAt(end - 1) === 124) end--;

	      let count = 0;
	      for (let i = start; i <= end; i++) {
	        if (i !== end && trimmed.charCodeAt(i) !== 124) continue;
	        count++;
	      }
	      return count;
	    }

    function renderTableCells(row, tag, colCount) {
      let html = '';
      for (let i = 0; i < colCount; i++) {
        const cell = i < row.length ? row[i] : '';
        html += '<' + tag + '>' + renderInlineMarkdown(cell) + '</' + tag + '>';
      }
      return html;
    }

	    function renderTable(lines, startIndex, endIndex) {
	      if (!lines) return '';
	      const start = typeof startIndex === 'number' && startIndex > 0 ? startIndex : 0;
	      const end = typeof endIndex === 'number' && endIndex <= lines.length ? endIndex : lines.length;
	      if (end - start < 2) return '';

		      const header = splitTableRow(lines[start]);
		      let colCount = header.length;
		      const separatorCount = countTableCells(lines[start + 1]);
		      if (separatorCount > colCount) colCount = separatorCount;
		      for (let i = start + 2; i < end; i++) {
		        const rowCount = countTableCells(lines[i]);
		        if (rowCount > colCount) colCount = rowCount;
		      }

		      const headerCells = renderTableCells(header, 'th', colCount);
		      let bodyRows = '';
		      for (let i = start + 2; i < end; i++) {
		        const row = splitTableRow(lines[i]);
		        bodyRows += '<tr>' + renderTableCells(row, 'td', colCount) + '</tr>';
		      }

      return '<div class="markdown-table-wrap" role="group" tabindex="0" data-scrollable="true" aria-label="Markdown table">' +
        '<table><thead><tr>' + headerCells + '</tr></thead><tbody>' + bodyRows + '</tbody></table>' +
        '</div>';
    }

	    function renderList(lines, type, startIndex, endIndex) {
	      if (!lines) return '';
	      const start = typeof startIndex === 'number' && startIndex > 0 ? startIndex : 0;
	      const end = typeof endIndex === 'number' && endIndex <= lines.length ? endIndex : lines.length;
	      const tag = type === 'ul' ? 'ul' : 'ol';
	      let current = null;
	      let liHtml = '';

	      function flushCurrent() {
	        if (!current) return;
	        liHtml += '<li>' + renderInlineMarkdown(current) + '</li>';
	      }

	      for (let i = start; i < end; i++) {
	        const line = String(lines[i] || '');
		        const match = tag === 'ol'
		          ? MARKDOWN_ORDERED_LIST_ITEM_RE.exec(line)
		          : MARKDOWN_BULLET_LIST_ITEM_RE.exec(line);

	        if (match) {
	          flushCurrent();
	          current = match[1] || '';
	          continue;
	        }

        const continuation = line.trim();
        if (current && continuation) {
          current += '\n' + continuation;
	        }
	      }

	      flushCurrent();

	      return '<' + tag + '>' + liHtml + '</' + tag + '>';
	    }

	    function renderParagraphs(lines, startIndex, endIndex) {
	      if (!lines) return '';
	      const start = typeof startIndex === 'number' && startIndex > 0 ? startIndex : 0;
	      const end = typeof endIndex === 'number' && endIndex <= lines.length ? endIndex : lines.length;
		      let html = '';
		      let current = '';

	      function flush() {
	        const text = current.trim();
	        if (text) html += '<p>' + renderInlineMarkdown(text) + '</p>';
	        current = '';
	      }

		      for (let i = start; i < end; i++) {
		        const line = String(lines[i] || '');
		        if (isMarkdownBlankLine(line)) {
		          flush();
		          continue;
	        }
	        current = current ? current + '\n' + line : line;
	      }

	      flush();

	      return html;
	    }

      const MARKDOWN_INLINE_CODE_RE = /`([^`]+)`/g;
      const MARKDOWN_INLINE_BOLD_RE = /\*\*([^*]+)\*\*/g;
      const MARKDOWN_INLINE_NEWLINE_RE = /\n/g;

      function renderInlineMarkdown(text) {
        if (!text) return '';

        // Escape first, then layer a minimal markdown subset on top.
        let escaped = escapeHtml(text);

        // Inline code: `code`
        if (escaped.indexOf('`') !== -1) {
          escaped = escaped.replace(MARKDOWN_INLINE_CODE_RE, (_m, code) => '<code>' + code + '</code>');
        }

        // Bold: **text**
        if (escaped.indexOf('**') !== -1) {
          escaped = escaped.replace(MARKDOWN_INLINE_BOLD_RE, '<strong>$1</strong>');
        }

        // Preserve newlines inside list items/paragraphs
        if (escaped.indexOf('\n') !== -1) {
          escaped = escaped.replace(MARKDOWN_INLINE_NEWLINE_RE, '<br>');
        }

        return escaped;
      }

      function postRenderedAction(message, failureMessage) {
        try {
          vscode.postMessage(message);
          return true;
        } catch {
          if (typeof showInputNotice === 'function') {
            showInputNotice(failureMessage || 'Failed to request action.');
          }
          try { syncInputState(); } catch {}
          return false;
        }
      }

	      function showRenderedActionNotice(message) {
	        if (typeof showInputNotice === 'function') {
	          showInputNotice(message || 'Action failed.');
	        }
	      }

				      const copyFeedbackTimers = new WeakMap();
				      const copyFeedbackButtonStates = new WeakMap();
				      const copyFeedbackResetStateByButton = new WeakMap();
				      const activeCopyFeedbackButtons = new Set();
				      const codeBlockCopyTextCache = new WeakMap();

		      function rememberCopyFeedbackResetState(button, resetText, resetAriaLabel) {
		        const existing = button ? copyFeedbackResetStateByButton.get(button) : null;
		        if (existing) return existing;
		        const state = {
		          text: String(resetText === undefined || resetText === null ? '' : resetText),
		          ariaLabel: String(resetAriaLabel === undefined || resetAriaLabel === null ? '' : resetAriaLabel),
		        };
		        if (button) copyFeedbackResetStateByButton.set(button, state);
		        return state;
		      }

			      function getCopyFeedbackResetState(button) {
			        const existing = button ? copyFeedbackResetStateByButton.get(button) : null;
			        if (existing) return existing;
			        return {
			          text: String(button ? button.textContent || '' : ''),
			          ariaLabel: '',
			        };
			      }

		      function resetCopyFeedbackButton(button) {
		        if (!button) return;
			        const resetState = getCopyFeedbackResetState(button);
		        const resetText = resetState.text;
		        const resetAriaLabel = resetState.ariaLabel;
		        setTextContent(button, resetText);
	        if (resetAriaLabel && button.setAttribute) {
	          setAttributeValue(button, 'aria-label', resetAriaLabel);
	        } else if (button.removeAttribute) {
	          if (!button.getAttribute || button.getAttribute('aria-label') !== null) {
	            button.removeAttribute('aria-label');
	          }
	        }
		        setClassPresence(button, 'copied', false);
		        copyFeedbackButtonStates.delete(button);
		      }

	      function clearAllCopyFeedbackTimers() {
	        for (const button of activeCopyFeedbackButtons) {
	          const timer = copyFeedbackTimers.get(button);
	          if (timer) clearTimeout(timer);
	          copyFeedbackTimers.delete(button);
	          resetCopyFeedbackButton(button);
	        }
	        activeCopyFeedbackButtons.clear();
	      }

		      function showCopyFeedback(button, copiedText, resetText, options) {
		        if (!button) return;
		        options = options || {};
			        if (!copyFeedbackResetStateByButton.get(button)) {
			          rememberCopyFeedbackResetState(
			            button,
			            resetText === undefined || resetText === null ? String(button.textContent || '') : resetText,
			            button.getAttribute ? String(button.getAttribute('aria-label') || '') : ''
			          );
			        }
		        const existing = copyFeedbackTimers.get(button);
		        if (existing) clearTimeout(existing);
		        const nextCopiedText = String(copiedText === undefined || copiedText === null ? '' : copiedText);
		        const nextAriaLabel = options.ariaLabel ? String(options.ariaLabel) : '';
		        const activeState = copyFeedbackButtonStates.get(button);
		        if (!activeState || activeState.text !== nextCopiedText || activeState.ariaLabel !== nextAriaLabel) {
		          copyFeedbackButtonStates.set(button, { text: nextCopiedText, ariaLabel: nextAriaLabel });
			          setTextContent(button, nextCopiedText);
			          if (nextAriaLabel && button.setAttribute) {
			            setAttributeValue(button, 'aria-label', nextAriaLabel);
			          }
			          setClassPresence(button, 'copied', true);
		        }
	        if (options.announcement && typeof announceStatus === 'function') {
	          announceStatus(String(options.announcement));
	        }
	        const timer = setTimeout(() => {
		          resetCopyFeedbackButton(button);
	          copyFeedbackTimers.delete(button);
	          activeCopyFeedbackButtons.delete(button);
	        }, 900);
	        copyFeedbackTimers.set(button, timer);
	        activeCopyFeedbackButtons.add(button);
	      }

		      function closestEventTarget(event, selector) {
		        const target = event && event.target;
		        return target && typeof target.closest === 'function' ? target.closest(selector) : null;
		      }

		      function getParentElement(el) {
		        const parent = el && (el.parentElement || el.parentNode);
		        return parent && parent.nodeType === 1 ? parent : null;
		      }

		      function getEventElementTarget(event) {
		        const target = event && event.target;
		        if (!target) return null;
		        if (target.nodeType === 1) return target;
		        return getParentElement(target);
		      }

			      function closestRenderedActionTarget(event) {
			        let el = getEventElementTarget(event);
			        while (el) {
			          if (getRenderedAction(el)) return el;
		          el = getParentElement(el);
		        }
			        return closestEventTarget(event, '[data-action]');
			      }

			      function isMarkdownCodeBlockElement(el) {
			        if (!el || el.nodeType !== 1) return false;
			        if (el.classList && typeof el.classList.contains === 'function') return el.classList.contains('markdown-code-block');
			        return (' ' + String(el.className || '') + ' ').indexOf(' markdown-code-block ') >= 0;
			      }

			      function findCodeBlockCopyElementFromLayout(actionEl) {
			        const blockEl = getParentElement(actionEl);
			        if (!isMarkdownCodeBlockElement(blockEl)) return null;
			        codeBlockByCopyButton.set(actionEl, blockEl);
			        return blockEl;
			      }

				      function isCodeElement(el) {
				        if (!el || el.nodeType !== 1) return false;
				        return String(el.localName || el.tagName || el.nodeName || '').toLowerCase() === 'code';
			      }

			      function findCodeBlockCodeElementFromLayout(blockEl) {
			        const children = blockEl && blockEl.children ? blockEl.children : null;
			        if (!children || children.length < 2) return null;
			        const preEl = children[1];
			        const preChildren = preEl && preEl.children ? preEl.children : null;
			        const codeEl = preChildren && preChildren.length > 0 ? preChildren[0] : null;
			        if (!isCodeElement(codeEl)) return null;
			        return codeEl;
			      }

			      function getCodeBlockCopyText(blockEl) {
			        if (!blockEl) return '';
			        const cached = codeBlockCopyTextCache.get(blockEl);
			        if (cached !== undefined) return cached;
			        const codeEl = findCodeBlockCodeElementFromLayout(blockEl) || (blockEl.querySelector ? blockEl.querySelector('code') : null);
			        const text = codeEl ? String(codeEl.textContent || '') : '';
			        codeBlockCopyTextCache.set(blockEl, text);
			        return text;
		      }

			      function focusRenderedControl(element) {
			        if (!element || typeof element.focus !== 'function') return false;
		        try {
		          element.focus({ preventScroll: true });
	        } catch {
	          try {
	            element.focus();
	          } catch {
	            return false;
	          }
	        }
		        return true;
		      }

		      function getAssistantCopyContentElement(msgEl) {
		        if (!msgEl) return null;
		        if (typeof getCachedMessageContentElement === 'function') {
		          return getCachedMessageContentElement(msgEl);
		        }
		        return msgEl.querySelector ? msgEl.querySelector('.message-content') : null;
		      }

		      function getRenderedMessageElementId(msgEl) {
		        if (!msgEl) return '';
		        if (typeof getMessageElementId === 'function') {
		          const id = getMessageElementId(msgEl);
		          if (id) return id;
		        }
		        return msgEl.dataset ? String(msgEl.dataset.id || '') : '';
		      }

			      const toolActionMessageByElement = new WeakMap();
			      const assistantActionMessageByElement = new WeakMap();
			      const compactionSummaryMessageByElement = new WeakMap();
			      const codeBlockByCopyButton = new WeakMap();
			      const planCancelPlanByButton = new WeakMap();
		      const planCancelConfirmByDismissButton = new WeakMap();
		      const planCancelTriggerByConfirm = new WeakMap();
		      const planCancelOpenByConfirm = new WeakMap();
				      const planCancelConfirmByPlan = new WeakMap();
			      const planCancelKeepButtonByConfirm = new WeakMap();

				      function findPlanCancelKeepButtonFromLayout(confirmEl) {
				        const children = confirmEl && confirmEl.children ? confirmEl.children : null;
				        if (!children || children.length < 2) return null;
			        const actions = children[1];
			        const actionChildren = actions && actions.children ? actions.children : null;
			        const keepButton = actionChildren && actionChildren.length > 0 ? actionChildren[0] : null;
			        if (getRenderedAction(keepButton) !== 'cancelPlanDismiss') return null;
			        planCancelKeepButtonByConfirm.set(confirmEl, keepButton);
				        return keepButton;
				      }

				      function isPlanCancelConfirmElement(el) {
				        if (!el || el.nodeType !== 1) return false;
				        if (el.classList && typeof el.classList.contains === 'function') return el.classList.contains('plan-cancel-confirm');
				        return (' ' + String(el.className || '') + ' ').indexOf(' plan-cancel-confirm ') >= 0;
				      }

				      function findPlanCancelConfirmFromLayout(planEl) {
				        const children = planEl && planEl.children ? planEl.children : null;
				        if (!children || children.length < 3) return null;
				        for (let i = 2; i < children.length; i++) {
				          const confirmEl = children[i];
				          if (!isPlanCancelConfirmElement(confirmEl)) continue;
				          planCancelConfirmByPlan.set(planEl, confirmEl);
				          return confirmEl;
				        }
				        return null;
				      }

			      function getCachedClosestElement(actionEl, selector, cache) {
			        if (!actionEl) return null;
			        const cachedElement = cache.get(actionEl);
		        if (cachedElement) {
		          let isCurrent = true;
		          if (typeof cachedElement.contains === 'function') {
		            isCurrent = cachedElement.contains(actionEl);
		          } else if (typeof actionEl.closest === 'function') {
		            isCurrent = actionEl.closest(selector) === cachedElement;
		          }
		          if (isCurrent) return cachedElement;
		          cache.delete(actionEl);
		        }
		        const element = actionEl.closest ? actionEl.closest(selector) : null;
			        if (element) cache.set(actionEl, element);
			        return element;
			      }

		      function getContainedCachedElement(actionEl, cache) {
		        if (!actionEl) return null;
		        const cachedElement = cache.get(actionEl);
		        if (!cachedElement) return null;
		        if (typeof cachedElement.contains !== 'function') return null;
		        if (cachedElement.contains(actionEl)) return cachedElement;
		        cache.delete(actionEl);
		        return null;
		      }

				      function hasRenderedElementClass(el, className) {
				        if (!el || el.nodeType !== 1) return false;
				        if (el.classList && typeof el.classList.contains === 'function') return el.classList.contains(className);
				        return (' ' + String(el.className || '') + ' ').indexOf(' ' + className + ' ') >= 0;
				      }

				      function findAssistantActionMessageElementFromLayout(actionEl) {
				        const actionsEl = getParentElement(actionEl);
				        if (!hasRenderedElementClass(actionsEl, 'message-actions')) return null;
				        const bubbleEl = getParentElement(actionsEl);
				        if (!hasRenderedElementClass(bubbleEl, 'message-bubble')) return null;
				        const messageEl = getParentElement(bubbleEl);
				        if (!hasRenderedElementClass(messageEl, 'message') || !hasRenderedElementClass(messageEl, 'assistant')) return null;
				        assistantActionMessageByElement.set(actionEl, messageEl);
				        return messageEl;
				      }

					      function findCompactionSummaryMessageElementFromLayout(actionEl) {
					        const actionsEl = getParentElement(actionEl);
					        if (!hasRenderedElementClass(actionsEl, 'operation-actions')) return null;
					        const bodyEl = getParentElement(actionsEl);
					        if (!hasRenderedElementClass(bodyEl, 'operation-body')) return null;
					        const messageEl = getParentElement(bodyEl);
					        if (!hasRenderedElementClass(messageEl, 'operation-card')) return null;
					        compactionSummaryMessageByElement.set(actionEl, messageEl);
					        return messageEl;
					      }

					      function findPlanCancelDismissConfirmFromLayout(actionEl) {
					        const actionsEl = getParentElement(actionEl);
					        if (!hasRenderedElementClass(actionsEl, 'plan-cancel-confirm-actions')) return null;
					        const confirmEl = getParentElement(actionsEl);
					        if (!isPlanCancelConfirmElement(confirmEl)) return null;
					        planCancelConfirmByDismissButton.set(actionEl, confirmEl);
					        return confirmEl;
					      }

					      function findPlanCancelActionPlanFromLayout(actionEl) {
					        const actionsEl = getParentElement(actionEl);
					        if (!hasRenderedElementClass(actionsEl, 'plan-actions')) return null;
					        const planEl = getParentElement(actionsEl);
					        if (!hasRenderedElementClass(planEl, 'message') || !hasRenderedElementClass(planEl, 'plan')) return null;
					        planCancelPlanByButton.set(actionEl, planEl);
					        return planEl;
					      }

				      function findToolActionMessageElementFromLayout(actionEl) {
				        let el = getParentElement(actionEl);
				        for (let depth = 0; el && depth < 8; depth++) {
				          if (hasRenderedElementClass(el, 'tool-card')) {
				            const messageEl = getParentElement(el);
				            if (!hasRenderedElementClass(messageEl, 'tool-message')) return null;
				            toolActionMessageByElement.set(actionEl, messageEl);
				            return messageEl;
				          }
				          el = getParentElement(el);
				        }
				        return null;
				      }

					      function getToolActionMessageElement(actionEl) {
					        const cachedMessage = getContainedCachedElement(actionEl, toolActionMessageByElement);
					        if (cachedMessage) return cachedMessage;
					        const layoutMessage = findToolActionMessageElementFromLayout(actionEl);
					        if (layoutMessage) return layoutMessage;
					        return getCachedClosestElement(actionEl, '.tool-message', toolActionMessageByElement);
					      }

				      function getAssistantActionMessageElement(actionEl) {
				        const cachedMessage = getContainedCachedElement(actionEl, assistantActionMessageByElement);
				        if (cachedMessage) return cachedMessage;
				        const layoutMessage = findAssistantActionMessageElementFromLayout(actionEl);
				        if (layoutMessage) return layoutMessage;
				        return getCachedClosestElement(actionEl, '.message.assistant', assistantActionMessageByElement);
				      }

				      function getCompactionSummaryMessageElement(actionEl) {
				        const cachedMessage = getContainedCachedElement(actionEl, compactionSummaryMessageByElement);
				        if (cachedMessage) return cachedMessage;
				        const layoutMessage = findCompactionSummaryMessageElementFromLayout(actionEl);
				        if (layoutMessage) return layoutMessage;
				        return getCachedClosestElement(actionEl, '.operation-card', compactionSummaryMessageByElement);
				      }

				      function getCodeBlockCopyElement(actionEl) {
				        const cachedBlock = getContainedCachedElement(actionEl, codeBlockByCopyButton);
				        if (cachedBlock) return cachedBlock;
				        const layoutBlock = findCodeBlockCopyElementFromLayout(actionEl);
				        if (layoutBlock) return layoutBlock;
				        return getCachedClosestElement(actionEl, '.markdown-code-block', codeBlockByCopyButton);
				      }

			      function getPlanCancelDismissConfirm(actionEl) {
			        const cachedConfirm = getContainedCachedElement(actionEl, planCancelConfirmByDismissButton);
			        if (cachedConfirm) return cachedConfirm;
			        const layoutConfirm = findPlanCancelDismissConfirmFromLayout(actionEl);
			        if (layoutConfirm) return layoutConfirm;
			        return getCachedClosestElement(actionEl, '.plan-cancel-confirm', planCancelConfirmByDismissButton);
			      }

			      function getPlanCancelActionPlan(actionEl) {
			        const cachedPlan = getContainedCachedElement(actionEl, planCancelPlanByButton);
			        if (cachedPlan) return cachedPlan;
			        const layoutPlan = findPlanCancelActionPlanFromLayout(actionEl);
			        if (layoutPlan) return layoutPlan;
			        return getCachedClosestElement(actionEl, '.message.plan', planCancelPlanByButton);
			      }

		      function isPlanCancelConfirmOpen(confirmEl) {
		        const cachedOpen = planCancelOpenByConfirm.get(confirmEl);
		        if (cachedOpen === true || cachedOpen === false) return cachedOpen;
		        // Plan cancellation confirmations are rendered hidden; after the first interaction the WeakMap is authoritative.
		        planCancelOpenByConfirm.set(confirmEl, false);
		        return false;
		      }

			      function getPlanCancelKeepButton(confirmEl) {
			        if (!confirmEl) return null;
			        const cachedButton = planCancelKeepButtonByConfirm.get(confirmEl);
			        if (cachedButton) {
			          if (typeof confirmEl.contains !== 'function' || confirmEl.contains(cachedButton)) return cachedButton;
			          planCancelKeepButtonByConfirm.delete(confirmEl);
			        }
			        const layoutButton = findPlanCancelKeepButtonFromLayout(confirmEl);
			        if (layoutButton) return layoutButton;
			        const keepButton = confirmEl.querySelector ? confirmEl.querySelector('[data-action="cancelPlanDismiss"]') : null;
			        if (keepButton) planCancelKeepButtonByConfirm.set(confirmEl, keepButton);
			        return keepButton;
		      }

		      function getPlanCancelConfirm(planEl) {
		        if (!planEl) return null;
		        const cachedConfirm = planCancelConfirmByPlan.get(planEl);
		        if (cachedConfirm) {
		          let isCurrent = true;
		          if (typeof planEl.contains === 'function') {
		            isCurrent = planEl.contains(cachedConfirm);
		          } else if (typeof cachedConfirm.closest === 'function') {
		            isCurrent = cachedConfirm.closest('.message.plan') === planEl;
		          }
			          if (isCurrent) return cachedConfirm;
			          planCancelConfirmByPlan.delete(planEl);
			        }
			        const layoutConfirm = findPlanCancelConfirmFromLayout(planEl);
			        if (layoutConfirm) return layoutConfirm;
			        const confirmEl = planEl.querySelector ? planEl.querySelector('.plan-cancel-confirm') : null;
			        if (confirmEl) planCancelConfirmByPlan.set(planEl, confirmEl);
			        return confirmEl;
		      }

			      function setPlanCancelConfirmOpen(confirmEl, open, trigger) {
			        if (!confirmEl) return;
			        const nextOpen = !!open;
			        const wasOpen = isPlanCancelConfirmOpen(confirmEl);
			        const cachedTrigger = planCancelTriggerByConfirm.get(confirmEl) || null;
			        if (nextOpen && wasOpen && cachedTrigger && (!trigger || trigger === cachedTrigger)) return;
			        if (!nextOpen && !wasOpen) return;
			        if (nextOpen !== wasOpen) {
			          confirmEl.classList.toggle('hidden', !nextOpen);
			          planCancelOpenByConfirm.set(confirmEl, nextOpen);
			        }
	        const cancelTrigger = trigger || cachedTrigger;
	        if (cancelTrigger) {
	          if (nextOpen) planCancelTriggerByConfirm.set(confirmEl, cancelTrigger);
	          setAttributeValue(cancelTrigger, 'aria-expanded', nextOpen ? 'true' : 'false');
	        }
	        if (nextOpen && !wasOpen) {
	          focusRenderedControl(getPlanCancelKeepButton(confirmEl));
	        } else if (!nextOpen && wasOpen) {
	          focusRenderedControl(cancelTrigger);
	        }
	        if (!nextOpen && cachedTrigger && cachedTrigger === cancelTrigger) {
	          planCancelTriggerByConfirm.delete(confirmEl);
	        }
	      }

      document.addEventListener('click', (e) => {
        const actionTarget = closestRenderedActionTarget(e);
        if (!actionTarget) return;
        const action = getRenderedAction(actionTarget);

	        if (action === 'openLocation') {
	          const locationBtn = actionTarget;
	          const location = getOpenLocationPayload(locationBtn);
	          if (location) {
	            postRenderedAction(
	              { type: 'openLocation', filePath: location.filePath, line: location.line, character: location.character },
	              'Failed to request location open.'
	            );
	          }
          return;
        }

	        if (action === 'viewCompactionSummary') {
	          const compactionBtn = actionTarget;
	          const msgEl = getCompactionSummaryMessageElement(compactionBtn);
	          const msgId = getRenderedMessageElementId(msgEl);
          const msg = msgId ? messageDataById.get(msgId) : null;
          const op = msg && msg.operation ? msg.operation : null;
          const summaryText = op && typeof op.summaryText === 'string' ? op.summaryText : '';
          if (hasNonWhitespaceText(summaryText)) {
            const auto = !!op.auto;
            const truncated = !!op.summaryTruncated;
            let title = auto ? 'Compaction summary (auto)' : 'Compaction summary';
            if (truncated) title += ' (truncated)';
            openOutputModal(title, summaryText);
          }
          return;
        }

        if (action === 'openFullOutput') {
          const outputToggle = actionTarget;
          const msgEl = getToolActionMessageElement(outputToggle);
          const msgId = getRenderedMessageElementId(msgEl);
          const msg = msgId ? messageDataById.get(msgId) : null;
	          const resultText = msg && msg.toolCall ? getToolResultText(msg.toolCall) : '';
	          if (resultText) {
	            const title = getToolModalTitle(msg.toolCall);
	            openOutputModal(title, resultText);
	          }
          return;
        }

        if (action === 'openNativeDiff') {
          const nativeDiffToggle = actionTarget;
          const msgEl = getToolActionMessageElement(nativeDiffToggle);
          const msgId = getRenderedMessageElementId(msgEl);
          const msg = msgId ? messageDataById.get(msgId) : null;
          const toolCallId = msg && msg.toolCall && msg.toolCall.approvalId ? msg.toolCall.approvalId : '';
          if (toolCallId) {
            postRenderedAction(
              { type: 'openNativeDiff', toolCallId },
              'Failed to request diff editor.'
            );
          }
          return;
        }

        if (action === 'openFullDiff') {
          const diffToggle = actionTarget;
          const msgEl = getToolActionMessageElement(diffToggle);
          const msgId = getRenderedMessageElementId(msgEl);
          const msg = msgId ? messageDataById.get(msgId) : null;
          if (msg && msg.toolCall && msg.toolCall.diff) {
            const title = getToolModalTitle(msg.toolCall) + ' (diff)';
            openOutputModal(title, msg.toolCall.diff);
          }
          return;
        }

        if (action === 'copyToolOutput') {
          const copyBtn = actionTarget;
          const msgEl = getToolActionMessageElement(copyBtn);
          const msgId = getRenderedMessageElementId(msgEl);
          const msg = msgId ? messageDataById.get(msgId) : null;
	          const text = msg && msg.toolCall ? getToolResultText(msg.toolCall) : '';
          if (text) {
            writeClipboard(text).then((ok) => {
              if (!ok) {
                showRenderedActionNotice('Failed to copy tool output.');
                return;
              }
              showCopyFeedback(copyBtn, 'Copied', 'Copy', {
                ariaLabel: 'Copied tool output',
                announcement: 'Copied tool output.'
              });
            });
          } else {
            showRenderedActionNotice('No tool output to copy.');
          }
          return;
        }

	        if (action === 'copyCodeBlock') {
	          const codeCopyBtn = actionTarget;
	          const blockEl = getCodeBlockCopyElement(codeCopyBtn);
	          const text = getCodeBlockCopyText(blockEl);
	          if (!text) {
	            showRenderedActionNotice('No code block to copy.');
            return;
          }

		          const original = getCopyFeedbackResetState(codeCopyBtn).text;
          writeClipboard(text).then((ok) => {
            if (!ok) {
              showRenderedActionNotice('Failed to copy code block.');
              return;
            }
            showCopyFeedback(codeCopyBtn, 'Copied', original, {
              ariaLabel: 'Copied code block',
              announcement: 'Copied code block.'
            });
          });
          return;
        }

	        if (action === 'copyAssistantMarkdown' || action === 'copyAssistantHtml') {
          const assistantCopyBtn = actionTarget;
          const msgEl = getAssistantActionMessageElement(assistantCopyBtn);
          const msgId = getRenderedMessageElementId(msgEl);
          const msg = msgId ? messageDataById.get(msgId) : null;
			          const original = getCopyFeedbackResetState(assistantCopyBtn).text;
          const finishCopy = (ok) => {
            if (!ok) {
              const format = action === 'copyAssistantHtml' ? 'HTML' : 'Markdown';
              showRenderedActionNotice('Failed to copy assistant ' + format + '.');
              return;
            }
            const copiedLabel = action === 'copyAssistantHtml'
              ? 'Copied assistant HTML'
              : 'Copied assistant Markdown';
            showCopyFeedback(assistantCopyBtn, '✓', original, {
              ariaLabel: copiedLabel,
              announcement: copiedLabel + '.'
            });
	          };

	          if (action === 'copyAssistantHtml') {
	            const contentEl = getAssistantCopyContentElement(msgEl);
	            if (!contentEl) return;
	            const html = contentEl.innerHTML || '';
	            const plain = contentEl.textContent || '';
	            writeClipboardHtml(html, plain).then(finishCopy);
		          } else {
		            let markdown = msg ? getMessageTextContent(msg.content, '') : '';
		            if (!markdown) {
			              const contentEl = getAssistantCopyContentElement(msgEl);
			              if (!contentEl) return;
		              markdown = typeof getAssistantMarkdownRaw === 'function' ? getAssistantMarkdownRaw(contentEl) : '';
		            }
            writeClipboard(markdown).then(finishCopy);
          }
          return;
        }

        if (
          action === 'executePlan' ||
          action === 'cancelPlan' ||
          action === 'cancelPlanDismiss' ||
          action === 'cancelPlanConfirm' ||
          action === 'revisePlan'
        ) {
          const planBtn = actionTarget;
          const planMessageId = getPlanActionMessageId(planBtn);
          if (!action || !planMessageId) return;

	          if (action === 'executePlan') {
            postRenderedAction(
              { type: 'executePlan', planMessageId },
              'Failed to request plan execution.'
            );
	          } else if (action === 'cancelPlan') {
	            const planEl = getPlanCancelActionPlan(planBtn);
	            const confirmEl = getPlanCancelConfirm(planEl);
	            setPlanCancelConfirmOpen(confirmEl, true, planBtn);
	          } else if (action === 'cancelPlanDismiss') {
	            const confirmEl = getPlanCancelDismissConfirm(planBtn);
	            setPlanCancelConfirmOpen(confirmEl, false, null);
          } else if (action === 'cancelPlanConfirm') {
            postRenderedAction(
              { type: 'cancelPlan', planMessageId, confirmed: true },
              'Failed to request plan cancellation.'
            );
          } else if (action === 'revisePlan') {
            const instructions = input && typeof input.value === 'string' ? input.value.trim() : '';
            if (instructions) {
              const posted = postRenderedAction(
                { type: 'revisePlan', planMessageId, instructions },
                'Failed to request plan revision.'
              );
              if (posted) {
                try { addToInputHistory(instructions); } catch {}
                if (input) input.value = '';
              }
            } else if (input) {
              input.placeholder = 'Type plan revisions or answer questions, then press Enter or click Revise again…';
              focusComposerInput();
            }
            try { updateInputLayout(); } catch {}
            try { syncInputState(); } catch {}
            try { closeSkillDropdown(); } catch {}
          }
          return;
        }

        if (action !== 'approve' && action !== 'always' && action !== 'reject' && action !== 'retryTool') return;

        const btn = actionTarget;
        const approvalId = getToolActionApprovalId(btn);

        if (action === 'approve') {
          postRenderedAction(
            { type: 'approveToolCall', approvalId },
            'Failed to request tool approval.'
          );
        } else if (action === 'always') {
          postRenderedAction(
            { type: 'alwaysAllowTool', approvalId },
            'Failed to request always-allow approval.'
          );
        } else if (action === 'reject') {
          postRenderedAction(
            { type: 'rejectToolCall', approvalId },
            'Failed to request tool rejection.'
          );
        } else if (action === 'retryTool') {
          postRenderedAction(
            { type: 'retryTool', approvalId },
            'Failed to request tool retry.'
          );
        }
      });
