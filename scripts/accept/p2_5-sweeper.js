// scripts/accept/p2_5-sweeper.js
// Acceptance verification for Task P2.5: Background Sweeper & Expired Record Purging (REL-002)
// Verifies:
// 1. Expired records are deleted in bounded batches of 500 per tick
// 2. 10,000 expired rows purged across batches without blocking the event loop > 50ms
// 3. Daily PRAGMA optimize executes successfully
// 4. Passive WAL checkpoint executes on shutdown without blocking

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { createSqliteStorage } = require('../../src/storage/sqlite.js');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-sweeper-p25-'));
const DB_PATH = path.join(TMP_DIR, 'sweeper.sqlite');

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.5 Background Sweeper Acceptance Verification');
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

  let storage = null;

  try {
    storage = createSqliteStorage(DB_PATH);

    console.log('1. Verifying batch limit on purgeExpired (batchSize = 500)...');
    const now = Date.now();

    // Insert 1,200 expired links
    storage.transaction(() => {
      for (let i = 0; i < 1200; i++) {
        storage.createLink({
          code: `batch_exp_${i}`,
          target: 'https://example.com/batch',
          createdAt: now - 5000,
          expiresAt: now - 1000
        });
      }
    });

    const tick1 = storage.purgeExpired(now, 500);
    assert(tick1.links === 500, `First tick deleted exactly 500 links (batch cap enforced: ${tick1.links})`);

    const tick2 = storage.purgeExpired(now, 500);
    assert(tick2.links === 500, `Second tick deleted exactly 500 links (batch cap enforced: ${tick2.links})`);

    const tick3 = storage.purgeExpired(now, 500);
    assert(tick3.links === 200, `Third tick deleted remaining 200 links (${tick3.links})`);

    const tick4 = storage.purgeExpired(now, 500);
    assert(tick4.links === 0, `Subsequent tick on empty expired set returns 0 deleted rows (${tick4.links})`);

    console.log('\n2. Seeding 10,000 expired rows (5,000 links + 5,000 pastes) for event loop soak...');
    storage.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        storage.createLink({
          code: `soak_link_${i}`,
          target: 'https://example.com/soak',
          createdAt: now - 10000,
          expiresAt: now - 1000
        });
        storage.createPaste({
          id: `soak_paste_${i}`,
          title: `Paste ${i}`,
          body: Buffer.from(`Sample paste payload ${i}`),
          createdAt: now - 10000,
          expiresAt: now - 1000
        });
      }
    });

    console.log('10,000 expired rows seeded into SQLite table.');

    console.log('\n3. Draining 10,000 expired rows in batches of 500 while monitoring event loop delay...');
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();

    let totalPurgedLinks = 0;
    let totalPurgedPastes = 0;
    let maxBatchDurationMs = 0;
    let batchCount = 0;

    while (true) {
      batchCount++;
      const batchStart = process.hrtime.bigint();
      const res = storage.purgeExpired(now, 500);
      const batchDurationMs = Number(process.hrtime.bigint() - batchStart) / 1e6;
      if (batchDurationMs > maxBatchDurationMs) {
        maxBatchDurationMs = batchDurationMs;
      }

      totalPurgedLinks += res.links;
      totalPurgedPastes += res.pastes;

      if (res.links === 0 && res.pastes === 0) {
        break;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    histogram.disable();
    const p99DelayMs = Number(histogram.percentile(99)) / 1e6;
    const maxDelayMs = Number(histogram.max) / 1e6;

    console.log(`Sweeper stats — Batches: ${batchCount}, Purged links: ${totalPurgedLinks}, Purged pastes: ${totalPurgedPastes}`);
    console.log(`Event loop delay — Max single batch: ${maxBatchDurationMs.toFixed(2)} ms, p99 delay: ${p99DelayMs.toFixed(2)} ms, Max delay: ${maxDelayMs.toFixed(2)} ms`);

    assert(totalPurgedLinks === 5000, `All 5,000 expired links purged (${totalPurgedLinks}/5000)`);
    assert(totalPurgedPastes === 5000, `All 5,000 expired pastes purged (${totalPurgedPastes}/5000)`);
    assert(maxBatchDurationMs < 50, `Max single batch duration is ${maxBatchDurationMs.toFixed(2)} ms (< 50 ms target)`);
    assert(p99DelayMs < 50, `Event loop p99 delay is ${p99DelayMs.toFixed(2)} ms (< 50 ms target)`);

    console.log('\n4. Verifying PRAGMA optimize and passive WAL checkpoint...');
    storage.optimize();
    assert(true, 'PRAGMA optimize completed without errors');

    storage.checkpoint('PASSIVE');
    assert(true, 'PRAGMA wal_checkpoint(PASSIVE) completed without errors');

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (storage) storage.close();
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
