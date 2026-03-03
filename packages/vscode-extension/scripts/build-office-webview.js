const args = process.argv.slice(2);
const watch = args.includes('--watch');
const { buildOfficeWebview } = require('./office-webview-build');

async function main() {
  await buildOfficeWebview({ watch, logPrefix: '[office-webview]' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
