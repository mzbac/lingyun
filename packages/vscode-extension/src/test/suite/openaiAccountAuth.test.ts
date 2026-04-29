import * as assert from 'assert';
import * as vscode from 'vscode';

import { OpenAIAccountAuth } from '../../providers/openaiAccountAuth';

function createContext(initialSecret?: string): {
  context: any;
  stored: () => string | undefined;
  deleted: () => boolean;
} {
  let secret = initialSecret;
  let wasDeleted = false;
  return {
    context: {
      secrets: {
        get: async () => secret,
        store: async (_key: string, value: string) => {
          wasDeleted = false;
          secret = value;
        },
        delete: async () => {
          wasDeleted = true;
          secret = undefined;
        },
        onDidChange: () => ({ dispose() {} }),
      },
    },
    stored: () => secret,
    deleted: () => wasDeleted,
  };
}

function createAuth(options: {
  initialSecret?: string;
  fetch: (input: unknown, init?: RequestInit) => Promise<Response>;
}): { auth: OpenAIAccountAuth; context: ReturnType<typeof createContext> } {
  const context = createContext(options.initialSecret);
  const auth = new OpenAIAccountAuth({
    context: context.context,
    secretStorageKey: 'test.openaiAccountAuth',
    providerName: 'ChatGPT Codex Subscription',
    providerId: 'codexSubscription',
    clientId: 'test-client-id',
    issuer: 'https://auth.example.test',
    fetch: options.fetch as any,
  });
  return { auth, context };
}

suite('OpenAIAccountAuth', () => {
  test('uses injected fetch when refreshing an expired stored session', async () => {
    const expiredSession = {
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() - 1000,
      accountId: 'org_old',
      email: 'old@example.test',
    };
    const requests: Array<{ input: unknown; headers: Headers; body: URLSearchParams }> = [];
    const { auth, context } = createAuth({
      initialSecret: JSON.stringify(expiredSession),
      fetch: async (input, init) => {
        requests.push({
          input,
          headers: new Headers(init?.headers),
          body: new URLSearchParams(String(init?.body || '')),
        });
        return new Response(
          JSON.stringify({
            access_token: 'fresh-access-token',
            refresh_token: 'fresh-refresh-token',
            expires_in: 1800,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const session = await auth.getValidSession();

    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].input, 'https://auth.example.test/oauth/token');
    assert.strictEqual(requests[0].headers.get('content-type'), 'application/x-www-form-urlencoded');
    assert.strictEqual(requests[0].body.get('grant_type'), 'refresh_token');
    assert.strictEqual(requests[0].body.get('refresh_token'), 'old-refresh-token');
    assert.strictEqual(requests[0].body.get('client_id'), 'test-client-id');
    assert.strictEqual(session.accessToken, 'fresh-access-token');
    assert.strictEqual(session.refreshToken, 'fresh-refresh-token');
    assert.strictEqual(session.accountId, 'org_old');
    assert.strictEqual(session.email, 'old@example.test');

    const stored = JSON.parse(context.stored() || '{}');
    assert.strictEqual(stored.accessToken, 'fresh-access-token');
    assert.strictEqual(stored.refreshToken, 'fresh-refresh-token');
    assert.strictEqual(context.deleted(), false);
  });

  test('accepts numeric string expires_in when refreshing an expired stored session', async () => {
    const expiredSession = {
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() - 1000,
    };
    const { auth, context } = createAuth({
      initialSecret: JSON.stringify(expiredSession),
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: 'fresh-access-token',
            refresh_token: 'fresh-refresh-token',
            expires_in: '1800',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const before = Date.now();
    const session = await auth.getValidSession();
    const after = Date.now();

    assert.strictEqual(session.accessToken, 'fresh-access-token');
    assert.strictEqual(session.refreshToken, 'fresh-refresh-token');
    assert.ok(session.expiresAt >= before + 1800 * 1000, 'session expiry should use numeric string expires_in');
    assert.ok(session.expiresAt <= after + 1800 * 1000, 'session expiry should not exceed the parsed expires_in window');

    const stored = JSON.parse(context.stored() || '{}');
    assert.strictEqual(stored.accessToken, 'fresh-access-token');
    assert.strictEqual(stored.refreshToken, 'fresh-refresh-token');
    assert.ok(stored.expiresAt >= before + 1800 * 1000, 'stored expiry should use numeric string expires_in');
    assert.ok(stored.expiresAt <= after + 1800 * 1000, 'stored expiry should not exceed the parsed expires_in window');
  });

  test('attaches structured metadata to refresh failures from injected fetch', async () => {
    const expiredSession = {
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() - 1000,
    };
    const { auth, context } = createAuth({
      initialSecret: JSON.stringify(expiredSession),
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'refresh token expired',
              code: 'refresh_token_expired',
              type: 'oauth_error',
            },
          }),
          {
            status: 401,
            statusText: 'Unauthorized',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'req_refresh_1',
              'set-cookie': 'session=secret',
            },
          },
        ),
    });

    let thrown: any;
    try {
      await auth.getValidSession();
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected getValidSession to reject');
    assert.strictEqual(thrown.name, 'ProviderHttpError');
    assert.match(thrown.message, /Token refresh failed: HTTP 401 Unauthorized/);
    assert.doesNotMatch(thrown.message, /refresh token expired/);
    assert.strictEqual(thrown.status, 401);
    assert.strictEqual(thrown.statusCode, 401);
    assert.strictEqual(thrown.url, 'https://auth.example.test/oauth/token');
    assert.strictEqual(thrown.provider, 'ChatGPT Codex Subscription');
    assert.strictEqual(thrown.providerId, 'codexSubscription');
    assert.strictEqual(thrown.requestId, 'req_refresh_1');
    assert.strictEqual(thrown.responseBody, '<redacted>');
    assert.strictEqual(thrown.responseHeaders?.['set-cookie'], '<redacted>');
    assert.strictEqual(thrown.code, 'refresh_token_expired');
    assert.strictEqual(thrown.type, 'oauth_error');
    assert.strictEqual(context.deleted(), true, 'failed refresh should disconnect stale credentials');
  });

  test('disconnects stale credentials when refresh token expiration is reported with HTTP 400', async () => {
    const expiredSession = {
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() - 1000,
    };
    const { auth, context } = createAuth({
      initialSecret: JSON.stringify(expiredSession),
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'refresh token expired',
              code: 'refresh_token_expired',
              type: 'oauth_error',
            },
          }),
          {
            status: 400,
            statusText: 'Bad Request',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'req_refresh_400_expired_1',
            },
          },
        ),
    });

    let thrown: any;
    try {
      await auth.getValidSession();
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected getValidSession to reject');
    assert.strictEqual(thrown.name, 'ProviderHttpError');
    assert.match(thrown.message, /Token refresh failed: HTTP 400 Bad Request/);
    assert.doesNotMatch(thrown.message, /refresh token expired/);
    assert.strictEqual(thrown.status, 400);
    assert.strictEqual(thrown.providerId, 'codexSubscription');
    assert.strictEqual(thrown.requestId, 'req_refresh_400_expired_1');
    assert.strictEqual(thrown.responseBody, '<redacted>');
    assert.strictEqual(thrown.code, 'refresh_token_expired');
    assert.strictEqual(context.deleted(), true, 'expired refresh token should disconnect stale credentials');
  });

  test('preserves stored credentials on transient refresh failures', async () => {
    const expiredSession = {
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() - 1000,
    };
    const { auth, context } = createAuth({
      initialSecret: JSON.stringify(expiredSession),
      fetch: async () => {
        const error = new Error('socket hang up');
        (error as any).code = 'ECONNRESET';
        throw error;
      },
    });

    let thrown: any;
    try {
      await auth.getValidSession();
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected getValidSession to reject');
    assert.strictEqual(thrown.name, 'ProviderFetchError');
    assert.strictEqual(thrown.code, 'ECONNRESET');
    assert.strictEqual(thrown.type, 'network_error');
    assert.strictEqual(thrown.provider, 'ChatGPT Codex Subscription');
    assert.strictEqual(thrown.providerId, 'codexSubscription');
    assert.strictEqual(context.deleted(), false, 'transient refresh failure should keep stored credentials');
    const stored = JSON.parse(context.stored() || '{}');
    assert.strictEqual(stored.refreshToken, 'old-refresh-token');
  });

  test('redacts invalid refresh token payloads without dropping stored credentials', async () => {
    const expiredSession = {
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() - 1000,
    };
    const { auth, context } = createAuth({
      initialSecret: JSON.stringify(expiredSession),
      fetch: async () =>
        new Response(
          JSON.stringify({
            refresh_token: 'fresh-refresh-token',
            expires_in: 1800,
          }),
          {
            status: 200,
            statusText: 'OK',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'req_refresh_validation_1',
            },
          },
        ),
    });

    let thrown: any;
    try {
      await auth.getValidSession();
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected getValidSession to reject');
    assert.strictEqual(thrown.name, 'ProviderValidationError');
    assert.match(thrown.message, /Failed to parse token refresh response: invalid response payload \(HTTP 200 OK\)/);
    assert.match(thrown.message, /access_token/);
    assert.strictEqual(thrown.status, 200);
    assert.strictEqual(thrown.statusCode, 200);
    assert.strictEqual(thrown.url, 'https://auth.example.test/oauth/token');
    assert.strictEqual(thrown.responseBody, '<redacted>');
    assert.strictEqual(thrown.provider, 'ChatGPT Codex Subscription');
    assert.strictEqual(thrown.providerId, 'codexSubscription');
    assert.strictEqual(thrown.requestId, 'req_refresh_validation_1');
    assert.strictEqual(thrown.code, 'invalid_response_payload');
    assert.strictEqual(thrown.type, 'invalid_response');
    assert.match(thrown.validationMessage, /access_token/);
    assert.strictEqual(context.deleted(), false, 'invalid refresh payload should keep stored credentials for a later retry');
    const stored = JSON.parse(context.stored() || '{}');
    assert.strictEqual(stored.refreshToken, 'old-refresh-token');
  });

  test('uses injected fetch for authorization-code token exchange', async () => {
    const requests: Array<{ input: unknown; body: URLSearchParams }> = [];
    const { auth } = createAuth({
      fetch: async (input, init) => {
        requests.push({ input, body: new URLSearchParams(String(init?.body || '')) });
        return new Response(
          JSON.stringify({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const tokens = await (auth as any).exchangeCodeForTokens('code_123', 'http://localhost:1455/auth/callback', 'verifier_123');

    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].input, 'https://auth.example.test/oauth/token');
    assert.strictEqual(requests[0].body.get('grant_type'), 'authorization_code');
    assert.strictEqual(requests[0].body.get('code'), 'code_123');
    assert.strictEqual(requests[0].body.get('redirect_uri'), 'http://localhost:1455/auth/callback');
    assert.strictEqual(requests[0].body.get('client_id'), 'test-client-id');
    assert.strictEqual(requests[0].body.get('code_verifier'), 'verifier_123');
    assert.strictEqual(tokens.access_token, 'new-access-token');
    assert.strictEqual(tokens.refresh_token, 'new-refresh-token');
  });

  test('redacts invalid authorization-code exchange token payloads', async () => {
    const { auth } = createAuth({
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-access-token',
            expires_in: 3600,
          }),
          {
            status: 200,
            statusText: 'OK',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'req_exchange_validation_1',
            },
          },
        ),
    });

    let thrown: any;
    try {
      await (auth as any).exchangeCodeForTokens('code_123', 'http://localhost:1455/auth/callback', 'verifier_123');
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'expected exchangeCodeForTokens to reject');
    assert.strictEqual(thrown.name, 'ProviderValidationError');
    assert.match(thrown.message, /Failed to parse token exchange response: invalid response payload \(HTTP 200 OK\)/);
    assert.match(thrown.message, /refresh_token/);
    assert.strictEqual(thrown.status, 200);
    assert.strictEqual(thrown.statusCode, 200);
    assert.strictEqual(thrown.url, 'https://auth.example.test/oauth/token');
    assert.strictEqual(thrown.responseBody, '<redacted>');
    assert.strictEqual(thrown.provider, 'ChatGPT Codex Subscription');
    assert.strictEqual(thrown.providerId, 'codexSubscription');
    assert.strictEqual(thrown.requestId, 'req_exchange_validation_1');
    assert.strictEqual(thrown.code, 'invalid_response_payload');
    assert.strictEqual(thrown.type, 'invalid_response');
    assert.match(thrown.validationMessage, /refresh_token/);
  });

  test('disposes callback server when browser launch throws during authentication', async () => {
    const withProgressDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'withProgress');
    const openExternalDescriptor = Object.getOwnPropertyDescriptor(vscode.env, 'openExternal');
    const { auth } = createAuth({
      fetch: async () => new Response('{}', { status: 200 }),
    });
    let disposeCalls = 0;
    let waitForCallbackCalls = 0;

    (auth as any).startCallbackServer = async () => ({
      externalUri: vscode.Uri.parse('http://localhost:1455/lingyun/openai-account/callback'),
      waitForCallback: () => {
        waitForCallbackCalls += 1;
        return new Promise(() => {});
      },
      dispose: () => {
        disposeCalls += 1;
      },
    });

    Object.defineProperty(vscode.window, 'withProgress', {
      configurable: true,
      value: async (_options: unknown, task: (progress: { report: (_value: unknown) => void }) => Promise<unknown>) => task({ report: () => {} }),
    });
    Object.defineProperty(vscode.env, 'openExternal', {
      configurable: true,
      value: async () => {
        throw new Error('browser launch failed');
      },
    });

    try {
      let thrown: any;
      try {
        await auth.authenticate();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected authenticate to reject');
      assert.match(String(thrown.message), /browser launch failed/);
      assert.strictEqual(waitForCallbackCalls, 1);
      assert.strictEqual(disposeCalls, 1);
    } finally {
      if (withProgressDescriptor) {
        Object.defineProperty(vscode.window, 'withProgress', withProgressDescriptor);
      }
      if (openExternalDescriptor) {
        Object.defineProperty(vscode.env, 'openExternal', openExternalDescriptor);
      }
    }
  });
});
