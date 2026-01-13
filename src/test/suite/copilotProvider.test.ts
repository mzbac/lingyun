import * as assert from 'assert';
import * as vscode from 'vscode';

import { CopilotProvider } from '../../providers/copilot';

suite('CopilotProvider', () => {
  test('uses dynamic VS Code + extension version headers', async () => {
    const provider = new CopilotProvider();

    // Avoid auth/network in tests.
    (provider as any).getCopilotToken = async () => 'test-token';

    await provider.getModel('gpt-4o');

    assert.strictEqual((provider as any).cachedProviderEditorVersion, `vscode/${vscode.version}`);

    const ext = vscode.extensions.getExtension('mzbac.lingyun');
    assert.ok(ext, 'Expected mzbac.lingyun extension to be available during tests');
    assert.strictEqual((provider as any).cachedProviderPluginVersion, `lingyun/${ext.packageJSON.version}`);
  });

  test('clears cached client and token after auth-like errors', () => {
    const provider = new CopilotProvider();

    (provider as any).copilotToken = 'stale-token';
    (provider as any).tokenExpiry = Date.now() + 60_000;
    (provider as any).cachedProviderToken = 'stale-token';
    (provider as any).provider = { fake: true };

    provider.onRequestError?.(new Error('401 Unauthorized'), { modelId: 'gpt-4o', mode: 'plan' });

    assert.strictEqual((provider as any).provider, null);
    assert.strictEqual((provider as any).cachedProviderToken, null);
    assert.strictEqual((provider as any).copilotToken, null);
    assert.strictEqual((provider as any).tokenExpiry, 0);
  });
});

