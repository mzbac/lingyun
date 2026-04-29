import * as assert from 'assert';

import { createProviderHttpError, fetchProviderResponse, isProviderAbortError, isProviderAuthError, parseProviderJsonResponse, readProviderResponseBody } from '../../providers/providerErrors';

suite('providerErrors', () => {
  test('does not treat unrelated bare 401/403 text as an auth error', () => {
    assert.strictEqual(isProviderAuthError(new Error('Responses stream error (response=resp_401)')), false);
    assert.strictEqual(isProviderAuthError(new Error('quota message mentions 403 tokens remaining')), false);
  });

  test('detects explicit and structured abort errors', () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    assert.strictEqual(isProviderAbortError(abortError), true);
    assert.strictEqual(isProviderAbortError(Object.assign(new Error('request failed'), { code: 'request_aborted' })), true);
    assert.strictEqual(isProviderAbortError(Object.assign(new Error('request failed'), { type: 'aborted' })), true);
    assert.strictEqual(isProviderAbortError(Object.assign(new Error('request failed'), { code: 'request_timeout' })), false);
    assert.strictEqual(isProviderAbortError(new Error('The operation was aborted due to timeout')), false);
  });

  test('detects structured and explicit auth errors', () => {
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { statusCode: 401 })), true);
    assert.strictEqual(isProviderAuthError(new Error('HTTP 403 Forbidden')), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { code: 'invalid_api_key' })), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { data: { type: 'invalid_grant' } })), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { code: 'refresh_token_expired' })), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { error: { code: 'refresh-token-revoked' } })), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { error: { code: 'permission_denied' } })), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { data: { error: { type: 'access_denied' } } })), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { error: { error_code: 'invalid_token' } })), true);
    assert.strictEqual(isProviderAuthError(Object.assign(new Error('request failed'), { data: { error: { error_type: 'authentication_error' } } })), true);
  });

  test('detects nested provider auth error metadata without relying on message text', () => {
    assert.strictEqual(
      isProviderAuthError(Object.assign(new Error('request failed'), { error: { code: 'invalid_token' } })),
      true,
    );
    assert.strictEqual(
      isProviderAuthError(Object.assign(new Error('request failed'), { error: { type: 'invalid_grant' } })),
      true,
    );
    assert.strictEqual(
      isProviderAuthError(Object.assign(new Error('request failed'), { data: { error: { message: 'expired token' } } })),
      true,
    );
    assert.strictEqual(
      isProviderAuthError(Object.assign(new Error('request failed'), { error: { code: 'context_length_exceeded' } })),
      false,
    );
  });

  test('attaches structured metadata to malformed successful JSON responses', async () => {
    const response = new Response('{"access_token":"secret-token"', {
      status: 200,
      statusText: 'OK',
      headers: {
        'x-request-id': 'req_parse_1',
        'cf-ray': 'ray_parse_1',
        'set-cookie': 'secret=session',
      },
    });

    let thrown: any;
    try {
      await parseProviderJsonResponse({
        message: 'Failed to parse token response',
        url: 'https://auth.example.test/oauth/token',
        response,
        provider: 'ChatGPT Codex Subscription',
        providerId: 'codexSubscription',
        redactResponseBody: true,
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected parseProviderJsonResponse to reject');
    assert.strictEqual(thrown.name, 'ProviderParseError');
    assert.match(thrown.message, /Failed to parse token response: invalid JSON response \(HTTP 200 OK\)/);
    assert.strictEqual(thrown.status, 200);
    assert.strictEqual(thrown.statusCode, 200);
    assert.strictEqual(thrown.statusText, 'OK');
    assert.strictEqual(thrown.url, 'https://auth.example.test/oauth/token');
    assert.strictEqual(thrown.responseBody, '<redacted>');
    assert.strictEqual(thrown.provider, 'ChatGPT Codex Subscription');
    assert.strictEqual(thrown.providerId, 'codexSubscription');
    assert.strictEqual(thrown.requestId, 'req_parse_1');
    assert.strictEqual(thrown.cfRay, 'ray_parse_1');
    assert.strictEqual(thrown.responseHeaders?.['cf-ray'], 'ray_parse_1');
    assert.strictEqual(thrown.responseHeaders?.['set-cookie'], '<redacted>');
    assert.strictEqual(thrown.code, 'invalid_json');
    assert.strictEqual(thrown.type, 'invalid_response');
    assert.strictEqual(thrown.parseErrorName, 'SyntaxError');
  });

  test('attaches stable provider id separately from provider display name', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'token refresh failed',
          code: 'invalid_grant',
          type: 'oauth_error',
        },
      }),
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          'x-request-id': 'req_123',
          'set-cookie': 'secret=session',
        },
      },
    );

    const error = createProviderHttpError({
      message: 'Token refresh failed',
      url: 'https://auth.example.test/oauth/token',
      response,
      responseBody: await response.text(),
      provider: 'ChatGPT Codex Subscription',
      providerId: 'codexSubscription',
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.strictEqual(error.provider, 'ChatGPT Codex Subscription');
    assert.strictEqual(error.providerId, 'codexSubscription');
    assert.strictEqual(error.status, 401);
    assert.strictEqual(error.requestId, 'req_123');
    assert.strictEqual(error.responseHeaders?.['set-cookie'], '<redacted>');
    assert.strictEqual(error.code, 'invalid_grant');
    assert.strictEqual(error.type, 'oauth_error');
  });

  test('extracts identity auth details from OpenAI header diagnostics', async () => {
    const encoded = Buffer.from(JSON.stringify({
      error: {
        code: 'token_expired',
        type: 'authentication_error',
        message: 'Bearer secret-token expired for https://api.example.test/v1 while using gpt-5.4',
      },
    }), 'utf8').toString('base64');
    const response = new Response(JSON.stringify({ detail: 'Unauthorized' }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: {
        'x-oai-request-id': 'req_identity_1',
        'cf-ray': 'ray_identity_1',
        'x-openai-authorization-error': 'missing_authorization_header',
        'x-error-json': encoded,
        authorization: 'Bearer leaked-token',
      },
    });

    const error = createProviderHttpError({
      message: 'Failed to list Codex models',
      url: 'https://chatgpt.com/backend-api/codex/models',
      response,
      responseBody: await response.text(),
      provider: 'codexSubscription',
      providerId: 'codexSubscription',
      modelId: 'gpt-5.4',
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.strictEqual(error.requestId, 'req_identity_1');
    assert.strictEqual(error.authorizationError, 'missing_authorization_header');
    assert.strictEqual(error.identityAuthorizationError, 'missing_authorization_header');
    assert.strictEqual(error.identityErrorCode, 'token_expired');
    assert.strictEqual(error.identityErrorType, 'authentication_error');
    assert.strictEqual(error.cfRay, 'ray_identity_1');
    assert.strictEqual(error.responseHeaders?.['x-error-json'], '<redacted>');

    assert.strictEqual(error.responseHeaders?.authorization, '<redacted>');
    assert.strictEqual(error.modelId, 'gpt-5.4');
    assert.strictEqual(isProviderAuthError(error), true);
    assert.doesNotMatch(error.message, /secret-token|api\.example\.test|gpt-5\.4/);
    assert.strictEqual(error.identityErrorMessage, 'Bearer <redacted> expired for <url> while using <model>');
    assert.doesNotMatch(error.identityErrorMessage, /secret-token|api\.example\.test|gpt-5\.4/);
  });

  test('uses identity auth header values as structured auth errors without HTTP status', () => {
    assert.strictEqual(
      isProviderAuthError(Object.assign(new Error('provider failed'), { identityErrorCode: 'token_expired' })),
      true,
    );
    assert.strictEqual(
      isProviderAuthError(Object.assign(new Error('provider failed'), { authorizationError: 'missing_authorization_header' })),
      true,
    );
  });

  test('ignores malformed identity error JSON headers safely', async () => {
    const response = new Response(JSON.stringify({ detail: 'provider error' }), {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        'x-error-json': 'not-base64-json',
      },
    });

    const error = createProviderHttpError({
      message: 'Provider request failed',
      url: 'https://api.example.test/v1/responses',
      response,
      responseBody: await response.text(),
      provider: 'OpenAI Compatible',
      providerId: 'openaiCompatible',
    }) as any;

    assert.strictEqual(error.identityErrorCode, undefined);
    assert.strictEqual(error.identityErrorType, undefined);
    assert.strictEqual(error.responseHeaders?.['x-error-json'], '<redacted>');
  });

  test('extracts flat OAuth error bodies as structured auth errors', async () => {
    const response = new Response(
      JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Refresh token expired',
      }),
      {
        status: 400,
        statusText: 'Bad Request',
        headers: {
          'x-request-id': 'req_oauth_flat_1',
        },
      },
    );

    const error = createProviderHttpError({
      message: 'Token refresh failed',
      url: 'https://auth.example.test/oauth/token',
      response,
      responseBody: await response.text(),
      provider: 'ChatGPT Codex Subscription',
      providerId: 'codexSubscription',
      redactResponseBody: true,
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.match(error.message, /Token refresh failed: HTTP 400 Bad Request/);
    assert.doesNotMatch(error.message, /Refresh token expired/);
    assert.strictEqual(error.responseBody, '<redacted>');
    assert.strictEqual(error.requestId, 'req_oauth_flat_1');
    assert.strictEqual(error.code, 'invalid_grant');
    assert.strictEqual(error.errorCode, 'invalid_grant');
    assert.strictEqual(isProviderAuthError(error), true);
  });

  test('uses OAuth error descriptions as provider HTTP messages when response bodies are not redacted', async () => {
    const response = new Response(
      JSON.stringify({
        error: 'temporarily_unavailable',
        errorDescription: 'Authorization server is temporarily unavailable',
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
      },
    );

    const error = createProviderHttpError({
      message: 'Token exchange failed',
      url: 'https://auth.example.test/oauth/token',
      response,
      responseBody: await response.text(),
      provider: 'ChatGPT Codex Subscription',
      providerId: 'codexSubscription',
    }) as any;

    assert.match(error.message, /Token exchange failed: HTTP 503 Service Unavailable - Authorization server is temporarily unavailable/);
    assert.strictEqual(error.code, 'temporarily_unavailable');
    assert.strictEqual(error.errorCode, 'temporarily_unavailable');
  });

  test('extracts request IDs from common provider headers', async () => {
    const cases: Array<{ header: string; value: string }> = [
      { header: 'request-id', value: 'req_plain_1' },
      { header: 'x-openai-request-id', value: 'req_openai_1' },
      { header: 'x-ms-request-id', value: 'req_azure_1' },
      { header: 'apim-request-id', value: 'req_apim_1' },
    ];

    for (const { header, value } of cases) {
      const response = new Response(JSON.stringify({ error: { message: 'provider error' } }), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { [header]: value },
      });

      const error = createProviderHttpError({
        message: 'Provider request failed',
        url: 'https://api.example.test/v1/responses',
        response,
        responseBody: await response.text(),
        provider: 'OpenAI Compatible',
        providerId: 'openaiCompatible',
      }) as any;

      assert.strictEqual(error.requestId, value, `expected ${header} to populate requestId`);
      assert.strictEqual(error.responseHeaders?.[header], value);
    }
  });

  test('extracts structured details from nested data.error HTTP response bodies', async () => {
    const response = new Response(
      JSON.stringify({
        data: {
          error: {
            message: 'remote rate limit details',
            code: 'rate_limit_exceeded',
            type: 'rate_limit_error',
            param: 'messages',
          },
        },
      }),
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'x-request-id': 'req_data_error_1' },
      },
    );

    const error = createProviderHttpError({
      message: 'Provider request failed',
      url: 'https://api.example.test/v1/responses',
      response,
      responseBody: await response.text(),
      provider: 'OpenAI Compatible',
      providerId: 'openaiCompatible',
      modelId: 'gpt-test',
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.match(error.message, /Provider request failed: HTTP 429 Too Many Requests - remote rate limit details/);
    assert.strictEqual(error.requestId, 'req_data_error_1');
    assert.strictEqual(error.code, 'rate_limit_exceeded');
    assert.strictEqual(error.errorCode, 'rate_limit_exceeded');
    assert.strictEqual(error.type, 'rate_limit_error');
    assert.strictEqual(error.errorType, 'rate_limit_error');
    assert.strictEqual(error.param, 'messages');
  });

  test('extracts error_code and error_type aliases from HTTP response bodies', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'alias-shaped provider failure',
          error_code: 'insufficient_quota',
          error_type: 'billing_error',
          param: 'messages',
        },
      }),
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'x-request-id': 'req_error_aliases_1' },
      },
    );

    const error = createProviderHttpError({
      message: 'Provider request failed',
      url: 'https://api.example.test/v1/chat/completions',
      response,
      responseBody: await response.text(),
      provider: 'OpenAI Compatible',
      providerId: 'openaiCompatible',
      modelId: 'gpt-test',
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.match(error.message, /Provider request failed: HTTP 429 Too Many Requests - alias-shaped provider failure/);
    assert.strictEqual(error.requestId, 'req_error_aliases_1');
    assert.strictEqual(error.code, 'insufficient_quota');
    assert.strictEqual(error.errorCode, 'insufficient_quota');
    assert.strictEqual(error.type, 'billing_error');
    assert.strictEqual(error.errorType, 'billing_error');
    assert.strictEqual(error.param, 'messages');
  });

  test('treats numeric retry-after epoch timestamps as absolute retry times', async () => {
    const retryAtSeconds = Math.ceil(Date.now() / 1000) + 3;
    const response = new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'retry-after': String(retryAtSeconds),
        'x-request-id': 'req_retry_after_epoch_1',
      },
    });

    const error = createProviderHttpError({
      message: 'Failed to list models',
      url: 'https://api.example.test/v1/models',
      response,
      responseBody: await response.text(),
      provider: 'OpenAI Compatible',
      providerId: 'openaiCompatible',
      modelId: 'gpt-test',
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.strictEqual(error.status, 429);
    assert.strictEqual(error.requestId, 'req_retry_after_epoch_1');
    assert.ok(typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0 && error.retryAfterMs <= 4000);
  });

  test('redacts HTTP response body and suppresses body-derived message while preserving structured details', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'refresh token secret details',
          code: 'invalid_grant',
          type: 'oauth_error',
        },
      }),
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          'x-request-id': 'req_redacted_http_1',
        },
      },
    );

    const error = createProviderHttpError({
      message: 'Token refresh failed',
      url: 'https://auth.example.test/oauth/token',
      response,
      responseBody: await response.text(),
      provider: 'ChatGPT Codex Subscription',
      providerId: 'codexSubscription',
      redactResponseBody: true,
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.match(error.message, /Token refresh failed: HTTP 401 Unauthorized/);
    assert.doesNotMatch(error.message, /refresh token secret details/);
    assert.strictEqual(error.responseBody, '<redacted>');
    assert.strictEqual(error.code, 'invalid_grant');
    assert.strictEqual(error.type, 'oauth_error');
    assert.strictEqual(error.requestId, 'req_redacted_http_1');
  });

  test('sanitizes non-redacted HTTP response bodies and messages while preserving diagnostics', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'model private-model failed at http://127.0.0.1:8080/v1 with Authorization: Bearer body-secret',
          code: 'rate_limit_exceeded',
          type: 'rate_limit_error',
        },
      }),
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'x-request-id': 'req_sanitized_http_1' },
      },
    );

    const error = createProviderHttpError({
      message: 'Provider request failed',
      url: 'http://127.0.0.1:8080/v1/responses',
      response,
      responseBody: await response.text(),
      provider: 'OpenAI Compatible',
      providerId: 'openaiCompatible',
      modelId: 'private-model',
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.match(error.message, /Provider request failed: HTTP 429 Too Many Requests/);
    assert.match(error.message, /model <model> failed at <url> with Authorization: <redacted> <redacted>/);
    assert.match(error.responseBody, /model <model> failed at <url> with Authorization: <redacted> <redacted>/);
    assert.doesNotMatch(error.message, /private-model|127\.0\.0\.1|body-secret/);
    assert.doesNotMatch(error.responseBody, /private-model|127\.0\.0\.1|body-secret/);
    assert.strictEqual(error.code, 'rate_limit_exceeded');
    assert.strictEqual(error.type, 'rate_limit_error');
    assert.strictEqual(error.requestId, 'req_sanitized_http_1');
  });

  test('wraps network fetch failures with structured provider metadata', async () => {
    const cause = Object.assign(
      new Error('socket hang up for gpt-test at http://127.0.0.1:8080/v1 token=raw-secret'),
      {
        code: 'ECONNRESET',
        responseBody: 'network body for gpt-test at http://127.0.0.1:8080/v1 token=raw-secret',
        error: {
          message: 'nested network error for gpt-test at http://127.0.0.1:8080/v1 token=raw-secret',
        },
        data: {
          error: {
            message: 'nested data error for gpt-test at http://127.0.0.1:8080/v1 token=raw-secret',
          },
        },
        headers: {
          authorization: 'Bearer raw-secret',
          'x-request-id': 'req_fetch_1',
        },
      },
    );
    cause.stack = 'Error: socket hang up for gpt-test at http://127.0.0.1:8080/v1 token=raw-secret';
    const fetchFn = async () => {
      throw cause;
    };

    let thrown: any;
    try {
      await fetchProviderResponse(fetchFn as any, 'https://api.example.test/v1/models', undefined, {
        message: 'Model discovery failed',
        url: 'https://api.example.test/v1/models',
        provider: 'OpenAI Compatible',
        providerId: 'openaiCompatible',
        modelId: 'gpt-test',
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected fetchProviderResponse to reject');
    assert.strictEqual(thrown.name, 'ProviderFetchError');
    assert.match(thrown.message, /Model discovery failed: socket hang up for <model> at <url> token=<redacted>/);
    assert.doesNotMatch(thrown.message, /gpt-test|127\.0\.0\.1|raw-secret/);
    assert.strictEqual(thrown.cause, cause);
    assert.strictEqual(cause.message.includes('raw-secret'), false);
    assert.strictEqual(cause.message.includes('127.0.0.1'), false);
    assert.strictEqual(cause.message.includes('gpt-test'), false);
    assert.strictEqual(cause.stack?.includes('raw-secret'), false);
    assert.strictEqual(cause.stack?.includes('127.0.0.1'), false);
    assert.strictEqual(cause.responseBody.includes('raw-secret'), false);
    assert.strictEqual(cause.responseBody.includes('127.0.0.1'), false);
    assert.strictEqual(cause.responseBody.includes('gpt-test'), false);
    assert.strictEqual(cause.error.message.includes('raw-secret'), false);
    assert.strictEqual(cause.error.message.includes('127.0.0.1'), false);
    assert.strictEqual(cause.error.message.includes('gpt-test'), false);
    assert.strictEqual(cause.data.error.message.includes('raw-secret'), false);
    assert.strictEqual(cause.data.error.message.includes('127.0.0.1'), false);
    assert.strictEqual(cause.data.error.message.includes('gpt-test'), false);
    assert.strictEqual(cause.headers.authorization, '<redacted>');
    assert.strictEqual(cause.headers['x-request-id'], 'req_fetch_1');
    assert.strictEqual(thrown.url, 'https://api.example.test/v1/models');
    assert.strictEqual(thrown.provider, 'OpenAI Compatible');
    assert.strictEqual(thrown.providerId, 'openaiCompatible');
    assert.strictEqual(thrown.modelId, 'gpt-test');
    assert.strictEqual(thrown.code, 'ECONNRESET');
    assert.strictEqual(thrown.errorCode, 'ECONNRESET');
    assert.strictEqual(thrown.type, 'network_error');
    assert.strictEqual(thrown.errorType, 'network_error');
  });

  test('classifies timeout and abort fetch failures distinctly', async () => {
    const timeoutCause = new Error('The operation timed out');
    timeoutCause.name = 'TimeoutError';
    const abortCause = new Error('The operation was aborted');
    abortCause.name = 'AbortError';

    const capture = async (cause: Error) => {
      try {
        await fetchProviderResponse(async () => { throw cause; }, 'https://api.example.test/v1/responses', undefined, {
          message: 'Responses request failed',
          url: 'https://api.example.test/v1/responses',
          provider: 'copilot',
          modelId: 'gpt-5.4',
        });
      } catch (error) {
        return error as any;
      }
      assert.fail('expected fetchProviderResponse to reject');
    };

    const timeoutError = await capture(timeoutCause);
    assert.strictEqual(timeoutError.name, 'ProviderFetchError');
    assert.strictEqual(timeoutError.code, 'request_timeout');
    assert.strictEqual(timeoutError.type, 'timeout');
    assert.strictEqual(timeoutError.providerId, 'copilot');
    assert.strictEqual(timeoutError.modelId, 'gpt-5.4');

    const abortError = await capture(abortCause);
    assert.strictEqual(abortError.name, 'ProviderFetchError');
    assert.strictEqual(abortError.code, 'request_aborted');
    assert.strictEqual(abortError.type, 'aborted');
    assert.strictEqual(abortError.providerId, 'copilot');
    assert.strictEqual(abortError.modelId, 'gpt-5.4');
  });

  test('preserves structured HTTP metadata when response body reading fails', async () => {
    const response = new Response('', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'x-request-id': 'req_unreadable_body_1',
        'set-cookie': 'secret=session',
      },
    });

    Object.defineProperty(response, 'text', {
      value: async () => {
        throw new Error('body stream failed');
      },
    });

    const responseBody = await readProviderResponseBody(response);
    assert.strictEqual(responseBody, '');

    const error = createProviderHttpError({
      message: 'Failed to list models',
      url: 'https://api.example.test/v1/models',
      response,
      responseBody,
      provider: 'OpenAI Compatible',
      providerId: 'openaiCompatible',
      modelId: 'gpt-test',
    }) as any;

    assert.strictEqual(error.name, 'ProviderHttpError');
    assert.match(error.message, /Failed to list models: HTTP 503 Service Unavailable/);
    assert.strictEqual(error.status, 503);
    assert.strictEqual(error.statusCode, 503);
    assert.strictEqual(error.statusText, 'Service Unavailable');
    assert.strictEqual(error.url, 'https://api.example.test/v1/models');
    assert.strictEqual(error.responseBody, '');
    assert.strictEqual(error.provider, 'OpenAI Compatible');
    assert.strictEqual(error.providerId, 'openaiCompatible');
    assert.strictEqual(error.modelId, 'gpt-test');
    assert.strictEqual(error.requestId, 'req_unreadable_body_1');
    assert.strictEqual(error.responseHeaders?.['set-cookie'], '<redacted>');
  });

  test('attaches structured metadata to invalid successful JSON payloads', async () => {
    const response = new Response(JSON.stringify({ access_token: 'secret-token' }), {
      status: 200,
      statusText: 'OK',
      headers: {
        'x-request-id': 'req_validation_1',
        'cf-ray': 'ray_validation_1',
        'retry-after-ms': '1500',
        'set-cookie': 'secret=session',
      },
    });

    let thrown: any;
    try {
      await parseProviderJsonResponse({
        message: 'Failed to parse token response',
        url: 'https://auth.example.test/oauth/token',
        response,
        provider: 'ChatGPT Codex Subscription',
        providerId: 'codexSubscription',
        modelId: 'gpt-5.4',
        redactResponseBody: true,
        validate: () => 'token response missing refresh_token for gpt-5.4 at http://127.0.0.1:8080/v1 token=raw-secret',
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected parseProviderJsonResponse to reject');
    assert.strictEqual(thrown.name, 'ProviderValidationError');
    assert.match(thrown.message, /Failed to parse token response: invalid response payload \(HTTP 200 OK\)/);
    assert.match(thrown.message, /token response missing refresh_token for <model> at <url> token=<redacted>/);
    assert.doesNotMatch(thrown.message, /gpt-5\.4|127\.0\.0\.1|raw-secret/);
    assert.strictEqual(thrown.status, 200);
    assert.strictEqual(thrown.statusCode, 200);
    assert.strictEqual(thrown.statusText, 'OK');
    assert.strictEqual(thrown.url, 'https://auth.example.test/oauth/token');
    assert.strictEqual(thrown.responseBody, '<redacted>');
    assert.strictEqual(thrown.provider, 'ChatGPT Codex Subscription');
    assert.strictEqual(thrown.providerId, 'codexSubscription');
    assert.strictEqual(thrown.requestId, 'req_validation_1');
    assert.strictEqual(thrown.cfRay, 'ray_validation_1');
    assert.strictEqual(thrown.retryAfterMs, 1500);
    assert.strictEqual(thrown.responseHeaders?.['cf-ray'], 'ray_validation_1');
    assert.strictEqual(thrown.responseHeaders?.['set-cookie'], '<redacted>');
    assert.strictEqual(thrown.code, 'invalid_response_payload');
    assert.strictEqual(thrown.errorCode, 'invalid_response_payload');
    assert.strictEqual(thrown.type, 'invalid_response');
    assert.strictEqual(thrown.errorType, 'invalid_response');
    assert.strictEqual(thrown.validationMessage, 'token response missing refresh_token for <model> at <url> token=<redacted>');
    assert.doesNotMatch(thrown.validationMessage, /gpt-5\.4|127\.0\.0\.1|raw-secret/);
    assert.strictEqual(thrown.modelId, 'gpt-5.4');
  });
});
