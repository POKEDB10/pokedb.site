// tests/sqlite.test.js
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createSqliteStorage } = require('../src/storage/sqlite.js');

describe('SQLite Storage Module (P2.1, P2.2)', () => {
  let tmpDir;
  let dbPath;
  let storage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-test-sqlite-'));
    dbPath = path.join(tmpDir, 'test.db');
    storage = createSqliteStorage(dbPath);
  });

  afterEach(() => {
    if (storage) {
      storage.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('configures expected pragmas and runs schema migrations', () => {
    const rawDb = storage.getRawDb();

    const busyTimeout = rawDb.prepare('PRAGMA busy_timeout;').get();
    expect(busyTimeout.timeout).toBe(5000);

    const foreignKeys = rawDb.prepare('PRAGMA foreign_keys;').get();
    expect(foreignKeys.foreign_keys).toBe(1);

    const tempStore = rawDb.prepare('PRAGMA temp_store;').get();
    expect(tempStore.temp_store).toBe(2); // MEMORY

    const migration = rawDb.prepare('SELECT version FROM schema_migrations WHERE version = 1;').get();
    expect(migration).toBeDefined();
    expect(migration.version).toBe(1);

    // Verify tables exist
    const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table';").all().map(r => r.name);
    expect(tables).toContain('links');
    expect(tables).toContain('pastes');
    expect(tables).toContain('drops');
    expect(tables).toContain('reports');
    expect(tables).toContain('threat_indicators');
    expect(tables).toContain('verdict_cache');
    expect(tables).toContain('takedown_audit');
    expect(tables).toContain('schema_migrations');
  });

  test('transaction helper commits on success and rolls back on error', () => {
    // Commit case
    storage.transaction(() => {
      storage.createLink({
        code: 'txn1',
        target: 'https://example.com/1',
        createdAt: Date.now()
      });
      storage.createLink({
        code: 'txn2',
        target: 'https://example.com/2',
        createdAt: Date.now()
      });
    });

    expect(storage.getLink('txn1')).not.toBeNull();
    expect(storage.getLink('txn2')).not.toBeNull();

    // Rollback case
    expect(() => {
      storage.transaction(() => {
        storage.createLink({
          code: 'txn3',
          target: 'https://example.com/3',
          createdAt: Date.now()
        });
        throw new Error('Simulated transaction failure');
      });
    }).toThrow('Simulated transaction failure');

    expect(storage.getLink('txn3')).toBeNull();
  });

  test('creates, resolves, and increments links correctly', () => {
    const now = Date.now();
    const created = storage.createLink({
      code: 'abc123',
      target: 'https://pokedb.site/tool',
      createdAt: now,
      expiresAt: now + 3600000,
      creator: '127.0.0.1'
    });
    expect(created).toBe(true);

    const link = storage.getLink('abc123');
    expect(link).not.toBeNull();
    expect(link.target).toBe('https://pokedb.site/tool');
    expect(link.clicks).toBe(0);

    // Increment clicks
    storage.incrementClicks('abc123', 5);
    const linkAfterClicks = storage.getLink('abc123');
    expect(linkAfterClicks.clicks).toBe(5);

    // Expired link returns null
    storage.createLink({
      code: 'expired1',
      target: 'https://expired.example.com',
      createdAt: now - 10000,
      expiresAt: now - 1000
    });
    expect(storage.getLink('expired1')).toBeNull();
  });

  test('finds multiple existing codes in a single query (TOOL-TINY-001 / P2.6)', () => {
    storage.createLink({ code: 'code1', target: 'https://a.com', createdAt: Date.now() });
    storage.createLink({ code: 'code2', target: 'https://b.com', createdAt: Date.now() });
    storage.createLink({ code: 'code3', target: 'https://c.com', createdAt: Date.now() });

    const existing = storage.getExistingCodes(['code1', 'code3', 'nonexistent', 'code2']);
    expect(new Set(existing)).toEqual(new Set(['code1', 'code2', 'code3']));
  });

  test('creates and retrieves pastes with encryption metadata', () => {
    const now = Date.now();
    const pasteBody = Buffer.from('console.log("hello world");', 'utf8');
    const salt = Buffer.from('randomsalt');
    const hash = Buffer.from('randomhash');

    storage.createPaste({
      id: 'p12345',
      title: 'Sample script',
      language: 'javascript',
      body: pasteBody,
      encrypted: 1,
      pwSalt: salt,
      pwHash: hash,
      burn: 0,
      createdAt: now,
      expiresAt: now + 86400000,
      creator: '127.0.0.1'
    });

    const p = storage.getPaste('p12345');
    expect(p).not.toBeNull();
    expect(p.title).toBe('Sample script');
    expect(p.language).toBe('javascript');
    expect(Buffer.isBuffer(p.body)).toBe(true);
    expect(p.body.toString('utf8')).toBe('console.log("hello world");');
    expect(p.encrypted).toBe(1);
    expect(p.views).toBe(0);

    storage.incrementPasteViews('p12345');
    const pAfter = storage.getPaste('p12345');
    expect(pAfter.views).toBe(1);
  });

  test('creates, retrieves, and updates drops', () => {
    const now = Date.now();
    storage.createDrop({
      id: 'drop8888',
      objectKey: 'drops/drop8888.bin',
      uploadId: null,
      name: 'archive.tar.gz',
      size: 1048576,
      state: 'complete',
      createdAt: now,
      expiresAt: now + 3600000,
      deleteHash: Buffer.from('deletehashsecret'),
      encrypted: 0,
      creator: '127.0.0.1'
    });

    const d = storage.getDrop('drop8888');
    expect(d).not.toBeNull();
    expect(d.name).toBe('archive.tar.gz');
    expect(d.size).toBe(1048576);
    expect(d.state).toBe('complete');

    storage.updateDropState('drop8888', 'deleted');
    expect(storage.getDrop('drop8888').state).toBe('deleted');
  });

  test('sweeper deletes expired records in bounded batches (P2.5)', () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      storage.createLink({
        code: `swp_exp_${i}`,
        target: 'https://example.com',
        createdAt: now - 5000,
        expiresAt: now - 1000 // expired
      });
    }

    const deleted = storage.purgeExpired(now, 10);
    expect(deleted.links).toBe(10); // Batch limit respected

    const deleted2 = storage.purgeExpired(now, 10);
    expect(deleted2.links).toBe(10);

    const deleted3 = storage.purgeExpired(now, 10);
    expect(deleted3.links).toBe(0);
  });

  test('generic KV store and restorePaste work as expected', () => {
    // KV tests
    storage.setKv('test:key', { foo: 'bar' });
    expect(storage.hasKv('test:key')).toBe(true);
    expect(JSON.parse(storage.getKv('test:key'))).toEqual({ foo: 'bar' });

    storage.delKv('test:key');
    expect(storage.hasKv('test:key')).toBe(false);
    expect(storage.getKv('test:key')).toBeNull();

    // Paste burn and restore
    storage.createPaste({
      id: 'burnrestore1',
      title: 'Burn and restore',
      body: Buffer.from('sensitive data'),
      burn: 1,
      createdAt: Date.now()
    });

    expect(storage.getPaste('burnrestore1')).not.toBeNull();
    storage.burnPaste('burnrestore1');
    expect(storage.getPaste('burnrestore1')).toBeNull();

    storage.restorePaste('burnrestore1');
    expect(storage.getPaste('burnrestore1')).not.toBeNull();
  });

  test('sweeper with 10k expired rows never blocks event loop > 50 ms (REL-002 / P2.5)', async () => {
    const { monitorEventLoopDelay } = require('node:perf_hooks');
    const now = Date.now();

    // 1. Insert 10,000 expired rows (5,000 links + 5,000 pastes) in a single transaction
    storage.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        storage.createLink({
          code: `exp_link_${i}`,
          target: 'https://example.com/expired',
          createdAt: now - 10000,
          expiresAt: now - 1000
        });
        storage.createPaste({
          id: `exp_paste_${i}`,
          title: `Paste ${i}`,
          body: Buffer.from(`body content ${i}`),
          createdAt: now - 10000,
          expiresAt: now - 1000
        });
      }
    });

    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();

    // 2. Run sweeper loop in batches of 500, yielding to event loop between batches
    let totalPurgedLinks = 0;
    let totalPurgedPastes = 0;
    let maxBatchDurationMs = 0;

    while (true) {
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

    expect(totalPurgedLinks).toBe(5000);
    expect(totalPurgedPastes).toBe(5000);
    expect(maxBatchDurationMs).toBeLessThan(50);
    expect(p99DelayMs).toBeLessThan(50);

    // Verify daily PRAGMA optimize runs without throwing
    expect(() => storage.optimize()).not.toThrow();

    // Verify passive WAL checkpoint runs without throwing
    expect(() => storage.checkpoint('PASSIVE')).not.toThrow();
  });
});
