// scripts/accept/p2_3-durability.js
// Acceptance and durability verification for Task P2.3:
// Create 100 links and pastes, kill the process abruptly, restart, and verify 100/100 row durability in WAL mode.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { ensureServer } = require('../bench/_server.js');

const PORT = 5055;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-durability-'));
const DB_PATH = path.join(TMP_DIR, 'durability.sqlite');

function postJson(urlPath, data, host = 'tinyurl.pokedb.site', ip = '10.100.1.1') {
  return new Promise((resolve) => {
    const payload = JSON.stringify(data);
    const req = http.request(
      `${BASE_URL}${urlPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': host,
          'X-Forwarded-For': ip
        },
        timeout: 5000
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
    req.on('error', (e) => resolve({ status: null, error: e.message }));
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.3 SQLite Durability Acceptance Verification');
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

  let server1 = null;
  let server2 = null;

  try {
    console.log('1. Spawning initial server instance with ensureServer...');
    server1 = await ensureServer({
      port: PORT,
      env: { SQLITE_DB_PATH: DB_PATH }
    });
    console.log(`Server online on ${server1.baseUrl}`);

    console.log('\n2. Creating 100 links and 100 pastes concurrently (simulating distinct clients)...');
    const linkPromises = [];
    const pastePromises = [];

    for (let i = 0; i < 100; i++) {
      const clientIp = `10.100.${Math.floor(i / 10)}.${(i % 10) + 1}`;
      linkPromises.push(
        postJson('/api/shorten', {
          url: `https://example.com/durability-target-${i}`,
          customAlias: `durl_${i}`
        }, 'tinyurl.pokedb.site', clientIp)
      );
      pastePromises.push(
        postJson('/api/paste/create', {
          title: `Durability Paste ${i}`,
          content: `Durability paste body content ${i}`,
          language: 'plaintext'
        }, 'paste.pokedb.site', clientIp)
      );
    }

    const [linkResults, pasteResults] = await Promise.all([
      Promise.all(linkPromises),
      Promise.all(pastePromises)
    ]);

    const successfulLinks = linkResults.filter((r) => r.status === 200);
    const successfulPastes = pasteResults.filter((r) => r.status === 200);

    assert(successfulLinks.length === 100, `Created 100/100 links successfully (${successfulLinks.length}/100)`);
    assert(successfulPastes.length === 100, `Created 100/100 pastes successfully (${successfulPastes.length}/100)`);

    console.log('\n3. Abruptly killing process (simulating hard crash / power loss)...');
    server1.child.kill('SIGKILL');
    server1 = null;
    await new Promise((r) => setTimeout(r, 600));

    console.log('\n4. Restarting server instance against the same SQLite database...');
    server2 = await ensureServer({
      port: PORT,
      env: { SQLITE_DB_PATH: DB_PATH }
    });
    console.log(`Server restarted on ${server2.baseUrl}`);

    console.log('\n5. Verifying row durability on restarted server...');
    const verifyLinkPromises = [];
    for (let i = 0; i < 100; i++) {
      verifyLinkPromises.push(
        new Promise((resolve) => {
          http.get(`${BASE_URL}/api/stats/durl_${i}`, { headers: { Host: 'tinyurl.pokedb.site' } }, (res) => {
            res.resume();
            resolve(res.statusCode);
          }).on('error', () => resolve(null));
        })
      );
    }

    const verifyPastePromises = successfulPastes.map((p) => {
      const code = p.body.code;
      return postJson(`/api/paste/view/${code}`, {}, 'paste.pokedb.site');
    });

    const [vLinks, vPastes] = await Promise.all([
      Promise.all(verifyLinkPromises),
      Promise.all(verifyPastePromises)
    ]);

    const verifiedLinksCount = vLinks.filter((s) => s === 200).length;
    const verifiedPastesCount = vPastes.filter((r) => r.status === 200).length;

    assert(
      verifiedLinksCount === 100,
      `100/100 links survived hard crash and process termination (WAL durability)`,
      `Found: ${verifiedLinksCount}/100`
    );

    assert(
      verifiedPastesCount === 100,
      `100/100 pastes survived hard crash and process termination (WAL durability)`,
      `Found: ${verifiedPastesCount}/100`
    );

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server1) await server1.stop();
    if (server2) await server2.stop();
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
