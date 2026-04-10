import * as assert from 'assert';
import * as os from 'os';

import {
  formatDetailedErrorForDebug,
  redactSensitive,
  summarizeErrorForDebug,
  summarizeToolArgsForDebug,
} from '../../core/agent/debug';

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

  test('redactSensitive redacts home paths and local hosts', () => {
    const home = os.homedir();
    const input = `Failed to connect to localhost:3000 from ${home}/projects/demo using file://${home}/token.txt and printer.local:631`;
    const redacted = redactSensitive(input);

    assert.ok(!redacted.includes(home));
    assert.ok(!redacted.includes('localhost:3000'));
    assert.ok(!redacted.includes('printer.local:631'));
    assert.ok(redacted.includes('~'));
    assert.ok(redacted.includes('<local-host>'));
    assert.ok(redacted.includes('<file-url>'));
  });

  test('redactSensitive keeps urls and paths when using secrets-only mode', () => {
    const home = os.homedir();
    const input = `authorization=Bearer abc https://example.com from ${home}/projects/demo via localhost:3000`;
    const redacted = redactSensitive(input, { redactionLevel: 'secrets-only' });

    assert.ok(!redacted.includes('abc'));
    assert.ok(redacted.includes('https://example.com'));
    assert.ok(redacted.includes(home));
    assert.ok(redacted.includes('localhost:3000'));
  });

  test('formatDetailedErrorForDebug redacts nested cause details and stack', () => {
    const cause = Object.assign(new TypeError('terminated token=inner-secret'), {
      responseHeaders: {
        location: 'https://example.com/v1/chat',
      },
    });
    const err: Error & { cause?: unknown } = new Error('network error authorization=Bearer outer-secret');
    err.stack = 'Error: network error token=stack-secret\n    at https://example.com/v1/chat';
    err.cause = cause;

    const details = formatDetailedErrorForDebug(err);
    assert.ok(details.includes('error:'));
    assert.ok(details.includes('cause[1]:'));
    assert.ok(details.includes('cause[1].headers='));
    assert.ok(details.includes('error.stack='));
    assert.ok(!details.includes('outer-secret'));
    assert.ok(!details.includes('inner-secret'));
    assert.ok(!details.includes('stack-secret'));
    assert.ok(details.includes('<url>'));
  });

  test('formatDetailedErrorForDebug keeps urls in secrets-only mode', () => {
    const cause = Object.assign(new TypeError('terminated token=inner-secret'), {
      responseHeaders: {
        location: 'https://example.com/v1/chat',
      },
    });
    const err: Error & { cause?: unknown } = new Error('network error authorization=Bearer outer-secret');
    err.stack = 'Error: network error token=stack-secret\n    at https://example.com/v1/chat';
    err.cause = cause;

    const details = formatDetailedErrorForDebug(err, { redactionLevel: 'secrets-only' });
    assert.ok(details.includes('https://example.com/v1/chat'));
    assert.ok(!details.includes('outer-secret'));
    assert.ok(!details.includes('inner-secret'));
    assert.ok(!details.includes('stack-secret'));
  });
});
