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
const sdkTsconfigPath = path.join(sdkDir, 'tsconfig.json');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveTsconfigExtendsPath(tsconfigPath, extendsValue) {
  if (typeof extendsValue !== 'string' || !extendsValue.trim()) return undefined;
  const baseDir = path.dirname(tsconfigPath);
  const rawTarget = extendsValue.trim();
  const withJson = rawTarget.endsWith('.json') ? rawTarget : `${rawTarget}.json`;
  return path.resolve(baseDir, withJson);
}

function collectTsconfigDependencyPaths(tsconfigPath, seen = new Set()) {
  const resolvedPath = path.resolve(tsconfigPath);
  if (seen.has(resolvedPath) || !fileExists(resolvedPath)) return [];
  seen.add(resolvedPath);

  let parsed;
  try {
    parsed = readJsonFile(resolvedPath);
  } catch {
    return [resolvedPath];
  }

  const extendsPath = resolveTsconfigExtendsPath(resolvedPath, parsed && typeof parsed === 'object' ? parsed.extends : undefined);
  return [
    resolvedPath,
    ...(extendsPath ? collectTsconfigDependencyPaths(extendsPath, seen) : []),
  ];
}

const sdkBuildInputPaths = [
  path.join(sdkDir, 'package.json'),
  ...collectTsconfigDependencyPaths(sdkTsconfigPath),
];

const newestSourceMtimeMs = Math.max(
  fileExists(sdkSrcDir) ? getNewestMtimeMs(sdkSrcDir) : 0,
  fileExists(sdkScriptsDir) ? getNewestMtimeMs(sdkScriptsDir) : 0,
  ...sdkBuildInputPaths.map((filePath) => getMtimeMs(filePath)),
);

const outputs = {
  types: path.join(sdkDir, 'dist/index.d.ts'),
  esm: path.join(sdkDir, 'dist/index.js'),
  cjs: path.join(sdkDir, 'dist/index.cjs'),
};

const lockPath = path.join(sdkDir, '.ensure-build.lock');
const lockPollMs = 250;
const lockStaleMs = 5 * 60 * 1000;

function getRequiredOutputs() {
  const missing = Object.entries(outputs)
    .filter(([, outputPath]) => !fileExists(outputPath))
    .map(([key]) => key);

  const stale = Object.entries(outputs)
    .filter(([, outputPath]) => fileExists(outputPath) && getMtimeMs(outputPath) < newestSourceMtimeMs)
    .map(([key]) => key);

  return [...new Set([...missing, ...stale])];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLockInfo() {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === 'object' && error.code === 'EPERM';
  }
}

function isStaleLock(lockInfo) {
  if (!lockInfo || typeof lockInfo !== 'object') return true;
  const pid = Number(lockInfo.pid);
  const startedAt = Number(lockInfo.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return true;
  if (Date.now() - startedAt > lockStaleMs) return true;
  return !isProcessAlive(pid);
}

async function acquireBuildLock() {
  const payload = JSON.stringify({ pid: process.pid, startedAt: Date.now() });

  while (true) {
    try {
      fs.writeFileSync(lockPath, payload, { flag: 'wx' });
      return true;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        throw error;
      }

      if (getRequiredOutputs().length === 0) {
        return false;
      }

      if (isStaleLock(readLockInfo())) {
        try {
          fs.rmSync(lockPath, { force: true });
          continue;
        } catch {
          // Another process may own or remove the lock; fall through to wait.
        }
      }

      await sleep(lockPollMs);
    }
  }
}

(async () => {
  if (getRequiredOutputs().length === 0) return 0;

  const ownsLock = await acquireBuildLock();
  if (!ownsLock) return 0;

  try {
    const required = getRequiredOutputs();
    if (required.length === 0) return 0;

    console.log(`[ensure-agent-sdk-build] Building @kooka/agent-sdk outputs: ${required.join(', ')}`);

    // Note: do not use `pnpm -w` here: the workspace root also has a `build` script (turbo),
    // which can race package builds and wipe dependency outputs mid-build.
    run('pnpm --filter @kooka/agent-sdk build');

    const stillMissing = Object.entries(outputs)
      .filter(([, outputPath]) => !fileExists(outputPath))
      .map(([key]) => key);

    if (stillMissing.length > 0) {
      console.error(`[ensure-agent-sdk-build] Failed to build @kooka/agent-sdk outputs: ${stillMissing.join(', ')}`);
      return 1;
    }

    return 0;
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
})()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
