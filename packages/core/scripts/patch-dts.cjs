const fs = require('node:fs');
const path = require('node:path');

const distTypesDir = path.resolve(__dirname, '..', 'dist', 'types');

function rewriteSpecifier(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return spec;
  const ext = path.posix.extname(spec);
  if (ext) return spec;
  return `${spec}.js`;
}

function patchDtsText(text) {
  let out = text;

  // Rewrites `from './x'` -> `from './x.js'` for NodeNext consumers.
  out = out.replace(/\bfrom\s+(['"])(\.[^'"]+)\1/g, (_m, quote, spec) => {
    const next = rewriteSpecifier(spec);
    return `from ${quote}${next}${quote}`;
  });

  // Rewrites type queries: `import('./x')` -> `import('./x.js')`.
  out = out.replace(/\bimport\(\s*(['"])(\.[^'"]+)\1\s*\)/g, (_m, quote, spec) => {
    const next = rewriteSpecifier(spec);
    return `import(${quote}${next}${quote})`;
  });

  return out;
}

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, cb);
      continue;
    }
    if (entry.isFile()) cb(full);
  }
}

function main() {
  if (!fs.existsSync(distTypesDir)) return;

  walk(distTypesDir, (filePath) => {
    if (!filePath.endsWith('.d.ts')) return;

    const before = fs.readFileSync(filePath, 'utf8');
    const after = patchDtsText(before);
    if (after !== before) {
      fs.writeFileSync(filePath, after, 'utf8');
    }
  });
}

main();

