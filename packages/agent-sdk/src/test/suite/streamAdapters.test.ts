import * as assert from 'assert';

import { buildStreamReplay } from '@kooka/agent-sdk';

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
});
