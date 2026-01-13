const path = require('path');
const esbuild = require('esbuild');

const args = process.argv.slice(2);
const watch = args.includes('--watch');

const entryPoint = path.resolve(__dirname, '..', 'src', 'extension.ts');
const outFile = path.resolve(__dirname, '..', 'dist', 'extension.js');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  external: ['vscode'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
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

  await esbuild.build(options);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

