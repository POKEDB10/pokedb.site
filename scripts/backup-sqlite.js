#!/usr/bin/env node
// scripts/backup-sqlite.js
// Monthly / On-Demand SQLite Transactional Snapshot Exporter (Task P8.6).
// Uses SQLite 'VACUUM INTO' for live, zero-lock consistent snapshots.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = path.resolve(process.cwd(), 'data', 'pokedb.sqlite');
  let outputDir = path.resolve(process.cwd(), 'backups');
  let outputFile = null;
  let verify = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      dbPath = path.resolve(process.cwd(), args[++i]);
    } else if (args[i] === '--out' && args[i + 1]) {
      outputFile = path.resolve(process.cwd(), args[++i]);
    } else if (args[i] === '--no-verify') {
      verify = false;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node scripts/backup-sqlite.js [options]

Options:
  --db <path>       Source SQLite database file (default: data/pokedb.sqlite)
  --out <path>      Destination backup file (default: backups/pokedb-backup-<timestamp>.sqlite)
  --no-verify       Skip post-backup PRAGMA integrity_check
  --help, -h        Show this help message
`);
      process.exit(0);
    }
  }

  if (!outputFile) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    outputFile = path.join(outputDir, `pokedb-backup-${stamp}.sqlite`);
  }

  return { dbPath, outputFile, verify };
}

function exportBackup({ dbPath, outputFile, verify = true }) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Source database does not exist at: ${dbPath}`);
  }

  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
  }

  const startTime = Date.now();
  console.log(`[BACKUP] Opening source database: ${dbPath}`);
  const sourceDb = new DatabaseSync(dbPath);

  try {
    // Normalise path for SQLite SQL string
    const targetSqlPath = outputFile.replace(/\\/g, '/').replace(/'/g, "''");
    console.log(`[BACKUP] Executing VACUUM INTO '${targetSqlPath}'...`);
    sourceDb.exec(`VACUUM INTO '${targetSqlPath}';`);
  } finally {
    sourceDb.close();
  }

  const durationMs = Date.now() - startTime;
  const stat = fs.statSync(outputFile);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`[BACKUP] Snapshot written successfully (${sizeMB} MB in ${durationMs} ms).`);

  if (verify) {
    console.log(`[BACKUP] Verifying snapshot integrity with PRAGMA integrity_check...`);
    const backupDb = new DatabaseSync(outputFile);
    try {
      const row = backupDb.prepare('PRAGMA integrity_check;').get();
      const result = row ? Object.values(row)[0] : 'unknown';
      if (result !== 'ok') {
        throw new Error(`Integrity check failed: ${result}`);
      }
      console.log(`[BACKUP] Integrity check passed: ${result}`);
    } finally {
      backupDb.close();
    }
  }

  return {
    outputFile,
    sizeBytes: stat.size,
    sizeMB,
    durationMs,
    verified: verify
  };
}

if (require.main === module) {
  try {
    const opts = parseArgs();
    exportBackup(opts);
    console.log('[BACKUP] Done.');
  } catch (err) {
    console.error(`[FATAL] Backup error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  exportBackup
};
