const SECRET_FIELD = String.raw`(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret|refresh[_-]?token)`;
const SECRET_KEY = String.raw`["']?(?:[A-Za-z0-9_./-]*)${SECRET_FIELD}(?:[A-Za-z0-9_./-]*)["']?`;

const QUOTED_SECRET_VALUE_PATTERN = new RegExp(`(${SECRET_KEY}\\s*[:=]\\s*)(["'])([\\s\\S]*?)(\\2)`, 'gi');
const SECRET_VALUE_PATTERN = new RegExp(`(${SECRET_KEY}\\s*[:=]\\s*)([^\\s,"')\\x60]+)`, 'gi');
const AUTH_BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{12,})\b/g;
const URL_SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|access[_-]?key|key|secret|token|password|client_secret|refresh_token|access_token)=)([^&#\s]+)/gi;
const URL_USERINFO_PATTERN = /(https?:\/\/[^\s/@:]+:)([^\s/@]+)(@)/gi;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

// High-confidence provider token patterns, intentionally biased toward distinctive prefixes.
const HIGH_CONFIDENCE_TOKEN_PATTERN = new RegExp(
  [
    String.raw`sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}`,
    String.raw`sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}`,
    String.raw`sk-[A-Za-z0-9_-]{16,}`,
    String.raw`github_pat_[A-Za-z0-9_]{40,}`,
    String.raw`gh[pousr]_[A-Za-z0-9_]{16,}`,
    String.raw`(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z2-7]{16}`,
    String.raw`AIza[\w-]{35}`,
    String.raw`hf_[A-Za-z]{34}`,
    String.raw`glpat-[\w-]{20}`,
    String.raw`gldt-[A-Za-z0-9_-]{20}`,
    String.raw`xoxb-[0-9]{10,13}-[0-9]{10,13}[A-Za-z0-9-]*`,
    String.raw`xox[pe](?:-[0-9]{10,13}){3}-[A-Za-z0-9-]{28,34}`,
    String.raw`xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+`,
    String.raw`npm_[A-Za-z0-9]{36}`,
    String.raw`pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}`,
    String.raw`(?:sk|rk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}`,
    String.raw`SG\.[A-Za-z0-9=_\-.]{66}`,
    String.raw`dop_v1_[a-f0-9]{64}`,
    String.raw`doo_v1_[a-f0-9]{64}`,
    String.raw`dapi[a-f0-9]{32}(?:-\d)?`,
    String.raw`pul-[a-f0-9]{40}`,
  ].join('|'),
  'gi',
);

export function redactMemorySecrets(text: string | undefined): string {
  const value = String(text || '');
  if (!value) return '';
  return value
    .replace(PRIVATE_KEY_BLOCK_PATTERN, '[REDACTED_SECRET]')
    .replace(URL_USERINFO_PATTERN, '$1[REDACTED_SECRET]$3')
    .replace(URL_SECRET_QUERY_PATTERN, '$1[REDACTED_SECRET]')
    .replace(AUTH_BEARER_PATTERN, '$1[REDACTED_SECRET]')
    .replace(QUOTED_SECRET_VALUE_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED_SECRET]${quote}`)
    .replace(SECRET_VALUE_PATTERN, '$1[REDACTED_SECRET]')
    .replace(HIGH_CONFIDENCE_TOKEN_PATTERN, '[REDACTED_SECRET]');
}

export function containsMemorySecret(text: string | undefined): boolean {
  const value = String(text || '');
  return !!value && redactMemorySecrets(value) !== value;
}
