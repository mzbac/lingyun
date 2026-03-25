import * as http from 'node:http';
import * as vscode from 'vscode';

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>LingYun Authorization Successful</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #111827;
        color: #f9fafb;
      }
      .card {
        max-width: 520px;
        padding: 24px;
        text-align: center;
      }
      h1 { margin: 0 0 8px 0; font-size: 20px; }
      p { margin: 0; color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to VS Code.</p>
    </div>
    <script>setTimeout(() => window.close(), 1200)</script>
  </body>
</html>`;

function htmlError(message: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>LingYun Authorization Failed</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #111827;
        color: #f9fafb;
      }
      .card {
        max-width: 620px;
        padding: 24px;
      }
      h1 { margin: 0 0 8px 0; font-size: 20px; color: #fda4af; }
      p { margin: 0 0 12px 0; color: #d1d5db; }
      code {
        display: block;
        padding: 12px;
        border-radius: 8px;
        background: #1f2937;
        color: #f9fafb;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Authorization Failed</h1>
      <p>An error occurred while completing authorization.</p>
      <code>${escapeHtml(message)}</code>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('');
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomString(43);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(hash) };
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

export interface OpenAIAccountTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
  };
}

export interface OpenAIAccountSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  email?: string;
}

type TokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

export interface OpenAIAccountAuthState {
  supported: true;
  authenticated: boolean;
  status: 'signed_out' | 'signed_in';
  label: string;
  detail?: string;
  accountLabel?: string;
}

export interface OpenAIAccountAuthOptions {
  context: vscode.ExtensionContext;
  secretStorageKey: string;
  providerName: string;
  clientId: string;
  authorizePath?: string;
  tokenPath?: string;
  scope?: string;
  issuer?: string;
  authorizeParams?: Record<string, string>;
  browserInstructions?: string;
  redirectPort?: number;
  redirectPath?: string;
  useExternalUri?: boolean;
}

export function parseJwtClaims(token: string): OpenAIAccountTokenClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function extractAccountIdFromClaims(claims: OpenAIAccountTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

function extractAccountMetadata(tokens: TokenResponse): { accountId?: string; email?: string } {
  const ordered = [tokens.id_token, tokens.access_token];
  for (const token of ordered) {
    if (!token) continue;
    const claims = parseJwtClaims(token);
    if (!claims) continue;
    return {
      accountId: extractAccountIdFromClaims(claims),
      email: typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim() : undefined,
    };
  }
  return {};
}

export class OpenAIAccountAuth {
  private readonly issuer: string;
  private readonly authorizePath: string;
  private readonly tokenPath: string;
  private readonly scope: string;
  private readonly authorizeParams: Record<string, string>;
  private sessionCache?: OpenAIAccountSession | null;
  private sessionLoadPromise?: Promise<OpenAIAccountSession | null>;
  private refreshPromise?: Promise<OpenAIAccountSession>;
  private forceRefresh = false;

  constructor(private readonly options: OpenAIAccountAuthOptions) {
    this.issuer = (options.issuer || 'https://auth.openai.com').replace(/\/+$/, '');
    this.authorizePath = options.authorizePath || '/oauth/authorize';
    this.tokenPath = options.tokenPath || '/oauth/token';
    this.scope = options.scope || 'openid profile email offline_access';
    this.authorizeParams = options.authorizeParams || {};
  }

  async getAuthState(): Promise<OpenAIAccountAuthState> {
    const session = await this.loadSession();
    if (!session) {
      return {
        supported: true,
        authenticated: false,
        status: 'signed_out',
        label: 'Sign in',
        detail: `Use your ${this.options.providerName} account in LingYun.`,
      };
    }

    const accountLabel = session.email || session.accountId;
    return {
      supported: true,
      authenticated: true,
      status: 'signed_in',
      label: accountLabel ? 'Connected' : 'Signed in',
      detail: accountLabel ? `Connected as ${accountLabel}.` : `Connected to ${this.options.providerName}.`,
      accountLabel,
    };
  }

  async authenticate(): Promise<OpenAIAccountSession> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `LingYun: Sign in to ${this.options.providerName}`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Preparing browser sign-in…' });
        const callback = await this.startCallbackServer();
        const pkce = await generatePKCE();
        const state = generateState();
        const redirectUri = callback.externalUri.toString(true);
        const authUrl = this.buildAuthorizeUrl(redirectUri, pkce.challenge, state);
        const callbackPromise = callback.waitForCallback(pkce.verifier, state, redirectUri);

        progress.report({ message: this.options.browserInstructions || 'Authorization will open in your browser.' });
        const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
        if (!opened) {
          callback.dispose();
          throw new Error(`Failed to open the ${this.options.providerName} authorization page.`);
        }

        try {
          const next = await callbackPromise;
          await this.saveSession(next);
          this.forceRefresh = false;
          return next;
        } finally {
          callback.dispose();
        }
      },
    );
  }

  async disconnect(): Promise<void> {
    this.sessionCache = null;
    this.sessionLoadPromise = undefined;
    this.forceRefresh = false;
    await this.options.context.secrets.delete(this.options.secretStorageKey);
  }

  invalidateAccessToken(): void {
    this.forceRefresh = true;
    if (this.sessionCache) {
      this.sessionCache = {
        ...this.sessionCache,
        accessToken: '',
        expiresAt: 0,
      };
    }
  }

  async getValidSession(): Promise<OpenAIAccountSession> {
    const session = await this.loadSession();
    if (!session) {
      throw new Error(`Sign in to ${this.options.providerName} to use this provider.`);
    }

    if (!this.forceRefresh && session.accessToken && session.expiresAt > Date.now() + 60_000) {
      return session;
    }

    return this.refreshSession(session);
  }

  private buildAuthorizeUrl(redirectUri: string, challenge: string, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      scope: this.scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      ...this.authorizeParams,
    });
    return `${this.issuer}${this.authorizePath}?${params.toString()}`;
  }

  private async exchangeCodeForTokens(code: string, redirectUri: string, verifier: string): Promise<TokenResponse> {
    const response = await fetch(`${this.issuer}${this.tokenPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.options.clientId,
        code_verifier: verifier,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: HTTP ${response.status}`);
    }

    return (await response.json()) as TokenResponse;
  }

  private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const response = await fetch(`${this.issuer}${this.tokenPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.options.clientId,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: HTTP ${response.status}`);
    }

    return (await response.json()) as TokenResponse;
  }

  private async refreshSession(session: OpenAIAccountSession): Promise<OpenAIAccountSession> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const tokens = await this.refreshAccessToken(session.refreshToken);
        const metadata = extractAccountMetadata(tokens);
        const next: OpenAIAccountSession = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          accountId: metadata.accountId || session.accountId,
          email: metadata.email || session.email,
        };
        await this.saveSession(next);
        this.forceRefresh = false;
        return next;
      } catch (error) {
        await this.disconnect();
        throw error;
      } finally {
        this.refreshPromise = undefined;
      }
    })();

    return this.refreshPromise;
  }

  private async loadSession(): Promise<OpenAIAccountSession | null> {
    if (this.sessionCache !== undefined) return this.sessionCache;
    if (this.sessionLoadPromise) return this.sessionLoadPromise;

    this.sessionLoadPromise = (async () => {
      const raw = await this.options.context.secrets.get(this.options.secretStorageKey);
      if (!raw) {
        this.sessionCache = null;
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as Partial<OpenAIAccountSession>;
        if (
          !parsed ||
          typeof parsed.accessToken !== 'string' ||
          typeof parsed.refreshToken !== 'string' ||
          typeof parsed.expiresAt !== 'number'
        ) {
          throw new Error('Invalid stored auth payload');
        }

        this.sessionCache = {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          ...(typeof parsed.accountId === 'string' && parsed.accountId.trim()
            ? { accountId: parsed.accountId.trim() }
            : {}),
          ...(typeof parsed.email === 'string' && parsed.email.trim()
            ? { email: parsed.email.trim() }
            : {}),
        };
      } catch {
        this.sessionCache = null;
        await this.options.context.secrets.delete(this.options.secretStorageKey);
      }

      return this.sessionCache;
    })();

    try {
      return await this.sessionLoadPromise;
    } finally {
      this.sessionLoadPromise = undefined;
    }
  }

  private async saveSession(session: OpenAIAccountSession): Promise<void> {
    this.sessionCache = session;
    await this.options.context.secrets.store(this.options.secretStorageKey, JSON.stringify(session));
  }

  private async startCallbackServer(): Promise<{
    externalUri: vscode.Uri;
    waitForCallback: (verifier: string, state: string, redirectUri: string) => Promise<OpenAIAccountSession>;
    dispose: () => void;
  }> {
    const server = http.createServer();
    const callbackPath = this.options.redirectPath || '/lingyun/openai-account/callback';
    const requestedPort =
      typeof this.options.redirectPort === 'number' && Number.isFinite(this.options.redirectPort)
        ? Math.max(1, Math.floor(this.options.redirectPort))
        : 0;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, () => resolve());
      });
    } catch (error) {
      try {
        server.close();
      } catch {
        // ignore
      }
      if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE' && requestedPort > 0) {
        throw new Error(`OAuth callback port ${requestedPort} is already in use. Close any other auth flow and retry.`);
      }
      throw error;
    }

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Failed to start OAuth callback server.');
    }

    const redirectUri = `http://localhost:${address.port}${callbackPath}`;
    const localUri = vscode.Uri.parse(redirectUri);
    const externalUri =
      this.options.useExternalUri === false ? localUri : await vscode.env.asExternalUri(localUri);

    let finished = false;
    let timeout: NodeJS.Timeout | undefined;

    const waitForCallback = (verifier: string, expectedState: string, resolvedRedirectUri: string) =>
      new Promise<OpenAIAccountSession>((resolve, reject) => {
        const finish = (error?: Error, result?: OpenAIAccountSession) => {
          if (finished) return;
          finished = true;
          if (timeout) clearTimeout(timeout);
          try {
            server.close();
          } catch {
            // ignore
          }
          if (error) reject(error);
          else if (result) resolve(result);
          else reject(new Error('Authorization did not complete.'));
        };

        timeout = setTimeout(() => {
          finish(new Error('OAuth callback timed out.'));
        }, 5 * 60 * 1000);

        server.on('request', async (req, res) => {
          try {
            const rawUrl = req.url || '/';
            const url = new URL(rawUrl, resolvedRedirectUri);
            if (url.pathname !== callbackPath) {
              res.statusCode = 404;
              res.end('Not found');
              return;
            }

            const state = url.searchParams.get('state');
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            const errorDescription = url.searchParams.get('error_description');

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(htmlError(errorDescription || error));
              finish(new Error(errorDescription || error));
              return;
            }

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(htmlError('Missing authorization code.'));
              finish(new Error('Missing authorization code.'));
              return;
            }

            if (!state || state !== expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(htmlError('Invalid OAuth state.'));
              finish(new Error('Invalid OAuth state.'));
              return;
            }

            const tokens = await this.exchangeCodeForTokens(code, resolvedRedirectUri, verifier);
            const metadata = extractAccountMetadata(tokens);
            const session: OpenAIAccountSession = {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              ...(metadata.accountId ? { accountId: metadata.accountId } : {}),
              ...(metadata.email ? { email: metadata.email } : {}),
            };

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML_SUCCESS);
            finish(undefined, session);
          } catch (requestError) {
            const message = requestError instanceof Error ? requestError.message : String(requestError);
            try {
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(htmlError(message));
            } catch {
              // ignore
            }
            finish(requestError instanceof Error ? requestError : new Error(message));
          }
        });
      });

    return {
      externalUri,
      waitForCallback,
      dispose: () => {
        if (finished) return;
        finished = true;
        if (timeout) clearTimeout(timeout);
        try {
          server.close();
        } catch {
          // ignore
        }
      },
    };
  }
}
