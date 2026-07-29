import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { createAgentBrowserToolProvider, type AgentBrowserRunner } from '../../index.js';

function createToolContext(workspaceRoot: string) {
  const controller = new AbortController();
  return {
    workspaceRoot,
    allowExternalPaths: false,
    sessionId: 'test',
    signal: controller.signal,
    log: () => {},
  };
}

suite('Agent Browser Tools', () => {
  test('browser.snapshot rejects non-https by default', async () => {
    const runner: AgentBrowserRunner = async () => ({ success: true, data: {}, error: null });
    const provider = createAgentBrowserToolProvider({ runner });

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kooka-browser-'));
    const ctx = createToolContext(root);

    const res = await provider.executeTool('browser_snapshot', { sessionId: 's1', url: 'http://example.com' }, ctx);
    assert.strictEqual(res.success, false);
    assert.match(String(res.error), /https/i);
  });

  test('browser.snapshot builds snapshot flags and returns truncated snapshot', async () => {
    const calls: Array<{ args: string[] }> = [];
    const runner: AgentBrowserRunner = async (args) => {
      calls.push({ args });
      if (args.includes('open')) {
        return { success: true, data: { url: 'https://example.com', title: 'Example' }, error: null };
      }
      if (args.includes('snapshot')) {
        return {
          success: true,
          data: { snapshot: '- link "OK" [ref=e1]\n'.repeat(10), refs: { e1: { role: 'link', name: 'OK' } } },
          error: null,
        };
      }
      return { success: true, data: {}, error: null };
    };

    const provider = createAgentBrowserToolProvider({ runner, maxSnapshotChars: 50 });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kooka-browser-'));
    const ctx = createToolContext(root);

    const res = await provider.executeTool(
      'browser_snapshot',
      {
        sessionId: 's1',
        url: 'https://example.com',
        interactive: true,
        compact: true,
        depth: 5,
        selector: '#main',
      },
      ctx
    );

    assert.strictEqual(res.success, true);
    const data = res.data as any;
    assert.ok(typeof data.snapshot === 'string');
    assert.ok(data.snapshot.length <= 50);
    assert.strictEqual(data.refCount, 1);

    assert.deepStrictEqual(calls[0]?.args.slice(0, 4), ['--session', 's1', 'open', 'https://example.com/']);
    assert.ok(calls[1]?.args.includes('snapshot'));
    assert.ok(calls[1]?.args.includes('-i'));
    assert.ok(calls[1]?.args.includes('-c'));
    assert.ok(calls[1]?.args.includes('-d'));
    assert.ok(calls[1]?.args.includes('5'));
    assert.ok(calls[1]?.args.includes('-s'));
    assert.ok(calls[1]?.args.includes('#main'));
  });

  test('browser.snapshot counts own refs without key-array snapshots', async () => {
    const refs = Object.assign(Object.create({ inherited: { role: 'button' } }), {
      e1: { role: 'link', name: 'One' },
      e2: { role: 'button', name: 'Two' },
    });
    const runner: AgentBrowserRunner = async (args) => {
      if (args.includes('snapshot')) {
        return { success: true, data: { snapshot: 'ok', refs }, error: null };
      }
      return { success: true, data: {}, error: null };
    };

    const provider = createAgentBrowserToolProvider({ runner });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kooka-browser-'));
    const ctx = createToolContext(root);

    const res = await provider.executeTool('browser_snapshot', { sessionId: 's1' }, ctx);
    assert.strictEqual(res.success, true);
    assert.strictEqual((res.data as any).refCount, 2);

    const source = await fs.readFile(new URL('../../../src/tools/agentBrowser.ts', import.meta.url), 'utf8');
    const helperStart = source.indexOf('function countOwnEnumerableKeys');
    assert.ok(helperStart >= 0, 'expected own-key count helper');
    const snapshotStart = source.indexOf('private async handleSnapshot', helperStart);
    assert.ok(snapshotStart > helperStart, 'expected snapshot handler after own-key helper');
    const snapshotEnd = source.indexOf('private async handleRun', snapshotStart);
    assert.ok(snapshotEnd > snapshotStart, 'expected browser run handler after snapshot handler');
    const section = source.slice(helperStart, snapshotEnd);

    assert.match(section, /for \(const key in value\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(value, key\)/);
    assert.match(section, /const refCount = countOwnEnumerableKeys\(data\.refs\);/);
    assert.doesNotMatch(section, /Object\.keys/);
  });

  test('browser.run redacts typed text and writes artifacts inside artifactsDir', async () => {
    const calls: Array<{ args: string[] }> = [];
    const runner: AgentBrowserRunner = async (args) => {
      calls.push({ args });
      if (args.includes('get') && args.includes('text')) {
        return { success: true, data: { text: 'hello world' }, error: null };
      }
      return { success: true, data: { ok: true }, error: null };
    };

    const provider = createAgentBrowserToolProvider({ runner, artifactsDir: 'artifacts' });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kooka-browser-'));
    const ctx = createToolContext(root);

    const res = await provider.executeTool(
      'browser_run',
      {
        sessionId: 's1',
        actions: [
          { type: 'open', url: 'https://example.com' },
          { type: 'fill', selector: '@e1', text: 'secret' },
          { type: 'get', kind: 'text', selector: 'body', maxChars: 3 },
          { type: 'screenshot', name: '../../pwn.png', fullPage: true },
        ],
      },
      ctx
    );

    assert.strictEqual(res.success, true);
    const data = res.data as any;

    const fillStep = data.results.find((r: any) => r.action?.type === 'fill');
    assert.ok(fillStep);
    assert.match(String(fillStep.action.text), /redacted/i);

    const getStep = data.results.find((r: any) => r.action?.type === 'get');
    assert.strictEqual(getStep.data.text, 'hel');

    assert.ok(Array.isArray(data.artifacts));
    assert.ok(String(data.artifacts[0]?.path).endsWith('pwn.png'));

    const screenshotCall = calls.find((c) => c.args.includes('screenshot'));
    assert.ok(screenshotCall);
    const screenshotPath = screenshotCall!.args.find((a) => a.endsWith('.png'))!;
    assert.ok(path.isAbsolute(screenshotPath));
    assert.ok(screenshotPath.includes(path.join(root, 'artifacts')));
  });

  test('browser.run validates wait actions without option arrays', async () => {
    const calls: Array<{ args: string[] }> = [];
    const runner: AgentBrowserRunner = async (args) => {
      calls.push({ args });
      return { success: true, data: { ok: true }, error: null };
    };

    const provider = createAgentBrowserToolProvider({ runner });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kooka-browser-'));
    const ctx = createToolContext(root);

    const valid = await provider.executeTool(
      'browser_run',
      { sessionId: 's1', actions: [{ type: 'wait', text: 'Ready' }] },
      ctx
    );
    assert.strictEqual(valid.success, true);
    assert.deepStrictEqual(calls[0]?.args, ['--session', 's1', 'wait', '--text', 'Ready']);

    const invalid = await provider.executeTool(
      'browser_run',
      { sessionId: 's1', actions: [{ type: 'wait', text: 'Ready', url: 'https://example.com' }] },
      ctx
    );
    assert.strictEqual(invalid.success, true);
    assert.deepStrictEqual((invalid.data as any).results[0], {
      index: 0,
      action: { type: 'wait', text: 'Ready', url: 'https://example.com' },
      success: false,
      error: 'wait action must specify exactly one of: ms, selector, text, url, load, fn',
    });
    assert.strictEqual(calls.length, 1, 'invalid wait action should not invoke the browser runner');

    const source = await fs.readFile(new URL('../../../src/tools/agentBrowser.ts', import.meta.url), 'utf8');
    const waitStart = source.indexOf("case 'wait':");
    assert.ok(waitStart >= 0, 'expected wait action mapper');
    const waitEnd = source.indexOf("case 'get':", waitStart);
    assert.ok(waitEnd > waitStart, 'expected get action mapper after wait action mapper');
    const waitSection = source.slice(waitStart, waitEnd);

    assert.match(waitSection, /let configured = 0;/);
    assert.match(waitSection, /if \(ms !== undefined\) configured\+\+;/);
    assert.match(waitSection, /if \(fn\) configured\+\+;/);
    assert.doesNotMatch(waitSection, /\.filter\(Boolean\)/);
    assert.doesNotMatch(waitSection, /\[[^\n]*ms !== undefined[^\n]*\]/);
  });
});
