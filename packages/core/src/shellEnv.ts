export type SafeChildProcessEnvOptions = {
  /**
   * Base environment to filter (defaults to process.env).
   */
  baseEnv?: NodeJS.ProcessEnv;
  /**
   * Extra environment variable names to pass through.
   *
   * Keep this host-controlled (do not let the model pick these), otherwise it can
   * request secrets like API keys.
   */
  extraAllowlist?: string[];
};

const DEFAULT_ALLOWLIST = [
  // Common POSIX
  'PATH',
  'HOME',
  'PWD',
  'OLDPWD',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  // XDG
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  // SSH agent (needed for git/ssh in many dev envs)
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  // TLS/CA (safe, but commonly needed in enterprise setups)
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  // Common non-secret toggles
  'CI',
  'NODE_ENV',
  // Windows
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERNAME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
];

function getEnvValue(baseEnv: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = baseEnv[key];
  if (typeof direct === 'string') return direct;

  if (process.platform !== 'win32') return undefined;

  // On Windows, env var names are case-insensitive. `process.env` is special,
  // but it is still safer to do a best-effort fallback scan.
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(baseEnv)) {
    if (k.toLowerCase() === lower && typeof v === 'string') return v;
  }

  return undefined;
}

export function buildSafeChildProcessEnv(options?: SafeChildProcessEnvOptions): NodeJS.ProcessEnv {
  const baseEnv = options?.baseEnv ?? process.env;
  const out: NodeJS.ProcessEnv = {};

  const allow = new Set<string>(DEFAULT_ALLOWLIST);
  for (const key of options?.extraAllowlist ?? []) {
    if (typeof key === 'string' && key.trim()) {
      allow.add(key.trim());
    }
  }

  for (const key of allow) {
    const value = getEnvValue(baseEnv, key);
    if (typeof value === 'string') {
      out[key] = value;
    }
  }

  return out;
}

