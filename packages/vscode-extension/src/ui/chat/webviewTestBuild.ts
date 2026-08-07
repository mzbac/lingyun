/**
 * Build-time switch for the webview e2e test hooks.
 *
 * The test runner (`src/test/suite/index.ts`) sets `globalThis.LINGYUN_TEST_BUILD
 * = true` before the extension activates, so the tsc test build enables the
 * webview e2e hooks. The production esbuild bundle (`scripts/bundle.js`)
 * defines `globalThis.LINGYUN_TEST_BUILD` as `false`, which lets esbuild fold
 * every `globalThis.LINGYUN_TEST_BUILD === true` guard to `false` at build time
 * and dead-code-eliminate the test-only branches, so the shipped extension
 * bundle contains no test/eval bridge code.
 */
declare global {
  // eslint-disable-next-line no-var
  var LINGYUN_TEST_BUILD: boolean | undefined;
}

export {};
