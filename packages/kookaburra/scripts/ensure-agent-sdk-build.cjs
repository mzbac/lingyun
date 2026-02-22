/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const agentSdkDist = path.join(repoRoot, 'packages', 'agent-sdk', 'dist', 'index.js');

function latestMtimeMs(p) {
  const stat = fs.statSync(p);
  if (stat.isFile()) return stat.mtimeMs;
  if (!stat.isDirectory()) return stat.mtimeMs;

  let max = stat.mtimeMs;
  for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, ent.name);
    try {
      max = Math.max(max, latestMtimeMs(child));
    } catch {
      // ignore unreadable entries
    }
  }
  return max;
}

const agentSdkRoot = path.join(repoRoot, 'packages', 'agent-sdk');
const agentSdkSrcDir = path.join(agentSdkRoot, 'src');
const agentSdkTsconfig = path.join(agentSdkRoot, 'tsconfig.json');
const agentSdkPkg = path.join(agentSdkRoot, 'package.json');

const needsBuild = (() => {
  if (!fs.existsSync(agentSdkDist)) return true;
  if (!fs.existsSync(agentSdkSrcDir)) return true;
  try {
    const distMtime = fs.statSync(agentSdkDist).mtimeMs;
    const inputsMtime = Math.max(
      latestMtimeMs(agentSdkSrcDir),
      fs.existsSync(agentSdkTsconfig) ? fs.statSync(agentSdkTsconfig).mtimeMs : 0,
      fs.existsSync(agentSdkPkg) ? fs.statSync(agentSdkPkg).mtimeMs : 0
    );
    return inputsMtime > distMtime;
  } catch {
    return true;
  }
})();

if (needsBuild) {
  console.log('[kookaburra] Building @kooka/agent-sdk (and deps) ...');
  execSync('pnpm --filter @kooka/agent-sdk build', { stdio: 'inherit', cwd: repoRoot });
}
