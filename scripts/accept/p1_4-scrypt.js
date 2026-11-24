// scripts/accept/p1_4-scrypt.js
// Acceptance script for Task P1.4 (PERF-002: Async scrypt + semaphore)

const http = require('node:http');
const { ensureServer } = require('../bench/_server.js');

const PORT = 5053;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function pingHealth() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(`${BASE_URL}/api/health/ping`, { timeout: 2000 }, (res) => {
      res.resume();
      res.on('end', () => {
        const diffMs = Number(process.hrtime.bigint() - start) / 1e6;
        resolve(diffMs);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function createProtectedPaste(index, timeout = 3000) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      title: `Protected Paste ${index}`,
      content: `Protected content ${index}`,
      password: `p4ssw0rd-${index}`
    });

    const req = http.request(
      `${BASE_URL}/api/paste/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'paste.pokedb.site',
          'X-Forwarded-For': `10.43.1.${index + 1}`
        },
        timeout
      },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, json, timedOut: false });
        });
      }
    );
    req.on('error', () => resolve({ status: null, timedOut: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, timedOut: true });
    });
    req.write(payload);
    req.end();
  });
}

function viewProtectedPaste(code, password) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ password });
    const req = http.request(
      `${BASE_URL}/api/paste/view/${code}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'paste.pokedb.site'
        },
        timeout: 5000
      },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 1.4 Async scrypt Acceptance Verification');
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
    // 1. Functional correctness: single paste creation + view verification
    const singlePaste = await createProtectedPaste(999, 5000);
    assert(
      singlePaste.status === 200 && singlePaste.json?.code,
      'Protected paste creation with async scrypt succeeds (200)',
      `Status: ${singlePaste.status}`
    );

    const testCode = singlePaste.json.code;
    const wrongPassRes = await viewProtectedPaste(testCode, 'wrong-password');
    assert(
      wrongPassRes.status === 401,
      'Protected paste view rejects incorrect password with 401',
      `Status: ${wrongPassRes.status}`
    );

    const rightPassRes = await viewProtectedPaste(testCode, 'p4ssw0rd-999');
    assert(
      rightPassRes.status === 200 && rightPassRes.json?.paste?.content === 'Protected content 999',
      'Protected paste view accepts correct password with 200',
      `Status: ${rightPassRes.status}`
    );

    // 2. Health latency under scrypt load: 20 parallel protected-paste creates
    const samples = [];
    let probing = true;

    const pingTask = (async () => {
      while (probing) {
        const lat = await pingHealth();
        if (lat !== null) samples.push(lat);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();

    // Allow pinger to establish baseline samples
    await new Promise((r) => setTimeout(r, 300));

    console.log('Launching 20 parallel protected-paste creations to stress scrypt worker pool...');
    const pastePromises = [];
    for (let i = 0; i < 20; i++) {
      pastePromises.push(createProtectedPaste(i, 3500));
    }

    await Promise.all(pastePromises);
    // Allow cooldown samples
    await new Promise((r) => setTimeout(r, 300));
    probing = false;
    await pingTask;

    samples.sort((a, b) => a - b);
    const p99Index = Math.ceil(0.99 * samples.length) - 1;
    const p99 = samples[Math.max(0, Math.min(p99Index, samples.length - 1))] || 0;
    console.log(`Captured ${samples.length} health pings during crypto load. p99: ${p99.toFixed(2)} ms`);

    assert(
      p99 < 50,
      `Health ping latency stays < 50 ms during scrypt load (p99 = ${p99.toFixed(2)} ms < 50 ms)`,
      `p99: ${p99.toFixed(2)} ms`
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
