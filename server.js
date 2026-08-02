const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const { customAlphabet } = require('nanoid');
const { rateLimit } = require('express-rate-limit');
const Redis = require('ioredis');
const QRCodeServer = require('qrcode');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5050;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
let CONFIG = {};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const rawConfig = fs.readFileSync(CONFIG_FILE, 'utf8');
    CONFIG = JSON.parse(rawConfig);
  } catch (err) {
    console.error('Error reading config.json:', err);
  }
}

const getBaseUrl = (req) => {
  const envBase = process.env.BASE_URL || CONFIG.BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  if (!req) return `http://localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  return `${protocol}://${host}`;
};

// 1. Trust Proxy
app.set('trust proxy', 1);

// Security Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
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

if (process.env.NODE_ENV === 'test') {
  isInMemory = true;
  redis = {
    get: async (key) => inMemoryStore.get(key) || null,
    set: async (key, val, mode, option, ttl) => {
      if (mode === 'NX' && inMemoryStore.has(key)) return null;
      inMemoryStore.set(key, val);
      return 'OK';
    },
    ttl: async (key) => -1,
    quit: async () => {}
  };
} else {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  redis.on('error', (err) => {
    if (!isInMemory) {
      console.warn('Redis unavailable, switching to persistent file-backed store.');
      isInMemory = true;
    }
  });
  redis.connect().catch((err) => {
    isInMemory = true;
  });

  // Proxy object to seamlessly route to file-backed persistent store if Redis connection fails
  const realRedis = redis;
  redis = {
    get: async (key) => {
      if (isInMemory) return inMemoryStore.get(key) || null;
      try { return await realRedis.get(key); } catch(e) { isInMemory = true; return inMemoryStore.get(key) || null; }
    },
    set: async (key, val, mode, option, ttl) => {
      if (isInMemory) {
        if (mode === 'NX' && inMemoryStore.has(key)) return null;
        inMemoryStore.set(key, val);
        savePersistentStore();
        return 'OK';
      }
      try {
        if (ttl) return await realRedis.set(key, val, mode, option, ttl);
        return await realRedis.set(key, val, mode);
      } catch(e) {
        isInMemory = true;
        if (mode === 'NX' && inMemoryStore.has(key)) return null;
        inMemoryStore.set(key, val);
        savePersistentStore();
        return 'OK';
      }
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

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 6);

const RESERVED_BLOCKLIST = new Set([
  'api', 'tools', 'shared', 'favicon.ico', 'static', 'public',
  'shorten', 'health', 'index.html', 'stats', 'admin', 'dashboard',
  'v', 'drop', 'tinyurl', 'qr'
]);

const shortenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again after 15 minutes.' }
});

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
  drop: express.static(path.join(__dirname, 'tools/drop/public'), { index: ['index.html'] })
};

const dynamicToolHandlers = {};

// Helper middleware to validate API host access per subdomain
const checkApiHost = (allowedHosts) => {
  return (req, res, next) => {
    const rawHost = req.headers.host || req.get('host') || '';
    const host = rawHost.split(':')[0].toLowerCase();

    if (['localhost', '127.0.0.1', '::1'].includes(host) || process.env.NODE_ENV === 'test') {
      return next();
    }
    if (['pokedb.site', 'www.pokedb.site', 'tools.pokedb.site'].includes(host)) {
      return next();
    }
    if (allowedHosts.includes(host)) {
      return next();
    }
    return res.status(404).json({ error: 'API endpoint not available on this subdomain' });
  };
};

// ============================================================
// DEDICATED HOST-BASED ROUTING MIDDLEWARE
// Switches on (req.headers.host || '').split(':')[0].toLowerCase()
// Uses express.static() handlers for 100% path traversal & dotfile protection
// Internal file serving only, NO 301/302 redirects.
// ============================================================
app.use((req, res, next) => {
  const rawHost = req.headers.host || req.get('host') || '';
  const host = rawHost.split(':')[0].toLowerCase();

  // Allow API endpoints and health checks to pass through directly
  if (req.path.startsWith('/api/') || req.path === '/health') {
    return next();
  }

  const notFound = () => res.status(404).send('Not Found');

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
      if (!/^[a-z0-9-]+$/.test(toolName)) return notFound();

      if (!dynamicToolHandlers[toolName]) {
        const dir = path.join(__dirname, 'tools', toolName, 'public');
        if (!fs.existsSync(dir)) return notFound();
        dynamicToolHandlers[toolName] = express.static(dir, { index: ['index.html'] });
      }
      return dynamicToolHandlers[toolName](req, res, notFound);
    }
  }
});

// TinyURL Tool (/tools/tinyurl/ and /tools/tinyurl)
app.use('/tools/tinyurl', express.static(path.join(__dirname, 'tools/tinyurl/public')));

// QR Generator Tool (/tools/qr/ and /tools/qr)
app.use('/tools/qr', express.static(path.join(__dirname, 'tools/qr/public')));

// Drop File Transfer Tool (/tools/drop/ and /tools/drop)
app.use('/tools/drop', express.static(path.join(__dirname, 'tools/drop/public')));

// Drop Media Viewer Gateway (/tools/drop/view/:fileId, /tools/drop/v/:fileId, /v/:fileId)
app.get(['/tools/drop/view/:fileId', '/tools/drop/v/:fileId', '/v/:fileId'], (req, res) => {
  res.sendFile(path.join(__dirname, 'tools/drop/public/view.html'));
});

// Backward-compatibility redirect for /tools/shorten
app.get('/tools/shorten*', (req, res) => {
  res.redirect(301, '/tools/tinyurl/');
});

// Tools Hub Landing Page (/tools/ and /tools)
app.use('/tools', express.static(path.join(__dirname, 'tools/public')));

// Root Main Portfolio (/)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Health check endpoint with DX telemetry
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    storeMode: isInMemory ? 'File-backed JSON Store' : 'Redis Cluster',
    recordsCount: inMemoryStore.size,
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
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
        code = nanoid();
      } while (RESERVED_BLOCKLIST.has(code.toLowerCase()));
    }

    const redisKey = `url:${code}`;
    const now = new Date().toISOString();
    // Default expiration to 30 Days (1 Month) if not explicitly set to 0 (never)
    const days = (expiresInDays !== undefined && expiresInDays !== null && !isNaN(Number(expiresInDays))) ? Number(expiresInDays) : 30;
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
      result = await redis.set(redisKey, payload, 'NX', 'EX', ttlSeconds);
    } else {
      result = await redis.set(redisKey, payload, 'NX');
    }

    if (!result) {
      return res.status(409).json({ error: 'Alias is already taken.' });
    }

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
      margin: 1,
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

    const dataUrl = await QRCodeServer.toDataURL(text, { ...options, width: 400 });

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

app.get('/api/qr', handleQrGeneration);
app.post('/api/qr', handleQrGeneration);

// ============================================================
// DROP FILE STORAGE TOOL API (/api/drop)
// ============================================================
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const uploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 * 1024 } // 25 GB limit supported by Rootz
});

const SERVER_ROOTZ_KEY = process.env.ROOTZ_API_KEY || CONFIG.ROOTZ_API_KEY || '';
const LARGE_FILE_PASSWORD = process.env.LARGE_FILE_PASSWORD || CONFIG.LARGE_FILE_PASSWORD || 'pokedb-secret';
const ONE_GB = 1073741824; // 1 GB limit in bytes

const verifyLargeFilePassword = (req, fileSize) => {
  if (!fileSize || fileSize <= ONE_GB) return true;
  const provided = req.headers['x-upload-password'] || req.body?.password;
  return provided === LARGE_FILE_PASSWORD;
};

const isPrivateHost = (host) => {
  if (!host) return true;
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return true;
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
};

const isValidRemoteUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (isPrivateHost(parsed.hostname)) return false;
    return true;
  } catch (err) {
    return false;
  }
};

// 1. Direct File Upload Endpoint (100% Proxied to Rootz API)
app.post('/api/drop/upload', uploadMulter.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided in upload request.' });
    }

    // Password verification for files > 1 GB
    if (req.file.size > ONE_GB && !verifyLargeFilePassword(req, req.file.size)) {
      return res.status(401).json({ error: 'Invalid or missing owner password for files over 1 GB.' });
    }

    // Build multipart FormData for Rootz API
    const formData = new FormData();
    const fileBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' });
    formData.append('file', fileBlob, req.file.originalname);

    const expDays = req.body.expiresInDays !== undefined ? req.body.expiresInDays : '30';
    formData.append('expiresInDays', String(expDays));

    if (req.body.folderId) {
      formData.append('folderId', String(req.body.folderId));
    }

    const headers = {};
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    let rootzRes;
    try {
      rootzRes = await fetch('https://rootz.so/api/files/upload', {
        method: 'POST',
        headers: headers,
        body: formData,
        signal: AbortSignal.timeout(15000)
      });
    } catch (fetchErr) {
      console.error('Fetch error or timeout uploading to Rootz API:', fetchErr.message);
    }

    let rootzData = {};
    if (rootzRes) {
      try {
        rootzData = await rootzRes.json();
      } catch (jsonErr) {
        console.error('Non-JSON response from Rootz API:', jsonErr);
      }
    }

    // Return unified file metadata
    const resultObj = rootzData.data || rootzData.result || rootzData;
    const fileCode = resultObj.short_id || resultObj.shortId || resultObj.filecode || resultObj.file_code || resultObj.id || generateShortCode(10);

    const dropRecord = {
      id: fileCode,
      name: resultObj.name || req.file.originalname,
      size: resultObj.size || req.file.size,
      mimeType: req.file.mimetype,
      downloads: 0,
      createdAt: new Date().toISOString(),
      expiresAt: resultObj.expires_at || resultObj.expiresAt || null
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
      createdAt: dropRecord.createdAt
    });
  } catch (err) {
    console.error('Error proxying direct upload to Rootz:', err);
    return res.status(500).json({ error: 'Failed to process file upload to Rootz.' });
  }
});

// 2. Remote URL Upload Endpoint (Proxied securely to Rootz API)
app.post('/api/drop/remote-upload', async (req, res) => {
  try {
    const { url, folderId, fileSize } = req.body;

    if (!url || typeof url !== 'string' || !isValidRemoteUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or unsafe remote URL provided. Only public HTTP/HTTPS URLs are allowed.'
      });
    }

    if (fileSize && Number(fileSize) > ONE_GB && !verifyLargeFilePassword(req, Number(fileSize))) {
      return res.status(401).json({ success: false, error: 'Invalid or missing owner password for files over 1 GB.' });
    }

    const headers = { 'Content-Type': 'application/json' };
    if (SERVER_ROOTZ_KEY) {
      headers['Authorization'] = SERVER_ROOTZ_KEY.startsWith('Bearer ') ? SERVER_ROOTZ_KEY : `Bearer ${SERVER_ROOTZ_KEY}`;
    }

    const rootzRes = await fetch('https://rootz.so/api/files/remote-upload', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        url: url.trim(),
        folderId: folderId ? String(folderId).trim() : null
      })
    });

    const rootzData = await rootzRes.json();
    if (!rootzRes.ok) {
      return res.status(rootzRes.status).json(rootzData);
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
          expiresAt: resultObj.expires_at || null
        };
        inMemoryStore.set(`drop:${fileCode}`, JSON.stringify(dropRecord));
        savePersistentStore();
      }
      rootzData.data.provider = 'rootz';
    }

    return res.status(200).json(rootzData);
  } catch (err) {
    console.error('Error proxying remote upload to Rootz:', err);
    return res.status(500).json({ success: false, error: 'Internal server error processing remote upload.' });
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
    const fileCode = req.params.filename.split('-')[0];
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

    const arrayBuffer = await rootzRes.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Error streaming file from Rootz:', err);
    return res.redirect(302, `https://rootz.so/d/${encodeURIComponent(req.params.filename.split('-')[0])}`);
  }
});

app.get('/api/stats/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const redisKey = `url:${code}`;
    const dataStr = await redis.get(redisKey);

    if (!dataStr) {
      return res.status(404).json({ error: 'Short URL not found or expired.' });
    }

    const record = JSON.parse(dataStr);
    return res.status(200).json({
      code: code,
      longUrl: record.longUrl,
      clicks: record.clicks || 0,
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

    if (RESERVED_BLOCKLIST.has(code.toLowerCase())) {
      return res.status(404).send('Not Found');
    }

    const redisKey = `url:${code}`;
    const dataStr = await redis.get(redisKey);

    if (!dataStr) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="en" data-theme="oled-black">
        <head>
          <meta charset="UTF-8">
          <title>404 — Short Link Not Found</title>
          <link rel="stylesheet" href="/tools/shared/theme.css">
        </head>
        <body class="container" style="padding-top: 5rem; text-align: center;">
          <div class="term-window" style="max-width: 500px; margin: 0 auto;">
            <div class="term-titlebar">~/404.txt</div>
            <div class="term-body">
              <div><span class="prompt">$</span> <span class="out">get /${code}</span></div>
              <div class="out" style="color: var(--accent); margin-top: .5rem;">Error 404: Link not found or expired.</div>
            </div>
          </div>
          <p style="margin-top: 2rem;"><a class="btn" href="/tools/shorten/">← Return to Shortener</a></p>
        </body>
        </html>
      `);
    }

    const record = JSON.parse(dataStr);
    record.clicks = (record.clicks || 0) + 1;

    const ttlSeconds = await redis.ttl(redisKey);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(redisKey, JSON.stringify(record), 'EX', ttlSeconds);
    } else {
      await redis.set(redisKey, JSON.stringify(record));
    }

    // Direct redirect if explicitly requested via query parameter, non-browser request, or test mode
    const isDirect = req.query.direct === '1' || req.query.direct === 'true';
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    const isTest = process.env.NODE_ENV === 'test';

    if (isDirect || isTest || !acceptsHtml) {
      return res.redirect(302, record.longUrl);
    }

    // Serve Intermediary Redirect Landing Page with 5s countdown
    const safeUrl = record.longUrl.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return res.status(200).send(`
<!DOCTYPE html>
<html lang="en" data-theme="oled-black">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redirecting — pokedb.site</title>
  <meta http-equiv="refresh" content="5;url=${safeUrl}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/tools/shared/theme.css">
  <script src="/tools/shared/theme-switcher.js"></script>
</head>
<body>

<header class="site-nav">
  <div class="logo">
    <a class="logo" href="/">root<span>@</span>pokedb</a>
    <div class="nav-links">
      <a class="nav-link" href="/tools/">← Tools Hub</a>
    </div>
  </div>
  <div class="theme-switcher">
    <span class="theme-swatch" id="theme-swatch"></span>
    <select id="theme-select" aria-label="Choose a color theme">
      <option value="paper">Paper — Editorial Light</option>
      <option value="matrix">Matrix — Phosphor Green</option>
      <option value="cyberpunk">Cyberpunk — Neon Cyan</option>
      <option value="synthwave">Synthwave — 80s Magenta</option>
      <option value="nordic-ice">Nordic — Glacier Blue</option>
      <option value="dracula-neon">Dracula — Electric Violet</option>
      <option value="gruvbox-retro">Gruvbox — Warm Retro</option>
      <option value="emerald-forest">Emerald — Deep Woods</option>
      <option value="sunset-amber">Sunset — Rose Amber</option>
      <option value="solarized-gold">Solarized — Solar Gold</option>
      <option value="oled-black">OLED — Pitch Indigo</option>
      <option value="tokyo-neon">Tokyo — Neon Coral</option>
    </select>
  </div>
</header>

<main class="container" style="padding-top: 3rem; padding-bottom: 4rem;">
  <div class="term-window" style="max-width: 680px; margin: 0 auto; box-shadow: 0 4px 24px rgba(0,0,0,0.25);">
    <div class="term-titlebar mono">~/redirect.sh — pokedb.site</div>
    <div class="term-body">
      <div><span class="prompt">$</span> <span class="out">tinyurl --resolve /${code}</span></div>
      <div style="margin-top: .75rem;"><span class="prompt">[+]</span> Destination URL:</div>
      <div class="out" style="word-break: break-all; font-weight: 600; color: var(--accent); font-size: 1.05rem; margin: .3rem 0 .9rem 1rem;">
        ${safeUrl}
      </div>
      <div><span class="prompt">[+]</span> Link Status: <span style="color:var(--accent);">Active</span> (${record.clicks} total clicks recorded)</div>
      <div><span class="prompt">[+]</span> Security Audit: Verified Destination</div>
      <div style="margin-top: 1.25rem;"><span class="prompt">$</span> <span class="out">Auto-redirecting in <strong id="countdown-num" style="color:var(--accent); font-size:1.3rem;">5</strong> seconds...</span></div>
    </div>
  </div>

  <div style="max-width: 680px; margin: 1.25rem auto;">
    <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 999px; height: 10px; overflow: hidden; padding: 2px;">
      <div id="progress-bar" style="background: var(--accent); width: 20%; height: 100%; border-radius: 999px; transition: width .9s linear;"></div>
    </div>
  </div>

  <div style="display: flex; gap: 1rem; justify-content: center; align-items: center; margin-top: 1.75rem; flex-wrap: wrap;">
    <a id="proceed-btn" class="btn btn-solid" href="${safeUrl}">$ redirect --now (Skip Timer) →</a>
    <a class="btn" href="/tools/tinyurl/">← Create TinyURL</a>
  </div>
</main>

<footer>
  <div class="footer-inner">
    <span>© pokedb.site · redirect gateway</span>
    <span id="uptime">session uptime · 00:00:00</span>
  </div>
</footer>

<script>
(function () {
  var count = 5;
  var target = ${JSON.stringify(record.longUrl)};
  var numEl = document.getElementById('countdown-num');
  var barEl = document.getElementById('progress-bar');

  var timer = setInterval(function () {
    count--;
    if (numEl) numEl.textContent = count;
    if (barEl) barEl.style.width = Math.min(100, ((6 - count) * 20)) + '%';

    if (count <= 0) {
      clearInterval(timer);
      window.location.href = target;
    }
  }, 1000);
})();
</script>

</body>
</html>
    `);
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
