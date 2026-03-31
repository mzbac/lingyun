import * as path from 'path';
import * as vscode from 'vscode';

type ConfigReader = Pick<vscode.WorkspaceConfiguration, 'get'>;

type TerminalProfile = {
  path?: string | string[];
  args?: string | string[];
};

export type ShellCommandInvocation = {
  executable: string;
  args: string[];
};

function getPlatformKey(platform: NodeJS.Platform): 'linux' | 'osx' | 'windows' {
  if (platform === 'darwin') return 'osx';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

function normalizeStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeShellPath(value: string | string[] | undefined): string | undefined {
  return normalizeStringArray(value)[0];
}

function getProfile(
  config: ConfigReader,
  platformKey: 'linux' | 'osx' | 'windows',
  settingKey: `automationProfile.${'linux' | 'osx' | 'windows'}` | `defaultProfile.${'linux' | 'osx' | 'windows'}`,
): TerminalProfile | undefined {
  const name = config.get<string>(settingKey);
  if (!name) return undefined;
  const profiles = config.get<Record<string, TerminalProfile>>(`profiles.${platformKey}`);
  const profile = profiles?.[name];
  return profile && typeof profile === 'object' ? profile : undefined;
}

function shellBasename(shellPath: string): string {
  return path.basename(shellPath).toLowerCase();
}

function getCommandSwitch(shellPath: string): string[] {
  const base = shellBasename(shellPath);
  if (base === 'cmd' || base === 'cmd.exe') {
    return ['/d', '/s', '/c'];
  }
  if (
    base === 'powershell' ||
    base === 'powershell.exe' ||
    base === 'pwsh' ||
    base === 'pwsh.exe'
  ) {
    return ['-Command'];
  }
  return ['-c'];
}

function hasCommandSwitch(shellPath: string, args: string[]): boolean {
  const base = shellBasename(shellPath);
  const lowerArgs = args.map((arg) => arg.toLowerCase());

  if (base === 'cmd' || base === 'cmd.exe') {
    return lowerArgs.includes('/c') || lowerArgs.includes('/k');
  }

  if (
    base === 'powershell' ||
    base === 'powershell.exe' ||
    base === 'pwsh' ||
    base === 'pwsh.exe'
  ) {
    return lowerArgs.includes('-command');
  }

  return lowerArgs.includes('-c') || lowerArgs.includes('-lc') || lowerArgs.includes('-cl');
}

function getImplicitProfileArgs(shellPath: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'darwin') return [];
  const base = shellBasename(shellPath);
  if (base === 'zsh' || base === 'bash') {
    return ['-l'];
  }
  return [];
}

export function resolveVscodeShellCommandInvocation(
  command: string,
  options?: {
    config?: ConfigReader;
    platform?: NodeJS.Platform;
    shellPath?: string;
  },
): ShellCommandInvocation | undefined {
  const platform = options?.platform ?? process.platform;
  const config = options?.config ?? vscode.workspace.getConfiguration('terminal.integrated');
  const platformKey = getPlatformKey(platform);

  const automationProfile = getProfile(config, platformKey, `automationProfile.${platformKey}`);
  const defaultProfile = getProfile(config, platformKey, `defaultProfile.${platformKey}`);

  const shellPath =
    normalizeShellPath(automationProfile?.path) ??
    normalizeShellPath(defaultProfile?.path) ??
    options?.shellPath ??
    vscode.env.shell;

  if (!shellPath || !shellPath.trim()) return undefined;

  const automationArgs = normalizeStringArray(automationProfile?.args);
  const defaultArgs = normalizeStringArray(defaultProfile?.args);
  const profileArgs = automationArgs.length > 0 ? automationArgs : defaultArgs;
  const preArgs = profileArgs.length > 0 ? profileArgs : getImplicitProfileArgs(shellPath, platform);
  const args = hasCommandSwitch(shellPath, preArgs)
    ? [...preArgs, command]
    : [...preArgs, ...getCommandSwitch(shellPath), command];

  return {
    executable: shellPath,
    args,
  };
}
