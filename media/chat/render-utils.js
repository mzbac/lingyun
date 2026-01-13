    function truncateText(text, maxLen) {
      return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
    }

    function formatFilePath(path) {
      if (!path) return '';
      return String(path);
    }

    function renderDiffLines(diff, maxLines) {
      if (!diff) return '';
      const lines = String(diff).split(/\\r?\\n/);
      const limit = typeof maxLines === 'number' && maxLines > 0 ? maxLines : 30;
      const displayLines = lines.slice(0, limit);
      const remaining = Math.max(0, lines.length - limit);

      let html = '<div class="tool-diff">';
      displayLines.forEach(line => {
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
      });
      if (remaining > 0) {
        html += '<div class="tool-diff-footer">';
        html += '<div class="tool-more">… (' + remaining + ' more lines)</div>';
        html += '<div class="tool-diff-actions">';
        html += '<button class="tool-diff-action" type="button" data-action="openNativeDiff">Open diff</button>';
        html += '<button class="tool-diff-action secondary" type="button" data-action="openFullDiff">Text diff</button>';
        html += '</div>';
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    function renderDiffViewer(toolCall) {
      const diffView = toolCall && toolCall.diffView ? toolCall.diffView : null;
      const diff = toolCall && typeof toolCall.diff === 'string' ? toolCall.diff : '';
      const truncated = !!(toolCall && toolCall.diffTruncated);
      const filePath = toolCall && typeof toolCall.path === 'string' ? toolCall.path : '';

      if (!diffView || !diffView.files || !diffView.files.length) {
        // Fallback to legacy rendering (still supports openFullDiff modal).
        return renderDiffLines(diff, 30);
      }

      const files = Array.isArray(diffView.files) ? diffView.files : [];
      if (!files.length) return renderDiffLines(diff, 30);

      let html = '<div class="tool-diff-viewer">';

      for (let f = 0; f < files.length; f++) {
        const file = files[f] || {};
        const displayPath = typeof file.filePath === 'string' && file.filePath.trim() ? file.filePath.trim() : filePath;
        const hunks = Array.isArray(file.hunks) ? file.hunks : [];

        if (displayPath) {
          html += '<div class="tool-diff-file-header" title="' + escapeHtml(displayPath) + '">' + escapeHtml(displayPath) + '</div>';
        }

        html += '<div class="tool-diff-scroll">';

        for (let h = 0; h < hunks.length; h++) {
          const hunk = hunks[h] || {};
          const header = typeof hunk.header === 'string' ? hunk.header : '';
          const lines = Array.isArray(hunk.lines) ? hunk.lines : [];

          if (header) {
            html += '<div class="tool-diff-hunk-header">' + escapeHtml(header) + '</div>';
          }

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] || {};
            const kind = line.kind || 'ctx';
            const oldLine = Number.isFinite(line.oldLine) ? Number(line.oldLine) : 0;
            const newLine = Number.isFinite(line.newLine) ? Number(line.newLine) : 0;
            const text = typeof line.text === 'string' ? line.text : '';

            const rowClass =
              kind === 'add' ? 'add' :
              kind === 'del' ? 'del' :
              kind === 'meta' ? 'meta' : 'ctx';

            const sign =
              kind === 'add' ? '+' :
              kind === 'del' ? '-' :
              kind === 'meta' ? '' : ' ';

            const openLine = newLine || oldLine;
            const openAttrs =
              displayPath && openLine
                ? ' data-action="openLocation" data-path="' + escapeHtml(displayPath) + '" data-line="' + String(openLine) + '" data-character="1"'
                : '';

            html += '<div class="tool-diff-row ' + rowClass + '">';

            if (oldLine) {
              html += '<span class="tool-diff-ln old">' + escapeHtml(String(oldLine)) + '</span>';
            } else {
              html += '<span class="tool-diff-ln old"></span>';
            }

            if (newLine) {
              html += '<button type="button" class="tool-diff-ln new"' + openAttrs + ' title="Open at line ' + escapeHtml(String(openLine)) + '">' + escapeHtml(String(newLine)) + '</button>';
            } else {
              html += '<span class="tool-diff-ln new"></span>';
            }

            html += '<span class="tool-diff-sign">' + escapeHtml(sign) + '</span>';
            html += '<span class="tool-diff-code">' + escapeHtml(text) + '</span>';
            html += '</div>';
          }
        }

        html += '</div>';
      }

      if (truncated) {
        html += '<div class="tool-diff-footer">';
        html += '<div class="tool-more">Diff truncated</div>';
        html += '<div class="tool-diff-actions">';
        html += '<button class="tool-diff-action" type="button" data-action="openNativeDiff">Open diff</button>';
        html += '<button class="tool-diff-action secondary" type="button" data-action="openFullDiff">Text diff</button>';
        html += '</div>';
        html += '</div>';
      } else if (diff && diff.length > 0) {
        html += '<div class="tool-diff-footer">';
        html += '<div class="tool-more"></div>';
        html += '<div class="tool-diff-actions">';
        html += '<button class="tool-diff-action" type="button" data-action="openNativeDiff">Open diff</button>';
        html += '<button class="tool-diff-action secondary" type="button" data-action="openFullDiff">Text diff</button>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    function renderOutputPreview(text, maxLines) {
      if (!text) return '';
      const fullText = String(text);
      const lines = fullText.split('\\n');
      const displayLines = lines.slice(0, maxLines);
      const remaining = lines.length - maxLines;
      const truncated = remaining > 0;
      let out = displayLines.join('\\n');
      if (truncated) out += '\\n… (' + remaining + ' more lines)';

      const showExpand = truncated || lines.length > 8 || fullText.length > 400;

      let html = '<div class="tool-output">';
      html += '<button class="copy-btn" type="button" data-action="copyToolOutput">Copy</button>';
      html += escapeHtml(out);
      if (showExpand) {
        html += '<div class="tool-output-toggle" data-action="openFullOutput">View full output</div>';
      }
      html += '</div>';
      return html;
    }

    function extractArgValue(raw, key) {
      if (!raw || !key) return '';

      try {
        const jsonRe = new RegExp('\"' + key + '\"\\\\s*:\\\\s*\"([^\"]+)\"');
        const jsonMatch = raw.match(jsonRe);
        if (jsonMatch && jsonMatch[1]) return jsonMatch[1];
      } catch {}

      const flagRe = new RegExp("--" + key + "\\s+((\\\"[^\\\"]+\\\")|('[^']+')|([^\\s]+))");
      const flagMatch = raw.match(flagRe);
      if (flagMatch) {
        const value = flagMatch[2] || flagMatch[3] || flagMatch[4] || '';
        return value.replace(/^['"]|['"]$/g, '');
      }

      const kvRe = new RegExp(key + "\\s*(?:=>|:)\\s*((\\\"[^\\\"]+\\\")|('[^']+')|([^\\s,}]+))");
      const kvMatch = raw.match(kvRe);
      if (kvMatch) {
        const value = kvMatch[2] || kvMatch[3] || kvMatch[4] || '';
        return value.replace(/^['"]|['"]$/g, '');
      }

      return '';
    }

    function formatToolSummary(toolCall) {
      const toolId = toolCall.id || '';
      let icon = toolIcons[toolId];
      if (!icon) {
        if (toolId.startsWith('kb.') || toolId.includes('search') || toolId.includes('knowledge')) icon = '🧠';
        else if (toolId.startsWith('workspace.')) icon = '🔧';
        else icon = '🔧';
      }

      let args = {};
      const rawArgsText = typeof toolCall.args === 'string' ? toolCall.args : '';
      try { args = JSON.parse(rawArgsText || '{}'); } catch {}
      if (!args.command && rawArgsText) {
        const extracted = extractArgValue(rawArgsText, 'command');
        if (extracted) args.command = extracted;
      }
      if (!args.filePath && rawArgsText) {
        const extracted = extractArgValue(rawArgsText, 'filePath');
        if (extracted) args.filePath = extracted;
      }
      if (!args.path && rawArgsText) {
        const extracted = extractArgValue(rawArgsText, 'path');
        if (extracted) args.path = extracted;
      }
      if (!args.pattern && rawArgsText) {
        const extracted = extractArgValue(rawArgsText, 'pattern');
        if (extracted) args.pattern = extracted;
      }
      if (!args.query && rawArgsText) {
        const extracted = extractArgValue(rawArgsText, 'query');
        if (extracted) args.query = extracted;
      }

      const path = toolCall.path || args.filePath || args.path || '';
      const diff = toolCall.diff || '';
      const diffStats = toolCall.diffStats || null;
      const diffTruncated = !!toolCall.diffTruncated;
      const diffUnavailableReason = toolCall.diffUnavailableReason || '';
      const batchFiles = toolCall.batchFiles || [];
      const additionalCount = toolCall.additionalCount || 0;
      const todosRaw = toolCall.todos;

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

      function renderTodoList(items) {
        const list = Array.isArray(items) ? items : [];
        if (list.length === 0) return '';

        let html = '<div class="tool-todos">';
        for (const t of list) {
          if (!t || typeof t !== 'object') continue;
          const content = typeof t.content === 'string' ? t.content : '';
          if (!content.trim()) continue;
          const status = normalizeTodoStatus(typeof t.status === 'string' ? t.status : 'pending');
          const priority = normalizeTodoPriority(typeof t.priority === 'string' ? t.priority : 'medium');

          html += '<div class="todo-item ' + escapeHtml(status) + (status === 'completed' ? ' completed' : '') + '">';
          html += '<div class="todo-icon">' + escapeHtml(todoStatusIcon(status)) + '</div>';
          html += '<div class="todo-content">' + escapeHtml(content) + '</div>';
          html += '<div class="todo-meta">';
          html += '<div class="todo-pill">' + escapeHtml(status === 'in_progress' ? 'in progress' : status) + '</div>';
          html += '<div class="todo-pill ' + escapeHtml(priority) + '">' + escapeHtml(priority) + '</div>';
          html += '</div>';
          html += '</div>';
        }
        html += '</div>';
        return html;
      }

      if (batchFiles.length > 0) {
        const totalCount = batchFiles.length + additionalCount;
        const toolName =
          (toolId === 'read' || toolId === 'file.read') ? 'Read Files' :
          (toolId === 'glob' || toolId === 'file.list') ? 'List Files' :
          (toolId === 'write' || toolId === 'edit' || toolId === 'file.write') ? 'Edit Files' : 'Files';
        const title = (toolId === 'glob' || toolId === 'file.list') && args.pattern
          ? ('Glob ' + truncateText(args.pattern, 50))
          : toolName;
        const maxFilesToShow = 10;
        let html = '<div class="tool-batch">';
        html += '<div class="tool-header"><span class="tool-name" title="' + escapeHtml(title) + '">' + icon + ' ' + escapeHtml(title) + ' (' + totalCount + ')</span></div>';
        html += '<div class="tool-file-list">';
        batchFiles.slice(0, maxFilesToShow).forEach(file => {
          const full = String(file || '');
          const display = formatFilePath(full);
          html += '<div class="tool-file-item" title="' + escapeHtml(full) + '">- ' + escapeHtml(display) + '</div>';
        });
        if (batchFiles.length > maxFilesToShow || additionalCount > 0) {
          const moreCount = (batchFiles.length - maxFilesToShow) + additionalCount;
          if (moreCount > 0) html += '<div class="tool-more">… and ' + moreCount + ' more</div>';
        }
        html += '</div></div>';
        return html;
      }

      let headerText = '';
      let showDiff = false;

      if (toolId === 'read' || toolId === 'file.read') {
        headerText = 'Read File';
      } else if (toolId === 'todowrite') {
        headerText = 'Todos';
        icon = '☑';
      } else if (toolId === 'todoread') {
        headerText = 'Todos';
        icon = '☑';
      } else if (toolId === 'lsp') {
        const op = args.operation ? String(args.operation) : '';
        headerText = op ? ('LSP ' + op) : 'LSP';
        if (args.query) headerText += ' "' + truncateText(String(args.query), 30) + '"';
        if (path) headerText += ': ' + formatFilePath(path);
      } else if (
        toolId === 'write' ||
        toolId === 'edit' ||
        toolId === 'patch' ||
        toolId === 'multiedit' ||
        toolId === 'file.write' ||
        toolId === 'file.edit' ||
        toolId === 'file.patch' ||
        toolId === 'file.multiedit'
      ) {
        if (toolId === 'patch') {
          headerText = 'Apply Patch';
        } else {
        headerText = path ? 'Edit: ' + formatFilePath(path) : 'Edit File';
        icon = '±';
        showDiff = !!diff;
        }
      } else if (toolId === 'glob' || toolId === 'file.list') {
        headerText = args.pattern
          ? ('Glob ' + truncateText(args.pattern, 50))
          : (path ? 'List ' + formatFilePath(path) : 'List Files');
      } else if (toolId === 'list') {
        headerText = path ? 'List ' + formatFilePath(path) : 'List Files';
      } else if (toolId === 'grep' || toolId === 'file.search') {
        const p = args.pattern || args.query;
        headerText = p ? 'Grep "' + truncateText(p, 30) + '"' : 'Grep';
      } else if (toolId === 'bash' || toolId === 'shell.run') {
        headerText = args.description
          ? truncateText(args.description, 60)
          : (args.command ? 'Run: ' + truncateText(args.command, 40) : 'Run');
      } else if (toolId === 'shell.terminal') {
        headerText = args.command ? 'Run: ' + truncateText(args.command, 40) : 'Run';
      } else if (toolId === 'shell.which') {
        headerText = args.command ? 'Which: ' + truncateText(args.command, 40) : 'Which Command';
      } else if (args.query && (toolId.includes('search') || toolId.startsWith('kb.'))) {
        headerText = 'Search "' + truncateText(args.query, 30) + '"';
      } else {
        headerText = toolCall.name || toolId;
        if (path) headerText += ': ' + formatFilePath(path);
      }

      if (toolCall.status === 'running') headerText += '…';
      if (toolCall.status === 'rejected') headerText = '✗ ' + headerText;
      if (toolCall.status === 'error') headerText = '✗ ' + headerText;

      if (toolCall.status === 'pending' && toolCall.approvalId) {
        let html = '<div class="tool-card pending">';
        html += '<div class="tool-header"><span class="tool-name" title="' + escapeHtml(headerText) + '">' + icon + ' ' + escapeHtml(headerText) + '</span></div>';
        if (path && (toolId === 'read' || toolId === 'file.read')) {
          const title = escapeHtml(path);
          const label = escapeHtml(formatFilePath(path));
          html += '<div class="tool-path" title="' + title + '">' + label + '</div>';
        }
        if (toolId === 'bash' || toolId === 'shell.terminal' || toolId === 'shell.run') {
          const preview = args.command || rawArgsText;
          if (preview) html += renderOutputPreview(preview, 6);
        }
        html += '<div class="tool-actions">' +
          '<button class="tool-btn approve" data-action="approve" data-approval="' + escapeHtml(toolCall.approvalId) + '">Allow</button>' +
          '<button class="tool-btn always" data-action="always" data-approval="' + escapeHtml(toolCall.approvalId) + '" data-tool="' + escapeHtml(toolId) + '">Always</button>' +
          '<button class="tool-btn reject" data-action="reject" data-approval="' + escapeHtml(toolCall.approvalId) + '">Deny</button>' +
        '</div>';
        html += '</div>';
        return html;
      }

      let html = '<div class="tool-card ' + toolCall.status + '">';
      html += '<div class="tool-header"><span class="tool-name" title="' + escapeHtml(headerText) + '">' + icon + ' ' + escapeHtml(headerText) + '</span>';

      if (diffStats && (typeof diffStats.additions === 'number' || typeof diffStats.deletions === 'number')) {
        const additions = Number(diffStats.additions || 0);
        const deletions = Number(diffStats.deletions || 0);
        if (additions > 0) html += '<span class="tool-badge add">+' + escapeHtml(String(additions)) + '</span>';
        if (deletions > 0) html += '<span class="tool-badge del">-' + escapeHtml(String(deletions)) + '</span>';
      }
      if (diffTruncated) {
        html += '<span class="tool-badge info" title="Diff was truncated for display/storage">truncated</span>';
      }

      html += '</div>';

      if (path && (toolId === 'read' || toolId === 'file.read')) {
        const title = escapeHtml(path);
        const label = escapeHtml(formatFilePath(path));
        if (toolCall.status === 'success') {
          html +=
            '<div class="tool-path" title="' + title + '">' +
            '<button type="button" class="file-link-token file-link" data-action="openLocation" data-path="' +
            title +
            '" data-line="1" data-character="1">' +
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
        html += toolCall.diffView ? renderDiffViewer(toolCall) : renderDiffLines(diff, 30);
      } else if (diffUnavailableReason) {
        html += '<div class="tool-note">' + escapeHtml(String(diffUnavailableReason)) + '</div>';
      }

      if (toolCall.status === 'success' && toolId === 'lsp' && toolCall.lsp) {
        html += renderLspResults(toolCall.lsp);
      } else if (toolCall.status === 'success' && toolCall.result) {
        if (toolId !== 'todowrite' && toolId !== 'todoread') {
          if (toolId === 'glob' || toolId === 'file.list') html += renderOutputPreview(toolCall.result, 10);
          else if (toolId === 'grep' || toolId === 'file.search') html += renderOutputPreview(toolCall.result, 12);
          else if (toolId === 'bash' || toolId === 'shell.run') html += renderOutputPreview(toolCall.result, 12);
          else if (toolId === 'list') html += renderOutputPreview(toolCall.result, 12);
          else if (toolId === 'shell.terminal') html += renderOutputPreview(toolCall.result, 6);
          else if (toolId === 'shell.which') html += renderOutputPreview(toolCall.result, 4);
          else if (toolId.startsWith('kb.')) html += renderOutputPreview(toolCall.result, 12);
          else html += renderOutputPreview(toolCall.result, 12);
        }
      }

      if (toolCall.status === 'success' && (toolId === 'write' || toolId === 'edit' || toolId === 'file.write' || toolId.includes('edit'))) {
        html += '<div class="tool-success">✓ Done</div>';
      }

      if (toolCall.status === 'error' && toolCall.result) {
        html += '<div class="tool-error-msg">' + escapeHtml(truncateText(toolCall.result, 100)) + '</div>';
        if (toolCall.approvalId) {
          html += '<div class="tool-actions">' +
            '<button class="tool-btn retry" data-action="retryTool" data-approval="' + escapeHtml(toolCall.approvalId) + '">⟳ Retry</button>' +
          '</div>';
        }
      }

      if (toolCall.status === 'rejected') {
        html += '<div class="tool-actions">' +
          '<button class="tool-btn retry" data-action="retryTool" data-approval="' + escapeHtml(toolCall.approvalId || '') + '">⟳ Retry</button>' +
        '</div>';
      }

      html += '</div>';
      return html;
    }

    function renderLspResults(payload) {
      if (!payload || typeof payload !== 'object') {
        return '<div class="tool-output">(No LSP results)</div>';
      }

      const op = typeof payload.operation === 'string' ? payload.operation : '';
      const filePath = typeof payload.filePath === 'string' ? payload.filePath : '';
      const results = Array.isArray(payload.results) ? payload.results : [];
      const truncated = !!payload.truncated;
      const skipped = typeof payload.skippedOutsideWorkspace === 'number' ? payload.skippedOutsideWorkspace : 0;

      const locations = [];
      const max = 30;

      const pushLocation = (loc, labelHint) => {
        if (!loc || typeof loc !== 'object') return;
        const fp = typeof loc.filePath === 'string' ? loc.filePath : '';
        const range = loc.range && typeof loc.range === 'object' ? loc.range : null;
        const start = range && range.start && typeof range.start === 'object' ? range.start : null;
        const line = start && Number.isFinite(start.line) ? Number(start.line) : null;
        const character = start && Number.isFinite(start.character) ? Number(start.character) : 1;
        if (!fp || !line) return;
        const label = typeof labelHint === 'string' && labelHint.trim() ? labelHint.trim() : '';
        locations.push({ filePath: fp, line, character, label });
      };

      const visit = (value, inheritedFilePath) => {
        if (!value || locations.length >= max) return;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (locations.length >= max) break;
            visit(item, inheritedFilePath);
          }
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
          visit(value.children, fileFromNode);
        }
      };

      // Common shapes:
      // - definition/implementation/references: results -> Location[]
      // - workspaceSymbol/documentSymbol: results -> items w/ location or ranges
      // - hover: results -> {contents, range}[] (use payload.filePath)
      visit(results, filePath);
      if (locations.length === 0 && filePath && op === 'hover') {
        visit(results, filePath);
      }

      let html = '<div class="lsp-results">';

      if (op === 'hover' && results[0] && typeof results[0].contents === 'string') {
        html += '<div class="lsp-hover">' + renderMarkdown(String(results[0].contents)) + '</div>';
      }

      if (locations.length === 0) {
        html += '<div class="tool-output">(No locations found)</div>';
      } else {
        for (const loc of locations) {
          const label = loc.label ? (escapeHtml(loc.label) + ' — ') : '';
          const display = escapeHtml(loc.filePath + ':' + loc.line + ':' + loc.character);
          html +=
            '<button type="button" class="lsp-link" data-action="openLocation" data-path="' +
            escapeHtml(loc.filePath) +
            '" data-line="' +
            String(loc.line) +
            '" data-character="' +
            String(loc.character) +
            '">' +
            label +
            '<span class="lsp-path">' +
            display +
            '</span>' +
            '</button>';
        }
      }

      if (skipped > 0 || truncated) {
        const notes = [];
        if (skipped > 0) notes.push('skipped ' + skipped + ' outside workspace');
        if (truncated) notes.push('truncated');
        html += '<div class="lsp-note">' + escapeHtml(notes.join(' · ')) + '</div>';
      }

      html += '</div>';
      return html;
    }

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

	      const text = (msg.content || '').trim();
	      const lines = text.split('\n');
	      const questionGroups = [];
	      let currentGroup = null;

	      for (let i = 0; i < lines.length; i++) {
	        const line = lines[i];
	        const trimmed = line.trim();

	        const isMainQuestion = /^\d+\.\s+.*\?$/.test(trimmed) || (/^[A-Z][^.!?]*\?$/.test(trimmed) && !trimmed.startsWith('-') && !trimmed.startsWith('*'));
	        const isSubQuestion = /^[-\*]\s+.*\?$/.test(trimmed);

	        if (isMainQuestion) {
	          if (currentGroup) {
	            questionGroups.push(currentGroup);
	          }
	          currentGroup = { main: trimmed, sub: [] };
	        } else if (isSubQuestion && currentGroup) {
	          currentGroup.sub.push(trimmed);
	        } else if (trimmed && currentGroup) {
	          currentGroup.sub.push(trimmed);
	        }
	      }
	      if (currentGroup) {
	        questionGroups.push(currentGroup);
	      }

	      let questionsHtml = '';
	      if (questionGroups.length > 0) {
	        questionsHtml = '<div class="plan-questions"><div class="plan-questions-title">Questions</div>';
	        questionGroups.forEach(group => {
	          let groupContent = '<div class="plan-question">';
	          groupContent += escapeHtml(group.main);
	          if (group.sub.length > 0) {
	            groupContent += '<ul class="plan-sub-questions">';
	            group.sub.forEach(sub => {
	              groupContent += '<li>' + escapeHtml(sub) + '</li>';
	            });
	            groupContent += '</ul>';
	          }
	          groupContent += '</div>';
	          questionsHtml += groupContent;
	        });
	        questionsHtml += '</div>';
	      }

	      let actions = '';
	      if (status === 'draft' && isActivePlan) {
	        actions = '<div class="plan-actions">' +
	          '<button class="plan-btn primary" data-action="executePlan" data-plan="' + escapeHtml(msg.id) + '">Execute</button>' +
	          '<button class="plan-btn secondary" data-action="revisePlan" data-plan="' + escapeHtml(msg.id) + '">Revise</button>' +
	          '<button class="plan-btn danger" data-action="cancelPlan" data-plan="' + escapeHtml(msg.id) + '">Cancel</button>' +
	        '</div>';
	      } else if (status === 'needs_input' && isActivePlan) {
	        const hasQuestions = questionGroups.length > 0;
	        const hintText =
	          !text || text === '(No plan generated)'
	            ? 'No plan generated. Add constraints in the chat box, then click "Update Plan", or click Revise.'
	            : hasQuestions
	              ? 'Answer the questions in the chat box, then click "Update Plan".'
	              : 'Add constraints in the chat box, then click "Update Plan", or click Revise.';
	        actions = '<div class="plan-actions">' +
	          '<button class="plan-btn secondary" data-action="revisePlan" data-plan="' + escapeHtml(msg.id) + '">Revise</button>' +
	          '<button class="plan-btn danger" data-action="cancelPlan" data-plan="' + escapeHtml(msg.id) + '">Cancel</button>' +
	        '</div>' +
	        '<div class="plan-hint">' + escapeHtml(hintText) + '</div>';
	      } else if (status === 'generating' && isActivePlan) {
	        actions = '<div class="plan-actions"><button class="plan-btn secondary" disabled>Planning…</button></div>';
	      } else if (status === 'executing' && isActivePlan) {
	        actions = '<div class="plan-actions"><button class="plan-btn secondary" disabled>Executing…</button></div>';
	      }

	      let html = '<div class="plan-header">🧭 Plan <span class="plan-status">' + escapeHtml(statusLabel) + '</span></div>';
	      html += '<div class="plan-body md">';
	      if (questionsHtml) html += questionsHtml;
	      html += renderMarkdown(text);
	      html += '</div>';
	      html += actions;
	      html += '<details class="plan-activity" data-count="0">';
	      html += '<summary class="plan-activity-summary">Activity <span class="plan-activity-count"></span></summary>';
	      html += '<div class="plan-activity-body"></div>';
	      html += '</details>';
	      return html;
	    }

	    function renderMarkdown(text) {
      if (!text) return '';

      const lines = String(text).replace(/\r\n/g, '\n').split('\n');

      const blocks = [];
      let inCode = false;
      let codeLang = '';
      let codeLines = [];
      let textLines = [];

      const flushText = () => {
        if (textLines.length === 0) return;
        blocks.push({ type: 'text', lines: textLines });
        textLines = [];
      };

      const flushCode = () => {
        blocks.push({ type: 'code', lang: codeLang, content: codeLines.join('\n') });
        codeLang = '';
        codeLines = [];
      };

      for (const line of lines) {
        const fence = line.match(/^\s*```(.*)$/);
        if (fence) {
          if (inCode) {
            flushCode();
            inCode = false;
          } else {
            flushText();
            inCode = true;
            codeLang = (fence[1] || '').trim();
          }
          continue;
        }

        if (inCode) {
          codeLines.push(line);
        } else {
          textLines.push(line);
        }
      }

      if (inCode) flushCode();
      flushText();

      const htmlParts = [];

      for (const block of blocks) {
        if (block.type === 'code') {
          const lang = String(block.lang || '').trim().toLowerCase();
          if (lang === 'markdown' || lang === 'md') {
            htmlParts.push(renderMarkdown(block.content));
            continue;
          }
          const langClass = block.lang ? ' language-' + escapeHtml(block.lang) : '';
          htmlParts.push('<pre><code class="' + langClass.trim() + '">' + escapeHtml(block.content) + '</code></pre>');
          continue;
        }

        htmlParts.push(renderMarkdownTextLines(block.lines || []));
      }

      return htmlParts.filter(Boolean).join('');
    }

    function renderMarkdownTextLines(lines) {
      const parts = [];
      let i = 0;

      const isBlank = (l) => !l || !String(l).trim();

      while (i < lines.length) {
        const raw = String(lines[i] || '');

        if (isBlank(raw)) {
          i++;
          continue;
        }

        const headingMatch = raw.match(/^\s*(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          const level = Math.min(6, Math.max(1, headingMatch[1].length));
          const text = headingMatch[2] || '';
          parts.push('<h' + level + '>' + renderInlineMarkdown(text) + '</h' + level + '>');
          i++;
          continue;
        }

        // Tables: header row + separator row (---)
        const next = i + 1 < lines.length ? String(lines[i + 1] || '') : '';
        if (raw.includes('|') && next && next.match(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/)) {
          const tableLines = [raw, next];
          i += 2;
          while (i < lines.length && !isBlank(lines[i])) {
            tableLines.push(String(lines[i] || ''));
            i++;
          }
          parts.push(renderTable(tableLines));
          continue;
        }

        const orderedStart = raw.match(/^\s*\d+\.\s+/);
        const bulletStart = raw.match(/^\s*[-*•]\s+/);
        if (orderedStart || bulletStart) {
          const listType = orderedStart ? 'ol' : 'ul';
          const listLines = [];
          while (i < lines.length) {
            const line = String(lines[i] || '');
            if (isBlank(line)) {
              // Markdown allows blank lines inside lists; keep scanning if the next non-blank
              // line continues the same list type.
              let j = i + 1;
              while (j < lines.length && isBlank(lines[j])) j++;
              if (j < lines.length) {
                const nextLine = String(lines[j] || '');
                const nextIsOrdered = /^\s*\d+\.\s+/.test(nextLine);
                const nextIsBullet = /^\s*[-*•]\s+/.test(nextLine);
                if ((listType === 'ol' && nextIsOrdered) || (listType === 'ul' && nextIsBullet)) {
                  i = j;
                  continue;
                }
              }
              break;
            }
            const heading = line.match(/^\s*(#{1,6})\s+/);
            if (heading) break;
            const isOrdered = /^\s*\d+\.\s+/.test(line);
            const isBullet = /^\s*[-*•]\s+/.test(line);
            if (listType === 'ol' && !isOrdered && !listLines.length) break;
            if (listType === 'ul' && !isBullet && !listLines.length) break;
            // Allow continuation lines inside list items.
            if (!isOrdered && !isBullet && listLines.length === 0) break;
            listLines.push(line);
            i++;
          }
          parts.push(renderList(listLines, listType));
          continue;
        }

        // Paragraphs until blank line or next structural element.
        const para = [];
        while (i < lines.length) {
          const line = String(lines[i] || '');
          if (isBlank(line)) break;
          if (line.match(/^\s*(#{1,6})\s+/)) break;
          const maybeNext = i + 1 < lines.length ? String(lines[i + 1] || '') : '';
          if (line.includes('|') && maybeNext && maybeNext.match(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/)) break;
          if (line.match(/^\s*\d+\.\s+/) || line.match(/^\s*[-*•]\s+/)) break;
          para.push(line);
          i++;
        }
        parts.push(renderParagraphs(para));
      }

      return parts.filter(Boolean).join('');
    }

    function splitTableRow(line) {
      const trimmed = String(line || '').trim();
      const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
      return withoutEdges.split('|').map(c => (c || '').trim());
    }

    function renderTable(lines) {
      if (!lines || lines.length < 2) return '';

      const header = splitTableRow(lines[0]);
      const rows = [];
      for (let i = 2; i < lines.length; i++) {
        rows.push(splitTableRow(lines[i]));
      }

      const colCount = Math.max(header.length, ...rows.map(r => r.length));
      const norm = (row) => {
        const out = row.slice(0, colCount);
        while (out.length < colCount) out.push('');
        return out;
      };

      const headerCells = norm(header)
        .map(cell => '<th>' + renderInlineMarkdown(cell) + '</th>')
        .join('');
      const bodyRows = rows
        .map(r => {
          const cells = norm(r).map(cell => '<td>' + renderInlineMarkdown(cell) + '</td>').join('');
          return '<tr>' + cells + '</tr>';
        })
        .join('');

      return '<table><thead><tr>' + headerCells + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
    }

    function renderList(lines, type) {
      const tag = type === 'ul' ? 'ul' : 'ol';
      const items = [];
      let current = null;

      for (const raw of lines) {
        const line = raw || '';
        const match = tag === 'ol'
          ? line.match(/^\s*\d+\.\s+(.*)$/)
          : line.match(/^\s*[-*•]\s+(.*)$/);

        if (match) {
          if (current) items.push(current);
          current = match[1] || '';
          continue;
        }

        if (current && line.trim()) {
          current += '\n' + line.trim();
        }
      }

      if (current) items.push(current);

      const liHtml = items
        .map(item => '<li>' + renderInlineMarkdown(item) + '</li>')
        .join('');

      return '<' + tag + '>' + liHtml + '</' + tag + '>';
    }

    function renderParagraphs(lines) {
      const paragraphs = [];
      let current = [];

      const flush = () => {
        if (current.length === 0) return;
        const text = current.join('\n').trim();
        if (text) paragraphs.push('<p>' + renderInlineMarkdown(text) + '</p>');
        current = [];
      };

      for (const raw of lines) {
        const line = raw || '';
        if (!line.trim()) {
          flush();
          continue;
        }
        current.push(line);
      }

      flush();

      return paragraphs.join('');
    }

    function renderInlineMarkdown(text) {
      if (!text) return '';

      // Escape first, then layer a minimal markdown subset on top.
      let escaped = escapeHtml(text);

      // Inline code: `code`
      escaped = escaped.replace(/`([^`]+)`/g, (_m, code) => '<code>' + code + '</code>');

      // Bold: **text**
      escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

      // Preserve newlines inside list items/paragraphs
      escaped = escaped.replace(/\n/g, '<br>');

      return escaped;
    }

	    document.addEventListener('click', (e) => {
	      const locationBtn = e.target.closest('[data-action="openLocation"]');
	      if (locationBtn) {
	        const filePath = locationBtn.dataset.path || '';
	        const line = Number(locationBtn.dataset.line || 0) || 0;
	        const character = Number(locationBtn.dataset.character || 1) || 1;
	        if (filePath && line > 0) {
	          try {
	            vscode.postMessage({ type: 'openLocation', filePath, line, character });
	          } catch {}
	        }
	        return;
	      }

	      const compactionBtn = e.target.closest('[data-action="viewCompactionSummary"]');
	      if (compactionBtn) {
	        const msgEl = compactionBtn.closest('.operation-card');
	        const msgId = msgEl && msgEl.dataset ? msgEl.dataset.id : '';
	        const msg = msgId ? messageDataById.get(msgId) : null;
	        const op = msg && msg.operation ? msg.operation : null;
	        const summaryText = op && typeof op.summaryText === 'string' ? op.summaryText : '';
	        if (summaryText.trim()) {
	          const auto = !!op.auto;
	          const truncated = !!op.summaryTruncated;
	          let title = auto ? 'Compaction summary (auto)' : 'Compaction summary';
	          if (truncated) title += ' (truncated)';
	          openOutputModal(title, summaryText);
	        }
	        return;
	      }

      const outputToggle = e.target.closest('[data-action="openFullOutput"]');
      if (outputToggle) {
	        const msgEl = outputToggle.closest('.tool-message');
	        const msgId = msgEl && msgEl.dataset ? msgEl.dataset.id : '';
	        const msg = msgId ? messageDataById.get(msgId) : null;
	        if (msg && msg.toolCall && msg.toolCall.result) {
	          const title = getToolModalTitle(msg.toolCall);
	          openOutputModal(title, msg.toolCall.result);
	        }
        return;
      }

      const nativeDiffToggle = e.target.closest('[data-action="openNativeDiff"]');
      if (nativeDiffToggle) {
        const msgEl = nativeDiffToggle.closest('.tool-message');
        const msgId = msgEl && msgEl.dataset ? msgEl.dataset.id : '';
        const msg = msgId ? messageDataById.get(msgId) : null;
        const toolCallId = msg && msg.toolCall && msg.toolCall.approvalId ? msg.toolCall.approvalId : '';
        if (toolCallId) {
          try {
            vscode.postMessage({ type: 'openNativeDiff', toolCallId });
          } catch {}
        }
        return;
      }

      const diffToggle = e.target.closest('[data-action="openFullDiff"]');
      if (diffToggle) {
        const msgEl = diffToggle.closest('.tool-message');
        const msgId = msgEl && msgEl.dataset ? msgEl.dataset.id : '';
	        const msg = msgId ? messageDataById.get(msgId) : null;
	        if (msg && msg.toolCall && msg.toolCall.diff) {
	          const title = getToolModalTitle(msg.toolCall) + ' (diff)';
	          openOutputModal(title, msg.toolCall.diff);
	        }
	        return;
	      }

		      const copyBtn = e.target.closest('[data-action="copyToolOutput"]');
		      if (copyBtn) {
		        const msgEl = copyBtn.closest('.tool-message');
		        const msgId = msgEl && msgEl.dataset ? msgEl.dataset.id : '';
		        const msg = msgId ? messageDataById.get(msgId) : null;
		        const text = msg && msg.toolCall && msg.toolCall.result ? msg.toolCall.result : '';
		        if (text) {
		          writeClipboard(text).then((ok) => {
		            if (!ok) return;
		            copyBtn.textContent = 'Copied';
		            copyBtn.classList.add('copied');
		            setTimeout(() => {
		              copyBtn.textContent = 'Copy';
		              copyBtn.classList.remove('copied');
		            }, 900);
		          });
		        }
		        return;
		      }

		      const assistantCopyBtn = e.target.closest(
		        '[data-action="copyAssistantMarkdown"],[data-action="copyAssistantHtml"]'
		      );
		      if (assistantCopyBtn) {
		        const action = assistantCopyBtn.dataset.action;
		        const msgEl = assistantCopyBtn.closest('.message.assistant');
		        const msgId = msgEl && msgEl.dataset ? msgEl.dataset.id : '';
		        const msg = msgId ? messageDataById.get(msgId) : null;
		        const contentEl = msgEl ? msgEl.querySelector('.message-content') : null;
		        if (!contentEl) return;

		        const markdown =
		          contentEl.dataset && contentEl.dataset.raw
		            ? contentEl.dataset.raw
		            : msg
		              ? msg.content || ''
		              : '';
		        const html = contentEl.innerHTML || '';
		        const plain = contentEl.textContent || '';

		        const original = assistantCopyBtn.textContent;
		        const finishCopy = (ok) => {
		          if (!ok) return;
		          assistantCopyBtn.textContent = '✓';
		          assistantCopyBtn.classList.add('copied');
		          setTimeout(() => {
		            assistantCopyBtn.textContent = original;
		            assistantCopyBtn.classList.remove('copied');
		          }, 900);
		        };

		        if (action === 'copyAssistantHtml') {
		          writeClipboardHtml(html, plain).then(finishCopy);
		        } else {
		          writeClipboard(markdown).then(finishCopy);
		        }
		        return;
		      }

		      const planBtn = e.target.closest('.plan-btn');
		      if (planBtn) {
	        const action = planBtn.dataset.action;
        const planMessageId = planBtn.dataset.plan;
        if (!action || !planMessageId) return;

	        if (action === 'executePlan') {
	          // Optimistically switch to Build mode; the extension will confirm via modeChanged.
	          setMode('build');
	          setPlanPending(false);
	          vscode.postMessage({ type: 'executePlan', planMessageId });
	        } else if (action === 'cancelPlan') {
	          setPlanPending(false);
	          vscode.postMessage({ type: 'cancelPlan', planMessageId });
	        } else if (action === 'revisePlan') {
	          vscode.postMessage({ type: 'revisePlan', planMessageId });
	        }
		        return;
		      }

		      const btn = e.target.closest('.tool-btn');
	      if (!btn) return;

      const action = btn.dataset.action;
      const approvalId = btn.dataset.approval;
      const toolId = btn.dataset.tool;

	      if (action === 'approve') {
	        vscode.postMessage({ type: 'approveToolCall', approvalId });
	      } else if (action === 'always') {
	        vscode.postMessage({ type: 'alwaysAllowTool', approvalId, toolId });
	      } else if (action === 'reject') {
	        vscode.postMessage({ type: 'rejectToolCall', approvalId });
	      } else if (action === 'retryTool') {
	        vscode.postMessage({ type: 'retryTool', approvalId });
      }
    });
