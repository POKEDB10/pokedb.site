// scripts/accept/p1_5-debounce.js
// Acceptance script for Task P1.5 (PERF-001 & PERF-004: Debounce promise queue and non-blocking redirect)

const http = require('node:http');
const { ensureServer } = require('../bench/_server.js');

const PORT = 5054;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function createPaste(i) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      title: `P1.5 Concurrency Paste ${i}`,
      content: `Content for concurrency paste #${i}`,
      language: 'plaintext'
    });

    const req = http.request(
      `${BASE_URL}/api/paste/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'paste.pokedb.site',
          'X-Forwarded-For': `10.45.0.${i + 1}`
        },
        timeout: 3000
      },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, code: json?.code, timedOut: false });
        });
      }
    );
    req.on('error', (e) => resolve({ status: null, error: e.message, timedOut: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, timedOut: true });
    });
    req.write(payload);
    req.end();
  });
}

function seedLink(code, url) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ url, customCode: code });
    const req = http.request(
      `${BASE_URL}/api/shorten`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'tinyurl.pokedb.site'
        },
        timeout: 3000
      },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function fetchRedirect(code) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(
      `${BASE_URL}/${code}?direct=1`,
      {
        headers: { Host: 'tinyurl.pokedb.site' },
        timeout: 1000
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          const latMs = Number(process.hrtime.bigint() - start) / 1e6;
          resolve({ status: res.statusCode, location: res.headers.location, latMs });
        });
      }
    );
    req.on('error', () => resolve({ status: null, latMs: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: null, latMs: 1000 }); });
  });
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 1.5 Debounce & Redirect Acceptance Verification');
  console.log(`Target: ${BASE_URL}`);
  console.log('=======================================================\n');

  const server = await ensureServer({ port: PORT });
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

  try {
    // 1. PERF-001 Verification: 30 concurrent writes must all resolve in < 2000ms
    console.log('Test 1: Launching 30 concurrent paste creations...');
    const start30 = Date.now();
    const promises = [];
    for (let i = 0; i < 30; i++) {
      promises.push(createPaste(i));
    }
    const results = await Promise.all(promises);
    const wallMs = Date.now() - start30;

    const successful = results.filter((r) => r.status === 200 && r.code);
    const timedOut = results.filter((r) => r.timedOut);

    console.log(`Results: ${successful.length}/30 succeeded in ${wallMs}ms. Timed out: ${timedOut.length}`);

    assert(
      successful.length === 30 && timedOut.length === 0,
      'PERF-001 resolved: all 30/30 concurrent requests resolved with HTTP 200',
      `Succeeded: ${successful.length}, Timed out: ${timedOut.length}`
    );

    assert(
      wallMs < 2000,
      `PERF-001 latency target met: 30 concurrent requests finished in ${wallMs}ms (< 2000ms)`,
      `Wall time: ${wallMs}ms`
    );

    // 2. PERF-004 Verification: Redirect path does not await disk persistence
    console.log('\nTest 2: Verifying unblocked redirect path...');
    const testCode = `p15bench-${Date.now()}`;
    const targetUrl = 'https://example.com/p15-test-destination';
    await seedLink(testCode, targetUrl);

    // Fire 50 sequential rapid redirects
    const redirectLatencies = [];
    for (let i = 0; i < 50; i++) {
      const res = await fetchRedirect(testCode);
      if (res.latMs !== null) redirectLatencies.push(res.latMs);
    }

    const avgLat = redirectLatencies.reduce((a, b) => a + b, 0) / redirectLatencies.length;
    console.log(`50 rapid redirects completed. Average latency: ${avgLat.toFixed(2)} ms`);

    assert(
      avgLat < 20,
      `PERF-004 resolved: redirect average latency is ${avgLat.toFixed(2)} ms (< 20 ms, no 300ms delay)`,
      `Average latency: ${avgLat.toFixed(2)} ms`
    );

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) process.exitCode = 1;
  } finally {
    await server.stop();
  }
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
