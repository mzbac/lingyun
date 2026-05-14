import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { fileURLToPath } from 'url';
import * as vscode from 'vscode';

import { WEBVIEW_MESSAGE_ERROR, WEBVIEW_MESSAGE_READY } from '../../ui/chat/webviewProtocol';
import { createStandaloneChatController } from './chatControllerHarness';

type ExtractedScript = {
  label: string;
  source: string;
};

function createMockElement(id = '', onCreate?: () => void): any {
  onCreate?.();
  const listeners = new Map<string, Array<(event: any) => void>>();
  const classes = new Set<string>();
  const element: any = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    dataset: {},
    style: {},
    children: [],
    firstChild: null,
    disabled: false,
    checked: false,
    rows: 0,
    scrollHeight: 0,
    classList: {
      add: (...names: string[]) => names.forEach(name => classes.add(name)),
      remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force?: boolean) => {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return enabled;
      },
    },
    appendChild(child: any) {
      if (child && child.__isFragment) {
        this.children.push(...child.children);
      } else {
        this.children.push(child);
      }
      this.firstChild = this.children[0] || null;
      return child;
    },
    insertBefore(child: any) {
      this.children.unshift(child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    replaceChildren(...children: any[]) {
      this.children = children;
      this.firstChild = children[0] || null;
    },
    setAttribute(name: string, value: unknown) {
      this[name] = String(value);
    },
    getAttribute(name: string) {
      return this[name];
    },
    removeAttribute(name: string) {
      delete this[name];
    },
    addEventListener(type: string, callback: (event: any) => void) {
      const existing = listeners.get(type) || [];
      existing.push(callback);
      listeners.set(type, existing);
    },
    removeEventListener(type: string, callback: (event: any) => void) {
      listeners.set(type, (listeners.get(type) || []).filter(item => item !== callback));
    },
    dispatchEvent(event: any) {
      for (const callback of listeners.get(event.type) || []) {
        callback(event);
      }
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus: () => {},
    blur: () => {},
    scrollIntoView: () => {},
  };
  return element;
}

function createMockBrowserContext(): {
  context: any;
  elements: Map<string, any>;
  posted: any[];
  getCreatedCount: () => number;
} {
  const elements = new Map<string, any>();
  const posted: any[] = [];
  let createdCount = 0;
  const create = (id = '') => createMockElement(id, () => { createdCount++; });
  const document: any = {
    body: create('body'),
    activeElement: null,
    createElement: (tag: string) => create(tag),
    createDocumentFragment: () => {
      const fragment = create('fragment');
      fragment.__isFragment = true;
      return fragment;
    },
    createTextNode: (text: unknown) => ({ textContent: String(text) }),
    getElementById: (id: string) => {
      let element = elements.get(id);
      if (!element) {
        element = create(id);
        elements.set(id, element);
      }
      return element;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const browserWindow: any = {
    document,
    LINGYUN_CHAT_PROTOCOL: {
      ready: WEBVIEW_MESSAGE_READY,
      initAck: 'webviewInitAck',
      webviewError: WEBVIEW_MESSAGE_ERROR,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const context: any = {
    window: browserWindow,
    document,
    console,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => posted.push(message) }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    performance: { now: () => 0 },
    Blob: function Blob() {},
    FileReader: function FileReader() {},
  };
  context.globalThis = context;
  browserWindow.window = browserWindow;
  browserWindow.globalThis = context;

  return {
    context,
    elements,
    posted,
    getCreatedCount: () => createdCount,
  };
}

function runScriptsInMockBrowser(scripts: ExtractedScript[], context: any): void {
  for (const script of scripts) {
    vm.runInNewContext(script.source, context, { filename: script.label });
  }
}

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

  test('ordered classic scripts run startup sync against a browser-like global', () => {
    const controller = createStandaloneChatController();
    const webview = {
      cspSource: 'test-csp',
      asWebviewUri: (uri: unknown) => uri,
    } as unknown as vscode.Webview;

    const html = controller.webviewApi.getHtml(webview);
    const scripts = extractOrderedScriptSources(html);
    const { context, posted } = createMockBrowserContext();

    assert.doesNotThrow(() => {
      runScriptsInMockBrowser(scripts, context);
    }, 'expected webview startup scripts to run without ReferenceError');
    assert.ok(posted.some(message => message && message.type === WEBVIEW_MESSAGE_READY));
    assert.ok(!posted.some(message => message && message.type === WEBVIEW_MESSAGE_ERROR));
  });

  test('composer exposes image attachment controls', () => {
    const controller = createStandaloneChatController();
    const webview = {
      cspSource: 'test-csp',
      asWebviewUri: (uri: unknown) => uri,
    } as unknown as vscode.Webview;

    const html = controller.webviewApi.getHtml(webview);
    const scripts = extractOrderedScriptSources(html);
    const bootstrap = scripts.find(script => script.label === 'bootstrap.js')?.source || '';

    assert.match(html, /id="attachImageButton"/);
    assert.match(html, /\bid="imageFileInput"[^>]*\baccept="image\/\*"/);
    assert.match(html, /\.input-attachment-thumb\b/);
    assert.match(bootstrap, /function attachImageFiles\(/);
    assert.match(bootstrap, /inputComposer\.addEventListener\('drop'/);
  });

  test('composer exposes goal command affordances', () => {
    const controller = createStandaloneChatController();
    const webview = {
      cspSource: 'test-csp',
      asWebviewUri: (uri: unknown) => uri,
    } as unknown as vscode.Webview;

    const html = controller.webviewApi.getHtml(webview);
    const scripts = extractOrderedScriptSources(html);
    const bootstrap = scripts.find(script => script.label === 'bootstrap.js')?.source || '';

    assert.match(html, /id="goalCommandSuggestion"/);
    assert.match(html, /id="goalCommandInsert"/);
    assert.match(html, /placeholder="Describe a task or type \/goal <objective>"/);
    assert.match(bootstrap, /function insertGoalCommand\(/);
    assert.match(bootstrap, /function updateGoalCommandSuggestion\(/);
  });

  test('queue renderer skips duplicate DOM rebuilds for identical queue state', () => {
    const controller = createStandaloneChatController();
    const webview = {
      cspSource: 'test-csp',
      asWebviewUri: (uri: unknown) => uri,
    } as unknown as vscode.Webview;

    const html = controller.webviewApi.getHtml(webview);
    const scripts = extractOrderedScriptSources(html);
    const { context, elements, posted, getCreatedCount } = createMockBrowserContext();
    runScriptsInMockBrowser(scripts, context);

    assert.strictEqual(typeof context.setQueueState, 'function');
    const queuedInputs = [{ id: 'q1', displayContent: 'queued message preview', attachmentCount: 1 }];
    const before = getCreatedCount();
    context.setQueueState(queuedInputs);
    const afterFirst = getCreatedCount();
    context.setQueueState(queuedInputs);
    const afterSecond = getCreatedCount();
    const queueItems = elements.get('queueItems');

    assert.strictEqual(queueItems?.children.length, 1);
    assert.ok(afterFirst > before, 'expected first queue render to create DOM nodes');
    assert.strictEqual(afterSecond, afterFirst, 'expected duplicate queue state to skip DOM creation');
    assert.ok(!posted.some(message => message && message.type === WEBVIEW_MESSAGE_ERROR));
  });

  test('send button presentation skips duplicate DOM rebuilds for identical input state', () => {
    const controller = createStandaloneChatController();
    const webview = {
      cspSource: 'test-csp',
      asWebviewUri: (uri: unknown) => uri,
    } as unknown as vscode.Webview;

    const html = controller.webviewApi.getHtml(webview);
    const scripts = extractOrderedScriptSources(html);
    const { context, elements, posted, getCreatedCount } = createMockBrowserContext();
    runScriptsInMockBrowser(scripts, context);

    assert.strictEqual(typeof context.syncInputState, 'function');
    const send = elements.get('send');
    assert.strictEqual(send?.children.length, 2);
    const before = getCreatedCount();
    context.syncInputState();
    const afterFirst = getCreatedCount();
    context.syncInputState();
    const afterSecond = getCreatedCount();

    assert.strictEqual(afterFirst, before, 'expected unchanged send button state to reuse existing nodes');
    assert.strictEqual(afterSecond, before, 'expected duplicate send button state to skip DOM creation');
    assert.ok(!posted.some(message => message && message.type === WEBVIEW_MESSAGE_ERROR));
  });
});
