// scripts/accept/p2_1-sqlite.js
// Acceptance script for Task P2.1 & P2.2 (SQLite storage module & schema)

const fs = require('node:fs');
const path = require('node:path');
const { createSqliteStorage } = require('../../src/storage/sqlite.js');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'accept-p2_1.sqlite');

function cleanup() {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }
}

async function run() {
  console.log('=======================================================');
  console.log('Phase 2.1 & 2.2 SQLite Storage Acceptance Verification');
  console.log(`Database: ${DB_PATH}`);
  console.log('=======================================================\n');

  cleanup();

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

  const storage = createSqliteStorage(DB_PATH);
  const rawDb = storage.getRawDb();

  try {
    // 1. Pragmas
    const jm = rawDb.prepare('PRAGMA journal_mode;').get();
    assert(jm.journal_mode.toLowerCase() === 'wal', 'PRAGMA journal_mode is WAL', `got ${jm.journal_mode}`);

    const sync = rawDb.prepare('PRAGMA synchronous;').get();
    assert(Number(sync.synchronous) === 1, 'PRAGMA synchronous is NORMAL (1)', `got ${sync.synchronous}`);

    const bt = rawDb.prepare('PRAGMA busy_timeout;').get();
    assert(Number(bt.timeout) === 5000, 'PRAGMA busy_timeout is 5000ms', `got ${bt.timeout}`);

    const fk = rawDb.prepare('PRAGMA foreign_keys;').get();
    assert(Number(fk.foreign_keys) === 1, 'PRAGMA foreign_keys is ON (1)', `got ${fk.foreign_keys}`);

    const ts = rawDb.prepare('PRAGMA temp_store;').get();
    assert(Number(ts.temp_store) === 2, 'PRAGMA temp_store is MEMORY (2)', `got ${ts.temp_store}`);

    // 2. Schema tables
    const expectedTables = [
      'schema_migrations',
      'links',
      'pastes',
      'drops',
      'reports',
      'threat_indicators',
      'verdict_cache',
      'takedown_audit'
    ];
    const tableRows = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
    const existingTables = new Set(tableRows.map((r) => r.name));

    for (const t of expectedTables) {
      assert(existingTables.has(t), `Table '${t}' exists in schema`, `missing from [${[...existingTables].join(', ')}]`);
    }

    // 3. Transactions
    storage.transaction(() => {
      storage.createLink({ code: 'acc1', target: 'https://pokedb.site', createdAt: Date.now() });
    });
    assert(storage.getLink('acc1')?.target === 'https://pokedb.site', 'Transaction commit persisted link');

    let rolledBack = false;
    try {
      storage.transaction(() => {
        storage.createLink({ code: 'acc2', target: 'https://bad.com', createdAt: Date.now() });
        throw new Error('rollback test');
      });
    } catch (_) {
      rolledBack = true;
    }
    assert(rolledBack && storage.getLink('acc2') === null, 'Transaction rollback reverted uncommitted link');

  } finally {
    storage.close();
    cleanup();
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
