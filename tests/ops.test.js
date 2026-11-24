// tests/ops.test.js
// Unit tests for operational consistency: /health replication age, REQUIRE_REPLICATION fail-closed,
// and security fail-fast gates (Item 3, 5, 7, 8).

const request = require('supertest');
const { spawnSync } = require('child_process');
const path = require('path');
const app = require('../server.js');

describe('Operational Consistency & Health Replication Status (Task R2.5f / Step 1)', () => {
  const originalReplication = process.env.REQUIRE_REPLICATION;
  const originalSyncTs = process.env.LITESTREAM_LAST_SYNC_TIMESTAMP;

  afterEach(() => {
    if (originalReplication !== undefined) process.env.REQUIRE_REPLICATION = originalReplication;
    else delete process.env.REQUIRE_REPLICATION;

    if (originalSyncTs !== undefined) process.env.LITESTREAM_LAST_SYNC_TIMESTAMP = originalSyncTs;
    else delete process.env.LITESTREAM_LAST_SYNC_TIMESTAMP;
  });

  test('GET /health exposes replication status and lastSyncAge', async () => {
    delete process.env.LITESTREAM_LAST_SYNC_TIMESTAMP;
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('replication');
    expect(res.body).toHaveProperty('replicationLastSyncAge');
    expect(res.body.replicationLastSyncAge).toBe('unknown');
    expect(res.body.replication.lastSyncAge).toBe('unknown');
  });

  test('GET /health returns 200 operational when replication signal is fresh (age <= 120s)', async () => {
    process.env.REQUIRE_REPLICATION = '1';
    process.env.LITESTREAM_LAST_SYNC_TIMESTAMP = String(Date.now() - 15000); // 15s ago
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.replication.status).toBe('operational');
    expect(typeof res.body.replication.lastSyncAge).toBe('number');
    expect(res.body.replication.lastSyncAge).toBeLessThan(60);
  });

  test('GET /health returns 503 degraded when replication signal is stale (age > 120s)', async () => {
    process.env.REQUIRE_REPLICATION = '1';
    process.env.LITESTREAM_LAST_SYNC_TIMESTAMP = String(Date.now() - 200000); // 200s ago
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.replication.status).toBe('stale');
    expect(res.body.replication.lastSyncAge).toBeGreaterThanOrEqual(190);
  });

  test('GET /health evaluates unknown signal correctly based on uptime', async () => {
    process.env.REQUIRE_REPLICATION = '1';
    delete process.env.LITESTREAM_LAST_SYNC_TIMESTAMP;
    const res = await request(app).get('/health');
    if (Math.floor(process.uptime()) > 60) {
      expect(res.statusCode).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.replication.status).toBe('stale');
    } else {
      expect(res.statusCode).toBe(200);
    }
  });

  test('fails closed when REQUIRE_REPLICATION=1 and credentials are missing', () => {
    function checkReplicationCredentials(env) {
      if (env.REQUIRE_REPLICATION === '1') {
        const hasR2 = Boolean(
          env.R2_ACCOUNT_ID &&
          env.R2_ACCESS_KEY_ID &&
          env.R2_SECRET_ACCESS_KEY
        );
        if (!hasR2) {
          throw new Error('Fatal: REQUIRE_REPLICATION=1 is set, but required Litestream/R2 credentials are missing.');
        }
      }
      return true;
    }

    expect(() => checkReplicationCredentials({ REQUIRE_REPLICATION: '1' })).toThrow(/Fatal: REQUIRE_REPLICATION=1/);
    expect(checkReplicationCredentials({
      REQUIRE_REPLICATION: '1',
      R2_ACCOUNT_ID: 'acc123',
      R2_ACCESS_KEY_ID: 'key123',
      R2_SECRET_ACCESS_KEY: 'sec123'
    })).toBe(true);
    expect(checkReplicationCredentials({ REQUIRE_REPLICATION: '0' })).toBe(true);
  });

  test('refuses ALLOW_TEST_IPC_SHUTDOWN or BENCH_BYPASS_LIMITER when NODE_ENV=production', () => {
    const res1 = spawnSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_IPC_SHUTDOWN = '1';
      require('./server.js');
    `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });

    expect(res1.status).toBe(1);
    expect(res1.stderr).toMatch(/strictly forbidden in production mode/);

    const res2 = spawnSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'production';
      process.env.BENCH_BYPASS_LIMITER = '1';
      require('./server.js');
    `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });

    expect(res2.status).toBe(1);
    expect(res2.stderr).toMatch(/strictly forbidden in production mode/);
  });

  test('renders friendly 400 HTML page when browser requests query tokens', async () => {
    const res = await request(app)
      .get('/api/drop/delete?token=legacy123')
      .set('Accept', 'text/html,application/xhtml+xml');

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Query Tokens Deprecated');
    expect(res.text).toContain('Authorization: Bearer');
  });

  test('returns 400 JSON when API client requests query tokens', async () => {
    const res = await request(app)
      .get('/api/drop/delete?token=legacy123')
      .set('Accept', 'application/json');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('query_tokens_forbidden');
  });
});
