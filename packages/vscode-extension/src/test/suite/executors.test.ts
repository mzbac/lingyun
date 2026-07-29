import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import { executeHttp } from '../../providers/executors';

function createToolContext(): ToolContext {
  return {
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri,
    activeEditor: vscode.window.activeTextEditor,
    extensionContext: {} as unknown as vscode.ExtensionContext,
    cancellationToken: new vscode.CancellationTokenSource().token,
    progress: { report: () => {} },
    log: () => {},
  };
}

suite('Workspace HTTP executor', () => {
  test('blocks private IPv4 literals before fetch', async () => {
    const blocked = [
      { url: 'http://10.0.0.2/path', error: /10\.x\.x\.x/ },
      { url: 'http://172.16.0.1/path', error: /172\.16-31\.x\.x/ },
      { url: 'http://172.31.255.255/path', error: /172\.16-31\.x\.x/ },
      { url: 'http://192.168.1.5/path', error: /192\.168\.x\.x/ },
      { url: 'http://169.254.1.1/path', error: /link-local/ },
      { url: 'http://127.0.0.2/path', error: /loopback/ },
      { url: 'http://0.1.2.3/path', error: /private or loopback/ },
    ];

    for (const item of blocked) {
      const result = await executeHttp({ type: 'http', url: item.url }, {}, createToolContext());
      assert.strictEqual(result.success, false, item.url);
      assert.match(String(result.error), item.error, item.url);
    }
  });

  test('parses IPv4 literals without allocation-heavy map chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/providers/executors.ts'), 'utf8');
    const ipv4Start = source.indexOf('function parseIPv4Octet');
    assert.ok(ipv4Start >= 0, 'expected IPv4 octet parser');
    const ipv4End = source.indexOf('\nfunction isPrivateIPv6Address', ipv4Start);
    assert.ok(ipv4End > ipv4Start, 'expected IPv6 parser after IPv4 parser');
    const ipv4Section = source.slice(ipv4Start, ipv4End);

    assert.match(ipv4Section, /charCodeAt/);
    assert.match(ipv4Section, /function classifyIPv4Address/);
    assert.doesNotMatch(ipv4Section, /split\('\.'\)\.map/);
    assert.doesNotMatch(ipv4Section, /\.some\(/);

    const urlStart = source.indexOf('function validateHttpUrl');
    assert.ok(urlStart >= 0, 'expected HTTP URL validator');
    const urlEnd = source.indexOf('\nexport async function executeHttp', urlStart);
    assert.ok(urlEnd > urlStart, 'expected executeHttp after HTTP URL validator');
    const urlSection = source.slice(urlStart, urlEnd);

    assert.match(urlSection, /switch \(classifyIPv4Address\(hostname\)\)/);
    assert.match(urlSection, /url\.protocol !== 'http:' && url\.protocol !== 'https:'/);
    assert.doesNotMatch(urlSection, /\['http:', 'https:'\]\.includes/);
    assert.doesNotMatch(urlSection, /hostname\.match/);
    assert.doesNotMatch(urlSection, /slice\(1\)\.map/);
    assert.doesNotMatch(urlSection, /localhostPatterns/);
    assert.doesNotMatch(urlSection, /metadataHosts/);
  });
});
