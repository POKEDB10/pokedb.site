#!/usr/bin/env node
// scripts/takedown.js
// Operator administrative content takedown and audit tool (Task P5.6).

const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { createObjectStore } = require('../src/storage/r2');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    kind: null,
    id: null,
    reason: 'admin_takedown_manual',
    db: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--kind' && args[i + 1]) {
      options.kind = args[++i].toLowerCase();
    } else if (args[i] === '--id' && args[i + 1]) {
      options.id = args[++i];
    } else if (args[i] === '--reason' && args[i + 1]) {
      options.reason = args[++i];
    } else if (args[i] === '--db' && args[i + 1]) {
      options.db = args[++i];
    }
  }

  return options;
}

async function run() {
  const options = parseArgs();
  if (!options.kind || !options.id) {
    console.log('Usage: node scripts/takedown.js --kind <link|paste|drop> --id <identifier> [--reason <reason>] [--db <path>]');
    process.exit(1);
  }

  if (!['link', 'paste', 'drop'].includes(options.kind)) {
    console.error(`Invalid kind "${options.kind}". Must be "link", "paste", or "drop".`);
    process.exit(1);
  }

  const config = loadConfig(process.env);
  const dbPath = options.db || config.sqliteDbPath;
  console.log(`[TAKEDOWN] Opening SQLite database: ${dbPath}`);
  const storage = createSqliteStorage(dbPath);
  const objectStore = createObjectStore(config);

  console.log(`[TAKEDOWN] Initiating takedown for kind=${options.kind}, id=${options.id}...`);

  try {
    // If drop, delete object from R2 first
    if (options.kind === 'drop') {
      const drop = storage.getDrop(options.id);
      if (drop && drop.objectKey && objectStore) {
        console.log(`[TAKEDOWN] Deleting R2 object key: ${drop.objectKey}`);
        await objectStore.deleteObject(drop.objectKey).catch((e) => {
          console.warn('[TAKEDOWN] Warning: Could not delete R2 object:', e.message);
        });
      }
    }

    // Execute storage takedown: records audit, deletes item, purges expired audits (>90d) and reports (>14d)
    const success = storage.takedown({
      kind: options.kind,
      targetId: options.id,
      reason: options.reason
    });

    if (success) {
      console.log(`[TAKEDOWN SUCCESS] ${options.kind}:${options.id} successfully removed and audited.`);
    } else {
      console.log(`[TAKEDOWN NOTICE] Target ${options.kind}:${options.id} was not found or already deleted.`);
    }
  } catch (err) {
    console.error('[TAKEDOWN ERROR]', err);
    process.exit(1);
  } finally {
    storage.close();
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
