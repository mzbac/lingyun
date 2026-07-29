/**
 * Test Bootstrap
 *
 * Downloads VSCode and runs extension tests.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function prepareTestWorkspace(): Promise<string> {
  const templatePath = path.resolve(__dirname, '../../src/test/fixtures/workspace-template');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-vscode-test-workspace-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await fs.cp(templatePath, workspacePath, { recursive: true });
  return tempRoot;
}

function getGrepArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--grep' || arg === '-g') {
      return argv[i + 1];
    }
    if (arg.startsWith('--grep=')) {
      return arg.slice('--grep='.length);
    }
  }
  return undefined;
}

async function main() {
  let tempWorkspaceRoot: string | undefined;

  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the test runner script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Run against a copied fixture workspace so tests can mutate files without touching tracked fixtures.
    tempWorkspaceRoot = await prepareTestWorkspace();
    const testWorkspacePath = path.join(tempWorkspaceRoot, 'workspace');
    const extensionTestsEnv: NodeJS.ProcessEnv = {
      ...process.env,
      LINGYUN_BASH_BACKGROUND_RUNNER: 'spawn',
    };
    const grep = getGrepArg(process.argv.slice(2));
    if (grep) {
      extensionTestsEnv.LINGYUN_TEST_GREP = grep;
    }

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv,
      launchArgs: [
        testWorkspacePath,
        '--disable-extensions', // Disable other extensions
      ],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  } finally {
    if (tempWorkspaceRoot) {
      await fs.rm(tempWorkspaceRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

main();
