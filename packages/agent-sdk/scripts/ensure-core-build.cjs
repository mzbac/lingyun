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

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

const coreDir = path.resolve(__dirname, '../../core');
const coreOutputs = {
  types: path.join(coreDir, 'dist/types/index.d.ts'),
  esm: path.join(coreDir, 'dist/esm/index.js'),
  cjs: path.join(coreDir, 'dist/cjs/index.cjs'),
};

const missing = Object.entries(coreOutputs)
  .filter(([, outputPath]) => !fileExists(outputPath))
  .map(([key]) => key);

if (missing.length === 0) {
  process.exit(0);
}

console.log(`[agent-sdk] Building missing @kooka/core outputs: ${missing.join(', ')}`);

if (missing.includes('types')) run('pnpm -w --filter @kooka/core build:types');
if (missing.includes('esm')) run('pnpm -w --filter @kooka/core build:esm');
if (missing.includes('cjs')) run('pnpm -w --filter @kooka/core build:cjs');

const stillMissing = Object.entries(coreOutputs)
  .filter(([, outputPath]) => !fileExists(outputPath))
  .map(([key]) => key);

if (stillMissing.length > 0) {
  console.error(`[agent-sdk] Failed to build @kooka/core outputs: ${stillMissing.join(', ')}`);
  process.exit(1);
}
