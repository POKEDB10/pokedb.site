const { ensureServer, runAutocannon } = require('./_server');

async function main() {
  const server = await ensureServer();
  try {
    console.log(`Running landing page benchmark on ${server.baseUrl}/ (Host: pokedb.site, connections: 20, duration: 5s)...`);
    await runAutocannon([
      '-c', '20',
      '-d', '5',
      '-H', 'Host=pokedb.site',
      '-l',
      '--renderStatusCodes',
      `${server.baseUrl}/`
    ]);
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
