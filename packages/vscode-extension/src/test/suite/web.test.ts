/**
 * Web Tools Tests
 *
 * Comprehensive unit tests for the Chrome/CDP web tools. Covers the pure
 * helpers, extractor JS, tool definitions, handler guard rails, and the
 * page-cache/formatting/paging logic. No Chrome is required:
 * browser-launching behavior is guarded behind the no-tab /
 * argument-validation errors, and the page-cache seam is tested with
 * in-memory sessions.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

import type { ToolContext } from '../../core/types';
import {
  CLICK_CONSENT_JS,
  EXTRACT_PAGE_JS,
  PAGE_CACHE_MAX,
  SCROLL_DYNAMIC_PAGE_JS,
  SEARCH_EXTRACT_JS,
  WEB_HEAD_BYTES,
  WEB_HEAD_LINES,
  clickSelectorJs,
  countLines,
  discoverChromeExecutable,
  formatPageOutput,
  formatPageReadOutput,
  googleSearchHandler,
  googleSearchTool,
  headOf,
  jsonGetString,
  pngDimensions,
  storePage,
  typeSelectorJs,
  urlEncode,
  visitPageHandler,
  visitPageTool,
  webClickHandler,
  webClickTool,
  webReadHandler,
  webReadTool,
  webScreenshotHandler,
  webScreenshotTool,
  webTypeHandler,
  webTypeTool,
  type PageCacheEntry,
  type WebSession,
} from '../../tools/builtin/web';

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

function createSession(): WebSession {
  return {
    port: 9333,
    profileDir: '/tmp/lingyun-web-test',
    chromePid: null,
    tab: null,
    pageSeq: 0,
    pages: new Map(),
  };
}

function createPageEntry(lines: string[]): PageCacheEntry {
  const markdown = lines.join('\n');
  return { url: 'https://example.com', markdown, lines: countLines(markdown) };
}

suite('Web Tools - JSON + URL helpers', () => {
  test('jsonGetString extracts values', () => {
    const json = JSON.stringify({
      webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/browser/abc',
      targetId: 'ABC123',
    });
    assert.strictEqual(
      jsonGetString(json, 'webSocketDebuggerUrl'),
      'ws://127.0.0.1:9333/devtools/browser/abc',
    );
    assert.strictEqual(jsonGetString(json, 'targetId'), 'ABC123');
  });

  test('jsonGetString returns null for missing keys', () => {
    assert.strictEqual(jsonGetString('{"a":"1"}', 'b'), null);
    assert.strictEqual(jsonGetString('{"a": 1}', 'a'), null); // non-string value
    assert.strictEqual(jsonGetString('', 'a'), null);
    assert.strictEqual(jsonGetString('not json', 'a'), null);
  });

  test('jsonGetString handles escaped strings', () => {
    const json = '{"a":"line\\nbreak\\ttab\\rret\\"quote\\\\slash\\/slash\\b\\f"}';
    assert.strictEqual(
      jsonGetString(json, 'a'),
      'line\nbreak\ttab\rret"quote\\slash/slash\b\f',
    );
  });

  test('jsonGetString does not match keys inside values or longer keys', () => {
    // "b" appears inside a string value but is not followed by ':'.
    assert.strictEqual(jsonGetString('{"a":"contains \\"b\\" inside"}', 'b'), null);
    // "url" must not match the longer key "url2".
    assert.strictEqual(jsonGetString('{"url":"a","url2":"b"}', 'url'), 'a');
    assert.strictEqual(jsonGetString('{"url":"a","url2":"b"}', 'url2'), 'b');
  });

  test('urlEncode encodes reserved characters and preserves unreserved ones', () => {
    assert.strictEqual(urlEncode('hello world'), 'hello%20world');
    assert.strictEqual(urlEncode('a-b_c.d~'), 'a-b_c.d~');
    assert.strictEqual(urlEncode('?&='), '%3F%26%3D');
    assert.strictEqual(urlEncode('中文'), '%E4%B8%AD%E6%96%87');
  });
});

suite('Web Tools - headOf + countLines', () => {
  test('headOf returns whole short text untruncated', () => {
    const text = ['line 1', 'line 2', 'line 3'].join('\n');
    assert.deepStrictEqual(headOf(text, 100, 8192), {
      head: text,
      lines: 3,
      byteLimited: false,
    });
  });

  test('headOf truncates by line count', () => {
    const text = ['a', 'b', 'c', 'd', 'e'].join('\n');
    const { head, lines, byteLimited } = headOf(text, 2, 8192);
    assert.strictEqual(lines, 2);
    // headOf includes the newline that completes the Nth line.
    assert.strictEqual(head, 'a\nb\n');
    assert.strictEqual(byteLimited, false);
  });

  test('headOf truncates by byte budget', () => {
    const { head, lines, byteLimited } = headOf('abcdefghij', 100, 4);
    assert.strictEqual(byteLimited, true);
    assert.strictEqual(head, 'abcd');
    assert.strictEqual(lines, 1);
  });

  test('headOf handles empty input and no trailing newline', () => {
    assert.deepStrictEqual(headOf('', 100, 8192), { head: '', lines: 0, byteLimited: false });
    const single = headOf('one line', 100, 8192);
    assert.strictEqual(single.lines, 1);
    assert.strictEqual(single.head, 'one line');
    // A line exactly at the byte budget with a trailing newline is not byte-limited.
    const exact = headOf('abcd\n', 100, 5);
    assert.strictEqual(exact.byteLimited, false);
  });

  test('countLines counts newline-terminated content', () => {
    assert.strictEqual(countLines(''), 0);
    assert.strictEqual(countLines('one'), 1);
    assert.strictEqual(countLines('a\nb\n'), 2);
    assert.strictEqual(countLines('a\nb'), 2);
    assert.strictEqual(countLines('\n'), 1);
  });
});

suite('Web Tools - Chrome executable discovery', () => {
  const previous = process.env.DS4_CHROME;

  teardown(() => {
    if (previous === undefined) delete process.env.DS4_CHROME;
    else process.env.DS4_CHROME = previous;
  });

  test('honors DS4_CHROME environment override', () => {
    process.env.DS4_CHROME = '/custom/chrome-bin';
    assert.strictEqual(discoverChromeExecutable(), '/custom/chrome-bin');
    process.env.DS4_CHROME = '   ';
    const blank = discoverChromeExecutable();
    assert.ok(blank.length > 0);
    assert.notStrictEqual(blank, ''); // blank override is ignored
  });

  test('falls back to an existing executable or default name', () => {
    delete process.env.DS4_CHROME;
    const exe = discoverChromeExecutable();
    assert.strictEqual(typeof exe, 'string');
    assert.ok(exe.length > 0);
    // Either a real binary was found or the platform default fallback is used.
    assert.ok(fs.existsSync(exe) || exe === 'google-chrome', `unexpected: ${exe}`);
  });
});

suite('Web Tools - extractor JS', () => {
  test('all browser JS strings are syntactically valid', () => {
    for (const js of [SEARCH_EXTRACT_JS, EXTRACT_PAGE_JS, SCROLL_DYNAMIC_PAGE_JS, CLICK_CONSENT_JS]) {
      assert.doesNotThrow(() => new Function(js), `invalid JS: ${js.slice(0, 100)}...`);
    }
  });

  test('search extractor produces Google-result markdown', () => {
    assert.ok(SEARCH_EXTRACT_JS.includes('# Google search results'));
    assert.ok(SEARCH_EXTRACT_JS.includes('## Visible links'));
    assert.ok(SEARCH_EXTRACT_JS.includes('## Text snapshot'));
    // Backslash escaping for link text must be preserved.
    assert.ok(SEARCH_EXTRACT_JS.includes('.replace(/\\\\/g,\'\\\\\\\\\')'));
    // /url?q= redirect unwrapping is present.
    assert.ok(SEARCH_EXTRACT_JS.includes('u.pathname===\'/url\''));
  });

  test('page extractor produces content + visible links markdown', () => {
    assert.ok(EXTRACT_PAGE_JS.includes('## Content'));
    assert.ok(EXTRACT_PAGE_JS.includes('## Visible links'));
    assert.ok(EXTRACT_PAGE_JS.includes('900000'));
    assert.ok(EXTRACT_PAGE_JS.includes('[Content truncated by browser extractor.]'));
    // CODE elements are wrapped in backticks (escape check).
    assert.ok(EXTRACT_PAGE_JS.includes('\\`'));
  });

  test('scroll extractor targets lazy/infinite content', () => {
    assert.ok(SCROLL_DYNAMIC_PAGE_JS.includes('scroll probe unchanged'));
    assert.ok(SCROLL_DYNAMIC_PAGE_JS.includes('getEventListeners'));
    assert.ok(SCROLL_DYNAMIC_PAGE_JS.includes('lazy'));
  });

  test('consent clicker matches common consent buttons', () => {
    assert.ok(CLICK_CONSENT_JS.includes('/accept all/i'));
    assert.ok(CLICK_CONSENT_JS.includes('/i agree/i'));
  });

  test('clickSelectorJs embeds selector JSON-encoded and stays valid', () => {
    const js = clickSelectorJs('a[href="x"]:nth-child(2)');
    assert.doesNotThrow(() => new Function(js));
    assert.ok(js.includes('document.querySelector("a[href=\\"x\\"]:nth-child(2)")'));
    assert.ok(js.includes("el.dispatchEvent(new MouseEvent('click'"));
  });

  test('typeSelectorJs embeds text JSON-encoded and stays valid', () => {
    const tricky = "it's \"quoted\" \\ and\nnewline";
    const js = typeSelectorJs('input[name="q"]', tricky);
    assert.doesNotThrow(() => new Function(js));
    assert.ok(js.includes('new InputEvent(\'input\''));
    assert.ok(js.includes('setter.call(el,'));
  });
});

suite('Web Tools - tool definitions', () => {
  test('browser-touching tools require approval', () => {
    for (const def of [
      googleSearchTool,
      visitPageTool,
      webClickTool,
      webTypeTool,
      webScreenshotTool,
    ]) {
      assert.strictEqual(def.metadata?.requiresApproval, true, `${def.id} should require approval`);
      assert.strictEqual(def.metadata?.permission, 'web', `${def.id} permission`);
      assert.strictEqual(def.metadata?.readOnly, false, `${def.id} is not read-only`);
    }
  });

  test('web_read is read-only and does not require approval', () => {
    assert.strictEqual(webReadTool.metadata?.requiresApproval, false);
    assert.strictEqual(webReadTool.metadata?.permission, 'read');
    assert.strictEqual(webReadTool.metadata?.readOnly, true);
  });

  test('required parameters are declared', () => {
    assert.deepStrictEqual(googleSearchTool.parameters.required, ['query']);
    assert.deepStrictEqual(visitPageTool.parameters.required, ['url']);
    assert.deepStrictEqual(webReadTool.parameters.required, ['page_id']);
    assert.deepStrictEqual(webClickTool.parameters.required, ['selector']);
    assert.deepStrictEqual(webTypeTool.parameters.required, ['selector', 'text']);
    assert.deepStrictEqual(webScreenshotTool.parameters.required, []);
  });
});

suite('Web Tools - handler guard rails (no Chrome)', () => {
  test('google_search rejects a missing query', async () => {
    const result = await googleSearchHandler({}, createToolContext());
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('query'));
  });

  test('visit_page rejects a missing url', async () => {
    const result = await visitPageHandler({}, createToolContext());
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('url'));
  });

  test('web_read rejects a missing page_id', async () => {
    const result = await webReadHandler({}, createToolContext());
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('page_id'));
  });

  test('web_read rejects an unknown page_id', async () => {
    const result = await webReadHandler({ page_id: 'p999' }, createToolContext());
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('Unknown page_id'));
    assert.strictEqual((result.metadata as { errorType?: string } | undefined)?.errorType, 'web_unknown_page');
  });

  test('web_click rejects a missing selector', async () => {
    const result = await webClickHandler({}, createToolContext());
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('selector'));
  });

  test('web_click requires an existing tab', async () => {
    const result = await webClickHandler({ selector: 'a' }, createToolContext());
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('google_search or visit_page'));
    assert.strictEqual((result.metadata as { errorType?: string } | undefined)?.errorType, 'web_no_tab');
  });

  test('web_type rejects missing args and requires a tab', async () => {
    const noSelector = await webTypeHandler({ text: 'x' }, createToolContext());
    assert.strictEqual(noSelector.success, false);
    assert.ok(noSelector.error?.includes('selector'));

    const noText = await webTypeHandler({ selector: 'input' }, createToolContext());
    assert.strictEqual(noText.success, false);
    assert.ok(noText.error?.includes('text'));

    const noTab = await webTypeHandler({ selector: 'input', text: 'x' }, createToolContext());
    assert.strictEqual(noTab.success, false);
    assert.strictEqual((noTab.metadata as { errorType?: string } | undefined)?.errorType, 'web_no_tab');
  });

  test('web_screenshot requires an existing tab', async () => {
    const result = await webScreenshotHandler({}, createToolContext());
    assert.strictEqual(result.success, false);
    assert.strictEqual((result.metadata as { errorType?: string } | undefined)?.errorType, 'web_no_tab');
  });
});

suite('Web Tools - page cache + output formatting', () => {
  test('storePage assigns sequential ids and counts lines', () => {
    const session = createSession();
    assert.strictEqual(storePage(session, 'https://a', 'one\ntwo\n'), 'p1');
    assert.strictEqual(storePage(session, 'https://b', 'x'), 'p2');
    assert.strictEqual(session.pages.get('p1')?.lines, 2);
    assert.strictEqual(session.pages.get('p2')?.lines, 1);
    assert.strictEqual(session.pages.get('p2')?.url, 'https://b');
  });

  test('storePage evicts the oldest entry past the cache cap', () => {
    const session = createSession();
    for (let i = 1; i <= PAGE_CACHE_MAX + 1; i++) {
      storePage(session, `https://page-${i}`, `content ${i}`);
    }
    assert.strictEqual(session.pages.size, PAGE_CACHE_MAX);
    assert.ok(!session.pages.has('p1'), 'oldest page should be evicted');
    assert.ok(session.pages.has(`p${PAGE_CACHE_MAX + 1}`));
  });

  test('formatPageOutput wraps small pages in <markdown> without caching', () => {
    const session = createSession();
    const markdown = '# Title\n\nHello world';
    const { data, outputText } = formatPageOutput('visit_page', 'https://example.com', markdown, session);
    assert.strictEqual(data, outputText);
    assert.ok(outputText.startsWith('<markdown>'));
    assert.ok(outputText.endsWith('</markdown>'));
    assert.ok(outputText.includes('Hello world'));
    assert.ok(!outputText.includes('page_id='));
    assert.strictEqual(session.pages.size, 0);
  });

  test('formatPageOutput heads large pages and stores a page_id', () => {
    const session = createSession();
    const markdown = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n');
    const { outputText } = formatPageOutput('visit_page', 'https://example.com', markdown, session);
    assert.ok(outputText.startsWith('visit_page url=https://example.com'));
    assert.ok(outputText.includes('page_id=p1'));
    assert.ok(outputText.includes(`<head -${WEB_HEAD_LINES} lines / ${WEB_HEAD_BYTES} bytes>`));
    assert.ok(outputText.includes('Use web_read page_id=p1 start_line=<line> max_lines=<count>'));
    assert.ok(outputText.includes('line 1'));
    assert.ok(!outputText.includes('line 250')); // head only
    assert.strictEqual(session.pages.get('p1')?.lines, 250);
  });

  test('formatPageReadOutput numbers lines and continues past the head', () => {
    const entry = createPageEntry(Array.from({ length: 120 }, (_, i) => `content ${i + 1}`));
    const output = formatPageReadOutput(entry, 'p1', 100, 25);
    assert.ok(output.startsWith('<page page_id=p1 url=https://example.com>'));
    assert.ok(output.includes('00101| content 101'));
    assert.ok(output.includes('00120| content 120'));
    assert.ok(output.includes('(End of page - total 120 lines)'));
    assert.ok(!output.includes('(Page has more lines'));
  });

  test('formatPageReadOutput reports continuation when lines remain', () => {
    const entry = createPageEntry(Array.from({ length: 50 }, (_, i) => `content ${i + 1}`));
    const output = formatPageReadOutput(entry, 'p7', 0, 10);
    assert.ok(output.includes('00010| content 10'));
    assert.ok(output.includes('(Page has more lines. Use web_read page_id=p7 start_line=10 max_lines=10 to continue.)'));
    assert.ok(!output.includes('(End of page'));
  });

  test('formatPageReadOutput clamps long lines', () => {
    const long = 'x'.repeat(5000);
    const entry = createPageEntry([long]);
    const output = formatPageReadOutput(entry, 'p1', 0, 1);
    assert.ok(output.includes('x'.repeat(2000) + '...'));
    assert.ok(!output.includes('x'.repeat(2001) + 'x'));
  });
});

suite('Web Tools - PNG metadata', () => {
  test('pngDimensions parses a PNG header', () => {
    const buffer = Buffer.alloc(24);
    buffer.writeUInt32BE(0x89504e47, 0); // PNG signature
    buffer.writeUInt32BE(13, 8); // IHDR length
    buffer.write('IHDR', 12);
    buffer.writeUInt32BE(1365, 16); // width
    buffer.writeUInt32BE(900, 20); // height
    assert.deepStrictEqual(pngDimensions(buffer), { width: 1365, height: 900 });
  });

  test('pngDimensions returns zeros for non-PNG or short buffers', () => {
    assert.deepStrictEqual(pngDimensions(Buffer.alloc(0)), { width: 0, height: 0 });
    assert.deepStrictEqual(pngDimensions(Buffer.from('not a png at all')), { width: 0, height: 0 });
    assert.deepStrictEqual(pngDimensions(Buffer.alloc(8)), { width: 0, height: 0 });
  });
});
