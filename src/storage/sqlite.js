// src/storage/sqlite.js
// SQLite Storage Implementation using node:sqlite DatabaseSync (Task P2.1, P2.2)

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createSqliteStorage(dbFilePath) {
  if (dbFilePath !== ':memory:') {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbFilePath);

  // Apply performance & durability pragmas
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA temp_store = MEMORY;');
  if (dbFilePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }

  // Schema migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(
      version INTEGER PRIMARY KEY,
      applied_at INTEGER
    );
  `);

  const currentVersionRow = db.prepare('SELECT MAX(version) AS ver FROM schema_migrations;').get();
  const currentVersion = currentVersionRow?.ver || 0;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS links(
        code TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        clicks INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        creator TEXT
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS links_exp ON links(expires_at) WHERE expires_at IS NOT NULL;

      CREATE TABLE IF NOT EXISTS pastes(
        id TEXT PRIMARY KEY,
        title TEXT,
        language TEXT,
        body BLOB NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        pw_salt BLOB,
        pw_hash BLOB,
        burn INTEGER NOT NULL DEFAULT 0,
        views INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        creator TEXT
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS pastes_exp ON pastes(expires_at);

      CREATE TABLE IF NOT EXISTS drops(
        id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL,
        upload_id TEXT,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        downloads INTEGER NOT NULL DEFAULT 0,
        max_downloads INTEGER,
        sha256 TEXT,
        delete_hash BLOB NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        creator TEXT
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS drops_state_exp ON drops(state, expires_at);

      CREATE TABLE IF NOT EXISTS reports(
        id INTEGER PRIMARY KEY,
        kind TEXT,
        target_id TEXT,
        subnet TEXT,
        reason TEXT,
        at INTEGER
      );

      CREATE TABLE IF NOT EXISTS threat_indicators(
        kind TEXT,
        value TEXT,
        source TEXT,
        added_at INTEGER,
        PRIMARY KEY(kind, value)
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS verdict_cache(
        host TEXT PRIMARY KEY,
        verdict TEXT,
        checked_at INTEGER
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS takedown_audit(
        id INTEGER PRIMARY KEY,
        kind TEXT,
        target_id TEXT,
        content_sha256 TEXT,
        created_at INTEGER,
        creator_subnet TEXT,
        removed_at INTEGER,
        reason TEXT
      );

      INSERT INTO schema_migrations(version, applied_at) VALUES(1, ${Date.now()});
    `);
  }

  if (currentVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS kv_exp ON kv(expires_at) WHERE expires_at IS NOT NULL;

      INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES(2, ${Date.now()});
    `);
  }

  // Cached prepared statements
  const stmts = {
    insertLink: db.prepare(`
      INSERT INTO links(code, target, created_at, expires_at, clicks, status, creator)
      VALUES(?, ?, ?, ?, ?, ?, ?);
    `),
    getLinkActive: db.prepare(`
      SELECT code, target, created_at, expires_at, clicks, status, creator
      FROM links
      WHERE code = ? AND status IN ('active', 'unscanned') AND (expires_at IS NULL OR expires_at > ?);
    `),
    getLinkRaw: db.prepare(`
      SELECT code, target, created_at, expires_at, clicks, status, creator
      FROM links
      WHERE code = ?;
    `),
    incrementLinkClicks: db.prepare(`
      UPDATE links SET clicks = clicks + ? WHERE code = ?;
    `),
    insertPaste: db.prepare(`
      INSERT INTO pastes(id, title, language, body, encrypted, pw_salt, pw_hash, burn, views, created_at, expires_at, status, creator)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `),
    getPasteActive: db.prepare(`
      SELECT id, title, language, body, encrypted, pw_salt, pw_hash, burn, views, created_at, expires_at, status, creator
      FROM pastes
      WHERE id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?);
    `),
    incrementPasteViews: db.prepare(`
      UPDATE pastes SET views = views + 1 WHERE id = ?;
    `),
    burnPaste: db.prepare(`
      UPDATE pastes SET status = 'burned' WHERE id = ?;
    `),
    insertDrop: db.prepare(`
      INSERT INTO drops(id, object_key, upload_id, name, size, state, created_at, expires_at, downloads, max_downloads, sha256, delete_hash, encrypted, creator)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `),
    getDrop: db.prepare(`
      SELECT id, object_key, upload_id, name, size, state, created_at, expires_at, downloads, max_downloads, sha256, delete_hash, encrypted, creator
      FROM drops
      WHERE id = ?;
    `),
    updateDropState: db.prepare(`
      UPDATE drops SET state = ? WHERE id = ?;
    `),
    updateDropComplete: db.prepare(`
      UPDATE drops
      SET state = 'complete', size = ?, sha256 = COALESCE(?, sha256)
      WHERE id = ?;
    `),
    claimDropDownload: db.prepare(`
      UPDATE drops
      SET downloads = downloads + 1
      WHERE id = ? AND state = 'complete' AND (max_downloads IS NULL OR downloads < max_downloads);
    `),
    getActiveStorageBytes: db.prepare(`
      SELECT COALESCE(SUM(size), 0) AS total FROM drops WHERE state = 'complete';
    `),
    getDailySubnetBytes: db.prepare(`
      SELECT COALESCE(SUM(size), 0) AS total FROM drops WHERE creator = ? AND created_at >= ?;
    `),
    getDailyGlobalBytes: db.prepare(`
      SELECT COALESCE(SUM(size), 0) AS total FROM drops WHERE created_at >= ?;
    `),
    getExpiredDrops: db.prepare(`
      SELECT id, object_key, upload_id, state FROM drops WHERE state = 'complete' AND expires_at <= ? LIMIT ?;
    `),
    getStaleInitiatedDrops: db.prepare(`
      SELECT id, object_key, upload_id FROM drops WHERE state = 'initiated' AND created_at <= ? LIMIT ?;
    `),
    deleteDrop: db.prepare(`
      DELETE FROM drops WHERE id = ?;
    `),
    incrementDropDownloads: db.prepare(`
      UPDATE drops SET downloads = downloads + 1 WHERE id = ?;
    `),
    deleteExpiredLinks: db.prepare(`
      DELETE FROM links
      WHERE code IN (
        SELECT code FROM links
        WHERE expires_at IS NOT NULL AND expires_at <= ?
        LIMIT ?
      );
    `),
    deleteExpiredPastes: db.prepare(`
      DELETE FROM pastes
      WHERE id IN (
        SELECT id FROM pastes
        WHERE expires_at IS NOT NULL AND expires_at <= ?
        LIMIT ?
      );
    `),
    deleteExpiredDrops: db.prepare(`
      DELETE FROM drops
      WHERE id IN (
        SELECT id FROM drops
        WHERE state != 'deleted' AND expires_at <= ?
        LIMIT ?
      );
    `),
    restorePaste: db.prepare(`
      UPDATE pastes SET status = 'active' WHERE id = ?;
    `),
    deletePaste: db.prepare(`
      DELETE FROM pastes WHERE id = ?;
    `),
    insertKv: db.prepare(`
      INSERT INTO kv(key, value, expires_at)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at;
    `),
    getKv: db.prepare(`
      SELECT key, value, expires_at FROM kv WHERE key = ?;
    `),
    deleteKv: db.prepare(`
      DELETE FROM kv WHERE key = ?;
    `),
    deleteExpiredKv: db.prepare(`
      DELETE FROM kv
      WHERE key IN (
        SELECT key FROM kv
        WHERE expires_at IS NOT NULL AND expires_at <= ?
        LIMIT ?
      );
    `),
    insertThreatIndicator: db.prepare(`
      INSERT OR REPLACE INTO threat_indicators(kind, value, source, added_at)
      VALUES(?, ?, ?, ?);
    `),
    hasThreatIndicator: db.prepare(`
      SELECT 1 FROM threat_indicators WHERE kind = ? AND value = ? LIMIT 1;
    `),
    countThreatIndicators: db.prepare(`
      SELECT COUNT(*) AS count FROM threat_indicators;
    `),
    getVerdict: db.prepare(`
      SELECT verdict FROM verdict_cache WHERE host = ? AND checked_at >= ?;
    `),
    setVerdict: db.prepare(`
      INSERT OR REPLACE INTO verdict_cache(host, verdict, checked_at)
      VALUES(?, ?, ?);
    `),
    insertReport: db.prepare(`
      INSERT INTO reports(kind, target_id, subnet, reason, at)
      VALUES(?, ?, ?, ?, ?);
    `),
    countDistinctReportSubnets: db.prepare(`
      SELECT COUNT(DISTINCT subnet) AS count FROM reports WHERE kind = ? AND target_id = ?;
    `),
    quarantineLink: db.prepare(`
      UPDATE links SET status = 'quarantined' WHERE code = ?;
    `),
    quarantinePaste: db.prepare(`
      UPDATE pastes SET status = 'quarantined' WHERE id = ?;
    `),
    quarantineDrop: db.prepare(`
      UPDATE drops SET state = 'quarantined' WHERE id = ?;
    `),
    insertTakedownAudit: db.prepare(`
      INSERT INTO takedown_audit(kind, target_id, content_sha256, created_at, creator_subnet, removed_at, reason)
      VALUES(?, ?, ?, ?, ?, ?, ?);
    `),
    deleteOldTakedownAudit: db.prepare(`
      DELETE FROM takedown_audit WHERE removed_at < ?;
    `),
    deleteOldReports: db.prepare(`
      DELETE FROM reports WHERE at < ?;
    `),
    getRecentActiveLinks: db.prepare(`
      SELECT code, target FROM links WHERE created_at >= ? AND status IN ('active', 'unscanned');
    `)
  };

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const res = fn();
      db.exec('COMMIT;');
      return res;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch (_) {}
      throw err;
    }
  }

  // Links API
  function createLink({ code, target, createdAt = Date.now(), expiresAt = null, clicks = 0, status = 'active', creator = null }) {
    try {
      stmts.insertLink.run(code, target, createdAt, expiresAt, clicks, status, creator);
      return true;
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('constraint'))) {
        return false;
      }
      throw err;
    }
  }

  function getLink(code, now = Date.now()) {
    const row = stmts.getLinkActive.get(code, now);
    if (!row) return null;
    return {
      code: row.code,
      target: row.target,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      clicks: row.clicks,
      status: row.status,
      creator: row.creator
    };
  }

  function incrementClicks(code, delta = 1) {
    stmts.incrementLinkClicks.run(delta, code);
  }

  function getExistingCodes(candidates = []) {
    if (!candidates || candidates.length === 0) return [];
    const placeholders = candidates.map(() => '?').join(',');
    const query = `SELECT code FROM links WHERE code IN (${placeholders});`;
    const rows = db.prepare(query).all(...candidates);
    return rows.map((r) => r.code);
  }

  // Pastes API
  function createPaste({
    id,
    title = null,
    language = null,
    body,
    encrypted = 0,
    pwSalt = null,
    pwHash = null,
    burn = 0,
    views = 0,
    createdAt = Date.now(),
    expiresAt = null,
    status = 'active',
    creator = null
  }) {
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    try {
      stmts.insertPaste.run(
        id,
        title,
        language,
        bodyBuf,
        encrypted ? 1 : 0,
        pwSalt,
        pwHash,
        burn ? 1 : 0,
        views,
        createdAt,
        expiresAt,
        status,
        creator
      );
      return true;
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('constraint'))) {
        return false;
      }
      throw err;
    }
  }

  function getPaste(id, now = Date.now()) {
    const row = stmts.getPasteActive.get(id, now);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      language: row.language,
      body: row.body ? Buffer.from(row.body) : null,
      encrypted: row.encrypted,
      pwSalt: row.pw_salt ? Buffer.from(row.pw_salt) : null,
      pwHash: row.pw_hash ? Buffer.from(row.pw_hash) : null,
      burn: row.burn,
      views: row.views,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.status,
      creator: row.creator
    };
  }

  function incrementPasteViews(id) {
    stmts.incrementPasteViews.run(id);
  }

  function burnPaste(id) {
    stmts.burnPaste.run(id);
  }

  function restorePaste(id) {
    stmts.restorePaste.run(id);
  }

  function deletePaste(id) {
    stmts.deletePaste.run(id);
  }

  // Generic KV API (e.g. for runtime/drop keys before Phase 4)
  function setKv(key, value, ttlSeconds = null) {
    const expiresAt = ttlSeconds ? Date.now() + Math.floor(ttlSeconds * 1000) : null;
    stmts.insertKv.run(key, typeof value === 'string' ? value : JSON.stringify(value), expiresAt);
  }

  function getKv(key) {
    const row = stmts.getKv.get(key);
    if (!row) return null;
    if (row.expires_at && row.expires_at <= Date.now()) {
      stmts.deleteKv.run(key);
      return null;
    }
    return row.value;
  }

  function delKv(key) {
    stmts.deleteKv.run(key);
  }

  function hasKv(key) {
    return getKv(key) !== null;
  }

  // Drops API
  function createDrop({
    id,
    objectKey,
    uploadId = null,
    name,
    size,
    state = 'initiated',
    createdAt = Date.now(),
    expiresAt,
    downloads = 0,
    maxDownloads = null,
    sha256 = null,
    deleteHash,
    encrypted = 0,
    creator = null
  }) {
    stmts.insertDrop.run(
      id,
      objectKey,
      uploadId,
      name,
      size,
      state,
      createdAt,
      expiresAt,
      downloads,
      maxDownloads,
      sha256,
      deleteHash,
      encrypted ? 1 : 0,
      creator
    );
    return true;
  }

  function getDrop(id) {
    const row = stmts.getDrop.get(id);
    if (!row) return null;
    return {
      id: row.id,
      objectKey: row.object_key,
      uploadId: row.upload_id,
      name: row.name,
      size: row.size,
      state: row.state,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      downloads: row.downloads,
      maxDownloads: row.max_downloads,
      sha256: row.sha256,
      deleteHash: row.delete_hash ? Buffer.from(row.delete_hash) : null,
      encrypted: row.encrypted,
      creator: row.creator
    };
  }

  function updateDropState(id, state) {
    stmts.updateDropState.run(state, id);
  }

  function updateDropComplete(id, size, sha256 = null) {
    stmts.updateDropComplete.run(size, sha256, id);
  }

  function claimDropDownload(id) {
    const res = stmts.claimDropDownload.run(id);
    return res.changes > 0;
  }

  function getActiveStorageBytes() {
    const row = stmts.getActiveStorageBytes.get();
    return row ? Number(row.total || 0) : 0;
  }

  function getDailySubnetBytes(subnet, sinceMs) {
    const row = stmts.getDailySubnetBytes.get(subnet, sinceMs);
    return row ? Number(row.total || 0) : 0;
  }

  function getDailyGlobalBytes(sinceMs) {
    const row = stmts.getDailyGlobalBytes.get(sinceMs);
    return row ? Number(row.total || 0) : 0;
  }

  function getExpiredDrops(now = Date.now(), limit = 100) {
    return stmts.getExpiredDrops.all(now, limit);
  }

  function getStaleInitiatedDrops(staleBeforeMs = Date.now() - 3600000, limit = 100) {
    return stmts.getStaleInitiatedDrops.all(staleBeforeMs, limit);
  }

  function deleteDrop(id) {
    stmts.deleteDrop.run(id);
  }

  function incrementDropDownloads(id) {
    stmts.incrementDropDownloads.run(id);
  }

  function getLinkRaw(code) {
    const row = stmts.getLinkRaw.get(code);
    if (!row) return null;
    return {
      code: row.code,
      target: row.target,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      clicks: row.clicks,
      status: row.status,
      creator: row.creator
    };
  }

  // Threat Indicators API (Task P5.3)
  function addThreatIndicator(kind, value, source = 'manual') {
    stmts.insertThreatIndicator.run(kind, value.toLowerCase().trim(), source, Date.now());
  }

  function hasThreatIndicator(kind, value) {
    const row = stmts.hasThreatIndicator.get(kind, value.toLowerCase().trim());
    return Boolean(row);
  }

  function isHostThreat(host) {
    if (!host) return false;
    const cleanHost = host.toLowerCase().trim().replace(/^\[|\]$/g, '').split(':')[0];
    const parts = cleanHost.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (hasThreatIndicator('host', parentDomain)) {
        return true;
      }
    }
    return false;
  }

  function bulkAddThreatIndicators(indicators = []) {
    return transaction(() => {
      let count = 0;
      const now = Date.now();
      for (const item of indicators) {
        if (!item || !item.value) continue;
        stmts.insertThreatIndicator.run(
          item.kind || 'host',
          item.value.toLowerCase().trim(),
          item.source || 'feed',
          now
        );
        count++;
      }
      return count;
    });
  }

  function getThreatIndicatorsCount() {
    const row = stmts.countThreatIndicators.get();
    return row ? Number(row.count || 0) : 0;
  }

  // Verdict Cache (Task P5.4) - 30 min max per Google Safe Browsing ToS
  function getVerdict(host, maxAgeMs = 1800000) {
    if (!host) return null;
    const minCheckedAt = Date.now() - maxAgeMs;
    const row = stmts.getVerdict.get(host.toLowerCase().trim(), minCheckedAt);
    return row ? row.verdict : null;
  }

  function setVerdict(host, verdict) {
    if (!host) return;
    stmts.setVerdict.run(host.toLowerCase().trim(), verdict, Date.now());
  }

  // Reports and Quarantine (Task P5.6)
  function quarantine(kind, id) {
    if (kind === 'link') {
      stmts.quarantineLink.run(id);
    } else if (kind === 'paste') {
      stmts.quarantinePaste.run(id);
    } else if (kind === 'drop') {
      stmts.quarantineDrop.run(id);
    }
  }

  function addReport({ kind, targetId, subnet, reason = 'abuse' }) {
    const now = Date.now();
    stmts.insertReport.run(kind, targetId, subnet, reason, now);
    const countRow = stmts.countDistinctReportSubnets.get(kind, targetId);
    const distinctSubnets = countRow ? Number(countRow.count || 0) : 1;

    let quarantined = false;
    if (distinctSubnets >= 3) {
      quarantine(kind, targetId);
      quarantined = true;
    }

    return { distinctSubnets, quarantined };
  }

  function takedown({ kind, targetId, reason = 'admin_takedown' }) {
    const now = Date.now();
    let contentSha256 = null;
    let creatorSubnet = null;

    if (kind === 'link') {
      const link = stmts.getLinkRaw.get(targetId);
      if (link) {
        creatorSubnet = link.creator;
        stmts.quarantineLink.run(targetId);
      }
    } else if (kind === 'paste') {
      const paste = stmts.getPasteActive.get(targetId, now + 1000000);
      if (paste) {
        creatorSubnet = paste.creator;
        stmts.quarantinePaste.run(targetId);
      }
    } else if (kind === 'drop') {
      const drop = stmts.getDrop.get(targetId);
      if (drop) {
        contentSha256 = drop.sha256;
        creatorSubnet = drop.creator;
        stmts.deleteDrop.run(targetId);
      }
    }

    stmts.insertTakedownAudit.run(kind, targetId, contentSha256, now, creatorSubnet, now, reason);

    // Purge old audits (>90 days) and reports (>14 days)
    const ninetyDaysAgo = now - (90 * 86400 * 1000);
    const fourteenDaysAgo = now - (14 * 86400 * 1000);
    stmts.deleteOldTakedownAudit.run(ninetyDaysAgo);
    stmts.deleteOldReports.run(fourteenDaysAgo);

    return true;
  }

  function rescanRecentLinks(maxAgeMs = 7 * 86400 * 1000) {
    const since = Date.now() - maxAgeMs;
    const activeLinks = stmts.getRecentActiveLinks.all(since);
    let quarantinedCount = 0;

    for (const link of activeLinks) {
      try {
        const parsed = new URL(link.target);
        if (isHostThreat(parsed.hostname)) {
          stmts.quarantineLink.run(link.code);
          quarantinedCount++;
        }
      } catch (_) {}
    }
    return quarantinedCount;
  }

  // Sweeper
  function purgeExpired(now = Date.now(), batchSize = 500) {
    const linkRes = stmts.deleteExpiredLinks.run(now, batchSize);
    const pasteRes = stmts.deleteExpiredPastes.run(now, batchSize);
    const dropRes = stmts.deleteExpiredDrops.run(now, batchSize);
    const kvRes = stmts.deleteExpiredKv.run(now, batchSize);

    return {
      links: linkRes.changes || 0,
      pastes: pasteRes.changes || 0,
      drops: dropRes.changes || 0,
      kv: kvRes.changes || 0
    };
  }

  function optimize() {
    try {
      db.exec('PRAGMA optimize;');
    } catch (_) {}
  }

  function healthProbe() {
    if (!db || !db.open) throw new Error('database_closed');
    const read = db.prepare('SELECT 1 as alive').get();
    if (!read || read.alive !== 1) throw new Error('database_read_failed');
    db.prepare('CREATE TABLE IF NOT EXISTS _health_probe (id INTEGER PRIMARY KEY, last_check INTEGER)').run();
    db.prepare('INSERT OR REPLACE INTO _health_probe (id, last_check) VALUES (1, ?)').run(Date.now());
    return true;
  }

  function checkpoint(mode = 'PASSIVE') {
    try {
      db.exec(`PRAGMA wal_checkpoint(${mode});`);
    } catch (_) {}
  }

  function getWalSize() {
    if (dbFilePath === ':memory:') return 0;
    try {
      return fs.statSync(`${dbFilePath}-wal`).size;
    } catch (_) {
      return 0;
    }
  }

  function getDbSize() {
    if (dbFilePath === ':memory:') return 0;
    try {
      return fs.statSync(dbFilePath).size;
    } catch (_) {
      return 0;
    }
  }

  function close() {
    checkpoint('PASSIVE');
    db.close();
  }

  return {
    getRawDb: () => db,
    getWalSize,
    getDbSize,
    transaction,
    createLink,
    getLink,
    incrementClicks,
    getExistingCodes,
    createPaste,
    getPaste,
    incrementPasteViews,
    burnPaste,
    restorePaste,
    deletePaste,
    setKv,
    getKv,
    delKv,
    hasKv,
    createDrop,
    getDrop,
    updateDropState,
    updateDropComplete,
    claimDropDownload,
    getActiveStorageBytes,
    getDailySubnetBytes,
    getDailyGlobalBytes,
    getExpiredDrops,
    getStaleInitiatedDrops,
    deleteDrop,
    incrementDropDownloads,
    getLinkRaw,
    addThreatIndicator,
    hasThreatIndicator,
    isHostThreat,
    bulkAddThreatIndicators,
    getThreatIndicatorsCount,
    getVerdict,
    setVerdict,
    quarantine,
    addReport,
    takedown,
    rescanRecentLinks,
    purgeExpired,
    optimize,
    checkpoint,
    healthProbe,
    close
  };
}

module.exports = {
  createSqliteStorage
};
