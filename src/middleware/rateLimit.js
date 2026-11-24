// src/middleware/rateLimit.js
// Rate limiters for each tool endpoint and shared resilient store (Task P3.3, SEC-001, PERF-004).

const { rateLimit, MemoryStore, ipKeyGenerator } = require('express-rate-limit');

let RedisStore;
try {
  const mod = require('rate-limit-redis');
  RedisStore = mod.default || mod;
} catch {
  // Optional in production
}

class ResilientRateLimitStore {
  constructor(prefix, registry = null) {
    this.prefix = `pokedb:rate-limit:${prefix}:`;
    this.memoryStore = new MemoryStore();
    this.redisStore = null;
    if (registry) registry.push(this);
  }

  init(options) {
    this.options = options;
    this.memoryStore.init(options);
  }

  useRedis(client) {
    if (!this.options || this.redisStore || !RedisStore) return;

    const store = new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix: this.prefix
    });
    store.init(this.options);
    this.redisStore = store;

    Promise.all([store.incrementScriptSha, store.getScriptSha]).catch((err) => {
      if (this.redisStore === store) {
        console.warn('Redis rate-limit store unavailable; using in-memory limits.', err.message);
        this.redisStore = null;
      }
    });
  }

  useMemory() {
    this.redisStore = null;
  }

  increment(key) {
    const active = this.redisStore || this.memoryStore;
    return active.increment(key);
  }

  decrement(key) {
    const active = this.redisStore || this.memoryStore;
    if (typeof active.decrement === 'function') {
      return active.decrement(key);
    }
  }

  resetKey(key) {
    const active = this.redisStore || this.memoryStore;
    return active.resetKey(key);
  }

  resetAll() {
    const active = this.redisStore || this.memoryStore;
    if (typeof active.resetAll === 'function') {
      return active.resetAll();
    }
  }
}

function createRateLimiters(options = {}) {
  const isBenchBypass = Boolean(options.benchBypassLimiter);
  const storeRegistry = options.storeRegistry || [];

  function createStore(prefix) {
    return new ResilientRateLimitStore(prefix, storeRegistry);
  }

  const sharedOptions = {
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isBenchBypass
  };

  const redirectLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('redirect'),
    windowMs: 60 * 1000,
    max: 300,
    message: { error: 'Too many redirect requests, please try again after 1 minute.' },
    statusCode: 429
  });

  const uploadLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('upload'),
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many upload requests, please try again after 15 minutes.' }
  });

  const multipartLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('multipart'),
    windowMs: 15 * 60 * 1000,
    max: 2000,
    message: { error: 'Too many multipart upload requests, please try again after 15 minutes.' }
  });

  const shortenLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('shorten'),
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many requests, please try again after 15 minutes.' }
  });

  const pasteCreateLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('paste_create'),
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many pastes created, please try again after 15 minutes.' }
  });

  const pasteAuthLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('paste_auth'),
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => `${ipKeyGenerator(req)}:${req.params.code || req.body?.code || ''}`,
    message: { error: 'Too many password attempts, please try again after 15 minutes.' }
  });

  const viewerLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('viewer'),
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Too many view requests. Rate limit is 120 requests per minute.' },
    statusCode: 429
  });

  const qrLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('qr'),
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Too many QR requests. Rate limit is 120 requests per minute.' },
    statusCode: 429
  });

  const adminLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('admin'),
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    message: { error: 'Too many failed admin attempts, please try again after 15 minutes.' },
    statusCode: 429
  });

  // Task P5.2: Strict 5/min rate limit for CLI requests
  const cliLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('cli'),
    windowMs: 60 * 1000,
    max: 5,
    skip: (req) => isBenchBypass || !req.isCli,
    message: 'Too many CLI requests. Rate limit is 5 requests per minute.\n',
    statusCode: 429
  });

  // Task P5.6: Abuse reporting rate limit
  const reportLimiter = rateLimit({
    ...sharedOptions,
    store: createStore('report'),
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many reports submitted. Please wait before reporting again.' },
    statusCode: 429
  });

  return {
    redirectLimiter,
    uploadLimiter,
    multipartLimiter,
    shortenLimiter,
    pasteCreateLimiter,
    pasteAuthLimiter,
    viewerLimiter,
    qrLimiter,
    adminLimiter,
    cliLimiter,
    reportLimiter,
    createStore
  };
}

module.exports = {
  ResilientRateLimitStore,
  createRateLimiters
};
