import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { fileURLToPath } from 'url';
import * as vscode from 'vscode';

import { createStandaloneChatController } from './chatControllerHarness';

type ExtractedScript = {
  label: string;
  source: string;
};

function extractOrderedScriptSources(html: string): ExtractedScript[] {
  const scripts: ExtractedScript[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const srcMatch = attrs.match(/\bsrc="([^"]+)"/i);

    if (srcMatch) {
      const scriptUrl = srcMatch[1];
      const filePath = scriptUrl.startsWith('file://') ? fileURLToPath(scriptUrl) : scriptUrl;
      scripts.push({
        label: path.basename(filePath),
        source: fs.readFileSync(filePath, 'utf8'),
      });
      continue;
    }

    if (body.trim()) {
      scripts.push({
        label: 'inline-bootstrap',
        source: body,
      });
    }
  }

  return scripts;
}

suite('Chat Webview Assets', () => {
  test('ordered classic scripts from getHtml parse together as one program', () => {
    const controller = createStandaloneChatController();
    const webview = {
      cspSource: 'test-csp',
      asWebviewUri: (uri: unknown) => uri,
    } as unknown as vscode.Webview;

    const html = controller.webviewApi.getHtml(webview);
    const scripts = extractOrderedScriptSources(html);

    assert.deepStrictEqual(
      scripts.map(script => script.label),
      [
        'inline-bootstrap',
        'bootstrap.js',
        'render-utils.js',
        'render-messages.js',
        'context.js',
        'main.js',
      ],
      'expected the real webview script load order from getHtml()'
    );

    const combinedSource = scripts
      .map(script => `// ${script.label}\n${script.source}`)
      .join('\n;\n');

    assert.doesNotThrow(
      () => new vm.Script(combinedSource, { filename: 'chat-webview-classic-scripts.js' }),
      'expected the ordered classic scripts to parse together without top-level collisions'
    );
  });
});
