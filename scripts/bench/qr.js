const { ensureServer, runAutocannon } = require('./_server');

async function main() {
  const server = await ensureServer();
  try {
    console.log(`Running QR generation benchmark on ${server.baseUrl}/api/qr (connections: 10, duration: 5s)...`);
    await runAutocannon([
      '-c', '10',
      '-d', '5',
      '-l',
      '--renderStatusCodes',
      `${server.baseUrl}/api/qr?text=https://pokedb.site`
    ]);
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
