import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

type CredentialsJson = {
  installed?: { client_id: string; client_secret: string; redirect_uris: string[] };
  web?: { client_id: string; client_secret: string; redirect_uris: string[] };
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadCredentials(filePath: string): Promise<NonNullable<CredentialsJson['installed']>> {
  const raw = await fs.readFile(filePath, 'utf8');

  let parsed: CredentialsJson;
  try {
    parsed = JSON.parse(raw) as CredentialsJson;
  } catch {
    throw new Error(`Invalid credentials json (failed to parse): ${path.basename(filePath)}`);
  }

  const entry = parsed.installed ?? parsed.web;
  if (
    !entry?.client_id ||
    !entry.client_secret ||
    !Array.isArray(entry.redirect_uris) ||
    entry.redirect_uris.length === 0
  ) {
    throw new Error(`Invalid credentials json (missing fields): ${path.basename(filePath)}`);
  }
  return entry;
}

async function loadTokenFromFile(tokenPath: string): Promise<Record<string, unknown> | undefined> {
  if (!tokenPath) return undefined;
  if (!(await fileExists(tokenPath))) return undefined;
  const raw = await fs.readFile(tokenPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') return undefined;
  return parsed;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(dir, 0o700);
  } catch {
    // ignore
  }

  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(value ?? {}, null, 2) + '\n';
  await fs.writeFile(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmpPath, filePath);
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // ignore
  }
}

function safeDisplayPath(value: string): string {
  const abs = path.resolve(value);

  const rel = path.relative(process.cwd(), abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel;
  }

  const home = os.homedir();
  if (home && (abs === home || abs.startsWith(home + path.sep))) {
    return `~${abs.slice(home.length)}`;
  }

  return path.basename(abs);
}

function extractAuthCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const match = trimmed.match(/(?:^|[?&])code=([^&]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    const code = url.searchParams.get('code');
    if (code) return code;
  } catch {
    // ignore
  }

  return trimmed;
}

export async function getGoogleAuth(params: {
  credentialsPath: string;
  tokenPath: string;
  scopes: string[];
}): Promise<OAuth2Client> {
  const creds = await loadCredentials(params.credentialsPath);

  const oAuth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);

  const existingToken = await loadTokenFromFile(params.tokenPath);
  if (existingToken) {
    oAuth2Client.setCredentials(existingToken as any);
    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: params.scopes,
    prompt: 'consent',
  });

  process.stderr.write('\nAuthorize this app by visiting this URL:\n');
  process.stderr.write(`${authUrl}\n\n`);

  if (!process.stdin.isTTY) {
    throw new Error('OAuth setup requires interactive stdin (run with a TTY to store the token on disk)');
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  rl.on('error', (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`readline error: ${msg}\n`);
  });
  const raw = (await rl.question('Paste the authorization code (or full redirect URL) here: ')).trim();
  rl.close();

  const code = extractAuthCode(raw);
  if (!code) {
    throw new Error('No authorization code provided');
  }

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  await writeJsonAtomic(params.tokenPath, tokens as any);
  process.stderr.write(`Saved Google OAuth token to ${safeDisplayPath(params.tokenPath)}\n`);

  return oAuth2Client;
}

