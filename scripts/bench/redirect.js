const http = require('http');
const { ensureServer, runAutocannon } = require('./_server');

function seedShortLink(baseUrl) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      url: 'https://example.com/target-redirect-bench',
      customAlias: `bench-${Date.now()}`
    });

    const url = new URL(`${baseUrl}/api/shorten`);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'tinyurl.pokedb.site'
        }
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve(data.code);
            } catch (e) {
              reject(new Error(`Failed to parse response: ${body}`));
            }
          } else {
            reject(new Error(`Seed failed with HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const server = await ensureServer({
    nodeEnv: process.env.NODE_ENV || 'bench',
    env: { BENCH_BYPASS_LIMITER: '1' }
  });
  try {
    console.log(`Seeding short link on ${server.baseUrl}...`);
    const code = await seedShortLink(server.baseUrl);
    console.log(`Seeded short link code: ${code}`);

    const args = process.argv.slice(2);
    let connections = process.env.CONNECTIONS || '20';
    let duration = process.env.DURATION || '5';
    let isDirect = process.env.USE_DIRECT === '1' || args.includes('--direct');

    for (let i = 0; i < args.length; i++) {
      if ((args[i] === '-c' || args[i] === '--connections') && args[i + 1]) connections = args[++i];
      if ((args[i] === '-d' || args[i] === '--duration') && args[i + 1]) duration = args[++i];
    }

    const targetUrl = isDirect ? `${server.baseUrl}/${code}?direct=1` : `${server.baseUrl}/${code}`;

    console.log(`Running redirect benchmark on ${targetUrl} (connections: ${connections}, duration: ${duration}s)...`);
    await runAutocannon([
      '-c', connections,
      '-d', duration,
      '-l',
      '--renderStatusCodes',
      targetUrl
    ]);
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error('Redirect benchmark failed:', err);
  process.exit(1);
});
