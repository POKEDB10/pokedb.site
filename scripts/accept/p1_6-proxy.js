// scripts/accept/p1_6-proxy.js
// Acceptance script for Task P1.6 (SEC-001, H2, H3: Trust proxy, diag, origin verify, rate limits)

const http = require('node:http');
const { ensureServer } = require('../bench/_server.js');

const PORT = 5055;
const ADMIN_TOKEN = 'diag-admin-token-secret-xyz';
const ORIGIN_SECRET = 'origin-verify-secret-abc';

function request(port, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      Host: 'pokedb.site',
      ...headers
    };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
        timeout: 4000
      },
      (res) => {
        let resBody = '';
        res.on('data', (d) => { resBody += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(resBody); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: resBody, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 1.6 Trust Proxy & Security Acceptance Verification');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message, detail = '') {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} - ${detail}`);
      failed++;
    }
  }

  // --- Part 1: Diagnostics Endpoint and Origin Verify ---
  console.log('--- Part 1: /__diag/ip and ORIGIN_VERIFY_SECRET ---');
  const server1 = await ensureServer({
    port: 5055,
    env: {
      ADMIN_TOKEN,
      ORIGIN_VERIFY_SECRET: ORIGIN_SECRET,
      TRUST_PROXY: 'false'
    }
  });

  try {
    // 1. /healthz from loopback allowed without origin secret
    const resHealthz = await request(5055, 'GET', '/healthz');
    assert(
      resHealthz.status === 200,
      'GET /healthz allowed from loopback without X-Origin-Verify',
      `Got status ${resHealthz.status}`
    );

    // 2. Request without origin secret gets 403
    const resNoOrigin = await request(5055, 'GET', '/api/health/ping');
    assert(
      resNoOrigin.status === 403,
      'Request lacking matching X-Origin-Verify rejected with 403',
      `Got status ${resNoOrigin.status}`
    );

    // 3. Request with valid origin secret passes
    const resWithOrigin = await request(5055, 'GET', '/api/health/ping', {
      'X-Origin-Verify': ORIGIN_SECRET
    });
    assert(
      resWithOrigin.status === 200,
      'Request with valid X-Origin-Verify header accepted (200)',
      `Got status ${resWithOrigin.status}`
    );

    // 4. /__diag/ip without auth -> 403
    const resDiagNoAuth = await request(5055, 'GET', '/__diag/ip', {
      'X-Origin-Verify': ORIGIN_SECRET
    });
    assert(
      resDiagNoAuth.status === 403,
      'GET /__diag/ip without token rejected with 403',
      `Got status ${resDiagNoAuth.status}`
    );

    // 5. /__diag/ip with Bearer token -> 200 with diagnostics
    const resDiagAuth = await request(5055, 'GET', '/__diag/ip', {
      'X-Origin-Verify': ORIGIN_SECRET,
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
      'X-Forwarded-For': '203.0.113.50',
      'CF-Connecting-IP': '198.51.100.22'
    });
    assert(
      resDiagAuth.status === 200 && resDiagAuth.json?.remoteAddress,
      'GET /__diag/ip with Bearer token returns diagnostics JSON',
      `Status: ${resDiagAuth.status}`
    );
    assert(
      resDiagAuth.json?.ip === '127.0.0.1' || resDiagAuth.json?.ip === '::ffff:127.0.0.1',
      'Direct mode (TRUST_PROXY=false): req.ip ignores spoofed X-Forwarded-For',
      `req.ip = ${resDiagAuth.json?.ip}`
    );
  } finally {
    await server1.stop();
  }

  // --- Part 2: Proxy Topology IP Resolution Matrix ---
  console.log('\n--- Part 2: Proxy Topology IP Resolution Matrix ---');

  // Topology A: 1 hop (TRUST_PROXY=1)
  const serverHop1 = await ensureServer({
    port: 5056,
    env: { ADMIN_TOKEN, TRUST_PROXY: '1' }
  });
  try {
    const res = await request(5056, 'GET', '/__diag/ip', {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'X-Forwarded-For': '203.0.113.1, 198.51.100.99'
    });
    assert(
      res.json?.ip === '198.51.100.99',
      'TRUST_PROXY=1 resolves rightmost hop (198.51.100.99) as client IP',
      `req.ip = ${res.json?.ip}`
    );
  } finally {
    await serverHop1.stop();
  }

  // Topology B: 2 hops (TRUST_PROXY=2)
  const serverHop2 = await ensureServer({
    port: 5057,
    env: { ADMIN_TOKEN, TRUST_PROXY: '2' }
  });
  try {
    const res = await request(5057, 'GET', '/__diag/ip', {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'X-Forwarded-For': '203.0.113.1, 198.51.100.99, 10.0.0.1'
    });
    assert(
      res.json?.ip === '198.51.100.99',
      'TRUST_PROXY=2 resolves second hop from right (198.51.100.99) as client IP',
      `req.ip = ${res.json?.ip}`
    );
  } finally {
    await serverHop2.stop();
  }

  // Topology C: Cloudflare Tunnel (TRUST_PROXY=loopback,uniquelocal)
  const serverTunnel = await ensureServer({
    port: 5058,
    env: { ADMIN_TOKEN, TRUST_PROXY: 'loopback,uniquelocal' }
  });
  try {
    const res = await request(5058, 'GET', '/__diag/ip', {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'X-Forwarded-For': '203.0.113.88'
    });
    assert(
      res.json?.ip === '203.0.113.88',
      'TRUST_PROXY="loopback,uniquelocal" trusts loopback caller and resolves client IP (203.0.113.88)',
      `req.ip = ${res.json?.ip}`
    );
  } finally {
    await serverTunnel.stop();
  }

  // --- Part 3: Spoof Test on /api/shorten ---
  console.log('\n--- Part 3: Spoof Test on /api/shorten ---');
  const serverSpoof = await ensureServer({
    port: 5059,
    env: { TRUST_PROXY: 'false' }
  });
  try {
    console.log('Sending 35 requests to /api/shorten with rotating X-Forwarded-For spoof headers...');
    const codes = [];
    for (let i = 1; i <= 35; i++) {
      const res = await request(
        5059,
        'POST',
        '/api/shorten',
        {
          Host: 'tinyurl.pokedb.site',
          'X-Forwarded-For': `203.0.113.${i}`
        },
        { url: `https://example.com/target-${i}` }
      );
      codes.push(res.status);
    }

    const first30Are200 = codes.slice(0, 30).every((code) => code === 200);
    const last5Are429 = codes.slice(30).every((code) => code === 429);

    console.log(`Requests 1-30 status codes: all 200 = ${first30Are200}`);
    console.log(`Requests 31-35 status codes: ${codes.slice(30).join(', ')}`);

    assert(
      first30Are200,
      'First 30 shorten requests succeed with HTTP 200',
      `Statuses: ${codes.slice(0, 5).join(',')}...`
    );

    assert(
      last5Are429,
      'Requests 31-35 return HTTP 429 Too Many Requests (spoofing defeated)',
      `Statuses: ${codes.slice(30).join(', ')}`
    );
  } finally {
    await serverSpoof.stop();
  }

  console.log('\n-------------------------------------------------------');
  console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('-------------------------------------------------------');

  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
