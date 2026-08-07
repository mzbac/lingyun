/**
 * Test Runner
 * 
 * Entry point for VSCode extension tests.
 * Runs in the Extension Development Host.
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

// Enable the extension's test-only hooks (the webview e2e DOM bridge). This
// runs in the extension host before the extension activates; the production
// esbuild bundle defines this global as `false` and strips the hooks.
(globalThis as { LINGYUN_TEST_BUILD?: boolean }).LINGYUN_TEST_BUILD = true;

export async function run(): Promise<void> {
  const grep = process.env.LINGYUN_TEST_GREP;
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000,
    grep: grep ? new RegExp(grep) : undefined,
  });

  const testsRoot = path.resolve(__dirname, '.');

  const files = await glob('**/**.test.js', { cwd: testsRoot });
  
  files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
