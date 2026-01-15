		    const readyInterval = setInterval(() => {
		      if (!initReceived) {
		        vscode.postMessage({ type: 'ready', clientInstanceId });
		      }
		    }, 2000);

		    function rerenderPlanMessage(msg) {
		      if (!msg || msg.role !== 'plan') return;
		      const msgEl = msg && typeof msg.id === 'string' ? messageEls.get(msg.id) : null;
		      if (!msgEl) return;

		      const existingBody = msgEl.querySelector('.plan-activity-body');
		      const existingChildren = existingBody ? Array.from(existingBody.children) : [];
		      const existingOpen = !!msgEl.querySelector('.plan-activity')?.open;
		      const existingCount = existingChildren.length;
		      const wasNearBottom = isNearBottom();

		      msgEl.className = 'message plan';
		      if (msg.plan?.status) msgEl.classList.add(msg.plan.status);
		      msgEl.innerHTML = formatPlanCard(msg);

		      const nextDetails = msgEl.querySelector('.plan-activity');
		      if (nextDetails) {
		        nextDetails.open = existingOpen;
		        nextDetails.dataset.count = String(existingCount);
		        const countEl = nextDetails.querySelector('.plan-activity-count');
		        if (countEl) countEl.textContent = existingCount > 0 ? '(' + existingCount + ')' : '';
		      }
		      const nextBody = msgEl.querySelector('.plan-activity-body');
		      if (nextBody) {
		        for (const child of existingChildren) {
		          nextBody.appendChild(child);
		        }
		        stepBodies.set(msg.id, nextBody);
		      }

		      maybeAutoScroll(wasNearBottom);
		    }

		    function rerenderPlanCards() {
		      messageDataById.forEach((msg) => {
		        if (msg && msg.role === 'plan') {
		          rerenderPlanMessage(msg);
		        }
		      });
		    }

		    window.addEventListener('message', (e) => {
		      try {
		        const data = e.data || {};
		      switch (data.type) {
	        case 'init':
			          initReceived = true;
			          clearInterval(readyInterval);
			          messages.innerHTML = '';
			          messages.appendChild(empty);
			          turnEls.clear();
			          activeTurnId = '';
			          messageEls.clear();
			          messageDataById.clear();
			          stepBodies.clear();
			          pendingTokens.clear();
			          lastToolMsg = null;
			          currentOperation = null;
			          stopOperationTimer();
			          updateOperationBanner();
		          currentRevertState = null;
		          updateRevertBar(null);
		          activePlanMessageId = typeof data.activePlanMessageId === 'string' ? data.activePlanMessageId : '';
		          suppressAutoScroll = true;
		          userScrolledAway = false;
		          {
		            const list = Array.isArray(data.messages) ? data.messages : [];
		            for (const msg of list) {
		              try {
		                addMessage(msg);
		              } catch (err) {
		                console.error('Failed to render message', err, msg);
		              }
		            }
		            if (list.length === 0) {
		            empty.style.display = 'flex';
	          } else {
	            empty.style.display = 'none';
	          }
		          }
		          suppressAutoScroll = false;
		          messages.scrollTop = messages.scrollHeight;

			          try {
			            const state = vscode.getState() || {};
			            activityOpenStates = state.activityOpenStates || {};
			          } catch {}

			          turnEls.forEach((turnData, turnId) => {
			            const expanded = activityOpenStates[turnId];
			            if (expanded) {
			              turnData.activity.open = true;
			            }
			            updateTurnActivitySummary(turnData);
			          });
		      if (data.sessions && data.sessions.length > 0) {
		        updateSessionSelect(data.sessions, data.activeSessionId);
		      }
		      updateModelHeader({
		        model: data.currentModel || '',
		        label: data.currentModelLabel || data.currentModel || 'Pick model',
		        isFavorite: !!data.currentModelIsFavorite,
		      });
			      updateContextIndicatorState(data.context);
			      closeContextPopover();
			      updateTodoIndicatorState(data.todos);
			      closeTodoPopover();
		          setMode(data.mode || 'build');
		          setPlanPending(!!data.planPending);
		          setProcessing(!!data.processing);
		          try { setInputHistoryEntries(Array.isArray(data.inputHistory) ? data.inputHistory : []); } catch {}
		          try { setAvailableSkills(Array.isArray(data.skills) ? data.skills : []); } catch {}
		          pendingApprovalsCount = Number(data.pendingApprovals || 0) || 0;
		          autoApproveThisRun = !!data.autoApproveThisRun;
		          updateApprovalBanner();
		          canUndo = !!data.canUndo;
		          canRedo = !!data.canRedo;
		          updateRevertBar(data.revertState);
		          syncInputState();
		          vscode.postMessage({ type: 'initAck', clientInstanceId });
		          break;
	        case 'context':
	          updateContextIndicatorState(data.context);
	          break;
	        case 'todos':
	          updateTodoIndicatorState(data.todos);
	          break;
	        case 'sessions':
	          if (data.sessions && data.sessions.length > 0) {
	            updateSessionSelect(data.sessions, data.activeSessionId || currentSessionId);
	          }
	          break;
	        case 'inputHistory':
	          try { setInputHistoryEntries(Array.isArray(data.entries) ? data.entries : []); } catch {}
	          break;
	        case 'message':
	          addMessage(data.message);
	          break;
		        case 'token':
		          const el = messageEls.get(data.messageId);
		          const wasNearBottom = isNearBottom();
		          if (el) {
              const msg = messageDataById.get(data.messageId);
              if (msg && msg.role === 'thought') {
                const thinkingEl = el.querySelector('.thinking-text');
                if (thinkingEl) {
                  thinkingEl.textContent = (thinkingEl.textContent || '') + data.token;
                }
                maybeAutoScroll(wasNearBottom);
                break;
              }
		            const contentEl = el.querySelector('.message-content');
		            if (contentEl) {
	                if (el.classList.contains('assistant') && contentEl.classList.contains('md')) {
	                  const raw = (contentEl.dataset.raw || '') + data.token;
	                  contentEl.dataset.raw = raw;
	                  contentEl.innerHTML = renderMarkdown(raw);
	                } else {
	                  contentEl.textContent = (contentEl.textContent === '…' ? '' : contentEl.textContent) + data.token;
	                }
		            }
		            if (typeof scheduleFileLinkify === 'function') {
		              try { scheduleFileLinkify(el); } catch {}
		            }
		            maybeAutoScroll(wasNearBottom);
		          } else {
		            pendingTokens.set(
		              data.messageId,
		              (pendingTokens.get(data.messageId) || '') + data.token
	            );
	          }
	          break;
		        case 'updateTool':
		          const wasNearBottomToolUpdate = isNearBottom();
		          if (data.message && typeof data.message.id === 'string') {
		            messageDataById.set(data.message.id, data.message);
		          }
		          const toolEl = messageEls.get(data.message.id);
		          if (toolEl && data.message.toolCall) {
	            const cardEl = toolEl.querySelector('.tool-card');
	            if (cardEl) {
	              cardEl.className = 'tool-card ' + data.message.toolCall.status;
	              cardEl.innerHTML = formatToolSummary(data.message.toolCall).replace(/<div class="tool-card[^>]*>/, '').replace(/<\/div>$/, '');
	            }
	            if (typeof scheduleFileLinkify === 'function') {
	              try { scheduleFileLinkify(toolEl, { force: true }); } catch {}
	            }
	
	            const status = data.message.toolCall.status;
		            if (status === 'pending' || status === 'error' || status === 'rejected') {
		              const details = toolEl.closest('.plan-activity');
		              if (details) details.open = true;
	            }

		            if (status === 'pending' && data.message.toolCall.approvalId && data.message.turnId) {
		              const turnData = turnEls.get(data.message.turnId);
		              if (turnData) {
		                turnData.statusBar.style.display = 'flex';
		                if (turnData.spinner) turnData.spinner.style.display = 'none';
		                turnData.statusText.textContent = 'Waiting approval: ' + (data.message.toolCall.name || data.message.toolCall.id || 'Tool');
		              }
		            }
	          }
		          maybeAutoScrollAfterLayout(wasNearBottomToolUpdate);
		          break;
		        case 'resolvedFileLinks':
		          if (typeof handleResolvedFileLinks === 'function') {
		            try { handleResolvedFileLinks(data); } catch {}
		          }
		          break;
				        case 'updateMessage':
				          if (data.message && typeof data.message.id === 'string') {
				            messageDataById.set(data.message.id, data.message);
				          }
			          const msgEl = messageEls.get(data.message.id);
			          if (msgEl && data.message.role === 'step') {
			            const wasNearBottomStepUpdate = isNearBottom();
			            const status = data.message.step?.status || 'running';
			            const mode = data.message.step?.mode || 'Build';
			            const model = data.message.step?.model || '';

		            msgEl.className = 'step ' + status;
		            const modeEl = msgEl.querySelector('.step-mode');
		            const sepEl = msgEl.querySelector('.step-sep');
		            const modelEl = msgEl.querySelector('.step-model');
		            if (modeEl) modeEl.textContent = mode;
		            if (sepEl) sepEl.style.display = model ? '' : 'none';
			            if (modelEl) {
			              modelEl.textContent = model;
			              modelEl.style.display = model ? '' : 'none';
			            }
			            const body = msgEl.querySelector('.step-body');
			            if (body) stepBodies.set(data.message.id, body);
			            maybeAutoScrollAfterLayout(wasNearBottomStepUpdate);
			          } else if (msgEl && data.message.role === 'plan') {
			            const existingBody = msgEl.querySelector('.plan-activity-body');
			            const existingChildren = existingBody ? Array.from(existingBody.children) : [];
			            const existingOpen = !!msgEl.querySelector('.plan-activity')?.open;
		            const existingCount = existingChildren.length;

		            msgEl.className = 'message plan';
		            if (data.message.plan?.status) msgEl.classList.add(data.message.plan.status);
		            const wasNearBottom = isNearBottom();
		            msgEl.innerHTML = formatPlanCard(data.message);

		            const nextDetails = msgEl.querySelector('.plan-activity');
		            if (nextDetails) {
		              nextDetails.open = existingOpen;
		              nextDetails.dataset.count = String(existingCount);
		              const countEl = nextDetails.querySelector('.plan-activity-count');
		              if (countEl) countEl.textContent = existingCount > 0 ? '(' + existingCount + ')' : '';
		            }
		            const nextBody = msgEl.querySelector('.plan-activity-body');
		            if (nextBody) {
		              for (const child of existingChildren) {
		                nextBody.appendChild(child);
		              }
		              stepBodies.set(data.message.id, nextBody);
		            }
		            maybeAutoScroll(wasNearBottom);
		          } else if (msgEl) {
		            const newEl = createMessageElement(data.message, !!data.message.toolCall);
		            msgEl.replaceWith(newEl);
		            messageEls.set(data.message.id, newEl);
		            const pending = pendingTokens.get(data.message.id);
		            if (pending) {
		              const contentEl = newEl.querySelector('.message-content');
		              if (contentEl) {
                      if (data.message.role === 'thought') {
                        const thinkingEl = newEl.querySelector('.thinking-text');
                        if (thinkingEl) {
                          thinkingEl.textContent = (thinkingEl.textContent || '') + pending;
                        }
                      } else
                    if (newEl.classList.contains('assistant') && contentEl.classList.contains('md')) {
                      const raw = (contentEl.dataset.raw || '') + pending;
                      contentEl.dataset.raw = raw;
                      contentEl.innerHTML = renderMarkdown(raw);
                    } else {
                      contentEl.textContent = (contentEl.textContent === '…' ? '' : contentEl.textContent) + pending;
                    }
		              }
		              pendingTokens.delete(data.message.id);
		            }
		          } else {
		            addMessage(data.message);
		          }
		          break;
        case 'processing':
          setProcessing(data.value);
          break;
        case 'operationStart':
          if (data.operation) {
            startOperation(data.operation);
          }
          break;
        case 'approvalsChanged':
          pendingApprovalsCount = Number(data.count || 0) || 0;
          autoApproveThisRun = !!data.autoApproveThisRun;
          updateApprovalBanner();
          break;
        case 'operationUpdate':
          if (currentOperation && data.operation && data.operation.id === currentOperation.id) {
            currentOperation = { ...currentOperation, ...data.operation };
            updateOperationBanner();
          }
          break;
        case 'operationEnd':
          if (currentOperation && data.operation && (!data.operation.id || data.operation.id === currentOperation.id)) {
            endOperation(data.operation.status || 'done', data.operation.label || '');
          }
          break;
        case 'planPending':
          setPlanPending(!!data.value);
          activePlanMessageId = typeof data.planMessageId === 'string' ? data.planMessageId : '';
          rerenderPlanCards();
          break;
        case 'revertState':
          canUndo = !!data.canUndo;
          canRedo = !!data.canRedo;
          updateRevertBar(data.revertState);
          syncInputState();
          break;
		        case 'cleared':
		          messages.innerHTML = '';
		          messages.appendChild(empty);
		          empty.style.display = 'flex';
		          turnEls.clear();
		          activeTurnId = '';
		          messageEls.clear();
		          stepBodies.clear();
		          pendingTokens.clear();
		          lastToolMsg = null;
		          activePlanMessageId = '';
		          currentOperation = null;
		          stopOperationTimer();
		          updateOperationBanner();
		          pendingApprovalsCount = 0;
		          autoApproveThisRun = false;
		          updateApprovalBanner();
		          latestContext = null;
		          closeContextPopover();
		          if (contextIndicator) {
		            contextIndicator.textContent = '';
		            contextIndicator.classList.add('hidden');
		            contextIndicator.classList.remove('warn', 'danger');
		          }
		          currentRevertState = null;
		          updateRevertBar(null);
		          canUndo = false;
		          canRedo = false;
		          setPlanPending(false);
		          syncInputState();
		          break;
        case 'modelChanged':
          currentModel = data.model;
          updateModelHeader({
            model: data.model || '',
            label: data.label || data.model || 'Pick model',
            isFavorite: !!data.isFavorite,
          });
          break;
        case 'modelState':
          updateModelHeader({
            model: data.model || currentModel || '',
            label: data.label || data.model || currentModel || 'Pick model',
            isFavorite: !!data.isFavorite,
          });
          break;
        case 'modeChanged':
          setMode(data.mode || 'build');
          break;
        case 'turnStatus':
          if (data.turnId && data.status) {
            const turnData = turnEls.get(data.turnId);
            if (turnData) {
              if (data.status.type === 'retry') {
                turnData.statusText.textContent = 'Retrying: ' + (data.status.message || 'error');
                turnData.retryInfo = {
                  attempt: data.status.attempt,
                  nextRetryTime: data.status.nextRetryTime,
                  message: data.status.message,
                };
                startRetryCountdown(turnData);
              } else if (data.status.type === 'paused') {
                turnData.statusText.textContent = 'Paused (' + (data.status.reason || 'permission denied') + ')';
                turnData.currentStatus = '';
                if (turnData.statusTimeout) {
                  clearTimeout(turnData.statusTimeout);
                  turnData.statusTimeout = null;
                }
              } else if (data.status.type === 'running') {
                const newStatus = (data.status.message && data.status.message.trim()) ? data.status.message : 'Thinking…';
                if (newStatus !== turnData.currentStatus) {
                  const now = Date.now();
                  const timeSinceShow = now - turnData.statusShowTime;
                  if (turnData.statusShowTime > 0 && timeSinceShow < 1000) {
                    turnData.statusTimeout = setTimeout(() => {
                      turnData.currentStatus = newStatus;
                      turnData.statusText.textContent = newStatus;
                      turnData.statusShowTime = Date.now();
                      turnData.statusTimeout = null;
                    }, 1000 - timeSinceShow);
                  } else {
                    turnData.currentStatus = newStatus;
                    turnData.statusText.textContent = newStatus;
                    turnData.statusShowTime = now;
                  }
                }
                turnData.retryInfo = null;
              } else if (data.status.type === 'done') {
                turnData.statusText.textContent = '';
                turnData.currentStatus = '';
                if (turnData.statusTimeout) {
                  clearTimeout(turnData.statusTimeout);
                  turnData.statusTimeout = null;
                }
                turnData.retryInfo = null;
              } else if (data.status.type === 'error') {
                turnData.statusText.textContent = 'Error: ' + (data.status.message || 'unknown error');
                turnData.currentStatus = '';
                if (turnData.statusTimeout) {
                  clearTimeout(turnData.statusTimeout);
                  turnData.statusTimeout = null;
                }
                turnData.retryInfo = null;
              }

              if (turnData.statusText.textContent.trim()) {
                turnData.statusBar.style.display = 'flex';
                if (turnData.spinner) {
                  turnData.spinner.style.display = data.status.type === 'running' || data.status.type === 'retry' ? '' : 'none';
                }
              } else if (!turnData.isProcessing) {
                turnData.statusBar.style.display = 'none';
              }
            }
          }
          break;
        case 'setInput':
          input.value = String(data.value || '');
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 120) + 'px';
          clearInputBtn.disabled = !input.value.trim();
          input.focus();
          break;
      }
	      } catch (err) {
	        showFatalError(err);
	        try { vscode.postMessage({ type: 'webviewError', error: String(err && (err.stack || err.message) || err) }); } catch {}
	      }
	    });

		    syncInputState();
		    vscode.postMessage({ type: 'ready', clientInstanceId });
