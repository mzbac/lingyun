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

  test('redactSensitive redacts json, inline key-value, and standalone OpenAI-style secrets', () => {
    const input =
      '{"authorization":"Bearer abc","apiKey":"xyz","url":"https://example.com"} token=abc secret:xyz standalone=sk-test-secret';
    const redacted = redactSensitive(input);

    assert.ok(!redacted.includes('abc'));
    assert.ok(!redacted.includes('xyz'));
    assert.ok(!redacted.includes('sk-test-secret'));
    assert.ok(redacted.includes('<url>'));
    assert.ok(redacted.includes('<redacted>'));
    assert.ok(redacted.includes('sk-<redacted>'));
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

  test('redactSensitive keeps public urls and paths but redacts private hosts in secrets-only mode', () => {
    const home = os.homedir();
    const input = `authorization=Bearer abc https://example.com from ${home}/projects/demo via localhost:3000 and http://192.168.1.20:11434/v1 and http://10.0.0.2/models and https://api.internal:8443/v1 and http://[::1]:11434/v1`;
    const redacted = redactSensitive(input, { redactionLevel: 'secrets-only' });

    assert.ok(!redacted.includes('abc'));
    assert.ok(redacted.includes('https://example.com'));
    assert.ok(redacted.includes(home));
    assert.ok(!redacted.includes('localhost:3000'));
    assert.ok(!redacted.includes('192.168.1.20'));
    assert.ok(!redacted.includes('10.0.0.2'));
    assert.ok(!redacted.includes('api.internal:8443'));
    assert.ok(!redacted.includes('[::1]:11434'));
    assert.ok(redacted.includes('<local-host>'));
    assert.ok(redacted.includes('<private-ip>'));
    assert.ok(redacted.includes('<ip>'));
    assert.ok(redacted.includes('<private-host>'));
  });

  test('summarizeErrorForDebug includes safe provider diagnostics without leaking URLs or model IDs', () => {
    const err = Object.assign(
      new Error('Provider request failed for https://private.local/v1 with authorization=Bearer secret-token'),
      {
        name: 'ProviderHttpError',
        code: 'rate_limit_exceeded',
        type: 'rate_limit_error',
        status: 429,
        providerId: 'openaiCompatible',
        modelId: 'private-local-model',
        requestId: 'req_provider_1',
        cfRay: 'ray_provider_1',
        retryAfterMs: 1500,
      },
    );

    const summary = summarizeErrorForDebug(err);

    assert.ok(summary.includes('provider=openaiCompatible'));
    assert.ok(summary.includes('requestId=req_provider_1'));
    assert.ok(summary.includes('cfRay=ray_provider_1'));
    assert.ok(summary.includes('retryAfterMs=1500'));
    assert.ok(summary.includes('type=rate_limit_error'));
    assert.ok(!summary.includes('private.local'));
    assert.ok(!summary.includes('secret-token'));
    assert.ok(!summary.includes('private-local-model'));
  });

  test('formatDetailedErrorForDebug includes safe provider diagnostics without leaking URLs or model IDs', () => {
    const err = Object.assign(
      new Error('Provider request failed for https://private.local/v1 with authorization=Bearer secret-token'),
      {
        name: 'ProviderHttpError',
        code: 'rate_limit_exceeded',
        type: 'rate_limit_error',
        status: 429,
        providerId: 'openaiCompatible',
        modelId: 'private-local-model',
        requestId: 'req_provider_2',
        cfRay: 'ray_provider_2',
        retryAfterMs: 2500,
      },
    );

    const details = formatDetailedErrorForDebug(err);

    assert.ok(details.includes('provider=openaiCompatible'));
    assert.ok(details.includes('requestId=req_provider_2'));
    assert.ok(details.includes('cfRay=ray_provider_2'));
    assert.ok(details.includes('retryAfterMs=2500'));
    assert.ok(details.includes('type=rate_limit_error'));
    assert.ok(!details.includes('private.local'));
    assert.ok(!details.includes('secret-token'));
    assert.ok(!details.includes('private-local-model'));
  });

  test('redacts provider-supplied code and type values in debug output', () => {
    const err = Object.assign(
      new Error('Provider request failed for http://10.0.0.9:11434/v1 token=message-secret'),
      {
        name: 'ProviderHttpError',
        code: 'provider failed at http://10.0.0.4:11434/v1 with token=code-secret',
        type: 'internal_host=http://192.168.1.20:8080 auth=Bearer type-secret',
        providerId: 'openaiCompatible',
      },
    );

    const summary = summarizeErrorForDebug(err);
    const details = formatDetailedErrorForDebug(err);

    for (const text of [summary, details]) {
      assert.ok(text.includes('provider=openaiCompatible'));
      assert.ok(!text.includes('code-secret'));
      assert.ok(!text.includes('type-secret'));
      assert.ok(!text.includes('message-secret'));
      assert.ok(!text.includes('10.0.0.4'));
      assert.ok(!text.includes('10.0.0.9'));
      assert.ok(!text.includes('192.168.1.20'));
    }
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
