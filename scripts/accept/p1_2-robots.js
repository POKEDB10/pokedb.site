const http = require('http');
const { ensureServer } = require('../bench/_server');

function fetchHeaders(baseUrl, path, host) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      url,
      {
        method: 'HEAD',
        headers: host ? { Host: host } : {}
      },
      (res) => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function fetchBody(baseUrl, path, host) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      url,
      {
        method: 'GET',
        headers: host ? { Host: host } : {}
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const server = await ensureServer();
  try {
    console.log(`=======================================================`);
    console.log(`Phase 1.2 Robots Policy Acceptance Verification`);
    console.log(`Server: ${server.baseUrl}`);
    console.log(`=======================================================\n`);

    const checks = [
      {
        name: 'tinyurl.pokedb.site / exact root',
        path: '/',
        host: 'tinyurl.pokedb.site',
        expectedTag: 'index, follow'
      },
      {
        name: 'tinyurl.pokedb.site /abc123 (short link code)',
        path: '/abc123',
        host: 'tinyurl.pokedb.site',
        expectedTag: 'noindex, nofollow, noarchive, nosnippet'
      },
      {
        name: 'drop.pokedb.site / exact root',
        path: '/',
        host: 'drop.pokedb.site',
        expectedTag: 'index, follow'
      },
      {
        name: 'drop.pokedb.site /v/test-drop-id',
        path: '/v/test-drop-id',
        host: 'drop.pokedb.site',
        expectedTag: 'noindex, nofollow, noarchive, nosnippet'
      },
      {
        name: 'paste.pokedb.site / exact root',
        path: '/',
        host: 'paste.pokedb.site',
        expectedTag: 'index, follow'
      },
      {
        name: 'paste.pokedb.site /p/test-paste-id',
        path: '/p/test-paste-id',
        host: 'paste.pokedb.site',
        expectedTag: 'noindex, nofollow, noarchive, nosnippet'
      },
      {
        name: 'pokedb.site / landing root',
        path: '/',
        host: 'pokedb.site',
        expectedTag: 'index, follow'
      },
      {
        name: 'health.pokedb.site /',
        path: '/',
        host: 'health.pokedb.site',
        expectedTag: 'noindex, follow'
      },
      {
        name: 'Shared static asset /shared/theme.css',
        path: '/shared/theme.css',
        host: 'tinyurl.pokedb.site',
        expectedTag: null // Must have NO robots tag
      },
      {
        name: 'API endpoint /api/health',
        path: '/api/health',
        host: 'pokedb.site',
        expectedTag: 'noindex'
      }
    ];

    let passed = 0;
    for (const check of checks) {
      const res = await fetchHeaders(server.baseUrl, check.path, check.host);
      const actualTag = res.headers['x-robots-tag'];
      const ok = actualTag === check.expectedTag || (!check.expectedTag && !actualTag);

      if (ok) {
        passed++;
        console.log(`[PASS] ${check.name}`);
        console.log(`       Path: ${check.path} | Host: ${check.host}`);
        console.log(`       X-Robots-Tag: ${actualTag || '(none - correct for static asset)'}\n`);
      } else {
        console.error(`[FAIL] ${check.name}`);
        console.error(`       Expected: ${check.expectedTag}`);
        console.error(`       Actual:   ${actualTag}\n`);
      }
    }

    // Verify robots.txt for tinyurl
    const robotsTiny = await fetchBody(server.baseUrl, '/robots.txt', 'tinyurl.pokedb.site');
    const robotsOk = robotsTiny.body.includes('Allow: /$') && robotsTiny.body.includes('Disallow: /api/');
    if (robotsOk) {
      passed++;
      console.log(`[PASS] robots.txt on tinyurl.pokedb.site`);
      console.log(`       Output:\n${robotsTiny.body.trim()}\n`);
    } else {
      console.error(`[FAIL] robots.txt on tinyurl.pokedb.site:\n${robotsTiny.body}`);
    }

    const total = checks.length + 1;
    console.log(`-------------------------------------------------------`);
    console.log(`Total checks: ${total} | Passed: ${passed} | Failed: ${total - passed}`);
    console.log(`-------------------------------------------------------`);

    if (passed !== total) {
      process.exit(1);
    }
    console.log('All robots policy acceptance checks passed.');
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error('Acceptance test failed:', err);
  process.exit(1);
});
