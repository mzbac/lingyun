import * as assert from 'assert';

import { retryable, sleep } from '../../agent/retry.js';

suite('retryable', () => {
  test('rejects retry sleep immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const originalSetTimeout = globalThis.setTimeout;
    let timerScheduled = false;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]) => {
      timerScheduled = true;
      return originalSetTimeout(callback, delayMs, ...args);
    }) as typeof setTimeout;

    try {
      await assert.rejects(
        () => sleep(60_000, controller.signal),
        (error: unknown) => {
          assert.strictEqual((error as Error).name, 'AbortError');
          return true;
        },
      );
      assert.strictEqual(timerScheduled, false, 'pre-aborted retry sleep should not schedule a timer');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test('retries structured fetch network and timeout errors but not aborts', () => {
    const networkError = Object.assign(new Error('OpenAI Compatible model discovery failed: socket hang up'), {
      name: 'ProviderFetchError',
      code: 'network_error',
      type: 'network_error',
    });
    const timeoutError = Object.assign(new Error('Copilot Responses request failed: The operation timed out'), {
      name: 'ProviderFetchError',
      code: 'request_timeout',
      type: 'timeout',
    });
    const abortError = Object.assign(new Error('Copilot Responses request failed: The operation was aborted'), {
      name: 'ProviderFetchError',
      code: 'request_aborted',
      type: 'aborted',
    });
    const streamReadError = Object.assign(new Error('Responses stream read failed'), {
      name: 'ResponsesStreamError',
      code: 'stream_read_error',
      type: 'network_error',
    });

    assert.deepStrictEqual(retryable(networkError), {
      kind: 'network_error',
      message: 'Network error',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(timeoutError), {
      kind: 'network_error',
      message: 'Network error',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(streamReadError), {
      kind: 'network_error',
      message: 'Network error',
      retryAfterMs: undefined,
    });
    assert.strictEqual(retryable(abortError), undefined);
  });

  test('retries raw and nested timeout failures but not wrapped aborts', () => {
    const rawTimeout = new Error('Request timed out after 40000ms');
    rawTimeout.name = 'TimeoutError';
    const wrappedTimeout = Object.assign(new Error('AI SDK stream failed'), { cause: rawTimeout });
    const undiciTimeout = Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' });
    const rawAbort = new Error('The operation was aborted');
    rawAbort.name = 'AbortError';
    const wrappedAbort = Object.assign(new Error('AI SDK stream failed'), { cause: rawAbort });

    assert.deepStrictEqual(retryable(rawTimeout), {
      kind: 'network_error',
      message: 'Network error',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(wrappedTimeout), {
      kind: 'network_error',
      message: 'Network error',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(undiciTimeout), {
      kind: 'network_error',
      message: 'Network error',
      retryAfterMs: undefined,
    });
    assert.strictEqual(retryable(rawAbort), undefined);
    assert.strictEqual(retryable(wrappedAbort), undefined);
  });

  test('uses structured retryAfterMs metadata when present', () => {
    const error = Object.assign(new Error('rate limited'), {
      name: 'ProviderHttpError',
      status: 429,
      retryAfterMs: 1234,
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Too Many Requests',
      retryAfterMs: 1234,
    });
  });

  test('uses structured statusCode metadata when status is absent', () => {
    const error = Object.assign(new Error('rate limited'), {
      name: 'ResponsesStreamError',
      statusCode: 429,
      retryAfterMs: 1234,
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Too Many Requests',
      retryAfterMs: 1234,
    });
  });

  test('prefers structured retryAfterMs over retry-after headers', () => {
    const error = Object.assign(new Error('rate limited'), {
      name: 'ProviderHttpError',
      status: 429,
      retryAfterMs: 1234,
      headers: { 'retry-after': '9' },
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Too Many Requests',
      retryAfterMs: 1234,
    });
  });

  test('falls back to retry-after headers when structured retryAfterMs is invalid', () => {
    const error = Object.assign(new Error('rate limited'), {
      name: 'ProviderHttpError',
      status: 429,
      retryAfterMs: -1,
      headers: { 'retry-after': '2' },
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Too Many Requests',
      retryAfterMs: 2000,
    });
  });

  test('treats numeric retry-after epoch timestamps as absolute retry times', () => {
    const retryAtSeconds = Math.ceil(Date.now() / 1000) + 3;
    const error = Object.assign(new Error('rate limited'), {
      name: 'ProviderHttpError',
      status: 429,
      headers: { 'retry-after': String(retryAtSeconds) },
    });

    const result = retryable(error);
    assert.strictEqual(result?.kind, 'rate_limited');
    assert.strictEqual(result?.message, 'Too Many Requests');
    assert.ok(typeof result?.retryAfterMs === 'number' && result.retryAfterMs > 0 && result.retryAfterMs <= 4000);
  });

  test('falls back to rate-limit reset headers when retry-after is absent', () => {
    const resetSeconds = Math.ceil(Date.now() / 1000) + 3;
    const error = Object.assign(new Error('rate limited'), {
      name: 'ProviderHttpError',
      status: 429,
      headers: { 'x-ratelimit-reset': String(resetSeconds) },
    });

    const result = retryable(error);
    assert.strictEqual(result?.kind, 'rate_limited');
    assert.strictEqual(result?.message, 'Too Many Requests');
    assert.ok(typeof result?.retryAfterMs === 'number' && result.retryAfterMs > 0 && result.retryAfterMs <= 4000);
  });

  test('parses string structured retryAfterMs metadata', () => {
    const error = Object.assign(new Error('rate limited'), {
      name: 'ProviderHttpError',
      status: 429,
      retryAfterMs: '1234.2',
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Too Many Requests',
      retryAfterMs: 1235,
    });
  });

  test('uses retry delay metadata from rate-limited Responses stream errors', () => {
    const error = Object.assign(
      new Error('Rate limit reached for gpt-5.4. Please try again in 11.054s. (code=rate_limit_exceeded)'),
      {
        name: 'ResponsesStreamError',
        code: 'rate_limit_exceeded',
        type: 'rate_limit_error',
        providerId: 'copilot',
        modelId: 'gpt-5.4',
        url: 'https://api.githubcopilot.com/responses',
        retryAfterMs: 11054,
      },
    );

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Rate limited',
      retryAfterMs: 11054,
    });
  });

  test('classifies nested structured rate-limit codes without message matching', () => {
    const error = Object.assign(new Error('request failed'), {
      name: 'ProviderHttpError',
      data: { code: 'rate_limit_exceeded' },
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Rate limited',
      retryAfterMs: undefined,
    });
  });

  test('classifies nested data.error rate-limit metadata without message matching', () => {
    const error = Object.assign(new Error('request failed'), {
      name: 'ProviderHttpError',
      data: { error: { code: 'rate_limit_exceeded', type: 'rate_limit_error' } },
      headers: { 'retry-after': '1.2' },
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Rate limited',
      retryAfterMs: 1200,
    });
  });

  test('ignores past rate-limit reset headers instead of returning zero-delay metadata', () => {
    const error = Object.assign(new Error('rate limited'), {
      name: 'ProviderHttpError',
      status: 429,
      headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) - 60) },
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'rate_limited',
      message: 'Too Many Requests',
      retryAfterMs: undefined,
    });
  });

  test('classifies nested structured overload codes without message matching', () => {
    const error = Object.assign(new Error('request failed'), {
      name: 'ProviderHttpError',
      error: { code: 'server_is_overloaded' },
    });

    assert.deepStrictEqual(retryable(error), {
      kind: 'provider_overloaded',
      message: 'Provider is overloaded',
      retryAfterMs: undefined,
    });
  });

  test('classifies structured server error types and no-kv-space codes without message matching', () => {
    const serverErrorType = Object.assign(new Error('request failed'), {
      name: 'ResponsesStreamError',
      errorType: 'server_error',
    });
    const noKvSpace = Object.assign(new Error('request failed'), {
      name: 'ResponsesStreamError',
      code: 'no_kv_space',
    });

    assert.deepStrictEqual(retryable(serverErrorType), {
      kind: 'provider_server_error',
      message: 'Provider server error',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(noKvSpace), {
      kind: 'provider_server_error',
      message: 'Provider server error',
      retryAfterMs: undefined,
    });
  });

  test('classifies structured Responses stream parser and termination codes without message matching', () => {
    const terminated = Object.assign(new Error('request failed'), {
      name: 'ResponsesStreamError',
      code: 'stream_terminated',
      type: 'incomplete_response',
    });
    const invalidJson = Object.assign(new Error('request failed'), {
      name: 'ResponsesStreamError',
      code: 'invalid_sse_json',
      type: 'invalid_response',
    });

    assert.deepStrictEqual(retryable(terminated), {
      kind: 'connection_terminated',
      message: 'Connection terminated',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(invalidJson), {
      kind: 'responses_stream_parser_error',
      message: 'Responses stream parser error',
      retryAfterMs: undefined,
    });
  });

  test('does not retry fatal structured provider codes without retryable status or message', () => {
    const contextTooLarge = Object.assign(new Error('request failed'), {
      name: 'ProviderHttpError',
      data: { code: 'context_length_exceeded' },
    });
    const insufficientQuota = Object.assign(new Error('request failed'), {
      name: 'ProviderHttpError',
      error: { code: 'insufficient_quota' },
    });

    assert.strictEqual(retryable(contextTooLarge), undefined);
    assert.strictEqual(retryable(insufficientQuota), undefined);
  });

  test('does not retry fatal JSON-string provider errors without retryable status or message', () => {
    const contextTooLarge = new Error(
      JSON.stringify({
        error: {
          code: 'context_length_exceeded',
          type: 'invalid_request_error',
          message: 'The requested context is too large.',
        },
      }),
    );
    const insufficientQuota = new Error(
      JSON.stringify({
        error: {
          code: 'insufficient_quota',
          type: 'insufficient_quota',
          message: 'You exceeded your current quota.',
        },
      }),
    );

    assert.strictEqual(retryable(contextTooLarge), undefined);
    assert.strictEqual(retryable(insufficientQuota), undefined);
  });

  test('classifies explicit retryable JSON-string provider errors', () => {
    const rateLimited = new Error(JSON.stringify({ type: 'error', error: { code: 'rate_limit_exceeded', type: 'rate_limit_error' } }));
    const overloaded = new Error(JSON.stringify({ error: { code: 'server_is_unavailable' } }));
    const serverError = new Error(JSON.stringify({ type: 'error', error: { type: 'server_error', message: 'Something failed.' } }));

    assert.deepStrictEqual(retryable(rateLimited), {
      kind: 'rate_limited',
      message: 'Rate limited',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(overloaded), {
      kind: 'provider_overloaded',
      message: 'Provider is overloaded',
      retryAfterMs: undefined,
    });
    assert.deepStrictEqual(retryable(serverError), {
      kind: 'provider_server_error',
      message: 'Provider server error',
      retryAfterMs: undefined,
    });
  });
});
