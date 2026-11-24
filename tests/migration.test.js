// tests/migration.test.js
// Unit tests for legacy migration script (Task P2.7 & R2.5e)
// Tests unmapped key rejection, --allow-unmapped flag, drop:* keys, and mock Redis source.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { transformRecords, runMigration } = require('../scripts/migrate-legacy.js');
const { createSqliteStorage } = require('../src/storage/sqlite.js');

describe('Legacy Storage Migration (Task P2.7 & R2.5e)', () => {
  let tmpDir;
  let dbPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokedb-migr-test-'));
    dbPath = path.join(tmpDir, 'test.sqlite');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('transforms links, pastes, and drops correctly', () => {
    const rawStore = {
      'url:gh': JSON.stringify({ longUrl: 'https://github.com', clicks: 42 }),
      'url:gh:clicks': 42,
      'paste:p1': JSON.stringify({ title: 'Paste 1', content: 'Hello World', views: 5 }),
      'drop:d1': JSON.stringify({ name: 'file.txt', size: 1024, state: 'complete' })
    };

    const res = transformRecords(rawStore, Date.now(), true);
    expect(res.links).toHaveLength(1);
    expect(res.links[0].code).toBe('gh');
    expect(res.links[0].clicks).toBe(42);

    expect(res.pastes).toHaveLength(1);
    expect(res.pastes[0].id).toBe('p1');
    expect(Buffer.from(res.pastes[0].body).toString('utf8')).toBe('Hello World');

    expect(res.drops).toHaveLength(1);
    expect(res.drops[0].id).toBe('d1');
    expect(res.drops[0].name).toBe('file.txt');

    expect(res.unmappedKeys).toHaveLength(0);
  });

  test('identifies unknown/unmapped keys and fails unless allowUnmapped is true', async () => {
    const jsonPath = path.join(tmpDir, 'store.json');
    const rawData = {
      'url:valid': JSON.stringify({ longUrl: 'https://example.com' }),
      'unknown_setting_1': 'some_val',
      'legacy_session:xyz': JSON.stringify({ user: 'anon' })
    };
    fs.writeFileSync(jsonPath, JSON.stringify(rawData));

    // Without --allow-unmapped: must fail
    await expect(runMigration({
      dryRun: true,
      source: jsonPath,
      dbPath,
      allowUnmapped: false
    })).rejects.toThrow(/Unmapped key\(s\) found in source store/);

    // With --allow-unmapped: must succeed
    const res = await runMigration({
      dryRun: true,
      source: jsonPath,
      dbPath,
      allowUnmapped: true
    });
    expect(res.dryRun).toBe(true);
    expect(res.migrated.links).toBe(1);
    expect(res.unmappedCount).toBe(2);
  });

  test('migrates from mock Redis source with drop:* and verifies drop parity', async () => {
    const mockRedisClient = {
      keys: async () => ['url:rlink', 'drop:rdrop'],
      get: async (k) => {
        if (k === 'url:rlink') return JSON.stringify({ longUrl: 'https://redis.example.com', clicks: 10 });
        if (k === 'drop:rdrop') return JSON.stringify({ name: 'archive.tar.gz', size: 50000, state: 'complete' });
        return null;
      },
      disconnect: () => {}
    };

    const res = await runMigration({
      dryRun: false,
      source: 'redis',
      dbPath,
      mockRedis: mockRedisClient,
      allowUnmapped: false
    });

    expect(res.dryRun).toBe(false);
    expect(res.migrated.links).toBe(1);
    expect(res.migrated.drops).toBe(1);

    const storage = createSqliteStorage(dbPath);
    const link = storage.getLink('rlink');
    const drop = storage.getDrop('rdrop');
    storage.close();

    expect(link).not.toBeNull();
    expect(link.target).toBe('https://redis.example.com');
    expect(drop).not.toBeNull();
    expect(drop.name).toBe('archive.tar.gz');
  });
});
