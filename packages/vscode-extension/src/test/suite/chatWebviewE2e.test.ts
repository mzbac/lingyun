/**
 * Real-DOM end-to-end tests for the chat webview, executed inside the extension
 * dev host via @vscode/test-electron.
 *
 * These drive the actual rendered UI (Chromium DOM inside the webview) instead
 * of mocking it, verifying that the chat panel is usable and responsive:
 * - the composer, send/clear/stop controls, mode toggle, session selector and
 *   model picker render and respond to real interaction
 * - user interaction round-trips through the extension host (e.g. mode toggle
 *   persists `lingyun.mode` and updates `aria-pressed`)
 * - the transcript renders messages through the real renderer channel and
 *   stays scrollable without horizontal overflow at the current panel width
 *
 * The DOM bridge (`__testEval` / `__testEvalResult`) is only enabled when the
 * extension host runs in `ExtensionMode.Test` (see `getHtml` and the renderer
 * guard in `media/chat/main.js`); production webviews ignore it.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  getChatWebviewHandshakeStateForTesting,
  getChatWebviewTestHarnessForTesting,
} from '../../extension';

type WebviewTestHarness = NonNullable<ReturnType<typeof getChatWebviewTestHarnessForTesting>>;

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Awaits a VS Code `Thenable` and swallows errors (Thenable lacks `.catch`). */
function settle<T>(promise: Thenable<T>): Promise<void> {
  return Promise.resolve(promise).then(() => undefined, () => undefined);
}

async function waitFor(
  predicate: () => boolean,
  describeState: () => string,
  timeoutMs = 20_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms: ${describeState()}`);
    }
    await delay(50);
  }
}

/** Evaluates `expression` in the webview until it returns a truthy value. */
async function waitForEval(
  harness: WebviewTestHarness,
  expression: string,
  timeoutMs = 20_000,
): Promise<unknown> {
  const start = Date.now();
  for (;;) {
    const value = await harness.evaluateInWebview(expression);
    if (value) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for webview expression: ${expression}`);
    }
    await delay(100);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object', 'expected an object result from the webview');
  return value as Record<string, unknown>;
}

suite('Chat Webview E2E', () => {
  let harness: WebviewTestHarness;

  suiteSetup(async function () {
    this.timeout(60_000);

    const ext = vscode.extensions.getExtension('mzbac.lingyun');
    assert.ok(ext, 'expected LingYun extension to be installed in the test host');
    await ext.activate();

    await vscode.commands.executeCommand('lingyun.openAgent');

    await waitFor(
      () => {
        const state = getChatWebviewHandshakeStateForTesting();
        return state.hasView && state.visible;
      },
      () => `chat view did not become visible: ${JSON.stringify(getChatWebviewHandshakeStateForTesting())}`,
    );

    await waitFor(
      () => {
        const state = getChatWebviewHandshakeStateForTesting();
        return state.initAcked && !!state.webviewClientInstanceId;
      },
      () => `chat webview handshake did not complete: ${JSON.stringify(getChatWebviewHandshakeStateForTesting())}`,
    );

    const testHarness = getChatWebviewTestHarnessForTesting();
    assert.ok(testHarness, 'expected the webview test harness after opening the chat view');
    harness = testHarness;

    // Wait until the renderer has built the composer DOM.
    await waitForEval(harness, `!!document.getElementById('input') && !!document.getElementById('send')`);
  });

  suiteTeardown(async function () {
    this.timeout(20_000);
    await settle(vscode.commands.executeCommand('workbench.view.explorer'));
  });

  teardown(async function () {
    this.timeout(15_000);
    // Reset the transcript and composer so tests are order-independent.
    harness.postMessage({ type: 'cleared' });
    await harness.evaluateInWebview(`(() => {
      const input = document.getElementById('input');
      if (input && input.value !== '') {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`).catch(() => undefined);
  });

  test('renders a usable composer with core controls and no crash banner', async () => {
    const state = asRecord(
      await harness.evaluateInWebview(`(() => {
        const input = document.getElementById('input');
        const send = document.getElementById('send');
        const clearBtn = document.getElementById('clearInput');
        const stop = document.getElementById('stop');
        const empty = document.getElementById('empty');
        const messages = document.getElementById('messages');
        const sessionSelect = document.getElementById('sessionSelect');
        const modelPicker = document.getElementById('modelPicker');
        const modeBuild = document.getElementById('modeBuild');
        const modePlan = document.getElementById('modePlan');
        const alert = document.querySelector('[role="alert"]');
        return {
          hasInput: input instanceof HTMLTextAreaElement,
          inputDisabled: !!input && input.disabled,
          hasSend: !!send,
          sendDisabled: !!send && send.disabled,
          clearDisabled: !!clearBtn && clearBtn.disabled,
          stopHidden: !!stop && stop.classList.contains('hidden'),
          emptyVisible: !!empty && empty.style.display !== 'none',
          messageCount: messages ? messages.querySelectorAll('.message').length : -1,
          hasSessionSelect: !!sessionSelect,
          sessionOptions: sessionSelect ? sessionSelect.options.length : 0,
          hasModelPicker: !!modelPicker,
          modelPickerLoading: !!modelPicker && /Loading/.test(modelPicker.textContent || ''),
          buildPressed: modeBuild ? modeBuild.getAttribute('aria-pressed') : null,
          planPressed: modePlan ? modePlan.getAttribute('aria-pressed') : null,
          fatalBanner: !!alert && alert.textContent.indexOf('LingYun webview crashed') >= 0,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      })()`),
    );

    assert.strictEqual(state.hasInput, true, 'expected a composer textarea');
    assert.strictEqual(state.inputDisabled, false, 'composer must not be disabled at rest');
    assert.strictEqual(state.hasSend, true, 'expected a send button');
    assert.strictEqual(state.sendDisabled, true, 'send must start disabled with an empty composer');
    assert.strictEqual(state.clearDisabled, true, 'clear input must start disabled');
    assert.strictEqual(state.stopHidden, true, 'stop button should be hidden when idle');
    assert.strictEqual(state.emptyVisible, true, 'empty state should be visible with no messages');
    assert.strictEqual(state.messageCount, 0, 'transcript should start empty');
    assert.ok(state.hasSessionSelect, 'expected a session selector');
    assert.ok((state.sessionOptions as number) >= 1, 'session selector should list at least the active session');
    assert.ok(state.hasModelPicker, 'expected a model picker');
    assert.strictEqual(state.modelPickerLoading, false, 'model picker should not be stuck on "Loading" after init');
    assert.strictEqual(state.buildPressed, 'true', 'build mode should be active by default');
    assert.strictEqual(state.planPressed, 'false', 'plan mode should be inactive by default');
    assert.strictEqual(state.fatalBanner, false, 'webview must not have crashed');
    assert.ok((state.clientWidth as number) > 0, 'expected a nonzero viewport width');
    assert.ok(
      (state.scrollWidth as number) <= (state.clientWidth as number),
      'webview must not overflow horizontally at rest',
    );
  });

  test('typing enables send/clear and clearing restores the idle state', async () => {
    const typed = asRecord(
      await harness.evaluateInWebview(`(() => {
        const input = document.getElementById('input');
        input.value = 'e2e composer input';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const send = document.getElementById('send');
        const clearBtn = document.getElementById('clearInput');
        return { sendDisabled: send.disabled, clearDisabled: clearBtn.disabled, value: input.value };
      })()`),
    );
    assert.strictEqual(typed.value, 'e2e composer input', 'typing should update the composer value');
    assert.strictEqual(typed.sendDisabled, false, 'send should enable once text is entered');
    assert.strictEqual(typed.clearDisabled, false, 'clear should enable once text is entered');

    await harness.evaluateInWebview(
      `(() => { document.getElementById('clearInput').click(); return true; })()`,
    );

    const cleared = asRecord(
      await harness.evaluateInWebview(`(() => {
        const input = document.getElementById('input');
        const send = document.getElementById('send');
        const clearBtn = document.getElementById('clearInput');
        return { value: input.value, sendDisabled: send.disabled, clearDisabled: clearBtn.disabled };
      })()`),
    );
    assert.strictEqual(cleared.value, '', 'clear input should empty the composer');
    assert.strictEqual(cleared.sendDisabled, true, 'send should disable after clearing');
    assert.strictEqual(cleared.clearDisabled, true, 'clear should disable after clearing');
  });

  test('mode toggle round-trips through the extension host and persists the setting', async function () {
    this.timeout(40_000);

    const config = vscode.workspace.getConfiguration('lingyun');
    // NOTE: assert persistence via `inspect().globalValue`, not `config.get()`.
    // A `WorkspaceConfiguration` captures its data snapshot when
    // `getConfiguration()` is called, so the same object's `get('mode')` keeps
    // returning the pre-update value after `config.update()` (VS Code
    // semantics, in tests and production alike). `inspect()` reads live data
    // and is what proves the extension actually wrote the setting.
    const previousMode = config.inspect<string>('mode')?.globalValue;

    try {
      await harness.evaluateInWebview(
        `(() => { document.getElementById('modePlan').click(); return true; })()`,
      );

      await waitForEval(
        harness,
        `(() => {
          const el = document.getElementById('modePlan');
          return el && el.getAttribute('aria-pressed') === 'true' ? true : null;
        })()`,
      );
      await waitFor(
        () => config.inspect<string>('mode')?.globalValue === 'plan',
        () => `lingyun.mode did not persist as plan (inspect: ${JSON.stringify(config.inspect('mode'))})`,
      );
      assert.strictEqual(config.inspect<string>('mode')?.globalValue, 'plan', 'mode config should be persisted as plan');

      await harness.evaluateInWebview(
        `(() => { document.getElementById('modeBuild').click(); return true; })()`,
      );

      await waitForEval(
        harness,
        `(() => {
          const el = document.getElementById('modeBuild');
          return el && el.getAttribute('aria-pressed') === 'true' ? true : null;
        })()`,
      );
      await waitFor(
        () => config.inspect<string>('mode')?.globalValue === 'build',
        () => `lingyun.mode did not persist as build (inspect: ${JSON.stringify(config.inspect('mode'))})`,
      );
      assert.strictEqual(
        config.inspect<string>('mode')?.globalValue,
        'build',
        'mode config should be persisted back to build',
      );
    } finally {
      await settle(config.update('mode', previousMode, vscode.ConfigurationTarget.Global));
    }
  });

  test('renders messages with a scrollable transcript and no horizontal overflow', async function () {
    this.timeout(40_000);

    const now = Date.now();
    harness.postMessage({
      type: 'message',
      message: { id: 'e2e-user-1', role: 'user', content: 'Explain the fix for the session wipe.', timestamp: now },
    });
    harness.postMessage({
      type: 'message',
      message: {
        id: 'e2e-assistant-1',
        role: 'assistant',
        content: 'Here is a long explanation that should wrap inside the message bubble and never push the page wider than the webview viewport.',
        timestamp: now + 1,
      },
    });
    for (let i = 0; i < 28; i++) {
      harness.postMessage({
        type: 'message',
        message: { id: `e2e-filler-${i}`, role: 'user', content: `Filler message ${i}`, timestamp: now + 2 + i },
      });
    }

    await waitForEval(
      harness,
      `(() => {
        const messages = document.getElementById('messages');
        if (!messages) return null;
        const user = messages.querySelector('.message.user');
        const assistant = messages.querySelector('.message.assistant');
        return user && assistant && user.textContent.indexOf('Explain the fix') >= 0 &&
          assistant.textContent.indexOf('long explanation') >= 0 ? true : null;
      })()`,
    );

    const layout = asRecord(
      await harness.evaluateInWebview(`(() => {
        const messages = document.getElementById('messages');
        const empty = document.getElementById('empty');
        const composer = document.getElementById('inputComposer');
        const send = document.getElementById('send');
        const userCount = messages.querySelectorAll('.message.user').length;
        const assistantCount = messages.querySelectorAll('.message.assistant').length;
        const composerRect = composer.getBoundingClientRect();
        const sendRect = send.getBoundingClientRect();
        return {
          userCount,
          assistantCount,
          emptyHidden: !!empty && empty.style.display === 'none',
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          transcriptScrollable: messages.scrollHeight > messages.clientHeight,
          composerWithinViewport: composerRect.left >= 0 && composerRect.right <= document.documentElement.clientWidth,
          sendWithinViewport: sendRect.left >= 0 && sendRect.right <= document.documentElement.clientWidth,
          composerWidth: composerRect.width,
        };
      })()`),
    );

    assert.ok((layout.userCount as number) >= 2, 'user messages should render');
    assert.ok((layout.assistantCount as number) >= 1, 'assistant messages should render');
    assert.strictEqual(layout.emptyHidden, true, 'empty state should hide once messages render');
    assert.ok((layout.transcriptScrollable as boolean), 'transcript should be scrollable with many messages');
    assert.ok(
      (layout.scrollWidth as number) <= (layout.clientWidth as number),
      'transcript must not cause horizontal overflow',
    );
    assert.strictEqual(layout.composerWithinViewport, true, 'composer must stay within the viewport width');
    assert.strictEqual(layout.sendWithinViewport, true, 'send button must stay within the viewport width');
    assert.ok((layout.composerWidth as number) > 0, 'composer should have nonzero layout width');
  });

  test('session selector reflects the active session', async () => {
    const state = asRecord(
      await harness.evaluateInWebview(`(() => {
        const select = document.getElementById('sessionSelect');
        return {
          hasSelect: !!select,
          options: select ? select.options.length : 0,
          selectedIndex: select ? select.selectedIndex : -1,
        };
      })()`),
    );
    assert.ok(state.hasSelect, 'expected a session selector');
    assert.ok((state.options as number) >= 1, 'session selector should list the active session');
    assert.ok((state.selectedIndex as number) >= 0, 'session selector should have a selection');
  });
});
