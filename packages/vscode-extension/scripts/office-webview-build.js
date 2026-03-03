const fs = require('fs');
const path = require('path');

const officeWebviewRoot = path.resolve(__dirname, '..', 'office-webview');
const officeWebviewConfig = path.resolve(officeWebviewRoot, 'vite.config.ts');
const officeWebviewOutDir = path.resolve(__dirname, '..', 'dist', 'office-webview');

const OFFICE_TILESET_FILES = [
  'Office Tileset All 16x16 no shadow.png',
  'Office Tileset All 16x16.png',
];

function copyOfficeTilesetAssets({ logPrefix = '[office-webview]' } = {}) {
  const srcRoot = path.resolve(officeWebviewRoot, 'vendor', 'Office_Tileset');
  if (!fs.existsSync(srcRoot)) return;

  // Only copy the exact files the extension can load, so the VSIX stays small
  // even if a developer has a larger local tileset folder.
  const dstRoot = path.resolve(officeWebviewOutDir, 'vendor', 'Office_Tileset');
  try {
    fs.mkdirSync(dstRoot, { recursive: true });
    for (const fileName of OFFICE_TILESET_FILES) {
      const src = path.join(srcRoot, fileName);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(dstRoot, fileName));
    }
  } catch (err) {
    console.error(`${logPrefix} failed to copy Office_Tileset assets`);
    throw err;
  }
}

function isRollupWatcher(value) {
  return !!value && typeof value === 'object' && typeof value.on === 'function';
}

async function buildOfficeWebview({ watch = false, logPrefix = '[office-webview]' } = {}) {
  try {
    // Lazy import because vite is ESM-only.
    const vite = await import('vite');
    if (typeof vite.build !== 'function') {
      throw new Error('vite.build is not available');
    }

    const result = await vite.build({
      configFile: officeWebviewConfig,
      root: officeWebviewRoot,
      logLevel: 'info',
      ...(watch ? { build: { watch: {} } } : {}),
    });

    if (watch && isRollupWatcher(result)) {
      result.on('event', (event) => {
        if (event?.code !== 'END') return;
        try {
          copyOfficeTilesetAssets({ logPrefix });
        } catch (err) {
          console.error(err);
        }
      });
    } else {
      copyOfficeTilesetAssets({ logPrefix });
    }

    return result;
  } catch (err) {
    console.error(`${logPrefix} build failed`);
    throw err;
  }
}

module.exports = { buildOfficeWebview };
