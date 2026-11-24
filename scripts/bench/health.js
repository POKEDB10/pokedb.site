const { ensureServer, runAutocannon } = require('./_server');

async function main() {
  const server = await ensureServer();
  try {
    console.log(`Running health benchmark on ${server.baseUrl}/health (connections: 20, duration: 5s)...`);
    await runAutocannon([
      '-c', '20',
      '-d', '5',
      '-l',
      '--renderStatusCodes',
      `${server.baseUrl}/health`
    ]);
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
