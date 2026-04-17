import * as assert from 'assert';
import * as vscode from 'vscode';

import { getChatWebviewHandshakeStateForTesting } from '../../extension';

async function waitFor(
  predicate: () => boolean,
  describeState: () => string,
  timeoutMs = 15_000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms: ${describeState()}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

suite('Chat Webview Smoke', () => {
  test('opening the real chat view completes the renderer handshake', async function () {
    this.timeout(20_000);

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

    const state = getChatWebviewHandshakeStateForTesting();
    assert.strictEqual(state.initAcked, true);
    assert.ok(state.webviewClientInstanceId, 'expected a live webview client instance id');
  });
});
