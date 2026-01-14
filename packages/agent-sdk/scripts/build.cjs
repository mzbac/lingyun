/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const esbuild = require('esbuild');

async function bundleRuntime() {
  const pkgRoot = path.resolve(__dirname, '..');
  const entryPoint = path.resolve(pkgRoot, 'src', 'index.ts');
  const outDir = path.resolve(pkgRoot, 'dist');
  const outFile = path.resolve(outDir, 'index.js');

  const coreEntry = path.resolve(pkgRoot, '..', 'core', 'dist', 'esm', 'index.js');

  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    sourcemap: true,
    external: ['ai', '@ai-sdk/openai-compatible', '@ai-sdk/provider', 'glob', 'undici', 'zod'],
    plugins: [
      {
        name: 'lingyun-core-alias',
        setup(build) {
          build.onResolve({ filter: /^@lingyun\/core$/ }, () => ({ path: coreEntry }));
        },
      },
    ],
  });

  const built = fs.readFileSync(outFile, 'utf8');
  if (built.includes('@lingyun/core')) {
    throw new Error('agent-sdk build must not reference @lingyun/core at runtime');
  }
}

async function bundleTypes() {
  const pkgRoot = path.resolve(__dirname, '..');
  const entryPoint = path.resolve(pkgRoot, 'src', 'index.ts');
  const outDir = path.resolve(pkgRoot, 'dist');
  const outFile = path.resolve(outDir, 'index.d.ts');
  const tsconfigPath = path.resolve(pkgRoot, 'tsconfig.json');

  const { generateDtsBundle } = await import('dts-bundle-generator');

  const [dts] = generateDtsBundle(
    [
      {
        filePath: entryPoint,
        output: { noBanner: true },
      },
    ],
    { preferredConfigPath: tsconfigPath }
  );

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, dts ?? '', 'utf8');

  const written = fs.readFileSync(outFile, 'utf8');
  if (/\bfrom\s+['"]@lingyun\/core['"]/.test(written) || /\bimport\s*\(\s*['"]@lingyun\/core['"]\s*\)/.test(written)) {
    throw new Error('agent-sdk types must not reference @lingyun/core');
  }
}

async function main() {
  await bundleRuntime();
  await bundleTypes();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

