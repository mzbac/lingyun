import * as assert from 'assert';

import { redactSensitive, summarizeErrorForDebug, summarizeToolArgsForDebug } from '../../core/agent/debug';

suite('Debug Redaction', () => {
  test('summarizeToolArgsForDebug redacts secret-like keys and values', () => {
    const summary = summarizeToolArgsForDebug({
      authorization: 'Bearer top-secret-token',
      apiKey: 'sk-1234567890abcdefghijkl',
      headers: { Authorization: 'Bearer another-secret' },
      command: 'curl -H "Authorization: Bearer cmd-secret" https://example.com/v1',
    });

    assert.ok(!summary.includes('top-secret-token'));
    assert.ok(!summary.includes('another-secret'));
    assert.ok(!summary.includes('cmd-secret'));
    assert.ok(!summary.includes('sk-1234567890abcdefghijkl'));
    assert.ok(summary.includes('<redacted'));
    assert.ok(summary.includes('<url>'));
  });

  test('summarizeErrorForDebug redacts inline secrets in error and cause', () => {
    const err: Error & { cause?: unknown } = new Error(
      'request failed authorization=Bearer raw-token api_key=abc123 https://example.com/v1'
    );
    err.cause = {
      token: 'cause-secret',
      endpoint: 'https://api.example.com/v1',
      headers: { authorization: 'Bearer hidden-token' },
    };

    const summary = summarizeErrorForDebug(err);
    assert.ok(!summary.includes('raw-token'));
    assert.ok(!summary.includes('abc123'));
    assert.ok(!summary.includes('cause-secret'));
    assert.ok(!summary.includes('hidden-token'));
    assert.ok(summary.includes('<url>'));
  });

  test('redactSensitive redacts json and inline key-value secrets', () => {
    const input =
      '{"authorization":"Bearer abc","apiKey":"xyz","url":"https://example.com"} token=abc secret:xyz';
    const redacted = redactSensitive(input);

    assert.ok(!redacted.includes('abc'));
    assert.ok(!redacted.includes('xyz'));
    assert.ok(redacted.includes('<url>'));
    assert.ok(redacted.includes('<redacted>'));
  });
});
