#!/usr/bin/env node
// scripts/export-sqlite-to-legacy.js
// Exports SQLite links and pastes into legacy JSON format (compatible with data/store.json).
// Used for reverse-export during rollback to preserve post-cutover writes.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function parseArgs(args) {
  const options = {
    dbPath: process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'pokedb.sqlite'),
    outFile: path.resolve(process.cwd(), 'data', 'store.reverse-export.json'),
    since: 0,
    pretty: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--db' && args[i + 1]) {
      options.dbPath = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--out' && args[i + 1]) {
      options.outFile = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--since' && args[i + 1]) {
      options.since = Number(args[++i]) || 0;
    } else if (arg === '--compact') {
      options.pretty = false;
    }
  }
  return options;
}

function exportData(customArgs) {
  const options = parseArgs(customArgs || process.argv.slice(2));
  console.log('Exporting SQLite data to legacy format...');
  console.log(`Database: ${options.dbPath}`);
  console.log(`Output:   ${options.outFile}`);
  if (options.since > 0) {
    console.log(`Filtering records created after: ${options.since} (${new Date(options.since).toISOString()})`);
  }

  if (!fs.existsSync(options.dbPath)) {
    console.error(`Error: Database not found at ${options.dbPath}`);
    process.exit(1);
  }

  const db = new DatabaseSync(options.dbPath, { readOnly: true });
  const exportStore = {};

  try {
    const linksStmt = db.prepare('SELECT * FROM links WHERE created_at >= ? ORDER BY created_at ASC');
    const linkRows = linksStmt.all(options.since);

    for (const row of linkRows) {
      exportStore[`url:${row.code}`] = {
        url: row.target,
        longUrl: row.target,
        clicks: row.clicks,
        createdAt: new Date(row.created_at).toISOString(),
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        status: row.status || 'active',
        creator: row.creator || null
      };
      if (row.clicks > 0) {
        exportStore[`url:${row.code}:clicks`] = row.clicks;
      }
    }

    const pastesStmt = db.prepare('SELECT * FROM pastes WHERE created_at >= ? ORDER BY created_at ASC');
    const pasteRows = pastesStmt.all(options.since);

    for (const row of pasteRows) {
      let content = '';
      if (Buffer.isBuffer(row.body)) {
        content = row.body.toString('utf8');
      } else if (row.body instanceof Uint8Array || (row.body && row.body.buffer)) {
        content = Buffer.from(row.body).toString('utf8');
      } else if (typeof row.body === 'string') {
        content = row.body;
      }

      exportStore[`paste:${row.id}`] = {
        id: row.id,
        title: row.title || null,
        language: row.language || 'plaintext',
        content,
        encrypted: Boolean(row.encrypted),
        createdAt: new Date(row.created_at).toISOString(),
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        creator: row.creator || null
      };
    }

    const json = options.pretty ? JSON.stringify(exportStore, null, 2) : JSON.stringify(exportStore);
    fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
    fs.writeFileSync(options.outFile, json, 'utf8');

    console.log(`SUCCESS: Exported ${linkRows.length} links and ${pasteRows.length} pastes to ${options.outFile}`);
    return { linksCount: linkRows.length, pastesCount: pasteRows.length, outFile: options.outFile };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  exportData();
}

module.exports = { parseArgs, exportData };
