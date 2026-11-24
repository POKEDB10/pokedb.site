// tests/config.test.js
// Unit tests for src/config.js (Task P3.1)

const path = require('node:path');

describe('Application Configuration (Task P3.1 / src/config.js)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset process.env before each test
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test('loads valid default configuration in development/test', () => {
    const { loadConfig } = require('../src/config.js');
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(5050);
    expect(config.store).toBe('sqlite');
    expect(config.clickBufferMaxSize).toBe(10000);
    expect(config.requireReplication).toBe(false);
    expect(config.allowTestIpcShutdown).toBe(false);
    expect(config.benchBypassLimiter).toBe(false);
  });

  test('parses custom environment overrides correctly', () => {
    const { loadConfig } = require('../src/config.js');
    const config = loadConfig({
      NODE_ENV: 'development',
      PORT: '8080',
      CLICK_BUFFER_MAX_SIZE: '5000',
      ADMIN_TOKEN: 'admintoken123',
      STORE: 'sqlite',
      BASE_URL: 'http://localhost:8080'
    });

    expect(config.port).toBe(8080);
    expect(config.clickBufferMaxSize).toBe(5000);
    expect(config.adminToken).toBe('admintoken123');
    expect(config.baseUrl).toBe('http://localhost:8080');
  });

  test('refuses ALLOW_TEST_IPC_SHUTDOWN in production', () => {
    const { loadConfig } = require('../src/config.js');
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        ALLOW_TEST_IPC_SHUTDOWN: '1'
      });
    }).toThrow(/strictly forbidden in production mode/);
  });

  test('refuses BENCH_BYPASS_LIMITER in production', () => {
    const { loadConfig } = require('../src/config.js');
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        BENCH_BYPASS_LIMITER: '1'
      });
    }).toThrow(/strictly forbidden in production mode/);
  });

  test('only activates bench bypass when NODE_ENV is bench or test', () => {
    const { loadConfig } = require('../src/config.js');

    const configBench = loadConfig({ NODE_ENV: 'bench', BENCH_BYPASS_LIMITER: '1' });
    expect(configBench.benchBypassLimiter).toBe(true);

    const configTest = loadConfig({ NODE_ENV: 'test', BENCH_BYPASS_LIMITER: '1' });
    expect(configTest.benchBypassLimiter).toBe(true);

    const configDev = loadConfig({ NODE_ENV: 'development', BENCH_BYPASS_LIMITER: '1' });
    expect(configDev.benchBypassLimiter).toBe(false);
  });

  test('validates REQUIRE_REPLICATION credentials fail-closed', () => {
    const { loadConfig } = require('../src/config.js');

    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        REQUIRE_REPLICATION: '1'
      });
    }).toThrow(/Fatal: REQUIRE_REPLICATION=1 is set, but required Litestream\/R2 credentials are missing/);

    const validReplication = loadConfig({
      NODE_ENV: 'production',
      REQUIRE_REPLICATION: '1',
      R2_ACCOUNT_ID: 'acc-123',
      R2_ACCESS_KEY_ID: 'key-123',
      R2_SECRET_ACCESS_KEY: 'secret-123'
    });
    expect(validReplication.requireReplication).toBe(true);
    expect(validReplication.r2AccountId).toBe('acc-123');
  });

  test('validates STORE=redis fail-fast when redis module missing or invalid', () => {
    const { loadConfig } = require('../src/config.js');

    // In this repo, ioredis is in devDependencies; if STORE=redis is used, it should validate REDIS_URL
    const redisConfig = loadConfig({
      STORE: 'redis',
      REDIS_URL: 'redis://127.0.0.1:6379'
    });
    expect(redisConfig.store).toBe('redis');
    expect(redisConfig.redisUrl).toBe('redis://127.0.0.1:6379');
  });

  test('refuses debug/bench flags in production with fail-closed security violation (Task R9.2 Part 2 Item 3)', () => {
    const { loadConfig } = require('../src/config.js');

    expect(() => {
      loadConfig({ NODE_ENV: 'production', BENCH_BYPASS_LIMITER: '1' });
    }).toThrow(/strictly forbidden in production mode/);

    expect(() => {
      loadConfig({ NODE_ENV: 'production', ALLOW_TEST_IPC_SHUTDOWN: '1' });
    }).toThrow(/strictly forbidden in production mode/);

    expect(() => {
      loadConfig({ NODE_ENV: 'production', ENABLE_SOAK_GC: '1' });
    }).toThrow(/strictly forbidden in production mode/);
  });
});
