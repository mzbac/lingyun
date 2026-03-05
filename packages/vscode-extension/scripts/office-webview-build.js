const path = require('path');

const officeWebviewRoot = path.resolve(__dirname, '..', 'office-webview');
const officeWebviewConfig = path.resolve(officeWebviewRoot, 'vite.config.ts');

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

    return result;
  } catch (err) {
    console.error(`${logPrefix} build failed`);
    throw err;
  }
}

module.exports = { buildOfficeWebview };
