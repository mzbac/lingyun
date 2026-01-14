const fs = require('fs');
const path = require('path');

const distPath = path.resolve(__dirname, '..', 'dist');

try {
  fs.rmSync(distPath, { recursive: true, force: true });
} catch {
  // ignore
}

