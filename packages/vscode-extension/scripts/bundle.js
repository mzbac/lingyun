const path = require('path');
const esbuild = require('esbuild');

const args = process.argv.slice(2);
const watch = args.includes('--watch');

const entryPoint = path.resolve(__dirname, '..', 'src', 'extension.ts');
const outFile = path.resolve(__dirname, '..', 'dist', 'extension.js');
const SINGLE_VERSION_RUNTIME_PACKAGES = [
  'ai',
  '@ai-sdk/gateway',
  '@ai-sdk/openai-compatible',
  '@ai-sdk/provider',
  '@ai-sdk/provider-utils',
];
const EXCLUDED_RUNTIME_PACKAGES = ['glob'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getBundledPnpmVersions(inputs, packageName) {
  const encodedName = packageName.replace('/', '+');
  const packagePattern = new RegExp(
    '(?:^|/)node_modules/\\.pnpm/' + escapeRegExp(encodedName) + '@([^_/]+)'
  );
  const versions = new Set();
  for (const inputPath of Object.keys(inputs || {})) {
    const match = packagePattern.exec(inputPath);
    if (match) versions.add(match[1]);
  }
  return versions;
}

function getEmittedInputs(metafile) {
  const outputs = metafile && metafile.outputs;
  if (!outputs || Object.keys(outputs).length === 0) {
    return (metafile && metafile.inputs) || {};
  }

  const emittedInputs = {};
  for (const output of Object.values(outputs)) {
    for (const [inputPath, contribution] of Object.entries((output && output.inputs) || {})) {
      if (Number(contribution && contribution.bytesInOutput) > 0) {
        emittedInputs[inputPath] = contribution;
      }
    }
  }
  return emittedInputs;
}

function assertSingleRuntimeVersions(metafile) {
  const emittedInputs = getEmittedInputs(metafile);
  const duplicates = [];
  for (const packageName of SINGLE_VERSION_RUNTIME_PACKAGES) {
    const versions = getBundledPnpmVersions(emittedInputs, packageName);
    if (versions.size > 1) {
      duplicates.push(packageName + ': ' + [...versions].sort().join(', '));
    }
  }
  if (duplicates.length > 0) {
    throw new Error('Duplicate AI runtime versions in extension bundle: ' + duplicates.join('; '));
  }
}

function assertExcludedRuntimePackages(metafile) {
  const emittedInputs = getEmittedInputs(metafile);
  const bundled = [];
  for (const packageName of EXCLUDED_RUNTIME_PACKAGES) {
    const versions = getBundledPnpmVersions(emittedInputs, packageName);
    if (versions.size > 0) {
      bundled.push(packageName + ': ' + [...versions].sort().join(', '));
    }
  }
  if (bundled.length > 0) {
    throw new Error('Excluded packages in extension bundle: ' + bundled.join('; '));
  }
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  minify: true,
  sourcemap: true,
  metafile: true,
  external: ['vscode'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    // The shipped bundle never contains the webview e2e test hooks: this makes
    // WEBVIEW_TEST_HOOKS_ENABLED fold to false, dead-code-eliminating the test
    // eval bridge (methods.webview.ts) and the test harness accessor
    // (extension.ts). The tsc test build leaves the global undefined and the
    // test runner (dist/test/suite/index.js) sets it to true.
    'globalThis.LINGYUN_TEST_BUILD': 'false',
  },
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[bundle] watching...');
    return;
  }

  const result = await esbuild.build(options);
  assertSingleRuntimeVersions(result.metafile);
  assertExcludedRuntimePackages(result.metafile);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  assertExcludedRuntimePackages,
  assertSingleRuntimeVersions,
  getBundledPnpmVersions,
  getEmittedInputs,
};
