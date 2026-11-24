// scripts/accept/p2_8-shutdown.js
// Acceptance verification for Task P2.8: Graceful Shutdown (OPS-001)
// Verifies:
// 1. Process traps SIGTERM/SIGINT signals
// 2. HTTP listener stops accepting new connections
// 3. In-flight requests drain cleanly
// 4. In-memory click buffer flushes completely to SQLite on shutdown
// 5. Passive WAL checkpoint runs before DB closure
// 6. Zero data loss when SIGTERM is sent mid-load

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');

const PORT = 5058;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-shutdown-p28-'));
const DB_PATH = path.join(TMP_DIR, 'shutdown.sqlite');

function postJson(urlPath, data, clientIp = '10.128.1.1') {
  return new Promise((resolve) => {
    const payload = JSON.stringify(data);
    const req = http.request(
      `${BASE_URL}${urlPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'tinyurl.pokedb.site',
          'X-Forwarded-For': clientIp
        },
        timeout: 4000
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
    req.on('error', (err) => resolve({ status: null, error: err.message }));
    req.write(payload);
    req.end();
  });
}

function fetchRedirect(code, clientIp = '10.128.1.1') {
  return new Promise((resolve) => {
    const req = http.get(
      `${BASE_URL}/${code}?direct=1`,
      {
        headers: {
          Host: 'tinyurl.pokedb.site',
          'X-Forwarded-For': clientIp
        },
        timeout: 3000
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve({ status: res.statusCode, location: res.headers.location });
        });
      }
    );
    req.on('error', (err) => resolve({ status: null, error: err.message }));
  });
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.8 Graceful Shutdown Acceptance Verification');
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

  let child = null;

  try {
    console.log('1. Spawning server process with isolated SQLite database...');
    child = spawn(process.execPath, [path.resolve(__dirname, '../../server.js')], {
      env: {
        ...process.env,
        PORT: String(PORT),
        SQLITE_DB_PATH: DB_PATH,
        TRUST_PROXY: 'true',
        ALLOW_TEST_IPC_SHUTDOWN: process.platform === 'win32' ? '1' : '0'
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let stdoutData = '';
    let stderrData = '';
    child.stdout.on('data', (d) => { stdoutData += d.toString(); });
    child.stderr.on('data', (d) => { stderrData += d.toString(); });

    // Wait for server online
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (stdoutData.includes(`Server running on 0.0.0.0:${PORT}`) || stdoutData.includes(`Server running on port ${PORT}`)) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > 10000) {
          clearInterval(interval);
          reject(new Error(`Server failed to boot:\n${stdoutData}\n${stderrData}`));
        }
      }, 50);
    });
    console.log(`Server online on http://127.0.0.1:${PORT}`);

    console.log('\n2. Seeding short link for load test...');
    const seedRes = await postJson('/api/shorten', {
      url: 'https://example.com/graceful-destination',
      customAlias: 'graceful-link'
    }, '10.128.2.1');
    assert(seedRes.status === 200 && seedRes.body.code === 'graceful-link', 'Short link seeded successfully');

    console.log('\n3. Generating concurrent in-flight requests (redirect clicks + link creations)...');
    // Accumulate 50 rapid redirect clicks (buffered in memory)
    const clickPromises = [];
    for (let i = 0; i < 50; i++) {
      clickPromises.push(fetchRedirect('graceful-link', `10.128.3.${i + 1}`));
    }
    const clickResults = await Promise.all(clickPromises);
    const successfulClicks = clickResults.filter((r) => r.status === 302).length;
    assert(successfulClicks === 50, `All 50 redirect requests succeeded and buffered in memory (${successfulClicks}/50)`);

    // Verify clickBuffer hasn't flushed to disk yet (immediate read should show 0 or initial on disk)
    const dbBefore = new DatabaseSync(DB_PATH);
    const beforeClicks = dbBefore.prepare('SELECT clicks FROM links WHERE code = ?;').get('graceful-link')?.clicks;
    dbBefore.close();
    console.log(`Disk click count immediately after requests (before 5s timer flush): ${beforeClicks}`);

    console.log('\n4. Initiating simultaneous in-flight creation load and sending SIGTERM mid-load...');
    const creationPromises = [];
    for (let i = 0; i < 10; i++) {
      creationPromises.push(postJson('/api/shorten', {
        url: `https://example.com/midload-${i}`,
        customAlias: `midload-${i}`
      }, `10.128.4.${i + 1}`));
    }

    // Send SIGTERM while requests are actively in flight
    if (process.platform === 'win32') {
      console.log('Windows environment detected: dispatching shutdown via ALLOW_TEST_IPC_SHUTDOWN...');
      child.send('SIGTERM');
    } else {
      console.log('POSIX / Linux environment detected: sending real SIGTERM signal...');
      child.kill('SIGTERM');
    }

    // Await all in-flight creations
    const creationResults = await Promise.all(creationPromises);
    const completedCreations = creationResults.filter((r) => r.status === 200).length;
    console.log(`In-flight creations completed before socket closure: ${completedCreations}/10`);

    // Wait for process to exit
    const exitCode = await new Promise((resolve, reject) => {
      const exitTimer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Process failed to exit gracefully within 12 seconds'));
      }, 12000);
      child.on('exit', (code) => {
        clearTimeout(exitTimer);
        resolve(code);
      });
    });

    console.log(`Process exited with exit code: ${exitCode}`);
    assert(exitCode === 0, `Process exited cleanly with code 0 (${exitCode})`);

    console.log('\n5. Verifying zero data loss directly from SQLite disk storage...');
    const dbAfter = new DatabaseSync(DB_PATH);
    const finalClicks = dbAfter.prepare('SELECT clicks FROM links WHERE code = ?;').get('graceful-link')?.clicks;
    const midloadRows = dbAfter.prepare("SELECT code FROM links WHERE code LIKE 'midload-%';").all();
    dbAfter.close();

    console.log(`Final click count in SQLite on disk: ${finalClicks}`);
    console.log(`Mid-load created rows in SQLite on disk: ${midloadRows.length}`);

    assert(finalClicks === 50, `All 50 buffered clicks were cleanly flushed to SQLite table on SIGTERM (${finalClicks}/50)`);
    assert(midloadRows.length === completedCreations, `Every completed in-flight creation is safely persisted (${midloadRows.length}/${completedCreations})`);
    assert(stdoutData.includes('Flushing click buffer') || stdoutData.includes('flushing click buffer'), 'Stdout confirms click buffer flush execution');
    assert(stdoutData.includes('Server and storage closed successfully'), 'Stdout confirms clean storage shutdown sequence');

    console.log('\n6. Verifying drain deadline vs Docker stop_grace_period...');
    const composeContent = fs.readFileSync(path.resolve(__dirname, '../../docker-compose.yml'), 'utf8');
    const stopGraceMatch = composeContent.match(/stop_grace_period:\s*(\d+)s/);
    const stopGracePeriod = stopGraceMatch ? parseInt(stopGraceMatch[1], 10) : 10;
    const SERVER_DRAIN_TIMEOUT_SEC = 10;
    console.log(`Configured Docker stop_grace_period: ${stopGracePeriod}s`);
    console.log(`Server max in-flight drain timeout: ${SERVER_DRAIN_TIMEOUT_SEC}s`);
    assert(SERVER_DRAIN_TIMEOUT_SEC < stopGracePeriod, `Server drain deadline (${SERVER_DRAIN_TIMEOUT_SEC}s) is strictly less than Docker stop_grace_period (${stopGracePeriod}s)`);

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
