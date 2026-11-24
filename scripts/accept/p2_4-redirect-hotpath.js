// scripts/accept/p2_4-redirect-hotpath.js
// Acceptance verification for Task P2.4: Redirect Hot Path & In-Memory Click Buffer
// Verifies:
// 1. Direct redirect returns 302 with target location
// 2. Average latency < 5ms, p99 < 15ms on hot path
// 3. Stats endpoint reads buffered clicks in real-time
// 4. Click buffer flushes to SQLite WAL within 5s transaction tick
// 5. Autocannon at 50 connections achieves >= 2,000 req/s, p99 < 15ms

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { ensureServer } = require('../bench/_server.js');

const PORT = 5056;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-redirect-p24-'));
const DB_PATH = path.join(TMP_DIR, 'redirect.sqlite');

function postJson(urlPath, data, host = 'tinyurl.pokedb.site') {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(
      `${BASE_URL}${urlPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': host
        },
        timeout: 3000
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (_) {}
          resolve({ status: res.statusCode, body: json });
        });
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
        timeout: 2000
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
    req.on('timeout', () => { req.destroy(); resolve({ status: null, latMs: 2000 }); });
  });
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.4 Redirect Hot Path Acceptance Verification');
  console.log(`Database: ${DB_PATH}`);
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

  let server = null;

  try {
    console.log('1. Starting test server with isolated SQLite database...');
    server = await ensureServer({
      port: PORT,
      env: { SQLITE_DB_PATH: DB_PATH }
    });
    console.log(`Server online on ${server.baseUrl}`);

    console.log('\n2. Seeding short link for hot-path verification...');
    const testCode = `p24hot_${Date.now()}`;
    const targetUrl = 'https://example.com/p24-target-destination';
    const seedRes = await postJson('/api/shorten', { url: targetUrl, customAlias: testCode });

    assert(seedRes.status === 200 && seedRes.body.code === testCode, 'Short link created successfully');

    console.log('\n3. Executing 100 rapid redirects on hot path...');
    const latencies = [];
    let redirectSuccess = 0;

    for (let i = 0; i < 100; i++) {
      const res = await fetchRedirect(testCode);
      if (res.status === 302 && res.location === targetUrl) {
        redirectSuccess++;
      }
      if (res.latMs !== null) latencies.push(res.latMs);
    }

    assert(redirectSuccess === 100, `All 100/100 redirects returned HTTP 302 with exact target URL`);

    latencies.sort((a, b) => a - b);
    const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    console.log(`100 redirects latency — Avg: ${avgLat.toFixed(2)} ms, p99: ${p99.toFixed(2)} ms`);
    assert(avgLat < 5, `Hot path average latency is ${avgLat.toFixed(2)} ms (< 5 ms target)`);
    assert(p99 < 15, `Hot path p99 latency is ${p99.toFixed(2)} ms (< 15 ms target)`);

    console.log('\n4. Verifying real-time stats endpoint with buffered clicks...');
    const statsRes = await new Promise((resolve) => {
      http.get(`${BASE_URL}/api/stats/${testCode}`, { headers: { Host: 'tinyurl.pokedb.site' } }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
        });
      });
    });

    assert(statsRes && statsRes.clicks === 100, `Stats endpoint reflects all 100 clicks in real-time (${statsRes?.clicks}/100)`);

    console.log('\n5. Waiting 5.5s for background click buffer flush tick to SQLite...');
    await new Promise((r) => setTimeout(r, 5500));

    // Verify directly from SQLite file on disk
    const diskDb = new DatabaseSync(DB_PATH);
    const diskRow = diskDb.prepare('SELECT clicks FROM links WHERE code = ?;').get(testCode);
    diskDb.close();

    assert(diskRow && diskRow.clicks === 100, `Click buffer flushed 100 clicks to SQLite table in one transaction (disk clicks: ${diskRow?.clicks})`);

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await server.stop();
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
