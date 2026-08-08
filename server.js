const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const net = require('node:net');
const dns = require('node:dns/promises');
const { Readable } = require('node:stream');
const { nanoid, customAlphabet } = require('nanoid');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');
const QRCodeServer = require('qrcode');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5050;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
let CONFIG = {};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const rawConfig = fs.readFileSync(CONFIG_FILE, 'utf8');
    CONFIG = JSON.parse(rawConfig);
  } catch (err) {
    console.error('Error reading config.json:', err);
  }
}

function resolveHost(req) {
  if (!req) return '';
  const candidates = [];

  const xsub = req.headers['x-subdomain'] || req.headers['x-tool-subdomain'];
  if (Array.isArray(xsub)) candidates.push(...xsub);
  else if (typeof xsub === 'string') candidates.push(...xsub.split(','));

  const xfh = req.headers['x-forwarded-host'];
  if (Array.isArray(xfh)) candidates.push(...xfh);
  else if (typeof xfh === 'string') candidates.push(...xfh.split(','));

  const xhost = req.headers['x-host'];
  if (Array.isArray(xhost)) candidates.push(...xhost);
  else if (typeof xhost === 'string') candidates.push(...xhost.split(','));

  const hostHeader = req.headers.host || req.get('host');
  if (typeof hostHeader === 'string') candidates.push(...hostHeader.split(','));

  const hosts = candidates
    .map(h => String(h).trim().split(':')[0].toLowerCase())
    .filter(Boolean);

  const toolSubdomain = hosts.find(h => h.endsWith('.pokedb.site') && h !== 'pokedb.site' && h !== 'www.pokedb.site');
  if (toolSubdomain) return toolSubdomain;

  const apexHost = hosts.find(h => h.endsWith('.pokedb.site') || h === 'pokedb.site');
  if (apexHost) return apexHost;

  return hosts[0] || '';
}

function normalizeHost(value) {
  if (typeof value !== 'string') return '';
  return value.trim().split(',')[0].trim().replace(/^https?:\/\//i, '').split(':')[0].toLowerCase();
}

// Render's custom-domain routing can preserve the platform host while adding the
// requested tool host in a proxy header. Only honour that routing hint when the
// direct Host is a known platform host; clients on the public domain cannot use
// it to switch API permissions.
function resolveApiHost(req) {
  const directHost = normalizeHost(req.headers.host || req.get('host'));
  if (!directHost.endsWith('.onrender.com')) return directHost;

  const forwardedHost = normalizeHost(req.headers['x-forwarded-host']);
  if (forwardedHost.endsWith('.pokedb.site')) return forwardedHost;

  const routedSubdomain = normalizeHost(req.headers['x-subdomain'] || req.headers['x-tool-subdomain']);
  if (routedSubdomain.endsWith('.pokedb.site')) return routedSubdomain;

  return directHost;
}

function resolveBrowserOriginHost(req) {
  const candidates = [req.get('origin'), req.get('referer')];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      if (host.endsWith('.pokedb.site') || host === 'pokedb.site') return host;
    } catch (err) {
      // Ignore malformed browser-provided URL headers.
    }
  }
  return '';
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function renderTemplate(templateName, values) {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, templateName), 'utf8');
  return template.replace(/{{(\w+)}}/g, (match, key) => values[key] ?? '');
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (Buffer.byteLength(provided) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

const getBaseUrl = (req) => {
  if (req) {
    const protocol = req.protocol || 'https';
    const host = resolveHost(req);
    if (host) return `${protocol}://${host}`;
  }
  const envBase = process.env.BASE_URL || CONFIG.BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  return `http://localhost:${PORT}`;
};

// 1. Trust Proxy
app.set('trust proxy', 1);

// Security Middleware
const allowedCorsOrigin = /^(?:https:\/\/)(?:[a-z0-9-]+\.)*pokedb\.site$/i;
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedCorsOrigin.test(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by CORS'));
  }
}));
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      upgradeInsecureRequests: null
    }
  },
  xPoweredBy: false,
  frameguard: { action: 'sameorigin' },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Persistent File Store Setup (data/store.json)
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const inMemoryStore = new Map();

// Load records from disk on startup
if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      inMemoryStore.set(k, v);
    }
    console.log(`Loaded ${inMemoryStore.size} persistent records from ${DATA_FILE}`);
  } catch (err) {
    console.error('Error loading persistent store:', err);
  }
}

// Function to save memory store to data/store.json
function savePersistentStore() {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const obj = {};
    for (const [k, v] of inMemoryStore.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving persistent store to disk:', err);
  }
}

// Redis Client Setup (with file-backed persistent fallback)
let redis;
let isInMemory = false;
const rateLimitStores = [];

class ResilientRateLimitStore {
  constructor(prefix) {
    this.prefix = `pokedb:rate-limit:${prefix}:`;
    this.memoryStore = new MemoryStore();
    this.redisStore = null;
    rateLimitStores.push(this);
  }

  init(options) {
    this.options = options;
    this.memoryStore.init(options);
  }

  useRedis(client) {
    if (!this.options || this.redisStore) return;

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

  async increment(key) {
    if (this.redisStore) {
      try {
        return await this.redisStore.increment(key);
      } catch (err) {
        console.warn('Redis rate-limit increment failed; using in-memory limits.', err.message);
        this.useMemory();
      }
    }
    return this.memoryStore.increment(key);
  }

  async decrement(key) {
    if (this.redisStore) {
      try { return await this.redisStore.decrement(key); } catch (err) { this.useMemory(); }
    }
    return this.memoryStore.decrement(key);
  }

  async resetKey(key) {
    if (this.redisStore) {
      try { return await this.redisStore.resetKey(key); } catch (err) { this.useMemory(); }
    }
    return this.memoryStore.resetKey(key);
  }

  async get(key) {
    if (this.redisStore) {
      try { return await this.redisStore.get(key); } catch (err) { this.useMemory(); }
    }
    return this.memoryStore.get(key);
  }
}

const createRateLimitStore = (prefix) => new ResilientRateLimitStore(prefix);

function cleanupInMemoryStore() {
  const now = Date.now();
  let changed = false;

  for (const [key, value] of inMemoryStore.entries()) {
    if (key.endsWith(':clicks')) {
      const recordKey = key.slice(0, -':clicks'.length);
      if (!inMemoryStore.has(recordKey)) {
        inMemoryStore.delete(key);
        changed = true;
      }
      continue;
    }

    try {
      const record = JSON.parse(value);
      if (record.expiresAt && Date.parse(record.expiresAt) <= now) {
        inMemoryStore.delete(key);
        inMemoryStore.delete(`${key}:clicks`);
        changed = true;
      }
    } catch (err) {
      // Entries that are not JSON records have no expiration metadata to clean up.
    }
  }

  if (changed) savePersistentStore();
}

const cleanupTimer = setInterval(cleanupInMemoryStore, 60 * 60 * 1000);
cleanupTimer.unref();

if (process.env.NODE_ENV === 'test') {
  isInMemory = true;
  redis = {
    get: async (key) => inMemoryStore.get(key) || null,
    set: async (key, val, options = {}) => {
      if (options.nx && inMemoryStore.has(key)) return null;
      inMemoryStore.set(key, val);
      return 'OK';
    },
    incr: async (key) => {
      const value = Number(inMemoryStore.get(key) || 0) + 1;
      inMemoryStore.set(key, String(value));
      return value;
    },
    expire: async () => 1,
    ttl: async (key) => -1,
    quit: async () => {}
  };
} else {
  const redisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  };

  if (REDIS_URL.startsWith('rediss://')) {
    redisOptions.tls = { rejectUnauthorized: false };
  }

  redis = new Redis(REDIS_URL, redisOptions);
  const realRedis = redis;
  redis.on('error', (err) => {
    if (!isInMemory) {
      console.warn('Redis unavailable, switching to persistent file-backed store.');
      isInMemory = true;
    }
    rateLimitStores.forEach((store) => store.useMemory());
  });
  redis.on('ready', () => {
    rateLimitStores.forEach((store) => store.useRedis(realRedis));
    if (isInMemory) {
      console.info('Redis reconnected; resuming Redis-backed storage.');
      isInMemory = false;
    }
  });
  redis.connect().catch((err) => {
    isInMemory = true;
    console.error('Unable to connect to Redis:', err.message);
  });

  // Proxy object to seamlessly route to file-backed persistent store if Redis connection fails
  redis = {
    get: async (key) => {
      if (isInMemory) return inMemoryStore.get(key) || null;
      try { return await realRedis.get(key); } catch(e) { isInMemory = true; return inMemoryStore.get(key) || null; }
    },
    set: async (key, val, options = {}) => {
      if (isInMemory) {
        if (options.nx && inMemoryStore.has(key)) return null;
        inMemoryStore.set(key, val);
        savePersistentStore();
        return 'OK';
      }
      try {
        const setArgs = [];
        if (options.ex) setArgs.push('EX', String(options.ex));
        if (options.nx) setArgs.push('NX');
        return await realRedis.set(key, val, ...setArgs);
      } catch(e) {
        isInMemory = true;
        if (options.nx && inMemoryStore.has(key)) return null;
        inMemoryStore.set(key, val);
        savePersistentStore();
        return 'OK';
      }
    },
    incr: async (key) => {
      if (isInMemory) {
        const value = Number(inMemoryStore.get(key) || 0) + 1;
        inMemoryStore.set(key, String(value));
        savePersistentStore();
        return value;
      }
      try { return await realRedis.incr(key); } catch (e) {
        isInMemory = true;
        const value = Number(inMemoryStore.get(key) || 0) + 1;
        inMemoryStore.set(key, String(value));
        savePersistentStore();
        return value;
      }
    },
    expire: async (key, seconds) => {
      if (isInMemory) return 1;
      try { return await realRedis.expire(key, seconds); } catch (e) { isInMemory = true; return 0; }
    },
    ttl: async (key) => {
      if (isInMemory) return -1;
      try { return await realRedis.ttl(key); } catch(e) { return -1; }
    },
    quit: async () => {
      try { await realRedis.quit(); } catch(e) {}
    }
  };
}

const generateShortCode = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 6);

const RESERVED_BLOCKLIST = new Set([
  'api', 'tools', 'shared', 'favicon.ico', 'static', 'public',
  'shorten', 'health', 'index.html', 'stats', 'admin', 'dashboard',
  'v', 'drop', 'tinyurl', 'qr'
]);

const sharedRateLimitOptions = {
  standardHeaders: true,
  legacyHeaders: false
};

const apiLimiter = rateLimit({
  ...sharedRateLimitOptions,
  store: createRateLimitStore('api'),
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many API requests, please try again after 15 minutes.' }
});

const uploadLimiter = rateLimit({
  ...sharedRateLimitOptions,
  store: createRateLimitStore('upload'),
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many upload requests, please try again after 15 minutes.' }
});

const shortenLimiter = rateLimit({
  ...sharedRateLimitOptions,
  store: createRateLimitStore('shorten'),
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again after 15 minutes.' }
});

function parseExpiresInDays(value, defaultValue = 30) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'string' && value.trim() === '') return null;

  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 365) return null;
  return days;
}

function isValidTargetUrl(targetUrl, reqHost) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;
  const trimmed = targetUrl.trim();
  if (trimmed.length === 0) return false;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    if (reqHost && parsed.host === reqHost) return false;
    if (parsed.hostname === 'pokedb.site' || parsed.hostname === 'tools.pokedb.site') return false;

    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 1. STATIC ASSET & ROUTE SERVING
// ============================================================

// Shared Theme CSS/JS Assets (/tools/shared/* or /shared/*)
app.use('/tools/shared', express.static(path.join(__dirname, 'tools/shared')));
app.use('/shared', express.static(path.join(__dirname, 'tools/shared')));

// Pre-configured static handlers with built-in path traversal & dotfile security
const staticHandlers = {
  main: express.static(path.join(__dirname, 'public'), { index: ['index.html'] }),
  tools: express.static(path.join(__dirname, 'tools/public'), { index: ['index.html'] }),
  tinyurl: express.static(path.join(__dirname, 'tools/tinyurl/public'), { index: ['index.html'] }),
  qr: express.static(path.join(__dirname, 'tools/qr/public'), { index: ['index.html'] }),
  drop: express.static(path.join(__dirname, 'tools/drop/public'), { index: ['index.html'] }),
  health: express.static(path.join(__dirname, 'tools/health/public'), { index: ['index.html'] })
};

// Helper middleware to validate API host access per subdomain
const checkApiHost = (allowedHosts) => {
  return (req, res, next) => {
    const hosts = [resolveApiHost(req), resolveBrowserOriginHost(req)];

    if (hosts.some((host) => ['localhost', '127.0.0.1', '::1'].includes(host))) {
      return next();
    }
    if (hosts.some((host) => allowedHosts.includes(host))) {
      return next();
    }
    return res.status(404).json({ error: 'API endpoint not available on this subdomain' });
  };
};

// ============================================================
// DEDICATED HOST-BASED ROUTING MIDDLEWARE
// Uses resolveHost(req) to switch target subdomains with 100% path traversal & dotfile security
// Internal file serving only, NO 301/302 redirects.
// ============================================================
app.use((req, res, next) => {
  const host = resolveHost(req);

  // Allow API endpoints and health checks to pass through directly
  if (req.path.startsWith('/api/') || req.path === '/health') {
    return next();
  }

  const notFound = (customToolName) => {
    const isPrimaryHost = ['pokedb.site', 'www.pokedb.site', 'pokedb-site.onrender.com'].includes(host);
    const requestedTool = typeof customToolName === 'string' ? customToolName : host.split('.')[0];
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    if (!acceptsHtml) return res.status(404).send('Not Found');

    const safePath = htmlEscape(req.path);
    const safeRequestedTool = htmlEscape(requestedTool);

    const errMessage = isPrimaryHost
      ? `Error 404: Page '${safePath}' not found on pokedb.site.`
      : `Error 404: Subdomain '${safeRequestedTool}.pokedb.site' does not correspond to any active tool.`;

    const cmdMessage = isPrimaryHost
      ? `pokedb resolve --path "${safePath}"`
      : `pokedb resolve --subdomain "${safeRequestedTool}"`;

    return res.status(404).send(renderTemplate('404.html', {
      title: '404 — Not Found | pokedb.site',
      command: cmdMessage,
      message: errMessage,
      returnUrl: 'https://tools.pokedb.site/',
      returnLabel: '← Explore Tools Hub (tools.pokedb.site)'
    }));
  };

  switch (host) {
    case 'pokedb.site':
    case 'www.pokedb.site':
    case 'pokedb-site.onrender.com':
      return staticHandlers.main(req, res, notFound);

    case 'tools.pokedb.site':
      return staticHandlers.tools(req, res, notFound);

    case 'tinyurl.pokedb.site':
      return staticHandlers.tinyurl(req, res, next); // falls through to /:code resolver

    case 'qr.pokedb.site':
      return staticHandlers.qr(req, res, notFound);

    case 'drop.pokedb.site':
      if (req.path.startsWith('/v/') || req.path.startsWith('/view/')) {
        return res.sendFile(path.join(__dirname, 'tools/drop/public/view.html'));
      }
      return staticHandlers.drop(req, res, notFound);

    case 'health.pokedb.site':
      return staticHandlers.health(req, res, notFound);

    case 'localhost':
    case '127.0.0.1':
    case '::1':
      return next();

    default: {
      if (host.endsWith('.onrender.com')) {
        return staticHandlers.main(req, res, notFound);
      }
      if (!host.endsWith('.pokedb.site')) return notFound();
      const toolName = host.slice(0, -'.pokedb.site'.length);
      return notFound(toolName);
    }
  }
});

app.use('/api/', apiLimiter);

// Health check endpoints with DX telemetry
const getHealthStatus = () => {
  const uptime = Math.floor(process.uptime());
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;
  const uptimeFormatted = `${hours > 0 ? hours + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;

  return {
    status: 'healthy',
    uptimeSeconds: uptime,
    uptimeFormatted,
    memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    storeMode: isInMemory ? 'File-backed JSON Store' : 'Redis Cluster',
    recordsCount: inMemoryStore.size,
    nodeVersion: process.version,
    services: {
      api: 'operational',
      database: isInMemory ? 'file_fallback' : 'redis_active',
      tinyurl: 'operational',
      qr: 'operational',
      drop: 'operational'
    },
    timestamp: new Date().toISOString()
  };
};

app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json(getHealthStatus());
});

app.get('/api/health/ping', (req, res) => {
  res.status(200).json({ status: 'ok', pong: true, timestamp: Date.now() });
});

// ============================================================
// 2. API ENDPOINTS
// ============================================================

app.post('/api/shorten', shortenLimiter, checkApiHost(['tinyurl.pokedb.site']), async (req, res) => {
  try {
    const { url, customAlias, expiresInDays } = req.body;

    if (!isValidTargetUrl(url, req.get('host'))) {
      return res.status(400).json({ error: 'Invalid URL. Only http:// and https:// URLs are supported.' });
    }

    let code;
    if (customAlias && typeof customAlias === 'string' && customAlias.trim() !== '') {
      const alias = customAlias.trim();

      if (RESERVED_BLOCKLIST.has(alias.toLowerCase())) {
        return res.status(400).json({ error: 'This custom alias is reserved.' });
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(alias) || alias.length > 30) {
        return res.status(400).json({ error: 'Custom alias must be alphanumeric, hyphens or underscores only (max 30 characters).' });
      }

      code = alias;
    } else {
      do {
        code = generateShortCode();
      } while (RESERVED_BLOCKLIST.has(code.toLowerCase()));
    }

    const redisKey = `url:${code}`;
    const now = new Date().toISOString();
    const days = parseExpiresInDays(expiresInDays);
    if (days === null) {
      return res.status(400).json({ error: 'expiresInDays must be an integer between 0 and 365.' });
    }
    let expiresAt = null;
    let ttlSeconds = null;

    if (days > 0) {
      ttlSeconds = Math.floor(days * 86400);
      expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    }

    const payload = JSON.stringify({
      longUrl: url.trim(),
      createdAt: now,
      clicks: 0,
      expiresAt: expiresAt
    });

    let result;
    if (ttlSeconds) {
      result = await redis.set(redisKey, payload, { nx: true, ex: ttlSeconds });
    } else {
      result = await redis.set(redisKey, payload, { nx: true });
    }

    if (!result) {
      const suggestions = [];
      for (let suffixNumber = 2; suffixNumber <= 50 && suggestions.length < 3; suffixNumber += 1) {
        const suffix = `-${suffixNumber}`;
        const candidate = `${code.slice(0, 30 - suffix.length)}${suffix}`;
        if (!RESERVED_BLOCKLIST.has(candidate.toLowerCase()) && !(await redis.get(`url:${candidate}`))) {
          suggestions.push(candidate);
        }
      }
      return res.status(409).json({ error: 'Alias is already taken.', suggestions });
    }

    await redis.set(`${redisKey}:clicks`, '0', ttlSeconds ? { ex: ttlSeconds } : {});

    const shortUrl = `${getBaseUrl(req)}/${code}`;
    return res.status(200).json({ code, shortUrl, longUrl: url.trim(), expiresAt });
  } catch (err) {
    console.error('Error shortening URL:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Dedicated QR Code Generation API (POST & GET /api/qr)
const handleQrGeneration = async (req, res) => {
  try {
    const text = req.body?.text || req.query?.text || 'https://pokedb.site';
    const format = req.body?.format || req.query?.format || 'json';
    const dark = req.body?.dark || req.query?.dark || '#000000';
    const light = req.body?.light || req.query?.light || '#ffffff';

    const options = {
      // A generous quiet zone and high error correction are essential when the
      // image is printed, resized, or has a centred logo overlay.
      margin: 4,
      errorCorrectionLevel: 'H',
      color: {
        dark: dark,
        light: light === 'transparent' ? '#ffffff00' : light
      }
    };

    if (format === 'svg') {
      const svg = await QRCodeServer.toString(text, { ...options, type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', 'attachment; filename="qrcode.svg"');
      }
      return res.send(svg);
    }

    const dataUrl = await QRCodeServer.toDataURL(text, { ...options, width: 512 });

    if (format === 'png') {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', 'attachment; filename="qrcode.png"');
      }
      return res.send(imgBuffer);
    }

    return res.json({ text, dataUrl });
  } catch (err) {
    console.error('Error generating QR:', err);
    return res.status(400).json({ error: 'Failed to generate QR code' });
  }
};

// QR output contains no account data and is deliberately shared by TinyURL,
// QR Studio, and Drop. Keeping it host-neutral prevents reverse-proxy host
// rewrites from intermittently breaking <img> previews and exports.
app.get('/api/qr', handleQrGeneration);
app.post('/api/qr', handleQrGeneration);

// Enforce subdomain access control on all /api/drop endpoints
// Drop endpoints are protected by per-upload deletion tokens and the admin
// token where applicable. Do not couple media playback or uploads to a proxy
// host header, which can vary between Render edge requests.

// ============================================================
// DROP FILE STORAGE TOOL API (/api/drop)
// ============================================================
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const uploadMulter = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, callback) => callback(null, `${nanoid()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 * 1024 } // 25 GB limit supported by Rootz
});

const SERVER_ROOTZ_KEY = process.env.ROOTZ_API_KEY || CONFIG.ROOTZ_API_KEY || '';
const LARGE_FILE_PASSWORD = process.env.LARGE_FILE_PASSWORD || CONFIG.LARGE_FILE_PASSWORD || null;
const configuredRootzTimeout = Number.parseInt(process.env.ROOTZ_TIMEOUT_MS || '1200000', 10);
const ROOTZ_TIMEOUT_MS = Number.isFinite(configuredRootzTimeout) && configuredRootzTimeout > 0
  ? Math.min(configuredRootzTimeout, 3600000)
  : 1200000;
const ONE_GB = 1073741824; // 1 GB limit in bytes

app.get('/api/drop/status', (req, res) => {
  const defaultFolder = process.env.ROOTZ_FOLDER_ID || CONFIG.ROOTZ_FOLDER_ID || process.env.ROOTZ_FOLDER_NAME || CONFIG.ROOTZ_FOLDER_NAME || '';
  return res.status(200).json({
    storageConfigured: Boolean(SERVER_ROOTZ_KEY),
    defaultFolderConfigured: Boolean(defaultFolder)
  });
});

const verifyLargeFilePassword = (req, fileSize) => {
  if (!fileSize || fileSize <= ONE_GB) return true;
  if (!LARGE_FILE_PASSWORD) return false;
  const provided = req.headers['x-upload-password'] || req.body?.password;
  return tokensMatch(provided, LARGE_FILE_PASSWORD);
};

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function ipv6Groups(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const parts = normalized.split('::');
  const expandPart = (part) => part ? part.split(':').filter(Boolean) : [];
  let left = expandPart(parts[0]);
  let right = expandPart(parts[1]);

  const convertEmbeddedIpv4 = (groups) => {
    const last = groups.at(-1);
    if (!last || !last.includes('.')) return groups;
    const octets = last.split('.').map(Number);
    return [...groups.slice(0, -1), ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16)];
  };

  left = convertEmbeddedIpv4(left);
  right = convertEmbeddedIpv4(right);
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(Math.max(0, missing)).fill('0'), ...right].map((group) => Number.parseInt(group, 16));
}

function isPrivateIpAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;

  const groups = ipv6Groups(address);
  if (groups.length !== 8 || groups.some(Number.isNaN)) return true;
  const isAllZero = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const isCompatibleIpv4 = groups.slice(0, 6).every((group) => group === 0);

  if (isMappedIpv4 || isCompatibleIpv4) {
    const ipv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isPrivateIpv4(ipv4);
  }

  return isAllZero || isLoopback || (groups[0] & 0xfe00) === 0xfc00 ||
    (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xff00) === 0xff00;
}

const isPrivateHost = async (host) => {
  if (!host) return true;
  const hostname = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') return true;
  if (net.isIP(hostname)) return isPrivateIpAddress(hostname);

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses.length === 0 || addresses.some(({ address }) => isPrivateIpAddress(address));
  } catch (err) {
    return true;
  }
};

const isValidRemoteUrl = async (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !(await isPrivateHost(parsed.hostname));
  } catch (err) {
    return false;
  }
};

// 1. Direct File Upload Endpoint (100% Proxied to Rootz API)
app.post('/api/drop/upload', uploadLimiter, uploadMulter.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided in upload request.' });
    }

    if (!SERVER_ROOTZ_KEY) {
      return res.status(503).json({ error: 'File storage is not configured. Set ROOTZ_API_KEY on the server and try again.' });
    }

    // Password verification for files > 1 GB
    if (req.file.size > ONE_GB && !verifyLargeFilePassword(req, req.file.size)) {
      return res.status(401).json({ error: 'Invalid or missing owner password for files over 1 GB.' });
    }

    const expDays = parseExpiresInDays(req.body.expiresInDays);
    if (expDays === null) {
      return res.status(400).json({ error: 'expiresInDays must be an integer between 0 and 365.' });
    }

    // Build multipart FormData for Rootz API from the temporary staged file.
    const formData = new FormData();
    const fileBlob = await fs.openAsBlob(req.file.path, { type: req.file.mimetype || 'application/octet-stream' });
    formData.append('file', fileBlob, req.file.originalname);
    formData.append('expiresInDays', String(expDays));

    const targetFolder = req.body.folderId || process.env.ROOTZ_FOLDER_ID || CONFIG.ROOTZ_FOLDER_ID || process.env.ROOTZ_FOLDER_NAME || CONFIG.ROOTZ_FOLDER_NAME || 'pokedb.site';
    if (targetFolder) {
      formData.append('folderId', String(targetFolder));
      formData.append('folder_id', String(targetFolder));
      formData.append('folder_name', String(targetFolder));
      formData.append('folder', String(targetFolder));
    }

    const headers = {};
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    const rootzRes = await fetch('https://rootz.so/api/files/upload', {
      method: 'POST',
      headers: headers,
      body: formData,
      signal: AbortSignal.timeout(ROOTZ_TIMEOUT_MS)
    });

    let rootzData;
    try {
      rootzData = await rootzRes.json();
    } catch (jsonErr) {
      return res.status(502).json({ error: 'Rootz returned an invalid upload response.' });
    }

    if (!rootzRes.ok) {
      return res.status(rootzRes.status).json({
        error: rootzData?.error || rootzData?.message || 'Rootz rejected the upload request.',
        providerStatus: rootzRes.status
      });
    }

    // Return unified file metadata
    const resultObj = rootzData.data || rootzData.result || rootzData;
    const fileCode = resultObj.short_id || resultObj.shortId || resultObj.filecode || resultObj.file_code || resultObj.id || nanoid();

    const dropRecord = {
      id: fileCode,
      name: resultObj.name || req.file.originalname,
      size: resultObj.size || req.file.size,
      mimeType: req.file.mimetype,
      downloads: 0,
      createdAt: new Date().toISOString(),
      expiresAt: resultObj.expires_at || resultObj.expiresAt || null,
      relativePath: req.body.relativePath || req.file.originalname,
      deletionToken: nanoid(32)
    };

    inMemoryStore.set(`drop:${fileCode}`, JSON.stringify(dropRecord));
    savePersistentStore();

    return res.status(200).json({
      success: true,
      id: fileCode,
      shortId: fileCode,
      name: dropRecord.name,
      size: dropRecord.size,
      mimeType: dropRecord.mimeType,
      url: `https://rootz.so/d/${fileCode}`,
      viewUrl: `${getBaseUrl(req)}/v/${fileCode}`,
      expiresAt: dropRecord.expiresAt,
      provider: 'rootz',
      createdAt: dropRecord.createdAt,
      relativePath: dropRecord.relativePath,
      deletionToken: dropRecord.deletionToken
    });
  } catch (err) {
    console.error('Error proxying direct upload to Rootz:', err);
    const timedOut = err?.name === 'TimeoutError';
    return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'The storage provider timed out while receiving the file. Please retry.' : 'The storage provider could not process this upload. Please retry.' });
  } finally {
    if (req.file?.path) {
      await fs.promises.unlink(req.file.path).catch((err) => {
        if (err.code !== 'ENOENT') console.error('Failed to remove temporary upload:', err);
      });
    }
  }
});

// 2. Remote URL Upload Endpoint (Proxied securely to Rootz API)
app.post('/api/drop/remote-upload', uploadLimiter, async (req, res) => {
  try {
    const { url, folderId, fileSize } = req.body;

    if (!url || typeof url !== 'string' || !(await isValidRemoteUrl(url))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or unsafe remote URL provided. Only public HTTP/HTTPS URLs are allowed.'
      });
    }

    if (!SERVER_ROOTZ_KEY) {
      return res.status(503).json({ success: false, error: 'Remote storage is not configured. Set ROOTZ_API_KEY on the server and try again.' });
    }

    if (fileSize && Number(fileSize) > ONE_GB && !verifyLargeFilePassword(req, Number(fileSize))) {
      return res.status(401).json({ success: false, error: 'Invalid or missing owner password for files over 1 GB.' });
    }

    const headers = { 'Content-Type': 'application/json' };
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    const targetFolder = folderId || process.env.ROOTZ_FOLDER_ID || CONFIG.ROOTZ_FOLDER_ID || process.env.ROOTZ_FOLDER_NAME || CONFIG.ROOTZ_FOLDER_NAME || 'pokedb.site';

    const rootzRes = await fetch('https://rootz.so/api/files/remote-upload', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        url: url.trim(),
        folderId: targetFolder ? String(targetFolder).trim() : null,
        folder_id: targetFolder ? String(targetFolder).trim() : null,
        folder_name: targetFolder ? String(targetFolder).trim() : null,
        folder: targetFolder ? String(targetFolder).trim() : null
      }),
      signal: AbortSignal.timeout(ROOTZ_TIMEOUT_MS)
    });

    const rootzData = await rootzRes.json();
    if (!rootzRes.ok) {
      return res.status(rootzRes.status).json({
        success: false,
        error: rootzData?.error || rootzData?.message || 'Rootz rejected the remote upload request.',
        providerStatus: rootzRes.status
      });
    }

    if (rootzData && rootzData.data) {
      const resultObj = rootzData.data;
      const fileCode = resultObj.short_id || resultObj.shortId || resultObj.filecode || resultObj.id;
      if (fileCode) {
        const dropRecord = {
          id: fileCode,
          name: resultObj.name || 'Remote File',
          size: resultObj.size || 0,
          mimeType: resultObj.mime_type || '',
          downloads: 0,
          createdAt: new Date().toISOString(),
          expiresAt: resultObj.expires_at || null,
          deletionToken: nanoid(32)
        };
        inMemoryStore.set(`drop:${fileCode}`, JSON.stringify(dropRecord));
        savePersistentStore();
        rootzData.data.deletionToken = dropRecord.deletionToken;
      }
      rootzData.data.provider = 'rootz';
    }

    return res.status(200).json(rootzData);
  } catch (err) {
    console.error('Error proxying remote upload to Rootz:', err);
    const timedOut = err?.name === 'TimeoutError';
    return res.status(timedOut ? 504 : 502).json({ success: false, error: timedOut ? 'The storage provider timed out while fetching that URL. Please retry.' : 'The storage provider could not process the remote upload. Please retry.' });
  }
});

// 3. Delete File Endpoint (Rootz API & Local)
app.delete('/api/drop/delete', async (req, res) => {
  try {
    const fileId = req.query.fileId || req.body?.fileId;
    const token = req.query.token || req.body?.token;

    if (!fileId) {
      return res.status(400).json({ success: false, error: 'File ID is required for deletion.' });
    }

    const storedDropRecord = inMemoryStore.get(`drop:${fileId}`);
    if (!storedDropRecord) {
      return res.status(403).json({ success: false, error: 'Deletion requires an active upload record and its deletion token.' });
    }

    let dropRecord;
    try {
      dropRecord = JSON.parse(storedDropRecord);
    } catch (err) {
      return res.status(403).json({ success: false, error: 'Deletion token is unavailable for this upload.' });
    }

    if (!dropRecord.deletionToken) {
      return res.status(403).json({ success: false, error: 'This upload predates deletion-token protection and cannot be deleted through this endpoint.' });
    }

    if (!tokensMatch(token, dropRecord.deletionToken)) {
      return res.status(403).json({ success: false, error: 'A valid deletion token is required.' });
    }

    inMemoryStore.delete(`drop:${fileId}`);
    savePersistentStore();

    let rootzUrl = `https://rootz.so/api/files/delete?fileId=${encodeURIComponent(fileId)}`;
    if (token) {
      rootzUrl += `&token=${encodeURIComponent(token)}`;
    }

    const headers = {};
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    const rootzRes = await fetch(rootzUrl, {
      method: 'DELETE',
      headers: headers
    });

    const rootzData = await rootzRes.json();
    return res.status(rootzRes.status).json(rootzData);
  } catch (err) {
    console.error('Error deleting file:', err);
    return res.status(500).json({ success: false, error: 'Internal server error deleting file.' });
  }
});

// 4. List Account Files & Folders Endpoint (Rootz API)
app.get('/api/drop/list', async (req, res) => {
  try {
    const adminToken = process.env.ADMIN_TOKEN || CONFIG.ADMIN_TOKEN;
    const providedToken = req.get('x-admin-token') || req.query.token;

    if (!adminToken) {
      return res.status(503).json({ success: false, error: 'File listing is unavailable until ADMIN_TOKEN is configured.' });
    }

    if (!tokensMatch(providedToken, adminToken)) {
      return res.status(403).json({ success: false, error: 'A valid admin token is required to list files.' });
    }

    const page = req.query.page || 1;
    const limit = req.query.limit || 50;
    const folderId = req.query.folderId || '';

    let url = `https://rootz.so/api/files/list?page=${page}&limit=${limit}`;
    if (folderId) {
      url += `&folderId=${encodeURIComponent(folderId)}`;
    }

    const headers = {};
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    const rootzRes = await fetch(url, { headers });
    const rootzData = await rootzRes.json();
    return res.status(rootzRes.status).json(rootzData);
  } catch (err) {
    console.error('Error listing files from Rootz:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve file list from Rootz.' });
  }
});

// 5. Get File Info & Telemetry Endpoint (Local Store Cache + Rootz API Proxy)
app.get('/api/drop/info', async (req, res) => {
  try {
    const fileCode = req.query.file_code;
    if (!fileCode) {
      return res.status(400).json({ msg: 'Bad Request', status: 400, error: 'file_code is required' });
    }

    // First check persistent local store cache
    const localData = await redis.get(`drop:${fileCode}`);
    if (localData) {
      const rec = JSON.parse(localData);
      return res.status(200).json({
        msg: 'OK',
        status: 200,
        result: [{
          status: 200,
          filecode: fileCode,
          name: rec.name,
          size: String(rec.size),
          mimeType: rec.mimeType,
          uploaded: rec.createdAt,
          download: String(rec.downloads || 0),
          expiresAt: rec.expiresAt,
          status_field: 'active'
        }]
      });
    }

    let url = `https://rootz.so/api/files/info?file_code=${encodeURIComponent(fileCode)}`;
    const headers = {};
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    const rootzRes = await fetch(url, { headers });
    const rootzData = await rootzRes.json();
    return res.status(rootzRes.status).json(rootzData);
  } catch (err) {
    console.error('Error getting file info from Rootz:', err);
    return res.status(500).json({ msg: 'Server Error', status: 500 });
  }
});

// 6. Direct Rootz Raw Binary File & Stream Proxy (Handles JSON URLs, Redirects, & Binary Streams)
app.get(['/api/drop/file/:filename', '/api/drop/stream/:filename'], async (req, res) => {
  try {
    const fileCode = req.params.filename;
    const rootzUrl = `https://rootz.so/api/files/retrieve?file_code=${encodeURIComponent(fileCode)}`;

    const headers = {};
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const rootzRes = await fetch(rootzUrl, { headers, redirect: 'manual' });

    // Handle HTTP Redirects from Rootz API
    if ([301, 302, 303, 307, 308].includes(rootzRes.status)) {
      const loc = rootzRes.headers.get('location');
      if (loc) {
        return res.redirect(302, loc);
      }
    }

    if (!rootzRes.ok) {
      return res.redirect(302, `https://rootz.so/d/${encodeURIComponent(fileCode)}`);
    }

    const contentType = (rootzRes.headers.get('content-type') || '').toLowerCase();

    // If Rootz API returned JSON containing the direct CDN URL
    if (contentType.includes('application/json')) {
      const json = await rootzRes.json();
      const directUrl = json.url || json.download_url || json.direct_url || (json.data && (json.data.url || json.data.download_url)) || `https://rootz.so/d/${encodeURIComponent(fileCode)}`;
      return res.redirect(302, directUrl);
    }

    // Direct binary media stream
    res.status(rootzRes.status);
    const passthroughHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];

    for (const key of passthroughHeaders) {
      const val = rootzRes.headers.get(key);
      if (val) res.setHeader(key, val);
    }

    if (!res.getHeader('accept-ranges')) {
      res.setHeader('accept-ranges', 'bytes');
    }

    if (!rootzRes.body) {
      return res.status(502).json({ error: 'Rootz returned an empty download stream.' });
    }

    const stream = Readable.fromWeb(rootzRes.body);
    stream.on('error', (err) => {
      console.error('Error streaming Rootz file response:', err);
      if (!res.headersSent) res.status(502).end();
      else res.destroy(err);
    });
    stream.pipe(res);
    return undefined;
  } catch (err) {
    console.error('Error streaming file from Rootz:', err);
    return res.redirect(302, `https://rootz.so/d/${encodeURIComponent(req.params.filename)}`);
  }
});

app.get('/api/stats/:code', checkApiHost(['tinyurl.pokedb.site']), async (req, res) => {
  try {
    const code = req.params.code;
    const redisKey = `url:${code}`;
    const dataStr = await redis.get(redisKey);

    if (!dataStr) {
      return res.status(404).json({ error: 'Short URL not found or expired.' });
    }

    const record = JSON.parse(dataStr);
    const clickCount = await redis.get(`${redisKey}:clicks`);
    return res.status(200).json({
      code: code,
      longUrl: record.longUrl,
      clicks: Number(clickCount ?? record.clicks ?? 0),
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 3. GET /:code — Catch-all Short Link Redirect (Registered LAST)
// ============================================================
app.get('/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const safeCode = htmlEscape(code);

    if (RESERVED_BLOCKLIST.has(code.toLowerCase())) {
      return res.status(404).send('Not Found');
    }

    const redisKey = `url:${code}`;
    const dataStr = await redis.get(redisKey);

    if (!dataStr) {
      return res.status(404).send(renderTemplate('404.html', {
        title: '404 — Short Link Not Found',
        command: `get /${safeCode}`,
        message: 'Error 404: Link not found or expired.',
        returnUrl: '/tools/shorten/',
        returnLabel: '← Return to Shortener'
      }));
    }

    const record = JSON.parse(dataStr);
    const clickCount = await redis.incr(`${redisKey}:clicks`);

    // Direct redirect if explicitly requested via query parameter, non-browser request, or test mode
    const isDirect = req.query.direct === '1' || req.query.direct === 'true';
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    const isTest = process.env.NODE_ENV === 'test';

    if (isDirect || isTest || !acceptsHtml) {
      return res.redirect(302, record.longUrl);
    }

    // Serve Intermediary Redirect Landing Page with 5s countdown
    const safeUrl = htmlEscape(record.longUrl);
    return res.status(200).send(renderTemplate('redirect.html', {
      safeUrl,
      safeCode,
      clickCount: String(clickCount),
      nonce: res.locals.cspNonce,
      serializedUrl: serializeForInlineScript(record.longUrl)
    }));
  } catch (err) {
    console.error('Error redirecting:', err);
    return res.status(500).send('Server Error');
  }
});

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
    console.log(`Main Portfolio: http://localhost:${PORT}/`);
    console.log(`TinyURL Tool:   http://localhost:${PORT}/tools/tinyurl/`);
    console.log(`QR Studio Tool: http://localhost:${PORT}/tools/qr/`);
    console.log(`Healthcheck:    http://localhost:${PORT}/health`);
  });

  const gracefulShutdown = (signal) => {
    console.log(`\nReceived ${signal}. Flushing store and shutting down server...`);
    savePersistentStore();
    server.close(() => {
      console.log('Server closed successfully.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

module.exports = app;
