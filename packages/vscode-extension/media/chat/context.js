	    function escapeHtml(text) {
	      const div = document.createElement('div');
	      div.textContent = text || '';
	      return div.innerHTML;
	    }

	    function updateSessionSelect(sessions, selectedId) {
	      if (!sessionSelect) return;
	      sessionSelect.innerHTML = '';
	      sessions.forEach(s => {
	        const opt = document.createElement('option');
	        let label = s.title || s.id;
	        if (s.id === selectedId && isProcessing) {
	          label = '◉ ' + label;
	        }
	        opt.value = s.id;
	        opt.textContent = label;
	        if (s.id === selectedId) opt.selected = true;
	        sessionSelect.appendChild(opt);
	      });
	      currentSessionId = selectedId || '';
	    }

	    function updateModelHeader(state) {
	      const modelId = state && (state.model || state.id) ? String(state.model || state.id) : '';
	      const label = state && state.label ? String(state.label) : (modelId || 'Pick model');
	      const isFavorite = !!(state && state.isFavorite);

	      if (modelPickerLabel) {
	        modelPickerLabel.textContent = label;
	      } else if (modelPicker) {
	        modelPicker.textContent = label;
	      }

	      currentModel = modelId;

	      if (modelFavoriteToggle) {
	        modelFavoriteToggle.disabled = !currentModel;
	        modelFavoriteToggle.textContent = isFavorite ? '★' : '☆';
	        modelFavoriteToggle.title = isFavorite ? 'Unfavorite model' : 'Favorite model';
	      }
	    }

	    function formatInt(value) {
	      try {
	        return Number(value).toLocaleString();
	      } catch {
	        return String(value);
	      }
	    }

	    function formatCompact(value) {
	      const num = Number(value);
	      if (!Number.isFinite(num)) return String(value);
	      const abs = Math.abs(num);
	      if (abs < 1000) return String(Math.round(num));
	      if (abs < 100_000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
	      if (abs < 1_000_000) return Math.round(num / 1000) + 'k';
	      if (abs < 100_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
	      return Math.round(num / 1_000_000) + 'm';
	    }

	    function closeContextPopover() {
	      if (!contextPopover) return;
	      contextPopover.classList.add('hidden');
	    }

	    function closeTodoPopover() {
	      if (!todoPopover) return;
	      todoPopover.classList.add('hidden');
	    }

	    let outputModalText = '';
	    let outputModalTitleText = '';

		    async function writeClipboard(text) {
		      if (!text) return false;
		      try {
		        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
		          await navigator.clipboard.writeText(String(text));
		          return true;
		        }
		      } catch {}

	      try {
	        const el = document.createElement('textarea');
	        el.value = String(text);
	        el.setAttribute('readonly', 'true');
	        el.style.position = 'fixed';
	        el.style.top = '-9999px';
	        el.style.left = '-9999px';
	        document.body.appendChild(el);
	        el.select();
	        const ok = document.execCommand('copy');
	        document.body.removeChild(el);
	        return !!ok;
	      } catch {
		        return false;
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

	    function closeOutputModal() {
	      if (!outputModal) return;
	      outputModal.classList.add('hidden');
	      outputModalText = '';
	      outputModalTitleText = '';
	    }

	    function openOutputModal(title, text) {
	      if (!outputModal || !outputModalTitle || !outputModalBody) return;
	      outputModalTitleText = String(title || 'Output');
	      outputModalText = String(text || '');
	      outputModalTitle.textContent = outputModalTitleText;
	      outputModalBody.textContent = outputModalText;
	      outputModal.classList.remove('hidden');
	      try { outputModalBody.scrollTop = 0; } catch {}
	      try { (outputModalClose || outputModalCopy || outputModal).focus(); } catch {}
	    }

	    function getToolModalTitle(toolCall) {
	      if (!toolCall) return 'Output';
	      const toolId = toolCall.id || '';
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

	    if (outputModalBackdrop) {
	      outputModalBackdrop.addEventListener('click', () => closeOutputModal());
	    }
	    if (outputModalClose) {
	      outputModalClose.addEventListener('click', () => closeOutputModal());
	    }
	    if (outputModalCopy) {
	      outputModalCopy.addEventListener('click', async () => {
	        const ok = await writeClipboard(outputModalText);
	        if (!ok) return;
	        outputModalCopy.textContent = 'Copied';
	        setTimeout(() => { outputModalCopy.textContent = 'Copy'; }, 900);
	      });
	    }

	    // --- File path linkification (click to open) ---
	    const fileLinkCache = new Map(); // raw -> { ok, path, checkedAt }
	    const fileLinkPending = new Set(); // raw
	    const fileLinkCandidatesByRaw = new Map(); // raw -> Set<HTMLElement>
	    const linkifyQueue = new Set(); // Set<Element>
	    const linkifyForceRoots = new WeakSet();
	    let linkifyTimer = null;
	    const FILE_LINK_NEGATIVE_CACHE_TTL_MS = 5000;

	    function scheduleFileLinkify(rootEl, opts) {
	      if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
	      if (opts && opts.force) {
	        try { linkifyForceRoots.add(rootEl); } catch {}
	      }
	      linkifyQueue.add(rootEl);
	      if (linkifyTimer) return;
	      linkifyTimer = setTimeout(() => {
	        linkifyTimer = null;
	        flushFileLinkifyQueue();
	      }, 80);
	    }

	    function flushFileLinkifyQueue() {
	      const roots = Array.from(linkifyQueue);
	      linkifyQueue.clear();
	      if (roots.length === 0) return;

	      const pendingRaw = new Set();

	      roots.forEach((rootEl) => {
	        try {
	          const force = linkifyForceRoots.has(rootEl);
	          if (force) {
	            try { linkifyForceRoots.delete(rootEl); } catch {}
	          }
	          markFileCandidatesInElement(rootEl);
	          const candidates = Array.from(rootEl.querySelectorAll('.file-link-token.file-link-candidate'));
	          for (const el of candidates) {
	            const raw = el && el.dataset ? (el.dataset.fileRaw || '') : '';
	            if (!raw) continue;
	            registerFileLinkCandidate(raw, el);
	            if (!force) {
	              const cached = fileLinkCache.get(raw);
	              if (cached && cached.ok) continue;
	              if (cached && !cached.ok) {
	                const age = Date.now() - (Number(cached.checkedAt || 0) || 0);
	                if (age < FILE_LINK_NEGATIVE_CACHE_TTL_MS) continue;
	                fileLinkCache.delete(raw);
	              }
	            }
	            if (fileLinkPending.has(raw)) continue;
	            pendingRaw.add(raw);
	          }
	        } catch {}
	      });

	      if (pendingRaw.size === 0) return;
	      requestResolveFileLinks(Array.from(pendingRaw));
	    }

	    function markFileCandidatesInElement(rootEl) {
	      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
	      const nodes = [];
	      let n;
	      while ((n = walker.nextNode())) nodes.push(n);

	      for (const textNode of nodes) {
	        if (!textNode || !textNode.nodeValue) continue;
	        const parent = textNode.parentElement;
	        if (!parent) continue;
	        if (parent.closest && parent.closest('.file-link-token')) continue;
	        if (shouldSkipFileLinkify(textNode)) continue;

	        const text = String(textNode.nodeValue || '');
	        if (!looksLikeTextMayContainPath(text)) continue;

	        const parts = splitTextIntoFileLinkParts(text);
	        if (!parts || parts.length === 0) continue;

	        const frag = document.createDocumentFragment();
	        let didChange = false;
	        for (const part of parts) {
	          if (part.kind === 'text') {
	            frag.appendChild(document.createTextNode(part.text));
	            continue;
	          }

	          didChange = true;
	          if (part.prefix) frag.appendChild(document.createTextNode(part.prefix));

	          const span = document.createElement('span');
	          span.className = 'file-link-token file-link-candidate';
	          span.dataset.fileRaw = part.fileRaw;
	          span.dataset.line = String(part.line || 1);
	          span.dataset.character = String(part.character || 1);
	          span.textContent = part.label || part.fileRaw;
	          frag.appendChild(span);
	          registerFileLinkCandidate(part.fileRaw, span);

	          if (part.suffix) frag.appendChild(document.createTextNode(part.suffix));
	        }

	        if (didChange) {
	          try { textNode.parentNode.replaceChild(frag, textNode); } catch {}
	        }
	      }
	    }

	    function shouldSkipFileLinkify(textNode) {
	      let el = textNode && textNode.parentElement ? textNode.parentElement : null;
	      while (el) {
	        const tag = String(el.tagName || '').toUpperCase();
	        if (tag === 'A' || tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SCRIPT' || tag === 'STYLE') {
	          return true;
	        }
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
	      if (!text) return false;
	      return (
	        text.includes('/') ||
	        text.includes('\\') ||
	        text.includes('.') ||
	        text.includes('file://') ||
	        text.includes('~/') ||
	        text.includes(':') ||
	        /\b(Makefile|Dockerfile|LICENSE|README)\b/.test(text)
	      );
	    }

	    function splitTextIntoFileLinkParts(text) {
	      const out = [];
	      const re = /\S+/g;
	      let lastIndex = 0;
	      let match;
	      let changed = false;

	      while ((match = re.exec(text))) {
	        const start = match.index;
	        const end = start + match[0].length;
	        const word = match[0];

	        const candidate = parseWordAsFileLinkCandidate(word);
	        if (!candidate) continue;

	        if (start > lastIndex) out.push({ kind: 'text', text: text.slice(lastIndex, start) });
	        out.push(candidate);
	        lastIndex = end;
	        changed = true;
	      }

	      if (!changed) return null;
	      if (lastIndex < text.length) out.push({ kind: 'text', text: text.slice(lastIndex) });
	      return out;
	    }

	    function parseWordAsFileLinkCandidate(word) {
	      const split = splitWordPunctuation(word);
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

	    function splitWordPunctuation(word) {
	      const raw = String(word || '');
	      if (!raw) return null;

	      const leading = '([{<"\'`';
	      const trailing = ')]}>,.;"\'`';
	      let start = 0;
	      let end = raw.length;

	      while (start < end && leading.includes(raw[start])) start++;
	      while (end > start && trailing.includes(raw[end - 1])) end--;

	      let prefix = raw.slice(0, start);
	      let core = raw.slice(start, end);
	      let suffix = raw.slice(end);

	      if (core.endsWith(':') && !/:\d+$/.test(core)) {
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
	      const lower = value.toLowerCase();
	      if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
	      if (lower.startsWith('www.')) return false;
	      if (value.includes('@') && value.includes('.')) return false;
	      if (/^\d+(?:\.\d+)+$/.test(value)) return false;
	      if (value.startsWith('file://')) return true;
	      if (value.startsWith('~/') || value.startsWith('~\\')) return true;
	      if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
	      if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
	      if (value.includes('/') || value.includes('\\')) return true;
	      if (value.includes('.') && /[a-zA-Z]/.test(value)) return true;
	      if (/^(Makefile|Dockerfile|LICENSE|README)$/i.test(value)) return true;
	      return false;
	    }

	    function parsePathLocation(token) {
	      const value = String(token || '').trim();
	      if (!value) return null;

	      const hashMatch = value.match(/^(.*)#L(\d+)(?:C(\d+))?$/);
	      if (hashMatch) {
	        return {
	          path: hashMatch[1] || '',
	          line: Number(hashMatch[2] || 1) || 1,
	          character: Number(hashMatch[3] || 1) || 1,
	          label: value,
	          trailing: '',
	        };
	      }

	      const colonMatch = value.match(/^(.*):(\d+)(?::(\d+))?$/);
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

	      const colonPrefixMatch = value.match(/^(.*):(\d+)(?::(\d+))?:(.+)$/);
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

	      return { path: value, line: 1, character: 1, label: value, trailing: '' };
	    }

	    function registerFileLinkCandidate(raw, el) {
	      if (!raw || !el) return;
	      let set = fileLinkCandidatesByRaw.get(raw);
	      if (!set) {
	        set = new Set();
	        fileLinkCandidatesByRaw.set(raw, set);
	      }
	      set.add(el);
	    }

	    function requestResolveFileLinks(rawPaths) {
	      const list = Array.isArray(rawPaths) ? rawPaths.filter(Boolean) : [];
	      if (list.length === 0) return;

	      const chunkSize = 150;
	      for (let i = 0; i < list.length; i += chunkSize) {
	        const chunk = list.slice(i, i + chunkSize);
	        if (chunk.length === 0) continue;

	        const requestId = String(Date.now()) + '_' + Math.random().toString(16).slice(2);
	        chunk.forEach(raw => fileLinkPending.add(raw));
	        try {
	          vscode.postMessage({
	            type: 'resolveFileLinks',
	            requestId,
	            candidates: chunk.map(raw => ({ raw })),
	          });
	        } catch {
	          chunk.forEach(raw => fileLinkPending.delete(raw));
	        }
	      }
	    }

	    function handleResolvedFileLinks(data) {
	      const payload = data || {};
	      const results = Array.isArray(payload.results) ? payload.results : [];
	      for (const r of results) {
	        if (!r || typeof r !== 'object') continue;
	        const raw = typeof r.raw === 'string' ? r.raw : '';
	        if (!raw) continue;
	        const ok = !!r.ok;
	        const resolvedPath = ok && typeof r.path === 'string' ? r.path : '';
	        fileLinkCache.set(raw, { ok, path: resolvedPath, checkedAt: Date.now() });
	        fileLinkPending.delete(raw);
	        applyResolvedFileLink(raw);
	      }
	    }

	    function applyResolvedFileLink(raw) {
	      const cached = fileLinkCache.get(raw);
	      if (!cached) return;
	      const set = fileLinkCandidatesByRaw.get(raw);
	      if (!set || set.size === 0) return;

	      for (const el of Array.from(set)) {
	        try {
	          if (!el || !el.isConnected) {
	            set.delete(el);
	            continue;
	          }
	          if (cached.ok && cached.path) {
	            const btn = document.createElement('button');
	            btn.type = 'button';
	            btn.className = 'file-link-token file-link';
	            btn.dataset.action = 'openLocation';
	            btn.dataset.path = String(cached.path);
	            btn.dataset.line = el.dataset.line || '1';
	            btn.dataset.character = el.dataset.character || '1';
	            btn.textContent = el.textContent || raw;
	            el.replaceWith(btn);
	          } else {
	            el.className = 'file-link-token file-link-candidate file-link-missing';
	            el.dataset.fileRaw = raw;
	          }
	        } catch {}
	        set.delete(el);
	      }

	      if (set.size === 0) {
	        fileLinkCandidatesByRaw.delete(raw);
	      }
	    }

	    function renderContextPopover(ctx) {
	      if (!contextPopoverBody) return;
	      contextPopoverBody.innerHTML = '';

	      const total = ctx && typeof ctx.totalTokens === 'number' ? ctx.totalTokens : undefined;
	      const contextLimit = ctx && typeof ctx.contextLimitTokens === 'number' ? ctx.contextLimitTokens : undefined;
	      const outputLimit = ctx && typeof ctx.outputLimitTokens === 'number' ? ctx.outputLimitTokens : undefined;
	      const percent = ctx && typeof ctx.percent === 'number' ? ctx.percent : undefined;
	      const input = ctx && typeof ctx.inputTokens === 'number' ? ctx.inputTokens : undefined;
	      const output = ctx && typeof ctx.outputTokens === 'number' ? ctx.outputTokens : undefined;
	      const cacheRead = ctx && typeof ctx.cacheReadTokens === 'number' ? ctx.cacheReadTokens : undefined;
	      const cacheWrite = ctx && typeof ctx.cacheWriteTokens === 'number' ? ctx.cacheWriteTokens : undefined;
	      const hasTokens = !!total && total > 0;

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
	        contextPopoverBody.appendChild(row);
	      };

	      const addDivider = () => {
	        const div = document.createElement('div');
	        div.className = 'context-divider';
	        contextPopoverBody.appendChild(div);
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
	    }

	    function updateContextIndicatorState(ctx) {
	      if (!contextIndicator) return;

	      latestContext = ctx || {};

	      const total = ctx && typeof ctx.totalTokens === 'number' ? ctx.totalTokens : undefined;
	      const contextLimit = ctx && typeof ctx.contextLimitTokens === 'number' ? ctx.contextLimitTokens : undefined;
	      const percent = ctx && typeof ctx.percent === 'number' ? ctx.percent : undefined;

	      const hasTokens = !!total && total > 0;
	      if (!hasTokens) {
	        contextIndicator.textContent = '';
	        contextIndicator.classList.add('hidden');
	        closeContextPopover();
	        return;
	      }

	      const shortTotal = hasTokens ? formatCompact(total) : '—';
	      const shortPercent = hasTokens && typeof percent === 'number' ? String(percent) + '%' : '';
	      const label = shortPercent ? shortTotal + ' tok ' + shortPercent : shortTotal + ' tok';

	      const lines = [];
	      let title = 'Context: ' + (hasTokens ? formatInt(total) : 'unavailable');
	      if (contextLimit && contextLimit > 0) {
	        title += ' / ' + formatInt(contextLimit);
	        if (hasTokens && percent !== undefined) {
	          title += ' (' + String(percent) + '%)';
	        }
	      } else {
	        title += hasTokens ? ' tokens' : '';
	      }
	      lines.push(title);
	      const input = ctx && typeof ctx.inputTokens === 'number' ? ctx.inputTokens : undefined;
	      const output = ctx && typeof ctx.outputTokens === 'number' ? ctx.outputTokens : undefined;
	      if (hasTokens && (input !== undefined || output !== undefined)) {
	        lines.push('Input: ' + formatInt(input || 0) + '  Output: ' + formatInt(output || 0));
	      }

	      contextIndicator.textContent = label;
	      contextIndicator.classList.remove('hidden');
	      contextIndicator.classList.remove('warn', 'danger');
	      if (hasTokens && typeof percent === 'number') {
	        if (percent >= 95) contextIndicator.classList.add('danger');
	        else if (percent >= 80) contextIndicator.classList.add('warn');
	      }
	      contextIndicator.title = lines.join('\n');

	      if (contextPopover && !contextPopover.classList.contains('hidden')) {
	        renderContextPopover(ctx);
	      }
	    }

	    function renderTodoPopover(todos) {
	      if (!todoPopoverBody) return;
	      todoPopoverBody.innerHTML = '';

	      const list = Array.isArray(todos) ? todos : [];
	      if (list.length === 0) {
	        const emptyEl = document.createElement('div');
	        emptyEl.className = 'todo-empty';
	        emptyEl.textContent = 'No todos yet. The agent can use todowrite to track a plan.';
	        todoPopoverBody.appendChild(emptyEl);
	        return;
	      }

	      const statusIcon = (status) => {
	        switch (status) {
	          case 'completed': return '[✓]';
	          case 'in_progress': return '[•]';
	          case 'cancelled': return '[✕]';
	          default: return '[ ]';
	        }
	      };

	      const normalizeStatus = (value) => {
	        return value === 'in_progress' || value === 'completed' || value === 'cancelled' ? value : 'pending';
	      };
	      const normalizePriority = (value) => {
	        return value === 'high' || value === 'low' ? value : 'medium';
	      };

	      for (const t of list) {
	        if (!t || typeof t !== 'object') continue;
	        const content = typeof t.content === 'string' ? t.content : '';
	        if (!content.trim()) continue;

	        const status = normalizeStatus(typeof t.status === 'string' ? t.status : 'pending');
	        const priority = normalizePriority(typeof t.priority === 'string' ? t.priority : 'medium');

	        const row = document.createElement('div');
	        row.className = 'todo-item ' + status;
	        if (status === 'completed') row.classList.add('completed');

	        const icon = document.createElement('div');
	        icon.className = 'todo-icon';
	        icon.textContent = statusIcon(status);

	        const body = document.createElement('div');
	        body.className = 'todo-content';
	        body.textContent = content;

	        const meta = document.createElement('div');
	        meta.className = 'todo-meta';

	        const statusPill = document.createElement('div');
	        statusPill.className = 'todo-pill';
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
	        todoPopoverBody.appendChild(row);
	      }
	    }

	    function updateTodoIndicatorState(todos) {
	      if (!todoIndicator) return;
	      latestTodos = Array.isArray(todos) ? todos : [];

	      const openCount = latestTodos.filter(t => t && typeof t === 'object' && t.status !== 'completed').length;
	      const totalCount = latestTodos.length;
	      if (!totalCount) {
	        todoIndicator.textContent = '';
	        todoIndicator.classList.add('hidden');
	        closeTodoPopover();
	        return;
	      }

	      todoIndicator.classList.remove('hidden');
	      todoIndicator.textContent = 'Todo · ' + formatCompact(openCount);

	      if (todoPopover && !todoPopover.classList.contains('hidden')) {
	        renderTodoPopover(latestTodos);
	      }
	    }

	    function openTodoPopover() {
	      if (!todoPopover) return;
	      renderTodoPopover(latestTodos);
	      todoPopover.classList.remove('hidden');
	    }

	    function toggleTodoPopover() {
	      if (!todoPopover) return;
	      if (todoPopover.classList.contains('hidden')) {
	        openTodoPopover();
	      } else {
	        closeTodoPopover();
	      }
	    }

	    function openContextPopover() {
	      if (!contextPopover || !latestContext) return;
	      renderContextPopover(latestContext);
	      contextPopover.classList.remove('hidden');
	    }

	    function toggleContextPopover() {
	      if (!contextPopover) return;
	      if (contextPopover.classList.contains('hidden')) {
	        openContextPopover();
	      } else {
	        closeContextPopover();
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
	        if (!initReceived || isProcessing) return;
	        closeContextPopover();
	        try { vscode.postMessage({ type: 'compactSession' }); } catch {}
	      });
	    }

	    document.addEventListener('mousedown', (e) => {
	      if (!contextPopover || contextPopover.classList.contains('hidden')) return;
	      const target = e.target;
	      if (contextPopover.contains(target) || (contextIndicator && contextIndicator.contains(target))) return;
	      closeContextPopover();
	    }, { capture: true });

	    document.addEventListener('mousedown', (e) => {
	      if (!todoPopover || todoPopover.classList.contains('hidden')) return;
	      const target = e.target;
	      if (todoPopover.contains(target) || (todoIndicator && todoIndicator.contains(target))) return;
	      closeTodoPopover();
	    }, { capture: true });

	    document.addEventListener('keydown', (e) => {
	      if (e.key === 'Escape') {
	        closeContextPopover();
	        closeTodoPopover();
	        closeOutputModal();
	      }
	    });
