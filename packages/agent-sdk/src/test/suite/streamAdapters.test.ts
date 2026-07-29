import * as assert from 'assert';
import * as fs from 'node:fs';

import { createStreamAdapter } from '../../agent/streamAdapters.js';
import { buildStreamReplay } from '../../index.js';

suite('streamAdapters', () => {
  test('buildStreamReplay throws on duplicate namespaces', () => {
    assert.throws(
      () =>
        buildStreamReplay({
          text: 'hello',
          reasoning: 'think',
          updates: [
            { namespace: 'copilot', update: { a: 1 } } as any,
            { namespace: 'copilot', update: { b: 2 } } as any,
          ],
        }),
      /Multiple replay updates/i,
    );
  });

  test('buildStreamReplay throws on reserved namespaces', () => {
    assert.throws(
      () =>
        buildStreamReplay({
          text: 'hello',
          reasoning: 'think',
          updates: [{ namespace: 'text', update: { a: 1 } } as any],
        }),
      /reserved/i,
    );
  });

  test('buildStreamReplay throws on empty namespace', () => {
    assert.throws(
      () =>
        buildStreamReplay({
          text: 'hello',
          reasoning: 'think',
          updates: [{ namespace: '   ', update: { a: 1 } } as any],
        }),
      /non-empty namespace/i,
    );
  });

  test('buildStreamReplay throws on empty update', () => {
    assert.throws(
      () =>
        buildStreamReplay({
          text: 'hello',
          reasoning: 'think',
          updates: [{ namespace: 'copilot', update: {} } as any],
        }),
      /non-empty object/i,
    );
  });

  test('stream replay empty-update guards avoid key-array scans', () => {
    const source = fs.readFileSync(new URL('../../../src/agent/streamAdapters.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function hasOwnEnumerableKey');
    assert.ok(start >= 0, 'expected local own-key helper');
    const end = source.indexOf('const NOOP_STREAM_ADAPTER', start);
    assert.ok(end > start, 'expected composed adapter section after own-key helper');
    const section = source.slice(start, end);

    assert.match(section, /for \(const key in value\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(value, key\)/);
    assert.match(section, /!hasOwnEnumerableKey\(update\)/);
    assert.match(section, /!hasOwnEnumerableKey\(value\)/);
    assert.doesNotMatch(section, /Object\.keys/);
  });

  test('single stream adapter dispatches directly while preserving replay validation', () => {
    const adapter = createStreamAdapter({ llmId: 'copilot', modelId: 'gpt-5.4' });
    adapter.onPart({
      type: 'text-delta',
      providerMetadata: {
        copilot: {
          reasoningOpaque: ' opaque-token ',
        },
      },
    } as any);

    assert.deepStrictEqual(adapter.getReplayUpdates(), [
      { namespace: 'copilot', update: { reasoningOpaque: 'opaque-token' } },
    ]);

    const source = fs.readFileSync(new URL('../../../src/agent/streamAdapters.ts', import.meta.url), 'utf8');
    const singleStart = source.indexOf('function wrapSingleStreamAdapter');
    assert.ok(singleStart >= 0, 'expected single-adapter wrapper');
    const composeStart = source.indexOf('function composeStreamAdapters', singleStart);
    assert.ok(composeStart > singleStart, 'expected composer after single-adapter wrapper');
    const singleSection = source.slice(singleStart, composeStart);
    const composeEnd = source.indexOf('const NOOP_STREAM_ADAPTER', composeStart);
    assert.ok(composeEnd > composeStart, 'expected noop adapter after composer');
    const composeSection = source.slice(composeStart, composeEnd);

    assert.match(singleSection, /adapter\.onPart\(part\);/);
    assert.match(singleSection, /return adapter\.shouldIgnoreError\(error, stream\);/);
    assert.match(singleSection, /normalizeAdapterReplayUpdate\(adapter, adapter\.getReplayUpdates\(\)\)/);
    assert.match(composeSection, /if \(adapters\.length === 1\) return wrapSingleStreamAdapter\(adapters\[0\]!\);/);
  });
});
