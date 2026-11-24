// src/config.js
// Centralized, validated application configuration (Task P3.1).
// Zero external dependencies. Fail-fast validation for production and security gates.

const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ROOT_DIR = path.resolve(__dirname, '..');

function tryLoadConfigFile() {
  const configPath = path.join(ROOT_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function parseTrustProxy(val) {
  if (val === undefined || val === null || val === '') return 'loopback,uniquelocal';
  const str = String(val).trim();
  if (str === 'true' || str === '1') return 1;
  if (str === 'false' || str === '0') return false;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  return str;
}

function loadConfig(env = process.env) {
  const fileConfig = tryLoadConfigFile();

  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';
  const isBench = nodeEnv === 'bench';

  // Security gate: refuse debug/bench bypasses in production (Task R9.2 Part 2 Item 3)
  if (isProduction) {
    if (env.ALLOW_TEST_IPC_SHUTDOWN === '1' || env.BENCH_BYPASS_LIMITER === '1' || env.ENABLE_SOAK_GC === '1') {
      throw new Error(
        'Security violation: ALLOW_TEST_IPC_SHUTDOWN, BENCH_BYPASS_LIMITER, and ENABLE_SOAK_GC are strictly forbidden in production mode.'
      );
    }
  }

  // Rate limiter bench bypass flag
  const benchBypassLimiter = (isBench || isTest) && env.BENCH_BYPASS_LIMITER === '1';

  // Server port & networking
  const port = parseInt(env.PORT || '5050', 10);
  const baseUrl = env.BASE_URL || fileConfig.BASE_URL || 'https://pokedb.site';
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const originVerifySecret = env.ORIGIN_VERIFY_SECRET || '';
  const adminToken = env.ADMIN_TOKEN || fileConfig.ADMIN_TOKEN || '';

  // Storage configuration
  const store = (env.STORE || 'sqlite').toLowerCase();
  const sqliteDbPath = env.SQLITE_DB_PATH || (isTest ? ':memory:' : path.join(DATA_DIR, 'pokedb.sqlite'));
  const clickBufferMaxSize = parseInt(env.CLICK_BUFFER_MAX_SIZE || '10000', 10);
  const enableSoakGc = env.ENABLE_SOAK_GC === '1';
  const allowTestIpcShutdown = env.ALLOW_TEST_IPC_SHUTDOWN === '1';

  // Legacy / Deprecated Redis configuration (v1 compatibility; PokéDB v2 uses SQLite WAL)
  // [LEGACY CONFIGURATION: Retained for backward-compatible migration only]
  const redisUrl = env.REDIS_URL || 'redis://127.0.0.1:6379';
  const redisRejectUnauthorized = env.REDIS_REJECT_UNAUTHORIZED === 'false' ? false : true;
  const redisCaCert = env.REDIS_CA_CERT || undefined;

  if (store === 'redis') {
    try {
      require.resolve('ioredis');
      require.resolve('rate-limit-redis');
    } catch {
      throw new Error('Fatal: STORE=redis requested, but required modules ioredis and rate-limit-redis are not installed.');
    }
  }

  // Litestream & Replication configuration
  const requireReplication = env.REQUIRE_REPLICATION === '1';
  const litestreamMetricsUrl = env.LITESTREAM_METRICS_URL || 'http://127.0.0.1:9090/metrics';
  const litestreamLastSyncTimestamp = env.LITESTREAM_LAST_SYNC_TIMESTAMP || undefined;
  const r2BucketBackups = env.R2_BUCKET_BACKUPS || 'pokedb-backups';
  const r2AccountId = env.R2_ACCOUNT_ID || '';
  const r2AccessKeyId = env.R2_ACCESS_KEY_ID || '';
  const r2SecretAccessKey = env.R2_SECRET_ACCESS_KEY || '';

  if (requireReplication) {
    const hasR2 = Boolean(r2AccountId && r2AccessKeyId && r2SecretAccessKey);
    if (!hasR2) {
      throw new Error('Fatal: REQUIRE_REPLICATION=1 is set, but required Litestream/R2 credentials are missing.');
    }
  }

  // Legacy Rootz cloud storage configuration (v1 compatibility; PokéDB v2 uses Cloudflare R2 direct uploads)
  // [LEGACY CONFIGURATION: Deprecated in v2 in favor of R2_BUCKET_NAME and R2_ACCOUNT_ID]
  const rootzApiKey = env.ROOTZ_API_KEY || fileConfig.ROOTZ_API_KEY || '';
  const rootzFolderId = env.ROOTZ_FOLDER_ID || fileConfig.ROOTZ_FOLDER_ID || '';
  const rootzFolderName = env.ROOTZ_FOLDER_NAME || fileConfig.ROOTZ_FOLDER_NAME || 'pokedb.site';
  const rootzTimeoutMs = parseInt(env.ROOTZ_TIMEOUT_MS || '1200000', 10);
  const largeFilePassword = env.LARGE_FILE_PASSWORD || fileConfig.LARGE_FILE_PASSWORD || null;

  // Cloudflare R2 Drop Storage
  const r2BucketName = env.R2_BUCKET_NAME || 'pokedb-drops';
  const r2Endpoint = env.R2_ENDPOINT || undefined;
  const dropPolicy = env.DROP_POLICY || 'open_limited';

  // Abuse resistance, Turnstile, and Scanning (Task P5.1 - P5.6)
  const turnstileSecretKey = env.TURNSTILE_SECRET_KEY || '';
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY || '';
  const abuseWebhookUrl = env.ABUSE_WEBHOOK_URL || '';
  const redirectMode = env.REDIRECT_MODE ? env.REDIRECT_MODE.toLowerCase() : '';
  const abuseChAuthKey = env.ABUSE_CH_AUTH_KEY || '';
  const googleSafeBrowsingKey = env.GOOGLE_SAFE_BROWSING_KEY || '';
  const sentryDsn = env.SENTRY_DSN || '';

  return {
    nodeEnv,
    isProduction,
    isTest,
    isBench,
    benchBypassLimiter,
    allowTestIpcShutdown,
    enableSoakGc,
    port,
    baseUrl,
    trustProxy,
    originVerifySecret,
    adminToken,
    store,
    sqliteDbPath,
    clickBufferMaxSize,
    redisUrl,
    redisRejectUnauthorized,
    redisCaCert,
    requireReplication,
    litestreamMetricsUrl,
    litestreamLastSyncTimestamp,
    r2BucketBackups,
    r2AccountId,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2BucketName,
    r2Endpoint,
    dropPolicy,
    turnstileSecretKey,
    turnstileSiteKey,
    abuseWebhookUrl,
    redirectMode,
    abuseChAuthKey,
    rootzApiKey,
    rootzFolderId,
    rootzFolderName,
    rootzTimeoutMs,
    largeFilePassword,
    googleSafeBrowsingKey,
    sentryDsn
  };
}

// Default singleton instance using process.env
let currentConfig = null;
function getConfig() {
  if (!currentConfig) {
    currentConfig = loadConfig(process.env);
  }
  return currentConfig;
}

module.exports = {
  loadConfig,
  getConfig,
  parseTrustProxy
};
