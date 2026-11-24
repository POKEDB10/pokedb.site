// scripts/accept/p2_6-alias-batch.js
// Acceptance verification for Task P2.6: Batch Alias Collision Lookup (TOOL-TINY-001)
// Verifies:
// 1. storage.getExistingCodes resolves up to 48 candidates in a single IN query
// 2. Performance: 48-candidate lookup executes in < 2ms (no sequential loop overhead)
// 3. POST /api/shorten returns 409 with available suggestions when alias is collided
// 4. Suggestions accurately skip already taken candidate variants

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createSqliteStorage } = require('../../src/storage/sqlite.js');
const { ensureServer } = require('../bench/_server.js');

const PORT = 5057;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-alias-p26-'));
const DB_PATH = path.join(TMP_DIR, 'alias.sqlite');

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(
      `${BASE_URL}${urlPath}`,
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

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.6 Batch Alias Suggestions Acceptance Verification');
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
  let storage = null;

  try {
    // 1. Direct SQLite module verification
    storage = createSqliteStorage(DB_PATH);

    console.log('1. Testing storage.getExistingCodes single-query batch lookup...');
    const candidates = [];
    for (let i = 2; i <= 50; i++) {
      candidates.push(`myalias-${i}`);
    }

    // Seed even-numbered candidates
    storage.transaction(() => {
      for (let i = 2; i <= 50; i += 2) {
        storage.createLink({
          code: `myalias-${i}`,
          target: `https://example.com/target-${i}`,
          createdAt: Date.now()
        });
      }
    });

    const start = process.hrtime.bigint();
    const existing = storage.getExistingCodes(candidates);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    console.log(`Resolved 48 candidates in ${durationMs.toFixed(3)} ms`);
    assert(existing.length === 25, `Found exact count of 25 existing candidates (${existing.length}/25)`);
    assert(durationMs < 2.0, `Query execution duration is ${durationMs.toFixed(3)} ms (< 2.0 ms target)`);

    // Verify candidate filtering
    const existingSet = new Set(existing);
    const available = candidates.filter((c) => !existingSet.has(c));
    assert(available[0] === 'myalias-3', `First available suggestion is odd-numbered 'myalias-3' (${available[0]})`);
    assert(available[1] === 'myalias-5', `Second available suggestion is odd-numbered 'myalias-5' (${available[1]})`);
    assert(available[2] === 'myalias-7', `Third available suggestion is odd-numbered 'myalias-7' (${available[2]})`);

    storage.close();
    storage = null;

    // 2. Integration verification via HTTP server
    console.log('\n2. Testing HTTP POST /api/shorten collision suggestions response...');
    server = await ensureServer({
      port: PORT,
      env: { SQLITE_DB_PATH: DB_PATH }
    });
    console.log(`Server online on ${server.baseUrl}`);

    // Create primary alias
    const primaryRes = await postJson('/api/shorten', {
      url: 'https://example.com/primary',
      customAlias: 'testcollision'
    });
    assert(primaryRes.status === 200 && primaryRes.body.code === 'testcollision', 'Primary alias created with HTTP 200');

    // Pre-occupy first suggestion: testcollision-2
    await postJson('/api/shorten', {
      url: 'https://example.com/testcollision-2',
      customAlias: 'testcollision-2'
    });

    // Try creating duplicate primary alias
    const conflictRes = await postJson('/api/shorten', {
      url: 'https://example.com/duplicate',
      customAlias: 'testcollision'
    });

    assert(conflictRes.status === 409, `Conflict returned HTTP 409 (${conflictRes.status})`);
    assert(Array.isArray(conflictRes.body?.suggestions), 'Response body contains suggestions array');
    assert(conflictRes.body.suggestions.length >= 3, `Returned ${conflictRes.body?.suggestions?.length} suggestions (>= 3)`);
    assert(!conflictRes.body.suggestions.includes('testcollision-2'), 'Occupied testcollision-2 is omitted from suggestions');
    assert(conflictRes.body.suggestions[0] === 'testcollision-3', `First available suggestion is testcollision-3 (${conflictRes.body?.suggestions?.[0]})`);

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (storage) storage.close();
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
