// scripts/restore-drill.js
// Disaster recovery local restore simulation (Task P2.10 local simulation; production Litestream/R2 drill requires live Cloudflare R2 environment)
// Simulates / tests local SQLite backup, database deletion, and cold-start restore.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const { createSqliteStorage } = require('../src/storage/sqlite.js');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-drill-p210-'));
const PRIMARY_DB = path.join(TMP_DIR, 'primary.sqlite');
const REPLICA_DIR = path.join(TMP_DIR, 'replica');
const RESTORED_DB = path.join(TMP_DIR, 'restored.sqlite');

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.10 SQLite Local Restore Simulation (Litestream/R2 Simulation)');
  console.log(`Working Directory: ${TMP_DIR}`);
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

  try {
    fs.mkdirSync(REPLICA_DIR, { recursive: true });

    // 1. Check if Litestream CLI is installed in environment
    const litestreamCheck = spawnSync('litestream', ['version'], { encoding: 'utf8', shell: true });
    const hasLitestream = litestreamCheck.status === 0;

    console.log(`Litestream CLI installed: ${hasLitestream ? 'YES (' + litestreamCheck.stdout.trim() + ')' : 'NO (simulated local replica)'}`);

    // 2. Initialize primary database and seed test records
    console.log('\n1. Creating primary database and seeding test records...');
    const storage = createSqliteStorage(PRIMARY_DB);

    const testNow = Date.now();
    storage.transaction(() => {
      for (let i = 0; i < 50; i++) {
        storage.createLink({
          code: `drill_link_${i}`,
          target: `https://example.com/target-${i}`,
          createdAt: testNow,
          clicks: 10 + i
        });
        storage.createPaste({
          id: `drill_paste_${i}`,
          title: `Drill Paste ${i}`,
          body: Buffer.from(`Payload data for drill item ${i}`),
          createdAt: testNow
        });
      }
    });

    // Checkpoint to ensure all pages are committed
    storage.checkpoint('PASSIVE');
    storage.close();

    console.log('Seeded 50 links and 50 pastes into primary database.');

    // 3. Create replica
    console.log('\n2. Replicating database to backup destination...');
    const replicaStart = process.hrtime.bigint();

    if (hasLitestream) {
      // Real Litestream file replica
      const repRes = spawnSync('litestream', ['replicate', '-exec', 'exit 0', PRIMARY_DB, `file://${REPLICA_DIR}`], { shell: true });
      if (repRes.status !== 0) console.warn('Litestream replicate warning:', repRes.stderr);
    } else {
      // Local snapshot simulation
      fs.copyFileSync(PRIMARY_DB, path.join(REPLICA_DIR, 'snapshot.sqlite'));
    }
    const replicaDurationMs = Number(process.hrtime.bigint() - replicaStart) / 1e6;
    console.log(`Replica snapshot created in ${replicaDurationMs.toFixed(2)} ms.`);

    // 4. Simulate complete volume loss / catastrophic disaster
    console.log('\n3. Simulating disaster: deleting primary database and WAL files...');
    fs.rmSync(PRIMARY_DB, { force: true });
    if (fs.existsSync(`${PRIMARY_DB}-wal`)) fs.rmSync(`${PRIMARY_DB}-wal`, { force: true });
    if (fs.existsSync(`${PRIMARY_DB}-shm`)) fs.rmSync(`${PRIMARY_DB}-shm`, { force: true });

    assert(!fs.existsSync(PRIMARY_DB), 'Primary database file successfully obliterated (simulating lost volume)');

    // 5. Cold-start restore
    console.log('\n4. Executing cold-start restore from replica...');
    const restoreStart = process.hrtime.bigint();

    if (hasLitestream) {
      const restoreRes = spawnSync('litestream', ['restore', '-o', RESTORED_DB, `file://${REPLICA_DIR}`], { shell: true });
      if (restoreRes.status !== 0) console.warn('Litestream restore warning:', restoreRes.stderr);
    } else {
      fs.copyFileSync(path.join(REPLICA_DIR, 'snapshot.sqlite'), RESTORED_DB);
    }
    const restoreDurationMs = Number(process.hrtime.bigint() - restoreStart) / 1e6;

    console.log(`Cold-start restore duration: ${restoreDurationMs.toFixed(2)} ms`);
    assert(fs.existsSync(RESTORED_DB), 'Restored database file created successfully');
    assert(restoreDurationMs < 500, `Cold-start restore completed in ${restoreDurationMs.toFixed(2)} ms (< 500 ms target)`);

    // 6. Verify row count and data parity
    console.log('\n5. Verifying database integrity and row counts on restored database...');
    const restoredDb = new DatabaseSync(RESTORED_DB);
    const linksRow = restoredDb.prepare('SELECT COUNT(*) as count FROM links;').get();
    const pastesRow = restoredDb.prepare('SELECT COUNT(*) as count FROM pastes;').get();

    // Verify sample payload
    const sampleLink = restoredDb.prepare('SELECT target, clicks FROM links WHERE code = ?;').get('drill_link_25');
    const samplePaste = restoredDb.prepare('SELECT body FROM pastes WHERE id = ?;').get('drill_paste_25');
    restoredDb.close();

    console.log(`Restored links count:  ${linksRow.count}/50`);
    console.log(`Restored pastes count: ${pastesRow.count}/50`);

    assert(linksRow.count === 50, 'All 50 links recovered from replica (100% row parity)');
    assert(pastesRow.count === 50, 'All 50 pastes recovered from replica (100% row parity)');
    assert(sampleLink?.target === 'https://example.com/target-25' && sampleLink?.clicks === 35, 'Sample link target and clicks match original values exactly');
    assert(samplePaste?.body && Buffer.from(samplePaste.body).toString('utf8').includes('Payload data for drill item 25'), 'Sample paste payload matches original bytes exactly');

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    console.log('\nDisaster Recovery SLA & Data-Loss Window Metrics:');
    console.log(`- Cold-start restore duration (local file copy): ~${restoreDurationMs.toFixed(2)} ms (UNMEASURED for production Litestream/R2)`);
    console.log('- Max data-loss window (RPO):  <= 30s (Litestream sync-interval: 30s) + <= 5s (in-memory click buffer)');
    console.log('- Recovery time objective (RTO): UNMEASURED on production (local file-copy simulation; production RTO depends on network pull from Cloudflare R2 and snapshot size)');

    if (!hasLitestream) {
      console.log('\n[UNVERIFIED: LITESTREAM & CLOUDFLARE R2 LIVE DRILL]');
      console.log('Local execution ran against simulated file replica because Litestream is not installed in the Windows host environment.');
      console.log('To execute the live restore drill against Cloudflare R2 on production, follow docs/RUNBOOK.md.');
    }

    if (failed > 0) process.exitCode = 1;
  } finally {
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Restore drill failed:', err);
  process.exit(1);
});
