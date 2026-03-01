const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function getMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function getNewestMtimeMs(dirPath) {
  let newest = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, getNewestMtimeMs(entryPath));
      continue;
    }
    if (!entry.isFile()) continue;
    newest = Math.max(newest, getMtimeMs(entryPath));
  }
  return newest;
}

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

const sdkDir = path.resolve(__dirname, '../packages/agent-sdk');
const sdkSrcDir = path.join(sdkDir, 'src');
const sdkScriptsDir = path.join(sdkDir, 'scripts');
const newestSourceMtimeMs = Math.max(
  fileExists(sdkSrcDir) ? getNewestMtimeMs(sdkSrcDir) : 0,
  fileExists(sdkScriptsDir) ? getNewestMtimeMs(sdkScriptsDir) : 0,
  getMtimeMs(path.join(sdkDir, 'package.json')),
  getMtimeMs(path.join(sdkDir, 'tsconfig.json')),
);

const outputs = {
  types: path.join(sdkDir, 'dist/index.d.ts'),
  esm: path.join(sdkDir, 'dist/index.js'),
  cjs: path.join(sdkDir, 'dist/index.cjs'),
};

const missing = Object.entries(outputs)
  .filter(([, outputPath]) => !fileExists(outputPath))
  .map(([key]) => key);

const stale = Object.entries(outputs)
  .filter(([, outputPath]) => fileExists(outputPath) && getMtimeMs(outputPath) < newestSourceMtimeMs)
  .map(([key]) => key);

const required = [...new Set([...missing, ...stale])];

if (required.length === 0) process.exit(0);

console.log(`[ensure-agent-sdk-build] Building @kooka/agent-sdk outputs: ${required.join(', ')}`);

// Note: do not use `pnpm -w` here: the workspace root also has a `build` script (turbo),
// which can race package builds and wipe dependency outputs mid-build.
run('pnpm --filter @kooka/agent-sdk build');

const stillMissing = Object.entries(outputs)
  .filter(([, outputPath]) => !fileExists(outputPath))
  .map(([key]) => key);

if (stillMissing.length > 0) {
  console.error(`[ensure-agent-sdk-build] Failed to build @kooka/agent-sdk outputs: ${stillMissing.join(', ')}`);
  process.exit(1);
}
