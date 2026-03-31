import * as assert from 'assert';
import * as vscode from 'vscode';

import { resolveVscodeShellCommandInvocation } from '../../core/terminal/shellLaunch';

type ConfigMap = Record<string, unknown>;

function createConfig(values: ConfigMap): Pick<vscode.WorkspaceConfiguration, 'get'> {
  return {
    get<T>(section: string): T | undefined {
      return values[section] as T | undefined;
    },
  };
}

suite('Shell Launch', () => {
  test('prefers automation profile path and args over default profile', () => {
    const config = createConfig({
      'automationProfile.osx': 'LingYun Automation',
      'defaultProfile.osx': 'LingYun Default',
      'profiles.osx': {
        'LingYun Automation': { path: '/opt/homebrew/bin/zsh', args: ['-l'] },
        'LingYun Default': { path: '/bin/bash', args: ['-l'] },
      },
    });

    const resolved = resolveVscodeShellCommandInvocation('echo test', {
      config,
      platform: 'darwin',
      shellPath: '/bin/sh',
    });

    assert.deepStrictEqual(resolved, {
      executable: '/opt/homebrew/bin/zsh',
      args: ['-l', '-c', 'echo test'],
    });
  });

  test('uses default profile args when automation profile is not configured', () => {
    const config = createConfig({
      'defaultProfile.linux': 'Workspace Bash',
      'profiles.linux': {
        'Workspace Bash': { path: '/bin/bash', args: ['-l'] },
      },
    });

    const resolved = resolveVscodeShellCommandInvocation('pwd', {
      config,
      platform: 'linux',
      shellPath: '/bin/sh',
    });

    assert.deepStrictEqual(resolved, {
      executable: '/bin/bash',
      args: ['-l', '-c', 'pwd'],
    });
  });

  test('adds macOS login-shell args for zsh when no profile args exist', () => {
    const resolved = resolveVscodeShellCommandInvocation('command -v brew', {
      config: createConfig({}),
      platform: 'darwin',
      shellPath: '/bin/zsh',
    });

    assert.deepStrictEqual(resolved, {
      executable: '/bin/zsh',
      args: ['-l', '-c', 'command -v brew'],
    });
  });

  test('reuses explicit command-mode profile args without appending another switch', () => {
    const config = createConfig({
      'defaultProfile.osx': 'Inline Command Shell',
      'profiles.osx': {
        'Inline Command Shell': { path: '/bin/zsh', args: ['-lc'] },
      },
    });

    const resolved = resolveVscodeShellCommandInvocation('echo ready', {
      config,
      platform: 'darwin',
      shellPath: '/bin/sh',
    });

    assert.deepStrictEqual(resolved, {
      executable: '/bin/zsh',
      args: ['-lc', 'echo ready'],
    });
  });
});
