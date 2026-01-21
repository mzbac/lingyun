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

const coreDir = path.resolve(__dirname, '../../core');
const coreSrcDir = path.join(coreDir, 'src');
const newestCoreSourceMtimeMs = fileExists(coreSrcDir) ? getNewestMtimeMs(coreSrcDir) : 0;
const coreOutputs = {
  types: path.join(coreDir, 'dist/types/index.d.ts'),
  esm: path.join(coreDir, 'dist/esm/index.js'),
  cjs: path.join(coreDir, 'dist/cjs/index.cjs'),
};

const missing = Object.entries(coreOutputs)
  .filter(([, outputPath]) => !fileExists(outputPath))
  .map(([key]) => key);

const stale = Object.entries(coreOutputs)
  .filter(([, outputPath]) => fileExists(outputPath) && getMtimeMs(outputPath) < newestCoreSourceMtimeMs)
  .map(([key]) => key);

const required = [...new Set([...missing, ...stale])];

if (required.length === 0) process.exit(0);

console.log(`[agent-sdk] Building @kooka/core outputs: ${required.join(', ')}`);

if (required.includes('types')) run('pnpm -w --filter @kooka/core build:types');
if (required.includes('esm')) run('pnpm -w --filter @kooka/core build:esm');
if (required.includes('cjs')) run('pnpm -w --filter @kooka/core build:cjs');

const stillMissing = Object.entries(coreOutputs)
  .filter(([, outputPath]) => !fileExists(outputPath))
  .map(([key]) => key);

if (stillMissing.length > 0) {
  console.error(`[agent-sdk] Failed to build @kooka/core outputs: ${stillMissing.join(', ')}`);
  process.exit(1);
}
