// tests/phase8.test.js
// Verification suite for Phase 8: Observability, Health Probes, Sentry Scrubbing, CI & Operations

const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { createSqliteStorage } = require('../src/storage/sqlite');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');
const { HealthProbeManager } = require('../src/tools/health/probe');
const {
  scrubIp,
  scrubUrl,
  scrubHeaders,
  is4xxError,
  HourlyRateLimiter,
  createBeforeSend,
  createSentryService
} = require('../src/services/sentry');
const { exportBackup } = require('../scripts/backup-sqlite');

describe('Phase 8: Observability & Health Probes (P8.1)', () => {
  let store;
  let objectStore;
  let app;
  let probe;

  beforeEach(() => {
    store = createSqliteStorage(':memory:');
    objectStore = new FakeObjectStore();
    probe = new HealthProbeManager({
      store,
      objectStore,
      config: { sqliteDbPath: ':memory:' }
    });
    const result = createApp({ store, objectStore, probe });
    app = result.app;
  });

  afterEach(() => {
    if (probe) probe.stop();
    if (store && store.close) store.close();
  });

  test('GET /healthz returns fast 200 OK liveness with zero I/O', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });

  test('GET /readyz returns 200 ready when subsystems are operational', async () => {
    await probe.runProbe();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.subsystems.database).toBe('operational');
    expect(res.body.subsystems.objectStore).toBe('operational');
  });

  test('GET /readyz returns 503 degraded when a critical subsystem fails', async () => {
    // Simulate broken database
    const brokenStore = {
      healthProbe: () => {
        throw new Error('disk_io_error');
      }
    };
    const degradedProbe = new HealthProbeManager({
      store: brokenStore,
      objectStore
    });
    await degradedProbe.runProbe();

    const degradedApp = createApp({ store: brokenStore, objectStore, probe: degradedProbe }).app;
    const res = await request(degradedApp).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.failing).toContain('database');
    expect(res.body.subsystems.database).toBe('degraded');
    degradedProbe.stop();
  });

  test('GET /api/status returns current snapshot and history ring buffer', async () => {
    await probe.runProbe();
    await probe.runProbe();

    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('operational');
    expect(res.body.current).toBeDefined();
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBeGreaterThanOrEqual(2);
  });

  test('Ring buffer caps at 60 snapshots', async () => {
    const testProbe = new HealthProbeManager({ store, objectStore });
    for (let i = 0; i < 65; i++) {
      await testProbe.runProbe();
    }
    expect(testProbe.getRingBuffer().length).toBe(60);
    testProbe.stop();
  });

  test('Visitors cannot trigger live dependency calls: endpoints serve cached snapshot', async () => {
    let probeCalls = 0;
    const trackingStore = {
      healthProbe: () => {
        probeCalls++;
      }
    };
    const cachedProbe = new HealthProbeManager({ store: trackingStore, objectStore });
    await cachedProbe.runProbe();
    expect(probeCalls).toBe(1);

    const testApp = createApp({ store: trackingStore, objectStore, probe: cachedProbe }).app;

    // Send 10 rapid status/readyz requests
    for (let i = 0; i < 10; i++) {
      await request(testApp).get('/readyz');
      await request(testApp).get('/api/status');
      await request(testApp).get('/health');
    }

    // probeCalls should still be exactly 1 because all endpoints read cached snapshot!
    expect(probeCalls).toBe(1);
    cachedProbe.stop();
  });
});

describe('Phase 8: Sentry Scrubbing & 4xx Suppression (P8.2)', () => {
  test('scrubIp masks IPv4 to /24 subnet and IPv6 to /48', () => {
    expect(scrubIp('192.168.1.45')).toBe('192.168.1.0/24');
    expect(scrubIp('10.0.5.123')).toBe('10.0.5.0/24');
    expect(scrubIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::/48');
    expect(scrubIp(null)).toBe('[REDACTED]');
  });

  test('scrubUrl redacts sensitive query parameters', () => {
    const raw = 'https://pokedb.site/api/shorten?url=https://example.com&token=secret123&key=xyz456&code=auth789';
    const clean = scrubUrl(raw);
    expect(clean).not.toContain('secret123');
    expect(clean).not.toContain('xyz456');
    expect(clean).not.toContain('auth789');
    expect(clean).toContain('token=%5BREDACTED%5D');
    expect(clean).toContain('url=https%3A%2F%2Fexample.com');
  });

  test('scrubHeaders redacts authentication and proxy headers', () => {
    const headers = {
      'host': 'pokedb.site',
      'authorization': 'Bearer secret-token',
      'x-admin-token': 'admin-secret',
      'cookie': 'session=abc',
      'content-type': 'application/json'
    };
    const clean = scrubHeaders(headers);
    expect(clean['authorization']).toBe('[REDACTED]');
    expect(clean['x-admin-token']).toBe('[REDACTED]');
    expect(clean['cookie']).toBe('[REDACTED]');
    expect(clean['host']).toBe('pokedb.site');
    expect(clean['content-type']).toBe('application/json');
  });

  test('is4xxError correctly identifies 4xx errors to suppress', () => {
    expect(is4xxError(null, { originalException: { statusCode: 400 } })).toBe(true);
    expect(is4xxError(null, { originalException: { statusCode: 404 } })).toBe(true);
    expect(is4xxError(null, { originalException: { statusCode: 429 } })).toBe(true);
    expect(is4xxError(null, { originalException: { statusCode: 500 } })).toBe(false);
    expect(is4xxError({ tags: { status_code: 403 } })).toBe(true);
    expect(is4xxError({ tags: { status_code: 503 } })).toBe(false);
  });

  test('HourlyRateLimiter caps events per hour', () => {
    let mockTime = 1000000;
    const limiter = new HourlyRateLimiter(5, { now: () => mockTime });

    for (let i = 0; i < 5; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    // 6th event in same hour should be rejected
    expect(limiter.tryAcquire()).toBe(false);

    // Advance 61 minutes
    mockTime += 3660000;
    expect(limiter.tryAcquire()).toBe(true);
  });

  test('beforeSend drops 4xx errors, drops rate-capped events, and scrubs PII', () => {
    const beforeSend = createBeforeSend({ maxEventsPerHour: 2 });

    // 1. 4xx error should return null
    const event404 = {
      request: { url: '/not-found' },
      contexts: { response: { status_code: 404 } }
    };
    expect(beforeSend(event404, { originalException: { statusCode: 404 } })).toBeNull();

    // 2. 500 error with PII should be scrubbed
    const event500 = {
      user: { ip_address: '203.0.113.195' },
      request: {
        url: 'https://pokedb.site/api/drop/init?token=super-secret',
        headers: { authorization: 'Bearer secret123', 'content-type': 'application/json' }
      },
      tags: { status_code: 500 }
    };
    const scrubbed = beforeSend(event500, { originalException: { statusCode: 500 } });
    expect(scrubbed).not.toBeNull();
    expect(scrubbed.user.ip_address).toBe('203.0.113.0/24');
    expect(scrubbed.request.url).not.toContain('super-secret');
    expect(scrubbed.request.headers.authorization).toBe('[REDACTED]');

    // 3. Second 500 error allowed
    expect(beforeSend({ tags: { status_code: 500 } }, {})).not.toBeNull();

    // 4. Third event exceeds hourly rate cap (maxEventsPerHour: 2) -> dropped
    expect(beforeSend({ tags: { status_code: 500 } }, {})).toBeNull();
  });
});

describe('Phase 8: Cloudflare Analytics Isolation (P8.3, C9)', () => {
  test('Cloudflare Analytics script exists only on landing and tools hub', () => {
    const landingHtml = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
    const toolsHubHtml = fs.readFileSync(path.resolve(__dirname, '../tools/public/index.html'), 'utf8');

    expect(landingHtml).toContain('beacon.min.js');
    expect(toolsHubHtml).toContain('beacon.min.js');
  });

  test('Cloudflare Analytics is strictly absent from all client-side tool pages (C9)', () => {
    const clientToolPages = [
      '../tools/json/public/index.html',
      '../tools/jwt/public/index.html',
      '../tools/codec/public/index.html',
      '../tools/hash/public/index.html',
      '../tools/uuid/public/index.html',
      '../tools/cron/public/index.html',
      '../tools/diff/public/index.html',
      '../tools/minecraft/public/index.html',
      '../tools/sanitizer/public/index.html',
      '../tools/paste/public/index.html',
      '../tools/drop/public/index.html',
      '../tools/qr/public/index.html'
    ];

    for (const rel of clientToolPages) {
      const p = path.resolve(__dirname, rel);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        expect(content).not.toContain('beacon.min.js');
        expect(content).not.toContain('cloudflareinsights.com');
      }
    }
  });
});

describe('Phase 8: CI & Dependabot Configuration (P8.4)', () => {
  test('.github/dependabot.yml exists and configures weekly npm and docker updates', () => {
    const depPath = path.resolve(__dirname, '../.github/dependabot.yml');
    expect(fs.existsSync(depPath)).toBe(true);
    const content = fs.readFileSync(depPath, 'utf8');
    expect(content).toContain('package-ecosystem: "npm"');
    expect(content).toContain('package-ecosystem: "docker"');
    expect(content).toContain('interval: "weekly"');
  });

  test('.github/workflows/ci.yml enforces coverage >=80%, contrast, budget, and gitleaks', () => {
    const ciPath = path.resolve(__dirname, '../.github/workflows/ci.yml');
    expect(fs.existsSync(ciPath)).toBe(true);
    const content = fs.readFileSync(ciPath, 'utf8');
    expect(content).toContain('--coverageThreshold');
    expect(content).toContain('validate-projects.js');
    expect(content).toContain('audit-contrast.js');
    expect(content).toContain('check-budget.js');
    expect(content).toContain('gitleaks');
  });
});

describe('Phase 8: Backup Routine & Operations Runbook (P8.5, P8.6)', () => {
  test('scripts/backup-sqlite.js executes transactional VACUUM INTO and verifies integrity', () => {
    const tempDir = path.resolve(__dirname, '../temp-p8-backup');
    fs.mkdirSync(tempDir, { recursive: true });
    const srcDb = path.join(tempDir, 'source.sqlite');
    const outDb = path.join(tempDir, 'backup.sqlite');

    const db = new DatabaseSync(srcDb);
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);');
    db.prepare('INSERT INTO items (title) VALUES (?)').run('verified-item');
    db.close();

    const result = exportBackup({ dbPath: srcDb, outputFile: outDb, verify: true });
    expect(result.verified).toBe(true);
    expect(fs.existsSync(outDb)).toBe(true);

    const checkDb = new DatabaseSync(outDb);
    const row = checkDb.prepare('SELECT title FROM items WHERE id = 1').get();
    expect(row.title).toBe('verified-item');
    checkDb.close();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('docs/RUNBOOK.md contains all required operational procedures', () => {
    const runbookPath = path.resolve(__dirname, '../docs/RUNBOOK.md');
    const content = fs.readFileSync(runbookPath, 'utf8');
    expect(content).toContain('Deploy & Rollback Procedures');
    expect(content).toContain('Secret Rotation Runbook');
    expect(content).toContain('Takedown & Abuse Audit Procedure');
    expect(content).toContain('Cloudflare R2 Outage Behavior');
    expect(content).toContain('Quota Alarms & Storage Capacity Tuning');
    expect(content).toContain('Cloudflare Dashboard Recommended Settings');
    expect(content).toContain('Monthly SQLite Snapshot Routine');
  });
});
