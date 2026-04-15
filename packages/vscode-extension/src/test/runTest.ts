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

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        ...process.env,
        LINGYUN_BASH_BACKGROUND_RUNNER: 'spawn',
      },
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
