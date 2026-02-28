const path = require('path');
const esbuild = require('esbuild');

async function main() {
  const pkgRoot = path.resolve(__dirname, '..');
  const entryPoint = path.resolve(pkgRoot, 'dist', 'index.js');
  const outFile = path.resolve(pkgRoot, 'dist', 'index.cjs');

  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    sourcemap: true,
    logLevel: 'info',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

