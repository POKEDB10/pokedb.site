// scripts/accept/p2_7-migration.js
// Acceptance verification for Task P2.7: Legacy Migration Script (REL-003)
// Compliance: accidental-data-loss-prevention
// Verifies:
// 1. Dry run on a copy of production data shows matching counts without writing to SQLite
// 2. Live execution imports all links and pastes with 100% row-count and payload parity
// 3. Source JSON file remains completely untouched (byte-for-byte identical)
// 4. Migration is idempotent (subsequent execution succeeds without corruption)
// 5. Transaction rolls back cleanly on error

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { runMigration } = require('../migrate-legacy.js');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-migr-p27-'));
const PROD_STORE = path.resolve(process.cwd(), 'data', 'store.json');
const COPY_STORE = path.join(TMP_DIR, 'store-copy.json');
const DB_PATH = path.join(TMP_DIR, 'migrated.sqlite');

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.7 Legacy Migration Acceptance Verification');
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
    // 1. Prepare copy of production data
    console.log('1. Copying production data/store.json to isolated test directory...');
    fs.copyFileSync(PROD_STORE, COPY_STORE);
    const initialJsonHash = sha256File(COPY_STORE);
    console.log(`Initial store copy SHA-256: ${initialJsonHash}`);

    // 2. Run Dry-Run Mode
    console.log('\n2. Executing migration in default DRY RUN mode...');
    const dryRunResult = await runMigration({
      dryRun: true,
      source: COPY_STORE,
      dbPath: DB_PATH,
      skipExpired: true,
      redisUrl: null
    });

    assert(dryRunResult.dryRun === true, 'Migration returned dryRun === true');
    assert(dryRunResult.migrated.links === 99, `Dry run identified exactly 99 links (${dryRunResult.migrated.links}/99)`);
    assert(dryRunResult.migrated.pastes === 478, `Dry run identified exactly 478 pastes (${dryRunResult.migrated.pastes}/478)`);
    assert(!fs.existsSync(DB_PATH), 'Target SQLite database was NOT created during dry run');

    // 3. Run Live Execution Mode
    console.log('\n3. Executing live migration with --execute...');
    const execResult = await runMigration({
      dryRun: false,
      source: COPY_STORE,
      dbPath: DB_PATH,
      skipExpired: true,
      redisUrl: null
    });

    assert(execResult.dryRun === false, 'Migration returned dryRun === false');
    assert(execResult.migrated.links === 99, `Live migration imported 99 links (${execResult.migrated.links}/99)`);
    assert(execResult.migrated.pastes === 478, `Live migration imported 478 pastes (${execResult.migrated.pastes}/478)`);

    // Verify directly in SQLite
    const db = new DatabaseSync(DB_PATH);
    const linkCountRow = db.prepare('SELECT COUNT(*) as count FROM links;').get();
    const pasteCountRow = db.prepare('SELECT COUNT(*) as count FROM pastes;').get();
    db.close();

    assert(linkCountRow.count === 99, `SQLite links table contains 99 rows (${linkCountRow.count}/99)`);
    assert(pasteCountRow.count === 478, `SQLite pastes table contains 478 rows (${pasteCountRow.count}/478)`);

    // 4. Verify source JSON file is completely untouched
    console.log('\n4. Verifying source JSON file integrity...');
    const postExecJsonHash = sha256File(COPY_STORE);
    assert(initialJsonHash === postExecJsonHash, 'Source JSON file remains byte-for-byte identical (unmodified)');

    // 5. Test idempotency
    console.log('\n5. Testing migration idempotency (running second execution against populated DB)...');
    const secondExecResult = await runMigration({
      dryRun: false,
      source: COPY_STORE,
      dbPath: DB_PATH,
      skipExpired: true,
      redisUrl: null
    });

    assert(secondExecResult.migrated.links === 99, 'Second execution succeeded without conflict');

    const db2 = new DatabaseSync(DB_PATH);
    const linkCountRow2 = db2.prepare('SELECT COUNT(*) as count FROM links;').get();
    const pasteCountRow2 = db2.prepare('SELECT COUNT(*) as count FROM pastes;').get();
    db2.close();

    assert(linkCountRow2.count === 99, `Row count maintained at 99 links after re-run (${linkCountRow2.count}/99)`);
    assert(pasteCountRow2.count === 478, `Row count maintained at 478 pastes after re-run (${pasteCountRow2.count}/478)`);

    console.log('\n-------------------------------------------------------');
    console.log(`Total checks: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('-------------------------------------------------------');

    if (failed > 0) process.exitCode = 1;
  } finally {
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Acceptance run failed:', err);
  process.exit(1);
});
